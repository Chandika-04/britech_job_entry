import { useState } from "react";
import { ArrowLeft, FileUp, X } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type SelectedFile = {
  key: string;
  file: File;
  error?: string;
};

function fileKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export function UploadPage() {
  const navigate = useNavigate();
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [skippedNonPdf, setSkippedNonPdf] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const addFiles = (incoming: FileList | File[]) => {
    const list = Array.from(incoming);
    const pdfs = list.filter(isPdf);
    setSkippedNonPdf(list.length - pdfs.length);
    setError(null);
    setFiles((current) => {
      const seen = new Set(current.map((item) => item.key));
      const added = pdfs
        .filter((file) => !seen.has(fileKey(file)))
        .map((file) => ({ key: fileKey(file), file }));
      return [...current, ...added];
    });
  };

  const removeFile = (key: string) => {
    setFiles((current) => current.filter((item) => item.key !== key));
  };

  const onUpload = async () => {
    if (files.length === 0) {
      setError("Choose a PDF first.");
      return;
    }
    setBusy(true);
    setError(null);
    const remaining: SelectedFile[] = [];
    const succeeded: number[] = [];
    try {
      for (const [index, item] of files.entries()) {
        setProgress(`Uploading ${index + 1} of ${files.length}…`);
        try {
          const result = await api.upload(item.file);
          succeeded.push(result.id);
        } catch (err) {
          remaining.push({
            ...item,
            error: err instanceof Error ? err.message : "Unable to process this PDF.",
          });
        }
      }
      if (remaining.length === 0) {
        if (succeeded.length === 1) {
          navigate(`/po/${succeeded[0]}`);
        } else {
          navigate("/");
        }
        return;
      }
      setFiles(remaining);
      setError(
        succeeded.length
          ? `${succeeded.length} uploaded. ${remaining.length} failed — fix or remove them and try again.`
          : "None of these PDFs could be uploaded.",
      );
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const label =
    files.length === 0
      ? "Drop PDFs here or click to choose"
      : files.length === 1
        ? files[0].file.name
        : `${files.length} purchase orders selected`;

  return (
    <div className="mx-auto max-w-2xl space-y-3">
      <Link to="/new" className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline">
        <ArrowLeft className="h-3.5 w-3.5" />
        New PO
      </Link>
    <Card>
      <CardHeader>
        <CardTitle>Upload a PDF</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[13px] text-muted">
          Scan each paper PO to its own PDF. You can upload several at once — each file becomes one purchase order.
          Extraction runs in the background so you can review another PO while the rest finish.
        </p>
        <label
          className={cn(
            "flex min-h-40 cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 text-center transition-colors",
            dragging ? "border-accent bg-accent-soft" : "border-rule bg-head hover:border-accent/50",
            busy && "pointer-events-none opacity-60",
          )}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            if (!busy) addFiles(event.dataTransfer.files);
          }}
        >
          <input
            type="file"
            accept="application/pdf,.pdf"
            multiple
            disabled={busy}
            className="sr-only"
            onChange={(event) => {
              if (event.target.files) addFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <FileUp className="h-6 w-6 text-accent" />
          <span className={cn("text-[13px] font-semibold", files.length === 1 && "font-mono")}>{label}</span>
          <span className="text-xs text-muted">PDF only, one PO per file. Typical POs are 1–3 pages.</span>
        </label>
        {files.length > 0 ? (
          <ul className="divide-y divide-rule-soft rounded-lg border border-rule">
            {files.map((item) => (
              <li key={item.key} className="flex items-start justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-mono text-[13px]">{item.file.name}</p>
                  {item.error ? <p className="text-xs text-red-700">{item.error}</p> : null}
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded p-1 text-muted hover:bg-rule-soft hover:text-ink disabled:opacity-40"
                  disabled={busy}
                  onClick={() => removeFile(item.key)}
                  aria-label={`Remove ${item.file.name}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {skippedNonPdf > 0 ? (
          <p className="text-[13px] text-amber-900">
            {skippedNonPdf === 1 ? "1 file was skipped because it is not a PDF." : `${skippedNonPdf} files were skipped because they are not PDFs.`}
          </p>
        ) : null}
        {error ? (
          <div className="rounded-lg border border-l-4 border-red-200 border-l-red-500 bg-red-50 px-3 py-1.5 text-[13px] text-red-800">
            {error}
          </div>
        ) : null}
        <div className="flex justify-end">
          <Button className="w-full sm:w-auto" disabled={busy || files.length === 0} onClick={onUpload}>
            {progress ?? (files.length > 1 ? `Upload and extract ${files.length} POs` : "Upload and extract")}
          </Button>
        </div>
      </CardContent>
    </Card>
    </div>
  );
}
