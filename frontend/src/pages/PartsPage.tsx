import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Plus, Search } from "lucide-react";

import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { PartListResponse, PartListRow } from "@/types/po";

const PAGE_SIZE = 300;

const SEARCH_OPTIONS = [
  { value: "part", label: "Part number", placeholder: "Search by part number" },
  { value: "customer", label: "Customer", placeholder: "Search by customer" },
  { value: "description", label: "Description", placeholder: "Search by description" },
] as const;

type SearchBy = (typeof SEARCH_OPTIONS)[number]["value"];

function normalizeSearchBy(value: string | null): SearchBy {
  return SEARCH_OPTIONS.some((option) => option.value === value) ? (value as SearchBy) : "part";
}

export function PartsPage() {
  const [params, setParams] = useSearchParams();
  const searchRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<PartListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const query = (params.get("q") ?? "").trim();
  const searchBy = normalizeSearchBy(params.get("search_by"));
  const page = Number(params.get("page") ?? "1");
  const requestKey = useMemo(() => `${query}|${searchBy}|${page}`, [query, searchBy, page]);
  const placeholder =
    SEARCH_OPTIONS.find((option) => option.value === searchBy)?.placeholder ?? "Search by part number";

  const reload = useCallback(() => {
    const search = new URLSearchParams();
    search.set("page_size", String(PAGE_SIZE));
    search.set("page", String(Number.isFinite(page) && page > 0 ? page : 1));
    search.set("search_by", searchBy);
    if (query) search.set("q", query);
    return api.listParts(search);
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
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink">Part master</h2>
            <p className="text-xs text-muted">
              ShopKeeper parts. Click a part number to edit operations, traveler picture, cert, or quality hold.
            </p>
          </div>
          {data ? <span className="font-mono text-xs text-muted tabular-nums">{data.total} parts</span> : null}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
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
          <Button asChild>
            <Link to="/parts/new" state={{ from: "parts", listSearch }}>
              <Plus className="h-4 w-4" />
              New part
            </Link>
          </Button>
        </div>
      </div>

      {error ? <div className="shrink-0 border border-red-200 bg-red-50 px-4 py-2 text-[13px] text-red-800">{error}</div> : null}

      <div ref={tableRef} className="min-h-0 flex-1 overflow-auto bg-white">
        {loading && !data ? <p className="px-4 py-6 text-[13px] text-muted">Loading…</p> : null}
        {data && data.items.length > 0 ? <PartTable rows={data.items} listSearch={listSearch} /> : null}
        {data && data.items.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] text-muted">
            {query ? "No ShopKeeper parts match that search." : "No ShopKeeper parts found."}
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

function PartTable({ rows, listSearch }: { rows: PartListRow[]; listSearch: string }) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Part #</th>
          <th>Rev</th>
          <th>Customer</th>
          <th>Description</th>
          <th className="num">Ops</th>
          <th>Pic</th>
          <th>Cert</th>
          <th>Hold</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.pm_linkid} className={row.inactive ? "text-muted" : undefined}>
            <td className="font-mono font-medium">
              <Link
                className="text-accent hover:underline"
                to={`/parts/${row.pm_linkid}`}
                state={{ from: "parts", listSearch }}
              >
                {row.part_number}
              </Link>
              {row.inactive ? <span className="ml-2 text-[11px] uppercase">Inactive</span> : null}
            </td>
            <td className="font-mono">{row.part_revision || "—"}</td>
            <td className="font-mono">{row.customer_code || "—"}</td>
            <td className="max-w-[360px] truncate">{row.description || "—"}</td>
            <td className="num font-mono tabular-nums">{row.operation_count}</td>
            <td>{row.picture_count > 0 ? "Yes" : "—"}</td>
            <td>{row.cert_linked ? "Yes" : "—"}</td>
            <td>{row.quality_hold ? "Hold" : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
