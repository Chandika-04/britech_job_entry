"""store shopkeeper shipper number on the po

Revision ID: 005_shipper_number
Revises: 004_pdf_file_storage
Create Date: 2026-10-01
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "005_shipper_number"
down_revision: Union[str, Sequence[str], None] = "004_pdf_file_storage"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("po_request", sa.Column("shipper_number", sa.String(length=20), nullable=True))


def downgrade() -> None:
    op.drop_column("po_request", "shipper_number")
