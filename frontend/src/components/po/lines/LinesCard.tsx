import { useEffect, useState } from "react";
import { Plus } from "lucide-react";

import { CustomerMatchSection } from "@/components/po/CustomerMatch";
import { CertAllCheckbox, type RunLine } from "@/components/po/lines/actions";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import type { LineItemDraft, PartCandidate, PoDetail, PoDraft } from "@/types/po";

import { CheckModeLine } from "./CheckModeLine";
import { emptyLine, firstNeedsAttentionId, firstUnmatchedKey, lineForItem, lineKey, type LineKey } from "./helpers";
import { JobModeRow } from "./JobModeRow";

export function LinesCard({
  po,
  draft,
  disabled,
  confirmed,
  focusLineId,
  onFocusConsumed,
  onChangeDraft,
  onUsePart,
  onBeforeCreatePart,
  onChangePo,
  onError,
  onNotice,
  onRun,
  onAskPrint,
  onCreateReadyJobs,
}: {
  po: PoDetail;
  draft: PoDraft;
  disabled?: boolean;
  confirmed: boolean;
  focusLineId?: number | null;
  onFocusConsumed?: () => void;
  onChangeDraft: (draft: PoDraft) => void;
  onUsePart: (index: number, part: PartCandidate) => void | Promise<void>;
  onBeforeCreatePart?: () => Promise<boolean>;
  onChangePo: (po: PoDetail) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  onRun: RunLine;
  onAskPrint: (jobNumber: string, certAvailable: boolean) => Promise<void>;
  onCreateReadyJobs?: () => void;
}) {
  const [editingLines, setEditingLines] = useState(confirmed);
  const [matcherKey, setMatcherKey] = useState<LineKey | null>(() => firstUnmatchedKey(po, draft.line_items));
  const [expanded, setExpanded] = useState<number | null>(() => firstNeedsAttentionId(po));
  const [openNotes, setOpenNotes] = useState<Set<LineKey>>(new Set());
  const [returnNonce, setReturnNonce] = useState(0);

  const checkLayout = !confirmed || editingLines;
  const createdCount = po.line_items.filter((line) => line.erp_status === "created").length;
  const readyCount = po.line_items.filter((line) => line.erp_status === "ready").length;
  const lineCount = draft.line_items.length;
  const jobLabel = createdCount === 1 ? "1 job created" : `${createdCount} jobs created`;
  const lineLabel = lineCount === 1 ? "1 line" : `${lineCount} lines`;

  useEffect(() => {
    if (!confirmed) setEditingLines(false);
  }, [confirmed]);

  useEffect(() => {
    if (focusLineId == null || Number.isNaN(focusLineId)) return;
    setMatcherKey(focusLineId);
    setExpanded(focusLineId);
    setReturnNonce((n) => n + 1);
    onFocusConsumed?.();
  }, [focusLineId, onFocusConsumed]);

  const updateItem = (index: number, field: keyof LineItemDraft, value: string) => {
    const line_items = draft.line_items.map((item, itemIndex) => (itemIndex === index ? { ...item, [field]: value } : item));
    onChangeDraft({ ...draft, line_items });
  };

  const addItem = () => {
    onChangeDraft({
      ...draft,
      line_items: [...draft.line_items, emptyLine(draft.line_items.length + 1)],
    });
  };

  const removeItem = (index: number) => {
    onChangeDraft({
      ...draft,
      line_items: draft.line_items.filter((_, itemIndex) => itemIndex !== index),
    });
  };

  const usePartAndClose = (index: number, part: PartCandidate) => {
    void onUsePart(index, part);
    setMatcherKey(null);
  };

  const toggleNotes = (key: LineKey) => {
    setOpenNotes((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <Card className="@container min-w-0">
      <CardHeader className="flex-wrap gap-2">
        <CardTitle>Lines</CardTitle>
        <span className="font-mono text-xs tabular-nums text-muted">
          {lineLabel} · {jobLabel}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <CertAllCheckbox po={po} disabled={disabled} onRun={onRun} />
          {confirmed && readyCount > 0 && onCreateReadyJobs ? (
            <Button type="button" size="sm" disabled={disabled} onClick={onCreateReadyJobs}>
              Create all ready lines ({readyCount})
            </Button>
          ) : null}
          {checkLayout ? (
            <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={addItem}>
              <Plus className="h-3.5 w-3.5" />
              Add line
            </Button>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => setEditingLines(true)}>
              Edit lines
            </Button>
          )}
          {confirmed && editingLines ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setEditingLines(false)}>
              Done
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <div className="border-b border-rule-soft px-4 py-3">
        <CustomerMatchSection po={po} disabled={disabled} onChange={onChangePo} onError={onError} onNotice={onNotice} />
      </div>
      {draft.line_items.length === 0 ? (
        <p className="px-4 py-6 text-[13px] text-muted">No line items yet.</p>
      ) : checkLayout ? (
        <div>
          {draft.line_items.map((item, index) => {
            const key = lineKey(item, index);
            const line = lineForItem(po, item);
            return (
              <CheckModeLine
                key={key}
                item={item}
                index={index}
                line={line}
                po={po}
                disabled={disabled}
                matcherOpen={matcherKey === key}
                remountMatcher={matcherKey === key ? `return-${key}-${returnNonce}` : undefined}
                notesOpen={openNotes.has(key) || Boolean(item.notes)}
                onToggleNotes={() => toggleNotes(key)}
                onToggleMatcher={() => setMatcherKey((current) => (current === key ? null : key))}
                onUpdate={(field, value) => updateItem(index, field, value)}
                onRemove={() => removeItem(index)}
                onUsePart={usePartAndClose}
                onBeforeCreatePart={onBeforeCreatePart}
                onRun={onRun}
                onError={onError}
                confirmed={confirmed}
                onNotice={onNotice}
                onAskPrint={onAskPrint}
              />
            );
          })}
        </div>
      ) : (
        <div>
          {draft.line_items.map((item, index) => {
            const key = lineKey(item, index);
            const line = lineForItem(po, item);
            const lineId = item.id ?? null;
            return (
              <JobModeRow
                key={key}
                item={item}
                index={index}
                line={line}
                po={po}
                confirmed={confirmed}
                disabled={disabled}
                expanded={lineId != null && expanded === lineId}
                matcherOpen={matcherKey === key}
                remountMatcher={matcherKey === key ? `return-${key}-${returnNonce}` : undefined}
                onToggle={() => setExpanded((current) => (lineId != null && current === lineId ? null : lineId))}
                onToggleMatcher={() => {
                  if (lineId != null) setExpanded(lineId);
                  setMatcherKey((current) => (current === key ? null : key));
                }}
                onUsePart={usePartAndClose}
                onBeforeCreatePart={onBeforeCreatePart}
                onRun={onRun}
                onNotice={onNotice}
                onAskPrint={onAskPrint}
                onError={onError}
              />
            );
          })}
        </div>
      )}
    </Card>
  );
}
