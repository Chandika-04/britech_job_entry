from __future__ import annotations

import logging
import threading
from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.database.session import get_session_factory
from app.models.llm_call import LlmCall
from app.models.po_line_item import PoLineItem
from app.models.po_request import PoRequest, PoStatus, ReviewState
from app.schemas.extraction import ExtractionResult, ProviderResult
from app.services.extraction.provider import ExtractionProvider, get_extraction_provider
from app.services.extraction.warnings import build_warnings
from app.services.pdf.processor import process_pdf
from app.services.storage.pdf_storage import pdf_storage

logger = logging.getLogger(__name__)


def _apply_extraction(po: PoRequest, extraction: ExtractionResult) -> None:
    po.po_number = extraction.po_number
    po.customer_name = extraction.customer_name
    po.customer_number = extraction.customer_number
    po.order_date = extraction.order_date
    po.requested_ship_date = extraction.requested_ship_date
    po.buyer_contact = extraction.buyer_contact
    po.buyer_notes = extraction.buyer_notes
    po.bill_to = extraction.bill_to
    po.ship_to = extraction.ship_to
    po.line_items.clear()
    for item in extraction.line_items:
        po.line_items.append(
            PoLineItem(
                line_number=item.line_number,
                customer_part_number=item.customer_part_number,
                revision=item.revision,
                description=item.description,
                quantity=item.quantity,
                unit_price=item.unit_price,
                uom=item.uom,
                due_date=item.due_date,
                notes=item.notes,
                reviewer_edited=False,
            )
        )


def _set_heartbeat(po_id: UUID) -> None:
    factory = get_session_factory()
    session = factory()
    try:
        po = session.get(PoRequest, po_id)
        if po is None:
            return
        po.heartbeat_at = datetime.now(UTC)
        session.add(po)
        session.commit()
    except Exception:
        logger.exception("Failed to update extraction heartbeat for %s", po_id)
        session.rollback()
    finally:
        session.close()


def run_extraction(
    db: Session,
    po_id: UUID,
    *,
    call_type: str = "extract",
    provider: ExtractionProvider | None = None,
    settings: Settings | None = None,
) -> None:
    settings = settings or get_settings()
    provider = provider or get_extraction_provider()
    logger.info(
        "Running extraction for %s with provider=%s call_type=%s",
        po_id,
        type(provider).__name__,
        call_type,
    )
    po = db.get(PoRequest, po_id)
    if po is None:
        logger.error("Extraction requested for missing PO %s", po_id)
        return

    attachment = pdf_storage.get_by_po(db, po_id)
    if attachment is None:
        po.status = PoStatus.failed
        po.extraction_error = "Extraction failed. Please try again."
        db.add(po)
        db.commit()
        return

    stop = threading.Event()

    def heartbeat_loop() -> None:
        _set_heartbeat(po_id)
        while not stop.wait(settings.heartbeat_interval_seconds):
            _set_heartbeat(po_id)

    worker = threading.Thread(target=heartbeat_loop, daemon=True)
    try:
        _set_heartbeat(po_id)
        db.refresh(po)
        processed = process_pdf(attachment.pdf_bytes, settings)
        worker.start()
        result: ProviderResult = provider.extract(processed)
        db.expire_all()
        po = db.get(PoRequest, po_id)
        if po is None:
            return
        warnings = build_warnings(db, result.extraction, exclude_id=po.id)
        _apply_extraction(po, result.extraction)
        po.warnings = [item.model_dump() for item in warnings]
        po.status = PoStatus.extracted
        po.review_state = ReviewState.unreviewed
        po.extraction_error = None
        po.heartbeat_at = datetime.now(UTC)
        db.add(
            LlmCall(
                po_request_id=po.id,
                model=result.model,
                call_type=call_type,
                input_tokens=result.input_tokens,
                output_tokens=result.output_tokens,
                cost_usd=result.cost_usd,
                raw_extraction_json=result.raw_json,
            )
        )
        db.add(po)
        db.commit()
    except Exception:
        logger.exception("Extraction failed for PO %s", po_id)
        db.rollback()
        po = db.get(PoRequest, po_id)
        if po is not None:
            po.status = PoStatus.failed
            po.extraction_error = "Extraction failed. Please try again."
            po.heartbeat_at = datetime.now(UTC)
            db.add(po)
            db.commit()
    finally:
        stop.set()
