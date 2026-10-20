from datetime import date
from decimal import Decimal

from pydantic import BaseModel, Field

from app.schemas.po import PoDetail


class OperationIn(BaseModel):
    id: int | None = None
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


class OperationOut(OperationIn):
    id: int | None = None


class WorkCenterOut(BaseModel):
    code: str
    description: str | None = None
    inactive: bool = False


class OpTemplateOut(BaseModel):
    id: int
    code: str
    description: str | None = None
    sort: int = 0
    step_count: int = 0


class CertTextOut(BaseModel):
    id: str
    description: str | None = None
    text: str | None = None


class PartPictureOut(BaseModel):
    id: int
    path: str
    description: str | None = None
    print_on_trav: bool = True
    sort_order: int | None = None


class CreatePrintOut(BaseModel):
    po: PoDetail
    job_number: str
    printed: bool
    missing_ops: bool
    missing_cert: bool
    print_error: str | None = None
    pm_linkid: int | None = None


class JobHeaderIn(BaseModel):
    customer_code: str = Field(min_length=1, max_length=15)
    po_number: str = Field(min_length=1, max_length=20)
    po_line: str | None = Field(default=None, max_length=10)
    part_number: str = Field(min_length=1, max_length=30)
    part_revision: str = Field(min_length=1, max_length=5)
    description: str | None = Field(default=None, max_length=75)
    quantity: int = Field(ge=1)
    unit: str = Field(default="Each", max_length=4)
    unit_price: Decimal
    order_date: date
    notes: str | None = None
    cert_required: bool = False


class JobPageOut(BaseModel):
    job_number: str
    customer_code: str
    customer_name: str | None = None
    po_number: str
    po_line: str | None = None
    part_number: str
    part_revision: str
    pm_linkid: int | None = None
    description: str | None = None
    quantity: int | None = None
    unit: str | None = None
    unit_price: Decimal | None = None
    due_date: date | None = None
    order_date: date | None = None
    notes: str | None = None
    cert_required: bool
    cert_linked: bool
    quality_hold: bool = False
    status: str | None = None
    shipper_number: str | None = None
    traveler_printed: bool = False
    operations: list[OperationOut] = Field(default_factory=list)
    print_ready: bool = False
    missing_ops: bool = False
    missing_cert: bool = False
    po_id: int | None = None
    line_id: int | None = None
    work_centers: list[WorkCenterOut] = Field(default_factory=list)
    templates: list[OpTemplateOut] = Field(default_factory=list)
    pictures: list[PartPictureOut] = Field(default_factory=list)


class PartEditorOut(BaseModel):
    pm_linkid: int
    part_number: str
    part_revision: str
    description: str | None = None
    customer_code: str | None = None
    locked: bool = False
    quality_hold: bool = False
    quality_hold_note: str | None = None
    fa_hold: bool = False
    ship_hold: bool = False
    operations: list[OperationOut] = Field(default_factory=list)
    pictures: list[PartPictureOut] = Field(default_factory=list)
    linked_certs: list[CertTextOut] = Field(default_factory=list)
    cert_library: list[CertTextOut] = Field(default_factory=list)
    work_centers: list[WorkCenterOut] = Field(default_factory=list)


class PartHeaderIn(BaseModel):
    part_number: str = Field(min_length=1, max_length=30)
    part_revision: str | None = Field(default=None, max_length=5)
    customer_code: str = Field(min_length=1, max_length=15)
    description: str | None = Field(default=None, max_length=75)


class PartListRowOut(BaseModel):
    pm_linkid: int
    part_number: str
    part_revision: str
    customer_code: str | None = None
    description: str | None = None
    inactive: bool = False
    quality_hold: bool = False
    operation_count: int = 0
    picture_count: int = 0
    cert_linked: bool = False


class PartListResponse(BaseModel):
    items: list[PartListRowOut]
    total: int
    page: int
    page_size: int
    query: str | None = None
    search_by: str = "part"


class OperationsSaveIn(BaseModel):
    operations: list[OperationIn] = Field(default_factory=list)


class CopyTemplateIn(BaseModel):
    template_id: int


class QualityHoldIn(BaseModel):
    hold: bool
    note: str | None = None


class LinkCertIn(BaseModel):
    ctxt_id: str


class PrintJobOut(BaseModel):
    job_number: str
    printed: bool
    missing_ops: bool
    missing_cert: bool
    print_error: str | None = None
