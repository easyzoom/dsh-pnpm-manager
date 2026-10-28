// lib/npmrc.js — shared .npmrc helpers for the host plugin and the CLI.
//
// The plugin/CLI never rewrites the whole file: it only adds/removes the
// proxy / https-proxy / registry lines, preserving every other setting.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import http from "node:http";

/** Default proxy address (Clash-style local mixed port). */
export const DEFAULT_PROXY = "http://127.0.0.1:7897";

/** Named registries the CLI/plugin can switch to. */
export const REGISTRIES = {
  npmjs: "https://registry.npmjs.org/",
  npmmirror: "https://registry.npmmirror.com/",
};

/** Split a proxy URL into [host, port] for a TCP reachability probe. */
export function proxyHostPort(url = DEFAULT_PROXY) {
  try {
    const u = new URL(url);
    return [u.hostname, Number(u.port) || (u.protocol === "https:" ? 443 : 80)];
  } catch {
    return ["127.0.0.1", 7897];
  }
}

/** The user-level .npmrc that pnpm always reads. */
export function userNpmrc() {
  return path.join(os.homedir(), ".npmrc");
}

/**
 * The .npmrc files a command should manage.
 * Always the user-level file; the profile file only when it already exists.
 */
export function npmrcFiles({ profileDir } = {}) {
  const files = [userNpmrc()];
  if (profileDir) {
    const p = path.join(profileDir, ".npmrc");
    if (fs.existsSync(p) && !files.includes(p)) files.push(p);
  }
  return files;
}

function readLines(f) {
  try {
    return fs.readFileSync(f, "utf8").split(/\r?\n/);
  } catch {
    return [];
  }
}
function keyRe(k) {
  return new RegExp("^\\s*" + k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*=", "i");
}
/** Read one key from an .npmrc, or undefined. */
export function getKey(f, k) {
  const re = keyRe(k);
  for (const l of readLines(f)) if (re.test(l)) return l.slice(l.indexOf("=") + 1).trim();
  return undefined;
}
function backup(f) {
  try {
    if (fs.existsSync(f)) {
      fs.copyFileSync(f, `${f}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`);
    }
  } catch {
    /* backup is best-effort */
  }
}
/** Preserve other lines, drop the named keys, then append `set` entries. */
export function editNpmrc(f, { set = {}, remove = [] } = {}) {
  const res = [...new Set([...remove, ...Object.keys(set)])].map(keyRe);
  let lines = readLines(f).filter((l) => !res.some((re) => re.test(l)));
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  for (const [k, v] of Object.entries(set)) lines.push(`${k}=${v}`);
  const next = lines.length ? lines.join("\n") + "\n" : "";
  let prev = null;
  try {
    prev = fs.readFileSync(f, "utf8");
  } catch {
    /* new file */
  }
  if (prev !== null && prev !== next) backup(f);
  fs.writeFileSync(f, next, "utf8");
}

export function proxyIsOn(files) {
  return files.some((f) => getKey(f, "proxy") !== undefined || getKey(f, "https-proxy") !== undefined);
}
export function setProxy(files, url) {
  for (const f of files) editNpmrc(f, { set: { proxy: url, "https-proxy": url } });
}
export function clearProxy(files) {
  for (const f of files) editNpmrc(f, { remove: ["proxy", "https-proxy"] });
}
export function registryOf(files) {
  return getKey(files[0], "registry") || REGISTRIES.npmjs;
}
export function setRegistry(files, url) {
  for (const f of files) editNpmrc(f, { set: { registry: url } });
}

/** Resolve true when host:port accepts a TCP connection within `timeout` ms. */
export function reachable(host, port, timeout = 1500) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    let done = false;
    const fin = (v) => {
      if (done) return;
      done = true;
      s.destroy();
      resolve(v);
    };
    s.setTimeout(timeout);
    s.once("connect", () => fin(true));
    s.once("timeout", () => fin(false));
    s.once("error", () => fin(false));
    s.connect(port, host);
  });
}

/**
 * Apply a proxy/registry configuration (used by the host plugin).
 * @param {{ mode?: 'on'|'off'|'auto', proxyUrl?: string, registry?: string,
 *           noProxy?: string, strictSsl?: boolean }} cfg
 * @param {{ files?: string[] }} [opts]
 */
export async function applyProxySettings(cfg = {}, { files = [userNpmrc()] } = {}) {
  const { mode = "auto", proxyUrl = DEFAULT_PROXY, registry = "keep", noProxy = "", strictSsl = true } = cfg;
  let on;
  if (mode === "on") on = true;
  else if (mode === "off") on = false;
  else on = await reachable(...proxyHostPort(proxyUrl));

  if (on) setProxy(files, proxyUrl);
  else clearProxy(files);

  // noproxy: hosts that bypass the proxy. Only meaningful while the proxy is on.
  const np = typeof noProxy === "string" ? noProxy.trim() : "";
  for (const f of files) {
    if (on && np) editNpmrc(f, { set: { noproxy: np } });
    else editNpmrc(f, { remove: ["noproxy"] });
  }

  // strict-ssl: npm defaults to true; only write the line when disabled.
  for (const f of files) {
    if (strictSsl === false) editNpmrc(f, { set: { "strict-ssl": "false" } });
    else editNpmrc(f, { remove: ["strict-ssl"] });
  }

  if (registry && registry !== "keep") {
    const url = REGISTRIES[registry] || registry;
    if (url) setRegistry(files, url);
  }
  return {
    proxy: on,
    proxyUrl,
    noProxy: on && np ? np : "",
    strictSsl: strictSsl !== false,
    registry: registry === "keep" ? registryOf(files) : REGISTRIES[registry] || registry,
  };
}

/** Read the current proxy/registry state (used by the host routes and CLI). */
export async function statusOf({ files = [userNpmrc()], proxyUrl = DEFAULT_PROXY } = {}) {
  const [h, p] = proxyHostPort(proxyUrl);
  const reach = await reachable(h, p);
  return {
    proxy: proxyIsOn(files),
    proxyUrl,
    proxyReachable: reach,
    registry: registryOf(files),
    noproxy: getKey(files[0], "noproxy") ?? null,
    strictSsl: getKey(files[0], "strict-ssl") !== "false",
  };
}

function registryHostPort(url) {
  try {
    const u = new URL(url || REGISTRIES.npmjs);
    return [u.hostname, Number(u.port) || (u.protocol === "https:" ? 443 : 80)];
  } catch {
    return ["registry.npmjs.org", 443];
  }
}

/**
 * Probe registry connectivity: through the proxy when it is on (an HTTP CONNECT
 * tunnel), otherwise a direct TCP connect. Resolves with timing and method.
 */
export function probeConnectivity({
  registryUrl = REGISTRIES.npmjs,
  proxyOn = false,
  proxyUrl = DEFAULT_PROXY,
  timeout = 8000,
} = {}) {
  const [rh, rp] = registryHostPort(registryUrl);
  const [ph, pp] = proxyHostPort(proxyUrl);
  const t0 = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok, via, error) => {
      if (settled) return;
      settled = true;
      resolve({ ok, host: `${rh}:${rp}`, via, latencyMs: Date.now() - t0, ...(error ? { error } : {}) });
    };
    if (!proxyOn) {
      reachable(rh, rp, timeout).then((ok) => done(ok, "direct", ok ? undefined : "connect failed"));
      return;
    }
    const req = http.request({ host: ph, port: pp, method: "CONNECT", path: `${rh}:${rp}`, timeout });
    req.once("connect", (res, socket) => {
      try {
        socket.destroy();
      } catch {
        /* socket already gone */
      }
      done(res.statusCode === 200, `proxy ${proxyUrl}`, res.statusCode === 200 ? undefined : `CONNECT ${res.statusCode}`);
    });
    req.once("timeout", () => {
      try {
        req.destroy();
      } catch {
        /* already destroyed */
      }
      done(false, `proxy ${proxyUrl}`, "timeout");
    });
    req.once("error", (e) => done(false, `proxy ${proxyUrl}`, e.code || String(e)));
    req.end();
  });
}
