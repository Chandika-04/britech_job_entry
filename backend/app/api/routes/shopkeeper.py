from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.schemas.po import PoDetail
from app.schemas.shopkeeper import (
    AcknowledgeIn,
    CustomerLookupResponse,
    CustomerSuggestionResponse,
    DuplicateCheckOut,
    PartLookupResponse,
    ResetErpIn,
    ResolveCustomerIn,
    ResolvePartIn,
    SkipLineIn,
)
from app.services.po_service import get_po, to_detail
from app.services.shopkeeper import get_shopkeeper_provider
from app.services.shopkeeper.writer import (
    acknowledge_credit_hold,
    acknowledge_duplicate,
    create_job_for_line,
    find_duplicates,
    get_line,
    lookup_customers,
    lookup_parts,
    reset_erp,
    resolve_customer,
    resolve_part,
    skip_line,
    suggest_customer,
    unskip_line,
)

router = APIRouter(tags=["shopkeeper"])


@router.get("/shopkeeper/status")
def shopkeeper_status() -> dict:
    provider = get_shopkeeper_provider()
    return {"database": provider.current_database()}


@router.get("/shopkeeper/customers", response_model=CustomerLookupResponse)
def shopkeeper_customers(q: str = Query(..., min_length=1)) -> CustomerLookupResponse:
    return CustomerLookupResponse.model_validate(lookup_customers(q))


@router.get("/shopkeeper/parts", response_model=PartLookupResponse)
def shopkeeper_parts(
    part_number: str = Query(..., min_length=1),
    part_revision: str | None = Query(None),
) -> PartLookupResponse:
    return PartLookupResponse.model_validate(lookup_parts(part_number, part_revision or None))


@router.get("/po/{po_id}/customer-suggestion", response_model=CustomerSuggestionResponse)
def po_customer_suggestion(po_id: UUID, db: Session = Depends(get_db)) -> CustomerSuggestionResponse:
    po = get_po(db, po_id)
    return CustomerSuggestionResponse.model_validate(suggest_customer(db, po))


@router.get("/po/{po_id}/lines/{line_id}/duplicates", response_model=DuplicateCheckOut)
def line_duplicates(po_id: UUID, line_id: UUID, db: Session = Depends(get_db)) -> DuplicateCheckOut:
    po = get_po(db, po_id)
    line = get_line(po, line_id)
    jobs = find_duplicates(po, line)
    db.commit()
    return DuplicateCheckOut(po_number=po.po_number or "", po_line=str(line.line_number or ""), job_numbers=jobs)


@router.post("/po/{po_id}/lines/{line_id}/resolve-customer", response_model=PoDetail)
def line_resolve_customer(
    po_id: UUID,
    line_id: UUID,
    payload: ResolveCustomerIn,
    db: Session = Depends(get_db),
) -> PoDetail:
    po = get_po(db, po_id)
    line = get_line(po, line_id)
    resolve_customer(db, po, line, payload.customer_number, payload.apply_to_all_lines)
    db.commit()
    db.refresh(po)
    return to_detail(po)


@router.post("/po/{po_id}/lines/{line_id}/resolve-part", response_model=PoDetail)
def line_resolve_part(
    po_id: UUID,
    line_id: UUID,
    payload: ResolvePartIn,
    db: Session = Depends(get_db),
) -> PoDetail:
    po = get_po(db, po_id)
    line = get_line(po, line_id)
    resolve_part(db, po, line, payload.part_number, payload.part_revision)
    db.commit()
    db.refresh(po)
    return to_detail(po)


@router.post("/po/{po_id}/lines/{line_id}/acknowledge-credit-hold", response_model=PoDetail)
def line_ack_credit_hold(
    po_id: UUID,
    line_id: UUID,
    payload: AcknowledgeIn,
    db: Session = Depends(get_db),
) -> PoDetail:
    po = get_po(db, po_id)
    line = get_line(po, line_id)
    acknowledge_credit_hold(line, po, payload.acknowledge)
    db.commit()
    db.refresh(po)
    return to_detail(po)


@router.post("/po/{po_id}/lines/{line_id}/acknowledge-duplicate", response_model=PoDetail)
def line_ack_duplicate(
    po_id: UUID,
    line_id: UUID,
    payload: AcknowledgeIn,
    db: Session = Depends(get_db),
) -> PoDetail:
    po = get_po(db, po_id)
    line = get_line(po, line_id)
    acknowledge_duplicate(line, po, payload.acknowledge)
    db.commit()
    db.refresh(po)
    return to_detail(po)


@router.post("/po/{po_id}/lines/{line_id}/skip", response_model=PoDetail)
def line_skip(
    po_id: UUID,
    line_id: UUID,
    payload: SkipLineIn,
    db: Session = Depends(get_db),
) -> PoDetail:
    po = get_po(db, po_id)
    line = get_line(po, line_id)
    skip_line(db, po, line, payload.reason)
    db.commit()
    db.refresh(po)
    return to_detail(po)


@router.post("/po/{po_id}/lines/{line_id}/unskip", response_model=PoDetail)
def line_unskip(po_id: UUID, line_id: UUID, db: Session = Depends(get_db)) -> PoDetail:
    po = get_po(db, po_id)
    line = get_line(po, line_id)
    unskip_line(db, po, line)
    db.commit()
    db.refresh(po)
    return to_detail(po)


@router.post("/po/{po_id}/lines/{line_id}/create-job", response_model=PoDetail)
def line_create_job(po_id: UUID, line_id: UUID, db: Session = Depends(get_db)) -> PoDetail:
    from app.exceptions import AppError

    po = get_po(db, po_id)
    line = get_line(po, line_id)
    try:
        create_job_for_line(db, po, line)
    except AppError:
        db.commit()
        raise
    db.commit()
    db.refresh(po)
    return to_detail(po)


@router.post("/po/{po_id}/lines/{line_id}/reset-erp", response_model=PoDetail)
def line_reset_erp(
    po_id: UUID,
    line_id: UUID,
    payload: ResetErpIn,
    db: Session = Depends(get_db),
) -> PoDetail:
    po = get_po(db, po_id)
    line = get_line(po, line_id)
    reset_erp(db, po, line, payload.reason)
    db.commit()
    db.refresh(po)
    return to_detail(po)
