import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import type { CreatePrintResult, LineItem, PoDetail } from "@/types/po";

/** Something that stopped a line's job from being created, shown as a popup. */
export type CreateIssue =
  | { kind: "duplicate"; lineLabel: string; jobs: string[]; batch: boolean }
  | { kind: "error"; lineLabel: string; message: string; batch: boolean };

export type IssueChoice = "create_anyway" | "skip_line" | "continue" | "stop";

export type AskIssue = (issue: CreateIssue) => Promise<IssueChoice>;

export type CreateOutcome =
  | { outcome: "created"; po: PoDetail; result: CreatePrintResult }
  | { outcome: "created_no_reply"; po: PoDetail; jobNumber: string }
  | { outcome: "skipped" | "stopped"; po: PoDetail }
  | { outcome: "failed"; po: PoDetail; message: string };

function lineLabel(line: LineItem): string {
  return `Line ${line.line_number ?? line.id}`;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : "ShopKeeper request failed.";
}

/**
 * Create one line's job. When ShopKeeper already has a job for this customer, PO and part, ask like
 * ShopKeeper does (Create anyway / Skip this line / Cancel) instead of just failing. In a batch, other
 * errors ask whether to carry on with the next line. Always returns the latest PO so the screen is current.
 */
export async function createLineJob(
  po: PoDetail,
  line: LineItem,
  create: (lineId: number) => Promise<CreatePrintResult>,
  askIssue: AskIssue,
  batch: boolean,
): Promise<CreateOutcome> {
  let firstError: unknown;
  try {
    const result = await create(line.id);
    return { outcome: "created", po: result.po, result };
  } catch (err) {
    firstError = err;
  }

  // The server saved what it learned (e.g. the duplicate job numbers); reload so we act on it.
  const latest = await api.getPo(po.id).catch(() => po);
  const current = latest.line_items.find((row) => row.id === line.id) ?? line;
  // The job was made but the reply never arrived (dropped connection, timeout): it was not a failure.
  if (current.erp_status === "created" && current.erp_job_number) {
    return { outcome: "created_no_reply", po: latest, jobNumber: current.erp_job_number };
  }
  const duplicate = current.duplicate_job_numbers.length > 0 && !current.duplicate_acknowledged;

  if (duplicate) {
    const choice = await askIssue({ kind: "duplicate", lineLabel: lineLabel(current), jobs: current.duplicate_job_numbers, batch });
    if (choice === "skip_line") {
      const skipped = await api.skipLine(po.id, line.id, "ShopKeeper already has a job for this customer, PO, and part.");
      return { outcome: "skipped", po: skipped };
    }
    if (choice !== "create_anyway") return { outcome: "stopped", po: latest };
    try {
      await api.acknowledgeDuplicate(po.id, line.id);
      const result = await create(line.id);
      return { outcome: "created", po: result.po, result };
    } catch (err) {
      const after = await api.getPo(po.id).catch(() => latest);
      const saved = after.line_items.find((row) => row.id === line.id);
      if (saved?.erp_status === "created" && saved.erp_job_number) {
        return { outcome: "created_no_reply", po: after, jobNumber: saved.erp_job_number };
      }
      return reportError(after, current, errorText(err), askIssue, batch);
    }
  }
  return reportError(latest, current, errorText(firstError), askIssue, batch);
}

async function reportError(
  po: PoDetail,
  line: LineItem,
  message: string,
  askIssue: AskIssue,
  batch: boolean,
): Promise<CreateOutcome> {
  if (!batch) return { outcome: "failed", po, message };
  const choice = await askIssue({ kind: "error", lineLabel: lineLabel(line), message, batch });
  return choice === "stop" ? { outcome: "stopped", po } : { outcome: "failed", po, message };
}

/** A promise-based popup for create problems. Render `dialog` once; call `ask` to show it. */
export function useCreateIssueDialog(): { ask: AskIssue; dialog: ReactNode } {
  const [issue, setIssue] = useState<CreateIssue | null>(null);
  const resolver = useRef<((choice: IssueChoice) => void) | null>(null);

  const ask: AskIssue = (next) =>
    new Promise<IssueChoice>((resolve) => {
      resolver.current = resolve;
      setIssue(next);
    });

  const choose = (choice: IssueChoice) => {
    resolver.current?.(choice);
    resolver.current = null;
    setIssue(null);
  };

  const dialog = issue
    ? createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md space-y-3 rounded-lg border border-rule bg-white p-4 shadow-lg">
            {issue.kind === "duplicate" ? (
              <>
                <h3 className="text-sm font-semibold">{issue.lineLabel}: possible duplicate</h3>
                <p className="text-sm">
                  ShopKeeper already has job{issue.jobs.length > 1 ? "s" : ""}{" "}
                  <span className="font-mono font-semibold">{issue.jobs.join(", ")}</span> for this customer, PO number,
                  and part. Create another job anyway?
                </p>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="outline" onClick={() => choose("stop")}>
                    {issue.batch ? "Stop creating" : "Cancel"}
                  </Button>
                  <Button variant="outline" onClick={() => choose("skip_line")}>
                    Skip this line
                  </Button>
                  <Button autoFocus onClick={() => choose("create_anyway")}>
                    Create anyway
                  </Button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-sm font-semibold">{issue.lineLabel} was not created</h3>
                <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{issue.message}</p>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="outline" onClick={() => choose("stop")}>
                    Stop creating
                  </Button>
                  <Button autoFocus onClick={() => choose("continue")}>
                    Continue with the next line
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body,
      )
    : null;

  return { ask, dialog };
}
