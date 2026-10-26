from datetime import date
from decimal import Decimal

import pytest

from app.exceptions import AppError, ConflictError
from app.models.po_request import ReviewState
from app.schemas.operations import JobHeaderIn, OperationIn, OperationsSaveIn
from app.schemas.po import LineItemIn, PoUpdate
from app.services.po_service import save_draft
from app.services.shopkeeper.writer import resolve_part
from app.services.shopkeeper.ops_util import note_plain_text, note_to_shopkeeper_html
from app.services.shopkeeper.fake import FakeShopKeeper
from app.services.shopkeeper.operations import (
    certification_pdf,
    copy_part_instructions,
    copy_template,
    create_job_and_print,
    get_job_page,
    get_part_editor,
    link_cert,
    mark_traveler_printed,
    print_job,
    save_job_header,
    save_job_operations,
    save_part_operations,
    set_quality_hold,
    traveler_pdf,
    unlink_cert,
)
from tests.test_shopkeeper import _ready_line


def test_create_copies_ops_and_prints_when_cert_ok(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po, line = _ready_line(db, settings, customer="BAYADV", fake=fake)
    line, result = create_job_and_print(db, po, line, fake)
    db.commit()
    assert result.printed is True
    assert result.missing_ops is False
    assert result.missing_cert is False
    assert fake.job_op_count(line.erp_job_number) == 4
    assert line.erp_traveler_printed is False
    pdf = traveler_pdf(line.erp_job_number, fake)
    cert = certification_pdf(line.erp_job_number, fake)
    mark_traveler_printed(db, line.erp_job_number, fake)
    db.commit()
    db.refresh(line)
    assert line.erp_traveler_printed is True
    assert pdf.startswith(b"%PDF")
    assert cert.startswith(b"%PDF")
    assert line.erp_job_number in fake.traveler_printed
    import fitz

    traveler_doc = fitz.open(stream=pdf, filetype="pdf")
    traveler_text = "".join(page.get_text() for page in traveler_doc)
    assert traveler_doc.page_count % 2 == 0
    traveler_doc.close()
    cert_doc = fitz.open(stream=cert, filetype="pdf")
    cert_text = "".join(page.get_text() for page in cert_doc)
    cert_doc.close()
    assert "Job Traveler" in traveler_text
    assert "CERTIFICATION OF" not in traveler_text
    assert "CERTIFICATION OF" in cert_text
    page = get_job_page(db, line.erp_job_number, fake)
    assert page.pictures == []
    assert page.pm_linkid is not None
    fake.add_part_picture(page.pm_linkid, r"\\server\PartPhotos\part.jpg", "sample")
    page = get_job_page(db, line.erp_job_number, fake)
    assert len(page.pictures) == 1
    assert page.pictures[0].path == r"\\server\PartPhotos\part.jpg"


def test_create_empty_ops_skips_print(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po, line = _ready_line(db, settings, customer="CORTEC", part="NO-OPS", rev="A", fake=fake)
    line, result = create_job_and_print(db, po, line, fake)
    assert result.printed is False
    assert result.missing_ops is True
    assert result.missing_cert is False
    assert fake.job_op_count(line.erp_job_number) == 0
    assert line.erp_traveler_printed is False
    assert line.erp_job_number is not None


def test_create_missing_cert_skips_print(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po, line = _ready_line(db, settings, customer="BAYADV", part="4022.656.2799", rev="A", fake=fake)
    line, result = create_job_and_print(db, po, line, fake)
    assert result.printed is False
    assert result.missing_ops is False
    assert result.missing_cert is True
    assert fake.job_op_count(line.erp_job_number) == 2
    assert line.erp_traveler_printed is False


def test_create_both_missing_goes_to_job_first(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po, line = _ready_line(db, settings, customer="BAYADV", part="NO-OPS", rev="A", fake=fake)
    _, result = create_job_and_print(db, po, line, fake)
    assert result.missing_ops is True
    assert result.missing_cert is True
    assert result.printed is False


def test_operation_notes_are_plain_on_screens_and_html_in_shopkeeper(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po, line = _ready_line(db, settings, customer="CORTEC", part="NO-OPS", rev="A", fake=fake)
    line, _ = create_job_and_print(db, po, line, fake)
    ops = copy_template(line.erp_job_number, 1, fake)
    ep = next(row for row in ops if row.wc_code == "EP")
    assert ep.note == "EP bath"
    stored = next(row for row in fake.job_ops[line.erp_job_number] if row.wc_code == "EP")
    assert "<div>" in (stored.note or "")
    saved = save_job_operations(
        line.erp_job_number,
        OperationsSaveIn(
            operations=[OperationIn(seq_num=10, wc_code="EP", description="EP", note="rinse twice\nthen dry")]
        ),
        fake,
    )
    assert saved[0].note == "rinse twice\nthen dry"
    html = fake.job_ops[line.erp_job_number][0].note or ""
    assert "<div" in html
    assert "rinse twice<br>then dry" in html
    page = get_job_page(db, line.erp_job_number, fake)
    assert page.operations[0].note == "rinse twice\nthen dry"


def test_note_html_roundtrip():
    html = note_to_shopkeeper_html("line one\nline two")
    assert html is not None
    assert "<div" in html
    assert note_plain_text(html) == "line one\nline two"
    assert note_plain_text('<div><font color="#FF0000">EP bath</font></div>') == "EP bath"


def test_copy_instructions_from_part_master(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po, line = _ready_line(db, settings, customer="BAYADV", fake=fake)
    line, _ = create_job_and_print(db, po, line, fake)
    save_job_operations(
        line.erp_job_number,
        OperationsSaveIn(operations=[OperationIn(seq_num=10, wc_code="EP", description="EP only")]),
        fake,
    )
    assert fake.job_op_count(line.erp_job_number) == 1
    ops = copy_part_instructions(line.erp_job_number, fake)
    assert [row.wc_code for row in ops] == ["MATL Check", "EP", "Rinse", "QC"]


def test_copy_instructions_errors_when_part_has_no_ops(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po, line = _ready_line(db, settings, customer="CORTEC", part="NO-OPS", rev="A", fake=fake)
    line, _ = create_job_and_print(db, po, line, fake)
    assert fake.job_op_count(line.erp_job_number) == 0
    with pytest.raises(AppError, match="no operations on the part master"):
        copy_part_instructions(line.erp_job_number, fake)


def test_job_page_template_replace(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po, line = _ready_line(db, settings, customer="CORTEC", part="NO-OPS", rev="A", fake=fake)
    line, _ = create_job_and_print(db, po, line, fake)
    page = get_job_page(db, line.erp_job_number, fake)
    assert page.missing_ops is True
    ops = copy_template(line.erp_job_number, 1, fake)
    assert len(ops) == 3
    empty = copy_template(line.erp_job_number, 2, fake)
    assert len(empty) == 3
    saved = save_job_operations(
        line.erp_job_number,
        OperationsSaveIn(operations=[OperationIn(seq_num=10, wc_code="EP", description="EP only")]),
        fake,
    )
    assert len(saved) == 1
    pdf = print_job(db, line.erp_job_number, fake)
    assert pdf.startswith(b"%PDF")
    assert line.erp_job_number in fake.traveler_printed


def test_job_page_loads_part_picture_and_cert_without_stored_link(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po, line = _ready_line(db, settings, customer="BAYADV", fake=fake)
    line, result = create_job_and_print(db, po, line, fake)
    job_number = line.erp_job_number
    assert job_number is not None
    fake.add_part_picture(101, r"\\server\PartPhotos\part.jpg", "sample")
    fake.job_details[job_number].pm_linkid = None
    page = get_job_page(db, job_number, fake)
    assert page.pm_linkid == 101
    assert page.cert_linked is True
    assert page.missing_cert is False
    assert len(page.pictures) == 1
    assert page.pictures[0].path == r"\\server\PartPhotos\part.jpg"


def test_part_editor_does_not_rewrite_existing_job(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po, line = _ready_line(db, settings, customer="CORTEC", fake=fake)
    line, _ = create_job_and_print(db, po, line, fake)
    before = fake.job_op_count(line.erp_job_number)
    save_part_operations(
        101,
        OperationsSaveIn(operations=[OperationIn(seq_num=10, wc_code="QC", description="QC only")]),
        fake,
    )
    assert fake.job_op_count(line.erp_job_number) == before
    part = get_part_editor(101, fake)
    assert part.customer_code == "BAYADV"
    assert len(part.operations) == 1
    set_quality_hold(101, True, "check", fake)
    part = get_part_editor(101, fake)
    assert part.quality_hold is True
    unlink_cert(101, "EP B912-13", fake)
    assert fake.part_has_certification(101) is False
    link_cert(101, "EP B912-13", fake)
    assert fake.part_has_certification(101) is True


def test_save_job_header_updates_price_and_cert(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po, line = _ready_line(db, settings, customer="BAYADV", fake=fake)
    line, _ = create_job_and_print(db, po, line, fake)
    page = save_job_header(
        db,
        line.erp_job_number,
        JobHeaderIn(
            customer_code="CORTEC",
            po_number="PO-EDIT",
            po_line="2",
            part_number="SUB-BEC-12352-0016",
            part_revision="A",
            description="Edited desc",
            quantity=7,
            unit="Each",
            unit_price=Decimal("12.50"),
            order_date=date(2026, 10, 1),
            notes="Rush this lot",
            cert_required=True,
        ),
        fake,
    )
    assert page.customer_code == "CORTEC"
    assert page.po_number == "PO-EDIT"
    assert page.po_line == "2"
    assert page.quantity == 7
    assert page.unit_price == Decimal("12.50")
    assert page.order_date == date(2026, 10, 1)
    assert page.notes == "Rush this lot"
    assert page.cert_required is True
    db.expire(line)
    assert Decimal(str(line.unit_price)) == Decimal("12.50")
    assert line.cert_required is True
    with pytest.raises(AppError, match="customer not found"):
        save_job_header(
            db,
            line.erp_job_number,
            JobHeaderIn(
                customer_code="NOPE",
                po_number="PO-EDIT",
                po_line="2",
                part_number="SUB-BEC-12352-0016",
                part_revision="A",
                description="Edited desc",
                quantity=7,
                unit="Each",
                unit_price=Decimal("12.50"),
                order_date=date(2026, 10, 1),
                notes="Rush this lot",
                cert_required=True,
            ),
            fake,
        )


def test_save_job_header_updates_shipper_quantity(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po, line = _ready_line(db, settings, customer="BAYADV", fake=fake)
    line, _ = create_job_and_print(db, po, line, fake)
    job_number = line.erp_job_number
    detail = fake.job_details[job_number]
    original_qty = detail.quantity
    fake.job_to_ship[job_number] = "500001"
    fake.ship_qty[job_number] = original_qty
    page = save_job_header(
        db,
        job_number,
        JobHeaderIn(
            customer_code=detail.customer_code,
            po_number=detail.po_number,
            po_line=detail.po_line,
            part_number=detail.part_number,
            part_revision=detail.part_revision,
            description=detail.description,
            quantity=original_qty + 5,
            unit=detail.unit or "Each",
            unit_price=detail.unit_price,
            order_date=detail.order_date or date.today(),
            notes=detail.notes,
            cert_required=detail.cert_required,
        ),
        fake,
    )
    assert page.quantity == original_qty + 5
    assert fake.ship_qty[job_number] == original_qty + 5


def test_traveler_pdf_includes_job_notes():
    import fitz

    from app.services.print.documents import build_traveler_pdf
    from app.services.shopkeeper.types import JobPageRecord, PrintDocumentData

    job = JobPageRecord(
        job_number="116345",
        customer_code="BAYADV",
        customer_name="Bay Advanced",
        po_number="PO-1",
        po_line="1",
        part_number="PART-1",
        part_revision="A",
        pm_linkid=1,
        description="Widget",
        quantity=7,
        unit="Each",
        unit_price=Decimal("12.50"),
        due_date=date(2026, 10, 9),
        cert_required=False,
        cert_linked=False,
        quality_hold=False,
        status="NA",
        shipper_number="74567",
        traveler_printed=False,
        operations=[],
        order_date=date(2026, 10, 1),
        notes="Hold for customer pickup",
    )
    pdf = build_traveler_pdf(PrintDocumentData(job=job, pictures=[], certs=[]))
    doc = fitz.open(stream=pdf, filetype="pdf")
    text = "".join(page.get_text() for page in doc)
    assert doc.page_count % 2 == 0
    doc.close()
    assert "Job Traveler" in text
    assert "SK066 Rev C" in text
    assert "Hold for customer pickup" in text
    assert "10/1/26" in text
    assert "Make To Order" in text
    assert "BAYADV" in text


def test_traveler_pdf_skips_unreadable_part_picture(monkeypatch):
    from pathlib import Path

    from app.services.print.documents import build_traveler_pdf
    from app.services.shopkeeper.types import JobPageRecord, PartPicture, PrintDocumentData

    def boom(self):
        raise OSError(1326, "The user name or password is incorrect", str(self))

    monkeypatch.setattr(Path, "exists", boom)
    job = JobPageRecord(
        job_number="116345",
        customer_code="BAYADV",
        customer_name="Bay Advanced",
        po_number="PO-1",
        po_line="1",
        part_number="PART-1",
        part_revision="A",
        pm_linkid=1,
        description="Widget",
        quantity=7,
        unit="Each",
        unit_price=Decimal("12.50"),
        due_date=date(2026, 10, 9),
        cert_required=False,
        cert_linked=False,
        quality_hold=False,
        status="NA",
        shipper_number="74567",
        traveler_printed=False,
        operations=[],
        order_date=date(2026, 10, 1),
        notes="Hold for customer pickup",
    )
    pdf = build_traveler_pdf(
        PrintDocumentData(
            job=job,
            pictures=[PartPicture(id=1, path=r"\\DISKSTATION\PartPhotos\part.jpg")],
            certs=[],
        )
    )
    assert pdf.startswith(b"%PDF")


def test_traveler_pdf_uses_customer_code_and_blank_op_dates():
    import fitz

    from app.services.print.documents import build_traveler_pdf
    from app.services.shopkeeper.types import JobPageRecord, OperationRow, PrintDocumentData

    job = JobPageRecord(
        job_number="116345",
        customer_code="BAYADV",
        customer_name="Bay Advanced Technologies Inc",
        po_number="PO-1",
        po_line="1",
        part_number="PART-1",
        part_revision="A",
        pm_linkid=1,
        description="Widget",
        quantity=7,
        unit="Each",
        unit_price=Decimal("12.50"),
        due_date=date(2026, 12, 25),
        cert_required=False,
        cert_linked=False,
        quality_hold=False,
        status="NA",
        shipper_number="74567",
        traveler_printed=False,
        operations=[OperationRow(1, 10, "EP", "Electropolish", "EP bath")],
        order_date=date(2026, 10, 1),
        notes=None,
    )
    pdf = build_traveler_pdf(PrintDocumentData(job=job, pictures=[], certs=[]))
    doc = fitz.open(stream=pdf, filetype="pdf")
    text = "".join(page.get_text() for page in doc)
    font_names = " ".join(row[3] for row in doc[0].get_fonts()).lower()
    doc.close()
    assert "BAYADV" in text
    assert "Bay Advanced Technologies Inc" not in text
    assert text.count("12/25/26") == 3
    assert "Electropolish" in text
    assert "Total Shipped" not in text
    assert "Balance" not in text
    assert "arial" in font_names


def test_certification_pdf_matches_shopkeeper_form():
    import fitz

    from app.services.print.documents import build_certification_pdf
    from app.services.shopkeeper.types import CertText, CustomerRecord, JobPageRecord, PrintDocumentData

    job = JobPageRecord(
        job_number="116148",
        customer_code="APILLIS",
        customer_name="APILLIS",
        po_number="1261001003",
        po_line="1",
        part_number="2423725",
        part_revision="-",
        pm_linkid=1,
        description="EXTENSION-SHUTTER-EIES",
        quantity=7,
        unit="Lot",
        unit_price=Decimal("1.00"),
        due_date=date(2026, 10, 2),
        cert_required=True,
        cert_linked=True,
        quality_hold=False,
        status="NA",
        shipper_number=None,
        traveler_printed=False,
        operations=[],
        order_date=date(2026, 10, 1),
    )
    customer = CustomerRecord(
        customer_number="APILLIS",
        company="APILLIS",
        record_type="Bill To",
        bill_to_customer_number=None,
        active=True,
        credit_hold=False,
        payment_terms=None,
        shipped_via=None,
        salesman=None,
        cert_default=True,
        taxable_default=False,
        tax_code=None,
        street="38875 Cherry St",
        city="Newark",
        state="CA",
        postal_code="94560",
    )
    pdf = build_certification_pdf(
        PrintDocumentData(
            job=job,
            pictures=[],
            certs=[
                CertText(
                    "EP B912-13",
                    "Short title not for print",
                    "<div>Electropolished per ASTM B912.</div>",
                )
            ],
            customer=customer,
            ship_to=customer,
        )
    )
    doc = fitz.open(stream=pdf, filetype="pdf")
    text = "".join(page.get_text() for page in doc)
    doc.close()
    assert "CERTIFICATION OF" in text
    assert "CONFORMANCE" in text
    assert "SK064 Rev B" in text
    assert "SHIPPED TO:" in text
    assert "APILLIS" in text
    assert "38875 Cherry St" in text
    assert "Electropolished per ASTM B912." in text
    assert "Short title not for print" not in text
    assert "Customer Copy" in text


def _line_payload(line, **updates) -> LineItemIn:
    data = dict(
        id=line.id,
        line_number=line.line_number,
        customer_part_number=line.customer_part_number,
        revision=line.revision,
        description=line.description,
        quantity=line.quantity,
        unit_price=line.unit_price,
        uom=line.uom,
        due_date=line.due_date,
        notes=line.notes,
    )
    data.update(updates)
    return LineItemIn(**data)


def _po_payload(po, line_items) -> PoUpdate:
    return PoUpdate(
        po_number=po.po_number,
        customer_name=po.customer_name,
        order_date=po.order_date,
        requested_ship_date=po.requested_ship_date,
        buyer_contact=po.buyer_contact,
        buyer_notes=po.buyer_notes,
        bill_to=po.bill_to,
        ship_to=po.ship_to,
        line_items=line_items,
    )


def test_save_draft_updates_created_job_and_stays_confirmed(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po, line = _ready_line(db, settings, customer="BAYADV", fake=fake)
    line, _ = create_job_and_print(db, po, line, fake)
    job_number = line.erp_job_number
    original_qty = fake.job_details[job_number].quantity
    payload = _po_payload(
        po,
        [
            _line_payload(item, quantity=Decimal(original_qty + 4) if item.id == line.id else item.quantity)
            for item in po.line_items
        ],
    )
    po = save_draft(db, po, payload)
    assert po.review_state == ReviewState.confirmed
    assert po.line_items[0].quantity == Decimal(original_qty + 4)
    assert fake.job_details[job_number].quantity == original_qty + 4


def test_resolve_part_updates_created_job(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po, line = _ready_line(db, settings, customer="BAYADV", fake=fake)
    line, _ = create_job_and_print(db, po, line, fake)
    resolve_part(db, po, line, "4022.656.2799", "A", fake)
    assert line.resolved_part_number == "4022.656.2799"
    assert fake.job_details[line.erp_job_number].part_number == "4022.656.2799"


def test_resolve_part_refuses_creating_line(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po, line = _ready_line(db, settings, customer="BAYADV", fake=fake)
    line.erp_status = "creating"
    with pytest.raises(ConflictError, match="in progress"):
        resolve_part(db, po, line, "4022.656.2799", "A", fake)
