from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base

if TYPE_CHECKING:
    from app.models.po_request import PoRequest


class LlmCall(Base):
    __tablename__ = "llm_call"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    po_request_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("po_request.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    model: Mapped[str] = mapped_column(String(128), nullable=False)
    call_type: Mapped[str] = mapped_column(String(32), nullable=False, default="extract")

    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cost_usd: Mapped[Decimal | None] = mapped_column(Numeric(12, 6), nullable=True)

    raw_extraction_json: Mapped[dict | list | None] = mapped_column(JSON, nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    po_request: Mapped["PoRequest"] = relationship(back_populates="llm_calls")
