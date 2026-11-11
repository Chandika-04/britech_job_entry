import { useState } from "react";
import { Printer, Truck } from "lucide-react";

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
}: {
  po: PoDetail;
  disabled?: boolean;
  onChangePo: (po: PoDetail) => void;
  onError: (message: string | null) => void;
  onNotice: (message: string | null) => void;
}) {
  const { initials, ensureInitials } = usePreparedBy();
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState<{ shipNumber: string; intro?: string } | null>(null);

  const shipperNumber = po.shipper_number;
  const lineCount = po.line_items.length;

  const createOrAttach = async () => {
    const attaching = Boolean(shipperNumber);
    let preparedBy = initials;
    if (!attaching) {
      preparedBy = await ensureInitials();
      if (!preparedBy) return;
    }
    const confirmed = attaching
      ? window.confirm(`Add the remaining jobs to shipper ${shipperNumber}, then print it?`)
      : window.confirm("Create one shipper for all jobs on this PO, then print it?");
    if (!confirmed) return;
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
        size="sm"
        variant="outline"
        disabled
        title={`Create every job first (${po.jobs_created_count} of ${lineCount} done). Skipped lines count as not done.`}
      >
        <Truck className="h-3.5 w-3.5" />
        Create shipper and print
      </Button>
    );
  } else if (!shipperNumber) {
    button = (
      <Button type="button" size="sm" disabled={disabled || busy} onClick={() => void createOrAttach()}>
        <Truck className="h-3.5 w-3.5" />
        {busy ? "Creating…" : "Create shipper and print"}
      </Button>
    );
  } else if (po.shipper_needs_attach) {
    button = (
      <Button type="button" size="sm" disabled={disabled || busy} onClick={() => void createOrAttach()}>
        <Truck className="h-3.5 w-3.5" />
        {busy ? "Adding…" : `Add to shipper ${shipperNumber} and print`}
      </Button>
    );
  } else {
    button = (
      <Button type="button" size="sm" variant="outline" onClick={() => setPrinting({ shipNumber: shipperNumber })}>
        <Printer className="h-3.5 w-3.5" />
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
