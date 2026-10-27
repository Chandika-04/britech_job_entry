import { useEffect, useState } from "react";

import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { printPdfBlob } from "@/lib/printPdf";

export function PrintJobDialog({
  jobNumber,
  certAvailable,
  certRequired = certAvailable,
  onClose,
}: {
  jobNumber: string;
  certAvailable: boolean;
  certRequired?: boolean;
  onClose: () => void;
}) {
  const [traveler, setTraveler] = useState(true);
  const [certification, setCertification] = useState(certAvailable);
  const [mode, setMode] = useState<"print" | "preview">("print");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewUrls, setPreviewUrls] = useState<{ traveler?: string; cert?: string }>({});

  useEffect(() => {
    return () => {
      if (previewUrls.traveler) URL.revokeObjectURL(previewUrls.traveler);
      if (previewUrls.cert) URL.revokeObjectURL(previewUrls.cert);
    };
  }, [previewUrls]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const canGo = traveler || (certAvailable && certification);
  const showingPreview = Boolean(previewUrls.traveler || previewUrls.cert);

  const run = async () => {
    if (!canGo) return;
    setBusy(true);
    setError(null);
    try {
      if (previewUrls.traveler) URL.revokeObjectURL(previewUrls.traveler);
      if (previewUrls.cert) URL.revokeObjectURL(previewUrls.cert);
      const next: { traveler?: string; cert?: string } = {};
      if (traveler) {
        const blob = await api.getTravelerPdf(jobNumber);
        if (mode === "preview") next.traveler = URL.createObjectURL(blob);
        else {
          await printPdfBlob(blob);
          await api.markTravelerPrinted(jobNumber);
        }
      }
      if (certAvailable && certification) {
        const blob = await api.getCertificationPdf(jobNumber);
        if (mode === "preview") next.cert = URL.createObjectURL(blob);
        else await printPdfBlob(blob);
      }
      setPreviewUrls(next);
      if (mode === "print") onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Print failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3">
      <div
        className={cn(
          "flex max-h-[96vh] w-full flex-col overflow-hidden rounded-lg border border-rule bg-white shadow-lg",
          showingPreview ? "max-w-[960px]" : "max-w-xl",
        )}
      >
        <div className="card-header bg-card-header px-4 py-2.5 text-card-header-ink">
          <h3 className="text-sm font-semibold">Traveler documents</h3>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={traveler} onChange={(event) => setTraveler(event.target.checked)} />
            Print traveler
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={certAvailable && certification}
              disabled={!certAvailable}
              onChange={(event) => setCertification(event.target.checked)}
            />
            Print certification
          </label>
          {!certAvailable ? (
            <p className="text-xs text-muted">
              {certRequired
                ? "Link a certification on the part before printing it."
                : "Certification is not required for this job."}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="print-mode" checked={mode === "preview"} onChange={() => setMode("preview")} />
              Print preview
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="print-mode" checked={mode === "print"} onChange={() => setMode("print")} />
              Print
            </label>
          </div>
          {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
          {showingPreview ? (
            <div className="space-y-3">
              {previewUrls.traveler ? (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Traveler</p>
                  <iframe
                    title="Traveler preview"
                    src={`${previewUrls.traveler}#view=FitH`}
                    className="h-[min(78vh,980px)] w-full rounded border border-rule bg-rule-soft"
                  />
                </div>
              ) : null}
              {previewUrls.cert ? (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Certification</p>
                  <iframe
                    title="Certification preview"
                    src={`${previewUrls.cert}#view=FitH`}
                    className="h-[min(78vh,980px)] w-full rounded border border-rule bg-rule-soft"
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-rule-soft px-4 py-3">
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            Close
          </Button>
          <Button disabled={busy || !canGo} onClick={() => void run()}>
            {busy ? "Working…" : mode === "preview" ? "Preview" : "Print"}
          </Button>
        </div>
      </div>
    </div>
  );
}
