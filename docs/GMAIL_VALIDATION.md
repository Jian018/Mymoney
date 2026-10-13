# Gmail Expense Sync validation — 2026-10-13

## Completed locally

- TypeScript: `npm run typecheck` passed.
- Automated suite: `npm test` passed all 15 tests. Gmail email examples are synthetic, labelled fixtures, not live Gmail responses.
- Production: `npm run build` passed with Next.js 16.4.0.
- PostgreSQL (PGlite): migrations 001–004, owner/device RLS, private token access restrictions, exact uniqueness, idempotent sync leases, historical data preservation, manual Cash matching, cross-platform and cross-currency review, refund limits, category edits and disconnect invalidation passed.
- Token cryptography: authenticated encryption rejects tampering and a different owner/context.
- Actual local production Next.js server: unauthenticated Gmail endpoints returned 401; cross-origin POST requests returned 403; invalid OAuth callback redirected to an authorization failure marker; obsolete import routes returned 404; privacy page returned 200.
- Edge at 440 × 956 with controlled local HTTP fixtures: Dashboard default, no scan on opening, explicit sync, disabled button during sync, review correction, Cash entry and disconnect passed with no JavaScript errors. Root dimensions and scroll dimensions were exactly 440 × 956; long content scrolled internally. A reduced 440 × 430 viewport remained accessible.

## Not verified

No real authorized Gmail account or real email data was used. Google OAuth consent, refresh/revocation against Google, live Gmail template coverage, production Supabase/PostgREST, deployed Vercel configuration, real iPhone standalone OAuth/cookies, actual keyboard/safe areas and Web Push still require configuration and device acceptance checks. Local fixtures do not prove live Gmail synchronization works.

Apply the SQL migration and follow `GMAIL_SYNC.md` for Google Cloud, server-only Vercel variables, restricted-scope requirements, deployment and real-account acceptance steps. Existing finance tests passed; no historical transaction data was deleted.
