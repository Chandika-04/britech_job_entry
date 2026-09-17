"""initial po extraction tables

Revision ID: 001_initial
Revises:
Create Date: 2026-09-16
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "001_initial"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "po_request",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("review_state", sa.String(length=32), nullable=False),
        sa.Column("heartbeat_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("po_number", sa.String(length=128), nullable=True),
        sa.Column("customer_name", sa.String(length=255), nullable=True),
        sa.Column("customer_number", sa.String(length=128), nullable=True),
        sa.Column("order_date", sa.Date(), nullable=True),
        sa.Column("requested_ship_date", sa.Date(), nullable=True),
        sa.Column("buyer_contact", sa.String(length=255), nullable=True),
        sa.Column("buyer_notes", sa.Text(), nullable=True),
        sa.Column("bill_to", sa.Text(), nullable=True),
        sa.Column("ship_to", sa.Text(), nullable=True),
        sa.Column("extraction_error", sa.Text(), nullable=True),
        sa.Column("warnings", sa.JSON(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_po_request_status", "po_request", ["status"])
    op.create_index("ix_po_request_review_state", "po_request", ["review_state"])
    op.create_index("ix_po_request_heartbeat_at", "po_request", ["heartbeat_at"])
    op.create_index("ix_po_request_po_number", "po_request", ["po_number"])
    op.create_index("ix_po_request_customer_number", "po_request", ["customer_number"])

    op.create_table(
        "po_line_item",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("po_request_id", sa.Uuid(), nullable=False),
        sa.Column("line_number", sa.Integer(), nullable=True),
        sa.Column("customer_part_number", sa.String(length=128), nullable=True),
        sa.Column("revision", sa.String(length=64), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("quantity", sa.Numeric(18, 4), nullable=True),
        sa.Column("unit_price", sa.Numeric(18, 4), nullable=True),
        sa.Column("uom", sa.String(length=32), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("reviewer_edited", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["po_request_id"], ["po_request.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_po_line_item_po_request_id", "po_line_item", ["po_request_id"])

    op.create_table(
        "po_attachment",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("po_request_id", sa.Uuid(), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=128), nullable=False),
        sa.Column("pdf_bytes", sa.LargeBinary(), nullable=False),
        sa.Column("page_count", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["po_request_id"], ["po_request.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("po_request_id"),
    )
    op.create_index("ix_po_attachment_po_request_id", "po_attachment", ["po_request_id"], unique=True)

    op.create_table(
        "llm_call",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("po_request_id", sa.Uuid(), nullable=False),
        sa.Column("model", sa.String(length=128), nullable=False),
        sa.Column("call_type", sa.String(length=32), nullable=False),
        sa.Column("input_tokens", sa.Integer(), nullable=True),
        sa.Column("output_tokens", sa.Integer(), nullable=True),
        sa.Column("cost_usd", sa.Numeric(12, 6), nullable=True),
        sa.Column("raw_extraction_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.ForeignKeyConstraint(["po_request_id"], ["po_request.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_llm_call_po_request_id", "llm_call", ["po_request_id"])


def downgrade() -> None:
    op.drop_table("llm_call")
    op.drop_table("po_attachment")
    op.drop_table("po_line_item")
    op.drop_table("po_request")
