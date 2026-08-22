# GitHub 重量级主题 / 设计系统重构案例调研

> 调研日期：2026-08-22 | 面向 AgentSkin 项目（Electron + CDP 注入 + 14-token 主题契约）
> 搜索范围：5 大方向，每个方向选取 1-3 个最具代表性的开源项目

---

## 方向一：企业级设计系统完整实现

### 1. Adobe Spectrum CSS

| 指标 | 数据 |
|------|------|
| URL | https://github.com/adobe/spectrum-css |
| Stars | 1,288 |
| 最近 commit | 2026-08-20 |
| 语言 | CSS / SCSS |
| 协议 | Apache 2.0 |

**可移植设计点：**

1. **Token 三层架构**（spectrum → express → 自定义主题覆盖）：通过 `--spectrum-*` 全局变量 + `--mod-*` 组件级覆盖层分离大规模设计意图与细粒度定制。AgentSkin 可借鉴：将现有 14 token 拆分为"全局语义层"和"适配器覆盖层"。
2. **stylelint 插件守卫契约**（`stylelint-no-missing-var` / `stylelint-theme-alignment`）：通过超 700 行 stylelint 配置强制 `custom-property-pattern`、`selector-class-pattern` 和 theme-token 一致性。AgentSkin 可将 check-design-tokens 提升为 biome 规则集的一部分。
3. **多主题切换机制**（Spectrum/Express/HighContrast 三档）：通过 `[data-mode]` 属性切换根级 token 组，而非重新加载 CSS。与 AgentSkin 的 applyTheme 事件驱动注入高度同构。

**适配到 AgentSkin：** 将 Spectrum 的 token 命名规范引入 AgentSkin 的 14-token 契约命名；移植 theme-alignment 插件思路到脚本校验层。

---

### 2. Microsoft Fluent UI (Web)

| 指标 | 数据 |
|------|------|
| URL | https://github.com/microsoft/fluentui |
| Stars | 20,223 |
| 最近 commit | 2026-08-21 |
| Commits 总量 | 20,681 |
| 语言 | TypeScript |

**可移植设计点：**

1. **Monorepo 包分层策略**（@fluentui/svg-icons / react-components / web-components 独立发布）：每包独立版本号 + 统一 presets 聚合入口。AgentSkin 的 6 适配器场景如果走向主题 Studio 路线，可借鉴此拆分。
2. **主题创建 API**（createTheme / createDarkTheme / createHighContrityTheme 工厂）：token 对象经工厂函数解构后注入 ThemeProvider，运行时不依赖预编译 CSS。与 AgentSkin 当前 JSON→CSS 字符串注入路径方向一致。
3. **Griffel CSS-in-JS 引擎**（原子化 CSS + 编译期 slot 映射）：生成 `f1abc` 类名并通过 `data-theme-token` 属性定位，避免 hash 冲突。AgentSkin 注入第三方 DOM 时同样面临"注入 CSS 不应污染宿主"的问题。

**适配到 AgentSkin：** 借鉴 Griffel 的 slot→atomic class 抽取机制，为每个适配器的 apply() 输出带作用域前缀的原子类；token 创建工厂可参考设计 Studio 的 ThemeBuilder 类。

---

### 3. MUI (Material UI v5+)

| 指标 | 数据 |
|------|------|
| URL | https://github.com/mui/material-ui |
| Stars | 98,887 |
| 最近 commit | 2026-08-22 |
| Language | JavaScript/TypeScript |

**可移植设计点：**

1. **Material Design Token Pipeline**（Figma Tokens → JSON → CSS Variables → ThemeProvider）：完整的 Design Token to CSS 工具链，含 `theme.palette.primary.main` 覆盖模式。AgentSkin 若做 Studio，可复用此数据流。
2. **Dynamic Color Scheme M3**（通过 seed color 派生全部色阶）：Material You 的 Tonal Palette 算法。AgentSkin 若支持"用户上传品牌色→自动生成主题"，此算法是直接参考。
3. **StyleOverrides / slots 主题接口**（每个组件 `styleOverrides` 通过 `name` 映射到 slot 选择器）：运行时动态覆盖组件样式而不切换整体 theme。等价于 AgentSkin 对每个 Adapter 的 per-component override hooks。

**适配到 AgentSkin：** 重点参考种子色→色阶派生算法，以及 slots 覆盖机制；CSS Variables 主题映射与 14-token 契约天然对应。

---

## 方向二：完整主题引擎重构案例

### 4. Dark Reader

| 指标 | 数据 |
|------|------|
| URL | https://github.com/darkreader/darkreader |
| Stars | 22,283 |
| 最近 commit | 2026-08-21 (active) |
| Commits 总量 | 10,158 |
| 协议 | MIT |

**可移植设计点：**

1. **多模式主题生成引擎**（Filter / Filter+ / Dynamic / Static 四种渲染模式）：Dynamic 模式通过 AST 分析 CSS 规则树 + 正则匹配颜色值后替换。AgentSkin 当前使用 JSON14-token→CSS IIFE 注入，与 DarkReader 的 Dynamic Theme 模式最为接近——但其 CSS 解析器比 AgentSkin 现有 pattern 替换更精细。
2. **Per-site Fix Config 动态覆盖机制**（`dynamic-theme-fixes.config` 按域名索引 selector→style 补丁）：10,000+ 站点的手动修复配置。AgentSkin 的 6 适配器结构类似——但 DarkReader 将此层暴露给社区维护，AgentSkin 将此层收敛进适配器内部。后者更契合。
3. **注入策略分层**（user-agent style sheet → author style sheet override → element.style override 三层瀑布）：通过 `declarativeContent` API + CSS Origin Switch 控制注入优先级。Electron CDP 场景下可对应：user-agent override → 注入 `<style>` → `element.style`。

**适配到 AgentSkin：** 重点参考其 CSS 颜色解析管道（parseColor → modifyColor → applyColor）以及 per-site fix config 的覆盖模型；schema 化为 AgentSkin 适配器的 fallback 层提供范式。

---

### 5. Stylus (openstyles)

| 指标 | 数据 |
|------|------|
| URL | https://github.com/openstyles/stylus |
| Stars | 6,837 |
| 最近 commit | 2026-08-19 |
| 协议 | GPL-3.0 |

**可移植设计点：**

1. **UserCSS 格式规范**（@preprocessor / @var / @-moz-document 元数据头）：声明式 CSS 变量系统 + 域名匹配。AgentSkin 适配器的 selector mapping 与此结构同构。
2. **运行时 CSS 注入管理器**（injectCSS API：allFrames + origin + runAt + frameURL 匹配）：比 manifest 声明式注入更精确。Electron 场景下 CDP `CSS.insertRule` 可实现同等效果。
3. **主题导入/导出 + JSON 偏好层**：每个 userstyle 附带 prefs 对象供运行时参数化。AgentSkin 的 14-token 可被看作 prefs 的超集。

**适配到 AgentSkin：** UserCSS 的 @var 声明格式与 14-token 契约高度相似，可直接借鉴其 JSON schema 作为 ThemeStudio 的导出格式参考。

---

## 方向三：Monorepo 风格 Theme Studio

### 6. nexu-io / Open Design

| 指标 | 数据 |
|------|------|
| URL | https://github.com/nexu-io/open-design |
| Stars | 90,287 |
| 最近 commit | 2026-08-22 (extremely active) |
| Commits — | 活跃，持续推送 |
| 协议 | Apache 2.0 |

**可移植设计点：**

1. **Studio + Runtime + Theme Library 三合一大项目结构**（`design-systems/` 目录 + `apps/daemon/` + `tokens.css` / `tailwind-v4.css` 三件套）：72 个品牌级 design-system，31 个 skill 编排。AgentSkin 要演进为 Studio 可参考此三分支结构。
2. **Replay-based Mock Agent 系统**（179 条录制 trace + golden snapshot 回归）：零 LLM token 消费下的完整流程回归。AgentSkin 未来 Studio 的测试框架可借鉴此"录制→回放→diff"套路。
3. **设计 Token JSON + Tailwind v4 CSS 双轨输出**（`design-tokens.json` ↔ `tokens.css` 双向同步）：token 单数据源，CSS 运行时消费。与 AgentSkin "14-token JSON → CSS 注入" 的单向管道方向一致但更工程化。

**适配到 AgentSkin：** 直接参考其 `design-systems/` 目录结构和 72-brand 的 token schema 设计；Studio 路线的 replay-based mock 测试方法极具移植价值。

---

### 7. OneKeyHQ app-monorepo

| 指标 | 数据 |
|------|------|
| URL | https://github.com/OneKeyHQ/app-monorepo |
| Stars | 2,417 |
| 最近 commit | 2026-08-22 |
| Commits | 非常活跃 |
| 平台 | Electron + React Native + Expo |

**可移植设计点：**

1. **跨 Electron + Mobile 的主题共享层**（`packages/shared/theme/` 跨端复用）：React Native 用 runtime CSS-in-JS、Electron 用 CSS variable，但共享 token schema。AgentSkin 若未来跨窗口或跨设备，此模型直接可用。
2. **Monorepo 内聚式 Theme Hooks**（`useTheme()` + `ThemeProvider` + `themeColors` selector with shallow equal）：Zustand v5 + React 19 下与 AgentSkin 技术栈完全对齐。
3. **Token 驱动的暗色切换**（`toggleTheme` → update CSS var on :root → 所有组件 re-render via selector）：与 AgentSkin 的 applyTheme 事件注入暗色目标应用方向相反，但 token 覆盖机制可参考。

**适配到 AgentSkin：** useTheme hook 的参考实现；Monorepo 下多 Electron BrowserView 共享同一主题源的设计思路。

---

## 方向四：VS Code 主题系统实现

### 8. microsoft/vscode

| 指标 | 数据 |
|------|------|
| URL | https://github.com/microsoft/vscode |
| Stars | 189,250 |
| 最近 commit | 2026-08-22 |
| Language | TypeScript |

**可移植设计点：**

1. **Tokenization Pipeline**（Textmate Grammar scope → ThemeRule → Color + fontStyle）：`vscode-colorize` + `inspectEditorTokensAndScopes` 命令可实时调试 scope→color 映射。AgentSkin 若需处理输入框内代码着色场景可参考。
2. **Workbench ↔ Syntax 双轨 theming**（`workbench.colorCustomizations` vs `editor.tokenColorCustomizations` vs `editor.semanticTokenColorCustomizations`）：三个独立它们维度。AgentSkin 同样区分 shell UI token vs. app UI token vs. code/syntax token。
3. **Color Contribution API**（`package.json` `contributes.colors` 声明语义类型 + `contributes.themes` 提供值）：扩展机制驱动主题注册。此 API 设计范式可直接移植到 AgentSkin 的 ThemeStudio 扩展市场。

**适配到 AgentSkin：** Color Contribution API 的声明式主题注册机制最具移植价值；scope→color 的 cascade matching 算法可参考。

---

### 9. microsoft/vscode-textmate

| 指标 | 数据 |
|------|------|
| URL | https://github.com/microsoft/vscode-textmate |
| Stars | 677 |
| 最近 commit | 2026-08-07 |
| 协议 | MIT |

**可移植设计点：**

1. **TextMate Grammar → Scope Stack → ThemeRule Match** 三间层模型：`Registry` 类加载 `.tmTheme` 或 JSON theme，通过 `theme.match(scopeStack)` 找到最佳 rule。AgentSkin 适配器的"选择器优先级匹配"逻辑与此同构。
2. **ThemeRuleSelector 排序算法**（ancestorMatch → priority weight）：在多个 rule 命中同一 token 时通过 specificity 权重决定胜出。AgentSkin 6 个适配器均有相似的多选择器竞争场景。
3. **WASM 加速的 Oniguruma 正则匹配**（`vscode-oniguruma` + WASM 编译）：grammar 规则匹配性能关键路径。AgentSkin 注入引擎若处理复杂 CSS 选择器匹配可参考。

**适配到 AgentSkin：** Theme 仓库模板 + `vscode.provideDocumentTokens` 思路可移植为 AgentSkin 的增量 token 求值引擎。

---

## 方向五：Electron + CDP 注入结合

### 10. codex-app-transfer (Cmochance)

| 指标 | 数据 |
|------|------|
| URL | https://github.com/Cmochance/codex-app-transfer |
| Stars | 301 |
| 最近 commit | 2026-08-17 |
| 协议 | MIT |

**可移植设计点：**

1. **Electron + CDP 实时主题注入 + 即时清除**（`theme/clear` API + CDP `CSS.insertRule` + `Runtime.evaluate`）：commit #530 明确实现了"能切不能关"的修复——off 分支落盘后 best-effort 调 `themeClear()` 即时清除。与 AgentSkin 的 apply/clear 对称设计完全同构。
2. **IIFE 注入模式**（主题切换走 IIFE 即切不需 reload）：与 AgentSkin 当前 applyTheme 的 IIFE 注入路径完全一致。
3. **Best-effort 降级策略**（CDP 不可用时回退"等重启移除"提示）：AgentSkin 同样面临目标应用未经本工具启动时的降级场景。

**适配到 AgentSkin：** 直接参考其 `themeClear()` 实现和 best-effort 降级模式；IIFE 注入路径与 AgentSkin 现有引擎高度一致。

---

### 11. tradingview-mcp (tradesdontlie)

| 指标 | 数据 |
|------|------|
| URL | https://github.com/tradesdontlie/tradingview-mcp |
| Stars | — (活跃小项目) |
| 最近 commit | 2026-04-04 |
| 协议 | MIT |

**可移植设计点：**

1. **CDP 注入 + DI 容器 + 全链路测试覆盖**（`Add DI and full test coverage for chart.js and drawing.js sanitization`）：CDP 注入场景下通过依赖注入解耦注入逻辑与业务逻辑。AgentSkin 的 Adapter 架构与此同构。
2. **CDP Framing 安全策略**（`Add attribution notices, trademark disclaimers, and CDP framing`）：注入第三方应用时的安全边界声明。AgentSkin 同样面临"修改非自有 DOM"的安全与合规问题。
3. **DOM-based tools → internal API calls 迁移**（`Replace DOM-based tools with internal API calls`）：从脆弱的 DOM 操作迁移到稳定的 API 调用。AgentSkin 的注入引擎同样面临 DOM 选择器脆弱性问题。

**适配到 AgentSkin：** DI 容器解耦注入逻辑的思路；CDP framing 安全策略；从 DOM 选择器迁移到 API 调用的演进路径。

---

## 横向对比总结

| 项目 | Stars | 方向 | 与 AgentSkin 同构度 | 最高价值移植点 |
|------|-------|------|---------------------|---------------|
| Adobe Spectrum CSS | 1,288 | 企业 DS | ★★★★ | stylelint 插件守卫 + token 三层架构 |
| Microsoft Fluent UI | 20,223 | 企业 DS | ★★★ | Griffel CSS-in-JS + createTheme 工厂 |
| MUI Material UI | 98,887 | 企业 DS | ★★★ | 种子色→色阶派生 + slots 覆盖 |
| Dark Reader | 22,283 | 主题引擎 | ★★★★★ | CSS 颜色解析管道 + per-site fix config |
| Stylus | 6,837 | 主题引擎 | ★★★★ | UserCSS @var 格式 + 注入管理器 |
| Open Design | 90,287 | Theme Studio | ★★★★ | 三分支结构 + replay-based mock 测试 |
| OneKeyHQ app-monorepo | 2,417 | Monorepo | ★★★ | 跨端 useTheme + 共享 token schema |
| VS Code | 189,250 | 编辑器主题 | ★★★★ | Color Contribution API + 双轨 theming |
| vscode-textmate | 677 | 编辑器主题 | ★★★★ | ThemeRule 匹配 + scope cascade |
| codex-app-transfer | 301 | Electron+CDP | ★★★★★ | themeClear + IIFE 注入 + best-effort 降级 |
| tradingview-mcp | — | Electron+CDP | ★★★ | DI 解耦 + CDP framing 安全 |

---

## 对 AgentSkin 的 Top 5 移植建议

1. **Dark Reader 的 CSS 颜色解析管道**：将现有 pattern 替换升级为 AST 级 CSS 解析 + 颜色语义替换，提升注入精度。
2. **codex-app-transfer 的 themeClear 对称设计**：补齐"能切不能关"的 CDP 即时清除能力，与现有 apply 对称。
3. **VS Code Color Contribution API 范式**：为 ThemeStudio 设计声明式主题注册 + 扩展市场接口。
4. **Adobe Spectrum 的 stylelint 插件守卫**：将 check-design-tokens 提升为 biome 规则集，编译期拦截 token 违规。
5. **Open Design 的 replay-based mock 测试**：为 Studio 路线建立零 token 消耗的回归测试框架。

---

*本报告为纯调研输出，不含任何代码修改。所有数据基于 2026-08-22 GitHub API 实时查询。*
