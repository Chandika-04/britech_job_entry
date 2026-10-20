"""record whether the traveler was printed for a created job

Revision ID: 009_line_erp_traveler_printed
Revises: 008_line_erp_shipper_number
Create Date: 2026-10-06
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "009_line_erp_traveler_printed"
down_revision: Union[str, Sequence[str], None] = "008_line_erp_shipper_number"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "po_line_item",
        sa.Column("erp_traveler_printed", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("po_line_item", "erp_traveler_printed")
