# AgentSkin 注入引擎优化汇总报告

> 生成日期：2026-08-23
> 基于子智能体分析结果汇总（注入引擎 + 主题引擎）
> 覆盖文件：`engines/shared/*.mjs`、`engines/*/adapter.mjs`、`scripts/build-theme-package.mjs`、`scripts/generate-theme-css.mjs`、`scripts/theme-utils.mjs`、`scripts/variations-loader.mjs`、`scripts/rebuild-all-themes.mjs`、`src/engine/src/runtime/*.mjs`、`src/main/cdp/**/*.ts`

---

## 一、不足验证结论

### 1.1 注入引擎 — 14 项不足验证

| # | 不足描述 | 验证状态 | 证据/位置 |
|---|---------|---------|----------|
| I1 | `discoverAndOverrideTokens` 全量遍历 stylesheet，大应用卡顿 | **真实** | `engines/doubao/adapter.mjs:554-612` — 遍历 `document.styleSheets` 全部 rule；4/6 adapter 含此函数 |
| I2 | `applyGenericPunchThrough` DOM walk + 强制 reflow | **真实** | `engines/doubao/adapter.mjs:495-546` — 递归 `walk(el)` + `getComputedStyle` + `getBoundingClientRect` 每节点触发 reflow |
| I3 | `hybrid-injector` 模块级全局状态（`_sheets`/`_rafQueue`） | **真实** | `engines/shared/hybrid-injector.mjs:38-40,64` — IIFE 内 `let _rafQueue` + `const _sheets = new Map()` 是模块级变量，多实例共享冲突 |
| I4 | `deep-core` 静态类属性单例冲突（`SafeAttachShadowPatcher`/`FragmentRegistry`） | **真实** | `engines/shared/deep-core.mjs:56-104,110-202` — `static _owned`、`static _fragments` 是模块级单例，多 adapter 实例 dispose 互相破坏 |
| I5 | `adoptedStyleSheets` setter 全局冲突 | **真实** | `engines/doubao/adapter.mjs:99-139`、`engines/traework/adapter.mjs:79-119`、`engines/workbuddy/adapter.mjs:98-138` — 3 个 adapter 各自 `window.__agentskin_originalAdoptedSheetsDesc = desc`，后者覆盖前者 |
| I6 | `workbuddy` STRUCTURAL_CSS 选择器泄漏（未用 host class 前缀） | **真实** | `engines/workbuddy/adapter.mjs:147-304` — `#root`、`.teams-container`、`[data-view-id]` 等均未加 `html.agentskin-host-workbuddy` 前缀 |
| I7 | `doubao` `reinjectSheet` 变量混淆（`finalSheet` 更新但 `window[MARKER].sheet` 未同步） | **真实** | `engines/doubao/adapter.mjs:816-828` — `reinjectSheet()` 内 `const newSheet = finalSheet = new CSSStyleSheet()` 覆盖了模块级 `finalSheet`，但 `window[MARKER]` 初始化时写入的是旧 `finalSheet`（line 886），导致后续 2s interval 检测 `sheets.length < expectedLayers` 使用旧引用判断 |
| I8 | `ContextAwareEngine` 空 interval（`exposedState: []` 但 `setInterval` 空转） | **真实** | `engines/shared/deep-core.mjs:289-314` — `initContextEngine(this._config.exposedState || [], ...)` 传入空数组时 `readAll()` 仍每秒执行一次空循环 |
| I9 | `AdaptiveMutationObserver` 6 份重复定义 | **部分正确** | 6 个 adapter 各有fallback 副本（有意设计，幂等兜底）；但 `src/engine/src/runtime/adaptive-observer.mjs` 主副本 + `engines/shared/deep-core.mjs:493-544` 一份 = 8 份 |
| I10 | `session-pool` 容量绕过（discard 后 fallthrough 绕过容量检查） | **不真实** | `SessionPool` 当前实现无硬容量上限；`prune()` 仅按 TTL 清理。此条为误报——不存在"被绕过的容量检查" |
| I11 | `reload-watchdog` 竞态（detach 与 reverify 之间竞态） | **部分正确** | `initRouteDetector` 的 `disconnect()` 恢复 `history.pushState` 但不处理嵌套 patch；多次调用后 `origPush` 链断裂 |
| I12 | `Runtime.enable` 未清理（每次 engine 注入都 enable 但未 disable） | **真实** | `src/engine/src/cdp/session.mjs:39`、`src/main/cdp/injection/engine-strategy.ts:161,327`、`src/main/cdp/injection/cdp-strategy.ts:107`、`src/main/theme-health-check.ts:40` — 多处 `Runtime.enable` 无对应 `Runtime.disable` |
| I13 | `deep-core` `setInterval` 泄漏风险（构造函数异常时 interval 无法清理） | **真实** | `engines/shared/deep-core.mjs:348-370` — `try { this._init() } catch { throw }` 中 `_init()` 内 `initContextEngine` 返回的 handle 已 push 到 `this._observers`，但 interval 在 push 前已启动；若 `_init` 后续步骤失败，interval 仍存在但 `dispose()` 不会被调用 |
| I14 | `initRouteDetector` 恢复链断裂（多次 patch 后 disconnect 无法恢复原始状态） | **真实** | `engines/shared/deep-core.mjs:222-264` — 每次调用保存 `origPush = history.pushState`，但多次调用后 `origPush` 已是前一次 patch 的版本，`disconnect` 只恢复最近一层 |

### 1.2 主题引擎 — 10 项不足验证

| # | 不足描述 | 验证状态 | 证据/位置 |
|---|---------|---------|----------|
| T1 | `sanitizeDeclarationBlock` 未导入（运行时 ReferenceError） | **真实（P0）** | `scripts/build-theme-package.mjs:537` — `sanitizeDeclarationBlock(String(val), ...)` 被调用但文件顶部 import 列表（line 30-46）中无此函数导入 |
| T2 | `themeId` 未定义（同文件 warn 日志引用未定义变量） | **真实（P0）** | `scripts/build-theme-package.mjs:542` — `console.warn(\`⚠ theme ${themeId}/...`) 中 `themeId` 未在 `buildAgentCssInternal` 作用域内定义 |
| T3 | `HOST_SELECTOR` 与 `HOSTS` 不一致（两套选择器定义不同源） | **真实** | `scripts/build-theme-package.mjs:73-81` 定义 `HOST_SELECTOR`；`scripts/theme-utils.mjs:780-784` 定义 `HOSTS`。key `workbuddy` 的值分别为 `'html.agentskin-host-workbuddy body'` vs `'body[data-application-name="workbuddy"]'`，完全不同源 |
| T4 | `color-scheme` 重复声明（tokenBlock + 3 个 override 函数重复） | **真实** | `scripts/build-theme-package.mjs:506,556` — `:root` 和 host 块各声明一次 `color-scheme`；加上 `theme-generators.mjs` 和各 adapter 内的 `color-scheme` 声明，单 theme 切换可产生 3-5 次重复声明 |
| T5 | `doubaoCss` 50% 重复（`--semi-color-*` 在 `:root` 和 `body` 重复） | **部分正确** | 有意设计（:root 提供继承回退，body 提供高特异性覆盖），但未在代码中标注为 INTENTIONAL，易被误报为 bug |
| T6 | 两条生成路径不一致（`rebuild-all-themes.mjs` vs `generate-theme-css.mjs`） | **真实** | `scripts/rebuild-all-themes.mjs` 直接调用 `buildThemePackage` 但跳过 `loadColorSchemes`、`extendedColorsBlock`、`designLanguageBlock`、`loadVariations`；`scripts/generate-theme-css.mjs` 走完整管线 |
| T7 | `AGENT_ONLY_TOKENS` 未覆盖 `text-shadow`（14-token 契约存在第 15 个影子 token） | **部分正确** | `scripts/check-theme-staleness.mjs:58` 的 `AGENT_ONLY_TOKENS` 仅含 `button-bg` + `input-bg` 两个；`text-shadow` 是主题 CSS 中实际使用的第 15 个 `agentskin-*` 变量但未纳入契约检查 |
| T8 | `rebuild-all-themes` 不支持 `colorSchemes` | **真实** | `scripts/rebuild-all-themes.mjs:36-67` — 仅读取 `manifest.colors`，不遍历 `manifest.colorSchemes`，替代方案的主题包无 CSS 输出 |
| T9 | `variations-loader` 无 CSS 消毒 | **真实** | `scripts/variations-loader.mjs:32,51` — `tokenOverridesToCss` 和 `componentSpecificToCss` 直接拼接用户提供的 key/value 无 `sanitizeDeclarationBlock` 调用 |
| T10 | `reload-watchdog` 600ms FOUC | **不真实** | 当前实现无 600ms  watchdog；self-heal interval 为 2000ms（`engines/*/adapter.mjs` 中 `setInterval(..., 2000)`）。FOUC 来自首次注入延迟，非 watchdog 配置问题 |

### 1.3 最初遗漏的重要不足

以下 6 项在子智能体分析中被首次识别，初始 8 点扫描中未覆盖：

| # | 遗漏不足 | 严重性 | 说明 |
|---|---------|--------|------|
| M1 | 3 个 adapter 的 `adoptedStyleSheets` setter 彼此覆盖写入 | P1 | traework/doubao/workbuddy 各自初始化时写 `window.__agentskin_originalAdoptedSheetsDesc`，后者覆盖前者，导致第一个 adapter 的 patch 引用丢失 |
| M2 | `SafeAttachShadowPatcher.install()` 在 `_patched=true` 时不更新 inject 但不重注入已有 shadowRoot | P1 | 首次 install 后新增 shadowRoot 不会获得注入，除非 `uninstall()+install()` |
| M3 | `FragmentRegistry.activate()` 对同一 fragment 重复调用会插入多个 sheet 副本 | P1 | `frag.active` 检查存在但 `adoptedStyleSheets` 赋值是 replace 全数组，并发场景下可能重复 |
| M4 | `HybridInjector.dispose()` 未清理模块级 `_rafQueue`/`_rafCallbacks` | P2 | 仅清理 `_rafId`，但 `_rafQueue` 和 `_rafCallbacks` 数组残留内存 |
| M5 | `build-theme-package.mjs` 的 `HOST_SELECTOR` 缺少 `zcode` 条目 | P1 | `HOST_SELECTOR` 仅 5 个 adapter（无 zcode），`HOSTS` 也未包含 zcode |
| M6 | `generate-theme-css.mjs` 生成的 CSS 与 `build-theme-package.mjs` 生成的 CSS 选择器作用域不一致 | P1 | 前者用 `HOSTS[agent]`（theme-utils.mjs），后者用 `HOST_SELECTOR[agent]`（build-theme-package.mjs 内部定义），两者对 workbuddy 的值完全不同 |

---

## 二、优先级排序

### P0（立即修 — 阻塞性运行时错误）

| # | 问题 | 位置 | 修复工作量 | 影响 |
|---|------|------|-----------|------|
| P0-1 | `sanitizeDeclarationBlock` 未导入 | `scripts/build-theme-package.mjs:537` | +1 行 import | Studio 导出主题时 variableBridge 非空即 ReferenceError |
| P0-2 | `themeId` 未定义 | `scripts/build-theme-package.mjs:542` | +1 行（从参数或 manifest 提取） | 同上场景 warn 日志崩溃 |

### P1（本周 — 高价值修复）

| # | 问题 | 位置 | 修复工作量 | 影响 |
|---|------|------|-----------|------|
| P1-1 | `HOST_SELECTOR` 与 `HOSTS` 不一致 | `scripts/build-theme-package.mjs:73-81` ↔ `scripts/theme-utils.mjs:780-784` | ±5 行（统一为单一来源） | Studio 导出 + 生成器产生不同选择器，workbuddy 作用域错误 |
| P1-2 | `color-scheme` 重复声明 | `scripts/build-theme-package.mjs:506,556` + `theme-generators.mjs` | ±10 行（提取为 shared helper） | 单 theme 3-5 次冗余声明，增加 CSS 体积 |
| P1-3 | `discoverAndOverrideTokens` 性能（4 adapter 全量遍历） | `engines/doubao/adapter.mjs:554`、`engines/workbuddy/adapter.mjs`、`engines/qoderwork/adapter.mjs`、`engines/zcode/adapter.mjs` | ±30 行（增量 + 缓存） | 大应用首次注入卡顿 200-500ms |
| P1-4 | `applyGenericPunchThrough` DOM walk + reflow | `engines/doubao/adapter.mjs:495-546` | ±20 行（`IntersectionObserver` + `requestIdleCallback`） | 大 DOM 应用布局抖动 |
| P1-5 | `hybrid-injector` 模块级全局状态 | `engines/shared/hybrid-injector.mjs:38-40,64` | ±15 行（封装为实例属性） | 多 adapter 共享 HybridInjector 时状态互相污染 |
| P1-6 | `deep-core` 静态类属性单例冲突 | `engines/shared/deep-core.mjs:56-104,110-202` | ±30 行（实例属性替代静态属性） | 多 adapter 实例 dispose 互相破坏 |
| P1-7 | `adoptedStyleSheets` setter 全局冲突 | `engines/*/adapter.mjs` 各 79-139 行 | ±20 行（adapter 间共享 patch 状态 via `window.__agentskin_adopted_patch__`） | 后初始化的 adapter 覆盖先者的 patch |
| P1-8 | `workbuddy` STRUCTURAL_CSS 选择器泄漏 | `engines/workbuddy/adapter.mjs:147-304` | ±25 行（加 `html.agentskin-host-workbuddy` 前缀） | 选择器泄漏到其他 agent 上下文 |
| P1-9 | `doubao` `reinjectSheet` 变量混淆 | `engines/doubao/adapter.mjs:816-828,886` | ±5 行（同步更新 `window[MARKER].sheet`） | self-heal 判断使用旧 sheet 引用 |
| P1-10 | 两条生成路径不一致 | `scripts/rebuild-all-themes.mjs` vs `scripts/generate-theme-css.mjs` | ±15 行（rebuild 委托给 generate-theme-css） | Studio 产物与手工主题 CSS 不一致 |
| P1-11 | `AGENT_ONLY_TOKENS` 未覆盖 text-shadow | `scripts/check-theme-staleness.mjs:58` | ±3 行（扩展允许集） | `--agentskin-shadow-*` 相关变化不被检测 |
| P1-12 | `HOST_SELECTOR` 缺少 zcode 条目 | `scripts/build-theme-package.mjs:73-81` | +1 行 | Studio 导出 zcode 主题时 host selector 回退到动态拼接 |

### P2（迭代 — 技术债与低优先级优化）

| # | 问题 | 位置 | 修复工作量 | 影响 |
|---|------|------|-----------|------|
| P2-1 | `ContextAwareEngine` 空 interval | `engines/shared/deep-core.mjs:289-314` | ±3 行（`exposedState.length === 0` 时跳过 setInterval） | 每秒一次无用 CPU 周期 |
| P2-2 | `AdaptiveMutationObserver` 6-8 份重复 | 各 adapter + deep-core + runtime | ±0（有意设计，加注释标注 INTENTIONAL） | 代码体积 +1.5KB |
| P2-3 | `reload-watchdog` 恢复链断裂 | `engines/shared/deep-core.mjs:222-264` | ±10 行（链式 restore 栈） | 多次 patch 后 disconnect 无法完全恢复 |
| P2-4 | `Runtime.enable` 未清理 | `src/engine/src/cdp/session.mjs:39` + 4 处调用点 | ±5 行（pool release 时 disable） | CDP session 增多时 V8 runtime 上下文残留 |
| P2-5 | `deep-core` setInterval 泄漏风险 | `engines/shared/deep-core.mjs:348-370` | ±8 行（try/catch 包裹 _init + 失败时 disconnect 已注册_handles） | 构造函数异常时 interval 无法清理 |
| P2-6 | `rebuild-all-themes` 不支持 colorSchemes | `scripts/rebuild-all-themes.mjs:36-67` | ±10 行（遍历 manifest.colorSchemes） | 替代方案主题包无 CSS 输出 |
| P2-7 | `variations-loader` 无 CSS 消毒 | `scripts/variations-loader.mjs:32,51` | ±5 行（调用 `sanitizeDeclarationBlock`） | 恶意/异常 variation 可注入任意 CSS |
| P2-8 | `HybridInjector.dispose()` 未清理模块级 `_rafQueue` | `engines/shared/hybrid-injector.mjs:212-222` | +2 行 | 内存微量残留 |

---

## 三、推荐修复路线图

### 第一批（立即修，预计 30 分钟）

**目标：消除运行时 ReferenceError，恢复 Studio 导出能力**

1. **P0-1**：在 `scripts/build-theme-package.mjs` 顶部 import 区加入 `sanitizeDeclarationBlock` 导入（从已有的 `../src/compiler/sanitize.js`）
2. **P0-2**：将 `buildAgentCssInternal` 内 `themeId` 引用替换为函数参数传入的 manifest id

**验证方式**：`node scripts/build-theme-package.mjs` 不抛 ReferenceError；Studio 导出含 variableBridge 的主题包成功

### 第二批（本周，预计 4-6 小时）

**目标：消除选择器不一致 + 性能 hot path 优化**

3. **P1-1 + P1-12**：统一 `HOST_SELECTOR` 与 `HOSTS` 为单一来源（从 `theme-utils.mjs` 导入），补全 zcode
4. **P1-2**：提取 `colorMode(mode)` 共享函数，消除 5 处重复 `color-scheme` 声明
5. **P1-10**：`rebuild-all-themes.mjs` 委托给 `generate-theme-css.mjs` 的完整管线
6. **P1-11**：`AGENT_ONLY_TOKENS` 增加 `text-shadow` token
7. **P1-3**：`discoverAndOverrideTokens` 增加增量缓存（已扫描过的 sheet 跳过；仅在新 sheet 出现时全量扫描）
8. **P1-4**：`applyGenericPunchThrough` 的 DOM walk 改为 `requestIdleCallback` 分片 + `IntersectionObserver` 替代 `getBoundingClientRect` 每节点调用

**验证方式**：`npm run check` 全绿；`codex-injection-benchmark` 重测无回归

### 第三批（迭代，预计 2-3 小时）

**目标：架构健壮性 + 技术债清理**

9. **P1-5**：HybridInjector 实例化 `_sheets`/`_rafQueue`（从 IIve 模块级移入 class 实例属性）
10. **P1-6**：`SafeAttachShadowPatcher`/`FragmentRegistry` 改为实例属性
11. **P1-7**：adapter 间共享 `adoptedStyleSheets` patch 状态，避免覆盖写入
12. **P1-8**：workbuddy STRUCTURAL_CSS 全部加 `html.agentskin-host-workbuddy` 前缀
13. **P1-9**：`reinjectSheet` 同步更新 `window[MARKER].sheet`
14. **P2-3**：`initRouteDetector` 链式 restore 栈
15. **P2-5**：`deep-core` 构造函数异常安全
16. **P2-4**：SessionPool release 时 `Runtime.disable`
17. **P2-7**：`variations-loader` 调用 `sanitizeDeclarationBlock`
18. **P2-6**：`rebuild-all-themes` 支持 colorSchemes

**验证方式**：`npm run check` 全绿；多 target 场景（workbuddy 13+ webview）回归测试通过

---

## 四、竞品实践落地点

### 4.1 已被 AgentSkin 覆盖的实践

| 竞品实践 | AgentSkin 对应实现 | 覆盖度 |
|---------|-------------------|--------|
| Catppuccin 语义化 token 命名 | `--agentskin-*` 14-token 契约 | 完全覆盖 |
| Dark Reader 三级注入策略 | `hybrid-injector.mjs` 增量/批量/动态三模式 | 完全覆盖 |
| Vencord 主题热替换 | `replaceSync` 原子替换 + `hotReplace()` | 完全覆盖 |
| Stylus 实时预览 | Theme Studio → 即时应用到运行中 target | 完全覆盖 |
| BetterDiscord 目录自动加载 | `themes/` 目录自动扫描 + manifest 驱动 | 完全覆盖 |

### 4.2 可低成本添加的实践

| 竞品实践 | 落地方式 | 工作量 | 优先级 |
|---------|---------|--------|--------|
| Catppuccin `palette.json` 机器可读 | `build-palette.mjs` 已生成 `palette.json`，但未被消费链路完整使用（`rebuild-all-themes.mjs` 跳过 colorSchemes） | ±10 行 | 随 P2-6 一起修复 |
| Dark Reader 站点锁（域名白名单） | 在 adapter 初始化时检查 `location.hostname`，不匹配时 short-circuit | ±5 行/adapter | 随 P1-7 一起修复 |
| Stylus UserCSS 可配置变量 | `variations-loader.mjs` 已支持 `tokenOverrides`，但缺 UI 暴露 | ±20 行 UI 绑定 | 第三批 |

### 4.3 需 RFC 评审后才能实施

| 竞品实践 | 原因 | RFC 触发条件 |
|---------|------|-------------|
| Codex Skin Desktop 的 RenderPlan → CSS Compiler 动态编译 | 涉及注入架构重构（L0-L4 注入层） | RFC: 注入架构重构 |
| Dark Reader `CSS.registerProperty()` Houdini 变量类型安全 | 需新增编译层 + Electron 版本兼容矩阵 | RFC: 注入架构重构 |
| Vencord manifest 标准（跨工具互操作） | 涉及 manifest schema 修改 | RFC: 核心数据模型修改 |
| 语义映射表（14-token → agent 原生变量运行时映射） | 涉及注入运行时引入新的中间层 | RFC: 注入架构重构 |

---

## 五、下一步行动建议

### 立即执行（当前会话可完成）

| 序号 | 操作 | 执行者 | 验证方式 |
|------|------|--------|---------|
| 1 | 修复 `sanitizeDeclarationBlock` 未导入（P0-1） | 开发者 | `node scripts/build-theme-package.mjs` 不报错 |
| 2 | 修复 `themeId` 未定义（P0-2） | 开发者 | 同上 |

### 本周迭代

| 序号 | 操作 | 执行者 | 验证方式 |
|------|------|--------|---------|
| 3 | 统一 `HOST_SELECTOR`/`HOSTS`（P1-1 + P1-12） | 开发者 | `check-themes.mjs` 全绿 + Studio 导出 zcode 主题验证 |
| 4 | `discoverAndOverrideTokens` 增量缓存（P1-3） | 开发者 | 大应用注入耗时下降 50%+ |
| 5 | `applyGenericPunchThrough` 分片（P1-4） | 开发者 | 大 DOM 应用无 layout thrashing |

### 验证基础设施

| 序号 | 操作 | 说明 |
|------|------|------|
| 6 | 补充 `Runtime.enable/disable` 配对的单元测试 | 在 `engine-strategy.test.ts` 中新增 case |
| 7 | 补充 `adoptedStyleSheets` setter 多 adapter 共存回归测试 | 在 `engines/shared/hybrid-injector.test.mjs` 中新增 |
| 8 | 补充 `reinjectSheet` 后 `window[MARKER].sheet` 同步验证 | 在 `engines/doubao/adapter.mjs` 自测中新增 |

### 竞品跟踪

| 序号 | 操作 | 说明 |
|------|------|------|
| 9 | 按 `codex-injection-benchmark-2026-08-23.md` 第 6 节完成 Codex 适配器精准化重写 | 独立任务，影响面大 |
| 10 | 评估Dark Reader 站点锁机制是否可移植到 workbuddy 13+ target 场景 | 需真机验证 |

---

## 附录 A：问题总数统计

| 类别 | 总计 | P0 | P1 | P2 | 不真实 | 部分正确 |
|------|------|----|----|----|-------|---------|
| 注入引擎 | 14 | 0 | 9 | 5 | 1 | 2 |
| 主题引擎 | 10 | 2 | 5 | 2 | 1 | 1 |
| **合计** | **24** | **2** | **14** | **7** | **2** | **3** |

## 附录 B：修复工作量估算

| 批次 | 问题数 | 估算行数 | 预估工时 |
|------|--------|---------|---------|
| 第一批（P0） | 2 | ±2 行 | 30 分钟 |
| 第二批（高价值 P1） | 12 | ±120 行 | 4-6 小时 |
| 第三批（P2 + 剩余 P1） | 7 | ±70 行 | 2-3 小时 |
| **总计** | **21** | **~192 行** | **7-10 小时** |
