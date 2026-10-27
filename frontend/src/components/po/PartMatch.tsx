import { Link, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn, focusNextField } from "@/lib/utils";
import type { PartCandidate } from "@/types/po";

interface Props {
  initialPartNumber?: string;
  initialRevision?: string;
  selectedPartNumber?: string | null;
  selectedRevision?: string | null;
  selectedPmLinkId?: number | null;
  disabled?: boolean;
  lineIndex?: number;
  lineId?: number;
  poId?: number;
  extractedDescription?: string;
  customerCode?: string | null;
  onBeforeCreatePart?: () => Promise<boolean>;
  onUse: (part: PartCandidate) => void | Promise<void>;
  onError?: (message: string) => void;
  onAfterUse?: () => void;
}

export function PartMatchSection({
  initialPartNumber = "",
  initialRevision = "",
  selectedPartNumber,
  selectedRevision,
  selectedPmLinkId,
  disabled,
  lineIndex = 0,
  lineId,
  poId,
  extractedDescription,
  customerCode,
  onBeforeCreatePart,
  onUse,
  onError,
  onAfterUse,
}: Props) {
  const navigate = useNavigate();
  const [partNumber, setPartNumber] = useState(initialPartNumber);
  const [partRevision, setPartRevision] = useState(initialRevision);
  const [partMatches, setPartMatches] = useState<PartCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lookupSeq = useRef(0);
  const matchesRef = useRef<PartCandidate[]>([]);

  useEffect(() => {
    setPartNumber(initialPartNumber);
    setPartRevision(initialRevision);
  }, [initialPartNumber, initialRevision]);

  const applyPart = async (part: PartCandidate) => {
    await onUse(part);
    onAfterUse?.();
  };

  const searchParts = (number = partNumber, revision = partRevision): Promise<PartCandidate[]> => {
    const q = number.trim();
    const seq = ++lookupSeq.current;
    if (!q) {
      matchesRef.current = [];
      setPartMatches([]);
      setError(null);
      setSearching(false);
      return Promise.resolve([]);
    }
    setSearching(true);
    return api
      .lookupParts(q, revision.trim() || undefined)
      .then((result) => {
        if (seq !== lookupSeq.current) return matchesRef.current;
        matchesRef.current = result.matches;
        setPartMatches(result.matches);
        if (result.matches.length === 0) {
          setError(`No active ShopKeeper parts start with “${q}”.`);
        } else {
          setError(null);
        }
        return result.matches;
      })
      .catch((err: Error) => {
        if (seq !== lookupSeq.current) return matchesRef.current;
        matchesRef.current = [];
        setPartMatches([]);
        const message = err.message || "Part lookup failed.";
        setError(message);
        onError?.(message);
        return [];
      })
      .finally(() => {
        if (seq === lookupSeq.current) setSearching(false);
      });
  };

  const pickFirstMatch = async (): Promise<boolean> => {
    const q = partNumber.trim();
    if (!q || disabled) return false;
    let matches = matchesRef.current;
    if (matches.length === 0) matches = await searchParts(q, partRevision);
    const top = matches[0];
    if (!top) return false;
    await applyPart(top);
    return true;
  };

  const onLookupEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (!partNumber.trim()) {
      focusNextField(event.currentTarget);
      return;
    }
    void pickFirstMatch().then((picked) => {
      if (!picked) focusNextField(event.currentTarget);
    });
  };

  const createNewPart = async () => {
    if (!lineId || poId == null || disabled) return;
    if (onBeforeCreatePart) {
      const ok = await onBeforeCreatePart();
      if (!ok) return;
    }
    const params = new URLSearchParams();
    const part = partNumber.trim() || initialPartNumber.trim();
    if (part) params.set("part", part);
    params.set("rev", partRevision.trim() || initialRevision.trim() || "-");
    const customer = (customerCode || "").trim();
    if (customer) params.set("customer", customer);
    const desc = (extractedDescription || "").trim();
    if (desc) params.set("desc", desc);
    params.set("returnPo", String(poId));
    params.set("returnLine", String(lineId));
    navigate(`/parts/new?${params.toString()}`);
  };

  const createPartControl =
    lineId && poId != null ? (
      <button
        type="button"
        className="text-xs font-semibold text-accent hover:underline disabled:opacity-40"
        disabled={disabled}
        onClick={() => void createNewPart()}
      >
        Create new part
      </button>
    ) : null;

  useEffect(() => {
    if (disabled) return;
    const q = partNumber.trim();
    if (!q) {
      lookupSeq.current += 1;
      matchesRef.current = [];
      setPartMatches([]);
      setError(null);
      setSearching(false);
      return;
    }
    const handle = window.setTimeout(() => void searchParts(q, partRevision), 250);
    return () => window.clearTimeout(handle);
  }, [partNumber, partRevision, disabled]);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2 sm:grid-cols-[minmax(0,16rem)_6rem_auto] sm:items-end">
        <div className="space-y-1">
          <Label>ShopKeeper part</Label>
          <Input
            id={`part-line-${lineIndex}`}
            data-focus={`part-line-${lineIndex}`}
            className="font-mono"
            value={partNumber}
            disabled={disabled}
            autoComplete="off"
            placeholder="Type a part number"
            onChange={(event) => setPartNumber(event.target.value)}
            onKeyDown={onLookupEnter}
          />
        </div>
        <div className="space-y-1">
          <Label>Rev</Label>
          <Input
            className="font-mono"
            value={partRevision}
            disabled={disabled}
            autoComplete="off"
            onChange={(event) => setPartRevision(event.target.value)}
            onKeyDown={onLookupEnter}
          />
        </div>
        <Button type="button" variant="outline" disabled={disabled || searching || !partNumber.trim()} onClick={() => void searchParts()}>
          {searching ? "Searching…" : "Search"}
        </Button>
      </div>
      {error ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-orange-200 bg-orange-50 px-3 py-1.5 text-xs text-orange-950">
          <span>{error}</span>
          {createPartControl ? (
            <Button type="button" size="sm" disabled={disabled} onClick={() => void createNewPart()}>
              Create new part
            </Button>
          ) : null}
        </div>
      ) : null}
      {selectedPmLinkId ? (
        <Link to={`/parts/${selectedPmLinkId}`} className="text-xs font-semibold text-accent hover:underline">
          Edit part
        </Link>
      ) : null}
      {partMatches.length > 0 ? (
        <div className="space-y-1">
          {createPartControl ? <div>{createPartControl}</div> : null}
          {partMatches.length >= 50 ? (
            <p className="text-xs text-muted">Showing the first 50 matches. Type more to narrow the list.</p>
          ) : null}
          <div className="max-h-60 min-w-0 overflow-y-auto rounded-md border border-rule bg-white">
          <table className="data-table wrap">
            <thead>
              <tr>
                <th className="w-[22%]">Part #</th>
                <th className="w-12">Rev</th>
                <th>Description</th>
                <th className="w-20">Type</th>
                <th className="w-16" />
              </tr>
            </thead>
            <tbody>
              {partMatches.map((match) => {
                const selected =
                  selectedPartNumber === match.part_number && selectedRevision === match.part_revision;
                return (
                  <tr
                    key={`${match.part_number}-${match.part_revision}`}
                    className={cn("pick-row", selected && "is-selected", disabled && "is-disabled")}
                    tabIndex={disabled ? undefined : 0}
                    onClick={() => {
                      if (!disabled) void applyPart(match);
                    }}
                    onKeyDown={(event) => {
                      if (disabled) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        void applyPart(match);
                      }
                    }}
                  >
                    <td className="font-mono font-semibold">{match.part_number}</td>
                    <td className="font-mono">{match.part_revision}</td>
                    <td>{match.description || <span className="text-faint">No description</span>}</td>
                    <td className="text-xs text-muted">{match.master_type || "—"}</td>
                    <td className="whitespace-nowrap text-right">
                      <Link
                        to={`/parts/${match.pm_linkid}`}
                        className="text-xs font-semibold text-accent hover:underline"
                        onClick={(event) => event.stopPropagation()}
                      >
                        Edit part
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
