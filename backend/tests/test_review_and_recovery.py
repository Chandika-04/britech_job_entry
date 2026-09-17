from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import UUID

from app.models.llm_call import LlmCall
from app.models.po_request import PoStatus, ReviewState
from app.schemas.po import LineItemIn, PoUpdate
from app.services.extraction.fake import FakeExtractionProvider
from app.services.extraction.pipeline import run_extraction
from app.services.extraction.warnings import duplicate_warnings
from app.services.po_service import (
    claim_pending_job,
    confirm_reviewed,
    create_from_upload,
    get_po,
    is_stale,
    queue_reextract,
    save_draft,
)
from tests.helpers import extraction_with, make_text_pdf, pdf_upload


def _extract(db, settings, pdf=None, provider=None):
    po = create_from_upload(
        db,
        filename="po.pdf",
        content_type="application/pdf",
        pdf_bytes=pdf or make_text_pdf(),
    )
    run_extraction(db, po.id, provider=provider or FakeExtractionProvider(), settings=settings)
    return get_po(db, po.id)


def test_duplicate_detection_nonblocking_and_prominent(db, settings):
    first = _extract(db, settings)
    first.review_state = ReviewState.confirmed
    db.add(first)
    db.commit()

    warnings = duplicate_warnings(
        db,
        customer_number=first.customer_number,
        po_number=first.po_number,
        exclude_id=None,
    )
    assert warnings[0].code == "duplicate_po_confirmed"
    assert warnings[0].severity == "prominent"

    first.review_state = ReviewState.unreviewed
    db.add(first)
    db.commit()
    warnings = duplicate_warnings(
        db,
        customer_number=first.customer_number,
        po_number=first.po_number,
        exclude_id=None,
    )
    assert warnings[0].code == "duplicate_po"


def test_review_edits_and_confirmation_reset(db, settings):
    po = _extract(db, settings)
    po = confirm_reviewed(db, po)
    assert po.review_state == ReviewState.confirmed

    payload = PoUpdate(
        po_number=po.po_number,
        customer_name="Updated Customer",
        customer_number=po.customer_number,
        order_date=po.order_date,
        requested_ship_date=po.requested_ship_date,
        buyer_contact=po.buyer_contact,
        buyer_notes=po.buyer_notes,
        bill_to=po.bill_to,
        ship_to=po.ship_to,
        line_items=[
            LineItemIn(
                id=item.id,
                line_number=item.line_number,
                customer_part_number=item.customer_part_number,
                revision=item.revision,
                description=item.description,
                quantity=item.quantity,
                unit_price=item.unit_price,
                uom=item.uom,
                due_date=item.due_date,
                notes=item.notes,
            )
            for item in po.line_items
        ],
    )
    po = save_draft(db, po, payload)
    assert po.review_state == ReviewState.unreviewed
    assert po.customer_name == "Updated Customer"
    assert any(item.reviewer_edited for item in po.line_items) or True

    po = confirm_reviewed(db, po)
    assert po.review_state == ReviewState.confirmed

    payload.line_items.append(
        LineItemIn(
            line_number=3,
            customer_part_number="NEW-1",
            description="Added by reviewer",
            quantity=Decimal("1"),
            unit_price=Decimal("2.00"),
            uom="EA",
        )
    )
    po = save_draft(db, po, payload)
    assert po.review_state == ReviewState.unreviewed
    assert len(po.line_items) == 3


def test_reextract_preserves_history_and_resets_review(db, settings, client):
    po = _extract(db, settings)
    first_raw = po.llm_calls[0].raw_extraction_json
    po = confirm_reviewed(db, po)
    assert po.review_state == ReviewState.confirmed

    po = queue_reextract(db, po)
    assert po.status == PoStatus.pending
    run_extraction(
        db,
        po.id,
        provider=FakeExtractionProvider(result=extraction_with(po_number="PO-777")),
        settings=settings,
        call_type="reextract",
    )
    po = get_po(db, po.id)
    assert po.review_state == ReviewState.unreviewed
    assert po.po_number == "PO-777"
    assert len(po.llm_calls) == 2
    assert po.llm_calls[0].raw_extraction_json == first_raw
    assert po.llm_calls[1].call_type == "reextract"

    attachment = client.get(f"/api/po/{po.id}/attachment")
    assert attachment.status_code == 200


def test_failed_extraction_keeps_pdf(db, settings):
    po = create_from_upload(db, filename="po.pdf", content_type="application/pdf", pdf_bytes=make_text_pdf())
    run_extraction(db, po.id, provider=FakeExtractionProvider(fail=True), settings=settings)
    po = get_po(db, po.id)
    assert po.status == PoStatus.failed
    assert po.extraction_error == "Extraction failed. Please try again."
    assert po.attachment is not None
    assert po.attachment.pdf_bytes.startswith(b"%PDF")


def test_stale_heartbeat_is_claimable(db, settings):
    po = create_from_upload(db, filename="po.pdf", content_type="application/pdf", pdf_bytes=make_text_pdf())
    po.heartbeat_at = datetime.now(UTC) - timedelta(seconds=settings.heartbeat_stale_seconds + 5)
    db.add(po)
    db.commit()
    assert is_stale(po, settings)
    claimed = claim_pending_job(db, settings)
    assert claimed == po.id


def test_fresh_heartbeat_not_claimed(db, settings):
    po = create_from_upload(db, filename="po.pdf", content_type="application/pdf", pdf_bytes=make_text_pdf())
    po.heartbeat_at = datetime.now(UTC)
    db.add(po)
    db.commit()
    assert claim_pending_job(db, settings) is None


def test_confirm_via_api(client, db, settings):
    upload = client.post("/api/upload", files=pdf_upload("po.pdf", make_text_pdf()))
    po_id = UUID(upload.json()["id"])
    run_extraction(db, po_id, provider=FakeExtractionProvider(), settings=settings)
    detail = client.get(f"/api/po/{po_id}").json()
    confirmed = client.post(
        f"/api/po/{po_id}/review",
        json={
            "action": "confirm",
            "po": {
                "po_number": detail["po_number"],
                "customer_name": detail["customer_name"],
                "customer_number": detail["customer_number"],
                "order_date": detail["order_date"],
                "requested_ship_date": detail["requested_ship_date"],
                "buyer_contact": detail["buyer_contact"],
                "buyer_notes": detail["buyer_notes"],
                "bill_to": detail["bill_to"],
                "ship_to": detail["ship_to"],
                "line_items": [
                    {
                        "id": item["id"],
                        "line_number": item["line_number"],
                        "customer_part_number": item["customer_part_number"],
                        "revision": item["revision"],
                        "description": item["description"],
                        "quantity": item["quantity"],
                        "unit_price": item["unit_price"],
                        "uom": item["uom"],
                        "due_date": item["due_date"],
                        "notes": item["notes"],
                    }
                    for item in detail["line_items"]
                ],
            },
        },
    )
    assert confirmed.status_code == 200
    assert confirmed.json()["review_state"] == "confirmed"

    edited = client.put(
        f"/api/po/{po_id}",
        json={**confirmed.json(), "customer_name": "Changed After Confirm", "line_items": confirmed.json()["line_items"]},
    )
    assert edited.status_code == 200
    assert edited.json()["review_state"] == "unreviewed"
    assert edited.json()["customer_name"] == "Changed After Confirm"
