from app.services.pdf.processor import (
    extract_embedded_text,
    image_media_type,
    open_pdf,
    process_pdf,
    render_page_for_model,
    render_page_png,
    validate_pdf,
)
from tests.helpers import make_scanned_pdf, make_text_pdf


def test_model_image_shrinks_when_png_too_large(settings):
    doc = open_pdf(make_scanned_pdf("Large scan"))
    try:
        png = render_page_png(doc, 1, settings.pdf_render_dpi)
        limit = len(png) // 2
        image = render_page_for_model(doc, 1, settings.pdf_render_dpi, max_bytes=limit)
        assert len(image) <= limit
        assert image_media_type(image) == "image/jpeg"
        assert image_media_type(png) == "image/png"
    finally:
        doc.close()


def test_page_count_and_text(settings):
    data = make_text_pdf("Hello PO", pages=2)
    assert validate_pdf(data, settings) == 2
    processed = process_pdf(data, settings)
    assert processed.page_count == 2
    assert "Hello PO" in processed.embedded_text
    assert "Page 1" in processed.embedded_text
    assert "Page 2" in processed.embedded_text
    assert len(processed.page_images) == 2
    assert processed.page_images[0].startswith(b"\x89PNG")


def test_scanned_pdf_has_little_or_no_text(settings):
    data = make_scanned_pdf("Secret scanned text")
    processed = process_pdf(data, settings)
    assert processed.page_count == 1
    assert len(processed.page_images) == 1
    # Image-only pages typically have no extractable text.
    assert "Secret scanned text" not in processed.embedded_text


def test_render_specific_page(settings):
    data = make_text_pdf(pages=3)
    doc = open_pdf(data)
    try:
        png = render_page_png(doc, 3, settings.pdf_render_dpi)
        assert png.startswith(b"\x89PNG")
        text = extract_embedded_text(doc)
        assert "Page 3" in text
    finally:
        doc.close()
