"""record which shipper a created job was attached to

Revision ID: 008_line_erp_shipper_number
Revises: 007_po_source
Create Date: 2026-10-06
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "008_line_erp_shipper_number"
down_revision: Union[str, Sequence[str], None] = "007_po_source"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("po_line_item", sa.Column("erp_shipper_number", sa.String(length=20), nullable=True))
    op.execute(
        """
        UPDATE po_line_item
        SET erp_shipper_number = (
            SELECT po_request.shipper_number
            FROM po_request
            WHERE po_request.id = po_line_item.po_request_id
        )
        WHERE erp_status = 'created'
          AND EXISTS (
              SELECT 1 FROM po_request
              WHERE po_request.id = po_line_item.po_request_id
                AND po_request.shipper_number IS NOT NULL
          )
        """
    )


def downgrade() -> None:
    op.drop_column("po_line_item", "erp_shipper_number")
