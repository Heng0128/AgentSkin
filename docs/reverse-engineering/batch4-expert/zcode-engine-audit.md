# 引擎对比与专家诊断 -- ZCode (zcode Agent)

> 诊断日期: 2026-08-31
> 输入: `batch3-validation/zcode-cross-validation.md` (交叉验证报告) + 现有引擎文件
> 方法: 四维度对比 (选择器准确性 / Token映射完整性 / 注入策略正确性 / 架构假设有效性) + 风险评估
> 目标: 识别引擎不足、量化回归风险、输出修复建议

---

## 1. 四维度对比矩阵

### 1.1 维度一: 选择器准确性 (Selector Accuracy)

| # | 选择器/模式 | 引擎声明 | 交叉验证真实状态 | 判定 | 说明 |
|---|------------|---------|-----------------|------|------|
| S-01 | `#root` (rootContainer) | `engines/zcode/adapter.mjs` L81 | 存在 (I-06) | **PASS** | React 挂载点, 高稳定 |
| S-02 | `:is(main, [role="main"], .main-content, [class*="main-area"])` (mainSurface) | adapter.mjs L82 | 未明确验证 | **UNKNOWN** | 应用未运行, 无法确认 main 元素存在 |
| S-03 | `:is(aside, [data-agentskin-sidebar], [class*="sidebar"], nav)` (sidebar) | adapter.mjs L83 | 过于宽泛 | **WARN** | `aside, nav` 过于宽泛; 引擎实际 CSS 仅命中 `[data-agentskin-sidebar]`, 但 JS findSidebar 仍使用宽泛 `aside, nav` |
| S-04 | `:is([contenteditable="true"], textarea, [role="textbox"], [data-agentskin-composer])` (composer) | adapter.mjs L84 | 过于宽泛 | **WARN** | CSS 仅命中 `[data-agentskin-composer]` 限定, 但 findComposer 遍历全局 contenteditable/textarea |
| S-05 | `[data-workspace-sidebar-panel="true"]` (zcode exact) | `scripts/theme-utils.mjs` shellStructureCss | Probe-verified | **PASS** | PROBE-VERIFIED 精确锚点 |
| S-06 | `[data-slot="button"]` / `[data-state="active"]` (item hover/active) | theme-utils.mjs shellStructureCss | 12 data-* 类别稳定 (I-27) | **PASS** | 高稳定性锚点 |
| S-07 | `.pdfViewer, .pdf-viewer` (PDF.js) | adapter.mjs L97-98 | 一致 (I-29) | **PASS** | 动态加载, MutationObserver 感知 |
| S-08 | `.katex, .katex-display` (KaTeX) | adapter.mjs L101-102 | 一致 (I-32) | **PASS** | 动态加载, MutationObserver 感知 |
| S-09 | `[role="dialog/menu/tooltip/listbox"]` (overlays) | adapter.mjs L91-94 | 8 条件选择器正确 (I-45) | **PASS** | overlay 条件选择器, 上下文正确 |
| S-10 | `button[class*="primary/send/submit"]` | adapter.mjs L259-271 | 部分匹配 | **WARN** | 子字符串匹配可能误伤 (theme-utils.mjs 注释提及 zcode 139 items over-match) |
| S-11 | `[class*="popover/modal/tooltip"]` | adapter.mjs L298-300 | 子字符串风险 | **WARN** | 子字符串类名匹配可能过宽 |
| S-12 | `#toolbarViewer, #sidebarContainer` (PDF) | adapter.mjs L320-334 | 一致 (I-29) | **PASS** | PDF.js 工具栏/侧边栏精确 ID |

**选择器健康总评: ~75/100 (WARNING)**

- PASS: 7/12 (58%)
- WARN: 4/12 (33%)
- UNKNOWN: 1/12 (8%)

### 1.2 维度二: Token 映射完整性 (Token Mapping Completeness)

| 类别 | 引擎声明 | 真实状态 | 覆盖率 | 判定 |
|------|---------|---------|--------|------|
| L0 bridge (5 token) | `--color-foreground/subtle/accent/primary/border` -> 角色映射 | 5/5 一致 (I-22, 1.4) | 100% | **PASS** |
| L3 theme layer (65+16) | `zcodeColorTokenOverrides()` + shellStructureCss | 65+16 核心语义面 (I-16~I-21) | ~30% of 256 | **PASS (架构正确)** |
| `--color-background` / `--color-surface` | transparent (art punch-through) | 一致 | -- | **PASS** |
| `--color-card/panel/sidebar/header/tab` | semi-transparent color-mix | 13 背景/表面 (1.5) | -- | **PASS** |
| `--color-foreground-*` (4) | foreground/muted/subtlest/inverse | 一致 | -- | **PASS** |
| `--color-border-*` (7) | border + hover/focused 变体 | 一致 | -- | **PASS** |
| `--color-accent/brand/primary/secondary` (6) | accent + destructive/success/warning 保留 | 一致 | -- | **PASS** |
| `--color-interaction-ask-*` (3) | ask-fill/surface/confirmation-surface | 一致 | -- | **PASS** |
| `--color-*-node` (5) | command/session/file/subagent/skill | 一致 | -- | **PASS** |
| Terminal ANSI 16 色 | 保留原生 | 一致 | -- | **PASS** |
| `--tw-*` (46) | 不注入 | 不注入 (I-19) | -- | **PASS** |
| `--beam-*` (23) | 保留原生 | 保留 (I-21) | -- | **PASS** |
| `--text-*` (23) | 主题层产出 | 一致 (I-20) | -- | **PASS** |
| 低活跃度 `--color-*` (168 剩余) | 未覆盖 | 86 个 `--color-*` 未映射 | ~64% 未覆盖 | **Risk** |

**Token 映射总评: 架构正确 (RFC A' Theme Layer Full Ownership)**

- 256 token 中 81+5 = 86 个被显式映射 (~33.6%)
- 终端 ANSI 16 色保留原生 (正确)
- 168 个低活跃度 token 未覆盖 (预期行为, 不影响核心渲染面)
- 唯一微小差异: CDP 计数 257 vs 静态 256 (单变量漂移, 可接受)

### 1.3 维度三: 注入策略正确性 (Injection Strategy Correctness)

| # | 策略 | 引擎实现 | 交叉验证状态 | 判定 |
|---|------|---------|-------------|------|
| INJ-01 | L0 CSS 变量桥接顺序 | engine-strategy css-var-bridge.mjs | L0 桥接 5 token (I-39, 1.9) | **PASS** |
| INJ-02 | L1 tokens.css 占位 | no-op placeholder | tokens.css 占位 (I-40, RFC A') | **PASS** |
| INJ-03 | L2 adapter.mjs 结构适配 | adoptedStyleSheets + 元素级 inline | L2 结构适配 + 自愈 + PDF/KaTeX (I-41) | **PASS** |
| INJ-04 | L3 HybridInjector 动态层 | 增量/全量/热替换 | L3 隐式 (I-42) | **PASS** |
| INJ-05 | L4 DeepCore 深度层 | Shadow DOM + 路由 | L4 隐式 (I-43) | **PASS** |
| INJ-06 | MutationObserver 自愈 | AdaptiveMutationObserver 300ms 防抖 | 自愈机制运行 | **PASS** |
| INJ-07 | adoptedStyleSheets 2s 周期守卫 | sheetGuardInterval 1.5s | 双重守卫 | **PASS** |
| INJ-08 | CSS 变量桥接声明式 | bridge 字段 | 声明式 (I-38) | **PASS** |
| INJ-09 | 主题层使用 `!important` | `${host} { ... !important }` | 层叠方向正确 | **PASS** |
| INJ-10 | 注入顺序 (L0->L1->L2->L3->L4) | orchestrator.ts 编排 | 分层所有权清晰 | **PASS** |

**注入策略总评: 完整正确**

- L0-L4 五层架构完整
- 注入顺序正确
- 自愈机制完善
- adoptedStyleSheets 守卫双重保险

### 1.4 维度四: 架构假设有效性 (Architecture Assumption Validity)

| # | 假设 | 引擎依赖 | 交叉验证状态 | 判定 |
|---|------|---------|-------------|------|
| A-01 | `file://` 渲染器可注入 | matchTarget `/^file:\/\//i` | file:// + #root (I-07) | **PASS** |
| A-02 | theme layer full ownership | tokens.css no-op + theme layer 81 token | RFC A' 一致 (I-44) | **PASS** |
| A-03 | 369 data-testid 锚点稳定 | 高稳定性锚点依赖 | 369 data-testid (I-23) | **PASS** |
| A-04 | 203 稳定类锚点 | `[data-slot], [data-state], [data-active]` | 203 class + 12 data-* 类别 (I-24~I-27) | **PASS** |
| A-05 | PDF.js 动态加载可感知 | MutationObserver 检测 | 动态加载 (I-28) | **PASS** |
| A-06 | KaTeX 动态加载可感知 | MutationObserver 检测 | 动态加载 (I-31) | **PASS** |
| A-07 | contextIsolation 不阻塞注入 | CDP Runtime.evaluate | contextIsolation=true, CSP from=none (I-12, I-34) | **PASS** |
| A-08 | DevToolsActivePort 端口发现 | devToolsActivePortFile 路径 | 端口 63215 (I-10) | **PASS** |

**架构假设总评: 全部有效**

---

## 2. 引擎问题清单

### 2.1 过时/过期配置 (Stale Configurations)

| # | 文件 | 问题 | 严重度 |
|---|------|------|--------|
| ST-01 | `engines/zcode/adapter.mjs` L83 | `SELECTORS.sidebar` 仍声明 `:is(aside, [data-agentskin-sidebar], [class*="sidebar"], nav)` -- 但引擎 CSS 仅命中 `[data-agentskin-sidebar]`, 选择器对象中的 `aside, nav` 仅为 findSidebar() 备用, 与 STRUCTURAL_CSS 的域限定设计不一致 | **P2** |
| ST-02 | `engines/zcode/adapter.mjs` L84 | `SELECTORS.composer` 声明 `:is([contenteditable="true"], textarea, [role="textbox"], [data-agentskin-composer])` -- 实际 CSS 仅命中 `[data-agentskin-composer] [contenteditable="true"]`, 选择器对象与 CSS 策略不对齐 | **P2** |
| ST-03 | `engines/zcode/adapter.mjs` L369 | 注释声称 "L5: HEURISTIC DOM POSITIONING" -- 实际引擎架构仅 L0-L4, L5 为历史遗留编号 | **P2 (文档)** |
| ST-04 | `src/engine/src/adapters/zcode.mjs` L84-86 | `verification.recommended` 列出 `sidebar: ["[class*='sidebar']", "aside"]` 和 `composer: ["[contenteditable='true']"]` -- 但 shellStructureCss 在 theme-utils.mjs 中已 probe-verified 为 `[data-workspace-sidebar-panel="true"]` 和 `[data-slot="button"]`, 两者不一致 | **P1** |

### 2.2 顺序/架构不对 (Ordering / Architecture Misalignments)

| # | 问题 | 详情 | 严重度 |
|---|------|------|--------|
| OA-01 | findSidebar() 使用宽泛选择器 | `adapter.mjs` L375: `document.querySelector('aside[role="navigation"], aside, nav')` 而非 `[data-workspace-sidebar-panel="true"]`. findComposer() 使用全局 contenteditable 遍历而非语义锚点 | **P1** |
| OA-02 | findSidebar/findComposer 几何阈值硬编码 | `rect.left < 60 && rect.width < 400 && rect.height > 300` / `rect.width > 300 && rect.height > 60 && rect.height < 300` -- 响应式布局或高分屏可能误判 | **P2** |
| OA-03 | STRUCTURAL_CSS 与 shellStructureCss 功能重叠 | `adapter.mjs` 内联 STRUCTURAL_CSS 定义侧边栏/输入框/按钮/overlay 样式, `theme-utils.mjs` shellStructureCss 也定义相同元素的 PROBE-VERIFIED 精确版本; 两层同时注入同一元素时依赖来源顺序决定最终样式 | **P1** |
| OA-04 | `_tokenAgent` 背景透明化过于激进 | `adapter.mjs` L60-70: `discoverAndOverrideTokens()` 将所有匹配 bg/background/container/surface 前缀的 CSS 变量设为 `transparent`, 可能覆盖主题层的 color-mix 半透明方案 | **P1** |
| OA-05 | DeepCore 配置硬编码空 routes | `adapter.mjs` L445-451: `DEEP_CONFIG = { shadowMode: "open-only", routes: [], fragments: {}, exposedState: [], enabled: true }` -- 空 routes/fragments 意味着 DeepCore 对 ZCode 无实际深度适配 | **P2** |

### 2.3 缺失配置 (Missing Configurations)

| # | 缺失 | 影响 | 严重度 |
|---|------|------|--------|
| MI-01 | 无 `--color-*` 命名空间 fallback 策略 | 如果 ZCode 版本升级重构变量名, `zcodeColorTokenOverrides()` 的静态映射将批量失效. 无动态 token discovery 兜底 | **P2** |
| MI-02 | 无 CSS Modules hash 变化探测 | ZCode 作为 Vite/React 构建产物, CSS Modules hash 随版本变化. engine 不追踪 hash 漂移 | **P2** |
| MI-03 | 无 RUM 监控 (`rum-electron-store/`) 兼容 | 交叉验证报告发现 RUM 监控目录, 可能干扰 MutationObserver 行为 | **P3** |
| MI-04 | 无嵌入式浏览器 (`Partitions/zcode-embedded-browser/`) 注入 | 独立 preload 进程覆盖不完整 | **P3** |

---

## 3. 风险评估

### 3.1 连锁故障风险 (Cascade Failure Risk)

| 风险 | 触发概率 | 影响范围 | 连锁路径 | 缓解状态 |
|------|---------|---------|---------|---------|
| R-01: tokenAgent 与 theme layer 冲突 | 中 | 全局视觉 | `_tokenAgent` 将所有 bg 变量强制 transparent -> 覆盖 theme layer color-mix 半透明 -> 毛玻璃效果消失 + 背景全透明 | **部分缓解**: 注入顺序 (L2 先于 L3) 保证 theme layer 后覆盖 |
| R-02: findSidebar 误判 | 低-中 | 侧边栏样式 | `aside, nav` 选择器命中顶部导航栏 -> 毛玻璃错误应用到导航 -> 界面混乱 | **缓解**: CSS 限定 `[data-agentskin-sidebar]`, 但 JS 打标阶段仍可能误标 |
| R-03: 双层结构 CSS 竞争 | 中 | 侧边栏/输入框/overlay | adapter.mjs STRUCTURAL_CSS + theme-utils shellStructureCss 同时命中同一元素 -> 后注入覆盖先注入 -> 样式不可预测 | **部分缓解**: orchestrator.ts 编排保证顺序 |
| R-04: adoptedStyleSheets 数组清空 | 低 | 全部视觉 | ZCode React 重渲染清空调用 `document.adoptedStyleSheets = []` -> 所有 AgentSkin 图层丢失 | **缓解**: 2s 周期守卫 + 1.5s sheet guard 双保险 |
| R-05: 版本升级 token 重构 | 低 | 主题层 | ZCode 升级导致 `--color-*` 变量重命名/删除 -> 81 token 映射批量失效 | **无缓解**: 仅靠语义面覆盖 (非按名称) 降低概率 |

**连锁故障综合风险: 中等**

- 最严重: R-01 (tokenAgent 冲突) -- 可能导致全局毛玻璃失效
- 概率最高: R-03 (双层竞争) -- 当前依赖注入顺序的脆弱平衡

### 3.2 回归风险 (Regression Risk)

| 场景 | 概率 | 影响 | 回归路径 |
|------|------|------|---------|
| ZCode 版本升级 (3.7.7 -> 3.8.x) | 中 | token 漂移 | 256 -> N 变量变化, 81 token 映射部分失效 |
| Tailwind v4 大版本升级 | 低 | 变量命名规范变化 | `--color-*` 前缀可能替换 |
| Electron Chromium 升级 | 低 | adoptedStyleSheets 行为变化 | CSSStyleSheet API 变更 |
| React 19 内部渲染优化 | 低 | MutationObserver 触发频率变化 | 自愈机制可能过于频繁或不够 |
| Windows DPI/缩放变化 | 中 | findSidebar/findComposer 几何阈值失效 | 侧边栏检测失败 -> 毛玻璃不生效 |

**回归风险综合评级: 中等偏低**

- 引擎选择的语义面覆盖 (非按具体变量名) 有效降低版本漂移影响
- 几何阈值硬编码是最大回归隐患

### 3.3 与 Codex 引擎对比 (Sibling Comparison)

| 维度 | ZCode | Codex | 差异分析 |
|------|-------|-------|---------|
| token 数量 | 256 `--color-*` | ~25 `--color-token-*` | ZCode 规模 10x, 但引擎策略一致 (theme layer ownership) |
| tokens.css | no-op placeholder | no-op placeholder | 完全一致 (RFC A') |
| adapter.mjs 复杂度 | 高 (自愈 + 启发式 + PDF/KaTeX) | 中 (结构 + token discovery) | ZCode 需要额外处理 3 个动态加载系统 |
| shellStructureCss | PROBE-VERIFIED 锚点 | PROBE-VERIFIED 锚点 | 两者均已 probe-verified |
| 选择器健康 | ~75/100 | ~80/100 | ZCode 额外风险来自 heuristic DOM 定位 |
| 安全边界 | 7 项合规 | 7 项合规 | 一致 |

**结论: ZCode 引擎成熟度与 Codex 同级, 复杂度更高但架构一致.**

---

## 4. 修复建议 (按优先级排序)

### P0 -- 立即修复 (阻断性Bug)

> 当前无 P0 阻断性问题. 引擎架构正确、注入通道畅通、核心功能可用.

### P1 -- 高优先级 (架构一致性/功能完整性)

| # | 修复项 | 文件 | 工作量 | 说明 |
|---|--------|------|--------|------|
| P1-01 | 对齐 verification.recommended 锚点 | `src/engine/src/adapters/zcode.mjs` | 小 | 将 `verification.recommended` 从 `[class*='sidebar'], aside` 更新为 `[data-workspace-sidebar-panel="true"]` / `[data-slot="button"]` 以与 shellStructureCss probe-verified 锚点一致 |
| P1-02 | findSidebar/findComposer 使用 probe-verified 锚点 | `engines/zcode/adapter.mjs` | 中 | 优先使用 `[data-workspace-sidebar-panel="true"]` / `[data-testid="composer-input"]` 精确锚点; 几何阈值仅作 fallback |
| P1-03 | 评估 STRUCTURAL_CSS 与 shellStructureCss 合并可行性 | `engines/zcode/adapter.mjs` + `scripts/theme-utils.mjs` | 中 | 双层结构 CSS 竞争是架构性风险. 建议将 STRUCTURAL_CSS 中非主题层独有逻辑 (PDF/KaTeX/overlay) 保留, 侧边栏/按钮/输入框迁移到 shellStructureCss 的 PROBE-VERIFIED 锚点 |
| P1-04 | _tokenAgent 与 theme layer 边界明确化 | `engines/zcode/adapter.mjs` | 中 | 明确 `_tokenAgent` 仅作为 theme layer 未覆盖时的兜底 (fallback), 不覆盖 theme layer 已声明的变量. 可通过检测 theme layer 是否已注入同变量决定是否跳过 |
| P1-05 | 验证 matchTarget 与 file:// 协议匹配 | `src/engine/src/adapters/zcode.mjs` | 小 | 当前 `matchTarget` 通过 `file:// + zcode` URL 匹配. 确认 ZCode 渲染器 URL 中是否始终包含 "zcode" 字符串 (验证报告 I-07 确认 file:// 但未说明 URL 含 zcode 关键字) |

### P2 -- 中优先级 (健壮性/可维护性)

| # | 修复项 | 文件 | 工作量 | 说明 |
|---|--------|------|--------|------|
| P2-01 | 移除 L5 历史遗留注释 | `engines/zcode/adapter.mjs` L369 | 极小 | "L5: HEURISTIC DOM POSITIONING" 改为 "HEURISTIC DOM POSITIONING" |
| P2-02 | SELECTORS 对象与 STRUCTURAL_CSS 对齐 | `engines/zcode/adapter.mjs` L79-103 | 小 | 移除 sidebar/composer 选择器中 CSS 未使用的宽泛变体 |
| P2-03 | findSidebar/findComposer 几何阈值参数化 | `engines/zcode/adapter.mjs` | 小 | 将硬编码阈值提取为可配置常量, 支持高分屏 |
| P2-04 | DeepCore 配置按 ZCode 实际路由填充 | `engines/zcode/adapter.mjs` L445-451 | 中 | 基于 369 data-testid 定义 routes 配置 |
| P2-05 | 添加 token 命名空间 fallback 策略 | `engines/zcode/adapter.mjs` | 中 | 版本升级时 token 名变化, 动态发现同语义变量 |
| P2-06 | button[class*="primary/send/submit"] 子字符串限制 | `engines/zcode/adapter.mjs` L259-271 | 小 | 使用 data-testid 或 data-slot="button" + data-state 替代子字符串匹配 |

### P3 -- 低优先级 (长期改进)

| # | 修复项 | 文件 | 工作量 | 说明 |
|---|--------|------|--------|------|
| P3-01 | RUM 监控兼容 | `engines/zcode/adapter.mjs` | 中 | 测试 rum-electron-store 对 MutationObserver 的影响 |
| P3-02 | 嵌入式浏览器注入 | `src/engine/src/adapters/zcode.mjs` | 大 | 独立 preload 进程, 需单独 matchTarget 模式 |
| P3-03 | GLM 插件运行时挂载点探测 | 新文件 | 大 | 交叉验证覆盖盲区 |
| P3-04 | 版本间 token 漂移率差分脚本 | `scripts/` | 中 | 定期差分分析 256 token 变化 |

---

## 5. 专家结论

### 5.1 引擎整体评估

| 维度 | 评分 | 说明 |
|------|------|------|
| 选择器准确性 | B+ (~75%) | 核心锚点稳定, heuristic 备用方案过于宽泛 |
| Token 映射完整性 | A (架构正确) | RFC A' Theme Layer Full Ownership 正确实现 |
| 注入策略正确性 | A | L0-L4 五层完整, 自愈机制完善 |
| 架构假设有效性 | A | file:// 渲染器、adoptedStyleSheets、动态加载全部有效 |
| 代码一致性 | B- | 双层结构 CSS 冗余 + 注释/选择器过期 |
| 版本韧性 | B | 语义面覆盖策略降低漂移风险, 但几何阈值硬编码是隐患 |

**综合评级: B+ (良好, 生产可用, 有改进空间)**

### 5.2 与交叉验证报告结论的关系

交叉验证报告 (batch3) 给出 **A- (高置信度, 生产可用)** 的综合准确度. 本专家引擎审计在认同该结论的基础上, 补充以下发现:

1. **交叉验证未见的结构性问题**: 双层 STRUCTURAL_CSS + shellStructureCss 的竞争、`_tokenAgent` 与 theme layer 的潜在冲突、verification.recommended 锚点过期
2. **交叉验证未覆盖的实现细节**: findSidebar/findComposer 几何阈值硬编码、DeepCore 空配置、L5 历史遗留编号
3. **交叉验证的 "8 条件选择器断裂" 评估**: 确认条件选择器设计正确, 断裂因应用未运行导致 overlay 未激活

### 5.3 核心判断

**ZCode 引擎架构正确 (RFC A' Theme Layer Full Ownership), 注入通道畅通, 核心功能完整.** 主要不足集中在代码层面的一致性和冗余问题, 非架构性缺陷.

**最需要关注的架构风险 (P1-03)**: `engines/zcode/adapter.mjs` 内联 STRUCTURAL_CSS 与 `scripts/theme-utils.mjs` shellStructureCss 存在功能重叠. 两者同时作用于侧边栏、输入框、按钮、overlay 等元素, 依赖注入顺序保证最终样式. 建议合并为单一来源.

**最需要关注的实现风险 (P1-04)**: `_tokenAgent` 将所有匹配 bg/background/container/surface 前缀的变量设为 `transparent`, 可能覆盖主题层精心调配的 color-mix 半透明方案. 边界需明确化.

### 5.4 与 6 端适配器的相对位置

| 排名 | 端 | 引擎成熟度 | 关键差异 |
|------|-----|----------|---------|
| 1 | Codex | A | 最简洁, 25 token + theme layer |
| 2 | ZCode | B+ | 256 token 但架构正确, 复杂度高 |
| 3 | Doubao | B+ | app:// + RUM 监控 |
| 4 | TRAE Work | B | app:// 渲染器 |
| 5 | QoderWork | B | 嵌入式浏览器 |
| 6 | WorkBuddy | B- | 独特注入通道 |

---

## 附录 A: 数据来源

| 数据 | 来源 | 章节 |
|------|------|------|
| 交叉验证报告 | `docs/reverse-engineering/batch3-validation/zcode-cross-validation.md` | 1-6 |
| 引擎源码 | `engines/zcode/adapter.mjs` | 全文 |
| 引擎源码 | `engines/zcode/tokens.css` | 全文 |
| 引擎源码 | `engines/zcode/cosmetic.css` | 全文 |
| 主题工具 | `scripts/theme-utils.mjs` | zcodeColorTokenOverrides + shellStructureCss |
| 引擎适配器 | `src/engine/src/adapters/zcode.mjs` | matchTarget + bridge + verification |
| TypeScript 适配器 | `src/adapters/domestic/zcode.ts` | ConnectionManager + WindowHints |
| 安全边界 | `docs/adapters/zcode-security-boundary.md` | 1-8 |
| Codex 对比 | `engines/codex/tokens.css` + `engines/codex/adapter.mjs` | 参考 |

## 附录 B: 引擎文件拓扑

```
ZCode Engine File Set (9 文件完整)
+-- engines/zcode/
|   +-- adapter.mjs        <- Layer 1-2: 结构适配 + 自愈 + PDF/KaTeX (647 行)
|   +-- tokens.css         <- Layer 0: no-op 占位 (RFC A')
|   +-- cosmetic.css       <- Layer 2: 选择器/滚动条/链接/代码块 (78 行)
+-- src/engine/src/adapters/
|   +-- zcode.mjs          <- 引擎适配器: matchTarget + bridge + verification (91 行)
+-- src/adapters/domestic/
|   +-- zcode.ts           <- TS 适配器: ConnectionManager + WindowHints (512 行)
|   +-- zcode-connection.test.ts
+-- scripts/
|   +-- theme-utils.mjs    <- 主题生成: zcodeColorTokenOverrides (81 token) + shellStructureCss
+-- docs/adapters/
    +-- zcode-security-boundary.md
```
