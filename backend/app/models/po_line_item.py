from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base

if TYPE_CHECKING:
    from app.models.po_request import PoRequest


class PoLineItem(Base):
    __tablename__ = "po_line_item"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    po_request_id: Mapped[int] = mapped_column(
        Integer,
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

    resolved_customer_code: Mapped[str | None] = mapped_column(String(15), nullable=True)
    resolved_part_number: Mapped[str | None] = mapped_column(String(30), nullable=True)
    resolved_part_revision: Mapped[str | None] = mapped_column(String(5), nullable=True)
    resolved_pm_linkid: Mapped[int | None] = mapped_column(Integer, nullable=True)

    customer_credit_hold: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    credit_hold_acknowledged: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    duplicate_job_numbers: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    duplicate_acknowledged: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    erp_status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    erp_job_number: Mapped[str | None] = mapped_column(String(21), nullable=True)
    erp_created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    erp_failure_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    erp_database: Mapped[str | None] = mapped_column(String(128), nullable=True)

    po_request: Mapped["PoRequest"] = relationship(back_populates="line_items")
