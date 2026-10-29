/**
 * dsh-pnpm-manager — host plugin for DeepSeek Harness (DSH).
 *
 * Adds one profile row whose `Config` DSH renders as a settings form. Editing
 * the form controls whether the pnpm used by DSH goes through a proxy, and
 * optionally which registry it uses. Changes are written to the user-level
 * `~/.npmrc` (the file pnpm always reads).
 *
 * It also registers a few JSON routes the optional client card (lib/client.js)
 * calls: GET /dsh-pnpm-manager/status, POST /dsh-pnpm-manager/mode, and
 * POST /dsh-pnpm-manager/test. Route registration is best-effort and never
 * throws, so a profile without a web server still loads the host half.
 */
import z from "@deepseek-ai/schemastery";
import {
  applyProxySettings,
  DEFAULT_PROXY,
  userNpmrc,
  statusOf,
  probeConnectivity,
  registryOf,
  proxyIsOn,
} from "./npmrc.js";

/** Plugin name (matches the row `name` in cordis.patch.yml). */
export const name = "dsh-pnpm-manager";

/** The web server serves the client card's routes. */
export const inject = ["webServer"];

/**
 * Settings schema. DSH auto-renders this as the plugin's settings form; each
 * field is validated before `apply` runs.
 */
export const Config = z.object({
  mode: z
    .union(["on", "off", "auto"])
    .default("auto")
    .description("代理模式：on 强制走代理；off 直连；auto 按代理端口可达性自动"),
  proxyUrl: z
    .string()
    .default(DEFAULT_PROXY)
    .description("代理地址，例如 http://127.0.0.1:7897"),
  noProxy: z
    .string()
    .default("")
    .description("绕过代理的主机（逗号分隔，写入 noproxy；仅代理开启时生效）"),
  strictSsl: z
    .boolean()
    .default(true)
    .description("严格校验 TLS；Clash 等 SSL 拦截代理可能需要关闭（写入 strict-ssl=false）"),
  registry: z
    .union(["keep", "npmjs", "npmmirror"])
    .default("keep")
    .description("registry：keep 保持不变；npmjs 官方源；npmmirror 国内镜像"),
});

/** Route prefix shared by the host routes and the client card. */
const PREFIX = "/dsh-pnpm-manager";

function writeJson(res, status, body) {
  try {
    res.statusCode = status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.setHeader("cache-control", "no-store");
    res.end(JSON.stringify(body));
  } catch {
    /* response already finished */
  }
}

function readJsonBody(req, maxBytes = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > maxBytes) {
        reject(new Error("body too large"));
        try {
          req.destroy();
        } catch {
          /* already destroyed */
        }
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function isJson(req) {
  return String(req.headers["content-type"] || "").toLowerCase().startsWith("application/json");
}

/** Build the three routes bound to one resolved config snapshot. */
function makeRoutes(cfg) {
  const files = [userNpmrc()];
  const proxyUrl = () => cfg?.proxyUrl || DEFAULT_PROXY;
  return [
    {
      kind: "exact",
      path: `${PREFIX}/status`,
      handler: async (req, res) => {
        if (req.method !== "GET") return writeJson(res, 405, { ok: false, error: "method-not-allowed" });
        const status = await statusOf({ files, proxyUrl: proxyUrl() });
        writeJson(res, 200, { ok: true, mode: cfg?.mode ?? "auto", ...status });
      },
    },
    {
      kind: "exact",
      path: `${PREFIX}/mode`,
      handler: async (req, res) => {
        if (req.method !== "POST") return writeJson(res, 405, { ok: false, error: "method-not-allowed" });
        if (!isJson(req)) return writeJson(res, 415, { ok: false, error: "json-required" });
        let body;
        try {
          body = await readJsonBody(req);
        } catch {
          return writeJson(res, 400, { ok: false, error: "invalid-body" });
        }
        const mode = body && body.mode;
        if (mode !== "on" && mode !== "off" && mode !== "auto") {
          return writeJson(res, 400, { ok: false, error: "invalid-mode" });
        }
        try {
          const result = await applyProxySettings({ ...cfg, mode }, { files });
          writeJson(res, 200, { ok: true, ...result });
        } catch (error) {
          writeJson(res, 500, { ok: false, error: String(error?.message ?? error) });
        }
      },
    },
    {
      kind: "exact",
      path: `${PREFIX}/config`,
      handler: async (req, res) => {
        if (req.method !== "POST") return writeJson(res, 405, { ok: false, error: "method-not-allowed" });
        if (!isJson(req)) return writeJson(res, 415, { ok: false, error: "json-required" });
        let body;
        try {
          body = await readJsonBody(req);
        } catch {
          return writeJson(res, 400, { ok: false, error: "invalid-body" });
        }
        if (body && body.mode !== undefined && body.mode !== "on" && body.mode !== "off" && body.mode !== "auto") {
          return writeJson(res, 400, { ok: false, error: "invalid-mode" });
        }
        const next = { ...cfg, ...body };
        try {
          const result = await applyProxySettings(next, { files });
          writeJson(res, 200, { ok: true, mode: next.mode ?? "auto", ...result });
        } catch (error) {
          writeJson(res, 500, { ok: false, error: String(error?.message ?? error) });
        }
      },
    },
    {
      kind: "exact",
      path: `${PREFIX}/test`,
      handler: async (req, res) => {
        if (req.method !== "POST") return writeJson(res, 405, { ok: false, error: "method-not-allowed" });
        if (!isJson(req)) return writeJson(res, 415, { ok: false, error: "json-required" });
        const result = await probeConnectivity({
          registryUrl: registryOf(files),
          proxyOn: proxyIsOn(files),
          proxyUrl: proxyUrl(),
        });
        writeJson(res, 200, { ok: true, ...result });
      },
    },
  ];
}

/**
 * Apply the current configuration and register the client-card routes. Both
 * halves are guarded: a failure is logged but never thrown (DSH fails the
 * whole boot when a plugin's apply throws).
 */
export async function apply(ctx, config) {
  const cfg = config ?? {};
  try {
    const result = await applyProxySettings(cfg);
    ctx?.logger?.info?.(
      `dsh-pnpm-manager: 代理 ${result.proxy ? "已启用" : "已关闭"}（${result.proxyUrl}），registry=${result.registry}`
    );
  } catch (error) {
    const message = error && typeof error === "object" && "message" in error ? error.message : String(error);
    ctx?.logger?.warn?.(`dsh-pnpm-manager: 写入 .npmrc 失败：${message}`);
  }

  try {
    const webServer = ctx?.webServer;
    if (webServer && typeof webServer.register === "function") {
      const register = () => {
        const disposers = makeRoutes(cfg).map((route) => {
          try {
            return webServer.register(route);
          } catch {
            return undefined;
          }
        });
        return () => {
          for (const dispose of disposers) {
            try {
              dispose?.();
            } catch {
              /* already disposed */
            }
          }
        };
      };
      if (typeof ctx.effect === "function") ctx.effect(register, "dsh-pnpm-manager: web routes");
      else register();
    }
  } catch (error) {
    const message = error && typeof error === "object" && "message" in error ? error.message : String(error);
    ctx?.logger?.warn?.(`dsh-pnpm-manager: 注册 web 路由失败：${message}`);
  }
}
