# dsh-pnpm-manager

控制 **DeepSeek Harness（DSH）** 使用的 **pnpm** 是否走代理，并查看 / 切换它的 registry 和 store。既可以在 DSH 的设置页里点开关，也可以用一个独立 CLI。

## 为什么需要

Node 和 pnpm **不会自动使用 Windows 系统代理**，所以 pnpm 会直连 `registry.npmjs.org` 和 GitHub。在有防火墙的环境里这会很慢，甚至报 `ECONNRESET`。让 pnpm 走本机代理（例如 Clash 的 `127.0.0.1:7897`）能把依赖解析加快数倍——但代理关掉时安装会失败。这个工具就是把这个开关变成一键（或一条命令）。

## 它只改什么

只改 `~/.npmrc` 里的 `proxy`、`https-proxy`、`registry` 三行，其它设置原样保留。只有内容真的变化时才写备份（`*.bak-<时间戳>`）。

## 作为 DSH 插件

`package.json` 声明了 `dsh.bundle.patch`，`cordis.patch.yml` 插入一个 host 行。该行的 `Config`（schemastery）会被 DSH 渲染成插件设置表单：

| 字段 | 取值 | 含义 |
|------|------|------|
| `mode` | `on` / `off` / `auto` | 强制走代理 / 强制直连 / 仅当代理端口可达时启用 |
| `proxyUrl` | URL | 代理地址（默认 `http://127.0.0.1:7897`） |
| `noProxy` | 主机列表（逗号分隔） | 绕过代理的主机（写入 `noproxy`；仅代理开启时生效） |
| `strictSsl` | `true` / `false` | 是否严格校验 TLS；Clash 等 SSL 拦截代理可关闭 → `strict-ssl=false` |
| `registry` | `keep` / `npmjs` / `npmmirror` | 不动 registry / 官方源 / 国内镜像 |

在表单里改完会立即重写 `~/.npmrc`（loader 会重新 apply 该行）。

> **状态说明：** 已在真实 DSH 验证（隔离 web profile **和**桌面端）：host 路由返回实时数据；卡片既显示在插件页，也作为 **设置 → 内置插件** 下的 **「pnpm 代理」标签页**，显示代理状态 + 开/关/自动/测试。host 路由并有单测覆盖。

### 客户端卡片（可选）

`lib/client.js` 在**插件页**（`plugins.bundle.config` / family 席位）和**「设置 → 内置插件」标签页**（`settings.plugins.tab`）两处注册同一张卡片——模式开关、实时状态、**测试**按钮。注册做了防御：等席位声明后才注册，席位不可用时只是不显示，绝不拖垮 Web 启动。

## CLI

```bash
node bin/dsh-pnpm-manager.mjs status [--json]
node bin/dsh-pnpm-manager.mjs doctor [--json]
node bin/dsh-pnpm-manager.mjs on | off | toggle | auto
node bin/dsh-pnpm-manager.mjs proxy http://127.0.0.1:7890   # 或 proxy reset
node bin/dsh-pnpm-manager.mjs registry npmjs | npmmirror
node bin/dsh-pnpm-manager.mjs store
node bin/dsh-pnpm-manager.mjs test
```

环境变量：`PNPM_PROXY_URL`、`DSH_PROFILE_DIR`、`DSH_PNPM_CJS`。

## 目录结构

```
lib/index.js               host 插件（name / Config / apply + web 路由）
lib/npmrc.js               共享的 .npmrc 读写逻辑
lib/client.js              可选客户端卡片（__ModuleLoader__ 打包格式）
bin/dsh-pnpm-manager.mjs   独立 CLI
cordis.patch.yml           bundle 补丁（插入 host 行）
```

## 许可证

MIT
