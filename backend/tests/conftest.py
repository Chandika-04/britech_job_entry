from __future__ import annotations

import os
from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

os.environ.setdefault("WORKER_ENABLED", "false")
os.environ.setdefault("EXTRACTION_PROVIDER", "fake")
os.environ.setdefault("SKIP_MIGRATIONS", "true")
os.environ.setdefault("HEARTBEAT_STALE_SECONDS", "30")
os.environ.setdefault("MAX_UPLOAD_SIZE_MB", "5")
os.environ.setdefault("MAX_PDF_PAGES", "5")
os.environ.setdefault("ANTHROPIC_API_KEY", "")
os.environ.setdefault("DATABASE_URL", "sqlite://")

from app.config import get_settings  # noqa: E402
from app.database.base import Base  # noqa: E402
from app.database.session import get_engine, get_session_factory, reset_engine  # noqa: E402
from app.models import LlmCall, PoAttachment, PoLineItem, PoRequest  # noqa: F401, E402


@pytest.fixture
def settings(tmp_path, monkeypatch):
    db_path = (tmp_path / "test.db").resolve().as_posix()
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{db_path}")
    monkeypatch.setenv("WORKER_ENABLED", "false")
    monkeypatch.setenv("EXTRACTION_PROVIDER", "fake")
    monkeypatch.setenv("SKIP_MIGRATIONS", "true")
    monkeypatch.setenv("HEARTBEAT_STALE_SECONDS", "30")
    get_settings.cache_clear()
    reset_engine()
    engine = get_engine()
    Base.metadata.create_all(engine)
    yield get_settings()
    Base.metadata.drop_all(engine)
    reset_engine()
    get_settings.cache_clear()


@pytest.fixture
def db(settings) -> Generator[Session, None, None]:
    factory = get_session_factory()
    session = factory()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(settings) -> Generator[TestClient, None, None]:
    from app.main import create_app

    app = create_app()
    with TestClient(app) as test_client:
        yield test_client
