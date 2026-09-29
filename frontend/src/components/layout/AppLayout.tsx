import { FileUp } from "lucide-react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";

import { cn } from "@/lib/utils";

const tabClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "-mb-px inline-flex h-10 items-center border-b-2 px-3 text-[13px] font-semibold transition-colors",
    isActive ? "border-accent text-accent" : "border-transparent text-muted hover:text-ink",
  );

export function AppLayout() {
  const { pathname } = useLocation();
  return (
    <div className="min-h-dvh bg-page text-ink">
      <header className="sticky top-0 z-20">
        <div className="eng-grid border-b-2 border-accent">
          <div className="mx-auto grid w-[94vw] max-w-[1520px] grid-cols-[1fr_auto_1fr] items-center gap-3 py-2.5">
            <Link to="/" className="flex flex-col leading-tight">
              <span className="text-[15px] font-bold tracking-[0.04em] text-accent">BRITECH</span>
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">Electropolishing</span>
            </Link>
            <div className="text-center text-[13px] font-semibold uppercase tracking-[0.18em] text-ink">Job Entry</div>
            <div className="flex justify-end">
              <Link
                to="/upload"
                className="inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-rule bg-white px-3 text-[13px] font-semibold text-ink hover:border-accent/50 hover:text-accent"
              >
                <FileUp className="h-4 w-4" />
                <span className="hidden sm:inline">Upload PO</span>
              </Link>
            </div>
          </div>
        </div>
        <nav className="border-b border-rule bg-white">
          <div className="mx-auto flex w-[94vw] max-w-[1520px] gap-1">
            <NavLink to="/" className={({ isActive }) => tabClass({ isActive: isActive || pathname.startsWith("/po/") })} end>
              Purchase Orders
            </NavLink>
            <NavLink to="/upload" className={tabClass}>
              Upload
            </NavLink>
          </div>
        </nav>
      </header>
      <main className="mx-auto w-[94vw] max-w-[1520px] py-4 pb-8">
        <Outlet />
      </main>
    </div>
  );
}
