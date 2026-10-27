from pathlib import Path

from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from app.database.session import get_db
from app.exceptions import AppError
from app.schemas.operations import (
    CopyTemplateIn,
    CreatePrintOut,
    JobHeaderIn,
    JobPageOut,
    LinkCertIn,
    LinkPictureIn,
    OperationOut,
    OperationsSaveIn,
    OpTemplateOut,
    PartEditorOut,
    PartHeaderIn,
    PartListResponse,
    PartPictureOut,
    QualityHoldIn,
    WorkCenterOut,
)
from app.services.po_service import get_po
from app.services.shopkeeper.operations import (
    add_picture,
    certification_pdf,
    copy_part_instructions,
    copy_part_template,
    copy_template,
    create_job_and_print,
    create_job_response,
    get_job_page,
    get_part_editor,
    create_part,
    list_parts,
    link_cert,
    mark_traveler_printed,
    picture_path,
    traveler_pdf,
    save_job_header,
    save_job_operations,
    save_part_operations,
    set_quality_hold,
    update_part_header,
    unlink_cert,
    unlink_picture,
)
from app.services.shopkeeper.writer import delete_shopkeeper_job, get_line
from app.services.shopkeeper import get_shopkeeper_provider

router = APIRouter(tags=["operations"])


@router.get("/shopkeeper/work-centers", response_model=list[WorkCenterOut])
def work_centers() -> list[WorkCenterOut]:
    return get_shopkeeper_provider().list_work_centers()


@router.get("/shopkeeper/op-templates", response_model=list[OpTemplateOut])
def op_templates() -> list[OpTemplateOut]:
    return get_shopkeeper_provider().list_op_templates()


@router.post("/po/{po_id}/lines/{line_id}/create-job", response_model=CreatePrintOut)
def line_create_job(po_id: int, line_id: int, db: Session = Depends(get_db)) -> CreatePrintOut:
    po = get_po(db, po_id)
    line = get_line(po, line_id)
    try:
        line, result = create_job_and_print(db, po, line)
    except AppError:
        db.commit()
        raise
    db.commit()
    db.refresh(po)
    return create_job_response(po, result)


@router.get("/jobs/{job_number}", response_model=JobPageOut)
def job_page(job_number: str, db: Session = Depends(get_db)) -> JobPageOut:
    return get_job_page(db, job_number)


@router.delete("/jobs/{job_number}", status_code=204)
def job_delete(job_number: str, db: Session = Depends(get_db)) -> None:
    try:
        delete_shopkeeper_job(db, job_number)
    except AppError:
        db.commit()
        raise
    db.commit()


@router.put("/jobs/{job_number}", response_model=JobPageOut)
def job_save_header(job_number: str, payload: JobHeaderIn, db: Session = Depends(get_db)) -> JobPageOut:
    result = save_job_header(db, job_number, payload)
    db.commit()
    return result


@router.put("/jobs/{job_number}/operations", response_model=list[OperationOut])
def job_save_ops(job_number: str, payload: OperationsSaveIn) -> list[OperationOut]:
    return save_job_operations(job_number, payload)


@router.post("/jobs/{job_number}/copy-template", response_model=list[OperationOut])
def job_copy_template(job_number: str, payload: CopyTemplateIn) -> list[OperationOut]:
    return copy_template(job_number, payload.template_id)


@router.post("/jobs/{job_number}/copy-part-ops", response_model=list[OperationOut])
def job_copy_part_ops(job_number: str) -> list[OperationOut]:
    return copy_part_instructions(job_number)


def _pdf_response(pdf: bytes, filename: str) -> Response:
    safe = filename.replace('"', "").replace("\r", "").replace("\n", "")
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{safe}"'},
    )


@router.get("/jobs/{job_number}/print/traveler")
def job_traveler_pdf(job_number: str) -> Response:
    return _pdf_response(traveler_pdf(job_number), f"traveler-{job_number}.pdf")


@router.get("/jobs/{job_number}/print/certification")
def job_certification_pdf(job_number: str) -> Response:
    return _pdf_response(certification_pdf(job_number), f"cert-{job_number}.pdf")


@router.post("/jobs/{job_number}/print/mark-traveler", status_code=204)
def job_mark_traveler(job_number: str, db: Session = Depends(get_db)) -> None:
    mark_traveler_printed(db, job_number)
    db.commit()


@router.get("/parts", response_model=PartListResponse)
def parts_list(
    q: str | None = Query(None),
    search_by: str = Query("part"),
    page: int = Query(1, ge=1),
    page_size: int = Query(300, ge=1, le=300),
) -> PartListResponse:
    return list_parts(query=q, search_by=search_by, page=page, page_size=page_size)


@router.post("/parts", response_model=PartEditorOut, status_code=201)
def parts_create(payload: PartHeaderIn) -> PartEditorOut:
    return create_part(payload)


@router.get("/parts/{pm_linkid}", response_model=PartEditorOut)
def part_editor(pm_linkid: int) -> PartEditorOut:
    return get_part_editor(pm_linkid)


@router.put("/parts/{pm_linkid}", response_model=PartEditorOut)
def part_save_header(pm_linkid: int, payload: PartHeaderIn) -> PartEditorOut:
    return update_part_header(pm_linkid, payload)


@router.put("/parts/{pm_linkid}/operations", response_model=list[OperationOut])
def part_save_ops(pm_linkid: int, payload: OperationsSaveIn) -> list[OperationOut]:
    return save_part_operations(pm_linkid, payload)


@router.post("/parts/{pm_linkid}/copy-template", response_model=list[OperationOut])
def part_copy_template(pm_linkid: int, payload: CopyTemplateIn) -> list[OperationOut]:
    return copy_part_template(pm_linkid, payload.template_id)


@router.post("/parts/{pm_linkid}/quality-hold", response_model=PartEditorOut)
def part_quality_hold(pm_linkid: int, payload: QualityHoldIn) -> PartEditorOut:
    set_quality_hold(pm_linkid, payload.hold, payload.note)
    return get_part_editor(pm_linkid)


@router.post("/parts/{pm_linkid}/certs", response_model=PartEditorOut)
def part_link_cert(pm_linkid: int, payload: LinkCertIn) -> PartEditorOut:
    link_cert(pm_linkid, payload.ctxt_id)
    return get_part_editor(pm_linkid)


@router.delete("/parts/{pm_linkid}/certs/{ctxt_id}", response_model=PartEditorOut)
def part_unlink_cert(pm_linkid: int, ctxt_id: str) -> PartEditorOut:
    unlink_cert(pm_linkid, ctxt_id)
    return get_part_editor(pm_linkid)


@router.post("/parts/{pm_linkid}/pictures", response_model=PartPictureOut)
def part_add_picture(pm_linkid: int, payload: LinkPictureIn) -> PartPictureOut:
    return add_picture(pm_linkid, payload.filename)


@router.delete("/parts/{pm_linkid}/pictures/{pmp_id}", response_model=PartEditorOut)
def part_unlink_picture(pm_linkid: int, pmp_id: int) -> PartEditorOut:
    unlink_picture(pm_linkid, pmp_id)
    return get_part_editor(pm_linkid)


@router.get("/parts/{pm_linkid}/pictures/{pmp_id}")
def part_get_picture(pm_linkid: int, pmp_id: int) -> FileResponse:
    path = picture_path(pm_linkid, pmp_id)
    return FileResponse(path)
