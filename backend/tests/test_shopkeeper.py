from decimal import Decimal
from uuid import UUID

import pytest

from app.exceptions import AppError, ConflictError
from app.models.erp_write_audit import ErpWriteAudit
from app.services.extraction.fake import FakeExtractionProvider
from app.services.extraction.pipeline import run_extraction
from app.services.po_service import confirm_reviewed, create_from_upload, get_po
from app.services.shopkeeper.fake import FakeShopKeeper
from app.services.shopkeeper.writer import (
    acknowledge_credit_hold,
    create_job_for_line,
    lookup_customers,
    lookup_parts,
    reset_erp,
    resolve_customer,
    resolve_part,
    skip_line,
    unskip_line,
)
from tests.helpers import make_text_pdf, pdf_upload


def _extracted_po(db, settings, **line_updates):
    po = create_from_upload(db, filename="po.pdf", content_type="application/pdf", pdf_bytes=make_text_pdf())
    run_extraction(db, po.id, provider=FakeExtractionProvider(), settings=settings)
    po = get_po(db, po.id)
    line = po.line_items[0]
    for key, value in line_updates.items():
        setattr(line, key, value)
    db.add(line)
    db.commit()
    db.refresh(po)
    return po


def _ready_line(db, settings, customer="BAYADV", part="SUB-BEC-12352-0016", rev="A", fake=None):
    po = _extracted_po(db, settings)
    line = po.line_items[0]
    resolve_customer(db, po, line, customer, True, fake)
    resolve_part(db, po, line, part, rev, fake)
    po = confirm_reviewed(db, po)
    return po, po.line_items[0]


def test_customer_lookup_excludes_ship_to_and_requires_reviewer_choice():
    fake = FakeShopKeeper()
    result = lookup_customers("Bay Advanced", fake)
    numbers = [row["customer_number"] for row in result["matches"]]
    assert numbers == ["BAYADV"]
    assert result["exact_one"] is True
    assert "BAYADV-S" not in numbers


def test_part_lookup_requires_explicit_revision():
    fake = FakeShopKeeper()
    multi = lookup_parts("MULTI-REV", None, fake)
    assert len(multi["matches"]) == 2
    assert multi["exact_one"] is False
    one = lookup_parts("MULTI-REV", "B", fake)
    assert one["exact_one"] is True
    assert one["matches"][0]["part_revision"] == "B"
    assert lookup_parts("DEAD-PART", "A", fake)["matches"] == []


def test_inactive_customer_cannot_be_resolved(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po = _extracted_po(db, settings)
    with pytest.raises(AppError, match="inactive"):
        resolve_customer(db, po, po.line_items[0], "OLDCO", True, fake)


def test_credit_hold_blocks_ready_until_acknowledged(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po = _extracted_po(db, settings)
    line = po.line_items[0]
    resolve_customer(db, po, line, "HOLDCO", True, fake)
    resolve_part(db, po, line, "SUB-BEC-12352-0016", "A", fake)
    po = confirm_reviewed(db, po)
    line = po.line_items[0]
    assert line.customer_credit_hold is True
    assert line.erp_status == "pending"
    with pytest.raises(AppError, match="credit hold"):
        create_job_for_line(db, po, line, fake)
    acknowledge_credit_hold(line, po, True)
    assert line.erp_status == "ready"


def test_write_time_checks_do_not_write(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po, line = _ready_line(db, settings, fake=fake)
    line.quantity = Decimal("2.5")
    db.add(line)
    db.commit()
    with pytest.raises(AppError, match="positive integer"):
        create_job_for_line(db, po, line, fake)
    assert fake.jobs == []
    assert line.erp_status == "failed"
    assert line.erp_job_number is None


def test_create_job_writes_reviewed_price_and_customer_tax(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po, line = _ready_line(db, settings, customer="CORTEC", fake=fake)
    line = create_job_for_line(db, po, line, fake)
    db.commit()
    assert line.erp_status == "created"
    assert line.erp_job_number == "200001"
    assert fake.last_payload is not None
    assert fake.last_payload.unit_price == Decimal(str(line.unit_price))
    assert fake.last_payload.customer_code == "CORTEC"
    assert fake.last_payload.taxable is False
    assert fake.last_payload.tax_code == "NT"
    assert fake.last_payload.cert_required is False
    assert fake.last_payload.part_description == "Test housing"
    assert fake.last_payload.unit == "Each"
    audits = db.query(ErpWriteAudit).filter_by(line_item_id=line.id).all()
    assert {row.action for row in audits} >= {"attempt", "create_job"}


def test_taxable_customer_uses_customer_tax_code(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po, line = _ready_line(db, settings, customer="TAXCO", fake=fake)
    create_job_for_line(db, po, line, fake)
    assert fake.last_payload is not None
    assert fake.last_payload.taxable is True
    assert fake.last_payload.tax_code == "CA"
    assert fake.last_payload.cert_required is False


def test_created_line_rejects_second_create(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po, line = _ready_line(db, settings, fake=fake)
    create_job_for_line(db, po, line, fake)
    db.commit()
    with pytest.raises(ConflictError, match="already created"):
        create_job_for_line(db, po, line, fake)
    assert fake.jobs == [("PO-1001", "1", "200001")]


def test_crash_after_commit_recovers_existing_job(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po, line = _ready_line(db, settings, fake=fake)
    fake.jobs.append((po.po_number, "1", "200099"))
    line.erp_status = "creating"
    db.add(line)
    db.commit()
    line = create_job_for_line(db, po, line, fake)
    db.commit()
    assert line.erp_status == "created"
    assert line.erp_job_number == "200099"
    assert [job for *_, job in fake.jobs] == ["200099"]
    assert db.query(ErpWriteAudit).filter_by(action="recover").count() == 1


def test_fail_after_commit_recovers_on_same_request(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po, line = _ready_line(db, settings, fake=fake)
    fake.fail_after_commit = True
    line = create_job_for_line(db, po, line, fake)
    assert line.erp_status == "created"
    assert line.erp_job_number == "200001"


def test_step_failure_rolls_back_and_consumes_reserved_number(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po, line = _ready_line(db, settings, fake=fake)
    fake.fail_step = "jobship"
    with pytest.raises(AppError, match="jobship"):
        create_job_for_line(db, po, line, fake)
    assert line.erp_status == "failed"
    assert fake.jobs == []
    assert fake.reserved_numbers == ["200001"]
    fake.fail_step = None
    line.erp_status = "ready"
    line = create_job_for_line(db, po, line, fake)
    assert line.erp_job_number == "200002"


def test_mismatched_database_stops_before_write(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po, line = _ready_line(db, settings, fake=fake)
    fake.database_name = "SkData"
    with pytest.raises(AppError, match="expected SkData_Test"):
        create_job_for_line(db, po, line, fake)
    assert fake.jobs == []
    assert line.erp_status == "ready"


def test_unconfirmed_po_cannot_create_job(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po = _extracted_po(db, settings)
    line = po.line_items[0]
    resolve_customer(db, po, line, "BAYADV", True, fake)
    resolve_part(db, po, line, "SUB-BEC-12352-0016", "A", fake)
    assert line.erp_status == "pending"
    with pytest.raises(ConflictError, match="confirmed"):
        create_job_for_line(db, po, line, fake)


def test_skip_and_admin_reset(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po, line = _ready_line(db, settings, fake=fake)
    skip_line(db, po, line, "Not needed")
    db.commit()
    db.refresh(line)
    assert line.erp_status == "skipped"
    with pytest.raises(ConflictError, match="skipped"):
        create_job_for_line(db, po, line, fake)
    unskip_line(db, po, line)
    assert line.erp_status == "ready"
    assert line.erp_failure_reason is None
    with pytest.raises(ConflictError, match="Only skipped"):
        unskip_line(db, po, line)
    db.commit()
    created = create_job_for_line(db, po, line, fake)
    assert created.erp_status == "created"
    line.erp_status = "created"
    line.erp_job_number = "200001"
    reset_erp(db, po, line, "Deleted in ShopKeeper")
    assert line.erp_status == "ready"
    assert line.erp_job_number is None


def test_lookup_and_create_via_api(client, db, settings):
    upload = client.post("/api/upload", files=pdf_upload("po.pdf", make_text_pdf()))
    po_id = UUID(upload.json()["id"])
    run_extraction(db, po_id, provider=FakeExtractionProvider(), settings=settings)
    detail = client.get(f"/api/po/{po_id}").json()
    line_id = detail["line_items"][0]["id"]

    customers = client.get("/api/shopkeeper/customers", params={"q": "Bay"})
    assert customers.status_code == 200
    assert [row["customer_number"] for row in customers.json()["matches"]] == ["BAYADV"]

    parts = client.get("/api/shopkeeper/parts", params={"part_number": "MULTI-REV"})
    assert parts.status_code == 200
    assert parts.json()["exact_one"] is False

    resolved = client.post(
        f"/api/po/{po_id}/lines/{line_id}/resolve-customer",
        json={"customer_number": "BAYADV", "apply_to_all_lines": True},
    )
    assert resolved.status_code == 200
    resolved = client.post(
        f"/api/po/{po_id}/lines/{line_id}/resolve-part",
        json={"part_number": "SUB-BEC-12352-0016", "part_revision": "A"},
    )
    assert resolved.status_code == 200

    confirm = client.post(
        f"/api/po/{po_id}/review",
        json={
            "action": "confirm",
            "po": {
                "po_number": detail["po_number"],
                "customer_name": detail["customer_name"],
                "order_date": detail["order_date"],
                "requested_ship_date": detail["requested_ship_date"],
                "buyer_contact": detail["buyer_contact"],
                "buyer_notes": detail["buyer_notes"],
                "bill_to": detail["bill_to"],
                "ship_to": detail["ship_to"],
                "line_items": detail["line_items"],
            },
        },
    )
    assert confirm.status_code == 200
    assert confirm.json()["line_items"][0]["erp_status"] == "ready"

    created = client.post(f"/api/po/{po_id}/lines/{line_id}/create-job")
    assert created.status_code == 200
    assert created.json()["line_items"][0]["erp_status"] == "created"
    assert created.json()["line_items"][0]["erp_job_number"] == "200001"

    again = client.post(f"/api/po/{po_id}/lines/{line_id}/create-job")
    assert again.status_code == 409
