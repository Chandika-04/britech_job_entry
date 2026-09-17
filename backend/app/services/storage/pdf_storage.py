"""PDF storage interface.

PDFs are stored in PostgreSQL as bytea for Phase 1. This interface exists so
object storage can be introduced later without changing callers.
"""

from __future__ import annotations

import uuid

from sqlalchemy.orm import Session

from app.models.po_attachment import PoAttachment


class PdfStorage:
    def save(
        self,
        db: Session,
        *,
        po_request_id: uuid.UUID,
        filename: str,
        content_type: str,
        pdf_bytes: bytes,
        page_count: int,
    ) -> PoAttachment:
        attachment = PoAttachment(
            po_request_id=po_request_id,
            filename=filename,
            content_type=content_type or "application/pdf",
            pdf_bytes=pdf_bytes,
            page_count=page_count,
        )
        db.add(attachment)
        db.flush()
        return attachment

    def get_by_po(self, db: Session, po_request_id: uuid.UUID) -> PoAttachment | None:
        return (
            db.query(PoAttachment)
            .filter(PoAttachment.po_request_id == po_request_id)
            .one_or_none()
        )


pdf_storage = PdfStorage()
