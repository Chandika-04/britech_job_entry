import { needsAttention } from "@/components/po/lines/actions";
import { formatUsd, todayIso } from "@/lib/utils";
import type { LineItem, LineItemDraft, PoDetail } from "@/types/po";

export const UNITS = ["Each", "Lot"] as const;

export type LineKey = number | string;

export function emptyLine(index: number): LineItemDraft {
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
    cert_required: false,
  };
}

export function lineKey(item: LineItemDraft, index: number): LineKey {
  return item.id ?? `new-${index}`;
}

export function lineForItem(po: PoDetail, item: LineItemDraft): LineItem | undefined {
  return item.id != null ? po.line_items.find((row) => row.id === item.id) : undefined;
}

export function poCustomerCode(po: PoDetail): string {
  return po.line_items.find((line) => line.resolved_customer_code)?.resolved_customer_code ?? "";
}

export function isLineLocked(line?: LineItem): boolean {
  return line?.erp_status === "creating";
}

export function isLineCreated(line?: LineItem): boolean {
  return line?.erp_status === "created";
}

export function lineFieldsDirty(item: LineItemDraft, line?: LineItem): boolean {
  if (!line) return true;
  const asText = (value: string | number | null | undefined) => (value == null ? "" : String(value));
  return (
    item.line_number !== asText(line.line_number) ||
    item.customer_part_number !== asText(line.customer_part_number) ||
    item.revision !== asText(line.revision) ||
    item.description !== asText(line.description) ||
    item.quantity !== asText(line.quantity) ||
    item.uom !== (line.uom === "Lot" ? "Lot" : "Each") ||
    item.due_date !== asText(line.due_date) ||
    item.notes !== asText(line.notes) ||
    (item.unit_price || "") !== formatUsd(line.unit_price)
  );
}

export function qtyDueLabel(item: LineItemDraft, line?: LineItem): string {
  const qty = item.quantity || (line?.quantity != null ? String(line.quantity) : "");
  const uom = (item.uom || line?.uom || "Each").toLowerCase() === "lot" ? "lot" : "ea";
  const due = item.due_date || line?.due_date || "";
  const left = qty ? `${qty} ${uom}` : "—";
  return due ? `${left} · ${due}` : left;
}

export function firstUnmatchedKey(po: PoDetail, items: LineItemDraft[]): LineKey | null {
  const index = items.findIndex((item) => {
    const line = lineForItem(po, item);
    return !line?.resolved_part_number;
  });
  if (index < 0) return null;
  return lineKey(items[index], index);
}

export function firstNeedsAttentionId(po: PoDetail): number | null {
  return po.line_items.find((row) => needsAttention(row))?.id ?? null;
}

export function firstNeedsAttentionIndex(po: PoDetail, items: LineItemDraft[]): number | null {
  const index = items.findIndex((item) => {
    const line = lineForItem(po, item);
    return line ? needsAttention(line) : false;
  });
  return index < 0 ? null : index;
}

export type LineStatusInfo = {
  label: string;
  variant: "unreviewed" | "extracted" | "warning" | "ready" | "created" | "skipped" | "failed" | "muted" | "creating";
};

export function lineStatus(item: LineItemDraft, line?: LineItem): LineStatusInfo {
  if (item.id == null) return { label: "Not saved yet", variant: "muted" };
  if (!line) return { label: "Not saved yet", variant: "muted" };
  if (line.erp_status === "creating") return { label: "Creating", variant: "creating" };
  if (line.erp_status === "created") return { label: "Created", variant: "created" };
  if (line.erp_status === "skipped") return { label: "Skipped", variant: "skipped" };
  if (line.erp_status === "failed" || line.erp_failure_reason) return { label: "Failed", variant: "failed" };
  if (line.customer_credit_hold && !line.credit_hold_acknowledged) return { label: "Credit hold", variant: "warning" };
  if (line.duplicate_job_numbers.length > 0 && !line.duplicate_acknowledged) {
    return { label: "Possible dup.", variant: "warning" };
  }
  if (!line.resolved_part_number) return { label: "Needs part", variant: "unreviewed" };
  if (line.erp_status === "ready") return { label: "Ready", variant: "created" };
  return { label: "Part matched", variant: "extracted" };
}
