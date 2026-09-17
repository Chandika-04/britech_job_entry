import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";

import { api } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ReviewBadge, StatusBadge } from "@/components/po/StatusBadge";
import { formatDateTime } from "@/lib/utils";
import type { PoListResponse } from "@/types/po";

export function DashboardPage() {
  const [params, setParams] = useSearchParams();
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

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Purchase orders</h1>
          <p className="text-sm text-slate-600">Search, review, and confirm extracted POs.</p>
        </div>
        <Button asChild>
          <Link to="/upload">Upload PO</Link>
        </Button>
      </div>

      <Card>
        <CardContent className="grid gap-3 pt-4 md:grid-cols-[1fr_auto_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-3.5 h-5 w-5 text-slate-400" />
            <Input
              className="pl-10"
              placeholder="Search PO number or customer"
              defaultValue={query}
              onKeyDown={(event) => {
                if (event.key === "Enter") updateParam("q", event.currentTarget.value);
              }}
            />
          </div>
          <select
            className="min-h-12 rounded-xl border border-slate-300 bg-white px-3 font-medium"
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
            onClick={() => {
              const input = document.querySelector<HTMLInputElement>("input[placeholder='Search PO number or customer']");
              updateParam("q", input?.value ?? "");
            }}
          >
            Search
          </Button>
        </CardContent>
      </Card>

      {error ? <div className="rounded-xl bg-red-50 p-4 text-red-800">{error}</div> : null}
      {loading && !data ? <p className="text-slate-600">Loading…</p> : null}

      <div className="space-y-3">
        {data?.items.map((item) => (
          <Link key={item.id} to={`/po/${item.id}`} className="block">
            <Card className="transition hover:border-sky-300">
              <CardContent className="flex flex-col gap-3 py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-lg font-semibold">{item.po_number || "PO number pending"}</div>
                    <div className="text-sm text-slate-600">{item.customer_name || "Customer pending"}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <StatusBadge status={item.status} />
                    <ReviewBadge state={item.review_state} />
                    {item.has_duplicate_warning ? <Badge variant="warning">Duplicate</Badge> : null}
                    {item.is_stale ? <Badge variant="stale">Stale job</Badge> : null}
                  </div>
                </div>
                <div className="text-sm text-slate-500">Uploaded {formatDateTime(item.created_at)}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
        {data && data.items.length === 0 ? (
          <p className="rounded-2xl bg-white p-8 text-center text-slate-600">No purchase orders yet. Upload a scanned PO to get started.</p>
        ) : null}
      </div>

      {data && data.total > data.page_size ? (
        <div className="flex items-center justify-between">
          <Button variant="outline" disabled={page <= 1} onClick={() => updateParam("page", String(page - 1))}>
            Previous
          </Button>
          <span className="text-sm text-slate-600">
            Page {data.page} of {Math.ceil(data.total / data.page_size)}
          </span>
          <Button
            variant="outline"
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
