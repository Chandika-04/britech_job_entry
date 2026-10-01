import { ChevronLeft, ChevronRight, ExternalLink, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { useMemo, useState } from "react";

import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";

export function PdfViewer({ poId, pageCount }: { poId: string; pageCount: number }) {
  const pages = Math.max(pageCount, 1);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const src = useMemo(() => api.pageUrl(poId, page), [poId, page]);

  return (
    <Card className="overflow-hidden xl:sticky xl:top-[104px] xl:min-w-[26rem] xl:self-start">
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Original PO</CardTitle>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            disabled={page <= 1}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="px-1.5 font-mono text-xs text-muted tabular-nums">
            {page} / {pages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => setPage((value) => Math.min(pages, value + 1))}
            disabled={page >= pages}
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="mx-1 h-5 w-px bg-rule" />
          <Button type="button" variant="outline" size="icon" onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))} aria-label="Zoom out">
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="w-11 text-center font-mono text-xs text-muted tabular-nums">{Math.round(zoom * 100)}%</span>
          <Button type="button" variant="outline" size="icon" onClick={() => setZoom((value) => Math.min(2.5, value + 0.25))} aria-label="Zoom in">
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" onClick={() => setZoom(1)} aria-label="Reset zoom">
            <RotateCcw className="h-4 w-4" />
          </Button>
          <Button asChild variant="ghost" size="icon" aria-label="Open original PDF">
            <a href={api.attachmentUrl(poId)} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        </div>
      </CardHeader>
      <div className="eng-grid max-h-[calc(100dvh-220px)] min-h-80 overflow-auto p-3">
        <img
          src={src}
          alt={`PO page ${page}`}
          className="mx-auto origin-top border border-rule bg-white shadow-sm"
          style={{ width: `${zoom * 100}%`, maxWidth: "none" }}
        />
      </div>
      {pages > 1 ? (
        <div className="flex gap-1.5 overflow-x-auto border-t border-rule-soft bg-head px-3 py-2">
          {Array.from({ length: pages }, (_, index) => index + 1).map((thumb) => (
            <button
              key={thumb}
              type="button"
              onClick={() => setPage(thumb)}
              className={`relative shrink-0 overflow-hidden rounded border-2 bg-white ${
                thumb === page ? "border-accent" : "border-rule hover:border-accent/40"
              }`}
              aria-label={`Page ${thumb}`}
            >
              <img src={api.pageUrl(poId, thumb)} alt="" className="h-16 w-12 object-cover" />
              <span className="absolute bottom-0 right-0 bg-white/90 px-1 font-mono text-[10px] text-muted">{thumb}</span>
            </button>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
