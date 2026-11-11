import { useEffect, useState, type ReactNode } from "react";
import { Plus, Settings } from "lucide-react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";

import { api } from "@/api/client";
import { PreparedByChip, PreparedByProvider } from "@/components/layout/PreparedBy";
import { jobNavFromPath } from "@/lib/jobNav";
import { isListTabPath, readTabSearch, writeTabSearch } from "@/lib/tabMemory";
import { UnreviewedCountContext } from "@/lib/useDocumentTitle";
import { cn } from "@/lib/utils";

const UNREVIEWED_POLL_MS = 30000;

const tabClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "-mb-px inline-flex h-10 items-center border-b-2 px-3 text-[13px] font-semibold transition-colors",
    isActive ? "border-accent text-accent-text" : "border-transparent text-muted hover:text-ink",
  );

export function AppLayout() {
  return (
    <PreparedByProvider>
      <UnreviewedCountProvider>
        <AppShell />
      </UnreviewedCountProvider>
    </PreparedByProvider>
  );
}

function UnreviewedCountProvider({ children }: { children: ReactNode }) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const load = () => {
      const search = new URLSearchParams();
      search.set("review_state", "unreviewed");
      search.set("page_size", "1");
      api
        .listPos(search)
        .then((result) => {
          if (!cancelled) setCount(result.total);
        })
        .catch(() => undefined);
    };
    const stop = () => {
      if (timer != null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    const start = () => {
      if (timer != null) return;
      timer = window.setInterval(load, UNREVIEWED_POLL_MS);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        load();
        start();
      } else {
        stop();
      }
    };
    load();
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
  return <UnreviewedCountContext.Provider value={count}>{children}</UnreviewedCountContext.Provider>;
}

function TabLink({
  to,
  label,
  isActive,
  onListPage,
}: {
  to: string;
  label: string;
  isActive: boolean;
  onListPage: boolean;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const saved = onListPage ? "" : readTabSearch(to);
  return (
    <NavLink
      to={{ pathname: to, search: saved }}
      end={to === "/"}
      className={() => tabClass({ isActive })}
      onClick={(event) => {
        if (!onListPage) return;
        writeTabSearch(to, "");
        if (location.pathname === to && location.search) {
          event.preventDefault();
          navigate(to);
        }
      }}
    >
      {label}
    </NavLink>
  );
}

function AppShell() {
  const location = useLocation();
  const { pathname } = location;
  const jobNav = jobNavFromPath(pathname, location.state);
  const isPartsList = pathname === "/parts";
  const onParts = pathname === "/parts" || pathname.startsWith("/parts/");
  const isFullList =
    pathname === "/" || pathname.startsWith("/purchase-orders") || pathname === "/shippers" || isPartsList;
  const onShippers = pathname.startsWith("/shippers") || jobNav?.from === "shippers";
  const isWorkList =
    pathname === "/" ||
    pathname.startsWith("/po/") ||
    /^\/manual\/.+/.test(pathname) ||
    jobNav?.from === "po-review" ||
    jobNav?.from === "work-list";
  const isNewPo = pathname === "/new" || pathname === "/upload" || pathname === "/manual";
  const isSettings = pathname === "/settings";
  const isPoReview = /^\/po\/[^/]+$/.test(pathname);

  useEffect(() => {
    if (!isListTabPath(pathname)) return;
    writeTabSearch(pathname, location.search);
  }, [pathname, location.search]);

  return (
    <div className={cn("flex flex-col bg-page text-ink", isFullList ? "h-dvh overflow-hidden" : "min-h-dvh")}>
      <header className="sticky top-0 z-20">
        <div className="eng-grid border-b-2 border-accent">
          <div className="mx-auto grid w-[94vw] max-w-[1520px] grid-cols-[1fr_auto_1fr] items-center gap-3 py-2.5">
            <Link to="/" className="flex flex-col leading-tight">
              <span className="text-[15px] font-bold tracking-[0.04em] text-accent-text">BRITECH</span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">Electropolishing</span>
            </Link>
            <div className="text-center text-[13px] font-semibold uppercase tracking-[0.18em] text-ink">Job Entry</div>
            <div className="flex items-center justify-end gap-2">
              <PreparedByChip />
              <Link
                to="/new"
                aria-label="New PO"
                className={cn(
                  "inline-flex h-11 w-11 items-center justify-center gap-1.5 rounded-[7px] border text-[13px] font-semibold md:h-8 md:w-auto md:px-3",
                  isNewPo
                    ? "border-accent bg-accent text-accent-ink"
                    : "border-rule bg-white text-ink hover:border-accent/50 hover:text-accent-text",
                )}
              >
                <Plus className="h-4 w-4" />
                <span className="hidden md:inline">New PO</span>
              </Link>
              <Link
                to="/settings"
                aria-label="Settings"
                className={cn(
                  "inline-flex h-11 w-11 items-center justify-center rounded-[7px] border md:h-8 md:w-8",
                  isSettings
                    ? "border-accent bg-accent text-accent-ink"
                    : "border-rule bg-white text-ink hover:border-accent/50 hover:text-accent-text",
                )}
              >
                <Settings className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>
        <nav className="border-b border-rule bg-white">
          <div className="mx-auto flex w-[94vw] max-w-[1520px] gap-1 overflow-x-auto">
            <TabLink to="/" label="Work list" isActive={isWorkList} onListPage={pathname === "/"} />
            <TabLink
              to="/purchase-orders"
              label="ShopKeeper jobs"
              isActive={
                (pathname.startsWith("/purchase-orders") ||
                  jobNav?.from === "purchase-orders" ||
                  jobNav?.from === "po-summary") &&
                !onShippers
              }
              onListPage={pathname === "/purchase-orders"}
            />
            <TabLink to="/shippers" label="Shippers" isActive={onShippers} onListPage={pathname === "/shippers"} />
            <TabLink to="/parts" label="Parts" isActive={onParts} onListPage={isPartsList} />
            <NavLink to="/new" className={() => tabClass({ isActive: isNewPo })}>
              New PO
            </NavLink>
          </div>
        </nav>
      </header>
      <main
        className={cn(
          "mx-auto flex min-h-0 w-full flex-1 flex-col",
          isFullList || isPoReview ? "max-w-none px-4" : "w-[94vw] max-w-[1520px] py-4 pb-8",
          isPoReview && "py-4 pb-8",
        )}
      >
        <Outlet />
      </main>
    </div>
  );
}
