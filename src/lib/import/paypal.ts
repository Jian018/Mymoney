import { createHash } from "node:crypto";
import { currencyAmount, requestedHistory } from "./normalize";
import { today } from "../finance";
import type { ImportRow, ProviderAdapter } from "./types";
const BASE = "https://api-m.paypal.com"; // Production only; sandbox transactions never enter the ledger.
export function paypalConfigured() {
  return (
    process.env.PAYPAL_BUSINESS_API_ENABLED === "true" &&
    !!process.env.PAYPAL_CLIENT_ID &&
    !!process.env.PAYPAL_CLIENT_SECRET &&
    !!process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}
export function paypalFingerprint() {
  return createHash("sha256")
    .update(process.env.PAYPAL_CLIENT_ID ?? "")
    .digest("hex");
}
export async function paypalToken() {
  if (!paypalConfigured())
    throw new Error(
      "PayPal Business API is not configured. Personal accounts use CSV.",
    );
  const response = await fetch(BASE + "/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(
          `${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`,
        ).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error(
      "PayPal OAuth authorization failed. Check the live Business app configuration.",
    );
  const token = await response.json();
  if (
    typeof token.access_token !== "string" ||
    !String(token.scope)
      .split(" ")
      .includes("https://uri.paypal.com/services/reporting/search/read")
  )
    throw new Error(
      "PayPal has not granted Transaction Search permission. Enable it in your live Business app.",
    );
  return token.access_token as string; // In memory only; never sent to browser or stored in database.
}
export const paypalAdapter: ProviderAdapter = {
  id: "paypal",
  async synchronize() {
    const token = await paypalToken(),
      range = requestedHistory(),
      rows: ImportRow[] = [];
    const account = "business:" + paypalFingerprint();
    let totalPages = 1;
    for (let page = 1; page <= totalPages; page++) {
      const query = new URLSearchParams({
        start_date: range.from + "T00:00:00+08:00",
        end_date: today() + "T00:00:00+08:00",
        fields: "transaction_info",
        page_size: "500",
        page: String(page),
        balance_affecting_records_only: "Y",
      });
      const response = await fetch(
        BASE + "/v1/reporting/transactions?" + query,
        {
          headers: { Authorization: "Bearer " + token },
          cache: "no-store",
          signal: AbortSignal.timeout(15000),
        },
      );
      if (!response.ok)
        throw new Error(
          "PayPal cannot return the requested seven-day history. No partial import was saved; check reporting permission and try later.",
        );
      const payload = await response.json();
      if (
        !Array.isArray(payload.transaction_details) ||
        !Number.isInteger(payload.total_pages) ||
        payload.total_pages < 0
      )
        throw new Error(
          "PayPal returned an unexpected history response; nothing imported.",
        );
      totalPages = Math.max(1, payload.total_pages);
      if (totalPages > 2)
        throw new Error(
          "History exceeds 1,000 records. Export a statement and split it into smaller CSV files; no partial import saved.",
        );
      for (const entry of payload.transaction_details) {
        const info = entry.transaction_info;
        if (
          !info ||
          typeof info.transaction_id !== "string" ||
          typeof info.transaction_initiation_date !== "string"
        )
          throw new Error(
            "PayPal returned incomplete transaction metadata; nothing imported.",
          );
        const value = String(info.transaction_amount?.value ?? ""),
          parsed = currencyAmount(
            value.replace(/^-/, ""),
            info.transaction_amount?.currency_code ?? "",
          );
        const instant = new Date(info.transaction_initiation_date);
        const date = isNaN(instant.valueOf()) ? null : today(instant);
        const code = String(info.transaction_event_code ?? ""),
          id = info.transaction_id;
        // Event codes and gross amounts do not reliably identify personal expenses or net fees.
        // Every API row is reviewed; no heuristic payment classification silently posts money.
        rows.push({
          original_amount: value.slice(0, 100),
          original_currency: String(
            info.transaction_amount?.currency_code ?? "",
          ).slice(0, 30),
          original_date: info.transaction_initiation_date.slice(0, 100),
          exact_key: `id:${id}:${code}`,
          source_transaction_id: id,
          transaction_date: date,
          ...parsed,
          merchant: String(
            info.transaction_subject ||
              info.transaction_note ||
              `PayPal ${code}`,
          ).slice(0, 200),
          flow: "unknown",
          reference: String(info.paypal_reference_id ?? "").slice(0, 200),
          reason: [
            parsed.reason,
            "Business reporting: classify payment, refund, fees or transfer before posting",
            !date && "Invalid provider date",
          ]
            .filter(Boolean)
            .join("; "),
        });
      }
    }
    return {
      rows,
      account,
      history: `Requested ${range.from} through ${range.to} (Asia/Singapore). All returned pages retrieved. PayPal reporting can lag by up to three hours; empty days are not proof of complete history. Only MYR/SGD can be posted.`,
    };
  },
};
