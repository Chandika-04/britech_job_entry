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
    haystack = f"{row.customer_name or ''} {job_haystack}"
    return q in haystack.casefold()


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
) -> tuple[list[ShopKeeperShipperRow], int]:
    q = (query or "").strip()
    field = normalize_shipper_search_by(search_by)
    matched = [
        row for row, haystack in rows if not q or shipper_matches_field(row, q, field, haystack)
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


def paginate_parts(
    rows: list[PartMasterListRow],
    *,
    query: str | None,
    search_by: str | None,
    page: int,
    page_size: int,
) -> tuple[list[PartMasterListRow], int]:
    q = (query or "").strip()
    field = normalize_part_search_by(search_by)
    matched = [row for row in rows if not q or part_matches_field(row, q, field)]
    matched.sort(key=lambda row: row.pm_linkid, reverse=True)
    total = len(matched)
    start = max(0, (page - 1) * page_size)
    return matched[start : start + page_size], total


def po_group_key(job: ShopKeeperJobRow) -> tuple[str, str]:
    return ((job.customer_code or "").strip(), (job.po_number or "").strip())


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


def paginate_po_groups(
    jobs: list[ShopKeeperJobRow],
    *,
    query: str | None,
    search_by: str | None,
    page: int,
    page_size: int,
) -> tuple[list[ShopKeeperPoGroupRow], int]:
    q = (query or "").strip()
    field = normalize_search_by(search_by)
    matching_keys = {po_group_key(job) for job in jobs if not q or job_matches_field(job, q, field)}
    grouped: dict[tuple[str, str], list[ShopKeeperJobRow]] = {}
    for job in jobs:
        key = po_group_key(job)
        if key not in matching_keys:
            continue
        grouped.setdefault(key, []).append(job)
    ranked = [
        (po_group_from_jobs(items), max(_job_recency_key(job) for job in items))
        for items in grouped.values()
    ]
    ranked.sort(key=lambda pair: pair[1], reverse=True)
    rows = [row for row, _recency in ranked]
    total = len(rows)
    start = max(0, (page - 1) * page_size)
    return rows[start : start + page_size], total


def paginate_jobs(
    jobs: list[ShopKeeperJobRow],
    *,
    query: str | None,
    search_by: str | None,
    page: int,
    page_size: int,
) -> tuple[list[ShopKeeperJobRow], int]:
    q = (query or "").strip()
    field = normalize_search_by(search_by)
    matched = [job for job in jobs if not q or job_matches_field(job, q, field)]
    matched.sort(key=_job_recency_key, reverse=True)
    total = len(matched)
    start = max(0, (page - 1) * page_size)
    return matched[start : start + page_size], total
