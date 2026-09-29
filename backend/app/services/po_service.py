from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import or_
from sqlalchemy.orm import Session, selectinload

from app.config import Settings, get_settings
from app.models.erp_write_audit import ErpWriteAudit
from app.models.po_line_item import PoLineItem
from app.models.po_request import PoRequest, PoStatus, ReviewState
from app.schemas.extraction import WarningItem
from app.schemas.po import LineItemIn, PoDetail, PoSummary, PoUpdate
from app.services.extraction.warnings import DUPLICATE_CODES, refresh_duplicate_warnings
from app.services.pdf.processor import sanitize_filename, validate_pdf
from app.services.storage.pdf_storage import pdf_storage
from app.services.units import normalize_unit
from app.exceptions import ConflictError, NotFoundError

logger = logging.getLogger(__name__)

HEADER_FIELDS = (
    "po_number",
    "customer_name",
    "order_date",
    "requested_ship_date",
    "buyer_contact",
    "buyer_notes",
    "bill_to",
    "ship_to",
)


def _as_warnings(raw: object) -> list[WarningItem]:
    if not raw:
        return []
    items: list[WarningItem] = []
    if isinstance(raw, list):
        for entry in raw:
            if isinstance(entry, dict):
                items.append(WarningItem.model_validate(entry))
            elif isinstance(entry, str):
                items.append(WarningItem(code="extraction_note", message=entry, severity="info"))
    return items


def is_stale(po: PoRequest, settings: Settings | None = None) -> bool:
    settings = settings or get_settings()
    if po.status != PoStatus.pending:
        return False
    reference = po.heartbeat_at or po.created_at
    if reference is None:
        return True
    if reference.tzinfo is None:
        reference = reference.replace(tzinfo=UTC)
    age = datetime.now(UTC) - reference
    return age > timedelta(seconds=settings.heartbeat_stale_seconds)


def to_summary(po: PoRequest, settings: Settings | None = None) -> PoSummary:
    warnings = _as_warnings(po.warnings)
    line_count = len(po.line_items)
    jobs_created_count = sum(1 for line in po.line_items if line.erp_status == "created")
    return PoSummary(
        id=po.id,
        created_at=po.created_at,
        updated_at=po.updated_at,
        status=po.status,
        review_state=po.review_state,
        po_number=po.po_number,
        customer_name=po.customer_name,
        warnings=warnings,
        is_stale=is_stale(po, settings),
        has_duplicate_warning=any(
            item.code in DUPLICATE_CODES for item in warnings
        ),
        page_count=po.attachment.page_count if po.attachment else None,
        line_count=line_count,
        jobs_created_count=jobs_created_count,
        jobs_complete=line_count > 0 and jobs_created_count == line_count,
    )


def to_detail(po: PoRequest, settings: Settings | None = None) -> PoDetail:
    summary = to_summary(po, settings)
    return PoDetail(
        **summary.model_dump(),
        heartbeat_at=po.heartbeat_at,
        order_date=po.order_date,
        requested_ship_date=po.requested_ship_date,
        buyer_contact=po.buyer_contact,
        buyer_notes=po.buyer_notes,
        bill_to=po.bill_to,
        ship_to=po.ship_to,
        extraction_error=po.extraction_error,
        line_items=list(po.line_items),
        llm_calls=list(po.llm_calls),
        attachment_filename=po.attachment.filename if po.attachment else None,
    )


def create_from_upload(
    db: Session,
    *,
    filename: str,
    content_type: str,
    pdf_bytes: bytes,
) -> PoRequest:
    settings = get_settings()
    page_count = validate_pdf(pdf_bytes, settings)
    po = PoRequest(
        status=PoStatus.pending,
        review_state=ReviewState.unreviewed,
        warnings=[],
    )
    db.add(po)
    db.flush()
    attachment = pdf_storage.save(
        db,
        po_request_id=po.id,
        filename=sanitize_filename(filename),
        content_type=content_type or "application/pdf",
        pdf_bytes=pdf_bytes,
        page_count=page_count,
    )
    try:
        db.commit()
    except Exception:
        db.rollback()
        pdf_storage.delete_files(attachment.storage_path)
        raise
    db.refresh(po)
    return po


def get_po(db: Session, po_id: UUID) -> PoRequest:
    po = db.get(PoRequest, po_id)
    if po is None:
        raise NotFoundError()
    return po


def list_pos(
    db: Session,
    *,
    q: str | None = None,
    status: PoStatus | None = None,
    review_state: ReviewState | None = None,
    sort: str = "created_at",
    order: str = "desc",
    page: int = 1,
    page_size: int = 20,
) -> tuple[list[PoRequest], int]:
    query = db.query(PoRequest)
    if q:
        like = f"%{q.strip()}%"
        query = query.filter(
            or_(
                PoRequest.po_number.ilike(like),
                PoRequest.customer_name.ilike(like),
            )
        )
    if status:
        query = query.filter(PoRequest.status == status)
    if review_state:
        query = query.filter(PoRequest.review_state == review_state)

    sort_map = {
        "created_at": PoRequest.created_at,
        "updated_at": PoRequest.updated_at,
        "po_number": PoRequest.po_number,
        "customer_name": PoRequest.customer_name,
        "status": PoRequest.status,
        "review_state": PoRequest.review_state,
    }
    sort_col = sort_map.get(sort, PoRequest.created_at)
    if order.lower() == "asc":
        query = query.order_by(sort_col.asc())
    else:
        query = query.order_by(sort_col.desc())

    total = query.count()
    page = max(page, 1)
    page_size = min(max(page_size, 1), 100)
    items = (
        query.options(selectinload(PoRequest.line_items), selectinload(PoRequest.attachment))
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return items, total


def _line_item_changed(existing: PoLineItem | None, incoming: LineItemIn) -> bool:
    if existing is None:
        return True
    return (
        existing.line_number != incoming.line_number
        or (existing.customer_part_number or None) != (incoming.customer_part_number or None)
        or (existing.revision or None) != (incoming.revision or None)
        or (existing.description or None) != (incoming.description or None)
        or existing.quantity != incoming.quantity
        or existing.unit_price != incoming.unit_price
        or (existing.uom or None) != (incoming.uom or None)
        or existing.due_date != incoming.due_date
        or (existing.notes or None) != (incoming.notes or None)
    )


def apply_update(db: Session, po: PoRequest, payload: PoUpdate) -> bool:
    """Apply reviewer edits. Returns True if stored data changed."""
    changed = False
    for incoming in payload.line_items:
        incoming.uom = normalize_unit(incoming.uom)
    for field in HEADER_FIELDS:
        new_value = getattr(payload, field)
        if getattr(po, field) != new_value:
            setattr(po, field, new_value)
            changed = True

    existing_by_id = {item.id: item for item in po.line_items}
    incoming_ids = {item.id for item in payload.line_items if item.id}
    for item in list(po.line_items):
        if item.id not in incoming_ids:
            db.query(ErpWriteAudit).filter(ErpWriteAudit.line_item_id == item.id).update(
                {ErpWriteAudit.line_item_id: None}, synchronize_session=False
            )
            po.line_items.remove(item)
            changed = True

    for incoming in payload.line_items:
        existing = existing_by_id.get(incoming.id) if incoming.id else None
        if existing is None:
            po.line_items.append(
                PoLineItem(
                    line_number=incoming.line_number,
                    customer_part_number=incoming.customer_part_number,
                    revision=incoming.revision,
                    description=incoming.description,
                    quantity=incoming.quantity,
                    unit_price=incoming.unit_price,
                    uom=incoming.uom,
                    due_date=incoming.due_date,
                    notes=incoming.notes,
                    reviewer_edited=True,
                )
            )
            changed = True
            continue
        if _line_item_changed(existing, incoming):
            existing.line_number = incoming.line_number
            existing.customer_part_number = incoming.customer_part_number
            existing.revision = incoming.revision
            existing.description = incoming.description
            existing.quantity = incoming.quantity
            existing.unit_price = incoming.unit_price
            existing.uom = incoming.uom
            existing.due_date = incoming.due_date
            existing.notes = incoming.notes
            existing.reviewer_edited = True
            changed = True

    if changed:
        refresh_duplicate_warnings(db, po)
        if po.review_state == ReviewState.confirmed:
            po.review_state = ReviewState.unreviewed
    return changed


def save_draft(db: Session, po: PoRequest, payload: PoUpdate) -> PoRequest:
    apply_update(db, po, payload)
    from app.services.shopkeeper.writer import refresh_po_erp_status

    refresh_po_erp_status(po)
    db.add(po)
    db.commit()
    db.refresh(po)
    return po


def confirm_reviewed(db: Session, po: PoRequest, payload: PoUpdate | None = None) -> PoRequest:
    if payload is not None:
        apply_update(db, po, payload)
    if po.status != PoStatus.extracted:
        raise ConflictError("This purchase order cannot be confirmed until extraction has completed.")
    po.review_state = ReviewState.confirmed
    from app.services.shopkeeper.writer import refresh_po_erp_status

    refresh_po_erp_status(po)
    db.add(po)
    db.commit()
    db.refresh(po)
    return po


def queue_reextract(db: Session, po: PoRequest) -> PoRequest:
    if po.attachment is None:
        raise ConflictError("The original PDF is missing, so this purchase order cannot be re-extracted.")
    po.status = PoStatus.pending
    po.review_state = ReviewState.unreviewed
    po.extraction_error = None
    po.heartbeat_at = None
    db.add(po)
    db.commit()
    db.refresh(po)
    return po


def delete_po(db: Session, po: PoRequest) -> None:
    storage_path = po.attachment.storage_path if po.attachment else None
    db.query(ErpWriteAudit).filter(ErpWriteAudit.po_id == po.id).delete(synchronize_session=False)
    db.delete(po)
    db.commit()
    if storage_path:
        pdf_storage.delete_files(storage_path)


def claim_pending_job(db: Session, settings: Settings | None = None) -> UUID | None:
    settings = settings or get_settings()
    stale_before = datetime.now(UTC) - timedelta(seconds=settings.heartbeat_stale_seconds)
    dialect = db.get_bind().dialect.name

    query = (
        db.query(PoRequest)
        .filter(PoRequest.status == PoStatus.pending)
        .filter(or_(PoRequest.heartbeat_at.is_(None), PoRequest.heartbeat_at < stale_before))
        .order_by(PoRequest.created_at.asc())
    )
    if dialect in {"postgresql", "mssql"}:
        query = query.with_for_update(skip_locked=True)
    po = query.first()
    if po is None:
        return None
    po.heartbeat_at = datetime.now(UTC)
    db.add(po)
    db.commit()
    return po.id
