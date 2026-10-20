export const PREPARED_BY_STORAGE_KEY = "britech.preparedBy";
export const PREPARED_BY_MAX = 20;

export function normalizePreparedBy(value: string): string {
  return value.replace(/[^a-zA-Z0-9.-]/g, "").slice(0, PREPARED_BY_MAX).toUpperCase();
}

export function readPreparedBy(): string | null {
  try {
    const value = normalizePreparedBy(localStorage.getItem(PREPARED_BY_STORAGE_KEY) ?? "");
    return value || null;
  } catch {
    return null;
  }
}

export function writePreparedBy(value: string): string {
  const next = normalizePreparedBy(value);
  if (next) localStorage.setItem(PREPARED_BY_STORAGE_KEY, next);
  else localStorage.removeItem(PREPARED_BY_STORAGE_KEY);
  return next;
}
