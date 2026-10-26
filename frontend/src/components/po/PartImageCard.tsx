import { useEffect, useState } from "react";

import { api } from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { pictureFileName } from "@/lib/partPath";
import type { PartPicture } from "@/types/po";

function pickPicture(pictures: PartPicture[]): PartPicture | null {
  if (!pictures.length) return null;
  return pictures.find((row) => row.print_on_trav) ?? pictures[0];
}

export function PartImageCard({ pictures, pmLinkId }: { pictures: PartPicture[]; pmLinkId: number | null }) {
  const pic = pickPicture(pictures);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [pic?.id, pic?.path]);

  return (
    <Card className="flex h-full min-h-[16rem] flex-col">
      <CardHeader>
        <CardTitle>Part image</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 items-center justify-center px-10 py-8">
        {!pic || pmLinkId == null ? (
          <img src="/no-image.png" alt="No image available" className="max-h-56 max-w-[70%] object-contain" />
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
            className="max-h-56 max-w-[70%] object-contain"
            onError={() => setFailed(true)}
          />
        )}
      </CardContent>
    </Card>
  );
}
