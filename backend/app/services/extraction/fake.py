from datetime import date
from decimal import Decimal

from app.schemas.extraction import ExtractedLineItem, ExtractionResult, ProviderResult
from app.services.pdf.processor import ProcessedPdf


class FakeExtractionProvider:
    """Predictable extraction used by automated tests. Does not call any AI service."""

    def __init__(self, result: ExtractionResult | None = None, fail: bool = False):
        self.result = result
        self.fail = fail
        self.calls = 0

    def extract(self, processed: ProcessedPdf) -> ProviderResult:
        self.calls += 1
        if self.fail:
            raise RuntimeError("fake provider failure")

        extraction = self.result or ExtractionResult(
            po_number="PO-1001",
            customer_name="Acme Manufacturing",
            customer_number="CUST-42",
            order_date=date(2026, 3, 12),
            requested_ship_date=date(2026, 4, 1),
            buyer_contact="Jane Buyer",
            buyer_notes="Please expedite if possible.",
            bill_to="Acme Manufacturing\n100 Industrial Way\nSeattle, WA 98101",
            ship_to="Acme Manufacturing\nDock 3\n100 Industrial Way\nSeattle, WA 98101",
            line_items=[
                ExtractedLineItem(
                    line_number=1,
                    customer_part_number="ACM-9001",
                    revision="B",
                    description="Machined housing",
                    quantity=Decimal("25"),
                    unit_price=Decimal("18.50"),
                    uom="EA",
                    due_date=date(2026, 4, 1),
                    notes=None,
                ),
                ExtractedLineItem(
                    line_number=2,
                    customer_part_number="ACM-9002",
                    revision="A",
                    description="Cover plate",
                    quantity=Decimal("10"),
                    unit_price=Decimal("6.25"),
                    uom="EA",
                    due_date=date(2026, 4, 15),
                    notes=None,
                ),
            ],
            possible_po_numbers=["PO-1001"],
            document_quality="good",
            unreadable_pages=[],
            conflicting_fields=[],
            warnings=[],
        )
        raw = extraction.model_dump(mode="json")
        raw["_fake"] = True
        raw["_page_count"] = processed.page_count
        raw["_has_embedded_text"] = bool(processed.embedded_text)
        return ProviderResult(
            extraction=extraction,
            raw_json=raw,
            model="fake",
            input_tokens=0,
            output_tokens=0,
            cost_usd=Decimal("0"),
        )
