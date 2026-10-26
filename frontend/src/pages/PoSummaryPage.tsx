import { useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

import { api } from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { JobNavState } from "@/lib/jobNav";
import { poLabel, splitShipperNumbers } from "@/lib/poSummary";
import { formatDate } from "@/lib/utils";
import type { ShopKeeperPoPage } from "@/types/po";

export function PoSummaryPage() {
  const [params] = useSearchParams();
  const location = useLocation();
  const nav = (location.state as JobNavState | null) || null;
  const customerCode = (params.get("customer") ?? "").trim();
  const poNumber = (params.get("po") ?? "").trim();
  const [page, setPage] = useState<ShopKeeperPoPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!customerCode) {
      setError("Customer code is required.");
      setPage(null);
      return;
    }
    api
      .getShopKeeperPo(customerCode, poNumber)
      .then((result) => {
        setPage(result);
        setError(null);
      })
      .catch((err: Error) => {
        setPage(null);
        setError(err.message);
      });
  }, [customerCode, poNumber]);

  const backTo = `/purchase-orders${nav?.listSearch ?? ""}`;
  const shippers = splitShipperNumbers(page?.shipper_numbers);

  return (
    <div className="space-y-4">
      <Link to={backTo} className="inline-flex items-center gap-1 text-sm text-muted hover:text-accent">
        <ArrowLeft className="h-4 w-4" />
        Back to ShopKeeper jobs
      </Link>
      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
      {page ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-baseline gap-x-8 text-[15px] font-semibold normal-case tracking-normal">
              <span>PO {poLabel(page.po_number)}</span>
              <span>{page.customer_name || page.customer_code}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-x-10 gap-y-2 text-sm md:grid-cols-2 lg:grid-cols-3">
              <Info label="Customer" value={page.customer_name} />
              <Info label="Customer code" value={page.customer_code} mono />
              <Info label="PO #" value={poLabel(page.po_number)} mono />
              <Info label="Jobs" value={String(page.job_count)} mono />
              <Info label="Ordered" value={formatDate(page.order_date) || null} mono />
              <div>
                <div className="text-[13px] text-ink">Shippers</div>
                <div className="font-mono text-sm tabular-nums">
                  {shippers.length > 0
                    ? shippers.map((shipNumber, index) => (
                        <span key={shipNumber}>
                          {index > 0 ? ", " : null}
                          <Link className="text-accent hover:underline" to={`/shippers/${encodeURIComponent(shipNumber)}`}>
                            {shipNumber}
                          </Link>
                        </span>
                      ))
                    : "—"}
                </div>
              </div>
            </div>
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
                  <th>Status</th>
                  <th>Shipper</th>
                  <th>Ordered</th>
                </tr>
              </thead>
              <tbody>
                {page.jobs.map((job) => (
                  <tr key={job.job_number}>
                    <td className="font-mono font-medium tabular-nums">
                      <Link
                        className="text-accent hover:underline"
                        to={`/jobs/${encodeURIComponent(job.job_number)}`}
                        state={{
                          from: "po-summary",
                          customerCode: page.customer_code,
                          poNumber: page.po_number,
                          listSearch: nav?.listSearch,
                        }}
                      >
                        {job.job_number}
                      </Link>
                    </td>
                    <td className="font-mono">{poLabel(job.po_number)}</td>
                    <td className="max-w-[240px] truncate">{job.customer_name || job.customer_code || "—"}</td>
                    <td className="font-mono">{job.part_number}</td>
                    <td className="font-mono text-muted">{job.part_revision || "—"}</td>
                    <td className="max-w-[280px] truncate">{job.description || "—"}</td>
                    <td className="num font-mono tabular-nums">{job.quantity ?? "—"}</td>
                    <td>{job.status || "—"}</td>
                    <td className="font-mono tabular-nums">
                      {job.shipper_number ? (
                        <Link className="text-accent hover:underline" to={`/shippers/${encodeURIComponent(job.shipper_number)}`}>
                          {job.shipper_number}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="whitespace-nowrap font-mono text-muted tabular-nums">{formatDate(job.order_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {page.jobs.length === 0 ? <p className="text-sm text-muted">No jobs are on this purchase order.</p> : null}
          </CardContent>
        </Card>
      ) : !error ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : null}
    </div>
  );
}

function Info({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div>
      <div className="text-[13px] text-ink">{label}</div>
      <div className={mono ? "font-mono text-sm tabular-nums" : "text-sm"}>{value || "—"}</div>
    </div>
  );
}
