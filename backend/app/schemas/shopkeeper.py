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


class ResolveCustomerIn(BaseModel):
    customer_number: str
    apply_to_all_lines: bool = True


class ResolvePartIn(BaseModel):
    part_number: str
    part_revision: str


class AcknowledgeIn(BaseModel):
    acknowledge: bool = True


class SkipLineIn(BaseModel):
    reason: str = "Reviewer skipped ShopKeeper job creation."


class ResetErpIn(BaseModel):
    reason: str = "Admin reset after ShopKeeper job was deleted."


class DuplicateCheckOut(BaseModel):
    po_number: str
    po_line: str
    job_numbers: list[str] = Field(default_factory=list)
