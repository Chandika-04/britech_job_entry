import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { api } from "@/api/client";
import { usePreparedBy } from "@/components/layout/PreparedBy";
import { Button } from "@/components/ui/button";
import { DirectPrintNote } from "@/components/po/DirectPrintNote";
import { printPdfBlob } from "@/lib/printPdf";
import { usePrintStatus } from "@/lib/printStatus";
import { cn } from "@/lib/utils";

export const SHIPPER_COPIES = ["Customer Copy", "Shipping Dept Copy", "Office Copy"] as const;
// Checked when the box opens, until someone picks different copies in this browser.
const DEFAULT_COPIES: string[] = ["Customer Copy", "Shipping Dept Copy"];
const COPIES_KEY = "britech.shipper.copies";

function readCopies(): string[] {
  try {
    const saved = JSON.parse(localStorage.getItem(COPIES_KEY) ?? "null");
    if (Array.isArray(saved)) {
      const valid = SHIPPER_COPIES.filter((copy) => saved.includes(copy));
      if (valid.length) return valid;
    }
  } catch {
    // localStorage may be blocked or hold old data
  }
  return [...DEFAULT_COPIES];
}

function writeCopies(copies: string[]) {
  try {
    localStorage.setItem(COPIES_KEY, JSON.stringify(copies));
  } catch {
    // ignore
  }
}

/** Print the SK055 packing list for a shipper: one page set per chosen copy (Customer / Shipping Dept / Office). */
export function PrintShipperDialog({
  shipNumber,
  intro,
  onClose,
  onPrinted,
}: {
  shipNumber: string;
  intro?: string;
  onClose: () => void;
  onPrinted?: () => void;
}) {
  const { initials, ensureInitials, openEditor } = usePreparedBy();
  const [copies, setCopies] = useState<string[]>(readCopies);
  const [mode, setMode] = useState<"print" | "preview">("print");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const printStatus = usePrintStatus();
  const [printer, setPrinter] = useState(""); // "" = the packing list's default printer

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const toggle = (copy: string, on: boolean) => {
    const next = SHIPPER_COPIES.filter((item) => (item === copy ? on : copies.includes(item)));
    setCopies(next);
    if (next.length) writeCopies(next);
  };

  const run = async () => {
    if (!copies.length) return;
    // "Prepared By" on the sheet is the person printing: the initials saved in this browser.
    const preparedBy = await ensureInitials();
    if (!preparedBy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === "print" && printStatus?.enabled) {
        // Server prints one side to the shop printer and marks the shipper printed in ShopKeeper.
        await api.printShipperDirect(shipNumber, copies, preparedBy, printer || null);
        onPrinted?.();
        onClose();
        return;
      }
      const blob = await api.getShipperPdf(shipNumber, copies, preparedBy);
      if (mode === "preview") {
        setPreviewUrl(URL.createObjectURL(blob));
        return;
      }
      await printPdfBlob(blob);
      // Step 15: Jsm_ShipperPrinted = 1. The print already happened, so a failure here is only a warning.
      try {
        await api.markShipperPrinted(shipNumber);
      } catch (err) {
        setError(
          `Printed, but ShopKeeper was not marked printed: ${err instanceof Error ? err.message : "unknown error"}`,
        );
        onPrinted?.();
        return;
      }
      onPrinted?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Print failed.");
    } finally {
      setBusy(false);
    }
  };

  // Rendered on <body> so a parent with blur/transform (the bottom action bar) cannot pin it in place.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3">
      <div
        className={cn(
          "flex max-h-[96vh] w-full flex-col overflow-hidden rounded-lg border border-rule bg-white shadow-lg",
          previewUrl ? "max-w-[960px]" : "max-w-xl",
        )}
      >
        <div className="card-header bg-card-header px-4 py-2.5 text-card-header-ink">
          <h3 className="text-sm font-semibold">Shipper {shipNumber} · packing list</h3>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
          {intro ? <p className="text-sm text-ink">{intro}</p> : null}
          <fieldset className="space-y-2">
            <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Copies</legend>
            {SHIPPER_COPIES.map((copy) => (
              <label key={copy} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={copies.includes(copy)} onChange={(event) => toggle(copy, event.target.checked)} />
                {copy}
              </label>
            ))}
          </fieldset>
          {!copies.length ? <p className="text-xs text-red-800">Pick at least one copy.</p> : null}
          <p className="text-sm">
            Prepared by:{" "}
            {initials ? <span className="font-mono font-semibold">{initials}</span> : <span className="text-muted">not set</span>}{" "}
            <button type="button" className="text-xs font-semibold text-accent hover:underline" onClick={openEditor}>
              {initials ? "Change" : "Set initials"}
            </button>
          </p>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="shipper-print-mode" checked={mode === "preview"} onChange={() => setMode("preview")} />
              Print preview
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="shipper-print-mode" checked={mode === "print"} onChange={() => setMode("print")} />
              Print
            </label>
          </div>
          {mode === "print" ? (
            <DirectPrintNote
              status={printStatus}
              kinds={["shipper"]}
              printer={printer}
              onPrinter={setPrinter}
              disabled={busy}
            />
          ) : null}
          {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
          {previewUrl ? (
            <iframe
              title="Shipper preview"
              src={`${previewUrl}#view=FitH`}
              className="h-[min(78vh,980px)] w-full rounded border border-rule bg-rule-soft"
            />
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-rule-soft px-4 py-3">
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Close
          </Button>
          <Button disabled={busy || !copies.length || printStatus === undefined} onClick={() => void run()}>
            {busy ? "Working…" : mode === "preview" ? "Preview" : "Print"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
