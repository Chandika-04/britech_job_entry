import type {
  CustomerLookupResponse,
  CustomerSuggestion,
  PartLookupResponse,
  PoDetail,
  PoDraft,
  PoListResponse,
} from "@/types/po";
import { emptyToNull } from "@/lib/utils";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) {
    let message = "Something went wrong. Please try again.";
    try {
      const body = (await response.json()) as { detail?: string };
      if (body.detail) message = body.detail;
    } catch {
      // keep default
    }
    throw new ApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function toNumberOrNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export function draftToPayload(draft: PoDraft) {
  return {
    po_number: emptyToNull(draft.po_number),
    customer_name: emptyToNull(draft.customer_name),
    order_date: emptyToNull(draft.order_date),
    requested_ship_date: emptyToNull(draft.requested_ship_date),
    buyer_contact: emptyToNull(draft.buyer_contact),
    buyer_notes: emptyToNull(draft.buyer_notes),
    bill_to: emptyToNull(draft.bill_to),
    ship_to: emptyToNull(draft.ship_to),
    line_items: draft.line_items.map((item) => ({
      id: item.id,
      line_number: item.line_number.trim() ? Number(item.line_number) : null,
      customer_part_number: emptyToNull(item.customer_part_number),
      revision: emptyToNull(item.revision),
      description: emptyToNull(item.description),
      quantity: toNumberOrNull(item.quantity),
      unit_price: toNumberOrNull(item.unit_price),
      uom: emptyToNull(item.uom),
      due_date: emptyToNull(item.due_date),
      notes: emptyToNull(item.notes),
    })),
  };
}

export const api = {
  health() {
    return request<{ status: string }>("/api/health");
  },
  listPos(params: URLSearchParams) {
    return request<PoListResponse>(`/api/po?${params.toString()}`);
  },
  getPo(id: number | string) {
    return request<PoDetail>(`/api/po/${id}`);
  },
  async upload(file: File) {
    const body = new FormData();
    body.append("file", file);
    return request<{ id: number; status: string; message: string }>("/api/upload", {
      method: "POST",
      body,
    });
  },
  saveDraft(id: number | string, draft: PoDraft) {
    return request<PoDetail>(`/api/po/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draftToPayload(draft)),
    });
  },
  review(id: number | string, action: "save_draft" | "confirm", draft: PoDraft) {
    return request<PoDetail>(`/api/po/${id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, po: draftToPayload(draft) }),
    });
  },
  reextract(id: number | string) {
    return request<{ id: number; status: string; message: string }>(`/api/po/${id}/reextract`, {
      method: "POST",
    });
  },
  deletePo(id: number | string) {
    return request<{ message: string }>(`/api/po/${id}`, { method: "DELETE" });
  },
  attachmentUrl(id: number | string) {
    return `${API_BASE}/api/po/${id}/attachment`;
  },
  pageUrl(id: number | string, page: number) {
    return `${API_BASE}/api/po/${id}/attachment/page/${page}`;
  },
  lookupCustomers(query: string) {
    const params = new URLSearchParams({ q: query });
    return request<CustomerLookupResponse>(`/api/shopkeeper/customers?${params.toString()}`);
  },
  suggestCustomer(poId: number | string) {
    return request<CustomerSuggestion>(`/api/po/${poId}/customer-suggestion`);
  },
  lookupParts(partNumber: string, partRevision?: string) {
    const params = new URLSearchParams({ part_number: partNumber });
    if (partRevision) params.set("part_revision", partRevision);
    return request<PartLookupResponse>(`/api/shopkeeper/parts?${params.toString()}`);
  },
  resolveCustomer(poId: number | string, lineId: number | string, customerNumber: string, applyToAllLines = true) {
    return request<PoDetail>(`/api/po/${poId}/lines/${lineId}/resolve-customer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customer_number: customerNumber, apply_to_all_lines: applyToAllLines }),
    });
  },
  resolvePart(poId: number | string, lineId: number | string, partNumber: string, partRevision: string) {
    return request<PoDetail>(`/api/po/${poId}/lines/${lineId}/resolve-part`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ part_number: partNumber, part_revision: partRevision }),
    });
  },
  acknowledgeCreditHold(poId: number | string, lineId: number | string) {
    return request<PoDetail>(`/api/po/${poId}/lines/${lineId}/acknowledge-credit-hold`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acknowledge: true }),
    });
  },
  acknowledgeDuplicate(poId: number | string, lineId: number | string) {
    return request<PoDetail>(`/api/po/${poId}/lines/${lineId}/acknowledge-duplicate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acknowledge: true }),
    });
  },
  skipLine(poId: number | string, lineId: number | string, reason?: string) {
    return request<PoDetail>(`/api/po/${poId}/lines/${lineId}/skip`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason || "Reviewer skipped ShopKeeper job creation." }),
    });
  },
  createJob(poId: number | string, lineId: number | string) {
    return request<PoDetail>(`/api/po/${poId}/lines/${lineId}/create-job`, { method: "POST" });
  },
  createShipper(poId: number | string) {
    return request<PoDetail>(`/api/po/${poId}/create-shipper`, { method: "POST" });
  },
  unskipLine(poId: number | string, lineId: number | string) {
    return request<PoDetail>(`/api/po/${poId}/lines/${lineId}/unskip`, { method: "POST" });
  },
  resetErp(poId: number | string, lineId: number | string, reason?: string) {
    return request<PoDetail>(`/api/po/${poId}/lines/${lineId}/reset-erp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: reason || "Admin reset after ShopKeeper job was deleted." }),
    });
  },
};
