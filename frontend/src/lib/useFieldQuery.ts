import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

export type FieldSpec = {
  key: string;
  placeholder: string;
  wide?: boolean;
  minLength?: number;
};

function snapshot(keys: string[], values: Record<string, string>): string {
  return keys.map((key) => values[key] ?? "").join("\0");
}

function fromParams(keys: string[], params: URLSearchParams): Record<string, string> {
  return Object.fromEntries(keys.map((key) => [key, params.get(key) ?? ""]));
}

export function useFieldQuery(fields: FieldSpec[]) {
  const keys = fields.map((field) => field.key);
  const [params, setParams] = useSearchParams();
  const urlSnapshot = snapshot(keys, fromParams(keys, params));
  const [values, setValues] = useState(() => fromParams(keys, params));
  const writtenRef = useRef(urlSnapshot);

  useEffect(() => {
    if (urlSnapshot !== writtenRef.current) {
      setValues(fromParams(keys, params));
      writtenRef.current = urlSnapshot;
    }
  }, [urlSnapshot, keys, params]);

  const commitRef = useRef<(next: Record<string, string>) => void>(() => undefined);
  commitRef.current = (next) => {
    writtenRef.current = snapshot(keys, next);
    setParams(
      (prev) => {
        const search = new URLSearchParams(prev);
        for (const key of keys) {
          const value = next[key] ?? "";
          if (value.trim()) search.set(key, value);
          else search.delete(key);
        }
        search.delete("q");
        search.delete("search_by");
        search.set("page", "1");
        return search;
      },
      { replace: true },
    );
  };

  const timer = useRef<number>(undefined);
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );

  const setField = (key: string, value: string) => {
    setValues((current) => {
      const next = { ...current, [key]: value };
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => commitRef.current(next), 300);
      return next;
    });
  };

  const clearAll = () => {
    if (timer.current) window.clearTimeout(timer.current);
    const next = Object.fromEntries(keys.map((key) => [key, ""]));
    setValues(next);
    commitRef.current(next);
  };

  // Build the API query from the URL (written 300 ms after typing stops), not from the
  // live box values, so ShopKeeper is queried once per pause instead of once per keystroke.
  const apiSearch = new URLSearchParams();
  for (const field of fields) {
    const trimmed = (params.get(field.key) ?? "").trim();
    if (trimmed.length >= (field.minLength ?? 1)) apiSearch.set(field.key, trimmed);
  }
  const apiQuery = apiSearch.toString();

  return {
    values,
    setField,
    clearAll,
    anyFilled: keys.some((key) => (values[key] ?? "").trim()),
    apiQuery,
    page: Number(params.get("page") ?? "1"),
    setPage: (page: number) => {
      setParams((prev) => {
        const search = new URLSearchParams(prev);
        search.set("page", String(page));
        return search;
      });
    },
    listSearch: params.toString() ? `?${params.toString()}` : "",
  };
}
