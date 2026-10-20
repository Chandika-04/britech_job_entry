import { FileUp, PenLine } from "lucide-react";
import { Link } from "react-router-dom";

import { Card, CardContent } from "@/components/ui/card";

export function NewPoPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-5 py-8">
      <div>
        <h1 className="text-xl font-semibold">New PO</h1>
        <p className="mt-1 text-[13px] text-muted">How did this purchase order arrive?</p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Link to="/upload" className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          <Card className="h-full min-h-[280px] transition-colors hover:border-accent/50">
            <CardContent className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 p-10 text-center">
              <FileUp className="h-10 w-10 text-accent" />
              <h2 className="text-lg font-semibold">Upload a PDF</h2>
              <p className="text-sm text-muted">Autofill</p>
            </CardContent>
          </Card>
        </Link>
        <Link to="/manual" className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          <Card className="h-full min-h-[280px] transition-colors hover:border-accent/50">
            <CardContent className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 p-10 text-center">
              <PenLine className="h-10 w-10 text-accent" />
              <h2 className="text-lg font-semibold">Type it in</h2>
              <p className="text-sm text-muted">Manual</p>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  );
}
