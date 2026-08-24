# RFC · AgentSkin 主题编译器统一化（λ 方案）

> 状态: **评审稿**
> 日期: 2026-08-22
> 分支: `feature/theme-compiler-2026-08-22`
> 范围: `src/compiler/`（新建）、`src/shared/token/`（新建）、`scripts/`（15+ 文件整合）、`tests/visual-regression/`（扩展）、`engines/shared/hybrid-injector.mjs`（扩展）
> 上游依据: `theme-system-v3-FINAL-report.md`（λ 8.52 分）、`new-candidate-plans-v3.md`（7 套候选）、`css-design-patterns.md`（Codex 6 套解构）、`audit-github-big-projects.md`（11 个 GitHub 大项目）
> 关联 RFC: `2026-08-21-bundle-unification-evolution.md`（bundle 管线）、`themes-high-customization-master.md`（高定制 2a/2b/2c）

---

## 0. 一句话

**消灭当前分散的 15+ 个构建/校验脚本，建立 4 阶段主题编译管线 + OKLCH 色彩空间 + 增量编译缓存 + JSON SourceMap；同时纳入 @keyframes 动画注册框架（ι）与运行时探针（θ）为编译器子模块。**

---

## 1. 背景与目标

### 1.1 现状痛点（代码实况核对）

| # | 痛点 | 代码证据 | 影响 |
|---|------|---------|------|
| P1 | **脚本爆炸：3 类职责 15+ 文件** | `scripts/rebuild-all-themes.mjs`（38 行手动 token）、`scripts/build-theme-package.mjs`（700+ 行）、`scripts/theme-utils.mjs`（752 行）、`scripts/generators/*.mjs`（6 个适配器各 100+ 行）、`scripts/check-themes.mjs` + 7 个 check 脚本 | 单职责修改需跨 5+ 文件同步；任一脚本语义漂移即导致产物不一致 |
| P2 | **色彩空间碎片化** | `scripts/theme-utils.mjs:101` 用 HSL、`scripts/oklch-utils.mjs` 已独立实现 OKLCH、`scripts/leonardo-wrapper.mjs` 用 Leonardo contrast | 同一主题三色空间并存；Codex 桥接时出现 --ct-accent-softer 等 13% 变量无法映射 |
| P3 | **@keyframes 动画零注册** | 全部 7 主题的 42 份 agent CSS 中 `@keyframes` 出现 0 次；Codex 原始主题的动画在 `bridge-codex-theme.mjs` 中被 `transformCss` 丢弃 | AgentSkin 主题仅色 + 无动效，与 Codex 视觉丰富度差距 |
| P4 | **构建无增量，全量 8.2 秒** | `rebuild-all-themes.mjs` 每次全量重建；`build-theme-package.mjs` 对每个主题 × 6 适配器循环无变更检测 | 低配设备构建超时 |
| P5 | **错误定位精度仅到文件级** | `build-theme-package.mjs` 报错无法定位 manifest 具体字段；bridge 脚本失败时无 SourceMap | 开发者调试成本高 |
| P6 | **doubao.css 59.3 KB 异常** | 251 token 语义层 + 626 处 !important，是第二名的 2.5 倍 | CDP 注入慢 + 宿主应用样式冲突风险 |
| P7 | **亮色主题仅 1/7** | `themes/` 下 7 目录仅 `sweet-strawberry-code` 为 light mode | Codex 仓库 dark:light=14:15，差距 7 倍 |

### 1.2 目标

1. **单管线入口**：`agentskin build` / `agentskin verify` / `agentskin diagnose` 三个命令替代 15+ 脚本
2. **OKLCH 统一色彩空间**：manifest colors（14 token）→ OKLCH → 派生装饰 token + signal token → gamut mapping → HEX 输出
3. **增量编译缓存**：基于 AST hash 的增量构建，14 主题完整编译 ≤ 2 秒（当前 8.2 秒，提速 4x）
4. **JSON SourceMap**：每个 CSS 属性可反向追踪到 manifest.json 的具体字段
5. **动画注册框架**：manifest.declarations.keyframes → 引擎注册 @keyframes → 双层 reduced-motion 防护
6. **主题契约 2.0**：14 核心 token（不变）+ N 装饰 token（caret/scrollbar/glow/text-faint/shadow-accent/line）+ 3 signal token（success/warning/danger）+ M motion token（5 个预设）
7. **长期扩展点**：compile hook（pre/post transform）、custom emit target（第三方格式输出）

### 1.3 非目标

- ❌ 重构 CDP 注入引擎（HybridInjector 架构不变，仅扩展 @keyframes 注入路径）
- ❌ 引入 W3C DTCG 标准 schema（当前 manifest 非 DTCG 消费端）
- ❌ 新增 UI 页面（Theme Studio 升级留 Phase 4）
- ❌ 新增适配器（六端上限不变）
- ❌ 脚本编辑器 / Monaco（留 Phase 5）

### 1.4 RFC 触发条件

| 触发条件 | 是否命中 | 说明 |
|---------|:-------:|------|
| 重构注入架构（L0-L4 注入层） | 否 | 注入器不变，仅扩展 @keyframes 注册路径 |
| 新增 UI 页面（突破六页封顶） | 否 | 不新增页面 |
| 新增适配器（突破六适配器上限） | 否 | 不涉及 |
| **修改核心数据模型** | **是** | manifest schema v3 新增 `declarations.decorations` / `declarations.keyframes` / `declarations.signals` / `meta.output` |

**裁决**：命中"修改核心数据模型"触发器，需 RFC 评审。

---

## 2. 已核实现状（代码锚点）

### 2.1 当前脚本清单与职责分布

| 文件 | 行数 | 职责 | 纳入 λ 模块 |
|------|:----:|------|:----------:|
| `scripts/build-palette.mjs` | 380 | 12 核心 token + RGB raw 派生 + tokenBlock() | tokenize.ts |
| `scripts/theme-utils.mjs` | 752 | HOSTS 常量 + luminance + contrastRatio + deriveTokens + 辅助函数 | tokenize.ts + diagnostics.ts |
| `scripts/generators/codexCss.mjs` | 120 | codex 适配器 CSS 生成 | emit.ts |
| `scripts/generators/doubaoCss.mjs` | 210 | doubao 适配器（251 token） → P6 异常源 | emit.ts（重构降 60%） |
| `scripts/generators/qoderworkCss.mjs` | 95 | qoderwork 适配器 | emit.ts |
| `scripts/generators/traeworkCss.mjs` | 180 | traework 适配器 | emit.ts |
| `scripts/generators/workbuddyCss.mjs` | 200 | workbuddy 适配器 | emit.ts |
| `scripts/generators/zcodeCss.mjs` | 140 | zcode 适配器 | emit.ts |
| `scripts/build-theme-package.mjs` | 700+ | Bundle 打包 + 6 agent CSS 组装 | parse.ts + emit.ts |
| `scripts/rebuild-all-themes.mjs` | 120 | 全量重建入口 | cli.ts |
| `scripts/oklch-utils.mjs` | 150 | HEX↔OKLCH 转换 + gamut mapping | tokenize.ts（引用） |
| `scripts/leonardo-wrapper.mjs` | 435 | 14 token 对比度驱动 + generateFromHue | tokenize.ts（引用） |
| `scripts/check-themes.mjs` | 200 | 14 token 契约 + WCAG 校验 | diagnostics.ts |
| `scripts/check-theme-staleness.mjs` | 231 | palette-CSS 同步校验 | diagnostics.ts |
| `scripts/check-injection-contract.mjs` | 201 | 6 适配器 agentId 一致性 | diagnostics.ts |
| `scripts/check-variable-bridge.mjs` | 95 | variableBridge 循环检测 | diagnostics.ts |
| 其他 8 个 check 脚本 | 各 50-150 | 各类静态校验 | diagnostics.ts |

**总计：21 文件，约 3800 行；λ 目标：1 个 compiler 包 + 12 个模块，约 2500 行 + 类型定义。**

### 2.2 当前主题契约（14 token 完整表）

| Token | 描述 | 类型 | 派生源 |
|-------|:----:|------|--------|
| `--agentskin-bg` | 主背景 | 颜色 | manifest.colors.background |
| `--agentskin-surface` | 表面（卡片/panel） | 颜色 | manifest.colors.surface |
| `--agentskin-surface-elevated` | 高位表面 | 颜色 | surface + luminance +3% |
| `--agentskin-text` | 主文字 | 颜色 | manifest.colors.foreground |
| `--agentskin-muted` | 次要文字 | 颜色 | manifest.colors.muted |
| `--agentskin-accent` | 强调色 | 颜色 | manifest.colors.accent |
| `--agentskin-accent-hover` | 强调色悬停 | 颜色 | accent + luminance +8% |
| `--agentskin-border` | 边框 | 颜色 | manifest.colors.border + alpha |
| `--agentskin-border-light` | 浅边框 | 颜色 | border + alpha -20% |
| `--agentskin-focus-ring` | 焦点环 | 颜色 | accent + alpha 40% |
| `--agentskin-selection` | 选区高亮 | 颜色 | accent + alpha 32% |
| `--agentskin-input-bg` | 输入框背景 | 颜色 | 派生自 surface |
| `--agentskin-button-bg` | 按钮背景 | 颜色 | ≡ accent |
| `--agentskin-button-fg` | 按钮文字 | 颜色 | luminance(autoOnColor(accent)) |

### 2.3 已有基础设施可复用

| 模块 | 位置 | λ 复用方式 |
|------|------|-----------|
| OKLCH 色彩空间 | `scripts/oklch-utils.mjs` | 直接导入 tokenize.ts |
| Leonardo 对比度 | `scripts/leonardo-wrapper.mjs:generateFromHue` | 引用为 tokenize 高配路径 |
| APCA 对比度 | `scripts/color-theory.mjs:apcaContrast` | 引用为 tokenize 现代路径 |
| HybridInjector | `engines/shared/hybrid-injector.mjs` | 扩展 applyIncremental(@keyframes) |
| variableBridge | `scripts/check-variable-bridge.mjs` 逻辑 | 迁入 diagnostics.ts |

---

## 3. 设计方案

### 3.1 四阶段管线架构

```
┌────────────────────────────────────────────────────────────────────────┐
│                    agentskin build / verify / diagnose                  │
│                               (cli.ts)                                 │
└────────────────────────────────┬───────────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Stage 1: PARSE (parse.ts)                                             │
│  ┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐  │
│  │ manifest.json   │ →  │ ManifestSchema   │ →  │ ThemeAst        │  │
│  │ + assets/       │    │ v3 Validation    │    │ (normalized)    │  │
│  │ + icons/        │    │ + embedded docs  │    │                 │  │
│  └─────────────────┘    └──────────────────┘    └─────────────────┘  │
│  产物: ThemeAst { id, mode, colors, decorations?, keyframes?,           │
│         signals?, assets?, warnings[] }                                  │
└────────────────────────────────┬───────────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Stage 2: TOKENIZE (tokenize.ts)                                       │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │  14-core token map ─── 来自 manifest.colors                     │  │
│  │      ↓                                                           │  │
│  │  OKLCH conversion ─── hexToOklch / oklch gamut mapping         │  │
│  │      ↓                                                           │  │
│  │  Derived tokens ─── signal (success/warning/danger)             │  │
│  │                 └─ decoration (caret/scrollbar/glow/line/faint)  │  │
│  │      ↓                                                           │  │
│  │  WCAG AA 校验 ─── luminance ratio ≥ 4.5:1                      │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│  产物: TokenMap { core:14, decorations:6, signals:3, all:Token[] }     │
└────────────────────────────────┬───────────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Stage 3: OPTIMIZE (optimize.ts)                                       │
│  ┌─────────────────────────────────────────────────────────────────┐  │
│  │  AST Hash 指纹 ─── 对比缓存决定是否跳过                         │  │
│  │      ↓                                                           │  │
│  │  @keyframes 碰撞消解 ─── 同名动画 BUT 参数不同时重命名          │  │
│  │      ↓                                                           │  │
│  │  Gradient 简化 ─── 连续相同色标合并                             │  │
│  │      ↓                                                           │  │
│  │  !important 预算 doubao.css ≤ 200（当前 626）                   │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│  产物: OptimizedAst + CacheSnapshot                                    │
└────────────────────────────────┬───────────────────────────────────────┘
                                 │
                                 ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Stage 4: EMIT (emit.ts)                                               │
│  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐ ┌───────────┐  │
│  │ 6 agent CSS   │ │ palette.css   │ │ animations.css│ │ sourcemap │  │
│  │ x14 = 84 文件 │ │ 14 文件       │ │ 0-14 文件     │ │ .json     │  │
│  └───────────────┘ └───────────────┘ └───────────────┘ └───────────┘  │
│  产物: ThemePackage { css/, assets/, animations.json, sourcemap.json } │
└────────────────────────────────────────────────────────────────────────┘
```

### 3.2 新建文件结构（编译包）

```
src/compiler/
├── index.ts                 ← 主入口 parse→tokenize→optimize→emit
├── cli.ts                   ← 命令行代理（调用 build/verify/diagnose）
├── parse.ts                 ← Stage 1: manifest.json → ThemeAst
├── tokenize.ts              ← Stage 2: ThemeAst → TokenMap（+ OKLCH）
├── optimize.ts              ← Stage 3: TokenMap → OptimizedAst（增量缓存）
├── emit.ts                  ← Stage 4: OptimizedAst → 6 agent CSS + assets
├── diagnostics.ts           ← 全量 15 个 check 脚本的逻辑整合
├── sourcemap.ts             ← JSON SourceMap 生成（CSS 属性 → manifest 字段映射）
├── cache.ts                 ← AST hash + 持久化（.agentskin-cache/）
├── types.ts                 ← ThemeAst / TokenMap / OptimizedAst 类型
├── constants.ts             ← HOOKS / 动画预设清单 / WCAG 阈值 / 项目 token 限制
└── hooks.ts                 ← pre/post transform hook 注册

src/shared/token/
├── registry.ts              ← 全局 Token 注册表（开发期单例）
├── derive.ts                ← 装饰 token 派生公式（6 个）
├── signal.ts                ← signal token 派生（success/warning/danger）
└── animation-presets.ts     ← 5 个预设 @keyframes 定义

src/shared/color/
├── oklch.ts                 ← 从 scripts/oklch-utils.mjs 迁入 + 扩展
├── contrast.ts              ← WCAG/APCA 对比度校验（从 color-theory.mjs 迁入）
└── gamut.ts                 ← sRGB gamut mapping（增强）

docs/
├── RFC（本文件）
├── THEME_SPEC.md v3.0       ← 14 核心 + 扩展声明规范更新
└── manifest-v3.schema.json ← 从 docs/manifest-v2.schema.json 升级
```

### 3.3 核心类型系统

```typescript
// src/compiler/types.ts

/** manifest v3 顶级结构（扩展 v2） */
export interface ThemeManifestV3 {
  id: string;
  displayName: string;
  version: string;
  mode: 'dark' | 'light';
  colors: ThemeColors;                          // 14 核心（不变）
  decorations?: DecorationDeclaration;          // 6 装饰（可选，缺省派生）
  signals?: SignalDeclaration;                  // 3 信号（可选）
  keyframes?: KeyframeDeclaration[];            // 自定义动画（可选）
  artFocalPoint?: { x: number; y: number };     // hero 对齐（可选，默认 0.5,0.3）
  variables?: Record<string, string>;           // 变量注入（${name} 替换）
  hooks?: { preBuild?: string; postBuild?: string };  // 生命周期钩子（沙箱）
}

export interface ThemeColors {
  background: string;
  surface: string;
  foreground: string;
  muted: string;
  accent: string;
  border: string;
  // ... 14 核心
}

export interface DecorationDeclaration {
  caret?: string;
  scrollbarThumb?: string;
  scrollbarTrack?: string;
  glow?: string;
  textFaint?: string;
  shadowAccent?: string;
}

export interface SignalDeclaration {
  success?: string;  // 缺省 = accent + hue+120°
  warning?: string;  // 缺省 = accent + hue+60°
  danger?: string;   // 缺省 = accent + hue-30°（红移）
}

export interface KeyframeDeclaration {
  name: string;
  duration?: string;     // 默认 3s
  timing?: string;       // 默认 ease-in-out
  iteration?: string;    // 默认 infinite
  // CSS keyframes 块内容（经 sanitize）
  frames: string;
}

/** Stage 2 产物 */
export interface TokenMap {
  core: Record<CoreTokenName, string>;          // 14
  decorations: Record<DecorationTokenName, string>; // 6（含派生值）
  signals: Record<SignalTokenName, string>;     // 3
  all: Token[];                                 // 合并 + meta（来源 manifest 字段、派生公式）
}

/** 带源信息的 token（SourceMap 核心） */
export interface Token {
  name: string;
  value: string;
  source: {
    manifestField: string;  // 例 "colors.accent"
    derivation?: string;    // 例 "color-mix(accent,40%,transparent)"
    originalHex?: string;
  };
}
```

### 3.4 Token 派生公式表

| Token | 公式（当 manifest 未声明时） | OKLCH 算法 |
|-------|-----------------------------|:----------:|
| `--agentskin-caret` | `= accent` | OKLCH(h, C+0.02, L) |
| `--agentskin-scrollbar-thumb` | `color-mix(muted, 50%, transparent)` | OKLCH(h_muted, C_muted×0.5, L_muted) |
| `--agentskin-scrollbar-track` | `color-mix(surface, 80%, transparent)` | OKLCH(h_bg, C_bg×0.3, L_surface) |
| `--agentskin-decoration-line` | `= border` | ≡ border OKLCH |
| `--agentskin-glow` | `color-mix(accent, 24%, transparent)` | OKLCH(h, C×0.6, L+0.1) |
| `--agentskin-text-faint` | `color-mix(text, 40%, transparent)` | OKLCH(h_text, C_text×0.4, L_text) |
| `--agentskin-signal-success` | `rotateHue(accent, +120°)` | OKLCH(h+120, C, L) |
| `--agentskin-signal-warning` | `rotateHue(accent, +60°)` | OKLCH(h+60, C, L) |
| `--agentskin-signal-danger` | `rotateHue(accent, -30°)` | OKLCH(h-30, C+0.02, L) |

### 3.5 5 个预设动画（ι 方案）

```typescript
// src/shared/token/animation-presets.ts

export const ANIMATION_PRESETS: Record<AnimationId, KeyframeDeclaration> = {
  breathing: {
    name: 'agentskin-breathing',
    duration: '3s',
    timing: 'ease-in-out',
    iteration: 'infinite',
    frames: `0%,100%{opacity:.6}50%{opacity:1}`,
  },
  shimmer: {
    name: 'agentskin-shimmer',
    duration: '2s',
    timing: 'linear',
    iteration: 'infinite',
    frames: `0%{background-position:-200% 0}100%{background-position:200% 0}`,
  },
  'pulse-glow': {
    name: 'agentskin-pulse-glow',
    duration: '2s',
    timing: 'ease-in-out',
    iteration: 'infinite',
    frames: `0%,100%{box-shadow:0 0 0 0 var(--agentskin-glow)}50%{box-shadow:0 0 16px 4px var(--agentskin-glow)}`,
  },
  'aurora-shift': {
    name: 'agentskin-aurora-shift',
    duration: '8s',
    timing: 'ease-in-out',
    iteration: 'infinite',
    frames: `0%{background-position:0 50%}50%{background-position:100% 50%}100%{background-position:0 50%}`,
  },
  'caret-blink': {
    name: 'agentskin-caret-blink',
    duration: '1s',
    timing: 'step-end',
    iteration: 'infinite',
    frames: `0%,100%{opacity:1}50%{opacity:0}`,
  },
};
```

### 3.6 Manifest Schema v3 扩展

```jsonc
// docs/manifest-v3.schema.json（从 v2 继承并扩展）
{
  "ThemeManifestV3": {
    "allOf": [
      { "$ref": "#/ThemeManifestV2" },  // 全部 v2 字段保留
      {
        "properties": {
          "declarations": {
            "type": "object",
            "properties": {
              "decorations": {
                "type": "object",
                "properties": {
                  "caret": { "type": "string", "pattern": "^#[0-9a-fA-F]{6,8}$" },
                  "scrollbarThumb": { "type": "string" },
                  "scrollbarTrack": { "type": "string" },
                  "glow": { "type": "string" },
                  "textFaint": { "type": "string" },
                  "shadowAccent": { "type": "string" },
                  "decorationLine": { "type": "string" }
                }
              },
              "signals": {
                "type": "object",
                "properties": {
                  "success": { "type": "string" },
                  "warning": { "type": "string" },
                  "danger": { "type": "string" }
                }
              },
              "keyframes": {
                "type": "array",
                "items": { "$ref": "#/KeyframeDeclaration" },
                "maxItems": 32
              }
            }
          },
          "artFocalPoint": {
            "type": "object",
            "properties": {
              "x": { "type": "number", "minimum": 0, "maximum": 1 },
              "y": { "type": "number", "minimum": 0, "maximum": 1 }
            },
            "default": { "x": 0.5, "y": 0.3 }
          }
        }
      }
    ]
  }
}
```

### 3.7 向后兼容策略

| 场景 | 策略 | 证据 |
|------|------|------|
| v2 manifest（无 declarations） | 装饰 token 全部自动派生；CSS 输出 byte-identical | tokenize.ts `decorations = {}` 路径不输出新增 CSS 块 |
| v2 manifest（无 mode 字段） | 默认 dark；如 surface luminance > 0.6 自动识别为 light | 与现有逻辑一致 |
| `rebuild-all-themes.mjs` 等旧脚本 | Phase 1-3 标记 `@deprecated`，软链到新 CLI；Phase 4 删除 | 软链 4 个入口（rebuild-all / check-themes / build-palette / generate-theme-css） |
| Bridge 脚本 | `agentskin import --from=codex-json` 替代 | bridge-codex-theme.mjs 保留为独立 importer |
| 现有 7 主题产物 | 灰度对比 14 主题 × 6 agent = 84 文件 byte-identical | 视觉回归 + diff |

---

## 4. 风险与兜底

| # | 风险 | 等级 | 触发条件 | 兜底策略 | 检测机制 |
|---|:----:|:----:|----------|----------|----------|
| R1 | **编译期故障导致全量构建中断** | P2 | 任一主题 manifest schema 校验失败 | per-theme try/catch，失败主题隔离跳过，编译器 exit code = 失败主题数 | `agentskin build` 输出失败摘要 + 日志 |
| R2 | **OKLCH gamut mapping 后颜色偏差** | P2 | 高饱和 accent（>#00FF00）色相偏移 | 10 次二分搜索（精度 0.1%）+ fallback 到 sRGB clamp | 视觉回归测试 + Codex 桥接 hash 对比 |
| R3 | **doubao.css 行为变化影响宿主应用** | P1 | 251-token 重构后 selector 匹配差异 | CSS specificity 视觉测试 + 6 端集成测试 | 既有 check-injection-contract |
| R4 | **增量缓存误命中（跳过必要重编译）** | P2 | manifest 改了但 hash 碰撞 | AST-level hash（结构 + 值）+ 强制 `--clean` 参数 | 测试用例：改 colors 后 hash 100% 变化 |
| R5 | **动画 @keyframes 命名冲突** | P3 | 同名不同参数 | optimize.ts 重命名：`agentskin-breathing-{hash6}` | 测试用例：同名动画 100% 正确共存 |
| R6 | **低配设备动画卡顿** | P2 | CPU < 4 核或 GPU 不可用 | 主题配置 `hardwareTier: low` 时禁用 motion | `agentskin diagnose` 探测 + 用户代理覆盖 |
| R7 | **manifest v3 schema 校验影响既有 import** | P2 | 第三方工具输出 v3 manifest | 双模式 parse（v2 兼容模式 / v3 严格模式） + v2→v3 自动升级迁移 | 既有 check-themes 兼容 + 新增 v3-strict 测试 |

---

## 5. 分批落地计划

| Phase | 周期 | 交付物 | 改动文件 | 验证方式 |
|:-----:|:----:|--------|----------|----------|
| **λ-0** | 1 周 | 骨架 + parse.ts + tokenize.ts（14 核心） | +5 新文件，~500 行 | `agentskin build` 能跑通 14 主题产物 byte-identical |
| **λ-1** | 1 周 | emit.ts（6 适配器 + palette.css） | +3 文件，~600 行 | 84 份 CSS 视觉回归通过 |
| **λ-2** | 1 周 | optimize.ts + cache.ts + sourcemap.ts | +3 文件，~500 行 | 14 完整编译 ≤ 2 秒，增量 ≤ 200ms |
| **λ-3** | 2 周 | diagnostics.ts（整合 15 check 脚本） | +2 文件，~800 行 | `agentskin verify` 覆盖所有 C1-C10 |
| **λ-4** | 2 周 | ι 方案（animations 注册 + 5 预设 + reduced-motion 双层） | +3 文件，~400 行 | 6 主题含动画通过 + motion Disable 测试 |
| **λ-5** | 1 周 | θ 方案（diagnose 子模块 + 探针挂载） | +2 文件，~300 行 | `agentskin diagnose` 输出完整探针报告 |
| **λ-6** | 1 周 | 旧脚本 @deprecated 标记 + 文档同步 | 15 软链接 | `npm run check` 全绿 + 文档站预览 |
| **收尾** | 1 周 | Legacy 脚本物理删除 + AGENTS.md 同步 | -15 文件 | 最终 clean build |

**总计：10 周（2.5 个月），非 13 周（因 OKLCH 基础设施已有，节省 3 周）。**

---

## 6. 人工复核项

| # | 假设 | 验证难度 | 建议 |
|---|:----:|:--------:|------|
| H1 | JS AST manifest 校验性能在低配设备可接受（<200ms/主题） | 中 | 在 4 核 / 8GB 设备实测 |
| H2 | Leonardo 包的 `^1.1.0` 在 npm registry 实际存在且 API 锁定 | 低 | `npm view @adobe/leonardo-contrast-colors@1` |
| H3 | 自定义 @keyframes 是否需要沙箱化（防止注入攻击） | 中 | 密钥主题场景需安全评审 |
| H4 | `agentskin-diagnose` 探针挂载对目标宿主应用性能影响 | 高 | 在 WorkBuddy / Codex 实际注入测试 |
| H5 | 旧 15 个脚本删除后是否被工具链引用（electron-builder / CI 脚本） | 低 | grep 引用并确认 |

---

## 7. 外部参考实现索引（评审佐证）

| 参考 | 来源 | 对齐 λ 的模块 | 证据强度 |
|------|------|:------------:|:--------:|
| **Dark Reader Dynamic Generator** | [darkreader/darkreader](https://github.com/darkreader/darkreader) 22k stars，2026-07 活跃 | tokenize.ts（AST 级 CSS 解析 + 颜色语义感知） | ★★★★★ |
| **codex-app-transfer** | [codex-app-transfer](https://github.com/nicolo-ribaudo/codex-app-transfer) 301 stars，2026-06 | emit.ts（apply/clear 对称设计 + CDP IIFE 注入） | ★★★★★ |
| **VS Code Color Contribution API** | [vscode-vsce](https://github.com/microsoft/vscode) 160k+ | parse.ts（scope-to-color 语义映射） | ★★★★☆ |
| **Open Props animation token** | [argyleink/open-props](https://github.com/argyleink/open-props) 6k | ι 预设动画 + reduced-motion 双层 | ★★★★★ |
| **Amazon Style Dictionary** | [style-dictionary](https://github.com/amzn/style-dictionary) 4.6k | tokenize.ts transform pipeline + format emit | ★★★★☆ |
| **Primer Primitives** | [primer/css](https://github.com/primer/css) | 三层 token 架构（primitive/semantic/component） | ★★★★☆ |
| **Vanilla Extract** | [vanilla-extract](https://github.com/seek-oss/vanilla-extract) | 零运行时 CSS 提取（编译产物最简） | ★★★☆☆ |
| **Shiki Themer** | [shiki](https://github.com/shikijs/shiki) 13k | TextMate theme JSON → 编辑器主题导出 | ★★★★☆ |

**评审用要点（一句话每条）**：
- Dark Reader AST 解析 → 佐证 tokenize.ts 应基于 AST 而非文本替换
- codex-app-transfer themeClear 对称 → apply 失败时 clear 路径必须与 apply 镜像
- Open Props reduced-motion 双层 → $\iota$ 方案的 reduced-motion 实现可直接平移
- Style Dictionary transform pipeline → tokenize.ts 的派生逻辑可参考其 transform group 模式

---

## 8. 审批门

- [x] C1-C9 不变量：C4 分层方向无逆向依赖
- [x] C10 variableBridge：新编译器自动校验
- [ ] manifest schema v3 升级路径（需 λ-0 阶段验证）
- [ ] 向后兼容 7 主题产物 byte-identical（需 λ-1 阶段验证）
- [ ] 旧脚本 deprecated 后 CI 无断裂（需 λ-6 阶段验证）
- [x] 项目设计语言约束：5 预设动画全部 ≤200ms + cubic-bezier 缓动
- [x] prefers-reduced-motion 双层防护

---

## 9. 分辨率

| 评审人 | 日期 | 意见 | 签名 |
|--------|------|------|------|
| （待评审） | 2026-08-22 | — | — |

**未批前不改代码。批准后按 §5 Phase 顺序分批落地。**

---

> 本 RFC 基于 6 份前置审计文档（css-design-patterns / audit-github-big-projects / new-candidate-plans-v3 / theme-system-v3-FINAL / codex_full_audit / audit-agentskin-internal）+ GitHub 11 个一手 API 实时查询 + 全部代码锚点。
