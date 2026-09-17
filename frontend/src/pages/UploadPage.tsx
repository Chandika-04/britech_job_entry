import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function UploadPage() {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold">Upload a purchase order</h1>
      <p className="text-slate-600">
        Scan the paper PO with Genius Scan, Adobe Scan, or Microsoft Lens, then upload the PDF here.
      </p>
      <Card>
        <CardHeader>
          <CardTitle>PDF file</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <label className="flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-4 text-center">
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <span className="text-base font-semibold">{file ? file.name : "Tap to choose a PDF"}</span>
            <span className="mt-1 text-sm text-slate-500">PDF only. Typical POs are 1–3 pages.</span>
          </label>
          {error ? <div className="rounded-xl bg-red-50 p-3 text-red-800">{error}</div> : null}
          <Button className="w-full" size="lg" disabled={busy} onClick={onUpload}>
            {busy ? "Uploading…" : "Upload and extract"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
