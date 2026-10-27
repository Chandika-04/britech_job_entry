import type {
  CreatePrintResult,
  CustomerLookupResponse,
  CustomerSuggestion,
  JobHeaderPayload,
  JobPage,
  PartEditor,
  PartHeaderPayload,
  PartListResponse,
  PartLookupResponse,
  PartPicture,
  PoDetail,
  PoDraft,
  PoListResponse,
  PriceLookupResponse,
  ShopKeeperPoGroupListResponse,
  ShopKeeperPoListResponse,
  ShopKeeperPoPage,
  ShopKeeperShipperListResponse,
  ShopKeeperShipperPage,
} from "@/types/po";
import { emptyToNull, parseMoney } from "@/lib/utils";

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
    throw new ApiError(await errorMessage(response), response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: string };
    if (body.detail) return body.detail;
  } catch {
    // keep default
  }
  return "Something went wrong. Please try again.";
}

async function requestPdf(path: string, init?: RequestInit): Promise<Blob> {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) {
    throw new ApiError(await errorMessage(response), response.status);
  }
  return response.blob();
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
      unit_price: parseMoney(item.unit_price),
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
  createManual(draft?: PoDraft) {
    return request<PoDetail>("/api/po/manual", {
      method: "POST",
      ...(draft
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(draftToPayload(draft)),
          }
        : {}),
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
  lookupPrices(customerNumber: string, partNumber: string, partRevision: string, quantity?: string) {
    const params = new URLSearchParams({
      customer_number: customerNumber,
      part_number: partNumber,
      part_revision: partRevision,
    });
    const qty = quantity?.trim();
    if (qty) params.set("quantity", qty);
    return request<PriceLookupResponse>(`/api/shopkeeper/prices?${params.toString()}`);
  },
  listShopKeeperPurchaseOrders(params: URLSearchParams) {
    return request<ShopKeeperPoListResponse>(`/api/shopkeeper/purchase-orders?${params.toString()}`);
  },
  listShopKeeperPoGroups(params: URLSearchParams) {
    return request<ShopKeeperPoGroupListResponse>(`/api/shopkeeper/purchase-order-groups?${params.toString()}`);
  },
  getShopKeeperPo(customerCode: string, poNumber: string) {
    const params = new URLSearchParams({ customer_code: customerCode, po: poNumber });
    return request<ShopKeeperPoPage>(`/api/shopkeeper/purchase-orders/detail?${params.toString()}`);
  },
  listShopKeeperShippers(params: URLSearchParams) {
    return request<ShopKeeperShipperListResponse>(`/api/shopkeeper/shippers?${params.toString()}`);
  },
  getShipper(shipNumber: string) {
    return request<ShopKeeperShipperPage>(`/api/shopkeeper/shippers/${encodeURIComponent(shipNumber)}`);
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
  setCertRequired(poId: number | string, lineId: number | string, certRequired: boolean, applyToAllLines = false) {
    return request<PoDetail>(`/api/po/${poId}/lines/${lineId}/cert-required`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cert_required: certRequired, apply_to_all_lines: applyToAllLines }),
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
    return request<CreatePrintResult>(`/api/po/${poId}/lines/${lineId}/create-job`, { method: "POST" });
  },
  getJob(jobNumber: string) {
    return request<JobPage>(`/api/jobs/${encodeURIComponent(jobNumber)}`);
  },
  deleteShopKeeperJob(jobNumber: string) {
    return request<void>(`/api/jobs/${encodeURIComponent(jobNumber)}`, { method: "DELETE" });
  },
  deleteShopKeeperJobForLine(poId: number | string, lineId: number | string) {
    return request<PoDetail>(`/api/po/${poId}/lines/${lineId}/delete-shopkeeper-job`, { method: "POST" });
  },
  saveJob(jobNumber: string, payload: JobHeaderPayload) {
    return request<JobPage>(`/api/jobs/${encodeURIComponent(jobNumber)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  saveJobOperations(jobNumber: string, operations: JobPage["operations"]) {
    return request<JobPage["operations"]>(`/api/jobs/${encodeURIComponent(jobNumber)}/operations`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operations }),
    });
  },
  copyJobTemplate(jobNumber: string, templateId: number) {
    return request<JobPage["operations"]>(`/api/jobs/${encodeURIComponent(jobNumber)}/copy-template`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template_id: templateId }),
    });
  },
  copyJobPartOps(jobNumber: string) {
    return request<JobPage["operations"]>(`/api/jobs/${encodeURIComponent(jobNumber)}/copy-part-ops`, {
      method: "POST",
    });
  },
  getTravelerPdf(jobNumber: string) {
    return requestPdf(`/api/jobs/${encodeURIComponent(jobNumber)}/print/traveler`);
  },
  getCertificationPdf(jobNumber: string) {
    return requestPdf(`/api/jobs/${encodeURIComponent(jobNumber)}/print/certification`);
  },
  markTravelerPrinted(jobNumber: string) {
    return request<void>(`/api/jobs/${encodeURIComponent(jobNumber)}/print/mark-traveler`, { method: "POST" });
  },
  listParts(params: URLSearchParams) {
    return request<PartListResponse>(`/api/parts?${params.toString()}`);
  },
  createPart(payload: PartHeaderPayload) {
    return request<PartEditor>(`/api/parts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  getPart(pmLinkId: number | string) {
    return request<PartEditor>(`/api/parts/${pmLinkId}`);
  },
  savePartHeader(pmLinkId: number | string, payload: PartHeaderPayload) {
    return request<PartEditor>(`/api/parts/${pmLinkId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  },
  savePartOperations(pmLinkId: number | string, operations: PartEditor["operations"]) {
    return request<PartEditor["operations"]>(`/api/parts/${pmLinkId}/operations`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operations }),
    });
  },
  copyPartTemplate(pmLinkId: number | string, templateId: number) {
    return request<PartEditor["operations"]>(`/api/parts/${pmLinkId}/copy-template`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template_id: templateId }),
    });
  },
  setQualityHold(pmLinkId: number | string, hold: boolean, note?: string | null) {
    return request<PartEditor>(`/api/parts/${pmLinkId}/quality-hold`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hold, note: note || null }),
    });
  },
  linkCert(pmLinkId: number | string, ctxtId: string) {
    return request<PartEditor>(`/api/parts/${pmLinkId}/certs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ctxt_id: ctxtId }),
    });
  },
  unlinkCert(pmLinkId: number | string, ctxtId: string) {
    return request<PartEditor>(`/api/parts/${pmLinkId}/certs/${encodeURIComponent(ctxtId)}`, { method: "DELETE" });
  },
  async uploadPartPicture(pmLinkId: number | string, file: File) {
    return request<PartPicture>(`/api/parts/${pmLinkId}/pictures`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name }),
    });
  },
  unlinkPartPicture(pmLinkId: number | string, pmpId: number) {
    return request<PartEditor>(`/api/parts/${pmLinkId}/pictures/${pmpId}`, { method: "DELETE" });
  },
  partPictureUrl(pmLinkId: number | string, pmpId: number) {
    return `${API_BASE}/api/parts/${pmLinkId}/pictures/${pmpId}`;
  },
  createShipper(poId: number | string, preparedBy?: string | null) {
    return request<PoDetail>(`/api/po/${poId}/create-shipper`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prepared_by: preparedBy ?? null }),
    });
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
