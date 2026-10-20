from __future__ import annotations

from datetime import date
from decimal import Decimal

from app.config import get_settings
from app.exceptions import AppError, ConflictError
from app.services.shopkeeper.lookup import LOOKUP_LIMIT, paginate_jobs, paginate_parts, paginate_shippers, sort_price_history, starts_with
from app.services.shopkeeper.ops_util import copy_op
from app.services.shopkeeper.types import (
    CertText,
    CustomerRecord,
    JobHeaderUpdate,
    JobPageRecord,
    JobWritePayload,
    OperationRow,
    OpTemplate,
    PartEditorRecord,
    PartHeaderUpdate,
    PartMasterListRow,
    PartPicture,
    PartRecord,
    PriceQuote,
    PrintDocumentData,
    ShipWritePayload,
    ShopKeeperJobRow,
    ShopKeeperShipperPage,
    ShopKeeperShipperRow,
    WorkCenter,
)


class FakeShopKeeper:
    _shared: "FakeShopKeeper | None" = None

    def __init__(self) -> None:
        self.database_name = "SkData_Test"
        self.next_job = 200001
        self.next_ship = 500001
        self.jobs: list[tuple[str, str, str]] = []
        self.reserved_numbers: list[str] = []
        self.reserved_ship_numbers: list[str] = []
        self.job_to_ship: dict[str, str] = {"199201": "S000012"}
        self.ship_qty: dict[str, int] = {}
        self.shippers: list[tuple[str, list[str]]] = []
        self.shipper_meta: dict[str, dict] = {
            "S000012": {
                "status": "S",
                "ship_via": "UPS",
                "ship_by": "Jane Sales",
                "ship_date": date(2026, 10, 1),
                "printed": False,
                "tracking": None,
                "note": None,
            }
        }
        self.last_ship_payload: ShipWritePayload | None = None
        self.fail_connect = False
        self.fail_step: str | None = None
        self.fail_after_commit = False
        self.customers = [
            CustomerRecord(
                customer_number="BAYADV",
                company="Bay Advanced",
                record_type="Bill To",
                bill_to_customer_number=None,
                active=True,
                credit_hold=False,
                payment_terms="Net 30",
                shipped_via="UPS",
                salesman="Jane Sales",
                cert_default=True,
                taxable_default=False,
                tax_code="NT",
                street="1200 Industrial Pkwy",
                city="Fremont",
                state="CA",
                postal_code="94538",
                country="USA",
            ),
            CustomerRecord(
                customer_number="BAYADV-S",
                company="Bay Advanced",
                record_type="Ship To",
                bill_to_customer_number="BAYADV",
                active=True,
                credit_hold=False,
                payment_terms="Net 30",
                shipped_via="UPS",
                salesman="Jane Sales",
                cert_default=True,
                taxable_default=False,
                tax_code="NT",
                street="Dock 4",
                city="Fremont",
                state="CA",
                postal_code="94538",
                country="USA",
            ),
            CustomerRecord(
                customer_number="CORTEC",
                company="Cortec",
                record_type="Both",
                bill_to_customer_number=None,
                active=True,
                credit_hold=False,
                payment_terms="Net 15",
                shipped_via="Will Call",
                salesman="Sam Seller",
                cert_default=False,
                taxable_default=False,
                tax_code=None,
                street="100 Cortec Way",
                city="San Jose",
                state="CA",
                postal_code="95112",
                country="USA",
            ),
            CustomerRecord(
                customer_number="TAXCO",
                company="Tax Co",
                record_type="Both",
                bill_to_customer_number=None,
                active=True,
                credit_hold=False,
                payment_terms="Net 30",
                shipped_via="UPS",
                salesman="Pat Tax",
                cert_default=False,
                taxable_default=True,
                tax_code="CA",
            ),
            CustomerRecord(
                customer_number="ACME",
                company="Acme Manufacturing Inc",
                record_type="Both",
                bill_to_customer_number=None,
                active=True,
                credit_hold=False,
                payment_terms="Net 30",
                shipped_via="UPS",
                salesman="Jane Sales",
                cert_default=False,
                taxable_default=False,
                tax_code=None,
            ),
            CustomerRecord(
                customer_number="MDC",
                company="MDC",
                record_type="Both",
                bill_to_customer_number=None,
                active=True,
                credit_hold=False,
                payment_terms="Net 30",
                shipped_via="FedEx",
                salesman="Sam Seller",
                cert_default=True,
                taxable_default=False,
                tax_code=None,
            ),
            CustomerRecord(
                customer_number="HOLDCO",
                company="Hold Co",
                record_type="Both",
                bill_to_customer_number=None,
                active=True,
                credit_hold=True,
                payment_terms="COD",
                shipped_via=None,
                salesman=None,
                cert_default=False,
                taxable_default=False,
                tax_code="NT",
            ),
            CustomerRecord(
                customer_number="OLDCO",
                company="Old Co",
                record_type="Both",
                bill_to_customer_number=None,
                active=False,
                credit_hold=False,
                payment_terms=None,
                shipped_via=None,
                salesman=None,
                cert_default=False,
                taxable_default=False,
                tax_code=None,
            ),
        ]
        self.parts = [
            PartRecord("SUB-BEC-12352-0016", "A", "Test housing", "Production", 101, False, "BAYADV"),
            PartRecord("4022.656.2799", "A", "Machined sleeve", "Production", 102, False, "BAYADV"),
            PartRecord("MULTI-REV", "A", "Rev A widget", "Production", 103, False, "CORTEC"),
            PartRecord("MULTI-REV", "B", "Rev B widget", "Production", 104, False, "CORTEC"),
            PartRecord("DEAD-PART", "A", "Inactive", "Production", 105, True, "ACME"),
            PartRecord("NO-OPS", "A", "No routing", "Production", 106, False, "CORTEC"),
        ]
        self.next_pm_id = 1000
        self.last_payload: JobWritePayload | None = None
        self.job_records: list[ShopKeeperJobRow] = [
            ShopKeeperJobRow(
                job_number="199101",
                po_number="PO-4501",
                po_line="1",
                customer_code="BAYADV",
                customer_name="Bay Advanced",
                part_number="SUB-BEC-12352-0016",
                part_revision="A",
                description="Test housing",
                quantity=10,
                status="",
                order_date=date(2026, 9, 28),
                cert_required=True,
                shipper_number=None,
            ),
            ShopKeeperJobRow(
                job_number="199102",
                po_number="PO-4501",
                po_line="2",
                customer_code="BAYADV",
                customer_name="Bay Advanced",
                part_number="4022.656.2799",
                part_revision="A",
                description="Machined sleeve",
                quantity=4,
                status="",
                order_date=date(2026, 9, 28),
                cert_required=True,
                shipper_number=None,
            ),
            ShopKeeperJobRow(
                job_number="199201",
                po_number="PO-8802",
                po_line="1",
                customer_code="CORTEC",
                customer_name="Cortec",
                part_number="MULTI-REV",
                part_revision="B",
                description="Rev B widget",
                quantity=2,
                status="S",
                order_date=date(2026, 10, 1),
                cert_required=False,
                shipper_number="S000012",
            ),
            ShopKeeperJobRow(
                job_number="198301",
                po_number="MDC-12",
                po_line="1",
                customer_code="MDC",
                customer_name="MDC",
                part_number="SUB-BEC-12352-0016",
                part_revision="A",
                description="Test housing",
                quantity=1,
                status="I",
                order_date=date(2026, 8, 15),
                cert_required=True,
                shipper_number=None,
            ),
        ]
        self.contract_prices = [
            {"customer": "BAYADV", "part": "SUB-BEC-12352-0016", "price": Decimal("9.25"), "note": "Contract"},
        ]
        self.matrix_prices = [
            {"pm_linkid": 101, "qty": 1, "price": Decimal("10.00")},
            {"pm_linkid": 101, "qty": 10, "price": Decimal("8.50")},
        ]
        self.price_history = [
            PriceQuote(
                source="history",
                unit_price=Decimal("9.10"),
                quantity=10,
                job_number="199101",
                po_number="PO-4501",
                order_date=date(2026, 9, 28),
                note="BAYADV SUB-BEC-12352-0016 A",
            ),
            *[
                PriceQuote(
                    source="history",
                    unit_price=Decimal("8.90") - Decimal(index) * Decimal("0.05"),
                    quantity=10,
                    job_number=str(198900 - index),
                    po_number=f"PO-OLD-{index + 1}",
                    order_date=date(2026, 8, max(1, 20 - index)),
                    note="BAYADV SUB-BEC-12352-0016 A",
                )
                for index in range(18)
            ],
            PriceQuote(
                source="proposal",
                unit_price=Decimal("9.40"),
                quantity=25,
                job_number="P1001",
                po_number="Q5001",
                order_date=date(2026, 7, 2),
                note="BAYADV SUB-BEC-12352-0016 A",
            ),
            PriceQuote(
                source="history",
                unit_price=Decimal("8.75"),
                quantity=1,
                job_number="198301",
                po_number="MDC-12",
                order_date=date(2026, 8, 15),
                note="MDC SUB-BEC-12352-0016 A",
            ),
        ]
        self.next_op_id = 1
        self.next_pic_id = 1
        self.work_centers = [
            WorkCenter("EP", "Electropolish"),
            WorkCenter("PASN", "Passivate"),
            WorkCenter("QC", "Quality Check"),
            WorkCenter("PKG", "Packaging"),
            WorkCenter("Rinse", "Rinse"),
            WorkCenter("MATL Check", "Material Check"),
            WorkCenter("CHEM", "Chemical Cleaning"),
        ]
        self.cert_texts = [
            CertText("EP B912-13", "ASTM B912 Electropolish", "<div>Electropolished per ASTM B912.</div>"),
            CertText("PASS A967", "ASTM A967 Passivate", "<div>Passivated per ASTM A967.</div>"),
        ]
        self.templates = [
            OpTemplate(1, "Electropolish", "ASTM B912 Electropolishing", 0, 3),
            OpTemplate(2, "Empty", "Empty template", 99, 0),
        ]
        self.template_ops = {
            1: [
                OperationRow(None, 10, "MATL Check", "Material check", None, 0.1, 0, False),
                OperationRow(None, 20, "EP", "Electropolish", "<div>EP bath</div>", 0.5, 0, False),
                OperationRow(None, 30, "QC", "Final QC", None, 0.1, 0, False),
            ],
            2: [],
        }
        self.part_ops: dict[int, list[OperationRow]] = {
            101: [
                self._new_part_op(101, 10, "MATL Check", "Material check"),
                self._new_part_op(101, 20, "EP", "Electropolish"),
                self._new_part_op(101, 30, "Rinse", "Rinse"),
                self._new_part_op(101, 40, "QC", "QC"),
            ],
            102: [
                self._new_part_op(102, 10, "EP", "Electropolish"),
                self._new_part_op(102, 20, "QC", "QC"),
            ],
            104: [
                self._new_part_op(104, 10, "CHEM", "Chem clean"),
                self._new_part_op(104, 20, "EP", "Electropolish"),
            ],
        }
        self.part_certs: dict[int, list[str]] = {101: ["EP B912-13"], 104: ["EP B912-13"]}
        self.part_pics: dict[int, list[PartPicture]] = {}
        self.part_holds: dict[int, dict] = {}
        self.locked_parts: set[int] = set()
        self.job_ops: dict[str, list[OperationRow]] = {}
        self.job_details: dict[str, JobPageRecord] = {}
        self.traveler_printed: set[str] = set()
        self.op_children: set[int] = set()
        self.locked_jobs: set[str] = set()
        self.kitted_qty: dict[str, int] = {}
        self.po_line_jobs: set[str] = set()
        self.serial_jobs: set[str] = set()
        self.lock_info: list[tuple[str, str, str, str]] = []
        self.fail_ops = False

    def _new_part_op(self, pm_linkid: int, seq: float, wc: str, desc: str) -> OperationRow:
        op_id = self.next_op_id
        self.next_op_id += 1
        return OperationRow(op_id, seq, wc, desc, None, 0.2, 0, False, om_link=op_id, rowversion="1")

    @classmethod
    def shared(cls) -> "FakeShopKeeper":
        if cls._shared is None:
            cls._shared = cls()
        return cls._shared

    @classmethod
    def reset_shared(cls) -> "FakeShopKeeper":
        cls._shared = cls()
        return cls._shared

    def current_database(self) -> str:
        if self.fail_connect:
            raise AppError("Unable to connect to ShopKeeper.", status_code=503)
        settings = get_settings()
        if self.database_name != settings.shopkeeper_expected_database:
            raise AppError(
                f"Connected to {self.database_name}, expected {settings.shopkeeper_expected_database}.",
                status_code=409,
            )
        return self.database_name

    def lookup_customers(self, query: str) -> list[CustomerRecord]:
        self.current_database()
        q = (query or "").strip()
        if not q:
            return []
        matches = [
            row
            for row in self.customers
            if row.record_type in {"Both", "Bill To"}
            and (starts_with(row.customer_number, q) or starts_with(row.company, q))
        ]
        matches.sort(key=lambda row: (0 if starts_with(row.customer_number, q) else 1, row.customer_number))
        return matches[:LOOKUP_LIMIT]

    def list_customers(self) -> list[CustomerRecord]:
        self.current_database()
        return [row for row in self.customers if row.record_type in {"Both", "Bill To"}]

    def get_customer(self, customer_number: str) -> CustomerRecord | None:
        self.current_database()
        code = (customer_number or "").strip().casefold()
        for row in self.customers:
            if row.customer_number.casefold() == code and row.record_type in {"Both", "Bill To"}:
                return row
        return None

    def lookup_ship_tos(self, bill_to_number: str) -> list[CustomerRecord]:
        self.current_database()
        code = (bill_to_number or "").strip().lower()
        return [
            row
            for row in self.customers
            if (row.record_type or "").lower() == "ship to"
            and (row.bill_to_customer_number or "").lower() == code
        ]

    def lookup_parts(self, part_number: str, part_revision: str | None = None) -> list[PartRecord]:
        self.current_database()
        q = (part_number or "").strip()
        if not q:
            return []
        rows = [row for row in self.parts if not row.inactive and starts_with(row.part_number, q)]
        if part_revision and part_revision.strip():
            rows = [row for row in rows if starts_with(row.part_revision, part_revision)]
        rows.sort(key=lambda row: (row.part_number, row.part_revision))
        return rows[:LOOKUP_LIMIT]

    def get_part(self, part_number: str, part_revision: str) -> PartRecord | None:
        self.current_database()
        for row in self.parts:
            if row.part_number == part_number and row.part_revision == part_revision and not row.inactive:
                return row
        return None

    def find_jobs_by_po_line(self, po_number: str, po_line: str) -> list[str]:
        self.current_database()
        return [job for po, line, job in self.jobs if po == po_number and line == po_line]

    def find_duplicate_jobs(self, po_number: str, customer_code: str, part_number: str) -> list[str]:
        self.current_database()
        return [
            row.job_number
            for row in self.job_records
            if row.po_number == po_number
            and row.customer_code == customer_code
            and row.part_number == part_number
        ]

    def create_job(self, payload: JobWritePayload) -> str:
        self.current_database()
        if self.fail_step == "reserve":
            raise RuntimeError("Forced failure at reserve")
        job_num = str(self.next_job)
        self.next_job += 1
        self.reserved_numbers.append(job_num)
        if self.fail_step in {"lock", "jobs", "jobship", "jobrelease", "schedule"}:
            raise RuntimeError(f"Forced failure at {self.fail_step}")
        self.jobs.append((payload.po_number, payload.po_line, job_num))
        customer = next((row for row in self.customers if row.customer_number == payload.customer_code), None)
        self.job_records.append(
            ShopKeeperJobRow(
                job_number=job_num,
                po_number=payload.po_number,
                po_line=payload.po_line,
                customer_code=payload.customer_code,
                customer_name=customer.company if customer else None,
                part_number=payload.part_number,
                part_revision=payload.part_revision,
                description=payload.part_description,
                quantity=payload.quantity,
                status="",
                order_date=date.today(),
                cert_required=payload.cert_required,
                shipper_number=None,
            )
        )
        self.price_history.append(
            PriceQuote(
                source="history",
                unit_price=payload.unit_price,
                quantity=payload.quantity,
                job_number=job_num,
                po_number=payload.po_number,
                order_date=date.today(),
                note=f"{payload.customer_code} {payload.part_number} {payload.part_revision}",
            )
        )
        self.last_payload = payload
        ops = self.part_ops.get(payload.pm_linkid, [])
        copied: list[OperationRow] = []
        for row in ops:
            new_id = self.next_op_id
            self.next_op_id += 1
            copied.append(copy_op(row, new_id=new_id, om_link=row.id))
        self.job_ops[job_num] = copied
        self.job_details[job_num] = JobPageRecord(
            job_number=job_num,
            customer_code=payload.customer_code,
            customer_name=customer.company if customer else None,
            po_number=payload.po_number,
            po_line=payload.po_line,
            part_number=payload.part_number,
            part_revision=payload.part_revision,
            pm_linkid=payload.pm_linkid,
            description=payload.part_description,
            quantity=payload.quantity,
            unit=payload.unit,
            unit_price=payload.unit_price,
            due_date=payload.due_date,
            cert_required=payload.cert_required,
            cert_linked=self.part_has_certification(payload.pm_linkid),
            quality_hold=bool(self.part_holds.get(payload.pm_linkid, {}).get("hold")),
            status=payload.status,
            shipper_number=None,
            traveler_printed=False,
            operations=copied,
            order_date=date.today(),
            notes=None,
        )
        if self.fail_after_commit:
            raise RuntimeError("Failed after ShopKeeper commit")
        return job_num

    def delete_job(self, job_number: str) -> None:
        self.current_database()
        number = (job_number or "").strip()
        detail = self.job_details.get(number)
        record = next((row for row in self.job_records if row.job_number == number), None)
        if detail is None and record is None:
            raise AppError(f"ShopKeeper job {number} was not found.", status_code=404)
        if number in self.locked_jobs:
            raise AppError(f"Job {number} is locked in ShopKeeper.", status_code=409)
        ship_num = self.job_to_ship.get(number)
        if ship_num:
            raise AppError(
                f"Job {number} is on shipper {ship_num}. "
                "Unlink it in ShopKeeper first; this app cannot unlink a shipper.",
                status_code=409,
            )
        if self.ship_qty.get(number):
            raise AppError(f"Job {number} has shipped quantity and cannot be deleted.", status_code=409)
        if number in self.traveler_printed or (detail is not None and detail.traveler_printed):
            raise AppError(f"Job {number} has a printed traveler and cannot be deleted.", status_code=409)
        if any(row.id in self.op_children for row in self.job_ops.get(number, []) if row.id is not None):
            raise AppError(
                f"Job {number} has time, schedule, or inspection records and cannot be deleted.",
                status_code=409,
            )
        if self.kitted_qty.get(number, 0) > 0:
            raise AppError(f"Job {number} has kitted quantity and cannot be deleted.", status_code=409)
        if number in self.po_line_jobs:
            raise AppError(
                f"Job {number} is on a ShopKeeper purchase order line and cannot be deleted.",
                status_code=409,
            )
        if number in self.serial_jobs:
            raise AppError(f"Job {number} has serial numbers and cannot be deleted.", status_code=409)
        self.jobs = [row for row in self.jobs if row[2] != number]
        self.job_records = [row for row in self.job_records if row.job_number != number]
        self.job_ops.pop(number, None)
        self.job_details.pop(number, None)
        self.job_to_ship.pop(number, None)
        self.ship_qty.pop(number, None)
        self.traveler_printed.discard(number)
        self.price_history = [row for row in self.price_history if row.job_number != number]
        self.lock_info.append(("Jobs", number, "AUTO", "Delete Job"))

    def find_shipper_for_jobs(self, job_numbers: list[str]) -> str | None:
        self.current_database()
        if not job_numbers:
            return None
        found = [self.job_to_ship.get(job) for job in job_numbers]
        if any(not ship_num for ship_num in found):
            return None
        unique = set(found)
        return unique.pop() if len(unique) == 1 else None

    def create_shipper(self, payload: ShipWritePayload) -> str:
        self.current_database()
        if self.fail_step == "ship_reserve":
            raise RuntimeError("Forced failure at ship_reserve")
        ship_num = str(self.next_ship)
        self.next_ship += 1
        self.reserved_ship_numbers.append(ship_num)
        if self.fail_step in {"ship_lock", "ship_master", "ship_attach"}:
            raise RuntimeError(f"Forced failure at {self.fail_step}")
        for line in payload.lines:
            self.job_to_ship[line.job_number] = ship_num
            self.ship_qty[line.job_number] = line.quantity
            for job in self.job_records:
                if job.job_number == line.job_number:
                    job.shipper_number = ship_num
                    job.status = "S"
        self.shippers.append((ship_num, [line.job_number for line in payload.lines]))
        self.shipper_meta[ship_num] = {
            "status": "S",
            "ship_via": payload.ship_via,
            "ship_by": payload.ship_by,
            "ship_date": payload.ship_date,
            "printed": False,
            "tracking": None,
            "note": None,
        }
        self.last_ship_payload = payload
        if self.fail_after_commit:
            raise RuntimeError("Failed after ShopKeeper commit")
        return ship_num

    def add_jobs_to_shipper(self, ship_number: str, payload: ShipWritePayload) -> str:
        self.current_database()
        attached: list[str] | None = None
        for existing_num, jobs in self.shippers:
            if existing_num == ship_number:
                attached = jobs
                break
        if attached is None:
            raise RuntimeError(f"Shipper {ship_number} not found.")
        if self.fail_step in {"ship_lock", "ship_master", "ship_attach"}:
            raise RuntimeError(f"Forced failure at {self.fail_step}")
        for line in payload.lines:
            current = self.job_to_ship.get(line.job_number)
            if current == ship_number:
                continue
            if current:
                raise RuntimeError(f"Job {line.job_number} is already on shipper {current}.")
            self.job_to_ship[line.job_number] = ship_number
            self.ship_qty[line.job_number] = line.quantity
            attached.append(line.job_number)
            for job in self.job_records:
                if job.job_number == line.job_number:
                    job.shipper_number = ship_number
                    job.status = "S"
        self.last_ship_payload = payload
        if self.fail_after_commit:
            raise RuntimeError("Failed after ShopKeeper commit")
        return ship_number

    def list_purchase_orders(
        self,
        *,
        query: str | None = None,
        search_by: str = "po",
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[ShopKeeperJobRow], int]:
        self.current_database()
        return paginate_jobs(
            self.job_records,
            query=query,
            search_by=search_by,
            page=page,
            page_size=page_size,
        )

    def _jobs_for_shipper(self, ship_number: str) -> list[ShopKeeperJobRow]:
        return [row for row in self.job_records if row.shipper_number == ship_number]

    def _shipper_row(self, ship_number: str, jobs: list[ShopKeeperJobRow]) -> ShopKeeperShipperRow:
        meta = self.shipper_meta.get(ship_number, {})
        pos = sorted({row.po_number for row in jobs if row.po_number})
        names = [row.customer_name or row.customer_code for row in jobs if row.customer_name or row.customer_code]
        return ShopKeeperShipperRow(
            shipper_number=ship_number,
            status=meta.get("status") or ("I" if any(row.status == "I" for row in jobs) else "S" if jobs else None),
            ship_via=meta.get("ship_via"),
            ship_by=meta.get("ship_by"),
            ship_date=meta.get("ship_date") or next((row.order_date for row in jobs if row.order_date), None),
            printed=bool(meta.get("printed")),
            invoiced=any(row.status == "I" for row in jobs),
            job_count=len(jobs),
            customer_name=names[0] if names else None,
            po_numbers=", ".join(pos) if pos else None,
        )

    def list_shippers(
        self,
        *,
        query: str | None = None,
        search_by: str = "shipper",
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[ShopKeeperShipperRow], int]:
        self.current_database()
        packed: list[tuple[ShopKeeperShipperRow, str]] = []
        seen: set[str] = set()
        numbers = [num for num, _jobs in self.shippers]
        for row in self.job_records:
            if row.shipper_number:
                numbers.append(row.shipper_number)
        for ship_num in numbers:
            if ship_num in seen:
                continue
            seen.add(ship_num)
            jobs = self._jobs_for_shipper(ship_num)
            haystack = " ".join(
                f"{row.job_number} {row.po_number} {row.customer_code} {row.customer_name or ''}" for row in jobs
            )
            packed.append((self._shipper_row(ship_num, jobs), haystack.casefold()))
        return paginate_shippers(packed, query=query, search_by=search_by, page=page, page_size=page_size)

    def get_shipper(self, ship_number: str) -> ShopKeeperShipperPage | None:
        self.current_database()
        number = (ship_number or "").strip()
        jobs = self._jobs_for_shipper(number)
        if not jobs and number not in self.shipper_meta and not any(num == number for num, _jobs in self.shippers):
            return None
        row = self._shipper_row(number, jobs)
        meta = self.shipper_meta.get(number, {})
        return ShopKeeperShipperPage(
            shipper_number=row.shipper_number,
            status=row.status,
            ship_via=row.ship_via,
            ship_by=row.ship_by,
            ship_date=row.ship_date,
            printed=row.printed,
            invoiced=row.invoiced,
            job_count=row.job_count,
            customer_name=row.customer_name,
            po_numbers=row.po_numbers,
            tracking_number=meta.get("tracking"),
            note=meta.get("note"),
            jobs=jobs,
        )

    def lookup_prices(
        self,
        customer_number: str,
        part_number: str,
        part_revision: str,
        quantity: int | None = None,
    ) -> list[PriceQuote]:
        self.current_database()
        quotes: list[PriceQuote] = []
        for row in self.contract_prices:
            if row["customer"] == customer_number and row["part"] == part_number:
                quotes.append(
                    PriceQuote(
                        source="contract",
                        unit_price=row["price"],
                        note=row.get("note") or "Contract",
                    )
                )
        part = self.get_part(part_number, part_revision)
        if part:
            breaks = [row for row in self.matrix_prices if row["pm_linkid"] == part.pm_linkid]
            if quantity is not None:
                eligible = [row for row in breaks if row["qty"] <= quantity]
                if eligible:
                    best = max(eligible, key=lambda row: row["qty"])
                    quotes.append(
                        PriceQuote(
                            source="matrix",
                            unit_price=best["price"],
                            quantity=best["qty"],
                            note=f"Qty break {best['qty']}",
                        )
                    )
            else:
                for row in breaks:
                    quotes.append(
                        PriceQuote(
                            source="matrix",
                            unit_price=row["price"],
                            quantity=row["qty"],
                            note=f"Qty break {row['qty']}",
                        )
                    )
        key = f"{customer_number} {part_number} {part_revision}"
        quotes.extend(
            sort_price_history(
                [
                    quote
                    for quote in self.price_history
                    if (quote.note or "") == key or (quote.note or "").startswith(key)
                ]
            )
        )
        return quotes

    def job_op_count(self, job_number: str) -> int:
        self.current_database()
        return len(self.job_ops.get(job_number, []))

    def part_has_certification(self, pm_linkid: int) -> bool:
        self.current_database()
        return bool(self.part_certs.get(pm_linkid))

    def list_work_centers(self) -> list[WorkCenter]:
        self.current_database()
        return list(self.work_centers)

    def list_op_templates(self) -> list[OpTemplate]:
        self.current_database()
        return list(self.templates)

    def list_certification_texts(self) -> list[CertText]:
        self.current_database()
        return [CertText(row.id, row.description, None) for row in self.cert_texts]

    def get_job_page(self, job_number: str) -> JobPageRecord | None:
        self.current_database()
        detail = self.job_details.get(job_number)
        if detail is None:
            return None
        ops = list(self.job_ops.get(job_number, []))
        pm = detail.pm_linkid
        detail.operations = ops
        detail.cert_linked = self.part_has_certification(pm) if pm else False
        detail.quality_hold = bool(self.part_holds.get(pm or 0, {}).get("hold"))
        detail.traveler_printed = job_number in self.traveler_printed
        detail.shipper_number = self.job_to_ship.get(job_number)
        detail.pictures = list(self.part_pics.get(pm, [])) if pm else []
        return detail

    def update_job_header(self, job_number: str, payload: JobHeaderUpdate) -> JobPageRecord:
        self.current_database()
        if job_number not in self.job_details:
            raise AppError("Job not found.", status_code=404)
        customer = self.get_customer(payload.customer_code.strip())
        if customer is None or not customer.active:
            raise AppError("ShopKeeper customer not found.", status_code=409)
        part = self.get_part(payload.part_number.strip(), payload.part_revision.strip())
        if part is None or part.inactive:
            raise AppError("ShopKeeper part not found.", status_code=409)
        unit = "Lot" if payload.unit.strip().lower() == "lot" else "Each"
        detail = self.job_details[job_number]
        detail.customer_code = customer.customer_number
        detail.customer_name = customer.company
        detail.po_number = payload.po_number.strip()
        detail.po_line = (payload.po_line or "").strip() or None
        detail.part_number = part.part_number
        detail.part_revision = part.part_revision
        detail.pm_linkid = part.pm_linkid
        detail.description = payload.description or part.description
        detail.quantity = payload.quantity
        detail.unit = unit
        detail.unit_price = payload.unit_price
        detail.order_date = payload.order_date
        detail.notes = payload.notes
        detail.cert_required = payload.cert_required
        if self.job_to_ship.get(job_number):
            self.ship_qty[job_number] = payload.quantity
        self.jobs = [
            (detail.po_number, detail.po_line or "", job_number) if row[2] == job_number else row for row in self.jobs
        ]
        for row in self.job_records:
            if row.job_number == job_number:
                row.po_number = detail.po_number
                row.po_line = detail.po_line
                row.customer_code = detail.customer_code
                row.customer_name = detail.customer_name
                row.part_number = detail.part_number
                row.part_revision = detail.part_revision
                row.description = detail.description
                row.quantity = detail.quantity
                row.cert_required = detail.cert_required
        return self.get_job_page(job_number)

    def save_job_operations(self, job_number: str, operations: list[OperationRow]) -> list[OperationRow]:
        self.current_database()
        if job_number not in self.job_details:
            raise AppError("Job not found.", status_code=404)
        if self.fail_ops:
            raise RuntimeError("Forced ops failure")
        for row in self.job_ops.get(job_number, []):
            if row.id in self.op_children:
                raise AppError("Cannot change operations that already have shop-floor activity.", status_code=409)
        saved = []
        for row in operations:
            new_id = row.id or self.next_op_id
            if row.id is None:
                self.next_op_id += 1
            saved.append(copy_op(row, new_id=new_id, om_link=row.om_link))
        self.job_ops[job_number] = saved
        self.job_details[job_number].operations = saved
        return saved

    def replace_job_ops_from_template(self, job_number: str, template_id: int) -> list[OperationRow]:
        self.current_database()
        if job_number not in self.job_details:
            raise AppError("Job not found.", status_code=404)
        steps = self.template_ops.get(template_id)
        if steps is None:
            raise AppError("Template not found.", status_code=404)
        if not steps:
            return list(self.job_ops.get(job_number, []))
        for row in self.job_ops.get(job_number, []):
            if row.id in self.op_children:
                raise AppError("Cannot replace operations that already have shop-floor activity.", status_code=409)
        qty = self.job_details[job_number].quantity
        saved = []
        for row in steps:
            new_id = self.next_op_id
            self.next_op_id += 1
            copied = copy_op(row, new_id=new_id, om_link=row.om_link)
            copied.qty = qty
            saved.append(copied)
        self.job_ops[job_number] = saved
        self.job_details[job_number].operations = saved
        return saved

    def replace_job_ops_from_part(self, job_number: str) -> list[OperationRow]:
        self.current_database()
        if job_number not in self.job_details:
            raise AppError("Job not found.", status_code=404)
        pm_linkid = self.job_details[job_number].pm_linkid
        if pm_linkid is None:
            raise AppError("This job has no part master linked.", status_code=409)
        steps = self.part_ops.get(pm_linkid, [])
        if not steps:
            raise AppError("This part has no operations on the part master.", status_code=409)
        for row in self.job_ops.get(job_number, []):
            if row.id in self.op_children:
                raise AppError("Cannot replace operations that already have shop-floor activity.", status_code=409)
        qty = self.job_details[job_number].quantity
        saved = []
        for row in steps:
            new_id = self.next_op_id
            self.next_op_id += 1
            copied = copy_op(row, new_id=new_id, om_link=row.id)
            copied.qty = qty
            saved.append(copied)
        self.job_ops[job_number] = saved
        self.job_details[job_number].operations = saved
        return saved

    def get_part_editor(self, pm_linkid: int) -> PartEditorRecord | None:
        self.current_database()
        part = next((row for row in self.parts if row.pm_linkid == pm_linkid), None)
        if part is None:
            return None
        hold = self.part_holds.get(pm_linkid, {})
        linked = [row for row in self.cert_texts if row.id in self.part_certs.get(pm_linkid, [])]
        return PartEditorRecord(
            pm_linkid=pm_linkid,
            part_number=part.part_number,
            part_revision=part.part_revision,
            description=part.description,
            customer_code=part.customer_code,
            locked=pm_linkid in self.locked_parts,
            quality_hold=bool(hold.get("hold")),
            quality_hold_note=hold.get("note"),
            fa_hold=False,
            ship_hold=False,
            operations=list(self.part_ops.get(pm_linkid, [])),
            pictures=list(self.part_pics.get(pm_linkid, [])),
            linked_certs=linked,
        )

    def _part_list_row(self, part: PartRecord) -> PartMasterListRow:
        hold = self.part_holds.get(part.pm_linkid, {})
        return PartMasterListRow(
            pm_linkid=part.pm_linkid,
            part_number=part.part_number,
            part_revision=part.part_revision,
            customer_code=part.customer_code,
            description=part.description,
            inactive=part.inactive,
            quality_hold=bool(hold.get("hold")),
            operation_count=len(self.part_ops.get(part.pm_linkid, [])),
            picture_count=len(self.part_pics.get(part.pm_linkid, [])),
            cert_linked=bool(self.part_certs.get(part.pm_linkid)),
        )

    def _find_production_part(self, part_number: str, part_revision: str, exclude_id: int | None = None) -> PartRecord | None:
        number = part_number.casefold()
        rev = part_revision.casefold()
        for row in self.parts:
            if row.part_number.casefold() != number or row.part_revision.casefold() != rev:
                continue
            if exclude_id is not None and row.pm_linkid == exclude_id:
                continue
            return row
        return None

    def list_parts(
        self,
        *,
        query: str | None = None,
        search_by: str = "part",
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[PartMasterListRow], int]:
        self.current_database()
        return paginate_parts(
            [self._part_list_row(row) for row in self.parts],
            query=query,
            search_by=search_by,
            page=page,
            page_size=page_size,
        )

    def create_part(self, payload: PartHeaderUpdate) -> int:
        self.current_database()
        if self._find_production_part(payload.part_number, payload.part_revision):
            raise ConflictError("A Production part with this number and revision already exists.")
        pm_linkid = self.next_pm_id
        self.next_pm_id += 1
        self.parts.append(
            PartRecord(
                payload.part_number,
                payload.part_revision,
                payload.description,
                "Production",
                pm_linkid,
                False,
                payload.customer_code,
            )
        )
        return pm_linkid

    def update_part_header(self, pm_linkid: int, payload: PartHeaderUpdate) -> None:
        self.current_database()
        part = next((row for row in self.parts if row.pm_linkid == pm_linkid), None)
        if part is None:
            raise AppError("Part not found.", status_code=404)
        if pm_linkid in self.locked_parts:
            raise AppError("This part is locked.", status_code=409)
        if self._find_production_part(payload.part_number, payload.part_revision, exclude_id=pm_linkid):
            raise ConflictError("A Production part with this number and revision already exists.")
        part.part_number = payload.part_number
        part.part_revision = payload.part_revision
        part.customer_code = payload.customer_code
        part.description = payload.description

    def save_part_operations(self, pm_linkid: int, operations: list[OperationRow]) -> list[OperationRow]:
        self.current_database()
        if self.get_part_editor(pm_linkid) is None:
            raise AppError("Part not found.", status_code=404)
        if pm_linkid in self.locked_parts:
            raise AppError("This part is locked.", status_code=409)
        saved = []
        for row in operations:
            new_id = row.id or self.next_op_id
            if row.id is None:
                self.next_op_id += 1
            saved.append(copy_op(row, new_id=new_id, om_link=new_id))
        self.part_ops[pm_linkid] = saved
        return saved

    def set_part_quality_hold(self, pm_linkid: int, hold: bool, note: str | None) -> None:
        self.current_database()
        if self.get_part_editor(pm_linkid) is None:
            raise AppError("Part not found.", status_code=404)
        if pm_linkid in self.locked_parts:
            raise AppError("This part is locked.", status_code=409)
        self.part_holds[pm_linkid] = {"hold": hold, "note": note}

    def link_part_cert(self, pm_linkid: int, ctxt_id: str) -> None:
        self.current_database()
        if self.get_part_editor(pm_linkid) is None:
            raise AppError("Part not found.", status_code=404)
        if pm_linkid in self.locked_parts:
            raise AppError("This part is locked.", status_code=409)
        if not any(row.id == ctxt_id for row in self.cert_texts):
            raise AppError("Certification text not found.", status_code=404)
        linked = self.part_certs.setdefault(pm_linkid, [])
        if ctxt_id not in linked:
            linked.append(ctxt_id)

    def unlink_part_cert(self, pm_linkid: int, ctxt_id: str) -> None:
        self.current_database()
        if pm_linkid in self.locked_parts:
            raise AppError("This part is locked.", status_code=409)
        linked = self.part_certs.get(pm_linkid, [])
        self.part_certs[pm_linkid] = [item for item in linked if item != ctxt_id]

    def add_part_picture(self, pm_linkid: int, dest_unc: str, description: str | None) -> PartPicture:
        self.current_database()
        if self.get_part_editor(pm_linkid) is None:
            raise AppError("Part not found.", status_code=404)
        if pm_linkid in self.locked_parts:
            raise AppError("This part is locked.", status_code=409)
        pic_id = self.next_pic_id
        self.next_pic_id += 1
        pic = PartPicture(pic_id, dest_unc, description, True, pic_id)
        self.part_pics.setdefault(pm_linkid, []).append(pic)
        return pic

    def unlink_part_picture(self, pm_linkid: int, pmp_id: int) -> None:
        self.current_database()
        if pm_linkid in self.locked_parts:
            raise AppError("This part is locked.", status_code=409)
        pics = self.part_pics.get(pm_linkid, [])
        self.part_pics[pm_linkid] = [row for row in pics if row.id != pmp_id]

    def load_print_data(self, job_number: str) -> PrintDocumentData:
        self.current_database()
        job = self.get_job_page(job_number)
        if job is None:
            raise AppError("Job not found.", status_code=404)
        pm = job.pm_linkid or 0
        certs = [row for row in self.cert_texts if row.id in self.part_certs.get(pm, [])]
        customer = self.get_customer(job.customer_code)
        ship_to = customer
        if customer is not None:
            tos = self.lookup_ship_tos(customer.customer_number)
            if tos:
                ship_to = tos[0]
        return PrintDocumentData(
            job=job,
            pictures=list(self.part_pics.get(pm, [])),
            certs=certs,
            customer=customer,
            ship_to=ship_to,
        )

    def mark_traveler_printed(self, job_number: str) -> None:
        self.current_database()
        if job_number not in self.job_details:
            raise AppError("Job not found.", status_code=404)
        self.traveler_printed.add(job_number)
        self.job_details[job_number].traveler_printed = True
