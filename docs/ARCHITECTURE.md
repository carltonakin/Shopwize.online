# Architecture and financial rules

## Source map

| Area | Files |
|---|---|
| Runtime, HTTP security and routes | `server/index.ts`, `server/config.ts`, `server/auth.ts`, `server/db.ts`, `server/util.ts` |
| Marketplace and operations | `server/services/marketplace.ts`, `operations.ts`, `drafts.ts`, `shipping.ts`, `domains.ts`, `recovery.ts` |
| Checkout and immutable accounting | `server/services/checkout.ts`, `returns.ts`, `settlements.ts`, `disputes.ts`, `server/money.ts` |
| Provider adapters and background processing | `server/payments/providers.ts`, `server/worker.ts` |
| Storefront and dashboards | `web/App.tsx`, `web/Workspace.tsx`, `web/Recovery.tsx`, `web/useProductDraft.ts`, `web/api.ts`, `web/styles.css` |
| Server metadata and public assets | `server/seo.ts`, `web/index.html`, `web/public/favicon.svg` |
| SQL schema | `database/migrations/001_marketplace.sql` through `005_shipment_backfill.sql` |
| Local setup, seed and initial admin | `scripts/migrate.ts`, `scripts/seed.ts`, `scripts/bootstrap-admin.ts`, `.env.example` |
| Verification | `tests/money.test.ts`, `scripts/integration-test.ts`, `test-results/integration.json` |
| Build and tooling | `package.json`, `package-lock.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `eslint.config.mjs` |

All listed source files are new in the previously empty workspace. Development artifacts under `.local`, `node_modules`, `dist`, `.env`, and `test-results` are ignored by source control. No remote repository, public Site or production deployment was created.

## Data and concurrency

Parameterized SQL Server queries are the data access layer. No SQLite, PostgreSQL, MySQL or Python backend was introduced. Domain objects use relational identifiers and foreign keys; validated presentation settings and immutable snapshots use JSON columns. Money aggregates use DECIMAL(19,4), timestamps use UTC datetime2, and products/drafts use rowversion for optimistic concurrency.

Checkout resolves current prices, inventory, publication, host approval, provider eligibility, delivery, discounts, taxes and commission on the server. SQL serializable transactions reserve stock before provider network calls. Last-item contention returns an availability error. Bounded retries handle SQL deadlock victims only; provider calls never run inside retrying SQL transaction callbacks.

Order, vendor-order, fulfillment, payment, refund, transfer, payout, dispute, webhook and outbox state are separate. Browser redirects and local status buttons cannot mark a real provider payment as paid. Order tracking tokens are hashed, scoped and expiring. Host-only sessions and validated host mappings prevent custom-domain cookies being shared across unrelated tenants.

## Exact money

- Decimal strings are converted into currency-specific integer minor units for calculation, then returned as decimal strings. Zero- and three-decimal currencies are covered by unit tests.
- Commission precedence: vendor+category → vendor → category → global. The illustrative default is 1,000 basis points (10%), resolved on the product subtotal after allocated discounts and excluding shipping/tax.
- Discount and refund residuals are allocated deterministically; item/suborder/order totals reconcile exactly.
- Captures snapshot item price, discount, tax, commission rule/version, processing time, return terms and delivery choices. Later catalog or fee-rule changes do not rewrite purchased terms.
- Ledger journals balance to zero. Capture records separate processor, vendor liability, host commission and tax. Refunds reverse original line amounts and link to original entries. Provider fees are not assumed to be zero when unavailable.
- Transfers relocate seller pending/available balances; they do not prove a bank payout. Disputes record actual provider balance movements in their reported currency and use suspense pending policy-based allocation. Manual adjustments are signed, audited, idempotent entries.
- USD, US seed sellers, zero default tax and 10% sample commission are fixtures and configurable defaults, not verified business facts.

## Operational boundaries

Vendor queries and mutations enforce membership on the server. Fulfillment staff can access customer delivery details for paid orders; finance views omit those addresses; catalog staff cannot read orders/returns/ledger/exports. Server role checks remain authoritative even if an unpermitted control is visible in a shared dashboard.

Uploads decode accepted image signatures, enforce pixel/byte limits, resize and write stripped WebP under a non-executable media directory. Rich text is treated as text. Themes and banners use validated structured fields and approved image sources; arbitrary scripts are not stored as executable store content.

The frontend uses Unsplash sample photography; the basket source was replaced after its original URL returned 404. These are illustrative local catalog records, not claims about real inventory or real customer reviews.
