import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

import { api } from "@/api/client";
import { OperationsEditor } from "@/components/po/OperationsEditor";
import { PartImageCard } from "@/components/po/PartImageCard";
import { PrintJobDialog } from "@/components/po/PrintJobDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { rememberJobNav } from "@/lib/jobNav";
import { cn, formatUsd, handleEnterAdvance, parseMoney } from "@/lib/utils";
import type { JobHeaderPayload, JobPage, OperationRow } from "@/types/po";

interface JobDraft {
  customer_code: string;
  po_number: string;
  po_line: string;
  part_number: string;
  part_revision: string;
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  order_date: string;
  notes: string;
  cert_required: boolean;
}

function toDraft(job: JobPage): JobDraft {
  return {
    customer_code: job.customer_code,
    po_number: job.po_number,
    po_line: job.po_line || "",
    part_number: job.part_number,
    part_revision: job.part_revision,
    description: job.description || "",
    quantity: job.quantity == null ? "" : String(job.quantity),
    unit: job.unit === "Lot" ? "Lot" : "Each",
    unit_price: formatUsd(job.unit_price),
    order_date: job.order_date || "",
    notes: job.notes || "",
    cert_required: job.cert_required,
  };
}

function draftToPayload(draft: JobDraft): JobHeaderPayload {
  const qty = Number(draft.quantity);
  const price = parseMoney(draft.unit_price);
  if (!Number.isInteger(qty) || qty < 1) throw new Error("Quantity must be a whole number of 1 or more.");
  if (!price) throw new Error("Enter a unit price.");
  if (!draft.order_date) throw new Error("Enter the job date.");
  return {
    customer_code: draft.customer_code.trim(),
    po_number: draft.po_number.trim(),
    po_line: draft.po_line.trim() || null,
    part_number: draft.part_number.trim(),
    part_revision: draft.part_revision.trim() || "-",
    description: draft.description.trim() || null,
    quantity: qty,
    unit: draft.unit === "Lot" ? "Lot" : "Each",
    unit_price: price,
    order_date: draft.order_date,
    notes: draft.notes.trim() || null,
    cert_required: draft.cert_required,
  };
}

function lineTotal(draft: JobDraft): string {
  const price = Number(parseMoney(draft.unit_price) ?? "");
  if (!Number.isFinite(price)) return "";
  if (draft.unit === "Lot") return formatUsd(price);
  const qty = Number(draft.quantity);
  if (!Number.isFinite(qty)) return formatUsd(price);
  return formatUsd(qty * price);
}

export function JobPage() {
  const { jobNumber } = useParams<{ jobNumber: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const nav = rememberJobNav(jobNumber, location.state);
  const [job, setJob] = useState<JobPage | null>(null);
  const [draft, setDraft] = useState<JobDraft | null>(null);
  const [ops, setOps] = useState<OperationRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [printOpen, setPrintOpen] = useState(false);

  const load = async () => {
    if (!jobNumber) return;
    const result = await api.getJob(jobNumber);
    setJob(result);
    setDraft(toDraft(result));
    setOps(result.operations);
  };

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [jobNumber]);

  if (!jobNumber) return null;

  const backToPo = nav?.from === "po-review";
  const fromShipper = nav?.from === "shippers";
  const poId = nav?.poId ?? job?.po_id ?? null;
  const backTo =
    backToPo && poId
      ? `/po/${poId}`
      : fromShipper && nav?.shipNumber
        ? `/shippers/${encodeURIComponent(nav.shipNumber)}`
        : fromShipper
          ? `/shippers${nav?.listSearch ?? ""}`
          : `/purchase-orders${nav?.listSearch ?? ""}`;

  const run = async (work: () => Promise<void>, ok?: string) => {
    setBusy(true);
    try {
      await work();
      setError(null);
      if (ok) setNotice(ok);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  };

  const setField = <K extends keyof JobDraft>(field: K, value: JobDraft[K]) => {
    setDraft((current) => (current ? { ...current, [field]: value } : current));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link to={backTo} className="inline-flex items-center gap-1 text-sm text-muted hover:text-accent">
          <ArrowLeft className="h-4 w-4" />
          {backToPo ? "Back to PO" : fromShipper ? "Back to shipper" : "Back to ShopKeeper jobs"}
        </Link>
        <div className="flex flex-col items-end gap-1">
          <Button disabled={busy || !job?.print_ready} onClick={() => setPrintOpen(true)}>
            Print
          </Button>
          {job && !job.print_ready ? (
            <span className="text-xs text-muted">
              {job.missing_ops
                ? "Add operations before printing."
                : job.missing_cert
                  ? "Link a certificate before printing."
                  : "Can't print yet."}
            </span>
          ) : null}
        </div>
      </div>
      {printOpen && jobNumber ? (
        <PrintJobDialog
          jobNumber={jobNumber}
          certAvailable={Boolean(job?.cert_required && job.cert_linked)}
          certRequired={Boolean(job?.cert_required)}
          onClose={() => {
            setPrintOpen(false);
            void load();
          }}
        />
      ) : null}
      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
      {notice ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{notice}</p> : null}
      {job && draft ? (
        <>
          <div className="grid items-stretch gap-3 lg:grid-cols-2">
          <Card className="h-full">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-baseline gap-x-8 text-[15px] font-semibold normal-case tracking-normal">
                <span>Job #{job.job_number}</span>
                <span>Ship #{job.shipper_number || "—"}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3" data-enter-form onKeyDown={handleEnterAdvance}>
              <div className="grid gap-x-10 gap-y-2.5 lg:grid-cols-2">
                <div className="space-y-2.5">
                  <JobRow label="Customer">
                    <Input
                      className="font-mono"
                      value={draft.customer_code}
                      disabled={busy}
                      onChange={(event) => setField("customer_code", event.target.value)}
                    />
                    {job.customer_name ? <p className="text-xs text-muted">{job.customer_name}</p> : null}
                  </JobRow>
                  <JobRow label="PO#">
                    <Input
                      className="font-mono"
                      value={draft.po_number}
                      disabled={busy}
                      onChange={(event) => setField("po_number", event.target.value)}
                    />
                  </JobRow>
                  <JobRow label="Line#">
                    <Input
                      className="font-mono"
                      value={draft.po_line}
                      disabled={busy}
                      onChange={(event) => setField("po_line", event.target.value)}
                    />
                  </JobRow>
                  <JobRow label="Date">
                    <Input
                      type="date"
                      className="font-mono"
                      value={draft.order_date}
                      disabled={busy}
                      onChange={(event) => setField("order_date", event.target.value)}
                    />
                  </JobRow>
                </div>
                <div className="space-y-2.5">
                  <div className="flex items-center gap-2">
                    <span className={jobTightLabelClass}>Part#</span>
                    <Input
                      className="min-w-0 flex-1 font-mono"
                      value={draft.part_number}
                      disabled={busy}
                      onChange={(event) => setField("part_number", event.target.value)}
                    />
                    <span className="shrink-0 text-[13px] text-ink">Rev</span>
                    <Input
                      className="w-16 shrink-0 font-mono"
                      value={draft.part_revision}
                      disabled={busy}
                      onChange={(event) => setField("part_revision", event.target.value)}
                    />
                  </div>
                  {job.pm_linkid ? (
                    <p className="pl-[3rem] text-xs">
                      <Link to={`/parts/${job.pm_linkid}`} className="font-semibold text-accent hover:underline">
                        Edit part
                      </Link>
                    </p>
                  ) : null}
                  <JobRow label="Desc." tight>
                    <Input value={draft.description} disabled={busy} onChange={(event) => setField("description", event.target.value)} />
                  </JobRow>
                  <div className="flex items-center gap-2">
                    <span className={jobTightLabelClass}>Qty</span>
                    <Input
                      className="w-16 font-mono"
                      inputMode="numeric"
                      value={draft.quantity}
                      disabled={busy}
                      onChange={(event) => setField("quantity", event.target.value)}
                    />
                    <span className="shrink-0 text-[13px] text-ink">Price</span>
                    <Input
                      data-money="usd"
                      className="min-w-0 flex-1 font-mono"
                      inputMode="decimal"
                      value={draft.unit_price}
                      disabled={busy}
                      onChange={(event) => setField("unit_price", event.target.value)}
                      onBlur={(event) => setField("unit_price", formatUsd(event.currentTarget.value))}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                    <span className="shrink-0 text-[13px] text-ink">Unit</span>
                    <select
                      className="h-10 w-20 shrink-0 rounded-md border border-rule bg-white px-2 text-sm text-ink focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/15 disabled:bg-head disabled:text-muted md:h-8"
                      value={draft.unit}
                      disabled={busy}
                      onChange={(event) => setField("unit", event.target.value)}
                    >
                      <option value="Each">Each</option>
                      <option value="Lot">Lot</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-[13px] text-ink">Certification</span>
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0"
                      checked={draft.cert_required}
                      disabled={busy}
                      onChange={(event) => setField("cert_required", event.target.checked)}
                      aria-label="Certification required"
                    />
                    <span className="ml-auto shrink-0 text-[13px] text-ink">Total</span>
                    <Input className="w-28 shrink-0 font-mono" value={lineTotal(draft)} readOnly tabIndex={-1} data-enter-skip />
                  </div>
                  <p className="text-xs text-muted">
                    {job.cert_linked ? "Certificate is linked on the part." : "No certificate linked on the part."}{" "}
                    {job.pm_linkid ? (
                      <button type="button" className="font-semibold text-accent hover:underline" onClick={() => navigate(`/parts/${job.pm_linkid}`)}>
                        Open part editor
                      </button>
                    ) : null}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="shrink-0 pt-1.5 text-[13px] text-ink">Job Notes</span>
                <textarea
                  className="min-h-[76px] min-w-0 flex-1 rounded-md border border-rule bg-white px-2.5 py-1.5 text-sm text-ink focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/15 disabled:bg-head disabled:text-muted"
                  value={draft.notes}
                  disabled={busy}
                  onChange={(event) => setField("notes", event.target.value)}
                />
              </div>
              {job.quality_hold ? <p className="text-sm text-amber-800">Quality hold is on for this part.</p> : null}
              {job.missing_ops ? (
                <p className="text-sm text-amber-800">This job has no operations. Copy instructions from the part, copy a template, or add steps before printing.</p>
              ) : null}
              {job.missing_cert ? (
                <p className="text-sm text-amber-800">Certificate is required but none is linked. Open the part editor to link one.</p>
              ) : null}
              <Button
                disabled={busy}
                onClick={() => {
                  if (job.shipper_number) {
                    const ok = window.confirm(
                      `A shipper (${job.shipper_number}) was already created for this job. Save these details anyway? The shipper quantity will be updated to match.`,
                    );
                    if (!ok) return;
                  }
                  run(async () => {
                    const saved = await api.saveJob(jobNumber, draftToPayload(draft));
                    setJob(saved);
                    setDraft(toDraft(saved));
                    setOps(saved.operations);
                  }, job.shipper_number ? "Job details and shipper quantity saved." : "Job details saved.");
                }}
              >
                Save job details
              </Button>
              <details className="rounded-md border border-rule px-3 py-2 text-xs text-muted">
                <summary className="cursor-pointer font-semibold">Office only — delete job</summary>
                <p className="mt-2">
                  Deletes the ShopKeeper job the same way ShopKeeper Delete Job does, then clears it from this app.
                  Refused if the job is on a shipper, locked, kitted, timed, traveler-printed, or has serials.
                </p>
                <Button
                  className="mt-2"
                  variant="danger"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    if (!window.confirm(`Permanently delete ShopKeeper job ${jobNumber}? This cannot be undone.`)) {
                      return;
                    }
                    void run(async () => {
                      await api.deleteShopKeeperJob(jobNumber);
                      navigate(backTo);
                    }, "ShopKeeper job deleted.");
                  }}
                >
                  Delete ShopKeeper job
                </Button>
                {job.po_id && job.line_id ? (
                  <>
                    <p className="mt-3">
                      If the job is already gone from ShopKeeper, clear the job number in this app only.
                    </p>
                    <Button
                      className="mt-2"
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() => {
                        if (
                          !window.confirm("Clear this job from the app? Only continue if it was deleted in ShopKeeper.")
                        ) {
                          return;
                        }
                        void run(async () => {
                          await api.resetErp(job.po_id as number, job.line_id as number);
                          navigate(backTo);
                        }, "Line cleared. You can create a new job.");
                      }}
                    >
                      Clear job from this app
                    </Button>
                  </>
                ) : null}
              </details>
            </CardContent>
          </Card>
          <PartImageCard pictures={job.pictures || []} pmLinkId={job.pm_linkid} />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Operations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !job.pm_linkid}
                  onClick={() => {
                    if (!window.confirm("Replace this job’s operations with the part master’s routing?")) return;
                    run(async () => {
                      const next = await api.copyJobPartOps(jobNumber);
                      setOps(next);
                      await load();
                    }, "Operations copied from the part master.");
                  }}
                >
                  Copy instructions
                </Button>
                <select
                  className="h-8 min-w-56 rounded-md border border-rule bg-white px-2 text-sm"
                  value={templateId}
                  disabled={busy}
                  onChange={(event) => setTemplateId(event.target.value)}
                  aria-label="Copy from template"
                >
                  <option value="">Copy from template…</option>
                  {job.templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.code} — {template.description || "no description"} ({template.step_count})
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !templateId}
                  onClick={() => {
                    const template = job.templates.find((row) => String(row.id) === templateId);
                    if (!template) return;
                    if (!window.confirm(`Replace this job’s operations with “${template.code}”?`)) return;
                    run(async () => {
                      const next = await api.copyJobTemplate(jobNumber, template.id);
                      setOps(next);
                      await load();
                    }, "Operations replaced from the template.");
                  }}
                >
                  Use this template
                </Button>
              </div>
              <OperationsEditor operations={ops} workCenters={job.work_centers} disabled={busy} onChange={setOps} />
              <Button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const next = await api.saveJobOperations(jobNumber, ops);
                    setOps(next);
                    await load();
                  }, "Operations saved.")
                }
              >
                Save operations
              </Button>
            </CardContent>
          </Card>
        </>
      ) : (
        <p className="text-sm text-muted">Loading job…</p>
      )}
    </div>
  );
}

const jobLabelClass = "w-[4.75rem] shrink-0 text-[13px] text-ink";
const jobTightLabelClass = "w-10 shrink-0 text-[13px] text-ink";

function JobRow({ label, children, tight }: { label: string; children: ReactNode; tight?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <span className={cn(tight ? jobTightLabelClass : jobLabelClass, "pt-1.5")}>{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
