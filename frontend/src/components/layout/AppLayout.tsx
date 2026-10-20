import { Plus } from "lucide-react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";

import { PreparedByChip, PreparedByProvider } from "@/components/layout/PreparedBy";
import { jobNavFromPath } from "@/lib/jobNav";
import { cn } from "@/lib/utils";

const tabClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "-mb-px inline-flex h-10 items-center border-b-2 px-3 text-[13px] font-semibold transition-colors",
    isActive ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink",
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
  const isFullList =
    pathname === "/" || pathname.startsWith("/purchase-orders") || pathname === "/shippers" || isPartsList;
  const onShippers = pathname.startsWith("/shippers") || jobNav?.from === "shippers";
  const isWorkList =
    pathname === "/" ||
    pathname.startsWith("/po/") ||
    /^\/manual\/.+/.test(pathname) ||
    jobNav?.from === "po-review";
  const isNewPo = pathname === "/new" || pathname === "/upload" || pathname === "/manual";
  return (
    <div className={cn("flex flex-col bg-page text-ink", isFullList ? "h-dvh overflow-hidden" : "min-h-dvh")}>
      <header className="sticky top-0 z-20">
        <div className="eng-grid border-b-2 border-accent">
          <div className="mx-auto grid w-[94vw] max-w-[1520px] grid-cols-[1fr_auto_1fr] items-center gap-3 py-2.5">
            <Link to="/" className="flex flex-col leading-tight">
              <span className="text-[15px] font-bold tracking-[0.04em] text-accent">BRITECH</span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">Electropolishing</span>
            </Link>
            <div className="text-center text-[13px] font-semibold uppercase tracking-[0.18em] text-ink">Job Entry</div>
            <div className="flex items-center justify-end gap-2">
              <PreparedByChip />
              <Link
                to="/new"
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-[7px] border px-3 text-[13px] font-semibold",
                  isNewPo
                    ? "border-accent bg-accent text-white"
                    : "border-rule bg-white text-ink hover:border-accent/50 hover:text-accent",
                )}
              >
                <Plus className="h-4 w-4" />
                New PO
              </Link>
            </div>
          </div>
        </div>
        <nav className="border-b border-rule bg-white">
          <div className="mx-auto flex w-[94vw] max-w-[1520px] gap-1">
            <NavLink to="/" className={() => tabClass({ isActive: isWorkList })} end>
              Work list
            </NavLink>
            <NavLink
              to={{ pathname: "/purchase-orders", search: "" }}
              className={({ isActive }) =>
                tabClass({ isActive: (isActive || jobNav?.from === "purchase-orders") && !onShippers })
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
          isFullList ? "max-w-none px-4" : "w-[94vw] max-w-[1520px] py-4 pb-8",
        )}
      >
        <Outlet />
      </main>
    </div>
  );
}
