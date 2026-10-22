# Deployment and operations

## SmarterASP.NET (Linux build, Windows IIS runtime)

The target hosting provider is **SmarterASP.NET**. Its successful deployment log confirms that Linux-built files are extracted onto Windows IIS. Follow [SMARTERASP_IIS.md](SMARTERASP_IIS.md) and `.env.production.example`. The repository now includes `railpack.json`; hosted SQL-login connections do not require the optional native ODBC package. Set `SQL_CREATE_DATABASE=false` to migrate an existing provider-assigned database without accessing `master`.

## Runtime

This is a Node service with SQL Server access, not a static-only site. Use a Windows service host for trusted SQL authentication or the `mssql` TCP driver with a restricted SQL login. Node 24 and the lockfile are the tested local baseline. The production server runs compiled JavaScript through `server.cjs`; TypeScript tooling is used during build and development.

1. Create a separate production SQL database and backups. Use a deployment identity for migrations and a separate runtime identity for application access.
2. Install with `npm ci`, configure environment outside source control, then `npm run db:migrate` and `npm run build`. Do **not** seed production.
3. On an empty production database, supply `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_NAME`, and a strong `BOOTSTRAP_ADMIN_PASSWORD` through the service's secure environment; run `npm run admin:bootstrap`. It refuses to run when a host administrator exists. Remove bootstrap credentials immediately afterward.
4. Set `NODE_ENV=production`, `DEMO_AUTH_ENABLED=false`, `MOCK_PAYMENTS_ENABLED=false`, and HTTPS `PUBLIC_ORIGIN` / `CHECKOUT_ORIGIN`. Configure actual SMTP and provider settings.
5. Run `npm start` and one `npm run worker` instance as supervised services, with this project as their working directory. For SmarterASP.NET, IIS launches `server.cjs` with the packaged Windows Node executable, loopback binding and its assigned `HTTP_PLATFORM_PORT`; see the IIS guide for the separate compiled worker command. For a separate deployment with a reverse proxy on the same machine, bind Node to loopback. Restart automatically on failure; preserve logs without sensitive request bodies.
6. Keep `.local/media` on durable storage, back it up and serve it only as static image content. Mail previews are development-only. Deny direct web access to `.local`, `.env`, scripts and database files.

For SQL authentication configure `SQL_TRUSTED_CONNECTION=false`, `SQL_USER`, `SQL_PASSWORD`, `SQL_ENCRYPT=true`, `SQL_TRUST_CERTIFICATE=false`, and a verifiable server certificate. Windows trusted mode uses the service identity, not the interactive developer identity. With Driver 18, update `SQL_ODBC_DRIVER`. Avoid granting the runtime identity schema-modification privileges. Grant application rights on required tables and deny UPDATE/DELETE on `LedgerEntries`; the application only inserts financial history.

## Host routing and session boundaries

Configure `PUBLIC_ORIGIN=https://shopwize.online`, `CHECKOUT_ORIGIN=https://shopwize.online`, and `BASE_DOMAIN=shopwize.online`. Route apex and wildcard DNS to the reverse proxy. Obtain apex and wildcard certificates with your DNS provider's supported ACME DNS challenge automation. Public product canonical URLs point to the central marketplace to avoid duplicate indexing across seller domains.

Preserve the original Host header when proxying ordinary traffic. Express does not blindly trust forwarded hosts or forwarded IPs. The backend should be reachable only by the reverse proxy. Requests to unknown domains return 421. Cookies omit Domain and are host-only; do not add a broad parent-domain cookie scope. Custom-domain carts use short-lived single-use handoff to the central checkout.

Because Express does not trust arbitrary proxies, a shared reverse proxy affects application IP rate limiting. Apply per-client limits at the edge. Configure any future Express trust-proxy setting only against exact trusted proxy addresses; never use an unrestricted value on a publicly reachable backend.

## Custom domains and certificate automation

1. Set `SHOPWIZE_EDGE_CNAME` to the public hostname of the TLS edge (for example `edge.shopwize.online`). A seller requests a hostname and receives `_shopwize.<hostname>` TXT with a random ownership value.
2. The seller creates the TXT and CNAME. The Verify action checks both and enters `verified_pending_tls`; it does not claim a certificate exists.
3. Configure a certificate-automating edge. For Caddy on the same machine, an on-demand certificate `ask` endpoint can call `http://127.0.0.1:3000/api/internal/tls/allow`. The endpoint accepts only loopback peers and already DNS-verified, non-detached domain records. Keep it internal and configure persistent ACME storage. The edge must send the requested domain query parameter. This configuration is a deployment template, not executed infrastructure.
4. Provision a publicly trusted certificate for the seller hostname. Host Settings → **Check DNS & TLS** connects to the configured public edge IP with that hostname as TLS SNI, checks ownership/routing, validates the certificate and requires more than seven days of validity before activation.
5. The worker checks active domains every six hours. Failed ownership/routing/certificate validation changes the domain to `needs_attention`; stale verification older than seven days also fails host resolution. Alert on these records. Renew certificates automatically before this threshold and rerun the check after correction.
6. Detach immediately invalidates routing and rotates the challenge. Remove the edge mapping/certificate as part of operator teardown. A detached hostname remains reserved in SQL to prevent another seller claiming it without administrative review and a fresh ownership process.

Automated certificate issuance is owned by the edge's ACME implementation. The app performs allow-listing, activation, monitoring and detach; it does not pretend to issue certificates itself. Public DNS/TLS was not exercised locally.

## Worker and recovery

The worker runs every 30 seconds with overlapping ticks prevented in-process. Run one supervised worker for this version. SQL leases and provider idempotency limit duplicate processing; deliberately scale only after multi-worker fault testing.

- Webhooks/outbox: durable records, unique source IDs, leased processing and bounded exponential backoff (up to eight attempts). Inspect exhausted records in the financial queue and host payment page. Never clear event/source IDs to force reprocessing.
- Payments: reconcile recent pending orders; expire stock reservations; reconcile late success without overselling. A captured item without available inventory enters `needs_attention` and cannot silently be shipped.
- Transfers: pending → processing → succeeded, or retry/reconcile_required. A never-attempted transfer held by a refund is reduced before sending. Uncertain old requests are stopped before provider idempotency retention could permit duplicate creation. Verify the provider record before an operator repair.
- Refunds: original capture/snapshot → provider refund ID → verified success → immutable linked ledger reversal. Pending provider refund IDs are retrieved, not treated as successful. Refund/transfer reversals survive process restarts through the outbox.
- Disputes: fetch current provider state, journal exact reported balance movements in settlement currency, hold pending transfers and expose the case to host finance. Provider evidence submission remains in its dashboard. Use documented balance adjustments only against confirmed evidence and the agreed seller-liability policy.
- Email: SMTP sends use stable message IDs; without SMTP, development writes `.local/mail/<id>.json` and records `local_preview`. `local_preview` is never described as sent mail. Message delivery remains at-least-once under SMTP response uncertainty.
- Recovery reminders: consented nonempty carts aged 24 hours to seven days receive one reminder per cart, with scoped recovery and opt-out tokens.

Review provider dashboards alongside `PaymentAttempts`, `PaymentTransactions`, `Transfers`, `Payouts`, `Refunds`, `RefundTransferReversals`, `Disputes`, `WebhookEvents`, `OutboxMessages` and `AuditEvents`. Never repair ledger history with UPDATE or DELETE. Stop new checkouts at the provider setting while resolving uncertain financial state; keep historical handlers enabled.

## Migration and backup recovery

Migrations 001–005 are incremental SQL Server batches with version records and transactions. Migration 005 backfills shipping counters for prior whole-order shipments. The migration runner creates a missing database only when creation is enabled (the development default, or explicit `SQL_CREATE_DATABASE=true`). Production and `SQL_CREATE_DATABASE=false` connect directly to the existing configured database. Provider-assigned names are supported. It does not drop/reset an existing database.

Back up SQL and media before release, verify restore in an isolated environment, and retain the corresponding source/lockfile. Prefer a forward correction over a down migration once orders exist. To roll back application code, stop API/worker writes, restore the previous application version against a compatible schema, or restore the complete pre-release backup to a separate instance and reconcile all provider events occurring since the backup. Do not restore over live financial data without that reconciliation plan. There is no destructive automatic rollback script.

Integration databases are retained under `ShopwizeTest_<timestamp>` for inspection. Remove only explicitly reviewed disposable test databases using an administrative SQL tool when no tests are running; no application command performs this deletion.
