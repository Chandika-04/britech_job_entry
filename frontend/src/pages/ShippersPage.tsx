import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";

import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/utils";
import type { ShopKeeperShipperListResponse, ShopKeeperShipperRow } from "@/types/po";

const PAGE_SIZE = 300;

const SEARCH_OPTIONS = [
  { value: "shipper", label: "Shipper #", placeholder: "Search by shipper number" },
  { value: "po", label: "PO #", placeholder: "Search by PO number" },
  { value: "job", label: "Job number", placeholder: "Search by job number" },
  { value: "customer", label: "Customer", placeholder: "Search by customer" },
] as const;

type SearchBy = (typeof SEARCH_OPTIONS)[number]["value"];

function normalizeSearchBy(value: string | null): SearchBy {
  return SEARCH_OPTIONS.some((option) => option.value === value) ? (value as SearchBy) : "shipper";
}

function statusLabel(row: ShopKeeperShipperRow): string {
  if (row.invoiced) return "I";
  return row.status || "—";
}

export function ShippersPage() {
  const [params, setParams] = useSearchParams();
  const searchRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<ShopKeeperShipperListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const query = (params.get("q") ?? "").trim();
  const searchBy = normalizeSearchBy(params.get("search_by"));
  const page = Number(params.get("page") ?? "1");
  const requestKey = useMemo(() => `${query}|${searchBy}|${page}`, [query, searchBy, page]);
  const placeholder =
    SEARCH_OPTIONS.find((option) => option.value === searchBy)?.placeholder ?? "Search by shipper number";

  const reload = useCallback(() => {
    const search = new URLSearchParams();
    search.set("page_size", String(PAGE_SIZE));
    search.set("page", String(Number.isFinite(page) && page > 0 ? page : 1));
    search.set("search_by", searchBy);
    if (query) search.set("q", query);
    return api.listShopKeeperShippers(search);
  }, [page, query, searchBy]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    reload()
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setError(null);
          tableRef.current?.scrollTo(0, 0);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [requestKey, reload]);

  const updateParams = (updates: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!("page" in updates)) next.set("page", "1");
    setParams(next);
  };

  const runSearch = () => {
    updateParams({ q: searchRef.current?.value ?? "", search_by: searchBy });
  };

  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const listSearch = params.toString() ? `?${params.toString()}` : "";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-baseline gap-3">
          <div>
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink">Shippers</h2>
            <p className="text-xs text-muted">
              Shippers already in ShopKeeper. Click a shipper number to see its jobs. Status: S = shipped, I =
              invoiced.
            </p>
          </div>
          {data ? <span className="font-mono text-xs text-muted tabular-nums">{data.total} shippers</span> : null}
        </div>
        <div className="grid gap-2 sm:grid-cols-[auto_minmax(0,1fr)_auto] md:w-[620px]">
          <select
            className="h-10 rounded-md border border-rule bg-white px-2 text-[13px] font-medium text-ink md:h-8"
            value={searchBy}
            onChange={(event) => updateParams({ search_by: event.target.value, q: searchRef.current?.value ?? query })}
          >
            {SEARCH_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <Input
              key={`${searchBy}:${query}`}
              ref={searchRef}
              className="pl-8"
              placeholder={placeholder}
              defaultValue={query}
              onKeyDown={(event) => {
                if (event.key === "Enter") runSearch();
              }}
            />
          </div>
          <Button type="button" variant="outline" onClick={runSearch}>
            Search
          </Button>
        </div>
      </div>

      {error ? <div className="shrink-0 border border-red-200 bg-red-50 px-4 py-2 text-[13px] text-red-800">{error}</div> : null}

      <div ref={tableRef} className="min-h-0 flex-1 overflow-auto bg-white">
        {loading && !data ? <p className="px-4 py-6 text-[13px] text-muted">Loading…</p> : null}
        {data && data.items.length > 0 ? <ShipperTable rows={data.items} listSearch={listSearch} /> : null}
        {data && data.items.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] text-muted">
            {query ? "No ShopKeeper shippers match that search." : "No ShopKeeper shippers found."}
          </p>
        ) : null}
      </div>

      {data ? (
        <div className="sticky bottom-0 z-10 flex shrink-0 items-center justify-between border-t border-rule bg-white px-4 py-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => updateParams({ page: String(page - 1) })}>
            Previous
          </Button>
          <span className="font-mono text-xs text-muted tabular-nums">
            Page {data.page} / {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={data.page * data.page_size >= data.total}
            onClick={() => updateParams({ page: String(page + 1) })}
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ShipperTable({ rows, listSearch }: { rows: ShopKeeperShipperRow[]; listSearch: string }) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Shipper #</th>
          <th>Customer</th>
          <th>PO #</th>
          <th className="num">Jobs</th>
          <th title="ShopKeeper shipper status. S = shipped, I = invoiced.">Status</th>
          <th>Ship via</th>
          <th>Ship date</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.shipper_number}>
            <td className="font-mono font-medium tabular-nums">
              <Link
                className="text-accent hover:underline"
                to={`/shippers/${encodeURIComponent(row.shipper_number)}`}
                state={{ from: "shippers", listSearch }}
              >
                {row.shipper_number}
              </Link>
            </td>
            <td className="max-w-[240px] truncate">{row.customer_name || "—"}</td>
            <td className="font-mono">{row.po_numbers || "—"}</td>
            <td className="num font-mono tabular-nums">{row.job_count}</td>
            <td>{statusLabel(row)}</td>
            <td>{row.ship_via || "—"}</td>
            <td className="whitespace-nowrap font-mono text-muted tabular-nums">{formatDate(row.ship_date)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
