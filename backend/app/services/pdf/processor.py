import logging
import re
from dataclasses import dataclass

import pymupdf as fitz

from app.config import Settings, get_settings
from app.exceptions import PdfValidationError

logger = logging.getLogger(__name__)

_PDF_MAGIC = b"%PDF-"


@dataclass
class ProcessedPdf:
    page_count: int
    embedded_text: str
    page_images: list[bytes]


def sanitize_filename(filename: str | None) -> str:
    name = (filename or "upload.pdf").replace("\\", "/").split("/")[-1]
    name = re.sub(r"[^A-Za-z0-9._-]", "_", name).strip("._") or "upload.pdf"
    if not name.lower().endswith(".pdf"):
        name = f"{name}.pdf"
    return name[:200]


def is_pdf_bytes(data: bytes) -> bool:
    return data[:5] == _PDF_MAGIC


def open_pdf(data: bytes) -> fitz.Document:
    if not data or not is_pdf_bytes(data):
        raise PdfValidationError("Unable to process this PDF.")
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception:
        logger.exception("PyMuPDF failed to open uploaded bytes")
        raise PdfValidationError("Unable to process this PDF.") from None
    if doc.is_encrypted:
        doc.close()
        raise PdfValidationError("Unable to process this PDF.")
    if doc.page_count < 1:
        doc.close()
        raise PdfValidationError("Unable to process this PDF.")
    return doc


def validate_pdf(data: bytes, settings: Settings | None = None) -> int:
    settings = settings or get_settings()
    if len(data) > settings.max_upload_bytes:
        raise PdfValidationError(
            f"This PDF exceeds the maximum file size of {settings.max_upload_size_mb} MB."
        )
    doc = open_pdf(data)
    try:
        page_count = doc.page_count
        if page_count > settings.max_pdf_pages:
            raise PdfValidationError(
                f"This PDF exceeds the maximum page count of {settings.max_pdf_pages}."
            )
        return page_count
    finally:
        doc.close()


def extract_embedded_text(doc: fitz.Document) -> str:
    parts: list[str] = []
    for index, page in enumerate(doc, start=1):
        text = (page.get_text("text") or "").strip()
        if text:
            parts.append(f"--- Page {index} ---\n{text}")
    return "\n\n".join(parts)


def render_page_png(doc: fitz.Document, page_number: int, dpi: int | None = None) -> bytes:
    settings = get_settings()
    dpi = dpi or settings.pdf_render_dpi
    if page_number < 1 or page_number > doc.page_count:
        raise PdfValidationError("Requested page is outside the document.")
    page = doc.load_page(page_number - 1)
    zoom = dpi / 72
    matrix = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=matrix, alpha=False)
    # Claude vision works best below very large pixel counts.
    max_edge = 4000
    if pix.width > max_edge or pix.height > max_edge:
        scale = min(max_edge / pix.width, max_edge / pix.height)
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom * scale, zoom * scale), alpha=False)
    return pix.tobytes("png")


def process_pdf(data: bytes, settings: Settings | None = None) -> ProcessedPdf:
    settings = settings or get_settings()
    validate_pdf(data, settings)
    doc = open_pdf(data)
    try:
        images = [render_page_png(doc, page_number, settings.pdf_render_dpi) for page_number in range(1, doc.page_count + 1)]
        return ProcessedPdf(
            page_count=doc.page_count,
            embedded_text=extract_embedded_text(doc),
            page_images=images,
        )
    finally:
        doc.close()
