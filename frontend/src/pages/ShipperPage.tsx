import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

import { api } from "@/api/client";
import { PrintShipperDialog } from "@/components/po/PrintShipperDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { JobNavState } from "@/lib/jobNav";
import { PoLink, PoNumberLinks, poSummaryPath } from "@/lib/poSummary";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { useListKeyboard } from "@/lib/useListKeyboard";
import { cn, formatDate } from "@/lib/utils";
import type { ShopKeeperShipperPage } from "@/types/po";

function shipperBack(nav: JobNavState | null): { to: string; label: string } {
  if (nav?.from === "po-review" && nav.poId != null) return { to: `/po/${nav.poId}`, label: "Back to PO" };
  if (nav?.from === "purchase-orders") {
    return { to: `/purchase-orders${nav.listSearch ?? ""}`, label: "Back to ShopKeeper jobs" };
  }
  if (nav?.from === "po-summary" && nav.customerCode) {
    return { to: poSummaryPath(nav.customerCode, nav.poNumber ?? ""), label: "Back to this PO" };
  }
  if (nav?.from === "work-list") return { to: `/${(nav.listSearch ?? "").replace(/^\//, "")}`, label: "Back to Work list" };
  return { to: `/shippers${nav?.listSearch ?? ""}`, label: "Back to Shippers" };
}

export function ShipperPage() {
  const { shipNumber } = useParams<{ shipNumber: string }>();
  const location = useLocation();
  const nav = (location.state as JobNavState | null) || null;
  const [shipper, setShipper] = useState<ShopKeeperShipperPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const shipperPos = (shipper?.po_numbers ?? "").split(",").map((po) => po.trim()).filter(Boolean);
  useDocumentTitle([
    "Shipper",
    shipper?.customer_code,
    shipperPos.length ? `PO ${shipperPos[0]}${shipperPos.length > 1 ? ` +${shipperPos.length - 1}` : ""}` : null,
  ]);
  const navigate = useNavigate();
  const shipperJobs = shipper?.jobs ?? [];
  // Up/Down highlights a job on this shipper, Enter opens it.
  const { rowProps, rowClass } = useListKeyboard(
    shipperJobs.length,
    (index) => {
      const job = shipperJobs[index];
      if (job && shipper) {
        navigate(`/jobs/${encodeURIComponent(job.job_number)}`, {
          state: { from: "shippers", shipNumber: shipper.shipper_number, listSearch: nav?.listSearch },
        });
      }
    },
    shipNumber,
  );

  const load = useCallback(() => {
    if (!shipNumber) return;
    api
      .getShipper(shipNumber)
      .then((result) => {
        setShipper(result);
        setError(null);
      })
      .catch((err: Error) => setError(err.message));
  }, [shipNumber]);

  useEffect(() => {
    load();
  }, [load]);

  if (!shipNumber) return null;

  const back = shipperBack(nav);
  const status = shipper?.invoiced ? "I" : shipper?.status || "—";
  const poNav: JobNavState = {
    from: "shippers",
    shipNumber: shipper?.shipper_number ?? shipNumber,
    listSearch: nav?.listSearch,
  };

  return (
    <div className="space-y-4">
      <Link to={back.to} className="inline-flex items-center gap-1 text-sm text-muted hover:text-accent">
        <ArrowLeft className="h-4 w-4" />
        {back.label}
      </Link>
      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
      {shipper ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center justify-between gap-3 text-[15px] font-semibold normal-case tracking-normal">
              <span className="flex flex-wrap items-baseline gap-x-8">
                <span>Shipper #{shipper.shipper_number}</span>
                <span>Status {status}</span>
                <span className="text-xs font-normal text-muted">{shipper.printed ? "Printed" : "Not printed yet"}</span>
              </span>
              <Button
                type="button"
                size="sm"
                variant={shipper.printed ? "outline" : "default"}
                disabled={shipper.job_count === 0}
                onClick={() => setPrinting(true)}
              >
                Print packing list
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-x-10 gap-y-2 text-sm md:grid-cols-2 lg:grid-cols-3">
              <Info label="Customer" value={shipper.customer_name} />
              <Info
                label="PO #"
                value={<PoNumberLinks customer={shipper.customer_code} poNumbers={shipper.po_numbers} state={poNav} />}
                mono
              />
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
                {shipper.jobs.map((job, index) => (
                  <tr key={job.job_number} {...rowProps(index)} className={cn(rowClass(index))}>
                    <td className="font-mono font-medium tabular-nums">
                      <Link
                        className="text-accent hover:underline"
                        to={`/jobs/${encodeURIComponent(job.job_number)}`}
                        state={{ from: "shippers", shipNumber: shipper.shipper_number, listSearch: nav?.listSearch }}
                      >
                        {job.job_number}
                      </Link>
                    </td>
                    <td className="font-mono">
                      <PoLink customer={job.customer_code} po={job.po_number} state={poNav} />
                    </td>
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
      {printing && shipper ? (
        <PrintShipperDialog shipNumber={shipper.shipper_number} onClose={() => setPrinting(false)} onPrinted={load} />
      ) : null}
    </div>
  );
}

function Info({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div>
      <div className="text-[13px] text-ink">{label}</div>
      <div className={mono ? "font-mono text-sm tabular-nums" : "text-sm"}>{value || "—"}</div>
    </div>
  );
}
