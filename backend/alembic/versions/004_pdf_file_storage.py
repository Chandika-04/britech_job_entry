"""store pdfs as files instead of in the database

Revision ID: 004_pdf_file_storage
Revises: 003_customer_alias
Create Date: 2026-09-29
"""

import hashlib
from datetime import datetime
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

from app.services.storage.pdf_storage import pdf_storage

revision: str = "004_pdf_file_storage"
down_revision: Union[str, Sequence[str], None] = "003_customer_alias"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

attachment = sa.table(
    "po_attachment",
    sa.column("id", sa.Uuid()),
    sa.column("po_request_id", sa.Uuid()),
    sa.column("pdf_bytes", sa.LargeBinary()),
    sa.column("storage_path", sa.String()),
    sa.column("size_bytes", sa.Integer()),
    sa.column("sha256", sa.String()),
)
po_request = sa.table("po_request", sa.column("id", sa.Uuid()), sa.column("created_at", sa.DateTime(timezone=True)))


def upgrade() -> None:
    with op.batch_alter_table("po_attachment") as batch:
        batch.add_column(sa.Column("storage_path", sa.String(length=512), nullable=True))
        batch.add_column(sa.Column("size_bytes", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("sha256", sa.String(length=64), nullable=True))

    conn = op.get_bind()
    rows = conn.execute(
        sa.select(attachment.c.id, attachment.c.po_request_id, attachment.c.pdf_bytes, po_request.c.created_at).join(
            po_request, po_request.c.id == attachment.c.po_request_id
        )
    ).all()
    for row in rows:
        data = bytes(row.pdf_bytes)
        stamp = row.created_at or datetime.now()
        relative = f"{stamp:%Y}/{stamp:%m}/{row.po_request_id}.pdf"
        pdf_storage.write_file(relative, data)
        conn.execute(
            attachment.update()
            .where(attachment.c.id == row.id)
            .values(storage_path=relative, size_bytes=len(data), sha256=hashlib.sha256(data).hexdigest())
        )

    with op.batch_alter_table("po_attachment") as batch:
        batch.alter_column("storage_path", existing_type=sa.String(length=512), nullable=False)
        batch.alter_column("size_bytes", existing_type=sa.Integer(), nullable=False)
        batch.alter_column("sha256", existing_type=sa.String(length=64), nullable=False)
        batch.drop_column("pdf_bytes")


def downgrade() -> None:
    with op.batch_alter_table("po_attachment") as batch:
        batch.add_column(sa.Column("pdf_bytes", sa.LargeBinary(), nullable=True))

    conn = op.get_bind()
    rows = conn.execute(sa.select(attachment.c.id, attachment.c.storage_path)).all()
    for row in rows:
        path = pdf_storage.primary_root.joinpath(*row.storage_path.split("/"))
        conn.execute(attachment.update().where(attachment.c.id == row.id).values(pdf_bytes=path.read_bytes()))

    with op.batch_alter_table("po_attachment") as batch:
        batch.alter_column("pdf_bytes", existing_type=sa.LargeBinary(), nullable=False)
        batch.drop_column("sha256")
        batch.drop_column("size_bytes")
        batch.drop_column("storage_path")
