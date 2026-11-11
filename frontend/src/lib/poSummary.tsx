import type { MouseEvent, ReactNode } from "react";
import { Link } from "react-router-dom";

import type { JobNavState } from "@/lib/jobNav";
import { cn } from "@/lib/utils";

export function poLabel(poNumber: string): string {
  return poNumber.trim() ? poNumber : "(no PO number)";
}

export function poSummaryPath(customerCode: string, poNumber: string): string {
  const params = new URLSearchParams();
  params.set("customer", customerCode);
  params.set("po", poNumber.trim());
  return `/purchase-orders/detail?${params.toString()}`;
}

export function splitShipperNumbers(value: string | null | undefined): string[] {
  if (!value?.trim()) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function stopRowClick(event: MouseEvent) {
  event.stopPropagation();
}

export function PoLink({
  customer,
  po,
  state,
  className,
  children,
}: {
  customer?: string | null;
  po?: string | null;
  state?: JobNavState;
  className?: string;
  children?: ReactNode;
}) {
  const code = (customer || "").trim();
  const number = po ?? "";
  const label = children ?? poLabel(number);
  if (!code) return <>{label}</>;
  return (
    <Link
      className={cn("text-accent hover:underline", className)}
      to={poSummaryPath(code, number)}
      state={state}
      onClick={stopRowClick}
    >
      {label}
    </Link>
  );
}

export function ShipperLink({
  number,
  state,
  className,
  children,
}: {
  number?: string | null;
  state?: JobNavState;
  className?: string;
  children?: ReactNode;
}) {
  const ship = (number || "").trim();
  if (!ship) return <>{children ?? "—"}</>;
  return (
    <Link
      className={cn("text-accent hover:underline", className)}
      to={`/shippers/${encodeURIComponent(ship)}`}
      state={state}
      onClick={stopRowClick}
    >
      {children ?? ship}
    </Link>
  );
}

export function PoNumberLinks({
  customer,
  poNumbers,
  state,
  className,
}: {
  customer?: string | null;
  poNumbers?: string | null;
  state?: JobNavState;
  className?: string;
}) {
  const pos = splitShipperNumbers(poNumbers);
  if (!pos.length) return "—";
  return (
    <>
      {pos.map((po, index) => (
        <span key={`${po}-${index}`}>
          {index > 0 ? ", " : null}
          <PoLink customer={customer} po={po} state={state} className={className} />
        </span>
      ))}
    </>
  );
}
