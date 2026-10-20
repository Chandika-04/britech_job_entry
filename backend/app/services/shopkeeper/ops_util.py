from __future__ import annotations

import re
from html import escape, unescape

from app.exceptions import AppError
from app.services.shopkeeper.types import OperationRow

_TAG = re.compile(r"<[^>]+>", re.IGNORECASE)
_BREAK = re.compile(r"(?i)<br\s*/?>")
_BLOCK_END = re.compile(r"(?i)</(div|p|li|tr|h[1-6])>")
_LOOKS_LIKE_HTML = re.compile(r"<[a-zA-Z/!?]")


def note_plain_text(value: str | None) -> str | None:
    if value is None:
        return None
    text = str(value)
    if not text.strip():
        return None
    text = _BREAK.sub("\n", text)
    text = _BLOCK_END.sub("\n", text)
    text = _TAG.sub("", text)
    text = unescape(text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    return text or None


def note_to_shopkeeper_html(value: str | None) -> str | None:
    plain = note_plain_text(value)
    if not plain:
        return None
    body = escape(plain).replace("\n", "<br>")
    return f'<div align="left"><font face="Arial" size="2">{body}</font></div>'


def note_html_for_print(value: str | None) -> str:
    if not value or not str(value).strip():
        return ""
    if _LOOKS_LIKE_HTML.search(str(value)):
        return str(value)
    return note_to_shopkeeper_html(value) or ""


def rowversion_hex(value: object) -> str | None:
    if value is None:
        return None
    if isinstance(value, memoryview):
        value = value.tobytes()
    if isinstance(value, bytes):
        return value.hex()
    text = str(value).strip()
    return text or None


def rowversion_bytes(value: str | None) -> bytes | None:
    if not value:
        return None
    try:
        return bytes.fromhex(value)
    except ValueError as exc:
        raise AppError("Invalid row version.", status_code=409) from exc


def operation_from_payload(payload) -> OperationRow:
    wc = (payload.wc_code or "").strip()
    if not wc:
        raise AppError("Work center is required.", status_code=409)
    return OperationRow(
        id=payload.id,
        seq_num=float(payload.seq_num),
        wc_code=wc[:10],
        description=(payload.description or None),
        note=note_to_shopkeeper_html(payload.note),
        run_time=payload.run_time,
        setup_time=payload.setup_time,
        subcontract=bool(payload.subcontract),
        process_code=payload.process_code,
        process=payload.process,
        fa=bool(payload.fa),
        qty=payload.qty,
        sched_days=payload.sched_days,
        om_link=payload.om_link,
        rowversion=payload.rowversion,
    )


def copy_op(row: OperationRow, *, new_id: int, om_link: int | None = None) -> OperationRow:
    return OperationRow(
        id=new_id,
        seq_num=row.seq_num,
        wc_code=row.wc_code,
        description=row.description,
        note=row.note,
        run_time=row.run_time,
        setup_time=row.setup_time,
        subcontract=row.subcontract,
        process_code=row.process_code,
        process=row.process,
        fa=row.fa,
        qty=row.qty,
        sched_days=row.sched_days,
        om_link=om_link if om_link is not None else row.om_link,
        rowversion="1",
    )
