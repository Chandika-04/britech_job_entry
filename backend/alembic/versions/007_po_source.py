"""track whether a PO was uploaded or entered by hand

Revision ID: 007_po_source
Revises: 006_line_cert_required
Create Date: 2026-10-05
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "007_po_source"
down_revision: Union[str, Sequence[str], None] = "006_line_cert_required"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "po_request",
        sa.Column("source", sa.String(length=32), nullable=False, server_default="upload"),
    )
    op.create_index("ix_po_request_source", "po_request", ["source"])


def downgrade() -> None:
    op.drop_index("ix_po_request_source", table_name="po_request")
    op.drop_column("po_request", "source")
