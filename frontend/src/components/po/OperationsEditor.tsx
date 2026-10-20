import type { MouseEvent } from "react";

import { Button } from "@/components/ui/button";
import { handleEnterAdvance } from "@/lib/utils";
import type { OperationRow, WorkCenter } from "@/types/po";

function blankOp(seq: number): OperationRow {
  return {
    id: null,
    seq_num: seq,
    wc_code: "",
    description: "",
    note: "",
    run_time: 0,
    setup_time: 0,
    subcontract: false,
    process_code: "",
    process: null,
    fa: false,
    qty: 0,
    sched_days: 0,
    om_link: null,
    rowversion: null,
  };
}

function plainNote(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|p|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function focusCell(event: MouseEvent<HTMLTableCellElement>) {
  const target = event.target as HTMLElement;
  if (target.closest("input, select, textarea, button, label")) return;
  const field = event.currentTarget.querySelector("input, select, textarea") as HTMLElement | null;
  field?.focus();
}

export function OperationsEditor({
  operations,
  workCenters,
  disabled,
  onChange,
}: {
  operations: OperationRow[];
  workCenters: WorkCenter[];
  disabled?: boolean;
  onChange: (ops: OperationRow[]) => void;
}) {
  const update = (index: number, patch: Partial<OperationRow>) => {
    onChange(operations.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  };

  return (
    <div className="space-y-2" data-enter-form onKeyDown={handleEnterAdvance}>
      <div className="overflow-x-auto rounded-md border border-rule bg-white">
        <table className="data-table sheet">
          <thead>
            <tr>
              <th className="w-14">Seq</th>
              <th className="min-w-[11rem]">Work center</th>
              <th className="min-w-[10rem]">Description</th>
              <th className="min-w-[16rem]">Notes</th>
              <th className="w-16">Run</th>
              <th className="w-16">Setup</th>
              <th className="w-12">OSP</th>
              <th className="w-12">FA</th>
              <th className="w-20" />
            </tr>
          </thead>
          <tbody>
            {operations.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-3 py-4 text-sm text-muted">
                  No operations yet. Copy instructions from the part, copy a template, or add a step.
                </td>
              </tr>
            ) : (
              operations.map((op, index) => (
                <tr key={op.id ?? `new-${index}`}>
                  <td onClick={focusCell}>
                    <input
                      className="cell-input font-mono"
                      type="number"
                      disabled={disabled}
                      value={op.seq_num}
                      onChange={(event) => update(index, { seq_num: Number(event.target.value) })}
                    />
                  </td>
                  <td onClick={focusCell}>
                    <select
                      className="cell-input h-8 w-full"
                      disabled={disabled}
                      value={op.wc_code}
                      onChange={(event) => update(index, { wc_code: event.target.value })}
                    >
                      <option value="">Select…</option>
                      {workCenters.map((center) => (
                        <option key={center.code} value={center.code} disabled={center.inactive}>
                          {center.code}
                          {center.description ? ` — ${center.description}` : ""}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td onClick={focusCell}>
                    <input
                      className="cell-input"
                      disabled={disabled}
                      maxLength={33}
                      value={op.description || ""}
                      onChange={(event) => update(index, { description: event.target.value })}
                    />
                  </td>
                  <td onClick={focusCell}>
                    <textarea
                      className="cell-input min-h-8 resize-y py-1"
                      disabled={disabled}
                      rows={1}
                      value={plainNote(op.note)}
                      onChange={(event) => update(index, { note: event.target.value })}
                    />
                  </td>
                  <td onClick={focusCell}>
                    <input
                      className="cell-input font-mono"
                      type="number"
                      disabled={disabled}
                      value={op.run_time ?? 0}
                      onChange={(event) => update(index, { run_time: Number(event.target.value) })}
                    />
                  </td>
                  <td onClick={focusCell}>
                    <input
                      className="cell-input font-mono"
                      type="number"
                      disabled={disabled}
                      value={op.setup_time ?? 0}
                      onChange={(event) => update(index, { setup_time: Number(event.target.value) })}
                    />
                  </td>
                  <td className="text-center">
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={op.subcontract}
                      onChange={(event) => update(index, { subcontract: event.target.checked })}
                    />
                  </td>
                  <td className="text-center">
                    <input
                      type="checkbox"
                      disabled={disabled}
                      checked={op.fa}
                      onChange={(event) => update(index, { fa: event.target.checked })}
                    />
                  </td>
                  <td>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={disabled}
                      onClick={() => onChange(operations.filter((_, rowIndex) => rowIndex !== index))}
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled}
        onClick={() => {
          const last = operations[operations.length - 1];
          onChange([...operations, blankOp((last?.seq_num || 0) + 10)]);
        }}
      >
        Add operation
      </Button>
    </div>
  );
}
