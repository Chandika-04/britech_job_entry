import type { ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { PoDraft } from "@/types/po";

interface Props {
  draft: PoDraft;
  onChange: (draft: PoDraft) => void;
  disabled?: boolean;
  compact?: boolean;
  dense?: boolean;
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function DenseField({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <label className={cn("grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-2", className)}>
      <span className="field-label mb-0">{label}</span>
      {children}
    </label>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="section-label">{title}</h3>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 lg:grid-cols-4">{children}</div>
    </section>
  );
}

export function PoHeaderForm({ draft, onChange, disabled, compact, dense }: Props) {
  const set = (field: keyof PoDraft, value: string) => onChange({ ...draft, [field]: value });

  if (dense) {
    return (
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-x-3 gap-y-1.5 sm:grid-cols-2 xl:grid-cols-3">
          <DenseField label="PO number">
            <Input
              id="po-number"
              data-focus="po-number"
              className="h-8 font-mono"
              value={draft.po_number}
              disabled={disabled}
              onChange={(event) => set("po_number", event.target.value)}
            />
          </DenseField>
          <DenseField label="Customer">
            <Input
              value={draft.customer_name}
              disabled={disabled}
              className="h-8"
              onChange={(event) => set("customer_name", event.target.value)}
            />
          </DenseField>
          <DenseField label="Order date">
            <Input
              className="h-8 font-mono"
              type="date"
              value={draft.order_date}
              disabled={disabled}
              onChange={(event) => set("order_date", event.target.value)}
            />
          </DenseField>
          <DenseField label="Ship date">
            <Input
              className="h-8 font-mono"
              type="date"
              value={draft.requested_ship_date}
              disabled={disabled}
              onChange={(event) => set("requested_ship_date", event.target.value)}
            />
          </DenseField>
          <DenseField label="Buyer">
            <Input
              className="h-8"
              value={draft.buyer_contact}
              disabled={disabled}
              onChange={(event) => set("buyer_contact", event.target.value)}
            />
          </DenseField>
          <DenseField label="Bill to">
            <Input className="h-8" value={draft.bill_to} disabled={disabled} onChange={(event) => set("bill_to", event.target.value)} />
          </DenseField>
          <DenseField label="Ship to" className="sm:col-span-2 xl:col-span-1">
            <Input className="h-8" value={draft.ship_to} disabled={disabled} onChange={(event) => set("ship_to", event.target.value)} />
          </DenseField>
          <DenseField label="Notes" className="sm:col-span-2 xl:col-span-3">
            <Input className="h-8" value={draft.buyer_notes} disabled={disabled} onChange={(event) => set("buyer_notes", event.target.value)} />
          </DenseField>
        </div>
      </div>
    );
  }

  const addresses = (
      <Group title="Addresses & notes">
        <Field label="Bill to" className="col-span-2">
          <Textarea className="min-h-16" value={draft.bill_to} disabled={disabled} onChange={(event) => set("bill_to", event.target.value)} />
        </Field>
        <Field label="Ship to" className="col-span-2">
          <Textarea className="min-h-16" value={draft.ship_to} disabled={disabled} onChange={(event) => set("ship_to", event.target.value)} />
        </Field>
        <Field label="Buyer notes" className="col-span-2 lg:col-span-4">
          <Textarea className="min-h-14" value={draft.buyer_notes} disabled={disabled} onChange={(event) => set("buyer_notes", event.target.value)} />
        </Field>
      </Group>
  );

  return (
    <div className="space-y-4">
      <Group title="Order">
        <Field label="PO number">
          <Input
            id="po-number"
            data-focus="po-number"
            className="font-mono"
            value={draft.po_number}
            disabled={disabled}
            onChange={(event) => set("po_number", event.target.value)}
          />
        </Field>
        <Field label="Order date">
          <Input className="font-mono" type="date" value={draft.order_date} disabled={disabled} onChange={(event) => set("order_date", event.target.value)} />
        </Field>
        <Field label="Requested ship">
          <Input
            className="font-mono"
            type="date"
            value={draft.requested_ship_date}
            disabled={disabled}
            onChange={(event) => set("requested_ship_date", event.target.value)}
          />
        </Field>
        <Field label="Buyer / contact">
          <Input value={draft.buyer_contact} disabled={disabled} onChange={(event) => set("buyer_contact", event.target.value)} />
        </Field>
      </Group>

      <Group title="Customer">
        <Field label="Customer name" className="col-span-2 lg:col-span-4">
          <Input value={draft.customer_name} disabled={disabled} onChange={(event) => set("customer_name", event.target.value)} />
        </Field>
      </Group>

      {compact ? (
        <details className="rounded-md border border-rule px-3 py-2">
          <summary className="cursor-pointer text-[13px] font-semibold text-muted">Addresses and notes</summary>
          <div className="mt-3">{addresses}</div>
        </details>
      ) : (
        addresses
      )}
    </div>
  );
}
