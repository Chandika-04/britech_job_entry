from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class ExtractedLineItem(BaseModel):
    line_number: int | None = None
    customer_part_number: str | None = None
    revision: str | None = None
    description: str | None = None
    quantity: Decimal | None = None
    unit_price: Decimal | None = None
    uom: str | None = None
    due_date: date | None = None
    notes: str | None = None


class ExtractionResult(BaseModel):
    po_number: str | None = None
    customer_name: str | None = None
    order_date: date | None = None
    requested_ship_date: date | None = None
    buyer_contact: str | None = None
    buyer_notes: str | None = None
    bill_to: str | None = None
    ship_to: str | None = None
    line_items: list[ExtractedLineItem] = Field(default_factory=list)
    possible_po_numbers: list[str] = Field(default_factory=list)
    document_quality: Literal["good", "poor", "unreadable"] | None = None
    unreadable_pages: list[int] = Field(default_factory=list)
    conflicting_fields: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class WarningItem(BaseModel):
    code: str
    message: str
    severity: Literal["info", "warning", "prominent"] = "warning"


class ProviderResult(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    extraction: ExtractionResult
    raw_json: dict
    model: str
    input_tokens: int | None = None
    output_tokens: int | None = None
    cost_usd: Decimal | None = None
