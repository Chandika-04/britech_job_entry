import { useEffect, useState } from "react";

import { api } from "@/api/client";
import { cn } from "@/lib/utils";

export type PartPreviewTarget = {
  pmLinkId?: number | null;
  partNumber?: string | null;
  partRevision?: string | null;
  label?: string;
  /** false when the list already knows the part has no picture (skips the request). */
  hasPicture?: boolean;
};

type Target = PartPreviewTarget;

function previewUrl(target: Target): string | null {
  if (target.hasPicture === false) return null;
  return api.partPreviewUrl(target);
}

/**
 * Small picture of the highlighted row's part, for the top of the jobs and parts lists.
 * Waits briefly before loading so arrowing quickly through rows does not fetch every picture.
 */
export function PartPreview({ target, className }: { target: Target | null; className?: string }) {
  const wanted = target ? previewUrl(target) : null;
  const [shown, setShown] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setShown(wanted);
      setFailed(false);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [wanted]);

  return (
    <div
      className={cn(
        "flex h-20 w-32 shrink-0 items-center justify-center overflow-hidden rounded-md border border-rule bg-white",
        className,
      )}
      title={target?.label}
    >
      {shown && !failed ? (
        <img
          key={shown}
          src={shown}
          alt={target?.label ? `Part ${target.label}` : "Part"}
          className="max-h-full max-w-full object-contain"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="px-2 text-center text-[11px] leading-tight text-faint">
          {!target ? "Highlight a row to see its part" : !wanted || failed ? "No picture" : ""}
        </span>
      )}
    </div>
  );
}
