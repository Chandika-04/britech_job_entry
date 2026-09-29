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

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="section-label">{title}</h3>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 lg:grid-cols-4">{children}</div>
    </section>
  );
}

export function PoHeaderForm({ draft, onChange, disabled }: Props) {
  const set = (field: keyof PoDraft, value: string) => onChange({ ...draft, [field]: value });

  return (
    <div className="space-y-4">
      <Group title="Order">
        <Field label="PO number">
          <Input className="font-mono" value={draft.po_number} disabled={disabled} onChange={(event) => set("po_number", event.target.value)} />
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
        <Field label="Customer name" className="col-span-2 lg:col-span-3">
          <Input value={draft.customer_name} disabled={disabled} onChange={(event) => set("customer_name", event.target.value)} />
        </Field>
        <Field label="Customer #" className="col-span-2 lg:col-span-1">
          <Input className="font-mono" value={draft.customer_number} disabled={disabled} onChange={(event) => set("customer_number", event.target.value)} />
        </Field>
      </Group>

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
    </div>
  );
}
