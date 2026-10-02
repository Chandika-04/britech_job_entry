from __future__ import annotations

from app.config import get_settings
from app.exceptions import AppError
from app.services.shopkeeper.types import CustomerRecord, JobWritePayload, PartRecord, ShipWritePayload


class FakeShopKeeper:
    _shared: "FakeShopKeeper | None" = None

    def __init__(self) -> None:
        self.database_name = "SkData_Test"
        self.next_job = 200001
        self.next_ship = 500001
        self.jobs: list[tuple[str, str, str]] = []
        self.reserved_numbers: list[str] = []
        self.reserved_ship_numbers: list[str] = []
        self.job_to_ship: dict[str, str] = {}
        self.shippers: list[tuple[str, list[str]]] = []
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
            PartRecord("SUB-BEC-12352-0016", "A", "Test housing", "Production", 101, False),
            PartRecord("4022.656.2799", "A", "Machined sleeve", "Production", 102, False),
            PartRecord("MULTI-REV", "A", "Rev A widget", "Production", 103, False),
            PartRecord("MULTI-REV", "B", "Rev B widget", "Production", 104, False),
            PartRecord("DEAD-PART", "A", "Inactive", "Production", 105, True),
        ]
        self.last_payload: JobWritePayload | None = None

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
        q = (query or "").strip().lower()
        if not q:
            return []
        return [
            row
            for row in self.customers
            if row.record_type in {"Both", "Bill To"}
            and (
                row.customer_number.lower() == q
                or (row.company or "").lower() == q
                or q in row.customer_number.lower()
                or q in (row.company or "").lower()
            )
        ]

    def list_customers(self) -> list[CustomerRecord]:
        self.current_database()
        return [row for row in self.customers if row.record_type in {"Both", "Bill To"}]

    def get_customer(self, customer_number: str) -> CustomerRecord | None:
        self.current_database()
        for row in self.customers:
            if row.customer_number == customer_number and row.record_type in {"Both", "Bill To"}:
                return row
        return None

    def lookup_parts(self, part_number: str, part_revision: str | None = None) -> list[PartRecord]:
        self.current_database()
        rows = [row for row in self.parts if row.part_number == part_number and not row.inactive]
        if part_revision:
            rows = [row for row in rows if row.part_revision == part_revision]
        return rows

    def get_part(self, part_number: str, part_revision: str) -> PartRecord | None:
        rows = self.lookup_parts(part_number, part_revision)
        return rows[0] if len(rows) == 1 else None

    def find_jobs_by_po_line(self, po_number: str, po_line: str) -> list[str]:
        self.current_database()
        return [job for po, line, job in self.jobs if po == po_number and line == po_line]

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
        self.last_payload = payload
        if self.fail_after_commit:
            raise RuntimeError("Failed after ShopKeeper commit")
        return job_num

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
        self.shippers.append((ship_num, [line.job_number for line in payload.lines]))
        self.last_ship_payload = payload
        if self.fail_after_commit:
            raise RuntimeError("Failed after ShopKeeper commit")
        return ship_num
