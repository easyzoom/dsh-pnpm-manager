import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import net from "node:net";
import path from "node:path";
import { once } from "node:events";
import {
  applyProxySettings,
  getKey,
  proxyIsOn,
  proxyHostPort,
} from "../lib/npmrc.js";

function tmpNpmrc(initial) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dshpm-"));
  const f = path.join(dir, ".npmrc");
  if (initial !== undefined) fs.writeFileSync(f, initial);
  return f;
}
function closedPort() {
  // Ask the OS for a free port, then release it so a later connect is refused.
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

test("on: writes proxy/https-proxy, preserves other lines, sets registry", async () => {
  const f = tmpNpmrc("; keep me\nfoo=bar\n");
  const res = await applyProxySettings(
    { mode: "on", proxyUrl: "http://127.0.0.1:9999", registry: "npmmirror" },
    { files: [f] }
  );
  const txt = fs.readFileSync(f, "utf8");
  assert.match(txt, /; keep me/);
  assert.match(txt, /foo=bar/);
  assert.match(txt, /proxy=http:\/\/127\.0\.0\.1:9999/);
  assert.match(txt, /https-proxy=http:\/\/127\.0\.0\.1:9999/);
  assert.match(txt, /registry=https:\/\/registry\.npmmirror\.com\//);
  assert.equal(res.proxy, true);
  assert.equal(getKey(f, "proxy"), "http://127.0.0.1:9999");
});

test("off: removes proxy lines, keeps registry and other lines", async () => {
  const f = tmpNpmrc("foo=bar\nproxy=http://x\nhttps-proxy=http://x\nregistry=https://r/\n");
  await applyProxySettings({ mode: "off", registry: "keep" }, { files: [f] });
  const txt = fs.readFileSync(f, "utf8");
  assert.doesNotMatch(txt, /^\s*proxy\s*=/m);
  assert.doesNotMatch(txt, /^\s*https-proxy\s*=/m);
  assert.match(txt, /foo=bar/);
  assert.match(txt, /registry=https:\/\/r\//);
});

test("noProxy and strictSsl=false are written only when requested", async () => {
  const f = tmpNpmrc();
  await applyProxySettings(
    { mode: "on", proxyUrl: "http://127.0.0.1:9999", noProxy: "localhost,127.0.0.1", strictSsl: false },
    { files: [f] }
  );
  assert.equal(getKey(f, "noproxy"), "localhost,127.0.0.1");
  assert.equal(getKey(f, "strict-ssl"), "false");

  // Turning strictSsl back on and clearing noProxy removes both lines.
  await applyProxySettings({ mode: "on", proxyUrl: "http://127.0.0.1:9999", strictSsl: true }, { files: [f] });
  assert.equal(getKey(f, "strict-ssl"), undefined);
  assert.equal(getKey(f, "noproxy"), undefined);
});

test("auto: enables when the proxy port is reachable", async () => {
  const srv = net.createServer().listen(0, "127.0.0.1");
  await once(srv, "listening");
  const port = srv.address().port;
  const f = tmpNpmrc();
  try {
    await applyProxySettings({ mode: "auto", proxyUrl: `http://127.0.0.1:${port}` }, { files: [f] });
    assert.equal(proxyIsOn([f]), true);
  } finally {
    srv.close();
  }
});

test("auto: disables when the proxy port is closed", async () => {
  const port = await closedPort();
  const f = tmpNpmrc("proxy=http://old\n");
  await applyProxySettings({ mode: "auto", proxyUrl: `http://127.0.0.1:${port}` }, { files: [f] });
  assert.equal(proxyIsOn([f]), false);
});

test("proxyHostPort parses proxy URLs", () => {
  assert.deepEqual(proxyHostPort("http://127.0.0.1:7897"), ["127.0.0.1", 7897]);
  assert.deepEqual(proxyHostPort("https://example.com"), ["example.com", 443]);
});
