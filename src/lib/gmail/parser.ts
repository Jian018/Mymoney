import { convert } from "html-to-text";
import { cents, decimal, today } from "../finance";
import { digest } from "./crypto";
import {
  PARSER_VERSION,
  type ExpenseCandidate,
  type GmailMessage,
  type GmailPart,
  type PaymentStatus,
} from "./types";
import { providers, providerFor } from "./providers";
const financialSubject =
  /receipt|transaction|payment|paid|purchase|order|refund|top.?up|transfer|authorization|authorisation|付款|支付|交易|收据|订单|退款|充值/i;
export function header(message: GmailMessage, name: string) {
  return (
    message.payload?.headers?.find(
      (h) => h.name.toLowerCase() === name.toLowerCase(),
    )?.value ?? ""
  );
}
export function senderAddress(message: GmailMessage) {
  const from = header(message, "from");
  return (
    from.match(/<([^<>\s]+@[^<>\s]+)>/)?.[1] ??
    from.match(/[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+/)?.[0] ??
    ""
  ).toLowerCase();
}
export function likelyFinancial(message: GmailMessage) {
  return financialSubject.test(header(message, "subject"));
}
export function searchQuery(from: number, to: number) {
  const senders = providers.flatMap((p) => p.domains.map((d) => "from:" + d));
  return `after:${Math.floor(from / 1000)} before:${Math.ceil(to / 1000) + 1} -in:spam -in:trash -in:sent {${senders.join(" ")} subject:receipt subject:payment subject:transaction subject:paid subject:purchase subject:refund subject:付款 subject:支付 subject:交易 subject:收据}`;
}
export function emailText(payload?: GmailPart): string {
  const plain: string[] = [],
    html: string[] = [];
  let bytes = 0;
  function walk(part?: GmailPart) {
    if (!part || part.filename) return;
    if (
      part.body?.data &&
      ["text/plain", "text/html"].includes(part.mimeType ?? "")
    ) {
      const buffer = Buffer.from(part.body.data, "base64url");
      bytes += buffer.length;
      if (bytes > 250_000)
        throw new Error("Email body exceeds the deterministic parser limit.");
      const text = buffer.toString("utf8");
      if (part.mimeType === "text/plain") plain.push(text);
      else
        html.push(
          convert(text, {
            wordwrap: false,
            selectors: [
              { selector: "a", options: { ignoreHref: true } },
              { selector: "img", format: "skip" },
            ],
          }),
        );
    }
    for (const child of part.parts ?? []) walk(child);
  }
  walk(payload);
  return [
    ...new Set(
      [...plain, ...html]
        .join("\n")
        .replace(/\u00a0/g, " ")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ].join("\n");
}
export function normalizeMerchant(value: string) {
  const s = value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  if (/shopee/.test(s)) return "shopee";
  if (/taobao|alipay/.test(s)) return "taobao";
  if (/grabfood/.test(s)) return "grabfood";
  if (/grab/.test(s)) return "grab";
  return s;
}
function paymentStatus(text: string): PaymentStatus {
  if (
    /refunded|refund\s+(?:successful|completed|processed)|refund\s+(?:has\s+been\s+)?(?:issued|credited)|退款成功|退款完成|已退款|reversed|reversal\s+completed/i.test(
      text,
    )
  )
    return "refund";
  if (
    /refund\s+(?:requested|pending|initiated|processing)|退款申请|退款处理中/i.test(
      text,
    )
  )
    return "pending";
  if (/cancelled|canceled|order\s+cancel|取消订单|已取消/i.test(text))
    return "cancelled";
  if (
    /authori[sz]ation\s+hold|pre.?authori[sz]|temporary\s+hold|预授权/i.test(
      text,
    )
  )
    return "hold";
  if (/top[ -]?up|reload|充值|钱包转入/i.test(text)) return "topup";
  if (
    /internal\s+transfer|transfer\s+(?:to|from|completed|successful)|funds\s+transfer|转账|转帐/i.test(
      text,
    )
  )
    return "transfer";
  if (
    /payment\s+(?:pending|processing|failed|declined)|awaiting\s+payment|unpaid|待付款|支付失败|未付款/i.test(
      text,
    )
  )
    return "pending";
  if (
    /payment\s+(?:successful|completed)|successfully\s+paid|paid\s+(?:successfully|on)|purchase\s+(?:completed|successful)|transaction\s+(?:successful|completed)|支付成功|付款成功|已付款/i.test(
      text,
    )
  )
    return "completed";
  return "unknown";
}
function dateFrom(text: string) {
  const match = text.match(
    /(?:transaction\s+date|payment\s+date|purchase\s+date|paid\s+on|date|交易日期|付款日期|支付时间)\s*[:：]?\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[\/-]\d{1,2}[\/-]\d{4})/i,
  );
  if (!match) return null;
  let value = match[1];
  if (!/^\d{4}-/.test(value)) {
    const parts = value.split(/[\/-]/);
    if (
      Number(parts[0]) <= 12 &&
      Number(parts[1]) <= 12 &&
      parts[0] !== parts[1]
    )
      return null;
    value = `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
  }
  const parsed = new Date(value + "T12:00:00Z");
  return !isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
    ? value
    : null;
}
function categoryFor(text: string, fallback: string) {
  if (
    /fairprice|ntuc|cold storage|jaya grocer|grocer|supermarket|超市/i.test(
      text,
    )
  )
    return "Groceries";
  if (/grabfood|foodpanda|restaurant|cafe|coffee|餐饮|外卖/i.test(text))
    return "Food";
  if (
    /airline|airasia|singapore airlines|hotel|booking\.com|航班|酒店/i.test(
      text,
    )
  )
    return "Travel";
  if (/grabcar|taxi|bus|train|mrt|交通/i.test(text)) return "Transport";
  if (/netflix|cinema|spotify|movie|电影/i.test(text)) return "Entertainment";
  if (/electricity|utilities|singtel|water bill|电费|账单/i.test(text))
    return "Bills";
  return fallback;
}
export function parseMessage(message: GmailMessage): ExpenseCandidate {
  const sender = senderAddress(message),
    provider = providerFor(sender),
    subject = header(message, "subject").slice(0, 250),
    text = emailText(message.payload),
    combined = subject + "\n" + text;
  const received = Number(message.internalDate),
    received_at =
      Number.isFinite(received) && received > 0
        ? new Date(received).toISOString()
        : "";
  const status = paymentStatus(combined),
    date = dateFrom(text),
    reasons: string[] = [];
  if (/(?:[-−(]\s*(?:MYR|RM|SGD|S\$)|(?:MYR|RM|SGD|S\$)\s*[-−(])/i.test(text))
    reasons.push(
      "Signed or parenthesized amount; verify whether this is a charge or credit",
    );
  const matches = [
    ...text.matchAll(
      /(?:(?<![\p{L}\p{N}])(SGD|S\$|MYR|RM|USD|US\$|CNY|RMB|\$)\s*([0-9]{1,12}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)(?![\d.,\p{L}])|(?<![\d.,])([0-9]{1,12}(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)(?![\d.,\p{L}])\s*(SGD|MYR|USD|CNY|RMB)\b)/giu,
    ),
  ];
  const amounts = matches.map((m) => {
    const symbol = (m[1] ?? m[4]).toUpperCase(),
      raw = m[2] ?? m[3];
    let amount: string | null = null;
    try {
      if (
        /^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(raw) ||
        /^\d{1,12}(?:\.\d{1,2})?$/.test(raw)
      ) {
        const c = cents(raw.replace(/,/g, ""));
        if (c > 0n) amount = decimal(c);
      }
    } catch {}
    return {
      currency: /^(MYR|RM)$/.test(symbol)
        ? "MYR"
        : /^(SGD|S\$)$/.test(symbol)
          ? "SGD"
          : null,
      amount,
      symbol,
    };
  });
  const unique = [
    ...new Map(
      amounts.map((a) => [
        `${a.symbol.replace("RM", "MYR").replace("S$", "SGD")}:${a.amount}`,
        a,
      ]),
    ).values(),
  ];
  const currencies = new Set(unique.map((a) => a.currency ?? a.symbol));
  const values = new Set(unique.map((a) => a.amount));
  let amount = values.size === 1 ? (unique[0]?.amount ?? null) : null;
  let currency = currencies.size === 1 ? (unique[0]?.currency ?? null) : null;
  if (!amount)
    reasons.push(
      "Missing or multiple monetary amounts; confirm the settled amount",
    );
  if (!currency)
    reasons.push(
      "Missing, ambiguous $ or foreign/multiple currencies; no conversion performed",
    );
  const merchantMatch = text.match(
    /(?:merchant(?:\s+name)?|paid\s+to|store|商户|商家|店铺)\s*[:：]\s*([^\r\n]{2,120})/i,
  );
  const merchant =
    merchantMatch?.[1]?.trim() ?? provider?.platformMerchant ?? "";
  if (!merchant) reasons.push("Merchant not identified");
  if (!date || date > today())
    reasons.push("Transaction date is missing, ambiguous or in the future");
  const domain = sender.split("@")[1] ?? "";
  const auth =
    message.payload?.headers?.find(
      (h) =>
        h.name.toLowerCase() === "authentication-results" &&
        /^mx\.google\.com\s*;/i.test(h.value),
    )?.value ?? "";
  const authenticated =
    /\bdmarc=pass\b/i.test(auth) &&
    auth.match(/\bheader\.from=([^\s;]+)/i)?.[1]?.toLowerCase() === domain;
  if (!provider || !authenticated)
    reasons.push(
      "Sender is not an authenticated known provider; inspect the original email",
    );
  const labeledAmount =
    /(?:amount(?:\s+paid)?|total(?:\s+paid)?|payment\s+amount|transaction\s+amount|实付|支付金额|交易金额)\s*[:：]?\s*(?:SGD|S\$|MYR|RM|\d)/i.test(
      text,
    );
  if (!labeledAmount) reasons.push("No explicit paid/transaction amount field");
  if (provider && !provider.completedContext.test(combined))
    reasons.push("Provider-specific completed purchase context is missing");
  if (
    /salary|deposit received|funds received|credited to your|incoming transfer|工资|入账/i.test(
      combined,
    )
  )
    reasons.push("Possible incoming funds; verify this is an expense");
  if (status !== "completed")
    reasons.push(`Payment status: ${status}; not a completed expense`);
  // Negated claims and generic order confirmations never become completed expenses.
  if (
    /not\s+(?:paid|completed|successful)|if\s+(?:your\s+)?payment|payment\s+due|will\s+be\s+charged/i.test(
      combined,
    )
  )
    reasons.push("Conditional or negated payment wording");
  const reference =
    text.match(
      /(?:transaction\s*(?:id|number|no\.?|reference)|order\s*(?:id|number|no\.?)|receipt\s*(?:id|number|no\.?)|reference\s*(?:number|no\.?)?|交易(?:编号|号码)|订单(?:号|编号))\s*[:：#]\s*([A-Za-z0-9][A-Za-z0-9_-]{5,79})/i,
    )?.[1] ?? null;
  const reference_key =
    reference && provider
      ? `${provider.id}:${status}:${digest(reference.toUpperCase().replace(/\s/g, ""))}`
      : null;
  const auto_save = reasons.length === 0;
  return {
    message_id: message.id,
    source: provider?.id ?? "other-email",
    sender,
    subject,
    received_at,
    merchant: merchant.slice(0, 200),
    merchant_key: normalizeMerchant(merchant),
    transaction_date: date,
    amount,
    currency,
    category: categoryFor(
      merchant + " " + subject + " " + text.slice(0, 300),
      provider?.category ?? "Other",
    ),
    payment_status: status,
    reference,
    reference_key,
    confidence: auto_save ? 0.98 : Math.max(0.1, 0.85 - reasons.length * 0.12),
    auto_save,
    reason: reasons.join("; "),
    evidence: {
      parser_version: PARSER_VERSION,
      content_hash: digest(text),
      sender_authenticated: authenticated,
      detected_amounts: unique.slice(0, 12),
      explicit_transaction_date: date,
      explicit_amount_label: labeledAmount,
      provider: provider?.id ?? null,
      payment_status: status,
    },
  };
}
