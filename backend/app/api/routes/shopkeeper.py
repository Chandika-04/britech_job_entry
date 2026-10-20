from fastapi import APIRouter, Body, Depends, Query
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.schemas.po import PoDetail
from app.schemas.shopkeeper import (
    AcknowledgeIn,
    CreateShipperIn,
    CustomerLookupResponse,
    CustomerSuggestionResponse,
    DuplicateCheckOut,
    PartLookupResponse,
    PriceLookupResponse,
    PriceQuoteOut,
    ResetErpIn,
    ResolveCustomerIn,
    ResolvePartIn,
    SetCertRequiredIn,
    ShopKeeperJobOut,
    ShopKeeperPoListResponse,
    ShopKeeperShipperListResponse,
    ShopKeeperShipperOut,
    ShopKeeperShipperPageOut,
    SkipLineIn,
)
from app.exceptions import NotFoundError
from app.services.shopkeeper.lookup import normalize_search_by, normalize_shipper_search_by
from app.services.po_service import get_po, to_detail
from app.services.shopkeeper import get_shopkeeper_provider
from app.services.shopkeeper.writer import (
    acknowledge_credit_hold,
    acknowledge_duplicate,
    create_shipper_for_po,
    delete_shopkeeper_job_for_line,
    find_duplicates,
    get_line,
    lookup_customers,
    lookup_parts,
    lookup_prices,
    reset_erp,
    resolve_customer,
    resolve_part,
    set_cert_required,
    skip_line,
    suggest_customer,
    unskip_line,
)

router = APIRouter(tags=["shopkeeper"])


@router.get("/shopkeeper/status")
def shopkeeper_status() -> dict:
    provider = get_shopkeeper_provider()
    return {"database": provider.current_database()}


@router.get("/shopkeeper/purchase-orders", response_model=ShopKeeperPoListResponse)
def shopkeeper_purchase_orders(
    q: str | None = Query(None),
    search_by: str = Query("po"),
    page: int = Query(1, ge=1),
    page_size: int = Query(300, ge=1, le=300),  # job list page size
) -> ShopKeeperPoListResponse:
    field = normalize_search_by(search_by)
    provider = get_shopkeeper_provider()
    jobs, total = provider.list_purchase_orders(query=q, search_by=field, page=page, page_size=page_size)
    return ShopKeeperPoListResponse(
        items=[ShopKeeperJobOut.model_validate(job, from_attributes=True) for job in jobs],
        total=total,
        page=page,
        page_size=page_size,
        query=q,
        search_by=field,
    )


@router.get("/shopkeeper/shippers", response_model=ShopKeeperShipperListResponse)
def shopkeeper_shippers(
    q: str | None = Query(None),
    search_by: str = Query("shipper"),
    page: int = Query(1, ge=1),
    page_size: int = Query(300, ge=1, le=300),
) -> ShopKeeperShipperListResponse:
    field = normalize_shipper_search_by(search_by)
    provider = get_shopkeeper_provider()
    rows, total = provider.list_shippers(query=q, search_by=field, page=page, page_size=page_size)
    return ShopKeeperShipperListResponse(
        items=[ShopKeeperShipperOut.model_validate(row, from_attributes=True) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
        query=q,
        search_by=field,
    )


@router.get("/shopkeeper/shippers/{ship_number}", response_model=ShopKeeperShipperPageOut)
def shopkeeper_shipper(ship_number: str) -> ShopKeeperShipperPageOut:
    shipper = get_shopkeeper_provider().get_shipper(ship_number)
    if shipper is None:
        raise NotFoundError("Shipper not found.")
    return ShopKeeperShipperPageOut.model_validate(shipper, from_attributes=True)


@router.get("/shopkeeper/customers", response_model=CustomerLookupResponse)
def shopkeeper_customers(q: str = Query(..., min_length=1)) -> CustomerLookupResponse:
    return CustomerLookupResponse.model_validate(lookup_customers(q))


@router.get("/shopkeeper/parts", response_model=PartLookupResponse)
def shopkeeper_parts(
    part_number: str = Query(..., min_length=1),
    part_revision: str | None = Query(None),
) -> PartLookupResponse:
    return PartLookupResponse.model_validate(lookup_parts(part_number, part_revision or None))


@router.get("/shopkeeper/prices", response_model=PriceLookupResponse)
def shopkeeper_prices(
    customer_number: str = Query(..., min_length=1),
    part_number: str = Query(..., min_length=1),
    part_revision: str = Query("", max_length=5),
    quantity: int | None = Query(None, ge=1),
) -> PriceLookupResponse:
    quotes = lookup_prices(customer_number, part_number, part_revision, quantity)
    return PriceLookupResponse(
        customer_number=customer_number,
        part_number=part_number,
        part_revision=part_revision,
        quantity=quantity,
        quotes=[PriceQuoteOut.model_validate(quote, from_attributes=True) for quote in quotes],
    )


@router.get("/po/{po_id}/customer-suggestion", response_model=CustomerSuggestionResponse)
def po_customer_suggestion(po_id: int, db: Session = Depends(get_db)) -> CustomerSuggestionResponse:
    po = get_po(db, po_id)
    return CustomerSuggestionResponse.model_validate(suggest_customer(db, po))


@router.get("/po/{po_id}/lines/{line_id}/duplicates", response_model=DuplicateCheckOut)
def line_duplicates(po_id: int, line_id: int, db: Session = Depends(get_db)) -> DuplicateCheckOut:
    po = get_po(db, po_id)
    line = get_line(po, line_id)
    jobs = find_duplicates(po, line)
    db.commit()
    return DuplicateCheckOut(po_number=po.po_number or "", po_line=str(line.line_number or ""), job_numbers=jobs)


@router.post("/po/{po_id}/lines/{line_id}/resolve-customer", response_model=PoDetail)
def line_resolve_customer(
    po_id: int,
    line_id: int,
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
    po_id: int,
    line_id: int,
    payload: ResolvePartIn,
    db: Session = Depends(get_db),
) -> PoDetail:
    po = get_po(db, po_id)
    line = get_line(po, line_id)
    resolve_part(db, po, line, payload.part_number, payload.part_revision)
    db.commit()
    db.refresh(po)
    return to_detail(po)


@router.post("/po/{po_id}/lines/{line_id}/cert-required", response_model=PoDetail)
def line_set_cert_required(
    po_id: int,
    line_id: int,
    payload: SetCertRequiredIn,
    db: Session = Depends(get_db),
) -> PoDetail:
    po = get_po(db, po_id)
    line = get_line(po, line_id)
    set_cert_required(po, line, payload.cert_required, payload.apply_to_all_lines)
    db.commit()
    db.refresh(po)
    return to_detail(po)


@router.post("/po/{po_id}/lines/{line_id}/acknowledge-credit-hold", response_model=PoDetail)
def line_ack_credit_hold(
    po_id: int,
    line_id: int,
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
    po_id: int,
    line_id: int,
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
    po_id: int,
    line_id: int,
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
def line_unskip(po_id: int, line_id: int, db: Session = Depends(get_db)) -> PoDetail:
    po = get_po(db, po_id)
    line = get_line(po, line_id)
    unskip_line(db, po, line)
    db.commit()
    db.refresh(po)
    return to_detail(po)


@router.post("/po/{po_id}/create-shipper", response_model=PoDetail)
def po_create_shipper(
    po_id: int,
    payload: CreateShipperIn = Body(default_factory=CreateShipperIn),
    db: Session = Depends(get_db),
) -> PoDetail:
    from app.exceptions import AppError

    po = get_po(db, po_id)
    try:
        create_shipper_for_po(db, po, prepared_by=payload.prepared_by)
    except AppError:
        db.commit()
        raise
    db.commit()
    db.refresh(po)
    return to_detail(po)


@router.post("/po/{po_id}/lines/{line_id}/reset-erp", response_model=PoDetail)
def line_reset_erp(
    po_id: int,
    line_id: int,
    payload: ResetErpIn,
    db: Session = Depends(get_db),
) -> PoDetail:
    po = get_po(db, po_id)
    line = get_line(po, line_id)
    reset_erp(db, po, line, payload.reason)
    db.commit()
    db.refresh(po)
    return to_detail(po)


@router.post("/po/{po_id}/lines/{line_id}/delete-shopkeeper-job", response_model=PoDetail)
def line_delete_shopkeeper_job(po_id: int, line_id: int, db: Session = Depends(get_db)) -> PoDetail:
    from app.exceptions import AppError

    po = get_po(db, po_id)
    line = get_line(po, line_id)
    try:
        delete_shopkeeper_job_for_line(db, po, line)
    except AppError:
        db.commit()
        raise
    db.commit()
    db.refresh(po)
    return to_detail(po)
