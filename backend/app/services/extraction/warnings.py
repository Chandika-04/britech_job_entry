from uuid import UUID

from sqlalchemy.orm import Session

from app.models.po_request import PoRequest, ReviewState
from app.schemas.extraction import ExtractionResult, WarningItem


def find_duplicate_pos(
    db: Session,
    *,
    customer_number: str | None,
    po_number: str | None,
    exclude_id: UUID | None = None,
) -> list[PoRequest]:
    if not customer_number or not po_number:
        return []
    query = db.query(PoRequest).filter(
        PoRequest.customer_number == customer_number.strip(),
        PoRequest.po_number == po_number.strip(),
    )
    if exclude_id is not None:
        query = query.filter(PoRequest.id != exclude_id)
    return query.order_by(PoRequest.created_at.desc()).all()


def duplicate_warnings(
    db: Session,
    *,
    customer_number: str | None,
    po_number: str | None,
    exclude_id: UUID | None = None,
) -> list[WarningItem]:
    matches = find_duplicate_pos(
        db,
        customer_number=customer_number,
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
                    "A confirmed purchase order already exists for this customer number "
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
                "Another purchase order already exists for this customer number "
                f"and PO number ({sample.po_number})."
            ),
            severity="warning",
        )
    ]


def build_warnings(
    db: Session,
    extraction: ExtractionResult,
    *,
    exclude_id: UUID | None = None,
) -> list[WarningItem]:
    warnings: list[WarningItem] = []

    if not extraction.po_number:
        warnings.append(
            WarningItem(
                code="missing_po_number",
                message="Missing PO number.",
            )
        )
    if not extraction.customer_name and not extraction.customer_number:
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
        if item.due_date is None:
            warnings.append(
                WarningItem(
                    code="missing_due_date",
                    message=f"Missing due date on line {label}.",
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

    warnings.extend(
        duplicate_warnings(
            db,
            customer_number=extraction.customer_number,
            po_number=extraction.po_number,
            exclude_id=exclude_id,
        )
    )
    return warnings
