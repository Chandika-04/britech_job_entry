from datetime import date

from app.services.shopkeeper.types import (
    PartMasterListRow,
    PriceQuote,
    ShopKeeperJobRow,
    ShopKeeperPoGroupRow,
    ShopKeeperShipperRow,
)

SEARCH_FIELDS = ("po", "part", "job", "customer")
SHIPPER_SEARCH_FIELDS = ("shipper", "po", "job", "customer")
PART_SEARCH_FIELDS = ("part", "customer", "description")
LOOKUP_LIMIT = 50


def prefix_like(query: str) -> str | None:
    q = (query or "").strip()
    if not q:
        return None
    escaped = q.replace("[", "[[]").replace("%", "[%]").replace("_", "[_]")
    return f"{escaped}%"


def starts_with(value: str | None, query: str) -> bool:
    q = query.strip().casefold()
    return bool(q) and (value or "").casefold().startswith(q)


def sort_price_history(quotes: list[PriceQuote]) -> list[PriceQuote]:
    return sorted(
        quotes,
        key=lambda quote: (
            quote.order_date is not None,
            quote.order_date or date.min,
            quote.job_number or "",
        ),
        reverse=True,
    )


def normalize_search_by(value: str | None) -> str:
    key = (value or "po").strip().lower()
    return key if key in SEARCH_FIELDS else "po"


def ready_term(value: str | None, min_len: int = 1) -> str | None:
    q = (value or "").strip()
    if len(q) < min_len:
        return None
    return q


def field_min_len(field: str) -> int:
    return 2 if field in ("po", "job") else 1


def job_matches_field(job: ShopKeeperJobRow, query: str, search_by: str) -> bool:
    q = query.casefold()
    if search_by == "po":
        return q in (job.po_number or "").casefold()
    if search_by == "part":
        return q in (job.part_number or "").casefold()
    if search_by == "job":
        return q in (job.job_number or "").casefold()
    haystack = f"{job.customer_code} {job.customer_name or ''}"
    return q in haystack.casefold()


def job_matches_filters(
    job: ShopKeeperJobRow,
    *,
    query: str | None = None,
    search_by: str | None = None,
    po: str | None = None,
    job_number: str | None = None,
    part: str | None = None,
    customer: str | None = None,
) -> bool:
    q = (query or "").strip()
    field = normalize_search_by(search_by)
    if q and len(q) >= field_min_len(field) and not job_matches_field(job, q, field):
        return False
    if term := ready_term(po, 2):
        if not job_matches_field(job, term, "po"):
            return False
    if term := ready_term(job_number, 2):
        if not job_matches_field(job, term, "job"):
            return False
    if term := ready_term(part):
        if not job_matches_field(job, term, "part"):
            return False
    if term := ready_term(customer):
        if not job_matches_field(job, term, "customer"):
            return False
    return True


def _job_recency_key(job: ShopKeeperJobRow) -> tuple[int, str]:
    try:
        return (int(job.job_number), job.job_number)
    except ValueError:
        return (-1, job.job_number)


def normalize_shipper_search_by(value: str | None) -> str:
    key = (value or "shipper").strip().lower()
    return key if key in SHIPPER_SEARCH_FIELDS else "shipper"


def shipper_matches_field(row: ShopKeeperShipperRow, query: str, search_by: str, job_haystack: str = "") -> bool:
    q = query.casefold()
    if search_by == "shipper":
        return q in (row.shipper_number or "").casefold()
    if search_by == "po":
        return q in (row.po_numbers or "").casefold() or q in job_haystack
    if search_by == "job":
        return q in job_haystack
    haystack = f"{row.customer_name or ''} {row.customer_code or ''} {job_haystack}"
    return q in haystack.casefold()


def shipper_matches_filters(
    row: ShopKeeperShipperRow,
    job_haystack: str = "",
    *,
    query: str | None = None,
    search_by: str | None = None,
    shipper: str | None = None,
    po: str | None = None,
    job: str | None = None,
    customer: str | None = None,
) -> bool:
    q = (query or "").strip()
    field = normalize_shipper_search_by(search_by)
    if q and len(q) >= field_min_len(field) and not shipper_matches_field(row, q, field, job_haystack):
        return False
    if term := ready_term(shipper):
        if not shipper_matches_field(row, term, "shipper", job_haystack):
            return False
    if term := ready_term(po, 2):
        if not shipper_matches_field(row, term, "po", job_haystack):
            return False
    if term := ready_term(job, 2):
        if not shipper_matches_field(row, term, "job", job_haystack):
            return False
    if term := ready_term(customer):
        if not shipper_matches_field(row, term, "customer", job_haystack):
            return False
    return True


def _shipper_recency_key(row: ShopKeeperShipperRow) -> tuple[int, str]:
    try:
        return (int(row.shipper_number.lstrip("Ss") or 0), row.shipper_number)
    except ValueError:
        try:
            return (int(row.shipper_number), row.shipper_number)
        except ValueError:
            return (-1, row.shipper_number)


def paginate_shippers(
    rows: list[tuple[ShopKeeperShipperRow, str]],
    *,
    query: str | None,
    search_by: str | None,
    page: int,
    page_size: int,
    shipper: str | None = None,
    po: str | None = None,
    job: str | None = None,
    customer: str | None = None,
) -> tuple[list[ShopKeeperShipperRow], int]:
    matched = [
        row
        for row, haystack in rows
        if shipper_matches_filters(
            row,
            haystack,
            query=query,
            search_by=search_by,
            shipper=shipper,
            po=po,
            job=job,
            customer=customer,
        )
    ]
    matched.sort(key=_shipper_recency_key, reverse=True)
    total = len(matched)
    start = max(0, (page - 1) * page_size)
    return matched[start : start + page_size], total


def normalize_part_search_by(value: str | None) -> str:
    key = (value or "part").strip().lower()
    return key if key in PART_SEARCH_FIELDS else "part"


def part_matches_field(row: PartMasterListRow, query: str, search_by: str) -> bool:
    q = query.casefold()
    if search_by == "customer":
        return q in (row.customer_code or "").casefold()
    if search_by == "description":
        return q in (row.description or "").casefold()
    return q in (row.part_number or "").casefold()


def part_matches_filters(
    row: PartMasterListRow,
    *,
    query: str | None = None,
    search_by: str | None = None,
    part: str | None = None,
    customer: str | None = None,
    description: str | None = None,
) -> bool:
    q = (query or "").strip()
    field = normalize_part_search_by(search_by)
    if q and not part_matches_field(row, q, field):
        return False
    if term := ready_term(part):
        if not part_matches_field(row, term, "part"):
            return False
    if term := ready_term(customer):
        if not part_matches_field(row, term, "customer"):
            return False
    if term := ready_term(description):
        if not part_matches_field(row, term, "description"):
            return False
    return True


def paginate_parts(
    rows: list[PartMasterListRow],
    *,
    query: str | None,
    search_by: str | None,
    page: int,
    page_size: int,
    part: str | None = None,
    customer: str | None = None,
    description: str | None = None,
) -> tuple[list[PartMasterListRow], int]:
    matched = [
        row
        for row in rows
        if part_matches_filters(
            row,
            query=query,
            search_by=search_by,
            part=part,
            customer=customer,
            description=description,
        )
    ]
    matched.sort(key=lambda row: row.pm_linkid, reverse=True)
    total = len(matched)
    start = max(0, (page - 1) * page_size)
    return matched[start : start + page_size], total


def po_group_from_jobs(jobs: list[ShopKeeperJobRow]) -> ShopKeeperPoGroupRow:
    ordered = sorted(jobs, key=_job_recency_key, reverse=True)
    first = ordered[0]
    shippers = sorted({row.shipper_number for row in jobs if row.shipper_number})
    dates = [row.order_date for row in jobs if row.order_date]
    return ShopKeeperPoGroupRow(
        customer_code=first.customer_code,
        customer_name=next((row.customer_name for row in ordered if row.customer_name), first.customer_name),
        po_number=first.po_number,
        job_count=len(jobs),
        shipper_numbers=", ".join(shippers) if shippers else None,
        order_date=max(dates) if dates else first.order_date,
    )


def paginate_jobs(
    jobs: list[ShopKeeperJobRow],
    *,
    query: str | None,
    search_by: str | None,
    page: int,
    page_size: int,
    po: str | None = None,
    job: str | None = None,
    part: str | None = None,
    customer: str | None = None,
) -> tuple[list[ShopKeeperJobRow], int]:
    matched = [
        row
        for row in jobs
        if job_matches_filters(
            row,
            query=query,
            search_by=search_by,
            po=po,
            job_number=job,
            part=part,
            customer=customer,
        )
    ]
    matched.sort(key=_job_recency_key, reverse=True)
    total = len(matched)
    start = max(0, (page - 1) * page_size)
    return matched[start : start + page_size], total
