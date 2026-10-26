from __future__ import annotations

import threading
from datetime import UTC, date, datetime
from decimal import Decimal, InvalidOperation

from sqlalchemy.orm import Session

from app.config import get_settings
from app.exceptions import AppError, ConflictError, NotFoundError
from app.models.customer_alias import CustomerAlias
from app.models.erp_write_audit import ErpWriteAudit
from app.models.po_line_item import PoLineItem
from app.models.po_request import PoRequest, PoSource, ReviewState
from app.services.extraction.warnings import refresh_duplicate_warnings
from app.services.shopkeeper.matching import MatchResult, match_customer, normalize
from app.services.shopkeeper.provider import ShopKeeperProvider, get_shopkeeper_provider
from app.services.shopkeeper.ops_util import note_to_shopkeeper_html
from app.services.shopkeeper.types import (
    CustomerRecord,
    JobHeaderUpdate,
    JobWritePayload,
    PartRecord,
    PriceQuote,
    ShipLine,
    ShipWritePayload,
)
from app.services.units import normalize_unit

_LINE_LOCKS: dict[int, threading.Lock] = {}
_LINE_LOCKS_GUARD = threading.Lock()
_PO_LOCKS: dict[int, threading.Lock] = {}
_PO_LOCKS_GUARD = threading.Lock()


def _line_lock(line_id: int) -> threading.Lock:
    with _LINE_LOCKS_GUARD:
        return _LINE_LOCKS.setdefault(line_id, threading.Lock())


def _po_lock(po_id: int) -> threading.Lock:
    with _PO_LOCKS_GUARD:
        return _PO_LOCKS.setdefault(po_id, threading.Lock())


def get_line(po: PoRequest, line_id: int) -> PoLineItem:
    for item in po.line_items:
        if item.id == line_id:
            return item
    raise NotFoundError("Line item not found.")


def _line_no(line: PoLineItem) -> str:
    if line.line_number is None:
        raise AppError("Line number is required before creating a ShopKeeper job.", status_code=409)
    return str(line.line_number)


def _tax_for_customer(customer: CustomerRecord) -> tuple[bool, str]:
    settings = get_settings()
    tax_code = (customer.tax_code or "").strip() or settings.shopkeeper_non_tax_code
    return bool(customer.taxable_default), tax_code


def _write_audit(
    db: Session,
    po: PoRequest,
    line: PoLineItem | None,
    action: str,
    status: str,
    job_number: str | None = None,
    request: dict | None = None,
    result: dict | None = None,
    error: str | None = None,
    database_name: str | None = None,
) -> None:
    db.add(
        ErpWriteAudit(
            po_id=po.id,
            line_item_id=line.id if line else None,
            job_number=job_number,
            action=action,
            status=status,
            database_name=database_name,
            app_version=get_settings().app_version,
            request_json=request,
            result_json=result,
            error_message=error,
        )
    )


def _candidate_customer(row: CustomerRecord) -> dict:
    return {
        "customer_number": row.customer_number,
        "company": row.company,
        "record_type": row.record_type,
        "bill_to_customer_number": row.bill_to_customer_number,
        "active": row.active,
        "credit_hold": row.credit_hold,
        "payment_terms": row.payment_terms,
        "shipped_via": row.shipped_via,
        "salesman": row.salesman,
        "cert_default": row.cert_default,
        "taxable_default": row.taxable_default,
        "tax_code": row.tax_code,
        "street": row.street,
        "suite": row.suite,
        "city": row.city,
        "state": row.state,
        "postal_code": row.postal_code,
        "country": row.country,
        "address_block": row.address_block(),
    }


def _candidate_part(row: PartRecord) -> dict:
    return {
        "part_number": row.part_number,
        "part_revision": row.part_revision,
        "description": row.description,
        "master_type": row.master_type,
        "pm_linkid": row.pm_linkid,
        "inactive": row.inactive,
    }


def lookup_customers(query: str, provider: ShopKeeperProvider | None = None) -> dict:
    provider = provider or get_shopkeeper_provider()
    matches = [_candidate_customer(row) for row in provider.lookup_customers(query)]
    exact = [
        row
        for row in matches
        if row["customer_number"].lower() == query.strip().lower()
        or (row["company"] or "").lower() == query.strip().lower()
    ]
    return {"query": query, "matches": matches, "exact_one": len(exact) == 1 or len(matches) == 1}


PRESELECT_STATUSES = {"alias", "exact", "contains"}


def _alias_map(db: Session) -> dict[str, str]:
    return {row.normalized_name: row.customer_number for row in db.query(CustomerAlias).all()}


def _extracted_customer_names(po: PoRequest) -> list[str]:
    return [po.customer_name] if po.customer_name and po.customer_name.strip() else []


def suggest_customer(db: Session, po: PoRequest, provider: ShopKeeperProvider | None = None) -> dict:
    provider = provider or get_shopkeeper_provider()
    names = _extracted_customer_names(po)
    if not names:
        return {
            "extracted_name": None,
            "normalized_name": "",
            "status": "none",
            "customer": None,
            "candidates": [],
            "warning": None,
        }

    customers = provider.list_customers()
    aliases = _alias_map(db)
    best_name = names[0]
    best: MatchResult = match_customer(best_name, customers, aliases)
    if best.status not in PRESELECT_STATUSES:
        for name in names[1:]:
            result = match_customer(name, customers, aliases)
            if result.status in PRESELECT_STATUSES:
                best_name, best = name, result
                break

    return {
        "extracted_name": best_name,
        "normalized_name": best.normalized_name,
        "status": best.status,
        "customer": _candidate_customer(best.customer) if best.customer else None,
        "candidates": [_candidate_customer(row) for row in best.candidates],
        "warning": best.warning,
    }


def save_customer_alias(db: Session, po: PoRequest, customer_number: str) -> CustomerAlias | None:
    names = _extracted_customer_names(po)
    if not names:
        return None
    source_name = names[0]
    key = normalize(source_name)
    if not key:
        return None
    alias = db.query(CustomerAlias).filter_by(normalized_name=key).one_or_none()
    if alias is None:
        alias = CustomerAlias(normalized_name=key, source_name=source_name, customer_number=customer_number)
        db.add(alias)
        db.flush()
    else:
        alias.source_name = source_name
        alias.customer_number = customer_number
    return alias


def lookup_parts(part_number: str, part_revision: str | None = None, provider: ShopKeeperProvider | None = None) -> dict:
    provider = provider or get_shopkeeper_provider()
    matches = [_candidate_part(row) for row in provider.lookup_parts(part_number, part_revision)]
    return {
        "part_number": part_number,
        "part_revision": part_revision,
        "matches": matches,
        "exact_one": len(matches) == 1,
    }


def lookup_prices(
    customer_number: str,
    part_number: str,
    part_revision: str,
    quantity: int | None = None,
    provider: ShopKeeperProvider | None = None,
) -> list[PriceQuote]:
    provider = provider or get_shopkeeper_provider()
    return provider.lookup_prices(customer_number, part_number, part_revision, quantity)


def find_duplicates(po: PoRequest, line: PoLineItem, provider: ShopKeeperProvider | None = None) -> list[str]:
    provider = provider or get_shopkeeper_provider()
    previous = list(line.duplicate_job_numbers or [])
    if not po.po_number or not line.resolved_customer_code or not line.resolved_part_number:
        jobs: list[str] = []
    else:
        jobs = provider.find_duplicate_jobs(
            po.po_number.strip(),
            line.resolved_customer_code,
            line.resolved_part_number,
        )
    line.duplicate_job_numbers = jobs
    if jobs != previous:
        line.duplicate_acknowledged = False
    return jobs


def _resolution_complete(line: PoLineItem) -> bool:
    return bool(line.resolved_customer_code and line.resolved_part_number and line.resolved_part_revision)


def _acks_complete(line: PoLineItem) -> bool:
    if line.customer_credit_hold and not line.credit_hold_acknowledged:
        return False
    if line.duplicate_job_numbers and not line.duplicate_acknowledged:
        return False
    return True


def refresh_line_status(line: PoLineItem, po: PoRequest) -> None:
    if line.erp_status in {"created", "creating", "skipped"}:
        return
    if po.review_state == ReviewState.confirmed and _resolution_complete(line) and _acks_complete(line):
        line.erp_status = "ready"
        return
    if line.erp_status != "failed":
        line.erp_status = "pending"


def refresh_po_erp_status(po: PoRequest) -> None:
    for line in po.line_items:
        refresh_line_status(line, po)


def resolve_customer(
    db: Session,
    po: PoRequest,
    line: PoLineItem,
    customer_code: str,
    apply_to_all: bool,
    provider: ShopKeeperProvider | None = None,
) -> list[PoLineItem]:
    provider = provider or get_shopkeeper_provider()
    customer = provider.get_customer(customer_code)
    if customer is None:
        raise AppError("Customer not found in ShopKeeper.", status_code=404)
    if not customer.active:
        raise AppError("Customer is inactive in ShopKeeper. Resolve it there before using it here.", status_code=409)
    targets = list(po.line_items) if apply_to_all else [line]
    for item in targets:
        if item.erp_status in {"created", "creating"}:
            continue
        item.resolved_customer_code = customer.customer_number
        item.customer_credit_hold = customer.credit_hold
        item.credit_hold_acknowledged = False
        item.cert_required = customer.cert_default
        find_duplicates(po, item, provider)
        refresh_line_status(item, po)
    if po.source == PoSource.manual:
        po.customer_name = (customer.company or "").strip() or customer.customer_number
        po.bill_to = customer.address_block() or None
        ships = provider.lookup_ship_tos(customer.customer_number)
        po.ship_to = (ships[0].address_block() if len(ships) == 1 else customer.address_block()) or None
    save_customer_alias(db, po, customer.customer_number)
    refresh_duplicate_warnings(db, po)
    return targets


def resolve_part(
    db: Session,
    po: PoRequest,
    line: PoLineItem,
    part_number: str,
    part_revision: str,
    provider: ShopKeeperProvider | None = None,
) -> PoLineItem:
    provider = provider or get_shopkeeper_provider()
    part = provider.get_part(part_number, part_revision)
    if part is None:
        raise AppError("Part/revision not found or is inactive in ShopKeeper.", status_code=404)
    if line.erp_status == "creating":
        raise ConflictError("This line already has a ShopKeeper job in progress.")
    line.resolved_part_number = part.part_number
    line.resolved_part_revision = part.part_revision
    line.resolved_pm_linkid = part.pm_linkid
    if po.source == PoSource.manual or line.erp_status == "created":
        line.customer_part_number = part.part_number
        line.revision = part.part_revision
        line.description = part.description
        line.reviewer_edited = True
    find_duplicates(po, line, provider)
    refresh_line_status(line, po)
    if line.erp_status == "created":
        sync_created_line_job(po, line, provider)
    return line


def set_cert_required(
    po: PoRequest,
    line: PoLineItem,
    cert_required: bool,
    apply_to_all: bool = False,
) -> list[PoLineItem]:
    targets = list(po.line_items) if apply_to_all else [line]
    updated: list[PoLineItem] = []
    for item in targets:
        if item.erp_status in {"created", "creating"}:
            if not apply_to_all:
                raise ConflictError("Certificate cannot be changed after the ShopKeeper job is created.")
            continue
        item.cert_required = bool(cert_required)
        updated.append(item)
    return updated


def acknowledge_credit_hold(line: PoLineItem, po: PoRequest, acknowledge: bool = True) -> PoLineItem:
    if not line.customer_credit_hold:
        raise AppError("This customer is not on credit hold.", status_code=409)
    line.credit_hold_acknowledged = acknowledge
    refresh_line_status(line, po)
    return line


def acknowledge_duplicate(line: PoLineItem, po: PoRequest, acknowledge: bool = True) -> PoLineItem:
    if not line.duplicate_job_numbers:
        raise AppError("No duplicate ShopKeeper jobs are recorded for this line.", status_code=409)
    line.duplicate_acknowledged = acknowledge
    refresh_line_status(line, po)
    return line


def skip_line(db: Session, po: PoRequest, line: PoLineItem, reason: str) -> PoLineItem:
    if line.erp_status == "created":
        raise ConflictError("Created jobs cannot be skipped.")
    if line.erp_status == "creating":
        raise ConflictError("A create is already in progress for this line.")
    line.erp_status = "skipped"
    line.erp_failure_reason = reason
    _write_audit(db, po, line, "skip", "success", error=reason)
    return line


def unskip_line(db: Session, po: PoRequest, line: PoLineItem) -> PoLineItem:
    if line.erp_status != "skipped":
        raise ConflictError("Only skipped lines can be un-skipped.")
    previous_reason = line.erp_failure_reason
    line.erp_status = "pending"
    line.erp_failure_reason = None
    refresh_line_status(line, po)
    _write_audit(db, po, line, "unskip", "success", error=previous_reason)
    return line


def reset_erp(db: Session, po: PoRequest, line: PoLineItem, reason: str) -> PoLineItem:
    if line.erp_status != "created":
        raise ConflictError("Only created lines can be reset.")
    previous = line.erp_job_number
    line.erp_status = "pending"
    line.erp_job_number = None
    line.erp_shipper_number = None
    line.erp_created_at = None
    line.erp_failure_reason = None
    line.erp_database = None
    line.erp_traveler_printed = False
    refresh_line_status(line, po)
    _write_audit(db, po, line, "reset", "success", job_number=previous, error=reason)
    return line


def _line_for_job(db: Session, job_number: str) -> tuple[PoRequest, PoLineItem] | None:
    line = db.query(PoLineItem).filter(PoLineItem.erp_job_number == job_number).first()
    if line is None:
        return None
    return line.po_request, line


def delete_shopkeeper_job(
    db: Session,
    job_number: str,
    provider: ShopKeeperProvider | None = None,
) -> PoLineItem | None:
    provider = provider or get_shopkeeper_provider()
    number = (job_number or "").strip()
    if not number:
        raise AppError("Job number is required.", status_code=409)
    db.flush()
    found = _line_for_job(db, number)
    try:
        database_name = provider.current_database()
        provider.delete_job(number)
    except AppError as exc:
        if found is not None:
            po, line = found
            _write_audit(
                db,
                po,
                line,
                "delete_job",
                "failed",
                job_number=number,
                error=exc.message,
            )
        raise
    if found is None:
        return None
    po, line = found
    _write_audit(
        db,
        po,
        line,
        "delete_job",
        "success",
        job_number=number,
        database_name=database_name,
    )
    return reset_erp(db, po, line, f"Deleted ShopKeeper job {number}.")


def delete_shopkeeper_job_for_line(
    db: Session,
    po: PoRequest,
    line: PoLineItem,
    provider: ShopKeeperProvider | None = None,
) -> PoLineItem:
    if line.erp_status != "created" or not line.erp_job_number:
        raise ConflictError("This line has no ShopKeeper job to delete.")
    deleted = delete_shopkeeper_job(db, line.erp_job_number, provider)
    return deleted if deleted is not None else line


def sync_created_line_job(
    po: PoRequest,
    line: PoLineItem,
    provider: ShopKeeperProvider | None = None,
) -> None:
    if line.erp_status != "created" or not line.erp_job_number:
        return
    provider = provider or get_shopkeeper_provider()
    if not po.po_number:
        raise ConflictError("PO number is required before saving ShopKeeper job changes.")
    if not line.resolved_customer_code:
        raise ConflictError("Match a ShopKeeper customer before saving ShopKeeper job changes.")
    part_number = line.resolved_part_number or line.customer_part_number
    part_revision = line.resolved_part_revision or line.revision or "-"
    if not part_number:
        raise ConflictError("Enter a part number.")
    if po.order_date is None:
        raise ConflictError("Enter the job date.")
    provider.update_job_header(
        line.erp_job_number,
        JobHeaderUpdate(
            customer_code=line.resolved_customer_code,
            po_number=po.po_number,
            po_line=str(line.line_number) if line.line_number is not None else None,
            part_number=part_number,
            part_revision=part_revision,
            description=line.description,
            quantity=_positive_int_quantity(line),
            unit=normalize_unit(line.uom) or "Each",
            unit_price=_unit_price(line),
            order_date=po.order_date,
            notes=note_to_shopkeeper_html(line.notes),
            cert_required=bool(line.cert_required),
        ),
    )


def _positive_int_quantity(line: PoLineItem) -> int:
    if line.quantity is None:
        raise AppError("Quantity is required and must be a positive integer.", status_code=409)
    try:
        qty = Decimal(str(line.quantity))
    except (InvalidOperation, ValueError) as exc:
        raise AppError("Quantity is required and must be a positive integer.", status_code=409) from exc
    if qty <= 0 or qty != qty.to_integral_value():
        raise AppError("Quantity is required and must be a positive integer.", status_code=409)
    return int(qty)


def _unit_price(line: PoLineItem) -> Decimal:
    if line.unit_price is None:
        raise AppError("Unit price is required and must be zero or greater.", status_code=409)
    try:
        price = Decimal(str(line.unit_price))
    except (InvalidOperation, ValueError) as exc:
        raise AppError("Unit price is required and must be zero or greater.", status_code=409) from exc
    if price < 0:
        raise AppError("Unit price is required and must be zero or greater.", status_code=409)
    return price


def _write_time_checks(
    po: PoRequest,
    line: PoLineItem,
    provider: ShopKeeperProvider,
) -> tuple[CustomerRecord, PartRecord, int, Decimal]:
    if not po.po_number:
        raise AppError("PO number is required before creating a ShopKeeper job.", status_code=409)
    if line.line_number is None:
        raise AppError("Line number is required before creating a ShopKeeper job.", status_code=409)
    if not line.due_date:
        raise AppError("Due date is required before creating a ShopKeeper job.", status_code=409)
    if not line.resolved_customer_code or not line.resolved_part_number or not line.resolved_part_revision:
        raise AppError("Resolve customer and part/revision before creating a job.", status_code=409)

    customer = provider.get_customer(line.resolved_customer_code)
    if customer is None:
        raise AppError("Resolved customer no longer exists in ShopKeeper.", status_code=409)
    if not customer.active:
        raise AppError("Resolved customer is inactive in ShopKeeper.", status_code=409)
    if customer.credit_hold:
        line.customer_credit_hold = True
        if not line.credit_hold_acknowledged:
            raise AppError("Customer is on credit hold. Acknowledge before creating the job.", status_code=409)

    part = provider.get_part(line.resolved_part_number, line.resolved_part_revision)
    if part is None:
        raise AppError("Resolved part/revision no longer exists or is inactive in ShopKeeper.", status_code=409)

    find_duplicates(po, line, provider)
    if line.duplicate_job_numbers and not line.duplicate_acknowledged:
        raise AppError(
            "A ShopKeeper job already exists for this customer, PO, and part. Acknowledge before creating another.",
            status_code=409,
        )

    return customer, part, _positive_int_quantity(line), _unit_price(line)


def create_job_for_line(
    db: Session,
    po: PoRequest,
    line: PoLineItem,
    provider: ShopKeeperProvider | None = None,
) -> PoLineItem:
    provider = provider or get_shopkeeper_provider()
    lock = _line_lock(line.id)
    if not lock.acquire(blocking=False):
        raise ConflictError("A create is already in progress for this line.")

    try:
        db.refresh(line)
        if po.review_state != ReviewState.confirmed:
            raise ConflictError("PO must be confirmed before creating ShopKeeper jobs.")
        if line.erp_status == "created" or line.erp_job_number:
            raise ConflictError(
                f"This line already created ShopKeeper job {line.erp_job_number or '(unknown)'}."
            )
        if line.erp_status == "skipped":
            raise ConflictError("This line was skipped. Un-skip it before creating a job.")

        database_name = None
        try:
            database_name = provider.current_database()
        except AppError:
            raise

        if line.erp_status in {"creating", "failed"}:
            recovered = provider.find_jobs_by_po_line(po.po_number or "", str(line.line_number or ""))
            if recovered:
                line.erp_status = "created"
                line.erp_job_number = recovered[0]
                line.erp_failure_reason = None
                line.erp_database = database_name
                line.erp_created_at = datetime.now(UTC)
                _write_audit(
                    db,
                    po,
                    line,
                    "recover",
                    "success",
                    recovered[0],
                    result={"jobs": recovered},
                    database_name=database_name,
                )
                return line

        line.erp_status = "creating"
        line.erp_failure_reason = None
        _write_audit(db, po, line, "attempt", "started", database_name=database_name)
        db.flush()

        try:
            customer, part, quantity, unit_price = _write_time_checks(po, line, provider)
            settings = get_settings()
            taxable, tax_code = _tax_for_customer(customer)
            payload = JobWritePayload(
                po_number=po.po_number or "",
                po_line=_line_no(line),
                customer_code=line.resolved_customer_code or "",
                part_number=line.resolved_part_number or "",
                part_revision=line.resolved_part_revision or "",
                part_description=part.description,
                quantity=quantity,
                unit_price=unit_price,
                unit=normalize_unit(line.uom),
                due_date=line.due_date,
                cert_required=line.cert_required,
                taxable=taxable,
                tax_code=tax_code,
                status=settings.shopkeeper_new_job_status,
                salesperson=customer.salesman,
                terms=customer.payment_terms,
                ship_via=customer.shipped_via,
                master_type=part.master_type,
                pm_linkid=part.pm_linkid,
            )
            request = {
                "po_number": payload.po_number,
                "po_line": payload.po_line,
                "customer_code": payload.customer_code,
                "part_number": payload.part_number,
                "part_revision": payload.part_revision,
                "quantity": payload.quantity,
                "unit_price": str(payload.unit_price),
                "unit": payload.unit,
                "cert_required": payload.cert_required,
            }
            job_number = provider.create_job(payload)
            line.erp_status = "created"
            line.erp_job_number = job_number
            line.erp_created_at = datetime.now(UTC)
            line.erp_database = database_name
            line.erp_failure_reason = None
            _write_audit(
                db,
                po,
                line,
                "create_job",
                "success",
                job_number,
                request,
                {"job_number": job_number},
                database_name=database_name,
            )
            return line
        except AppError as exc:
            recovered = _try_recover(provider, po, line)
            if recovered:
                _mark_recovered(db, po, line, recovered, database_name)
                return line
            line.erp_status = "failed"
            line.erp_failure_reason = exc.message
            _write_audit(db, po, line, "create_job", "failed", error=exc.message, database_name=database_name)
            raise
        except Exception as exc:
            recovered = _try_recover(provider, po, line)
            if recovered:
                _mark_recovered(db, po, line, recovered, database_name)
                return line
            line.erp_status = "failed"
            line.erp_failure_reason = str(exc)
            _write_audit(db, po, line, "create_job", "failed", error=str(exc), database_name=database_name)
            raise AppError(f"ShopKeeper job create failed: {exc}", status_code=502) from exc
    finally:
        lock.release()


def _try_recover(provider: ShopKeeperProvider, po: PoRequest, line: PoLineItem) -> list[str]:
    try:
        if not po.po_number or line.line_number is None:
            return []
        return provider.find_jobs_by_po_line(po.po_number, str(line.line_number))
    except Exception:
        return []


def _mark_recovered(
    db: Session,
    po: PoRequest,
    line: PoLineItem,
    recovered: list[str],
    database_name: str | None,
) -> None:
    line.erp_status = "created"
    line.erp_job_number = recovered[0]
    line.erp_failure_reason = None
    line.erp_database = database_name
    line.erp_created_at = datetime.now(UTC)
    _write_audit(
        db,
        po,
        line,
        "recover",
        "success",
        recovered[0],
        result={"jobs": recovered},
        database_name=database_name,
    )


def _jobs_complete(po: PoRequest) -> bool:
    lines = list(po.line_items)
    return bool(lines) and all(line.erp_status == "created" and line.erp_job_number for line in lines)


def _created_lines_in_order(po: PoRequest) -> list[PoLineItem]:
    return sorted(
        [line for line in po.line_items if line.erp_status == "created" and line.erp_job_number],
        key=lambda line: (line.line_number is None, line.line_number or 0),
    )


def _try_recover_shipper(provider: ShopKeeperProvider, job_numbers: list[str]) -> str | None:
    try:
        return provider.find_shipper_for_jobs(job_numbers)
    except Exception:
        return None


PREPARED_BY_MAX = 20


def normalize_prepared_by(value: str | None) -> str | None:
    text = "".join((value or "").split())
    if not text:
        return None
    if len(text) > PREPARED_BY_MAX:
        raise AppError("Prepared by initials must be 20 characters or fewer.")
    if not all(ch.isalnum() or ch in ".-" for ch in text):
        raise AppError("Prepared by initials can only include letters, numbers, periods, and hyphens.")
    return text.upper()


def _ship_payload(
    provider: ShopKeeperProvider, lines: list[PoLineItem], *, ship_by: str | None = None
) -> ShipWritePayload:
    customer_code = lines[0].resolved_customer_code or ""
    customer = provider.get_customer(customer_code) if customer_code else None
    return ShipWritePayload(
        ship_via=customer.shipped_via if customer else None,
        ship_by=ship_by,
        ship_date=date.today(),
        lines=[
            ShipLine(job_number=line.erp_job_number or "", quantity=_positive_int_quantity(line))
            for line in lines
        ],
    )


def _lines_missing_from_shipper(
    provider: ShopKeeperProvider, ship_number: str, lines: list[PoLineItem]
) -> list[PoLineItem]:
    missing: list[PoLineItem] = []
    for line in lines:
        current = provider.find_shipper_for_jobs([line.erp_job_number or ""])
        if current == ship_number:
            continue
        if current:
            raise ConflictError(f"Job {line.erp_job_number} is already on shipper {current}.")
        missing.append(line)
    return missing


def _mark_on_shipper(lines: list[PoLineItem], ship_number: str) -> None:
    for line in lines:
        line.erp_shipper_number = ship_number


def create_shipper_for_po(
    db: Session,
    po: PoRequest,
    provider: ShopKeeperProvider | None = None,
    *,
    prepared_by: str | None = None,
) -> PoRequest:
    provider = provider or get_shopkeeper_provider()
    lock = _po_lock(po.id)
    if not lock.acquire(blocking=False):
        raise ConflictError("A shipper create is already in progress for this PO.")

    try:
        db.refresh(po)
        if po.review_state != ReviewState.confirmed:
            raise ConflictError("PO must be confirmed before creating a shipper.")
        if not _jobs_complete(po):
            raise ConflictError("Every line must have a created ShopKeeper job before creating a shipper.")

        database_name = provider.current_database()
        lines = _created_lines_in_order(po)
        job_numbers = [line.erp_job_number or "" for line in lines]

        if po.shipper_number:
            missing = _lines_missing_from_shipper(provider, po.shipper_number, lines)
            if not missing:
                _mark_on_shipper(lines, po.shipper_number)
                return po
            payload = _ship_payload(provider, missing)
            request = {
                "shipper_number": po.shipper_number,
                "ship_via": payload.ship_via,
                "ship_by": payload.ship_by,
                "ship_date": payload.ship_date.isoformat(),
                "jobs": [{"job_number": line.job_number, "quantity": line.quantity} for line in payload.lines],
            }
            _write_audit(db, po, None, "attempt_shipper", "started", request=request, database_name=database_name)
            db.flush()
            try:
                provider.add_jobs_to_shipper(po.shipper_number, payload)
                _mark_on_shipper(missing, po.shipper_number)
                _write_audit(
                    db,
                    po,
                    None,
                    "attach_shipper",
                    "success",
                    po.shipper_number,
                    request,
                    {"shipper_number": po.shipper_number, "jobs": [line.erp_job_number for line in missing]},
                    database_name=database_name,
                )
                return po
            except AppError as exc:
                _write_audit(
                    db, po, None, "attach_shipper", "failed", error=exc.message, database_name=database_name
                )
                raise
            except Exception as exc:
                _write_audit(
                    db, po, None, "attach_shipper", "failed", error=str(exc), database_name=database_name
                )
                raise AppError(f"ShopKeeper shipper update failed: {exc}", status_code=502) from exc

        recovered = provider.find_shipper_for_jobs(job_numbers)
        if recovered:
            po.shipper_number = recovered
            _mark_on_shipper(lines, recovered)
            _write_audit(
                db,
                po,
                None,
                "recover_shipper",
                "success",
                recovered,
                result={"shipper_number": recovered, "jobs": job_numbers},
                database_name=database_name,
            )
            return po

        initials = normalize_prepared_by(prepared_by)
        if not initials:
            raise AppError("Prepared by initials are required to create a shipper.")
        payload = _ship_payload(provider, lines, ship_by=initials)
        request = {
            "ship_via": payload.ship_via,
            "ship_by": payload.ship_by,
            "ship_date": payload.ship_date.isoformat(),
            "jobs": [{"job_number": line.job_number, "quantity": line.quantity} for line in payload.lines],
        }
        _write_audit(db, po, None, "attempt_shipper", "started", request=request, database_name=database_name)
        db.flush()

        try:
            ship_number = provider.create_shipper(payload)
            po.shipper_number = ship_number
            _mark_on_shipper(lines, ship_number)
            _write_audit(
                db,
                po,
                None,
                "create_shipper",
                "success",
                ship_number,
                request,
                {"shipper_number": ship_number},
                database_name=database_name,
            )
            return po
        except AppError as exc:
            recovered = _try_recover_shipper(provider, job_numbers)
            if recovered:
                po.shipper_number = recovered
                _mark_on_shipper(lines, recovered)
                _write_audit(
                    db,
                    po,
                    None,
                    "recover_shipper",
                    "success",
                    recovered,
                    result={"shipper_number": recovered, "jobs": job_numbers},
                    database_name=database_name,
                )
                return po
            _write_audit(
                db, po, None, "create_shipper", "failed", error=exc.message, database_name=database_name
            )
            raise
        except Exception as exc:
            recovered = _try_recover_shipper(provider, job_numbers)
            if recovered:
                po.shipper_number = recovered
                _mark_on_shipper(lines, recovered)
                _write_audit(
                    db,
                    po,
                    None,
                    "recover_shipper",
                    "success",
                    recovered,
                    result={"shipper_number": recovered, "jobs": job_numbers},
                    database_name=database_name,
                )
                return po
            _write_audit(db, po, None, "create_shipper", "failed", error=str(exc), database_name=database_name)
            raise AppError(f"ShopKeeper shipper create failed: {exc}", status_code=502) from exc
    finally:
        lock.release()
