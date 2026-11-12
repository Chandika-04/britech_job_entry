import { useState } from "react";

import { api } from "@/api/client";
import { usePreparedBy } from "@/components/layout/PreparedBy";
import { PrintShipperDialog } from "@/components/po/PrintShipperDialog";
import { Button } from "@/components/ui/button";
import type { PoDetail } from "@/types/po";

/**
 * Shipper button for the PO review / manual entry page. Same rules as the Work list's
 * Create shipper / Add to shipper, plus it opens the packing-list print dialog afterwards.
 */
export function ShipperActions({
  po,
  disabled,
  onChangePo,
  onError,
  onNotice,
  inActionBar = false,
}: {
  po: PoDetail;
  disabled?: boolean;
  /** Sized to match the Save / PO is correct buttons in the page's bottom bar. */
  inActionBar?: boolean;
  onChangePo: (po: PoDetail) => void;
  onError: (message: string | null) => void;
  onNotice: (message: string | null) => void;
}) {
  const { initials, ensureInitials } = usePreparedBy();
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState<{ shipNumber: string; intro?: string } | null>(null);

  const shipperNumber = po.shipper_number;
  const size = inActionBar ? "default" : "sm";
  const barClass = inActionBar ? "min-h-12 flex-1 md:min-h-0 md:flex-none" : undefined;
  const lineCount = po.line_items.length;

  const createOrAttach = async () => {
    const attaching = Boolean(shipperNumber);
    let preparedBy = initials;
    if (!attaching) {
      preparedBy = await ensureInitials();
      if (!preparedBy) return;
    }
    // No confirm popup: the button label says what it does, and the print box that follows can be closed.
    setBusy(true);
    onError(null);
    try {
      const result = await api.createShipper(po.id, attaching ? undefined : preparedBy);
      onChangePo(result);
      const number = result.shipper_number;
      if (!number) throw new Error("ShopKeeper did not return a shipper number.");
      const message = attaching ? `Jobs added to shipper ${number}.` : `Shipper ${number} created.`;
      onNotice(message);
      setPrinting({ shipNumber: number, intro: `${message} Choose the copies to print.` });
    } catch (err) {
      onError(err instanceof Error ? err.message : attaching ? "Could not add jobs to the shipper." : "Could not create shipper.");
    } finally {
      setBusy(false);
    }
  };

  let button;
  if (!po.jobs_complete) {
    button = (
      <Button
        type="button"
        size={size} className={barClass}
        variant="outline"
        disabled
        title={`Create every job first (${po.jobs_created_count} of ${lineCount} done). Skipped lines count as not done.`}
      >
        Create shipper and print
      </Button>
    );
  } else if (!shipperNumber) {
    button = (
      <Button type="button" size={size} className={barClass} disabled={disabled || busy} onClick={() => void createOrAttach()}>
        {busy ? "Creating…" : "Create shipper and print"}
      </Button>
    );
  } else if (po.shipper_needs_attach) {
    button = (
      <Button type="button" size={size} className={barClass} disabled={disabled || busy} onClick={() => void createOrAttach()}>
        {busy ? "Adding…" : `Add to shipper ${shipperNumber} and print`}
      </Button>
    );
  } else {
    button = (
      <Button type="button" size={size} className={barClass} variant="outline" onClick={() => setPrinting({ shipNumber: shipperNumber })}>
        Print shipper {shipperNumber}
      </Button>
    );
  }

  return (
    <>
      {button}
      {printing ? (
        <PrintShipperDialog
          shipNumber={printing.shipNumber}
          intro={printing.intro}
          onClose={() => setPrinting(null)}
          onPrinted={() => onNotice(`Shipper ${printing.shipNumber} printed.`)}
        />
      ) : null}
    </>
  );
}
