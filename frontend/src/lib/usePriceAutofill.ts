import { useEffect, useRef, useState } from "react";

import { api } from "@/api/client";
import { formatDate, formatUsd } from "@/lib/utils";
import type { PriceQuote } from "@/types/po";

export type AutofillLine = {
  /** Stable per line (the line id, or "new-<index>" for unsaved lines). */
  key: string;
  label: string;
  customer: string | null | undefined;
  part: string | null | undefined;
  rev: string | null | undefined;
  quantity: string;
  price: string;
};

const DEBOUNCE_MS = 400;

function wholeQty(value: string): number | null {
  const qty = Number(value.replace(/,/g, "").trim());
  return Number.isInteger(qty) && qty >= 1 ? qty : null;
}

export function describeSuggestion(quote: PriceQuote): string {
  if (quote.source === "matrix") {
    return quote.expires ? `price matrix, expires ${formatDate(quote.expires)}` : "price matrix, no expiry";
  }
  const when = quote.order_date ? ` (${formatDate(quote.order_date)})` : "";
  return `last price used, job ${quote.job_number ?? "?"}${when}`;
}

/**
 * Fills a line's unit price when its ShopKeeper part is picked (or its customer or quantity
 * changes): the price-matrix break for the quantity, else this customer's last job price.
 *
 * Never overwrites a price someone typed or the PO stated: it only fills an empty price, or
 * replaces a price it filled itself. Lines are not touched on first load, only after a change.
 * Returns the note for each line whose price is still the autofilled one.
 */
export function usePriceAutofill(
  lines: AutofillLine[],
  onFill: (line: AutofillLine, price: string, quote: PriceQuote) => void,
): Record<string, string> {
  const seen = useRef(new Map<string, string | null>());
  const filled = useRef(new Map<string, { price: string; note: string }>());
  const latest = useRef(lines);
  const fillRef = useRef(onFill);
  latest.current = lines;
  fillRef.current = onFill;
  const [, bump] = useState(0);

  const signature = lines
    .map((line) => [line.key, line.customer, line.part, line.rev, line.quantity, line.price].join("|"))
    .join("\n");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      for (const line of latest.current) {
        const qty = wholeQty(line.quantity);
        const query =
          line.customer && line.part && line.rev && qty ? [line.customer, line.part, line.rev, qty].join("|") : null;
        if (!seen.current.has(line.key)) {
          seen.current.set(line.key, query); // first sight (page load): leave the price alone
          continue;
        }
        if (query === null || query === seen.current.get(line.key)) continue;
        seen.current.set(line.key, query);
        const auto = filled.current.get(line.key);
        const current = line.price.trim();
        if (current && current !== auto?.price) continue; // typed or from the PO: keep it
        void api
          .suggestPrice(line.customer!, line.part!, line.rev!, qty!)
          .then((quote) => {
            if (!quote || seen.current.get(line.key) !== query) return;
            const now = latest.current.find((row) => row.key === line.key);
            const price = formatUsd(quote.unit_price);
            if (!now || !price) return;
            const stillAuto = !now.price.trim() || now.price.trim() === filled.current.get(line.key)?.price;
            if (!stillAuto) return;
            filled.current.set(line.key, { price, note: describeSuggestion(quote) });
            fillRef.current(now, price, quote);
            bump((n) => n + 1);
          })
          .catch(() => undefined); // autofill is a convenience; Price lookup still works
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [signature]);

  const notes: Record<string, string> = {};
  for (const line of lines) {
    const auto = filled.current.get(line.key);
    if (auto && auto.price === line.price.trim()) notes[line.key] = auto.note;
  }
  return notes;
}
