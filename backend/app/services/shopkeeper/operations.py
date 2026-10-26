from __future__ import annotations

import re
import shutil
from datetime import datetime
from pathlib import Path

from sqlalchemy.orm import Session

from app.config import get_settings
from app.exceptions import AppError, NotFoundError
from app.models.po_line_item import PoLineItem
from app.models.po_request import PoRequest
from app.schemas.operations import (
    CertTextOut,
    CreatePrintOut,
    JobHeaderIn,
    JobPageOut,
    OperationOut,
    OpTemplateOut,
    PartEditorOut,
    PartHeaderIn,
    PartListResponse,
    PartListRowOut,
    PartPictureOut,
    WorkCenterOut,
)
from app.services.po_service import to_detail
from app.services.print.documents import build_certification_pdf, build_traveler_pdf
from app.services.shopkeeper import get_shopkeeper_provider
from app.services.shopkeeper.ops_util import note_plain_text, note_to_shopkeeper_html, operation_from_payload
from app.services.shopkeeper.provider import ShopKeeperProvider
from app.services.shopkeeper.lookup import normalize_part_search_by
from app.services.shopkeeper.types import CreatePrintResult, JobHeaderUpdate, PartHeaderUpdate
from app.services.shopkeeper.writer import create_job_for_line


def create_job_and_print(
    db: Session,
    po: PoRequest,
    line: PoLineItem,
    provider: ShopKeeperProvider | None = None,
) -> tuple[PoLineItem, CreatePrintResult]:
    provider = provider or get_shopkeeper_provider()
    line = create_job_for_line(db, po, line, provider)
    result = _print_readiness(provider, line.erp_job_number or "", line.cert_required, line.resolved_pm_linkid)
    result.printed = not result.missing_ops and not result.missing_cert
    line.erp_traveler_printed = False
    return line, result


def create_job_response(po: PoRequest, result: CreatePrintResult) -> CreatePrintOut:
    return CreatePrintOut(
        po=to_detail(po),
        job_number=result.job_number,
        printed=result.printed,
        missing_ops=result.missing_ops,
        missing_cert=result.missing_cert,
        print_error=result.print_error,
        pm_linkid=result.pm_linkid,
    )


def get_job_page(db: Session, job_number: str, provider: ShopKeeperProvider | None = None) -> JobPageOut:
    provider = provider or get_shopkeeper_provider()
    job = provider.get_job_page(job_number)
    if job is None:
        raise NotFoundError("Job not found.")
    missing_ops = len(job.operations) == 0
    missing_cert = job.cert_required and not job.cert_linked
    po_id, line_id = _local_line(db, job_number)
    return JobPageOut(
        job_number=job.job_number,
        customer_code=job.customer_code,
        customer_name=job.customer_name,
        po_number=job.po_number,
        po_line=job.po_line,
        part_number=job.part_number,
        part_revision=job.part_revision,
        pm_linkid=job.pm_linkid,
        description=job.description,
        quantity=job.quantity,
        unit=job.unit,
        unit_price=job.unit_price,
        due_date=job.due_date,
        order_date=job.order_date,
        notes=note_plain_text(job.notes),
        cert_required=job.cert_required,
        cert_linked=job.cert_linked,
        quality_hold=job.quality_hold,
        status=job.status,
        shipper_number=job.shipper_number,
        traveler_printed=job.traveler_printed,
        operations=_ops_out(job.operations),
        print_ready=not missing_ops and not missing_cert,
        missing_ops=missing_ops,
        missing_cert=missing_cert,
        po_id=po_id,
        line_id=line_id,
        work_centers=[WorkCenterOut.model_validate(row, from_attributes=True) for row in provider.list_work_centers()],
        templates=[OpTemplateOut.model_validate(row, from_attributes=True) for row in provider.list_op_templates()],
        pictures=[PartPictureOut.model_validate(row, from_attributes=True) for row in (job.pictures or [])],
    )


def save_job_header(
    db: Session,
    job_number: str,
    payload: JobHeaderIn,
    provider: ShopKeeperProvider | None = None,
) -> JobPageOut:
    provider = provider or get_shopkeeper_provider()
    db.flush()
    provider.update_job_header(
        job_number,
        JobHeaderUpdate(
            customer_code=payload.customer_code,
            po_number=payload.po_number,
            po_line=payload.po_line,
            part_number=payload.part_number,
            part_revision=payload.part_revision,
            description=payload.description,
            quantity=payload.quantity,
            unit=payload.unit,
            unit_price=payload.unit_price,
            order_date=payload.order_date,
            notes=note_to_shopkeeper_html(payload.notes),
            cert_required=payload.cert_required,
        ),
    )
    line = next(
        (row for row in db.query(PoLineItem).all() if (row.erp_job_number or "") == job_number),
        None,
    )
    if line:
        page = provider.get_job_page(job_number)
        line.customer_part_number = payload.part_number
        line.revision = payload.part_revision
        line.description = payload.description
        line.quantity = payload.quantity
        line.unit_price = payload.unit_price
        line.uom = payload.unit
        line.cert_required = payload.cert_required
        line.resolved_customer_code = payload.customer_code
        line.resolved_part_number = payload.part_number
        line.resolved_part_revision = payload.part_revision
        if page is not None:
            line.resolved_pm_linkid = page.pm_linkid
        db.flush()
    return get_job_page(db, job_number, provider)


def save_job_operations(job_number: str, payload, provider: ShopKeeperProvider | None = None) -> list[OperationOut]:
    provider = provider or get_shopkeeper_provider()
    ops = [operation_from_payload(row) for row in payload.operations]
    saved = provider.save_job_operations(job_number, ops)
    return _ops_out(saved)


def copy_template(job_number: str, template_id: int, provider: ShopKeeperProvider | None = None) -> list[OperationOut]:
    provider = provider or get_shopkeeper_provider()
    saved = provider.replace_job_ops_from_template(job_number, template_id)
    return _ops_out(saved)


def copy_part_instructions(job_number: str, provider: ShopKeeperProvider | None = None) -> list[OperationOut]:
    provider = provider or get_shopkeeper_provider()
    saved = provider.replace_job_ops_from_part(job_number)
    return _ops_out(saved)


def copy_part_template(pm_linkid: int, template_id: int, provider: ShopKeeperProvider | None = None) -> list[OperationOut]:
    provider = provider or get_shopkeeper_provider()
    saved = provider.replace_part_ops_from_template(pm_linkid, template_id)
    return _ops_out(saved)


def _job_ready_to_print(job_number: str, provider: ShopKeeperProvider):
    job = provider.get_job_page(job_number)
    if job is None:
        raise NotFoundError("Job not found.")
    result = _print_readiness(provider, job_number, job.cert_required, job.pm_linkid)
    if result.missing_ops or result.missing_cert:
        raise AppError(
            "Cannot print until the job has operations"
            + (" and a linked certification." if result.missing_cert else "."),
            status_code=409,
        )
    return job


def _build_print_pdf(job_number: str, builder, provider: ShopKeeperProvider) -> bytes:
    try:
        return builder(provider.load_print_data(job_number))
    except AppError:
        raise
    except Exception as exc:
        raise AppError(str(exc), status_code=502) from exc


def traveler_pdf(job_number: str, provider: ShopKeeperProvider | None = None) -> bytes:
    provider = provider or get_shopkeeper_provider()
    _job_ready_to_print(job_number, provider)
    return _build_print_pdf(job_number, build_traveler_pdf, provider)


def certification_pdf(job_number: str, provider: ShopKeeperProvider | None = None) -> bytes:
    provider = provider or get_shopkeeper_provider()
    job = _job_ready_to_print(job_number, provider)
    if not job.cert_required:
        raise AppError("Certification is not required for this job.", status_code=409)
    return _build_print_pdf(job_number, build_certification_pdf, provider)


def mark_traveler_printed(
    db: Session,
    job_number: str,
    provider: ShopKeeperProvider | None = None,
) -> None:
    provider = provider or get_shopkeeper_provider()
    _job_ready_to_print(job_number, provider)
    provider.mark_traveler_printed(job_number)
    line = db.query(PoLineItem).filter(PoLineItem.erp_job_number == job_number).first()
    if line:
        line.erp_traveler_printed = True


def print_job(
    db: Session,
    job_number: str,
    provider: ShopKeeperProvider | None = None,
) -> bytes:
    provider = provider or get_shopkeeper_provider()
    pdf = traveler_pdf(job_number, provider)
    mark_traveler_printed(db, job_number, provider)
    return pdf


def get_part_editor(pm_linkid: int, provider: ShopKeeperProvider | None = None) -> PartEditorOut:
    provider = provider or get_shopkeeper_provider()
    part = provider.get_part_editor(pm_linkid)
    if part is None:
        raise NotFoundError("Part not found.")
    return PartEditorOut(
        pm_linkid=part.pm_linkid,
        part_number=part.part_number,
        part_revision=part.part_revision,
        description=part.description,
        customer_code=part.customer_code,
        locked=part.locked,
        quality_hold=part.quality_hold,
        quality_hold_note=part.quality_hold_note,
        fa_hold=part.fa_hold,
        ship_hold=part.ship_hold,
        operations=_ops_out(part.operations),
        pictures=[PartPictureOut.model_validate(row, from_attributes=True) for row in part.pictures],
        linked_certs=[CertTextOut.model_validate(row, from_attributes=True) for row in part.linked_certs],
        cert_library=[CertTextOut.model_validate(row, from_attributes=True) for row in provider.list_certification_texts()],
        work_centers=[WorkCenterOut.model_validate(row, from_attributes=True) for row in provider.list_work_centers()],
        templates=[OpTemplateOut.model_validate(row, from_attributes=True) for row in provider.list_op_templates()],
    )


def list_parts(
    *,
    query: str | None,
    search_by: str,
    page: int,
    page_size: int,
    provider: ShopKeeperProvider | None = None,
) -> PartListResponse:
    provider = provider or get_shopkeeper_provider()
    field = normalize_part_search_by(search_by)
    rows, total = provider.list_parts(query=query, search_by=field, page=page, page_size=page_size)
    return PartListResponse(
        items=[PartListRowOut.model_validate(row, from_attributes=True) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
        query=query,
        search_by=field,
    )


def create_part(payload: PartHeaderIn, provider: ShopKeeperProvider | None = None) -> PartEditorOut:
    provider = provider or get_shopkeeper_provider()
    header = _part_header(payload, provider)
    pm_linkid = provider.create_part(header)
    return get_part_editor(pm_linkid, provider)


def update_part_header(
    pm_linkid: int,
    payload: PartHeaderIn,
    provider: ShopKeeperProvider | None = None,
) -> PartEditorOut:
    provider = provider or get_shopkeeper_provider()
    header = _part_header(payload, provider)
    provider.update_part_header(pm_linkid, header)
    return get_part_editor(pm_linkid, provider)


def _part_header(payload: PartHeaderIn, provider: ShopKeeperProvider) -> PartHeaderUpdate:
    number = (payload.part_number or "").strip()
    if not number:
        raise AppError("Part number is required.")
    revision = (payload.part_revision or "").strip() or "-"
    code = (payload.customer_code or "").strip()
    if not code:
        raise AppError("Customer code is required.")
    customer = provider.get_customer(code)
    if customer is None:
        raise AppError("ShopKeeper customer not found.")
    description = (payload.description or "").strip() or number
    return PartHeaderUpdate(
        part_number=number,
        part_revision=revision,
        customer_code=customer.customer_number,
        description=description,
    )


def save_part_operations(pm_linkid: int, payload, provider: ShopKeeperProvider | None = None) -> list[OperationOut]:
    provider = provider or get_shopkeeper_provider()
    ops = [operation_from_payload(row) for row in payload.operations]
    saved = provider.save_part_operations(pm_linkid, ops)
    return _ops_out(saved)


def set_quality_hold(pm_linkid: int, hold: bool, note: str | None, provider: ShopKeeperProvider | None = None) -> None:
    provider = provider or get_shopkeeper_provider()
    provider.set_part_quality_hold(pm_linkid, hold, note)


def link_cert(pm_linkid: int, ctxt_id: str, provider: ShopKeeperProvider | None = None) -> None:
    provider = provider or get_shopkeeper_provider()
    provider.link_part_cert(pm_linkid, ctxt_id)


def unlink_cert(pm_linkid: int, ctxt_id: str, provider: ShopKeeperProvider | None = None) -> None:
    provider = provider or get_shopkeeper_provider()
    provider.unlink_part_cert(pm_linkid, ctxt_id)


def add_picture(
    pm_linkid: int,
    source: Path,
    original_name: str,
    provider: ShopKeeperProvider | None = None,
) -> PartPictureOut:
    provider = provider or get_shopkeeper_provider()
    part = provider.get_part_editor(pm_linkid)
    if part is None:
        raise NotFoundError("Part not found.")
    dest_dir = _photos_dir()
    dest_dir.mkdir(parents=True, exist_ok=True)
    safe = _safe_filename(original_name or source.name)
    stamp = datetime.now().strftime("%Y%m%d%H%M%S")
    dest_name = f"{_safe_filename(part.part_number)}_{_safe_filename(part.part_revision)}_{stamp}_{safe}"
    dest = dest_dir / dest_name
    try:
        shutil.copy2(source, dest)
    except OSError as exc:
        raise AppError(f"Could not copy the picture onto the PartPhotos share: {exc}", status_code=502) from exc
    pic = provider.add_part_picture(pm_linkid, str(dest), Path(original_name).stem)
    return PartPictureOut.model_validate(pic, from_attributes=True)


def unlink_picture(pm_linkid: int, pmp_id: int, provider: ShopKeeperProvider | None = None) -> None:
    provider = provider or get_shopkeeper_provider()
    provider.unlink_part_picture(pm_linkid, pmp_id)


def picture_path(pm_linkid: int, pmp_id: int, provider: ShopKeeperProvider | None = None) -> Path:
    provider = provider or get_shopkeeper_provider()
    part = provider.get_part_editor(pm_linkid)
    if part is None:
        raise NotFoundError("Part not found.")
    pic = next((row for row in part.pictures if row.id == pmp_id), None)
    if pic is None:
        raise NotFoundError("Picture not found.")
    path = Path(pic.path)
    if not path.exists():
        raise NotFoundError("Picture file is missing from the PartPhotos share.")
    return path


def _print_readiness(
    provider: ShopKeeperProvider,
    job_number: str,
    cert_required: bool,
    pm_linkid: int | None,
) -> CreatePrintResult:
    op_count = provider.job_op_count(job_number)
    cert_linked = provider.part_has_certification(pm_linkid) if pm_linkid else False
    missing_ops = op_count == 0
    missing_cert = bool(cert_required) and not cert_linked
    return CreatePrintResult(
        job_number=job_number,
        printed=False,
        missing_ops=missing_ops,
        missing_cert=missing_cert,
        pm_linkid=pm_linkid,
    )


def _ops_out(rows) -> list[OperationOut]:
    out: list[OperationOut] = []
    for row in rows:
        item = OperationOut.model_validate(row, from_attributes=True)
        out.append(item.model_copy(update={"note": note_plain_text(item.note)}))
    return out


def _local_line(db: Session, job_number: str) -> tuple[int | None, int | None]:
    line = db.query(PoLineItem).filter(PoLineItem.erp_job_number == job_number).first()
    if not line:
        return None, None
    return line.po_request_id, line.id


def _photos_dir() -> Path:
    settings = get_settings()
    value = (settings.part_photos_dir or "").strip()
    if value:
        return Path(value)
    if settings.shopkeeper_provider.strip().lower() == "fake":
        return settings.pdf_storage_path.parent / "part-photos"
    raise AppError("Part photos folder is not configured.", status_code=409)


def _safe_filename(name: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("._")
    return cleaned or "picture"
