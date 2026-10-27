import { useEffect, useState, type MutableRefObject } from "react";
import { Plus } from "lucide-react";

import { CertAllCheckbox, type RunLine } from "@/components/po/lines/actions";
import { LinesGrid } from "@/components/po/lines/LinesGrid";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import type { LineItemDraft, PartCandidate, PoDetail, PoDraft } from "@/types/po";

import { emptyLine, firstNeedsAttentionIndex, isLineCreated, isLineLocked, lineForItem } from "./helpers";

export function LinesCard({
  po,
  draft,
  disabled,
  confirmed,
  focusLineId,
  attentionTick,
  skStatus,
  saveTick,
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
  onSave,
  closeDetailsRef,
}: {
  po: PoDetail;
  draft: PoDraft;
  disabled?: boolean;
  confirmed: boolean;
  focusLineId?: number | null;
  attentionTick?: number;
  skStatus: Record<string, string>;
  saveTick?: number;
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
  onSave: () => Promise<boolean>;
  closeDetailsRef?: MutableRefObject<(() => void) | null>;
}) {
  const [highlightedIndex, setHighlightedIndex] = useState<number | null>(() => firstNeedsAttentionIndex(po, draft.line_items));
  const [openIndex, setOpenIndex] = useState<number | null>(() => firstNeedsAttentionIndex(po, draft.line_items));
  const [matcherIndex, setMatcherIndex] = useState<number | null>(null);
  const [returnNonce, setReturnNonce] = useState(0);
  const [previewReady, setPreviewReady] = useState(false);
  const stackedView = useStackedLayout();

  const createdCount = po.line_items.filter((line) => line.erp_status === "created").length;
  const readyCount = po.line_items.filter((line) => line.erp_status === "ready").length;
  const readyLines = po.line_items.filter((line) => line.erp_status === "ready");
  const lineCount = draft.line_items.length;
  const jobLabel = createdCount === 1 ? "1 job created" : `${createdCount} jobs created`;
  const readyLabel = readyCount === 1 ? "1 ready" : `${readyCount} ready`;
  const lineLabel = lineCount === 1 ? "1 line" : `${lineCount} lines`;
  const readyTitle =
    readyCount === 0
      ? "No lines are ready. Match parts and resolve duplicates first."
      : `Creates jobs for lines ${readyLines.map((line) => line.line_number ?? line.id).join(", ")}`;

  useEffect(() => {
    if (focusLineId == null || Number.isNaN(focusLineId)) return;
    const index = draft.line_items.findIndex((item) => item.id === focusLineId);
    if (index < 0) return;
    setHighlightedIndex(index);
    setOpenIndex(index);
    setMatcherIndex(index);
    setReturnNonce((n) => n + 1);
    onFocusConsumed?.();
  }, [focusLineId, draft.line_items, onFocusConsumed]);

  useEffect(() => {
    if (!attentionTick) return;
    const index = firstNeedsAttentionIndex(po, draft.line_items);
    setHighlightedIndex(index);
    setOpenIndex(index);
  }, [attentionTick, po, draft.line_items]);

  useEffect(() => {
    if (closeDetailsRef) closeDetailsRef.current = () => setOpenIndex(null);
  });

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
    const item = draft.line_items[index];
    if (!item) return;
    const line = lineForItem(po, item);
    if (isLineLocked(line) || isLineCreated(line)) return;
    const line_items = draft.line_items.filter((_, itemIndex) => itemIndex !== index);
    onChangeDraft({ ...draft, line_items });
    const shift = (current: number | null) => {
      if (current == null) return current;
      if (current === index) return null;
      return current > index ? current - 1 : current;
    };
    setHighlightedIndex((current) => shift(current));
    setOpenIndex((current) => shift(current));
    setMatcherIndex((current) => shift(current));
  };

  const usePartAndClose = (index: number, part: PartCandidate) => {
    void onUsePart(index, part);
    setMatcherIndex(null);
  };

  const toggleOpen = (index: number) => {
    setHighlightedIndex(index);
    setOpenIndex((current) => (current === index ? null : index));
    if (openIndex !== index) setMatcherIndex(null);
  };

  return (
    <Card className="@container min-w-0">
      <CardHeader className="flex-wrap gap-2">
        <CardTitle>Lines</CardTitle>
        <span className="font-mono text-xs tabular-nums opacity-80">
          {lineLabel} · {jobLabel} · {readyLabel}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="hidden md:inline">
            <CertAllCheckbox po={po} disabled={disabled} onRun={onRun} />
          </span>
          <Button type="button" variant="outline" size="sm" className="hidden min-h-11 md:inline-flex md:min-h-0" disabled={disabled} onClick={addItem}>
            <Plus className="h-3.5 w-3.5" />
            Add line
          </Button>
          {confirmed && onCreateReadyJobs ? (
            <Button
              type="button"
              size="sm"
              disabled={disabled || readyCount === 0}
              title={readyTitle}
              onClick={onCreateReadyJobs}
              onMouseEnter={() => setPreviewReady(true)}
              onMouseLeave={() => setPreviewReady(false)}
              onFocus={() => setPreviewReady(true)}
              onBlur={() => setPreviewReady(false)}
            >
              Create all ready jobs ({readyCount})
            </Button>
          ) : null}
        </div>
      </CardHeader>
      {draft.line_items.length === 0 ? (
        <p className="px-4 py-6 text-[13px] text-muted">No line items yet.</p>
      ) : (
        <div>
          <LinesGrid
            po={po}
            draft={draft}
            disabled={disabled}
            confirmed={confirmed}
            skStatus={skStatus}
            previewReady={previewReady}
            highlightedIndex={highlightedIndex}
            openIndex={openIndex}
            matcherIndex={matcherIndex}
            remountMatcher={matcherIndex != null ? `return-${matcherIndex}-${returnNonce}` : undefined}
            saveTick={saveTick}
            stacked={stackedView}
            onHighlight={setHighlightedIndex}
            onToggleOpen={toggleOpen}
            onToggleMatcher={(index) => {
              const line = lineForItem(po, draft.line_items[index]);
              if (line && !line.resolved_part_number) {
                setMatcherIndex(index);
                setOpenIndex(index);
                return;
              }
              setMatcherIndex((current) => (current === index ? null : index));
              setOpenIndex(index);
            }}
            onUpdate={updateItem}
            onRemove={removeItem}
            onUsePart={usePartAndClose}
            onBeforeCreatePart={onBeforeCreatePart}
            onRun={onRun}
            onError={onError}
            onNotice={onNotice}
            onAskPrint={onAskPrint}
            onSave={onSave}
            onChangePo={onChangePo}
          />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2 border-t border-rule-soft px-3 py-2 md:hidden">
        <CertAllCheckbox po={po} disabled={disabled} onRun={onRun} />
        <Button type="button" variant="outline" size="sm" className="min-h-11" disabled={disabled} onClick={addItem}>
          <Plus className="h-3.5 w-3.5" />
          Add line
        </Button>
      </div>
    </Card>
  );
}

function useStackedLayout() {
  const [stacked, setStacked] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(max-width: 767px)").matches : false,
  );
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const onChange = () => setStacked(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return stacked;
}
