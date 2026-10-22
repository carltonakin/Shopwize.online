# Shopwize

A local multi-vendor marketplace built with Node.js/TypeScript, Express, React, Vite, and **Microsoft SQL Server**. Includes a working storefront, seller and host workspaces, and a transactional multi-vendor checkout.

The supplied specification was used as the implementation brief. The workspace was empty; a new project was created with your authorization. No existing application or customer data was replaced.

## Start locally

Prerequisites: Node.js 24 LTS, Microsoft SQL Server, and (for Windows trusted authentication) Microsoft ODBC Driver 17 or 18 for SQL Server. The local workspace is already installed and configured for the existing local SQL Server instance.

```powershell
npm ci
# On a fresh checkout only: copy .env.example to .env and configure SQL Server.
npm run db:migrate
npm run db:seed
npm run dev
```

Open **http://localhost:5173**. API health: http://127.0.0.1:3000/api/health.

Run background processing in a second terminal:

```powershell
npm run worker
```

Use **My account → development sign-in** to try customer, two seller accounts, and host administrator roles. Development shortcuts require loopback binding and are rejected in production. Random seed passwords are written to ignored `.local/demo-credentials.json`. The seed refuses production use and is additive; it does not reset tables.

## Try the checkout

1. Add products from Form & Field and Everyday Studio.
2. Open the bag and continue to checkout. Enter a US demo address; optionally use `WELCOME10`.
3. Review each store's delivery options and the full server-calculated amount.
4. Choose the **local simulator**. Test success, failure, and partial seller payment from the order page.
5. Sign in as the appropriate seller to accept, pack, ship, and track the scoped order. Item-level shipping and cancellation are under Manage.
6. Request an item return from the customer order link. The seller receives it with an explicit stock disposition; host finance processes the refund.

The simulator moves **no money**. Stripe/PayPal adapters are implemented but no real provider sandbox purchase or live transaction was performed. WooPayments is visibly unavailable because this project has no WooCommerce installation.

## Checks

```powershell
npm run test
npm run test:integration
npm run lint
npm run build
```

Integration tests create a fresh `ShopwizeTest_<timestamp>` SQL Server database, apply all migrations, seed fixtures, and call the actual Express API over loopback HTTP. The database is retained for inspection; no automatic drop is performed. Results are saved to `test-results/integration.json` and summarized in [docs/VALIDATION.md](docs/VALIDATION.md).

## SmarterASP.NET hosting

SmarterASP.NET builds this project with Railpack on Linux, then extracts the files onto **Windows IIS**. Follow the [Windows IIS activation and startup guide](docs/SMARTERASP_IIS.md). The Node.js application startup file is `server.cjs`; GitHub Deploy keeps build `npm run build` and start `npm start`. The build also packages Windows dependencies and a verified Node 24 executable. Configure private SQL-login settings from [.env.production.example](.env.production.example) in the website application pool. Earlier build errors are recorded in [RAILPACK_FIX.md](docs/RAILPACK_FIX.md).

## Delivery notes

- [Feature status and known limits](docs/FEATURE_STATUS.md)
- [Provider configuration and sandbox checklist](docs/PAYMENTS.md)
- [Deployment, DNS/TLS, worker operations, backup and recovery](docs/DEPLOYMENT.md)
- [Architecture, financial rules and changed files](docs/ARCHITECTURE.md)

The development `.env`, local media, email previews, credentials, logs, databases, and build dependencies are not source artifacts. Do not publish `.local` or `.env`.
