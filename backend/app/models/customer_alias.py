from datetime import datetime

from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base


class CustomerAlias(Base):
    __tablename__ = "customer_alias"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    normalized_name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    source_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    customer_number: Mapped[str] = mapped_column(String(15), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
