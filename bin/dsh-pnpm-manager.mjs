#!/usr/bin/env node
/**
 * dsh-pnpm-manager — CLI
 *
 * Control whether the pnpm used by DeepSeek Harness (DSH) goes through a
 * proxy, and inspect / switch its registry and store. The host plugin
 * (lib/index.js) exposes the same switch inside DSH's settings page.
 *
 * Commands:
 *   status                         show proxy / registry / store
 *   doctor                         full diagnostic (paths, proxy, store)
 *   on | off | toggle              enable / disable / flip the proxy
 *   auto                           enable if the proxy port is reachable, else disable
 *   proxy [url|reset]              show / set a custom proxy address
 *   registry [npmjs|npmmirror|url] show / switch the registry
 *   store                          show the pnpm store path and size
 *   test                           verify registry reachability through pnpm
 *   help                           show help
 *
 * Add --json to status/doctor for machine-readable output.
 * Env: PNPM_PROXY_URL / DSH_HOME / DSH_PROFILE_DIR / DSH_PNPM_CJS
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  DEFAULT_PROXY,
  REGISTRIES,
  proxyHostPort,
  npmrcFiles,
  getKey,
  proxyIsOn,
  setProxy,
  clearProxy,
  registryOf,
  setRegistry,
  reachable,
} from "../lib/npmrc.js";

const CONF = path.join(os.homedir(), ".dsh-pnpm-manager.json");
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
const PROFILE = process.env.DSH_PROFILE_DIR || path.join(DSH_HOME, "profiles", "desktop");
// The pnpm bundled inside DSH is deployment-specific; supply it via DSH_PNPM_CJS
// when needed. Without it, `test` falls back to a pnpm on PATH.
const PNPM_CJS = process.env.DSH_PNPM_CJS || null;

const readConf = () => {
  try {
    return JSON.parse(fs.readFileSync(CONF, "utf8"));
  } catch {
    return {};
  }
};
const writeConf = (c) => fs.writeFileSync(CONF, JSON.stringify(c, null, 2) + "\n", "utf8");
let PROXY = process.env.PNPM_PROXY_URL || readConf().proxy || DEFAULT_PROXY;

const ARGV = process.argv.slice(2);
const AS_JSON = ARGV.includes("--json");
const [cmd, arg] = ARGV.filter((a) => a !== "--json");

const files = () => npmrcFiles({ profileDir: PROFILE });

function storeDir() {
  try {
    const t = fs.readFileSync(path.join(PROFILE, "pnpm-workspace.yaml"), "utf8");
    const m = t.match(/^\s*storeDir\s*:\s*['"]?([^'"\r\n]+?)['"]?\s*$/m);
    if (m) return m[1].trim();
  } catch {
    /* no workspace file */
  }
  return null;
}
function dirStats(dir) {
  let bytes = 0,
    count = 0;
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let ents;
    try {
      ents = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.isFile())
        try {
          bytes += fs.statSync(p).size;
          count++;
        } catch {
          /* skip */
        }
    }
  }
  return { bytes, count };
}
function human(n) {
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return n.toFixed(1) + " " + u[i];
}

async function collectStatus() {
  const fs_ = files();
  const [h, p] = proxyHostPort(PROXY);
  const reach = await reachable(h, p);
  return {
    proxy: proxyIsOn(fs_),
    proxyUrl: PROXY,
    proxyReachable: reach,
    registry: registryOf(fs_),
    noproxy: getKey(fs_[0], "noproxy") ?? null,
    strictSsl: getKey(fs_[0], "strict-ssl") !== "false",
    store: storeDir(),
    profile: PROFILE,
    npmrc: fs_,
  };
}
function printStatus(o) {
  if (AS_JSON) return console.log(JSON.stringify(o, null, 2));
  console.log("dsh-pnpm-manager 状态");
  console.log("  代理配置：");
  for (const f of o.npmrc) console.log(`    ${getKey(f, "proxy") !== undefined ? " ON " : "OFF"}  ${f}`);
  console.log(`    代理地址：${o.proxyUrl}  ${o.proxyReachable ? "可达 ✅" : "不可达 ⚠️"}`);
  console.log(`  registry：${o.registry}`);
  console.log(`  noproxy：${o.noproxy ?? "(未设置)"}`);
  console.log(`  strict-ssl：${o.strictSsl ? "true（默认）" : "false"}`);
  console.log(`  pnpm store：${o.store ? o.store + (fs.existsSync(o.store) ? "  ✓" : "  ✗ 不存在") : "（未找到 storeDir）"}`);
  console.log(`  总体：${o.proxy ? "启用代理（走代理）" : "关闭代理（直连）"}`);
}

async function collectDoctor() {
  const s = await collectStatus();
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, pass: Boolean(pass), detail });
  add("DSH_HOME", fs.existsSync(DSH_HOME), DSH_HOME);
  add("profile package.json", fs.existsSync(path.join(PROFILE, "package.json")), PROFILE);
  add("proxy configured", s.proxy, s.proxy ? s.proxyUrl : "未配置代理（直连）");
  add("proxy reachable", s.proxyReachable, s.proxyUrl);
  add("store exists", Boolean(s.store) && fs.existsSync(s.store), s.store || "未找到 storeDir");
  if (s.store && fs.existsSync(s.store)) {
    const { bytes, count } = dirStats(s.store);
    add("store size", true, `${human(bytes)} / ${count} files`);
  }
  return { ...s, dshHome: DSH_HOME, checks };
}
function printDoctor(d) {
  if (AS_JSON) return console.log(JSON.stringify(d, null, 2));
  console.log("dsh-pnpm-manager 诊断\n");
  for (const c of d.checks) console.log(`  ${c.pass ? "✅" : "❌"} ${c.name}：${c.detail}`);
  console.log(`\n  代理：${d.proxy ? `开（${d.proxyUrl}）` : "关（直连）"}，端口${d.proxyReachable ? "可达" : "不可达"}`);
  console.log(`  registry：${d.registry}  |  noproxy：${d.noproxy ?? "(未设置)"}  |  strict-ssl：${d.strictSsl}`);
  const failed = d.checks.filter((c) => !c.pass).length;
  console.log(`\n  结论：${failed === 0 ? "全部正常 ✅" : `${failed} 项异常 ❌`}`);
}

function runPnpmView() {
  const args = ["--dir", PROFILE, "view", "dsh-unlag", "version"];
  const opts = { encoding: "utf8", timeout: 45000, stdio: ["ignore", "pipe", "pipe"] };
  if (PNPM_CJS) {
    if (!fs.existsSync(PNPM_CJS)) throw new Error(`DSH_PNPM_CJS 指向的文件不存在：${PNPM_CJS}`);
    return execFileSync(process.execPath, [PNPM_CJS, ...args], opts);
  }
  return execFileSync("pnpm", args, opts);
}
function testRegistry() {
  const mode = proxyIsOn(files()) ? `走代理 ${PROXY}` : "直连";
  console.log(`通过 pnpm 访问 registry（当前：${mode}）…`);
  const t0 = Date.now();
  try {
    const out = runPnpmView();
    console.log(`✅ 连通：dsh-unlag=${out.trim()}，耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch {
    const hint = PNPM_CJS ? "" : "\n（未设置 DSH_PNPM_CJS，已尝试 PATH 上的 pnpm；可设置它指向 DSH 自带的 pnpm.cjs）";
    console.error(`❌ 失败（耗时 ${((Date.now() - t0) / 1000).toFixed(1)}s）。检查代理是否开启 / registry / pnpm 是否可用。${hint}`);
    process.exit(1);
  }
}

function setProxyUrl(url) {
  if (url === "reset" || url === "default") {
    const c = readConf();
    delete c.proxy;
    writeConf(c);
    PROXY = DEFAULT_PROXY;
    console.log(`已恢复默认代理地址 ${DEFAULT_PROXY}`);
  } else {
    try {
      new URL(url);
    } catch {
      console.error("代理 URL 无效");
      process.exit(2);
    }
    const c = readConf();
    c.proxy = url;
    writeConf(c);
    PROXY = url;
    console.log(`已设置代理地址 ${url}`);
  }
  if (proxyIsOn(files())) {
    setProxy(files(), PROXY);
    console.log("已按新地址更新 .npmrc。");
  }
}

switch (cmd) {
  case "status":
    printStatus(await collectStatus());
    break;
  case "doctor":
  case "diag":
    printDoctor(await collectDoctor());
    break;
  case "on":
  case "enable":
    if (!(await reachable(...proxyHostPort(PROXY)))) console.warn(`⚠️  代理 ${PROXY} 当前不可达，仍写入配置。`);
    setProxy(files(), PROXY);
    console.log(`已启用代理 → ${PROXY}`);
    break;
  case "off":
  case "disable":
    clearProxy(files());
    console.log("已关闭代理 → pnpm 直连 registry");
    break;
  case "toggle":
    if (proxyIsOn(files())) {
      clearProxy(files());
      console.log("已关闭代理 → 直连");
    } else {
      setProxy(files(), PROXY);
      console.log(`已启用代理 → ${PROXY}`);
    }
    break;
  case "auto": {
    const ok = await reachable(...proxyHostPort(PROXY));
    if (ok) {
      setProxy(files(), PROXY);
      console.log(`代理 ${PROXY} 可达 → 已启用代理`);
    } else {
      clearProxy(files());
      console.log(`代理 ${PROXY} 不可达 → 已关闭代理（直连）`);
    }
    break;
  }
  case "test":
    testRegistry();
    break;
  case "proxy":
    if (!arg) console.log(`当前代理地址：${PROXY}（默认 ${DEFAULT_PROXY}）`);
    else setProxyUrl(arg);
    break;
  case "registry": {
    if (!arg) {
      console.log(`当前 registry：${registryOf(files())}`);
      break;
    }
    const url = REGISTRIES[arg] || arg;
    try {
      new URL(url);
    } catch {
      console.error("registry URL 无效");
      process.exit(2);
    }
    setRegistry(files(), url);
    console.log(`已设置 registry：${url}`);
    break;
  }
  case "store": {
    const sd = storeDir();
    if (!sd) {
      console.log("未在 pnpm-workspace.yaml 找到 storeDir。");
      break;
    }
    console.log(`store 路径：${sd}`);
    if (!fs.existsSync(sd)) {
      console.log("  ✗ 不存在");
      break;
    }
    const { bytes, count } = dirStats(sd);
    console.log(`  存在 ✓  约 ${human(bytes)}，${count} 个文件`);
    break;
  }
  case "help":
  case "-h":
  case "--help":
  default:
    console.log(`dsh-pnpm-manager — DeepSeek Harness 的 pnpm 管理器

代理：
  status [--json]    查看状态（代理 / registry / store）
  doctor [--json]    完整诊断（路径、代理可达性、store）
  on | off | toggle  启用 / 关闭 / 切换代理
  auto               代理端口可达则启用，否则关闭
  proxy [url|reset]  查看 / 设置自定义代理地址（默认 ${DEFAULT_PROXY}）

registry：
  registry           查看当前 registry
  registry npmjs     切回官方源
  registry npmmirror 切到国内镜像
  registry <url>     自定义 registry

其他：
  store              查看 pnpm store 路径与占用
  test               通过 pnpm 实测 registry 连通与耗时
  help               显示本帮助

环境变量：PNPM_PROXY_URL / DSH_HOME / DSH_PROFILE_DIR / DSH_PNPM_CJS`);
}
