import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { LineItemDraft, PoDraft } from "@/types/po";

function emptyLine(index: number): LineItemDraft {
  return {
    line_number: String(index),
    customer_part_number: "",
    revision: "",
    description: "",
    quantity: "",
    unit_price: "",
    uom: "EA",
    due_date: "",
    notes: "",
  };
}

interface Props {
  draft: PoDraft;
  onChange: (draft: PoDraft) => void;
  disabled?: boolean;
}

export function LineItemsEditor({ draft, onChange, disabled }: Props) {
  const updateItem = (index: number, field: keyof LineItemDraft, value: string) => {
    const line_items = draft.line_items.map((item, itemIndex) =>
      itemIndex === index ? { ...item, [field]: value } : item,
    );
    onChange({ ...draft, line_items });
  };

  const addItem = () => {
    onChange({
      ...draft,
      line_items: [...draft.line_items, emptyLine(draft.line_items.length + 1)],
    });
  };

  const removeItem = (index: number) => {
    onChange({
      ...draft,
      line_items: draft.line_items.filter((_, itemIndex) => itemIndex !== index),
    });
  };

  return (
    <div className="space-y-4">
      {draft.line_items.length === 0 ? (
        <p className="rounded-xl bg-slate-50 px-4 py-6 text-sm text-slate-600">No line items yet.</p>
      ) : null}
      {draft.line_items.map((item, index) => (
        <div key={item.id ?? `new-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="font-semibold">Line {item.line_number || index + 1}</h3>
            <Button type="button" variant="ghost" size="sm" disabled={disabled} onClick={() => removeItem(index)}>
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Line number</Label>
              <Input inputMode="numeric" value={item.line_number} disabled={disabled} onChange={(event) => updateItem(index, "line_number", event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Customer part number</Label>
              <Input value={item.customer_part_number} disabled={disabled} onChange={(event) => updateItem(index, "customer_part_number", event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Revision</Label>
              <Input value={item.revision} disabled={disabled} onChange={(event) => updateItem(index, "revision", event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>UOM</Label>
              <Input value={item.uom} disabled={disabled} onChange={(event) => updateItem(index, "uom", event.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Description</Label>
              <Input value={item.description} disabled={disabled} onChange={(event) => updateItem(index, "description", event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Quantity</Label>
              <Input inputMode="decimal" value={item.quantity} disabled={disabled} onChange={(event) => updateItem(index, "quantity", event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Unit price</Label>
              <Input inputMode="decimal" value={item.unit_price} disabled={disabled} onChange={(event) => updateItem(index, "unit_price", event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Due date</Label>
              <Input type="date" value={item.due_date} disabled={disabled} onChange={(event) => updateItem(index, "due_date", event.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Notes</Label>
              <Textarea value={item.notes} disabled={disabled} onChange={(event) => updateItem(index, "notes", event.target.value)} />
            </div>
          </div>
        </div>
      ))}
      <Button type="button" variant="outline" disabled={disabled} onClick={addItem}>
        <Plus className="h-4 w-4" />
        Add line item
      </Button>
    </div>
  );
}
