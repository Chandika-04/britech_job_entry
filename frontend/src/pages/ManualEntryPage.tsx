import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { api } from "@/api/client";
import { CustomerMatchSection } from "@/components/po/CustomerMatch";
import { PartMatchSection } from "@/components/po/PartMatch";
import { PoHeaderForm } from "@/components/po/PoHeaderForm";
import { PriceLookup } from "@/components/po/PriceLookup";
import {
  CertAllCheckbox,
  CertCheckbox,
  CreateJobButton,
  LineDetail,
  type RunLine,
} from "@/components/po/ShopKeeperPanel";
import { PrintJobDialog } from "@/components/po/PrintJobDialog";
import { ErpBadge, ReviewBadge, StatusBadge } from "@/components/po/StatusBadge";
import { ShipperCreatedBanner, WarningsBanner } from "@/components/po/WarningsBanner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn, focusNextEmpty, formatQty, formatUsd, handleEnterAdvance, todayIso } from "@/lib/utils";
import type { CustomerCandidate, LineItem, LineItemDraft, PartCandidate, PoDetail, PoDraft } from "@/types/po";

const UNITS = ["Each", "Lot"] as const;

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
        due_date: asText(item.due_date) || todayIso(),
        notes: asText(item.notes),
      }),
    ),
  };
}

function emptyLine(index: number): LineItemDraft {
  return {
    line_number: String(index),
    customer_part_number: "",
    revision: "",
    description: "",
    quantity: "",
    unit_price: "",
    uom: "Each",
    due_date: todayIso(),
    notes: "",
  };
}

function blankDraft(): PoDraft {
  return {
    po_number: "",
    customer_name: "",
    order_date: todayIso(),
    requested_ship_date: "",
    buyer_contact: "",
    buyer_notes: "",
    bill_to: "",
    ship_to: "",
    line_items: [emptyLine(1)],
  };
}

function unsavedPo(): PoDetail {
  const now = new Date().toISOString();
  return {
    id: 0,
    created_at: now,
    updated_at: now,
    status: "extracted",
    review_state: "unreviewed",
    source: "manual",
    po_number: null,
    customer_name: null,
    warnings: [],
    is_stale: false,
    has_duplicate_warning: false,
    page_count: null,
    line_count: 1,
    jobs_created_count: 0,
    jobs_complete: false,
    shipper_number: null,
    shipper_needs_attach: false,
    heartbeat_at: null,
    order_date: todayIso(),
    requested_ship_date: null,
    buyer_contact: null,
    buyer_notes: null,
    bill_to: null,
    ship_to: null,
    extraction_error: null,
    line_items: [],
    llm_calls: [],
    attachment_filename: null,
  };
}

function applyCustomer(draft: PoDraft, customer: CustomerCandidate): PoDraft {
  const address =
    customer.address_block ||
    [
      customer.company,
      customer.street,
      customer.suite,
      [customer.city, [customer.state, customer.postal_code].filter(Boolean).join(" ")].filter(Boolean).join(", "),
    ]
      .filter(Boolean)
      .join("\n");
  return {
    ...draft,
    customer_name: customer.company || customer.customer_number,
    bill_to: address,
    ship_to: address,
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

export function ManualEntryPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [po, setPo] = useState<PoDetail | null>(() => (id ? null : unsavedPo()));
  const [draft, setDraft] = useState<PoDraft | null>(() => (id ? null : blankDraft()));
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickedCustomer, setPickedCustomer] = useState<CustomerCandidate | null>(null);
  const [pickedParts, setPickedParts] = useState<Record<number, PartCandidate>>({});

  const load = async (poId: string) => {
    const result = await api.getPo(poId);
    setPo(result);
    setDraft(toDraft(result));
  };

  useEffect(() => {
    if (id) {
      load(id).catch((err: Error) => setError(err.message));
      return;
    }
    setPo(unsavedPo());
    setDraft(blankDraft());
    setPickedCustomer(null);
    setPickedParts({});
    setError(null);
    setNotice(null);
  }, [id]);

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      let result: PoDetail;
      if (!id) {
        const created = await api.createManual();
        result = await api.review(created.id, "confirm", draft);
      } else {
        result = await api.review(id, "confirm", draft);
      }
      if (pickedCustomer && result.line_items[0]) {
        result = await api.resolveCustomer(result.id, result.line_items[0].id, pickedCustomer.customer_number, true);
      }
      for (const [indexStr, part] of Object.entries(pickedParts)) {
        const index = Number(indexStr);
        const wanted = draft.line_items[index];
        const line =
          result.line_items.find((row) => row.id === wanted?.id) ||
          result.line_items.find((row) => String(row.line_number) === wanted?.line_number) ||
          result.line_items[index];
        if (line) {
          result = await api.resolvePart(result.id, line.id, part.part_number, part.part_revision);
        }
      }
      setPo(result);
      setDraft(toDraft(result));
      if (!id) navigate(`/manual/${result.id}`, { replace: true });
      setNotice("Saved. Ready lines can create a ShopKeeper job.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save.");
    } finally {
      setBusy(false);
    }
  };

  const run: RunLine = async (lineId, work, message) => {
    void lineId;
    if (!id) {
      setError("Save the draft before creating a ShopKeeper job.");
      return;
    }
    setBusy(true);
    try {
      const result = await work();
      setPo(result);
      setError(null);
      if (message) setNotice(message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ShopKeeper request failed.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!id) {
      if (!window.confirm("Discard this unsaved manual entry?")) return;
      navigate("/");
      return;
    }
    if (!window.confirm("Delete this manual entry?")) return;
    await api.deletePo(id);
    navigate("/");
  };

  const addLine = () => {
    if (!draft) return;
    setDraft({
      ...draft,
      line_items: [...draft.line_items, emptyLine(draft.line_items.length + 1)],
    });
  };

  const removeLine = (index: number) => {
    if (!draft || draft.line_items.length <= 1) return;
    setDraft({ ...draft, line_items: draft.line_items.filter((_, itemIndex) => itemIndex !== index) });
  };

  const applyPrice = (index: number, price: string) => {
    if (!draft) return;
    const line_items = draft.line_items.map((item, itemIndex) =>
      itemIndex === index ? { ...item, unit_price: formatUsd(price) } : item,
    );
    setDraft({ ...draft, line_items });
    setNotice("Unit price updated from lookup. Save the draft to keep it.");
  };

  if (error && !po && id) {
    return <Notice tone="error">{error}</Notice>;
  }
  if (!po || !draft) {
    return <p className="text-[13px] text-muted">Loading…</p>;
  }

  const fieldsDisabled = busy;
  const createdCount = po.line_items.filter((line) => line.erp_status === "created").length;

  return (
    <div className="space-y-3 pb-16" data-enter-form onKeyDown={handleEnterAdvance}>
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <Link to={id ? "/" : "/new"} className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
            <ArrowLeft className="h-3.5 w-3.5" />
            {id ? "Work list" : "New PO"}
          </Link>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="font-mono text-xl font-semibold">{draft.po_number || po.po_number || "Manual entry"}</h1>
            <span className="truncate text-[13px] text-muted">{draft.customer_name || po.customer_name || "Customer pending"}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {id ? (
            <>
              <StatusBadge status={po.status} source={po.source} />
              <ReviewBadge state={po.review_state} />
            </>
          ) : (
            <span className="text-xs font-semibold text-muted">Unsaved</span>
          )}
          <span className="ml-1 font-mono text-xs text-muted tabular-nums">
            {draft.line_items.length} {draft.line_items.length === 1 ? "line" : "lines"}
            {id ? ` · ${createdCount} jobs` : ""}
          </span>
        </div>
      </div>

      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {po.review_state === "confirmed" ? (
        <Notice tone="muted">
          Saved. Create a ShopKeeper job on each ready line. If you change a field, click Save again first.
        </Notice>
      ) : null}

      <ShipperCreatedBanner shipperNumber={po.shipper_number} poId={po.id} />
      <WarningsBanner warnings={po.warnings} />

      <Card>
        <CardHeader>
          <CardTitle>PO information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <CustomerMatchSection
            po={po}
            disabled={fieldsDisabled}
            onPick={(customer) => {
              setPickedCustomer(customer);
              setDraft((current) => (current ? applyCustomer(current, customer) : current));
            }}
            onChange={(result) => {
              setPo(result);
              setDraft((current) =>
                current
                  ? {
                      ...current,
                      customer_name: result.customer_name || current.customer_name,
                      bill_to: result.bill_to || current.bill_to,
                      ship_to: result.ship_to || current.ship_to,
                    }
                  : toDraft(result),
              );
            }}
            onError={setError}
            onNotice={setNotice}
            onAfterUse={() => focusNextEmpty(["po-number", "part-line-0"])}
          />
          <PoHeaderForm draft={draft} onChange={setDraft} disabled={fieldsDisabled} compact />
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
        <h2 className="text-sm font-semibold">Lines</h2>
        <CertAllCheckbox po={po} disabled={fieldsDisabled} onRun={run} />
      </div>

      {draft.line_items.map((item, index) => {
        const line = po.line_items.find((row) => row.id === item.id);
        return (
          <ManualLineCard
            key={item.id ?? `new-${index}`}
            po={po}
            line={line}
            item={item}
            index={index}
            canDelete={draft.line_items.length > 1}
            disabled={fieldsDisabled}
            onUpdate={(field, value) => {
              const line_items = draft.line_items.map((row, rowIndex) =>
                rowIndex === index ? { ...row, [field]: value } : row,
              );
              setDraft({ ...draft, line_items });
            }}
            onRemove={() => removeLine(index)}
            onPickPrice={(price) => applyPrice(index, price)}
            onPickPart={(part) => {
              setPickedParts((current) => ({ ...current, [index]: part }));
              setDraft((current) => (current ? applyPart(current, index, part) : current));
            }}
            pickedCustomerNumber={pickedCustomer?.customer_number || null}
            onRun={run}
            onNotice={setNotice}
          />
        );
      })}

      <Button type="button" variant="outline" disabled={fieldsDisabled} onClick={addLine}>
        <Plus className="h-3.5 w-3.5" />
        Add line
      </Button>

      <div className="flex flex-wrap gap-2 pb-16 text-xs">
        <button type="button" className="text-red-700 hover:underline disabled:opacity-40" disabled={busy} onClick={remove}>
          {id ? "Delete this PO" : "Discard"}
        </button>
      </div>

      <div className="sticky bottom-2 z-10 rounded-lg border border-rule bg-white/95 px-3 py-2.5 shadow-[0_-2px_8px_rgb(22_32_44/0.06)] backdrop-blur">
        <div className="flex items-center gap-2">
          <p className="hidden flex-1 text-xs text-muted md:block">Save puts this PO on the work list and unlocks job creation.</p>
          <Button disabled={fieldsDisabled} onClick={() => save()}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}

function ManualLineCard({
  po,
  line,
  item,
  index,
  canDelete,
  disabled,
  onUpdate,
  onRemove,
  onPickPrice,
  onPickPart,
  pickedCustomerNumber,
  onRun,
  onNotice,
}: {
  po: PoDetail;
  line: LineItem | undefined;
  item: LineItemDraft;
  index: number;
  canDelete: boolean;
  disabled: boolean;
  onUpdate: (field: keyof LineItemDraft, value: string) => void;
  onRemove: () => void;
  onPickPrice: (price: string) => void;
  onPickPart: (part: PartCandidate) => void;
  pickedCustomerNumber: string | null;
  onRun: RunLine;
  onNotice: (message: string) => void;
}) {
  const locked = line?.erp_status === "creating";
  const created = line?.erp_status === "created";
  const printWaiter = useRef<(() => void) | null>(null);
  const [printJob, setPrintJob] = useState<{ jobNumber: string; certAvailable: boolean } | null>(null);
  const askPrint = (jobNumber: string, certAvailable: boolean) =>
    new Promise<void>((resolve) => {
      printWaiter.current = resolve;
      setPrintJob({ jobNumber, certAvailable });
    });
  const fieldsOff = disabled || locked;

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-2">
        <CardTitle>Line {item.line_number || index + 1}</CardTitle>
        <div className="flex items-center gap-2">
          {line ? <ErpBadge status={line.erp_status} /> : null}
          <Button type="button" variant="ghost" size="sm" disabled={fieldsOff || created || !canDelete} onClick={onRemove}>
            <Trash2 className="h-3.5 w-3.5" />
            Delete
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <PartMatchSection
          initialPartNumber={item.customer_part_number}
          initialRevision={item.revision}
          selectedPartNumber={line?.resolved_part_number}
          selectedRevision={line?.resolved_part_revision}
          selectedPmLinkId={line?.resolved_pm_linkid}
          disabled={fieldsOff}
          lineIndex={index}
          onAfterUse={() => focusNextEmpty([`qty-line-${index}`, `price-line-${index}`, `due-line-${index}`])}
          onUse={async (part) => {
            onPickPart(part);
            if (line && po.id) {
              await onRun(
                line.id,
                () => api.resolvePart(po.id, line.id, part.part_number, part.part_revision),
                `Part ${part.part_number} rev ${part.part_revision} stored.`,
              );
            }
          }}
        />
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <Field label="Line #">
            <Input
              className="font-mono"
              inputMode="numeric"
              value={item.line_number}
              disabled={fieldsOff}
              onChange={(event) => onUpdate("line_number", event.target.value)}
            />
          </Field>
          <Field label="Part #">
            <Input
              className="font-mono"
              value={item.customer_part_number}
              disabled={fieldsOff}
              onChange={(event) => onUpdate("customer_part_number", event.target.value)}
            />
          </Field>
          <Field label="Rev">
            <Input className="font-mono" value={item.revision} disabled={fieldsOff} onChange={(event) => onUpdate("revision", event.target.value)} />
          </Field>
          <Field label="Unit">
            <select
              className="h-10 w-full rounded-md border border-rule bg-white px-2.5 text-sm text-ink focus-visible:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/15 disabled:bg-head disabled:text-muted md:h-8"
              value={item.uom}
              disabled={fieldsOff}
              onChange={(event) => onUpdate("uom", event.target.value)}
            >
              {UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Description" className="col-span-2 lg:col-span-4">
            <Input value={item.description} disabled={fieldsOff} onChange={(event) => onUpdate("description", event.target.value)} />
          </Field>
          <Field label="Qty">
            <Input
              data-focus={`qty-line-${index}`}
              className="font-mono"
              inputMode="decimal"
              value={item.quantity}
              disabled={fieldsOff}
              onChange={(event) => onUpdate("quantity", event.target.value)}
            />
          </Field>
          <Field label="Unit price">
            <Input
              data-focus={`price-line-${index}`}
              data-money="usd"
              className="font-mono"
              inputMode="decimal"
              value={item.unit_price}
              disabled={fieldsOff}
              onChange={(event) => onUpdate("unit_price", event.target.value)}
              onBlur={(event) => onUpdate("unit_price", formatUsd(event.currentTarget.value))}
              onFocus={(event) => event.currentTarget.select()}
            />
          </Field>
          <Field label="Due" className="col-span-2">
            <Input
              data-focus={`due-line-${index}`}
              type="date"
              className="font-mono"
              value={item.due_date}
              disabled={fieldsOff}
              onChange={(event) => onUpdate("due_date", event.target.value)}
            />
          </Field>
          <Field label="Notes" className="col-span-2 lg:col-span-4">
            <Textarea value={item.notes} disabled={fieldsOff} onChange={(event) => onUpdate("notes", event.target.value)} />
          </Field>
        </div>

        {line ? (
          <div className="space-y-3 border-t border-rule-soft pt-3">
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <CertCheckbox po={po} line={line} disabled={disabled} onRun={onRun} />
              Certificate of conformance
            </label>
            <LineDetail
              key={`${line.id}-${item.customer_part_number}-${item.revision}`}
              po={po}
              line={line}
              disabled={disabled}
              onRun={onRun}
              showFinder={false}
            />
            <CreateJobButton
              po={po}
              line={line}
              confirmed={po.review_state === "confirmed"}
              disabled={disabled}
              onRun={onRun}
              onNotice={onNotice}
              onAskPrint={askPrint}
            />
            {printJob ? (
              <PrintJobDialog
                jobNumber={printJob.jobNumber}
                certAvailable={printJob.certAvailable}
                onClose={() => {
                  setPrintJob(null);
                  printWaiter.current?.();
                  printWaiter.current = null;
                }}
              />
            ) : null}
          </div>
        ) : null}
        <details className="rounded-md border border-rule px-3 py-2">
          <summary className="cursor-pointer text-[13px] font-semibold text-muted">Look up a past price</summary>
          <div className="mt-3">
            <PriceLookup
              customerNumber={line?.resolved_customer_code || pickedCustomerNumber}
              partNumber={line?.resolved_part_number || item.customer_part_number}
              partRevision={line?.resolved_part_revision || item.revision}
              quantity={item.quantity}
              disabled={fieldsOff}
              onPick={onPickPrice}
              onAfterPick={() => focusNextEmpty([`price-line-${index}`, `due-line-${index}`])}
            />
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div className={cn("space-y-1", className)}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

const NOTICE_TONES = {
  success: "border-emerald-200 border-l-emerald-500 bg-emerald-50 text-emerald-900",
  error: "border-red-200 border-l-red-500 bg-red-50 text-red-800",
  muted: "border-rule border-l-faint bg-white text-muted",
} as const;

function Notice({ tone, children }: { tone: keyof typeof NOTICE_TONES; children: ReactNode }) {
  return <div className={cn("rounded-lg border border-l-4 px-3 py-1.5 text-[13px]", NOTICE_TONES[tone])}>{children}</div>;
}
