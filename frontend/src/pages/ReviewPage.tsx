import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { api } from "@/api/client";
import { PdfViewer } from "@/components/pdf/PdfViewer";
import { LineItemsEditor } from "@/components/po/LineItemsEditor";
import { PoHeaderForm } from "@/components/po/PoHeaderForm";
import { ReviewBadge, StatusBadge } from "@/components/po/StatusBadge";
import { WarningsBanner } from "@/components/po/WarningsBanner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LineItemDraft, PoDetail, PoDraft } from "@/types/po";

function asText(value: string | number | null | undefined): string {
  return value == null ? "" : String(value);
}

function toDraft(po: PoDetail): PoDraft {
  return {
    po_number: asText(po.po_number),
    customer_name: asText(po.customer_name),
    customer_number: asText(po.customer_number),
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
        uom: asText(item.uom),
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
    return <div className="rounded-xl bg-red-50 p-4 text-red-800">{error}</div>;
  }
  if (!po) {
    return <p className="text-slate-600">Loading…</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <Link to="/" className="text-sm font-semibold text-sky-700">
            Back to dashboard
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">{po.po_number || "Purchase order"}</h1>
          <p className="text-slate-600">{po.customer_name || "Customer pending"}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusBadge status={po.status} />
          <ReviewBadge state={po.review_state} />
        </div>
      </div>

      {po.is_stale ? (
        <div className="rounded-2xl border border-orange-300 bg-orange-50 p-4 text-orange-950">
          This extraction job looks stale. It should recover automatically; you can also retry extraction.
        </div>
      ) : null}
      {po.status === "pending" ? (
        <div className="rounded-2xl bg-sky-50 p-4 text-sky-950">Extracting purchase-order information… this can take a minute.</div>
      ) : null}
      {po.status === "failed" ? (
        <div className="rounded-2xl bg-red-50 p-4 text-red-900">
          {po.extraction_error || "Extraction failed. Please try again."}
        </div>
      ) : null}
      {notice ? <div className="rounded-2xl bg-emerald-50 p-4 text-emerald-900">{notice}</div> : null}
      {error ? <div className="rounded-2xl bg-red-50 p-4 text-red-800">{error}</div> : null}
      {po.review_state === "confirmed" ? (
        <div className="rounded-2xl bg-slate-50 p-4 text-slate-700">
          Confirmed. Editing any stored field will automatically return this PO to unreviewed.
        </div>
      ) : null}

      <WarningsBanner warnings={po.warnings} />

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <PdfViewer poId={po.id} pageCount={po.page_count ?? 1} />
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>PO information</CardTitle>
            </CardHeader>
            <CardContent>
              {draft ? <PoHeaderForm draft={draft} onChange={setDraft} disabled={disabled} /> : <p>Waiting for extraction.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Line items</CardTitle>
            </CardHeader>
            <CardContent>
              {draft ? <LineItemsEditor draft={draft} onChange={setDraft} disabled={disabled} /> : null}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="sticky bottom-0 z-10 -mx-4 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:rounded-2xl md:border md:bg-white">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button className="flex-1" variant="outline" disabled={disabled || !draft} onClick={() => save("save_draft")}>
            Save draft
          </Button>
          <Button className="flex-1" disabled={disabled || !draft} onClick={() => save("confirm")}>
            Confirm reviewed
          </Button>
        </div>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <Button className="flex-1" variant="secondary" disabled={busy} onClick={reextract}>
            Re-extract
          </Button>
          <Button className="flex-1" variant="danger" disabled={busy} onClick={remove}>
            Delete
          </Button>
        </div>
      </div>
    </div>
  );
}
