"""PDF file storage.

PDFs live as files under PDF_STORAGE_DIR (on the host PC). Each file is also copied to
PDF_BACKUP_DIR (e.g. a DiskStation share) when one is configured. The database keeps
only the relative path, size, and checksum.
"""

from __future__ import annotations

import hashlib
import logging
import os
import uuid
from datetime import datetime
from pathlib import Path

from sqlalchemy.orm import Session

from app.config import get_settings
from app.exceptions import PdfStorageError
from app.models.po_attachment import PoAttachment

logger = logging.getLogger(__name__)


def _resolve(root: Path, relative: str) -> Path:
    return root.joinpath(*relative.split("/"))


def _write_atomic(target: Path, data: bytes) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    temp = target.with_name(f"{target.name}.{uuid.uuid4().hex}.tmp")
    try:
        with open(temp, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, target)
    finally:
        temp.unlink(missing_ok=True)


def _remove(path: Path) -> None:
    try:
        path.unlink(missing_ok=True)
    except OSError:
        logger.warning("Could not delete PDF file %s", path, exc_info=True)


class PdfStorage:
    @property
    def primary_root(self) -> Path:
        return get_settings().pdf_storage_path

    @property
    def backup_root(self) -> Path | None:
        return get_settings().pdf_backup_path

    def check_ready(self) -> None:
        """Fail fast at startup if the primary folder is unusable; only warn for the backup."""
        root = self.primary_root
        probe = root / f".write-test-{uuid.uuid4().hex}"
        try:
            root.mkdir(parents=True, exist_ok=True)
            probe.write_bytes(b"ok")
        except OSError as exc:
            raise RuntimeError(f"PDF storage folder is not writable: {root}") from exc
        finally:
            probe.unlink(missing_ok=True)
        backup = self.backup_root
        if backup is not None:
            try:
                backup.mkdir(parents=True, exist_ok=True)
            except OSError:
                logger.warning("PDF backup folder is unreachable right now: %s", backup, exc_info=True)

    def write_file(self, relative: str, data: bytes) -> None:
        try:
            _write_atomic(_resolve(self.primary_root, relative), data)
        except OSError as exc:
            logger.exception("Could not write PDF to %s", self.primary_root)
            raise PdfStorageError("PDF storage is unavailable. Please try again.") from exc
        self._copy_to_backup(relative, data)

    def _copy_to_backup(self, relative: str, data: bytes) -> bool:
        backup = self.backup_root
        if backup is None:
            return False
        try:
            _write_atomic(_resolve(backup, relative), data)
            return True
        except OSError:
            logger.warning("Could not copy PDF %s to backup folder %s", relative, backup, exc_info=True)
            return False

    def save(
        self,
        db: Session,
        *,
        po_request_id: int,
        filename: str,
        content_type: str,
        pdf_bytes: bytes,
        page_count: int,
    ) -> PoAttachment:
        now = datetime.now()
        relative = f"{now:%Y}/{now:%m}/{po_request_id}.pdf"
        self.write_file(relative, pdf_bytes)
        attachment = PoAttachment(
            po_request_id=po_request_id,
            filename=filename,
            content_type=content_type or "application/pdf",
            storage_path=relative,
            size_bytes=len(pdf_bytes),
            sha256=hashlib.sha256(pdf_bytes).hexdigest(),
            page_count=page_count,
        )
        db.add(attachment)
        db.flush()
        return attachment

    def get_by_po(self, db: Session, po_request_id: int) -> PoAttachment | None:
        return (
            db.query(PoAttachment)
            .filter(PoAttachment.po_request_id == po_request_id)
            .one_or_none()
        )

    def read(self, attachment: PoAttachment) -> bytes:
        roots = [self.primary_root]
        if self.backup_root is not None:
            roots.append(self.backup_root)
        for root in roots:
            path = _resolve(root, attachment.storage_path)
            try:
                data = path.read_bytes()
            except OSError:
                continue
            if hashlib.sha256(data).hexdigest() != attachment.sha256:
                logger.error("PDF file %s does not match its stored checksum", path)
                continue
            if root != self.primary_root:
                logger.warning("Restoring missing PDF %s from backup", attachment.storage_path)
                try:
                    _write_atomic(_resolve(self.primary_root, attachment.storage_path), data)
                except OSError:
                    logger.warning("Could not restore PDF %s to primary storage", attachment.storage_path, exc_info=True)
            return data
        raise PdfStorageError("The original PDF file is missing from storage.", status_code=404)

    def delete_files(self, relative: str) -> None:
        _remove(_resolve(self.primary_root, relative))
        if self.backup_root is not None:
            _remove(_resolve(self.backup_root, relative))

    def sync_backup(self, db: Session) -> int:
        """Copy any PDFs that are missing from the backup folder (e.g. it was offline at upload)."""
        backup = self.backup_root
        if backup is None:
            return 0
        copied = 0
        for (relative,) in db.query(PoAttachment.storage_path).all():
            target = _resolve(backup, relative)
            source = _resolve(self.primary_root, relative)
            try:
                if target.exists() or not source.exists():
                    continue
                _write_atomic(target, source.read_bytes())
                copied += 1
            except OSError:
                logger.warning("PDF backup sync stopped; backup folder unreachable: %s", backup, exc_info=True)
                break
        if copied:
            logger.info("Copied %d PDF(s) to backup folder %s", copied, backup)
        return copied


pdf_storage = PdfStorage()
