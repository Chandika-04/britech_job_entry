import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

import { api } from "@/api/client";
import { CustomerCodeField } from "@/components/po/CustomerCodeField";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

function partsBack(state: unknown): string {
  if (state && typeof state === "object" && "listSearch" in state) {
    const search = (state as { listSearch?: string }).listSearch;
    return `/parts${search || ""}`;
  }
  return "/parts";
}

export function NewPartPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const backTo = partsBack(location.state);
  const [partNumber, setPartNumber] = useState("");
  const [partRevision, setPartRevision] = useState("-");
  const [customerCode, setCustomerCode] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const part = await api.createPart({
        part_number: partNumber.trim(),
        part_revision: partRevision.trim() || "-",
        customer_code: customerCode.trim(),
        description: description.trim() || null,
      });
      navigate(`/parts/${part.pm_linkid}`, { state: { from: "parts", listSearch: "" } });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the part.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Link to={backTo} className="inline-flex items-center gap-1 text-sm text-muted hover:text-accent">
        <ArrowLeft className="h-4 w-4" />
        Back to parts
      </Link>
      {error ? <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
      <Card>
        <CardHeader>
          <CardTitle>New part</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={submit}>
            <p className="text-xs text-muted">
              Creates a Production part in ShopKeeper. Revision defaults to <span className="font-mono">-</span>. After
              save, add operations, a traveler picture, and a certification on the next screen.
            </p>
            <Field label="Part #">
              <Input
                required
                maxLength={30}
                value={partNumber}
                onChange={(event) => setPartNumber(event.target.value)}
                autoFocus
              />
            </Field>
            <Field label="Rev">
              <Input maxLength={5} value={partRevision} onChange={(event) => setPartRevision(event.target.value)} />
            </Field>
            <Field label="Customer">
              <CustomerCodeField value={customerCode} onChange={setCustomerCode} />
            </Field>
            <Field label="Description">
              <Textarea
                maxLength={75}
                value={description}
                placeholder="Defaults to the part number if left blank"
                onChange={(event) => setDescription(event.target.value)}
              />
            </Field>
            <Button type="submit" disabled={busy || !partNumber.trim() || !customerCode.trim()}>
              {busy ? "Creating…" : "Create part"}
            </Button>
          </form>
        </CardContent>
      </Card>
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
