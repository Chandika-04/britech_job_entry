// Default expiry for new price-matrix entries, set on the Settings page (kept in this browser).
const EXPIRY_KEY = "britech.priceExpiryDays";
export const DEFAULT_PRICE_EXPIRY_DAYS = 365;

export function readPriceExpiryDays(): number {
  try {
    const value = Number(localStorage.getItem(EXPIRY_KEY));
    return Number.isInteger(value) && value > 0 ? value : DEFAULT_PRICE_EXPIRY_DAYS;
  } catch {
    return DEFAULT_PRICE_EXPIRY_DAYS;
  }
}

export function writePriceExpiryDays(days: number): void {
  try {
    localStorage.setItem(EXPIRY_KEY, String(days));
  } catch {
    // localStorage may be blocked
  }
}

/** Today + days, as YYYY-MM-DD for a date input. */
export function expiryFromToday(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}
