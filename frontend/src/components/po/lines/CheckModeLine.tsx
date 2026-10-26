import { MessageSquareText, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { CertCheckbox, CreateJobButton, type RunLine } from "@/components/po/lines/actions";
import { Button } from "@/components/ui/button";
import { cn, formatUsd } from "@/lib/utils";
import type { LineItem, LineItemDraft, PartCandidate, PoDetail } from "@/types/po";

import { isLineCreated, isLineLocked, UNITS } from "./helpers";
import { LinePartMatch } from "./LinePartMatch";
import { SkPartChip } from "./SkPartChip";

export function CheckModeLine({
  item,
  index,
  line,
  po,
  disabled,
  matcherOpen,
  remountMatcher,
  notesOpen,
  onToggleNotes,
  onToggleMatcher,
  onUpdate,
  onRemove,
  onUsePart,
  onBeforeCreatePart,
  onRun,
  onError,
  confirmed,
  onNotice,
  onAskPrint,
}: {
  item: LineItemDraft;
  index: number;
  line?: LineItem;
  po: PoDetail;
  disabled?: boolean;
  matcherOpen: boolean;
  remountMatcher?: string | number;
  notesOpen: boolean;
  onToggleNotes: () => void;
  onToggleMatcher: () => void;
  onUpdate: (field: keyof LineItemDraft, value: string) => void;
  onRemove: () => void;
  onUsePart: (index: number, part: PartCandidate) => void | Promise<void>;
  onBeforeCreatePart?: () => Promise<boolean>;
  onRun: RunLine;
  onError?: (message: string) => void;
  confirmed?: boolean;
  onNotice?: (message: string) => void;
  onAskPrint?: (jobNumber: string, certAvailable: boolean) => Promise<void>;
}) {
  const creating = isLineLocked(line);
  const created = isLineCreated(line);
  const fieldsDisabled = disabled || creating;
  const unsaved = item.id == null;
  const skDisabled = disabled || unsaved || creating;

  return (
    <div className="space-y-1.5 border-b border-rule-soft px-4 py-2.5 last:border-b-0" data-outlined-fields>
      <div className="grid grid-cols-1 gap-2 @[640px]:grid-cols-[3.25rem_minmax(7rem,11rem)_3.5rem_minmax(0,1fr)] @[640px]:items-end">
        <Cell label="Ln">
          <input
            className="cell-input font-mono tabular-nums"
            inputMode="numeric"
            value={item.line_number}
            disabled={fieldsDisabled}
            aria-label="Line number"
            onChange={(event) => onUpdate("line_number", event.target.value)}
          />
        </Cell>
        <Cell label="Part #">
          <input
            className="cell-input font-mono"
            value={item.customer_part_number}
            disabled={fieldsDisabled}
            aria-label="Customer part number"
            onChange={(event) => onUpdate("customer_part_number", event.target.value)}
          />
        </Cell>
        <Cell label="Rev">
          <input
            className="cell-input font-mono"
            value={item.revision}
            disabled={fieldsDisabled}
            aria-label="Revision"
            onChange={(event) => onUpdate("revision", event.target.value)}
          />
        </Cell>
        <Cell label="Description">
          <input
            className="cell-input"
            value={item.description}
            disabled={fieldsDisabled}
            aria-label="Description"
            onChange={(event) => onUpdate("description", event.target.value)}
          />
        </Cell>
      </div>
      <div className="grid grid-cols-2 gap-2 @[640px]:grid-cols-[4.5rem_4.75rem_6.75rem_8.5rem_minmax(7rem,1fr)_auto_auto] @[640px]:items-end">
        <Cell label="Qty">
          <input
            data-focus={`qty-line-${index}`}
            className="cell-input text-right font-mono tabular-nums"
            inputMode="decimal"
            value={item.quantity}
            disabled={fieldsDisabled}
            aria-label="Quantity"
            onChange={(event) => onUpdate("quantity", event.target.value)}
          />
        </Cell>
        <Cell label="Unit">
          <select
            className="cell-input"
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
        </Cell>
        <Cell label="Unit price">
          <input
            data-focus={`price-line-${index}`}
            data-money="usd"
            className="cell-input text-right font-mono tabular-nums"
            inputMode="decimal"
            value={item.unit_price}
            disabled={fieldsDisabled}
            aria-label="Unit price"
            onChange={(event) => onUpdate("unit_price", event.target.value)}
            onBlur={(event) => onUpdate("unit_price", formatUsd(event.currentTarget.value))}
            onFocus={(event) => event.currentTarget.select()}
          />
        </Cell>
        <Cell label="Due">
          <input
            data-focus={`due-line-${index}`}
            className="cell-input font-mono tabular-nums"
            type="date"
            value={item.due_date}
            disabled={fieldsDisabled}
            aria-label="Due date"
            onChange={(event) => onUpdate("due_date", event.target.value)}
          />
        </Cell>
        <div className="col-span-2 flex min-w-0 flex-wrap items-end gap-x-2 gap-y-1 @[640px]:col-span-1">
          {line?.erp_job_number ? (
            <Link
              className="pb-1 font-mono text-xs font-semibold text-accent hover:underline"
              to={`/jobs/${encodeURIComponent(line.erp_job_number)}`}
              state={{ from: "po-review", poId: po.id }}
            >
              {line.erp_job_number}
            </Link>
          ) : null}
          <SkPartChip line={line} poId={po.id} variant="check" disabled={skDisabled} onClick={onToggleMatcher} />
        </div>
        <label className="flex items-end gap-1.5 pb-1 text-xs text-muted">
          {line ? <CertCheckbox po={po} line={line} disabled={skDisabled} onRun={onRun} /> : <input type="checkbox" disabled />}
          Cert
        </label>
        <div className="flex items-end justify-end gap-1">
          {confirmed && line && onAskPrint ? (
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
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className={cn("h-7 w-7", notesOpen && "text-accent")}
            aria-label="Line notes"
            onClick={onToggleNotes}
          >
            <MessageSquareText className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 hover:text-red-700"
            disabled={fieldsDisabled || created}
            aria-label="Delete line"
            onClick={onRemove}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      {unsaved ? <p className="text-xs text-muted">Not saved yet</p> : null}
      {notesOpen ? (
        <div className="flex items-center gap-2">
          <span className="field-label shrink-0">Notes</span>
          <input
            className="cell-input"
            value={item.notes}
            disabled={fieldsDisabled}
            placeholder="Line notes"
            aria-label="Notes"
            onChange={(event) => onUpdate("notes", event.target.value)}
          />
        </div>
      ) : null}
      {matcherOpen && !creating ? (
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
    </div>
  );
}

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="min-w-0 space-y-0.5">
      <span className="field-label">{label}</span>
      {children}
    </label>
  );
}
