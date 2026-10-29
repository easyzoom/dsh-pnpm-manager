/**
 * dsh-pnpm-manager — client card.
 *
 * Hand-written in DSH's `window.__ModuleLoader__.load({ id, factory })` bundle
 * format (no build step). It registers a settings card under the official
 * `plugins.bundle.config` seat, keyed by this package's bundle name, and talks
 * to the host routes registered by lib/index.js:
 *   GET  /dsh-pnpm-manager/status
 *   POST /dsh-pnpm-manager/mode   { mode: 'on' | 'off' | 'auto' }
 *   POST /dsh-pnpm-manager/test
 *
 * Registration is guarded: if the seat or slots service is unavailable, the
 * card simply does not render (it must never throw — DSH fails the whole Web
 * boot when a client plugin's apply throws).
 */
window.__ModuleLoader__.load({
  id: "dsh-pnpm-manager",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    var react = require("react");
    var h = react.createElement;

    var PREFIX = "/dsh-pnpm-manager";

    function fetchJson(path, init) {
      return fetch(path, init).then(function (r) {
        return r.json();
      });
    }

    function Card() {
      var stateHook = react.useState({ loading: true });
      var state = stateHook[0];
      var setState = stateHook[1];
      var testHook = react.useState(null);
      var testResult = testHook[0];
      var setTestResult = testHook[1];
      var busyHook = react.useState(false);
      var busy = busyHook[0];
      var setBusy = busyHook[1];

      var load = react.useCallback(function () {
        fetchJson(PREFIX + "/status")
          .then(function (d) {
            setState(d && d.ok ? d : { ok: false, error: (d && d.error) || "status failed" });
          })
          .catch(function (e) {
            setState({ ok: false, error: String(e) });
          });
      }, []);

      react.useEffect(
        function () {
          load();
        },
        [load]
      );

      function setMode(mode) {
        setBusy(true);
        fetchJson(PREFIX + "/mode", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode: mode }),
        })
          .then(function () {
            load();
          })
          .catch(function (e) {
            setState({ ok: false, error: String(e) });
          })
          .finally(function () {
            setBusy(false);
          });
      }

      function runTest() {
        setBusy(true);
        setTestResult({ running: true });
        fetchJson(PREFIX + "/test", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        })
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

      var proxyText = state.loading ? "加载中…" : state.proxy ? "走代理 " + (state.proxyUrl || "") : "直连";
      var reachText = state.loading ? "" : state.proxyReachable ? " · 代理可达" : " · 代理不可达";
      var testText = null;
      if (testResult) {
        if (testResult.running) testText = "测试中…";
        else if (testResult.ok)
          testText =
            "✅ " + (testResult.via || "") + (testResult.latencyMs != null ? " · " + testResult.latencyMs + "ms" : "");
        else testText = "❌ " + (testResult.error || "失败");
      }

      return h(
        "div",
        { style: { padding: "12px 4px", display: "flex", flexDirection: "column", gap: "8px" } },
        h("div", { style: { fontWeight: 600 } }, "pnpm 代理"),
        h("div", { style: { opacity: 0.8 } }, "状态：" + proxyText + reachText),
        h("div", { style: { opacity: 0.8 } }, "registry：" + (state.registry || "-")),
        h(
          "div",
          { style: { display: "flex", gap: "6px", flexWrap: "wrap" } },
          h("button", { disabled: busy, onClick: function () { setMode("on"); } }, "开"),
          h("button", { disabled: busy, onClick: function () { setMode("off"); } }, "关"),
          h("button", { disabled: busy, onClick: function () { setMode("auto"); } }, "自动"),
          h("button", { disabled: busy, onClick: runTest }, "测试")
        ),
        testText ? h("div", { style: { fontSize: 12, opacity: 0.8 } }, "连通测试：" + testText) : null,
        state.error ? h("div", { style: { color: "#c0392b", fontSize: 12 } }, "错误：" + state.error) : null
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

        // Only register into a seat that is actually declared; otherwise wait for
        // `slots/changed` (a parent entry declares the seat when its page mounts).
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
          } catch (_) {
            /* already disposed */
          }
          try {
            var cfg =
              target === FAMILY_SEAT
                ? {
                    name: FAMILY_SEAT,
                    id: "dsh-pnpm-manager",
                    order: 100,
                    label: function () {
                      return "pnpm 代理";
                    },
                    locale: "dsh-pnpm-manager",
                  }
                : { name: OFFICIAL_SEAT, key: "dsh-pnpm-manager", locale: "dsh-pnpm-manager" };
            dispose = slots.register(cfg, Card);
            current = target;
          } catch (e) {
            try {
              console.warn("[dsh-pnpm-manager] card seat " + target + " refused", e);
            } catch (_) {
              /* console unavailable */
            }
          } finally {
            reconciling = false;
          }
        }

        if (typeof ctx.on === "function") {
          try {
            ctx.on("slots/changed", reconcile);
          } catch (_) {
            /* event seat unavailable */
          }
        }
        reconcile();

        if (typeof ctx.effect === "function") {
          ctx.effect(
            function () {
              return function () {
                try {
                  dispose && dispose();
                } catch (_) {
                  /* already disposed */
                }
              };
            },
            "dsh-pnpm-manager: client card"
          );
        }

        // Also expose the card as a tab under Settings → Built-in plugins.
        try {
          if (typeof slots.inject === "function") {
            slots.inject("settings.plugins.tab", function () {
              try {
                return slots.register(
                  {
                    name: "settings.plugins.tab",
                    id: "dsh-pnpm-manager",
                    order: 20,
                    label: function () {
                      return "pnpm 代理";
                    },
                    locale: "dsh-pnpm-manager",
                  },
                  Card
                );
              } catch (e) {
                try {
                  console.warn("[dsh-pnpm-manager] settings tab registration failed", e);
                } catch (_) {}
                return undefined;
              }
            });
          }
        } catch (e) {
          try {
            console.warn("[dsh-pnpm-manager] settings tab inject failed", e);
          } catch (_) {}
        }
      } catch (e) {
        try {
          console.warn("[dsh-pnpm-manager] client card registration failed", e);
        } catch (_) {
          /* console unavailable */
        }
      }
    }

    exports.apply = apply;
    exports.inject = ["slots"];
    return module.exports;
  },
});
