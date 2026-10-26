import { Link } from "react-router-dom";

import { LineDetail, type RunLine } from "@/components/po/lines/actions";
import { formatUsd } from "@/lib/utils";
import type { LineItem, LineItemDraft, PartCandidate, PoDetail } from "@/types/po";

import { isLineLocked } from "./helpers";
import { LinePartMatch } from "./LinePartMatch";

export function LineDetailPanel({
  item,
  index,
  line,
  po,
  disabled,
  matcherOpen,
  remountMatcher,
  onToggleMatcher,
  onUsePart,
  onBeforeCreatePart,
  onRun,
  onError,
}: {
  item: LineItemDraft;
  index: number;
  line?: LineItem;
  po: PoDetail;
  disabled?: boolean;
  matcherOpen: boolean;
  remountMatcher?: string | number;
  onToggleMatcher: () => void;
  onUsePart: (index: number, part: PartCandidate) => void | Promise<void>;
  onBeforeCreatePart?: () => Promise<boolean>;
  onRun: RunLine;
  onError?: (message: string) => void;
}) {
  const unsaved = item.id == null;
  const locked = isLineLocked(line);
  const skDisabled = disabled || unsaved || locked;
  const partLabel = line?.resolved_part_number
    ? `SK part ${line.resolved_part_number}${line.resolved_part_revision ? ` rev ${line.resolved_part_revision}` : ""}`
    : "No ShopKeeper part matched";

  return (
    <div className="space-y-3 border-t border-rule-soft bg-head/40 px-4 py-3">
      {unsaved ? <p className="text-xs text-muted">Not saved yet</p> : null}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px] @[640px]:grid-cols-4">
        <Field label="Ln" value={item.line_number} mono />
        <Field label="Part #" value={item.customer_part_number} mono />
        <Field label="Rev" value={item.revision} mono />
        <Field label="Qty" value={`${item.quantity || "—"} ${item.uom || ""}`.trim()} />
        <Field label="Description" value={item.description} wide />
        <Field label="Unit price" value={formatUsd(item.unit_price) || "—"} mono />
        <Field label="Due" value={item.due_date} mono />
        {item.notes ? <Field label="Notes" value={item.notes} wide /> : null}
      </dl>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
        <span className={line?.resolved_part_number ? "font-medium" : "text-muted"}>{partLabel}</span>
        {line?.resolved_pm_linkid ? (
          <Link to={`/parts/${line.resolved_pm_linkid}`} className="text-xs font-semibold text-accent hover:underline">
            Open part ↗
          </Link>
        ) : null}
        {!unsaved ? (
          <button type="button" className="text-xs font-semibold text-accent hover:underline" disabled={skDisabled} onClick={onToggleMatcher}>
            Change
          </button>
        ) : null}
      </div>
      {matcherOpen && !locked ? (
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
      ) : null}
      {line ? <LineDetail po={po} line={line} disabled={skDisabled} onRun={onRun} showFinder={false} /> : null}
    </div>
  );
}

function Field({ label, value, mono, wide }: { label: string; value: string; mono?: boolean; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2 @[640px]:col-span-4" : undefined}>
      <dt className="field-label">{label}</dt>
      <dd className={mono ? "font-mono" : undefined}>{value || "—"}</dd>
    </div>
  );
}
