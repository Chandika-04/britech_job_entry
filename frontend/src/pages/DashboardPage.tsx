import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";

import { api } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePreparedBy } from "@/components/layout/PreparedBy";
import { JobsBadge, ReviewBadge, StatusBadge } from "@/components/po/StatusBadge";
import { formatDate } from "@/lib/utils";
import type { PoListResponse, PoSummary } from "@/types/po";

const LIST_POLL_MS = 5000;

export function DashboardPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const searchRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<PoListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [shippingId, setShippingId] = useState<number | null>(null);
  const { initials, ensureInitials } = usePreparedBy();

  const query = params.get("q") ?? "";
  const sort = params.get("sort") ?? "queue";
  const order = params.get("order") ?? "desc";
  const page = Number(params.get("page") ?? "1");

  const requestKey = useMemo(() => params.toString(), [params]);

  const reload = useCallback(() => {
    const search = new URLSearchParams(params);
    if (!search.get("page_size")) search.set("page_size", "20");
    if (!search.get("sort")) search.set("sort", "queue");
    return api.listPos(search);
  }, [params]);

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

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const refresh = () => {
      reload()
        .then((result) => {
          if (!cancelled) {
            setData(result);
            setError(null);
          }
        })
        .catch(() => undefined);
    };

    const stop = () => {
      if (timer != null) {
        window.clearInterval(timer);
        timer = null;
      }
    };

    const start = () => {
      if (timer != null) return;
      timer = window.setInterval(refresh, LIST_POLL_MS);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        refresh();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reload]);

  const updateParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.set("page", "1");
    setParams(next);
  };

  const createShipper = async (event: MouseEvent, item: PoSummary) => {
    event.preventDefault();
    event.stopPropagation();
    const attaching = Boolean(item.shipper_number);
    let preparedBy = initials;
    if (!attaching) {
      preparedBy = await ensureInitials();
      if (!preparedBy) return;
    }
    const confirmed = attaching
      ? window.confirm(`Add remaining jobs to shipper ${item.shipper_number}?`)
      : window.confirm("Create one shipper for all jobs on this PO?");
    if (!confirmed) return;
    setShippingId(item.id);
    try {
      await api.createShipper(item.id, attaching ? undefined : preparedBy);
      const result = await reload();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : attaching ? "Could not add jobs to the shipper." : "Could not create shipper.");
    } finally {
      setShippingId(null);
    }
  };

  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-baseline gap-3">
          <div>
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink">Work list</h2>
            <p className="text-xs text-muted">POs started in this app. Unfinished work is listed first.</p>
          </div>
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
            <option value="queue:desc">Needs attention first</option>
            <option value="created_at:desc">Newest first</option>
            <option value="created_at:asc">Oldest first</option>
            <option value="po_number:asc">PO number</option>
            <option value="customer_name:asc">Customer</option>
          </select>
          <Button
            type="button"
            variant="outline"
            onClick={() => updateParam("q", searchRef.current?.value ?? "")}
          >
            Search
          </Button>
        </div>
      </div>

      {error ? <div className="shrink-0 border border-red-200 bg-red-50 px-4 py-2 text-[13px] text-red-800">{error}</div> : null}

      <div ref={tableRef} className="min-h-0 flex-1 overflow-auto bg-white">
        {loading && !data ? <p className="px-4 py-6 text-[13px] text-muted">Loading…</p> : null}

        {data && data.items.length > 0 ? (
          <table className="data-table">
            <thead>
              <tr>
                <th>PO #</th>
                <th>Customer</th>
                <th>Entered</th>
                <th className="num">Pages</th>
                <th>Status</th>
                <th>Check</th>
                <th>Jobs</th>
                <th>Shipper</th>
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr
                  key={item.id}
                  className="cursor-pointer hover:bg-accent-soft/60"
                  onClick={() => navigate(item.source === "manual" ? `/manual/${item.id}` : `/po/${item.id}`)}
                >
                  <td className="font-mono font-medium">
                    <Link to={item.source === "manual" ? `/manual/${item.id}` : `/po/${item.id}`} className="text-accent hover:underline" onClick={(event) => event.stopPropagation()}>
                      {item.po_number || "—"}
                    </Link>
                  </td>
                  <td className="max-w-[320px] truncate">{item.customer_name || <span className="text-faint">Pending</span>}</td>
                  <td className="whitespace-nowrap font-mono text-muted tabular-nums">{formatDate(item.created_at)}</td>
                  <td className="num text-muted">{item.page_count ?? "—"}</td>
                  <td>
                    <StatusBadge status={item.status} source={item.source} />
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
                  <td onClick={(event) => event.stopPropagation()}>
                    <ShipperCell item={item} shippingId={shippingId} onCreate={createShipper} />
                  </td>
                  <td>
                    <div className="flex gap-1">
                      {item.has_duplicate_warning ? <Badge variant="warning">Duplicate</Badge> : null}
                      {item.is_stale ? <Badge variant="stale">Stuck</Badge> : null}
                      {item.warnings.length > 0 && !item.has_duplicate_warning ? (
                        <Badge variant="muted">
                          {item.warnings.length} {item.warnings.length === 1 ? "warning" : "warnings"}
                        </Badge>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {data && data.items.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] text-muted">No POs yet. Click New PO to upload a PDF or type one in.</p>
        ) : null}
      </div>

      {data && data.total > data.page_size ? (
        <div className="sticky bottom-0 z-10 flex shrink-0 items-center justify-between border-t border-rule bg-white px-4 py-2">
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
    </div>
  );
}

function ShipperCell({
  item,
  shippingId,
  onCreate,
}: {
  item: PoSummary;
  shippingId: number | null;
  onCreate: (event: MouseEvent, item: PoSummary) => void;
}) {
  if (!item.jobs_complete) {
    return item.shipper_number ? (
      <span className="font-mono text-[13px] tabular-nums">{item.shipper_number}</span>
    ) : (
      <span className="text-faint">—</span>
    );
  }
  if (!item.shipper_number) {
    return (
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={shippingId === item.id}
        onClick={(event) => onCreate(event, item)}
      >
        {shippingId === item.id ? "Creating…" : "Create shipper"}
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[13px] tabular-nums">{item.shipper_number}</span>
      <Button
        type="button"
        size="sm"
        variant={item.shipper_needs_attach ? "default" : "outline"}
        disabled={shippingId === item.id}
        onClick={(event) => onCreate(event, item)}
      >
        {shippingId === item.id ? "Adding…" : "Add to shipper"}
      </Button>
    </div>
  );
}
