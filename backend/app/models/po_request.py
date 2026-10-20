import enum
from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, Date, DateTime, Enum, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base

if TYPE_CHECKING:
    from app.models.llm_call import LlmCall
    from app.models.po_attachment import PoAttachment
    from app.models.po_line_item import PoLineItem


class PoStatus(str, enum.Enum):
    pending = "pending"
    extracted = "extracted"
    failed = "failed"


class ReviewState(str, enum.Enum):
    unreviewed = "unreviewed"
    confirmed = "confirmed"


class PoSource(str, enum.Enum):
    upload = "upload"
    manual = "manual"


class PoRequest(Base):
    __tablename__ = "po_request"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    status: Mapped[PoStatus] = mapped_column(
        Enum(PoStatus, name="po_status", native_enum=False, length=32),
        default=PoStatus.pending,
        nullable=False,
        index=True,
    )
    review_state: Mapped[ReviewState] = mapped_column(
        Enum(ReviewState, name="review_state", native_enum=False, length=32),
        default=ReviewState.unreviewed,
        nullable=False,
        index=True,
    )
    source: Mapped[PoSource] = mapped_column(
        Enum(PoSource, name="po_source", native_enum=False, length=32),
        default=PoSource.upload,
        nullable=False,
        index=True,
    )
    heartbeat_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )

    po_number: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    customer_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    customer_number: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    order_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    requested_ship_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    buyer_contact: Mapped[str | None] = mapped_column(String(255), nullable=True)
    buyer_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    bill_to: Mapped[str | None] = mapped_column(Text, nullable=True)
    ship_to: Mapped[str | None] = mapped_column(Text, nullable=True)

    extraction_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    warnings: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    shipper_number: Mapped[str | None] = mapped_column(String(20), nullable=True)

    line_items: Mapped[list["PoLineItem"]] = relationship(
        back_populates="po_request",
        cascade="all, delete-orphan",
        order_by="PoLineItem.line_number",
    )
    attachment: Mapped["PoAttachment | None"] = relationship(
        back_populates="po_request",
        cascade="all, delete-orphan",
        uselist=False,
    )
    llm_calls: Mapped[list["LlmCall"]] = relationship(
        back_populates="po_request",
        cascade="all, delete-orphan",
        order_by="LlmCall.created_at",
    )
