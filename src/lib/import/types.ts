export type SourceStatus =
  "Available" | "Manual Import Only" | "Authorization Required" | "Unsupported";
export interface Source {
  id: string;
  name: string;
  group: "Banks" | "Wallets" | "Shopping" | "Other";
  status: SourceStatus;
  detail: string;
  docs?: string;
}
export type Flow =
  "expense" | "income" | "refund" | "transfer" | "topup" | "unknown";
export interface ImportRow {
  original_amount?: string;
  original_currency?: string;
  original_date?: string;
  exact_key: string;
  source_transaction_id: string | null;
  transaction_date: string | null;
  currency: string | null;
  amount: string | null;
  merchant: string;
  flow: Flow;
  reason: string;
  reference: string;
}
export interface ImportItem extends ImportRow {
  id: string;
  source: string;
  account: string;
  status: string;
  reason: string;
  transaction_id: string | null;
  candidate_ids: string[];
  imported_at: string;
}
export interface ImportResult {
  id: string;
  new: number;
  duplicate: number;
  pending: number;
  excluded: number;
  history: string;
}
export interface ProviderAdapter {
  id: string;
  synchronize(): Promise<{
    rows: ImportRow[];
    account: string;
    history: string;
  }>;
}
