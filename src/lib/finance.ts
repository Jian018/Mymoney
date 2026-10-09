export type Currency = "MYR" | "SGD";
export type Kind = "income" | "expense";
export interface Category {
  id: string;
  name: string;
  icon: string;
  color: string;
  transaction_type: Kind;
}
export interface Transaction {
  id: string;
  transaction_type: Kind;
  category_id: string;
  amount: string;
  currency: Currency;
  description: string;
  transaction_date: string;
}
export interface Budget {
  id: string;
  category_id: string | null;
  month: string;
  currency: Currency;
  limit_amount: string;
}
export interface Checkin {
  id: string;
  checkin_date: string;
  status: "completed";
  has_unrecorded_spending: boolean;
  has_impulse_purchase: boolean;
  notes: string;
  completed_at: string;
}
export interface Preferences {
  daily_reminder_enabled: boolean;
  reminder_time: string;
  timezone: string;
  push_enabled: boolean;
}
export interface Profile {
  display_name: string;
  timezone: string;
  default_currency: Currency;
}
export interface Notice {
  id: string;
  notification_type: string;
  notification_date: string;
  status: string;
  sent_at: string | null;
}
export interface Data {
  transactions: Transaction[];
  categories: Category[];
  budgets: Budget[];
  checkins: Checkin[];
  preferences: Preferences;
  profile: Profile;
  notifications: Notice[];
}
export const ZONE = "Asia/Singapore";
export function today(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"]
    .map((k) => parts.find((p) => p.type === k)!.value)
    .join("-");
}
export function shiftDate(date: string, days: number): string {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function localTime(now = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
}
export function cents(value: string): bigint {
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(value))
    throw new Error("Enter an amount with at most two decimal places.");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}
export function decimal(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  return (
    sign +
    (absolute / 100n).toString() +
    "." +
    (absolute % 100n).toString().padStart(2, "0")
  );
}
export function money(value: bigint, currency: Currency): string {
  const [whole, fraction] = decimal(value).split(".");
  return (
    (currency === "MYR" ? "RM " : "S$ ") +
    whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") +
    "." +
    fraction
  );
}
export function total(
  rows: Transaction[],
  kind: Kind,
  currency: Currency,
): bigint {
  return rows
    .filter((r) => r.transaction_type === kind && r.currency === currency)
    .reduce((s, r) => s + cents(r.amount), 0n);
}
export function budgetSpent(b: Budget, rows: Transaction[]): bigint {
  return total(
    rows.filter(
      (t) =>
        t.transaction_date.slice(0, 7) === b.month.slice(0, 7) &&
        (!b.category_id || t.category_id === b.category_id),
    ),
    "expense",
    b.currency,
  );
}
export function percentage(spent: bigint, limit: bigint): number {
  return limit === 0n ? 0 : Number((spent * 10000n) / limit) / 100;
}
export function thresholdCrossed(
  before: bigint,
  after: bigint,
  limit: bigint,
): number | null {
  for (const threshold of [100, 80, 50])
    if (
      before * 100n < limit * BigInt(threshold) &&
      after * 100n >= limit * BigInt(threshold)
    )
      return threshold;
  return null;
}
export function streaks(
  rows: Checkin[],
  date = today(),
): { current: number; longest: number } {
  const days = [
    ...new Set(
      rows.filter((r) => r.status === "completed").map((r) => r.checkin_date),
    ),
  ].sort();
  let longest = 0,
    run = 0,
    last = "";
  for (const day of days) {
    run = last && shiftDate(last, 1) === day ? run + 1 : 1;
    longest = Math.max(longest, run);
    last = day;
  }
  const set = new Set(days);
  let cursor = set.has(date) ? date : shiftDate(date, -1),
    current = 0;
  while (set.has(cursor)) {
    current++;
    cursor = shiftDate(cursor, -1);
  }
  return { current, longest };
}
export function csvCell(value: string): string {
  const safe =
    /^[\s\u0000-\u001f]*[=+\-@]/.test(value) || /^[\t\r\n]/.test(value)
      ? "'" + value
      : value;
  return '"' + safe.replace(/"/g, '""') + '"';
}
export function transactionCsv(
  rows: Transaction[],
  categories: Category[],
): string {
  const header = [
    "Date",
    "Type",
    "Category",
    "Amount",
    "Currency",
    "Description",
  ];
  const lines = rows.map((t) => [
    t.transaction_date,
    t.transaction_type,
    categories.find((c) => c.id === t.category_id)?.name ?? "Deleted category",
    t.amount,
    t.currency,
    t.description,
  ]);
  return (
    "\uFEFF" +
    [header, ...lines].map((row) => row.map(csvCell).join(",")).join("\r\n")
  );
}
