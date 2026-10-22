# SmarterASP.NET: successful build, IIS placeholder still displayed

## What the successful log established

Deployment `shopwizeonline_3899436` built successfully on Linux, copied the application out of its Docker container, downloaded and extracted it into the Windows website folder, then deleted the build container and image. The running website is Windows IIS; Railpack is the build environment. The earlier assumption that the Linux container stayed running was incorrect.

The previous repository had no IIS startup configuration, and `npm start` used a TypeScript loader with platform-specific dependencies. An IIS default document cannot start this backend. Changing only `index.html` would also leave `/api/*` unavailable.

## Files supplied by this repair

- `web.config` routes every application request through httpPlatformHandler, launches `runtime/node.exe server.cjs`, maps the IIS-assigned port, and retains application HTTP responses. Internal folders and startup logs are blocked from public requests.
- `server.cjs` fixes the working directory and loads the compiled backend. When IIS supplies `HTTP_PLATFORM_PORT`, it takes precedence over a fixed `PORT`, and the listener binds to loopback.
- `npm run build` type-checks the project, emits the backend into `runtime/server`, and builds the frontend into `dist`. `npm start` now runs `node server.cjs`.
- Railpack appends `npm run build:windows-runtime` after its normal build. It keeps package-file copies and lockfile installation. Node's bundled npm is used directly; no Corepack download is required.
- The additional build step installs lockfile-based Windows x64 runtime dependencies into `runtime/node_modules`, including the Windows Sharp binary. Lifecycle scripts are disabled for this cross-platform installation; compiled server startup does not need tsx/esbuild or native ODBC. The Linux build dependencies stay separate.
- It downloads the official Windows x64 Node executable matching the Node 24 build version and verifies its SHA-256 against that release's official checksum file. The executable lives at `runtime/node.exe`, so IIS does not depend on an older system Node version.
- The generated runtime directory is excluded from Git and rebuilt by deployment. No SQL password or private environment file is packaged by these scripts.

## Deploy and activate

1. In the website's **Node.js App** settings, select **Enable Node.js**, enter **server.cjs** as **Application startup file**, and submit. This is the Node.js startup-file field, not the IIS Default Doc setting.
2. Back up any existing host `web.config` before redeployment. Preserve host-specific redirects or other intentional settings when merging; the application's handler and executable settings below must remain in effect.
3. Under **Github Deploy**, deploy the updated repository with **Build Command: `npm run build`** and **Start Command: `npm start`**. Railpack appends the Windows packaging step automatically. The successful log should include `Windows IIS runtime prepared`.
4. In File Manager, confirm these are under the website's mapped root, alongside `server.cjs`: `web.config`, `runtime/node.exe`, `runtime/server/index.js`, `runtime/node_modules`, and `dist/index.html`. The mapped root must contain the whole application, not only `dist`.
5. Confirm the deployed `web.config` has `processPath=".\\runtime\\node.exe"`, `arguments="server.cjs"`, and `PORT=%HTTP_PLATFORM_PORT%`. Saving Node.js settings again may regenerate this file; keep the application version's executable and routing settings.
6. Keep the existing private SQL settings and HTTPS origins in this website's application-pool environment. The defaults in Railpack's image do not configure IIS after files are copied. The supplied `web.config` also sets production mode and disables demo/mock authentication. Do not set a fixed `PORT`.
7. Recycle the website's application pool after environment/configuration changes. Open `https://shopwize.online/api/health`: expect HTTP 200 JSON with `ok: true`, `database: "Microsoft SQL Server"`, and `mode: "production"`. Then check the storefront and its JS/CSS.
8. If startup fails, inspect `runtime/startup.log*` privately in File Manager. A 500.19 configuration error means IIS rejected configuration; a 502 startup error needs that runtime log. A continued placeholder or IIS 404 means the active website root/configuration still needs checking.

The hosting database already has migrations 001?005. This startup repair does not require reseeding or another database migration. Hosted checkout remains unverified until the public application is reachable and its catalog/payment/worker configuration is ready.

## Deploy the prebuilt Windows ZIP

An already-built Windows package can be uploaded without using the GitHub/Railpack builder. The prepared local artifact is `test-results/shopwize-windows-iis.zip`. It contains the compiled backend, frontend assets, Windows production dependencies, checksum-verified Node executable, IIS configuration and migration files. It excludes private environment files, uploaded media and Git history.

1. Back up the existing website files/configuration. In the hosting panel stop the website and recycle its application pool if needed to release the running Node executable.
2. Use **File Manager** to upload the ZIP into the website root and extract it there, overwriting the matching application files. Use File Manager extraction, not the GitHub Deploy page's ZIP build option: the latter runs the build again.
3. The extracted root must directly contain `server.cjs`, `web.config`, `runtime` and `dist`, without an extra enclosing folder. Leave the site's private environment and `.local/media` in place.
4. Confirm `web.config` still points to `.\\runtime\\node.exe` with arguments `server.cjs`. Keep the site's existing private application-pool environment variables.
5. Start the website, recycle its application pool, then verify `https://shopwize.online/api/health` and the storefront. Inspect `runtime/startup.log*` privately if IIS reports 502. Remove the uploaded ZIP from the public website root after extraction; retain a private local copy.

This route does not call npm or download build dependencies on the host. It still requires the site's existing SQL configuration and IIS Node.js support. The ZIP does not run migrations or create accounts.

## Other deployment modes

For an ordinary installation built on its runtime OS, use `npm ci`, `npm run build`, and `npm start`; skip the Windows packaging step. The checked-in Railpack configuration now targets this SmarterASP.NET Windows extraction workflow. It is not intended as a portable Linux runtime image because the compiled server's adjacent dependencies target Windows.

Compiled operational entry points are `runtime/server/worker.js`, `runtime/scripts/migrate.js`, and `runtime/scripts/bootstrap-admin.js`. Run them with Node from the website root and the same private environment. The web process does not start the background worker.

## Provider references

SmarterASP.NET documents [Windows IIS/httpPlatformHandler hosting](https://www.smarterasp.net/support/kb/a1970/quick-start-node_js.aspx), [custom Windows Node executables](https://www.smarterasp.net/support/kb/a2471/how-to-use-a-custom-node_js-executable.aspx), and [application-pool environment variables](https://www.smarterasp.net/support/kb/a2437/how-to-set-environment-variable-for-your-account.aspx). Microsoft's [httpPlatformHandler reference](https://learn.microsoft.com/en-us/iis/extensions/httpplatformhandler/httpplatformhandler-configuration-reference) documents site-relative executable paths and process startup. Sharp documents [cross-platform package installation](https://sharp.pixelplumbing.com/install/#cross-platform).

## Verification of this repair

- Production TypeScript/Vite build passed; all 16 unit tests and lint passed.
- Railpack 0.35.0's generated plan preserves the working install/setup commands and source copy, runs the Windows packaging step after the build, and explicitly includes the runtime directory in the final export.
- Windows packaging installed 170 production/optional packages and verified the official Node 24.21.0 Windows executable checksum.
- Eight checks passed using the packaged Windows executable and dependencies: native Sharp WebP generation, compiled-server startup from another working directory, IIS dynamic-port precedence, production health using the hosted SQL database, storefront HTML, JS/CSS, catalog, and API status handling. The smoke test made no database writes.
- These runtime checks ran locally on Windows, with IIS-style environment variables. The actual remote IIS handler still needs verification after redeployment. At the last public check before this repair, the site returned IIS HTTP 502.
