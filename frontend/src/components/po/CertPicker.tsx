import { useMemo, useRef, useState, type KeyboardEvent } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { CertText } from "@/types/po";

const MATCH_LIMIT = 50;

function rankCerts(certs: CertText[], query: string): CertText[] {
  const q = query.trim().toLowerCase();
  const starts: CertText[] = [];
  const idContains: CertText[] = [];
  const descContains: CertText[] = [];
  const byId = (a: CertText, b: CertText) => a.id.localeCompare(b.id);
  if (!q) return [...certs].sort(byId);
  for (const cert of certs) {
    const id = (cert.id || "").toLowerCase();
    const desc = (cert.description || "").toLowerCase();
    if (id.startsWith(q)) starts.push(cert);
    else if (id.includes(q)) idContains.push(cert);
    else if (desc.includes(q)) descContains.push(cert);
  }
  return [...starts.sort(byId), ...idContains.sort(byId), ...descContains.sort(byId)];
}

export function CertPicker({
  available,
  disabled,
  onLink,
}: {
  available: CertText[];
  disabled?: boolean;
  onLink: (id: string) => Promise<void> | void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);

  const matches = useMemo(() => rankCerts(available, query), [available, query]);
  const shown = matches.slice(0, MATCH_LIMIT);
  const selected = available.find((row) => row.id === selectedId) ?? matches.find((row) => row.id === selectedId) ?? null;

  const clear = () => {
    setQuery("");
    setSelectedId("");
    inputRef.current?.focus();
  };

  const selectTop = () => {
    const top = matches[0];
    if (!top) return;
    setSelectedId(top.id);
    queueMicrotask(() => document.getElementById("cert-picker-link")?.focus());
  };

  const link = async () => {
    if (!selected || disabled || busy) return;
    setBusy(true);
    try {
      await onLink(selected.id);
      setQuery("");
      setSelectedId("");
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      selectTop();
    }
    if (event.key === "Escape") {
      event.preventDefault();
      clear();
    }
  };

  const onRowKey = (event: KeyboardEvent<HTMLTableRowElement>, id: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setSelectedId(id);
    }
    if (event.key === "Escape") {
      event.preventDefault();
      clear();
    }
  };

  return (
    <div className="space-y-2">
      <label className="block text-[13px] text-ink">
        Find certification
        <Input
          ref={inputRef}
          className="mt-1"
          placeholder="Type a cert ID or description"
          value={query}
          disabled={disabled || busy}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={onSearchKey}
        />
      </label>
      <div className="max-h-60 overflow-y-auto rounded-md border border-rule">
        <table className="data-table wrap">
          <thead>
            <tr>
              <th>ID</th>
              <th>Description</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((cert) => (
              <tr
                key={cert.id}
                tabIndex={disabled ? -1 : 0}
                className={cn("pick-row", selectedId === cert.id && "is-selected")}
                onClick={() => !disabled && setSelectedId(cert.id)}
                onKeyDown={(event) => onRowKey(event, cert.id)}
              >
                <td className="font-mono font-bold">{cert.id}</td>
                <td>{cert.description || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {matches.length > MATCH_LIMIT ? (
          <p className="px-3 py-2 text-xs text-muted">Showing the first 50 matches. Type more to narrow the list.</p>
        ) : null}
        {matches.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted">No certifications match “{query}”.</p>
        ) : null}
      </div>
      {selected ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span>
            Selected: <span className="font-mono font-semibold">{selected.id}</span>
            {selected.description ? ` — ${selected.description}` : ""}
          </span>
          <Button type="button" size="sm" variant="ghost" disabled={disabled || busy} onClick={clear}>
            Clear
          </Button>
        </div>
      ) : null}
      <Button id="cert-picker-link" type="button" size="sm" disabled={disabled || busy || !selected} onClick={() => void link()}>
        Link
      </Button>
    </div>
  );
}
