import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowLeft, PanelLeftOpen } from "lucide-react";
import { Link, Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { api } from "@/api/client";
import { PdfViewer } from "@/components/pdf/PdfViewer";
import { CustomerMatchSection } from "@/components/po/CustomerMatch";
import { LinesCard } from "@/components/po/lines/LinesCard";
import { createJobThenPrint, JobPrintBlock, type RunLine } from "@/components/po/lines/actions";
import { poCustomerCode } from "@/components/po/lines/helpers";
import { PoHeaderForm } from "@/components/po/PoHeaderForm";
import { PrintJobDialog } from "@/components/po/PrintJobDialog";
import { ReviewBadge, StatusBadge } from "@/components/po/StatusBadge";
import { ShipperCreatedBanner, WarningsBanner } from "@/components/po/WarningsBanner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatQty, formatUsd, handleEnterAdvance } from "@/lib/utils";
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
        quantity: formatQty(item.quantity),
        unit_price: formatUsd(item.unit_price),
        uom: item.uom === "Lot" ? "Lot" : "Each",
        due_date: asText(item.due_date),
        notes: asText(item.notes),
        cert_required: item.cert_required,
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

function headerDirty(po: PoDetail, draft: PoDraft): boolean {
  const original = toDraft(po);
  return (
    original.po_number !== draft.po_number ||
    original.customer_name !== draft.customer_name ||
    original.order_date !== draft.order_date ||
    original.requested_ship_date !== draft.requested_ship_date ||
    original.buyer_contact !== draft.buyer_contact ||
    original.buyer_notes !== draft.buyer_notes ||
    original.bill_to !== draft.bill_to ||
    original.ship_to !== draft.ship_to
  );
}

function pendingChanges(po: PoDetail, draft: PoDraft) {
  const original = toDraft(po);
  const origById = new Map(original.line_items.filter((item) => item.id != null).map((item) => [item.id as number, item]));
  let poChanged = headerDirty(po, draft);
  const jobs: string[] = [];
  if (original.line_items.length !== draft.line_items.length) poChanged = true;
  for (const item of draft.line_items) {
    if (item.id == null) {
      poChanged = true;
      continue;
    }
    const before = origById.get(item.id);
    if (!before) {
      poChanged = true;
      continue;
    }
    origById.delete(item.id);
    const line = po.line_items.find((row) => row.id === item.id);
    const { cert_required: _a, ...itemRest } = item;
    const { cert_required: _b, ...beforeRest } = before;
    if (JSON.stringify(itemRest) === JSON.stringify(beforeRest)) continue;
    if (line?.erp_status === "created" && line.erp_job_number) jobs.push(line.erp_job_number);
    else poChanged = true;
  }
  if (origById.size) poChanged = true;
  return { poChanged, jobs };
}

function isDirty(po: PoDetail, draft: PoDraft): boolean {
  const pending = pendingChanges(po, draft);
  return pending.poChanged || pending.jobs.length > 0;
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

function saveLabel(pending: { poChanged: boolean; jobs: string[] }): string {
  if (!pending.poChanged && pending.jobs.length === 0) return "Save";
  if (pending.poChanged && pending.jobs.length) {
    return pending.jobs.length === 1 ? `Save (PO + job ${pending.jobs[0]})` : `Save (PO + jobs ${pending.jobs.join(", ")})`;
  }
  if (pending.jobs.length) {
    return pending.jobs.length === 1 ? `Save (job ${pending.jobs[0]})` : `Save (jobs ${pending.jobs.join(", ")})`;
  }
  return "Save (PO)";
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
  const [batchBlock, setBatchBlock] = useState<CreatePrintResult | null>(null);
  const [printJob, setPrintJob] = useState<{ jobNumber: string; certAvailable: boolean } | null>(null);
  const [skStatus, setSkStatus] = useState<Record<string, string>>({});
  const [attentionTick, setAttentionTick] = useState(0);
  const [saveTick, setSaveTick] = useState(0);
  const [everConfirmed, setEverConfirmed] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<"pdf" | "header" | null>(null);
  const [pdfHidden, setPdfHidden] = useState(() => {
    try {
      return localStorage.getItem("britech.review.pdfHidden") === "1";
    } catch {
      return false;
    }
  });
  const printWaiter = useRef<(() => void) | null>(null);
  const closeDetailsRef = useRef<(() => void) | null>(null);

  const setPdfHiddenAndStore = (hidden: boolean) => {
    setPdfHidden(hidden);
    try {
      localStorage.setItem("britech.review.pdfHidden", hidden ? "1" : "0");
    } catch {
      // localStorage may be blocked
    }
  };

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

  useEffect(() => {
    if (po?.review_state === "confirmed") setEverConfirmed(true);
  }, [po?.review_state, po?.id]);

  const loadSkStatus = useCallback(async (current: PoDetail | null) => {
    if (!current) return;
    const code = poCustomerCode(current);
    const number = current.po_number;
    if (!code || !number) return;
    try {
      const page = await api.getShopKeeperPo(code, number);
      const map: Record<string, string> = {};
      for (const job of page.jobs) map[job.job_number] = job.status || "";
      setSkStatus(map);
    } catch {
      setSkStatus({});
    }
  }, []);

  useEffect(() => {
    void loadSkStatus(po);
  }, [po, loadSkStatus]);

  useEffect(() => {
    const onFocus = () => void loadSkStatus(po);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [po, loadSkStatus]);

  const disabled = po?.status !== "extracted" || busy || busyLine != null;
  const confirmed = po?.review_state === "confirmed";
  const dirty = po && draft ? isDirty(po, draft) : false;
  const pending = po && draft ? pendingChanges(po, draft) : { poChanged: false, jobs: [] as string[] };
  const needsReconfirm = Boolean(everConfirmed && (!confirmed || pending.poChanged));

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
      void loadSkStatus(result);
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
      setSaveTick((n) => n + 1);
      setNotice(
        action === "confirm"
          ? "PO is marked correct. You can create jobs."
          : shippers.length
            ? "Saved. ShopKeeper jobs and shipper quantity updated."
            : "Saved.",
      );
      void loadSkStatus(result);
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
    }).then(() => {
      setAttentionTick((n) => n + 1);
      void loadSkStatus(po);
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

  const onPageKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      closeDetailsRef.current?.();
      setMobilePanel(null);
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      if (!disabled && draft) void save("save_draft");
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      if (disabled || !draft || confirmed) return;
      void save("confirm");
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "p") {
      event.preventDefault();
      setPdfHiddenAndStore(!pdfHidden);
    }
  };

  const statusNote = useMemo(() => {
    if (needsReconfirm) return "⚠ Line edited after confirming — click PO is correct again to create jobs.";
    if (pending.poChanged || pending.jobs.length) {
      const parts = [...(pending.poChanged ? ["PO"] : []), ...pending.jobs.map((job) => `job ${job}`)];
      return `Unsaved changes: ${parts.join(", ")}`;
    }
    return "All changes saved";
  }, [needsReconfirm, pending]);

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

  return (
    <div className="space-y-3 pb-2" onKeyDown={onPageKeyDown}>
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
      <div className="flex gap-2 md:hidden">
        <Button type="button" variant="outline" className="min-h-11 flex-1" onClick={() => setMobilePanel("pdf")}>
          View PDF
        </Button>
        <Button type="button" variant="outline" className="min-h-11 flex-1" onClick={() => setMobilePanel("header")}>
          PO header
        </Button>
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

      <div
        className={cn(
          "grid gap-3",
          pdfHidden ? "xl:grid-cols-[40px_minmax(0,1fr)]" : "xl:grid-cols-[minmax(24rem,4fr)_minmax(0,8fr)]",
        )}
      >
        <div className="hidden md:block">
          {pdfHidden ? (
            <div className="flex min-h-[calc(100dvh-220px)] w-10 flex-col items-center gap-2 rounded-xl border border-rule bg-white py-2 xl:sticky xl:top-[104px] xl:self-start">
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-[7px] text-ink hover:bg-head"
                aria-label="Show PDF"
                title="Show PDF"
                onClick={() => setPdfHiddenAndStore(false)}
              >
                <PanelLeftOpen className="h-4 w-4" />
              </button>
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted [writing-mode:vertical-rl]">
                PDF
              </span>
            </div>
          ) : (
            <PdfViewer poId={po.id} pageCount={po.page_count ?? 1} onHide={() => setPdfHiddenAndStore(true)} />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <Card className="hidden md:block">
            <CardHeader>
              <CardTitle>PO header</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3" data-enter-form onKeyDown={handleEnterAdvance}>
              {draft ? (
                <>
                  <PoHeaderForm draft={draft} onChange={setDraft} disabled={disabled} dense />
                  <CustomerMatchSection po={po} disabled={disabled} onChange={setPo} onError={setError} onNotice={setNotice} />
                </>
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
              attentionTick={attentionTick}
              skStatus={skStatus}
              saveTick={saveTick}
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
              onSave={() => save("save_draft")}
              closeDetailsRef={closeDetailsRef}
            />
          ) : null}
        </div>
      </div>

      <div className="flex gap-2 md:hidden">
        <Button
          type="button"
          className="min-h-11 flex-1 border-transparent bg-[#1d6b3a] text-white hover:bg-[#175830]"
          disabled={busy}
          onClick={() => void reextract()}
        >
          Re-extract
        </Button>
        <Button
          type="button"
          className="min-h-11 flex-1 border-transparent bg-[#b42318] text-white hover:bg-[#9a1d14]"
          disabled={busy}
          onClick={() => void remove()}
        >
          Delete this PO
        </Button>
      </div>

      <div className="sticky bottom-0 z-10 border-t border-rule bg-white px-3 py-2 shadow-[0_-2px_8px_rgb(22_32_44/0.06)] md:bottom-2 md:rounded-lg md:border">
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <div className="hidden items-center gap-2 md:flex">
            <Button
              type="button"
              className="border-transparent bg-[#1d6b3a] text-white hover:bg-[#175830]"
              disabled={busy}
              onClick={() => void reextract()}
            >
              Re-extract
            </Button>
            <Button
              type="button"
              className="border-transparent bg-[#b42318] text-white hover:bg-[#9a1d14]"
              disabled={busy}
              onClick={() => void remove()}
            >
              Delete this PO
            </Button>
            <span className="mx-1 h-6 w-px bg-rule" />
          </div>
          <p
            className={cn("flex-1 text-xs", needsReconfirm ? "font-semibold text-amber-800" : "text-muted")}
            role="status"
          >
            {statusNote}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              className="min-h-12 flex-1 md:min-h-0 md:flex-none"
              title="Ctrl+S"
              disabled={disabled || !draft}
              onClick={() => void save("save_draft")}
            >
              {saveLabel(pending)}
            </Button>
            <Button
              className={cn("min-h-12 flex-1 md:min-h-0 md:flex-none", needsReconfirm && "ring-[3px] ring-accent/40")}
              title="Ctrl+Enter"
              aria-pressed={confirmed}
              disabled={disabled || !draft}
              onClick={() => {
                if (confirmed) return;
                void save("confirm");
              }}
            >
              {confirmed ? "✓ PO is correct" : "PO is correct"}
            </Button>
          </div>
        </div>
      </div>

      {mobilePanel === "pdf" ? <PdfViewer poId={po.id} pageCount={po.page_count ?? 1} overlay onClose={() => setMobilePanel(null)} /> : null}
      {mobilePanel === "header" ? (
        <div className="fixed inset-0 z-40 flex flex-col bg-page">
          <div className="flex items-center justify-between border-b border-rule bg-white px-3 py-2">
            <p className="text-sm font-semibold">PO header</p>
            <Button type="button" variant="outline" onClick={() => setMobilePanel(null)}>
              Back
            </Button>
          </div>
          <div className="flex-1 overflow-auto p-3" data-enter-form onKeyDown={handleEnterAdvance}>
            {draft ? (
              <div className="space-y-3">
                <PoHeaderForm draft={draft} onChange={setDraft} disabled={disabled} dense />
                <CustomerMatchSection po={po} disabled={disabled} onChange={setPo} onError={setError} onNotice={setNotice} />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

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
