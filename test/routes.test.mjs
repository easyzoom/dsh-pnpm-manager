import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

// lib/index.js imports @deepseek-ai/schemastery; skip when it is unavailable.
const PLUGIN = new URL("../lib/index.js", import.meta.url).href;
let mod;
let loadError;
try {
  mod = await import(PLUGIN);
} catch (error) {
  loadError = error;
}
const skip = loadError ? `needs @deepseek-ai/schemastery: ${loadError.message}` : false;

/** Drive a route handler with mock IncomingMessage/ServerResponse objects. */
function callRoute(route, method, body, json = true) {
  return new Promise((resolve) => {
    const req = new Readable({ read() {} });
    req.method = method;
    req.headers = json ? { "content-type": "application/json" } : {};
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(k, v) {
        this.headers[k] = v;
      },
      end(chunk) {
        let parsed = null;
        try {
          parsed = chunk ? JSON.parse(chunk) : null;
        } catch {
          parsed = chunk;
        }
        resolve({ status: this.statusCode, body: parsed });
      },
    };
    route.handler(req, res);
    if (body !== undefined) req.push(JSON.stringify(body));
    req.push(null);
  });
}

test("host routes: status / mode / test", { skip }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dshpm-routes-"));
  const old = process.env.USERPROFILE;
  process.env.USERPROFILE = dir;
  // Safety: never touch the real home .npmrc.
  if (os.homedir() !== dir) {
    process.env.USERPROFILE = old;
    t.skip("os.homedir() does not follow USERPROFILE on this platform");
    return;
  }
  try {
    const routes = [];
    const ctx = {
      logger: { info() {}, warn() {} },
      webServer: {
        register(r) {
          routes.push(r);
          return () => {};
        },
      },
      effect(fn) {
        fn();
        return () => {};
      },
    };
    await mod.apply(ctx, { mode: "on", proxyUrl: "http://127.0.0.1:9999", registry: "keep" });
    assert.equal(routes.length, 4, "four routes registered");
    const route = (suffix) => routes.find((r) => r.path.endsWith(suffix));
    assert.ok(route("/status") && route("/mode") && route("/config") && route("/test"));

    const status = await callRoute(route("/status"), "GET");
    assert.equal(status.status, 200);
    assert.equal(status.body.ok, true);
    assert.equal(status.body.proxy, true);

    const off = await callRoute(route("/mode"), "POST", { mode: "off" });
    assert.equal(off.status, 200);
    assert.equal(off.body.ok, true);
    assert.equal(off.body.proxy, false);
    assert.doesNotMatch(fs.readFileSync(path.join(dir, ".npmrc"), "utf8"), /^\s*proxy\s*=/m);

    assert.equal((await callRoute(route("/mode"), "POST", { mode: "nope" })).status, 400);
    assert.equal((await callRoute(route("/mode"), "POST", { mode: "on" }, false)).status, 415);
    assert.equal((await callRoute(route("/status"), "POST", {})).status, 405);

    const probe = await callRoute(route("/test"), "POST", {});
    assert.equal(probe.status, 200);
    assert.equal(typeof probe.body.ok, "boolean");
    assert.equal(typeof probe.body.via, "string");

    const configured = await callRoute(route("/config"), "POST", {
      mode: "on",
      proxyUrl: "http://127.0.0.1:9999",
      registry: "npmmirror",
      noProxy: "localhost",
      strictSsl: false,
    });
    assert.equal(configured.status, 200);
    assert.equal(configured.body.ok, true);
    assert.equal(configured.body.proxy, true);
    const after = fs.readFileSync(path.join(dir, ".npmrc"), "utf8");
    assert.match(after, /registry=https:\/\/registry\.npmmirror\.com\//);
    assert.match(after, /noproxy=localhost/);
    assert.match(after, /strict-ssl=false/);
  } finally {
    process.env.USERPROFILE = old;
  }
});
