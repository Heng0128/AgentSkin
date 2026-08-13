# AgentSkin Desktop — 代码库深度分析报告

> 分析基于真实源码（Electron 多进程、`@agentskin/engine` 注入引擎、主题/壁纸管线、React UI）。覆盖调用关系、数据流转、边界条件与异常处理。

---

## 1. 项目身份与技术栈

**AgentSkin Desktop** 是一个 Electron 应用（Windows/macOS），核心能力是通过 **Chrome DevTools Protocol (CDP)** 把主题（theme）与壁纸（wallpaper）**注入到第三方 AI 桌面客户端**（Trae / 通义灵码 / Qoder / WorkBuddy / 豆包 / Codex / ZCode / Cursor / Claude / Kimi 等），在不修改目标应用的前提下改写其界面外观。

关键事实（来自 `package.json`、`electron.vite.config.ts`、`electron-builder.yml`）：
- **运行时**：Electron 37，主进程/预加载脚本走 CJS，渲染进程经 Vite 转 ESM。
- **构建**：`electron-vite`（三入口：`main` / `preload` / `renderer`），`electron-builder` 打包；`biome` 做 lint/format，无 eslint。
- **测试**：`vitest`（冒烟+集成，含 CDP mock），`scripts/smoke.mjs` 做 E2E 冒烟（`--dry-run` 不拉起浏览器）。
- **i18n**：内置 `zh-CN` / `en` 双语，`src/shared/i18n.ts` 提供 `t()`。
- **许可**：源码 MPL-2.0；自带引擎以定制 MPL 发布；依赖项许可在 `licenses/`、`OPEN_SOURCE_STRATEGY.md`、`NOTICE`。

`package.json` 的 `scripts` 把主题/壁纸/场景解析等脚本统一收口在 `scripts/`：`rebuild-all-themes`、`build-palette-and-themes`、`build-themes`、`build-wallpapers`、`verify-theme-manifests` 等。

---

## 2. 运行时架构（三进程 + 注入引擎）

```
┌─────────────────────────┐   contextBridge    ┌──────────────────────────┐
│ Renderer (React/Vite)   │ ─── agentskin.* ──▶ │ Preload (contextBridge)  │
│ src/renderer.tsx        │                    │ src/preload.ts            │
│ src/ui/** (17 stores)   │                    └────────────┬─────────────┘
└─────────────────────────┘                                 │ ipcRenderer
                                                            ▼
                              ┌─────────────────────────────────────────────┐
                              │ Main Process (CJS)  src/main.ts              │
                              │  - app-engine-service (编排中枢)             │
                              │  - app-discovery / cdp-client (WebSocket)    │
                              │  - adapters (TS 引擎适配器)                  │
                              │  - wallpaper-injector / scene-parser         │
                              │  - catalog (manifest-v2 校验)                │
                              │  - epoch-manager (并发时隙)                  │
                              │  - 内嵌 @agentskin/engine (src/engine)       │
                              └───────────────┬──────────────────────────────┘
                                              │ CDP over WebSocket (Runtime.evaluate /
                                              │     addScriptToEvaluateOnNewDocument /
                                              │     Page.navigate / Network 拦截)
                                              ▼
                              ┌─────────────────────────────────────────────┐
                              │ Target AI App (第三方 Electron 客户端)        │
                              │   注入层 L0–L4 + 壁纸层（见 §4/§7）           │
                              └─────────────────────────────────────────────┘
```

启动顺序（`src/main/boot-sequence.ts`，串行+可恢复，支持 `isFirstRun`/`isFreshBoot` 重放）：
1. `prepareUserDirectories` → 2. `prepareEngine`（解包 `engines/`（每个目标一个 CSS 集）与 `themes/` 到 `AS_USER_DATA` 以便 CDP 通过 `file://` 加载）→ 3. `loadCatalog` → 4. `discoverApps`（首跑自动发现）→ 5. `registerIpc`（仅 `freshBoot` 注册）→ 6. `createWindow`（仅 `freshBoot`）→ 7. `applyOrRestoreEnvironment`（上次状态幂等重放）。

> 关键约定：`engines/` 与 `themes/` 在**打包时拷进 `resources/`**，运行时再**解包到 `AS_USER_DATA`**（见 `AS_USER_DATA` 常量）。原因：CDP 注入需通过 `file://` 或 `blob:` 读取资源，asar 内无法直接 `fetch`。

---

## 3. 三层 Adapter 体系（易混，务必区分）

代码里出现 **三个互不相同的 "adapter" 概念**，名字相似但层级、职责完全不同：

| 层 | 位置 | 运行处 | 职责 |
|---|---|---|---|
| **A. 引擎 TS 适配器** | `src/adapters/*.ts` + `src/adapters/domestic/*.ts` | 主进程 | `AgentEngineAdapter` 子类（`TraeAdapter` 等），注册进 `src/adapters/registry.ts`，对 `agent-engine-service` 暴露 `apply/restore/status`，内部调用内嵌引擎 |
| **B. 引擎内 JS 适配器** | `src/engine/src/adapters/*.mjs` | 主进程（vendored engine） | 声明 `id/platforms/matchTarget/verification/rendererProfiles`，负责**如何发现并注入**目标；如 `traework.mjs` 含完整 bundleId / 安装路径 / 卸载注册表 GUID / DevToolsActivePort 路径 |
| **C. 浏览器内结构适配器** | `engines/<agent>/adapter.mjs` | 目标应用浏览器内 | 真正注入的"Layer 1 结构改写"CSS，带幂等标记 `window[MARKER]` 与自愈定时器 |

`registry.ts` 的 `registerAdapter()` 校验 `id` + `matchTarget` 函数，重复注册抛错；`getAdapter(id)` 找不到则抛 `Unsupported app '…'`（可用列表合并给出）——这是 B 层与 A 层的衔接点。

`engines/traework/adapter.mjs` 是 C 层范例：用 `CSSStyleSheet` + `document.adoptedStyleSheets`（按 `__agentskin_layer==='adapter'` 去重）注入结构 CSS，并用 `setInterval(…, 5000)` 做**自愈**（目标 SPA 路由切换清掉 host-class 时重新补回），`window[MARKER]` 防重复注入（返回 `'already-applied'`）。

---

## 4. 核心注入引擎（vendored `@agentskin/engine`）

源在 `src/engine/`（构建期拷至 `resources/engine`）。核心能力：

### 4.1 CDP 会话 `cdp/session.mjs`
`CdpSession` 封装 WebSocket：
- **请求/响应关联**：每条命令带自增 `id`，`Runtime.evaluate`/`Page.navigate` 通过 id 匹配响应；
- **事件订阅**：`Runtime.consoleAPIDalled`、`Page.frameNavigated` 等以回调分发；
- **超时/重连**：连接失败、命令超时、页面导航导致会话失效均能被上层 `CdpClient`（`src/main/cdp/cdp-client.ts`）感知并重建。

### 4.2 注入编排 `runtime/skin.mjs` → `runtime/injector.mjs`
`applySkin` 按 **L0→L4 五层**依次注入（文档 `docs/ARCHITECTURE.md` 与 `src/engine/src/runtime/renderer-payload.mjs` 对应）：
- **L0 Host Bootstrap**：`renderer-payload.mjs` 注入基础 reset + 把配置挂到 `window.__AGENTSKIN_CONFIG__`（含 `heroBlobUrl`/`wallpaperConfig`）；
- **L1 Base Palette / Token**：主题 CSS 的 `tokenBlock`，定义 `--agentskin-accent/surface/text/art…` 变量（`generators/*.mjs` 产出）；
- **L2/L3 结构与 Agent 适配**：`engines/<agent>/adapter.mjs`（C 层结构 CSS）+ 针对 `--vscode-*`、`--semi-color-*` 等设计令牌的覆盖（见 §6 `traeworkCss` 范例）；
- **L4 Host Appearance / 壁纸**：`wallpaper-injector` 注入壁纸层（见 §7）。

**持久化与自愈合**：使用 `Page.addScriptToEvaluateOnNewDocument`，让脚本在新文档创建时自动重跑（覆盖 SPA 路由切换 / 整页刷新），这是"注入能抗刷新"的关键机制。

**验证（Verification）**：`injector.mjs` 的 `verifyTheme` + `buildVerifyExpression` 用目标 manifest 的 `verification.required/recommended` 选择器列表，在目标页 `Runtime.evaluate` 查询节点是否存在；`required` 全失则判定注入未生效（可触发自愈或回退），`recommended` 缺失仅告警（节点可能按视图隐藏，CSS 在其上 inert，不致命——见 `traework.mjs` 注释）。

### 4.3 `AdaptiveMutationObserver`（`runtime/adaptive-observer.mjs`）
集成了**三层节流**的 `MutationObserver` 包装（原生 API 兼容）：
1. 窗口限流：10s 内最多 50 次突变；
2. 冷却期：超限后 2s 静默（不停 `disconnect`，仅暂停处理）；
3. 循环检测：同一元素 1s 内变更 >10 次则跳过（`WeakMap` 按节点记数）。

目的：防止"注入脚本触发 DOM 变更 → MutationObserver 又触发注入"的死循环（典型 SPA 主题注入陷阱）。

---

## 5. 编排中枢 `agent-engine-service.ts`

主进程对 UI 暴露的入口（`app-engine-service`），维护 **apply → verify → watch → status → restore** 状态机，统一调度 A 层适配器 + CDP + 壁纸。关键点：
- **幂等重放**：`applyOrRestoreEnvironment` 读取上次环境状态，`boot-sequence` 在 `isFirstRun` 时重放，保证重启后外观一致；
- **并发时隙 `epoch-manager.ts`**：每次 apply/restore 递增 `epoch`，过期操作的结果被丢弃（避免快速切换主题时旧注入覆盖新注入）；
- **组合环境**：主题与壁纸合并为"environment bundle"一起应用/恢复。

---

## 6. 主题生产线（manifest → CSS）

### 6.1 Manifest 格式（v2，`themes/<id>/manifest.json`）
- `$schema: manifest-v2.json`；字段含 `mode`(light/dark)、`category`、`tags`、`displayName`、`colors`（12+ 语义色）、可选 `colorSchemes`、`targets.<agent>.{css, verification}`。
- `targets` 下**每个 agent 单独一份 `assets/css/*.css`** + 自己的 `verification`（`required` 阻塞 / `recommended` 告警）——这是"一套配色，多端适配"的核心数据模型。
- 校验：`src/main/catalog/` 用 `manifest-v2.schema.json` 校验；`scripts/verify-theme-manifests.mjs` 批量校验。

### 6.2 CSS 生成（纯函数，`scripts/theme-utils.mjs` + `scripts/generators/*.mjs`）
- **纯函数、无 I/O**：`theme-utils.mjs` 只做"颜色进、CSS 出"。`parseColor` 支持 `#rgb/#rrggbb/#rrggbbaa/rgb()/rgba()`，非法值抛 `Unsupported color value`。
- **颜色回退（H-6 健壮性）**：`COLOR_FALLBACKS`（13 个语义色，如 `accent:'#4a90d9'`）由 `buildContext` 在缺色/非法色时替补，保证下游 `tokenBlock`/`shellTokenOverrides` 永不因坏值崩溃。
- `GENERATORS`（冻结的 `Object.freeze`）按 agent id 映射到各生成器；`theme-generators.mjs` 仅是**门面 re-export**（便于旧导入 `buildContext/GENERATORS` 继续工作）。
- `traeworkCss` 范例（`scripts/generators/traeworkCss.mjs`）：覆盖 `--vscode-foreground`、`--vscode-button-background`、`--vscode-icube-*`、`--vscode-sideBar-background` 等，**用宿主自身的设计变量系统做全局重涂**；注释明确说明宿主把变量声明在裸 `body` 上，而引擎用 `html.agentskin-host-traework body`（特异性 (0,1,2)）总能压过。策略注释详细解释了"为什么这样选选择器"。

### 6.3 构建脚本
- `rebuild-all-themes.mjs`：`--dry-run`(仅校验) / `--skip-build` / `--skip-zip` / `--verify`；解析 `themes/*/manifest.json` 生成 CSS、zip 打包（`.agentskin-theme`）、调 `verify-theme-manifests`。
- `build-palette.mjs`：由 `palette.json`（macOS 原生取色）生成 `palettes.json`，再驱动 `build-theme-from-palette`（产出 `tokens.css`/`cosmetic.css`）。`engines/<agent>/` 下的 `tokens.css`(L1 palette) 与 `cosmetic.css`(L4 host 外观) 即此处产物。
- 仓库已提交 `palettes.json` + 28 套预生成主题（`themes/`），新配色只需改 `palette.json` 后跑脚本，符合文档"主题管线全自动化"的约定。

---

## 7. 壁纸与 Wallpaper Engine 场景管线

- **类型**：image / video / web / Wallpaper Engine **Scene**。
- **发现/注册/注入**：`wallpaper-service.ts` + `wallpaper-injector.ts`；媒体通过 `wallpaper-server.ts`（本地 HTTP）以 `file://`/blob 提供给目标应用，避免跨域。
- **Scene 解析**（`src/main/scene/`）：`scene-pkg-parser`（解析 `.pkg` 包）→ `tex-parser`（解码 TEX 纹理）→ `lz4-decoder`（LZ4 解压）→ `scene-renderer-html`（把场景渲染成可注入 HTML）。这是整套系统里最重的二进制解析链路，对损坏包/缺失纹理需做容错（解析失败应降级为静态壁纸而非崩溃）。
- **音频响应**：`main.ts` 的 `disposeAudioBroadcast` 表明存在"音频广播 + PowerShell 采样器"，把本机音频电平回传给注入层做可视化（仅 Windows 启采样器）。
- **与主题的关系**：二者合并为 environment bundle，主题层（L0–L4）在壁纸层之上，结构适配器通过 `color-mix(...transparent)` 把宿主面板"穿孔"透出底层壁纸（见 `engines/traework/adapter.mjs` 的 `STRUCTURAL_CSS`）。

---

## 8. UI 层与数据流转

- **3 层 IPC 桥**（文档"Three-Layer IPC Bridge"）：
  - `src/preload.ts` 用 `contextBridge.exposeInMainWorld('agentskin', {...})` 暴露**受限** API（域控 + 仅 `invoke/on`，绝不直接暴露 `ipcRenderer`）；
  - `src/ui/api/agentSkinClient.ts`：渲染进程统一的 `AgentskinClient`，每个方法 `ipcRenderer.invoke('channel', ...)`；
  - `src/main/ipc/index.ts` + 各域文件：注册 `ipcMain.handle`，按 channel 路由到 `agent-engine-service` 等。
- **状态管理**：`src/ui/stores/` 下 ~17 个 Zustand store（`agentStore`/`themeStore`/`wallpaperStore`/`statusStore`/`settingsStore`/`studioStore`/`environmentStore`/`diagnosticsStore`/`bootProgressStore`/`dialogStore`/`installFlowStore`/`notificationStore`/`shellStore`/`workspace-presets`…）。store action 调用 client → IPC → 主进程；主进程经 `webContents.send` 回推事件，store 订阅更新。**新旧组件兼容层 `useAppController`**：把旧 store 接口与新 client 统一，便于渐进迁移。
- **页面**：`dashboard / workspace / themes / wallpaper / settings / studio`，数据从 store→组件→IPC 单向流动。
- **i18n**：`t()` 取 `zh-CN`/`en`，UI 文案与代码注释大量中英双语。

---

## 9. 健康度校验与测试（当前分支重点）

`src/main/theme-health-check.ts` 提供 `checkThemeHealth`：
- 通过 CDP 取目标状态（`heroArtActive/themeSheetPresent/accentToken/hostClassPresent/adapterPresent/nativeTokens`）与"不透明层"列表（`OpaqueLayer`：depth/tag/id/classes/backgroundColor/backgroundImage/size/visible/backdropFilter）；
- **打分**：hero 未激活 → 0 分；否则按不透明层面积扣分（>500k:-20, >100k:-10, >10k:-5, ≤10k:-2），下限钳到 0（见测试边界用例 500000/500001、100000/100001、10000/10001 等精确断言）；
- `generatePunchThroughCss`：对遮挡层自动生成 `background-color: transparent` 的"穿孔"CSS；**显式不生成 `background: transparent` 简写**（会把所有 longhand 复位——P1-7 回归护栏，`theme-health-check.test.ts:645` 断言）。
- 容错：CDP `send`/`evaluate` 抛错、JSON 非法 → 返回 `score=-1` 的空报告，不抛异常。

**当前分支 `feature/inspection-2026-08-13-1351-D-test-quality-balance` 的未提交改动**（注意：会话开始时的 git 快照已过期，真实工作区改动为）：
```
 M src/main/cdp/snapshot-theme.test.ts
 M src/main/scene-particle-smoke.test.ts
 M src/main/theme-health-check.test.ts
 M src/main/theme-restore-flow.test.ts
 M themes/THEME_SPEC.md
```
即分支聚焦于**测试质量与一致性**（烟雾测试、场景粒子烟雾、主题健康度、恢复流程、主题规范文档），符合"test-quality-balance"语义。

---

## 10. 关键边界条件 / 异常处理（逐点来自源码）

- **颜色解析**：`parseColor` 解析失败抛错，但 `buildContext` 用 `COLOR_FALLBACKS` 兜底（H-6），下游生成器不崩。
- **注入幂等**：`window[MARKER]`（C 层）+ `addScriptToEvaluateOnNewDocument`（引擎层）+ epoch（主进程层）三重防重/防过期。
- **SPA 自愈**：`AdaptiveMutationObserver` 三层节流防死循环；`engines/*/adapter.mjs` 的 5s 定时器补回被清掉的 host-class / art 变量。
- **CDP 失效**：会话超时/导航失效由 `CdpClient` 重建；`checkThemeHealth` 对 CDP 异常返回 score=-1。
- **验证分级**：`required` 全失才判失败；`recommended` 缺失仅告警（节点可能按视图隐藏）。
- **资源加载**：`engines/`、`themes/` 解包到 `AS_USER_DATA` 后才经 `file://` 注入，规避 asar 限制。
- **平台路径**：B 层适配器（如 `traework.mjs`）枚举多平台安装路径、卸载注册表 GUID、DevToolsActivePort 位置，并区分 global/CN 版；`matchTarget` 用严格路径匹配 + 宽松 fallback（按产品名/标题），兼顾 UI 重构。
- **并发切换**：`epoch-manager` 丢弃过期操作结果。

---

## 11. 依赖与构建要点

- `package.json` 依赖分三类：Electron 运行时、UI（React/Zustand/radix）、工具（commander/vitest 等）。**注意**：项目明确"不使用 clsx/tailwind-merge"（`components.json` 用 `cn` 自定义合并）；`biome` 替代 eslint。
- `electron-builder.yml` 决定打包产物与asar；`engines/`、`themes/` 需在 `extraResources`/拷贝步骤纳入 `resources/`（由 `prepareEngine` 解包）。
- `scripts/smoke.mjs` 的 `--dry-run` 不启动浏览器，仅校验脚本/管线健康，适合 CI。

---

## 12. 值得注意的观察 / 风险点

1. **L0–L4 命名在代码与文档间不完全一致**：文档把结构改写（C 层 `engines/*/adapter.mjs`）称为"Layer 1: Structural Adaptation"，而引擎内部 `renderer-payload` 是 L0 bootstrap、主题 `tokenBlock` 是 L1 palette。阅读时应以"注入顺序 + 文件位置"为准，而非单一 Layer 编号。
2. **三层 adapter 同名**：见 §3，最易在代码评审中混淆，建议以"运行位置"区分。
3. **Scene 二进制解析是脆弱点**：`scene/` 的 pkg/tex/lz4 解析对损坏资源需明确降级路径（建议复查 `scene-pkg-parser` 的异常分支）。
4. **未提交改动集中在测试**：当前分支未碰业务代码，只调测试与 `THEME_SPEC.md`，是对既有健康度/恢复/快照逻辑的加固。
5. **i18n 注释文化**：代码注释中英双语且含"为什么"级说明（如 `traeworkCss` 的选择器策略、`traework.mjs` 的版本校验来源），是高质量维护信号。

---

### 一句话总结
AgentSkin 是一个"用 CDP 给第三方 AI 客户端换肤"的 Electron 应用：主进程通过三层适配器发现目标与编排注入，内嵌 `@agentskin/engine` 经 WebSocket CDP 把 L0–L4 主题层 + 壁纸层注入目标浏览器（含 SPA 自愈与并发 epoch 防护），主题由纯函数 CSS 生成器从 manifest+palette 自动产出，UI 经 3 层 IPC 桥以 17 个 Zustand store 驱动，并以 `theme-health-check` 打分+穿刺做注入质量闭环。
