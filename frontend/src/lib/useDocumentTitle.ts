import { createContext, useContext, useEffect } from "react";

export const UnreviewedCountContext = createContext<number | null>(null);

export function useDocumentTitle(parts: Array<string | null | undefined>) {
  const count = useContext(UnreviewedCountContext);
  const label = parts.map((part) => (part || "").trim()).filter(Boolean).join(" – ") || "Job Entry";
  const prefix = count && count > 0 ? `(${count}) ` : "";
  useEffect(() => {
    document.title = `${prefix}${label}`;
  }, [prefix, label]);
}
