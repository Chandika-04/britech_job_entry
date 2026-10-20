from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from app.exceptions import AppError, ConflictError
from app.services.shopkeeper.lookup import normalize_part_search_by
from app.services.shopkeeper.ops_util import rowversion_bytes, rowversion_hex
from app.services.shopkeeper.types import (
    CertText,
    JobHeaderUpdate,
    JobPageRecord,
    OperationRow,
    OpTemplate,
    PartEditorRecord,
    PartHeaderUpdate,
    PartMasterListRow,
    PartPicture,
    PrintDocumentData,
    WorkCenter,
)


OP_SELECT = """
SELECT Os_ID, Os_SeqNum, Os_WCCode, Os_Description, Os_Note, Os_RunTime, Os_SetupTime,
       COALESCE(Os_Subcontract, 0), Os_ProcessCode, Os_Process, COALESCE(Os_FA, 0),
       Os_Qty, Os_SchedDays, Os_OMLink, SSMA_TimeStamp
FROM dbo.OpStatus
WHERE Os_JobNum = ? AND Os_ReleaseNum = 1
ORDER BY Os_SeqNum
"""

PART_OP_SELECT = """
SELECT Om_LinkID, Om_SeqNum, Om_WCCode, Om_Description, Om_Note, Om_RunTime, Om_SetupTime,
       COALESCE(Om_Subcontract, 0), Om_ProcessCode, Om_Process, COALESCE(Om_FA, 0),
       Om_Qty, Om_SchedDays, Om_LinkID, SSMA_TimeStamp
FROM dbo.OpMaster
WHERE Om_PmLinkID = ?
ORDER BY Om_SeqNum
"""

JOB_OP_CHILDREN = """
SELECT 1 FROM dbo.OpStatus os
WHERE os.Os_ID = ?
  AND (
    EXISTS (SELECT 1 FROM dbo.ScheduledOps WHERE SchO_OSId = os.Os_ID)
    OR EXISTS (SELECT 1 FROM dbo.TimeCard WHERE Tc_Os_ID = os.Os_ID)
    OR EXISTS (SELECT 1 FROM dbo.TimeClock WHERE Tk_OsID = os.Os_ID)
    OR EXISTS (SELECT 1 FROM dbo.QcInspectLog WHERE QcL_OpStatusLinkID = os.Os_ID)
  )
"""

PART_OP_CHILDREN = """
SELECT 1 FROM dbo.OpMaster om
WHERE om.Om_LinkID = ?
  AND (
    EXISTS (SELECT 1 FROM dbo.Tooling WHERE Tool_OmLinkID = om.Om_LinkID)
    OR EXISTS (SELECT 1 FROM dbo.OpMasterObjects WHERE Omo_OmLinkID = om.Om_LinkID)
    OR EXISTS (SELECT 1 FROM dbo.QcFeatures WHERE Qcf_OMLinkID = om.Om_LinkID)
    OR EXISTS (SELECT 1 FROM dbo.QcInspectRequirements WHERE QcIr_OMLinkID = om.Om_LinkID)
  )
"""


def _as_bool(value: object) -> bool:
    return bool(value) if value is not None else False


def _as_optional_str(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _is_unique_conflict(exc: Exception) -> bool:
    text = str(exc)
    return "(2627)" in text or "(2601)" in text or "UNIQUE KEY" in text.upper() or "duplicate key" in text.lower()


def _as_int(value: object) -> int | None:
    if value is None:
        return None
    return int(value)


def _as_float(value: object) -> float | None:
    if value is None:
        return None
    return float(value)


def _row_to_op(row) -> OperationRow:
    return OperationRow(
        id=int(row[0]),
        seq_num=float(row[1] or 0),
        wc_code=str(row[2] or "").strip(),
        description=row[3],
        note=row[4],
        run_time=_as_float(row[5]),
        setup_time=_as_float(row[6]),
        subcontract=_as_bool(row[7]),
        process_code=row[8],
        process=_as_int(row[9]),
        fa=_as_bool(row[10]),
        qty=_as_float(row[11]),
        sched_days=_as_int(row[12]),
        om_link=_as_int(row[13]),
        rowversion=rowversion_hex(row[14]),
    )


class SqlServerOpsMixin:
    def job_op_count(self, job_number: str) -> int:
        conn, _ = self._connect()
        try:
            row = conn.cursor().execute(
                "SELECT COUNT(*) FROM dbo.OpStatus WHERE Os_JobNum = ? AND Os_ReleaseNum = 1",
                job_number,
            ).fetchone()
            return int(row[0] if row else 0)
        finally:
            conn.close()

    def part_has_certification(self, pm_linkid: int) -> bool:
        conn, _ = self._connect()
        try:
            row = conn.cursor().execute(
                "SELECT TOP 1 1 FROM dbo.CertificationItems WHERE CItm_PMLinkID = ?",
                pm_linkid,
            ).fetchone()
            return bool(row)
        finally:
            conn.close()

    def list_work_centers(self) -> list[WorkCenter]:
        conn, _ = self._connect()
        try:
            rows = conn.cursor().execute(
                """
                SELECT Wc_Name, Wc_Description, COALESCE(Wc_Inactive, 0)
                FROM dbo.WorkCenters
                ORDER BY Wc_Sortby, Wc_Name
                """
            ).fetchall()
            return [
                WorkCenter(str(row[0]).strip(), row[1], _as_bool(row[2]))
                for row in rows
            ]
        finally:
            conn.close()

    def list_op_templates(self) -> list[OpTemplate]:
        conn, _ = self._connect()
        try:
            rows = conn.cursor().execute(
                """
                SELECT m.Omm_ID, m.Omm_Code, m.Omm_Description, COALESCE(m.Omm_Sort, 0),
                       (SELECT COUNT(*) FROM dbo.OpMasterMasterOps o WHERE o.Om_MmLinkID = m.Omm_ID)
                FROM dbo.OpMasterMasters m
                ORDER BY COALESCE(m.Omm_Sort, 0), m.Omm_Code
                """
            ).fetchall()
            return [
                OpTemplate(int(row[0]), str(row[1] or "").strip(), row[2], int(row[3] or 0), int(row[4] or 0))
                for row in rows
            ]
        finally:
            conn.close()

    def list_certification_texts(self) -> list[CertText]:
        conn, _ = self._connect()
        try:
            rows = conn.cursor().execute(
                "SELECT CTxt_ID, CTxt_Description FROM dbo.CertificationText ORDER BY CTxt_ID"
            ).fetchall()
            return [CertText(str(row[0]).strip(), row[1], None) for row in rows]
        finally:
            conn.close()

    def get_job_page(self, job_number: str) -> JobPageRecord | None:
        conn, _ = self._connect()
        try:
            cur = conn.cursor()
            row = cur.execute(
                """
                SELECT j.Jb_Job_Num, j.Jb_Cust_Code, c.Company, j.Jb_PO_Num, s.Sh_PO_Line,
                       j.Jb_Part_Num, j.Jb_Part_Rev, r.Jr_PartMasterLink, j.Jb_Part_Desc,
                       j.Jb_Qty_Order, j.Jb_Unit, j.Jb_Price, s.Sh_Due_Date,
                       COALESCE(j.Jb_Cert_Required, 0), j.Jb_Status, s.Sh_Ship_Num,
                       COALESCE(r.Jr_TravelerPrinted, 0), COALESCE(p.Pm_QualityHold, 0),
                       j.Jb_Order_Date, j.Jb_Note
                FROM dbo.Jobs j
                JOIN dbo.JobShip s ON s.Sh_Job_Num = j.Jb_Job_Num AND s.Sh_ReleaseInt = 1
                JOIN dbo.JobRelease r ON r.Jr_JobNum = j.Jb_Job_Num AND r.Jr_ReleaseNum = 1
                LEFT JOIN dbo.Customers c ON c.[Customer Number] = j.Jb_Cust_Code
                LEFT JOIN dbo.PartMaster p ON p.Pm_LinkID = r.Jr_PartMasterLink
                WHERE j.Jb_Job_Num = ?
                """,
                job_number,
            ).fetchone()
            if not row:
                return None
            pm_linkid = int(row[7]) if row[7] is not None else None
            cert_linked = False
            if pm_linkid is not None:
                cert_linked = bool(
                    cur.execute(
                        "SELECT TOP 1 1 FROM dbo.CertificationItems WHERE CItm_PMLinkID = ?",
                        pm_linkid,
                    ).fetchone()
                )
            ops = [_row_to_op(item) for item in cur.execute(OP_SELECT, job_number).fetchall()]
            pics: list[PartPicture] = []
            if pm_linkid is not None:
                pics = [
                    PartPicture(int(item[0]), str(item[1] or ""), item[2], _as_bool(item[3]), _as_int(item[4]))
                    for item in cur.execute(
                        """
                        SELECT Pmp_ID, Pmp_PictureName, Pmp_PictureDesc, COALESCE(Pmp_PrintOnTrav, 0), Pmp_SortOrder
                        FROM dbo.PartMasterPics
                        WHERE Pmp_PmLinkID = ?
                        ORDER BY Pmp_SortOrder, Pmp_ID
                        """,
                        pm_linkid,
                    )
                ]
            due = row[12]
            if isinstance(due, datetime):
                due = due.date()
            ordered = row[18]
            if isinstance(ordered, datetime):
                ordered = ordered.date()
            return JobPageRecord(
                job_number=str(row[0]).strip(),
                customer_code=str(row[1] or "").strip(),
                customer_name=row[2],
                po_number=str(row[3] or "").strip(),
                po_line=str(row[4]).strip() if row[4] is not None else None,
                part_number=str(row[5] or "").strip(),
                part_revision=str(row[6] or "").strip(),
                pm_linkid=pm_linkid,
                description=row[8],
                quantity=int(row[9]) if row[9] is not None else None,
                unit=row[10],
                unit_price=Decimal(str(row[11])) if row[11] is not None else None,
                due_date=due,
                cert_required=_as_bool(row[13]),
                cert_linked=cert_linked,
                quality_hold=_as_bool(row[17]),
                status=row[14],
                shipper_number=str(row[15]).strip() if row[15] else None,
                traveler_printed=_as_bool(row[16]),
                operations=ops,
                order_date=ordered,
                notes=row[19],
                pictures=pics,
            )
        finally:
            conn.close()

    def update_job_header(self, job_number: str, payload: JobHeaderUpdate) -> JobPageRecord:
        customer = self.get_customer(payload.customer_code.strip())
        if customer is None or not customer.active:
            raise AppError("ShopKeeper customer not found.", status_code=409)
        part = self.get_part(payload.part_number.strip(), payload.part_revision.strip())
        if part is None or part.inactive:
            raise AppError("ShopKeeper part not found.", status_code=409)
        ordered = datetime(payload.order_date.year, payload.order_date.month, payload.order_date.day)
        desc = (payload.description or part.description or "")[:75]
        unit = "Lot" if payload.unit.strip().lower() == "lot" else "Each"
        conn, _ = self._connect()
        try:
            cur = conn.cursor()
            job_ts = cur.execute(
                "SELECT SSMA_TimeStamp FROM dbo.Jobs WHERE Jb_Job_Num = ?",
                job_number,
            ).fetchone()
            if not job_ts:
                raise AppError("Job not found.", status_code=404)
            ship_row = cur.execute(
                "SELECT Sh_ID, SSMA_TimeStamp, Sh_Ship_Num FROM dbo.JobShip WHERE Sh_Job_Num = ? AND Sh_ReleaseInt = 1",
                job_number,
            ).fetchone()
            if not ship_row:
                raise AppError("Job ship line not found.", status_code=404)
            existing_shipper = str(ship_row[2]).strip() if ship_row[2] else None
            rel_ts = cur.execute(
                "SELECT SSMA_TimeStamp FROM dbo.JobRelease WHERE Jr_JobNum = ? AND Jr_ReleaseNum = 1",
                job_number,
            ).fetchone()
            if not rel_ts:
                raise AppError("Job release not found.", status_code=404)
            cur.execute(
                """
                UPDATE dbo.Jobs
                SET Jb_Cust_Code = ?, Jb_Shipto_Code = ?, Jb_PO_Num = ?,
                    Jb_Part_Num = ?, Jb_Part_Rev = ?, Jb_Part_Desc = ?,
                    Jb_Qty_Order = ?, Jb_Price = ?, Jb_Unit = ?, Jb_Cert_Required = ?,
                    Jb_Order_Date = ?, Jb_Note = ?
                WHERE Jb_Job_Num = ? AND SSMA_TimeStamp = ?
                """,
                customer.customer_number,
                customer.customer_number,
                payload.po_number.strip()[:20],
                part.part_number,
                part.part_revision,
                desc,
                payload.quantity,
                payload.unit_price,
                unit,
                1 if payload.cert_required else 0,
                ordered,
                payload.notes,
                job_number,
                job_ts[0],
            )
            if cur.rowcount != 1:
                raise AppError("Could not save the job (it was changed in ShopKeeper).", status_code=409)
            po_line = (payload.po_line or "").strip()[:10] or None
            if existing_shipper:
                cur.execute(
                    """
                    UPDATE dbo.JobShip
                    SET Sh_PO_Line = ?, Sh_Qty_Due = ?, Sh_Qty_Shipped = ?
                    WHERE Sh_ID = ? AND SSMA_TimeStamp = ?
                    """,
                    po_line,
                    payload.quantity,
                    payload.quantity,
                    ship_row[0],
                    ship_row[1],
                )
            else:
                cur.execute(
                    """
                    UPDATE dbo.JobShip
                    SET Sh_PO_Line = ?, Sh_Qty_Due = ?
                    WHERE Sh_ID = ? AND SSMA_TimeStamp = ?
                    """,
                    po_line,
                    payload.quantity,
                    ship_row[0],
                    ship_row[1],
                )
            if cur.rowcount != 1:
                raise AppError("Could not save the job ship line (it was changed in ShopKeeper).", status_code=409)
            cur.execute(
                """
                UPDATE dbo.JobRelease
                SET Jr_StartQty = ?, Jr_MinDueQty = ?, Jr_PartMasterLink = ?
                WHERE Jr_JobNum = ? AND Jr_ReleaseNum = 1 AND SSMA_TimeStamp = ?
                """,
                payload.quantity,
                payload.quantity,
                part.pm_linkid,
                job_number,
                rel_ts[0],
            )
            if cur.rowcount != 1:
                raise AppError("Could not save the job release (it was changed in ShopKeeper).", status_code=409)
            cur.execute(
                "UPDATE dbo.OpStatus SET Os_QtyToMake = ? WHERE Os_JobNum = ? AND Os_ReleaseNum = 1",
                payload.quantity,
                job_number,
            )
            cur.execute(
                "INSERT INTO dbo.LockInfo (Lk_Form, Lk_ID, Lk_Date, Lk_Initials, Lk_Comment) VALUES (?, ?, ?, ?, ?)",
                "Jobs",
                job_number,
                datetime.now(),
                "AUTO",
                "Job update via Automation",
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()
        job = self.get_job_page(job_number)
        if job is None:
            raise AppError("Job not found.", status_code=404)
        return job

    def save_job_operations(self, job_number: str, operations: list[OperationRow]) -> list[OperationRow]:
        conn, _ = self._connect()
        try:
            cur = conn.cursor()
            qty_row = cur.execute(
                "SELECT Jb_Qty_Order FROM dbo.Jobs WHERE Jb_Job_Num = ?",
                job_number,
            ).fetchone()
            if not qty_row:
                raise AppError("Job not found.", status_code=404)
            qty = int(qty_row[0] or 0)
            existing = {row.id: row for row in (_row_to_op(item) for item in cur.execute(OP_SELECT, job_number))}
            incoming_ids = {row.id for row in operations if row.id is not None}
            for op_id, row in existing.items():
                if op_id not in incoming_ids:
                    _assert_no_job_children(cur, op_id)
                    cur.execute("DELETE FROM dbo.OpStatus WHERE Os_ID = ?", op_id)
            for row in operations:
                _validate_wc(cur, row.wc_code)
                if row.id is None:
                    cur.execute(
                        """
                        INSERT INTO dbo.OpStatus (
                            Os_OMLink, Os_JobNum, Os_ReleaseNum, Os_SeqNum, Os_WCCode,
                            Os_Description, Os_RunTime, Os_SetupTime, Os_Subcontract,
                            Os_ProcessCode, Os_Process, Os_FA, Os_Note, Os_Qty, Os_SchedDays, Os_QtyToMake
                        ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        row.om_link or 0,
                        job_number,
                        row.seq_num,
                        row.wc_code,
                        row.description,
                        row.run_time or 0,
                        row.setup_time or 0,
                        1 if row.subcontract else 0,
                        row.process_code,
                        row.process,
                        1 if row.fa else 0,
                        row.note,
                        row.qty if row.qty is not None else 0,
                        row.sched_days or 0,
                        qty,
                    )
                else:
                    ts = rowversion_bytes(row.rowversion)
                    cur.execute(
                        """
                        UPDATE dbo.OpStatus
                        SET Os_SeqNum = ?, Os_WCCode = ?, Os_Description = ?, Os_Note = ?,
                            Os_RunTime = ?, Os_SetupTime = ?, Os_Subcontract = ?,
                            Os_ProcessCode = ?, Os_Process = ?, Os_FA = ?, Os_Qty = ?, Os_SchedDays = ?
                        WHERE Os_ID = ? AND Os_JobNum = ? AND SSMA_TimeStamp = ?
                        """,
                        row.seq_num,
                        row.wc_code,
                        row.description,
                        row.note,
                        row.run_time or 0,
                        row.setup_time or 0,
                        1 if row.subcontract else 0,
                        row.process_code,
                        row.process,
                        1 if row.fa else 0,
                        row.qty if row.qty is not None else 0,
                        row.sched_days or 0,
                        row.id,
                        job_number,
                        ts,
                    )
                    if cur.rowcount != 1:
                        raise AppError("This operation was changed by someone else. Reload and try again.", status_code=409)
            conn.commit()
            return [_row_to_op(item) for item in cur.execute(OP_SELECT, job_number)]
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def replace_job_ops_from_template(self, job_number: str, template_id: int) -> list[OperationRow]:
        conn, _ = self._connect()
        try:
            cur = conn.cursor()
            qty_row = cur.execute(
                "SELECT Jb_Qty_Order FROM dbo.Jobs WHERE Jb_Job_Num = ?",
                job_number,
            ).fetchone()
            if not qty_row:
                raise AppError("Job not found.", status_code=404)
            steps = cur.execute(
                """
                SELECT Om_LinkID, Om_SeqNum, Om_WCCode, Om_Description, Om_RunTime, Om_SetupTime,
                       COALESCE(Om_Subcontract, 0), Om_ProcessCode, Om_Process, COALESCE(Om_FA, 0),
                       Om_Note, Om_Qty, Om_SchedDays
                FROM dbo.OpMasterMasterOps
                WHERE Om_MmLinkID = ?
                ORDER BY Om_SeqNum
                """,
                template_id,
            ).fetchall()
            if not steps:
                exists = cur.execute(
                    "SELECT 1 FROM dbo.OpMasterMasters WHERE Omm_ID = ?",
                    template_id,
                ).fetchone()
                if not exists:
                    raise AppError("Template not found.", status_code=404)
                return [_row_to_op(item) for item in cur.execute(OP_SELECT, job_number)]
            _replace_release1_ops(cur, job_number, int(qty_row[0] or 0), steps)
            conn.commit()
            return [_row_to_op(item) for item in cur.execute(OP_SELECT, job_number)]
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def replace_job_ops_from_part(self, job_number: str) -> list[OperationRow]:
        conn, _ = self._connect()
        try:
            cur = conn.cursor()
            job = cur.execute(
                """
                SELECT j.Jb_Qty_Order, r.Jr_PartMasterLink
                FROM dbo.Jobs j
                JOIN dbo.JobRelease r ON r.Jr_JobNum = j.Jb_Job_Num AND r.Jr_ReleaseNum = 1
                WHERE j.Jb_Job_Num = ?
                """,
                job_number,
            ).fetchone()
            if not job:
                raise AppError("Job not found.", status_code=404)
            if job[1] is None:
                raise AppError("This job has no part master linked.", status_code=409)
            pm_linkid = int(job[1])
            steps = cur.execute(
                """
                SELECT Om_LinkID, Om_SeqNum, Om_WCCode, Om_Description, Om_RunTime, Om_SetupTime,
                       COALESCE(Om_Subcontract, 0), Om_ProcessCode, Om_Process, COALESCE(Om_FA, 0),
                       Om_Note, Om_Qty, Om_SchedDays
                FROM dbo.OpMaster
                WHERE Om_PmLinkID = ?
                ORDER BY Om_SeqNum
                """,
                pm_linkid,
            ).fetchall()
            if not steps:
                raise AppError("This part has no operations on the part master.", status_code=409)
            _replace_release1_ops(cur, job_number, int(job[0] or 0), steps)
            conn.commit()
            return [_row_to_op(item) for item in cur.execute(OP_SELECT, job_number)]
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def get_part_editor(self, pm_linkid: int) -> PartEditorRecord | None:
        conn, _ = self._connect()
        try:
            cur = conn.cursor()
            row = cur.execute(
                """
                SELECT Pm_LinkID, Pm_PartNum, Pm_PartRev, Pm_PartDesc, Pm_CustCode,
                       COALESCE(Pm_Locked, 0), COALESCE(Pm_QualityHold, 0), Pm_QualityHoldNote,
                       COALESCE(Pm_FAHold, 0), COALESCE(Pm_ShipHold, 0)
                FROM dbo.PartMaster
                WHERE Pm_LinkID = ?
                """,
                pm_linkid,
            ).fetchone()
            if not row:
                return None
            ops = [_row_to_op(item) for item in cur.execute(PART_OP_SELECT, pm_linkid)]
            pics = [
                PartPicture(int(item[0]), str(item[1] or ""), item[2], _as_bool(item[3]), _as_int(item[4]))
                for item in cur.execute(
                    """
                    SELECT Pmp_ID, Pmp_PictureName, Pmp_PictureDesc, COALESCE(Pmp_PrintOnTrav, 0), Pmp_SortOrder
                    FROM dbo.PartMasterPics
                    WHERE Pmp_PmLinkID = ?
                    ORDER BY Pmp_SortOrder, Pmp_ID
                    """,
                    pm_linkid,
                )
            ]
            certs = [
                CertText(str(item[0]).strip(), item[1], None)
                for item in cur.execute(
                    """
                    SELECT t.CTxt_ID, t.CTxt_Description
                    FROM dbo.CertificationItems i
                    JOIN dbo.CertificationText t ON t.CTxt_ID = i.CItm_LinkID
                    WHERE i.CItm_PMLinkID = ?
                    ORDER BY i.CItm_OrderNum, t.CTxt_ID
                    """,
                    pm_linkid,
                )
            ]
            return PartEditorRecord(
                pm_linkid=int(row[0]),
                part_number=str(row[1] or "").strip(),
                part_revision=str(row[2] or "").strip(),
                description=row[3],
                customer_code=_as_optional_str(row[4]),
                locked=_as_bool(row[5]),
                quality_hold=_as_bool(row[6]),
                quality_hold_note=row[7],
                fa_hold=_as_bool(row[8]),
                ship_hold=_as_bool(row[9]),
                operations=ops,
                pictures=pics,
                linked_certs=certs,
            )
        finally:
            conn.close()

    def list_parts(
        self,
        *,
        query: str | None = None,
        search_by: str = "part",
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[PartMasterListRow], int]:
        q = (query or "").strip()
        field = normalize_part_search_by(search_by)
        like = f"%{q}%"
        offset = max(0, (page - 1) * page_size)
        search_params: list[object] = []
        search_sql = ""
        if q:
            if field == "customer":
                search_sql = """
                    AND (
                        p.Pm_CustCode LIKE ?
                        OR EXISTS (
                            SELECT 1
                            FROM dbo.Customers c
                            WHERE c.[Customer Number] = p.Pm_CustCode
                              AND c.Company LIKE ?
                        )
                    )
                """
                search_params.extend([like, like])
            elif field == "description":
                search_sql = "AND p.Pm_PartDesc LIKE ?"
                search_params.append(like)
            else:
                search_sql = "AND p.Pm_PartNum LIKE ?"
                search_params.append(like)
        conn, _ = self._connect()
        try:
            cur = conn.cursor()
            cur.execute(
                f"""
                SELECT COUNT(*)
                FROM dbo.PartMaster p
                WHERE COALESCE(p.Pm_MasterType, N'Production') = N'Production'
                {search_sql}
                """,
                *search_params,
            )
            total = int(cur.fetchone()[0] or 0)
            cur.execute(
                f"""
                SELECT
                    p.Pm_LinkID,
                    p.Pm_PartNum,
                    p.Pm_PartRev,
                    p.Pm_CustCode,
                    p.Pm_PartDesc,
                    COALESCE(p.Pm_InActive, 0),
                    COALESCE(p.Pm_QualityHold, 0),
                    (SELECT COUNT(*) FROM dbo.OpMaster o WHERE o.Om_PmLinkID = p.Pm_LinkID),
                    (SELECT COUNT(*) FROM dbo.PartMasterPics pic WHERE pic.Pmp_PmLinkID = p.Pm_LinkID),
                    CASE WHEN EXISTS (
                        SELECT 1 FROM dbo.CertificationItems ci WHERE ci.CItm_PMLinkID = p.Pm_LinkID
                    ) THEN 1 ELSE 0 END
                FROM dbo.PartMaster p
                WHERE COALESCE(p.Pm_MasterType, N'Production') = N'Production'
                {search_sql}
                ORDER BY p.Pm_LinkID DESC
                OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
                """,
                *search_params,
                offset,
                page_size,
            )
            rows = [
                PartMasterListRow(
                    pm_linkid=int(row[0]),
                    part_number=str(row[1] or "").strip(),
                    part_revision=str(row[2] or "").strip(),
                    customer_code=_as_optional_str(row[3]),
                    description=row[4],
                    inactive=_as_bool(row[5]),
                    quality_hold=_as_bool(row[6]),
                    operation_count=int(row[7] or 0),
                    picture_count=int(row[8] or 0),
                    cert_linked=_as_bool(row[9]),
                )
                for row in cur.fetchall()
            ]
            return rows, total
        finally:
            conn.close()

    def create_part(self, payload: PartHeaderUpdate) -> int:
        conn, _ = self._connect()
        try:
            cur = conn.cursor()
            if _production_part_exists(cur, payload.part_number, payload.part_revision):
                raise ConflictError("A Production part with this number and revision already exists.")
            cur.execute(
                """
                INSERT INTO dbo.PartMaster (
                    Pm_PartNum, Pm_PartRev, Pm_MasterType, Pm_CustCode, Pm_PartDesc,
                    Pm_LeadTime, Pm_InActive, Pm_Locked, Pm_QualityHold, Pm_FAHold, Pm_ShipHold,
                    Pm_CreationDate
                )
                VALUES (?, ?, N'Production', ?, ?, 0, 0, 0, 0, 0, 0, ?)
                """,
                payload.part_number,
                payload.part_revision,
                payload.customer_code,
                payload.description,
                datetime.now(),
            )
            row = cur.execute("SELECT CAST(SCOPE_IDENTITY() AS int)").fetchone()
            conn.commit()
            return int(row[0])
        except ConflictError:
            conn.rollback()
            raise
        except Exception as exc:
            conn.rollback()
            if _is_unique_conflict(exc):
                raise ConflictError("A Production part with this number and revision already exists.") from exc
            raise
        finally:
            conn.close()

    def update_part_header(self, pm_linkid: int, payload: PartHeaderUpdate) -> None:
        conn, _ = self._connect()
        try:
            cur = conn.cursor()
            ts = _assert_part_writable(cur, pm_linkid)
            if _production_part_exists(cur, payload.part_number, payload.part_revision, exclude_id=pm_linkid):
                raise ConflictError("A Production part with this number and revision already exists.")
            cur.execute(
                """
                UPDATE dbo.PartMaster
                SET Pm_PartNum = ?, Pm_PartRev = ?, Pm_CustCode = ?, Pm_PartDesc = ?
                WHERE Pm_LinkID = ? AND SSMA_TimeStamp = ?
                """,
                payload.part_number,
                payload.part_revision,
                payload.customer_code,
                payload.description,
                pm_linkid,
                ts,
            )
            if cur.rowcount != 1:
                raise AppError("This part was changed by someone else. Reload and try again.", status_code=409)
            conn.commit()
        except (AppError, ConflictError):
            conn.rollback()
            raise
        except Exception as exc:
            conn.rollback()
            if _is_unique_conflict(exc):
                raise ConflictError("A Production part with this number and revision already exists.") from exc
            raise
        finally:
            conn.close()

    def save_part_operations(self, pm_linkid: int, operations: list[OperationRow]) -> list[OperationRow]:
        conn, _ = self._connect()
        try:
            cur = conn.cursor()
            _assert_part_writable(cur, pm_linkid)
            existing = {row.id: row for row in (_row_to_op(item) for item in cur.execute(PART_OP_SELECT, pm_linkid))}
            incoming_ids = {row.id for row in operations if row.id is not None}
            for op_id in existing:
                if op_id not in incoming_ids:
                    _assert_no_part_children(cur, op_id)
                    cur.execute("DELETE FROM dbo.OpMaster WHERE Om_LinkID = ? AND Om_PmLinkID = ?", op_id, pm_linkid)
            for row in operations:
                _validate_wc(cur, row.wc_code)
                if row.id is None:
                    cur.execute(
                        """
                        INSERT INTO dbo.OpMaster (
                            Om_PmLinkID, Om_SeqNum, Om_WCCode, Om_Description, Om_RunTime, Om_SetupTime,
                            Om_Subcontract, Om_ProcessCode, Om_Process, Om_FA, Om_Note, Om_Qty, Om_SchedDays
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        pm_linkid,
                        row.seq_num,
                        row.wc_code,
                        row.description,
                        row.run_time or 0,
                        row.setup_time or 0,
                        1 if row.subcontract else 0,
                        row.process_code,
                        row.process,
                        1 if row.fa else 0,
                        row.note,
                        row.qty if row.qty is not None else 0,
                        row.sched_days or 0,
                    )
                else:
                    ts = rowversion_bytes(row.rowversion)
                    cur.execute(
                        """
                        UPDATE dbo.OpMaster
                        SET Om_SeqNum = ?, Om_WCCode = ?, Om_Description = ?, Om_Note = ?,
                            Om_RunTime = ?, Om_SetupTime = ?, Om_Subcontract = ?,
                            Om_ProcessCode = ?, Om_Process = ?, Om_FA = ?, Om_Qty = ?, Om_SchedDays = ?
                        WHERE Om_LinkID = ? AND Om_PmLinkID = ? AND SSMA_TimeStamp = ?
                        """,
                        row.seq_num,
                        row.wc_code,
                        row.description,
                        row.note,
                        row.run_time or 0,
                        row.setup_time or 0,
                        1 if row.subcontract else 0,
                        row.process_code,
                        row.process,
                        1 if row.fa else 0,
                        row.qty if row.qty is not None else 0,
                        row.sched_days or 0,
                        row.id,
                        pm_linkid,
                        ts,
                    )
                    if cur.rowcount != 1:
                        raise AppError("This operation was changed by someone else. Reload and try again.", status_code=409)
            conn.commit()
            return [_row_to_op(item) for item in cur.execute(PART_OP_SELECT, pm_linkid)]
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def set_part_quality_hold(self, pm_linkid: int, hold: bool, note: str | None) -> None:
        conn, _ = self._connect()
        try:
            cur = conn.cursor()
            ts = _assert_part_writable(cur, pm_linkid)
            cur.execute(
                """
                UPDATE dbo.PartMaster
                SET Pm_QualityHold = ?, Pm_QualityHoldNote = ?
                WHERE Pm_LinkID = ? AND SSMA_TimeStamp = ?
                """,
                1 if hold else 0,
                note,
                pm_linkid,
                ts,
            )
            if cur.rowcount != 1:
                raise AppError("This part was changed by someone else. Reload and try again.", status_code=409)
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def link_part_cert(self, pm_linkid: int, ctxt_id: str) -> None:
        conn, _ = self._connect()
        try:
            cur = conn.cursor()
            _assert_part_writable(cur, pm_linkid)
            exists = cur.execute(
                "SELECT 1 FROM dbo.CertificationText WHERE CTxt_ID = ?",
                ctxt_id,
            ).fetchone()
            if not exists:
                raise AppError("Certification text not found.", status_code=404)
            already = cur.execute(
                "SELECT 1 FROM dbo.CertificationItems WHERE CItm_PMLinkID = ? AND CItm_LinkID = ?",
                pm_linkid,
                ctxt_id,
            ).fetchone()
            if already:
                conn.commit()
                return
            order_row = cur.execute(
                "SELECT COALESCE(MAX(CItm_OrderNum), 0) FROM dbo.CertificationItems WHERE CItm_PMLinkID = ?",
                pm_linkid,
            ).fetchone()
            next_order = int(order_row[0] or 0) + 1
            cur.execute(
                """
                INSERT INTO dbo.CertificationItems (CItm_LinkID, CItm_PMLinkID, CItm_OrderNum)
                VALUES (?, ?, ?)
                """,
                ctxt_id,
                pm_linkid,
                next_order,
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def unlink_part_cert(self, pm_linkid: int, ctxt_id: str) -> None:
        conn, _ = self._connect()
        try:
            cur = conn.cursor()
            _assert_part_writable(cur, pm_linkid)
            cur.execute(
                "DELETE FROM dbo.CertificationItems WHERE CItm_PMLinkID = ? AND CItm_LinkID = ?",
                pm_linkid,
                ctxt_id,
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def add_part_picture(self, pm_linkid: int, dest_unc: str, description: str | None) -> PartPicture:
        conn, _ = self._connect()
        try:
            cur = conn.cursor()
            _assert_part_writable(cur, pm_linkid)
            order_row = cur.execute(
                "SELECT COALESCE(MAX(Pmp_SortOrder), 0) FROM dbo.PartMasterPics WHERE Pmp_PmLinkID = ?",
                pm_linkid,
            ).fetchone()
            next_order = int(order_row[0] or 0) + 1
            cur.execute(
                """
                INSERT INTO dbo.PartMasterPics (Pmp_PmLinkID, Pmp_PictureName, Pmp_PictureDesc, Pmp_PrintOnTrav, Pmp_SortOrder)
                VALUES (?, ?, ?, 1, ?)
                """,
                pm_linkid,
                dest_unc,
                description,
                next_order,
            )
            conn.commit()
            row = cur.execute(
                """
                SELECT TOP 1 Pmp_ID, Pmp_PictureName, Pmp_PictureDesc, COALESCE(Pmp_PrintOnTrav, 0), Pmp_SortOrder
                FROM dbo.PartMasterPics
                WHERE Pmp_PmLinkID = ?
                ORDER BY Pmp_ID DESC
                """,
                pm_linkid,
            ).fetchone()
            return PartPicture(int(row[0]), str(row[1] or ""), row[2], _as_bool(row[3]), _as_int(row[4]))
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def unlink_part_picture(self, pm_linkid: int, pmp_id: int) -> None:
        conn, _ = self._connect()
        try:
            cur = conn.cursor()
            _assert_part_writable(cur, pm_linkid)
            cur.execute(
                "DELETE FROM dbo.PartMasterPics WHERE Pmp_ID = ? AND Pmp_PmLinkID = ?",
                pmp_id,
                pm_linkid,
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def load_print_data(self, job_number: str) -> PrintDocumentData:
        job = self.get_job_page(job_number)
        if job is None:
            raise AppError("Job not found.", status_code=404)
        conn, _ = self._connect()
        try:
            cur = conn.cursor()
            pics: list[PartPicture] = []
            certs: list[CertText] = []
            if job.pm_linkid is not None:
                pics = [
                    PartPicture(int(item[0]), str(item[1] or ""), item[2], _as_bool(item[3]), _as_int(item[4]))
                    for item in cur.execute(
                        """
                        SELECT Pmp_ID, Pmp_PictureName, Pmp_PictureDesc, COALESCE(Pmp_PrintOnTrav, 0), Pmp_SortOrder
                        FROM dbo.PartMasterPics
                        WHERE Pmp_PmLinkID = ? AND COALESCE(Pmp_PrintOnTrav, 0) = 1
                        ORDER BY Pmp_SortOrder, Pmp_ID
                        """,
                        job.pm_linkid,
                    )
                ]
                certs = [
                    CertText(str(item[0]).strip(), item[1], item[2])
                    for item in cur.execute(
                        """
                        SELECT t.CTxt_ID, t.CTxt_Description, t.CTxt_Text
                        FROM dbo.CertificationItems i
                        JOIN dbo.CertificationText t ON t.CTxt_ID = i.CItm_LinkID
                        WHERE i.CItm_PMLinkID = ?
                        ORDER BY i.CItm_OrderNum, t.CTxt_ID
                        """,
                        job.pm_linkid,
                    )
                ]
            customer = self.get_customer(job.customer_code)
            ship_to = customer
            if customer is not None:
                tos = self.lookup_ship_tos(customer.customer_number)
                if tos:
                    ship_to = tos[0]
            return PrintDocumentData(job=job, pictures=pics, certs=certs, customer=customer, ship_to=ship_to)
        finally:
            conn.close()

    def mark_traveler_printed(self, job_number: str) -> None:
        conn, _ = self._connect()
        try:
            cur = conn.cursor()
            ts = cur.execute(
                "SELECT SSMA_TimeStamp FROM dbo.JobRelease WHERE Jr_JobNum = ? AND Jr_ReleaseNum = 1",
                job_number,
            ).fetchone()
            if not ts:
                raise AppError("Job not found.", status_code=404)
            cur.execute(
                """
                UPDATE dbo.JobRelease
                SET Jr_TravelerPrinted = 1
                WHERE Jr_JobNum = ? AND Jr_ReleaseNum = 1 AND SSMA_TimeStamp = ?
                """,
                job_number,
                ts[0],
            )
            if cur.rowcount != 1:
                raise AppError("Could not mark the traveler printed (timestamp conflict).", status_code=409)
            now = datetime.now()
            cur.execute(
                "INSERT INTO dbo.LockInfo (Lk_Form, Lk_ID, Lk_Date, Lk_Initials, Lk_Comment) VALUES (?, ?, ?, ?, ?)",
                "Jobs",
                job_number,
                now,
                "AUTO",
                "Rel# 1 - Printing Traveler",
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


def _validate_wc(cur, wc_code: str) -> None:
    row = cur.execute("SELECT 1 FROM dbo.WorkCenters WHERE Wc_Name = ?", wc_code).fetchone()
    if not row:
        raise AppError(f"Unknown work center “{wc_code}”.", status_code=409)


def _replace_release1_ops(cur, job_number: str, qty: int, steps) -> None:
    for item in cur.execute(OP_SELECT, job_number):
        _assert_no_job_children(cur, int(item[0]))
    cur.execute("DELETE FROM dbo.OpStatus WHERE Os_JobNum = ? AND Os_ReleaseNum = 1", job_number)
    for step in steps:
        cur.execute(
            """
            INSERT INTO dbo.OpStatus (
                Os_OMLink, Os_JobNum, Os_ReleaseNum, Os_SeqNum, Os_WCCode,
                Os_Description, Os_RunTime, Os_SetupTime, Os_Subcontract,
                Os_ProcessCode, Os_Process, Os_FA, Os_Note, Os_Qty, Os_SchedDays, Os_QtyToMake
            ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            step[0],
            job_number,
            step[1],
            step[2],
            step[3],
            step[4] or 0,
            step[5] or 0,
            1 if step[6] else 0,
            step[7],
            step[8],
            1 if step[9] else 0,
            step[10],
            step[11] or 0,
            step[12] or 0,
            qty,
        )


def _assert_no_job_children(cur, op_id: int) -> None:
    if cur.execute(JOB_OP_CHILDREN, op_id).fetchone():
        raise AppError("Cannot change operations that already have shop-floor activity.", status_code=409)


def _assert_no_part_children(cur, op_id: int) -> None:
    if cur.execute(PART_OP_CHILDREN, op_id).fetchone():
        raise AppError("Cannot delete this part operation because it has tooling or QC records.", status_code=409)


def _production_part_exists(cur, part_number: str, part_revision: str, exclude_id: int | None = None) -> bool:
    sql = """
        SELECT Pm_LinkID
        FROM dbo.PartMaster
        WHERE Pm_PartNum = ? AND Pm_PartRev = ?
          AND COALESCE(Pm_MasterType, N'Production') = N'Production'
    """
    params: list[object] = [part_number, part_revision]
    if exclude_id is not None:
        sql += " AND Pm_LinkID <> ?"
        params.append(exclude_id)
    return cur.execute(sql, *params).fetchone() is not None


def _assert_part_writable(cur, pm_linkid: int):
    row = cur.execute(
        "SELECT COALESCE(Pm_Locked, 0), SSMA_TimeStamp FROM dbo.PartMaster WHERE Pm_LinkID = ?",
        pm_linkid,
    ).fetchone()
    if not row:
        raise AppError("Part not found.", status_code=404)
    if _as_bool(row[0]):
        raise AppError("This part is locked.", status_code=409)
    return row[1]
