import { Calendar, ChevronDown, ChevronRight } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";

import { CertCheckbox, type RunLine } from "@/components/po/lines/actions";
import { LineDetailsBody } from "@/components/po/lines/LineDetailsRow";
import { isLineLocked, lineForItem, lineKey, lineStatus } from "@/components/po/lines/helpers";
import { Badge } from "@/components/ui/badge";
import { cn, formatDueDisplay, formatUsd, parseDueInput } from "@/lib/utils";
import type { LineItem, LineItemDraft, PartCandidate, PoDetail, PoDraft } from "@/types/po";

const COL_COUNT = 14;
const TEXT_COLS = [1, 2, 3, 4, 5, 7, 8];

export function LinesGrid({
  po,
  draft,
  disabled,
  confirmed,
  skStatus,
  previewReady,
  highlightedIndex,
  openIndex,
  matcherIndex,
  remountMatcher,
  saveTick,
  stacked,
  onHighlight,
  onToggleOpen,
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
  po: PoDetail;
  draft: PoDraft;
  disabled?: boolean;
  confirmed: boolean;
  skStatus: Record<string, string>;
  previewReady?: boolean;
  highlightedIndex: number | null;
  openIndex: number | null;
  matcherIndex: number | null;
  remountMatcher?: string | number;
  saveTick?: number;
  stacked?: boolean;
  onHighlight: (index: number) => void;
  onToggleOpen: (index: number) => void;
  onToggleMatcher: (index: number) => void;
  onUpdate: (index: number, field: keyof LineItemDraft, value: string) => void;
  onUsePart: (index: number, part: PartCandidate) => void | Promise<void>;
  onBeforeCreatePart?: () => Promise<boolean>;
  onRun: RunLine;
  onError?: (message: string) => void;
  onNotice?: (message: string) => void;
  onAskPrint: (jobNumber: string, certAvailable: boolean) => Promise<void>;
  onSave: () => Promise<boolean>;
  onChangePo?: (po: PoDetail) => void;
}) {
  const tableRef = useRef<HTMLTableElement>(null);
  const partColRef = useRef<HTMLTableColElement>(null);
  const dueColRef = useRef<HTMLTableColElement>(null);
  const skPartColRef = useRef<HTMLTableColElement>(null);
  const openRowRef = useRef<HTMLTableRowElement | null>(null);
  const openDetailsRef = useRef<HTMLTableRowElement | null>(null);
  const mobileOpenRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = stacked ? mobileOpenRef.current : openDetailsRef.current || openRowRef.current;
    node?.scrollIntoView({ block: "nearest" });
  }, [openIndex, stacked]);

  useLayoutEffect(() => {
    if (stacked) return;
    const table = tableRef.current;
    if (!table) return;
    const size = () => {
      fitCol(partColRef.current, table, '[data-col="2"] input', 128);
      fitCol(dueColRef.current, table, '[data-col="8"] input[aria-label="Due date"]', 84);
      fitCol(skPartColRef.current, table, '[data-col="9"] .sk-part', 96);
    };
    size();
    const frame = requestAnimationFrame(size);
    void document.fonts?.ready.then(size);
    return () => cancelAnimationFrame(frame);
  }, [draft.line_items, po.line_items, stacked]);

  const onTableKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    const origin = event.target;
    if (!(origin instanceof HTMLElement)) return;
    const row = origin.closest("tr[data-row]");
    if (!row) return;
    const rowIndex = Number(row.getAttribute("data-row"));
    if (Number.isNaN(rowIndex)) return;

    if (event.key === "Enter" && !event.ctrlKey && !event.metaKey && !(origin instanceof HTMLTextAreaElement)) {
      if (origin instanceof HTMLInputElement && origin.type === "checkbox") return;
      event.preventDefault();
      onToggleOpen(rowIndex);
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const delta = event.key === "ArrowUp" ? -1 : 1;
      const next = rowIndex + delta;
      if (next < 0 || next >= draft.line_items.length) return;
      const col = Number(origin.closest("[data-col]")?.getAttribute("data-col") ?? 0);
      onHighlight(next);
      focusCell(tableRef.current, next, col);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      handleHorizontal(event, origin, row, rowIndex);
    }
  };

  if (stacked) {
    return (
      <div className="divide-y divide-rule-soft">
        {draft.line_items.map((item, index) => {
          const line = lineForItem(po, item);
          const open = openIndex === index;
          const status = lineStatus(item, line);
          const jobNo = line?.erp_job_number;
          const sk = jobNo ? skStatus[jobNo] : "";
          return (
            <div key={lineKey(item, index)} className="px-3 py-2" ref={open ? mobileOpenRef : undefined}>
              <button
                type="button"
                className={cn(
                  "flex w-full min-h-11 flex-col gap-1 rounded-md px-2 py-2 text-left",
                  open || highlightedIndex === index ? "bg-accent-soft" : "hover:bg-head",
                  previewReady && line?.erp_status === "ready" && "bg-emerald-50",
                )}
                aria-expanded={open}
                aria-label={`Line ${item.line_number || index + 1} details`}
                onClick={() => onToggleOpen(index)}
              >
                <div className="flex items-center gap-2">
                  {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
                  <span className="font-mono text-xs tabular-nums">{item.line_number || index + 1}</span>
                  <span className="break-all font-mono text-sm font-semibold">
                    {item.customer_part_number || "—"}
                    {item.revision ? <span className="font-normal text-muted"> {item.revision}</span> : null}
                  </span>
                  <Badge variant={status.variant} className="ml-auto">
                    {status.label}
                  </Badge>
                </div>
                <p className="pl-6 text-[13px] text-muted">{item.description || "No description"}</p>
                <p className="pl-6 font-mono text-xs text-muted">
                  {item.quantity || "—"} {item.uom || "Each"} · {item.due_date || "—"} · {item.unit_price || "—"}
                </p>
                {jobNo ? (
                  <p className="pl-6 font-mono text-xs">
                    Job {jobNo}
                    {sk ? ` · ${sk}` : ""}
                  </p>
                ) : null}
              </button>
              {open ? (
                <LineDetailsBody
                  item={item}
                  index={index}
                  line={line}
                  po={po}
                  disabled={disabled}
                  confirmed={confirmed}
                  matcherOpen={matcherIndex === index}
                  remountMatcher={matcherIndex === index ? remountMatcher : undefined}
                  stacked
                  saveTick={saveTick}
                  onToggleMatcher={() => onToggleMatcher(index)}
                  onUpdate={(field, value) => onUpdate(index, field, value)}
                  onUsePart={onUsePart}
                  onBeforeCreatePart={onBeforeCreatePart}
                  onRun={onRun}
                  onError={onError}
                  onNotice={onNotice}
                  onAskPrint={onAskPrint}
                  onSave={onSave}
                  onChangePo={onChangePo}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table ref={tableRef} className="lines-grid" onKeyDown={onTableKeyDown}>
        <colgroup>
          <col style={{ width: 24 }} />
          <col style={{ width: 34 }} />
          <col ref={partColRef} style={{ width: 128 }} />
          <col style={{ width: 36 }} />
          <col />
          <col style={{ width: 44 }} />
          <col style={{ width: 52 }} />
          <col style={{ width: 66 }} />
          <col ref={dueColRef} style={{ width: 84 }} />
          <col ref={skPartColRef} style={{ width: 96 }} />
          <col style={{ width: 32 }} />
          <col style={{ width: 60 }} />
          <col style={{ width: 40 }} />
          <col style={{ width: 92 }} />
        </colgroup>
        <thead>
          <tr>
            <th>
              <span className="sr-only">Details</span>
            </th>
            <th>Ln</th>
            <th>Customer part #</th>
            <th>Rev</th>
            <th>Description</th>
            <th className="text-right">Qty</th>
            <th>Unit</th>
            <th className="text-right">Price</th>
            <th>Due</th>
            <th className="sk-split">SK part</th>
            <th>Cert</th>
            <th>Job #</th>
            <th title="ShopKeeper ship-line status. S = shipped, I = invoiced, blank = not shipped.">SK</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {draft.line_items.map((item, index) => {
            const line = lineForItem(po, item);
            const open = openIndex === index;
            const highlighted = highlightedIndex === index || open;
            const creating = isLineLocked(line);
            const fieldsDisabled = disabled || creating;
            const unsaved = item.id == null;
            const status = lineStatus(item, line);
            const jobNo = line?.erp_job_number;
            const shipStatus = jobNo ? skStatus[jobNo] || "" : "";
            const poPrice = formatUsd(line?.unit_price);
            const priceChanged = Boolean(poPrice && item.unit_price && item.unit_price !== poPrice);
            const readyPreview = Boolean(previewReady && line?.erp_status === "ready");
            const skPart = skPartCell(item, line, creating);
            return (
              <Fragment key={lineKey(item, index)}>
                <tr
                  data-row={index}
                  ref={open ? openRowRef : undefined}
                  className={cn(index % 2 === 1 && "is-alt", highlighted && "is-highlighted", readyPreview && "is-ready-preview")}
                  onFocusCapture={() => onHighlight(index)}
                >
                  <td data-col={0}>
                    <button
                      type="button"
                      className="flex h-[22px] w-full items-center justify-center"
                      aria-expanded={open}
                      aria-label={`Line ${item.line_number || index + 1} details`}
                      onClick={() => onToggleOpen(index)}
                    >
                      {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                    </button>
                  </td>
                  <td data-col={1}>
                    <input
                      className="cell-input text-center font-mono tabular-nums"
                      inputMode="numeric"
                      value={item.line_number}
                      disabled={fieldsDisabled}
                      aria-label="Line number"
                      onChange={(event) => onUpdate(index, "line_number", event.target.value)}
                    />
                  </td>
                  <td data-col={2}>
                    <input
                      className="cell-input font-mono"
                      value={item.customer_part_number}
                      disabled={fieldsDisabled}
                      aria-label="Customer part number"
                      onChange={(event) => onUpdate(index, "customer_part_number", event.target.value)}
                    />
                  </td>
                  <td data-col={3}>
                    <input
                      className="cell-input font-mono"
                      value={item.revision}
                      disabled={fieldsDisabled}
                      aria-label="Revision"
                      onChange={(event) => onUpdate(index, "revision", event.target.value)}
                    />
                  </td>
                  <td data-col={4}>
                    <input
                      className="cell-input"
                      value={item.description}
                      disabled={fieldsDisabled}
                      aria-label="Description"
                      title={item.description}
                      onChange={(event) => onUpdate(index, "description", event.target.value)}
                    />
                  </td>
                  <td data-col={5}>
                    <input
                      className="cell-input text-right font-mono tabular-nums"
                      inputMode="numeric"
                      value={item.quantity}
                      disabled={fieldsDisabled}
                      aria-label="Quantity"
                      onChange={(event) => onUpdate(index, "quantity", event.target.value)}
                    />
                  </td>
                  <td data-col={6}>
                    <div className="relative">
                      <select
                        className="cell-input appearance-none pr-3.5"
                        value={item.uom}
                        disabled={fieldsDisabled}
                        aria-label="Unit"
                        onChange={(event) => onUpdate(index, "uom", event.target.value)}
                      >
                        <option value="Each">EA</option>
                        <option value="Lot">LOT</option>
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-0.5 top-1/2 h-2.5 w-2.5 -translate-y-1/2 text-muted" />
                    </div>
                  </td>
                  <td data-col={7}>
                    <input
                      data-money="usd"
                      className={cn("cell-input text-right font-mono tabular-nums", priceChanged && "text-accent-text")}
                      inputMode="decimal"
                      value={item.unit_price}
                      disabled={fieldsDisabled}
                      aria-label="Unit price"
                      title={priceChanged && poPrice ? `Changed from ${poPrice} on the PO.` : undefined}
                      onChange={(event) => onUpdate(index, "unit_price", event.target.value)}
                      onBlur={(event) => onUpdate(index, "unit_price", formatUsd(event.currentTarget.value))}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                  </td>
                  <td data-col={8}>
                    <CompactDueCell
                      value={item.due_date}
                      disabled={fieldsDisabled}
                      onChange={(next) => onUpdate(index, "due_date", next)}
                    />
                  </td>
                  <td data-col={9} className="sk-split">
                    <span className={cn("sk-part", skPart.className)} title={skPart.title}>
                      {skPart.label}
                    </span>
                  </td>
                  <td data-col={10} className="text-center">
                    {line && !unsaved ? (
                      <CertCheckbox po={po} line={line} disabled={disabled || creating} onRun={onRun} />
                    ) : (
                      <input type="checkbox" disabled aria-label="Certificate of conformance" />
                    )}
                  </td>
                  <td data-col={11} className="font-mono">
                    {jobNo ? (
                      <Link
                        className="font-semibold text-accent hover:underline"
                        to={`/jobs/${encodeURIComponent(jobNo)}`}
                        state={{ from: "po-review", poId: po.id }}
                      >
                        {jobNo}
                      </Link>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                  <td data-col={12} className="font-mono">
                    {shipStatus || "—"}
                  </td>
                  <td data-col={13}>
                    <Badge variant={status.variant} className="px-1.5 py-px text-[11px] leading-none tracking-normal">
                      {status.label}
                    </Badge>
                  </td>
                </tr>
                {open ? (
                  <tr className="details-row" ref={openDetailsRef}>
                    <td colSpan={COL_COUNT}>
                      <LineDetailsBody
                        item={item}
                        index={index}
                        line={line}
                        po={po}
                        disabled={disabled}
                        confirmed={confirmed}
                        matcherOpen={matcherIndex === index}
                        remountMatcher={matcherIndex === index ? remountMatcher : undefined}
                        saveTick={saveTick}
                        onToggleMatcher={() => onToggleMatcher(index)}
                        onUpdate={(field, value) => onUpdate(index, field, value)}
                        onUsePart={onUsePart}
                        onBeforeCreatePart={onBeforeCreatePart}
                        onRun={onRun}
                        onError={onError}
                        onNotice={onNotice}
                        onAskPrint={onAskPrint}
                        onSave={onSave}
                        onChangePo={onChangePo}
                      />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function normPart(value: string | null | undefined): string {
  return (value || "").replace(/\s+/g, "").toLowerCase();
}

function skPartCell(item: LineItemDraft, line: LineItem | undefined, creating: boolean): { label: string; title: string; className: string } {
  if (creating) return { label: "Creating…", title: "", className: "text-muted" };
  if (!line?.resolved_part_number) return { label: "Not matched", title: "Not matched", className: "text-orange-700" };
  const full = `${line.resolved_part_number}${line.resolved_part_revision ? ` rev ${line.resolved_part_revision}` : ""}`;
  const same =
    normPart(line.resolved_part_number) === normPart(item.customer_part_number) &&
    normPart(line.resolved_part_revision) === normPart(item.revision);
  if (same) return { label: "✓ Same", title: full, className: "text-emerald-800" };
  return { label: `✓ ${line.resolved_part_number}`, title: full, className: "text-emerald-800" };
}

function fitCol(col: HTMLTableColElement | null, table: HTMLTableElement, selector: string, min: number) {
  if (!col) return;
  let max = min;
  table.querySelectorAll<HTMLElement>(selector).forEach((el) => {
    const overflow = Math.max(0, el.scrollWidth - el.clientWidth);
    const cell = el.closest("td");
    const cellW = cell ? cell.getBoundingClientRect().width : el.getBoundingClientRect().width;
    max = Math.max(max, Math.ceil(cellW + overflow + (overflow > 0 ? 2 : 0)));
  });
  col.style.width = `${max}px`;
}

function CompactDueCell({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled?: boolean;
  onChange: (next: string) => void;
}) {
  const [text, setText] = useState(() => formatDueDisplay(value));
  const [invalid, setInvalid] = useState(false);
  const pickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText(formatDueDisplay(value));
    setInvalid(false);
  }, [value]);

  const commit = (raw: string) => {
    const parsed = parseDueInput(raw);
    if (parsed === "") {
      setInvalid(false);
      onChange("");
      setText("");
      return;
    }
    if (!parsed) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    onChange(parsed);
    setText(formatDueDisplay(parsed));
  };

  return (
    <div className="group relative">
      <input
        className={cn(
          "cell-input font-mono tabular-nums group-hover:pr-5 group-focus-within:pr-5",
          invalid && "border-red-500",
        )}
        value={text}
        disabled={disabled}
        aria-label="Due date"
        title={invalid ? "Use MM/DD/YY" : text || undefined}
        onChange={(event) => {
          setText(event.target.value);
          setInvalid(false);
        }}
        onBlur={(event) => commit(event.currentTarget.value)}
      />
      <input
        ref={pickerRef}
        type="date"
        tabIndex={-1}
        className="pointer-events-none absolute h-0 w-0 opacity-0"
        value={value}
        disabled={disabled}
        aria-hidden
        onChange={(event) => {
          onChange(event.target.value);
          setText(formatDueDisplay(event.target.value));
          setInvalid(false);
        }}
      />
      <button
        type="button"
        className="absolute right-0 top-1/2 hidden h-5 w-5 -translate-y-1/2 items-center justify-center text-muted group-focus-within:flex group-hover:flex"
        aria-label="Open calendar"
        disabled={disabled}
        tabIndex={-1}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          try {
            pickerRef.current?.showPicker();
          } catch {
            pickerRef.current?.focus();
          }
        }}
      >
        <Calendar className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}

function handleHorizontal(event: KeyboardEvent<HTMLTableElement>, origin: HTMLElement, row: Element, _rowIndex: number) {
  const goingLeft = event.key === "ArrowLeft";
  if (origin instanceof HTMLInputElement || origin instanceof HTMLTextAreaElement) {
    const start = origin.selectionStart;
    const end = origin.selectionEnd;
    const value = origin.value ?? "";
    if (start == null || end == null) return;
    if (start !== end) return;
    if (goingLeft && start !== 0) return;
    if (!goingLeft && start !== value.length) return;
  } else if (!(origin instanceof HTMLButtonElement) && !(origin instanceof HTMLSelectElement)) {
    return;
  }
  event.preventDefault();
  const currentCol = Number(origin.closest("[data-col]")?.getAttribute("data-col") ?? 0);
  const nextCol = nextTextCol(currentCol, goingLeft);
  if (nextCol == null) return;
  const cell = row.querySelector(`[data-col="${nextCol}"]`);
  const input = cell?.querySelector<HTMLInputElement>("input:not([type=checkbox]), textarea");
  if (!input) return;
  input.focus();
  const pos = goingLeft ? input.value.length : 0;
  try {
    input.setSelectionRange(pos, pos);
  } catch {
    // date inputs may not support selection
  }
}

function nextTextCol(from: number, left: boolean): number | null {
  const ordered = left ? [...TEXT_COLS].reverse() : TEXT_COLS;
  const found = ordered.find((col) => (left ? col < from : col > from));
  return found ?? null;
}

function focusCell(table: HTMLTableElement | null, rowIndex: number, col: number) {
  const row = table?.querySelector(`tr[data-row="${rowIndex}"]`);
  if (!row) return;
  const cell = row.querySelector(`[data-col="${col}"]`);
  const focusable =
    cell?.querySelector<HTMLElement>("input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])") ??
    row.querySelector<HTMLElement>("button");
  if (!focusable) return;
  focusable.focus();
  if (focusable instanceof HTMLInputElement && focusable.type !== "checkbox" && focusable.type !== "date") {
    focusable.select();
  }
  row.scrollIntoView({ block: "nearest" });
}
