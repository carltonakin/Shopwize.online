# SmarterASP.NET deployment failure: diagnosis and solution

## Deployment #3900108: npm registry HTTP 503

This attempt failed during Corepack's download of `npm@11.19.0`, before dependency installation or either build step. npm's [incident report](https://status.npmjs.org/incidents/xfp75s9j3bp8) records degraded package installation beginning at 02:33 UTC on October 22, 2026, matching the deployment time. The trailing image-format message is a consequence of the failed build.

The Node 24.21.0 distribution in the log already includes npm 11.19.0. The repair removes `packageManager` from the root manifest and removes the explicit Corepack install/prepare commands. Railpack now uses Node's bundled npm. Removing the manifest field also prevents Railpack from generating a runtime copy of the absent `/opt/corepack` directory. PATH, cache-directory setup, package-file copies, `npm ci`, the application build, Windows packaging, and the explicit Windows runtime export are retained.

Both dependency installations use `--prefer-offline`, allowing npm to reuse cached packages verified against the lockfile. This does not guarantee an online build during a registry outage: uncached application dependencies still require npm's registry. No registry mirror or alternative source has been introduced.

For immediate deployment without a registry build, use the prepared Windows ZIP and the File Manager procedure in [SMARTERASP_IIS.md](SMARTERASP_IIS.md#deploy-the-prebuilt-windows-zip).

## Current status: Windows IIS startup repair awaits successful deployment

Deployment `shopwizeonline_3899436` confirms the install and production build succeeded. The completed log also shows that the container is temporary: its application files are copied to Windows IIS and the container is deleted. Follow [SMARTERASP_IIS.md](SMARTERASP_IIS.md) for the startup repair, Windows dependencies and activation steps. The earlier container-runtime assumption below has been corrected.

## Resolved failure: package files missing from the install step

The deployment log for `shopwizeonline_3899018` confirms that Railpack 0.35.0 reads `railpack.json`, selects Node 24.21.0, and runs `npm ci --include=dev --include=optional`. It then fails with `EUSAGE` because npm cannot find a usable lockfile.

`package-lock.json` is already committed, valid JSON, lockfile version 3, and consistent with `package.json`. The earlier custom `steps.install.commands` array replaced Railpack's generated commands, including the commands that copy the package files. The generated install step contained only `npm ci`, with no application files copied into it. This was a configuration error introduced by the previous repair.

The corrected install step retains Railpack's standard PATH, Corepack preparation and cache-directory setup, and explicitly copies both package files before installing. Corepack preparation creates `/opt/corepack`, which the generated runtime image copies from the build step:

```json
{
  "commands": [
    {
      "path": "/app/node_modules/.bin"
    },
    {
      "dest": "package.json",
      "src": "package.json"
    },
    {
      "cmd": "sh -c 'npm i -g corepack@latest && corepack enable && corepack prepare --activate'",
      "customName": "npm i -g corepack@latest && corepack enable && corepack prepare --activate"
    },
    {
      "cmd": "mkdir -p /app/node_modules/.cache"
    },
    {
      "dest": "package-lock.json",
      "src": "package-lock.json"
    },
    {
      "dest": "package.json",
      "src": "package.json"
    },
    "npm ci --include=dev --include=optional"
  ]
}
```

These are Railpack [copy commands](https://railpack.com/config/file/#copy-command), executed before npm. The install inputs retain the Node toolchain; the preparation commands also preserve the package-manager files expected by the runtime copy inputs. The application build continues to copy the source and run `npm run build`.

Commit and push the updated `railpack.json`, then redeploy that commit in SmarterASP.NET. Keep **Build Command** as `npm run build` and **Start Command** as `npm start`. The lockfile does not need regeneration for this error. Hosted database migrations are already applied; this build failure does not require another database change.

The trailing `unrecognized image format` is downstream of the failed container build. A successful rebuild and public HTTPS/routing verification remain necessary before the website can be declared working.

### Validation of the package-file copy fix

- Compared the final install setup with Railpack's unmodified provider plan: every PATH, Corepack, cache and file-copy setup command is preserved; the dependency install command is changed to `npm ci`. The default runtime copy inputs are all retained.
- Generated before/after plans with Railpack **0.35.0**, the version in the hosting log, from a clean committed-source snapshot. The original plan had no package-file copies; the corrected plan copies both files before npm and retains the build inputs and start command.
- Ran `npm ci --include=dev --include=optional` in a fresh directory containing only those copied package files: **389 packages installed successfully**.
- Added the clean source to that installation: the production TypeScript/Vite build and **all 16 unit tests passed**.
- These execution checks ran on Windows. The subsequent successful host log confirms the Linux build; public IIS startup is addressed by the current repair.

## Original failure: native ODBC dependency

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

The complete successful log establishes a **Linux/Railpack build followed by Windows IIS hosting**. The build VM creates a container only to extract application files; it does not remain as the web server. The [Windows IIS guide](SMARTERASP_IIS.md) supersedes earlier advice to configure a running Linux container.

Use SQL login with `SQL_TRUSTED_CONNECTION=false` and `SQL_CREATE_DATABASE=false`. Keep SQL credentials and HTTPS origins in the Windows website application-pool environment. The hosted database has already been migrated.

## Redeploy

Use the current [deployment and activation procedure](SMARTERASP_IIS.md#deploy-and-activate). Keep GitHub Deploy build `npm run build` and start `npm start`; the Node.js application startup file is `server.cjs`. The checked-in Railpack config appends Windows packaging to its default build. Verify public HTTPS, `/api/health`, storefront assets and the separately supervised worker after deployment.

## References

The [npm optional dependency contract](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#optionaldependencies) explicitly permits installation to proceed when an optional dependency cannot build. The [node-mssql documentation](https://github.com/tediousjs/node-mssql#installation) identifies Tedious as the default JavaScript driver and MSNodeSQLv8 as an optional alternative. [Railpack's Node configuration](https://railpack.com/languages/node/) documents Node/package-manager selection; its [configuration-file reference](https://railpack.com/config/file/) documents install commands and runtime variables.

## Local verification of this repair

- `npm run test`: 16 passing tests (9 money tests and 7 deployment regressions).
- `npm run test:integration`: all 31 passing checks using the actual local SQL Server and Windows trusted connection.
- `npm run build`: passed TypeScript and Vite production build.
- `npm run lint`: passed, including a minor pre-existing smoke-test regex escape correction.
- `SQL_CREATE_DATABASE=false` migration rerun: succeeded against the existing disposable database `ShopwizeTest_1792598152323`.
- Lockfile refresh: npm reported zero known vulnerabilities.

These are the original repair checks. Subsequently the hosted SQL database was migrated and tested, and the Linux build succeeded. Public IIS startup must still be verified after the Windows hosting repair.
