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
