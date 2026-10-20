import { Badge } from "@/components/ui/badge";
import type { ErpStatus, PoSource, PoStatus, ReviewState } from "@/types/po";

export function StatusBadge({ status, source }: { status: PoStatus; source?: PoSource }) {
  if (source === "manual") {
    return <Badge variant="extracted">Typed in</Badge>;
  }
  const label =
    status === "pending" ? "Reading PDF" : status === "extracted" ? "Ready to check" : status === "failed" ? "Couldn't read" : status;
  return <Badge variant={status}>{label}</Badge>;
}

export function ReviewBadge({ state }: { state: ReviewState }) {
  return <Badge variant={state}>{state === "confirmed" ? "Checked" : "Needs check"}</Badge>;
}

export function JobsBadge({ complete }: { complete: boolean }) {
  return <Badge variant={complete ? "created" : "muted"}>{complete ? "Jobs done" : "Jobs open"}</Badge>;
}

const ERP_LABELS: Record<ErpStatus, string> = {
  pending: "Match needed",
  ready: "Ready to create",
  creating: "Creating",
  created: "Job made",
  failed: "Failed",
  skipped: "Skipped",
};

export function ErpBadge({ status }: { status: ErpStatus }) {
  const variant = status === "pending" ? "unreviewed" : status;
  return <Badge variant={variant}>{ERP_LABELS[status]}</Badge>;
}
