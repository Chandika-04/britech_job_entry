import { useEffect, useRef, useState } from "react";

import { api } from "@/api/client";
import { Input } from "@/components/ui/input";
import { cn, focusNextField, handleEnterAdvance } from "@/lib/utils";
import type { CustomerCandidate } from "@/types/po";

interface Props {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

export function CustomerCodeField({ value, disabled, onChange }: Props) {
  const [query, setQuery] = useState(value);
  const [matches, setMatches] = useState<CustomerCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const lookupSeq = useRef(0);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  const search = (text: string) => {
    const q = text.trim();
    const seq = ++lookupSeq.current;
    if (!q) {
      setMatches([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    api
      .lookupCustomers(q)
      .then((result) => {
        if (seq !== lookupSeq.current) return;
        setMatches(result.matches);
      })
      .catch(() => {
        if (seq !== lookupSeq.current) return;
        setMatches([]);
      })
      .finally(() => {
        if (seq === lookupSeq.current) setSearching(false);
      });
  };

  useEffect(() => {
    const handle = window.setTimeout(() => search(query), 250);
    return () => window.clearTimeout(handle);
  }, [query]);

  const pick = (customer: CustomerCandidate) => {
    onChange(customer.customer_number);
    setQuery(customer.customer_number);
    setMatches([]);
  };

  return (
    <div className="space-y-1">
      <Input
        value={query}
        disabled={disabled}
        autoComplete="off"
        aria-label="Customer code"
        onChange={(event) => {
          setQuery(event.target.value);
          onChange(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && matches[0]) {
            event.preventDefault();
            pick(matches[0]);
            focusNextField(event.currentTarget);
            return;
          }
          handleEnterAdvance(event);
        }}
      />
      {searching ? <p className="text-[11px] text-muted">Finding customers…</p> : null}
      {matches.length > 0 && query.trim() ? (
        <div className="max-h-40 overflow-y-auto rounded-md border border-rule bg-white">
          {matches.map((customer) => (
            <button
              key={customer.customer_number}
              type="button"
              className={cn(
                "flex w-full items-baseline justify-between gap-2 px-2 py-1.5 text-left text-[13px] hover:bg-head",
                !customer.active && "text-muted",
              )}
              onClick={() => pick(customer)}
            >
              <span className="font-mono font-semibold">{customer.customer_number}</span>
              <span className="truncate text-muted">{customer.company || ""}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
