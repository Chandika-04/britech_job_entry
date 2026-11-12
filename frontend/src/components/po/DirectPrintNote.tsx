import type { PrintDocKind, PrintStatus } from "@/types/po";

const LABELS: Record<PrintDocKind, string> = {
  traveler: "Traveler",
  certification: "Certification",
  shipper: "Packing list",
};

/**
 * Where Print goes. With direct printing on: a printer picker ("Default" keeps each document's
 * .env printer) and the destination plus sides for each document. Otherwise: the browser print box.
 */
export function DirectPrintNote({
  status,
  kinds,
  printer,
  onPrinter,
  disabled,
}: {
  status: PrintStatus | null | undefined;
  kinds: PrintDocKind[];
  printer: string;
  onPrinter: (printer: string) => void;
  disabled?: boolean;
}) {
  if (status === undefined) return <p className="text-xs text-muted">Checking the printer…</p>;
  if (!status?.enabled) {
    return (
      <p className="text-xs text-muted">
        Print opens the browser's print box{status?.reason ? ` (direct printing is off: ${status.reason})` : ""}.
      </p>
    );
  }
  const defaults = Array.from(new Set(kinds.map((kind) => status.documents[kind].printer)));
  return (
    <div className="space-y-2">
      <label className="flex flex-wrap items-center gap-2 text-sm">
        Printer
        <select
          className="h-8 min-w-56 rounded-md border border-rule bg-white px-2 text-sm"
          value={printer}
          disabled={disabled}
          onChange={(event) => onPrinter(event.target.value)}
          aria-label="Printer"
        >
          <option value="">Default ({defaults.join(" / ")})</option>
          {status.printers.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <ul className="space-y-0.5 rounded-md border border-rule-soft bg-head px-3 py-2 text-xs text-ink">
        {kinds.map((kind) => {
          const doc = status.documents[kind];
          return (
            <li key={kind}>
              <span className="font-semibold">{LABELS[kind]}</span> → {printer || doc.printer}, {doc.description}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
