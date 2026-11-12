from datetime import date
from decimal import Decimal

import pytest

from app.exceptions import ConflictError
from app.models.po_request import PoSource, PoStatus, ReviewState
from app.services.po_service import confirm_reviewed, create_manual, queue_reextract
from app.services.shopkeeper.fake import FakeShopKeeper
from app.services.shopkeeper.writer import create_job_for_line, lookup_prices, resolve_customer, resolve_part


def test_create_manual_starts_extracted_with_one_line(db, settings):
    po = create_manual(db)
    assert po.source == PoSource.manual
    assert po.status == PoStatus.extracted
    assert po.review_state == ReviewState.unreviewed
    assert po.attachment is None
    assert len(po.line_items) == 1
    assert po.line_items[0].line_number == 1
    assert po.line_items[0].uom == "Each"
    assert po.line_items[0].due_date == po.order_date


def test_manual_po_can_confirm_and_create_job(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po = create_manual(db)
    line = po.line_items[0]
    po.po_number = "M-1001"
    po.customer_name = "Bay Advanced"
    line.customer_part_number = "SUB-BEC-12352-0016"
    line.revision = "A"
    line.quantity = Decimal("10")
    line.unit_price = Decimal("9.25")
    db.add(po)
    db.commit()
    resolve_customer(db, po, line, "BAYADV", True, fake)
    resolve_part(db, po, line, "SUB-BEC-12352-0016", "A", fake)
    po = confirm_reviewed(db, po)
    assert po.review_state == ReviewState.confirmed
    line = create_job_for_line(db, po, po.line_items[0], fake)
    assert line.erp_status == "created"
    assert line.erp_job_number == "200001"


def test_manual_resolve_customer_fills_header_addresses(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po = create_manual(db)
    resolve_customer(db, po, po.line_items[0], "BAYADV", True, fake)
    assert po.customer_name == "Bay Advanced"
    assert po.bill_to == "Bay Advanced\n1200 Industrial Pkwy\nFremont, CA 94538"
    assert po.ship_to == "Bay Advanced\nDock 4\nFremont, CA 94538"


def test_manual_resolve_part_fills_line_fields(db, settings):
    fake = FakeShopKeeper.reset_shared()
    po = create_manual(db)
    line = resolve_part(db, po, po.line_items[0], "SUB-BEC-12352-0016", "A", fake)
    assert line.customer_part_number == "SUB-BEC-12352-0016"
    assert line.revision == "A"
    assert line.description == "Test housing"


def test_manual_cannot_reextract(db, settings):
    po = create_manual(db)
    with pytest.raises(ConflictError, match="Manual entries have no PDF"):
        queue_reextract(db, po)


def test_manual_api_create_and_list(client):
    created = client.post("/api/po/manual")
    assert created.status_code == 200
    body = created.json()
    assert body["source"] == "manual"
    assert body["status"] == "extracted"
    assert len(body["line_items"]) == 1
    listed = client.get("/api/po").json()
    assert listed["items"][0]["id"] == body["id"]
    assert listed["items"][0]["source"] == "manual"


def test_manual_api_create_with_draft(client):
    created = client.post(
        "/api/po/manual",
        json={
            "po_number": "M-SAVE",
            "customer_name": "Bay Advanced",
            "order_date": "2026-10-05",
            "line_items": [
                {
                    "line_number": 1,
                    "customer_part_number": "ABC",
                    "revision": "A",
                    "quantity": "2",
                    "unit_price": "1.50",
                    "uom": "Each",
                    "due_date": "2026-10-05",
                }
            ],
        },
    )
    assert created.status_code == 200
    body = created.json()
    assert body["po_number"] == "M-SAVE"
    assert body["customer_name"] == "Bay Advanced"
    assert body["line_items"][0]["customer_part_number"] == "ABC"
    listed = client.get("/api/po").json()
    assert listed["items"][0]["po_number"] == "M-SAVE"


def test_matrix_price_carries_its_expiry_date(client):
    fake = FakeShopKeeper.reset_shared()
    expires = date.today().replace(year=date.today().year + 1)
    fake.matrix_prices[1]["expires"] = expires
    params = {"customer_number": "BAYADV", "part_number": "SUB-BEC-12352-0016", "part_revision": "A", "quantity": 10}
    quotes = client.get("/api/shopkeeper/prices", params=params).json()["quotes"]
    matrix = next(row for row in quotes if row["source"] == "matrix")
    assert matrix["expires"] == expires.isoformat()
    suggested = client.get("/api/shopkeeper/prices/suggest", params=params).json()
    assert suggested["source"] == "matrix"
    assert suggested["expires"] == expires.isoformat()


def test_price_lookup_returns_contract_matrix_and_history(client):
    FakeShopKeeper.reset_shared()
    response = client.get(
        "/api/shopkeeper/prices",
        params={
            "customer_number": "BAYADV",
            "part_number": "SUB-BEC-12352-0016",
            "part_revision": "A",
            "quantity": 10,
        },
    )
    assert response.status_code == 200
    quotes = response.json()["quotes"]
    sources = [row["source"] for row in quotes]
    assert "contract" in sources
    assert "matrix" in sources
    assert "history" in sources
    assert "proposal" in sources
    contract = next(row for row in quotes if row["source"] == "contract")
    assert Decimal(str(contract["unit_price"])) == Decimal("9.25")
    matrix = next(row for row in quotes if row["source"] == "matrix")
    assert matrix["quantity"] == 10
    assert Decimal(str(matrix["unit_price"])) == Decimal("8.50")
    assert matrix["expires"] is None
    proposal = next(row for row in quotes if row["source"] == "proposal")
    assert proposal["job_number"] == "P1001"
    assert proposal["order_date"] == "2026-07-02"
    assert Decimal(str(proposal["unit_price"])) == Decimal("9.40")
    history = [row for row in quotes if row["source"] in {"history", "proposal"}]
    dates = [row["order_date"] for row in history]
    assert dates == sorted(dates, reverse=True)
    history_jobs = [row["job_number"] for row in quotes if row["source"] == "history"]
    assert "199101" in history_jobs
    assert "198883" in history_jobs


def test_lookup_prices_helper_filters_by_customer_part():
    fake = FakeShopKeeper()
    quotes = lookup_prices("BAYADV", "SUB-BEC-12352-0016", "A", 10, fake)
    assert any(row.source == "history" and row.job_number == "199101" for row in quotes)
    assert any(row.source == "history" and row.job_number == "198883" for row in quotes)
    assert any(row.source == "proposal" and row.job_number == "P1001" and row.order_date == date(2026, 7, 2) for row in quotes)
    assert not any(row.job_number == "198301" for row in quotes)


def test_pick_matrix_break_uses_next_break_up():
    from app.services.shopkeeper.lookup import pick_matrix_break

    breaks = [(10, "p10"), (1, "p1"), (5, "p5")]
    picked = {qty: pick_matrix_break(breaks, qty)[1] for qty in (1, 2, 5, 6, 10, 11, 500)}
    assert picked == {1: "p1", 2: "p5", 5: "p5", 6: "p10", 10: "p10", 11: "p10", 500: "p10"}
    assert pick_matrix_break([], 3) is None


def test_price_suggestion_matrix_then_last_job_price(client):
    from datetime import date

    fake = FakeShopKeeper.reset_shared()
    url = "/api/shopkeeper/prices/suggest"
    base = {"customer_number": "BAYADV", "part_number": "SUB-BEC-12352-0016", "part_revision": "A"}

    # Matrix breaks for part 101 are qty 1 ($10.00) and qty 10 ($8.50).
    assert Decimal(client.get(url, params={**base, "quantity": 1}).json()["unit_price"]) == Decimal("10.00")
    six = client.get(url, params={**base, "quantity": 6}).json()
    assert (six["source"], six["quantity"], Decimal(six["unit_price"])) == ("matrix", 10, Decimal("8.50"))
    assert Decimal(client.get(url, params={**base, "quantity": 40}).json()["unit_price"]) == Decimal("8.50")

    # Expired matrix rows are skipped; with none left, fall back to the newest job price for this customer.
    for row in fake.matrix_prices:
        row["expires"] = date(2020, 1, 1)
    history = client.get(url, params={**base, "quantity": 6}).json()
    assert history["source"] == "history"
    assert history["job_number"] == "199101"
    assert Decimal(history["unit_price"]) == Decimal("9.10")

    # No matrix and no job history: nothing to fill.
    none = client.get(url, params={"customer_number": "CORTEC", "part_number": "NO-OPS", "part_revision": "A", "quantity": 3})
    assert none.status_code == 200
    assert none.json() is None
