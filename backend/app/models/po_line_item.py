import uuid
from datetime import date
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Date, ForeignKey, Integer, Numeric, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base

if TYPE_CHECKING:
    from app.models.po_request import PoRequest


class PoLineItem(Base):
    __tablename__ = "po_line_item"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    po_request_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("po_request.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    line_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    customer_part_number: Mapped[str | None] = mapped_column(String(128), nullable=True)
    revision: Mapped[str | None] = mapped_column(String(64), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    quantity: Mapped[Decimal | None] = mapped_column(Numeric(18, 4), nullable=True)
    unit_price: Mapped[Decimal | None] = mapped_column(Numeric(18, 4), nullable=True)
    uom: Mapped[str | None] = mapped_column(String(32), nullable=True)

    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    reviewer_edited: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    po_request: Mapped["PoRequest"] = relationship(back_populates="line_items")
