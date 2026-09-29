"""customer alias table

Revision ID: 003_customer_alias
Revises: 002_phase2_erp
Create Date: 2026-09-28
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "003_customer_alias"
down_revision: Union[str, Sequence[str], None] = "002_phase2_erp"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "customer_alias",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("normalized_name", sa.String(length=255), nullable=False),
        sa.Column("source_name", sa.String(length=255), nullable=True),
        sa.Column("customer_number", sa.String(length=15), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_customer_alias_normalized_name", "customer_alias", ["normalized_name"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_customer_alias_normalized_name", table_name="customer_alias")
    op.drop_table("customer_alias")
