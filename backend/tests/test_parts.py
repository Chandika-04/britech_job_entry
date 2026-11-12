import pytest

from app.exceptions import AppError, ConflictError
from app.schemas.operations import PartHeaderIn
from app.services.shopkeeper.fake import FakeShopKeeper
from app.services.shopkeeper.operations import create_part, get_part_editor, update_part_header


def test_list_parts_search(client):
    FakeShopKeeper.reset_shared()
    response = client.get("/api/parts")
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 6
    assert body["search_by"] == "part"
    assert body["items"][0]["pm_linkid"] == 106
    assert {row["part_number"] for row in body["items"]} >= {"SUB-BEC-12352-0016", "NO-OPS", "DEAD-PART"}

    by_part = client.get("/api/parts", params={"q": "MULTI", "search_by": "part"})
    assert [row["part_revision"] for row in by_part.json()["items"]] == ["B", "A"]

    by_customer = client.get("/api/parts", params={"q": "BAYADV", "search_by": "customer"})
    assert {row["part_number"] for row in by_customer.json()["items"]} == {"SUB-BEC-12352-0016", "4022.656.2799"}

    by_desc = client.get("/api/parts", params={"q": "housing", "search_by": "description"})
    assert [row["part_number"] for row in by_desc.json()["items"]] == ["SUB-BEC-12352-0016"]

    missing = client.get("/api/parts", params={"q": "no-such", "search_by": "part"})
    assert missing.json()["items"] == []
    assert missing.json()["total"] == 0

    both = client.get("/api/parts", params={"part": "MULTI", "customer": "CORTEC"})
    assert [row["part_revision"] for row in both.json()["items"]] == ["B", "A"]

    none = client.get("/api/parts", params={"part": "MULTI", "customer": "BAYADV"})
    assert none.json()["items"] == []


def test_create_and_update_part(client):
    FakeShopKeeper.reset_shared()
    created = client.post(
        "/api/parts",
        json={"part_number": "NEW-PART-1", "customer_code": "cortec", "description": ""},
    )
    assert created.status_code == 201
    body = created.json()
    assert body["part_number"] == "NEW-PART-1"
    assert body["part_revision"] == "-"
    assert body["customer_code"] == "CORTEC"
    assert body["description"] == "NEW-PART-1"
    assert body["operations"] == []
    pm_linkid = body["pm_linkid"]

    listed = client.get("/api/parts", params={"q": "NEW-PART-1", "search_by": "part"})
    assert listed.json()["items"][0]["pm_linkid"] == pm_linkid

    updated = client.put(
        f"/api/parts/{pm_linkid}",
        json={
            "part_number": "NEW-PART-1",
            "part_revision": "A",
            "customer_code": "MDC",
            "description": "Updated desc",
        },
    )
    assert updated.status_code == 200
    assert updated.json()["part_revision"] == "A"
    assert updated.json()["customer_code"] == "MDC"
    assert updated.json()["description"] == "Updated desc"


def test_create_part_rejects_duplicate_and_unknown_customer(client):
    FakeShopKeeper.reset_shared()
    duplicate = client.post(
        "/api/parts",
        json={"part_number": "MULTI-REV", "part_revision": "A", "customer_code": "CORTEC"},
    )
    assert duplicate.status_code == 409
    missing = client.post(
        "/api/parts",
        json={"part_number": "BRAND-NEW", "customer_code": "NOPE"},
    )
    assert missing.status_code == 400
    assert "customer" in missing.json()["detail"].lower()


def test_create_part_default_rev_and_header_conflict(db, settings):
    fake = FakeShopKeeper.reset_shared()
    part = create_part(PartHeaderIn(part_number="  BRITECH-TEST  ", customer_code="BAYADV"), fake)
    assert part.part_revision == "-"
    assert part.customer_code == "BAYADV"
    editor = get_part_editor(part.pm_linkid, fake)
    assert editor.customer_code == "BAYADV"
    updated = update_part_header(
        part.pm_linkid,
        PartHeaderIn(part_number="BRITECH-TEST", part_revision="B", customer_code="CORTEC", description="Lot"),
        fake,
    )
    assert updated.part_revision == "B"
    assert updated.description == "Lot"
    with pytest.raises(ConflictError, match="already exists"):
        create_part(PartHeaderIn(part_number="BRITECH-TEST", part_revision="B", customer_code="MDC"), fake)
    with pytest.raises(ConflictError, match="already exists"):
        update_part_header(
            part.pm_linkid,
            PartHeaderIn(part_number="MULTI-REV", part_revision="A", customer_code="CORTEC"),
            fake,
        )
    with pytest.raises(AppError, match="customer not found"):
        create_part(PartHeaderIn(part_number="X", customer_code="NOPE"), fake)


def test_copy_part_template_replaces_routing(client):
    FakeShopKeeper.reset_shared()
    response = client.post("/api/parts/101/copy-template", json={"template_id": 1})
    assert response.status_code == 200
    body = response.json()
    assert [row["seq_num"] for row in body] == [10, 20, 30]
    assert [row["wc_code"] for row in body] == ["MATL Check", "EP", "QC"]
    editor = client.get("/api/parts/101")
    assert [row["id"] for row in editor.json()["templates"]] == [1, 2]


def test_link_picture_uses_existing_partphotos_file(client, tmp_path, monkeypatch):
    from app.config import get_settings

    photos = tmp_path / "part-photos"
    photos.mkdir()
    chosen = photos / "housing.jpg"
    chosen.write_bytes(b"jpeg-bytes")
    nested = photos / "sub" / "deep.png"
    nested.parent.mkdir()
    nested.write_bytes(b"png-bytes")
    monkeypatch.setenv("PART_PHOTOS_DIR", str(photos))
    get_settings.cache_clear()
    FakeShopKeeper.reset_shared()

    linked = client.post("/api/parts/101/pictures", json={"filename": "housing.jpg"})
    assert linked.status_code == 200
    assert linked.json()["path"] == str(chosen)
    assert sorted(path.name for path in photos.iterdir()) == ["housing.jpg", "sub"]

    nested_linked = client.post("/api/parts/101/pictures", json={"filename": "deep.png"})
    assert nested_linked.status_code == 200
    assert nested_linked.json()["path"] == str(nested)

    missing = client.post("/api/parts/101/pictures", json={"filename": "missing.jpg"})
    assert missing.status_code == 409
    assert "not on the PartPhotos share" in missing.json()["detail"]


def test_copy_part_template_rejects_locked_and_unknown(client):
    fake = FakeShopKeeper.reset_shared()
    fake.locked_parts.add(101)
    locked = client.post("/api/parts/101/copy-template", json={"template_id": 1})
    assert locked.status_code == 409
    fake.locked_parts.clear()
    missing = client.post("/api/parts/101/copy-template", json={"template_id": 999})
    assert missing.status_code == 404
    empty = client.post("/api/parts/101/copy-template", json={"template_id": 2})
    assert empty.status_code == 409


def test_price_matrix_add_edit_delete(client):
    from datetime import date, timedelta
    from decimal import Decimal

    FakeShopKeeper.reset_shared()
    part = client.get("/api/parts/101").json()
    assert [(row["quantity"], Decimal(row["price"])) for row in part["price_matrix"]] == [(1, Decimal("10")), (10, Decimal("8.5"))]

    expires = (date.today() + timedelta(days=365)).isoformat()
    added = client.post(
        "/api/parts/101/prices",
        json={"quantity": 50, "price": "7.25", "expiration_date": expires, "note": " bulk "},
    )
    assert added.status_code == 201, added.text
    row = next(item for item in added.json()["price_matrix"] if item["quantity"] == 50)
    assert Decimal(row["price"]) == Decimal("7.25")
    assert row["expiration_date"] == expires
    assert row["last_date"] == date.today().isoformat()
    assert row["note"] == "bulk"
    assert row["expired"] is False

    # One current price per qty break.
    dup = client.post("/api/parts/101/prices", json={"quantity": 50, "price": "7.00"})
    assert dup.status_code == 409
    assert "Qty 50" in dup.json()["detail"]
    past = client.post("/api/parts/101/prices", json={"quantity": 75, "price": "7.00", "expiration_date": "2020-01-01"})
    assert past.status_code == 422

    edited = client.put(
        f"/api/parts/101/prices/{row['id']}",
        json={"quantity": 50, "price": "7.10", "expiration_date": None, "rowversion": row["rowversion"]},
    )
    assert edited.status_code == 200, edited.text
    row2 = next(item for item in edited.json()["price_matrix"] if item["quantity"] == 50)
    assert Decimal(row2["price"]) == Decimal("7.10")
    assert row2["expiration_date"] is None

    stale = client.put(
        f"/api/parts/101/prices/{row['id']}",
        json={"quantity": 50, "price": "6.00", "rowversion": row["rowversion"]},
    )
    assert stale.status_code == 409

    # Price lookup picks up the new 50-piece break.
    quotes = client.get(
        "/api/shopkeeper/prices",
        params={"customer_number": "BAYADV", "part_number": "SUB-BEC-12352-0016", "part_revision": "A", "quantity": 60},
    ).json()["quotes"]
    assert any(q["source"] == "matrix" and q["quantity"] == 50 for q in quotes)

    deleted = client.delete(f"/api/parts/101/prices/{row['id']}", params={"rowversion": row2["rowversion"]})
    assert deleted.status_code == 200
    assert all(item["quantity"] != 50 for item in deleted.json()["price_matrix"])


def test_price_matrix_refuses_locked_part_and_bad_qty(client):
    fake = FakeShopKeeper.reset_shared()
    fake.locked_parts.add(101)
    assert client.post("/api/parts/101/prices", json={"quantity": 5, "price": "1.00"}).status_code == 409
    assert client.post("/api/parts/102/prices", json={"quantity": 40000, "price": "1.00"}).status_code == 422


def test_part_preview_picture_by_id_and_by_number(client, tmp_path):
    fake = FakeShopKeeper.reset_shared()
    image = tmp_path / "part.png"
    image.write_bytes(b"\x89PNG\r\n\x1a\nfake")
    fake.add_part_picture(102, str(image), "sample")

    by_id = client.get("/api/parts/102/preview-picture")
    assert by_id.status_code == 200
    assert by_id.content.startswith(b"\x89PNG")
    assert "max-age" in by_id.headers["cache-control"]

    by_number = client.get("/api/parts/preview-picture", params={"part_number": "4022.656.2799", "part_revision": "A"})
    assert by_number.status_code == 200

    assert client.get("/api/parts/103/preview-picture").status_code == 404  # no picture linked
    assert client.get("/api/parts/preview-picture", params={"part_number": "NOPE"}).status_code == 404
