from datetime import date
from decimal import Decimal

import pytest

from app.exceptions import AppError, ConflictError
from app.models.erp_write_audit import ErpWriteAudit
from app.schemas.po import LineItemIn, PoUpdate
from app.services.extraction.fake import FakeExtractionProvider
from app.services.extraction.pipeline import run_extraction
from app.services.po_service import confirm_reviewed, create_from_upload, get_po, save_draft, to_summary
from app.services.shopkeeper.fake import FakeShopKeeper
from app.services.shopkeeper.writer import (
    acknowledge_credit_hold,
    acknowledge_duplicate,
    create_job_for_line,
    delete_shopkeeper_job,
    lookup_customers,
    lookup_parts,
    reset_erp,
    resolve_customer,
    resolve_part,
    set_cert_required,
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


def test_customer_lookup_matches_starts_with():
    fake = FakeShopKeeper()
    by_name = lookup_customers("Bay", fake)
    assert [row["customer_number"] for row in by_name["matches"]] == ["BAYADV"]
    by_number = lookup_customers("COR", fake)
    assert [row["customer_number"] for row in by_number["matches"]] == ["CORTEC"]
    assert lookup_customers("Advanced", fake)["matches"] == []


def test_part_lookup_requires_explicit_revision():
    fake = FakeShopKeeper()
    multi = lookup_parts("MULTI-REV", None, fake)
    assert len(multi["matches"]) == 2
    assert multi["exact_one"] is False
    one = lookup_parts("MULTI-REV", "B", fake)
    assert one["exact_one"] is True
    assert one["matches"][0]["part_revision"] == "B"
    assert lookup_parts("DEAD-PART", "A", fake)["matches"] == []


def test_part_lookup_matches_starts_with():
    fake = FakeShopKeeper()
    prefix = lookup_parts("SUB", None, fake)
    assert [row["part_number"] for row in prefix["matches"]] == ["SUB-BEC-12352-0016"]
    assert lookup_parts("BEC", None, fake)["matches"] == []
    assert fake.get_part("SUB", "A") is None
    assert fake.get_part("SUB-BEC-12352-0016", "A") is not None


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


def test_duplicate_matches_customer_po_and_part_not_line(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po = _extracted_po(db, settings)
    po.po_number = "PO-4501"
    line = po.line_items[0]
    line_id = line.id
    line.line_number = 99
    db.add(po)
    db.commit()
    db.refresh(line)
    resolve_customer(db, po, line, "BAYADV", True, fake)
    assert line.duplicate_job_numbers == []
    resolve_part(db, po, line, "SUB-BEC-12352-0016", "A", fake)
    assert line.duplicate_job_numbers == ["199101"]
    po = confirm_reviewed(db, po)
    line = next(item for item in po.line_items if item.id == line_id)
    assert line.erp_status == "pending"
    with pytest.raises(AppError, match="customer, PO, and part"):
        create_job_for_line(db, po, line, fake)
    acknowledge_duplicate(line, po, True)
    assert line.erp_status == "ready"

    other_part = _extracted_po(db, settings)
    other_part.po_number = "PO-4501"
    other_line = other_part.line_items[0]
    resolve_customer(db, other_part, other_line, "BAYADV", True, fake)
    resolve_part(db, other_part, other_line, "4022.656.2799", "A", fake)
    assert other_line.duplicate_job_numbers == ["199102"]

    other_customer = _extracted_po(db, settings)
    other_customer.po_number = "PO-4501"
    cortec_line = other_customer.line_items[0]
    resolve_customer(db, other_customer, cortec_line, "CORTEC", True, fake)
    resolve_part(db, other_customer, cortec_line, "SUB-BEC-12352-0016", "A", fake)
    assert cortec_line.duplicate_job_numbers == []


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


def test_cert_default_from_customer_is_written_to_job(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po, line = _ready_line(db, settings, customer="BAYADV", fake=fake)
    assert line.cert_required is True
    create_job_for_line(db, po, line, fake)
    assert fake.last_payload is not None
    assert fake.last_payload.cert_required is True


def test_cert_override_is_written_instead_of_customer_default(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po, line = _ready_line(db, settings, customer="CORTEC", fake=fake)
    assert line.cert_required is False
    set_cert_required(po, line, True)
    db.commit()
    db.refresh(line)
    create_job_for_line(db, po, line, fake)
    assert fake.last_payload is not None
    assert fake.last_payload.cert_required is True


def test_cert_all_lines_skips_created_jobs(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po, _ = _ready_line(db, settings, customer="CORTEC", fake=fake)
    for line in po.line_items:
        if not line.resolved_part_number:
            resolve_part(db, po, line, "SUB-BEC-12352-0016", "A", fake)
    db.commit()
    db.refresh(po)
    create_job_for_line(db, po, po.line_items[0], fake)
    db.commit()
    db.refresh(po)
    set_cert_required(po, po.line_items[1], True, apply_to_all=True)
    db.commit()
    db.refresh(po)
    assert po.line_items[0].cert_required is False
    assert po.line_items[1].cert_required is True


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
    assert fake.get_job_page("200001") is not None


def test_delete_shopkeeper_job_removes_job_and_clears_line(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po, line = _ready_line(db, settings, fake=fake)
    line = create_job_for_line(db, po, line, fake)
    job = line.erp_job_number
    assert job
    deleted = delete_shopkeeper_job(db, job, fake)
    db.commit()
    db.refresh(line)
    assert deleted is not None
    assert line.erp_status == "ready"
    assert line.erp_job_number is None
    assert fake.get_job_page(job) is None
    assert ("Jobs", job, "AUTO", "Delete Job") in fake.lock_info
    audits = db.query(ErpWriteAudit).filter_by(line_item_id=line.id, action="delete_job").all()
    assert any(row.status == "success" for row in audits)


def test_delete_shopkeeper_job_refuses_shipper(db, settings):
    fake = FakeShopKeeper.reset_shared()
    from app.services.shopkeeper.writer import create_shipper_for_po

    po = _create_all_jobs(db, _ready_all_lines(db, settings, fake), fake)
    po = create_shipper_for_po(db, po, fake, prepared_by="CR")
    line = po.line_items[0]
    job = line.erp_job_number
    with pytest.raises(AppError, match="shipper"):
        delete_shopkeeper_job(db, job, fake)
    db.refresh(line)
    assert line.erp_status == "created"
    assert line.erp_job_number == job
    assert fake.get_job_page(job) is not None


def test_delete_shopkeeper_job_refuses_printed_traveler(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po, line = _ready_line(db, settings, fake=fake)
    line = create_job_for_line(db, po, line, fake)
    job = line.erp_job_number
    fake.mark_traveler_printed(job)
    with pytest.raises(AppError, match="printed traveler"):
        delete_shopkeeper_job(db, job, fake)
    assert fake.get_job_page(job) is not None
    assert line.erp_status == "created"


def test_lookup_and_create_via_api(client, db, settings):
    upload = client.post("/api/upload", files=pdf_upload("po.pdf", make_text_pdf()))
    po_id = upload.json()["id"]
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
    body = created.json()
    assert body["printed"] is True
    assert body["po"]["line_items"][0]["erp_status"] == "created"
    assert body["po"]["line_items"][0]["erp_job_number"] == "200001"

    again = client.post(f"/api/po/{po_id}/lines/{line_id}/create-job")
    assert again.status_code == 409


def test_delete_shopkeeper_job_via_api(client, db, settings):
    upload = client.post("/api/upload", files=pdf_upload("po.pdf", make_text_pdf()))
    po_id = upload.json()["id"]
    run_extraction(db, po_id, provider=FakeExtractionProvider(), settings=settings)
    detail = client.get(f"/api/po/{po_id}").json()
    line_id = detail["line_items"][0]["id"]
    client.post(f"/api/po/{po_id}/lines/{line_id}/resolve-customer", json={"customer_number": "BAYADV"})
    client.post(f"/api/po/{po_id}/lines/{line_id}/resolve-part", json={"part_number": "SUB-BEC-12352-0016", "part_revision": "A"})
    detail = client.get(f"/api/po/{po_id}").json()
    client.post(
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
    created = client.post(f"/api/po/{po_id}/lines/{line_id}/create-job")
    assert created.status_code == 200
    job = next(item for item in created.json()["po"]["line_items"] if item["id"] == line_id)["erp_job_number"]
    deleted = client.post(f"/api/po/{po_id}/lines/{line_id}/delete-shopkeeper-job")
    assert deleted.status_code == 200
    line = next(item for item in deleted.json()["line_items"] if item["id"] == line_id)
    assert line["erp_status"] == "ready"
    assert line["erp_job_number"] is None
    missing = client.get(f"/api/jobs/{job}")
    assert missing.status_code == 404
    gone = client.delete(f"/api/jobs/{job}")
    assert gone.status_code == 404


def _ready_all_lines(db, settings, fake):
    po, _ = _ready_line(db, settings, fake=fake)
    extra_parts = ["MULTI-REV"]
    extra_index = 0
    for line in po.line_items:
        if not line.resolved_part_number:
            resolve_part(db, po, line, extra_parts[extra_index], "A", fake)
            extra_index += 1
    db.commit()
    db.refresh(po)
    return po


def _create_all_jobs(db, po, fake):
    for line in po.line_items:
        create_job_for_line(db, po, line, fake)
    db.commit()
    db.refresh(po)
    return po


def _po_update(po, extra_lines: list[LineItemIn] | None = None) -> PoUpdate:
    items = [
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
    ]
    if extra_lines:
        items.extend(extra_lines)
    return PoUpdate(
        po_number=po.po_number,
        customer_name=po.customer_name,
        order_date=po.order_date,
        requested_ship_date=po.requested_ship_date,
        buyer_contact=po.buyer_contact,
        buyer_notes=po.buyer_notes,
        bill_to=po.bill_to,
        ship_to=po.ship_to,
        line_items=items,
    )


def test_create_shipper_for_two_created_jobs(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po = _create_all_jobs(db, _ready_all_lines(db, settings, fake), fake)
    assert len(po.line_items) == 2
    assert all(line.erp_status == "created" for line in po.line_items)

    from app.services.shopkeeper.writer import create_shipper_for_po

    po = create_shipper_for_po(db, po, fake, prepared_by="cr")
    db.commit()
    db.refresh(po)
    assert po.shipper_number == "500001"
    assert fake.reserved_ship_numbers == ["500001"]
    assert fake.shippers == [("500001", ["200001", "200002"])]
    assert fake.last_ship_payload is not None
    assert fake.last_ship_payload.ship_via == "UPS"
    assert fake.last_ship_payload.ship_by == "CR"
    assert [line.job_number for line in fake.last_ship_payload.lines] == ["200001", "200002"]
    assert [line.quantity for line in fake.last_ship_payload.lines] == [25, 10]
    assert all(line.erp_shipper_number == "500001" for line in po.line_items)
    assert to_summary(po).shipper_needs_attach is False
    audits = db.query(ErpWriteAudit).filter_by(po_id=po.id).all()
    assert {row.action for row in audits} >= {"attempt_shipper", "create_shipper"}


def test_create_shipper_second_click_is_idempotent(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po = _create_all_jobs(db, _ready_all_lines(db, settings, fake), fake)
    from app.services.shopkeeper.writer import create_shipper_for_po

    create_shipper_for_po(db, po, fake, prepared_by="CR")
    db.commit()
    db.refresh(po)
    po = create_shipper_for_po(db, po, fake)
    db.commit()
    db.refresh(po)
    assert po.shipper_number == "500001"
    assert fake.next_ship == 500002
    assert fake.shippers == [("500001", ["200001", "200002"])]


def test_added_line_inherits_customer_and_attaches_to_existing_shipper(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po = _create_all_jobs(db, _ready_all_lines(db, settings, fake), fake)
    from app.services.shopkeeper.writer import create_shipper_for_po

    po = create_shipper_for_po(db, po, fake, prepared_by="CR")
    db.commit()
    db.refresh(po)
    first = po.line_items[0]
    po = save_draft(
        db,
        po,
        _po_update(
            po,
            [
                LineItemIn(
                    line_number=3,
                    customer_part_number="4022.656.2799",
                    revision="A",
                    description="Missed page",
                    quantity=Decimal("5"),
                    unit_price=Decimal("12.00"),
                    uom="Each",
                    due_date=date.today(),
                )
            ],
        ),
    )
    added = next(item for item in po.line_items if item.line_number == 3)
    assert added.resolved_customer_code == first.resolved_customer_code
    assert added.cert_required == first.cert_required
    assert added.customer_credit_hold == first.customer_credit_hold
    assert added.credit_hold_acknowledged == first.credit_hold_acknowledged
    assert added.erp_status == "pending"

    resolve_part(db, po, added, "4022.656.2799", "A", fake)
    po = confirm_reviewed(db, po)
    added = next(item for item in po.line_items if item.line_number == 3)
    assert added.erp_status == "ready"
    create_job_for_line(db, po, added, fake)
    db.commit()
    db.refresh(po)
    added = next(item for item in po.line_items if item.line_number == 3)
    assert added.erp_shipper_number is None
    assert to_summary(po).shipper_needs_attach is True
    po = create_shipper_for_po(db, po, fake)
    db.commit()
    db.refresh(po)
    assert po.shipper_number == "500001"
    assert fake.next_ship == 500002
    assert fake.shippers == [("500001", ["200001", "200002", "200003"])]
    assert all(line.erp_shipper_number == "500001" for line in po.line_items)
    assert to_summary(po).shipper_needs_attach is False
    audits = db.query(ErpWriteAudit).filter_by(po_id=po.id, action="attach_shipper").all()
    assert len(audits) == 1


def test_create_shipper_rejects_incomplete_po(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po, line = _ready_line(db, settings, fake=fake)
    create_job_for_line(db, po, line, fake)
    db.commit()
    db.refresh(po)
    from app.services.shopkeeper.writer import create_shipper_for_po

    with pytest.raises(ConflictError, match="Every line must have a created"):
        create_shipper_for_po(db, po, fake)
    assert po.shipper_number is None
    assert fake.shippers == []


def test_create_shipper_recovers_after_commit_failure(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po = _create_all_jobs(db, _ready_all_lines(db, settings, fake), fake)
    from app.services.shopkeeper.writer import create_shipper_for_po

    fake.fail_after_commit = True
    po = create_shipper_for_po(db, po, fake, prepared_by="CR")
    db.commit()
    db.refresh(po)
    assert po.shipper_number == "500001"
    audits = db.query(ErpWriteAudit).filter_by(po_id=po.id, action="recover_shipper").all()
    assert len(audits) == 1


def test_create_shipper_via_api(client, db, settings):
    fake = FakeShopKeeper.reset_shared()
    po = _create_all_jobs(db, _ready_all_lines(db, settings, fake), fake)
    po_id = po.id
    missing = client.post(f"/api/po/{po_id}/create-shipper")
    assert missing.status_code == 400
    assert "Prepared by" in missing.json()["detail"]
    created = client.post(f"/api/po/{po_id}/create-shipper", json={"prepared_by": "CR"})
    assert created.status_code == 200
    assert created.json()["shipper_number"] == "500001"
    listed = client.get("/api/po").json()["items"]
    match = next(item for item in listed if item["id"] == po_id)
    assert match["shipper_number"] == "500001"
    assert match["shipper_needs_attach"] is False
    again = client.post(f"/api/po/{po_id}/create-shipper")
    assert again.status_code == 200
    assert again.json()["shipper_number"] == "500001"
    assert fake.next_ship == 500002


def test_normalize_prepared_by():
    from app.services.shopkeeper.writer import normalize_prepared_by

    assert normalize_prepared_by(" cr ") == "CR"
    assert normalize_prepared_by("j.d") == "J.D"
    assert normalize_prepared_by("") is None
    with pytest.raises(AppError, match="20 characters"):
        normalize_prepared_by("A" * 21)
    with pytest.raises(AppError, match="letters"):
        normalize_prepared_by("C/")


def test_format_ship_number_pads_when_format_is_zeros():
    from app.services.shopkeeper.sqlserver import _format_ship_number

    assert _format_ship_number(12, "S", "000000", None) == "S000012"
    assert _format_ship_number(12, None, None, None) == "12"
    assert _format_ship_number(12, "A", None, "X") == "A12X"


def test_shopkeeper_purchase_orders_lists_recent_jobs(client):
    FakeShopKeeper.reset_shared()
    response = client.get("/api/shopkeeper/purchase-orders")
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 4
    assert body["search_by"] == "po"
    assert [item["job_number"] for item in body["items"]] == ["199201", "199102", "199101", "198301"]
    assert body["items"][0]["po_number"] == "PO-8802"
    assert body["items"][0]["shipper_number"] == "S000012"
    assert body["items"][0]["status"] == "S"


def test_shopkeeper_purchase_orders_search_and_paging(client):
    FakeShopKeeper.reset_shared()
    by_job = client.get("/api/shopkeeper/purchase-orders", params={"q": "199102", "search_by": "job"})
    assert by_job.status_code == 200
    jobs = by_job.json()["items"]
    assert [item["job_number"] for item in jobs] == ["199102"]

    by_po = client.get("/api/shopkeeper/purchase-orders", params={"q": "PO-4501", "search_by": "po"})
    assert [item["job_number"] for item in by_po.json()["items"]] == ["199102", "199101"]

    by_part = client.get("/api/shopkeeper/purchase-orders", params={"q": "MULTI-REV", "search_by": "part"})
    assert [item["job_number"] for item in by_part.json()["items"]] == ["199201"]

    by_customer = client.get("/api/shopkeeper/purchase-orders", params={"q": "Bay", "search_by": "customer"})
    assert [item["job_number"] for item in by_customer.json()["items"]] == ["199102", "199101"]

    paged = client.get("/api/shopkeeper/purchase-orders", params={"page": 2, "page_size": 2})
    assert paged.status_code == 200
    body = paged.json()
    assert body["total"] == 4
    assert [item["job_number"] for item in body["items"]] == ["199101", "198301"]


def test_shopkeeper_shippers_lists_and_search(client):
    FakeShopKeeper.reset_shared()
    response = client.get("/api/shopkeeper/shippers")
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["search_by"] == "shipper"
    assert body["items"][0]["shipper_number"] == "S000012"
    assert body["items"][0]["job_count"] == 1
    assert body["items"][0]["po_numbers"] == "PO-8802"
    assert body["items"][0]["status"] == "S"

    by_job = client.get("/api/shopkeeper/shippers", params={"q": "199201", "search_by": "job"})
    assert [item["shipper_number"] for item in by_job.json()["items"]] == ["S000012"]

    by_po = client.get("/api/shopkeeper/shippers", params={"q": "PO-8802", "search_by": "po"})
    assert [item["shipper_number"] for item in by_po.json()["items"]] == ["S000012"]

    by_customer = client.get("/api/shopkeeper/shippers", params={"q": "Cortec", "search_by": "customer"})
    assert [item["shipper_number"] for item in by_customer.json()["items"]] == ["S000012"]

    missing = client.get("/api/shopkeeper/shippers", params={"q": "no-such", "search_by": "shipper"})
    assert missing.json()["items"] == []
    assert missing.json()["total"] == 0


def test_shopkeeper_shipper_detail(client):
    FakeShopKeeper.reset_shared()
    response = client.get("/api/shopkeeper/shippers/S000012")
    assert response.status_code == 200
    body = response.json()
    assert body["shipper_number"] == "S000012"
    assert body["customer_name"] == "Cortec"
    assert body["po_numbers"] == "PO-8802"
    assert [job["job_number"] for job in body["jobs"]] == ["199201"]
    missing = client.get("/api/shopkeeper/shippers/nope")
    assert missing.status_code == 404


def test_shopkeeper_purchase_orders_empty_search(client):
    FakeShopKeeper.reset_shared()
    response = client.get("/api/shopkeeper/purchase-orders", params={"q": "no-such-po", "search_by": "po"})
    assert response.status_code == 200
    body = response.json()
    assert body["items"] == []
    assert body["total"] == 0


def test_shopkeeper_po_groups_and_detail(client):
    FakeShopKeeper.reset_shared()
    grouped = client.get("/api/shopkeeper/purchase-order-groups")
    assert grouped.status_code == 200
    body = grouped.json()
    assert body["total"] == 3
    assert [item["po_number"] for item in body["items"]] == ["PO-8802", "PO-4501", "MDC-12"]
    bay = next(item for item in body["items"] if item["po_number"] == "PO-4501")
    assert bay["customer_code"] == "BAYADV"
    assert bay["job_count"] == 2
    assert bay["shipper_numbers"] is None

    by_job = client.get(
        "/api/shopkeeper/purchase-order-groups",
        params={"q": "199102", "search_by": "job"},
    )
    items = by_job.json()["items"]
    assert len(items) == 1
    assert items[0]["po_number"] == "PO-4501"
    assert items[0]["job_count"] == 2

    detail = client.get(
        "/api/shopkeeper/purchase-orders/detail",
        params={"customer_code": "BAYADV", "po": "PO-4501"},
    )
    assert detail.status_code == 200
    page = detail.json()
    assert page["customer_code"] == "BAYADV"
    assert page["job_count"] == 2
    assert [job["job_number"] for job in page["jobs"]] == ["199102", "199101"]

    missing = client.get(
        "/api/shopkeeper/purchase-orders/detail",
        params={"customer_code": "BAYADV", "po": "no-such"},
    )
    assert missing.status_code == 404
