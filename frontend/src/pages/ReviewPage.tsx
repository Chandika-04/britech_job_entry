import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { api } from "@/api/client";
import { PdfViewer } from "@/components/pdf/PdfViewer";
import { LinesCard } from "@/components/po/lines/LinesCard";
import { createJobThenPrint, JobPrintBlock, type RunLine } from "@/components/po/lines/actions";
import { PoHeaderForm } from "@/components/po/PoHeaderForm";
import { PrintJobDialog } from "@/components/po/PrintJobDialog";
import { ReviewBadge, StatusBadge } from "@/components/po/StatusBadge";
import { ShipperCreatedBanner, WarningsBanner } from "@/components/po/WarningsBanner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatUsd, handleEnterAdvance } from "@/lib/utils";
import type { CreatePrintResult, LineItemDraft, PartCandidate, PoDetail, PoDraft } from "@/types/po";

function asText(value: string | number | null | undefined): string {
  return value == null ? "" : String(value);
}

function toDraft(po: PoDetail): PoDraft {
  return {
    po_number: asText(po.po_number),
    customer_name: asText(po.customer_name),
    order_date: asText(po.order_date),
    requested_ship_date: asText(po.requested_ship_date),
    buyer_contact: asText(po.buyer_contact),
    buyer_notes: asText(po.buyer_notes),
    bill_to: asText(po.bill_to),
    ship_to: asText(po.ship_to),
    line_items: po.line_items.map(
      (item): LineItemDraft => ({
        id: item.id,
        line_number: asText(item.line_number),
        customer_part_number: asText(item.customer_part_number),
        revision: asText(item.revision),
        description: asText(item.description),
        quantity: asText(item.quantity),
        unit_price: formatUsd(item.unit_price),
        uom: item.uom === "Lot" ? "Lot" : "Each",
        due_date: asText(item.due_date),
        notes: asText(item.notes),
      }),
    ),
  };
}

function applyPart(draft: PoDraft, index: number, part: PartCandidate): PoDraft {
  const line_items = draft.line_items.map((item, itemIndex) =>
    itemIndex === index
      ? {
          ...item,
          customer_part_number: part.part_number,
          revision: part.part_revision,
          description: part.description || "",
        }
      : item,
  );
  return { ...draft, line_items };
}

function isDirty(po: PoDetail, draft: PoDraft): boolean {
  return JSON.stringify(draft) !== JSON.stringify(toDraft(po));
}

function dirtyCreatedShippers(po: PoDetail, draft: PoDraft): string[] {
  const original = toDraft(po);
  const numbers = new Set<string>();
  for (const item of draft.line_items) {
    if (item.id == null) continue;
    const line = po.line_items.find((row) => row.id === item.id);
    if (line?.erp_status !== "created" || !line.erp_shipper_number) continue;
    const before = original.line_items.find((row) => row.id === item.id);
    if (JSON.stringify(item) !== JSON.stringify(before)) numbers.add(line.erp_shipper_number);
  }
  return [...numbers];
}

export function ReviewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [po, setPo] = useState<PoDetail | null>(null);
  const [draft, setDraft] = useState<PoDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyLine, setBusyLine] = useState<number | null>(null);
  const [poOpen, setPoOpen] = useState(false);
  const [batchBlock, setBatchBlock] = useState<CreatePrintResult | null>(null);
  const [printJob, setPrintJob] = useState<{ jobNumber: string; certAvailable: boolean } | null>(null);
  const printWaiter = useRef<(() => void) | null>(null);

  const focusLineRaw = params.get("line");
  const focusLineId = focusLineRaw ? Number(focusLineRaw) : null;

  const consumeFocusLine = useCallback(() => {
    if (!params.has("line")) return;
    const next = new URLSearchParams(params);
    next.delete("line");
    setParams(next, { replace: true });
  }, [params, setParams]);

  const load = async () => {
    if (!id) return;
    const result = await api.getPo(id);
    setPo(result);
    if (result.status !== "pending") {
      setDraft(toDraft(result));
    }
  };

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [id]);

  useEffect(() => {
    if (!id || po?.status !== "pending") return;
    const timer = window.setInterval(() => {
      load().catch(() => undefined);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [id, po?.status]);

  const disabled = po?.status !== "extracted" || busy || busyLine != null;
  const confirmed = po?.review_state === "confirmed";
  const dirty = po && draft ? isDirty(po, draft) : false;

  const askPrint = (jobNumber: string, certAvailable: boolean) =>
    new Promise<void>((resolve) => {
      printWaiter.current = resolve;
      setPrintJob({ jobNumber, certAvailable });
    });

  const finishPrint = () => {
    setPrintJob(null);
    printWaiter.current?.();
    printWaiter.current = null;
  };

  const run: RunLine = async (lineId, work, noticeText) => {
    setBusyLine(lineId);
    try {
      const result = await work();
      setPo(result);
      setError(null);
      if (noticeText) setNotice(noticeText);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ShopKeeper request failed.");
    } finally {
      setBusyLine(null);
    }
  };

  const save = async (action: "save_draft" | "confirm"): Promise<boolean> => {
    if (!id || !draft || !po) return false;
    const shippers = dirtyCreatedShippers(po, draft);
    if (shippers.length) {
      const ok = window.confirm(
        `A shipper (${shippers.join(", ")}) was already created. Save these details anyway? The shipper quantity will be updated to match.`,
      );
      if (!ok) return false;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.review(id, action, draft);
      setPo(result);
      setDraft(toDraft(result));
      setNotice(
        action === "confirm"
          ? "PO is marked correct. You can create jobs."
          : shippers.length
            ? "Saved. ShopKeeper jobs and shipper quantity updated."
            : "Saved.",
      );
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const usePart = async (index: number, part: PartCandidate) => {
    setDraft((current) => (current ? applyPart(current, index, part) : current));
    const item = draft?.line_items[index];
    const line = item?.id != null ? po?.line_items.find((row) => row.id === item.id) : undefined;
    if (!po || !line) {
      setNotice(`Part ${part.part_number} rev ${part.part_revision} filled in.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.resolvePart(po.id, line.id, part.part_number, part.part_revision);
      setPo(result);
      setNotice(
        line.erp_status === "created"
          ? `Part ${part.part_number} rev ${part.part_revision} stored and the ShopKeeper job updated.`
          : `Part ${part.part_number} rev ${part.part_revision} stored.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to store the ShopKeeper part.");
    } finally {
      setBusy(false);
    }
  };

  const saveBeforeLeaving = async (): Promise<boolean> => {
    if (!dirty) return true;
    if (!window.confirm("Save your changes to this PO before leaving?")) return false;
    return save("save_draft");
  };

  const createReadyJobs = () => {
    if (!po) return;
    const readyLines = po.line_items.filter((line) => line.erp_status === "ready");
    if (readyLines.length === 0) return;
    void run(readyLines[0].id, async () => {
      let latest = po;
      for (const line of readyLines) {
        const result = await createJobThenPrint(po.id, line.id, line.cert_required, askPrint);
        latest = result.po;
        if (result.missing_ops || result.missing_cert) {
          setBatchBlock(result);
          setNotice(`Job ${result.job_number} was created. Nothing was printed.`);
          return latest;
        }
        if (result.printed) setNotice(`Job ${result.job_number} created.`);
        else if (result.print_error) setNotice(`Job created. Print skipped: ${result.print_error}`);
        else setNotice("ShopKeeper job created.");
      }
      return latest;
    });
  };

  const reextract = async () => {
    if (!id) return;
    const ok = window.confirm(
      "Re-extract from the original PDF? This replaces the current extracted values, including any manual edits, and sets the PO back to unreviewed.",
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await api.reextract(id);
      setNotice("Re-extraction started. Current extracted values will be replaced.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to re-extract.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!id) return;
    if (!window.confirm("Delete this purchase order and its original PDF?")) return;
    await api.deletePo(id);
    navigate("/");
  };

  if (error && !po) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <Notice tone="error">{error}</Notice>
      </div>
    );
  }
  if (!po) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <p className="text-[13px] text-muted">Loading…</p>
      </div>
    );
  }
  if (po.source === "manual") {
    return <Navigate to={`/manual/${po.id}`} replace />;
  }

  const lineCount = po.line_items.length;
  const createdCount = po.line_items.filter((line) => line.erp_status === "created").length;
  const jobMode = confirmed;
  const poCollapsed = jobMode && !poOpen;

  return (
    <div className="space-y-3 pb-2">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <Link to="/" className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
            <ArrowLeft className="h-3.5 w-3.5" />
            Work list
          </Link>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="font-mono text-xl font-semibold">{po.po_number || "PO # pending"}</h1>
            <span className="truncate text-[13px] text-muted">{po.customer_name || "Customer pending"}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={po.status} source={po.source} />
          <ReviewBadge state={po.review_state} />
          <span className="ml-1 font-mono text-xs text-muted tabular-nums">
            {lineCount} {lineCount === 1 ? "line" : "lines"} · {createdCount} jobs
          </span>
        </div>
      </div>

      {po.is_stale ? (
        <Notice tone="warning">This extraction job looks stale. It should recover automatically; you can also retry extraction.</Notice>
      ) : null}
      {po.status === "pending" ? <Notice tone="info">Extracting purchase-order information… this can take a minute.</Notice> : null}
      {po.status === "failed" ? <Notice tone="error">{po.extraction_error || "Extraction failed. Please try again."}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {po.review_state === "confirmed" ? (
        <Notice tone="muted">
          This PO is checked. You can still edit quantity, part, and the other line fields here — Save writes those to any
          ShopKeeper job already created. Changing a line that does not have a job yet puts the PO back to Needs check.
        </Notice>
      ) : po.status === "extracted" ? (
        <Notice tone="info">
          Check the PDF against the fields, then click <strong>PO is correct</strong>. After that you can create ShopKeeper jobs.
        </Notice>
      ) : null}

      <ShipperCreatedBanner shipperNumber={po.shipper_number} poId={po.id} />
      <WarningsBanner warnings={po.warnings} />

      <div className="grid gap-3 xl:grid-cols-[minmax(26rem,5fr)_minmax(0,7fr)]">
        <PdfViewer poId={po.id} pageCount={po.page_count ?? 1} />
        <div className="flex min-w-0 flex-col gap-3" data-enter-form onKeyDown={handleEnterAdvance}>
          <Card>
            <CardHeader className="flex-wrap gap-2">
              <CardTitle>PO information</CardTitle>
              {jobMode ? (
                <button
                  type="button"
                  className="ml-auto inline-flex items-center gap-1 text-xs font-semibold"
                  onClick={() => setPoOpen((open) => !open)}
                >
                  {poCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  {poCollapsed ? "Show" : "Hide"}
                </button>
              ) : null}
            </CardHeader>
            <CardContent>
              {draft && poCollapsed ? (
                <p className="text-[13px]">
                  <span className="font-mono font-semibold">{draft.po_number || "PO # pending"}</span>
                  {" · "}
                  <span className="font-bold">{draft.customer_name || "Customer pending"}</span>
                  {draft.order_date ? <span className="font-mono text-muted"> · {draft.order_date}</span> : null}
                </p>
              ) : draft ? (
                <PoHeaderForm draft={draft} onChange={setDraft} disabled={disabled} compact={jobMode} />
              ) : (
                <p className="text-[13px] text-muted">Waiting for extraction.</p>
              )}
            </CardContent>
          </Card>
          {draft ? (
            <LinesCard
              po={po}
              draft={draft}
              disabled={disabled}
              confirmed={Boolean(confirmed)}
              focusLineId={focusLineId}
              onFocusConsumed={consumeFocusLine}
              onChangeDraft={setDraft}
              onUsePart={usePart}
              onBeforeCreatePart={saveBeforeLeaving}
              onChangePo={setPo}
              onError={setError}
              onNotice={setNotice}
              onRun={run}
              onAskPrint={askPrint}
              onCreateReadyJobs={createReadyJobs}
            />
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 pb-16 text-xs">
        <button type="button" className="text-muted hover:text-accent hover:underline disabled:opacity-40" disabled={busy} onClick={reextract}>
          Read PDF again
        </button>
        <span className="text-faint">·</span>
        <button type="button" className="text-red-700 hover:underline disabled:opacity-40" disabled={busy} onClick={remove}>
          Delete this PO
        </button>
      </div>

      <div className="sticky bottom-2 z-10 rounded-lg border border-rule bg-white/95 px-3 py-2.5 shadow-[0_-2px_8px_rgb(22_32_44/0.06)] backdrop-blur">
        <div className="flex items-center gap-2">
          <p className="hidden flex-1 text-xs text-muted md:block">
            {jobMode
              ? "Save keeps field edits and updates ShopKeeper jobs already created."
              : "Save keeps your edits. PO is correct unlocks job creation."}
          </p>
          <Button variant="outline" disabled={disabled || !draft} onClick={() => void save("save_draft")}>
            Save
          </Button>
          {!jobMode ? (
            <Button disabled={disabled || !draft} onClick={() => void save("confirm")}>
              PO is correct
            </Button>
          ) : null}
        </div>
      </div>

      {printJob ? (
        <PrintJobDialog jobNumber={printJob.jobNumber} certAvailable={printJob.certAvailable} onClose={finishPrint} />
      ) : null}
      {batchBlock ? <JobPrintBlock block={batchBlock} poId={po.id} onClose={() => setBatchBlock(null)} /> : null}
    </div>
  );
}

const NOTICE_TONES = {
  info: "border-accent/25 border-l-accent bg-accent-soft text-ink",
  success: "border-emerald-200 border-l-emerald-500 bg-emerald-50 text-emerald-900",
  warning: "border-orange-200 border-l-orange-500 bg-orange-50 text-orange-950",
  error: "border-red-200 border-l-red-500 bg-red-50 text-red-800",
  muted: "border-rule border-l-faint bg-white text-muted",
} as const;

function Notice({ tone, children }: { tone: keyof typeof NOTICE_TONES; children: ReactNode }) {
  return <div className={cn("rounded-lg border border-l-4 px-3 py-1.5 text-[13px]", NOTICE_TONES[tone])}>{children}</div>;
}
