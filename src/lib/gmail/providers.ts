// Sender domains identify a parser rule set, never prove a payment by themselves.
// Extend these rules with redacted, verified receipt formats rather than bank APIs.
export interface EmailProvider {
  id: string;
  domains: string[];
  category: string;
  platformMerchant?: string;
  completedContext: RegExp;
}
export const providers: EmailProvider[] = [
  {
    id: "dbs",
    domains: ["dbs.com", "dbs.com.sg"],
    category: "Other",
    completedContext:
      /card\s+(?:purchase|transaction|ending)|(?:debit|credit)\s+card|charged\s+to\s+your\s+card|purchase\s+at|paid\s+to/i,
  },
  {
    id: "posb",
    domains: ["posb.com.sg"],
    category: "Other",
    completedContext:
      /card\s+(?:purchase|transaction|ending)|(?:debit|credit)\s+card|charged\s+to\s+your\s+card|purchase\s+at|paid\s+to/i,
  },
  {
    id: "public-bank",
    domains: ["pbebank.com", "publicbank.com.my"],
    category: "Other",
    completedContext:
      /card\s+(?:purchase|transaction|ending)|(?:debit|credit)\s+card|charged\s+to\s+your\s+card|purchase\s+at|paid\s+to|交易商户/i,
  },
  {
    id: "grab",
    domains: ["grab.com", "grab.com.sg"],
    category: "Transport",
    platformMerchant: "Grab",
    completedContext:
      /payment\s+(?:successful|completed)|paid\s+(?:successfully|on)|successfully\s+paid|支付成功|付款成功|已付款/i,
  },
  {
    id: "shopee",
    domains: ["shopee.sg", "shopee.com.my", "shopee.com"],
    category: "Shopping",
    platformMerchant: "Shopee",
    completedContext:
      /payment\s+(?:successful|completed)|paid\s+(?:successfully|on)|successfully\s+paid|支付成功|付款成功|已付款/i,
  },
  {
    id: "taobao",
    domains: ["taobao.com", "alipay.com"],
    category: "Shopping",
    platformMerchant: "Taobao",
    completedContext:
      /payment\s+(?:successful|completed)|paid\s+(?:successfully|on)|successfully\s+paid|支付成功|付款成功|已付款/i,
  },
  {
    id: "tng",
    domains: ["tngdigital.com.my", "touchngo.com.my"],
    category: "Other",
    completedContext:
      /merchant\s*(?:payment|name)?\s*[:：]|paid\s+to|商户|商家/i,
  },
];
export function providerFor(address: string) {
  const host = address.split("@")[1] ?? "";
  return providers.find((p) =>
    p.domains.some((d) => host === d || host.endsWith("." + d)),
  );
}
