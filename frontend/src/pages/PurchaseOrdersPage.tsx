import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { api } from "@/api/client";
import { FieldSearch } from "@/components/search/FieldSearch";
import { Button } from "@/components/ui/button";
import { PoLink, ShipperLink } from "@/lib/poSummary";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { useFieldQuery, type FieldSpec } from "@/lib/useFieldQuery";
import { formatDate } from "@/lib/utils";
import type { ShopKeeperJobRow, ShopKeeperPoListResponse } from "@/types/po";

const PAGE_SIZE = 300;

const SEARCH_FIELDS: FieldSpec[] = [
  { key: "po", placeholder: "PO #", minLength: 2 },
  { key: "job", placeholder: "Job #", minLength: 2 },
  { key: "part", placeholder: "Part number" },
  { key: "customer", placeholder: "Customer", wide: true },
];

export function PurchaseOrdersPage() {
  useDocumentTitle(["ShopKeeper jobs"]);
  const tableRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<ShopKeeperPoListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const search = useFieldQuery(SEARCH_FIELDS);
  const requestKey = `${search.apiQuery}|${search.page}`;

  const reload = useCallback(() => {
    const params = new URLSearchParams(search.apiQuery);
    params.set("page_size", String(PAGE_SIZE));
    params.set("page", String(Number.isFinite(search.page) && search.page > 0 ? search.page : 1));
    return api.listShopKeeperPurchaseOrders(params);
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
  const jobs = useMemo(() => {
    const items = data?.items ?? [];
    if (search.anyFilled || items.length === 0) return items;
    return [...items].sort((a, b) => {
      const left = Number(a.job_number);
      const right = Number(b.job_number);
      if (Number.isFinite(left) && Number.isFinite(right) && left !== right) return right - left;
      return b.job_number.localeCompare(a.job_number);
    });
  }, [data?.items, search.anyFilled]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink">ShopKeeper jobs</h2>
          {data ? <span className="font-mono text-xs text-muted tabular-nums">{data.total} jobs</span> : null}
        </div>
        <FieldSearch fields={SEARCH_FIELDS} values={search.values} onChange={search.setField} onClearAll={search.clearAll} />
      </div>

      {error ? <div className="shrink-0 border border-red-200 bg-red-50 px-4 py-2 text-[13px] text-red-800">{error}</div> : null}

      <div ref={tableRef} className="min-h-0 flex-1 overflow-auto bg-white">
        {loading && !data ? <p className="px-4 py-6 text-[13px] text-muted">Loading…</p> : null}
        {data && jobs.length > 0 ? <JobTable jobs={jobs} listSearch={search.listSearch} /> : null}
        {data && data.items.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] text-muted">
            {search.anyFilled ? "No ShopKeeper jobs match that search." : "No ShopKeeper jobs found."}
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

function JobTable({ jobs, listSearch }: { jobs: ShopKeeperJobRow[]; listSearch: string }) {
  const nav = { from: "purchase-orders" as const, listSearch };
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Job #</th>
          <th>PO #</th>
          <th>Customer</th>
          <th>Part</th>
          <th>Rev</th>
          <th>Description</th>
          <th className="num">Qty</th>
          <th title="ShopKeeper ship-line status. S = shipped, I = invoiced, blank = not shipped.">Status</th>
          <th>Shipper</th>
          <th>Ordered</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((job) => (
          <tr key={job.job_number}>
            <td className="font-mono font-medium tabular-nums">
              <Link
                className="text-accent hover:underline"
                to={`/jobs/${encodeURIComponent(job.job_number)}`}
                state={nav}
              >
                {job.job_number}
              </Link>
            </td>
            <td className="font-mono">
              <PoLink customer={job.customer_code} po={job.po_number} state={nav} />
            </td>
            <td className="max-w-[240px] truncate">{job.customer_name || job.customer_code || "—"}</td>
            <td className="font-mono">{job.part_number}</td>
            <td className="font-mono text-muted">{job.part_revision || "—"}</td>
            <td className="max-w-[280px] truncate">{job.description || "—"}</td>
            <td className="num font-mono tabular-nums">{job.quantity ?? "—"}</td>
            <td>{job.status || "—"}</td>
            <td className="font-mono tabular-nums">
              <ShipperLink number={job.shipper_number} state={nav} />
            </td>
            <td className="whitespace-nowrap font-mono text-muted tabular-nums">{formatDate(job.order_date)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
