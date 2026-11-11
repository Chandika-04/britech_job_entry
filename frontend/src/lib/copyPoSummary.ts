import { formatUsd, lineTotal } from "@/lib/utils";
import type { LineItemDraft, ShopKeeperJobRow } from "@/types/po";

export type PoSummaryCopyRow = {
  line: string;
  part: string;
  rev: string;
  qty: string;
  unit: string;
  unitPrice: string;
  ext: string;
};

type Column = { key: keyof PoSummaryCopyRow; label: string; align: "left" | "right" };

// One list drives the header and every row, so a header always sits over its own values.
const COLUMNS: Column[] = [
  { key: "line", label: "Line", align: "right" },
  { key: "part", label: "Part", align: "left" },
  { key: "rev", label: "Rev", align: "left" },
  { key: "qty", label: "Qty", align: "right" },
  { key: "unit", label: "Unit", align: "left" },
  { key: "unitPrice", label: "Unit price", align: "right" },
  { key: "ext", label: "Ext", align: "right" },
];

export function rowsFromDraft(items: LineItemDraft[]): PoSummaryCopyRow[] {
  return items.map((item, index) => ({
    line: item.line_number.trim() || String(index + 1),
    part: item.customer_part_number.trim(),
    rev: item.revision.trim(),
    qty: item.quantity.trim(),
    unit: (item.uom || "").trim(),
    unitPrice: formatUsd(item.unit_price) || item.unit_price.trim(),
    ext: lineTotal(item.quantity, item.uom, item.unit_price),
  }));
}

function lineSortKey(value: string | null): number {
  const parsed = Number.parseFloat(value ?? "");
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

// PO line order (1, 2, 10 — numeric, not text); lines with no number go last. Ties keep job-number order.
export function sortJobsByLine(jobs: ShopKeeperJobRow[]): ShopKeeperJobRow[] {
  return [...jobs].sort(
    (a, b) =>
      lineSortKey(a.po_line) - lineSortKey(b.po_line) ||
      a.job_number.localeCompare(b.job_number, undefined, { numeric: true }),
  );
}

export function rowsFromJobs(jobs: ShopKeeperJobRow[]): PoSummaryCopyRow[] {
  return sortJobsByLine(jobs)
    .map((job) => {
      const qty = job.quantity == null ? "" : String(job.quantity);
      const price = job.unit_price ?? "";
      return {
        line: (job.po_line || "").trim(),
        part: job.part_number,
        rev: job.part_revision,
        qty,
        unit: (job.unit || "").trim(),
        unitPrice: formatUsd(price),
        ext: price ? lineTotal(qty, job.unit, price) : "",
      };
    });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

const CELL_STYLE = "border:1px solid #bfbfbf;padding:3px 8px;font-family:Calibri,Arial,sans-serif;font-size:11pt;";

function htmlCell(tag: "th" | "td", value: string, align: Column["align"]): string {
  const weight = tag === "th" ? "font-weight:bold;background:#f2f2f2;" : "";
  return `<${tag} style="${CELL_STYLE}${weight}text-align:${align};white-space:nowrap;">${escapeHtml(value) || "&nbsp;"}</${tag}>`;
}

export function poSummaryTableHtml(rows: PoSummaryCopyRow[]): string {
  const header = COLUMNS.map((column) => htmlCell("th", column.label, column.align)).join("");
  const body = rows
    .map((row) => `<tr>${COLUMNS.map((column) => htmlCell("td", row[column.key], column.align)).join("")}</tr>`)
    .join("");
  return `<table style="border-collapse:collapse;"><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>`;
}

// Plain-text version for places that drop the HTML table: pad every column to its widest
// value so the headers line up over the data in a fixed-width font.
export function poSummaryPlainText(rows: PoSummaryCopyRow[]): string {
  const widths = COLUMNS.map((column) =>
    Math.max(column.label.length, ...rows.map((row) => row[column.key].length)),
  );
  const format = (values: string[]) =>
    values
      .map((value, index) =>
        COLUMNS[index].align === "right" ? value.padStart(widths[index]) : value.padEnd(widths[index]),
      )
      .join("  ")
      .trimEnd();
  const header = format(COLUMNS.map((column) => column.label));
  const rule = widths.map((width) => "-".repeat(width)).join("  ");
  const lines = rows.map((row) => format(COLUMNS.map((column) => row[column.key])));
  return [header, rule, ...lines].join("\n");
}

function fallbackCopyHtml(html: string): boolean {
  const el = document.createElement("div");
  el.setAttribute("contenteditable", "true");
  el.style.position = "fixed";
  el.style.left = "-9999px";
  el.innerHTML = html;
  document.body.appendChild(el);
  const range = document.createRange();
  range.selectNodeContents(el);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  selection?.removeAllRanges();
  document.body.removeChild(el);
  return ok;
}

export async function copyPoSummary(rows: PoSummaryCopyRow[]): Promise<void> {
  const html = poSummaryTableHtml(rows);
  const text = poSummaryPlainText(rows);
  try {
    if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
      return;
    }
  } catch {
    /* fall through to execCommand */
  }
  if (!fallbackCopyHtml(html)) {
    throw new Error("Could not copy.");
  }
}
