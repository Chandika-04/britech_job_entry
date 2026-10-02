from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.exceptions import NotFoundError, PdfValidationError
from app.models.po_request import PoStatus, ReviewState
from app.schemas.po import MessageResponse, PoDetail, PoListResponse, PoUpdate, ReviewAction, UploadResponse
from app.services.pdf.processor import open_pdf, render_page_png
from app.services.po_service import (
    confirm_reviewed,
    delete_po,
    get_po,
    list_pos,
    queue_reextract,
    save_draft,
    to_detail,
    to_summary,
)
from app.services.storage.pdf_storage import pdf_storage

router = APIRouter(prefix="/po", tags=["po"])


@router.get("", response_model=PoListResponse)
def list_purchase_orders(
    q: str | None = None,
    status: PoStatus | None = None,
    review_state: ReviewState | None = None,
    sort: str = Query("created_at"),
    order: str = Query("desc"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> PoListResponse:
    items, total = list_pos(
        db,
        q=q,
        status=status,
        review_state=review_state,
        sort=sort,
        order=order,
        page=page,
        page_size=page_size,
    )
    return PoListResponse(
        items=[to_summary(item) for item in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{po_id}", response_model=PoDetail)
def get_purchase_order(po_id: int, db: Session = Depends(get_db)) -> PoDetail:
    return to_detail(get_po(db, po_id))


@router.put("/{po_id}", response_model=PoDetail)
def update_purchase_order(po_id: int, payload: PoUpdate, db: Session = Depends(get_db)) -> PoDetail:
    po = get_po(db, po_id)
    return to_detail(save_draft(db, po, payload))


@router.post("/{po_id}/review", response_model=PoDetail)
def review_purchase_order(po_id: int, payload: ReviewAction, db: Session = Depends(get_db)) -> PoDetail:
    po = get_po(db, po_id)
    action = (payload.action or "").strip().lower()
    if action in {"confirm", "confirm_reviewed"}:
        return to_detail(confirm_reviewed(db, po, payload.po))
    if action in {"save_draft", "draft", "save"}:
        if payload.po is None:
            db.refresh(po)
            return to_detail(po)
        return to_detail(save_draft(db, po, payload.po))
    from app.exceptions import AppError

    raise AppError("Unknown review action. Use save_draft or confirm.", status_code=400)


@router.post("/{po_id}/reextract", response_model=UploadResponse)
def reextract_purchase_order(po_id: int, db: Session = Depends(get_db)) -> UploadResponse:
    po = get_po(db, po_id)
    po = queue_reextract(db, po)
    return UploadResponse(
        id=po.id,
        status=po.status,
        message="Re-extraction started. Previous extracted values will be replaced.",
    )


@router.delete("/{po_id}", response_model=MessageResponse)
def delete_purchase_order(po_id: int, db: Session = Depends(get_db)) -> MessageResponse:
    po = get_po(db, po_id)
    delete_po(db, po)
    return MessageResponse(message="Purchase order deleted.", id=po_id)


@router.get("/{po_id}/attachment")
def get_attachment(po_id: int, db: Session = Depends(get_db)) -> Response:
    po = get_po(db, po_id)
    attachment = pdf_storage.get_by_po(db, po.id)
    if attachment is None:
        raise NotFoundError("Original PDF was not found.")
    headers = {
        "Content-Disposition": f'inline; filename="{attachment.filename}"',
    }
    return Response(content=pdf_storage.read(attachment), media_type="application/pdf", headers=headers)


@router.get("/{po_id}/attachment/page/{page_number}")
def get_attachment_page(po_id: int, page_number: int, db: Session = Depends(get_db)) -> Response:
    po = get_po(db, po_id)
    attachment = pdf_storage.get_by_po(db, po.id)
    if attachment is None:
        raise NotFoundError("Original PDF was not found.")
    if page_number < 1 or page_number > attachment.page_count:
        raise PdfValidationError("Requested page is outside the document.")
    doc = open_pdf(pdf_storage.read(attachment))
    try:
        png = render_page_png(doc, page_number)
    finally:
        doc.close()
    return Response(content=png, media_type="image/png")
