export type PoStatus = "pending" | "extracted" | "failed";
export type ReviewState = "unreviewed" | "confirmed";
export type WarningSeverity = "info" | "warning" | "prominent";
export type ErpStatus = "pending" | "ready" | "creating" | "created" | "failed" | "skipped";

export interface WarningItem {
  code: string;
  message: string;
  severity: WarningSeverity;
}

export interface LineItem {
  id: number;
  line_number: number | null;
  customer_part_number: string | null;
  revision: string | null;
  description: string | null;
  quantity: string | number | null;
  unit_price: string | number | null;
  uom: string | null;
  due_date: string | null;
  notes: string | null;
  reviewer_edited: boolean;
  resolved_customer_code: string | null;
  resolved_part_number: string | null;
  resolved_part_revision: string | null;
  resolved_pm_linkid: number | null;
  customer_credit_hold: boolean;
  credit_hold_acknowledged: boolean;
  duplicate_job_numbers: string[];
  duplicate_acknowledged: boolean;
  erp_status: ErpStatus;
  erp_job_number: string | null;
  erp_created_at: string | null;
  erp_failure_reason: string | null;
  erp_database: string | null;
}

export interface LlmCall {
  id: number;
  model: string;
  call_type: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: string | number | null;
  created_at: string;
}

export interface PoSummary {
  id: number;
  created_at: string;
  updated_at: string;
  status: PoStatus;
  review_state: ReviewState;
  po_number: string | null;
  customer_name: string | null;
  warnings: WarningItem[];
  is_stale: boolean;
  has_duplicate_warning: boolean;
  page_count: number | null;
  line_count: number;
  jobs_created_count: number;
  jobs_complete: boolean;
  shipper_number: string | null;
}

export interface PoDetail extends PoSummary {
  heartbeat_at: string | null;
  order_date: string | null;
  requested_ship_date: string | null;
  buyer_contact: string | null;
  buyer_notes: string | null;
  bill_to: string | null;
  ship_to: string | null;
  extraction_error: string | null;
  line_items: LineItem[];
  llm_calls: LlmCall[];
  attachment_filename: string | null;
}

export interface PoListResponse {
  items: PoSummary[];
  total: number;
  page: number;
  page_size: number;
}

export interface LineItemDraft {
  id?: number;
  line_number: string;
  customer_part_number: string;
  revision: string;
  description: string;
  quantity: string;
  unit_price: string;
  uom: string;
  due_date: string;
  notes: string;
}

export interface PoDraft {
  po_number: string;
  customer_name: string;
  order_date: string;
  requested_ship_date: string;
  buyer_contact: string;
  buyer_notes: string;
  bill_to: string;
  ship_to: string;
  line_items: LineItemDraft[];
}

export interface CustomerCandidate {
  customer_number: string;
  company: string | null;
  record_type: string | null;
  bill_to_customer_number: string | null;
  active: boolean;
  credit_hold: boolean;
  payment_terms: string | null;
  shipped_via: string | null;
  salesman: string | null;
  cert_default: boolean;
  taxable_default: boolean;
  tax_code: string | null;
}

export interface PartCandidate {
  part_number: string;
  part_revision: string;
  description: string | null;
  master_type: string | null;
  pm_linkid: number;
  inactive: boolean;
}

export interface CustomerLookupResponse {
  query: string;
  matches: CustomerCandidate[];
  exact_one: boolean;
}

export type CustomerMatchStatus = "alias" | "exact" | "contains" | "ambiguous" | "candidates" | "none";

export interface CustomerSuggestion {
  extracted_name: string | null;
  normalized_name: string;
  status: CustomerMatchStatus;
  customer: CustomerCandidate | null;
  candidates: CustomerCandidate[];
  warning: string | null;
}

export interface PartLookupResponse {
  part_number: string;
  part_revision: string | null;
  matches: PartCandidate[];
  exact_one: boolean;
}
