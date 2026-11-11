const PREFIX = "tab:";

export const LIST_TAB_PATHS = ["/", "/purchase-orders", "/shippers", "/parts"] as const;

export function tabStorageKey(path: string): string {
  return `${PREFIX}${path}`;
}

export function readTabSearch(path: string): string {
  try {
    return sessionStorage.getItem(tabStorageKey(path)) ?? "";
  } catch {
    return "";
  }
}

export function writeTabSearch(path: string, search: string): void {
  try {
    sessionStorage.setItem(tabStorageKey(path), search);
  } catch {
    /* ignore quota / private mode */
  }
}

export function isListTabPath(path: string): boolean {
  return (LIST_TAB_PATHS as readonly string[]).includes(path);
}
