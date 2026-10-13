export type PaymentStatus =
  | "completed"
  | "pending"
  | "hold"
  | "refund"
  | "cancelled"
  | "topup"
  | "transfer"
  | "unknown";
export interface GmailHeader {
  name: string;
  value: string;
}
export interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
}
export interface GmailMessage {
  id: string;
  internalDate?: string;
  payload?: GmailPart;
}
export interface ExpenseCandidate {
  message_id: string;
  source: string;
  sender: string;
  subject: string;
  received_at: string;
  merchant: string;
  merchant_key: string;
  transaction_date: string | null;
  amount: string | null;
  currency: string | null;
  category: string;
  payment_status: PaymentStatus;
  reference: string | null;
  reference_key: string | null;
  confidence: number;
  auto_save: boolean;
  reason: string;
  evidence: Record<string, unknown>;
}
export interface ReviewCandidate extends ExpenseCandidate {
  id: string;
  review_status: string;
  category_id: string | null;
  transaction_id: string | null;
  candidate_ids: string[];
  created_at: string;
  gmail_message_id: string;
  google_account_id: string;
}
export interface SyncRun {
  id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  scanned_count: number;
  imported_count: number;
  duplicate_count: number;
  review_count: number;
  failed_count: number;
  ignored_count: number;
  myr_total: string;
  sgd_total: string;
  message: string;
}
export interface GmailConnection {
  id: string;
  email: string;
  google_account_id: string;
  connection_status: string;
  last_sync_at: string | null;
}
export const PARSER_VERSION = "gmail-rules-1";
