import { normalizeCsv, requestedHistory } from "./normalize";
import { sourceById } from "./catalog";
import type { ImportRow } from "./types";
export function statementImport(source: string, csv: string) {
  sourceById(source);
  const rows = normalizeCsv(csv);
  if (!rows.length) throw new Error("The statement contains no transactions.");
  const range = requestedHistory();
  return {
    rows,
    history: `Requested history: ${range.from} to ${range.to} (previous seven calendar days). CSV coverage is unverified: transaction dates do not prove a complete statement. Export that entire period from your provider; missing history cannot be retrieved by this adapter.`,
  };
}
export function rpcRows(rows: ImportRow[]) {
  return rows.map((row) => ({
    ...row,
    currency:
      row.currency === "MYR" || row.currency === "SGD" ? row.currency : null,
  }));
}
