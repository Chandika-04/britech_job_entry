import { ChevronDown, ChevronRight } from "lucide-react";
import type { MouseEvent } from "react";
import { Link } from "react-router-dom";

import { CertCheckbox, CreateJobButton, LineChecks, type RunLine } from "@/components/po/lines/actions";
import { ErpBadge } from "@/components/po/StatusBadge";
import type { LineItem, LineItemDraft, PartCandidate, PoDetail } from "@/types/po";

import { isLineLocked, qtyDueLabel } from "./helpers";
import { LineDetailPanel } from "./LineDetailPanel";
import { SkPartChip } from "./SkPartChip";

export function JobModeRow({
  item,
  index,
  line,
  po,
  confirmed,
  disabled,
  expanded,
  matcherOpen,
  remountMatcher,
  onToggle,
  onToggleMatcher,
  onUsePart,
  onBeforeCreatePart,
  onRun,
  onNotice,
  onAskPrint,
  onError,
}: {
  item: LineItemDraft;
  index: number;
  line?: LineItem;
  po: PoDetail;
  confirmed: boolean;
  disabled?: boolean;
  expanded: boolean;
  matcherOpen: boolean;
  remountMatcher?: string | number;
  onToggle: () => void;
  onToggleMatcher: () => void;
  onUsePart: (index: number, part: PartCandidate) => void | Promise<void>;
  onBeforeCreatePart?: () => Promise<boolean>;
  onRun: RunLine;
  onNotice?: (message: string) => void;
  onAskPrint: (jobNumber: string, certAvailable: boolean) => Promise<void>;
  onError?: (message: string) => void;
}) {
  const unsaved = item.id == null;
  const locked = isLineLocked(line);
  const skDisabled = disabled || unsaved || locked;
  const part = item.customer_part_number || "—";
  const rev = item.revision ? ` ${item.revision}` : "";

  const onRowClick = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("a, button, input, select, textarea, label")) return;
    onToggle();
  };

  const panel = (
    <LineDetailPanel
      item={item}
      index={index}
      line={line}
      po={po}
      disabled={disabled}
      matcherOpen={matcherOpen}
      remountMatcher={remountMatcher}
      onToggleMatcher={onToggleMatcher}
      onUsePart={onUsePart}
      onBeforeCreatePart={onBeforeCreatePart}
      onRun={onRun}
      onError={onError}
    />
  );

  return (
    <div className="border-b border-rule-soft last:border-b-0">
      <div
        className="hidden cursor-pointer px-4 py-2 hover:bg-head @[640px]:grid @[640px]:grid-cols-[1.5rem_2.25rem_minmax(7rem,10rem)_minmax(0,1fr)_8.5rem_minmax(7rem,9rem)_auto] @[640px]:items-center @[640px]:gap-2"
        onClick={onRowClick}
      >
        {expanded ? <ChevronDown className="h-4 w-4 text-muted" /> : <ChevronRight className="h-4 w-4 text-muted" />}
        <span className="font-mono text-xs tabular-nums">{item.line_number || index + 1}</span>
        <div className="min-w-0">
          <div className="truncate font-mono text-[13px] font-semibold">
            {part}
            <span className="font-normal text-muted">{rev}</span>
          </div>
          <SkPartChip line={line} poId={po.id} variant="job" disabled={skDisabled} onClick={onToggleMatcher} />
        </div>
        <p className="line-clamp-2 text-[13px]">{item.description || <span className="text-faint">No description</span>}</p>
        <span className="font-mono text-xs tabular-nums text-muted">{qtyDueLabel(item, line)}</span>
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          {line ? <ErpBadge status={line.erp_status} /> : <span className="text-xs text-muted">Unsaved</span>}
          {line ? <LineChecks line={line} hideEmpty /> : null}
          {line?.erp_job_number ? (
            <Link
              className="font-mono text-xs font-semibold text-accent hover:underline"
              to={`/jobs/${encodeURIComponent(line.erp_job_number)}`}
              state={{ from: "po-review", poId: po.id }}
            >
              {line.erp_job_number}
            </Link>
          ) : null}
        </div>
        <div className="flex items-center justify-end gap-2" onClick={(event) => event.stopPropagation()}>
          {line ? <CertCheckbox po={po} line={line} disabled={skDisabled} onRun={onRun} /> : null}
          {line ? (
            <CreateJobButton
              po={po}
              line={line}
              confirmed={confirmed}
              disabled={skDisabled}
              onRun={onRun}
              onNotice={onNotice}
              onAskPrint={onAskPrint}
            />
          ) : null}
        </div>
      </div>

      <div className="space-y-2 px-4 py-2 @[640px]:hidden">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-mono text-xs text-muted">Ln {item.line_number || index + 1}</p>
            <p className="truncate font-mono text-[13px] font-semibold">
              {part}
              <span className="font-normal text-muted">{rev}</span>
            </p>
            <SkPartChip line={line} poId={po.id} variant="job" disabled={skDisabled} onClick={onToggleMatcher} />
          </div>
          {line ? <ErpBadge status={line.erp_status} /> : <span className="text-xs text-muted">Unsaved</span>}
        </div>
        <p className="text-xs text-muted">{qtyDueLabel(item, line)}</p>
        {line?.erp_job_number ? (
          <Link
            className="font-mono text-xs font-semibold text-accent hover:underline"
            to={`/jobs/${encodeURIComponent(line.erp_job_number)}`}
            state={{ from: "po-review", poId: po.id }}
          >
            {line.erp_job_number}
          </Link>
        ) : null}
        <button type="button" className="text-xs font-semibold text-accent hover:underline" onClick={onToggle}>
          {expanded ? "Hide details" : "Details"}
        </button>
      </div>
      {expanded ? panel : null}
    </div>
  );
}
