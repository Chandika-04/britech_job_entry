import { Fragment, useState, type ReactNode } from "react";
import { MessageSquareText, Plus, Trash2 } from "lucide-react";

import { PartMatchSection } from "@/components/po/PartMatch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn, focusNextEmpty, formatUsd } from "@/lib/utils";
import type { LineItem, LineItemDraft, PartCandidate, PoDetail, PoDraft } from "@/types/po";

const UNITS = ["Each", "Lot"] as const;

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function emptyLine(index: number): LineItemDraft {
  return {
    line_number: String(index),
    customer_part_number: "",
    revision: "",
    description: "",
    quantity: "",
    unit_price: "",
    uom: "Each",
    due_date: todayIso(),
    notes: "",
  };
}

interface Props {
  draft: PoDraft;
  onChange: (draft: PoDraft) => void;
  disabled?: boolean;
  po?: PoDetail;
  onUsePart?: (index: number, part: PartCandidate) => void | Promise<void>;
}

type UpdateItem = (index: number, field: keyof LineItemDraft, value: string) => void;

export function LineItemsEditor({ draft, onChange, disabled, po, onUsePart }: Props) {
  const updateItem: UpdateItem = (index, field, value) => {
    const line_items = draft.line_items.map((item, itemIndex) =>
      itemIndex === index ? { ...item, [field]: value } : item,
    );
    onChange({ ...draft, line_items });
  };

  const addItem = () => {
    onChange({
      ...draft,
      line_items: [...draft.line_items, emptyLine(draft.line_items.length + 1)],
    });
  };

  const removeItem = (index: number) => {
    onChange({
      ...draft,
      line_items: draft.line_items.filter((_, itemIndex) => itemIndex !== index),
    });
  };

  return (
    <div>
      {draft.line_items.length === 0 ? (
        <p className="px-4 py-6 text-[13px] text-muted">No line items yet.</p>
      ) : (
        <>
          <LineItemsTable
            items={draft.line_items}
            disabled={disabled}
            po={po}
            onUpdate={updateItem}
            onRemove={removeItem}
            onUsePart={onUsePart}
          />
          <LineItemsStack
            items={draft.line_items}
            disabled={disabled}
            po={po}
            onUpdate={updateItem}
            onRemove={removeItem}
            onUsePart={onUsePart}
          />
        </>
      )}
      <div className="border-t border-rule-soft px-4 py-2">
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={addItem}>
          <Plus className="h-3.5 w-3.5" />
          Add line
        </Button>
      </div>
    </div>
  );
}

interface ListProps {
  items: LineItemDraft[];
  disabled?: boolean;
  po?: PoDetail;
  onUpdate: UpdateItem;
  onRemove: (index: number) => void;
  onUsePart?: (index: number, part: PartCandidate) => void | Promise<void>;
}

function lineForItem(po: PoDetail | undefined, item: LineItemDraft): LineItem | undefined {
  return item.id != null ? po?.line_items.find((row) => row.id === item.id) : undefined;
}

function LinePartMatch({
  item,
  index,
  line,
  disabled,
  onUsePart,
}: {
  item: LineItemDraft;
  index: number;
  line?: LineItem;
  disabled?: boolean;
  onUsePart?: (index: number, part: PartCandidate) => void | Promise<void>;
}) {
  if (!onUsePart) return null;
  const locked = line?.erp_status === "created" || line?.erp_status === "creating";
  return (
    <PartMatchSection
      initialPartNumber={item.customer_part_number}
      initialRevision={item.revision}
      selectedPartNumber={line?.resolved_part_number}
      selectedRevision={line?.resolved_part_revision}
      selectedPmLinkId={line?.resolved_pm_linkid}
      disabled={disabled || locked}
      lineIndex={index}
      onUse={(part) => onUsePart(index, part)}
      onAfterUse={() => focusNextEmpty([`qty-line-${index}`, `price-line-${index}`, `due-line-${index}`])}
    />
  );
}

function LineItemsTable({ items, disabled, po, onUpdate, onRemove, onUsePart }: ListProps) {
  const [openNotes, setOpenNotes] = useState<Set<number>>(new Set());

  const toggleNotes = (index: number) => {
    setOpenNotes((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  return (
    <div className="hidden overflow-x-auto md:block">
      <table className="data-table dense">
        <thead>
          <tr>
            <th className="w-12">Ln</th>
            <th className="w-48">Part #</th>
            <th className="w-16">Rev</th>
            <th>Description</th>
            <th className="num w-20">Qty</th>
            <th className="w-20">Unit</th>
            <th className="num w-28">Unit price</th>
            <th className="w-36">Due</th>
            <th className="w-16" aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => {
            const notesOpen = openNotes.has(index) || Boolean(item.notes);
            const continued = notesOpen || Boolean(onUsePart);
            return (
              <Fragment key={item.id ?? `new-${index}`}>
                <tr className={cn("hover:bg-head", continued && "[&>td]:border-b-0")}>
                  <td>
                    <input
                      className="cell-input font-mono tabular-nums"
                      inputMode="numeric"
                      value={item.line_number}
                      disabled={disabled}
                      aria-label="Line number"
                      onChange={(event) => onUpdate(index, "line_number", event.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className="cell-input font-mono"
                      value={item.customer_part_number}
                      disabled={disabled}
                      aria-label="Customer part number"
                      onChange={(event) => onUpdate(index, "customer_part_number", event.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className="cell-input font-mono"
                      value={item.revision}
                      disabled={disabled}
                      aria-label="Revision"
                      onChange={(event) => onUpdate(index, "revision", event.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className="cell-input"
                      value={item.description}
                      disabled={disabled}
                      aria-label="Description"
                      onChange={(event) => onUpdate(index, "description", event.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      data-focus={`qty-line-${index}`}
                      className="cell-input text-right font-mono tabular-nums"
                      inputMode="decimal"
                      value={item.quantity}
                      disabled={disabled}
                      aria-label="Quantity"
                      onChange={(event) => onUpdate(index, "quantity", event.target.value)}
                    />
                  </td>
                  <td>
                    <select
                      className="cell-input"
                      value={item.uom}
                      disabled={disabled}
                      aria-label="Unit"
                      onChange={(event) => onUpdate(index, "uom", event.target.value)}
                    >
                      {UNITS.map((unit) => (
                        <option key={unit} value={unit}>
                          {unit}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      data-focus={`price-line-${index}`}
                      data-money="usd"
                      className="cell-input text-right font-mono tabular-nums"
                      inputMode="decimal"
                      value={item.unit_price}
                      disabled={disabled}
                      aria-label="Unit price"
                      onChange={(event) => onUpdate(index, "unit_price", event.target.value)}
                      onBlur={(event) => onUpdate(index, "unit_price", formatUsd(event.currentTarget.value))}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                  </td>
                  <td>
                    <input
                      data-focus={`due-line-${index}`}
                      className="cell-input font-mono tabular-nums"
                      type="date"
                      value={item.due_date}
                      disabled={disabled}
                      aria-label="Due date"
                      onChange={(event) => onUpdate(index, "due_date", event.target.value)}
                    />
                  </td>
                  <td>
                    <div className="flex justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className={cn("h-7 w-7 md:h-7 md:w-7", notesOpen && "text-accent")}
                        aria-label="Line notes"
                        onClick={() => toggleNotes(index)}
                      >
                        <MessageSquareText className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 hover:text-red-700 md:h-7 md:w-7"
                        disabled={disabled}
                        aria-label="Delete line"
                        onClick={() => onRemove(index)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
                {notesOpen ? (
                  <tr>
                    <td />
                    <td colSpan={8}>
                      <div className="flex items-center gap-2 pb-1">
                        <span className="field-label shrink-0">Notes</span>
                        <input
                          className="cell-input"
                          value={item.notes}
                          disabled={disabled}
                          placeholder="Line notes"
                          aria-label="Notes"
                          onChange={(event) => onUpdate(index, "notes", event.target.value)}
                        />
                      </div>
                    </td>
                  </tr>
                ) : null}
                {onUsePart ? (
                  <tr>
                    <td />
                    <td colSpan={8} className="pb-2">
                      <LinePartMatch
                        item={item}
                        index={index}
                        line={lineForItem(po, item)}
                        disabled={disabled}
                        onUsePart={onUsePart}
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

function LineItemsStack({ items, disabled, po, onUpdate, onRemove, onUsePart }: ListProps) {
  return (
    <div className="divide-y divide-rule-soft md:hidden">
      {items.map((item, index) => (
        <div key={item.id ?? `new-${index}`} className="space-y-2.5 px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <span className="section-label">Line {item.line_number || index + 1}</span>
            <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => onRemove(index)}>
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <MobileField label="Line #">
              <Input inputMode="numeric" value={item.line_number} disabled={disabled} onChange={(event) => onUpdate(index, "line_number", event.target.value)} />
            </MobileField>
            <MobileField label="Part #">
              <Input value={item.customer_part_number} disabled={disabled} onChange={(event) => onUpdate(index, "customer_part_number", event.target.value)} />
            </MobileField>
            <MobileField label="Rev">
              <Input value={item.revision} disabled={disabled} onChange={(event) => onUpdate(index, "revision", event.target.value)} />
            </MobileField>
            <MobileField label="Unit">
              <select
                className="h-10 w-full rounded-md border border-rule bg-white px-2.5 text-sm text-ink focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/15 disabled:bg-head disabled:text-muted"
                value={item.uom}
                disabled={disabled}
                onChange={(event) => onUpdate(index, "uom", event.target.value)}
              >
                {UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
            </MobileField>
            <MobileField label="Description" wide>
              <Input value={item.description} disabled={disabled} onChange={(event) => onUpdate(index, "description", event.target.value)} />
            </MobileField>
            <MobileField label="Qty">
              <Input data-focus={`qty-line-${index}`} inputMode="decimal" value={item.quantity} disabled={disabled} onChange={(event) => onUpdate(index, "quantity", event.target.value)} />
            </MobileField>
            <MobileField label="Unit price">
              <Input
                data-focus={`price-line-${index}`}
                data-money="usd"
                inputMode="decimal"
                value={item.unit_price}
                disabled={disabled}
                onChange={(event) => onUpdate(index, "unit_price", event.target.value)}
                onBlur={(event) => onUpdate(index, "unit_price", formatUsd(event.currentTarget.value))}
                onFocus={(event) => event.currentTarget.select()}
              />
            </MobileField>
            <MobileField label="Due" wide>
              <Input data-focus={`due-line-${index}`} type="date" value={item.due_date} disabled={disabled} onChange={(event) => onUpdate(index, "due_date", event.target.value)} />
            </MobileField>
            <MobileField label="Notes" wide>
              <Textarea value={item.notes} disabled={disabled} onChange={(event) => onUpdate(index, "notes", event.target.value)} />
            </MobileField>
          </div>
          <LinePartMatch
            item={item}
            index={index}
            line={lineForItem(po, item)}
            disabled={disabled}
            onUsePart={onUsePart}
          />
        </div>
      ))}
    </div>
  );
}

function MobileField({ label, wide, children }: { label: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={cn("space-y-1", wide && "col-span-2")}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
