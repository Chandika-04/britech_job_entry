export type JobNavState = {
  from: "purchase-orders" | "po-review" | "shippers";
  poId?: number;
  shipNumber?: string;
  listSearch?: string;
};

const storageKey = (jobNumber: string) => `job-back:${jobNumber}`;

function isJobNav(value: unknown): value is JobNavState {
  if (!value || typeof value !== "object" || !("from" in value)) return false;
  const from = (value as JobNavState).from;
  return from === "purchase-orders" || from === "po-review" || from === "shippers";
}

export function rememberJobNav(jobNumber: string | undefined, locationState: unknown): JobNavState | null {
  if (isJobNav(locationState)) {
    if (jobNumber) {
      try {
        sessionStorage.setItem(storageKey(jobNumber), JSON.stringify(locationState));
      } catch {
        /* ignore quota / private mode */
      }
    }
    return locationState;
  }
  if (!jobNumber) return null;
  try {
    const raw = sessionStorage.getItem(storageKey(jobNumber));
    return raw ? (JSON.parse(raw) as JobNavState) : null;
  } catch {
    return null;
  }
}

export function jobNavFromPath(pathname: string, locationState: unknown): JobNavState | null {
  const match = pathname.match(/^\/jobs\/([^/]+)/);
  const jobNumber = match ? decodeURIComponent(match[1]) : undefined;
  return rememberJobNav(jobNumber, locationState);
}
