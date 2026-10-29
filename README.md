# dsh-pnpm-manager

Control whether the **pnpm** used by **DeepSeek Harness (DSH)** goes through a proxy — and inspect / switch its registry and store — from either DSH's settings page or a standalone CLI.

## Why

Node and pnpm do **not** use the Windows system proxy, so pnpm connects to `registry.npmjs.org` and GitHub directly. Behind a firewall that is slow or fails with `ECONNRESET`. Pointing pnpm at a local proxy (e.g. Clash on `127.0.0.1:7897`) makes dependency resolution several times faster — but if the proxy is down, installs fail. This tool makes that switch one click (or one command) away.

## What it touches

Only the `proxy`, `https-proxy` and `registry` lines of `~/.npmrc`. Every other setting is preserved. A backup (`*.bak-<timestamp>`) is written only when the content actually changes.

## As a DSH plugin

`package.json` declares `dsh.bundle.patch`, and `cordis.patch.yml` inserts one host row. The row's `Config` (schemastery) is rendered by DSH as the plugin's settings form:

| field | values | meaning |
|-------|--------|---------|
| `mode` | `on` / `off` / `auto` | force proxy on / force direct / enable only when the proxy port is reachable |
| `proxyUrl` | URL | proxy address (default `http://127.0.0.1:7897`) |
| `noProxy` | hosts (comma-separated) | hosts that bypass the proxy (`noproxy`; only while the proxy is on) |
| `strictSsl` | `true` / `false` | strict TLS verification; disable it for SSL-intercepting proxies (e.g. Clash) → `strict-ssl=false` |
| `registry` | `keep` / `npmjs` / `npmmirror` | leave registry alone / official source / China mirror |

Editing the form rewrites `~/.npmrc` immediately (the loader re-applies the row).

> **Status:** verified in a live DSH web profile (isolated): the host routes return live data, and the client card renders on the plugin page showing the mode status plus **开 / 关 / 自动 / 测试** controls. The host routes are also unit-tested.

### Client card (optional)

`lib/client.js` registers a richer card — mode switch, live status, and a **Test** button — under the `plugins.bundle.config` seat, calling the host routes above. Registration is guarded so an unavailable seat never breaks the Web boot.

## CLI

```bash
node bin/dsh-pnpm-manager.mjs status [--json]
node bin/dsh-pnpm-manager.mjs doctor [--json]
node bin/dsh-pnpm-manager.mjs on | off | toggle | auto
node bin/dsh-pnpm-manager.mjs proxy http://127.0.0.1:7890   # or: proxy reset
node bin/dsh-pnpm-manager.mjs registry npmjs | npmmirror
node bin/dsh-pnpm-manager.mjs store
node bin/dsh-pnpm-manager.mjs test
```

Environment: `PNPM_PROXY_URL`, `DSH_PROFILE_DIR`, `DSH_PNPM_CJS`.

## Layout

```
lib/index.js            host plugin (name / Config / apply + web routes)
lib/npmrc.js            shared .npmrc read/write helpers
lib/client.js           optional client card (__ModuleLoader__ bundle)
bin/dsh-pnpm-manager.mjs   standalone CLI
cordis.patch.yml        bundle patch (inserts the host row)
```

## License

MIT
