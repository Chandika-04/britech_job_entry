from sqlalchemy.orm import Session

from app.models.po_line_item import PoLineItem
from app.models.po_request import PoRequest, ReviewState
from app.schemas.extraction import ExtractionResult, WarningItem


DUPLICATE_CODES = {"duplicate_po", "duplicate_po_confirmed"}


def find_duplicate_pos(
    db: Session,
    *,
    customer_codes: set[str],
    po_number: str | None,
    exclude_id: int | None = None,
) -> list[PoRequest]:
    if not customer_codes or not po_number:
        return []
    query = (
        db.query(PoRequest)
        .join(PoLineItem, PoLineItem.po_request_id == PoRequest.id)
        .filter(
            PoRequest.po_number == po_number.strip(),
            PoLineItem.resolved_customer_code.in_(customer_codes),
        )
        .distinct()
    )
    if exclude_id is not None:
        query = query.filter(PoRequest.id != exclude_id)
    return query.order_by(PoRequest.created_at.desc()).all()


def duplicate_warnings(
    db: Session,
    *,
    customer_codes: set[str],
    po_number: str | None,
    exclude_id: int | None = None,
) -> list[WarningItem]:
    matches = find_duplicate_pos(
        db,
        customer_codes=customer_codes,
        po_number=po_number,
        exclude_id=exclude_id,
    )
    if not matches:
        return []

    confirmed = [item for item in matches if item.review_state == ReviewState.confirmed]
    if confirmed:
        sample = confirmed[0]
        return [
            WarningItem(
                code="duplicate_po_confirmed",
                message=(
                    "A confirmed purchase order already exists for this ShopKeeper customer "
                    f"and PO number ({sample.po_number}). Please review carefully."
                ),
                severity="prominent",
            )
        ]
    sample = matches[0]
    return [
        WarningItem(
            code="duplicate_po",
            message=(
                "Another purchase order already exists for this ShopKeeper customer "
                f"and PO number ({sample.po_number})."
            ),
            severity="warning",
        )
    ]


def refresh_duplicate_warnings(db: Session, po: PoRequest) -> None:
    codes = {line.resolved_customer_code for line in po.line_items if line.resolved_customer_code}
    kept = [item for item in (po.warnings or []) if not (isinstance(item, dict) and item.get("code") in DUPLICATE_CODES)]
    extra = duplicate_warnings(db, customer_codes=codes, po_number=po.po_number, exclude_id=po.id)
    po.warnings = kept + [item.model_dump() for item in extra]


def build_warnings(
    db: Session,
    extraction: ExtractionResult,
    *,
    exclude_id: int | None = None,
) -> list[WarningItem]:
    warnings: list[WarningItem] = []

    if not extraction.po_number:
        warnings.append(
            WarningItem(
                code="missing_po_number",
                message="Missing PO number.",
            )
        )
    if not extraction.customer_name:
        warnings.append(
            WarningItem(
                code="missing_customer",
                message="Missing customer.",
            )
        )

    distinct_pos = []
    for value in extraction.possible_po_numbers:
        cleaned = (value or "").strip()
        if cleaned and cleaned not in distinct_pos:
            distinct_pos.append(cleaned)
    if extraction.po_number and extraction.po_number.strip() not in distinct_pos:
        distinct_pos.insert(0, extraction.po_number.strip())
    if len(distinct_pos) > 1:
        listed = ", ".join(distinct_pos)
        warnings.append(
            WarningItem(
                code="multiple_po_numbers",
                message=f"Multiple possible PO numbers were found ({listed}). Please review.",
                severity="prominent",
            )
        )

    if extraction.document_quality == "poor":
        warnings.append(
            WarningItem(
                code="poor_document_quality",
                message="Document quality appears poor. Please inspect the PDF carefully.",
            )
        )
    if extraction.document_quality == "unreadable" or extraction.unreadable_pages:
        pages = ", ".join(str(p) for p in extraction.unreadable_pages) or "unknown"
        warnings.append(
            WarningItem(
                code="unreadable_page",
                message=f"One or more pages appear unreadable (pages: {pages}).",
                severity="prominent",
            )
        )
    if extraction.conflicting_fields:
        fields = ", ".join(extraction.conflicting_fields)
        warnings.append(
            WarningItem(
                code="conflicting_values",
                message=f"Conflicting values were detected for: {fields}.",
            )
        )

    if not extraction.line_items:
        warnings.append(
            WarningItem(
                code="partial_line_item",
                message="No line items were extracted.",
            )
        )

    for item in extraction.line_items:
        label = item.line_number if item.line_number is not None else item.customer_part_number or "a line"
        if item.quantity is None:
            warnings.append(
                WarningItem(
                    code="missing_quantity",
                    message=f"Missing quantity on line {label}.",
                )
            )
        has_identity = bool(item.customer_part_number or item.description)
        has_details = item.quantity is not None or item.unit_price is not None
        if has_identity and not has_details:
            warnings.append(
                WarningItem(
                    code="partial_line_item",
                    message=f"Partial line-item extraction on line {label}.",
                )
            )
        if (item.quantity is not None or item.unit_price is not None) and not has_identity:
            warnings.append(
                WarningItem(
                    code="partial_line_item",
                    message=f"Partial line-item extraction on line {label}.",
                )
            )

    for model_warning in extraction.warnings:
        text = (model_warning or "").strip()
        if text:
            warnings.append(WarningItem(code="extraction_note", message=text, severity="info"))

    return warnings
