import { createHash } from "node:crypto";
import { cents, decimal, today } from "../finance";
export { requestedHistory } from "./dates";
import type { Flow, ImportRow } from "./types";
export const TEMPLATE =
  "date,amount,currency,merchant,type,transaction_id,reference\r\n";
export function parseCsv(text: string): string[][] {
  if (Buffer.byteLength(text, "utf8") > 2_000_000)
    throw new Error("CSV limit is 2 MB.");
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false,
    closed = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += c;
    } else if (c === '"') {
      if (field || closed) throw new Error("Invalid CSV quoting.");
      quoted = true;
    } else if (c === "," || c === "\n" || c === "\r") {
      row.push(field);
      field = "";
      closed = false;
      if (c !== ",") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        if (row.some(Boolean)) rows.push(row);
        row = [];
      }
    } else {
      if (closed) throw new Error("Invalid CSV after closing quote.");
      field += c;
    }
  }
  if (quoted) throw new Error("Unclosed CSV quote.");
  if (field || row.length) {
    row.push(field);
    if (row.some(Boolean)) rows.push(row);
  }
  if (rows.length > 1001)
    throw new Error("Import at most 1,000 transactions per file.");
  return rows;
}
export function currencyAmount(
  raw: string,
  metadata = "",
): { currency: string | null; amount: string | null; reason: string } {
  const symbols = [...raw.matchAll(/MYR|SGD|RM|S\$/gi)].map((m) =>
    /MYR|RM/i.test(m[0]) ? "MYR" : "SGD",
  );
  const code = metadata.trim().toUpperCase();
  const codes = new Set([
    ...symbols,
    ...(code ? [code === "RM" ? "MYR" : code === "S$" ? "SGD" : code] : []),
  ]);
  const currency =
    codes.size === 1 && ["MYR", "SGD"].includes([...codes][0])
      ? [...codes][0]
      : null;
  const cleaned = raw.replace(/MYR|SGD|RM|S\$/gi, "").trim();
  let amount: string | null = null;
  try {
    if (/^\d{1,12}(\.\d{1,2})?$/.test(cleaned) && cents(cleaned) > 0n)
      amount = decimal(cents(cleaned));
  } catch {
    /* Review invalid values instead of guessing. */
  }
  return {
    currency,
    amount,
    reason: [
      !currency &&
        "Missing, conflicting or unsupported currency (bare $ is ambiguous)",
      !amount &&
        "Amount must be a positive decimal without thousands separators",
    ]
      .filter(Boolean)
      .join("; "),
  };
}
export function normalizeCsv(text: string): ImportRow[] {
  const rows = parseCsv(text),
    headers = rows.shift()?.map((v) => v.trim().toLowerCase()) ?? [];
  for (const name of ["date", "amount", "currency", "merchant", "type"])
    if (!headers.includes(name))
      throw new Error(`Missing ${name} column. Download the CSV template.`);
  if (new Set(headers).size !== headers.length)
    throw new Error("Duplicate CSV headers.");
  if (headers.some((v) => /password|otp|pin|token|secret/.test(v)))
    throw new Error("Credential columns are not accepted.");
  const file = createHash("sha256")
    .update(text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n"))
    .digest("hex");
  return rows.map((cells, index) => {
    if (cells.length !== headers.length)
      throw new Error(
        `CSV row ${index + 2} has an incorrect number of columns.`,
      );
    const get = (name: string) => (cells[headers.indexOf(name)] ?? "").trim();
    const date = get("date"),
      parsed = new Date(date + "T12:00:00Z");
    const transaction_date =
      /^\d{4}-\d{2}-\d{2}$/.test(date) &&
      !isNaN(parsed.valueOf()) &&
      parsed.toISOString().slice(0, 10) === date
        ? date
        : null;
    const { currency, amount, reason } = currencyAmount(
      get("amount"),
      get("currency"),
    );
    const type = get("type").toLowerCase(),
      flow: Flow = [
        "expense",
        "income",
        "refund",
        "transfer",
        "topup",
      ].includes(type)
        ? (type as Flow)
        : "unknown";
    if (get("transaction_id").length > 200)
      throw new Error("Source transaction IDs cannot exceed 200 characters.");
    const id = get("transaction_id") || null;
    // Missing IDs: only the identical file + row is exact. Overlapping statements need review.
    return {
      original_amount: get("amount").slice(0, 100),
      original_currency: get("currency").slice(0, 30),
      original_date: get("date").slice(0, 100),
      exact_key: id ? "id:" + id : `file:${file}:${index}`,
      source_transaction_id: id,
      transaction_date,
      currency,
      amount,
      merchant: get("merchant").slice(0, 200),
      flow,
      reference: get("reference").slice(0, 200),
      reason: [
        reason,
        !transaction_date && "Invalid date; use YYYY-MM-DD",
        transaction_date &&
          transaction_date > today() &&
          "Future date needs correction",
        flow === "unknown" && "Transaction type needs review",
        !get("merchant") && "Merchant missing",
      ]
        .filter(Boolean)
        .join("; "),
    };
  });
}
