import { cn } from "@/lib/utils";
import type { LineItem } from "@/types/po";

export function SkPartChip({
  line,
  variant,
  onClick,
  disabled,
}: {
  line?: LineItem;
  poId: number;
  variant: "check" | "job";
  onClick?: () => void;
  disabled?: boolean;
}) {
  if (variant === "check" && line?.erp_status === "creating") {
    return <span className="text-xs text-muted">Creating…</span>;
  }
  if (line?.resolved_part_number) {
    const rev = line.resolved_part_revision ? ` rev ${line.resolved_part_revision}` : "";
    const label = variant === "job" ? `✓ SK: ${line.resolved_part_number}${rev}` : `✓ SK ${line.resolved_part_number}${rev}`;
    return (
      <button
        type="button"
        className={cn(
          "truncate text-left text-xs font-semibold text-emerald-800 hover:underline",
          disabled && "no-underline opacity-70",
        )}
        disabled={disabled}
        onClick={onClick}
      >
        {label}
      </button>
    );
  }
  return (
    <button
      type="button"
      className={cn("text-xs text-muted hover:text-accent hover:underline", disabled && "no-underline")}
      disabled={disabled}
      onClick={onClick}
    >
      {variant === "job" ? "Not matched" : "Match part"}
    </button>
  );
}
