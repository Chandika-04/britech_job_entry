from datetime import date
from decimal import Decimal

from tests.helpers import make_scanned_pdf, make_text_pdf, pdf_upload


def test_health(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_upload_valid_pdf(client):
    response = client.post("/api/upload", files=pdf_upload("po.pdf", make_text_pdf()))
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "pending"
    detail = client.get(f"/api/po/{body['id']}")
    assert detail.status_code == 200
    assert detail.json()["page_count"] == 1


def test_upload_invalid_file(client):
    response = client.post("/api/upload", files={"file": ("notes.txt", b"not a pdf", "text/plain")})
    assert response.status_code == 400
    assert "Unable to process this PDF." in response.json()["detail"]


def test_upload_oversized_file(client, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "max_upload_size_mb", 0)
    data = make_text_pdf()
    assert len(data) > 0
    response = client.post("/api/upload", files=pdf_upload("big.pdf", data))
    assert response.status_code == 400
    assert "maximum file size" in response.json()["detail"]


def test_upload_too_many_pages(client, monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "max_pdf_pages", 1)
    response = client.post("/api/upload", files=pdf_upload("multi.pdf", make_text_pdf(pages=2)))
    assert response.status_code == 400
    assert "maximum page count" in response.json()["detail"]


def test_upload_scanned_pdf(client):
    response = client.post("/api/upload", files=pdf_upload("scan.pdf", make_scanned_pdf()))
    assert response.status_code == 200
    po_id = response.json()["id"]
    attachment = client.get(f"/api/po/{po_id}/attachment")
    assert attachment.status_code == 200
    assert attachment.headers["content-type"].startswith("application/pdf")


def test_upload_digital_and_multipage(client):
    response = client.post(
        "/api/upload",
        files=pdf_upload("digital.pdf", make_text_pdf("Digital PO 55", pages=3)),
    )
    assert response.status_code == 200
    po_id = response.json()["id"]
    detail = client.get(f"/api/po/{po_id}").json()
    assert detail["page_count"] == 3
    page = client.get(f"/api/po/{po_id}/attachment/page/2")
    assert page.status_code == 200
    assert page.headers["content-type"] == "image/png"
    missing = client.get(f"/api/po/{po_id}/attachment/page/9")
    assert missing.status_code == 400


def test_list_search_sort_pagination(client, db):
    from app.models.po_request import PoRequest, PoStatus, ReviewState

    for index in range(3):
        db.add(
            PoRequest(
                po_number=f"PO-{index}",
                customer_name="Acme" if index < 2 else "Beta",
                status=PoStatus.extracted,
                review_state=ReviewState.unreviewed,
                warnings=[],
            )
        )
    db.commit()
    listed = client.get("/api/po", params={"q": "Acme", "sort": "po_number", "order": "asc", "page": 1, "page_size": 10})
    assert listed.status_code == 200
    body = listed.json()
    assert body["total"] == 2
    assert [item["po_number"] for item in body["items"]] == ["PO-0", "PO-1"]
