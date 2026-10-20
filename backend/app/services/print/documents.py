from __future__ import annotations

import os
from datetime import date, datetime
from functools import lru_cache
from pathlib import Path

import fitz

from app.services.shopkeeper.ops_util import note_plain_text
from app.services.shopkeeper.types import PrintDocumentData

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


def _draw_footer(page: fitz.Page, form: str, page_no: int, page_count: int) -> None:
    _put(page, (LEFT, 743), form, 8)
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
        _draw_footer(page, "SK066 Rev C", index + 1, page_count)
    if content_pages % 2 == 1:
        page = doc.new_page(width=PAGE_W, height=PAGE_H)
        _draw_traveler_identity(page, job)
        _draw_traveler_job_fields(page, job, data)
        _fill(page, fitz.Rect(21, 163, RIGHT, 166), GRAY)
        _draw_footer(page, "SK066 Rev C", page_count, page_count)
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
    _put(page, (36, 740), "SK064 Rev B", 8)
    _put(page, (36, 752), _now_stamp(), 8)
    _put(page, (250, 752), "Customer Copy", 13, bold=True)
    _put(page, (500, 748), "Page 1", 10)
    pdf = doc.tobytes()
    doc.close()
    return pdf
