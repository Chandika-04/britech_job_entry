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


@dataclass
class PartRecord:
    part_number: str
    part_revision: str
    description: str | None
    master_type: str
    pm_linkid: int
    inactive: bool


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
