import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowLeft, ArrowUp } from "lucide-react";

import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { readPriceExpiryDays, writePriceExpiryDays } from "@/lib/priceDefaults";
import { cn } from "@/lib/utils";
import { useDocumentTitle } from "@/lib/useDocumentTitle";
import type { CertTemplate, MaterialOption } from "@/types/po";

const CERT_ID_MAX = 30;
const CERT_DESC_MAX = 30;
const MATERIAL_MAX = 40;

function Message({ error, notice }: { error: string | null; notice: string | null }) {
  if (error) return <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>;
  if (notice) {
    return <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{notice}</p>;
  }
  return null;
}

function useRunner() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const run = async (work: () => Promise<void>, ok?: string) => {
    setBusy(true);
    setNotice(null);
    try {
      await work();
      setError(null);
      if (ok) setNotice(ok);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, notice, run, setError };
}

export function AdvancedSettingsPage() {
  useDocumentTitle(["Advanced settings"]);
  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <Link to="/settings" className="inline-flex items-center gap-1 text-sm text-muted hover:text-accent">
        <ArrowLeft className="h-4 w-4" />
        Back to settings
      </Link>
      <div>
        <h1 className="text-xl font-semibold">Advanced settings</h1>
        <p className="mt-1 text-[13px] text-muted">
          Materials and certification templates are shared by everyone; certification templates are saved straight into
          ShopKeeper. The price expiry setting is kept on this computer only.
        </p>
      </div>
      <PriceMatrixCard />
      <MaterialsCard />
      <CertTemplatesCard />
    </div>
  );
}

function PriceMatrixCard() {
  const [expiryDays, setExpiryDays] = useState(() => String(readPriceExpiryDays()));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Price matrix</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <label className="flex flex-wrap items-center gap-2 text-sm">
          New prices expire after
          <Input
            type="number"
            min={1}
            max={3650}
            className="w-24 font-mono"
            value={expiryDays}
            onChange={(event) => setExpiryDays(event.target.value)}
            onBlur={() => {
              const days = Math.round(Number(expiryDays));
              const next = Number.isFinite(days) && days >= 1 && days <= 3650 ? days : readPriceExpiryDays();
              writePriceExpiryDays(next);
              setExpiryDays(String(next));
            }}
          />
          days
        </label>
        <p className="text-[13px] text-muted">
          Fills in the expiry date when you add a price on the part editor. You can still change it on each price. This
          browser keeps the setting on this computer.
        </p>
      </CardContent>
    </Card>
  );
}

function MaterialsCard() {
  const [rows, setRows] = useState<MaterialOption[]>([]);
  const [name, setName] = useState("");
  const { busy, error, notice, run, setError } = useRunner();

  useEffect(() => {
    api
      .listMaterials(true)
      .then(setRows)
      .catch((err: Error) => setError(err.message));
  }, []);

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const ids = rows.map((row) => row.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void run(async () => setRows(await api.reorderMaterials(ids)));
  };

  const add = () => {
    const clean = name.trim();
    if (!clean) return;
    void run(async () => {
      setRows(await api.addMaterial(clean));
      setName("");
    }, `${clean} added.`);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Part materials</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[13px] text-muted">
          The choices in the part editor's Material box, in this order. Hiding a material takes it off the list for new
          choices; parts that already use it keep it.
        </p>
        <Message error={error} notice={notice} />
        <div className="overflow-hidden rounded-md border border-rule">
          <table className="data-table">
            <thead>
              <tr>
                <th>Material</th>
                <th className="w-24">Shown</th>
                <th className="w-40" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id} className={cn(!row.active && "text-muted")}>
                  <td className={cn(!row.active && "line-through")}>{row.name}</td>
                  <td>{row.active ? "Yes" : "Hidden"}</td>
                  <td className="whitespace-nowrap text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Move ${row.name} up`}
                      disabled={busy || index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Move ${row.name} down`}
                      disabled={busy || index === rows.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        run(
                          async () => setRows(await api.setMaterialActive(row.id, !row.active)),
                          row.active ? `${row.name} hidden.` : `${row.name} shown again.`,
                        )
                      }
                    >
                      {row.active ? "Hide" : "Show"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <Input
            className="w-64"
            maxLength={MATERIAL_MAX}
            placeholder="New material, e.g. Titanium"
            value={name}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
          <Button type="submit" disabled={busy || !name.trim()}>
            Add material
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

type CertDraft = { description: string; text: string };

function CertTemplatesCard() {
  const [rows, setRows] = useState<CertTemplate[]>([]);
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<CertDraft>({ description: "", text: "" });
  const [creating, setCreating] = useState(false);
  const [newCert, setNewCert] = useState({ id: "", description: "", text: "" });
  const { busy, error, notice, run, setError } = useRunner();

  const load = () =>
    api
      .listCertTemplates()
      .then(setRows)
      .catch((err: Error) => setError(err.message));
  useEffect(() => {
    void load();
  }, []);

  const open = rows.find((row) => row.id === openId) ?? null;
  const dirty = Boolean(open && (draft.description !== (open.description || "") || draft.text !== open.text));
  const term = search.trim().toLowerCase();
  const shown = term
    ? rows.filter((row) => `${row.id} ${row.description ?? ""} ${row.text}`.toLowerCase().includes(term))
    : rows;

  const openTemplate = (row: CertTemplate) => {
    if (dirty && !window.confirm("Discard your unsaved changes to this template?")) return;
    setOpenId(row.id === openId ? null : row.id);
    setDraft({ description: row.description || "", text: row.text });
  };

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-2">
        <CardTitle>Certification templates</CardTitle>
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setCreating((value) => !value)}>
          {creating ? "Cancel new template" : "New template"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[13px] text-muted">
          The wording printed on a certificate of conformance. Changes save into ShopKeeper and apply to every part that
          uses the template, including certificates ShopKeeper prints. Line breaks and spacing are kept; fonts and colours
          from ShopKeeper are replaced with plain text when you change the wording.
        </p>
        <Message error={error} notice={notice} />

        {creating ? (
          <div className="space-y-2 rounded-md border border-rule p-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                <span className="field-label">Name (ID)</span>
                <Input
                  maxLength={CERT_ID_MAX}
                  placeholder="e.g. ASTM B912-22"
                  value={newCert.id}
                  disabled={busy}
                  onChange={(event) => setNewCert({ ...newCert, id: event.target.value })}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="field-label">Description</span>
                <Input
                  maxLength={CERT_DESC_MAX}
                  value={newCert.description}
                  disabled={busy}
                  onChange={(event) => setNewCert({ ...newCert, description: event.target.value })}
                />
              </label>
            </div>
            <label className="block space-y-1 text-sm">
              <span className="field-label">Wording</span>
              <Textarea
                rows={6}
                className="font-mono text-[13px]"
                value={newCert.text}
                disabled={busy}
                onChange={(event) => setNewCert({ ...newCert, text: event.target.value })}
              />
            </label>
            <Button
              type="button"
              disabled={busy || !newCert.id.trim() || !newCert.text.trim()}
              onClick={() =>
                run(async () => {
                  const next = await api.createCertTemplate({
                    id: newCert.id.trim(),
                    description: newCert.description.trim() || null,
                    text: newCert.text,
                  });
                  setRows(next);
                  setNewCert({ id: "", description: "", text: "" });
                  setCreating(false);
                }, `Template ${newCert.id.trim()} created. Link it to parts in the part editor.`)
              }
            >
              Create template
            </Button>
          </div>
        ) : null}

        <Input
          className="max-w-sm"
          placeholder="Search templates"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="divide-y divide-rule-soft rounded-md border border-rule">
          {shown.map((row) => {
            const isOpen = row.id === openId;
            return (
              <div key={row.id}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-baseline gap-3 px-3 py-2 text-left text-sm hover:bg-accent-soft",
                    isOpen && "bg-accent-soft",
                  )}
                  aria-expanded={isOpen}
                  onClick={() => openTemplate(row)}
                >
                  <span className="font-mono font-semibold">{row.id}</span>
                  <span className="min-w-0 flex-1 truncate text-muted">{row.description || "no description"}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {row.part_count} {row.part_count === 1 ? "part" : "parts"}
                  </span>
                </button>
                {isOpen ? (
                  <div className="space-y-2 border-t border-rule-soft bg-white px-3 py-3">
                    <label className="block max-w-sm space-y-1 text-sm">
                      <span className="field-label">Description</span>
                      <Input
                        maxLength={CERT_DESC_MAX}
                        value={draft.description}
                        disabled={busy}
                        onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                      />
                    </label>
                    <label className="block space-y-1 text-sm">
                      <span className="field-label">Wording</span>
                      <Textarea
                        rows={Math.min(14, Math.max(4, draft.text.split("\n").length + 1))}
                        className="font-mono text-[13px]"
                        value={draft.text}
                        disabled={busy}
                        onChange={(event) => setDraft({ ...draft, text: event.target.value })}
                      />
                    </label>
                    {row.part_count > 0 && draft.text !== row.text ? (
                      <p className="text-xs text-amber-800">
                        Changing the wording changes the certificate for all {row.part_count}{" "}
                        {row.part_count === 1 ? "part" : "parts"} that use this template.
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        disabled={busy || !dirty || !draft.text.trim()}
                        onClick={() =>
                          run(async () => {
                            const next = await api.updateCertTemplate(row.id, {
                              description: draft.description.trim() || null,
                              text: draft.text,
                              rowversion: row.rowversion,
                            });
                            setRows(next);
                            const saved = next.find((item) => item.id === row.id);
                            if (saved) setDraft({ description: saved.description || "", text: saved.text });
                          }, `Template ${row.id} saved.`)
                        }
                      >
                        Save template
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy || !dirty}
                        onClick={() => setDraft({ description: row.description || "", text: row.text })}
                      >
                        Undo changes
                      </Button>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
          {shown.length === 0 ? <p className="px-3 py-2 text-sm text-muted">No templates match.</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}
