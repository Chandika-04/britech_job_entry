import { useEffect, useState, type ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { api } from "@/api/client";
import { PdfViewer } from "@/components/pdf/PdfViewer";
import { LineItemsEditor } from "@/components/po/LineItemsEditor";
import { ShopKeeperPanel } from "@/components/po/ShopKeeperPanel";
import { PoHeaderForm } from "@/components/po/PoHeaderForm";
import { ReviewBadge, StatusBadge } from "@/components/po/StatusBadge";
import { WarningsBanner } from "@/components/po/WarningsBanner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { LineItemDraft, PoDetail, PoDraft } from "@/types/po";

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
        unit_price: asText(item.unit_price),
        uom: item.uom === "Lot" ? "Lot" : "Each",
        due_date: asText(item.due_date),
        notes: asText(item.notes),
      }),
    ),
  };
}

export function ReviewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [po, setPo] = useState<PoDetail | null>(null);
  const [draft, setDraft] = useState<PoDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  const disabled = po?.status !== "extracted" || busy;

  const save = async (action: "save_draft" | "confirm") => {
    if (!id || !draft) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.review(id, action, draft);
      setPo(result);
      setDraft(toDraft(result));
      setNotice(action === "confirm" ? "Marked as reviewed." : "Draft saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save.");
    } finally {
      setBusy(false);
    }
  };

  const reextract = async () => {
    if (!id) return;
    const confirmed = window.confirm(
      "Re-extract from the original PDF? This replaces the current extracted values, including any manual edits, and sets the PO back to unreviewed.",
    );
    if (!confirmed) return;
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
    return <Notice tone="error">{error}</Notice>;
  }
  if (!po) {
    return <p className="text-[13px] text-muted">Loading…</p>;
  }

  const lineCount = po.line_items.length;
  const createdCount = po.line_items.filter((line) => line.erp_status === "created").length;

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <Link to="/" className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
            <ArrowLeft className="h-3.5 w-3.5" />
            Purchase orders
          </Link>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="font-mono text-xl font-semibold">{po.po_number || "PO # pending"}</h1>
            <span className="truncate text-[13px] text-muted">{po.customer_name || "Customer pending"}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={po.status} />
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
          Confirmed. Resolve the ShopKeeper customer and part below, then create one job per line. Editing any stored PO field will
          return this PO to unreviewed.
        </Notice>
      ) : null}

      <WarningsBanner warnings={po.warnings} />

      <div className="grid gap-3 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <PdfViewer poId={po.id} pageCount={po.page_count ?? 1} />
        <div className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle>PO information</CardTitle>
            </CardHeader>
            <CardContent>
              {draft ? (
                <PoHeaderForm draft={draft} onChange={setDraft} disabled={disabled} />
              ) : (
                <p className="text-[13px] text-muted">Waiting for extraction.</p>
              )}
            </CardContent>
          </Card>
          <Card className="overflow-hidden">
            <CardHeader className="flex items-baseline justify-between">
              <CardTitle>Line items</CardTitle>
              {draft ? <span className="font-mono text-xs text-muted tabular-nums">{draft.line_items.length}</span> : null}
            </CardHeader>
            {draft ? <LineItemsEditor draft={draft} onChange={setDraft} disabled={disabled} /> : null}
          </Card>
          {po.status === "extracted" ? (
            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle>ShopKeeper jobs</CardTitle>
              </CardHeader>
              <ShopKeeperPanel
                po={po}
                disabled={busy}
                onChange={(result) => {
                  setPo(result);
                }}
                onError={setError}
                onNotice={setNotice}
              />
            </Card>
          ) : null}
        </div>
      </div>

      <div className="sticky bottom-2 z-10 rounded-lg border border-rule bg-white/95 px-3 py-2.5 shadow-[0_-2px_8px_rgb(22_32_44/0.06)] backdrop-blur">
        <div className="grid grid-cols-2 gap-2 md:flex md:items-center">
          <Button variant="danger" disabled={busy} onClick={remove} className="md:order-1">
            Delete
          </Button>
          <Button variant="secondary" disabled={busy} onClick={reextract} className="md:order-2">
            Re-extract
          </Button>
          <div className="hidden md:order-3 md:block md:flex-1" />
          <Button variant="outline" disabled={disabled || !draft} onClick={() => save("save_draft")} className="md:order-4">
            Save draft
          </Button>
          <Button disabled={disabled || !draft} onClick={() => save("confirm")} className="md:order-5">
            Confirm reviewed
          </Button>
        </div>
      </div>
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
