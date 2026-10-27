import { useEffect, useState } from "react";

import { api } from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { pictureFileName } from "@/lib/partPath";
import type { PartPicture } from "@/types/po";

function pickPicture(pictures: PartPicture[]): PartPicture | null {
  if (!pictures.length) return null;
  return pictures.find((row) => row.print_on_trav) ?? pictures[0];
}

export function PartImageCard({
  pictures,
  pmLinkId,
  compact,
}: {
  pictures: PartPicture[];
  pmLinkId: number | null;
  compact?: boolean;
}) {
  const pic = pickPicture(pictures);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [pic?.id, pic?.path]);

  const image = !pic || pmLinkId == null ? (
    <img src="/no-image.png" alt="No image available" className={compact ? "max-h-40 max-w-full object-contain" : "max-h-56 max-w-[70%] object-contain"} />
  ) : failed ? (
    <div className="max-w-[80%] space-y-1 text-center">
      <p className="text-sm text-ink">{pictureFileName(pic.path) || "Image"}</p>
      <p className="break-all font-mono text-[11px] text-muted">{pic.path}</p>
      <p className="text-xs text-muted">Image file not found on the PartPhotos share.</p>
    </div>
  ) : (
    <img
      src={api.partPictureUrl(pmLinkId, pic.id)}
      alt={pic.description || "Part"}
      className={compact ? "max-h-40 max-w-full object-contain" : "max-h-56 max-w-[70%] object-contain"}
      onError={() => setFailed(true)}
    />
  );

  if (compact) {
    return (
      <div className="space-y-1.5">
        <p className="field-label">Picture</p>
        <div className="flex min-h-32 items-center justify-center rounded-md border border-rule bg-white p-2">{image}</div>
        {pic ? <p className="truncate font-mono text-[11px] text-muted">{pictureFileName(pic.path) || "Image"}</p> : null}
      </div>
    );
  }

  return (
    <Card className="flex h-full min-h-[16rem] flex-col">
      <CardHeader>
        <CardTitle>Part image</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 items-center justify-center px-10 py-8">{image}</CardContent>
    </Card>
  );
}
