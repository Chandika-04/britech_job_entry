from datetime import date
from decimal import Decimal

from app.services.cert_templates import cert_html_to_text, cert_text_to_html
from app.services.materials import DEFAULT_MATERIALS
from app.services.shopkeeper.fake import FakeShopKeeper


def test_material_list_starts_with_defaults_and_can_be_added_hidden_and_reordered(client):
    listed = client.get("/api/settings/materials").json()
    assert [row["name"] for row in listed] == list(DEFAULT_MATERIALS)

    added = client.post("/api/settings/materials", json={"name": "  Titanium   Gr 2 "})
    assert added.status_code == 201
    assert added.json()[-1]["name"] == "Titanium Gr 2"
    assert client.post("/api/settings/materials", json={"name": "titanium gr 2"}).status_code == 409
    assert client.post("/api/settings/materials", json={"name": "x" * 41}).status_code == 422

    copper = next(row for row in added.json() if row["name"] == "Copper")
    hidden = client.put(f"/api/settings/materials/{copper['id']}", json={"active": False}).json()
    assert next(row for row in hidden if row["id"] == copper["id"])["active"] is False
    assert "Copper" not in [row["name"] for row in client.get("/api/settings/materials").json()]
    assert "Copper" in [row["name"] for row in client.get("/api/settings/materials", params={"include_hidden": True}).json()]
    # Hidden materials cannot be picked for a part any more.
    FakeShopKeeper.reset_shared()
    new_part = {"part_number": "CU-1", "customer_code": "CORTEC", "material": "Copper"}
    assert client.post("/api/parts", json=new_part).status_code == 422
    # Adding it again shows it again.
    assert client.post("/api/settings/materials", json={"name": "copper"}).status_code == 201
    assert client.post("/api/parts", json=new_part).status_code == 201

    ids = [row["id"] for row in client.get("/api/settings/materials", params={"include_hidden": True}).json()]
    reordered = client.put("/api/settings/materials/order", json={"ids": list(reversed(ids))}).json()
    assert [row["id"] for row in reordered] == list(reversed(ids))
    assert client.put("/api/settings/materials/order", json={"ids": ids[:-1]}).status_code == 409


def test_cert_text_round_trip_keeps_lines_and_spacing():
    html = '<div><font color="#2D2F2F">&nbsp;[ &nbsp;&nbsp;&nbsp;] &nbsp;&nbsp;CLEAN &nbsp;0250-70351</font></div>\r\n\r\n<div>&nbsp;</div>'
    text = cert_html_to_text(html)
    assert text == " [    ]   CLEAN  0250-70351"
    back = cert_text_to_html("Line one\n\n  [    ]  Line <3")
    assert back == "<div>Line one</div>\r\n<div>&nbsp;</div>\r\n<div>&nbsp;&nbsp;[&nbsp;&nbsp;&nbsp;&nbsp;]&nbsp;&nbsp;Line &lt;3</div>"
    assert cert_html_to_text(back) == "Line one\n\n  [    ]  Line <3"
    assert cert_html_to_text("[        ] 0250-62523  PASSIVATION") == "[        ] 0250-62523  PASSIVATION"


def test_cert_templates_can_be_listed_created_and_edited(client):
    fake = FakeShopKeeper.reset_shared()
    fake.part_certs[101] = ["EP B912-13"]
    linked = sum("EP B912-13" in certs for certs in fake.part_certs.values())
    listed = client.get("/api/settings/cert-templates").json()
    ep = next(row for row in listed if row["id"] == "EP B912-13")
    assert ep["text"] == "Electropolished per ASTM B912."
    assert ep["part_count"] == linked >= 1

    # Changing only the description keeps the stored HTML as it was.
    original_html = next(row for row in fake.cert_texts if row.id == "EP B912-13").text
    renamed = client.put(
        "/api/settings/cert-templates/EP B912-13",
        json={"description": "B912 EP", "text": ep["text"], "rowversion": ep["rowversion"]},
    )
    assert renamed.status_code == 200, renamed.text
    assert next(row for row in fake.cert_texts if row.id == "EP B912-13").text == original_html

    # A stale row version is refused.
    stale = client.put(
        "/api/settings/cert-templates/EP B912-13",
        json={"description": "x", "text": "y", "rowversion": ep["rowversion"]},
    )
    assert stale.status_code == 409

    fresh = next(row for row in renamed.json() if row["id"] == "EP B912-13")
    reworded = client.put(
        "/api/settings/cert-templates/EP B912-13",
        json={"description": "B912 EP", "text": "Electropolished per ASTM B912-13.\nLot traceable.", "rowversion": fresh["rowversion"]},
    ).json()
    assert next(row for row in reworded if row["id"] == "EP B912-13")["text"] == "Electropolished per ASTM B912-13.\nLot traceable."
    assert next(row for row in fake.cert_texts if row.id == "EP B912-13").text == (
        "<div>Electropolished per ASTM B912-13.</div>\r\n<div>Lot traceable.</div>"
    )

    created = client.post(
        "/api/settings/cert-templates", json={"id": "SEMI F19", "description": "SEMI F19", "text": "Per SEMI F19."}
    )
    assert created.status_code == 201
    assert any(row["id"] == "SEMI F19" for row in created.json())
    assert client.post("/api/settings/cert-templates", json={"id": "semi f19", "text": "dup"}).status_code == 409
    assert client.post("/api/settings/cert-templates", json={"id": "EMPTY", "text": "   "}).status_code == 422
    assert client.post("/api/settings/cert-templates", json={"id": "X" * 31, "text": "a"}).status_code == 422
    # The new template shows up in the part editor's certification dropdown.
    library = client.get("/api/parts/101").json()["cert_library"]
    assert "SEMI F19" in [row["id"] for row in library]


def test_traveler_prints_part_material_next_to_rev(client):
    import fitz

    from app.services.print.documents import build_traveler_pdf
    from app.services.shopkeeper.types import JobPageRecord, OperationRow, PrintDocumentData

    job = JobPageRecord(
        job_number="116345", customer_code="BAYADV", customer_name=None, po_number="PO-1", po_line="1",
        part_number="PART-1", part_revision="A", pm_linkid=1, description="Widget", quantity=7, unit="Each",
        unit_price=Decimal("12.50"), due_date=date(2026, 12, 25), cert_required=False, cert_linked=False,
        quality_hold=False, status="NA", shipper_number=None, traveler_printed=False,
        operations=[OperationRow(1, 10, "EP", "Electropolish", None)], material="316 SST",
    )
    doc = fitz.open(stream=build_traveler_pdf(PrintDocumentData(job=job, pictures=[], certs=[])), filetype="pdf")
    page = doc[0]
    rev = page.search_for("Rev:")[0]
    label = page.search_for("Material:")[0]
    value = page.search_for("316 SST")[0]
    doc.close()
    assert abs(label.y0 - rev.y0) < 2 and label.x0 > rev.x1  # same row, to the right of Rev
    assert value.x0 > label.x1
    assert value.height > label.height  # printed larger

    # The job page and part matching carry the part's material too.
    FakeShopKeeper.reset_shared()
    matches = client.get("/api/shopkeeper/parts", params={"part_number": "SUB-BEC"}).json()["matches"]
    assert matches[0]["material"] == "316 SST"
