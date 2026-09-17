import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, LargeBinary, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database.base import Base

if TYPE_CHECKING:
    from app.models.po_request import PoRequest


class PoAttachment(Base):
    __tablename__ = "po_attachment"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    po_request_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("po_request.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )

    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(128), nullable=False, default="application/pdf")
    pdf_bytes: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    page_count: Mapped[int] = mapped_column(Integer, nullable=False)

    po_request: Mapped["PoRequest"] = relationship(back_populates="attachment")
