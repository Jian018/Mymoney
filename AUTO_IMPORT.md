# Auto Import Hub

Run `supabase/migrations/003_auto_import.sql` once in the Supabase SQL Editor, after migrations 001 and 002. The existing approved-device authentication and `ALLOWED_USER_ID` remain in use. Git pushes do not apply SQL migrations. Redeploy Vercel after changing environment variables.

Auto Import is the default screen for approved devices. The Money overview switch and existing bottom navigation retain Cash entry, budgets, daily check-ins, reports, notifications and exports. Import operations are authenticated, same-origin POST requests. Opening the app, authorizing an adapter, or loading the review queue does not synchronize transactions. No import cron or webhook is registered.

## Statement imports

Download the blank CSV template in the selected source card. Export records from the provider, then convert them to this template. This release supports UTF-8 comma-separated CSV, not PDF, screenshots, XLSX, or arbitrary native bank formats. Dates use YYYY-MM-DD. Amounts are positive decimals, at most two decimal places, without thousands separators. Types are expense, income, refund, transfer, or topup. Currency is MYR/RM or SGD/S$; bare `$`, missing, conflicting and unsupported currencies require review. Use a consistent account label; changing it changes the exact duplicate namespace.

The requested period is the seven complete calendar days before today in Asia/Singapore. CSV transaction dates cannot establish statement completeness: the result explicitly reports unverified coverage. Export the complete period from the source. No bank history retrieval is implied by a source card.

IDs are unique per ledger, provider and account. Without a provider ID, the normalized file hash and row position identify an exact re-upload; overlapping files are uncertain matches, never silently deduplicated by amount alone. Changed data under an existing ID rejects the entire import. Batch request IDs make network retries idempotent, and an owner advisory lock serializes import/review operations. New expense/income rows use the existing Other category if available; absent categories go to review.

Matching amounts/currency within three days are reviewed across sources, including manual Cash entries. Merchant wording for payment platforms, transfers and refunds also triggers review. Review allows matching an existing purchase, approving a separate purchase, excluding money movement, or linking a refund. Pending/excluded/duplicate rows never create another financial entry. Explicit top-ups/transfers are excluded. Refunds require an existing expense of the same currency; combined refunds cannot exceed its amount. Refund rows reduce expense totals, budgets and reports, and carry original linkage in CSV exports. Provenance is immutable through Cash CRUD. Possible matches cannot establish that two transactions are the same; the user decides. Split payments, delayed posting beyond three days and platform fees can require manual examination.

## Optional live PayPal Business adapter

Personal PayPal accounts use CSV. For your **own PayPal Business account only**, create a LIVE REST app and enable Transaction Search. Set server-only Vercel variables `PAYPAL_BUSINESS_API_ENABLED=true`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and `SUPABASE_SERVICE_ROLE_KEY`. Never prefix them NEXT_PUBLIC. Keep the switch disabled otherwise. The API uses PayPal's official OAuth2 **client-credentials** grant; a consumer authorization redirect would be incorrect for this API. Press Authorize business API to verify the reporting scope, then separately press Sync previous 7 days. Credentials stay in Vercel; access tokens exist only in server memory. Only an app fingerprint and authorization timestamp are persisted. Revocation: disable the flag or revoke/rotate the app credentials in PayPal. Scope authorization does not guarantee history endpoint eligibility; a denied history request reports an error and saves nothing.

The adapter requests the full seven-day interval with explicit +08:00 dates and retrieves every returned page, up to 1,000 rows. A larger or failed response rejects the entire import rather than pretending it is complete. Only balance-affecting records are requested; PayPal IDs are scoped with the reporting event code because reporting IDs alone can recur. Gross amounts do not establish expense versus refund, income, transfer or fees, so **all PayPal rows require classification**. MYR and SGD can be posted; other currencies remain pending. PayPal may lag by three hours. Empty days do not prove that no transactions exist.

## Provider eligibility checked 2026-10-13

These are assessments for a private personal ledger, not claims that the providers have no APIs. No sandbox is presented as a live bank connection.

| Source | Official evidence and eligibility | Implemented path |
|---|---|---|
| Maybank | [API Marketplace](https://mconnect.maybank.com/v3/) describes business APIs and sandbox access; unrestricted personal transaction-history production eligibility was not verified. | Template CSV |
| CIMB | [API Gateway](https://www.cimb.com.sg/en/business/solutions-products/cash-management/channels-cimb/api-gateway-cimb.html) is a business service; personal production access was not verified. | Template CSV |
| DBS/POSB | [Developer terms](https://www.dbs.com/dbsdevelopers/devterms.html) distinguish developer program access; personal live history eligibility was not established. | Template CSV |
| OCBC | [Corporate transaction history](https://api.ocbc.com/store/ocbc/apis/documentation?name=Transactional_TransactionHistory&title=Corporate+Transaction+History&type=Transactional) is corporate account data. Personal history eligibility was not verified. | Template CSV |
| UOB | [API Services](https://www.uob.com.sg/business/digital/uob-api-services.page) is offered through business/developer onboarding; personal production history eligibility was not verified. | Template CSV |
| Grab | [Consumer history help](https://help.grab.com/passenger/en-my/articles/115012738667-How-to-check-my-GrabPay-Credits-transaction-history) describes history/receipts. No suitable personal API access was verified. | Template CSV |
| Touch ’n Go | [Merchant services](https://www.touchngo.com.my/merchant) do not establish personal wallet history API eligibility. | Template CSV |
| Wise | [Personal API token documentation](https://docs.wise.com/guides/developer/auth-and-security/personal-api-token) refers to own business accounts and country restrictions. Personal consumer OAuth eligibility was not established. | Template CSV |
| Shopee | [Open Platform](https://open.shopee.com/) documentation could not establish personal buyer history access; do not infer it from seller APIs. | Template CSV |
| Lazada | [Seller authorization](https://open.lazada.com/apps/doc/doc?docId=108260&nodeId=10777) authorizes seller data. It does not establish personal buyer history access. | Template CSV |
| PayPal Business | [Account eligibility](https://developer.paypal.com/api/get-started/) requires Business for live integrations. [Transaction Search](https://developer.paypal.com/api/transaction-search/v1/search-get) documents OAuth scope, client credentials, pagination, and history limits. | Optional live OAuth2 + review; CSV fallback |

## Extending adapters

`src/lib/import/types.ts` defines the adapter contract; `catalog.ts` holds honest capabilities, `normalize.ts` parses statements, and `paypal.ts` is a live adapter. New providers must document production eligibility, official authorization, history bounds, pagination and currency semantics before becoming available. Normalize only trusted transaction fields, and call the existing `run_import` RPC. Never accept bank passwords/OTPs, scrape bank sessions, schedule implicit syncs, or save fake connection state. SQL source allowlists must be updated deliberately with new adapters.

## Validation and operational limits

Tests execute the three migrations in an actual PostgreSQL-compatible PGlite engine, including owner RLS, idempotence, cross-source review, exact constraints, refund bounds and authorization rejection. Production Next.js build/type checks are run separately. Local browser checks use controlled test data; no live bank account or Supabase production credentials were provided. Live PayPal scope/history access and real iPhone standalone behavior require deployment configuration and device verification.
