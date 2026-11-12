from __future__ import annotations

import os
from datetime import date, datetime
from functools import lru_cache
from pathlib import Path

import fitz

from app.services.shopkeeper.ops_util import note_plain_text
from app.services.shopkeeper.types import CustomerRecord, PrintDocumentData, ShipperPrintData

PAGE_W = 612.0
PAGE_H = 792.0
LEFT = 18.0
RIGHT = 594.0
GRAY = (0.75, 0.75, 0.75)
DARK_GRAY = (0.45, 0.45, 0.45)
LIGHT_GRAY = (0.85, 0.85, 0.85)
BLACK = (0.0, 0.0, 0.0)

BRITECH_NAME = "Britech Electropolishing"
BRITECH_STREET = "6821 Central Avenue"
BRITECH_CITY = "Newark CA 94560"
BRITECH_PHONE = "(510) 713-8030  Fax (510) 713-8075"

# Code 39: n=narrow, w=wide. Start/stop is *.
_CODE39 = {
    "0": "nnnwwnwnn",
    "1": "wnnwnnnnw",
    "2": "nnwwnnnnw",
    "3": "wnwwnnnnn",
    "4": "nnnwwnnnw",
    "5": "wnnwwnnnn",
    "6": "nnwwwnnnn",
    "7": "nnnwnnwnw",
    "8": "wnnwnnwnn",
    "9": "nnwwnnwnn",
    "A": "wnnnnwnnw",
    "B": "nnwnnwnnw",
    "C": "wnwnnwnnn",
    "D": "nnnnwwnnw",
    "E": "wnnnwwnnn",
    "F": "nnwnwwnnn",
    "G": "nnnnnwwnw",
    "H": "wnnnnwwnn",
    "I": "nnwnnwwnn",
    "J": "nnnnwwwnn",
    "K": "wnnnnnnww",
    "L": "nnwnnnnww",
    "M": "wnwnnnnwn",
    "N": "nnnnwnnww",
    "O": "wnnnwnnwn",
    "P": "nnwnwnnwn",
    "Q": "nnnnnnwww",
    "R": "wnnnnnwwn",
    "S": "nnwnnnwwn",
    "T": "nnnnwnwwn",
    "U": "wwnnnnnnw",
    "V": "nwwnnnnnw",
    "W": "wwwnnnnnn",
    "X": "nwnnwnnnw",
    "Y": "wwnnwnnnn",
    "Z": "nwwnwnnnn",
    "-": "nwnnnnwnw",
    ".": "wwnnnnwnn",
    " ": "nwwnnnwnn",
    "*": "nwnnwnwnn",
    "$": "nwnwnwnnn",
    "/": "nwnwnnnwn",
    "+": "nwnnnwnwn",
    "%": "nnnwnwnwn",
}


def _text(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _date(value: date | None) -> str:
    if value is None:
        return ""
    return f"{value.month}/{value.day}/{str(value.year)[-2:]}"


def _now_stamp() -> str:
    now = datetime.now()
    hour = now.strftime("%I").lstrip("0") or "12"
    ampm = now.strftime("%p")[0]
    return f"{now.month}/{now.day}/{str(now.year)[-2:]} {hour}:{now.strftime('%M:%S')} {ampm} AUTO"


def _fill(page: fitz.Page, rect: fitz.Rect, color: tuple[float, float, float]) -> None:
    page.draw_rect(rect, color=None, fill=color, width=0)


def _box(page: fitz.Page, rect: fitz.Rect, width: float = 0.8) -> None:
    page.draw_rect(rect, color=BLACK, fill=None, width=width)


def _line(page: fitz.Page, x0: float, y0: float, x1: float, y1: float, width: float = 0.8) -> None:
    page.draw_line(fitz.Point(x0, y0), fitz.Point(x1, y1), color=BLACK, width=width)


_FACE_FILES = {
    "arial": ("arial.ttf", "Arial.ttf"),
    "arial-bold": ("arialbd.ttf", "Arialbd.ttf"),
    "arial-narrow": ("ARIALN.TTF", "arialn.ttf"),
    "arial-narrow-bold": ("ARIALNB.TTF", "arialnb.ttf"),
}


@lru_cache(maxsize=8)
def _face_file(face: str) -> str | None:
    fonts = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"
    for name in _FACE_FILES.get(face, ()):
        path = fonts / name
        if path.is_file():
            return str(path)
    return None


def _font_args(face: str | None, *, bold: bool = False) -> dict:
    if face:
        fontfile = _face_file(face)
        if fontfile:
            return {"fontname": face, "fontfile": fontfile}
        bold = bold or "bold" in face
    return {"fontname": "hebo" if bold else "helv"}


def _put(
    page: fitz.Page,
    xy: tuple[float, float],
    text: str,
    size: float,
    *,
    bold: bool = False,
    face: str | None = None,
) -> None:
    if not text:
        return
    page.insert_text(xy, text, fontsize=size, color=BLACK, **_font_args(face, bold=bold))


def _draw_code39(page: fitz.Page, x: float, y: float, value: str, *, height: float = 18.0, module: float = 0.7) -> None:
    payload = "".join(ch for ch in value.upper() if ch in _CODE39)
    if not payload:
        return
    encoded = f"*{payload}*"
    cursor = x
    for char in encoded:
        pattern = _CODE39.get(char)
        if not pattern:
            continue
        bar = True
        for bit in pattern:
            width = module * (2.4 if bit == "w" else 1.0)
            if bar:
                page.draw_rect(
                    fitz.Rect(cursor, y, cursor + width, y + height),
                    color=None,
                    fill=BLACK,
                    width=0,
                )
            cursor += width
            bar = not bar
        cursor += module


def _ship_name(data: PrintDocumentData) -> str:
    ship = data.ship_to or data.customer
    if ship and (ship.company or "").strip():
        return ship.company.strip()
    return _text(data.job.customer_name or data.job.customer_code)


def _ship_address_lines(data: PrintDocumentData) -> list[str]:
    ship = data.ship_to or data.customer
    if ship is None:
        return []
    block = ship.address_block()
    lines = [line for line in block.splitlines() if line.strip()]
    if lines and lines[0].strip() == _ship_name(data):
        lines = lines[1:]
    return lines


def _insert_picture(page: fitz.Page, data: PrintDocumentData, rect: fitz.Rect) -> None:
    _box(page, rect, 0.6)
    for pic in data.pictures:
        if not pic.print_on_trav or not pic.path:
            continue
        try:
            path = Path(pic.path)
            if not path.exists() or not path.is_file():
                continue
            page.insert_image(rect, filename=str(path), keep_proportion=True)
            return
        except Exception:
            continue


def _draw_qty_grid(page: fitz.Page, x: float, y: float, w: float, h: float) -> None:
    cols = 4
    rows = 2
    cw = w / cols
    ch = h / rows
    _box(page, fitz.Rect(x, y, x + w, y + h), 0.8)
    for i in range(1, cols):
        _line(page, x + i * cw, y, x + i * cw, y + h, 0.5)
    _line(page, x, y + ch, x + w, y + ch, 0.5)
    _put(page, (x + 4, y + 11), "Qty:", 8, face="arial")


def _op_height(op) -> float:
    note = note_plain_text(op.note) or ""
    extra = min(36.0, 12.0 * (1 + note.count("\n"))) if note else 0.0
    return 78.0 + extra


def _draw_operation(page: fitz.Page, y: float, op, job_number: str) -> float:
    height = _op_height(op)
    grid_x = 390.0
    grid_w = RIGHT - grid_x
    grid_h = 36.0
    seq = f"{op.seq_num:g}"
    _put(page, (40, y + 14), seq, 12, face="arial-bold")
    wc = _text(op.wc_code)
    desc = _text(op.description)
    _put(page, (88, y + 12), wc, 9, face="arial-narrow-bold")
    _put(page, (148, y + 12), desc, 9, face="arial-narrow-bold")
    if op.subcontract:
        _put(page, (270, y + 12), "OSP", 9, face="arial-narrow-bold")
    _draw_code39(page, 40, y + 20, job_number or seq, height=16, module=0.65)
    note = note_plain_text(op.note)
    if note:
        box = fitz.Rect(58, y + 40, grid_x - 8, y + height - 6)
        page.insert_textbox(
            box,
            note,
            fontsize=9,
            color=BLACK,
            **_font_args("arial-narrow-bold"),
        )
    _draw_qty_grid(page, grid_x, y + 4, grid_w, grid_h)
    bottom = y + height - 2
    _line(page, LEFT, bottom, RIGHT, bottom, 1.0)
    return height


def _draw_traveler_identity(page: fitz.Page, job) -> None:
    _fill(page, fitz.Rect(LEFT, 32, 148, 56), GRAY)
    _put(page, (26, 49), "Job Traveler", 13, bold=True)
    _put(page, (200, 52), _text(job.job_number), 22, bold=True)
    _put(page, (355, 42), "Rel:", 10)
    _put(page, (380, 44), "1", 14, bold=True)
    _put(page, (410, 42), "of", 10)
    _put(page, (430, 44), "1", 14, bold=True)
    _put(page, (468, 40), "Start Date:", 9)
    _put(page, (530, 40), _date(job.order_date), 10, bold=True)
    _put(page, (468, 54), "Shop Due:", 9)
    _put(page, (530, 54), _date(job.due_date), 10, bold=True)
    _put(page, (LEFT + 4, 70), "Planner:", 8)


def _draw_traveler_job_fields(page: fitz.Page, job, data: PrintDocumentData) -> None:
    qty = job.quantity if job.quantity is not None else 0
    _fill(page, fitz.Rect(LEFT, 78, RIGHT, 102), DARK_GRAY)
    page.insert_text(
        (190, 95),
        f"Make To Order: {qty}  Start: {qty}",
        fontsize=14,
        fontname="hebo",
        color=(1, 1, 1),
    )
    _put(page, (LEFT + 4, 116), "P O # :", 10)
    _put(page, (70, 116), _text(job.po_number), 10, bold=True)
    _put(page, (184, 116), "Part#:", 10)
    _put(page, (224, 116), _text(job.part_number), 10, bold=True)
    _put(page, (364, 116), "Rev:", 10)
    _put(page, (394, 116), _text(job.part_revision) or "-", 10, bold=True)
    _put(page, (LEFT + 4, 132), "Customer", 10)
    _put(page, (70, 132), _text(job.customer_code), 10, bold=True)
    _put(page, (184, 132), "Desc:", 10)
    _put(page, (224, 132), _text(job.description), 10, bold=True)
    _put(page, (LEFT + 4, 148), "Ship To:", 10)
    _put(page, (70, 148), _text(job.customer_code), 10, bold=True)
    _put(page, (400, 160), "Start / Minimum Qty :", 9)
    _put(page, (530, 160), f"{qty} / {qty}", 12, bold=True)


def _draw_section_rule(page: fitz.Page, y: float) -> None:
    _line(page, 54, y, RIGHT, y, 1.2)
    _line(page, 54, y + 4, RIGHT, y + 4, 1.2)


def _draw_traveler_deliveries(page: fitz.Page, job, data: PrintDocumentData) -> None:
    _put(page, (LEFT + 4, 176), "VID:", 8)
    _put(page, (70, 176), "Hrs", 8)
    _fill(page, fitz.Rect(380, 166, 500, 184), LIGHT_GRAY)
    _put(page, (392, 178), "OSP Days:", 9, bold=True)
    _insert_picture(page, data, fitz.Rect(388, 188, 546, 344))
    _put(page, (LEFT + 4, 200), "Deliveries:", 13, bold=True)
    headers = [(LEFT + 4, "POLn"), (50, "Qty Due"), (100, "ShipBy"), (160, "WeekCode"), (230, "Shipped")]
    for x, label in headers:
        _put(page, (x, 218), label, 8, bold=True)
    _put(page, (300, 218), "(S1) Int Note", 8)
    qty = job.quantity if job.quantity is not None else 0
    _put(page, (LEFT + 4, 234), _text(job.po_line) or "1", 9)
    _put(page, (50, 234), str(qty), 9)
    _put(page, (100, 234), _date(job.due_date), 9)
    _put(page, (230, 234), "0", 9)
    note = note_plain_text(job.notes) or ""
    if note:
        page.insert_textbox(fitz.Rect(300, 222, 378, 265), note, fontsize=7, fontname="helv", color=BLACK)
    _draw_section_rule(page, 368)


def _draw_operations_header(page: fitz.Page, y: float) -> float:
    _fill(page, fitz.Rect(LEFT, y, 130, y + 21), GRAY)
    _put(page, (LEFT + 6, y + 16), "Operations:", 16, face="arial-bold")
    _put(page, (40, y + 36), "Seq#", 9, face="arial-bold")
    _put(page, (88, y + 36), "W/C", 9, face="arial-bold")
    _put(page, (148, y + 36), "Description", 9, face="arial-bold")
    _put(page, (270, y + 36), "Subcontract", 9, face="arial-bold")
    _put(page, (520, y + 28), "Start By", 9, face="arial-bold")
    _put(page, (532, y + 38), "Date", 9, face="arial-bold")
    bottom = y + 46
    _line(page, LEFT, bottom, RIGHT, bottom, 1.0)
    return bottom + 6


def _draw_footer(page: fitz.Page, page_no: int, page_count: int) -> None:
    _put(page, (163, 743), BRITECH_NAME, 9)
    _put(page, (318, 743), _now_stamp(), 8)
    _put(page, (500, 743), f"Page {page_no} of {page_count}", 9)


def _paginated_ops(job) -> list[list]:
    ops = sorted(job.operations, key=lambda row: row.seq_num)
    first_budget = 300.0
    cont_budget = 520.0
    pages: list[list] = []
    current: list = []
    used = 0.0
    budget = first_budget
    for op in ops:
        need = _op_height(op)
        if current and used + need > budget:
            pages.append(current)
            current = []
            used = 0.0
            budget = cont_budget
        current.append(op)
        used += need
    if current or not pages:
        pages.append(current)
    return pages


def merge_pdfs(*blobs: bytes) -> bytes:
    out = fitz.open()
    try:
        for blob in blobs:
            if not blob:
                continue
            src = fitz.open(stream=blob, filetype="pdf")
            out.insert_pdf(src)
            src.close()
        return out.tobytes()
    finally:
        out.close()


def build_job_print_pdf(data: PrintDocumentData, cert_required: bool) -> bytes:
    parts = [build_traveler_pdf(data)]
    if cert_required:
        parts.append(build_certification_pdf(data))
    return merge_pdfs(*parts)


def build_traveler_pdf(data: PrintDocumentData) -> bytes:
    job = data.job
    op_pages = _paginated_ops(job)
    content_pages = max(1, len(op_pages))
    page_count = content_pages + (content_pages % 2)
    doc = fitz.open()
    for index, ops in enumerate(op_pages):
        page = doc.new_page(width=PAGE_W, height=PAGE_H)
        _draw_traveler_identity(page, job)
        _draw_traveler_job_fields(page, job, data)
        if index == 0:
            _draw_traveler_deliveries(page, job, data)
            y = _draw_operations_header(page, 392)
        else:
            _fill(page, fitz.Rect(21, 163, RIGHT, 166), GRAY)
            y = _draw_operations_header(page, 172)
        for op in ops:
            if y + 70 > 730:
                break
            y += _draw_operation(page, y, op, _text(job.job_number))
        _draw_footer(page, index + 1, page_count)
    if content_pages % 2 == 1:
        page = doc.new_page(width=PAGE_W, height=PAGE_H)
        _draw_traveler_identity(page, job)
        _draw_traveler_job_fields(page, job, data)
        _fill(page, fitz.Rect(21, 163, RIGHT, 166), GRAY)
        _draw_footer(page, page_count, page_count)
    pdf = doc.tobytes()
    doc.close()
    return pdf


def build_certification_pdf(data: PrintDocumentData) -> bytes:
    job = data.job
    doc = fitz.open()
    page = doc.new_page(width=PAGE_W, height=PAGE_H)
    outer = fitz.Rect(30, 38, 574, 360)
    _box(page, outer, 1.0)
    _put(page, (46, 68), BRITECH_NAME, 14, bold=True)
    _put(page, (46, 86), BRITECH_STREET, 10)
    _put(page, (46, 100), BRITECH_CITY, 10)
    _put(page, (46, 114), BRITECH_PHONE, 10)
    _put(page, (384, 62), "CERTIFICATION OF", 16, bold=True)
    _put(page, (399, 84), "CONFORMANCE", 16, bold=True)

    _line(page, 30, 161, 574, 161, 1.0)
    _put(page, (36, 176), "SHIPPED TO:", 8, bold=True)
    _put(page, (100, 176), _ship_name(data), 10, bold=True)
    for i, line in enumerate(_ship_address_lines(data)[:3]):
        _put(page, (100, 190 + i * 14), line, 10)

    _line(page, 30, 258, 574, 258, 1.0)
    _put(page, (168, 274), "This is to Certify the Conformance of:", 11, bold=True)
    qty = job.quantity if job.quantity is not None else ""
    unit = "Lot" if (_text(job.unit).lower() == "lot") else ""
    _put(page, (60, 290), "Part Number:", 10)
    _put(page, (190, 290), _text(job.part_number), 10, bold=True)
    _put(page, (330, 290), "Rev:", 10)
    _put(page, (360, 290), _text(job.part_revision) or "-", 10, bold=True)
    _put(page, (445, 290), "Qty:", 10)
    page.draw_line(fitz.Point(472, 292), fitz.Point(508, 292), color=BLACK, width=0.6)
    _put(page, (478, 288), str(qty), 10, bold=True)
    if unit:
        _put(page, (514, 290), unit, 10)
    _put(page, (60, 304), "Description:", 10)
    _put(page, (190, 304), _text(job.description), 10, bold=True)
    _put(page, (60, 318), "Your Purchase Order #:", 10)
    _put(page, (190, 318), _text(job.po_number), 10, bold=True)
    _put(page, (330, 318), f"PO Line #: {_text(job.po_line) or '1'}", 10)
    _put(page, (60, 332), "Shipping Work Order #:", 10)
    _put(page, (190, 332), _text(job.job_number), 10, bold=True)
    _put(page, (60, 348), "MFS Work Order #:", 10)
    _put(page, (190, 348), _text(job.job_number), 10, bold=True)
    _put(page, (298, 348), "Serial #:", 10)
    page.draw_line(fitz.Point(350, 350), fitz.Point(560, 350), color=BLACK, width=0.6)

    labels = [note_plain_text(cert.text) or "" for cert in (data.certs or []) if note_plain_text(cert.text)]
    y = 386
    block_bottom = y
    for label in labels:
        lines = max(1, 1 + (len(label) // 80) + label.count("\n"))
        block_bottom = y + 8 + lines * 12
        y += max(16, lines * 14)
    process = fitz.Rect(30, 368, 574, max(452, block_bottom + 12))
    _box(page, process, 1.0)
    y = 386
    for label in labels:
        tb = fitz.Rect(46, y - 10, 560, y + 56)
        unused = page.insert_textbox(tb, label, fontsize=10, fontname="helv", color=BLACK)
        y += max(16, int(tb.height - unused) + 4)

    methods = fitz.Rect(30, process.y1 + 4, 574, process.y1 + 76)
    _box(page, methods, 1.0)
    _put(page, (48, methods.y0 + 22), "THE METHODS USED ON THE PARTS DESCRIBED ABOVE COMPLIES IN ALL RESPECTS TO", 9, bold=True)
    _put(page, (48, methods.y0 + 36), "APPLICABLE STANDARDS.", 9, bold=True)
    _put(page, (48, methods.y0 + 50), "ABOVE SELECTED PROCESS IS ROHS COMPLIANT", 9, bold=True)

    _line(page, 33, 727, 573, 727, 0.8)
    _put(page, (36, 752), _now_stamp(), 8)
    _put(page, (250, 752), "Customer Copy", 13, bold=True)
    _put(page, (500, 748), "Page 1", 10)
    pdf = doc.tobytes()
    doc.close()
    return pdf


# ---------------------------------------------------------------------------
# Shipper / packing list (ShopKeeper form SK055 Rev B)
# Layout measured from references/singlejob-shipperexample.pdf and multijob-shipperexample.pdf.
# ---------------------------------------------------------------------------

SHIPPER_COPIES = ("Customer Copy", "Shipping Dept Copy", "Office Copy")
DEFAULT_SHIPPER_COPIES = ("Customer Copy", "Shipping Dept Copy")
_SHIPPER_ROWS_PER_PAGE = 9
_SHIPPER_ROW_H = 24.5
_SHIPPER_TABLE_TOP = 271.0
_SHIPPER_HEADER_H = 13.0
# Column edges: Ship Qty | UOM | Part # | Rev. | Description | Job Ref. | PO Ln/Rel#
_SHIPPER_COLS = (16.0, 73.0, 106.0, 211.0, 251.0, 406.0, 524.0, 592.0)
_SHIPPER_HEADERS = ("Ship Qty", "UOM", "Part #", "Rev.", "Description", "Job Ref.", "PO Ln/Rel#")


@lru_cache(maxsize=8)
def _font_obj(face: str | None, bold: bool) -> fitz.Font:
    if face:
        path = _face_file(face)
        if path:
            return fitz.Font(fontfile=path)
    return fitz.Font("hebo" if bold or (face and "bold" in face) else "helv")


def _width(text: str, size: float, *, face: str | None = None, bold: bool = False) -> float:
    return _font_obj(face, bold).text_length(text, fontsize=size)


def _put_center(page: fitz.Page, cx: float, y: float, text: str, size: float, *, face: str | None = None, bold: bool = False) -> None:
    _put(page, (cx - _width(text, size, face=face, bold=bold) / 2, y), text, size, face=face, bold=bold)


def _put_right(page: fitz.Page, rx: float, y: float, text: str, size: float, *, face: str | None = None, bold: bool = False) -> None:
    _put(page, (rx - _width(text, size, face=face, bold=bold), y), text, size, face=face, bold=bold)


def _fit(text: str, max_width: float, size: float, *, face: str | None = None, bold: bool = False) -> str:
    if _width(text, size, face=face, bold=bold) <= max_width:
        return text
    while text and _width(text + "…", size, face=face, bold=bold) > max_width:
        text = text[:-1]
    return text + "…" if text else ""


def _clock_stamp() -> str:
    now = datetime.now()
    hour = now.strftime("%I").lstrip("0") or "12"
    return f"{hour}:{now.strftime('%M:%S')} {now.strftime('%p')}"


def _shipper_address(data: ShipperPrintData) -> list[str]:
    record: CustomerRecord | None = data.ship_to or data.customer
    shipper = data.shipper
    name = _text((record.company if record else None) or shipper.customer_name or shipper.customer_code)
    lines = [name] if name else []
    if record is not None:
        for line in record.address_block().splitlines():
            line = line.strip()
            if line and line != name:
                lines.append(line)
        country = _text(record.country)
        if country and country not in lines:
            lines.append(country)
    return lines[:6]


def is_cod_terms(terms: str | None) -> bool:
    """True for cash-on-delivery payment terms, however they are written (C.O.D., COD, cod ...)."""
    letters = "".join(ch for ch in (terms or "").upper() if ch.isalpha())
    return letters.startswith("COD")


def _draw_cod_notice(page: fitz.Page) -> None:
    # Same as ShopKeeper's COD packing list: two bold lines to the right of the SHIPPED TO box.
    _put_center(page, 470, 222, "C.O.D. Must", 18, face="arial-bold")
    _put_center(page, 470, 246, "Receive Check", 18, face="arial-bold")


def _shipper_po_label(shipper) -> str:
    pos = [po.strip() for po in (shipper.po_numbers or "").split(",") if po.strip()]
    if not pos:
        return ""
    return pos[0] if len(pos) == 1 else f"{pos[0]} +{len(pos) - 1}"


def _draw_shipper_header(page: fitz.Page, data: ShipperPrintData, page_no: int, page_count: int) -> None:
    shipper = data.shipper
    ship_no = _text(shipper.shipper_number)
    terms = _text(data.customer.payment_terms if data.customer else None)

    _put(page, (37, 52), BRITECH_NAME, 13.5, face="arial-bold")  # company name stays bold
    _put(page, (37, 81), BRITECH_STREET, 9.5, face="arial")
    _put(page, (37, 94), BRITECH_CITY, 9.5, face="arial")
    _put(page, (37, 107), BRITECH_PHONE, 9.5, face="arial")

    # Packing List box: 3 rows x (Terms | Contact | Ship column)
    x0, x1, x2, x3 = 339.0, 436.0, 501.0, 592.0
    y0, y1, y2, y3 = 21.0, 46.0, 72.0, 99.0
    _fill(page, fitz.Rect(x0, y0, x2, y1), LIGHT_GRAY)
    _box(page, fitz.Rect(x0, y0, x3, y3), 0.9)
    _line(page, x0, y1, x3, y1, 0.6)
    _line(page, x0, y2, x3, y2, 0.6)
    _line(page, x2, y0, x2, y3, 0.6)
    _line(page, x1, y1, x1, y3, 0.6)
    _put_center(page, (x0 + x2) / 2, 39, "Packing List", 12, face="arial")
    _put(page, (x2 + 3, y0 + 6), "Ship Number", 5.5, face="arial")
    _put_center(page, (x2 + x3) / 2, 42, ship_no, 13, face="arial")

    _put(page, (x0 + 3, y1 + 6), "Terms", 5.5, face="arial")
    _put_center(page, (x0 + x1) / 2, 66, _fit(terms, x1 - x0 - 6, 9, face="arial"), 9, face="arial")
    _put(page, (x1 + 3, y1 + 6), "Contact", 5.5, face="arial")
    _put(page, (x2 + 3, y1 + 6), "Ship Date", 5.5, face="arial")
    _put_center(page, (x2 + x3) / 2 + 8, 67, _date(shipper.ship_date or date.today()), 9, face="arial")

    po_label = _shipper_po_label(shipper)
    _put(page, (x0 + 3, y2 + 6), "PO Number", 5.5, face="arial")
    _put_center(page, (x0 + x1) / 2, 93, _fit(po_label, x1 - x0 - 6, 9, face="arial"), 9, face="arial")
    _put(page, (x1 + 3, y2 + 6), "Shipped Via", 5.5, face="arial")
    _put_center(page, (x1 + x2) / 2, 93, _fit(_text(shipper.ship_via), x2 - x1 - 6, 8, face="arial"), 8, face="arial")
    _put(page, (x2 + 3, y2 + 6), "Page", 5.5, face="arial")
    _put_center(page, (x2 + x3) / 2 + 8, 93, f"{page_no} of {page_count}", 9, face="arial")

    first_po = po_label.split(" +")[0]
    if first_po:
        _draw_code39(page, x0 + 2, 100, first_po, height=10, module=0.75)

    _put(page, (205, 155), f"Shipper #: {ship_no}", 9.5, face="arial")
    _box(page, fitz.Rect(21, 160, 325, 265), 0.9)
    _put(page, (28, 169), "SHIPPED TO:", 6.5, face="arial")
    for i, line in enumerate(_shipper_address(data)):
        _put(page, (24, 181 + i * 14), _fit(line, 296, 9.5, face="arial-bold"), 9.5, face="arial-bold")  # ship-to stays bold
    _put(page, (52, 259), "Contact:", 9, face="arial")
    if is_cod_terms(terms):
        _draw_cod_notice(page)


def _draw_shipper_table(page: fitz.Page, jobs: list) -> None:
    cols = _SHIPPER_COLS
    top = _SHIPPER_TABLE_TOP
    head_bottom = top + _SHIPPER_HEADER_H
    _fill(page, fitz.Rect(cols[0], top, cols[-1], head_bottom), LIGHT_GRAY)
    _box(page, fitz.Rect(cols[0], top, cols[-1], head_bottom), 0.8)
    for x in cols[1:-1]:
        _line(page, x, top, x, head_bottom, 0.6)
    for i, label in enumerate(_SHIPPER_HEADERS):
        _put_center(page, (cols[i] + cols[i + 1]) / 2, top + 10, label, 9, face="arial")

    y = head_bottom
    for job in jobs:
        base = y + 12
        qty = job.quantity_shipped if job.quantity_shipped is not None else job.quantity
        unit = "Lot" if _text(job.unit).lower() == "lot" else "Each"
        _put_right(page, cols[1] - 4, base, "" if qty is None else str(qty), 9.5, face="arial")
        _put_right(page, cols[2] - 4, base, unit, 9.5, face="arial")
        _put(page, (cols[2] + 3, base), _fit(_text(job.part_number), cols[3] - cols[2] - 6, 8.5, face="arial-narrow"), 8.5, face="arial-narrow")
        _put(page, (cols[3] + 3, base), _fit(_text(job.part_revision) or "-", cols[4] - cols[3] - 6, 9, face="arial"), 9, face="arial")
        _put(page, (cols[4] + 3, base), _fit(_text(job.description), cols[5] - cols[4] - 6, 8, face="arial-narrow"), 8, face="arial-narrow")
        _put(page, (cols[5] + 3, base), f"{_text(job.job_number)} Rel 1", 9.5, face="arial")
        _put(page, (cols[6] + 3, base), _text(job.po_line) or "1", 9.5, face="arial")
        for x in cols:
            _line(page, x, y + 2, x, y + 18, 0.6)
        _line(page, cols[0] + 4, y + _SHIPPER_ROW_H - 3, cols[-1], y + _SHIPPER_ROW_H - 3, 0.6)
        y += _SHIPPER_ROW_H


def _draw_shipper_footer(page: fitz.Page, data: ShipperPrintData, copy_label: str, page_no: int, page_count: int, stamp: str) -> None:
    last = page_no == page_count
    if last:
        _fill(page, fitz.Rect(49, 514, 80, 524), LIGHT_GRAY)
        _put(page, (51, 521.5), "Comments:", 5.4, face="arial")
        comments = fitz.Rect(82, 513, 551, 601)
        _box(page, comments, 0.9)
        note = note_plain_text(data.shipper.note) or ""
        if note:
            page.insert_textbox(
                fitz.Rect(comments.x0 + 4, comments.y0 + 4, comments.x1 - 4, comments.y1 - 4),
                note,
                fontsize=9,
                color=BLACK,
                **_font_args("arial"),
            )
        _put(page, (45, 692), "Shipped by:  /  Received by:", 9, face="arial")
        _put(page, (312, 692), "Date:", 9, face="arial")
        # Signature lines sit well below the labels to leave room to sign.
        _line(page, 45, 726, 290, 726, 0.8)
        _line(page, 312, 726, 413, 726, 0.8)
    _put(page, (32, 738), stamp, 7, face="arial")
    prepared = _text(data.prepared_by) or _text(data.shipper.ship_by)
    _put(page, (21, 746), f"Prepared By:  {prepared}" if prepared else "Prepared By:", 7, face="arial")
    _put_center(page, 334, 748, copy_label, 12, face="arial-bold")  # copy label stays bold
    _put(page, (520, 748), f"Page {page_no} of {page_count}", 9.5, face="arial")


def build_shipper_pdf(data: ShipperPrintData, copies: tuple[str, ...] | list[str] = DEFAULT_SHIPPER_COPIES) -> bytes:
    """One packing list per copy label (Customer / Shipping Dept / Office), each 1+ pages."""
    jobs = sorted(
        data.shipper.jobs,
        key=lambda job: (_line_sort(job.po_line), _text(job.job_number)),
    )
    chunks = [jobs[i : i + _SHIPPER_ROWS_PER_PAGE] for i in range(0, len(jobs), _SHIPPER_ROWS_PER_PAGE)] or [[]]
    page_count = len(chunks)
    stamp = _clock_stamp()
    labels = [label for label in copies if label] or list(SHIPPER_COPIES[:1])
    doc = fitz.open()
    try:
        for label in labels:
            for index, chunk in enumerate(chunks, start=1):
                page = doc.new_page(width=PAGE_W, height=PAGE_H)
                _draw_shipper_header(page, data, index, page_count)
                _draw_shipper_table(page, chunk)
                _draw_shipper_footer(page, data, label, index, page_count, stamp)
        return doc.tobytes()
    finally:
        doc.close()


def _line_sort(value: str | None) -> float:
    try:
        return float(_text(value))
    except ValueError:
        return float("inf")
