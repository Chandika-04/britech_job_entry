import { FileUp, ClipboardList } from "lucide-react";
import { Link, NavLink, Outlet } from "react-router-dom";

import { cn } from "@/lib/utils";

const navClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold",
    isActive ? "bg-slate-800 text-white" : "text-slate-300 hover:bg-slate-800/70 hover:text-white",
  );

export function AppLayout() {
  return (
    <div className="min-h-dvh bg-slate-100 text-slate-900">
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950 text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="min-h-11 font-semibold tracking-tight">
            PO Extraction
          </Link>
          <nav className="flex items-center gap-1">
            <NavLink to="/" className={navClass} end>
              <ClipboardList className="h-4 w-4" />
              Dashboard
            </NavLink>
            <NavLink to="/upload" className={navClass}>
              <FileUp className="h-4 w-4" />
              Upload
            </NavLink>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 py-4 pb-24 md:pb-8">
        <Outlet />
      </main>
    </div>
  );
}
