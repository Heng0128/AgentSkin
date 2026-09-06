# 引擎对比与专家诊断：WorkBuddy (workbuddy Agent)

> 生成日期: 2026-08-31
> 目标应用: WorkBuddy 5.3.14 (VS Code 架构)
> Agent ID: workbuddy
> 方法论: 四维度对比 + 风险评估（adapter-comparator v1）
> 数据源:
>   - 交叉验证报告: `docs/reverse-engineering/batch3-validation/workbuddy-cross-validation.md`
>   - 引擎层: `engines/workbuddy/adapter.mjs` + `tokens.css` + `cosmetic.css`
>   - 主题层: `scripts/generators/workbuddyCss.mjs`
>   - 门禁层: `src/engine/src/adapters/workbuddy.mjs`
>   - TS 适配器: `src/adapters/domestic/workbuddy.ts`
>   - Landmarks: `scripts/lib/landmarks/workbuddy.mjs`
>   - 契约: `src/shared/injection/contracts/workbuddy.contract.json`

---

## 1. 四维度对比矩阵

### 1.1 维度 A：选择器准确性（Selector Accuracy）

| # | 引擎选择器 | 声明位置 | 交叉验证状态 | 判定 |
|---|-----------|---------|------------|------|
| A1 | `body[data-application-name="workbuddy"]` | tokens.css, workbuddyCss.mjs | CDP ✅ + 静态 ✅ (D1) | **有效** |
| A2 | `#root` | adapter.mjs, workbuddyCss.mjs | CDP ✅ + 静态 ✅ (D2) | **有效** |
| A3 | `.teams-container` | adapter.mjs, workbuddyCss.mjs | CDP ✅ + 静态 ✅ (D3) | **有效** |
| A4 | `.codebuddy-menubar` | adapter.mjs, workbuddyCss.mjs | CDP ✅ + 静态 ✅ (D4) | **有效** |
| A5 | `#workbuddy-menubar-container` | adapter.mjs, workbuddyCss.mjs | CDP ✅ (C2) | **有效** |
| A6 | `#workbuddy-window-controls-container` | adapter.mjs, workbuddyCss.mjs | CDP ✅ (C3) | **有效** |
| A7 | `.workbuddy-window-control-button` | adapter.mjs, workbuddyCss.mjs | CDP ✅ (C3) | **有效** |
| A8 | `.workbuddy-window-controls` | workbuddyCss.mjs | CDP ✅ (C3) | **有效** |
| A9 | `[data-view-id]` | adapter.mjs, workbuddyCss.mjs | CDP ❌ 零命中 (T6, A9) | **无效 — 不存在** |
| A10 | `[data-view-id="sidebar"]` | adapter.mjs, workbuddyCss.mjs | CDP ❌ 零命中 | **无效 — 不存在** |
| A11 | `[data-view-id="main-content"]` | adapter.mjs, workbuddyCss.mjs | CDP ❌ 零命中 | **无效 — 不存在** |
| A12 | `[data-view-id="detail-panel"]` | adapter.mjs, workbuddyCss.mjs | CDP ❌ 零命中 | **无效 — 不存在** |
| A13 | `[class*="_gridViewItem_"]` | adapter.mjs, workbuddyCss.mjs | CDP ✅ (C4) | **有效** |
| A14 | `[class*="_mainArea_"]` | adapter.mjs, workbuddyCss.mjs | CDP ✅ (C4) | **有效** |
| A15 | `.conversation-list` | adapter.mjs, workbuddyCss.mjs | CDP ✅ (D3 语义锚点) | **有效** |
| A16 | `.chat-container` | adapter.mjs, workbuddyCss.mjs | CDP ✅ (D3 语义锚点) | **有效** |
| A17 | `.sidebar-next` | tokens.css, workbuddyCss.mjs | 静态确认 | **有效** |
| A18 | `.conversation-section-label` | workbuddyCss.mjs | 静态确认 | **有效** |
| A19 | `.collapsible-section-header` | workbuddyCss.mjs | 静态确认 | **有效** |
| A20 | `.my-files-search` | adapter.mjs, workbuddyCss.mjs | 静态确认 | **有效** |
| A21 | `.wb-home-composer__input-slot` | workbuddyCss.mjs | PROBE-VERIFIED 2026-08-23 | **有效** |
| A22 | `.quick-actions__item` | workbuddyCss.mjs | PROBE-VERIFIED 2026-08-23 | **有效** |
| A23 | `.wb-button` | workbuddyCss.mjs | PROBE-VERIFIED 2026-08-23 | **有效** |
| A24 | `[data-page="home"]` | ambient-router.mjs | **未验证** — 无数据 | **可疑** |
| A25 | `[data-page="chat"]` | ambient-router.mjs | **未验证** — 无数据 | **可疑** |
| A26 | `[data-page="detail"]` | ambient-router.mjs | **未验证** — 无数据 | **可疑** |
| A27 | `.home-surface` / `.detail-surface` | ambient-router.mjs | **未验证** — 无数据 | **可疑** |
| A28 | `[data-testid]` | landmarks.mjs (未使用) | CDP ❌ 零命中 (D5) | **正确未使用** |

**维度 A 评分: 72/100**

- 28 个选择器中，23 个有效 (82%)，5 个可疑/无效
- **关键问题**: `[data-view-id]` 系列选择器在引擎中被大量使用，但交叉验证确认该属性**不存在于运行时 DOM**（T6, A9 联合裁定）
- `ambient-router.mjs` 的全部 page 选择器均未经验证，运行时几乎肯定全部失效

---

### 1.2 维度 B：Token 映射完整性（Token Mapping Completeness）

#### 1.2.1 运行时 rootVars 覆盖度（3560 变量）

| 命名空间 | 运行时变量数 | 引擎覆盖数 | 覆盖率 | 覆盖位置 |
|----------|------------|-----------|--------|---------|
| `--vscode-*` | 867 | 78 | 9.0% | tokens.css + workbuddyCss.mjs + bridge |
| `--wb-*` | 863 | 4 (基础) | 0.5% | tokens.css (--wb-accent/secondary/surface/text) |
| `--cb-*` | 466 | ~50+ | ~10.7% | tokens.css + workbuddyCss.mjs + bridge |
| `--sc-ui-*` | 140 | 24 | 17.1% | tokens.css + workbuddyCss.mjs |
| `--cr-*` | 190 | 0 | 0% | 未覆盖 |
| `--ec-*` | 86 | 0 | 0% | 未覆盖 |
| `--dc-*` | 28 | 0 | 0% | 未覆盖 |
| `--gray-*` ~ `--yellow-*` | 504 | 0 | 0% | 未覆盖（Radix 色板，无需覆盖） |
| `--black-*` / `--white-*` | 24 | 0 | 0% | 未覆盖（透明度色板，无需覆盖） |
| 其他 42 个命名空间 | ~383 | 0 | 0% | 未覆盖 |

#### 1.2.2 三层 token 体系覆盖分析

| 层 | 角色 | 引擎策略 | 交叉验证判定 |
|---|------|---------|------------|
| `--cb-*` (封装层) | WorkBuddy 自绘 UI 主视觉 | 50+ 变量覆盖 + 16 bridge 语义映射 | **部分有效** — 覆盖核心 bg/text/panel/chat 系，但 400+ 变量未覆盖 |
| `--vscode-*` (工作台层) | VS Code chrome | 78 变量覆盖 + 28 bridge 语义映射 | **部分有效** — 覆盖 editor/sidebar/tab/panel/menu 系，但 789 变量未覆盖 |
| `--sc-ui-*` (组件库层) | 独立 UI kit | 24 变量覆盖 | **部分有效** — 覆盖 text/bg/surface/primary 系，但 116 变量未覆盖 |

#### 1.2.3 Token 映射正确性

| 检查项 | 引擎声明 | 交叉验证 | 判定 |
|--------|---------|---------|------|
| `--cb-*` 是主前缀 | 引擎注释称其为"design-variable system" | ❌ `--wb-*` (863) > `--cb-*` (466) | **过时认知** — 主前缀应为 `--wb-*` |
| `--wb-*` 是注入层基础变量 | tokens.css 定义 --wb-accent/secondary/surface/text | ✅ 运行时 863 个 `--wb-*` 变量存在 | **部分正确** — 引擎只定义 4 个基础 `--wb-*`，其余 859 个是原生变量 |
| 三层体系 | cb + vscode + sc-ui | ✅ 三层独立确认 | **正确** |
| bridge 语义映射 | 16 cb + 28 vscode | ✅ 运行时覆盖确认 | **正确** |
| sc-ui 独立于 vscode-dark | 注释说明 | ✅ 独立组件库确认 | **正确** |

**维度 B 评分: 75/100**

- 三层 token 体系架构认知正确
- 核心变量覆盖到位（bg/text/accent/surface 四角色全覆盖）
- 但覆盖率偏低（vscode 9%, cb 11%, sc-ui 17%）
- 关键过时认知：引擎注释称 `--cb-*` 为"design-variable system"，但 `--wb-*` 才是最大命名空间

---

### 1.3 维度 C：注入策略正确性（Injection Strategy Correctness）

| # | 策略 | 引擎实现 | 交叉验证对比 | 判定 |
|---|------|---------|------------|------|
| C1 | 注入方式 | adoptedStyleSheets + CSSStyleSheet.replaceSync | 100 张样式表 0 CORS (D7, S5) | **正确** — 无障碍注入 |
| C2 | 注入顺序 | host class → structural CSS → heuristic → token discovery → self-heal | 无多 frame 标记 (architecture.md §5) | **正确** — 单 target 覆盖 |
| C3 | 自愈机制 | MutationObserver + 2s interval + 1.5s sheet guard | API 未被污染 (D8) | **正确但冗余** — 三重自愈可能过度 |
| C4 | adoptedStyleSheets 守卫 | sheet_manager.install() + setter 拦截 | 无 CORS | **正确** |
| C5 | DeepCore 集成 | DEEP_CONFIG open-only 模式 | 13+ target 结构 | **部分正确** — open-only 对多 target 安全，但 routes 为空 |
| C6 | Webview hardening | 6+ preload 面板覆盖 | 8 preload 静态确认 (P1-P8) | **正确** |
| C7 | SW 防护 | clearSWCaches + controllerchange 监听 | 无 SW 报告 | **防御性正确** — 无 SW 时 no-op |
| C8 | 主题存储感知 | localStorage 包装 + storage 事件 | 无主题 key 报告 | **防御性正确** — 无 key 时 no-op |
| C9 | 渐进渲染 | 2s × 5 次重试 mainArea | 无渐进渲染报告 | **防御性正确** |
| C10 | 路由检测 | detectRoute() 基于 gridViewItem/mainArea | 多视图切换确认 | **部分正确** — 仅检测 grid-view/main-view 两态 |

**维度 C 评分: 85/100**

- 注入方式、顺序、守卫均正确
- 自愈机制完善但存在冗余（三重守护可能引发性能问题）
- DeepCore routes 为空，未利用路由感知能力
- 路由检测过于简单（仅两态），未覆盖 settings/detail 等视图

---

### 1.4 维度 D：架构假设有效性（Architecture Assumption Validity）

| # | 引擎假设 | 交叉验证事实 | 判定 |
|---|---------|------------|------|
| D1 | Electron ASAR 打包 | ✅ 283MB app.asar 确认 (I2) | **有效** |
| D2 | VS Code 架构家族 | ✅ vscode-dark body class (I6) | **有效** |
| D3 | file:// 渲染面 | ✅ securityOrigin file:// (I4) | **有效** |
| D4 | 单 frame 注入 | ✅ 无多 frame 标记 (§5) | **有效** |
| D5 | 13+ CDP target (主 page + webview) | ⚠️ 8 preload 确认，13+ webview 推断未实时枚举 (R5) | **部分有效** |
| D6 | 三层 token 体系 (cb/vscode/sc-ui) | ✅ 三层独立确认 (V1-V4) | **有效** |
| D7 | host 选择器 body[data-application-name] | ✅ CDP + 静态双重确认 (D1) | **有效** |
| D8 | contextIsolation=true | ✅ 双重确认 (S1) | **有效** |
| D9 | webSecurity=false | ✅ 双重确认 (S2) | **有效** |
| D10 | 无 CSP 限制 | ✅ Electron 默认 (S4) | **有效** |
| D11 | 窗口控件结构 | ✅ #workbuddy-window-controls-container (C3) | **有效** |
| D12 | 菜单栏结构 | ✅ #workbuddy-menubar-container (C2) | **有效** |
| D13 | `[data-view-id]` 视图锚点 | ❌ **不存在** (T6, A9) | **无效假设** |
| D14 | `data-vscode-theme-kind` 深浅切换 | ✅ 属实 (T3) | **有效** |
| D15 | `.teams-container` 主容器 | ✅ 属实 (T4) | **有效** |
| D16 | `#root` React 根 | ✅ 属实 (T5) | **有效** |
| D17 | `.cb-dark` 深色类 | ✅ 属实 (T7) | **有效** |
| D18 | popup 窗口模式 popout/floating | ⚠️ 未实际验证 (R3) | **未验证** |

**维度 D 评分: 82/100**

- 18 个架构假设中，15 个有效 (83%)，1 个无效，2 个未验证
- **关键无效假设**: `[data-view-id]` 视图锚点不存在，但引擎大量依赖它
- popup 窗口模式未验证，但不影响主流程

---

## 2. 引擎问题清单

### 2.1 过时配置（Outdated Config）

| # | 文件 | 问题 | 严重度 | 说明 |
|---|------|------|--------|------|
| O1 | `engines/workbuddy/tokens.css` L4 | 注释称 "--cb-* design-variable system" | 中 | 交叉验证确认 `--wb-*` (863) 才是最大命名空间，`--cb-*` (466) 仅为第二。注释误导维护者对主前缀的认知 |
| O2 | `engines/workbuddy/tokens.css` L136-139 | 注释称 "Previous coverage only touched --cb-*" | 低 | 历史注释，现已覆盖 vscode/sc-ui 两层，但注释未更新 |
| O3 | `src/engine/src/adapters/workbuddy.mjs` L11-12 | darwin lastVerified 5.3.5 (2026-07-25) | 低 | win32 已更新到 5.3.14，darwin 仍为 5.3.5 |
| O4 | `scripts/lib/landmarks/workbuddy.mjs` L50 | `.codebuddy-menu-container` | 低 | 交叉验证确认运行时菜单栏 class 为 `.codebuddy-menubar`，无 `menu-container` 变体 |
| O5 | `scripts/lib/landmarks/workbuddy.mjs` L57-58 | `.sidebar-collapsed` / `.sidebar-animating` | 低 | 未在交叉验证中确认，可能为推测性锚点 |
| O6 | `scripts/lib/landmarks/workbuddy.mjs` L49 | `.detail-panel-container` | 低 | 交叉验证确认的 detail panel 选择器为 `.detail-panel` / `.detail-sidebar`（tokens.css L272-275），非 `detail-panel-container` |

### 2.2 错误配置（Incorrect Config）

| # | 文件 | 问题 | 严重度 | 说明 |
|---|------|------|--------|------|
| E1 | `engines/workbuddy/adapter.mjs` L293 | `[data-view-id] { background: transparent }` | **高** | 交叉验证确认 `[data-view-id]` 属性**不存在于运行时 DOM**（T6, A9 联合裁定）。此规则永无效 |
| E2 | `engines/workbuddy/adapter.mjs` L391-396 | `[data-view-id="sidebar"]` 玻璃效果 | **高** | 同上，选择器不匹配任何元素，sidebar 玻璃效果完全失效 |
| E3 | `engines/workbuddy/adapter.mjs` L399-401 | `[data-view-id="main-content"]` 透明 | **高** | 同上，main-content 透明化失效 |
| E4 | `engines/workbuddy/adapter.mjs` L404-406 | `[data-view-id="detail-panel"]` 玻璃效果 | **高** | 同上，detail-panel 玻璃效果失效 |
| E5 | `engines/workbuddy/adapter.mjs` L517-518 | `findSidebar()` 优先匹配 `[data-view-id="sidebar"]` | **高** | 启发式函数优先匹配不存在属性，导致 sidebar 定位失败 |
| E6 | `engines/workbuddy/adapter.mjs` L517 | `mainArea` 优先匹配 `[data-view-id="main-content"]` | **高** | 启发式函数优先匹配不存在属性，导致 main-content 定位失败 |
| E7 | `engines/workbuddy/adapter.mjs` L582 | `matchesHeuristicRules` 检查 `data-view-id` 属性 | **高** | 启发式规则检查不存在的属性，此分支永不被触发 |
| E8 | `scripts/generators/workbuddyCss.mjs` L232-234 | `${host} [data-view-id] { background: transparent }` | **高** | 主题层同样使用不存在选择器 |
| E9 | `scripts/generators/workbuddyCss.mjs` L317-321 | `${host} [data-view-id="sidebar"]` 玻璃效果 | **高** | 主题层 sidebar 选择器失效 |
| E10 | `scripts/generators/workbuddyCss.mjs` L324-326 | `${host} [data-view-id="main-content"]` 渐变 | **高** | 主题层 main-content 选择器失效 |
| E11 | `scripts/generators/workbuddyCss.mjs` L329-332 | `${host} [data-view-id="detail-panel"]` 玻璃效果 | **高** | 主题层 detail-panel 选择器失效 |
| E12 | `engines/workbuddy/ambient-router.mjs` L27-48 | 全部 PAGE_SELECTORS | **高** | `[data-page="home"]` / `[data-page="chat"]` / `[data-page="detail"]` / `.home-surface` / `.detail-surface` 等选择器均未经验证，交叉验证报告未确认 `data-page` 属性存在。此模块运行时几乎肯定完全失效 |
| E13 | `engines/workbuddy/adapter.mjs` L199 | `SELECTORS.mainArea` 含 `[data-view-id="main-content"]` | **中** | 选择器组合中包含无效选择器（`:is()` 中其他分支仍有效，但此分支永无效） |
| E14 | `engines/workbuddy/adapter.mjs` L200 | `SELECTORS.sidebar` 含 `[data-view-id="sidebar"]` | **中** | 同上 |

### 2.3 缺失配置（Missing Config）

| # | 缺失项 | 影响 | 严重度 | 说明 |
|---|--------|------|--------|------|
| M1 | `--cr-*` 命名空间覆盖 | 190 个品牌/色板变量未主题化 | 中 | `--cr-*` 可能包含品牌色相关变量，未覆盖可能导致部分 UI 颜色不一致 |
| M2 | `--ec-*` 命名空间覆盖 | 86 个编辑器颜色变量未主题化 | 低 | 编辑器颜色可能已被 `--vscode-*` 覆盖间接生效 |
| M3 | `--dc-*` 命名空间覆盖 | 28 个文档颜色变量未主题化 | 低 | 文档颜色影响面较小 |
| M4 | `data-vscode-theme-kind` 深浅切换 | 主题切换时可能不完全 | 中 | 交叉验证确认此属性存在 (T3)，但引擎未显式监听其变化 |
| M5 | popup 窗口适配 | popout/floating 窗口无适配 | 低 | 未实际验证 (R3)，但声明了 windowHints |
| M6 | DeepCore routes 配置 | 路由感知增强未启用 | 低 | DEEP_CONFIG.routes 为空数组，DeepCore 无法做路由级增强 |
| M7 | `globalApiCandidates` | 无法静默切换主题 | 低 | 交叉验证标记为盲区 (R1) |
| M8 | CDP Target 实时枚举 | 13+ webview 完整列表未知 | 低 | 交叉验证标记为盲区 (R5) |

---

## 3. 风险评估

### 3.1 连锁故障风险（Cascade Failure Risk）

```
风险链 #1: [data-view-id] 选择器失效链
┌─────────────────────────────────────────────────────────────────┐
│ E1-E4: adapter.mjs 中 [data-view-id] 选择器全部无效            │
│    ↓                                                            │
│ E5-E6: findSidebar() / mainArea 启发式定位失败                  │
│    ↓                                                            │
│ sidebar 玻璃效果失效 → sidebar 不透明 → 艺术层被遮挡            │
│ main-content 透明化失效 → 内容区不透明 → 艺术层被遮挡           │
│ detail-panel 玻璃效果失效 → 面板不透明 → 艺术层被遮挡           │
│    ↓                                                            │
│ 连锁结果: 用户看到不透明 sidebar/panel，壁纸不可见              │
│ 触发条件: 任何 WorkBuddy 会话（100% 触发）                      │
│ 严重度: HIGH — 核心视觉体验完全失效                             │
└─────────────────────────────────────────────────────────────────┘

风险链 #2: ambient-router 完全失效链
┌─────────────────────────────────────────────────────────────────┐
│ E12: ambient-router.mjs 全部 PAGE_SELECTORS 无效                │
│    ↓                                                            │
│ detectPage() 永远返回默认 'home'                                │
│    ↓                                                            │
│ 背景强度永不调整 → 工作页壁纸过亮干扰阅读                       │
│    ↓                                                            │
│ 连锁结果: 氛围路由 UX 完全失效，但不会崩溃                      │
│ 触发条件: 任何 WorkBuddy 会话（100% 触发）                      │
│ 严重度: LOW — 仅影响氛围体验，不破坏主题                        │
└─────────────────────────────────────────────────────────────────┘

风险链 #3: 三重自愈冗余链
┌─────────────────────────────────────────────────────────────────┐
│ C3: MutationObserver + 2s interval + 1.5s sheet guard           │
│    ↓                                                            │
│ 三个机制同时运行，可能引发:                                     │
│ - observer 触发 → scheduleReinject (100ms debounce)             │
│ - interval 触发 → scheduleReinject                              │
│ - sheet guard 触发 → 直接操作 adoptedStyleSheets                │
│    ↓                                                            │
│ 潜在结果: CSS 替换竞争、CPU 占用升高                            │
│ 触发条件: React 频繁重渲染时                                    │
│ 严重度: MEDIUM — 性能影响，非功能崩溃                           │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 回归风险（Regression Risk）

| 场景 | 概率 | 影响 | 风险等级 |
|------|------|------|---------|
| WorkBuddy 升级后 `--cb-*` 变量重命名 | 中 (fragility.md Medium) | bridge 映射断裂 | **MEDIUM** |
| WorkBuddy 升级后 `--vscode-*` 变量重命名 | 低 (vscode 稳定性高) | 工作台颜色回退原生 | **LOW** |
| WorkBuddy 升级后 `--sc-ui-*` 变量重命名 | 中 (独立组件库迭代) | 组件颜色回退原生 | **MEDIUM** |
| WorkBuddy 升级后语义 class 重构 | 高 (fragility.md High) | 结构层选择器全部失效 | **HIGH** |
| WorkBuddy 升级后 DOM 结构变化 | 高 (fragility.md High) | 启发式定位失败 | **HIGH** |
| Electron 升级后 adoptedStyleSheets 行为变化 | 低 | 注入机制失效 | **LOW** |
| `[data-view-id]` 被添加到 WorkBuddy | 极低 | 突然生效但可能冲突 | **NEGLIGIBLE** |

### 3.3 量化风险评分

| 维度 | 风险分 (1-10) | 说明 |
|------|-------------|------|
| 选择器失效风险 | 7 | `[data-view-id]` 系列 100% 失效，语义 class 重构概率高 |
| 变量覆盖不足风险 | 5 | 三层核心变量已覆盖，但覆盖率偏低 (9-17%) |
| 注入机制失效风险 | 2 | adoptedStyleSheets + 三重自愈，机制健壮 |
| 架构假设失效风险 | 3 | 13+ webview 未实时枚举，popup 未验证 |
| 连锁故障风险 | 6 | data-view-id 失效链影响核心视觉 |
| **综合风险** | **5.2/10** | **MEDIUM — 核心功能可用，但结构层有显著缺口** |

---

## 4. 修复建议

### 4.1 P0 — 立即修复（阻断性 Bug）

| # | 修复项 | 文件 | 修复方案 | 预期效果 |
|---|--------|------|---------|---------|
| P0-1 | 替换 `[data-view-id]` 选择器 | `engines/workbuddy/adapter.mjs` L293, L391-406 | 用交叉验证确认的语义 class 替换: `[data-view-id="sidebar"]` → `.conversation-sidebar, .sidebar-next`; `[data-view-id="main-content"]` → `.teams-main-content, .chat-container`; `[data-view-id="detail-panel"]` → `.detail-panel` | sidebar/main-content/detail-panel 玻璃效果恢复正常 |
| P0-2 | 修复启发式定位函数 | `engines/workbuddy/adapter.mjs` L471-492, L517-518 | `findSidebar()` 移除 `[data-view-id="sidebar"]` 优先匹配，改为 `.conversation-sidebar, .sidebar-next` 优先; `mainArea` 移除 `[data-view-id="main-content"]`，改为 `.teams-main-content, .chat-container` | 启发式定位恢复正常 |
| P0-3 | 修复 `matchesHeuristicRules` | `engines/workbuddy/adapter.mjs` L582 | 移除 `el.hasAttribute('data-view-id')` 检查，改为匹配语义 class: `/conversation-sidebar|sidebar-next|teams-main-content|chat-container|detail-panel/i` | 启发式规则正确触发 |
| P0-4 | 同步修复主题层 | `scripts/generators/workbuddyCss.mjs` L232-234, L317-332 | 同 P0-1，替换所有 `[data-view-id]` 选择器为语义 class | 主题层与引擎层一致 |
| P0-5 | 禁用或重写 ambient-router | `engines/workbuddy/ambient-router.mjs` | 方案 A: 暂时禁用（注释导出），待选择器验证后重写; 方案 B: 用交叉验证确认的选择器重写 PAGE_SELECTORS | 避免无效代码运行 |

### 4.2 P1 — 短期修复（功能完善）

| # | 修复项 | 文件 | 修复方案 | 预期效果 |
|---|--------|------|---------|---------|
| P1-1 | 更新过时注释 | `engines/workbuddy/tokens.css` L4 | 将 "--cb-* design-variable system" 改为 "--wb-* (863) 为主前缀, --cb-* (466) 为封装层" | 维护者认知正确 |
| P1-2 | 填充 DeepCore routes | `engines/workbuddy/adapter.mjs` L436 | 基于交叉验证确认的视图类型填充 routes: `[{ from: 'home', to: 'workspace', fragments: {...} }]` | DeepCore 路由增强生效 |
| P1-3 | 添加 `data-vscode-theme-kind` 监听 | `engines/workbuddy/adapter.mjs` | 在 MutationObserver 中添加对 `body[data-vscode-theme-kind]` 属性变化的监听 | 深浅主题切换时自动重注入 |
| P1-4 | 精简三重自愈为双重 | `engines/workbuddy/adapter.mjs` L683-713 | 移除 1.5s sheet guard（与 2s interval 功能重叠），保留 MutationObserver + 2s interval | 减少 CPU 占用，消除 CSS 替换竞争 |
| P1-5 | 更新 landmarks | `scripts/lib/landmarks/workbuddy.mjs` | 移除未确认的 `.codebuddy-menu-container`, `.sidebar-collapsed`, `.sidebar-animating`, `.detail-panel-container`; 添加交叉验证确认的 `.conversation-sidebar`, `.detail-panel`, `.detail-sidebar` | landmarks 与运行时一致 |
| P1-6 | 更新 TS adapter windowHints | `src/adapters/domestic/workbuddy.ts` L37-38 | popup patterns `*/popout*` 标记为未验证，添加 TODO 注释 | 避免误匹配 |

### 4.3 P2 — 中期优化（覆盖率提升）

| # | 修复项 | 文件 | 修复方案 | 预期效果 |
|---|--------|------|---------|---------|
| P2-1 | 扩展 `--cb-*` 覆盖 | `engines/workbuddy/tokens.css` | 从 50+ 扩展到 80+，覆盖 cb 层剩余的 chat/conversation 系变量 | cb 层覆盖率从 11% 提升到 17% |
| P2-2 | 扩展 `--vscode-*` 覆盖 | `engines/workbuddy/tokens.css` | 从 78 扩展到 100+，覆盖 minimap/findWidget 系变量 | vscode 层覆盖率从 9% 提升到 11.5% |
| P2-3 | 添加 `--cr-*` 基础覆盖 | `engines/workbuddy/tokens.css` | 覆盖 `--cr-*` 中的品牌色/强调色变量（约 10-15 个核心变量） | 品牌色主题化 |
| P2-4 | 验证 popup 窗口模式 | `src/adapters/domestic/workbuddy.ts` | 当 popout 窗口出现时验证 patterns，更新 windowHints | popup 窗口正确适配 |
| P2-5 | CDP Target 实时枚举 | 新脚本 | 编写 CDP Target 枚举脚本，实时获取 13+ webview 完整列表 | 盲区 R5 补全 |
| P2-6 | 升级检查清单执行 | — | 按 fragility.md §3 执行升级检查清单 | 版本漂移风险降低 |

---

## 5. 专家结论

### 5.1 引擎健康度总览

| 维度 | 评分 | 置信度 | 说明 |
|------|------|--------|------|
| 选择器准确性 | 72/100 | 高 | `[data-view-id]` 系列全部失效，但核心语义选择器有效 |
| Token 映射完整性 | 75/100 | 高 | 三层体系架构正确，核心变量覆盖到位，但覆盖率偏低 |
| 注入策略正确性 | 85/100 | 高 | 注入方式/顺序/守卫均正确，自愈机制冗余 |
| 架构假设有效性 | 82/100 | 高 | 18 个假设 15 个有效，关键无效假设 1 个 |
| **综合评分** | **78.5/100** | **高** | **B+ — 核心功能可用，结构层有显著缺口** |

### 5.2 核心发现

1. **最大问题**: `[data-view-id]` 选择器在引擎中被大量使用（adapter.mjs 7 处 + workbuddyCss.mjs 4 处 = 11 处），但交叉验证**明确确认该属性不存在于运行时 DOM**（T6, A9 联合裁定）。这导致 sidebar 玻璃效果、main-content 透明化、detail-panel 玻璃效果全部失效，艺术层被不透明面板遮挡。

2. **架构认知偏差**: 引擎注释称 `--cb-*` 为 "design-variable system"，但交叉验证确认 `--wb-*` (863) 才是最大命名空间，`--cb-*` (466) 仅为第二。这不影响功能（引擎正确覆盖了 `--cb-*`），但误导维护者对主前缀的认知。

3. **ambient-router 完全失效**: `ambient-router.mjs` 的全部 PAGE_SELECTORS 均未经验证，运行时几乎肯定完全失效。此模块为独立 ES module，不影响主注入流程，但浪费运行时资源。

4. **自愈机制冗余**: 三重自愈（MutationObserver + 2s interval + 1.5s sheet guard）功能重叠，可能引发 CSS 替换竞争和 CPU 占用升高。

5. **Token 覆盖架构正确但覆盖率偏低**: 三层 token 体系（cb/vscode/sc-ui）架构认知正确，核心 bg/text/accent/surface 四角色全覆盖，但各层覆盖率仅 9-17%，存在视觉不一致风险。

### 5.3 与交叉验证报告的一致性

| 交叉验证结论 | 引擎对比结果 | 一致性 |
|-------------|------------|--------|
| 覆盖率 "完整" (§6.1) | Token 覆盖率 9-17%，结构层选择器 11 处失效 | **不一致** — 交叉验证高估了覆盖率 |
| 健康评分 82/100 (§6.2) | 引擎对比评分 78.5/100 | **基本一致** — 差异来自结构层缺口 |
| 风险等级 GOOD (§6.2) | 综合风险 5.2/10 MEDIUM | **不一致** — 选择器失效链应提升风险等级 |
| matchTarget 全部有效 (§6.4) | matchTarget 全部有效 | **一致** |

### 5.4 最终裁定

**WorkBuddy 引擎状态: B+（核心功能可用，结构层需修复）**

- **Token 层 (L0)**: 架构正确，三层覆盖，核心变量到位。评分: 80/100
- **结构层 (L1)**: `[data-view-id]` 选择器全部失效，sidebar/main-content/detail-panel 玻璃效果缺失。评分: 55/100
- **动态层 (L2)**: HybridInjector 未单独评估（由 orchestrator 统一编排）。评分: N/A
- **深度层 (L4/L5)**: 启发式定位因 `[data-view-id]` 优先匹配而失效。评分: 60/100
- **注入策略**: 方式/顺序/守卫正确，自愈冗余。评分: 85/100

**建议优先级**: P0 修复（data-view-id 替换）> P1 修复（注释/landmarks/DeepCore）> P2 修复（覆盖率提升）

### 5.5 与同级引擎对比（定性）

| 维度 | WorkBuddy | traework | qoderwork |
|------|-----------|----------|-----------|
| 选择器健康 | 72 (data-view-id 失效) | 85+ | 85+ |
| Token 覆盖 | 75 (三层 9-17%) | 80+ (双层) | 80+ (双层) |
| 注入策略 | 85 (三重自愈冗余) | 85 | 85 |
| 架构假设 | 82 (1 个无效) | 85+ | 85+ |
| **综合** | **78.5 (B+)** | **~84 (A-)** | **~84 (A-)** |

WorkBuddy 引擎因 `[data-view-id]` 选择器问题，综合评分低于 traework/qoderwork 约 5-6 分。修复 P0 后预计可提升至 84+ (A-)。

---

## 附录 A：选择器验证完整清单

| 选择器 | 引擎位置 | 交叉验证 | 运行时状态 |
|--------|---------|---------|-----------|
| `body[data-application-name="workbuddy"]` | tokens.css:12, workbuddyCss.mjs:220 | D1 ✅ | 有效 |
| `#root` | adapter.mjs:197,271-281 | D2 ✅ | 有效 |
| `.teams-container` | adapter.mjs:284-289 | D3 ✅ | 有效 |
| `.codebuddy-menubar` | adapter.mjs:317 | D4 ✅ | 有效 |
| `#workbuddy-menubar-container` | adapter.mjs:316 | C2 ✅ | 有效 |
| `#workbuddy-window-controls-container` | adapter.mjs:318 | C3 ✅ | 有效 |
| `.workbuddy-window-control-button` | adapter.mjs:324-334 | C3 ✅ | 有效 |
| `[data-view-id]` | adapter.mjs:293 | T6 ❌ A9 ❌ | **无效** |
| `[data-view-id="sidebar"]` | adapter.mjs:391 | T6 ❌ A9 ❌ | **无效** |
| `[data-view-id="main-content"]` | adapter.mjs:399 | T6 ❌ A9 ❌ | **无效** |
| `[data-view-id="detail-panel"]` | adapter.mjs:404 | T6 ❌ A9 ❌ | **无效** |
| `[class*="_gridViewItem_"]` | adapter.mjs:198,296 | C4 ✅ | 有效 |
| `[class*="_mainArea_"]` | adapter.mjs:199,344 | C4 ✅ | 有效 |
| `.conversation-list` | adapter.mjs:302 | D3 语义锚点 ✅ | 有效 |
| `.chat-container` | adapter.mjs:303 | D3 语义锚点 ✅ | 有效 |
| `.sidebar-next` | tokens.css:272 | 静态确认 ✅ | 有效 |
| `.wb-home-composer__input-slot` | workbuddyCss.mjs:434 | PROBE 2026-08-23 ✅ | 有效 |
| `.quick-actions__item` | workbuddyCss.mjs:448 | PROBE 2026-08-23 ✅ | 有效 |
| `.wb-button` | workbuddyCss.mjs:374 | PROBE 2026-08-23 ✅ | 有效 |
| `[data-page="home"]` | ambient-router.mjs:28 | 未验证 | **可疑** |
| `[data-page="chat"]` | ambient-router.mjs:35 | 未验证 | **可疑** |
| `[data-page="detail"]` | ambient-router.mjs:42 | 未验证 | **可疑** |

## 附录 B：Token 覆盖明细

### B.1 --cb-* 层覆盖清单（~50 个）

引擎覆盖的 `--cb-*` 变量（tokens.css + workbuddyCss.mjs 合并去重）:

```
--cb-bg-primary, --cb-bg-secondary, --cb-bg-tertiary, --cb-bg-overlay,
--cb-panel-bg-primary, --cb-panel-bg-secondary, --cb-team-member-card-background,
--cb-text-primary, --cb-text-secondary, --cb-text-tertiary, --cb-text-disabled,
--cb-text-link, --cb-text-link-hover, --cb-text-error-active,
--cb-vscode-editor-background, --cb-vscode-sideBar-background, --cb-vscode-foreground,
--cb-vscode-editor-foreground, --cb-vscode-descriptionForeground,
--cb-vscode-titleBar-activeBackground, --cb-vscode-titleBar-activeForeground,
--cb-vscode-titleBar-inactiveBackground, --cb-vscode-titleBar-inactiveForeground,
--cb-titlebar-control-hover-background, --cb-vscode-input-background,
--cb-vscode-dropdown-background, --cb-vscode-list-hoverBackground,
--cb-vscode-toolbar-hoverBackground, --cb-vscode-scrollbarSlider-background,
--cb-vscode-scrollbarSlider-hoverBackground, --cb-vscode-textLink-foreground,
--cb-vscode-widget-border, --cb-vscode-panel-border,
--cb-button-dark-background, --cb-button-dark-foreground, --cb-button-dark-hover-background,
--cb-vscode-button-background, --cb-vscode-button-foreground, --cb-vscode-button-hoverBackground,
--cb-button-ghost-hover-background, --cb-vscode-button-secondaryBackground,
--cb-stroke-secondary, --cb-markdown-hr-border-color,
--cb-vscode-focusBorder, --cb-vscode-list-activeSelectionForeground,
--cb-vscode-list-inactiveSelectionBackground,
--cb-chat-bg, --cb-chat-input-bg, --cb-chat-input-border, --cb-chat-input-text,
--cb-chat-input-placeholder, --cb-chat-message-bg, --cb-chat-message-user-bg,
--cb-chat-message-text, --cb-chat-timestamp,
--cb-markdown-code-bg, --cb-markdown-code-text, --cb-markdown-codeblock-bg,
--cb-markdown-codeblock-header-bg, --cb-markdown-codeblock-border,
--cb-markdown-inline-code-bg, --cb-markdown-inline-code-text,
--cb-markdown-link, --cb-markdown-link-hover, --cb-markdown-blockquote-border,
--cb-markdown-blockquote-bg, --cb-markdown-table-border, --cb-markdown-table-header-bg,
--cb-input-bg, --cb-input-border, --cb-input-focus-border, --cb-input-text,
--cb-input-placeholder, --cb-editor-bg, --cb-editor-fg, --cb-editor-line-highlight,
--cb-editor-selection,
--cb-sidebar-bg, --cb-sidebar-item-hover, --cb-sidebar-item-active,
--cb-sidebar-section-header, --cb-sidebar-border,
--cb-badge-bg, --cb-badge-fg, --cb-notification-bg, --cb-notification-border,
--cb-tab-active-bg, --cb-tab-inactive-bg, --cb-tab-hover-bg, --cb-tab-active-border,
--cb-tab-text, --cb-tab-inactive-text,
--cb-icon-button-hover-background
```

### B.2 --vscode-* 层覆盖清单（78 个）

```
--vscode-foreground, --vscode-descriptionForeground, --vscode-disabledForeground,
--vscode-icon-foreground, --vscode-focusBorder, --vscode-errorForeground,
--vscode-textLink-foreground, --vscode-textLink-activeForeground,
--vscode-textPreformat-foreground, --vscode-textPreformat-background,
--vscode-textBlockQuote-background, --vscode-textBlockQuote-border,
--vscode-textCodeBlock-background,
--vscode-editor-background, --vscode-editor-foreground,
--vscode-editorWidget-background, --vscode-editorWidget-foreground, --vscode-editorWidget-border,
--vscode-editorHoverWidget-background, --vscode-editorHoverWidget-foreground, --vscode-editorHoverWidget-border,
--vscode-editor-selectionBackground, --vscode-editor-inactiveSelectionBackground,
--vscode-editorCursor-foreground,
--vscode-input-background, --vscode-input-foreground, --vscode-input-border,
--vscode-input-placeholderForeground, --vscode-inputOption-activeBorder, --vscode-inputOption-activeBackground,
--vscode-button-foreground, --vscode-button-background, --vscode-button-hoverBackground,
--vscode-button-secondaryForeground, --vscode-button-secondaryBackground, --vscode-button-secondaryHoverBackground,
--vscode-list-activeSelectionBackground, --vscode-list-activeSelectionForeground,
--vscode-list-hoverBackground, --vscode-list-focusOutline, --vscode-list-highlightForeground,
--vscode-menu-background, --vscode-menu-foreground, --vscode-menu-border,
--vscode-menu-selectionBackground, --vscode-menu-selectionForeground, --vscode-menu-separatorBackground,
--vscode-dropdown-background, --vscode-dropdown-listBackground, --vscode-dropdown-foreground, --vscode-dropdown-border,
--vscode-sideBar-background, --vscode-sideBar-foreground, --vscode-sideBar-border,
--vscode-sideBarTitle-foreground,
--vscode-panel-background, --vscode-panel-border,
--vscode-panelTitle-activeForeground, --vscode-panelTitle-inactiveForeground,
--vscode-tab-activeBackground, --vscode-tab-activeForeground, --vscode-tab-activeBorderTop,
--vscode-tab-inactiveBackground, --vscode-tab-inactiveForeground,
--vscode-badge-background, --vscode-badge-foreground,
--vscode-diffEditor-insertedTextBackground, --vscode-diffEditor-removedTextBackground,
--vscode-diffEditor-insertedLineBackground, --vscode-diffEditor-removedLineBackground,
--vscode-terminal-background, --vscode-terminal-foreground,
--vscode-terminal-selectionBackground, --vscode-terminalCursor-foreground,
--vscode-scrollbarSlider-background, --vscode-scrollbarSlider-hoverBackground, --vscode-scrollbarSlider-activeBackground
```

### B.3 --sc-ui-* 层覆盖清单（24 个）

```
--sc-ui-text, --sc-ui-text-muted, --sc-ui-text-on-primary,
--sc-ui-bg, --sc-ui-bg-subtle, --sc-ui-surface, --sc-ui-surface-border,
--sc-ui-hover, --sc-ui-active, --sc-ui-focus-ring, --sc-ui-border, --sc-ui-separator,
--sc-ui-primary, --sc-ui-primary-hover, --sc-ui-primary-active,
--sc-ui-danger, --sc-ui-success, --sc-ui-warning, --sc-ui-info,
--sc-text-default, --sc-inline-code-bg, --sc-bg-grey_background,
--sc-border-grey, --sc-divider-default
```

---

> 报告结束。生成工具: adapter-comparator v1 (四维度对比 + 风险评估方法论)
