import type { PrintDocKind, PrintStatus } from "@/types/po";

const LABELS: Record<PrintDocKind, string> = {
  traveler: "Traveler",
  certification: "Certification",
  shipper: "Packing list",
};

/** Tells the user where Print goes: straight to the shop printer (and how), or the browser print box. */
export function DirectPrintNote({ status, kinds }: { status: PrintStatus | null | undefined; kinds: PrintDocKind[] }) {
  if (status === undefined) return <p className="text-xs text-muted">Checking the printer…</p>;
  if (!status?.enabled) {
    return (
      <p className="text-xs text-muted">
        Print opens the browser's print box{status?.reason ? ` (direct printing is off: ${status.reason})` : ""}.
      </p>
    );
  }
  return (
    <ul className="space-y-0.5 rounded-md border border-rule-soft bg-head px-3 py-2 text-xs text-ink">
      {kinds.map((kind) => {
        const doc = status.documents[kind];
        return (
          <li key={kind}>
            <span className="font-semibold">{LABELS[kind]}</span> → {doc.printer}, {doc.description}
          </li>
        );
      })}
    </ul>
  );
}
