"""Advanced settings: part material choices (app database) and certification templates (ShopKeeper)."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.schemas.settings import (
    CertTemplateCreateIn,
    CertTemplateOut,
    CertTemplateUpdateIn,
    MaterialActiveIn,
    MaterialAddIn,
    MaterialOptionOut,
    MaterialOrderIn,
)
from app.services import cert_templates, materials

router = APIRouter(prefix="/settings", tags=["settings"])


def _materials_out(rows) -> list[MaterialOptionOut]:
    return [MaterialOptionOut.model_validate(row) for row in rows]


@router.get("/materials", response_model=list[MaterialOptionOut])
def list_materials(include_hidden: bool = Query(False), db: Session = Depends(get_db)) -> list[MaterialOptionOut]:
    return _materials_out(materials.list_options(db, include_hidden=include_hidden))


@router.post("/materials", response_model=list[MaterialOptionOut], status_code=201)
def add_material(payload: MaterialAddIn, db: Session = Depends(get_db)) -> list[MaterialOptionOut]:
    return _materials_out(materials.add_option(db, payload.name))


# Registered before /materials/{option_id} so "order" is not read as an id.
@router.put("/materials/order", response_model=list[MaterialOptionOut])
def reorder_materials(payload: MaterialOrderIn, db: Session = Depends(get_db)) -> list[MaterialOptionOut]:
    return _materials_out(materials.reorder(db, payload.ids))


@router.put("/materials/{option_id}", response_model=list[MaterialOptionOut])
def set_material_active(option_id: int, payload: MaterialActiveIn, db: Session = Depends(get_db)) -> list[MaterialOptionOut]:
    return _materials_out(materials.set_active(db, option_id, payload.active))


@router.get("/cert-templates", response_model=list[CertTemplateOut])
def list_cert_templates() -> list[dict]:
    return cert_templates.list_templates()


@router.post("/cert-templates", response_model=list[CertTemplateOut], status_code=201)
def create_cert_template(payload: CertTemplateCreateIn) -> list[dict]:
    return cert_templates.create_template(payload.id, payload.description, payload.text)


# IDs can contain spaces and slashes (e.g. "0250-70351 Type II"), so take the rest of the path.
@router.put("/cert-templates/{ctxt_id:path}", response_model=list[CertTemplateOut])
def update_cert_template(ctxt_id: str, payload: CertTemplateUpdateIn) -> list[dict]:
    return cert_templates.update_template(ctxt_id, payload.description, payload.text, payload.rowversion)
