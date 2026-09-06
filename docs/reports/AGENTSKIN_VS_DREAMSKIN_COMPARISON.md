# AgentSkin vs DreamSkin 全面对比分析

> 分析日期: 2026-08-31
> AgentSkin 路径: `C:\Users\snowb\Desktop\work\desktop-main`
> DreamSkin 路径: `C:\Users\snowb\Desktop\work\dream-work-theme-main`

---

## 1. 应用覆盖对比表

| 应用 | AgentSkin 适配器 | AgentSkin 层级 | DreamSkin app-registry | DreamSkin kind | DreamSkin 注入 CSS |
|------|------------------|----------------|------------------------|----------------|---------------------|
| TRAE Work / SOLO CN | `traework` (active) | engine-strategy + adapter.mjs | `trae-work` | `vscode-work` | buildVsCodeWorkCss |
| QoderWork | `qoderwork` (active) | engine-strategy + adapter.mjs | `qoder-work` | `generic-work` | buildGenericWorkCss + buildQoderWorkShellCss |
| WorkBuddy | `workbuddy` (active) | engine-strategy + adapter.mjs | `workbuddy` | `workbuddy` | buildWorkBuddyCss |
| 豆包 (Doubao) | `doubao` (active) | engine-strategy + adapter.mjs | `doubao` | `generic-work` | buildDoubaoCss |
| Codex | `codex` (active) | engine-strategy + adapter.mjs | `codex` | `codex` | buildCodexCss + codex-dream-skin-base |
| ZCode | `zcode` (active) | engine-strategy + adapter.mjs | `zcode` | `generic-work` | buildZCodeCss |
| CatPaw | — | — | `catpaw` | `generic-work` | buildCatPawCss |
| 千问办公 (QwenWork) | — | — | `qwen-office` | `generic-work` | buildGenericWorkCss |
| HanaAgent | — | — | `hana-agent` | `generic-work` | buildHanaAgentCss |
| Kimi | — | — | `kimi` | `generic-work` | buildKimiCss |
| OpenCode | — | — | `opencode` | `generic-work` | buildOpenCodeCss |
| AgnesCode | — | — | `agnes-code` | `generic-work` | buildAgnesCodeCss |
| MiniMax Code | — | — | `minimax-code` | `generic-work` | buildMiniMaxCodeCss |
| AstronClaw | — | — | `astronclaw` | `generic-work` | buildAstronClawCss |
| StepFun | — | — | `stepfun` | `generic-work` | buildStepFunCss |
| SparkDesk | — | — | `sparkdesk` | `generic-work` | buildSparkDeskCss |
| DeepSeek Harness | — | — | `deepseek-harness` | `generic-work` | buildDeepSeekHarnessCss |
| MonkeyCode | — | — | `monkeycode` | `generic-work` | buildMonkeyCodeCss |
| AutoClaw | — | — | `autoclaw` | `generic-work` | buildAutoClawCss |

**总结**: AgentSkin 支持 6 个活跃适配器（全部有独立的 engine-strategy + adapter.mjs），DreamSkin 在 app-registry 中定义了 18 个应用，但只有 2 个有独立的 app-profiles（codex、workbuddy），其余 16 个通过 generic-work 路径的 buildGenericWorkCss 模板化处理。

---

## 2. 架构对比

### 2.1 AgentSkin 注入架构

**四引擎分工 + 统一编排**

```
UI (React) → preload → IPC → agent-engine-service → 适配器 → CDP WebSocket → 目标应用
```

| 引擎 | 运行位置 | 负责层 | 注入方式 |
|------|---------|--------|---------|
| engine-strategy | 主进程 | palette, tokens, cosmetic, theme, custom | adoptedStyleSheets |
| adapter.mjs | 页面内 (CDP Runtime.evaluate) | adapter | adoptedStyleSheets + 元素级 inline |
| HybridInjector | 页面内 (CDP Runtime.evaluate) | dynamic-overrides | adoptedStyleSheets + rAF 批处理 |
| DeepCore | 页面内 (CDP Runtime.evaluate) | deep-core | adoptedStyleSheets (Shadow DOM) |

**编排层**: `src/shared/injection/orchestrator/`
- Layer Ownership: 每层单引擎负责
- Module Matrix: 模块注册、payload budget 自动降级
- Scene Model: 显式场景模型，主题作者可声明式控制注入层次
- Contract Validator: JSON 契约验证注入结果 (required / recommended / contexts)
- Token Discovery: 增量扫描 CSS 变量，MutationObserver 监听变化

**自愈机制**: UnifiedSelfHeal
- 统一 MutationObserver + 周期自检 + sheet watchdog
- cooldown 期防止重入

**引擎共享模块** (engines/shared/): 22+ 个按需加载的独立 .mjs 文件，包含：
- `adopted-sheets-manager.mjs` — 拦截 adoptedStyleSheets setter
- `adaptive-mutation-observer.mjs` — DOM 变化监测
- `deep-core.mjs` — Shadow DOM 深度适配
- `hybrid-injector.mjs` — 动态增量注入
- `token-discovery.mjs` — CSS 变量自动发现
- `dom-self-heal.mjs` — DOM 自愈
- `theme-hot-swap.mjs` — 主题热替换
- `particle-layer.mjs` / `art-focus.mjs` — 视觉效果层
- `visual-coordinator.mjs` / `visual-quality-guarantor.mjs` — 视觉协调

**背景图处理**: JavaScript art layer (::before/::after pseudo-elements) + CSS 变量 + blob URL (主进程内 file:// 协议用 data URL)

### 2.2 DreamSkin 注入架构

**单一 <style> 元素 + textContent 整块替换**

```
Renderer (Vite React) → IPC → Electron main process → CDP applyTheme() → 目标应用
```

| 阶段 | 实现方式 |
|------|---------|
| CSS 生成 | `buildAppCss()` 根据 appId 分发到具体构建函数 |
| 注入方式 | 页面内 `document.createElement('style')` → `textContent = CSS` |
| ID 标识 | `<style id="dream-work-style">` — 单一 style 元素 |
| 跨应用菜单 | Shadow DOM 菜单系统 (`dream-work-menu`) |
| 持久化脚本 | `addScriptToEvaluateOnNewDocument` — 多窗口/导航恢复 |
| 导航恢复 | `watcher.ts` (5s 定时器) + app-specific 的 startXxxWatcher (500-750ms 间隔) |
| 多窗口处理 | Persistent scripts + generation 标记去重 |
| 跨窗口同步 | localStorage + 内嵌 HTTP 服务器 (custom-theme-store) |

**DreamSkin 无分层概念** — 所有 CSS 变量和覆盖规则混注在同一个 `<style>` 标签内。

### 2.3 架构优劣势

| 维度 | AgentSkin | DreamSkin |
|------|-----------|-----------|
| 分层清晰度 | **优势**: 8 层独立所有权，职责分明 | **劣势**: 所有内容混在一个 style 标签 |
| 可维护性 | **优势**: 模块化设计，每个引擎可独立修改 | **劣势**: buildAppCss 分支数组随应用增长线性膨胀 |
| 性能 | **劣势**: 多引擎协调有开销，需编排器管理 | **优势**: 单一注入路径，开销低 |
| 复杂性 | **劣势**: 架构显著更复杂，学习曲线陡峭 | **优势**: 架构简单，易于理解 |
| 可扩展性 | **优势**: 新增主题特性只需增加声明 | **劣势**: 新增 app 需在 buildAppCss 中添加新分支 |
| 自愈可靠性 | **优势**: 统一引擎 + cooldown，消除闪烁 | **劣势**: 多个 watcher 各自为政，缺少协调 |

---

## 3. 逐维度评分 (1-5)

| 维度 | AgentSkin | DreamSkin | 说明 |
|------|-----------|-----------|------|
| **应用覆盖** | 3 | 4 | DreamSkin 注册 18 个应用 vs AgentSkin 6 个活跃适配器；但 DreamSkin 多数是模板化泛适配 |
| **注入架构** | 4 | 3 | AgentSkin 分层清晰但复杂；DreamSkin 简单但随应用增长难维护 |
| **选择器策略** | 4 | 3 | AgentSkin 固定 class + data-testid；DreamSkin 大量 class*=" 通配 |
| **CSS 变量策略** | 5 | 3 | AgentSkin 14-token 双层映射 + 自动发现；DreamSkin color-mix() 直算 |
| **背景图处理** | 4 | 4 | 两者都用 blob URL + data URL；AgentSkin 多一层 JS art layer |
| **自愈/鲁棒性** | 4 | 3 | AgentSkin 统一引擎；DreamSkin 多 watcher 独立运行 |
| **自定义主题** | 3 | 4 | AgentSkin 14-token 严格模式；DreamSkin 4-color 松耦合更易上手 |
| **UI/创作环境** | 5 | 3 | AgentSkin 有 Studio/Wallpaper/Custom Theme 制作器；DreamSkin 仅有 Gallery + Settings |
| **多窗口支持** | 4 | 3 | AgentSkin 有 windowMatcher 声明；DreamSkin 用 persistent scripts 但缺乏编排 |
| **主题热切换** | 4 | 4 | 两者都支持运行时切换 |
| **跨应用体验** | 3 | 4 | DreamSkin 有跨应用统一菜单；AgentSkin 无此概念 |
| **工程化** | 4 | 3 | AgentSkin 有 RFC 流程 + 不变量守卫 + 22 校验脚本；DreamSkin 较轻量 |
| **i18n/国际化** | 2 | 4 | AgentSkin 有 i18n 校验但实际翻译不完整；DreamSkin 有中英文双语文档 |
| **总分** | **45** | **43** | |

---

## 4. AgentSkin 应该保留的优势

### 4.1 四层注入架构 (engine-strategy / adapter / hybrid-injector / deep-core)

**这是 AgentSkin 最核心的设计优势。** 每层独立所有权 + 编排器协调，使主题作者可以声明式控制注入层次（palette → tokens → cosmetic → theme → custom → adapter → dynamic-overrides → deep-core），新视觉效果只需声明而不需要修改引擎。DreamSkin 把所有逻辑塞进一个 buildAppCss 分支数组，每新增一个应用就膨胀一个 buildXxxCss 函数，长期不可持续。

### 4.2 14-token 系统 + palette.css

14 个语义化 token (accent, background, foreground, secondary, surface, muted, border, hero-radius, ...) 通过 `palette.css` 统一定义，所有引擎和主题共享这一契约。DreamSkin 的 4-color (accent/secondary/surface/text) 虽然简单，但对复杂 UI 的描述力不足，导致 CSS 中大量硬编码颜色值。

### 4.3 Token Discovery 引擎

增量 CSS 变量扫描 + MutationObserver 缓存 + 性能预算分帧执行。这是 AgentSkin 独有的自适应能力 — 当目标应用更新其 CSS 变量命名时，token discovery 能自动发现新变量。DreamSkin 完全依赖人工逆向每个应用的 CSS 变量名。

### 4.4 注入契约验证系统 (contract-validator)

JSON 格式声明每个适配器的"注入成功"标准（required / recommended / contexts），CI 自动验证。这是 DreamSkin 完全没有的质量保障层。

### 4.5 Scene Model + Module Matrix

显式场景模型 + 模块注册 + payload budget 自动降级，使得引擎可以在运行时决定注入策略。DreamSkin 的硬编码 if/else 分发无法做此优化。

### 4.6 Studio 创作环境

React 实现的完整主题创作 IDE，支持实时预览、Wallpaper 引擎、Custom Theme 制作。DreamSkin 的 renderer 只是一个 Gallery + Settings，需要外部工具辅助创作。

### 4.7 RFC 治理流程

架构重构、新增 UI 页面、新增适配器等变更需 RFC 评审。保证了架构的长期一致性。DreamSkin 没有此流程。

---

## 5. AgentSkin 应该改进的问题

### 5.1 架构过于复杂，认知负担重

**问题**: 4 引擎 + 编排器 + Scene Model + Module Matrix + Contract Validator + Declaration Verifier + 22 个共享 .mjs 文件 + 11 个不变量守卫。新贡献者极难理解全貌。

**建议**: 
- 编写一份"新手 30 分钟理解引擎架构"的快速入门
- 考虑将部分共享模块合并（如 visual-coordinator + visual-quality-guarantor + art-focus 可合并为一个"视觉效果引擎"）
- Module Matrix 的实际使用率存疑 — 如果从未触发过降级，说明是过度设计

### 5.2 应用覆盖落后于 DreamSkin

**问题**: 6 个活跃适配器 vs 18 个应用定义。CatPaw、Kimi、Qwen、HanaAgent、OpenCode、AgnesCode、MiniMax Code、AstronClaw、StepFun、SparkDesk、DeepSeek Harness、MonkeyCode、AutoClaw 均缺少。

**建议**: 按用户基数优先级排队补齐适配器。但需遵守 RFC 评审流程。

### 5.3 主题格式严格，上手门槛高

**问题**: 14-token + manifest.json schemaVersion:2 + palette.css 的严格模式使得第三方创作者需要深入理解 token 语义才能制作主题。相比之下 DreamSkin 的 4-color + theme.json + theme.css 几乎零门槛。

**建议**: 
- 提供"简单模式"主题格式（只需 4 个颜色 + 1 张 hero 图），引擎自动展开为 14 token
- CLI 向导工具: `agentskin create-theme --mode=simple`

### 5.4 缺少跨应用统一菜单

**问题**: AgentSkin 没有类似 DreamSkin 的 Shadow DOM 浮动菜单（可在应用内快速切换主题）。用户必须回到 AgentSkin 主界面切换。

**建议**: 考虑在 Studio 或独立悬浮窗中实现跨应用主题快速切换器（需 RFC 评审）。

### 5.5 缺少自定义主题上传/分享

**问题**: 用户制作的自定义主题只能本地使用，无法分享给其他用户。DreamSkin 有 SharedCustomTheme + 内嵌 HTTP 服务实现基础的主题共享。

**建议**: 
- 自定义主题的导入/导出功能（zip 或 JSON）
- 但需注意黄金规则 #3: 禁止自建内容 CDN 和服务端，分享应走 P2P/本地网络

### 5.6 适配器变体爆炸 (Variant Explosion)

**问题**: 每个 adapter.mjs 内包含大量版本特定的选择器变体（TRAE 的 data-trae-ref、WorkBuddy 的 cb- 前缀、Doubao 的 dbx- 前缀等），随应用版本更新不断膨胀。

**建议**: 
- 将版本特定选择器外部化到配置文件（如 DreamSkin 的 app-profiles/）
- Token Discovery 应承担更多自适应工作，减少硬编码选择器

### 5.7 图片→主题自动生成缺失

**问题**: DreamSkin 有 image-to-theme 工作流（用户上传一张图，自动生成调色板 + 主题 CSS）。AgentSkin 需要手动指定 14 个 token 值。

**建议**: 
- 利用已有的 `@material/material-color-utilities` 依赖实现图片到调色板的自动生成
- 在 Studio 中增加"从图片生成主题"按钮

### 5.8 i18n 不完整

**问题**: 有 `check-i18n.mjs` 校验脚本但实际翻译覆盖不全。DreamSkin 有 README.md + README_EN.md 双语文档。

**建议**: 补齐 UI 字符串的中英文翻译，尤其是错误消息和引导文案。

---

## 6. 从 DreamSkin 应该借鉴的优点

### 6.1 极简主题格式 (4-color + hero)

DreamSkin 的 `theme.json` 只需: id, name, author, hero, colors (accent/secondary/surface/text)。用户 30 秒就能创建一个有效主题。

**借鉴方式**: 在 Studio 中增加"快速创作"模式，用户只需上传图片 + 4 个颜色，引擎自动推断 14 token。

### 6.2 跨应用统一菜单 (Shadow DOM)

DreamSkin 的 `buildMenuScript` 创建 Shadow DOM 悬浮菜单，用户在应用内直接切换主题，体验流畅。尤其对 SparkDesk / StepFun / MonkeyCode 等多 surface 应用，菜单能感知当前 surface 并适配。

**借鉴方式**: 设计一个可选的"快速切换"扩展层（作为独立引擎或 Studio 功能），不影响现有 6 适配器的注入流程。

### 6.3 智能 watcher 系统

DreamSkin 为每个需要特殊处理的应用实现了专用 watcher:
- HanaAgent: 20s 稳定期检测 + 2s 轮询
- Kimi: actionAt 排序 + 多主题同步 + 恢复状态传播
- Doubao: 导航后 theme lost 检测 + 重新注入
- StepFun/SparkDesk: surface 感知 + 主题同步
- MonkeyCode: 原生主题存储检测 + 现代化构建版本适配

这些 watcher 虽然各自为政，但解决的是 AgentSkin 也面临的多窗口/导航/恢复问题。

**借鉴方式**: 用 AgentSkin 的自我愈合系统替代 DreamSkin 的 watcher，但加入其 surface 感知和 actionAt 排序的实用模式。

### 6.4 4 色 + color-mix() 的颜色系统

DreamSkin 用 `color-mix(in srgb, ${color} XX%, transparent/dark)` 在运行时计算所有中间色，避免了预定义大量 token 的需要。这对快速适配新应用非常有效。

**借鉴方式**: 在 token-discovery 引擎增加 color-mix 作为"未知 token"的推断策略 — 当无法精确匹配时，基于 4 个基础色推算中间色。

### 6.5 应用启动 + 注入一体化

DreamSkin 的 `launchApp(appId, themeId)` 先启动应用再注入，对用户来说是一个按钮操作。AgentSkin 的 applyTheme 有 launch 选项但流程更显式。

**借鉴方式**: 优化 AgentSkin 安装流程 (installFlow store) 的一键应用体验。

### 6.6 内置主题更新 (theme-updater)

DreamSkin 有 `updateCommunityThemes` 从社区源抓取新主题。AgentSkin 的主题需要手动放置。

**借鉴方式**: 参考其设计但需规避服务端依赖 — 可设计为读取 OSS/网盘上的静态索引文件。

### 6.7 自定义主题制作 Skill

DreamSkin 的 `skills/custom-theme-maker/SKILL.md` 定义了完整的主题制作工作流文档。

**借鉴方式**: 将 AgentSkin 的 THEME_AUTHORING_GUIDE.md 增强为可执行的 Skill 定义。

---

## 7. DreamSkin 的局限（不应采纳的）

### 7.1 单一 buildAppCss 分支膨胀

DreamSkin 的 `buildAppCss` 函数通过 appId if/else 分发到 15+ 个构建函数。这个模式会随应用增长线性恶化 — 每个新应用至少需要:
1. app-registry.ts 条目
2. main.ts APP_PORTS 条目
3. App.tsx 数据定义
4. injector.ts 中的 buildXxxCss 函数

对比 AgentSkin 的四引擎架构，新增应用只需新增一个 adapter.ts 声明文件 + adapter.mjs + tokens.css + cosmetic.css。

### 7.2 缺少分层注入概念

所有规则放在同一个 `<style>` 元素里，通过特异性碰撞解决优先级。当多个主题效果叠加时无法精确控制层级。AgentSkin 的 8 层分 z-index 设计是正确的方向。

### 7.3 缺少不变量守卫

DreamSkin 没有 check-injection-contract、check-themes、check-design-tokens 等守护脚本。主题质量完全依赖人工 review。

### 7.4 16/32 位十六进制颜色校验不一致

DreamSkin 的 `validateThemeManifest` 只校验 `#xxxxxx` (6 位) 格式，但 `buildWorkBuddyCss` 里的 `WORKBUDDY_CSS_PLACEHOLDERS.accent = '#010203'` 只用了 3 位字符（#010203 是合法的 6 位但数值很小）。此外 `isLightSurface` 的阈值 140 缺少文档说明。

### 7.5 Watcher 缺少统一协调

每个 app 有独立的 Map<port, timer> + Map<port, generation> + Map<port, scripts>。这些数据结构随着应用增长不断复制。部分 watcher 有 `timer.unref()` 调用，部分没有。AgentSkin 的 UnifiedSelfHeal + cooldown 机制更优雅。

### 7.6 app-profiles/ 实际使用率低

`electron/manager/app-profiles/` 下只有 codex.ts 和 workbuddy.ts 两个文件，但 app-registry.ts 定义了 18 个应用。说明 profile 机制没有被充分利用，实际工作主要由 app-registry.ts + injector.ts 中的 if/else 分支承担。

### 7.7 缺少 TypeScript 类型安全

DreamSkin 的 injector.ts 大量使用 `any` 类型（manifest: any, colors: any, options = {}），编译期无法捕获字段拼写错误。AgentSkin 有完整的类型系统。

---

## 8. 分适配器的改进建议

### 8.1 traework (TRAE SOLO CN)

**现状**: AgentSkin 的 traework adapter.mjs 有完善的 token discovery (--vscode-icube-, --icube-, --vscode- 前缀) 和路由感知。DreamSkin 的 buildVsCodeWorkCss 通过 body.solo-lite 选择器 + 大量 class*=" 通配。

**改进**:
- 继续保持 token discovery 优势
- 参考 DreamSkin 的 `data-dream-shell="dark/light"` 模式，在 surface 色变化时同步 TRAE 的 body class (vs-dark/vs-light)

### 8.2 qoderwork (QoderWork)

**现状**: AgentSkin 有独立 adapter.mjs + tokens.css。DreamSkin 有 buildQoderWorkShellCss + buildGenericWorkCss 双层。

**改进**:
- 补齐多窗口支持（如 DreamSense 对 StepFun/SparkDesk 的 surface 检测）

### 8.3 workbuddy (WorkBuddy)

**现状**: 两者覆盖都较完善。DreamSkin 有专门的 WorkBuddy menu UI (buildWorkBuddyMenuScript)。

**改进**:
- 参考 DreamSkin 的 WB_CSS_PLACEHOLDERS + template 机制，优化 AgentSkin 的背景图模板化注入
- WorkBuddy 环境变量 (ambient-router.mjs) 是 AgentSkin 独有优势，保持

### 8.4 doubao

**现状**: AgentSkin 有独立 adapter + dark-mode-remap + background-self-heal。DreamSkin 有 buildDoubaoCss + startDoubaoWatcher。

**改进**:
- DreamSkin 的导航后 theme lost 检测可纳入 AgentSelfHeal

### 8.5 codex

**现状**: Codex 是两者重点适配的应用。AgentSkin 的 codex adapter.mjs 有 multi-version selector strategy + progressive rendering awareness。DreamSkin 有独立的 codex-dream-skin-base.css + buildCodexCss + 4 次重试 home detection。

**改进**:
- 学习 DreamSkin 的 `dream-skin-home` class 标记策略 — 对 AgentSkin 的 codex 选择器稳定性有帮助
- 参考 DreamSkin 的 codex debug 信息收集模式，优化 injection-feedback

### 8.6 zcode, catpaw, kimi, 及其他 AgentSkin 未覆盖的应用

**改进方案**:
- ZCode: AgentSkin 已有适配器，保持
- CatPaw/Kimi/Qwen/HanaAgent 等 12 个: 按用户基数排优先级，逐个补齐
- 对于模板化适配即可的应用，可在 engine-strategy 中新增"通用引擎"路径（无需独立 adapter.ts），降低新增成本

---

## 9. 总结

AgentSkin 和 DreamSkin 走的是两条截然不同的技术路线：

- **AgentSkin** 追求架构严谨性：四层注入、token discovery、契约验证、RFC 治理。代价是复杂度高、上手门槛高、应用覆盖慢。
- **DreamSkin** 追求覆盖速度：极简单主题格式、模板化 CSS 生成、快速扩展。代价是架构积弱、分支膨胀、缺少质量守卫。

两者互相需要对方的优点。AgentSkin 最值得借鉴 DreamSkin 的"极简入门体验"（4 色快速创作 + 跨应用菜单），DreamSkin 最值得借鉴 AgentSkin 的"分层注入架构"和"token discovery 自适应"。

对于 AgentSkin 的核心团队，建议：
1. **保留** 14-token 契约、四层注入、token discovery、contract validator
2. **优化** 极简主题快速创作流（降低 14 token 的认知门槛）
3. **补齐** 缺失的 12 个适配器（尤其是 CatPaw、Kimi、QwenOffice）
4. **吸收** DreamSkin 的 watcher surface 感知模式和 Shadow DOM 菜单概念
5. **拒绝** DreamSkin 的 if/else 分支膨胀模式和无类型安全实践
