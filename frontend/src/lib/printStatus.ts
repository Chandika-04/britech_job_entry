import { useEffect, useState } from "react";

import { api } from "@/api/client";
import type { PrintStatus } from "@/types/po";

// Fetched once per page load: whether the server prints straight to the shop printer.
let cached: Promise<PrintStatus | null> | null = null;

function loadPrintStatus(): Promise<PrintStatus | null> {
  if (!cached) {
    cached = api.getPrintStatus().catch(() => {
      cached = null; // try again next time a print box opens
      return null;
    });
  }
  return cached;
}

/** `undefined` while loading, `null` if the server could not be asked (falls back to the browser dialog). */
export function usePrintStatus(): PrintStatus | null | undefined {
  const [status, setStatus] = useState<PrintStatus | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void loadPrintStatus().then((value) => {
      if (alive) setStatus(value);
    });
    return () => {
      alive = false;
    };
  }, []);
  return status;
}
