export type PoStatus = "pending" | "extracted" | "failed";
export type ReviewState = "unreviewed" | "confirmed";
export type PoSource = "upload" | "manual";
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
  cert_required: boolean;
  erp_status: ErpStatus;
  erp_job_number: string | null;
  erp_shipper_number: string | null;
  erp_created_at: string | null;
  erp_failure_reason: string | null;
  erp_database: string | null;
  erp_traveler_printed: boolean;
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
  source: PoSource;
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
  shipper_needs_attach: boolean;
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
  cert_required?: boolean;
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
  street?: string | null;
  suite?: string | null;
  city?: string | null;
  state?: string | null;
  postal_code?: string | null;
  country?: string | null;
  address_block?: string | null;
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

export interface PriceQuote {
  source: string;
  unit_price: string | number;
  quantity: number | null;
  job_number: string | null;
  po_number: string | null;
  order_date: string | null;
  note: string | null;
}

export interface PriceLookupResponse {
  customer_number: string;
  part_number: string;
  part_revision: string;
  quantity: number | null;
  quotes: PriceQuote[];
}

export interface ShopKeeperJobRow {
  job_number: string;
  po_number: string;
  po_line: string | null;
  customer_code: string;
  customer_name: string | null;
  part_number: string;
  part_revision: string;
  description: string | null;
  quantity: number | null;
  status: string;
  order_date: string | null;
  cert_required: boolean;
  shipper_number: string | null;
}

export interface ShopKeeperPoListResponse {
  items: ShopKeeperJobRow[];
  total: number;
  page: number;
  page_size: number;
  query: string | null;
  search_by: string;
}

export interface ShopKeeperPoGroupRow {
  customer_code: string;
  customer_name: string | null;
  po_number: string;
  job_count: number;
  shipper_numbers: string | null;
  order_date: string | null;
}

export interface ShopKeeperPoGroupListResponse {
  items: ShopKeeperPoGroupRow[];
  total: number;
  page: number;
  page_size: number;
  query: string | null;
  search_by: string;
}

export interface ShopKeeperPoPage extends ShopKeeperPoGroupRow {
  jobs: ShopKeeperJobRow[];
}

export interface ShopKeeperShipperRow {
  shipper_number: string;
  status: string | null;
  ship_via: string | null;
  ship_by: string | null;
  ship_date: string | null;
  printed: boolean;
  invoiced: boolean;
  job_count: number;
  customer_name: string | null;
  po_numbers: string | null;
}

export interface ShopKeeperShipperListResponse {
  items: ShopKeeperShipperRow[];
  total: number;
  page: number;
  page_size: number;
  query: string | null;
  search_by: string;
}

export interface ShopKeeperShipperPage {
  shipper_number: string;
  status: string | null;
  ship_via: string | null;
  ship_by: string | null;
  ship_date: string | null;
  printed: boolean;
  invoiced: boolean;
  job_count: number;
  customer_name: string | null;
  po_numbers: string | null;
  tracking_number: string | null;
  note: string | null;
  jobs: ShopKeeperJobRow[];
}

export interface CreatePrintResult {
  po: PoDetail;
  job_number: string;
  printed: boolean;
  missing_ops: boolean;
  missing_cert: boolean;
  print_error: string | null;
  pm_linkid: number | null;
}

export interface WorkCenter {
  code: string;
  description: string | null;
  inactive: boolean;
}

export interface OperationRow {
  id: number | null;
  seq_num: number;
  wc_code: string;
  description: string | null;
  note: string | null;
  run_time: number | null;
  setup_time: number | null;
  subcontract: boolean;
  process_code: string | null;
  process: number | null;
  fa: boolean;
  qty: number | null;
  sched_days: number | null;
  om_link: number | null;
  rowversion: string | null;
}

export interface OpTemplate {
  id: number;
  code: string;
  description: string | null;
  sort: number;
  step_count: number;
}

export interface CertText {
  id: string;
  description: string | null;
  text: string | null;
}

export interface PartPicture {
  id: number;
  path: string;
  description: string | null;
  print_on_trav: boolean;
  sort_order: number | null;
}

export interface JobHeaderPayload {
  customer_code: string;
  po_number: string;
  po_line: string | null;
  part_number: string;
  part_revision: string;
  description: string | null;
  quantity: number;
  unit: string;
  unit_price: string;
  order_date: string;
  notes: string | null;
  cert_required: boolean;
}

export interface JobPage {
  job_number: string;
  customer_code: string;
  customer_name: string | null;
  po_number: string;
  po_line: string | null;
  part_number: string;
  part_revision: string;
  pm_linkid: number | null;
  description: string | null;
  quantity: number | null;
  unit: string | null;
  unit_price: string | number | null;
  due_date: string | null;
  order_date: string | null;
  notes: string | null;
  cert_required: boolean;
  cert_linked: boolean;
  quality_hold: boolean;
  status: string | null;
  shipper_number: string | null;
  traveler_printed: boolean;
  operations: OperationRow[];
  print_ready: boolean;
  missing_ops: boolean;
  missing_cert: boolean;
  po_id: number | null;
  line_id: number | null;
  work_centers: WorkCenter[];
  templates: OpTemplate[];
  pictures: PartPicture[];
}

export interface PartEditor {
  pm_linkid: number;
  part_number: string;
  part_revision: string;
  description: string | null;
  customer_code: string | null;
  locked: boolean;
  quality_hold: boolean;
  quality_hold_note: string | null;
  fa_hold: boolean;
  ship_hold: boolean;
  operations: OperationRow[];
  pictures: PartPicture[];
  linked_certs: CertText[];
  cert_library: CertText[];
  work_centers: WorkCenter[];
  templates: OpTemplate[];
}

export interface PartHeaderPayload {
  part_number: string;
  part_revision: string;
  customer_code: string;
  description: string | null;
}

export interface PartListRow {
  pm_linkid: number;
  part_number: string;
  part_revision: string;
  customer_code: string | null;
  description: string | null;
  inactive: boolean;
  quality_hold: boolean;
  operation_count: number;
  picture_count: number;
  cert_linked: boolean;
}

export interface PartListResponse {
  items: PartListRow[];
  total: number;
  page: number;
  page_size: number;
  query: string | null;
  search_by: string;
}
