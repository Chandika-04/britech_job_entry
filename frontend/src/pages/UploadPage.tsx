import { useState } from "react";
import { FileUp } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function UploadPage() {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const onUpload = async () => {
    if (!file) {
      setError("Choose a PDF first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.upload(file);
      navigate(`/po/${result.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to process this PDF.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>Upload a purchase order</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[13px] text-muted">
          Scan the paper PO with Genius Scan, Adobe Scan, or Microsoft Lens, then upload the PDF here.
        </p>
        <label
          className={cn(
            "flex min-h-40 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 text-center transition-colors",
            dragging ? "border-accent bg-accent-soft" : "border-rule bg-head hover:border-accent/50",
          )}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const dropped = event.dataTransfer.files?.[0];
            if (dropped) setFile(dropped);
          }}
        >
          <input
            type="file"
            accept="application/pdf,.pdf"
            className="sr-only"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <FileUp className="h-6 w-6 text-accent" />
          <span className={cn("text-[13px] font-semibold", file && "font-mono")}>{file ? file.name : "Drop a PDF here or click to choose"}</span>
          <span className="text-xs text-muted">PDF only. Typical POs are 1–3 pages.</span>
        </label>
        {error ? (
          <div className="rounded-lg border border-l-4 border-red-200 border-l-red-500 bg-red-50 px-3 py-1.5 text-[13px] text-red-800">{error}</div>
        ) : null}
        <div className="flex justify-end">
          <Button className="w-full sm:w-auto" disabled={busy || !file} onClick={onUpload}>
            {busy ? "Uploading…" : "Upload and extract"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
