import { todayIso } from "@/lib/utils";
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
  const line = po.line_items.find((row) => {
    if (row.erp_status === "created") return false;
    if (row.erp_status === "skipped") return true;
    return (
      row.erp_status !== "ready" ||
      (row.customer_credit_hold && !row.credit_hold_acknowledged) ||
      (row.duplicate_job_numbers.length > 0 && !row.duplicate_acknowledged)
    );
  });
  return line?.id ?? null;
}
