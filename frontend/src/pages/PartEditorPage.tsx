import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

import { api } from "@/api/client";
import { CertPicker } from "@/components/po/CertPicker";
import { CustomerCodeField } from "@/components/po/CustomerCodeField";
import { OperationsEditor } from "@/components/po/OperationsEditor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { pictureFileName } from "@/lib/partPath";
import { cn } from "@/lib/utils";
import type { OperationRow, PartEditor, PartPicture } from "@/types/po";

const PART_MAX = 30;
const REV_MAX = 5;
const DESC_MAX = 75;

function partsBack(state: unknown): string | null {
  if (!state || typeof state !== "object" || !("from" in state)) return null;
  if ((state as { from?: string }).from !== "parts") return null;
  const search = (state as { listSearch?: string }).listSearch;
  return `/parts${search || ""}`;
}

function takeParam(params: URLSearchParams, key: string, max: number): { value: string; shortened: boolean } {
  const raw = (params.get(key) ?? "").trim();
  if (raw.length > max) return { value: raw.slice(0, max), shortened: true };
  return { value: raw, shortened: false };
}

function pickPicture(pictures: PartPicture[]): PartPicture | null {
  if (!pictures.length) return null;
  return pictures.find((row) => row.print_on_trav) ?? pictures[0];
}

function UnsavedBadge({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium normal-case tracking-normal text-amber-900">
      Unsaved changes
    </span>
  );
}

export function PartEditorPage() {
  const { pmLinkId } = useParams<{ pmLinkId: string }>();
  const [params] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const isNew = !pmLinkId;
  const backToParts = partsBack(location.state);
  const returnPo = (params.get("returnPo") ?? "").trim();
  const returnLine = (params.get("returnLine") ?? "").trim();
  const backToPo = returnPo ? `/po/${returnPo}${returnLine ? `?line=${encodeURIComponent(returnLine)}` : ""}` : null;

  const [part, setPart] = useState<PartEditor | null>(null);
  const [ops, setOps] = useState<OperationRow[]>([]);
  const [partNumber, setPartNumber] = useState("");
  const [partRevision, setPartRevision] = useState("-");
  const [customerCode, setCustomerCode] = useState("");
  const [description, setDescription] = useState("");
  const [holdNote, setHoldNote] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [shortened, setShortened] = useState<{ part?: boolean; rev?: boolean; desc?: boolean }>({});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);

  const load = async (id = pmLinkId) => {
    if (!id) return;
    const result = await api.getPart(id);
    setPart(result);
    setOps(result.operations);
    setPartNumber(result.part_number);
    setPartRevision(result.part_revision || "-");
    setCustomerCode(result.customer_code || "");
    setDescription(result.description || "");
    setHoldNote(result.quality_hold_note || "");
    setPreviewFailed(false);
  };

  useEffect(() => {
    if (isNew) {
      const partField = takeParam(params, "part", PART_MAX);
      const revField = takeParam(params, "rev", REV_MAX);
      const descField = takeParam(params, "desc", DESC_MAX);
      const customer = (params.get("customer") ?? "").trim().slice(0, 15);
      setPartNumber(partField.value);
      setPartRevision(revField.value || "-");
      setCustomerCode(customer);
      setDescription(descField.value);
      setShortened({ part: partField.shortened, rev: revField.shortened, desc: descField.shortened });
      return;
    }
    load().catch((err: Error) => setError(err.message));
  }, [pmLinkId, isNew]);

  const run = async (work: () => Promise<void>, ok?: string) => {
    setBusy(true);
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

  const locked = Boolean(part?.locked);
  const sectionLocked = isNew;
  const controlsOff = busy || locked || sectionLocked;
  const availableCerts = (part?.cert_library ?? []).filter(
    (cert) => !(part?.linked_certs ?? []).some((row) => row.id === cert.id),
  );
  const preview = pickPicture(part?.pictures ?? []);
  const headerDirty = Boolean(
    part &&
      (partNumber !== part.part_number ||
        (partRevision || "-") !== (part.part_revision || "-") ||
        customerCode !== (part.customer_code || "") ||
        description !== (part.description || "")),
  );
  const opsDirty = Boolean(part && JSON.stringify(ops) !== JSON.stringify(part.operations));
  const templates = part?.templates ?? [];

  const createSearch = useMemo(() => {
    const next = new URLSearchParams();
    for (const key of ["part", "rev", "customer", "desc", "returnPo", "returnLine"]) {
      const value = params.get(key);
      if (value) next.set(key, value);
    }
    const qs = next.toString();
    return qs ? `?${qs}` : "";
  }, [params]);

  const copyPath = async (id: number, path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1500);
    } catch {
      setError("Could not copy the path.");
    }
  };

  return (
    <div className="space-y-4">
      <Link
        to={backToPo ?? backToParts ?? "/parts"}
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-accent"
      >
        <ArrowLeft className="h-4 w-4" />
        {backToPo ? "Back to PO" : backToParts ? "Back to parts" : "Back to parts"}
      </Link>
      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
      {notice ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{notice}</p> : null}
      {!isNew && !part ? <p className="text-sm text-muted">Loading part…</p> : null}

      <div className="grid items-stretch gap-3 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex flex-wrap items-baseline gap-x-8 text-[15px] font-semibold normal-case tracking-normal">
              <span>{isNew ? "New part" : `Part ${part?.part_number ?? partNumber}`}</span>
              {part ? <span>Rev {part.part_revision}</span> : null}
              <UnsavedBadge show={!isNew && headerDirty} />
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {part?.locked ? <p className="text-amber-800">This part is locked. ShopKeeper will not accept edits.</p> : null}
            {part?.fa_hold || part?.ship_hold ? (
              <p className="text-muted">
                {part?.fa_hold ? "FA hold is on. " : ""}
                {part?.ship_hold ? "Ship hold is on." : ""}
              </p>
            ) : null}
            <Field label="Part #">
              <Input
                required
                maxLength={PART_MAX}
                disabled={busy || locked}
                value={partNumber}
                autoFocus={isNew}
                onChange={(event) => setPartNumber(event.target.value)}
              />
              {shortened.part ? <p className="mt-1 text-xs text-muted">Shortened to {PART_MAX} characters from the PO.</p> : null}
            </Field>
            <Field label="Rev">
              <Input
                maxLength={REV_MAX}
                disabled={busy || locked}
                value={partRevision}
                onChange={(event) => setPartRevision(event.target.value)}
              />
              {shortened.rev ? <p className="mt-1 text-xs text-muted">Shortened to {REV_MAX} characters from the PO.</p> : null}
            </Field>
            <Field label="Customer">
              <CustomerCodeField value={customerCode} disabled={busy || locked} onChange={setCustomerCode} />
            </Field>
            <Field label="Description">
              <Textarea
                maxLength={DESC_MAX}
                disabled={busy || locked}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
              {shortened.desc ? <p className="mt-1 text-xs text-muted">Shortened to {DESC_MAX} characters from the PO.</p> : null}
            </Field>
            {isNew ? (
              <Button
                disabled={busy || !partNumber.trim() || !customerCode.trim()}
                onClick={() =>
                  run(async () => {
                    const created = await api.createPart({
                      part_number: partNumber.trim(),
                      part_revision: partRevision.trim() || "-",
                      customer_code: customerCode.trim(),
                      description: description.trim() || null,
                    });
                    navigate(`/parts/${created.pm_linkid}${createSearch}`, { replace: true, state: location.state });
                  }, "Part created. You can now add routing, a picture and certificates.")
                }
              >
                Create part
              </Button>
            ) : (
              <Button
                disabled={busy || locked || !headerDirty || !partNumber.trim() || !customerCode.trim()}
                onClick={() =>
                  run(async () => {
                    if (!part) return;
                    const next = await api.savePartHeader(part.pm_linkid, {
                      part_number: partNumber.trim(),
                      part_revision: partRevision.trim() || "-",
                      customer_code: customerCode.trim(),
                      description: description.trim() || null,
                    });
                    setPart(next);
                    setOps(next.operations);
                    setPartNumber(next.part_number);
                    setPartRevision(next.part_revision || "-");
                    setCustomerCode(next.customer_code || "");
                    setDescription(next.description || "");
                  }, "Part details saved.")
                }
              >
                Save part details
              </Button>
            )}
          </CardContent>
        </Card>

        <Card className={cn(sectionLocked && "opacity-50")}>
          <CardHeader>
            <CardTitle>Picture</CardTitle>
          </CardHeader>
          <CardContent className={cn("space-y-3", sectionLocked && "pointer-events-none")}>
            {sectionLocked ? <p className="text-xs text-muted">Create the part first to edit this section.</p> : null}
            <PicturePreview pic={preview} pmLinkId={part?.pm_linkid ?? null} failed={previewFailed} onFail={() => setPreviewFailed(true)} />
            {(part?.pictures ?? []).map((pic) => (
              <div key={pic.id} className="rounded-md border border-rule p-2">
                <p className="text-sm text-ink">{pictureFileName(pic.path) || pic.description || "Picture"}</p>
                <p className="break-all font-mono text-[11px] text-muted">{pic.path}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={controlsOff} onClick={() => void copyPath(pic.id, pic.path)}>
                    {copiedId === pic.id ? "Copied" : "Copy path"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={controlsOff}
                    onClick={() =>
                      run(async () => {
                        if (!part) return;
                        await api.unlinkPartPicture(part.pm_linkid, pic.id);
                        await load();
                      }, "Picture unlinked.")
                    }
                  >
                    Unlink
                  </Button>
                </div>
              </div>
            ))}
            {!sectionLocked && part && (part.pictures.length === 0) ? <p className="text-xs text-muted">No pictures linked.</p> : null}
            <input
              type="file"
              accept="image/*"
              disabled={controlsOff}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file || !part) return;
                run(async () => {
                  await api.uploadPartPicture(part.pm_linkid, file);
                  await load();
                }, "Picture copied to PartPhotos and linked.");
              }}
            />
          </CardContent>
        </Card>
      </div>

      <Card className={cn(sectionLocked && "opacity-50")}>
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center">
            Standard routing
            <UnsavedBadge show={!isNew && opsDirty} />
          </CardTitle>
        </CardHeader>
        <CardContent className={cn("space-y-3", sectionLocked && "pointer-events-none")}>
          {sectionLocked ? <p className="text-xs text-muted">Create the part first to edit this section.</p> : null}
          <p className="text-xs text-muted">Saving part operations does not change jobs that already exist. Fix those on the job page.</p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="h-8 min-w-56 rounded-md border border-rule bg-white px-2 text-sm"
              value={templateId}
              disabled={controlsOff}
              onChange={(event) => setTemplateId(event.target.value)}
              aria-label="Copy from template"
            >
              <option value="">Copy from template…</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.code} — {template.description || "no description"} ({template.step_count})
                </option>
              ))}
            </select>
            <Button
              size="sm"
              variant="outline"
              disabled={controlsOff || !templateId}
              onClick={() => {
                const template = templates.find((row) => String(row.id) === templateId);
                if (!template || !part) return;
                const extra = opsDirty ? " Your unsaved routing edits will be lost." : "";
                if (!window.confirm(`Replace this part's routing with “${template.code}”? Jobs that already exist are not changed.${extra}`)) {
                  return;
                }
                run(async () => {
                  await api.copyPartTemplate(part.pm_linkid, template.id);
                  await load();
                  setTemplateId("");
                }, `Routing replaced from template ${template.code}.`);
              }}
            >
              Use this template
            </Button>
          </div>
          <OperationsEditor operations={ops} workCenters={part?.work_centers ?? []} disabled={controlsOff} onChange={setOps} />
          <Button
            disabled={controlsOff || !opsDirty}
            onClick={() =>
              run(async () => {
                if (!part) return;
                const next = await api.savePartOperations(part.pm_linkid, ops);
                setOps(next);
                await load();
              }, "Part operations saved.")
            }
          >
            Save operations
          </Button>
        </CardContent>
      </Card>

      <div className="grid items-stretch gap-3 lg:grid-cols-2">
        <Card className={cn(sectionLocked && "opacity-50")}>
          <CardHeader>
            <CardTitle>Certificates</CardTitle>
          </CardHeader>
          <CardContent className={cn("space-y-3", sectionLocked && "pointer-events-none")}>
            {sectionLocked ? <p className="text-xs text-muted">Create the part first to edit this section.</p> : null}
            {part && part.linked_certs.length === 0 ? (
              <p className="text-xs text-muted">No certification linked. Choose one to print with the traveler when cert is required.</p>
            ) : null}
            {part?.linked_certs.map((cert) => (
              <div key={cert.id} className="flex items-center justify-between gap-2 rounded-md border border-rule-soft px-3 py-2 text-sm">
                <span>
                  <span className="font-mono font-semibold">{cert.id}</span>
                  <span className="text-muted"> — {cert.description || "no description"}</span>
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={controlsOff}
                  onClick={() =>
                    run(async () => {
                      if (!part) return;
                      await api.unlinkCert(part.pm_linkid, cert.id);
                      await load();
                    }, "Certification unlinked.")
                  }
                >
                  Unlink
                </Button>
              </div>
            ))}
            {!sectionLocked && part && availableCerts.length === 0 ? (
              <p className="text-xs text-muted">
                {part.linked_certs.length > 0 ? "Every ShopKeeper certification is linked." : "No certifications are in ShopKeeper."}
              </p>
            ) : null}
            {!sectionLocked && availableCerts.length > 0 ? (
              <CertPicker
                available={availableCerts}
                disabled={controlsOff}
                onLink={async (id) => {
                  if (!part) return;
                  await api.linkCert(part.pm_linkid, id);
                  await load();
                  setNotice("Certification linked.");
                }}
              />
            ) : null}
          </CardContent>
        </Card>

        <Card className={cn(sectionLocked && "opacity-50")}>
          <CardHeader>
            <CardTitle>Quality hold</CardTitle>
          </CardHeader>
          <CardContent className={cn("space-y-2", sectionLocked && "pointer-events-none")}>
            {sectionLocked ? <p className="text-xs text-muted">Create the part first to edit this section.</p> : null}
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(part?.quality_hold)}
                disabled={controlsOff}
                onChange={(event) =>
                  run(async () => {
                    if (!part) return;
                    await api.setQualityHold(part.pm_linkid, event.target.checked, holdNote);
                    await load();
                  }, event.target.checked ? "Quality hold on." : "Quality hold off.")
                }
              />
              Quality check hold
            </label>
            <Textarea
              disabled={controlsOff}
              placeholder="Hold note"
              value={holdNote}
              onChange={(event) => setHoldNote(event.target.value)}
              onBlur={() => {
                if (!part || holdNote === (part.quality_hold_note || "")) return;
                run(async () => {
                  await api.setQualityHold(part.pm_linkid, part.quality_hold, holdNote);
                  await load();
                }, "Hold note saved.");
              }}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Price matrix</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted">
            Not edited here yet. Once pricing is standardized, contract and matrix prices for this part will live on this card.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function PicturePreview({
  pic,
  pmLinkId,
  failed,
  onFail,
}: {
  pic: PartPicture | null;
  pmLinkId: number | null;
  failed: boolean;
  onFail: () => void;
}) {
  if (!pic || pmLinkId == null) {
    return <img src="/no-image.png" alt="No image available" className="mx-auto max-h-56 max-w-[70%] object-contain" />;
  }
  if (failed) {
    return (
      <div className="space-y-1 text-center">
        <p className="text-sm text-ink">{pictureFileName(pic.path) || "Image"}</p>
        <p className="break-all font-mono text-[11px] text-muted">{pic.path}</p>
        <p className="text-xs text-muted">Image file not found on the PartPhotos share.</p>
      </div>
    );
  }
  return (
    <img
      src={api.partPictureUrl(pmLinkId, pic.id)}
      alt={pic.description || "Part"}
      className="mx-auto max-h-56 max-w-[70%] object-contain"
      onError={onFail}
    />
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span className={cn("w-[6.5rem] shrink-0 pt-1.5 text-[13px] text-ink")}>{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
