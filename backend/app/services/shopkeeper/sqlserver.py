from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from app.config import get_settings
from app.exceptions import AppError
from app.services.shopkeeper.lookup import (
    LOOKUP_LIMIT,
    normalize_search_by,
    normalize_shipper_search_by,
    prefix_like,
    sort_price_history,
)
from app.services.shopkeeper.sqlserver_ops import SqlServerOpsMixin
from app.services.shopkeeper.types import (
    CustomerRecord,
    JobWritePayload,
    PartRecord,
    PriceQuote,
    ShipWritePayload,
    ShopKeeperJobRow,
    ShopKeeperShipperPage,
    ShopKeeperShipperRow,
)


def _format_ship_number(next_num: int, prefix: str | None, fmt: str | None, suffix: str | None) -> str:
    # references/job_entry_write_sequence.md step 12: Prefix + zero-pad when Format is zeros + Suffix
    body = str(next_num)
    if fmt and set(fmt) <= {"0"}:
        body = body.zfill(len(fmt))
    return f"{prefix or ''}{body}{suffix or ''}"

CUSTOMER_COLUMNS = """
SELECT [Customer Number], Company, [Customer Record Type], [Bill To Customer Number],
       COALESCE(Active, 1), COALESCE(CreditHold, 0), [Payment Terms], [Shipped Via],
       LEFT(Salesman, 20), COALESCE(Cus_CertDefault, 0), COALESCE(Cus_TaxableDefault, 0),
       Cus_TaxCodeDefault, Street, Suite, City, State, [Zip/Postal Code], Country
FROM dbo.Customers
"""

CUSTOMER_SELECT = CUSTOMER_COLUMNS + " WHERE [Customer Record Type] IN (N'Both', N'Bill To')"


def _as_bool(value: object) -> bool:
    return bool(value) if value is not None else False


def _is_fk_conflict(exc: Exception) -> bool:
    text = str(exc)
    return "(547)" in text or "REFERENCE constraint" in text


def _has_row(cur, sql: str, *params) -> bool:
    return cur.execute(sql, params).fetchone() is not None


def _object_exists(cur, name: str) -> bool:
    row = cur.execute("SELECT OBJECT_ID(?)", name).fetchone()
    return bool(row and row[0])


def _column_names(cur, table: str) -> set[str]:
    rows = cur.execute(
        "SELECT name FROM sys.columns WHERE object_id = OBJECT_ID(?)",
        table,
    ).fetchall()
    return {str(row[0]) for row in rows}


def _delete_blocked(cur, job_number: str) -> str | None:
    job = cur.execute(
        "SELECT ID, COALESCE(Jb_Locked, 0) FROM dbo.Jobs WHERE Jb_Job_Num = ?",
        job_number,
    ).fetchone()
    if job is None:
        return f"ShopKeeper job {job_number} was not found."
    if job[1]:
        return f"Job {job_number} is locked in ShopKeeper."
    ship = cur.execute(
        """
        SELECT Sh_Ship_Num, COALESCE(Sh_Qty_Shipped, 0)
        FROM dbo.JobShip
        WHERE Sh_Job_Num = ?
        """,
        job_number,
    ).fetchall()
    for ship_num, qty_shipped in ship:
        attached = str(ship_num).strip() if ship_num else ""
        if attached:
            return (
                f"Job {job_number} is on shipper {attached}. "
                "Unlink it in ShopKeeper first; this app cannot unlink a shipper."
            )
        if qty_shipped:
            return f"Job {job_number} has shipped quantity and cannot be deleted."
    if _has_row(
        cur,
        "SELECT 1 FROM dbo.JobRelease WHERE Jr_JobNum = ? AND COALESCE(Jr_TravelerPrinted, 0) <> 0",
        job_number,
    ):
        return f"Job {job_number} has a printed traveler and cannot be deleted."
    if _has_row(
        cur,
        """
        SELECT 1 FROM dbo.OpStatus os
        WHERE os.Os_JobNum = ?
          AND (
            EXISTS (SELECT 1 FROM dbo.ScheduledOps WHERE SchO_OSId = os.Os_ID)
            OR EXISTS (SELECT 1 FROM dbo.TimeCard WHERE Tc_Os_ID = os.Os_ID)
            OR EXISTS (SELECT 1 FROM dbo.TimeClock WHERE Tk_OsID = os.Os_ID)
            OR EXISTS (SELECT 1 FROM dbo.QcInspectLog WHERE QcL_OpStatusLinkID = os.Os_ID)
          )
        """,
        job_number,
    ):
        return f"Job {job_number} has time, schedule, or inspection records and cannot be deleted."
    if _object_exists(cur, "dbo.Kit") and _has_row(
        cur,
        "SELECT 1 FROM dbo.Kit WHERE Kit_JobNum = ? AND COALESCE(Kit_KittedQty, 0) > 0",
        job_number,
    ):
        return f"Job {job_number} has kitted quantity and cannot be deleted."
    if _object_exists(cur, "dbo.[Purchase Order LineItems]") and _has_row(
        cur,
        "SELECT 1 FROM dbo.[Purchase Order LineItems] WHERE Pol_JobNum = ?",
        job_number,
    ):
        return f"Job {job_number} is on a ShopKeeper purchase order line and cannot be deleted."
    if _object_exists(cur, "dbo.JobShipSerialNumbers"):
        serial_cols = _column_names(cur, "dbo.JobShipSerialNumbers")
        has_serials = False
        if "Jssn_JobNum" in serial_cols:
            has_serials = _has_row(
                cur,
                "SELECT 1 FROM dbo.JobShipSerialNumbers WHERE Jssn_JobNum = ?",
                job_number,
            )
        if not has_serials and "Jssn_ShID" in serial_cols:
            has_serials = _has_row(
                cur,
                """
                SELECT 1 FROM dbo.JobShipSerialNumbers sns
                JOIN dbo.JobShip js ON js.Sh_ID = sns.Jssn_ShID
                WHERE js.Sh_Job_Num = ?
                """,
                job_number,
            )
        if has_serials:
            return f"Job {job_number} has serial numbers and cannot be deleted."
    return None


def _as_date(value: object) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return None


def _as_optional_str(value: object) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _as_money(value: object) -> Decimal | None:
    if value is None:
        return None
    try:
        return Decimal(str(value))
    except Exception:
        return None


def _row_to_customer(row) -> CustomerRecord:
    return CustomerRecord(
        customer_number=str(row[0]).strip(),
        company=row[1],
        record_type=row[2],
        bill_to_customer_number=row[3],
        active=_as_bool(row[4]),
        credit_hold=_as_bool(row[5]),
        payment_terms=row[6],
        shipped_via=row[7],
        salesman=row[8],
        cert_default=_as_bool(row[9]),
        taxable_default=_as_bool(row[10]),
        tax_code=(str(row[11]).strip() if row[11] else None),
        street=_as_optional_str(row[12]),
        suite=_as_optional_str(row[13]),
        city=_as_optional_str(row[14]),
        state=_as_optional_str(row[15]),
        postal_code=_as_optional_str(row[16]),
        country=_as_optional_str(row[17]),
    )


def _row_to_part(row) -> PartRecord:
    return PartRecord(
        part_number=str(row[0]).strip(),
        part_revision=str(row[1] or "").strip(),
        description=row[2],
        master_type=row[3] or "Production",
        pm_linkid=int(row[4]),
        inactive=_as_bool(row[5]),
    )


class SqlServerShopKeeper(SqlServerOpsMixin):
    def _connect(self):
        settings = get_settings()
        if not settings.shopkeeper_connection_string:
            raise AppError("ShopKeeper is not configured.", status_code=503)
        try:
            import pyodbc
        except ImportError as exc:
            raise AppError("pyodbc is not installed on this server.", status_code=503) from exc
        try:
            conn = pyodbc.connect(settings.shopkeeper_connection_string, autocommit=False)
        except Exception as exc:
            raise AppError("Unable to connect to ShopKeeper.", status_code=503) from exc
        try:
            name = conn.cursor().execute("SELECT DB_NAME()").fetchone()[0]
        except Exception as exc:
            conn.close()
            raise AppError("Unable to connect to ShopKeeper.", status_code=503) from exc
        if name != settings.shopkeeper_expected_database:
            conn.close()
            raise AppError(
                f"Connected to {name}, expected {settings.shopkeeper_expected_database}.",
                status_code=409,
            )
        return conn, name

    def current_database(self) -> str:
        conn, name = self._connect()
        conn.close()
        return name

    def lookup_customers(self, query: str) -> list[CustomerRecord]:
        pattern = prefix_like(query)
        if not pattern:
            return []
        conn, _ = self._connect()
        try:
            sql = CUSTOMER_SELECT.replace("SELECT ", f"SELECT TOP {LOOKUP_LIMIT} ", 1) + """
                AND ([Customer Number] LIKE ? OR Company LIKE ?)
                ORDER BY CASE WHEN [Customer Number] LIKE ? THEN 0 ELSE 1 END, [Customer Number]
            """
            rows = conn.cursor().execute(sql, pattern, pattern, pattern).fetchall()
            return [_row_to_customer(row) for row in rows]
        finally:
            conn.close()

    def list_customers(self) -> list[CustomerRecord]:
        conn, _ = self._connect()
        try:
            rows = conn.cursor().execute(CUSTOMER_SELECT).fetchall()
            return [_row_to_customer(row) for row in rows]
        finally:
            conn.close()

    def get_customer(self, customer_number: str) -> CustomerRecord | None:
        conn, _ = self._connect()
        try:
            row = conn.cursor().execute(
                CUSTOMER_SELECT + " AND [Customer Number] = ?",
                customer_number,
            ).fetchone()
            return _row_to_customer(row) if row else None
        finally:
            conn.close()

    def lookup_ship_tos(self, bill_to_number: str) -> list[CustomerRecord]:
        code = (bill_to_number or "").strip()
        if not code:
            return []
        conn, _ = self._connect()
        try:
            rows = conn.cursor().execute(
                CUSTOMER_COLUMNS + " WHERE [Customer Record Type] = N'Ship To' AND [Bill To Customer Number] = ?",
                code,
            ).fetchall()
            return [_row_to_customer(row) for row in rows]
        finally:
            conn.close()

    def lookup_parts(self, part_number: str, part_revision: str | None = None) -> list[PartRecord]:
        pattern = prefix_like(part_number)
        if not pattern:
            return []
        conn, _ = self._connect()
        try:
            sql = f"""
                SELECT TOP {LOOKUP_LIMIT} Pm_PartNum, Pm_PartRev, Pm_PartDesc, COALESCE(Pm_MasterType, N'Production'),
                       Pm_LinkID, COALESCE(Pm_InActive, 0)
                FROM dbo.PartMaster
                WHERE Pm_PartNum LIKE ? AND COALESCE(Pm_InActive, 0) = 0
            """
            params: list = [pattern]
            rev_pattern = prefix_like(part_revision or "")
            if rev_pattern:
                sql += " AND Pm_PartRev LIKE ?"
                params.append(rev_pattern)
            sql += " ORDER BY Pm_PartNum, Pm_PartRev"
            rows = conn.cursor().execute(sql, *params).fetchall()
            return [_row_to_part(row) for row in rows]
        finally:
            conn.close()

    def get_part(self, part_number: str, part_revision: str) -> PartRecord | None:
        conn, _ = self._connect()
        try:
            row = conn.cursor().execute(
                """
                SELECT Pm_PartNum, Pm_PartRev, Pm_PartDesc, COALESCE(Pm_MasterType, N'Production'),
                       Pm_LinkID, COALESCE(Pm_InActive, 0)
                FROM dbo.PartMaster
                WHERE Pm_PartNum = ? AND Pm_PartRev = ? AND COALESCE(Pm_InActive, 0) = 0
                """,
                part_number,
                part_revision,
            ).fetchone()
            return _row_to_part(row) if row else None
        finally:
            conn.close()

    def find_jobs_by_po_line(self, po_number: str, po_line: str) -> list[str]:
        conn, _ = self._connect()
        try:
            rows = conn.cursor().execute(
                """
                SELECT j.Jb_Job_Num
                FROM dbo.Jobs j
                JOIN dbo.JobShip s ON s.Sh_Job_Num = j.Jb_Job_Num
                WHERE j.Jb_PO_Num = ? AND s.Sh_PO_Line = ?
                """,
                po_number,
                po_line,
            ).fetchall()
            return [str(row[0]) for row in rows]
        finally:
            conn.close()

    def find_duplicate_jobs(self, po_number: str, customer_code: str, part_number: str) -> list[str]:
        conn, _ = self._connect()
        try:
            rows = conn.cursor().execute(
                """
                SELECT j.Jb_Job_Num
                FROM dbo.Jobs j
                WHERE j.Jb_PO_Num = ? AND j.Jb_Cust_Code = ? AND j.Jb_Part_Num = ?
                ORDER BY TRY_CONVERT(bigint, j.Jb_Job_Num) DESC, j.Jb_Job_Num DESC
                """,
                po_number,
                customer_code,
                part_number,
            ).fetchall()
            return [str(row[0]).strip() for row in rows if row[0]]
        finally:
            conn.close()

    def create_job(self, payload: JobWritePayload) -> str:
        settings = get_settings()
        conn, _ = self._connect()
        try:
            job_num = self._reserve_job_number(conn)
            cur = conn.cursor()
            now = datetime.now()
            today = datetime(now.year, now.month, now.day)
            due = datetime(payload.due_date.year, payload.due_date.month, payload.due_date.day)
            cur.execute(
                "INSERT INTO dbo.LockInfo (Lk_Form, Lk_ID, Lk_Date, Lk_Initials, Lk_Comment) VALUES (?, ?, ?, ?, ?)",
                "Jobs",
                job_num,
                now,
                "AUTO",
                "New Job Input via Automation",
            )
            cur.execute(
                """INSERT INTO dbo.Jobs (
                       Jb_Job_Num, Jb_Cust_Code, Jb_Shipto_Code, Jb_PO_Num,
                       Jb_Part_Num, Jb_Part_Rev, Jb_Order_Date, Jb_Part_Desc,
                       Jb_Qty_Order, Jb_Price, Jb_Unit, Jb_Cert_Required,
                       Jb_Taxable, Jb_TaxCode, Jb_Status, Jb_SalesPerson,
                       Jb_NeedPOConfirm, Jb_Locked, Jb_Facility, Jb_Terms, Jb_ShipVia
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?)""",
                job_num,
                payload.customer_code,
                payload.customer_code,
                payload.po_number,
                payload.part_number,
                payload.part_revision,
                today,
                payload.part_description,
                payload.quantity,
                payload.unit_price,
                payload.unit,
                1 if payload.cert_required else 0,
                1 if payload.taxable else 0,
                payload.tax_code,
                payload.status or settings.shopkeeper_new_job_status,
                payload.salesperson,
                payload.terms,
                payload.ship_via,
            )
            cur.execute(
                """INSERT INTO dbo.JobShip (
                       Sh_Job_Num, Sh_Release_Num, Sh_ReleaseInt, Sh_PO_Line,
                       Sh_Due_Date, Sh_Qty_Due, Sh_DockDate, Sh_OrigDate, Sh_ShipType
                   ) VALUES (?, 1, 1, ?, ?, ?, ?, ?, ?)""",
                job_num,
                payload.po_line,
                due,
                payload.quantity,
                due,
                due,
                "MTO",
            )
            cur.execute(
                """INSERT INTO dbo.JobRelease (
                       Jr_JobNum, Jr_ReleaseNum, Jr_FirstDueDate, Jr_ShopDueDate,
                       Jr_MasterType, Jr_PartMasterLink
                   ) VALUES (?, 1, ?, ?, ?, ?)""",
                job_num,
                due,
                due,
                payload.master_type,
                payload.pm_linkid,
            )
            ts = cur.execute(
                "SELECT SSMA_TimeStamp FROM dbo.JobRelease WHERE Jr_JobNum = ? AND Jr_ReleaseNum = 1",
                job_num,
            ).fetchone()[0]
            cur.execute(
                """UPDATE dbo.JobRelease
                   SET Jr_StartDate = ?, Jr_StartQty = ?, Jr_MinDueQty = ?
                   WHERE Jr_JobNum = ? AND Jr_ReleaseNum = 1 AND SSMA_TimeStamp = ?""",
                today,
                payload.quantity,
                payload.quantity,
                job_num,
                ts,
            )
            if cur.rowcount != 1:
                raise RuntimeError("Step 6 JobRelease update matched 0 rows (timestamp conflict).")
            cur.execute(
                """
                INSERT INTO dbo.OpStatus (
                    Os_OMLink, Os_JobNum, Os_ReleaseNum, Os_SeqNum, Os_WCCode,
                    Os_Description, Os_RunTime, Os_SetupTime, Os_Subcontract,
                    Os_ProcessCode, Os_Process, Os_FA, Os_Note, Os_Qty, Os_SchedDays, Os_QtyToMake
                )
                SELECT Om_LinkID, ?, 1, Om_SeqNum, Om_WCCode,
                       Om_Description, Om_RunTime, Om_SetupTime, Om_Subcontract,
                       Om_ProcessCode, Om_Process, Om_FA, Om_Note, Om_Qty, Om_SchedDays, ?
                FROM   dbo.OpMaster
                WHERE  Om_PmLinkID = ?
                ORDER  BY Om_SeqNum
                """,
                job_num,
                payload.quantity,
                payload.pm_linkid,
            )
            conn.commit()
            return job_num
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def delete_job(self, job_number: str) -> None:
        conn, _ = self._connect()
        try:
            cur = conn.cursor()
            blocked = _delete_blocked(cur, job_number)
            if blocked:
                status = 404 if "was not found" in blocked else 409
                raise AppError(blocked, status_code=status)
            job_id = cur.execute("SELECT ID FROM dbo.Jobs WHERE Jb_Job_Num = ?", job_number).fetchone()
            if job_id is None:
                raise AppError(f"ShopKeeper job {job_number} was not found.", status_code=404)
            cur.execute("DELETE FROM dbo.OpStatus WHERE Os_JobNum = ?", job_number)
            cur.execute("DELETE FROM dbo.JobRelease WHERE Jr_JobNum = ?", job_number)
            try:
                cur.execute("DELETE FROM dbo.Jobs WHERE ID = ?", job_id[0])
            except Exception as exc:
                if not _is_fk_conflict(exc):
                    raise
                conn.rollback()
                cur.execute("DELETE FROM dbo.OpStatus WHERE Os_JobNum = ?", job_number)
                cur.execute("DELETE FROM dbo.JobRelease WHERE Jr_JobNum = ?", job_number)
                cur.execute("DELETE FROM dbo.JobShip WHERE Sh_Job_Num = ?", job_number)
                cur.execute("DELETE FROM dbo.Jobs WHERE ID = ?", job_id[0])
            conn.commit()
            cur.execute(
                "INSERT INTO dbo.LockInfo (Lk_Form, Lk_ID, Lk_Date, Lk_Initials, Lk_Comment) VALUES (?, ?, ?, ?, ?)",
                "Jobs",
                job_number,
                datetime.now(),
                "AUTO",
                "Delete Job",
            )
            conn.commit()
        except AppError:
            conn.rollback()
            raise
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _reserve_job_number(self, conn) -> str:
        settings = get_settings()
        cur = conn.cursor()
        for _ in range(settings.shopkeeper_job_reserve_retries):
            dummy, counter, prefix, ts = cur.execute(
                "SELECT SK_MasterDummy, SK_NextJobNumber, Sk_NextJobNumberPrefix, SSMA_TimeStamp FROM dbo.SkMaster"
            ).fetchone()
            cur.execute(
                "UPDATE dbo.SkMaster SET SK_NextJobNumber = ? WHERE SK_MasterDummy = ? AND SSMA_TimeStamp = ?",
                counter + 1,
                dummy,
                ts,
            )
            if cur.rowcount == 1:
                conn.commit()
                return f"{prefix or ''}{counter}"
            conn.rollback()
        raise RuntimeError("Could not reserve a ShopKeeper job number after retries.")

    def find_shipper_for_jobs(self, job_numbers: list[str]) -> str | None:
        if not job_numbers:
            return None
        conn, _ = self._connect()
        try:
            placeholders = ",".join("?" * len(job_numbers))
            rows = conn.cursor().execute(
                f"""
                SELECT j.Jb_Job_Num, s.Sh_Ship_Num
                FROM dbo.Jobs j
                JOIN dbo.JobShip s ON s.Sh_Job_Num = j.Jb_Job_Num AND s.Sh_ReleaseInt = 1
                WHERE j.Jb_Job_Num IN ({placeholders})
                """,
                *job_numbers,
            ).fetchall()
            by_job = {str(row[0]).strip(): (str(row[1]).strip() if row[1] else None) for row in rows}
            found = [by_job.get(job) for job in job_numbers]
            if any(not ship_num for ship_num in found):
                return None
            unique = set(found)
            return unique.pop() if len(unique) == 1 else None
        finally:
            conn.close()

    def create_shipper(self, payload: ShipWritePayload) -> str:
        # SQL order: references/job_entry_write_sequence.md §5 steps 12–14.
        conn, _ = self._connect()
        try:
            ship_num = self._reserve_ship_number(conn)
            cur = conn.cursor()
            now = datetime.now()
            ship_date = datetime(
                payload.ship_date.year, payload.ship_date.month, payload.ship_date.day
            )
            cur.execute(
                "INSERT INTO dbo.LockInfo (Lk_Form, Lk_ID, Lk_Date, Lk_Initials, Lk_Comment) VALUES (?, ?, ?, ?, ?)",
                "Jobs",
                ship_num,
                now,
                "AUTO",
                "Shipper via Automation",
            )
            cur.execute(
                """INSERT INTO dbo.JobShipMaster (
                       Jsm_Ship_Num, Jsm_Status, Jsm_ShipVia, Jsm_ShipBy, Jsm_ShipperPrinted
                   ) VALUES (?, N'S', ?, ?, 0)""",
                ship_num,
                payload.ship_via,
                payload.ship_by,
            )
            self._attach_job_ship_rows(cur, ship_num, payload.lines, ship_date)
            conn.commit()
            return ship_num
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def add_jobs_to_shipper(self, ship_number: str, payload: ShipWritePayload) -> str:
        conn, _ = self._connect()
        try:
            cur = conn.cursor()
            master = cur.execute(
                "SELECT Jsm_Ship_Num FROM dbo.JobShipMaster WHERE Jsm_Ship_Num = ?",
                ship_number,
            ).fetchone()
            if not master:
                raise RuntimeError(f"Shipper {ship_number} not found.")
            ship_date = datetime(
                payload.ship_date.year, payload.ship_date.month, payload.ship_date.day
            )
            pending = []
            for line in payload.lines:
                row = cur.execute(
                    "SELECT Sh_Ship_Num FROM dbo.JobShip WHERE Sh_Job_Num = ? AND Sh_ReleaseInt = 1",
                    line.job_number,
                ).fetchone()
                current = str(row[0]).strip() if row and row[0] else None
                if current == str(ship_number).strip():
                    continue
                if current:
                    raise RuntimeError(f"Job {line.job_number} is already on shipper {current}.")
                pending.append(line)
            if pending:
                self._attach_job_ship_rows(cur, ship_number, pending, ship_date)
            conn.commit()
            return ship_number
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    def _attach_job_ship_rows(self, cur, ship_num: str, lines, ship_date: datetime) -> None:
        for line in lines:
            release_ts = cur.execute(
                "SELECT SSMA_TimeStamp FROM dbo.JobRelease WHERE Jr_JobNum = ? AND Jr_ReleaseNum = 1",
                line.job_number,
            ).fetchone()
            if not release_ts:
                raise RuntimeError(f"JobRelease not found for job {line.job_number} release 1.")
            cur.execute(
                """UPDATE dbo.JobRelease
                   SET Jr_Complete = 1, Jr_CloseDate = ?
                   WHERE Jr_JobNum = ? AND Jr_ReleaseNum = 1 AND SSMA_TimeStamp = ?""",
                ship_date,
                line.job_number,
                release_ts[0],
            )
            if cur.rowcount != 1:
                raise RuntimeError(
                    f"Step 14 JobRelease update matched 0 rows for job {line.job_number} (timestamp conflict)."
                )
            ship_row = cur.execute(
                "SELECT Sh_ID, SSMA_TimeStamp FROM dbo.JobShip WHERE Sh_Job_Num = ? AND Sh_ReleaseInt = 1",
                line.job_number,
            ).fetchone()
            if not ship_row:
                raise RuntimeError(f"JobShip not found for job {line.job_number} release 1.")
            cur.execute(
                """UPDATE dbo.JobShip
                   SET Sh_Ship_Date = ?, Sh_Qty_Shipped = ?, Sh_Ship_Num = ?, Sh_Status = N'S'
                   WHERE Sh_ID = ? AND SSMA_TimeStamp = ?""",
                ship_date,
                line.quantity,
                ship_num,
                ship_row[0],
                ship_row[1],
            )
            if cur.rowcount != 1:
                raise RuntimeError(
                    f"Step 14 JobShip update matched 0 rows for job {line.job_number} (timestamp conflict)."
                )

    def _reserve_ship_number(self, conn) -> str:
        settings = get_settings()
        cur = conn.cursor()
        for _ in range(settings.shopkeeper_job_reserve_retries):
            row = cur.execute(
                "SELECT [Next Number], Prefix, Format, Suffix FROM dbo.SystemID WHERE Code = N'ShipNum'"
            ).fetchone()
            if not row:
                raise RuntimeError("SystemID ShipNum row is missing.")
            next_num, prefix, fmt, suffix = row
            if next_num is None:
                raise RuntimeError("SystemID ShipNum Next Number is NULL.")
            cur.execute(
                """UPDATE dbo.SystemID
                   SET [Next Number] = ?
                   WHERE Code = N'ShipNum' AND [Next Number] = ?
                     AND (Prefix = ? OR (Prefix IS NULL AND ? IS NULL))
                     AND (Format = ? OR (Format IS NULL AND ? IS NULL))
                     AND (Suffix = ? OR (Suffix IS NULL AND ? IS NULL))""",
                next_num + 1,
                next_num,
                prefix,
                prefix,
                fmt,
                fmt,
                suffix,
                suffix,
            )
            if cur.rowcount == 1:
                conn.commit()
                return _format_ship_number(int(next_num), prefix, fmt, suffix)
            conn.rollback()
        raise RuntimeError("Could not reserve a ShopKeeper ship number after retries.")

    def list_purchase_orders(
        self,
        *,
        query: str | None = None,
        search_by: str = "po",
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[ShopKeeperJobRow], int]:
        q = (query or "").strip()
        field = normalize_search_by(search_by)
        like = f"%{q}%"
        offset = max(0, (page - 1) * page_size)
        search_params: list[object] = []
        search_sql = ""
        if q:
            if field == "po":
                search_sql = "AND J.Jb_PO_Num LIKE ?"
                search_params.append(like)
            elif field == "part":
                search_sql = "AND J.Jb_Part_Num LIKE ?"
                search_params.append(like)
            elif field == "job":
                search_sql = "AND J.Jb_Job_Num LIKE ?"
                search_params.append(like)
            else:
                search_sql = "AND (J.Jb_Cust_Code LIKE ? OR C.Company LIKE ?)"
                search_params.extend([like, like])

        customer_join = """
            LEFT JOIN (
                SELECT [Customer Number], MAX(Company) AS Company
                FROM dbo.Customers
                WHERE [Customer Record Type] IN (N'Both', N'Bill To')
                GROUP BY [Customer Number]
            ) C ON C.[Customer Number] = J.Jb_Cust_Code
        """
        po_key_sql = "ISNULL(NULLIF(LTRIM(RTRIM(J.Jb_PO_Num)), ''), '')"
        conn, _ = self._connect()
        try:
            cur = conn.cursor()
            count_sql = f"""
                SELECT COUNT(*)
                FROM dbo.Jobs J
                {customer_join}
                WHERE 1 = 1
                {search_sql}
            """
            cur.execute(count_sql, *search_params)
            total = int(cur.fetchone()[0] or 0)

            job_sql = f"""
                SELECT
                    {po_key_sql} AS po_key,
                    J.Jb_Job_Num,
                    JS.Sh_PO_Line,
                    J.Jb_Cust_Code,
                    C.Company,
                    J.Jb_Part_Num,
                    J.Jb_Part_Rev,
                    J.Jb_Part_Desc,
                    J.Jb_Qty_Order,
                    JS.Sh_Status,
                    J.Jb_Order_Date,
                    J.Jb_Cert_Required,
                    JS.Sh_Ship_Num
                FROM dbo.Jobs J
                {customer_join}
                LEFT JOIN dbo.JobShip JS
                    ON JS.Sh_Job_Num = J.Jb_Job_Num AND JS.Sh_ReleaseInt = 1
                WHERE 1 = 1
                {search_sql}
                ORDER BY TRY_CONVERT(bigint, J.Jb_Job_Num) DESC, J.Jb_Job_Num DESC
                OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
            """
            cur.execute(job_sql, *search_params, offset, page_size)
            jobs = [
                ShopKeeperJobRow(
                    job_number=str(row[1] or "").strip(),
                    po_number=str(row[0] or ""),
                    po_line=_as_optional_str(row[2]),
                    customer_code=str(row[3] or "").strip(),
                    customer_name=_as_optional_str(row[4]),
                    part_number=str(row[5] or "").strip(),
                    part_revision=str(row[6] or "").strip(),
                    description=_as_optional_str(row[7]),
                    quantity=int(row[8]) if row[8] is not None else None,
                    status=str(row[9] or "").strip(),
                    order_date=_as_date(row[10]),
                    cert_required=_as_bool(row[11]),
                    shipper_number=_as_optional_str(row[12]),
                )
                for row in cur.fetchall()
            ]
            return jobs, total
        finally:
            conn.close()

    def list_shippers(
        self,
        *,
        query: str | None = None,
        search_by: str = "shipper",
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[ShopKeeperShipperRow], int]:
        q = (query or "").strip()
        field = normalize_shipper_search_by(search_by)
        like = f"%{q}%"
        offset = max(0, (page - 1) * page_size)
        search_params: list[object] = []
        search_sql = ""
        if q:
            if field == "shipper":
                search_sql = "AND m.Jsm_Ship_Num LIKE ?"
                search_params.append(like)
            elif field == "po":
                search_sql = """
                    AND EXISTS (
                        SELECT 1
                        FROM dbo.JobShip js
                        JOIN dbo.Jobs j ON j.Jb_Job_Num = js.Sh_Job_Num
                        WHERE js.Sh_Ship_Num = m.Jsm_Ship_Num AND j.Jb_PO_Num LIKE ?
                    )
                """
                search_params.append(like)
            elif field == "job":
                search_sql = """
                    AND EXISTS (
                        SELECT 1 FROM dbo.JobShip js
                        WHERE js.Sh_Ship_Num = m.Jsm_Ship_Num AND js.Sh_Job_Num LIKE ?
                    )
                """
                search_params.append(like)
            else:
                search_sql = """
                    AND EXISTS (
                        SELECT 1
                        FROM dbo.JobShip js
                        JOIN dbo.Jobs j ON j.Jb_Job_Num = js.Sh_Job_Num
                        LEFT JOIN (
                            SELECT [Customer Number], MAX(Company) AS Company
                            FROM dbo.Customers
                            WHERE [Customer Record Type] IN (N'Both', N'Bill To')
                            GROUP BY [Customer Number]
                        ) C ON C.[Customer Number] = j.Jb_Cust_Code
                        WHERE js.Sh_Ship_Num = m.Jsm_Ship_Num
                          AND (j.Jb_Cust_Code LIKE ? OR C.Company LIKE ?)
                    )
                """
                search_params.extend([like, like])

        conn, _ = self._connect()
        try:
            cur = conn.cursor()
            cur.execute(
                f"SELECT COUNT(*) FROM dbo.JobShipMaster m WHERE 1 = 1 {search_sql}",
                *search_params,
            )
            total = int(cur.fetchone()[0] or 0)
            cur.execute(
                f"""
                SELECT
                    m.Jsm_Ship_Num,
                    m.Jsm_Status,
                    m.Jsm_ShipVia,
                    m.Jsm_ShipBy,
                    COALESCE(m.Jsm_ShipperPrinted, 0),
                    (
                        SELECT COUNT(*)
                        FROM dbo.JobShip js
                        WHERE js.Sh_Ship_Num = m.Jsm_Ship_Num
                    ),
                    (
                        SELECT MIN(js.Sh_Ship_Date)
                        FROM dbo.JobShip js
                        WHERE js.Sh_Ship_Num = m.Jsm_Ship_Num
                    ),
                    CASE WHEN EXISTS (
                        SELECT 1 FROM dbo.JobShip js
                        WHERE js.Sh_Ship_Num = m.Jsm_Ship_Num AND js.Sh_Status = N'I'
                    ) THEN 1 ELSE 0 END,
                    (
                        SELECT TOP 1 COALESCE(C.Company, j.Jb_Cust_Code)
                        FROM dbo.JobShip js
                        JOIN dbo.Jobs j ON j.Jb_Job_Num = js.Sh_Job_Num
                        LEFT JOIN (
                            SELECT [Customer Number], MAX(Company) AS Company
                            FROM dbo.Customers
                            WHERE [Customer Record Type] IN (N'Both', N'Bill To')
                            GROUP BY [Customer Number]
                        ) C ON C.[Customer Number] = j.Jb_Cust_Code
                        WHERE js.Sh_Ship_Num = m.Jsm_Ship_Num
                        ORDER BY js.Sh_Job_Num
                    ),
                    (
                        SELECT STRING_AGG(po, N', ') WITHIN GROUP (ORDER BY po)
                        FROM (
                            SELECT DISTINCT NULLIF(LTRIM(RTRIM(j.Jb_PO_Num)), N'') AS po
                            FROM dbo.JobShip js
                            JOIN dbo.Jobs j ON j.Jb_Job_Num = js.Sh_Job_Num
                            WHERE js.Sh_Ship_Num = m.Jsm_Ship_Num
                        ) pos
                    )
                FROM dbo.JobShipMaster m
                WHERE 1 = 1
                {search_sql}
                ORDER BY TRY_CONVERT(bigint, m.Jsm_Ship_Num) DESC, m.Jsm_Ship_Num DESC
                OFFSET ? ROWS FETCH NEXT ? ROWS ONLY
                """,
                *search_params,
                offset,
                page_size,
            )
            rows = [
                ShopKeeperShipperRow(
                    shipper_number=str(row[0] or "").strip(),
                    status=_as_optional_str(row[1]),
                    ship_via=_as_optional_str(row[2]),
                    ship_by=_as_optional_str(row[3]),
                    printed=_as_bool(row[4]),
                    job_count=int(row[5] or 0),
                    ship_date=_as_date(row[6]),
                    invoiced=_as_bool(row[7]),
                    customer_name=_as_optional_str(row[8]),
                    po_numbers=_as_optional_str(row[9]),
                )
                for row in cur.fetchall()
            ]
            return rows, total
        finally:
            conn.close()

    def get_shipper(self, ship_number: str) -> ShopKeeperShipperPage | None:
        number = (ship_number or "").strip()
        if not number:
            return None
        conn, _ = self._connect()
        try:
            cur = conn.cursor()
            header = cur.execute(
                """
                SELECT Jsm_Ship_Num, Jsm_Status, Jsm_ShipVia, Jsm_ShipBy,
                       COALESCE(Jsm_ShipperPrinted, 0), Jsm_TrackingNumber, Jsm_ShipperNote
                FROM dbo.JobShipMaster
                WHERE Jsm_Ship_Num = ?
                """,
                number,
            ).fetchone()
            if header is None:
                return None
            cur.execute(
                """
                SELECT
                    ISNULL(NULLIF(LTRIM(RTRIM(J.Jb_PO_Num)), ''), '') AS po_key,
                    J.Jb_Job_Num,
                    JS.Sh_PO_Line,
                    J.Jb_Cust_Code,
                    C.Company,
                    J.Jb_Part_Num,
                    J.Jb_Part_Rev,
                    J.Jb_Part_Desc,
                    J.Jb_Qty_Order,
                    JS.Sh_Status,
                    J.Jb_Order_Date,
                    J.Jb_Cert_Required,
                    JS.Sh_Ship_Num,
                    JS.Sh_Ship_Date
                FROM dbo.JobShip JS
                JOIN dbo.Jobs J ON J.Jb_Job_Num = JS.Sh_Job_Num
                LEFT JOIN (
                    SELECT [Customer Number], MAX(Company) AS Company
                    FROM dbo.Customers
                    WHERE [Customer Record Type] IN (N'Both', N'Bill To')
                    GROUP BY [Customer Number]
                ) C ON C.[Customer Number] = J.Jb_Cust_Code
                WHERE JS.Sh_Ship_Num = ?
                ORDER BY TRY_CONVERT(bigint, J.Jb_Job_Num), J.Jb_Job_Num
                """,
                number,
            )
            jobs: list[ShopKeeperJobRow] = []
            dates: list[date] = []
            for row in cur.fetchall():
                jobs.append(
                    ShopKeeperJobRow(
                        job_number=str(row[1] or "").strip(),
                        po_number=str(row[0] or ""),
                        po_line=_as_optional_str(row[2]),
                        customer_code=str(row[3] or "").strip(),
                        customer_name=_as_optional_str(row[4]),
                        part_number=str(row[5] or "").strip(),
                        part_revision=str(row[6] or "").strip(),
                        description=_as_optional_str(row[7]),
                        quantity=int(row[8]) if row[8] is not None else None,
                        status=str(row[9] or "").strip(),
                        order_date=_as_date(row[10]),
                        cert_required=_as_bool(row[11]),
                        shipper_number=_as_optional_str(row[12]),
                    )
                )
                ship_date = _as_date(row[13])
                if ship_date is not None:
                    dates.append(ship_date)
            invoiced = any(job.status == "I" for job in jobs)
            pos = sorted({job.po_number for job in jobs if job.po_number.strip()})
            names = [job.customer_name or job.customer_code for job in jobs if job.customer_name or job.customer_code]
            return ShopKeeperShipperPage(
                shipper_number=str(header[0] or "").strip(),
                status=_as_optional_str(header[1]),
                ship_via=_as_optional_str(header[2]),
                ship_by=_as_optional_str(header[3]),
                printed=_as_bool(header[4]),
                tracking_number=_as_optional_str(header[5]),
                note=_as_optional_str(header[6]),
                invoiced=invoiced,
                job_count=len(jobs),
                customer_name=names[0] if names else None,
                po_numbers=", ".join(pos) if pos else None,
                ship_date=min(dates) if dates else None,
                jobs=jobs,
            )
        finally:
            conn.close()

    def lookup_prices(
        self,
        customer_number: str,
        part_number: str,
        part_revision: str,
        quantity: int | None = None,
    ) -> list[PriceQuote]:
        today = date.today()
        quotes: list[PriceQuote] = []
        conn, _ = self._connect()
        try:
            cur = conn.cursor()
            for row in cur.execute(
                """
                SELECT Ccp_Price, Ccp_Note
                FROM dbo.CustomerContractPrices
                WHERE Ccp_PartNum = ? AND Ccp_Customer = ?
                  AND Ccp_Price IS NOT NULL
                  AND (Ccp_ExpirationDate IS NULL OR Ccp_ExpirationDate >= ?)
                """,
                part_number,
                customer_number,
                today,
            ).fetchall():
                price = _as_money(row[0])
                if price is None:
                    continue
                quotes.append(
                    PriceQuote(
                        source="contract",
                        unit_price=price,
                        note=_as_optional_str(row[1]) or "Contract",
                    )
                )

            part_row = cur.execute(
                """
                SELECT Pm_LinkID
                FROM dbo.PartMaster
                WHERE Pm_PartNum = ? AND Pm_PartRev = ? AND COALESCE(Pm_InActive, 0) = 0
                """,
                part_number,
                part_revision,
            ).fetchone()
            if part_row:
                breaks = [
                    (int(row[0]) if row[0] is not None else 0, _as_money(row[1]), _as_optional_str(row[2]))
                    for row in cur.execute(
                        """
                        SELECT Pmpm_Qty, Pmpm_Price, Pmpm_Note
                        FROM dbo.PartMasterPriceMatrix
                        WHERE Pmpm_LinkID = ?
                          AND Pmpm_Price IS NOT NULL
                          AND (Pmpm_ExpirationDate IS NULL OR Pmpm_ExpirationDate >= ?)
                        ORDER BY Pmpm_Qty
                        """,
                        int(part_row[0]),
                        today,
                    ).fetchall()
                ]
                breaks = [row for row in breaks if row[1] is not None]
                if quantity is not None:
                    eligible = [row for row in breaks if row[0] <= quantity]
                    if eligible:
                        qty, price, note = max(eligible, key=lambda row: row[0])
                        quotes.append(
                            PriceQuote(
                                source="matrix",
                                unit_price=price,
                                quantity=qty,
                                note=note or f"Qty break {qty}",
                            )
                        )
                else:
                    for qty, price, note in breaks:
                        quotes.append(
                            PriceQuote(
                                source="matrix",
                                unit_price=price,
                                quantity=qty,
                                note=note or f"Qty break {qty}",
                            )
                        )

            history: list[PriceQuote] = []
            for row in cur.execute(
                """
                SELECT TOP 200 Jb_Job_Num, Jb_PO_Num, Jb_Price, Jb_Qty_Order, Jb_Order_Date
                FROM dbo.Jobs
                WHERE Jb_Cust_Code = ? AND Jb_Part_Num = ? AND Jb_Part_Rev = ?
                  AND Jb_Price IS NOT NULL
                ORDER BY Jb_Order_Date DESC, TRY_CONVERT(bigint, Jb_Job_Num) DESC, Jb_Job_Num DESC
                """,
                customer_number,
                part_number,
                part_revision,
            ).fetchall():
                price = _as_money(row[2])
                if price is None:
                    continue
                history.append(
                    PriceQuote(
                        source="history",
                        unit_price=price,
                        quantity=int(row[3]) if row[3] is not None else None,
                        job_number=str(row[0] or "").strip() or None,
                        po_number=_as_optional_str(row[1]),
                        order_date=_as_date(row[4]),
                    )
                )
            for row in cur.execute(
                """
                SELECT TOP 200
                    Q.ProQ_Num, Q.ProQ_QuoteNum, I.ProI_Price, I.ProI_QuoteQty,
                    COALESCE(Q.ProQ_Date, M.ProM_Date)
                FROM dbo.ProposalQuotes Q
                INNER JOIN dbo.ProposalItems I
                    ON I.ProI_Num = Q.ProQ_Num AND I.ProI_QuoteNum = Q.ProQ_QuoteNum
                INNER JOIN dbo.ProposalMaster M
                    ON M.ProM_Num = Q.ProQ_Num
                WHERE M.ProM_CustCode = ?
                  AND Q.ProQ_PartNum = ?
                  AND Q.ProQ_PartRev = ?
                  AND I.ProI_Price IS NOT NULL
                  AND COALESCE(Q.ProQ_ObsoletePrice, 0) = 0
                ORDER BY COALESCE(Q.ProQ_Date, M.ProM_Date) DESC, Q.ProQ_Num DESC, I.ProI_QuoteQty
                """,
                customer_number,
                part_number,
                part_revision,
            ).fetchall():
                price = _as_money(row[2])
                if price is None:
                    continue
                history.append(
                    PriceQuote(
                        source="proposal",
                        unit_price=price,
                        quantity=int(row[3]) if row[3] is not None else None,
                        job_number=_as_optional_str(row[0]),
                        po_number=_as_optional_str(row[1]),
                        order_date=_as_date(row[4]),
                        note="Proposal",
                    )
                )
            quotes.extend(sort_price_history(history))
            return quotes
        finally:
            conn.close()
