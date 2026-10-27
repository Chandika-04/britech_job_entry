import { Plus, Settings } from "lucide-react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";

import { PreparedByChip, PreparedByProvider } from "@/components/layout/PreparedBy";
import { jobNavFromPath } from "@/lib/jobNav";
import { cn } from "@/lib/utils";

const tabClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "-mb-px inline-flex h-10 items-center border-b-2 px-3 text-[13px] font-semibold transition-colors",
    isActive ? "border-accent text-accent-text" : "border-transparent text-muted hover:text-ink",
  );

export function AppLayout() {
  return (
    <PreparedByProvider>
      <AppShell />
    </PreparedByProvider>
  );
}

function AppShell() {
  const location = useLocation();
  const { pathname } = location;
  const jobNav = jobNavFromPath(pathname, location.state);
  const isPartsList = pathname === "/parts";
  const onParts = pathname === "/parts" || pathname.startsWith("/parts/");
  const isPoSummary = pathname === "/purchase-orders/detail";
  const isFullList =
    pathname === "/" || pathname.startsWith("/purchase-orders") || pathname === "/shippers" || isPartsList;
  const onShippers = pathname.startsWith("/shippers") || jobNav?.from === "shippers";
  const isWorkList =
    pathname === "/" ||
    pathname.startsWith("/po/") ||
    /^\/manual\/.+/.test(pathname) ||
    jobNav?.from === "po-review";
  const isNewPo = pathname === "/new" || pathname === "/upload" || pathname === "/manual";
  const isSettings = pathname === "/settings";
  const isPoReview = /^\/po\/[^/]+$/.test(pathname);
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
            <NavLink to="/" className={() => tabClass({ isActive: isWorkList })} end>
              Work list
            </NavLink>
            <NavLink
              to={{ pathname: "/purchase-orders", search: "" }}
              className={({ isActive }) =>
                tabClass({
                  isActive: (isActive || isPoSummary || jobNav?.from === "purchase-orders" || jobNav?.from === "po-summary") && !onShippers,
                })
              }
            >
              ShopKeeper jobs
            </NavLink>
            <NavLink to="/shippers" className={() => tabClass({ isActive: onShippers })}>
              Shippers
            </NavLink>
            <NavLink to="/parts" className={() => tabClass({ isActive: onParts })}>
              Parts
            </NavLink>
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
