import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { api } from "@/api/client";
import { PartMatchSection } from "@/components/po/PartMatch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { focusNextEmpty } from "@/lib/utils";
import type { CreatePrintResult, LineItem, PoDetail } from "@/types/po";

export async function createJobThenPrint(
  poId: number,
  lineId: number,
  certAvailable: boolean,
  askPrint: (jobNumber: string, certAvailable: boolean) => Promise<void>,
) {
  const result = await api.createJob(poId, lineId);
  if (result.printed) await askPrint(result.job_number, certAvailable);
  return result;
}

export type RunLine = (lineId: number, work: () => Promise<PoDetail>, notice?: string) => Promise<void>;

function certEditable(line: LineItem): boolean {
  return line.erp_status !== "created" && line.erp_status !== "creating";
}

export function needsAttention(line: LineItem): boolean {
  if (line.erp_status === "created") return false;
  if (line.erp_status === "skipped") return true;
  return (
    line.erp_status !== "ready" ||
    (line.customer_credit_hold && !line.credit_hold_acknowledged) ||
    (line.duplicate_job_numbers.length > 0 && !line.duplicate_acknowledged)
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

export function LineChecks({ line, hideEmpty }: { line: LineItem; hideEmpty?: boolean }) {
  const hold = line.customer_credit_hold && !line.credit_hold_acknowledged;
  const duplicate = line.duplicate_job_numbers.length > 0 && !line.duplicate_acknowledged;
  const failed = Boolean(line.erp_failure_reason) && line.erp_status !== "skipped";
  if (!hold && !duplicate && !failed) return hideEmpty ? null : <span className="text-faint">—</span>;
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
  hideCreatedActions = false,
}: {
  po: PoDetail;
  line: LineItem;
  disabled?: boolean;
  onRun: RunLine;
  showFinder?: boolean;
  hideCreatedActions?: boolean;
}) {
  const created = line.erp_status === "created";
  const skipped = line.erp_status === "skipped";

  return (
    <div className="space-y-2">
      {line.erp_job_number && !hideCreatedActions ? (
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
              Create anyway
            </Button>
            <Button size="sm" variant="outline" disabled={disabled} onClick={() => onRun(line.id, () => api.skipLine(po.id, line.id), "Line skipped.")}>
              Skip this line
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
      ) : !created && !hideCreatedActions ? (
        <div className="flex justify-end">
          {!skipped ? (
            <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onRun(line.id, () => api.skipLine(po.id, line.id), "Line skipped.")}>
              Skip line
            </Button>
          ) : null}
        </div>
      ) : line.erp_status === "failed" && hideCreatedActions ? (
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => onRun(line.id, () => api.resetErp(po.id, line.id), "Line cleared. You can create a new job.")}
        >
          Reset
        </Button>
      ) : hideCreatedActions ? null : (
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

export function JobPrintBlock({
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
