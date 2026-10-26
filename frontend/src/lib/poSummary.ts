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
