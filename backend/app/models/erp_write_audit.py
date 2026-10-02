from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import JSON

from app.database.base import Base


class ErpWriteAudit(Base):
    __tablename__ = "erp_write_audit"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    po_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("po_request.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    line_item_id: Mapped[int | None] = mapped_column(
        Integer,
        # No ON DELETE rule: SQL Server rejects a second cascade path through po_line_item.
        ForeignKey("po_line_item.id"),
        nullable=True,
        index=True,
    )
    job_number: Mapped[str | None] = mapped_column(String(21), nullable=True)
    action: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    database_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    app_version: Mapped[str | None] = mapped_column(String(32), nullable=True)
    request_json: Mapped[dict | list | None] = mapped_column(JSON, nullable=True)
    result_json: Mapped[dict | list | None] = mapped_column(JSON, nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
