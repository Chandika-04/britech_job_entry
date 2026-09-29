from uuid import UUID

from app.models.customer_alias import CustomerAlias
from app.services.extraction.fake import FakeExtractionProvider
from app.services.extraction.pipeline import run_extraction
from app.services.po_service import create_from_upload, get_po
from app.services.shopkeeper.fake import FakeShopKeeper
from app.services.shopkeeper.matching import match_customer, normalize
from app.services.shopkeeper.types import CustomerRecord
from app.services.shopkeeper.writer import resolve_customer, suggest_customer
from tests.helpers import make_text_pdf, pdf_upload


def _customer(number: str, company: str, active: bool = True) -> CustomerRecord:
    return CustomerRecord(
        customer_number=number,
        company=company,
        record_type="Both",
        bill_to_customer_number=None,
        active=active,
        credit_hold=False,
        payment_terms=None,
        shipped_via=None,
        salesman=None,
        cert_default=False,
        taxable_default=False,
        tax_code=None,
    )


def _po(db, settings, customer_name: str | None):
    po = create_from_upload(db, filename="po.pdf", content_type="application/pdf", pdf_bytes=make_text_pdf())
    run_extraction(db, po.id, provider=FakeExtractionProvider(), settings=settings)
    po = get_po(db, po.id)
    po.customer_name = customer_name
    db.add(po)
    db.commit()
    return po


def test_normalize_strips_suffixes_punctuation_and_abbreviations():
    assert normalize("Acme Mfg. Co.") == "acme manufacturing"
    assert normalize("Smith & Sons, Inc.") == "smith and sons"
    assert normalize("O'Brien Machining LLC") == "obrien machining"
    assert normalize("MDC Vacuum Technologies") == "mdc vacuum technology"
    assert normalize("  ") == ""


def test_exact_normalized_match():
    customers = [_customer("ACME", "Acme Manufacturing Inc"), _customer("BAY", "Bay Advanced")]
    result = match_customer("ACME MFG, CO.", customers, {})
    assert result.status == "exact"
    assert result.customer.customer_number == "ACME"


def test_contains_match_on_short_customer_code():
    customers = [_customer("MDC", "MDC"), _customer("CORTEC", "Cortec")]
    result = match_customer("MDC Vacuum Technologies", customers, {})
    assert result.status == "contains"
    assert result.customer.customer_number == "MDC"


def test_contains_matches_customer_number_when_company_differs():
    customers = [_customer("MDC", "M.D.C. Holdings Group"), _customer("CORTEC", "Cortec")]
    result = match_customer("MDC Vacuum Technologies", customers, {})
    assert result.status == "contains"
    assert result.customer.customer_number == "MDC"


def test_multiple_contains_hits_are_candidates_not_preselected():
    customers = [_customer("MDC", "MDC"), _customer("VAC", "Vacuum Technology")]
    result = match_customer("MDC Vacuum Technologies", customers, {})
    assert result.status == "candidates"
    assert result.customer is None
    assert {c.customer_number for c in result.candidates} == {"MDC", "VAC"}


def test_word_containment_does_not_match_partial_words():
    customers = [_customer("CORTEC", "Cortec")]
    assert match_customer("Co", customers, {}).status == "none"
    assert match_customer("Cort", customers, {}).status == "none"


def test_inactive_customers_are_excluded():
    customers = [_customer("OLD", "MDC", active=False)]
    assert match_customer("MDC Vacuum Technologies", customers, {}).status == "none"


def test_alias_wins_and_inactive_alias_warns():
    customers = [_customer("MDC", "MDC"), _customer("OTHER", "Something Else", active=False)]
    key = normalize("MDC Vacuum Technologies")
    result = match_customer("MDC Vacuum Technologies", customers, {key: "MDC"})
    assert result.status == "alias"
    assert result.customer.customer_number == "MDC"

    result = match_customer("MDC Vacuum Technologies", customers, {key: "OTHER"})
    assert result.status == "contains"
    assert result.customer.customer_number == "MDC"
    assert "inactive" in (result.warning or "")


def test_suggestion_and_alias_saved_on_confirmation(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po = _po(db, settings, "MDC Vacuum Technologies")
    suggestion = suggest_customer(db, po, fake)
    assert suggestion["status"] == "contains"
    assert suggestion["customer"]["customer_number"] == "MDC"

    resolve_customer(db, po, po.line_items[0], "MDC", True, fake)
    db.commit()
    alias = db.query(CustomerAlias).one()
    assert alias.normalized_name == "mdc vacuum technology"
    assert alias.customer_number == "MDC"
    assert alias.source_name == "MDC Vacuum Technologies"

    again = _po(db, settings, "MDC VACUUM TECHNOLOGIES, INC.")
    suggestion = suggest_customer(db, again, fake)
    assert suggestion["status"] == "alias"
    assert suggestion["customer"]["customer_number"] == "MDC"


def test_alias_updates_when_reviewer_picks_a_different_customer(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po = _po(db, settings, "Bay Advanced Technologies")
    resolve_customer(db, po, po.line_items[0], "BAYADV", True, fake)
    db.commit()
    resolve_customer(db, po, po.line_items[0], "CORTEC", True, fake)
    db.commit()
    aliases = db.query(CustomerAlias).all()
    assert len(aliases) == 1
    assert aliases[0].customer_number == "CORTEC"


def test_ship_to_rows_are_never_suggested(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po = _po(db, settings, "Bay Advanced")
    suggestion = suggest_customer(db, po, fake)
    assert suggestion["status"] == "exact"
    assert suggestion["customer"]["customer_number"] == "BAYADV"


def test_customer_suggestion_api(client, db, settings):
    upload = client.post("/api/upload", files=pdf_upload("po.pdf", make_text_pdf()))
    po_id = UUID(upload.json()["id"])
    run_extraction(db, po_id, provider=FakeExtractionProvider(), settings=settings)
    response = client.get(f"/api/po/{po_id}/customer-suggestion")
    assert response.status_code == 200
    body = response.json()
    assert body["extracted_name"] == "Acme Manufacturing"
    assert body["status"] == "exact"
    assert body["customer"]["customer_number"] == "ACME"
