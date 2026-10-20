from datetime import date
from decimal import Decimal

from pydantic import BaseModel, Field


class CustomerCandidate(BaseModel):
    customer_number: str
    company: str | None = None
    record_type: str | None = None
    bill_to_customer_number: str | None = None
    active: bool = True
    credit_hold: bool = False
    payment_terms: str | None = None
    shipped_via: str | None = None
    salesman: str | None = None
    cert_default: bool = False
    taxable_default: bool = False
    tax_code: str | None = None
    street: str | None = None
    suite: str | None = None
    city: str | None = None
    state: str | None = None
    postal_code: str | None = None
    country: str | None = None
    address_block: str | None = None


class PartCandidate(BaseModel):
    part_number: str
    part_revision: str
    description: str | None = None
    master_type: str | None = None
    pm_linkid: int
    inactive: bool = False


class CustomerLookupResponse(BaseModel):
    query: str
    matches: list[CustomerCandidate]
    exact_one: bool


class CustomerSuggestionResponse(BaseModel):
    extracted_name: str | None = None
    normalized_name: str = ""
    status: str
    customer: CustomerCandidate | None = None
    candidates: list[CustomerCandidate] = Field(default_factory=list)
    warning: str | None = None


class PartLookupResponse(BaseModel):
    part_number: str
    part_revision: str | None = None
    matches: list[PartCandidate]
    exact_one: bool


class PriceQuoteOut(BaseModel):
    source: str
    unit_price: Decimal
    quantity: int | None = None
    job_number: str | None = None
    po_number: str | None = None
    order_date: date | None = None
    note: str | None = None


class PriceLookupResponse(BaseModel):
    customer_number: str
    part_number: str
    part_revision: str
    quantity: int | None = None
    quotes: list[PriceQuoteOut]


class ResolveCustomerIn(BaseModel):
    customer_number: str
    apply_to_all_lines: bool = True


class ResolvePartIn(BaseModel):
    part_number: str
    part_revision: str


class SetCertRequiredIn(BaseModel):
    cert_required: bool
    apply_to_all_lines: bool = False


class AcknowledgeIn(BaseModel):
    acknowledge: bool = True


class SkipLineIn(BaseModel):
    reason: str = "Reviewer skipped ShopKeeper job creation."


class ResetErpIn(BaseModel):
    reason: str = "Admin reset after ShopKeeper job was deleted."


class CreateShipperIn(BaseModel):
    prepared_by: str | None = None


class DuplicateCheckOut(BaseModel):
    po_number: str
    po_line: str
    job_numbers: list[str] = Field(default_factory=list)


class ShopKeeperJobOut(BaseModel):
    job_number: str
    po_number: str
    po_line: str | None = None
    customer_code: str
    customer_name: str | None = None
    part_number: str
    part_revision: str
    description: str | None = None
    quantity: int | None = None
    status: str
    order_date: date | None = None
    cert_required: bool
    shipper_number: str | None = None


class ShopKeeperPoListResponse(BaseModel):
    items: list[ShopKeeperJobOut]
    total: int
    page: int
    page_size: int
    query: str | None = None
    search_by: str = "po"


class ShopKeeperShipperOut(BaseModel):
    shipper_number: str
    status: str | None = None
    ship_via: str | None = None
    ship_by: str | None = None
    ship_date: date | None = None
    printed: bool = False
    invoiced: bool = False
    job_count: int = 0
    customer_name: str | None = None
    po_numbers: str | None = None


class ShopKeeperShipperListResponse(BaseModel):
    items: list[ShopKeeperShipperOut]
    total: int
    page: int
    page_size: int
    query: str | None = None
    search_by: str = "shipper"


class ShopKeeperShipperPageOut(ShopKeeperShipperOut):
    tracking_number: str | None = None
    note: str | None = None
    jobs: list[ShopKeeperJobOut] = Field(default_factory=list)
