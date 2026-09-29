import { AlertTriangle } from "lucide-react";

import type { WarningItem } from "@/types/po";
import { cn } from "@/lib/utils";

export function WarningsBanner({ warnings }: { warnings: WarningItem[] }) {
  if (!warnings.length) return null;
  const prominent = warnings.some((item) => item.severity === "prominent" || item.code.includes("duplicate"));
  return (
    <div
      className={cn(
        "rounded-lg border border-l-4 bg-amber-50 px-3 py-2 text-[13px] text-amber-950",
        prominent ? "border-amber-300 border-l-amber-500" : "border-amber-200 border-l-amber-400",
      )}
    >
      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-[0.06em] text-amber-800">
        <AlertTriangle className="h-3.5 w-3.5" />
        Review warnings · {warnings.length}
      </div>
      <ul className="mt-1 space-y-0.5">
        {warnings.map((warning, index) => (
          <li key={`${warning.code}-${index}`} className={cn(warning.severity === "prominent" && "font-semibold")}>
            {warning.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
