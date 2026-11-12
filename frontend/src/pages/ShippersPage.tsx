import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { api } from "@/api/client";
import { FieldSearch } from "@/components/search/FieldSearch";
import { Button } from "@/components/ui/button";
import { PoNumberLinks, ShipperLink } from "@/lib/poSummary";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { useFieldQuery, type FieldSpec } from "@/lib/useFieldQuery";
import { useListKeyboard } from "@/lib/useListKeyboard";
import { cn, formatDate } from "@/lib/utils";
import type { ShopKeeperShipperListResponse, ShopKeeperShipperRow } from "@/types/po";

const PAGE_SIZE = 300;

const SEARCH_FIELDS: FieldSpec[] = [
  { key: "shipper", placeholder: "Shipper #" },
  { key: "po", placeholder: "PO #", minLength: 2 },
  { key: "job", placeholder: "Job #", minLength: 2 },
  { key: "customer", placeholder: "Customer", wide: true },
];

function statusLabel(row: ShopKeeperShipperRow): string {
  if (row.invoiced) return "I";
  return row.status || "—";
}

export function ShippersPage() {
  useDocumentTitle(["Shippers"]);
  const navigate = useNavigate();
  const tableRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<ShopKeeperShipperListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const search = useFieldQuery(SEARCH_FIELDS);
  const requestKey = `${search.apiQuery}|${search.page}`;

  const reload = useCallback(() => {
    const params = new URLSearchParams(search.apiQuery);
    params.set("page_size", String(PAGE_SIZE));
    params.set("page", String(Number.isFinite(search.page) && search.page > 0 ? search.page : 1));
    return api.listShopKeeperShippers(params);
  }, [search.apiQuery, search.page]);

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

  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const rows = data?.items ?? [];
  const nav = { from: "shippers" as const, listSearch: search.listSearch };
  // Up/Down highlights a shipper, Enter opens it.
  const { rowProps, rowClass } = useListKeyboard(
    rows.length,
    (index) => {
      const row = rows[index];
      if (row) navigate(`/shippers/${encodeURIComponent(row.shipper_number)}`, { state: nav });
    },
    requestKey,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink">Shippers</h2>
          {data ? <span className="font-mono text-xs text-muted tabular-nums">{data.total} shippers</span> : null}
        </div>
        <FieldSearch fields={SEARCH_FIELDS} values={search.values} onChange={search.setField} onClearAll={search.clearAll} />
      </div>

      {error ? <div className="shrink-0 border border-red-200 bg-red-50 px-4 py-2 text-[13px] text-red-800">{error}</div> : null}

      <div ref={tableRef} className="min-h-0 flex-1 overflow-auto bg-white">
        {loading && !data ? <p className="px-4 py-6 text-[13px] text-muted">Loading…</p> : null}
        {data && data.items.length > 0 ? <ShipperTable rows={rows} nav={nav} rowProps={rowProps} rowClass={rowClass} /> : null}
        {data && data.items.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] text-muted">
            {search.anyFilled ? "No ShopKeeper shippers match that search." : "No ShopKeeper shippers found."}
          </p>
        ) : null}
      </div>

      {data ? (
        <div className="sticky bottom-0 z-10 flex shrink-0 items-center justify-between border-t border-rule bg-white px-4 py-2">
          <Button variant="outline" size="sm" disabled={search.page <= 1} onClick={() => search.setPage(search.page - 1)}>
            Previous
          </Button>
          <span className="font-mono text-xs text-muted tabular-nums">
            Page {data.page} / {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={data.page * data.page_size >= data.total}
            onClick={() => search.setPage(search.page + 1)}
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ShipperTable({
  rows,
  nav,
  rowProps,
  rowClass,
}: {
  rows: ShopKeeperShipperRow[];
  nav: { from: "shippers"; listSearch: string };
  rowProps: (index: number) => object;
  rowClass: (index: number) => string | undefined;
}) {
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
        {rows.map((row, index) => (
          <tr key={row.shipper_number} {...rowProps(index)} className={cn(rowClass(index))}>
            <td className="font-mono font-medium tabular-nums">
              <ShipperLink number={row.shipper_number} state={nav} className="font-medium" />
            </td>
            <td className="max-w-[240px] truncate">{row.customer_name || "—"}</td>
            <td className="font-mono">
              <PoNumberLinks customer={row.customer_code} poNumbers={row.po_numbers} state={nav} />
            </td>
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
