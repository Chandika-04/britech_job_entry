import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";

import { api } from "@/api/client";
import { PartPreview } from "@/components/po/PartPreview";
import { FieldSearch } from "@/components/search/FieldSearch";
import { Button } from "@/components/ui/button";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import { useFieldQuery, type FieldSpec } from "@/lib/useFieldQuery";
import { useListKeyboard } from "@/lib/useListKeyboard";
import { cn } from "@/lib/utils";
import type { PartListResponse, PartListRow } from "@/types/po";

const PAGE_SIZE = 300;

const SEARCH_FIELDS: FieldSpec[] = [
  { key: "part", placeholder: "Part number" },
  { key: "customer", placeholder: "Customer", wide: true },
  { key: "description", placeholder: "Description", wide: true },
];

export function PartsPage() {
  useDocumentTitle(["Parts"]);
  const navigate = useNavigate();
  const tableRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<PartListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const search = useFieldQuery(SEARCH_FIELDS);
  const requestKey = `${search.apiQuery}|${search.page}`;

  const reload = useCallback(() => {
    const params = new URLSearchParams(search.apiQuery);
    params.set("page_size", String(PAGE_SIZE));
    params.set("page", String(Number.isFinite(search.page) && search.page > 0 ? search.page : 1));
    return api.listParts(params);
  }, [search.apiQuery, search.page]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    reload()
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setError(null);
          tableRef.current?.scrollTo(0, 0);
        }
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [requestKey, reload]);

  const pageCount = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const rows = data?.items ?? [];
  // Up/Down highlights a part (and shows its picture above), Enter opens the part editor.
  const { active, rowProps, rowClass } = useListKeyboard(
    rows.length,
    (index) => {
      const row = rows[index];
      if (row) navigate(`/parts/${row.pm_linkid}`, { state: { from: "parts", listSearch: search.listSearch } });
    },
    requestKey,
  );
  const activePart = active >= 0 ? rows[active] : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-2 py-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-baseline gap-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.06em] text-ink">Part master</h2>
          {data ? <span className="font-mono text-xs text-muted tabular-nums">{data.total} parts</span> : null}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
          <PartPreview
            className="hidden md:flex"
            target={
              activePart
                ? {
                    pmLinkId: activePart.pm_linkid,
                    hasPicture: activePart.picture_count > 0,
                    label: `${activePart.part_number} rev ${activePart.part_revision || "-"}`,
                  }
                : null
            }
          />
          <FieldSearch fields={SEARCH_FIELDS} values={search.values} onChange={search.setField} onClearAll={search.clearAll} />
          <Button asChild>
            <Link to="/parts/new" state={{ from: "parts", listSearch: search.listSearch }}>
              <Plus className="h-4 w-4" />
              New part
            </Link>
          </Button>
        </div>
      </div>

      {error ? <div className="shrink-0 border border-red-200 bg-red-50 px-4 py-2 text-[13px] text-red-800">{error}</div> : null}

      <div ref={tableRef} className="min-h-0 flex-1 overflow-auto bg-white">
        {loading && !data ? <p className="px-4 py-6 text-[13px] text-muted">Loading…</p> : null}
        {data && data.items.length > 0 ? <PartTable rows={rows} listSearch={search.listSearch} rowProps={rowProps} rowClass={rowClass} /> : null}
        {data && data.items.length === 0 ? (
          <p className="px-4 py-10 text-center text-[13px] text-muted">
            {search.anyFilled ? "No ShopKeeper parts match that search." : "No ShopKeeper parts found."}
          </p>
        ) : null}
      </div>

      {data ? (
        <div className="sticky bottom-0 z-10 flex shrink-0 items-center justify-between border-t border-rule bg-white px-4 py-2">
          <Button variant="outline" size="sm" disabled={search.page <= 1} onClick={() => search.setPage(search.page - 1)}>
            Previous
          </Button>
          <span className="font-mono text-xs text-muted tabular-nums">
            Page {data.page} / {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={data.page * data.page_size >= data.total}
            onClick={() => search.setPage(search.page + 1)}
          >
            Next
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function PartTable({
  rows,
  listSearch,
  rowProps,
  rowClass,
}: {
  rows: PartListRow[];
  listSearch: string;
  rowProps: (index: number) => object;
  rowClass: (index: number) => string | undefined;
}) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Part #</th>
          <th>Rev</th>
          <th>Customer</th>
          <th>Description</th>
          <th className="num">Ops</th>
          <th>Pic</th>
          <th>Cert</th>
          <th>Hold</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={row.pm_linkid} {...rowProps(index)} className={cn(row.inactive && "text-muted", rowClass(index))}>
            <td className="font-mono font-medium">
              <Link
                className="text-accent hover:underline"
                to={`/parts/${row.pm_linkid}`}
                state={{ from: "parts", listSearch }}
              >
                {row.part_number}
              </Link>
              {row.inactive ? <span className="ml-2 text-[11px] uppercase">Inactive</span> : null}
            </td>
            <td className="font-mono">{row.part_revision || "—"}</td>
            <td className="font-mono">{row.customer_code || "—"}</td>
            <td className="max-w-[360px] truncate">{row.description || "—"}</td>
            <td className="num font-mono tabular-nums">{row.operation_count}</td>
            <td>{row.picture_count > 0 ? "Yes" : "—"}</td>
            <td>{row.cert_linked ? "Yes" : "—"}</td>
            <td>{row.quality_hold ? "Hold" : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
