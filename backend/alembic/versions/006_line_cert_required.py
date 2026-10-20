"""store reviewer cert flag on each po line

Revision ID: 006_line_cert_required
Revises: 005_shipper_number
Create Date: 2026-10-02
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "006_line_cert_required"
down_revision: Union[str, Sequence[str], None] = "005_shipper_number"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "po_line_item",
        sa.Column("cert_required", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("po_line_item", "cert_required")
