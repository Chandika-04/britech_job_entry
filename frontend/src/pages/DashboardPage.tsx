import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";

import { api } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { JobsBadge, ReviewBadge, StatusBadge } from "@/components/po/StatusBadge";
import { formatDateTime } from "@/lib/utils";
import type { PoListResponse } from "@/types/po";

export function DashboardPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);
  const [data, setData] = useState<PoListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const query = params.get("q") ?? "";
  const sort = params.get("sort") ?? "created_at";
  const order = params.get("order") ?? "desc";
  const page = Number(params.get("page") ?? "1");

  const requestKey = useMemo(() => params.toString(), [params]);

  useEffect(() => {
    let cancelled = false;
    const search = new URLSearchParams(params);
    if (!search.get("page_size")) search.set("page_size", "20");
    setLoading(true);
    api
      .listPos(search)
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setError(null);
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
  }, [requestKey, params]);

  useEffect(() => {
    const hasPending = data?.items.some((item) => item.status === "pending");
    if (!hasPending) return;
    const timer = window.setInterval(() => {
      const search = new URLSearchParams(params);
      search.set("page_size", "20");
      api.listPos(search).then(setData).catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, [data, params]);

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.set("page", "1");
    setParams(next);
  };

  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2.5 md:flex-row md:items-center md:justify-between">
        <div className="flex items-baseline gap-3">
          <CardTitle>Purchase orders</CardTitle>
          {data ? <span className="font-mono text-xs text-muted tabular-nums">{data.total} total</span> : null}
        </div>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] md:w-[560px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
            <Input
              ref={searchRef}
              className="pl-8"
              placeholder="Search PO number or customer"
              defaultValue={query}
              onKeyDown={(event) => {
                if (event.key === "Enter") updateParam("q", event.currentTarget.value);
              }}
            />
          </div>
          <select
            className="h-10 rounded-md border border-rule bg-white px-2 text-[13px] font-medium text-ink md:h-8"
            value={`${sort}:${order}`}
            onChange={(event) => {
              const [nextSort, nextOrder] = event.target.value.split(":");
              const next = new URLSearchParams(params);
              next.set("sort", nextSort);
              next.set("order", nextOrder);
              setParams(next);
            }}
          >
            <option value="created_at:desc">Newest first</option>
            <option value="created_at:asc">Oldest first</option>
            <option value="po_number:asc">PO number</option>
            <option value="customer_name:asc">Customer</option>
            <option value="status:asc">Extraction status</option>
            <option value="review_state:asc">Review status</option>
          </select>
          <Button
            type="button"
            variant="outline"
            onClick={() => updateParam("q", searchRef.current?.value ?? "")}
          >
            Search
          </Button>
        </div>
      </CardHeader>

      {error ? <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-[13px] text-red-800">{error}</div> : null}
      {loading && !data ? <p className="px-4 py-6 text-[13px] text-muted">Loading…</p> : null}

      {data && data.items.length > 0 ? (
        <>
          <div className="hidden overflow-x-auto md:block">
            <table className="data-table">
              <thead>
                <tr>
                  <th>PO #</th>
                  <th>Customer</th>
                  <th>Uploaded</th>
                  <th className="num">Pages</th>
                  <th>Extraction</th>
                  <th>Review</th>
                  <th>Jobs</th>
                  <th>Flags</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr
                    key={item.id}
                    className="cursor-pointer hover:bg-accent-soft/60"
                    onClick={() => navigate(`/po/${item.id}`)}
                  >
                    <td className="font-mono font-medium">
                      <Link to={`/po/${item.id}`} className="text-accent hover:underline" onClick={(event) => event.stopPropagation()}>
                        {item.po_number || "—"}
                      </Link>
                    </td>
                    <td className="max-w-[320px] truncate">{item.customer_name || <span className="text-faint">Pending</span>}</td>
                    <td className="whitespace-nowrap font-mono text-muted tabular-nums">{formatDateTime(item.created_at)}</td>
                    <td className="num text-muted">{item.page_count ?? "—"}</td>
                    <td>
                      <StatusBadge status={item.status} />
                    </td>
                    <td>
                      <ReviewBadge state={item.review_state} />
                    </td>
                    <td>
                      <div className="flex items-center gap-2">
                        <JobsBadge complete={item.jobs_complete} />
                        <span className="font-mono text-xs text-muted tabular-nums">
                          {item.jobs_created_count}/{item.line_count}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="flex gap-1">
                        {item.has_duplicate_warning ? <Badge variant="warning">Duplicate</Badge> : null}
                        {item.is_stale ? <Badge variant="stale">Stale</Badge> : null}
                        {item.warnings.length > 0 && !item.has_duplicate_warning ? (
                          <Badge variant="muted">{item.warnings.length} warn</Badge>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="divide-y divide-rule-soft md:hidden">
            {data.items.map((item) => (
              <li key={item.id}>
                <Link to={`/po/${item.id}`} className="flex flex-col gap-1.5 px-4 py-3 active:bg-accent-soft/60">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono font-semibold text-accent">{item.po_number || "PO # pending"}</span>
                    <span className="font-mono text-xs text-muted">{formatDateTime(item.created_at)}</span>
                  </div>
                  <span className="text-[13px]">{item.customer_name || "Customer pending"}</span>
                  <div className="flex flex-wrap gap-1">
                    <StatusBadge status={item.status} />
                    <ReviewBadge state={item.review_state} />
                    <JobsBadge complete={item.jobs_complete} />
                    {item.has_duplicate_warning ? <Badge variant="warning">Duplicate</Badge> : null}
                    {item.is_stale ? <Badge variant="stale">Stale</Badge> : null}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {data && data.items.length === 0 ? (
        <p className="px-4 py-10 text-center text-[13px] text-muted">No purchase orders yet. Upload a scanned PO to get started.</p>
      ) : null}

      {data && data.total > data.page_size ? (
        <div className="flex items-center justify-between border-t border-rule-soft px-4 py-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => updateParam("page", String(page - 1))}>
            Previous
          </Button>
          <span className="font-mono text-xs text-muted tabular-nums">
            Page {data.page} / {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={data.page * data.page_size >= data.total}
            onClick={() => updateParam("page", String(page + 1))}
          >
            Next
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
