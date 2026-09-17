import { AlertTriangle } from "lucide-react";

import type { WarningItem } from "@/types/po";
import { cn } from "@/lib/utils";

export function WarningsBanner({ warnings }: { warnings: WarningItem[] }) {
  if (!warnings.length) return null;
  const prominent = warnings.some((item) => item.severity === "prominent" || item.code.includes("duplicate"));
  return (
    <div
      className={cn(
        "rounded-2xl border p-4",
        prominent ? "border-amber-400 bg-amber-50" : "border-amber-200 bg-amber-50/70",
      )}
    >
      <div className="mb-2 flex items-center gap-2 font-semibold text-amber-950">
        <AlertTriangle className="h-5 w-5" />
        Review warnings
      </div>
      <ul className="space-y-2 text-sm text-amber-950">
        {warnings.map((warning, index) => (
          <li
            key={`${warning.code}-${index}`}
            className={cn(warning.severity === "prominent" && "rounded-lg bg-amber-200/80 px-3 py-2 font-medium")}
          >
            {warning.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
