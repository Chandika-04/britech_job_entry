import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

import { api } from "@/api/client";
import { CustomerCodeField } from "@/components/po/CustomerCodeField";
import { OperationsEditor } from "@/components/po/OperationsEditor";
import { PartImageCard } from "@/components/po/PartImageCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { OperationRow, PartEditor } from "@/types/po";

function partsBack(state: unknown): string | null {
  if (!state || typeof state !== "object" || !("from" in state)) return null;
  if ((state as { from?: string }).from !== "parts") return null;
  const search = (state as { listSearch?: string }).listSearch;
  return `/parts${search || ""}`;
}

export function PartEditorPage() {
  const { pmLinkId } = useParams<{ pmLinkId: string }>();
  const location = useLocation();
  const backTo = partsBack(location.state);
  const [part, setPart] = useState<PartEditor | null>(null);
  const [ops, setOps] = useState<OperationRow[]>([]);
  const [partNumber, setPartNumber] = useState("");
  const [partRevision, setPartRevision] = useState("-");
  const [customerCode, setCustomerCode] = useState("");
  const [description, setDescription] = useState("");
  const [holdNote, setHoldNote] = useState("");
  const [certId, setCertId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!pmLinkId) return;
    const result = await api.getPart(pmLinkId);
    setPart(result);
    setOps(result.operations);
    setPartNumber(result.part_number);
    setPartRevision(result.part_revision || "-");
    setCustomerCode(result.customer_code || "");
    setDescription(result.description || "");
    setHoldNote(result.quality_hold_note || "");
  };

  useEffect(() => {
    load().catch((err: Error) => setError(err.message));
  }, [pmLinkId]);

  if (!pmLinkId) return null;

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
  const availableCerts = (part?.cert_library ?? []).filter(
    (cert) => !(part?.linked_certs ?? []).some((row) => row.id === cert.id),
  );

  return (
    <div className="space-y-4">
      <Link
        to={(backTo ?? (-1 as never)) as never}
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-accent"
      >
        <ArrowLeft className="h-4 w-4" />
        {backTo ? "Back to parts" : "Back"}
      </Link>
      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
      {notice ? <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">{notice}</p> : null}
      {part ? (
        <>
          <div className="grid items-stretch gap-3 lg:grid-cols-2">
            <div className="flex min-h-0 flex-col gap-3">
              <Card>
                <CardHeader>
                  <CardTitle className="flex flex-wrap items-baseline gap-x-8 text-[15px] font-semibold normal-case tracking-normal">
                    <span>Part {part.part_number}</span>
                    <span>Rev {part.part_revision}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {part.locked ? <p className="text-amber-800">This part is locked. ShopKeeper will not accept edits.</p> : null}
                  {part.fa_hold || part.ship_hold ? (
                    <p className="text-muted">
                      {part.fa_hold ? "FA hold is on. " : ""}
                      {part.ship_hold ? "Ship hold is on." : ""}
                    </p>
                  ) : null}
                  <Field label="Part #">
                    <Input
                      maxLength={30}
                      disabled={busy || locked}
                      value={partNumber}
                      onChange={(event) => setPartNumber(event.target.value)}
                    />
                  </Field>
                  <Field label="Rev">
                    <Input
                      maxLength={5}
                      disabled={busy || locked}
                      value={partRevision}
                      onChange={(event) => setPartRevision(event.target.value)}
                    />
                  </Field>
                  <Field label="Customer">
                    <CustomerCodeField value={customerCode} disabled={busy || locked} onChange={setCustomerCode} />
                  </Field>
                  <Field label="Description">
                    <Textarea
                      maxLength={75}
                      disabled={busy || locked}
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                    />
                  </Field>
                  <Button
                    disabled={busy || locked || !partNumber.trim() || !customerCode.trim()}
                    onClick={() =>
                      run(async () => {
                        const next = await api.savePartHeader(part.pm_linkid, {
                          part_number: partNumber.trim(),
                          part_revision: partRevision.trim() || "-",
                          customer_code: customerCode.trim(),
                          description: description.trim() || null,
                        });
                        setPart(next);
                        setPartNumber(next.part_number);
                        setPartRevision(next.part_revision || "-");
                        setCustomerCode(next.customer_code || "");
                        setDescription(next.description || "");
                      }, "Part details saved.")
                    }
                  >
                    Save part details
                  </Button>
                </CardContent>
              </Card>
              <Card className="flex-1">
                <CardHeader>
                  <CardTitle>Picture</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {part.pictures.length === 0 ? <p className="text-xs text-muted">No pictures linked.</p> : null}
                  <div className="grid gap-3 sm:grid-cols-2">
                    {part.pictures.map((pic) => (
                      <div key={pic.id} className="rounded-md border border-rule p-2">
                        <img
                          alt={pic.description || "Part"}
                          className="mb-2 max-h-40 w-full object-contain"
                          src={api.partPictureUrl(part.pm_linkid, pic.id)}
                        />
                        <p className="truncate font-mono text-[11px] text-muted">{pic.path}</p>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy || locked}
                          onClick={() =>
                            run(async () => {
                              await api.unlinkPartPicture(part.pm_linkid, pic.id);
                              await load();
                            }, "Picture unlinked.")
                          }
                        >
                          Unlink
                        </Button>
                      </div>
                    ))}
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    disabled={busy || locked}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = "";
                      if (!file) return;
                      run(async () => {
                        await api.uploadPartPicture(part.pm_linkid, file);
                        await load();
                      }, "Picture copied to PartPhotos and linked.");
                    }}
                  />
                </CardContent>
              </Card>
            </div>
            <PartImageCard pictures={part.pictures} pmLinkId={part.pm_linkid} />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Standard routing</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted">Saving part operations does not change jobs that already exist. Fix those on the job page.</p>
              <OperationsEditor operations={ops} workCenters={part.work_centers} disabled={busy || locked} onChange={setOps} />
              <Button
                disabled={busy || locked}
                onClick={() =>
                  run(async () => {
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
          <Card>
            <CardHeader>
              <CardTitle>Certificates</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {part.linked_certs.length === 0 ? (
                <p className="text-xs text-muted">No certification linked. Choose one to print with the traveler when cert is required.</p>
              ) : (
                <ul className="space-y-2">
                  {part.linked_certs.map((cert) => (
                    <li
                      key={cert.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-rule-soft px-3 py-2 text-sm"
                    >
                      <span>
                        <span className="font-mono font-semibold">{cert.id}</span>
                        <span className="text-muted"> — {cert.description || "no description"}</span>
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy || locked}
                        onClick={() =>
                          run(async () => {
                            await api.unlinkCert(part.pm_linkid, cert.id);
                            await load();
                          }, "Certification unlinked.")
                        }
                      >
                        Unlink
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {availableCerts.length === 0 ? (
                <p className="text-xs text-muted">
                  {part.linked_certs.length > 0
                    ? "Every ShopKeeper certification is linked."
                    : "No certifications are in ShopKeeper."}
                </p>
              ) : (
                <div className="space-y-2">
                  <select
                    className="h-8 w-full rounded-md border border-rule bg-white px-2 text-sm"
                    value={certId}
                    disabled={busy || locked}
                    aria-label="Link a certification"
                    onChange={(event) => setCertId(event.target.value)}
                  >
                    <option value="">Link a certification…</option>
                    {availableCerts.map((cert) => (
                      <option key={cert.id} value={cert.id}>
                        {cert.id}
                        {cert.description ? ` — ${cert.description}` : ""}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    disabled={busy || locked || !certId}
                    onClick={() => {
                      const chosen = certId;
                      if (!chosen) return;
                      run(async () => {
                        await api.linkCert(part.pm_linkid, chosen);
                        setCertId("");
                        await load();
                      }, "Certification linked.");
                    }}
                  >
                    Link
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Quality hold</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={part.quality_hold}
                  disabled={busy || locked}
                  onChange={(event) =>
                    run(async () => {
                      await api.setQualityHold(part.pm_linkid, event.target.checked, holdNote);
                      await load();
                    }, event.target.checked ? "Quality hold on." : "Quality hold off.")
                  }
                />
                Quality check hold
              </label>
              <Textarea
                disabled={busy || locked}
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
          <Card>
            <CardHeader>
              <CardTitle>Price matrix</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted">
                Not edited here yet. Once pricing is standardized, contract and matrix prices for this part will
                live on this card.
              </p>
            </CardContent>
          </Card>
        </>
      ) : (
        <p className="text-sm text-muted">Loading part…</p>
      )}
    </div>
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
