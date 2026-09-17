from datetime import date
from decimal import Decimal
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.schemas.extraction import ExtractionResult
from app.services.extraction.claude import ClaudeExtractionProvider, _retry_after_seconds, estimate_cost_usd
from app.services.extraction.fake import FakeExtractionProvider
from app.services.extraction.pipeline import run_extraction
from app.services.extraction.warnings import build_warnings
from app.services.pdf.processor import process_pdf
from app.services.po_service import create_from_upload
from tests.helpers import extraction_with, make_text_pdf


def test_fake_provider_predictable(settings):
    processed = process_pdf(make_text_pdf(), settings)
    result = FakeExtractionProvider().extract(processed)
    assert result.model == "fake"
    assert result.extraction.po_number == "PO-1001"
    assert len(result.extraction.line_items) == 2
    assert result.raw_json["_page_count"] == 1


def test_extraction_schema_allows_nulls():
    parsed = ExtractionResult.model_validate(
        {
            "po_number": None,
            "customer_name": None,
            "line_items": [
                {
                    "line_number": None,
                    "customer_part_number": None,
                    "quantity": None,
                    "unit_price": None,
                }
            ],
        }
    )
    assert parsed.po_number is None
    assert parsed.line_items[0].quantity is None


def test_extraction_schema_rejects_malformed():
    with pytest.raises(ValidationError):
        ExtractionResult.model_validate({"line_items": "not-a-list"})


def test_multiple_line_items_and_po_numbers(db):
    extraction = extraction_with(
        possible_po_numbers=["PO-1001", "PO-2002"],
        line_items=[
            extraction_with().line_items[0],
            extraction_with().line_items[0].model_copy(
                update={"line_number": 2, "customer_part_number": "ACM-9002", "quantity": Decimal("4")}
            ),
        ],
    )
    warnings = build_warnings(db, extraction)
    codes = {item.code for item in warnings}
    assert "multiple_po_numbers" in codes
    assert any("Multiple possible PO numbers" in item.message for item in warnings)


def test_conflicting_and_missing_fields(db):
    extraction = extraction_with(
        po_number=None,
        customer_name=None,
        customer_number=None,
        document_quality="poor",
        unreadable_pages=[2],
        conflicting_fields=["requested_ship_date"],
        line_items=[
            extraction_with().line_items[0].model_copy(
                update={"quantity": None, "due_date": None, "unit_price": None}
            )
        ],
    )
    codes = {item.code for item in build_warnings(db, extraction)}
    assert "missing_po_number" in codes
    assert "missing_customer" in codes
    assert "missing_quantity" in codes
    assert "missing_due_date" in codes
    assert "poor_document_quality" in codes
    assert "unreadable_page" in codes
    assert "conflicting_values" in codes
    assert "partial_line_item" in codes


def test_pipeline_stores_llm_history(db, settings):
    po = create_from_upload(db, filename="po.pdf", content_type="application/pdf", pdf_bytes=make_text_pdf())
    provider = FakeExtractionProvider()
    run_extraction(db, po.id, provider=provider, settings=settings, call_type="extract")
    db.refresh(po)
    assert po.status.value == "extracted"
    assert po.po_number == "PO-1001"
    assert len(po.line_items) == 2
    assert len(po.llm_calls) == 1
    assert po.llm_calls[0].raw_extraction_json["po_number"] == "PO-1001"

    provider.result = extraction_with(po_number="PO-9999")
    run_extraction(db, po.id, provider=provider, settings=settings, call_type="reextract")
    db.refresh(po)
    assert po.po_number == "PO-9999"
    assert po.review_state.value == "unreviewed"
    assert len(po.llm_calls) == 2
    originals = [call.raw_extraction_json["po_number"] for call in po.llm_calls]
    assert originals == ["PO-1001", "PO-9999"]


def test_claude_parses_tool_response():
    provider = ClaudeExtractionProvider(client=object())
    tool_input = extraction_with().model_dump(mode="json")
    response = SimpleNamespace(
        content=[SimpleNamespace(type="tool_use", name="save_purchase_order_extraction", input=tool_input)],
        usage=SimpleNamespace(input_tokens=1000, output_tokens=200),
        model="claude-sonnet-5",
    )
    parsed = provider._parse_response(response, "claude-sonnet-5")
    assert parsed.extraction.po_number == "PO-1001"
    assert parsed.cost_usd == estimate_cost_usd(1000, 200)


def test_claude_malformed_tool_response():
    provider = ClaudeExtractionProvider(client=object())
    response = SimpleNamespace(content=[SimpleNamespace(type="text", text="nope")], usage=None, model="x")
    with pytest.raises(ValueError):
        provider._parse_response(response, "x")


def test_retry_after_header():
    error = SimpleNamespace(response=SimpleNamespace(headers={"retry-after": "7"}))
    assert _retry_after_seconds(error, 1.0) == 7.0
    assert estimate_cost_usd(1_000_000, 1_000_000) > 0
