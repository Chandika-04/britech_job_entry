"""Material choices for parts (app-owned list; the chosen name is stored in ShopKeeper Pm_MaterialNote)."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.exceptions import AppError, ConflictError, NotFoundError
from app.models.part_material import PartMaterialOption

DEFAULT_MATERIALS = (
    "303 SST",
    "304 SST",
    "316 SST",
    "300 series",
    "403 SST",
    "416 SST",
    "400 series",
    "Aluminum",
    "Copper",
    "UC Nickel",
    "Nitronic",
    "Other",
    "Unknown",
)
MAX_NAME = 40


def _ensure_seeded(db: Session) -> None:
    if db.scalar(select(func.count()).select_from(PartMaterialOption)):
        return
    db.add_all(PartMaterialOption(name=name, sort_order=index, active=True) for index, name in enumerate(DEFAULT_MATERIALS))
    db.commit()


def list_options(db: Session, *, include_hidden: bool = False) -> list[PartMaterialOption]:
    _ensure_seeded(db)
    stmt = select(PartMaterialOption).order_by(PartMaterialOption.sort_order, PartMaterialOption.id)
    if not include_hidden:
        stmt = stmt.where(PartMaterialOption.active.is_(True))
    return list(db.scalars(stmt))


def _clean_name(name: str | None) -> str:
    clean = " ".join((name or "").split())
    if not clean:
        raise AppError("Type a material name.", status_code=422)
    if len(clean) > MAX_NAME:
        raise AppError(f"Material names can be at most {MAX_NAME} characters.", status_code=422)
    return clean


def _find_by_name(db: Session, name: str) -> PartMaterialOption | None:
    return db.scalar(select(PartMaterialOption).where(func.lower(PartMaterialOption.name) == name.lower()))


def add_option(db: Session, name: str) -> list[PartMaterialOption]:
    _ensure_seeded(db)
    clean = _clean_name(name)
    existing = _find_by_name(db, clean)
    if existing is not None:
        if existing.active:
            raise ConflictError(f"{existing.name} is already on the list.")
        existing.active = True  # adding a hidden material shows it again
    else:
        last = db.scalar(select(func.max(PartMaterialOption.sort_order))) or 0
        db.add(PartMaterialOption(name=clean, sort_order=last + 1, active=True))
    db.commit()
    return list_options(db, include_hidden=True)


def set_active(db: Session, option_id: int, active: bool) -> list[PartMaterialOption]:
    option = db.get(PartMaterialOption, option_id)
    if option is None:
        raise NotFoundError("Material not found.")
    if not active and len(list_options(db)) <= 1 and option.active:
        raise AppError("Keep at least one material on the list.", status_code=422)
    option.active = active
    db.commit()
    return list_options(db, include_hidden=True)


def reorder(db: Session, ids: list[int]) -> list[PartMaterialOption]:
    options = {row.id: row for row in list_options(db, include_hidden=True)}
    if sorted(ids) != sorted(options):
        raise AppError("The material list changed. Reload and try again.", status_code=409)
    for index, option_id in enumerate(ids):
        options[option_id].sort_order = index
    db.commit()
    return list_options(db, include_hidden=True)


def resolve_part_material(db: Session, value: str | None, current: str | None = None) -> str:
    """The material to save on a part: required, and one of the listed choices.

    A part whose stored material is not on the list (older data) can keep it unchanged.
    """
    clean = " ".join((value or "").split())
    if not clean:
        raise AppError("Material is required. Pick one from the list.", status_code=422)
    match = next((row.name for row in list_options(db) if row.name.casefold() == clean.casefold()), None)
    if match:
        return match
    if current and clean == " ".join(current.split()):
        return current
    raise AppError(f"{clean} is not on the material list. Add it in Advanced settings first.", status_code=422)
