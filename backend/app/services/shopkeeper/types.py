from dataclasses import dataclass
from datetime import date
from decimal import Decimal


@dataclass
class CustomerRecord:
    customer_number: str
    company: str | None
    record_type: str | None
    bill_to_customer_number: str | None
    active: bool
    credit_hold: bool
    payment_terms: str | None
    shipped_via: str | None
    salesman: str | None
    cert_default: bool
    taxable_default: bool
    tax_code: str | None
    street: str | None = None
    suite: str | None = None
    city: str | None = None
    state: str | None = None
    postal_code: str | None = None
    country: str | None = None

    def address_block(self) -> str:
        lines: list[str] = []
        company = (self.company or "").strip()
        if company:
            lines.append(company)
        street = (self.street or "").strip()
        if street:
            lines.append(street)
        suite = (self.suite or "").strip()
        if suite:
            lines.append(suite)
        city = (self.city or "").strip()
        state = (self.state or "").strip()
        postal = (self.postal_code or "").strip()
        locality = " ".join(part for part in (state, postal) if part)
        if city and locality:
            lines.append(f"{city}, {locality}")
        elif city or locality:
            lines.append(city or locality)
        country = (self.country or "").strip()
        if country and country.upper() not in {"US", "USA", "UNITED STATES"}:
            lines.append(country)
        return "\n".join(lines)


@dataclass
class PartRecord:
    part_number: str
    part_revision: str
    description: str | None
    master_type: str
    pm_linkid: int
    inactive: bool
    customer_code: str | None = None


@dataclass
class PartMasterListRow:
    pm_linkid: int
    part_number: str
    part_revision: str
    customer_code: str | None
    description: str | None
    inactive: bool
    quality_hold: bool
    operation_count: int
    picture_count: int
    cert_linked: bool


@dataclass
class PartHeaderUpdate:
    part_number: str
    part_revision: str
    customer_code: str
    description: str | None


@dataclass
class JobWritePayload:
    po_number: str
    po_line: str
    customer_code: str
    part_number: str
    part_revision: str
    part_description: str | None
    quantity: int
    unit_price: Decimal
    unit: str
    due_date: date
    cert_required: bool
    taxable: bool
    tax_code: str
    status: str
    salesperson: str | None
    terms: str | None
    ship_via: str | None
    master_type: str
    pm_linkid: int


@dataclass
class ShipLine:
    job_number: str
    quantity: int


@dataclass
class ShipWritePayload:
    ship_via: str | None
    ship_by: str | None
    ship_date: date
    lines: list[ShipLine]


@dataclass
class PriceQuote:
    source: str
    unit_price: Decimal
    quantity: int | None = None
    job_number: str | None = None
    po_number: str | None = None
    order_date: date | None = None
    note: str | None = None


@dataclass
class ShopKeeperJobRow:
    job_number: str
    po_number: str
    po_line: str | None
    customer_code: str
    customer_name: str | None
    part_number: str
    part_revision: str
    description: str | None
    quantity: int | None
    status: str
    order_date: date | None
    cert_required: bool
    shipper_number: str | None


@dataclass
class ShopKeeperShipperRow:
    shipper_number: str
    status: str | None
    ship_via: str | None
    ship_by: str | None
    ship_date: date | None
    printed: bool
    invoiced: bool
    job_count: int
    customer_name: str | None
    po_numbers: str | None


@dataclass
class ShopKeeperShipperPage:
    shipper_number: str
    status: str | None
    ship_via: str | None
    ship_by: str | None
    ship_date: date | None
    printed: bool
    invoiced: bool
    job_count: int
    customer_name: str | None
    po_numbers: str | None
    tracking_number: str | None
    note: str | None
    jobs: list[ShopKeeperJobRow]


@dataclass
class WorkCenter:
    code: str
    description: str | None
    inactive: bool = False


@dataclass
class OperationRow:
    id: int | None
    seq_num: float
    wc_code: str
    description: str | None = None
    note: str | None = None
    run_time: float | None = 0
    setup_time: float | None = 0
    subcontract: bool = False
    process_code: str | None = None
    process: int | None = None
    fa: bool = False
    qty: float | None = 0
    sched_days: int | None = 0
    om_link: int | None = None
    rowversion: str | None = None


@dataclass
class OpTemplate:
    id: int
    code: str
    description: str | None
    sort: int = 0
    step_count: int = 0


@dataclass
class CertText:
    id: str
    description: str | None = None
    text: str | None = None


@dataclass
class PartPicture:
    id: int
    path: str
    description: str | None = None
    print_on_trav: bool = True
    sort_order: int | None = None


@dataclass
class PartEditorRecord:
    pm_linkid: int
    part_number: str
    part_revision: str
    description: str | None
    customer_code: str | None
    locked: bool
    quality_hold: bool
    quality_hold_note: str | None
    fa_hold: bool
    ship_hold: bool
    operations: list[OperationRow]
    pictures: list[PartPicture]
    linked_certs: list[CertText]


@dataclass
class JobPageRecord:
    job_number: str
    customer_code: str
    customer_name: str | None
    po_number: str
    po_line: str | None
    part_number: str
    part_revision: str
    pm_linkid: int | None
    description: str | None
    quantity: int | None
    unit: str | None
    unit_price: Decimal | None
    due_date: date | None
    cert_required: bool
    cert_linked: bool
    quality_hold: bool
    status: str | None
    shipper_number: str | None
    traveler_printed: bool
    operations: list[OperationRow]
    order_date: date | None = None
    notes: str | None = None
    pictures: list[PartPicture] | None = None


@dataclass
class JobHeaderUpdate:
    customer_code: str
    po_number: str
    po_line: str | None
    part_number: str
    part_revision: str
    description: str | None
    quantity: int
    unit: str
    unit_price: Decimal
    order_date: date
    notes: str | None
    cert_required: bool


@dataclass
class PrintDocumentData:
    job: JobPageRecord
    pictures: list[PartPicture]
    certs: list[CertText]
    customer: CustomerRecord | None = None
    ship_to: CustomerRecord | None = None


@dataclass
class CreatePrintResult:
    job_number: str
    printed: bool
    missing_ops: bool
    missing_cert: bool
    print_error: str | None = None
    pm_linkid: int | None = None
