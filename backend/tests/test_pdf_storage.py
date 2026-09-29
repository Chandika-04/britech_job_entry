import pytest

from app.config import get_settings
from app.exceptions import PdfStorageError
from app.models.erp_write_audit import ErpWriteAudit
from app.models.po_attachment import PoAttachment
from app.models.po_request import PoRequest
from app.services.po_service import create_from_upload, delete_po, get_po
from app.services.storage.pdf_storage import pdf_storage
from tests.helpers import make_text_pdf


def _upload(db, data=None):
    return create_from_upload(db, filename="po.pdf", content_type="application/pdf", pdf_bytes=data or make_text_pdf())


def _paths(po):
    relative = po.attachment.storage_path
    return (
        pdf_storage.primary_root.joinpath(*relative.split("/")),
        pdf_storage.backup_root.joinpath(*relative.split("/")),
    )


def test_upload_writes_file_and_backup_copy(db, settings):
    data = make_text_pdf()
    po = _upload(db, data)
    primary, backup = _paths(po)
    assert primary.read_bytes() == data
    assert backup.read_bytes() == data
    assert po.attachment.size_bytes == len(data)
    assert po.attachment.storage_path.endswith(f"/{po.id}.pdf")
    assert pdf_storage.read(po.attachment) == data


def test_unreachable_backup_does_not_block_upload_and_syncs_later(db, settings, tmp_path, monkeypatch):
    blocker = tmp_path / "not-a-folder"
    blocker.write_text("x")
    monkeypatch.setenv("PDF_BACKUP_DIR", str(blocker / "backup"))
    get_settings.cache_clear()
    po = _upload(db)
    assert pdf_storage.read(po.attachment).startswith(b"%PDF")

    monkeypatch.setenv("PDF_BACKUP_DIR", str(tmp_path / "pdf-backup"))
    get_settings.cache_clear()
    assert pdf_storage.sync_backup(db) == 1
    assert _paths(po)[1].exists()
    assert pdf_storage.sync_backup(db) == 0


def test_missing_primary_file_is_restored_from_backup(db, settings):
    data = make_text_pdf()
    po = _upload(db, data)
    primary, _ = _paths(po)
    primary.unlink()
    assert pdf_storage.read(po.attachment) == data
    assert primary.read_bytes() == data


def test_missing_everywhere_raises_clear_error(db, settings):
    po = _upload(db)
    for path in _paths(po):
        path.unlink()
    with pytest.raises(PdfStorageError) as exc:
        pdf_storage.read(po.attachment)
    assert exc.value.status_code == 404


def test_corrupted_file_is_rejected(db, settings):
    po = _upload(db)
    for path in _paths(po):
        path.write_bytes(b"%PDF-garbage")
    with pytest.raises(PdfStorageError):
        pdf_storage.read(po.attachment)


def test_delete_po_removes_files_and_audit_rows(db, settings):
    po = _upload(db)
    primary, backup = _paths(po)
    db.add(ErpWriteAudit(po_id=po.id, action="attempt", status="started"))
    db.commit()
    delete_po(db, get_po(db, po.id))
    assert not primary.exists()
    assert not backup.exists()
    assert db.query(PoRequest).count() == 0
    assert db.query(PoAttachment).count() == 0
    assert db.query(ErpWriteAudit).count() == 0


def test_attachment_api_serves_file(client, db, settings):
    po = _upload(db)
    response = client.get(f"/api/po/{po.id}/attachment")
    assert response.status_code == 200
    assert response.content == pdf_storage.read(po.attachment)
    for path in _paths(po):
        path.unlink()
    missing = client.get(f"/api/po/{po.id}/attachment")
    assert missing.status_code == 404
    assert "missing from storage" in missing.json()["detail"]


def test_migration_moves_existing_pdfs_to_files(tmp_path, monkeypatch):
    from alembic import command
    from alembic.config import Config
    import sqlalchemy as sa

    from app.config import BACKEND_ROOT

    db_path = (tmp_path / "migrate.db").resolve().as_posix()
    url = f"sqlite:///{db_path}"
    monkeypatch.setenv("DATABASE_URL", url)
    monkeypatch.setenv("PDF_STORAGE_DIR", str(tmp_path / "migrated-pdfs"))
    monkeypatch.setenv("PDF_BACKUP_DIR", "")
    get_settings.cache_clear()
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))

    command.upgrade(config, "003_customer_alias")
    engine = sa.create_engine(url)
    data = make_text_pdf()
    with engine.begin() as conn:
        conn.execute(
            sa.text(
                "INSERT INTO po_request (id, status, review_state, warnings, created_at, updated_at) "
                "VALUES ('11111111111111111111111111111111', 'extracted', 'unreviewed', '[]', '2026-03-05 10:00:00', '2026-03-05 10:00:00')"
            )
        )
        conn.execute(
            sa.text(
                "INSERT INTO po_attachment (id, po_request_id, filename, content_type, pdf_bytes, page_count) "
                "VALUES ('22222222222222222222222222222222', '11111111111111111111111111111111', 'po.pdf', 'application/pdf', :data, 1)"
            ),
            {"data": data},
        )

    command.upgrade(config, "head")
    with engine.connect() as conn:
        row = conn.execute(sa.text("SELECT storage_path, size_bytes FROM po_attachment")).one()
        columns = {col["name"] for col in sa.inspect(conn).get_columns("po_attachment")}
    engine.dispose()
    assert "pdf_bytes" not in columns
    assert row.storage_path == "2026/03/11111111-1111-1111-1111-111111111111.pdf"
    assert row.size_bytes == len(data)
    assert (tmp_path / "migrated-pdfs" / "2026" / "03" / "11111111-1111-1111-1111-111111111111.pdf").read_bytes() == data
    get_settings.cache_clear()
