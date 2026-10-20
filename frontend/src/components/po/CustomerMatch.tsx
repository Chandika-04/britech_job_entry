import { useEffect, useRef, useState } from "react";

import { api } from "@/api/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, focusNextField } from "@/lib/utils";
import type { CustomerCandidate, CustomerSuggestion, PoDetail } from "@/types/po";

const MATCH_LABELS: Record<string, string> = {
  alias: "Matched from a previous confirmation",
  exact: "Exact name match",
  contains: "Likely match",
};

type RunWork = (work: () => Promise<PoDetail>, notice?: string) => Promise<void>;

interface Props {
  po: PoDetail;
  disabled?: boolean;
  onChange: (po: PoDetail) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  onBeforeResolve?: () => Promise<unknown>;
  onPick?: (customer: CustomerCandidate) => void;
  onAfterUse?: () => void;
}

export function CustomerMatchSection({ po, disabled, onChange, onError, onNotice, onBeforeResolve, onPick, onAfterUse }: Props) {
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerMatches, setCustomerMatches] = useState<CustomerCandidate[]>([]);
  const [applyToAll, setApplyToAll] = useState(true);
  const [searchingCustomers, setSearchingCustomers] = useState(false);
  const [lookupEmpty, setLookupEmpty] = useState(false);
  const [suggestion, setSuggestion] = useState<CustomerSuggestion | null>(null);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const lookupSeq = useRef(0);
  const matchesRef = useRef<CustomerCandidate[]>([]);
  const firstLineId = po.line_items[0]?.id;
  const resolvedCodes = Array.from(
    new Set(po.line_items.map((line) => line.resolved_customer_code).filter((code): code is string => Boolean(code))),
  );
  const allResolved = po.line_items.length > 0 && po.line_items.every((line) => line.resolved_customer_code);
  const canStore = Boolean(po.id && firstLineId);

  useEffect(() => {
    if (!po.id) {
      setSuggestion(null);
      setSuggestionError(null);
      return;
    }
    let cancelled = false;
    setSuggestionError(null);
    api
      .suggestCustomer(po.id)
      .then((result) => {
        if (!cancelled) setSuggestion(result);
      })
      .catch((err: Error) => {
        if (!cancelled) setSuggestionError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [po.id, po.customer_name]);

  const run: RunWork = async (work, notice) => {
    try {
      const result = await work();
      onChange(result);
      onError("");
      if (notice) onNotice(notice);
    } catch (err) {
      onError(err instanceof Error ? err.message : "ShopKeeper request failed.");
    }
  };

  const useCustomer = (customer: CustomerCandidate) => {
    onPick?.(customer);
    if (!canStore) {
      onNotice(`Customer ${customer.customer_number} filled in.`);
      onAfterUse?.();
      return;
    }
    void run(async () => {
      if (onBeforeResolve) await onBeforeResolve();
      return api.resolveCustomer(po.id, firstLineId, customer.customer_number, applyToAll);
    }, `Customer ${customer.customer_number} stored.`);
    onAfterUse?.();
  };

  const searchCustomers = (query = customerQuery): Promise<CustomerCandidate[]> => {
    const q = query.trim();
    const seq = ++lookupSeq.current;
    if (!q) {
      matchesRef.current = [];
      setCustomerMatches([]);
      setLookupEmpty(false);
      setSearchingCustomers(false);
      return Promise.resolve([]);
    }
    setSearchingCustomers(true);
    return api
      .lookupCustomers(q)
      .then((result) => {
        if (seq !== lookupSeq.current) return matchesRef.current;
        matchesRef.current = result.matches;
        setCustomerMatches(result.matches);
        setLookupEmpty(result.matches.length === 0);
        onError("");
        return result.matches;
      })
      .catch((err: Error) => {
        if (seq !== lookupSeq.current) return matchesRef.current;
        matchesRef.current = [];
        setCustomerMatches([]);
        setLookupEmpty(false);
        onError(err.message || "Customer lookup failed.");
        return [];
      })
      .finally(() => {
        if (seq === lookupSeq.current) setSearchingCustomers(false);
      });
  };

  const pickFirstMatch = async (): Promise<boolean> => {
    const q = customerQuery.trim();
    if (!q || disabled) return false;
    let matches = matchesRef.current;
    if (matches.length === 0) matches = await searchCustomers(q);
    const top = matches.find((row) => row.active) ?? matches[0];
    if (!top || !top.active) return false;
    useCustomer(top);
    return true;
  };

  useEffect(() => {
    if (disabled) return;
    const q = customerQuery.trim();
    if (!q) {
      lookupSeq.current += 1;
      matchesRef.current = [];
      setCustomerMatches([]);
      setLookupEmpty(false);
      setSearchingCustomers(false);
      return;
    }
    const handle = window.setTimeout(() => searchCustomers(q), 250);
    return () => window.clearTimeout(handle);
  }, [customerQuery, disabled]);

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="section-label">ShopKeeper customer</h3>
        {resolvedCodes.length > 0 ? (
          <span className="text-xs text-muted">
            Stored on {allResolved ? "all lines" : "some lines"}:{" "}
            <span className="font-mono font-semibold text-ink">{resolvedCodes.join(", ")}</span>
          </span>
        ) : null}
      </div>

      {po.id ? (
        <CustomerSuggestionBlock
          suggestion={suggestion}
          error={suggestionError}
          resolvedCodes={resolvedCodes}
          disabled={disabled}
          onUse={useCustomer}
        />
      ) : (
        <p className="text-xs text-muted">Type a customer number or company. Matches that start with what you type appear below.</p>
      )}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          value={customerQuery}
          disabled={disabled}
          autoComplete="off"
          placeholder="Type a customer number or company"
          onChange={(event) => setCustomerQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            if (!customerQuery.trim()) {
              focusNextField(event.currentTarget);
              return;
            }
            void pickFirstMatch().then((picked) => {
              if (!picked) focusNextField(event.currentTarget);
            });
          }}
        />
        <Button type="button" variant="outline" disabled={disabled || searchingCustomers || !customerQuery.trim()} onClick={() => searchCustomers()}>
          {searchingCustomers ? "Searching…" : "Search"}
        </Button>
        <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={applyToAll} onChange={(event) => setApplyToAll(event.target.checked)} disabled={disabled} />
          Apply to every line
        </label>
      </div>
      {lookupEmpty && customerQuery.trim() && !searchingCustomers ? (
        <p className="text-xs text-muted">No ShopKeeper customers start with “{customerQuery.trim()}”.</p>
      ) : null}
      {customerMatches.length > 0 ? (
        <div className="space-y-1">
          {customerMatches.length >= 50 ? (
            <p className="text-xs text-muted">Showing the first 50 matches. Type more to narrow the list.</p>
          ) : null}
          <CustomerTable customers={customerMatches} resolvedCodes={resolvedCodes} disabled={disabled} onUse={useCustomer} />
        </div>
      ) : null}
    </section>
  );
}

function CustomerSuggestionBlock({
  suggestion,
  error,
  resolvedCodes,
  disabled,
  onUse,
}: {
  suggestion: CustomerSuggestion | null;
  error: string | null;
  resolvedCodes: string[];
  disabled?: boolean;
  onUse: (customer: CustomerCandidate) => void;
}) {
  if (error) {
    return <p className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-800">Customer match unavailable: {error}</p>;
  }
  if (!suggestion) {
    return <p className="text-xs text-muted">Looking for a matching ShopKeeper customer…</p>;
  }
  if (!suggestion.extracted_name) {
    return <p className="text-xs text-muted">Search ShopKeeper by customer number or company.</p>;
  }

  const warning = suggestion.warning ? (
    <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">{suggestion.warning}</p>
  ) : null;

  if (suggestion.customer) {
    return (
      <div className="space-y-2">
        {warning}
        <div className="rounded-md border border-emerald-200 border-l-4 border-l-emerald-500 bg-emerald-50/60">
          <p className="px-3 pt-1.5 text-xs text-emerald-900">
            {MATCH_LABELS[suggestion.status] ?? "Suggested match"} for “{suggestion.extracted_name}”
          </p>
          <CustomerTable customers={[suggestion.customer]} resolvedCodes={resolvedCodes} disabled={disabled} onUse={onUse} bare />
        </div>
      </div>
    );
  }

  if (suggestion.candidates.length > 0) {
    return (
      <div className="space-y-2">
        {warning}
        <p className="text-xs text-muted">
          {suggestion.status === "ambiguous" ? "Several customers share this name" : "Possible matches"} for “
          {suggestion.extracted_name}”. Pick one:
        </p>
        <CustomerTable customers={suggestion.candidates} resolvedCodes={resolvedCodes} disabled={disabled} onUse={onUse} />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {warning}
      <p className="text-xs text-muted">No ShopKeeper customer matched “{suggestion.extracted_name}”. Search below.</p>
    </div>
  );
}

export function CustomerTable({
  customers,
  resolvedCodes,
  disabled,
  onUse,
  bare,
}: {
  customers: CustomerCandidate[];
  resolvedCodes: string[];
  disabled?: boolean;
  onUse: (customer: CustomerCandidate) => void;
  bare?: boolean;
}) {
  return (
    <div className={cn("min-w-0", !bare && "max-h-60 overflow-y-auto rounded-md border border-rule")}>
      <table className="data-table wrap">
        {!bare ? (
          <thead>
            <tr>
              <th>Cust #</th>
              <th>Company</th>
              <th>Type</th>
              <th>Flags</th>
            </tr>
          </thead>
        ) : null}
        <tbody>
          {customers.map((customer) => {
            const selected = resolvedCodes.includes(customer.customer_number);
            const locked = disabled || !customer.active;
            return (
              <tr
                key={customer.customer_number}
                className={cn("pick-row", bare && "[&>td]:border-b-0", selected && "is-selected", locked && "is-disabled")}
                tabIndex={locked ? undefined : 0}
                onClick={() => {
                  if (!locked) onUse(customer);
                }}
                onKeyDown={(event) => {
                  if (locked) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onUse(customer);
                  }
                }}
              >
                <td className="font-mono font-semibold">{customer.customer_number}</td>
                <td>{customer.company || <span className="text-faint">No company name</span>}</td>
                <td className="text-xs text-muted">{customer.record_type}</td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {customer.credit_hold ? <Badge variant="warning">Credit hold</Badge> : null}
                    {customer.cert_default ? <Badge variant="muted">Certs</Badge> : null}
                    {customer.active ? null : <Badge variant="muted">Inactive</Badge>}
                    {selected ? <Badge variant="muted">Selected</Badge> : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
