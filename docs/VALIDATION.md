# Validation record

Executed locally on 2026-10-21 against Node.js 24.21.0 and the available Microsoft SQL Server 2025 Express instance.

| Check | Result |
|---|---|
| Exact-money unit tests | **9 passed** |
| SQL-backed HTTP integration tests | **31 passed** |
| ESLint | **Passed**, no remaining findings |
| TypeScript and Vite production build | **Passed** |
| Dependency audit | **0 known vulnerabilities** reported by npm after dependency updates |
| Built-server HTTP smoke tests | **6 passed**: health, HTML/assets, product metadata, store canonical, sitemap and 404 routes |
| Local migrations / representative new database | **Passed**, migrations 001–005 |
| Demo image correction | Replacement asset returned HTTP 200 |
| Browser visual/mobile/keyboard automation | **Not run**: the Browser execution tool was unavailable in this session |
| Real Stripe/PayPal sandbox transactions | **Not run**: provider credentials and approved seller accounts were not available |
| Public custom-domain DNS / certificate issuance | **Not run**: no public edge or domain provisioning was supplied |
| SMTP delivery | **Not run**: development outbox writes clearly marked local previews |

Integration report: `test-results/integration.json`. Retained successful test database: `ShopwizeTest_1792569606393`. Earlier failed-run databases are retained as separate disposable test artifacts, not production data.

The 31 integration checks exercise migrations/catalog; CSRF/host rejection; exact two-store quote; checkout replay; scoped guest access; partial payment; duplicate capture and balanced journals; vendor isolation; fulfillment transitions; refund quantity/replay; CSV preview/idempotency; payment failure and cart preservation; last-item concurrency; reservation expiry/late capture; single-use handoff; registration/invitation/approval; provider disable; verified order claim; staff redaction; loyalty ownership/replay; synthetic signed-webhook dedup/tamper rejection; reviews/moderation/rowversion; recovery consent/opt-out; shared drafts; upload validation/optimization; shipping-zone matching; partial shipments/cancellation; synthetic dispute journals; import plan limits; mixed currency/analytics consent; and suspension.

The Stripe signature test uses the SDK's generated test signature over a fixture. Dispute tests use explicit synthetic provider-style data. Neither is a provider sandbox purchase, payout, or chargeback. The tests do not validate public browser rendering, third-party account approvals, or live-country capabilities.

## Manual browser acceptance still required

After `npm run dev`, check the storefront and complete a two-store simulated checkout at desktop and mobile widths. Exercise keyboard focus, dialogs, product editor drag/drop, quantity changes, delivery errors, address preservation after failed payment, partial payment status, tracking, returns and role switching. Verify the console and network panels. The final build and API tests are evidence for code/data behavior, not a substitute for these checks.

Reproduce built-server checks with `npm run build` followed by `npm run test:http`. Results: `test-results/http-smoke.json`. The temporary HTTP server is closed after the checks. The development preview was stopped after validation; use `npm run dev` to reopen it.
