import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

import { api } from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import type { JobNavState } from "@/lib/jobNav";
import type { ShopKeeperShipperPage } from "@/types/po";

function poLabel(poNumber: string): string {
  return poNumber.trim() ? poNumber : "(no PO number)";
}

export function ShipperPage() {
  const { shipNumber } = useParams<{ shipNumber: string }>();
  const location = useLocation();
  const nav = (location.state as JobNavState | null) || null;
  const [shipper, setShipper] = useState<ShopKeeperShipperPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!shipNumber) return;
    api
      .getShipper(shipNumber)
      .then((result) => {
        setShipper(result);
        setError(null);
      })
      .catch((err: Error) => setError(err.message));
  }, [shipNumber]);

  if (!shipNumber) return null;

  const backTo = `/shippers${nav?.listSearch ?? ""}`;
  const status = shipper?.invoiced ? "I" : shipper?.status || "—";

  return (
    <div className="space-y-4">
      <Link to={backTo} className="inline-flex items-center gap-1 text-sm text-muted hover:text-accent">
        <ArrowLeft className="h-4 w-4" />
        Back to Shippers
      </Link>
      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
      {shipper ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-baseline gap-x-8 text-[15px] font-semibold normal-case tracking-normal">
              <span>Shipper #{shipper.shipper_number}</span>
              <span>Status {status}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-x-10 gap-y-2 text-sm md:grid-cols-2 lg:grid-cols-3">
              <Info label="Customer" value={shipper.customer_name} />
              <Info label="PO #" value={shipper.po_numbers} mono />
              <Info label="Jobs" value={String(shipper.job_count)} mono />
              <Info label="Ship via" value={shipper.ship_via} />
              <Info label="Prepared by" value={shipper.ship_by} />
              <Info label="Ship date" value={formatDate(shipper.ship_date) || null} mono />
              <Info label="Printed" value={shipper.printed ? "Yes" : "No"} />
              <Info label="Tracking" value={shipper.tracking_number} mono />
            </div>
            {shipper.note ? <p className="text-sm text-ink">{shipper.note}</p> : null}
            {shipper.invoiced ? (
              <p className="text-sm text-amber-800">This shipper is invoiced in ShopKeeper. Jobs on it cannot be unlinked or deleted here.</p>
            ) : null}
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
                  <th>Ordered</th>
                </tr>
              </thead>
              <tbody>
                {shipper.jobs.map((job) => (
                  <tr key={job.job_number}>
                    <td className="font-mono font-medium tabular-nums">
                      <Link
                        className="text-accent hover:underline"
                        to={`/jobs/${encodeURIComponent(job.job_number)}`}
                        state={{ from: "shippers", shipNumber: shipper.shipper_number, listSearch: nav?.listSearch }}
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
                    <td className="whitespace-nowrap font-mono text-muted tabular-nums">{formatDate(job.order_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shipper.jobs.length === 0 ? (
              <p className="text-sm text-muted">No jobs are attached to this shipper.</p>
            ) : null}
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
