from __future__ import annotations

from datetime import datetime

from app.config import get_settings
from app.exceptions import AppError
from app.services.shopkeeper.types import CustomerRecord, JobWritePayload, PartRecord

CUSTOMER_SELECT = """
SELECT [Customer Number], Company, [Customer Record Type], [Bill To Customer Number],
       COALESCE(Active, 1), COALESCE(CreditHold, 0), [Payment Terms], [Shipped Via],
       LEFT(Salesman, 20), COALESCE(Cus_CertDefault, 0), COALESCE(Cus_TaxableDefault, 0),
       Cus_TaxCodeDefault
FROM dbo.Customers
WHERE [Customer Record Type] IN (N'Both', N'Bill To')
"""


def _as_bool(value: object) -> bool:
    return bool(value) if value is not None else False


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


class SqlServerShopKeeper:
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
        q = (query or "").strip()
        if not q:
            return []
        conn, _ = self._connect()
        try:
            rows = conn.cursor().execute(
                CUSTOMER_SELECT
                + " AND ([Customer Number] = ? OR Company = ? OR [Customer Number] LIKE ? OR Company LIKE ?)",
                q,
                q,
                f"%{q}%",
                f"%{q}%",
            ).fetchall()
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

    def lookup_parts(self, part_number: str, part_revision: str | None = None) -> list[PartRecord]:
        conn, _ = self._connect()
        try:
            sql = """
                SELECT Pm_PartNum, Pm_PartRev, Pm_PartDesc, COALESCE(Pm_MasterType, N'Production'),
                       Pm_LinkID, COALESCE(Pm_InActive, 0)
                FROM dbo.PartMaster
                WHERE Pm_PartNum = ? AND COALESCE(Pm_InActive, 0) = 0
            """
            params: list = [part_number]
            if part_revision:
                sql += " AND Pm_PartRev = ?"
                params.append(part_revision)
            rows = conn.cursor().execute(sql, *params).fetchall()
            return [_row_to_part(row) for row in rows]
        finally:
            conn.close()

    def get_part(self, part_number: str, part_revision: str) -> PartRecord | None:
        rows = self.lookup_parts(part_number, part_revision)
        return rows[0] if len(rows) == 1 else None

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
            conn.commit()
            return job_num
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
