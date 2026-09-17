import { Minus, Plus, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { useMemo, useState } from "react";

import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function PdfViewer({ poId, pageCount }: { poId: string; pageCount: number }) {
  const pages = Math.max(pageCount, 1);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const src = useMemo(() => api.pageUrl(poId, page), [poId, page]);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle>Original PO</CardTitle>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}>
            <Minus className="h-4 w-4" />
            Prev
          </Button>
          <span className="inline-flex min-h-10 items-center px-2 text-sm font-medium">
            Page {page} / {pages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setPage((value) => Math.min(pages, value + 1))}
            disabled={page >= pages}
          >
            Next
            <Plus className="h-4 w-4" />
          </Button>
          <Button type="button" variant="outline" size="icon" onClick={() => setZoom((value) => Math.min(2.5, value + 0.25))} aria-label="Zoom in">
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button type="button" variant="outline" size="icon" onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))} aria-label="Zoom out">
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button type="button" variant="ghost" size="icon" onClick={() => setZoom(1)} aria-label="Reset zoom">
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-auto rounded-xl bg-slate-200 p-2">
          <img
            src={src}
            alt={`PO page ${page}`}
            className="mx-auto origin-top rounded-lg bg-white shadow"
            style={{ width: `${zoom * 100}%`, maxWidth: "none" }}
          />
        </div>
        {pages > 1 ? (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {Array.from({ length: pages }, (_, index) => index + 1).map((thumb) => (
              <button
                key={thumb}
                type="button"
                onClick={() => setPage(thumb)}
                className={`min-w-16 overflow-hidden rounded-lg border-2 ${
                  thumb === page ? "border-sky-600" : "border-transparent"
                }`}
              >
                <img src={api.pageUrl(poId, thumb)} alt={`Thumbnail ${thumb}`} className="h-20 w-16 object-cover" />
              </button>
            ))}
          </div>
        ) : null}
        <a className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-sky-700" href={api.attachmentUrl(poId)} target="_blank" rel="noreferrer">
          Open original PDF
        </a>
      </CardContent>
    </Card>
  );
}
