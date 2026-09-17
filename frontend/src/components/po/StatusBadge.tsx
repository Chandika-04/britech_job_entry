import { Badge } from "@/components/ui/badge";
import type { PoStatus, ReviewState } from "@/types/po";

export function StatusBadge({ status }: { status: PoStatus }) {
  const label = status === "pending" ? "Extracting" : status;
  return <Badge variant={status}>{label}</Badge>;
}

export function ReviewBadge({ state }: { state: ReviewState }) {
  return <Badge variant={state}>{state === "confirmed" ? "Confirmed" : "Unreviewed"}</Badge>;
}
