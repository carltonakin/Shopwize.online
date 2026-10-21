# SmarterASP.NET deployment failure: diagnosis and solution

## What failed

The supplied `ErrorLog.txt` shows both builds failing during **npm dependency installation**, before TypeScript or Vite could build the application:

```text
/app/node_modules/msnodesqlv8
fatal error: sql.h: No such file or directory
make ... Error 1
npm install ... exit code: 1
```

The native `msnodesqlv8` package was a mandatory dependency. Railpack's Linux image did not contain the ODBC development header it needed. Repeating the same build cannot supply that missing dependency.

The subsequent `unrecognized image format` message follows the failed container build. It is a downstream deployment-wrapper error; this log does not show a problem with product images or frontend assets. The ESLint deprecation message, npm production-configuration warning and package-manager detection message are not the fatal failure.

## Changes applied

- Moved `msnodesqlv8` to **optionalDependencies** and regenerated `package-lock.json`. A failed optional native build no longer aborts the whole npm installation. The normal `mssql` dependency remains installed and provides its default JavaScript/TCP driver.
- Kept Windows trusted authentication available when explicitly configured. Missing native prerequisites produce a clear configuration error; the app never silently switches authentication modes.
- Added `SQL_PORT`, production configuration validation and explicit encrypted SQL-login connection settings.
- Added Node 24 and npm metadata so Railpack selects the tested Node major instead of its old Node 22 default.
- Added `railpack.json` with lockfile installation, development build tools, optional platform packages and container runtime defaults. Do not disable all optional dependencies: Sharp needs its platform packages.
- Added `.env.production.example`. It is a template, not a file automatically loaded by the app, and contains no credentials.
- Updated migrations to use a provider-assigned database name and skip the `master` database / CREATE DATABASE path when `SQL_CREATE_DATABASE=false`. Production defaults to this behavior. Existing local development database creation still works.
- Added deployment regression tests covering driver selection without native ODBC, SQL configuration, hosted database names, local trusted authentication and the optional dependency contract.

The database remains **Microsoft SQL Server**. No database migration to another engine is involved.

## SmarterASP.NET deployment mode

The online hosting provider is **SmarterASP.NET**. The supplied log identifies a **Linux/Railpack container build** through its GitHub deployment system: it uses `/app`, Linux build images and `npm install`. The Windows path used to save the final deployment log does not change the build environment shown in that log. The fix below targets this observed deployment mode.

SmarterASP.NET also documents older Windows IIS/iisnode hosting. Those instructions describe a different deployment mode; this project is currently configured for the container build in the supplied log.

In the SmarterASP.NET control panel, open the target website, choose **Node.js App**, then **Github Deploy**. Set **Build Command** to `npm run build` and **Start Command** to `npm start`; use the repository root. These controls are documented in the [SmarterASP.NET GitHub deployment guide](https://www.smarterasp.net/support/kb/a2332/how-to-deploy-node_js-to-our-server-from-a-github-repository.aspx). The repository's `railpack.json` supplies the install command.

Use the SQL Server hostname, database name and SQL login assigned to your SmarterASP.NET account. The app uses the default Tedious driver through `mssql`, consistent with the provider's [Node.js SQL Server connection example](https://www.smarterasp.net/support/kb/a2274/how-to-connect-mssql-with-node_js.aspx). Keep `SQL_TRUSTED_CONNECTION=false` and `SQL_CREATE_DATABASE=false`; create or select the database in the hosting control panel before migrating.

Configure the production values below for the Node.js app using the environment mechanism available in the hosting panel. If this deployment uses a private `.env` file, provision it on the host from `.env.production.example` and keep it out of Git. The app already loads dotenv; see the provider's [environment-variable guidance](https://www.smarterasp.net/support/kb/a2234/how-to-use-node-environment-variables-with-a-dotenv-file-in-node_js.aspx). Preserve the host-assigned `PORT`.

A persistent worker process and durable media storage are application requirements. Their availability on this account has not been verified. Confirm the plan's process supervision and storage options with SmarterASP.NET before enabling production checkout; the web deployment alone does not start the worker.

## Redeploy

1. Review and commit the changed source, both package files, `railpack.json`, the production template, tests and documentation. Keep the local `.env` and `.local` out of Git. These changes have not been committed or pushed by this repair task.
2. Configure the following runtime values for the SmarterASP.NET Node.js app. Use the SQL Server connection details assigned to that hosting account:

| Setting | Value |
|---|---|
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `PORT` | The port assigned by the host; otherwise the app defaults to `3000` |
| `PUBLIC_ORIGIN` | `https://shopwize.online` (or the actual HTTPS address used for this deployment) |
| `CHECKOUT_ORIGIN` | Same trusted HTTPS checkout address |
| `DEMO_AUTH_ENABLED` | `false` |
| `MOCK_PAYMENTS_ENABLED` | `false` |
| `SQL_TRUSTED_CONNECTION` | `false` |
| `SQL_CREATE_DATABASE` | `false` |
| `SQL_SERVER` | Provider's SQL Server hostname, without a URL scheme |
| `SQL_PORT` | Provider's TCP port, usually `1433` |
| `SQL_DATABASE` | Exact existing database name assigned by the provider |
| `SQL_USER` / `SQL_PASSWORD` | Provider-issued SQL login, supplied privately in hosting settings |
| `SQL_ENCRYPT` | `true` |
| `SQL_TRUST_CERTIFICATE` | `false` |

3. Select the repository root as the build directory. Let Railpack read `railpack.json`. If the host overrides build commands, use install `npm ci --include=dev --include=optional`, build `npm run build`, and start `npm start`. Remove an obsolete `RAILPACK_NODE_VERSION=22` override or change it to `24`. Preserve the host-supplied `PORT`.
4. Rebuild the container with the updated manifest **and lockfile**. A native optional-dependency failure can still be logged on a builder without ODBC; npm must finish successfully and proceed to `npm run build`.
5. With the same hosting environment, run `npm run db:migrate` once as a release/deployment operation using a database identity allowed to create/alter tables. It will use the existing target database when `SQL_CREATE_DATABASE=false`. Do not run demo seed in production. For a new empty database, follow `docs/DEPLOYMENT.md` for initial administrator setup.
6. Confirm the public `/api/health` returns `{ "ok": true, ... }` through the configured domain. This checks database connectivity as well as HTTP. If it fails after the build succeeds, check SQL hostname/port, firewall access, login, database permissions and certificate trust; those would be new runtime issues, not the native build failure in this log.
7. Run `npm run worker` as a separate supervised process with the same database/provider/SMTP settings. Keep payment live flags false until provider sandbox verification is complete.

No production credentials were requested or changed. No remote deployment was triggered. This Windows workspace has no usable Docker/WSL Linux runtime, so the actual hosted Linux rebuild and remote database connection still need verification after redeployment.

## References

The [npm optional dependency contract](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#optionaldependencies) explicitly permits installation to proceed when an optional dependency cannot build. The [node-mssql documentation](https://github.com/tediousjs/node-mssql#installation) identifies Tedious as the default JavaScript driver and MSNodeSQLv8 as an optional alternative. [Railpack's Node configuration](https://railpack.com/languages/node/) documents Node/package-manager selection; its [configuration-file reference](https://railpack.com/config/file/) documents install commands and runtime variables.

## Local verification of this repair

- `npm run test`: 16 passing tests (9 money tests and 7 deployment regressions).
- `npm run test:integration`: all 31 passing checks using the actual local SQL Server and Windows trusted connection.
- `npm run build`: passed TypeScript and Vite production build.
- `npm run lint`: passed, including a minor pre-existing smoke-test regex escape correction.
- `SQL_CREATE_DATABASE=false` migration rerun: succeeded against the existing disposable database `ShopwizeTest_1792598152323`.
- Lockfile refresh: npm reported zero known vulnerabilities.

A hosted Linux rebuild and remote SQL-login connection are not included in these results. The configuration and source fix are ready for review and redeployment; they are not a claim that the remote deployment has already succeeded.
