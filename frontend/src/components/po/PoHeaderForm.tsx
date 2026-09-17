import type { ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { PoDraft } from "@/types/po";

interface Props {
  draft: PoDraft;
  onChange: (draft: PoDraft) => void;
  disabled?: boolean;
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

export function PoHeaderForm({ draft, onChange, disabled }: Props) {
  const set = (field: keyof PoDraft, value: string) => onChange({ ...draft, [field]: value });

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="PO number">
          <Input value={draft.po_number} disabled={disabled} onChange={(event) => set("po_number", event.target.value)} />
        </Field>
        <Field label="Customer number">
          <Input value={draft.customer_number} disabled={disabled} onChange={(event) => set("customer_number", event.target.value)} />
        </Field>
        <Field label="Customer name">
          <Input value={draft.customer_name} disabled={disabled} onChange={(event) => set("customer_name", event.target.value)} className="sm:col-span-2" />
        </Field>
        <Field label="Order date">
          <Input type="date" value={draft.order_date} disabled={disabled} onChange={(event) => set("order_date", event.target.value)} />
        </Field>
        <Field label="Requested ship date">
          <Input type="date" value={draft.requested_ship_date} disabled={disabled} onChange={(event) => set("requested_ship_date", event.target.value)} />
        </Field>
        <Field label="Buyer / contact">
          <Input value={draft.buyer_contact} disabled={disabled} onChange={(event) => set("buyer_contact", event.target.value)} />
        </Field>
      </div>
      <Field label="Buyer notes">
        <Textarea value={draft.buyer_notes} disabled={disabled} onChange={(event) => set("buyer_notes", event.target.value)} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Bill to">
          <Textarea value={draft.bill_to} disabled={disabled} onChange={(event) => set("bill_to", event.target.value)} />
        </Field>
        <Field label="Ship to">
          <Textarea value={draft.ship_to} disabled={disabled} onChange={(event) => set("ship_to", event.target.value)} />
        </Field>
      </div>
    </div>
  );
}
