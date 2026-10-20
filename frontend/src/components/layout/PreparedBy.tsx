import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  PREPARED_BY_MAX,
  PREPARED_BY_STORAGE_KEY,
  normalizePreparedBy,
  readPreparedBy,
  writePreparedBy,
} from "@/lib/preparedBy";

type Resolver = (value: string | null) => void;

type PreparedByContextValue = {
  initials: string | null;
  ensureInitials: () => Promise<string | null>;
  openEditor: () => void;
};

const PreparedByContext = createContext<PreparedByContextValue | null>(null);

export function usePreparedBy(): PreparedByContextValue {
  const value = useContext(PreparedByContext);
  if (!value) throw new Error("usePreparedBy must be used inside PreparedByProvider");
  return value;
}

export function PreparedByProvider({ children }: { children: ReactNode }) {
  const [initials, setInitials] = useState<string | null>(() => readPreparedBy());
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const initialsRef = useRef(initials);
  const resolverRef = useRef<Resolver | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    initialsRef.current = initials;
  }, [initials]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== PREPARED_BY_STORAGE_KEY) return;
      setInitials(readPreparedBy());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const persist = useCallback((value: string) => {
    const next = writePreparedBy(value);
    setInitials(next || null);
    return next || null;
  }, []);

  const close = useCallback((value: string | null) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setOpen(false);
    setError(null);
    resolve?.(value);
  }, []);

  const openEditor = useCallback(() => {
    setDraft(initialsRef.current ?? "");
    setError(null);
    setOpen(true);
  }, []);

  const ensureInitials = useCallback(() => {
    if (initialsRef.current) return Promise.resolve(initialsRef.current);
    openEditor();
    return new Promise<string | null>((resolve) => {
      resolverRef.current?.(null);
      resolverRef.current = resolve;
    });
  }, [openEditor]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(null);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const save = () => {
    const next = normalizePreparedBy(draft);
    if (!next) {
      setError("Enter your initials.");
      return;
    }
    close(persist(next));
  };

  return (
    <PreparedByContext.Provider value={{ initials, ensureInitials, openEditor }}>
      {children}
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3">
          <div className="w-full max-w-sm rounded-lg border border-rule bg-white p-4 shadow-lg">
            <h2 className="text-[15px] font-semibold text-ink">Prepared by</h2>
            <p className="mt-1 text-sm text-muted">
              Enter your initials. This browser keeps them and uses them on every shipper you create until you
              change them.
            </p>
            <form
              className="mt-3 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                save();
              }}
            >
              <Input
                ref={inputRef}
                value={draft}
                maxLength={PREPARED_BY_MAX}
                autoComplete="off"
                spellCheck={false}
                placeholder="CR"
                onChange={(event) => {
                  setDraft(normalizePreparedBy(event.target.value));
                  setError(null);
                }}
              />
              {error ? <p className="text-sm text-red-800">{error}</p> : null}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => close(null)}>
                  Cancel
                </Button>
                <Button type="submit">Save</Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </PreparedByContext.Provider>
  );
}

export function PreparedByChip() {
  const { initials, openEditor } = usePreparedBy();
  return (
    <Button type="button" variant="outline" size="sm" onClick={openEditor} title="Change prepared-by initials">
      {initials ? (
        <>
          <span className="font-normal text-muted">Prepared by</span>
          <span className="font-mono tabular-nums">{initials}</span>
        </>
      ) : (
        "Set initials"
      )}
    </Button>
  );
}
