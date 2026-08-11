# AgentSkin Desktop — 架构总览（活文档）

最后更新：2026-08-07。以代码为准；发现与代码不符时请更新本文件。

## 分层总览

```
UI（React 19）→ preload（contextBridge）→ IPC → 主进程服务层 → 适配器 → 引擎
                                                                    ↓
                                            CDP WebSocket → 目标 AI 应用
```

三个窗口入口：

| 入口 | 文件 | 职责 |
|------|------|------|
| 主窗口 | index.html → src/renderer.tsx | 应用壳：侧边栏 + 页面路由（dashboard/workspace/themes/wallpaper/settings） |
| Studio 窗口 | studio.html → src/studio.tsx | 独立 BrowserWindow，主题创作与调试 |
| Splash | splash.html（内联 JS） | 启动加载屏，真实进度上报后淡出 |

## 主进程（src/main/）

### 启动

`src/main.ts` → `boot-sequence.ts`：8 步确定性初始化（Locale → ThemeLibrary → Settings → Wallpaper → AgentEngine → Catalogs/种子 → IPC/Tray → 主窗口），逐步降级，进度经 `BootProgressReporter` 推送 splash。

### 核心服务

| 模块 | 职责 |
|------|------|
| `agent-engine-service.ts` | 核心编排器：apply / restore / status / wallpaper 全流程 |
| `app-discovery.ts` | 端口解析与 CDP 就绪（从编排器拆出的发现层） |
| `theme-library.ts`（theme/ 目录） | 主题包存储、索引、CRUD |
| `wallpaper-service.ts` + `wallpaper/` | 壁纸管理、注入、媒体注册 |
| `catalog/` | 只读数据层：ThemeCatalog / AgentCatalog + manifest 校验 |
| `scene/`（scene-pkg-parser / tex-parser / lz4-decoder / scene-renderer-html） | Wallpaper Engine Scene 场景包解析与 HTML 渲染 |
| `window-manager.ts` / `tray-manager.ts` | 窗口与托盘 |
| `epoch-manager.ts` | 并发 epoch 管理，防止过期 apply 覆盖新操作 |

### CDP 子系统（src/main/cdp/）

| 模块 | 职责 |
|------|------|
| `cdp-client.ts` | 主进程侧 CDP WebSocket 客户端 |
| `injection/engine-strategy.ts` | L0-L4 多层注入 + `Page.addScriptToEvaluateOnNewDocument` 持久化 |
| `cdp-fanout.ts` | 多 target 扇出 + 加固 |
| `cdp-ready.ts` / `cdp-watcher.ts` / `cdp-targets.ts` | 就绪等待 / target 监控 / target 筛选 |
| `cdp-wallpaper-inject.ts` + `wallpaper/` | 壁纸注入（图片 / 视频 / Web / Scene） |
| `secondary-inject.ts` | 二级窗口注入 |
| `snapshot-theme.ts` / `inspect-session.ts` | Studio 快照与元素检查 |

注：`framework-fingerprint.ts` / `variable-graph.ts` / `token-extractor.ts` 为研究期提取工具，当前生产链路未引用，保留备用。

### IPC（src/main/ipc/）

按领域分文件，`index.ts` 聚合注册：core / theme / bundle / settings / wallpaper / studio / studio-project / studio-workspace / visual-analyzer / performance / window。

`visual-analyzer-ipc.ts` 当前为 stub（见 ROADMAP P1-5），UI 侧调用会降级。

## 适配器（src/adapters/）

`base.ts` 定义 ApplicationAdapter 契约：身份 + 委托，不重复实现注入逻辑。6 个 active 适配器：traework / qoderwork / workbuddy / doubao / codex / zcode（无 experimental）。安装检测走 installHints（目录名 / 可执行文件名 / 注册表 DisplayName）。

## 引擎与运行时层

- `src/legacy/agentskin-core-runtime.ts`：**唯一**导入 `@agentskin/engine` 的桥接层（"legacy" 为历史命名，非废弃代码），承担 Windows 兼容与引擎适配。
- `src/engine/`：vendored 引擎包 `@agentskin/engine`（CDP session、主题包读写、选择器解析等）。
- `engines/<agent>/`：每目标应用三件套——`adapter.mjs`（L4 结构适配 + MutationObserver）、`tokens.css`（L1 原生 token 映射）、`cosmetic.css`（L2 打磨）。

## 注入分层（L0-L4）

| 层 | 内容 | 来源 |
|----|------|------|
| L0 | palette.css：14 个 `--agentskin-*` 语义 token | build-palette.mjs 生成 |
| L1 | tokens.css：目标应用原生 token → var() 映射 | engines/<agent>/tokens.css |
| L2 | cosmetic.css：主题无关视觉打磨 | engines/<agent>/cosmetic.css |
| L3 | theme.css：主题特定 CSS | 主题包 |
| L4 | adapter.mjs：JS 结构定位 + 自愈 | engines/<agent>/adapter.mjs |

持久化：`Page.addScriptToEvaluateOnNewDocument`；注入后经 `buildVerifyExpression` 验证 DOM landmark 与样式生效。

## 主题管线（构建期）

```
themes/<id>/manifest.json（14 语义 token + 元数据 + targets 验证选择器）
  → scripts/build-palette.mjs        palette.css
  → scripts/generate-theme-css.mjs   assets/css/<agent>.css × 6（theme-generators.mjs 纯函数）
  → scripts/build-theme-package.mjs  .agentskin-theme 分发包
```

配色方案：`themes/<id>/color-schemes/*.json`，每套方案额外生成一组 CSS。

分发格式：`.agentskin-theme`（主题）、`.agentskin-bundle`（主题+壁纸组合）。规范见 THEME_SPEC.md / THEME_API.md；权威 schema 为 `src/main/catalog/manifest-v2.schema.json`（docs/ 下为逐字节同步镜像）。

## UI（src/ui/）

- 状态管理：UI 状态管理使用 17 个 Zustand stores（src/ui/stores/），useAppController 作为兼容聚合层为新旧组件提供统一接口；IPC 统一经 `api/agentSkinClient.ts`。
- 页面：dashboard / workspace / themes / wallpaper / settings + 独立 Studio 窗口。
- 组件：shadcn 风格（components.json），约 60 个组件。
- i18n：自研双语（zh-CN 默认 / en），src/shared/i18n.ts。
- 全局层：TitleBar / StatusBar / Sidebar / InjectDock / InstallWizard / CommandPalette / DynamicBackground。

## 数据目录

| 目录 | 内容 |
|------|------|
| `themes/` | 15 个内置主题（manifest + 生成 CSS + 配色方案 + 图片） |
| `engines/` | 6 个目标应用的运行时三件套 |
| `agents-profiles/` | 目标应用 DOM/CSS 分析 profile（Visual Analyzer 的待接通数据资产） |
| `agents-raw-data/` | CDP 全量提取原始数据 |
| `scripts/` | 构建/校验/生成/探测脚本（30 个） |

## 质量门禁

- `npm run check` = typecheck + biome + vitest + check-injection-contract（四源一致）+ check-themes（14-token 契约）+ theme-staleness（palette/CSS 与 manifest 同步）。
- CI：tag 触发完整构建发布流水线；PR/push 触发 validate 门禁（`.github/workflows/pr.yml`）。
- pre-commit：husky + lint-staged（biome 修复 + themes 校验）。
- 测试：103 个测试文件，集中于 CDP / 主题 / IPC / 壁纸 / Scene；`agent-engine-service.ts` 测试补齐中（ROADMAP P0-2）。
