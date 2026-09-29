import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from alembic import command
from alembic.config import Config
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app.api import api_router
from app.config import get_settings
from app.exceptions import AppError
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


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    run_migrations()
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

        @app.get("/{full_path:path}")
        async def serve_spa(full_path: str):
            candidate = (frontend_dist / full_path).resolve()
            if full_path and candidate.is_file() and str(candidate).startswith(str(frontend_dist.resolve())):
                return FileResponse(candidate)
            return FileResponse(frontend_dist / "index.html")

    return app


app = create_app()
