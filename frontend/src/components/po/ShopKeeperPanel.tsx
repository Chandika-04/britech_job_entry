import { Fragment, useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";

import { api } from "@/api/client";
import { ErpBadge } from "@/components/po/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { CustomerCandidate, CustomerSuggestion, LineItem, PartCandidate, PoDetail } from "@/types/po";

interface Props {
  po: PoDetail;
  onChange: (po: PoDetail) => void;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  disabled?: boolean;
}

type RunLine = (lineId: string, work: () => Promise<PoDetail>, notice?: string) => Promise<void>;

const MATCH_LABELS: Record<string, string> = {
  alias: "Matched from a previous confirmation",
  exact: "Exact name match",
  contains: "Likely match",
};

function needsAttention(line: LineItem): boolean {
  if (line.erp_status === "created") return false;
  if (line.erp_status === "skipped") return true;
  return (
    line.erp_status !== "ready" ||
    (line.customer_credit_hold && !line.credit_hold_acknowledged) ||
    (line.duplicate_job_numbers.length > 0 && !line.duplicate_acknowledged)
  );
}

export function ShopKeeperPanel({ po, onChange, onError, onNotice, disabled }: Props) {
  const [customerQuery, setCustomerQuery] = useState(po.customer_name || "");
  const [customerMatches, setCustomerMatches] = useState<CustomerCandidate[]>([]);
  const [applyToAll, setApplyToAll] = useState(true);
  const [searchingCustomers, setSearchingCustomers] = useState(false);
  const [busyLine, setBusyLine] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<CustomerSuggestion | null>(null);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(po.line_items.filter(needsAttention).map((line) => line.id)),
  );
  const firstLineId = po.line_items[0]?.id;
  const confirmed = po.review_state === "confirmed";
  const resolvedCodes = Array.from(
    new Set(po.line_items.map((line) => line.resolved_customer_code).filter((code): code is string => Boolean(code))),
  );
  const allResolved = po.line_items.length > 0 && po.line_items.every((line) => line.resolved_customer_code);
  const createdCount = po.line_items.filter((line) => line.erp_status === "created").length;

  useEffect(() => {
    let cancelled = false;
    setSuggestionError(null);
    api
      .suggestCustomer(po.id)
      .then((result) => {
        if (!cancelled) setSuggestion(result);
      })
      .catch((err: Error) => {
        if (!cancelled) setSuggestionError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [po.id, po.customer_name]);

  const run = async (lineId: string | null, work: () => Promise<PoDetail>, notice?: string) => {
    setBusyLine(lineId);
    try {
      const result = await work();
      onChange(result);
      onError("");
      if (notice) onNotice(notice);
    } catch (err) {
      onError(err instanceof Error ? err.message : "ShopKeeper request failed.");
    } finally {
      setBusyLine(null);
    }
  };

  const toggle = (lineId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  };

  const useCustomer = (customerNumber: string) =>
    firstLineId
      ? run(
          firstLineId,
          () => api.resolveCustomer(po.id, firstLineId, customerNumber, applyToAll),
          `Customer ${customerNumber} stored.`,
        )
      : undefined;

  const searchCustomers = async () => {
    setSearchingCustomers(true);
    try {
      const result = await api.lookupCustomers(customerQuery.trim());
      setCustomerMatches(result.matches);
      if (result.matches.length === 0) onError("No ShopKeeper bill-to/both customers matched that search.");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Customer lookup failed.");
    } finally {
      setSearchingCustomers(false);
    }
  };

  return (
    <div>
      <p className="border-b border-rule-soft px-4 py-2 text-xs text-muted">
        Match the PO to an existing ShopKeeper customer and part. The app never creates customers or parts.
        {confirmed ? " Create one job per line after each line is ready." : " Confirm the PO before creating jobs."}
      </p>

      <section className="border-b border-rule-soft px-4 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="section-label">Customer</h3>
          {resolvedCodes.length > 0 ? (
            <span className="text-xs text-muted">
              Stored on {allResolved ? "all lines" : "some lines"}:{" "}
              <span className="font-mono font-semibold text-ink">{resolvedCodes.join(", ")}</span>
            </span>
          ) : null}
        </div>

        <CustomerSuggestionBlock
          suggestion={suggestion}
          error={suggestionError}
          resolvedCodes={resolvedCodes}
          disabled={disabled || !firstLineId}
          onUse={useCustomer}
        />

        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            value={customerQuery}
            disabled={disabled}
            placeholder="Search ShopKeeper by customer number or company"
            onChange={(event) => setCustomerQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && customerQuery.trim()) searchCustomers();
            }}
          />
          <Button type="button" variant="outline" disabled={disabled || searchingCustomers || !customerQuery.trim()} onClick={searchCustomers}>
            Search
          </Button>
          <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" checked={applyToAll} onChange={(event) => setApplyToAll(event.target.checked)} disabled={disabled} />
            Apply to every line
          </label>
        </div>
        {customerMatches.length > 0 ? (
          <CustomerTable
            customers={customerMatches}
            resolvedCodes={resolvedCodes}
            disabled={disabled || !firstLineId}
            onUse={useCustomer}
          />
        ) : null}
      </section>

      <div className="flex items-baseline justify-between px-4 pb-1 pt-3">
        <h3 className="section-label">Jobs by line</h3>
        <span className="font-mono text-xs text-muted tabular-nums">
          {createdCount}/{po.line_items.length} created
        </span>
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="data-table">
          <thead>
            <tr>
              <th className="w-8" aria-label="Expand" />
              <th>Ln</th>
              <th>Extracted part</th>
              <th className="num">Qty</th>
              <th>Due</th>
              <th>Customer</th>
              <th>SK part</th>
              <th>Checks</th>
              <th>Status</th>
              <th>Job #</th>
              <th className="text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {po.line_items.map((line) => {
              const open = expanded.has(line.id);
              const lineDisabled = disabled || busyLine === line.id;
              return (
                <Fragment key={line.id}>
                  <tr className={cn("cursor-pointer hover:bg-head", open && "bg-head [&>td]:border-b-0")} onClick={() => toggle(line.id)}>
                    <td className="text-faint">
                      {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </td>
                    <td className="num">{line.line_number ?? "—"}</td>
                    <td className="whitespace-nowrap font-mono">
                      {line.customer_part_number || <span className="text-faint">—</span>}
                      {line.revision ? <span className="text-muted"> rev {line.revision}</span> : null}
                    </td>
                    <td className="num">{line.quantity ?? "—"}</td>
                    <td className="whitespace-nowrap font-mono text-muted">{line.due_date || "—"}</td>
                    <td className="font-mono">{line.resolved_customer_code || <span className="text-faint">—</span>}</td>
                    <td className="whitespace-nowrap font-mono">
                      {line.resolved_part_number ? (
                        <>
                          {line.resolved_part_number}
                          <span className="text-muted"> rev {line.resolved_part_revision || "—"}</span>
                        </>
                      ) : (
                        <span className="text-faint">—</span>
                      )}
                    </td>
                    <td>
                      <LineChecks line={line} />
                    </td>
                    <td>
                      <ErpBadge status={line.erp_status} />
                    </td>
                    <td className="font-mono font-semibold">{line.erp_job_number || <span className="font-normal text-faint">—</span>}</td>
                    <td className="text-right" onClick={(event) => event.stopPropagation()}>
                      <CreateJobButton po={po} line={line} confirmed={confirmed} disabled={lineDisabled} onRun={run} />
                    </td>
                  </tr>
                  {open ? (
                    <tr className="bg-head">
                      <td />
                      <td colSpan={10} className="pb-3">
                        <LineDetail po={po} line={line} disabled={lineDisabled} onRun={run} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="divide-y divide-rule-soft md:hidden">
        {po.line_items.map((line) => {
          const lineDisabled = disabled || busyLine === line.id;
          return (
            <div key={line.id} className="space-y-2 px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="section-label">Line {line.line_number ?? "—"}</span>
                <ErpBadge status={line.erp_status} />
              </div>
              <p className="font-mono text-xs text-muted">
                {line.customer_part_number || "no part"} rev {line.revision || "—"} · qty {line.quantity ?? "—"} · {line.due_date || "no due date"}
              </p>
              <p className="text-xs">
                Customer <span className="font-mono font-semibold">{line.resolved_customer_code || "—"}</span>
                {" · "}Part{" "}
                <span className="font-mono font-semibold">
                  {line.resolved_part_number ? `${line.resolved_part_number} rev ${line.resolved_part_revision || "—"}` : "—"}
                </span>
              </p>
              <LineDetail po={po} line={line} disabled={lineDisabled} onRun={run} />
              <CreateJobButton po={po} line={line} confirmed={confirmed} disabled={lineDisabled} onRun={run} className="w-full" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LineChecks({ line }: { line: LineItem }) {
  const hold = line.customer_credit_hold && !line.credit_hold_acknowledged;
  const duplicate = line.duplicate_job_numbers.length > 0 && !line.duplicate_acknowledged;
  const failed = Boolean(line.erp_failure_reason) && line.erp_status !== "skipped";
  if (!hold && !duplicate && !failed) return <span className="text-faint">—</span>;
  return (
    <div className="flex gap-1">
      {hold ? <Badge variant="warning">Credit hold</Badge> : null}
      {duplicate ? <Badge variant="warning">Duplicate</Badge> : null}
      {failed ? <Badge variant="failed">Error</Badge> : null}
    </div>
  );
}

function CreateJobButton({
  po,
  line,
  confirmed,
  disabled,
  onRun,
  className,
}: {
  po: PoDetail;
  line: LineItem;
  confirmed: boolean;
  disabled?: boolean;
  onRun: RunLine;
  className?: string;
}) {
  if (line.erp_status === "created" || line.erp_status === "skipped") return null;
  const canCreate = confirmed && line.erp_status === "ready";
  return (
    <Button
      size="sm"
      className={className}
      disabled={disabled || !canCreate}
      onClick={() => onRun(line.id, () => api.createJob(po.id, line.id), "ShopKeeper job created.")}
    >
      Create job
    </Button>
  );
}

function CustomerSuggestionBlock({
  suggestion,
  error,
  resolvedCodes,
  disabled,
  onUse,
}: {
  suggestion: CustomerSuggestion | null;
  error: string | null;
  resolvedCodes: string[];
  disabled?: boolean;
  onUse: (customerNumber: string) => void;
}) {
  if (error) {
    return <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-800">Customer match unavailable: {error}</p>;
  }
  if (!suggestion) {
    return <p className="mt-2 text-xs text-muted">Looking for a matching ShopKeeper customer…</p>;
  }
  if (!suggestion.extracted_name) {
    return <p className="mt-2 text-xs text-muted">No customer name was extracted. Search below.</p>;
  }

  const warning = suggestion.warning ? (
    <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">{suggestion.warning}</p>
  ) : null;

  if (suggestion.customer) {
    return (
      <div className="mt-2 space-y-2">
        {warning}
        <div className="rounded-md border border-emerald-200 border-l-4 border-l-emerald-500 bg-emerald-50/60">
          <p className="px-3 pt-1.5 text-xs text-emerald-900">
            {MATCH_LABELS[suggestion.status] ?? "Suggested match"} for “{suggestion.extracted_name}”
          </p>
          <CustomerTable customers={[suggestion.customer]} resolvedCodes={resolvedCodes} disabled={disabled} onUse={onUse} bare />
        </div>
      </div>
    );
  }

  if (suggestion.candidates.length > 0) {
    return (
      <div className="mt-2 space-y-2">
        {warning}
        <p className="text-xs text-muted">
          {suggestion.status === "ambiguous" ? "Several customers share this name" : "Possible matches"} for “{suggestion.extracted_name}”. Pick one:
        </p>
        <CustomerTable customers={suggestion.candidates} resolvedCodes={resolvedCodes} disabled={disabled} onUse={onUse} />
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      {warning}
      <p className="text-xs text-muted">No ShopKeeper customer matched “{suggestion.extracted_name}”. Search below.</p>
    </div>
  );
}

function CustomerTable({
  customers,
  resolvedCodes,
  disabled,
  onUse,
  bare,
}: {
  customers: CustomerCandidate[];
  resolvedCodes: string[];
  disabled?: boolean;
  onUse: (customerNumber: string) => void;
  bare?: boolean;
}) {
  return (
    <div className={cn("overflow-x-auto", !bare && "mt-2 rounded-md border border-rule")}>
      <table className="data-table">
        {!bare ? (
          <thead>
            <tr>
              <th>Cust #</th>
              <th>Company</th>
              <th>Type</th>
              <th>Flags</th>
              <th aria-label="Action" />
            </tr>
          </thead>
        ) : null}
        <tbody>
          {customers.map((customer) => {
            const selected = resolvedCodes.includes(customer.customer_number);
            return (
              <tr key={customer.customer_number} className={cn(bare && "[&>td]:border-b-0")}>
                <td className="font-mono font-semibold">{customer.customer_number}</td>
                <td>{customer.company || <span className="text-faint">No company name</span>}</td>
                <td className="text-xs text-muted">{customer.record_type}</td>
                <td>
                  <div className="flex gap-1">
                    {customer.credit_hold ? <Badge variant="warning">Credit hold</Badge> : null}
                    {customer.active ? null : <Badge variant="muted">Inactive</Badge>}
                  </div>
                </td>
                <td className="text-right">
                  <Button
                    type="button"
                    size="sm"
                    variant={selected ? "outline" : "default"}
                    disabled={disabled || !customer.active || selected}
                    onClick={() => onUse(customer.customer_number)}
                  >
                    {selected ? "Selected" : "Use"}
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function LineDetail({
  po,
  line,
  disabled,
  onRun,
}: {
  po: PoDetail;
  line: LineItem;
  disabled?: boolean;
  onRun: RunLine;
}) {
  const [partNumber, setPartNumber] = useState(line.customer_part_number || "");
  const [partRevision, setPartRevision] = useState(line.revision || "");
  const [partMatches, setPartMatches] = useState<PartCandidate[]>([]);
  const created = line.erp_status === "created";
  const skipped = line.erp_status === "skipped";

  const searchParts = async () => {
    try {
      const result = await api.lookupParts(partNumber.trim(), partRevision.trim() || undefined);
      setPartMatches(result.matches);
      if (result.matches.length === 0) {
        throw new Error("No active ShopKeeper part matched that number and revision.");
      }
    } catch (err) {
      setPartMatches([]);
      throw err;
    }
  };

  return (
    <div className="space-y-2">
      {line.erp_job_number ? (
        <p className="text-xs text-emerald-800">
          ShopKeeper job <span className="font-mono font-semibold">{line.erp_job_number}</span>
          {line.erp_database ? ` on ${line.erp_database}` : ""}
        </p>
      ) : null}
      {skipped ? (
        <div className="flex flex-col gap-2 rounded-md border border-rule border-l-4 border-l-faint bg-white px-3 py-1.5 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>Skipped{line.erp_failure_reason ? `: ${line.erp_failure_reason}` : "."} Fix the line, then un-skip it to create the job.</span>
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => onRun(line.id, () => api.unskipLine(po.id, line.id), "Line un-skipped.")}>
            Un-skip line
          </Button>
        </div>
      ) : line.erp_failure_reason ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-800">{line.erp_failure_reason}</p>
      ) : null}
      {line.customer_credit_hold && !line.credit_hold_acknowledged ? (
        <div className="flex flex-col gap-2 rounded-md border border-amber-200 border-l-4 border-l-amber-500 bg-amber-50 px-3 py-1.5 text-xs text-amber-950 sm:flex-row sm:items-center sm:justify-between">
          This customer is on credit hold. Confirm before the line can become ready.
          <Button size="sm" disabled={disabled} onClick={() => onRun(line.id, () => api.acknowledgeCreditHold(po.id, line.id), "Credit hold acknowledged.")}>
            Acknowledge credit hold
          </Button>
        </div>
      ) : null}
      {line.duplicate_job_numbers?.length && !line.duplicate_acknowledged && !skipped ? (
        <div className="flex flex-col gap-2 rounded-md border border-amber-200 border-l-4 border-l-amber-500 bg-amber-50 px-3 py-1.5 text-xs text-amber-950 sm:flex-row sm:items-center sm:justify-between">
          <span>
            ShopKeeper already has job <span className="font-mono font-semibold">{line.duplicate_job_numbers.join(", ")}</span> for this PO line.
            Skip this line or confirm it is a genuine new order.
          </span>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" disabled={disabled} onClick={() => onRun(line.id, () => api.acknowledgeDuplicate(po.id, line.id), "Duplicate acknowledged.")}>
              Create new job anyway
            </Button>
            <Button size="sm" variant="outline" disabled={disabled} onClick={() => onRun(line.id, () => api.skipLine(po.id, line.id), "Line skipped.")}>
              Skip line
            </Button>
          </div>
        </div>
      ) : null}

      {!created ? (
        <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2 sm:grid-cols-[minmax(0,16rem)_6rem_auto_1fr] sm:items-end">
          <div className="space-y-1">
            <Label>ShopKeeper part</Label>
            <Input className="font-mono" value={partNumber} disabled={disabled} onChange={(event) => setPartNumber(event.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Rev</Label>
            <Input className="font-mono" value={partRevision} disabled={disabled} onChange={(event) => setPartRevision(event.target.value)} />
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={disabled || !partNumber.trim()}
            onClick={() =>
              onRun(line.id, async () => {
                await searchParts();
                return po;
              })
            }
          >
            Find part
          </Button>
          <div className="col-span-2 flex justify-end gap-2 sm:col-span-1">
            {!skipped ? (
              <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onRun(line.id, () => api.skipLine(po.id, line.id), "Line skipped.")}>
                Skip line
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex justify-end">
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled}
            onClick={() => {
              if (!window.confirm("Reset this line so a new ShopKeeper job can be created? Use this only after the existing job was deleted in ShopKeeper.")) {
                return;
              }
              return onRun(line.id, () => api.resetErp(po.id, line.id), "ERP status reset.");
            }}
          >
            Admin reset
          </Button>
        </div>
      )}

      {partMatches.length > 0 && !created ? (
        <div className="overflow-x-auto rounded-md border border-rule bg-white">
          <table className="data-table">
            <thead>
              <tr>
                <th>Part #</th>
                <th>Rev</th>
                <th>Description</th>
                <th>Type</th>
                <th aria-label="Action" />
              </tr>
            </thead>
            <tbody>
              {partMatches.map((match) => (
                <tr key={`${match.part_number}-${match.part_revision}`}>
                  <td className="font-mono font-semibold">{match.part_number}</td>
                  <td className="font-mono">{match.part_revision}</td>
                  <td>{match.description || <span className="text-faint">No description</span>}</td>
                  <td className="text-xs text-muted">{match.master_type || "—"}</td>
                  <td className="text-right">
                    <Button
                      type="button"
                      size="sm"
                      disabled={disabled}
                      onClick={() =>
                        onRun(
                          line.id,
                          () => api.resolvePart(po.id, line.id, match.part_number, match.part_revision),
                          `Part ${match.part_number} rev ${match.part_revision} stored.`,
                        )
                      }
                    >
                      Use
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
