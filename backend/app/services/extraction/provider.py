from typing import Protocol

from app.schemas.extraction import ProviderResult
from app.services.pdf.processor import ProcessedPdf


class ExtractionProvider(Protocol):
    def extract(self, processed: ProcessedPdf) -> ProviderResult:
        """Extract structured PO data from processed PDF pages and text."""


def get_extraction_provider() -> ExtractionProvider:
    from app.config import get_settings
    from app.services.extraction.claude import ClaudeExtractionProvider
    from app.services.extraction.fake import FakeExtractionProvider

    settings = get_settings()
    name = (settings.extraction_provider or "claude").strip().lower()
    if name == "fake":
        return FakeExtractionProvider()
    return ClaudeExtractionProvider()
