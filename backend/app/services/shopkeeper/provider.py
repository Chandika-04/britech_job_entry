from typing import Protocol

from app.services.shopkeeper.types import CustomerRecord, JobWritePayload, PartRecord, ShipWritePayload


class ShopKeeperProvider(Protocol):
    def current_database(self) -> str: ...

    def lookup_customers(self, query: str) -> list[CustomerRecord]: ...

    def list_customers(self) -> list[CustomerRecord]: ...

    def get_customer(self, customer_number: str) -> CustomerRecord | None: ...

    def lookup_parts(self, part_number: str, part_revision: str | None = None) -> list[PartRecord]: ...

    def get_part(self, part_number: str, part_revision: str) -> PartRecord | None: ...

    def find_jobs_by_po_line(self, po_number: str, po_line: str) -> list[str]: ...

    def create_job(self, payload: JobWritePayload) -> str: ...

    def find_shipper_for_jobs(self, job_numbers: list[str]) -> str | None: ...

    def create_shipper(self, payload: ShipWritePayload) -> str: ...


def get_shopkeeper_provider() -> ShopKeeperProvider:
    from app.config import get_settings
    from app.services.shopkeeper.fake import FakeShopKeeper
    from app.services.shopkeeper.sqlserver import SqlServerShopKeeper

    settings = get_settings()
    name = (settings.shopkeeper_provider or "shopkeeper").strip().lower()
    if name == "fake":
        return FakeShopKeeper.shared()
    return SqlServerShopKeeper()
