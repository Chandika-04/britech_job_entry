from __future__ import annotations

import logging
import time
from decimal import Decimal

import anthropic
from anthropic import APIStatusError, RateLimitError
from pydantic import ValidationError

from app.config import get_settings
from app.schemas.extraction import ExtractionResult, ProviderResult
from app.services.extraction.prompt import SYSTEM_PROMPT
from app.services.pdf.processor import ProcessedPdf

logger = logging.getLogger(__name__)

EXTRACTION_TOOL = {
    "name": "save_purchase_order_extraction",
    "description": "Save the structured manufacturing purchase-order extraction. Use null for unavailable values.",
    "input_schema": {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "po_number": {"type": ["string", "null"]},
            "customer_name": {"type": ["string", "null"]},
            "customer_number": {"type": ["string", "null"]},
            "order_date": {"type": ["string", "null"], "description": "YYYY-MM-DD"},
            "requested_ship_date": {"type": ["string", "null"], "description": "YYYY-MM-DD"},
            "buyer_contact": {"type": ["string", "null"]},
            "buyer_notes": {"type": ["string", "null"]},
            "bill_to": {"type": ["string", "null"]},
            "ship_to": {"type": ["string", "null"]},
            "possible_po_numbers": {"type": "array", "items": {"type": "string"}},
            "document_quality": {
                "type": ["string", "null"],
                "enum": ["good", "poor", "unreadable"],
            },
            "unreadable_pages": {"type": "array", "items": {"type": "integer"}},
            "conflicting_fields": {"type": "array", "items": {"type": "string"}},
            "warnings": {"type": "array", "items": {"type": "string"}},
            "line_items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "properties": {
                        "line_number": {"type": ["integer", "null"]},
                        "customer_part_number": {"type": ["string", "null"]},
                        "revision": {"type": ["string", "null"]},
                        "description": {"type": ["string", "null"]},
                        "quantity": {"type": ["number", "string", "null"]},
                        "unit_price": {"type": ["number", "string", "null"]},
                        "uom": {"type": ["string", "null"]},
                        "due_date": {"type": ["string", "null"], "description": "YYYY-MM-DD"},
                        "notes": {"type": ["string", "null"]},
                    },
                    "required": [
                        "line_number",
                        "customer_part_number",
                        "revision",
                        "description",
                        "quantity",
                        "unit_price",
                        "uom",
                        "due_date",
                        "notes",
                    ],
                },
            },
        },
        "required": [
            "po_number",
            "customer_name",
            "customer_number",
            "order_date",
            "requested_ship_date",
            "buyer_contact",
            "buyer_notes",
            "bill_to",
            "ship_to",
            "line_items",
            "possible_po_numbers",
            "document_quality",
            "unreadable_pages",
            "conflicting_fields",
            "warnings",
        ],
    },
}


def _retry_after_seconds(error: RateLimitError | APIStatusError, fallback: float) -> float:
    headers = getattr(error, "response", None)
    raw = None
    if headers is not None:
        raw = error.response.headers.get("retry-after")
    if raw:
        try:
            return max(float(raw), 0.1)
        except ValueError:
            pass
    return fallback


def estimate_cost_usd(input_tokens: int, output_tokens: int) -> Decimal:
    settings = get_settings()
    cost = (
        Decimal(input_tokens) / Decimal(1_000_000) * Decimal(str(settings.anthropic_input_cost_per_million))
        + Decimal(output_tokens) / Decimal(1_000_000) * Decimal(str(settings.anthropic_output_cost_per_million))
    )
    return cost.quantize(Decimal("0.000001"))


class ClaudeExtractionProvider:
    def __init__(self, client: anthropic.Anthropic | None = None):
        self._client = client

    @property
    def client(self) -> anthropic.Anthropic:
        if self._client is None:
            settings = get_settings()
            if not settings.anthropic_api_key:
                raise RuntimeError("ANTHROPIC_API_KEY is not configured.")
            self._client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
        return self._client

    def extract(self, processed: ProcessedPdf) -> ProviderResult:
        settings = get_settings()
        content: list[dict] = []
        for index, image in enumerate(processed.page_images, start=1):
            import base64

            content.append(
                {
                    "type": "text",
                    "text": f"Page {index} of {processed.page_count}:",
                }
            )
            content.append(
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/png",
                        "data": base64.b64encode(image).decode("ascii"),
                    },
                }
            )
        if processed.embedded_text:
            content.append(
                {
                    "type": "text",
                    "text": (
                        "Embedded PDF text was also found. Treat images as primary for scanned documents.\n\n"
                        f"{processed.embedded_text}"
                    ),
                }
            )
        content.append(
            {
                "type": "text",
                "text": "Extract the purchase order using the save_purchase_order_extraction tool.",
            }
        )

        delay = 1.0
        last_error: Exception | None = None
        for attempt in range(1, settings.max_extraction_retries + 1):
            try:
                response = self.client.messages.create(
                    model=settings.anthropic_model,
                    max_tokens=4096,
                    system=SYSTEM_PROMPT,
                    tools=[EXTRACTION_TOOL],
                    tool_choice={"type": "tool", "name": "save_purchase_order_extraction"},
                    messages=[{"role": "user", "content": content}],
                )
                return self._parse_response(response, settings.anthropic_model)
            except RateLimitError as exc:
                last_error = exc
                wait = _retry_after_seconds(exc, delay)
                logger.warning(
                    "Anthropic rate limit on attempt %s/%s; retrying in %.1fs",
                    attempt,
                    settings.max_extraction_retries,
                    wait,
                )
                time.sleep(wait)
                delay = min(delay * 2, 60)
            except APIStatusError as exc:
                last_error = exc
                if exc.status_code >= 500:
                    logger.warning("Anthropic server error %s on attempt %s", exc.status_code, attempt)
                    time.sleep(delay)
                    delay = min(delay * 2, 60)
                    continue
                logger.exception("Anthropic API error")
                raise
        raise RuntimeError("Extraction failed after retries.") from last_error

    def _parse_response(self, response, model: str) -> ProviderResult:
        tool_input = None
        for block in response.content:
            if getattr(block, "type", None) == "tool_use" and getattr(block, "name", "") == EXTRACTION_TOOL["name"]:
                tool_input = block.input
                break
        if not isinstance(tool_input, dict):
            raise ValueError("The extraction model did not return structured data.")
        try:
            extraction = ExtractionResult.model_validate(tool_input)
        except ValidationError as exc:
            logger.warning("Extraction schema validation failed: %s", exc)
            raise ValueError("The extraction model returned data that could not be validated.") from exc

        usage = getattr(response, "usage", None)
        input_tokens = getattr(usage, "input_tokens", None) if usage else None
        output_tokens = getattr(usage, "output_tokens", None) if usage else None
        cost = None
        if input_tokens is not None and output_tokens is not None:
            cost = estimate_cost_usd(input_tokens, output_tokens)

        return ProviderResult(
            extraction=extraction,
            raw_json=tool_input,
            model=getattr(response, "model", None) or model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=cost,
        )
