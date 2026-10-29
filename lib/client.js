/**
 * dsh-pnpm-manager — client card.
 *
 * Hand-written in DSH's `window.__ModuleLoader__.load({ id, factory })` bundle
 * format (no build step). Renders an editable form (mode / proxy URL / registry
 * / no-proxy / strict TLS) with a save confirmation and a connectivity test,
 * and talks to the host routes registered by lib/index.js:
 *   GET  /dsh-pnpm-manager/status
 *   POST /dsh-pnpm-manager/config   { mode, proxyUrl, registry, noProxy, strictSsl }
 *   POST /dsh-pnpm-manager/test
 *
 * Registered into both the plugin's page and a Settings → Built-in plugins tab.
 * Registration is guarded and waits for the seat to be declared, so an
 * unavailable seat never breaks the Web boot.
 */
window.__ModuleLoader__.load({
  id: "dsh-pnpm-manager",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var react = require("react");
    var h = react.createElement;
    var useState = react.useState;
    var useEffect = react.useEffect;
    var useCallback = react.useCallback;

    var PREFIX = "/dsh-pnpm-manager";

    var S = {
      wrap: { display: "flex", flexDirection: "column", gap: "14px", padding: "4px 0", maxWidth: "620px", fontFamily: "inherit", color: "#1a1a1a" },
      status: { fontSize: "13px", color: "#666", lineHeight: 1.6 },
      field: { display: "flex", flexDirection: "column", gap: "5px" },
      label: { fontSize: "12px", color: "#666" },
      input: { border: "1px solid #d9d9d9", borderRadius: "7px", padding: "7px 9px", fontSize: "14px", background: "#fff", color: "#1a1a1a", outline: "none", width: "100%", boxSizing: "border-box" },
      row: { display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" },
      primary: { background: "#111", color: "#fff", border: "1px solid #111", borderRadius: "7px", padding: "7px 16px", fontSize: "14px", cursor: "pointer" },
      secondary: { background: "#fff", color: "#1a1a1a", border: "1px solid #d9d9d9", borderRadius: "7px", padding: "7px 16px", fontSize: "14px", cursor: "pointer" },
      confirm: { padding: "12px", border: "1px solid #e3e3e3", borderRadius: "9px", background: "#fafafa", fontSize: "13px", display: "flex", flexDirection: "column", gap: "8px" },
      muted: { color: "#666", fontSize: "13px" },
    };

    function fetchJson(path, init) {
      return fetch(path, init).then(function (r) {
        return r.json();
      });
    }
    function registryChoice(url) {
      if (!url) return "keep";
      var u = String(url);
      if (u.indexOf("npmmirror") >= 0) return "npmmirror";
      if (u.indexOf("registry.npmjs.org") >= 0) return "npmjs";
      return "keep";
    }
    function Field(label, control) {
      return h("div", { style: S.field }, h("div", { style: S.label }, label), control);
    }

    function Card() {
      var st = useState(null);
      var status = st[0];
      var setStatus = st[1];
      var fm = useState(null);
      var form = fm[0];
      var setForm = fm[1];
      var bu = useState(false);
      var busy = bu[0];
      var setBusy = bu[1];
      var cf = useState(false);
      var confirming = cf[0];
      var setConfirming = cf[1];
      var mg = useState(null);
      var msg = mg[0];
      var setMsg = mg[1];
      var tr = useState(null);
      var testResult = tr[0];
      var setTestResult = tr[1];

      var load = useCallback(function () {
        fetchJson(PREFIX + "/status")
          .then(function (d) {
            if (!d || !d.ok) {
              setStatus(d || { ok: false });
              setForm(null);
              return;
            }
            setStatus(d);
            setForm({
              mode: d.mode || "auto",
              proxyUrl: d.proxyUrl || "",
              registry: registryChoice(d.registry),
              noProxy: d.noproxy || "",
              strictSsl: d.strictSsl !== false,
            });
          })
          .catch(function (e) {
            setStatus({ ok: false, error: String(e) });
          });
      }, []);
      useEffect(function () {
        load();
      }, [load]);

      function patch(k, v) {
        setForm(function (f) {
          var n = {};
          for (var key in f) n[key] = f[key];
          n[k] = v;
          return n;
        });
      }
      function save() {
        setBusy(true);
        setMsg(null);
        fetchJson(PREFIX + "/config", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(form),
        })
          .then(function (d) {
            if (d && d.ok) {
              setMsg({ kind: "ok", text: "已保存并应用" });
              load();
            } else {
              setMsg({ kind: "err", text: (d && d.error) || "保存失败" });
            }
          })
          .catch(function (e) {
            setMsg({ kind: "err", text: String(e) });
          })
          .finally(function () {
            setBusy(false);
            setConfirming(false);
          });
      }
      function runTest() {
        setBusy(true);
        setTestResult({ running: true });
        fetchJson(PREFIX + "/test", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
          .then(function (d) {
            setTestResult(d);
          })
          .catch(function (e) {
            setTestResult({ ok: false, error: String(e) });
          })
          .finally(function () {
            setBusy(false);
          });
      }

      if (!form) {
        return h("div", { style: S.wrap }, h("div", { style: S.muted }, status && status.error ? "错误：" + status.error : "加载中…"));
      }

      var statusLine = status.proxy
        ? "走代理 " + status.proxyUrl + (status.proxyReachable ? " · 可达 ✅" : " · 不可达 ⚠️")
        : "直连（不使用代理）";
      var modeLabel = { auto: "自动", on: "强制走代理", off: "直连" }[form.mode] || form.mode;
      var regLabel = { keep: "保持不变", npmjs: "官方源", npmmirror: "国内镜像" }[form.registry] || form.registry;

      return h(
        "div",
        { style: S.wrap },
        h("div", { style: S.status }, "当前：" + statusLine + "　·　registry：" + (status.registry || "-")),
        Field(
          "代理模式",
          h(
            "select",
            { value: form.mode, disabled: busy, style: S.input, onChange: function (e) { patch("mode", e.target.value); } },
            h("option", { value: "auto" }, "自动（代理端口可达时走代理，否则直连）"),
            h("option", { value: "on" }, "强制走代理"),
            h("option", { value: "off" }, "直连（不使用代理）")
          )
        ),
        Field(
          "代理地址",
          h("input", {
            type: "text",
            value: form.proxyUrl,
            disabled: busy,
            style: S.input,
            placeholder: "http://127.0.0.1:7897",
            onChange: function (e) { patch("proxyUrl", e.target.value); },
          })
        ),
        Field(
          "registry",
          h(
            "select",
            { value: form.registry, disabled: busy, style: S.input, onChange: function (e) { patch("registry", e.target.value); } },
            h("option", { value: "keep" }, "保持不变"),
            h("option", { value: "npmjs" }, "官方源 registry.npmjs.org"),
            h("option", { value: "npmmirror" }, "国内镜像 registry.npmmirror.com")
          )
        ),
        Field(
          "绕过代理的主机（可选，逗号分隔）",
          h("input", {
            type: "text",
            value: form.noProxy,
            disabled: busy,
            style: S.input,
            placeholder: "localhost,127.0.0.1",
            onChange: function (e) { patch("noProxy", e.target.value); },
          })
        ),
        h(
          "label",
          { style: { display: "flex", alignItems: "center", gap: "8px", fontSize: "14px", cursor: "pointer" } },
          h("input", { type: "checkbox", checked: form.strictSsl, disabled: busy, onChange: function (e) { patch("strictSsl", e.target.checked); } }),
          "严格校验 TLS（Clash 等 SSL 拦截代理可关闭）"
        ),
        h(
          "div",
          { style: S.row },
          h("button", { disabled: busy, style: S.primary, onClick: function () { setConfirming(true); setMsg(null); } }, "保存"),
          h("button", { disabled: busy, style: S.secondary, onClick: runTest }, "测试连接")
        ),
        confirming
          ? h(
              "div",
              { style: S.confirm },
              h("div", { style: { fontWeight: 600 } }, "确认保存以下配置？"),
              h(
                "div",
                { style: S.muted },
                "模式：" + modeLabel + "　地址：" + (form.proxyUrl || "(空)") + "　registry：" + regLabel + (form.noProxy ? "　绕过：" + form.noProxy : "") + (form.strictSsl ? "" : "　关闭 TLS 校验")
              ),
              h(
                "div",
                { style: S.row },
                h("button", { disabled: busy, style: S.primary, onClick: save }, busy ? "保存中…" : "确认保存"),
                h("button", { disabled: busy, style: S.secondary, onClick: function () { setConfirming(false); } }, "取消")
              )
            )
          : null,
        msg ? h("div", { style: { fontSize: "13px", color: msg.kind === "ok" ? "#0a7d32" : "#c0392b" } }, msg.text) : null,
        testResult
          ? h(
              "div",
              { style: S.muted },
              "测试：" +
                (testResult.running
                  ? "测试中…"
                  : testResult.ok
                    ? "✅ " + (testResult.via || "") + (testResult.latencyMs != null ? " · " + testResult.latencyMs + "ms" : "")
                    : "❌ " + (testResult.error || "失败"))
            )
          : null
      );
    }

    function apply(ctx) {
      try {
        var slots = ctx && ctx.slots;
        if (!slots || typeof slots.register !== "function") return;

        var FAMILY_SEAT = "web-ui.plugin.item";
        var OFFICIAL_SEAT = "plugins.bundle.config";
        var dispose = null;
        var current = null;
        var reconciling = false;

        function familyLoaded() {
          try {
            return typeof ctx.get === "function" && ctx.get("webUiSettings") !== undefined;
          } catch (_) {
            return false;
          }
        }

        function reconcile() {
          if (reconciling) return;
          var target = familyLoaded() ? FAMILY_SEAT : OFFICIAL_SEAT;
          if (current === target) return;
          if (typeof slots.spec === "function" && slots.spec(target) === undefined) return;
          reconciling = true;
          var prev = dispose;
          dispose = null;
          current = null;
          try {
            prev && prev();
          } catch (_) {}
          try {
            var cfg =
              target === FAMILY_SEAT
                ? { name: FAMILY_SEAT, id: "dsh-pnpm-manager", order: 100, label: function () { return "pnpm 代理"; }, locale: "dsh-pnpm-manager" }
                : { name: OFFICIAL_SEAT, key: "dsh-pnpm-manager", locale: "dsh-pnpm-manager" };
            dispose = slots.register(cfg, Card);
            current = target;
          } catch (e) {
            try { console.warn("[dsh-pnpm-manager] card seat " + target + " refused", e); } catch (_) {}
          } finally {
            reconciling = false;
          }
        }

        if (typeof ctx.on === "function") {
          try { ctx.on("slots/changed", reconcile); } catch (_) {}
        }
        reconcile();

        if (typeof ctx.effect === "function") {
          ctx.effect(function () {
            return function () {
              try { dispose && dispose(); } catch (_) {}
            };
          }, "dsh-pnpm-manager: client card");
        }

        // Also expose the card as a tab under Settings → Built-in plugins.
        try {
          if (typeof slots.inject === "function") {
            slots.inject("settings.plugins.tab", function () {
              try {
                return slots.register(
                  { name: "settings.plugins.tab", id: "dsh-pnpm-manager", order: 20, label: function () { return "pnpm 代理"; }, locale: "dsh-pnpm-manager" },
                  Card
                );
              } catch (e) {
                try { console.warn("[dsh-pnpm-manager] settings tab registration failed", e); } catch (_) {}
                return undefined;
              }
            });
          }
        } catch (e) {
          try { console.warn("[dsh-pnpm-manager] settings tab inject failed", e); } catch (_) {}
        }
      } catch (e) {
        try { console.warn("[dsh-pnpm-manager] client card registration failed", e); } catch (_) {}
      }
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    return module.exports;
  },
});
