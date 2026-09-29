from __future__ import annotations

import io
from datetime import date
from decimal import Decimal

import pymupdf as fitz

from app.schemas.extraction import ExtractedLineItem, ExtractionResult


def make_text_pdf(text: str = "Purchase Order PO-1001\nCustomer: Acme Manufacturing", pages: int = 1) -> bytes:
    doc = fitz.open()
    for index in range(pages):
        page = doc.new_page()
        page.insert_text((72, 72), f"{text}\nPage {index + 1}")
    data = doc.tobytes()
    doc.close()
    return data


def make_scanned_pdf(text: str = "Purchase Order PO-1001") -> bytes:
    source = fitz.open()
    page = source.new_page()
    page.insert_text((72, 72), text)
    pix = page.get_pixmap()
    source.close()

    doc = fitz.open()
    page = doc.new_page()
    page.insert_image(page.rect, pixmap=pix)
    data = doc.tobytes()
    doc.close()
    return data


def pdf_upload(name: str, data: bytes) -> dict:
    return {"file": (name, io.BytesIO(data), "application/pdf")}


def extraction_with(**overrides) -> ExtractionResult:
    base = ExtractionResult(
        po_number="PO-1001",
        customer_name="Acme Manufacturing",
        order_date=date(2026, 3, 12),
        requested_ship_date=date(2026, 4, 1),
        buyer_contact="Jane Buyer",
        buyer_notes=None,
        bill_to="Acme HQ",
        ship_to="Acme Dock",
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
            )
        ],
        possible_po_numbers=["PO-1001"],
        document_quality="good",
    )
    return base.model_copy(update=overrides)
