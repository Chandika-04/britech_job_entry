import { useEffect, useRef, useState } from "react";
import { Copy } from "lucide-react";

import { copyPoSummary, type PoSummaryCopyRow } from "@/lib/copyPoSummary";
import { Button } from "@/components/ui/button";

type CopyState = "idle" | "copied" | "failed";

const LABELS: Record<CopyState, string> = {
  idle: "Copy PO summary",
  copied: "Copied",
  failed: "Couldn't copy",
};

export function CopyPoSummaryButton({ rows, disabled }: { rows: PoSummaryCopyRow[]; disabled?: boolean }) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const show = (next: CopyState, ms: number) => {
    window.clearTimeout(timer.current);
    setState(next);
    timer.current = window.setTimeout(() => setState("idle"), ms);
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled || rows.length === 0}
      className={state === "failed" ? "border-red-300 text-red-700" : undefined}
      title={state === "failed" ? "The browser blocked the copy. Try again, or select the lines and copy them by hand." : undefined}
      onClick={() => {
        copyPoSummary(rows)
          .then(() => show("copied", 2000))
          .catch(() => show("failed", 4000));
      }}
    >
      <Copy className="h-3.5 w-3.5" />
      {LABELS[state]}
    </Button>
  );
}
