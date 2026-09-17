export type PoStatus = "pending" | "extracted" | "failed";
export type ReviewState = "unreviewed" | "confirmed";
export type WarningSeverity = "info" | "warning" | "prominent";

export interface WarningItem {
  code: string;
  message: string;
  severity: WarningSeverity;
}

export interface LineItem {
  id: string;
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
}

export interface LlmCall {
  id: string;
  model: string;
  call_type: string;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: string | number | null;
  created_at: string;
}

export interface PoSummary {
  id: string;
  created_at: string;
  updated_at: string;
  status: PoStatus;
  review_state: ReviewState;
  po_number: string | null;
  customer_name: string | null;
  customer_number: string | null;
  warnings: WarningItem[];
  is_stale: boolean;
  has_duplicate_warning: boolean;
  page_count: number | null;
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
  id?: string;
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
  customer_number: string;
  order_date: string;
  requested_ship_date: string;
  buyer_contact: string;
  buyer_notes: string;
  bill_to: string;
  ship_to: string;
  line_items: LineItemDraft[];
}
