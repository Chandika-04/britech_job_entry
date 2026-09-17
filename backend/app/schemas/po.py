import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models.po_request import PoStatus, ReviewState
from app.schemas.extraction import WarningItem


class LineItemIn(BaseModel):
    id: uuid.UUID | None = None
    line_number: int | None = None
    customer_part_number: str | None = None
    revision: str | None = None
    description: str | None = None
    quantity: Decimal | None = None
    unit_price: Decimal | None = None
    uom: str | None = None
    due_date: date | None = None
    notes: str | None = None


class LineItemOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    line_number: int | None = None
    customer_part_number: str | None = None
    revision: str | None = None
    description: str | None = None
    quantity: Decimal | None = None
    unit_price: Decimal | None = None
    uom: str | None = None
    due_date: date | None = None
    notes: str | None = None
    reviewer_edited: bool = False


class PoUpdate(BaseModel):
    po_number: str | None = None
    customer_name: str | None = None
    customer_number: str | None = None
    order_date: date | None = None
    requested_ship_date: date | None = None
    buyer_contact: str | None = None
    buyer_notes: str | None = None
    bill_to: str | None = None
    ship_to: str | None = None
    line_items: list[LineItemIn] = Field(default_factory=list)


class ReviewAction(BaseModel):
    action: str = Field(description="save_draft or confirm")
    po: PoUpdate | None = None


class LlmCallOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    model: str
    call_type: str
    input_tokens: int | None = None
    output_tokens: int | None = None
    cost_usd: Decimal | None = None
    created_at: datetime


class PoSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    status: PoStatus
    review_state: ReviewState
    po_number: str | None = None
    customer_name: str | None = None
    customer_number: str | None = None
    warnings: list[WarningItem] = Field(default_factory=list)
    is_stale: bool = False
    has_duplicate_warning: bool = False
    page_count: int | None = None


class PoDetail(PoSummary):
    heartbeat_at: datetime | None = None
    order_date: date | None = None
    requested_ship_date: date | None = None
    buyer_contact: str | None = None
    buyer_notes: str | None = None
    bill_to: str | None = None
    ship_to: str | None = None
    extraction_error: str | None = None
    line_items: list[LineItemOut] = Field(default_factory=list)
    llm_calls: list[LlmCallOut] = Field(default_factory=list)
    attachment_filename: str | None = None


class PoListResponse(BaseModel):
    items: list[PoSummary]
    total: int
    page: int
    page_size: int


class UploadResponse(BaseModel):
    id: uuid.UUID
    status: PoStatus
    message: str


class MessageResponse(BaseModel):
    message: str
    id: uuid.UUID | None = None
