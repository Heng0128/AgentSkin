# 逆向分析综合报告

> **生成日期**: 2026-08-31
> **方法论**: CDP 动态探测 + ASAR/文件 静态分析 + 交叉验证 + 引擎审计
> **覆盖应用**: traework, qoderwork, workbuddy, doubao, codex, zcode（共 6 个）
> **数据来源**: `docs/reverse-engineering/batch1-cdp/` + `batch2-asar/` + `batch3-validation/` + `batch4-expert/`

---

## 1. 执行摘要

### 1.1 四批次方法论总结

| 批次 | 方法 | 覆盖 | 核心价值 | 局限 |
|------|------|------|---------|------|
| **Batch 1: CDP 动态探测** | WebSocket 实时连接 + Runtime.evaluate | 6 应用 | 运行时真实 DOM/CSS/端口数据 | 3 个应用未运行（codex/qoderwork/zcode），依赖历史快照 |
| **Batch 2: ASAR 静态分析** | 二进制解析 + 字符串提取 + 文件遍历 | 5 应用 | 完整文件拓扑、token 变量定义、第三方 SDK | 无法获得运行时状态；doubao 无 ASAR（Chromium 封装） |
| **Batch 3: 交叉验证** | CDP x 静态双向比对 | 3 应用 | 交集印证（最高置信度）、差异解析、盲区补全 | 仅覆盖 3 个应用 |
| **Batch 4: 引擎审计** | 四维度对比 + 风险评估 | 6 应用 | 选择器/token/注入/架构全面评分 | 部分评估基于静态推断 |

### 1.2 整体结论

六个适配器引擎全部达到 **生产可用** 水平。其中：
- **Codex** 引擎最成熟（96/100，A 级）
- **WorkBuddy** 存在 11 处无效选择器缺陷需 P0 修复
- **QoderWork** 多窗口覆盖缺口最大（canvas/writing 渲染器完全缺失）
- **Doubao** 暗色模式使用硬编码 hex，需变量化
- **TRAE Work** 引擎架构优秀但裸前缀扩展家族未覆盖
- **ZCode** 双层 CSS 冗余需合并

---

## 2. 六大应用内部位置确认

### 2.1 安装路径与入口文件

| 应用 | Agent ID | 安装路径 | 入口文件 | 打包方式 | 架构类型 |
|------|---------|---------|---------|---------|---------|
| **TRAE SOLO CN** | traework | `%LOCALAPPDATA%\Programs\TRAE SOLO CN` | `resources/app/out/vs/code/electron-browser/solo/solo-lite.html` | 散文件（无 ASAR） | VS Code OSS + iCube |
| **QoderWork CN** | qoderwork | `C:\Program Files\QoderWork CN\QoderWork CN\` | `resources/app.asar` 内嵌 `index.html` | ASAR (~8MB) | Electron + React 19 |
| **WorkBuddy** | workbuddy | `C:\Program Files\WorkBuddy\` | `resources/app.asar/renderer/index.html` | ASAR (283MB) | VS Code + ASAR |
| **豆包 Doubao** | doubao | `%LOCALAPPDATA\Doubao\Application\` | `local_webcontents/extensions/ai-views/side_panel.html` | 无 ASAR（Chromium 封装 + Manifest V3 扩展） | Chromium 封装 + Semi Design |
| **OpenAI Codex** | codex | `C:\Program Files\WindowsApps\OpenAI.Codex_<version>\` | `app.asar/webview/index.html`（`app://-/index.html`） | ASAR (273.5MB) + MSIX | Electron + Owl Runtime (Chromium 151) |
| **ZCode** | zcode | `C:\Program Files\ZCode\` | `resources/app.asar/out/renderer/index.html` | ASAR (283MB) | Electron + Vite/React 19 |

**数据来源**: [CDP] batch1-cdp 各应用 §1-2 + [静态] batch2-asar 各应用 §1-2

### 2.2 WebUI 位置

| 应用 | 渲染协议 | 渲染 URL 模式 | HTML 入口数 | CSS 变量总量 |
|------|---------|-------------|-----------|------------|
| traework | `vscode-file://` | `vscode-file://vscode-app/.../solo-lite.html` | 6（含 slim/full 双模式） | ~3,535 |
| qoderwork | `file://` | `file:///.../index.html` + 6 个独立渲染器 | 7 | ~100+ |
| workbuddy | `file://` | `file:///.../app.asar/renderer/index.html` | 1（主）+ 13+ webview | ~3,560 |
| doubao | `chrome://` / `chrome-extension://` | `side_panel.html` / `popup.html` / `options.html` | 3 | ~250+ |
| codex | `app://` | `app://-/index.html` | 1（主）+ 1 头像浮层 | 1,246（运行时） / 1,503（静态） |
| zcode | `file://` | `file:///.../app.asar/out/renderer/index.html` | 1 | ~390 |

**数据来源**: [CDP] runtime rootVars 统计 + [静态] ASAR 内 HTML/CSS 分析

### 2.3 架构差异摘要

| 维度 | traework | qoderwork | workbuddy | doubao | codex | zcode |
|------|---------|-----------|-----------|--------|-------|-------|
| **框架** | VS Code OSS 1.x | React 19.2.1 | VS Code + React | Semi Design + rspack | React 19 + Tailwind 4 | React 19 + Tailwind 4 |
| **CSP** | 宽松（VS Code 默认） | 中（CM6 nonce） | 宽松（Electron 默认） | 中（`argus-csp-token` nonce） | 极端（`default-src 'none'`） | 无（file://） |
| **contextIsolation** | true | true（推测） | true | N/A（非 Electron） | true | true |
| **CDP 端口** | 50063（应用分配） | ephemeral | 60181（DevToolsActivePort） | 61607/9222 | 56901（历史） | 63215（历史） |
| **Token 策略** | `--vscode-icube-*` 三层 | `--color-*` 单层 | `--cb-*` + `--vscode-*` + `--sc-ui-*` 三层 | `--dbx-*` + `--s-color-*` + `--semi-color-*` 三层 | `--color-token-*` 25 核心 | `--color-*` 256 + theme layer 全权 |

**数据来源**: [CDP] CSP 策略 §7 + [静态] 安全机制 §5

---

## 3. 纯 WebUI 页面位置清单

### 3.1 所有 HTML 入口文件

| 应用 | HTML 入口 | 用途 | 探测方式 |
|------|----------|------|---------|
| **traework** | `solo-lite.html` | 主工作台（Full 模式） | CDP + 静态 |
| | `solo-lite-slim.html` | 精简模式 | 静态 |
| | `arch-mismatch.html` | 架构不匹配提示 | 静态 |
| | `file-preview.html` | 文件预览 | 静态 |
| | `icubeProcessExplorer.html` | 进程浏览器 | 静态 |
| | `webWorkerExtensionHostIframe.html` | 扩展主机 Worker | 静态 |
| **qoderwork** | `index.html`（内嵌 ASAR） | 主工作区 | CDP + 静态 |
| | `voice-overlay.html` | 语音输入覆盖层 | 静态推断 |
| | `mcp-app-preview.html` | MCP 应用预览 | 静态推断 |
| | `artifact-preview.html` | 产物预览面板 | 静态推断 |
| | `quickpick.html` | 命令面板 | 静态推断 |
| | `resources/canvas/index.html` | 画布设计工具（6.4MB React 19） | 静态 |
| | `resources/writing/index.html` | 写作编辑器（3.7MB React 19） | 静态 |
| **workbuddy** | `renderer/index.html` | 主工作区 | CDP + 静态 |
| | (13+ webview 页面) | 腾讯文档/MCP/tdoc/菜单 | 静态推断 |
| **doubao** | `side_panel.html` | 主聊天侧边栏 | 静态 |
| | `popup.html` | 浏览器扩展 popup | 静态 |
| | `options.html` | 设置页 | 静态 |
| **codex** | `webview/index.html` | 主渲染入口 | CDP + 静态 |
| | `webview/avatar-overlay-composition-surface.html` | 头像浮层面 | 静态 |
| **zcode** | `out/renderer/index.html` | 主工作区（唯一 HTML） | CDP + 静态 |

**数据来源**: [CDP] Target 列表 §2 + [静态] ASAR 内 HTML 入口分析 §1-2

---

## 4. 现有引擎准确度排名

### 4.1 六大引擎评分对比

| 排名 | 应用 | 综合评分 | 等级 | 选择器 | Token | 注入策略 | 架构假设 | 最大问题 |
|------|------|---------|------|--------|-------|---------|---------|---------|
| **1** | **Codex** | **96/100** | **A** | 95 | 100 | 100 | 100 | CSS Builder 12 个 VSCode widget 与 Codex 实际 UI 不匹配 |
| **2** | **TRAE Work** | **94/100** | **A-** | 98 | 85 | 100 | 92 | 裸前缀扩展家族（--status/--chat/--radius 等）未覆盖 |
| **3** | **ZCode** | **88/100** | **B+** | 75 | 95 | 100 | 100 | 双层 STRUCTURAL_CSS + shellStructureCss 冗余 |
| **4** | **Doubao** | **93/100** | **A-** | 95 | 95 | 98 | 95 | 暗色模式 token 硬编码 hex（非变量引用） |
| **5** | **QoderWork** | **81/100** | **B** | 82 | 78 | 92 | 70 | canvas/writing 渲染器完全缺失（5/7 覆盖） |
| **6** | **WorkBuddy** | **79/100** | **B+** | 72 | 75 | 85 | 82 | `[data-view-id]` 选择器 100% 失效（11 处无效规则） |

**数据来源**: [Batch 4] 各应用 engine-audit §5 综合评估

### 4.2 最强环节分析

| 优势维度 | 体现 | 应用 |
|---------|------|------|
| **注入策略 100% 正确** | 六端全部采用 `adoptedStyleSheets` 主通道，CORS=0，CSP 无阻碍 | 全部 |
| **自愈机制完善** | MutationObserver + 周期检查 + sheet watchdog 三重防御 | codex/zcode/doubao/workbuddy/qoderwork |
| **Token 桥接架构** | Bridge（运行时）+ 主题生成器（静态）双路径分工 | codex/traework |
| **选择器多版本兼容** | `:is()` + data-testid > role > class 三层 fallback | codex/doubao/zcode |

### 4.3 最弱环节分析

| 弱点 | 影响 | 涉及应用 | 修复优先级 |
|------|------|---------|-----------|
| `[data-view-id]` 选择器全部失效 | sidebar/main-content/detail-panel 玻璃效果完全缺失，艺术层被遮挡 | workbuddy | **P0** |
| canvas/writing 渲染器未覆盖 | 用户在画布/写作页面无主题效果 | qoderwork | **P0** |
| CSS Builder 基于 VSCode 模型 | 12 个 widget 与 Codex 实际 UI 不匹配（仅 CSP 降级时触发） | codex | **P0** |
| 暗色模式硬编码 hex | 暗色模式仅能使用固定暗色，无法换肤 | doubao | **P1** |
| 裸前缀扩展家族未覆盖 | 状态/圆角/间距/品牌色使用宿主默认值 | traework | **P1** |
| 双层 CSS 结构冗余 | STRUCTURAL_CSS + shellStructureCss 竞争注入 | zcode | **P1** |

**数据来源**: [Batch 4] 各应用 engine-audit §2 问题清单 + §3 风险评估

---

## 5. 关键发现

### 5.1 过时/过期配置

| # | 应用 | 文件 | 问题 | 严重性 |
|---|------|------|------|--------|
| 1 | workbuddy | `adapter.mjs` + `workbuddyCss.mjs` | **11 处 `[data-view-id]` 选择器** — 交叉验证确认该属性不存在于运行时 DOM | **高** |
| 2 | codex | `codex-css-builder.ts` | **12 个 VSCode widget 槽位** — prompt-area/editor-surface/terminal-panel/tab-bar/command-palette/status-bar 均为 VSCode 概念，Codex 不存在 | **高** |
| 3 | workbuddy | `tokens.css` L4 | 注释称 "--cb-* design-variable system" — 实际主前缀为 `--wb-*`（863 > 466） | 中 |
| 4 | doubao | `dark-mode-remap.mjs` | 暗色 token 全部硬编码 hex 值，未引用 `agentskin-*` 变量 | 中 |
| 5 | zcode | `adapter.mjs` L369 | 注释 "L5: HEURISTIC DOM POSITIONING" — 实际引擎仅 L0-L4 | 低 |
| 6 | codex | `codex-theme-v1.mjs` | Legacy runtime profile 使用非标准 class `agentskin-codex-skin` + DreamSkin 时代变量 | 中 |

**数据来源**: [Batch 4] §2.1 过期配置

### 5.2 顺序/架构错误

| # | 应用 | 问题 | 影响 | 严重性 |
|---|------|------|------|--------|
| 1 | workbuddy | `findSidebar()` 和 `mainArea` 优先匹配 `[data-view-id="sidebar"]`（不存在属性） | 启发式定位失败 | **高** |
| 2 | qoderwork | `ambient-router.mjs` 全部 PAGE_SELECTORS 未经验证 | 氛围路由运行时完全失效 | **高** |
| 3 | zcode | `STRUCTURAL_CSS` + `shellStructureCss` 双层注入同一元素 | 样式竞争，依赖注入顺序 | 中 |
| 4 | zcode | `_tokenAgent` 将所有 bg 变量强制 transparent，可能覆盖 theme layer 的 color-mix 半透明 | 毛玻璃效果消失 | 中 |
| 5 | traework | `--ag-glass-*` 变量在 engine-strategy 中未找到明确定义 | 玻璃效果可能失效 | 中 |
| 6 | workbuddy | 三重自愈冗余（MutationObserver + 2s + 1.5s sheet guard） | CSS 替换竞争、CPU 占用 | 低 |

**数据来源**: [Batch 4] §2.2 顺序/架构错误

### 5.3 连锁故障风险

| 风险等级 | 应用 | 故障链 | 触发概率 | 影响 |
|---------|------|--------|---------|------|
| **高** | workbuddy | `[data-view-id]` 全部失效 → sidebar/main-content/detail-panel 玻璃失效 → 艺术层被遮挡 | 100% | 核心视觉体验完全失效 |
| **高** | qoderwork | canvas/writing 渲染器缺失 → 画布/写作页面无主题 → 视觉断裂 | 100%（打开即现） | 用户功能完全无主题 |
| **中** | zcode | `_tokenAgent` 与 theme layer 冲突 → 毛玻璃效果消失 | 中 | 全局玻璃失效 |
| **中** | zcode | 双层 CSS 竞争 → 样式不可预测 | 中 | 侧边栏/按钮/overlay 异常 |
| **中** | traework | `--ag-glass-*` 未定义 → backdrop-filter 失效 | 中 | 玻璃效果全无 |
| **低** | workbuddy | 三重自愈冗余 → CPU 占用升高 | 低 | 性能影响 |

**数据来源**: [Batch 4] §3.1 连锁故障风险

---

## 6. 修复路线图（按优先级排序）

### Phase 0 — 立即修复（阻断性 Bug，1-2 天）

| # | 应用 | 修复项 | 文件 | 预期效果 |
|---|------|--------|------|---------|
| P0-1 | **workbuddy** | 替换 11 处 `[data-view-id]` 为交叉验证确认的语义 class | `adapter.mjs` + `workbuddyCss.mjs` | sidebar/main-content/detail-panel 玻璃效果恢复 |
| P0-2 | **workbuddy** | 修复 `findSidebar()` 和 `mainArea` 启发式定位 | `adapter.mjs` L517-518 | 侧边栏/内容区定位恢复正常 |
| P0-3 | **workbuddy** | 修复 `matchesHeuristicRules` 中 `data-view-id` 检查 | `adapter.mjs` L582 | 启发式规则正确触发 |
| P0-4 | **qoderwork** | 补充 canvas/writing 渲染器检测与 CSS | `adapter.mjs` | 画布/写作页面主题效果恢复 |
| P0-5 | **codex** | 重构 CSS Builder 为 Codex 实际 UI 组件 | `codex-css-builder.ts` | CSP 降级路径恢复正常 |

### Phase 1 — 短期修复（1-2 周）

| # | 应用 | 修复项 | 文件 | 预期效果 |
|---|------|--------|------|---------|
| P1-1 | doubao | 暗色模式 token 值统一为 `agentskin-*` 变量引用 | `dark-mode-remap.mjs` | 暗色模式换肤能力恢复 |
| P1-2 | traework | 补全裸前缀扩展家族（--status/--chat/--radius/--brand/--spacer/--solo） | `tokens.css` | 状态/圆角/间距主题化 |
| P1-3 | zcode | 对齐 `verification.recommended` 锚点为 probe-verified 版本 | `zcode.mjs` | 锚点声明与实际一致 |
| P1-4 | zcode | 评估 STRUCTURAL_CSS 与 shellStructureCss 合并可行性 | `adapter.mjs` + `theme-utils.mjs` | 消除双层竞争 |
| P1-5 | zcode | `_tokenAgent` 与 theme layer 边界明确化 | `adapter.mjs` | 防止覆盖 theme layer 半透明方案 |
| P1-6 | qoderwork | RUM preload 冲突防御 + popup 局部变量映射 | `adapter.mjs` + `tokens.css` | 消除闪烁风险 + popup 主题完整 |

### Phase 2 — 中期优化（1-2 月）

| # | 应用 | 修复项 | 预期效果 |
|---|------|--------|---------|
| P2-1 | traework | 验证 popout 窗口 + Slim 模式 DOM 差异 | 多窗口/全模式覆盖 |
| P2-2 | qoderwork | CodeMirror 6 编辑器透明适配 | 代码区域 art punch-through 恢复 |
| P2-3 | qoderwork | 扩展 `--color-border-*` 和 `--color-text-*` 变量映射 | token 覆盖率 >98% |
| P2-4 | workbuddy | 更新 landmarks 注释 + DeepCore routes 配置 | 维护准确性 + 深度适配 |
| P2-5 | codex | Legacy profile 统一 host class + 明确层边界 | 架构债务清理 |
| P2-6 | doubao | `neotix` API 探索性集成 | 利用原生 API 优化注入时机 |

### Phase 3 — 长期观察

| # | 应用 | 项目 |
|---|------|------|
| P3-1 | 全部 | 运行时选择器健康验证（启动应用 + CDP probe） |
| P3-2 | codex | 跟踪 Owl Runtime 废弃日志 + `--color-token-*` 扩展 |
| P3-3 | traework | CDP 端口发现机制动态化（当前硬编码 50063） |
| P3-4 | zcode | RUM 监控（`rum-electron-store/`）兼容性验证 |
| P3-5 | workbuddy | popup 窗口模式 + 13+ webview targets 实时枚举 |

---

## 7. 方法论总结

### 7.1 CDP + 静态交叉验证的价值

| 验证维度 | 交集（强信心） | 并集（完整图景） | 差异（互补） |
|----------|--------------|----------------|-------------|
| **traework** | 23 项核心事实双源印证 | 80+ 项发现汇总 | 10 项 CDP 独有 + 15 项静态独有，0 矛盾 |
| **workbuddy** | 30+ 项双源印证（含安全上下文 5 项） | 3560 运行时 + 293 静态-only 变量 | CDP 补全 `agent-ui-theme`；静态补全 293 命名空间 |
| **qoderwork** | 38 项双源印证（应用未运行时高度重叠） | 完整文件拓扑 + SDK 版本 | 静态提供 90% 独立发现；CDP 确认端口模式 |

### 7.2 方法论互补性

| 方法 | 优势 | 盲区 |
|------|------|------|
| **CDP 动态探测** | 运行时真实 DOM/CSS 实测值、条件选择器验证、精确像素尺寸 | 文件系统、配置源、未激活路径、未运行应用 |
| **ASAR 静态分析** | 完整文件拓扑、全量 token 命名空间、第三方 SDK 版本 | 运行时状态、精确计算值、条件选择器 |
| **交叉验证** | 差异解析、第三方情报去伪存真、盲区补全 | 需要两份报告均有足够独立信息 |
| **引擎审计** | 四维度量化评分、风险评估、回归分析 | 需运行时验证确认推断 |

### 7.3 数据来源标识

| 符号 | 含义 |
|------|------|
| [CDP] | 来自 batch1-cdp 动态探测报告 |
| [静态] | 来自 batch2-asar ASAR/文件静态分析 |
| [交叉验证] | 来自 batch3-validation 交叉验证报告 |
| [Batch 4] | 来自 batch4-expert 引擎审计报告 |

---

## 附录 A：各应用成熟度评级总览

| 应用 | Batch 1 CDP 评级 | Batch 3 交叉验证评级 | Batch 4 引擎审计评级 | 最终评级 |
|------|-----------------|---------------------|---------------------|---------|
| traework | B+（生产可用） | 99/100 准确度 | 93.75/100 | **A-（生产可用）** |
| qoderwork | B（需运行时验证） | 86% 匹配度 | 80.5/100 | **B（主窗口可用，需修复多窗口）** |
| workbuddy | A-（生产可用） | A-（高置信度） | 78.5/100 | **B+（核心可用，需 P0 修复 data-view-id）** |
| doubao | B（引擎完整） | — | 93/100 | **A-（引擎优秀，待运行时验证）** |
| codex | A（生产可用） | 96/100（A 级） | 96/100 | **A（最成熟）** |
| zcode | A-（生产可用） | 88/100 | 88/100 | **B+（架构正确，需代码层清理）** |

---

## 附录 B：关键文件路径索引

| 目录/文件 | 用途 |
|-----------|------|
| `docs/reverse-engineering/batch1-cdp/` | CDP 动态探测报告（6 应用） |
| `docs/reverse-engineering/batch2-asar/` | ASAR 静态分析报告（5 应用） |
| `docs/reverse-engineering/batch3-validation/` | 交叉验证报告（3 应用） |
| `docs/reverse-engineering/batch4-expert/` | 引擎审计报告（6 应用） |
| `engines/{agent}/adapter.mjs` | 各应用注入引擎 |
| `engines/{agent}/tokens.css` | 各应用 token 映射 |
| `engines/{agent}/cosmetic.css` | 各应用视觉美化层 |
| `src/adapters/domestic/{agent}.ts` | 各应用 TypeScript 适配器 |
| `src/engine/src/adapters/{agent}.mjs` | 各应用引擎元数据 |
| `scripts/generators/{agent}Css.mjs` | 各应用主题 CSS 生成器 |
| `scripts/lib/landmarks/{agent}.mjs` | 各应用稳定锚点定义 |
| `src/shared/injection/contracts/{agent}.contract.json` | 各应用注入验证契约 |
