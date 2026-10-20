import { Fragment, useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import { api } from "@/api/client";
import { CustomerMatchSection } from "@/components/po/CustomerMatch";
import { PartMatchSection } from "@/components/po/PartMatch";
import { PrintJobDialog } from "@/components/po/PrintJobDialog";
import { ErpBadge } from "@/components/po/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, focusNextEmpty } from "@/lib/utils";
import type { CreatePrintResult, LineItem, PoDetail } from "@/types/po";

async function createJobThenPrint(
  poId: number,
  lineId: number,
  certAvailable: boolean,
  askPrint: (jobNumber: string, certAvailable: boolean) => Promise<void>,
) {
  const result = await api.createJob(poId, lineId);
  if (result.printed) await askPrint(result.job_number, certAvailable);
  return result;
}

interface Props {
  po: PoDetail;
  onChange: (po: PoDetail) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  disabled?: boolean;
}

export type RunLine = (lineId: number, work: () => Promise<PoDetail>, notice?: string) => Promise<void>;

function certEditable(line: LineItem): boolean {
  return line.erp_status !== "created" && line.erp_status !== "creating";
}

function needsAttention(line: LineItem): boolean {
  if (line.erp_status === "created") return false;
  if (line.erp_status === "skipped") return true;
  return (
    line.erp_status !== "ready" ||
    (line.customer_credit_hold && !line.credit_hold_acknowledged) ||
    (line.duplicate_job_numbers.length > 0 && !line.duplicate_acknowledged)
  );
}

export function ShopKeeperPanel({ po, onChange, onError, onNotice, disabled }: Props) {
  const [busyLine, setBusyLine] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(
    () => new Set(po.line_items.filter(needsAttention).map((line) => line.id)),
  );
  const confirmed = po.review_state === "confirmed";
  const createdCount = po.line_items.filter((line) => line.erp_status === "created").length;
  const readyLines = po.line_items.filter((line) => line.erp_status === "ready");
  const [batchBlock, setBatchBlock] = useState<CreatePrintResult | null>(null);
  const printWaiter = useRef<(() => void) | null>(null);
  const [printJob, setPrintJob] = useState<{ jobNumber: string; certAvailable: boolean } | null>(null);

  const askPrint = (jobNumber: string, certAvailable: boolean) =>
    new Promise<void>((resolve) => {
      printWaiter.current = resolve;
      setPrintJob({ jobNumber, certAvailable });
    });

  const finishPrint = () => {
    setPrintJob(null);
    printWaiter.current?.();
    printWaiter.current = null;
  };

  const run = async (lineId: number | null, work: () => Promise<PoDetail>, notice?: string) => {
    setBusyLine(lineId);
    try {
      const result = await work();
      onChange(result);
      onError("");
      if (notice) onNotice(notice);
    } catch (err) {
      onError(err instanceof Error ? err.message : "ShopKeeper request failed.");
    } finally {
      setBusyLine(null);
    }
  };

  const toggle = (lineId: number) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  };

  return (
    <div>
      <p className="border-b border-rule-soft px-4 py-2 text-xs text-muted">
        Match this PO to a ShopKeeper customer and each line to a ShopKeeper part. New parts are added on the Parts
        tab. The app never creates customers.
        {confirmed
          ? " Ready lines can create a job and print the traveler."
          : " Click PO is correct at the bottom before creating jobs."}
      </p>

      <div className="border-b border-rule-soft px-4 py-3">
        <CustomerMatchSection
          po={po}
          disabled={disabled || busyLine != null}
          onChange={onChange}
          onError={onError}
          onNotice={onNotice}
          onAfterUse={() => focusNextEmpty(["po-number", "part-line-0"])}
        />
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pb-1 pt-3">
        <h3 className="section-label">Jobs by line</h3>
        <div className="flex flex-wrap items-center gap-3">
          <CertAllCheckbox po={po} disabled={disabled || busyLine != null} onRun={run} />
          {confirmed && readyLines.length > 1 ? (
            <Button
              size="sm"
              disabled={disabled || busyLine != null}
              onClick={() =>
                run(readyLines[0].id, async () => {
                  let latest = po;
                  for (const line of readyLines) {
                    const result = await createJobThenPrint(po.id, line.id, line.cert_required, askPrint);
                    latest = result.po;
                    if (result.missing_ops || result.missing_cert) {
                      setBatchBlock(result);
                      onNotice(`Job ${result.job_number} was created. Nothing was printed.`);
                      return latest;
                    }
                    if (result.printed) onNotice(`Job ${result.job_number} created.`);
                    else if (result.print_error) onNotice(`Job created. Print skipped: ${result.print_error}`);
                    else onNotice("ShopKeeper job created.");
                  }
                  return latest;
                })
              }
            >
              Create all ready lines ({readyLines.length})
            </Button>
          ) : null}
          <span className="font-mono text-xs text-muted tabular-nums">
            {createdCount}/{po.line_items.length} created
          </span>
        </div>
        {batchBlock ? (
          <JobPrintBlock
            block={batchBlock}
            poId={po.id}
            onClose={() => setBatchBlock(null)}
          />
        ) : null}
      </div>

      <div className="hidden min-w-0 md:block">
        <table className="data-table wrap">
          <thead>
            <tr>
              <th className="w-8" aria-label="Expand" />
              <th>Ln</th>
              <th>Extracted part</th>
              <th className="num">Qty</th>
              <th>Due</th>
              <th>Customer</th>
              <th>SK part</th>
              <th>Cert</th>
              <th>Checks</th>
              <th>Status</th>
              <th>Job #</th>
              <th className="text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {po.line_items.map((line) => {
              const open = expanded.has(line.id);
              const lineDisabled = disabled || busyLine === line.id;
              return (
                <Fragment key={line.id}>
                  <tr className={cn("cursor-pointer hover:bg-head", open && "bg-head [&>td]:border-b-0")} onClick={() => toggle(line.id)}>
                    <td className="text-faint">
                      {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </td>
                    <td className="num">{line.line_number ?? "—"}</td>
                    <td className="font-mono">
                      {line.customer_part_number || <span className="text-faint">—</span>}
                      {line.revision ? <span className="text-muted"> rev {line.revision}</span> : null}
                    </td>
                    <td className="num">{line.quantity ?? "—"}</td>
                    <td className="font-mono text-muted">{line.due_date || "—"}</td>
                    <td className="font-mono">{line.resolved_customer_code || <span className="text-faint">—</span>}</td>
                    <td className="font-mono">
                      {line.resolved_part_number ? (
                        <>
                          {line.resolved_part_number}
                          <span className="text-muted"> rev {line.resolved_part_revision || "—"}</span>
                        </>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td onClick={(event) => event.stopPropagation()}>
                      <CertCheckbox po={po} line={line} disabled={lineDisabled} onRun={run} />
                    </td>
                    <td>
                      <LineChecks line={line} />
                    </td>
                    <td>
                      <ErpBadge status={line.erp_status} />
                    </td>
                    <td className="font-mono font-semibold">
                      {line.erp_job_number ? (
                        <Link
                          className="text-accent hover:underline"
                          to={`/jobs/${encodeURIComponent(line.erp_job_number)}`}
                          state={{ from: "po-review", poId: po.id }}
                        >
                          {line.erp_job_number}
                        </Link>
                      ) : (
                        <span className="font-normal text-faint">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap text-right" onClick={(event) => event.stopPropagation()}>
                      <CreateJobButton po={po} line={line} confirmed={confirmed} disabled={lineDisabled} onRun={run} onNotice={onNotice} onAskPrint={askPrint} />
                    </td>
                  </tr>
                  {open ? (
                    <tr className="bg-head">
                      <td />
                      <td colSpan={11} className="min-w-0 pb-3">
                        <LineDetail po={po} line={line} disabled={lineDisabled} onRun={run} showFinder={false} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="divide-y divide-rule-soft md:hidden">
        {po.line_items.map((line) => {
          const lineDisabled = disabled || busyLine === line.id;
          return (
            <div key={line.id} className="space-y-2 px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="section-label">Line {line.line_number ?? "—"}</span>
                <ErpBadge status={line.erp_status} />
              </div>
              <p className="font-mono text-xs text-muted">
                {line.customer_part_number || "no part"} rev {line.revision || "—"} · qty {line.quantity ?? "—"} · {line.due_date || "no due date"}
              </p>
              <p className="text-xs">
                Customer <span className="font-mono font-semibold">{line.resolved_customer_code || "—"}</span>
                {" · "}Part{" "}
                <span className="font-mono font-semibold">
                  {line.resolved_part_number ? `${line.resolved_part_number} rev ${line.resolved_part_revision || "—"}` : "—"}
                </span>
              </p>
              <label className="flex items-center gap-1.5 text-xs text-muted">
                <CertCheckbox po={po} line={line} disabled={lineDisabled} onRun={run} />
                Certificate of conformance
              </label>
              <LineDetail po={po} line={line} disabled={lineDisabled} onRun={run} showFinder={false} />
              <CreateJobButton po={po} line={line} confirmed={confirmed} disabled={lineDisabled} onRun={run} onNotice={onNotice} onAskPrint={askPrint} className="w-full" />
            </div>
          );
        })}
      </div>
      {printJob ? (
        <PrintJobDialog jobNumber={printJob.jobNumber} certAvailable={printJob.certAvailable} onClose={finishPrint} />
      ) : null}
    </div>
  );
}

export function CertAllCheckbox({
  po,
  disabled,
  onRun,
}: {
  po: PoDetail;
  disabled?: boolean;
  onRun: RunLine;
}) {
  const editable = po.line_items.filter(certEditable);
  const anchor = editable[0];
  const allOn = editable.length > 0 && editable.every((line) => line.cert_required);
  const someOn = editable.some((line) => line.cert_required);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = someOn && !allOn;
  }, [someOn, allOn]);

  return (
    <label className="flex items-center gap-1.5 text-xs text-muted">
      <input
        ref={inputRef}
        type="checkbox"
        checked={allOn}
        disabled={disabled || !anchor}
        onChange={() => {
          if (!anchor) return;
          onRun(
            anchor.id,
            () => api.setCertRequired(po.id, anchor.id, !allOn, true),
            !allOn ? "Certificates marked for all lines." : "Certificates cleared for all lines.",
          );
        }}
      />
      Certs for all lines
    </label>
  );
}

export function CertCheckbox({
  po,
  line,
  disabled,
  onRun,
}: {
  po: PoDetail;
  line: LineItem;
  disabled?: boolean;
  onRun: RunLine;
}) {
  return (
    <input
      type="checkbox"
      checked={line.cert_required}
      disabled={disabled || !certEditable(line)}
      aria-label={`Certificate of conformance for line ${line.line_number ?? line.id}`}
      onChange={() =>
        onRun(
          line.id,
          () => api.setCertRequired(po.id, line.id, !line.cert_required),
          !line.cert_required ? "Certificate required for this line." : "Certificate not required for this line.",
        )
      }
    />
  );
}

function LineChecks({ line }: { line: LineItem }) {
  const hold = line.customer_credit_hold && !line.credit_hold_acknowledged;
  const duplicate = line.duplicate_job_numbers.length > 0 && !line.duplicate_acknowledged;
  const failed = Boolean(line.erp_failure_reason) && line.erp_status !== "skipped";
  if (!hold && !duplicate && !failed) return <span className="text-faint">—</span>;
  return (
    <div className="flex gap-1">
      {hold ? <Badge variant="warning">Credit hold</Badge> : null}
      {duplicate ? <Badge variant="warning">Duplicate</Badge> : null}
      {failed ? <Badge variant="failed">Error</Badge> : null}
    </div>
  );
}

export function CreateJobButton({
  po,
  line,
  confirmed,
  disabled,
  onRun,
  onNotice,
  onAskPrint,
  className,
}: {
  po: PoDetail;
  line: LineItem;
  confirmed: boolean;
  disabled?: boolean;
  onRun: RunLine;
  onNotice?: (message: string) => void;
  onAskPrint: (jobNumber: string, certAvailable: boolean) => Promise<void>;
  className?: string;
}) {
  const [block, setBlock] = useState<CreatePrintResult | null>(null);
  if ((line.erp_status === "created" || line.erp_status === "skipped") && !block) return null;
  const canCreate = confirmed && line.erp_status === "ready";
  return (
    <>
      <Button
        size="sm"
        className={className}
        disabled={disabled || !canCreate}
        onClick={() =>
          onRun(line.id, async () => {
            const result = await createJobThenPrint(po.id, line.id, line.cert_required, onAskPrint);
            if (result.printed) onNotice?.(`Job ${result.job_number} created.`);
            else if (result.missing_ops || result.missing_cert) setBlock(result);
            else if (result.print_error) onNotice?.(`Job created. Print skipped: ${result.print_error}`);
            else onNotice?.("ShopKeeper job created.");
            return result.po;
          })
        }
      >
        Create job and print
      </Button>
      {block ? <JobPrintBlock block={block} poId={po.id} onClose={() => setBlock(null)} /> : null}
    </>
  );
}

export function LineDetail({
  po,
  line,
  disabled,
  onRun,
  showFinder = true,
}: {
  po: PoDetail;
  line: LineItem;
  disabled?: boolean;
  onRun: RunLine;
  showFinder?: boolean;
}) {
  const created = line.erp_status === "created";
  const skipped = line.erp_status === "skipped";

  return (
    <div className="space-y-2">
      {line.erp_job_number ? (
        <p className="text-xs text-emerald-800">
          ShopKeeper job{" "}
          <Link
            className="font-mono font-semibold text-accent hover:underline"
            to={`/jobs/${encodeURIComponent(line.erp_job_number)}`}
            state={{ from: "po-review", poId: po.id }}
          >
            {line.erp_job_number}
          </Link>
          {line.erp_database ? ` on ${line.erp_database}` : ""}
        </p>
      ) : null}
      {skipped ? (
        <div className="flex flex-col gap-2 rounded-md border border-rule border-l-4 border-l-faint bg-white px-3 py-1.5 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>Skipped{line.erp_failure_reason ? `: ${line.erp_failure_reason}` : "."} Fix the line, then un-skip it to create the job.</span>
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => onRun(line.id, () => api.unskipLine(po.id, line.id), "Line un-skipped.")}>
            Un-skip line
          </Button>
        </div>
      ) : line.erp_failure_reason ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-800">{line.erp_failure_reason}</p>
      ) : null}
      {line.customer_credit_hold && !line.credit_hold_acknowledged ? (
        <div className="flex flex-col gap-2 rounded-md border border-amber-200 border-l-4 border-l-amber-500 bg-amber-50 px-3 py-1.5 text-xs text-amber-950 sm:flex-row sm:items-center sm:justify-between">
          This customer is on credit hold. Confirm before the line can become ready.
          <Button size="sm" disabled={disabled} onClick={() => onRun(line.id, () => api.acknowledgeCreditHold(po.id, line.id), "Credit hold acknowledged.")}>
            Acknowledge credit hold
          </Button>
        </div>
      ) : null}
      {line.duplicate_job_numbers?.length && !line.duplicate_acknowledged && !skipped ? (
        <div className="flex flex-col gap-2 rounded-md border border-amber-200 border-l-4 border-l-amber-500 bg-amber-50 px-3 py-1.5 text-xs text-amber-950 sm:flex-row sm:items-center sm:justify-between">
          <span>
            ShopKeeper already has job <span className="font-mono font-semibold">{line.duplicate_job_numbers.join(", ")}</span> for this customer, PO, and part.
            Skip this line or confirm it is a genuine new order.
          </span>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" disabled={disabled} onClick={() => onRun(line.id, () => api.acknowledgeDuplicate(po.id, line.id), "Duplicate acknowledged.")}>
              Create new job anyway
            </Button>
            <Button size="sm" variant="outline" disabled={disabled} onClick={() => onRun(line.id, () => api.skipLine(po.id, line.id), "Line skipped.")}>
              Skip line
            </Button>
          </div>
        </div>
      ) : null}

      {!created && showFinder ? (
        <div className="space-y-2">
          <PartMatchSection
            initialPartNumber={line.customer_part_number || ""}
            initialRevision={line.revision || ""}
            selectedPartNumber={line.resolved_part_number}
            selectedRevision={line.resolved_part_revision}
            selectedPmLinkId={line.resolved_pm_linkid}
            disabled={disabled}
            lineIndex={Math.max(0, po.line_items.findIndex((row) => row.id === line.id))}
            onAfterUse={() => {
              const index = Math.max(0, po.line_items.findIndex((row) => row.id === line.id));
              focusNextEmpty([`qty-line-${index}`, `price-line-${index}`, `due-line-${index}`]);
            }}
            onUse={(match) =>
              onRun(
                line.id,
                () => api.resolvePart(po.id, line.id, match.part_number, match.part_revision),
                `Part ${match.part_number} rev ${match.part_revision} stored.`,
              )
            }
          />
          <div className="flex justify-end">
            {!skipped ? (
              <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onRun(line.id, () => api.skipLine(po.id, line.id), "Line skipped.")}>
                Skip line
              </Button>
            ) : null}
          </div>
        </div>
      ) : !created ? (
        <div className="flex justify-end">
          {!skipped ? (
            <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onRun(line.id, () => api.skipLine(po.id, line.id), "Line skipped.")}>
              Skip line
            </Button>
          ) : null}
        </div>
      ) : (
        <details className="rounded-md border border-rule px-3 py-2 text-xs text-muted">
          <summary className="cursor-pointer font-semibold">Office only — delete job</summary>
          <p className="mt-2">
            Deletes the ShopKeeper job the same way ShopKeeper Delete Job does, then clears it from this app. Refused if
            the job is on a shipper, locked, kitted, timed, traveler-printed, or has serials.
          </p>
          <Button
            className="mt-2"
            variant="danger"
            size="sm"
            disabled={disabled}
            onClick={() => {
              if (
                !window.confirm(
                  `Permanently delete ShopKeeper job ${line.erp_job_number}? This cannot be undone.`,
                )
              ) {
                return;
              }
              return onRun(
                line.id,
                () => api.deleteShopKeeperJobForLine(po.id, line.id),
                "ShopKeeper job deleted. You can create a new job.",
              );
            }}
          >
            Delete ShopKeeper job
          </Button>
          <p className="mt-3">
            If the job is already gone from ShopKeeper, clear the job number in this app only so you can create the line
            again.
          </p>
          <Button
            className="mt-2"
            variant="secondary"
            size="sm"
            disabled={disabled}
            onClick={() => {
              if (!window.confirm("Clear this job from the app? Only continue if it was deleted in ShopKeeper.")) {
                return;
              }
              return onRun(line.id, () => api.resetErp(po.id, line.id), "Line cleared. You can create a new job.");
            }}
          >
            Clear job from this app
          </Button>
        </details>
      )}
    </div>
  );
}

function JobPrintBlock({
  block,
  poId,
  onClose,
}: {
  block: CreatePrintResult;
  poId: number;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-w-md rounded-lg border border-rule bg-white p-4 shadow-lg">
        <h3 className="mb-2 text-sm font-semibold">Job {block.job_number} was created. Nothing was printed.</h3>
        <ul className="mb-3 list-disc space-y-1 pl-5 text-sm">
          {block.missing_ops ? <li>This job has no operations. Add steps or copy a template on the job page.</li> : null}
          {block.missing_cert ? (
            <li>Certificate is required but this part has none linked. Open the part to link a certification.</li>
          ) : null}
        </ul>
        <Button
          onClick={() => {
            if (block.missing_ops) {
              navigate(`/jobs/${encodeURIComponent(block.job_number)}`, { state: { from: "po-review", poId } });
            } else if (block.pm_linkid) {
              navigate(`/parts/${block.pm_linkid}`);
            }
            onClose();
          }}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}
