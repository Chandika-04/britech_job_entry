import { useState, type KeyboardEvent } from "react";

import { api } from "@/api/client";
import { CustomerCodeField } from "@/components/po/CustomerCodeField";
import { PriceLookup } from "@/components/po/PriceLookup";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { expiryFromToday, readPriceExpiryDays } from "@/lib/priceDefaults";
import { cn, formatDate, formatUsd, parseMoney } from "@/lib/utils";
import type { PartEditor, PriceMatrixPayload, PriceMatrixRow } from "@/types/po";

type Draft = { quantity: string; price: string; expires: string; note: string };

function emptyDraft(): Draft {
  return { quantity: "", price: "", expires: expiryFromToday(readPriceExpiryDays()), note: "" };
}

function rowDraft(row: PriceMatrixRow): Draft {
  return {
    quantity: String(row.quantity),
    price: formatUsd(row.price),
    expires: row.expiration_date ?? "",
    note: row.note ?? "",
  };
}

function toPayload(draft: Draft, rowversion?: string | null): PriceMatrixPayload | string {
  const quantity = Number(draft.quantity.replace(/,/g, "").trim());
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 32767) return "Quantity must be a whole number from 1 to 32767.";
  const price = parseMoney(draft.price);
  if (price == null || Number(price) < 0) return "Enter a price, e.g. $12.50.";
  return {
    quantity,
    price,
    expiration_date: draft.expires || null,
    note: draft.note.trim() || null,
    ...(rowversion !== undefined ? { rowversion } : {}),
  };
}

/**
 * ShopKeeper PartMasterPriceMatrix for this part: one price per quantity break (the price for
 * orders of that qty or more). Expired rows stay as history in gray. Also a view-only Price
 * lookup (contract, matrix, past jobs, proposals) for any customer.
 */
export function PriceMatrixCard({
  part,
  disabled,
  onChange,
  onError,
  onNotice,
}: {
  part: PartEditor | null;
  disabled: boolean;
  onChange: (part: PartEditor) => void;
  onError: (message: string | null) => void;
  onNotice: (message: string | null) => void;
}) {
  const [adding, setAdding] = useState<Draft>(emptyDraft);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editing, setEditing] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [lookupCustomer, setLookupCustomer] = useState<string | null>(null);
  const [lookupQty, setLookupQty] = useState("");

  const rows = part?.price_matrix ?? [];
  const off = disabled || busy || !part;
  const customer = lookupCustomer ?? part?.customer_code ?? "";

  const run = async (work: () => Promise<PartEditor>, ok: string) => {
    setBusy(true);
    onError(null);
    try {
      onChange(await work());
      onNotice(ok);
      return true;
    } catch (err) {
      onError(err instanceof Error ? err.message : "Could not save the price.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = async (draft: Draft = adding) => {
    if (!part) return;
    const payload = toPayload(draft);
    if (typeof payload === "string") {
      onError(payload);
      return;
    }
    if (await run(() => api.addPartPrice(part.pm_linkid, payload), `Price for qty ${payload.quantity} added.`)) {
      setAdding(emptyDraft());
    }
  };

  const save = async (row: PriceMatrixRow, draft: Draft = editing) => {
    if (!part) return;
    const payload = toPayload(draft, row.rowversion);
    if (typeof payload === "string") {
      onError(payload);
      return;
    }
    if (await run(() => api.updatePartPrice(part.pm_linkid, row.id, payload), `Price for qty ${payload.quantity} saved.`)) {
      setEditingId(null);
    }
  };

  const remove = (row: PriceMatrixRow) => {
    if (!part) return;
    if (!window.confirm(`Delete the qty ${row.quantity} price (${formatUsd(row.price)}) from ShopKeeper?`)) return;
    void run(() => api.deletePartPrice(part.pm_linkid, row.id, row.rowversion), `Price for qty ${row.quantity} deleted.`);
  };

  const field = (draft: Draft, set: (next: Draft) => void, key: keyof Draft, props: Record<string, unknown> = {}) => (
    <Input
      className="h-8"
      value={draft[key]}
      disabled={off}
      data-field={key}
      onChange={(event) => set({ ...draft, [key]: event.target.value })}
      {...props}
    />
  );

  /**
   * Enter in a price row: Qty → Price → Expires → Note. Enter on Note saves the row once Qty,
   * Price and Expires are all filled; otherwise it goes back to the first empty one of those.
   */
  const rowEnter =
    (draft: Draft, set: (next: Draft) => void, submit: (draft: Draft) => void) =>
    (event: KeyboardEvent<HTMLTableRowElement>) => {
      if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof HTMLInputElement) || !target.dataset.field) return;
      event.preventDefault();
      let next = draft;
      if (target.dataset.field === "price") {
        next = { ...draft, price: formatUsd(draft.price) || draft.price };
        set(next);
      }
      const inputs = Array.from(event.currentTarget.querySelectorAll<HTMLInputElement>("input[data-field]")).filter(
        (input) => !input.disabled,
      );
      const index = inputs.indexOf(target);
      if (index < inputs.length - 1) {
        const following = inputs[index + 1];
        following.focus();
        if (following.type !== "date") following.select();
        return;
      }
      const missing = (["quantity", "price", "expires"] as const).find((key) => !next[key].trim());
      if (!missing) {
        submit(next);
        return;
      }
      inputs.find((input) => input.dataset.field === missing)?.focus();
    };

  return (
    <Card className={cn(!part && "opacity-50")}>
      <CardHeader>
        <CardTitle>Price matrix</CardTitle>
      </CardHeader>
      <CardContent className={cn("space-y-4", !part && "pointer-events-none")}>
        {!part ? <p className="text-xs text-muted">Create the part first to edit this section.</p> : null}
        <p className="text-xs text-muted">
          An order uses the row with the smallest quantity at or above its quantity (above the top row, the top row): with
          rows 1, 5 and 10, qty 2–5 uses the 5 price and qty 6 or more uses the 10 price. Expired rows are skipped. Changes
          save straight to ShopKeeper.
        </p>

        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th className="num">Qty</th>
                <th className="num">Price</th>
                <th>Entered</th>
                <th>Expires</th>
                <th>Note</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) =>
                editingId === row.id ? (
                  <tr key={row.id} onKeyDown={rowEnter(editing, setEditing, (draft) => void save(row, draft))}>
                    <td className="w-24">{field(editing, setEditing, "quantity", { inputMode: "numeric", className: "h-8 text-right font-mono" })}</td>
                    <td className="w-28">
                      {field(editing, setEditing, "price", {
                        className: "h-8 text-right font-mono",
                        onBlur: () => setEditing({ ...editing, price: formatUsd(editing.price) || editing.price }),
                      })}
                    </td>
                    <td className="whitespace-nowrap font-mono text-muted">{formatDate(row.last_date)}</td>
                    <td className="w-40">{field(editing, setEditing, "expires", { type: "date" })}</td>
                    <td>{field(editing, setEditing, "note")}</td>
                    <td className="whitespace-nowrap">
                      <div className="flex gap-1">
                        <Button size="sm" disabled={off} onClick={() => void save(row)}>
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditingId(null)}>
                          Cancel
                        </Button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={row.id} className={cn(row.expired && "text-faint")}>
                    <td className="num font-mono tabular-nums">{row.quantity}</td>
                    <td className="num font-mono tabular-nums">{formatUsd(row.price)}</td>
                    <td className="whitespace-nowrap font-mono">{formatDate(row.last_date)}</td>
                    <td className="whitespace-nowrap font-mono">
                      {row.expiration_date ? formatDate(row.expiration_date) : "No expiry"}
                      {row.expired ? <span className="ml-1 font-sans text-xs font-semibold">Expired</span> : null}
                    </td>
                    <td className="max-w-[260px] truncate">{row.note || "—"}</td>
                    <td className="whitespace-nowrap">
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={off || editingId !== null}
                          onClick={() => {
                            setEditing(rowDraft(row));
                            setEditingId(row.id);
                          }}
                        >
                          Edit
                        </Button>
                        <Button size="sm" variant="ghost" disabled={off || editingId !== null} onClick={() => remove(row)}>
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ),
              )}
              {part && rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-muted">
                    No prices yet.
                  </td>
                </tr>
              ) : null}
              <tr
                className="bg-head/60"
                data-add-row
                onKeyDown={rowEnter(adding, setAdding, (draft) => {
                  void add(draft).then(() => {
                    // Ready for the next price: back to Qty.
                    window.setTimeout(
                      () => document.querySelector<HTMLInputElement>('tr[data-add-row] input[data-field="quantity"]')?.focus(),
                      0,
                    );
                  });
                })}
              >
                <td className="w-24">{field(adding, setAdding, "quantity", { inputMode: "numeric", placeholder: "Qty", className: "h-8 text-right font-mono" })}</td>
                <td className="w-28">
                  {field(adding, setAdding, "price", {
                    placeholder: "$0.00",
                    className: "h-8 text-right font-mono",
                    onBlur: () => setAdding({ ...adding, price: formatUsd(adding.price) || adding.price }),
                  })}
                </td>
                <td className="whitespace-nowrap text-xs text-muted">Today</td>
                <td className="w-40">{field(adding, setAdding, "expires", { type: "date", title: "Default from Settings" })}</td>
                <td>{field(adding, setAdding, "note", { placeholder: "Note (optional)" })}</td>
                <td>
                  <Button size="sm" disabled={off || editingId !== null || !adding.quantity.trim() || !adding.price.trim()} onClick={() => void add()}>
                    Add price
                  </Button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted">
          Enter moves Qty → Price → Expires → Note; Enter on Note saves the row once Qty, Price and Expires are filled. New
          prices expire {readPriceExpiryDays()} days from today by default (change it in Settings). Clear the date for no
          expiry and click Add price.
        </p>

        <div className="space-y-2 border-t border-rule-soft pt-3">
          <p className="text-[13px] font-semibold text-ink">Price lookup</p>
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-56">
              <CustomerCodeField value={customer} disabled={!part} onChange={(value) => setLookupCustomer(value)} />
            </div>
            <Input
              className="h-8 w-28 font-mono"
              inputMode="numeric"
              placeholder="Qty (optional)"
              value={lookupQty}
              onChange={(event) => setLookupQty(event.target.value)}
            />
          </div>
          <PriceLookup
            key={`${customer}|${lookupQty}|${rows.map((row) => `${row.id}:${row.rowversion}`).join(",")}`}
            customerNumber={customer || null}
            partNumber={part?.part_number ?? null}
            partRevision={part?.part_revision ?? null}
            quantity={lookupQty.trim() || undefined}
          />
        </div>
      </CardContent>
    </Card>
  );
}
