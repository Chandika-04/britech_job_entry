import { useEffect, useState } from "react";

import { api } from "@/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
          <p className="max-w-[80%] break-all text-center font-mono text-[11px] text-muted">{pic.path || "Image could not be displayed."}</p>
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
