import type { Source } from "./types";
// Personal ledger eligibility, checked 2026-10-13. A sandbox is never a live connection.
export const sources: Source[] = [
  ...["Maybank", "CIMB", "DBS / POSB", "OCBC", "UOB"].map((name) => ({
    id: name.split(" ")[0].toLowerCase(),
    name,
    group: "Banks" as const,
    status: "Manual Import Only" as const,
    detail:
      "No verified personal transaction API integration. Import a CSV statement using the template; PDF and native bank formats are not yet supported.",
  })),
  ...["Touch ’n Go", "Grab", "Wise"].map((name, index) => ({
    id: ["tng", "grab", "wise"][index],
    name,
    group: "Wallets" as const,
    status: "Manual Import Only" as const,
    detail:
      "Use an exported statement converted to the CSV template. No personal wallet connection is claimed.",
  })),
  {
    id: "paypal",
    name: "PayPal Business",
    group: "Wallets",
    status: "Manual Import Only",
    detail:
      "Optional live API requires your own Business account, a live app and Transaction Search permission. Personal accounts use CSV.",
    docs: "https://developer.paypal.com/api/transaction-search/v1/search-get",
  },
  {
    id: "shopee",
    name: "Shopee",
    group: "Shopping",
    status: "Manual Import Only",
    detail:
      "Buyer history API access has not been verified for personal apps. Import your records with the CSV template.",
    docs: "https://open.shopee.com/",
  },
  {
    id: "lazada",
    name: "Lazada",
    group: "Shopping",
    status: "Manual Import Only",
    detail:
      "Official order authorization is for seller data, not personal buyer history. Use the CSV template.",
    docs: "https://open.lazada.com/",
  },
  {
    id: "csv",
    name: "CSV statement",
    group: "Other",
    status: "Available",
    detail:
      "Import the published CSV template. Explicit MYR, RM, SGD or S$ metadata is required.",
  },
  {
    id: "other",
    name: "Other provider",
    group: "Other",
    status: "Unsupported",
    detail:
      "No verified adapter. Select CSV statement to import a supported file.",
  },
];
export function sourceById(id: string) {
  const source = sources.find((s) => s.id === id);
  if (!source || source.status === "Unsupported")
    throw new Error("Unsupported provider");
  return source;
}
