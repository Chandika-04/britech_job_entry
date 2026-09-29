import { Badge } from "@/components/ui/badge";
import type { ErpStatus, PoStatus, ReviewState } from "@/types/po";

export function StatusBadge({ status }: { status: PoStatus }) {
  const label = status === "pending" ? "Extracting" : status;
  return <Badge variant={status}>{label}</Badge>;
}

export function ReviewBadge({ state }: { state: ReviewState }) {
  return <Badge variant={state}>{state === "confirmed" ? "Confirmed" : "Unreviewed"}</Badge>;
}

export function JobsBadge({ complete }: { complete: boolean }) {
  return <Badge variant={complete ? "created" : "muted"}>{complete ? "Complete" : "Incomplete"}</Badge>;
}

const ERP_LABELS: Record<ErpStatus, string> = {
  pending: "Needs match",
  ready: "Ready",
  creating: "Creating",
  created: "Created",
  failed: "Failed",
  skipped: "Skipped",
};

export function ErpBadge({ status }: { status: ErpStatus }) {
  const variant = status === "pending" ? "unreviewed" : status;
  return <Badge variant={variant}>{ERP_LABELS[status]}</Badge>;
}
