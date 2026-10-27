import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

import { api } from "@/api/client";
import { PartImageCard } from "@/components/po/PartImageCard";
import { PriceLookup } from "@/components/po/PriceLookup";
import { CreateJobButton, LineDetail, type RunLine } from "@/components/po/lines/actions";
import { LinePartMatch } from "@/components/po/lines/LinePartMatch";
import { isLineCreated, isLineLocked, lineFieldsDirty, poCustomerCode, UNITS } from "@/components/po/lines/helpers";
import { Button } from "@/components/ui/button";
import { cn, formatDate, formatUsd } from "@/lib/utils";
import type { JobPage, LineItem, LineItemDraft, PartCandidate, PartEditor, PoDetail } from "@/types/po";

export function LineDetailsBody({
  item,
  index,
  line,
  po,
  disabled,
  confirmed,
  matcherOpen,
  remountMatcher,
  stacked,
  saveTick,
  onToggleMatcher,
  onUpdate,
  onUsePart,
  onBeforeCreatePart,
  onRun,
  onError,
  onNotice,
  onAskPrint,
  onSave,
  onChangePo,
}: {
  item: LineItemDraft;
  index: number;
  line?: LineItem;
  po: PoDetail;
  disabled?: boolean;
  confirmed: boolean;
  matcherOpen: boolean;
  remountMatcher?: string | number;
  stacked?: boolean;
  saveTick?: number;
  onToggleMatcher: () => void;
  onUpdate: (field: keyof LineItemDraft, value: string) => void;
  onUsePart: (index: number, part: PartCandidate) => void | Promise<void>;
  onBeforeCreatePart?: () => Promise<boolean>;
  onRun: RunLine;
  onError?: (message: string) => void;
  onNotice?: (message: string) => void;
  onAskPrint: (jobNumber: string, certAvailable: boolean) => Promise<void>;
  onSave: () => Promise<boolean>;
  onChangePo?: (po: PoDetail) => void;
}) {
  const unsaved = item.id == null;
  const locked = isLineLocked(line);
  const created = isLineCreated(line);
  const skDisabled = disabled || unsaved || locked;
  const fieldsDisabled = disabled || locked;
  const partLabel = item.customer_part_number || line?.customer_part_number || "—";
  const revLabel = item.revision || line?.revision || "";
  const matched = Boolean(line?.resolved_part_number);
  const showMatcher = matcherOpen || (!matched && !created && !unsaved);
  const customerCode = line?.resolved_customer_code || poCustomerCode(po);
  const showNotes = !created || Boolean(item.notes);
  const readyHint = !confirmed && line?.erp_status === "ready";
  const priceReady = Boolean(customerCode && line?.resolved_part_number);

  const [job, setJob] = useState<JobPage | null>(null);
  const [part, setPart] = useState<PartEditor | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [savedNote, setSavedNote] = useState(false);

  useEffect(() => {
    setDeleteOpen(false);
    setDeleteError(null);
    setSavedNote(false);
  }, [line?.id]);

  useEffect(() => {
    if (saveTick && saveTick > 0) setSavedNote(true);
  }, [saveTick]);

  useEffect(() => {
    if (!created || !line?.erp_job_number) {
      setJob(null);
      return;
    }
    let cancelled = false;
    api
      .getJob(line.erp_job_number)
      .then((result) => {
        if (!cancelled) setJob(result);
      })
      .catch(() => {
        if (!cancelled) setJob(null);
      });
    return () => {
      cancelled = true;
    };
  }, [created, line?.erp_job_number, saveTick]);

  useEffect(() => {
    const pm = line?.resolved_pm_linkid ?? job?.pm_linkid ?? null;
    if (!pm) {
      setPart(null);
      return;
    }
    let cancelled = false;
    api
      .getPart(pm)
      .then((result) => {
        if (!cancelled) setPart(result);
      })
      .catch(() => {
        if (!cancelled) setPart(null);
      });
    return () => {
      cancelled = true;
    };
  }, [line?.resolved_pm_linkid, job?.pm_linkid]);

  const certName = part?.linked_certs[0]?.description || part?.linked_certs[0]?.id || null;
  const jobDirty = created && lineFieldsDirty(item, line);
  const pictures = job?.pictures ?? part?.pictures ?? [];
  const pmLinkId = job?.pm_linkid ?? line?.resolved_pm_linkid ?? null;

  const heading = (
    <div className={cn("flex flex-wrap items-baseline justify-between gap-2", stacked ? "px-1" : "px-3 pt-3")}>
      <p className="text-[13px] font-semibold">
        Line {item.line_number || index + 1} · {partLabel}
        {revLabel ? <span className="font-mono font-normal text-muted"> rev {revLabel}</span> : null}
        {item.description ? <span className="ml-2 font-normal text-muted">{item.description}</span> : null}
      </p>
      {stacked ? null : (
        <p className="text-[11px] text-muted">
          ↑ ↓ move between lines · ← → move between fields · Enter opens or closes details · Esc closes · Ctrl+S saves ·
          Ctrl+Enter confirms · Ctrl+Shift+P hides PDF
        </p>
      )}
    </div>
  );

  const matcher = showMatcher && !locked ? (
    <LinePartMatch
      item={item}
      index={index}
      line={line}
      po={po}
      disabled={skDisabled}
      remountKey={remountMatcher}
      onUsePart={onUsePart}
      onBeforeCreatePart={onBeforeCreatePart}
      onError={onError}
    />
  ) : null;

  const matchedSummary =
    matched && !showMatcher && !created ? (
      <div className="space-y-1 text-[13px]">
        <p>
          ShopKeeper part{" "}
          <span className="font-mono font-semibold">
            {line?.resolved_part_number} rev {line?.resolved_part_revision || "—"}
          </span>
          {line?.resolved_pm_linkid ? (
            <>
              {" · "}
              <Link to={`/parts/${line.resolved_pm_linkid}`} className="font-semibold text-accent hover:underline">
                Open part ↗
              </Link>
            </>
          ) : null}
          {" · "}
          <button type="button" className="font-semibold text-accent hover:underline" disabled={skDisabled} onClick={onToggleMatcher}>
            Change
          </button>
        </p>
        {part ? (
          <p className="text-xs text-muted">
            {part.operations.length} {part.operations.length === 1 ? "operation" : "operations"}
            {line?.cert_required ? ` · cert ${certName || "required"}` : " · cert not required"}
          </p>
        ) : line?.cert_required ? (
          <p className="text-xs text-muted">Certification required</p>
        ) : null}
      </div>
    ) : null;

  const notes = showNotes ? (
    <label className="block space-y-1">
      <span className="field-label">Line notes</span>
      <textarea
        className={cn(
          "min-h-[56px] w-full rounded-md border border-rule bg-white px-2.5 py-1.5 text-ink focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/15 disabled:bg-head",
          stacked ? "text-[16px]" : "text-sm",
        )}
        value={item.notes}
        disabled={fieldsDisabled}
        aria-label="Line notes"
        onChange={(event) => onUpdate("notes", event.target.value)}
      />
    </label>
  ) : null;

  const prices = (
    <div className="space-y-1">
      <PriceLookup
        customerNumber={customerCode || null}
        partNumber={line?.resolved_part_number || null}
        partRevision={line?.resolved_part_revision || null}
        quantity={item.quantity}
        disabled={skDisabled || !priceReady}
        currentPrice={item.unit_price || undefined}
        pickLabel={stacked ? "Use" : undefined}
        onPick={(price) => {
          onUpdate("unit_price", price);
          setSavedNote(false);
        }}
      />
      {created && line?.erp_job_number && priceReady ? (
        <p className="text-xs text-muted">Picking a price also updates job {line.erp_job_number} in ShopKeeper.</p>
      ) : null}
    </div>
  );

  const create =
    confirmed && line?.erp_status === "ready" && onAskPrint ? (
      <div className="flex justify-end">
        <CreateJobButton
          po={po}
          line={line}
          confirmed={confirmed}
          disabled={skDisabled}
          onRun={onRun}
          onNotice={onNotice}
          onAskPrint={onAskPrint}
        />
      </div>
    ) : readyHint ? (
      <p className="text-xs text-muted">Tap PO is correct below to create this job.</p>
    ) : null;

  const checks = line ? (
    <LineDetail po={po} line={line} disabled={skDisabled} onRun={onRun} showFinder={false} hideCreatedActions />
  ) : unsaved ? (
    <p className="text-xs text-muted">Not saved yet. Save the PO before matching a part or creating a job.</p>
  ) : null;

  const stackedFields = stacked ? (
    <div className="grid grid-cols-2 gap-2">
      <MobileField label="Ln">
        <input
          className="cell-input h-11 border-rule text-[16px] font-mono"
          inputMode="numeric"
          value={item.line_number}
          disabled={fieldsDisabled}
          aria-label="Line number"
          onChange={(event) => onUpdate("line_number", event.target.value)}
        />
      </MobileField>
      <MobileField label="Rev">
        <input
          className="cell-input h-11 border-rule text-[16px] font-mono"
          value={item.revision}
          disabled={fieldsDisabled}
          aria-label="Revision"
          onChange={(event) => onUpdate("revision", event.target.value)}
        />
      </MobileField>
      <MobileField label="Customer part #" className="col-span-2">
        <input
          className="cell-input h-11 border-rule text-[16px] font-mono"
          value={item.customer_part_number}
          disabled={fieldsDisabled}
          aria-label="Customer part number"
          onChange={(event) => onUpdate("customer_part_number", event.target.value)}
        />
      </MobileField>
      <MobileField label="Description" className="col-span-2">
        <input
          className="cell-input h-11 border-rule text-[16px]"
          value={item.description}
          disabled={fieldsDisabled}
          aria-label="Description"
          onChange={(event) => onUpdate("description", event.target.value)}
        />
      </MobileField>
      <MobileField label="Qty">
        <input
          className="cell-input h-11 border-rule text-right text-[16px] font-mono"
          inputMode="numeric"
          value={item.quantity}
          disabled={fieldsDisabled}
          aria-label="Quantity"
          onChange={(event) => onUpdate("quantity", event.target.value)}
        />
      </MobileField>
      <MobileField label="Unit">
        <select
          className="cell-input h-11 border-rule text-[16px]"
          value={item.uom}
          disabled={fieldsDisabled}
          aria-label="Unit"
          onChange={(event) => onUpdate("uom", event.target.value)}
        >
          {UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {unit}
            </option>
          ))}
        </select>
      </MobileField>
      <MobileField label="Price">
        <input
          className="cell-input h-11 border-rule text-right text-[16px] font-mono"
          inputMode="decimal"
          value={item.unit_price}
          disabled={fieldsDisabled}
          aria-label="Unit price"
          onChange={(event) => onUpdate("unit_price", event.target.value)}
          onBlur={(event) => onUpdate("unit_price", formatUsd(event.currentTarget.value))}
        />
      </MobileField>
      <MobileField label="Due">
        <input
          className="cell-input h-11 border-rule text-[16px] font-mono"
          type="date"
          value={item.due_date}
          disabled={fieldsDisabled}
          aria-label="Due date"
          onChange={(event) => onUpdate("due_date", event.target.value)}
        />
      </MobileField>
      {line ? (
        <label className="col-span-2 flex min-h-11 items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={line.cert_required}
            disabled={skDisabled || created}
            onChange={() =>
              onRun(
                line.id,
                () => api.setCertRequired(po.id, line.id, !line.cert_required),
                !line.cert_required ? "Certificate required for this line." : "Certificate not required for this line.",
              )
            }
          />
          Certification required{certName ? ` · ${certName}` : ""}
        </label>
      ) : null}
    </div>
  ) : null;

  const miniJob = created && line?.erp_job_number ? (
    <MiniJob
      item={item}
      line={line}
      po={po}
      job={job}
      part={part}
      pictures={pictures}
      pmLinkId={pmLinkId}
      certName={certName}
      stacked={stacked}
      disabled={fieldsDisabled}
      deleteOpen={deleteOpen}
      deleteError={deleteError}
      deleteBusy={deleteBusy}
      jobDirty={jobDirty}
      savedNote={savedNote}
      onUpdate={onUpdate}
      onAskPrint={onAskPrint}
      onSave={async () => {
        const ok = await onSave();
        if (ok) setSavedNote(true);
        return ok;
      }}
      onDeleteAsk={() => {
        setDeleteOpen(true);
        setDeleteError(null);
      }}
      onDeleteCancel={() => {
        setDeleteOpen(false);
        setDeleteError(null);
      }}
      onDeleteConfirm={() => {
        setDeleteBusy(true);
        setDeleteError(null);
        api
          .deleteShopKeeperJobForLine(po.id, line.id)
          .then((result) => {
            onChangePo?.(result);
            onNotice?.("ShopKeeper job deleted. You can create a new job.");
            setDeleteOpen(false);
          })
          .catch((err: unknown) => {
            setDeleteError(err instanceof Error ? err.message : "Unable to delete this job.");
          })
          .finally(() => setDeleteBusy(false));
      }}
    />
  ) : null;

  return (
    <div className={cn("space-y-3 pb-3", stacked ? "pt-2" : "")}>
      {heading}
      <div className={cn(stacked ? "space-y-3 px-1" : "grid gap-3 px-3 pb-1 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]")}>
        <div className="min-w-0 space-y-3">
          {stacked ? (
            <div className="space-y-2">
              {pmLinkId || matched ? <PartImageCard pictures={pictures} pmLinkId={pmLinkId} compact /> : null}
              {matched && !created ? (
                <div className="flex flex-wrap gap-2 text-[13px]">
                  <span className="font-mono font-semibold">
                    {line?.resolved_part_number} rev {line?.resolved_part_revision || "—"}
                  </span>
                  <button type="button" className="font-semibold text-accent hover:underline" onClick={onToggleMatcher}>
                    Change part
                  </button>
                </div>
              ) : null}
              {showMatcher ? matcher : null}
            </div>
          ) : (
            <>
              {matcher}
              {matchedSummary}
            </>
          )}
          {miniJob && !stacked ? miniJob : null}
          {stackedFields}
          {checks}
          {notes}
          {prices}
          {miniJob && stacked ? miniJob : null}
          {create}
        </div>
        {!stacked && !created ? (
          <div className="min-w-0 max-w-[280px]">
            {matched || pmLinkId ? <PartImageCard pictures={pictures} pmLinkId={pmLinkId} compact /> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function MiniJob({
  item,
  line,
  po,
  job,
  part,
  pictures,
  pmLinkId,
  certName,
  stacked,
  disabled,
  deleteOpen,
  deleteError,
  deleteBusy,
  jobDirty,
  savedNote,
  onUpdate,
  onAskPrint,
  onSave,
  onDeleteAsk,
  onDeleteCancel,
  onDeleteConfirm,
}: {
  item: LineItemDraft;
  line: LineItem;
  po: PoDetail;
  job: JobPage | null;
  part: PartEditor | null;
  pictures: JobPage["pictures"];
  pmLinkId: number | null;
  certName: string | null;
  stacked?: boolean;
  disabled?: boolean;
  deleteOpen: boolean;
  deleteError: string | null;
  deleteBusy: boolean;
  jobDirty: boolean;
  savedNote: boolean;
  onUpdate: (field: keyof LineItemDraft, value: string) => void;
  onAskPrint: (jobNumber: string, certAvailable: boolean) => Promise<void>;
  onSave: () => Promise<boolean>;
  onDeleteAsk: () => void;
  onDeleteCancel: () => void;
  onDeleteConfirm: () => void;
}) {
  const jobNumber = line.erp_job_number || "";
  const createdLabel = formatDate(line.erp_created_at);
  const printed = job?.traveler_printed || line.erp_traveler_printed;
  const ops = job?.operations ?? part?.operations ?? [];
  const printCert = Boolean(job ? job.cert_required && job.cert_linked : line.cert_required);

  const fields = (
    <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 lg:grid-cols-3">
      <JobField label="Customer">
        <span className="font-mono text-[13px]">{line.resolved_customer_code || poCustomerCode(po) || "—"}</span>
      </JobField>
      <JobField label="PO #">
        <span className="font-mono text-[13px]">{po.po_number || "—"}</span>
      </JobField>
      <JobField label="Part #">
        <input
          className="cell-input h-8 border-rule font-mono"
          value={item.customer_part_number}
          disabled={disabled}
          aria-label="Part number"
          onChange={(event) => onUpdate("customer_part_number", event.target.value)}
        />
      </JobField>
      <JobField label="Rev">
        <input
          className="cell-input h-8 border-rule font-mono"
          value={item.revision}
          disabled={disabled}
          aria-label="Revision"
          onChange={(event) => onUpdate("revision", event.target.value)}
        />
      </JobField>
      <JobField label="Qty">
        <input
          className="cell-input h-8 border-rule text-right font-mono"
          inputMode="numeric"
          value={item.quantity}
          disabled={disabled}
          aria-label="Quantity"
          onChange={(event) => onUpdate("quantity", event.target.value)}
        />
      </JobField>
      <JobField label="Unit">
        <select
          className="cell-input h-8 border-rule"
          value={item.uom}
          disabled={disabled}
          aria-label="Unit"
          onChange={(event) => onUpdate("uom", event.target.value)}
        >
          {UNITS.map((unit) => (
            <option key={unit} value={unit}>
              {unit}
            </option>
          ))}
        </select>
      </JobField>
      <JobField label="Unit price">
        <input
          className="cell-input h-8 border-rule text-right font-mono"
          inputMode="decimal"
          value={item.unit_price}
          disabled={disabled}
          aria-label="Unit price"
          onChange={(event) => onUpdate("unit_price", event.target.value)}
          onBlur={(event) => onUpdate("unit_price", formatUsd(event.currentTarget.value))}
        />
      </JobField>
      <JobField label="Due date">
        <input
          className="cell-input h-8 border-rule font-mono"
          type="date"
          value={item.due_date}
          disabled={disabled}
          aria-label="Due date"
          onChange={(event) => onUpdate("due_date", event.target.value)}
        />
      </JobField>
      <JobField label="Description" className="col-span-2 lg:col-span-3">
        <input
          className="cell-input h-8 border-rule"
          value={item.description}
          disabled={disabled}
          aria-label="Description"
          onChange={(event) => onUpdate("description", event.target.value)}
        />
      </JobField>
      <label className="col-span-2 flex items-center gap-2 text-[13px] lg:col-span-3">
        <input type="checkbox" className="h-4 w-4" checked={line.cert_required} disabled readOnly />
        Certification required{certName ? ` · ${certName}` : job?.cert_linked ? " · certificate linked" : ""}
      </label>
    </div>
  );

  const opsTable = ops.length ? (
    <div className="overflow-hidden rounded-md border border-rule">
      <table className="data-table">
        <thead>
          <tr>
            <th className="bg-card-header text-card-header-ink">Seq</th>
            <th className="bg-card-header text-card-header-ink">Work center</th>
            <th className="bg-card-header text-card-header-ink">Description</th>
          </tr>
        </thead>
        <tbody>
          {ops.map((op) => (
            <tr key={`${op.seq_num}-${op.wc_code}`}>
              <td className="font-mono">{op.seq_num}</td>
              <td className="font-mono">{op.wc_code}</td>
              <td>{op.description || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <p className="text-xs text-muted">No operations on this job yet.</p>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px]">
          <Link
            className="font-mono text-base font-semibold text-accent hover:underline"
            to={`/jobs/${encodeURIComponent(jobNumber)}`}
            state={{ from: "po-review", poId: po.id }}
          >
            Job {jobNumber}
          </Link>
          <span className="ml-2 text-muted">
            created {createdLabel}
            {printed ? " · traveler printed" : ""}
          </span>
        </p>
        <Link
          className="text-xs font-semibold text-accent hover:underline"
          to={`/jobs/${encodeURIComponent(jobNumber)}`}
          state={{ from: "po-review", poId: po.id }}
        >
          Open job ↗
        </Link>
      </div>
      <div className={cn(stacked ? "space-y-3" : "grid gap-3 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]")}>
        <div className="min-w-0 space-y-3">
          {fields}
          {opsTable}
        </div>
        <div className={cn("min-w-0", stacked ? "" : "max-w-[280px]")}>
          <PartImageCard pictures={pictures} pmLinkId={pmLinkId} compact />
        </div>
      </div>
      {deleteOpen ? (
        <div className="space-y-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-900">
          <p>
            Delete job {jobNumber} from ShopKeeper? This removes the job itself, not just this app's link to it, and
            can't be undone.
          </p>
          {deleteError ? <p className="text-red-800">{deleteError}</p> : null}
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" disabled={deleteBusy} onClick={onDeleteCancel}>
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={deleteBusy}
              className="border-transparent bg-[#b42318] text-white hover:bg-[#9a1d14]"
              onClick={onDeleteConfirm}
            >
              Delete job
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            size="sm"
            className="border-transparent bg-[#b42318] text-white hover:bg-[#9a1d14]"
            disabled={disabled}
            onClick={onDeleteAsk}
          >
            Delete job
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted" role="status">
              {jobDirty && !savedNote ? `Unsaved changes to job ${jobNumber}` : "Saved to ShopKeeper"}
            </span>
            <Button type="button" variant="outline" size="sm" disabled={disabled || !jobDirty} onClick={() => void onSave()}>
              Save to ShopKeeper
            </Button>
            <Button type="button" size="sm" disabled={disabled} onClick={() => void onAskPrint(jobNumber, printCert)}>
              Print
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function JobField({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <label className={cn("space-y-0.5", className)}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}

function MobileField({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <label className={cn("space-y-0.5", className)}>
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}
