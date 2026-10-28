import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// lib/index.js imports @deepseek-ai/schemastery. In an environment without the
// DSH peer packages (e.g. plain CI) the import fails; the tests then skip
// instead of failing the run.
const PLUGIN = new URL("../lib/index.js", import.meta.url).href;
let mod;
let loadError;
try {
  mod = await import(PLUGIN);
} catch (error) {
  loadError = error;
}
const skip = loadError ? `needs @deepseek-ai/schemastery: ${loadError.message}` : false;

test("plugin exports name / Config / apply", { skip }, () => {
  assert.equal(mod.name, "dsh-pnpm-manager");
  assert.equal(typeof mod.Config, "function");
  assert.equal(typeof mod.apply, "function");
});

test("Config resolves defaults and rejects an invalid mode", { skip }, () => {
  const defaults = mod.Config({});
  assert.equal(defaults.mode, "auto");
  assert.equal(defaults.proxyUrl, "http://127.0.0.1:7897");
  assert.equal(defaults.registry, "keep");
  assert.equal(defaults.strictSsl, true);
  assert.equal(defaults.noProxy, "");
  assert.throws(() => mod.Config({ mode: "nope" }));
});

test("apply writes ~/.npmrc (honors USERPROFILE)", { skip }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dshpm-plugin-"));
  const old = process.env.USERPROFILE;
  process.env.USERPROFILE = dir;
  // Safety: only proceed when os.homedir() actually follows USERPROFILE,
  // so this test can never touch the real home .npmrc.
  if (os.homedir() !== dir) {
    process.env.USERPROFILE = old;
    t.skip("os.homedir() does not follow USERPROFILE on this platform");
    return;
  }
  try {
    await mod.apply({ logger: { info() {}, warn() {} } }, { mode: "on", proxyUrl: "http://127.0.0.1:9999", registry: "keep" });
    const f = path.join(dir, ".npmrc");
    assert.ok(fs.existsSync(f));
    assert.match(fs.readFileSync(f, "utf8"), /proxy=http:\/\/127\.0\.0\.1:9999/);
  } finally {
    process.env.USERPROFILE = old;
  }
});
