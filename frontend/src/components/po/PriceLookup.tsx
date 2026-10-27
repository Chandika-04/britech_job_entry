import { useState } from "react";

import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { formatDate, formatUsd } from "@/lib/utils";
import type { PriceQuote } from "@/types/po";

const SOURCE_LABELS: Record<string, string> = {
  contract: "Contract",
  matrix: "Price matrix",
  history: "Job history",
  proposal: "Proposal",
};

const CURRENT_SOURCES = new Set(["contract", "matrix"]);

function historyTime(quote: PriceQuote): number {
  if (!quote.order_date) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(quote.order_date);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function orderedQuotes(quotes: PriceQuote[]): PriceQuote[] {
  const current: PriceQuote[] = [];
  const history: PriceQuote[] = [];
  for (const quote of quotes) {
    if (CURRENT_SOURCES.has(quote.source)) current.push(quote);
    else history.push(quote);
  }
  history.sort((a, b) => {
    const byDate = historyTime(b) - historyTime(a);
    if (byDate !== 0) return byDate;
    return (b.job_number || "").localeCompare(a.job_number || "");
  });
  return [...current, ...history];
}

interface Props {
  customerNumber: string | null;
  partNumber: string | null;
  partRevision: string | null;
  quantity?: string;
  disabled?: boolean;
  currentPrice?: string;
  pickLabel?: string;
  onPick: (price: string) => void;
  onAfterPick?: () => void;
}

export function PriceLookup({
  customerNumber,
  partNumber,
  partRevision,
  quantity,
  disabled,
  currentPrice,
  pickLabel,
  onPick,
  onAfterPick,
}: Props) {
  const [quotes, setQuotes] = useState<PriceQuote[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const ready = Boolean(customerNumber && partNumber && partRevision);
  const showing = open && quotes !== null;

  const search = async () => {
    if (!customerNumber || !partNumber || !partRevision) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.lookupPrices(customerNumber, partNumber, partRevision, quantity);
      setQuotes(result.quotes);
      setOpen(true);
      if (result.quotes.length === 0) setError("No contract, matrix, job, or proposal prices found for this customer and part.");
    } catch (err) {
      setQuotes([]);
      setOpen(true);
      setError(err instanceof Error ? err.message : "Price lookup failed.");
    } finally {
      setBusy(false);
    }
  };

  const toggle = () => {
    if (showing) {
      setOpen(false);
      return;
    }
    if (quotes) {
      setOpen(true);
      return;
    }
    void search();
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={disabled || busy || !ready} onClick={toggle}>
          {busy ? "Looking up…" : showing ? "Hide prices" : "Price lookup"}
        </Button>
        {currentPrice ? <span className="font-mono text-xs tabular-nums">{currentPrice}</span> : null}
        {!ready ? <span className="text-xs text-muted">Match the customer and ShopKeeper part first.</span> : null}
      </div>
      {showing && error ? <p className="text-xs text-muted">{error}</p> : null}
      {showing && quotes && quotes.length > 0 ? (
        <div className="max-h-72 min-w-0 overflow-y-auto rounded-md border border-rule bg-white">
          <table className="data-table wrap">
            <thead>
              <tr>
                <th>Source</th>
                <th className="num">Price</th>
                <th className="num">Qty</th>
                <th>Job / quote</th>
                <th>Date</th>
                {pickLabel ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {orderedQuotes(quotes).map((quote, index) => (
                <tr
                  key={`${quote.source}-${quote.job_number ?? index}-${quote.unit_price}`}
                  className={disabled ? "pick-row is-disabled" : "pick-row"}
                  tabIndex={disabled || pickLabel ? undefined : 0}
                  onClick={() => {
                    if (disabled || pickLabel) return;
                    onPick(formatUsd(quote.unit_price));
                    onAfterPick?.();
                  }}
                  onKeyDown={(event) => {
                    if (disabled || pickLabel) return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onPick(formatUsd(quote.unit_price));
                      onAfterPick?.();
                    }
                  }}
                >
                  <td>{SOURCE_LABELS[quote.source] ?? quote.source}</td>
                  <td className="num font-mono">{formatUsd(quote.unit_price)}</td>
                  <td className="num font-mono">{quote.quantity ?? "—"}</td>
                  <td className="font-mono text-xs">
                    {quote.job_number || quote.po_number ? (
                      <>
                        {quote.job_number || "—"}
                        {quote.po_number ? <span className="text-muted"> / {quote.po_number}</span> : null}
                      </>
                    ) : (
                      quote.note || "—"
                    )}
                  </td>
                  <td className="whitespace-nowrap font-mono text-xs text-muted">{formatDate(quote.order_date)}</td>
                  {pickLabel ? (
                    <td>
                      <Button
                        type="button"
                        size="sm"
                        disabled={disabled}
                        onClick={() => {
                          onPick(formatUsd(quote.unit_price));
                          onAfterPick?.();
                        }}
                      >
                        {pickLabel}
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
