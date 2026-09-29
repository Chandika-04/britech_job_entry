"""phase 2 line resolution and erp audit

Revision ID: 002_phase2_erp
Revises: 001_initial
Create Date: 2026-09-23
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "002_phase2_erp"
down_revision: Union[str, Sequence[str], None] = "001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("po_line_item", sa.Column("resolved_customer_code", sa.String(length=15), nullable=True))
    op.add_column("po_line_item", sa.Column("resolved_part_number", sa.String(length=30), nullable=True))
    op.add_column("po_line_item", sa.Column("resolved_part_revision", sa.String(length=5), nullable=True))
    op.add_column("po_line_item", sa.Column("resolved_pm_linkid", sa.Integer(), nullable=True))
    op.add_column("po_line_item", sa.Column("customer_credit_hold", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("po_line_item", sa.Column("credit_hold_acknowledged", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("po_line_item", sa.Column("duplicate_job_numbers", sa.JSON(), nullable=False, server_default=sa.text("'[]'")))
    op.add_column("po_line_item", sa.Column("duplicate_acknowledged", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("po_line_item", sa.Column("erp_status", sa.String(length=32), nullable=False, server_default="pending"))
    op.add_column("po_line_item", sa.Column("erp_job_number", sa.String(length=21), nullable=True))
    op.add_column("po_line_item", sa.Column("erp_created_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("po_line_item", sa.Column("erp_failure_reason", sa.Text(), nullable=True))
    op.add_column("po_line_item", sa.Column("erp_database", sa.String(length=128), nullable=True))

    op.create_table(
        "erp_write_audit",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("po_id", sa.Uuid(), nullable=False),
        sa.Column("line_item_id", sa.Uuid(), nullable=True),
        sa.Column("job_number", sa.String(length=21), nullable=True),
        sa.Column("action", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("database_name", sa.String(length=128), nullable=True),
        sa.Column("app_version", sa.String(length=32), nullable=True),
        sa.Column("request_json", sa.JSON(), nullable=True),
        sa.Column("result_json", sa.JSON(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(["po_id"], ["po_request.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["line_item_id"], ["po_line_item.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_erp_write_audit_po_id", "erp_write_audit", ["po_id"])
    op.create_index("ix_erp_write_audit_line_item_id", "erp_write_audit", ["line_item_id"])


def downgrade() -> None:
    op.drop_table("erp_write_audit")
    for name in [
        "resolved_customer_code",
        "resolved_part_number",
        "resolved_part_revision",
        "resolved_pm_linkid",
        "customer_credit_hold",
        "credit_hold_acknowledged",
        "duplicate_job_numbers",
        "duplicate_acknowledged",
        "erp_status",
        "erp_job_number",
        "erp_created_at",
        "erp_failure_reason",
        "erp_database",
    ]:
        op.drop_column("po_line_item", name)
