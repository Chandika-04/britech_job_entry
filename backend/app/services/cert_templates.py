"""Certification templates (ShopKeeper CertificationText), edited as plain text.

ShopKeeper stores the wording as HTML. The editor shows plain text with spacing and line breaks kept;
saving changed wording writes simple HTML (one <div> per line, &nbsp; for runs of spaces) so ShopKeeper's
own certificate prints the same. Wording that was not changed keeps its original HTML (fonts, colours).
"""

from __future__ import annotations

import re
from html import escape, unescape

from app.exceptions import AppError
from app.services.shopkeeper import get_shopkeeper_provider
from app.services.shopkeeper.provider import ShopKeeperProvider
from app.services.shopkeeper.types import CertTemplate, CertTemplateWrite

MAX_ID = 30  # CTxt_ID nvarchar(30)
MAX_DESCRIPTION = 30  # CTxt_Description nvarchar(30)

_BREAK = re.compile(r"<br\s*/?>", re.IGNORECASE)
_BLOCK_END = re.compile(r"</(div|p|li|tr|h[1-6])\s*>", re.IGNORECASE)
_TAG = re.compile(r"<[^>]+>")


def cert_html_to_text(value: str | None) -> str:
    if not value:
        return ""
    text = str(value)
    looks_html = bool(_TAG.search(text))
    if looks_html:
        text = re.sub(r"[\r\n]+", "", text)  # raw newlines between tags are not line breaks in HTML
        text = _BREAK.sub("\n", text)
        text = _BLOCK_END.sub("\n", text)
        text = _TAG.sub("", text)
        text = unescape(text)
    text = text.replace("\xa0", " ").replace("\r\n", "\n").replace("\r", "\n")
    lines = [line.rstrip() for line in text.split("\n")]
    while lines and not lines[-1]:
        lines.pop()
    return "\n".join(lines)


def _line_html(line: str) -> str:
    if not line.strip():
        return "<div>&nbsp;</div>"
    body = escape(line, quote=False)
    body = re.sub(r" {2,}", lambda m: "&nbsp;" * len(m.group(0)), body)
    if body.startswith(" "):
        body = "&nbsp;" + body[1:]
    return f"<div>{body}</div>"


def cert_text_to_html(text: str | None) -> str | None:
    clean = cert_html_to_text(text)  # same normalising as the editor view
    if not clean.strip():
        return None
    return "\r\n".join(_line_html(line) for line in clean.split("\n"))


def _clean_id(value: str | None) -> str:
    clean = (value or "").strip()
    if not clean:
        raise AppError("Give the template a name (ID).", status_code=422)
    if len(clean) > MAX_ID:
        raise AppError(f"Template names can be at most {MAX_ID} characters.", status_code=422)
    return clean


def _clean_description(value: str | None) -> str | None:
    clean = " ".join((value or "").split())
    if len(clean) > MAX_DESCRIPTION:
        raise AppError(f"Descriptions can be at most {MAX_DESCRIPTION} characters.", status_code=422)
    return clean or None


def _out(row: CertTemplate) -> dict:
    return {
        "id": row.id,
        "description": row.description,
        "text": cert_html_to_text(row.text),
        "rowversion": row.rowversion,
        "part_count": row.part_count,
    }


def list_templates(provider: ShopKeeperProvider | None = None) -> list[dict]:
    provider = provider or get_shopkeeper_provider()
    return [_out(row) for row in provider.list_cert_templates()]


def create_template(
    ctxt_id: str, description: str | None, text: str | None, provider: ShopKeeperProvider | None = None
) -> list[dict]:
    provider = provider or get_shopkeeper_provider()
    html = cert_text_to_html(text)
    if html is None:
        raise AppError("Type the certification wording.", status_code=422)
    provider.create_cert_template(CertTemplateWrite(_clean_id(ctxt_id), _clean_description(description), html))
    return list_templates(provider)


def update_template(
    ctxt_id: str,
    description: str | None,
    text: str | None,
    rowversion: str | None,
    provider: ShopKeeperProvider | None = None,
) -> list[dict]:
    provider = provider or get_shopkeeper_provider()
    current = next((row for row in provider.list_cert_templates() if row.id == ctxt_id), None)
    if current is None:
        raise AppError("Certification template not found.", status_code=404)
    if cert_html_to_text(text) == cert_html_to_text(current.text):
        html = current.text  # wording unchanged: keep ShopKeeper's original formatting
    else:
        html = cert_text_to_html(text)
        if html is None:
            raise AppError("Type the certification wording.", status_code=422)
    provider.update_cert_template(CertTemplateWrite(current.id, _clean_description(description), html), rowversion)
    return list_templates(provider)
