from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = Path(__file__).resolve().parents[1]


def normalize_database_url(url: str) -> str:
    if url.startswith("postgres://"):
        return "postgresql+psycopg://" + url.removeprefix("postgres://")
    if url.startswith("postgresql://") and "+psycopg" not in url:
        return "postgresql+psycopg://" + url.removeprefix("postgresql://")
    return url


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(PROJECT_ROOT / ".env", BACKEND_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "postgresql+psycopg://po:po@localhost:5432/po_extraction"

    anthropic_api_key: str = ""
    anthropic_model: str = "claude-haiku-4-5-20251001"
    anthropic_input_cost_per_million: float = 1.00
    anthropic_output_cost_per_million: float = 5.00

    extraction_provider: str = "claude"

    max_upload_size_mb: int = 15
    max_pdf_pages: int = 10

    heartbeat_stale_seconds: int = 120
    heartbeat_interval_seconds: int = 15
    worker_enabled: bool = True
    worker_poll_seconds: float = 2.0

    pdf_render_dpi: int = 150

    pdf_storage_dir: str = ""
    pdf_backup_dir: str = ""

    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"

    max_extraction_retries: int = 5

    shopkeeper_provider: str = "shopkeeper"
    shopkeeper_connection_string: str = ""
    shopkeeper_expected_database: str = "SkData_Test"
    shopkeeper_non_tax_code: str = "NT"
    shopkeeper_new_job_status: str = "NA"
    shopkeeper_job_reserve_retries: int = 5
    app_version: str = "0.2.0"

    @property
    def sqlalchemy_database_url(self) -> str:
        return normalize_database_url(self.database_url)

    @property
    def pdf_storage_path(self) -> Path:
        value = self.pdf_storage_dir.strip()
        return Path(value) if value else BACKEND_ROOT / "storage" / "pdfs"

    @property
    def pdf_backup_path(self) -> Path | None:
        value = self.pdf_backup_dir.strip()
        return Path(value) if value else None

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_size_mb * 1024 * 1024

    @property
    def cors_origin_list(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
