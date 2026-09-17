from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database.session import get_db

router = APIRouter(tags=["health"])


@router.get("/health")
def health(db: Session = Depends(get_db)) -> dict:
    db.execute(text("SELECT 1"))
    settings = get_settings()
    return {
        "status": "ok",
        "extraction_provider": settings.extraction_provider,
        "anthropic_configured": bool(settings.anthropic_api_key),
        "anthropic_model": settings.anthropic_model,
    }
