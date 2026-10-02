import logging
import os
import threading
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from alembic import command
from alembic.config import Config
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.routing import Match, Route
from starlette.types import Scope

from app.api import api_router
from app.config import get_settings
from app.database.session import get_session_factory
from app.exceptions import AppError
from app.services.storage.pdf_storage import pdf_storage
from app.workers.extraction_worker import start_worker, stop_worker

logging.basicConfig(level=logging.INFO)

BACKEND_ROOT = Path(__file__).resolve().parent.parent


def run_migrations() -> None:
    if os.getenv("SKIP_MIGRATIONS", "").lower() in {"1", "true", "yes"}:
        return
    alembic_ini = BACKEND_ROOT / "alembic.ini"
    if not alembic_ini.exists():
        return
    config = Config(str(alembic_ini))
    config.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
    command.upgrade(config, "head")


def _sync_pdf_backup() -> None:
    session = get_session_factory()()
    try:
        pdf_storage.sync_backup(session)
    except Exception:
        logging.getLogger(__name__).exception("PDF backup sync failed")
    finally:
        session.close()


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    pdf_storage.check_ready()
    run_migrations()
    threading.Thread(target=_sync_pdf_backup, name="pdf-backup-sync", daemon=True).start()
    start_worker()
    yield
    stop_worker()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="PO Extraction",
        description="Manufacturing purchase-order extraction, review, and ShopKeeper job creation.",
        version="0.2.0",
        lifespan=lifespan,
    )
    origins = settings.cors_origin_list
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins or ["*"],
        allow_credentials=bool(origins),
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(AppError)
    async def app_error_handler(_request: Request, exc: AppError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.message})

    app.include_router(api_router, prefix="/api")

    frontend_dist = BACKEND_ROOT.parent / "frontend" / "dist"
    if frontend_dist.exists():
        assets_dir = frontend_dist / "assets"
        if assets_dir.exists():
            app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")
        _mount_spa_fallback(app, frontend_dist)

    return app


class _SpaFallbackRoute(Route):
    """Serve the website for unknown GET paths, but never swallow /api routes."""

    def matches(self, scope: Scope) -> tuple[Match, Scope]:
        path = scope.get("path", "")
        if path == "/api" or path.startswith("/api/"):
            return Match.NONE, {}
        return super().matches(scope)


def _mount_spa_fallback(app: FastAPI, frontend_dist: Path) -> None:
    dist_root = frontend_dist.resolve()

    async def serve_spa(request: Request):
        full_path = request.path_params.get("full_path", "")
        candidate = (frontend_dist / full_path).resolve()
        if full_path and candidate.is_file() and str(candidate).startswith(str(dist_root)):
            return FileResponse(candidate)
        return FileResponse(frontend_dist / "index.html")

    app.router.routes.append(
        _SpaFallbackRoute("/{full_path:path}", endpoint=serve_spa, methods=["GET", "HEAD"])
    )


app = create_app()
