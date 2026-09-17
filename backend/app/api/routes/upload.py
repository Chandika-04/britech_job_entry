from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database.session import get_db
from app.exceptions import PdfValidationError
from app.models.po_request import PoStatus
from app.schemas.po import UploadResponse
from app.services.pdf.processor import is_pdf_bytes
from app.services.po_service import create_from_upload

router = APIRouter(tags=["upload"])


@router.post("/upload", response_model=UploadResponse)
async def upload_po(file: UploadFile = File(...), db: Session = Depends(get_db)) -> UploadResponse:
    settings = get_settings()
    filename = file.filename or "upload.pdf"
    content_type = file.content_type or "application/pdf"
    if not filename.lower().endswith(".pdf") and content_type not in {
        "application/pdf",
        "application/x-pdf",
        "application/octet-stream",
    }:
        raise PdfValidationError("Unable to process this PDF.")

    data = await file.read()
    if len(data) > settings.max_upload_bytes:
        raise PdfValidationError(
            f"This PDF exceeds the maximum file size of {settings.max_upload_size_mb} MB."
        )
    if not is_pdf_bytes(data):
        raise PdfValidationError("Unable to process this PDF.")

    po = create_from_upload(
        db,
        filename=filename,
        content_type="application/pdf",
        pdf_bytes=data,
    )
    return UploadResponse(
        id=po.id,
        status=PoStatus.pending,
        message="Upload received. Extraction has started.",
    )
