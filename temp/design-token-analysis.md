# AgentSkin Design Token 体系 & 14-Token 主题契约分析

> 生成日期：2026-08-21
> 数据来源：代码实证（非猜测），涵盖 docs/、scripts/、src/shared/types/、themes/
> 用途：供后续主题体系扩展/重构时比对使用

---

## 1. 14-Token 契约一览表

### 1.1 核心 14 契约 Token（check-themes.mjs REQUIRED_TOKENS）

| # | CSS 变量名 | Manifest 语义名 | 类型 | 用途 | 约束 |
|---|-----------|----------------|------|------|------|
| 1 | `--agentskin-accent` | `colors.accent` | color | 主强调色（按钮/激活/进度/链接） | 暗色中高亮度，亮色中饱和度 |
| 2 | `--agentskin-secondary` | `colors.secondary` | color | 次强调色（渐变/光晕/辅助标记） | 与 accent 互补 |
| 3 | `--agentskin-bg` | `colors.background` | color | 全局背景 | **必需**；暗色 ≤15% 亮度，亮色 ≥90% 亮度 |
| 4 | `--agentskin-surface` | `colors.surface` | color | 表面/面板底色 | 比 bg 略亮（暗色）/接近白（亮色） |
| 5 | `--agentskin-surface-elevated` | `colors.surfaceElevated` | color | 提升表面（弹窗/浮层） | 比 surface 略亮 |
| 6 | `--agentskin-text` | `colors.foreground` | color | 主文本色 | **必需**；暗色 ≥85% 亮度，亮色 ≤30% 亮度 |
| 7 | `--agentskin-muted` | `colors.muted` | color | 次要文本/标签 | 中亮度 |
| 8 | `--agentskin-border` | `colors.border` | color | 边框 | 通常 accent + alpha |
| 9 | `--agentskin-code-bg` | `colors.codeBackground` | color | 代码块背景 | 比 bg 暗或略灰 |
| 10 | `--agentskin-code-fg` | `colors.codeForeground` | color | 代码前景 | accent 浅化或深化 |
| 11 | `--agentskin-input-bg` | `colors.inputBackground` | color | 输入框背景 | 在 agent CSS 中从 surface+accent 派生 |
| 12 | `--agentskin-button-bg` | `colors.buttonBackground` | color | 按钮底色 | accent + alpha，agent CSS 层派生 |
| 13 | `--agentskin-focus-ring` | `colors.focusRing` | color | 焦点环 | accent + 60% alpha |
| 14 | `--agentskin-selection` | — | color | 文本选区 | `alpha(accent, 0.32)` 派生 |

### 1.2 不在 14 契约但有定义的辅助 Token

| Token | 来源 | 派生逻辑 |
|-------|------|---------|
| `--agentskin-text-shadow` | tokenBlock() | `isLight ? '0 1px 2px rgba(255,255,255,0.6)' : '0 1px 3px rgba(0,0,0,0.5)'` |
| `--agentskin-accent-raw` | build-palette.mjs | `toRgbTriple(accent)` → "R, G, B" |
| `--agentskin-secondary-raw` | build-palette.mjs | 同上 |
| `--agentskin-text-raw` | build-palette.mjs | 同上 |
| `--agentskin-muted-raw` | build-palette.mjs | 同上 |
| `--agentskin-surface-raw` | build-palette.mjs | 同上 |
| `--agentskin-surface-elevated-raw` | build-palette.mjs | 同上 |
| `--agentskin-bg-raw` | build-palette.mjs | 同上 |
| `--agentskin-border-raw` | build-palette.mjs | 同上 |
| `--agentskin-art` | 运行时注入 | Hero 背景图 Object URL，主题不写死 |

### 1.3 palette.css vs agent CSS 的 Token 分流

| 文件 | Token 数量 | 包含 | 不包含 |
|------|-----------|------|--------|
| `palette.css`（生成物） | 12 核心 + 9 raw = 21 | 除 button-bg/input-bg 外的 12 个 + -raw 派生 | `--agentskin-button-bg`, `--agentskin-input-bg` |
| `assets/css/<agent>.css`（生成物） | 14 完整 + 辅助 | 全部 14 个 + text-shadow | `-raw` 派生（引用 palette.css 的） |

**设计意图**：button-bg 和 input-bg 在 agent CSS 层从 accent/surface 通过 color-mix() 派生，保持与 accent 的动态关联；palette.css 仅承载"原子色"。

---

## 2. 当前变量层级模型

```
┌─────────────────────────────────────────────────────────────────┐
│                    Layer 0: Base Palette                        │
│  manifest.json colors → build-palette.mjs → palette.css         │
│  12 个核心 --agentskin-* 变量 + 9 个 -raw RGB 派生              │
└────────────────────────────┬────────────────────────────────────┘
                             │ buildContext() 读取
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                 Layer 1: Semantic Context                       │
│  buildContext() 产出 { id, name, mode, isLight, signature,      │
│  colors } 对象 → 传入每个生成器                                  │
└────────────────────────────┬────────────────────────────────────┘
                             │ tokenBlock(t) 调用
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              Layer 2: Agent-Native Token Mapping                │
│  每个生成器（6个）产出:                                          │
│  ┌─────────────┐ ┌──────────────┐ ┌──────────────────────────┐ │
│  │ traework:   │ │ qoderwork:   │ │ workbuddy:               │ │
│  │ --vscode-*  │ │ --color-*    │ │ --cb-*                   │ │
│  │ --vscode-   │ │ (antd)       │ │ (腾讯体系)                │ │
│  │  icube-*    │ │              │ │                          │ │
│  └─────────────┘ └──────────────┘ └──────────────────────────┘ │
│  ┌─────────────┐ ┌──────────────┐ ┌──────────────────────────┐ │
│  │ doubao:     │ │ codex:       │ │ zcode:                   │ │
│  │ --dbx-*     │ │ --color-     │ │ --color-*                │ │
│  │ (251-token) ││  token-*     │ │ (Tailwind v4)            │ │
│  └─────────────┘ └──────────────┘ └──────────────────────────┘ │
└────────────────────────────┬────────────────────────────────────┘
                             │ 生成器内联结构化 CSS
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│            Layer 3: Structural / Component Layer                │
│  artLayerCss() + sharedChromeRules() + shellStructureCss()     │
│  shellTokenOverrides() / codexColorTokenOverrides() /          │
│  zcodeColorTokenOverrides() + auroraGlassSignature()           │
│  (hero 背景、毛玻璃侧栏、按钮渐变、滚动条、选区、焦点等)          │
└─────────────────────────────────────────────────────────────────┘
```

**CSS 注入分层（L0-L4 运行时层）**：

| 注入层 | 内容 | 来源 |
|--------|------|------|
| L0 | palette.css：14 个 --agentskin-* 语义 token | build-palette.mjs 生成 |
| L1 | tokens.css：目标应用原生 token → var() 映射 | engines/<agent>/tokens.css |
| L2 | cosmetic.css：主题无关视觉打磨 | engines/<agent>/cosmetic.css |
| L3 | theme.css：主题特定 CSS | 主题包 assets/css/<agent>.css |
| L4 | adapter.mjs：JS 结构定位 + 自愈 | engines/<agent>/adapter.mjs |

---

## 3. 派生关系图

```
manifest.json colors
│
├── accent ─────────────────────────────────────────────────────┐
│   ├──→ --agentskin-accent (direct)                           │
│   ├──→ --agentskin-accent-raw (toRgbTriple)                  │
│   ├──→ --agentskin-selection = alpha(accent, 0.32)           │
│   ├──→ --agentskin-button-bg = accent (direct in tokenBlock) │
│   ├──→ --agentskin-focus-ring (direct from manifest)         │
│   ├──→ --agentskin-input-bg = color-mix(srgb,               │
│   │       color-mix(srgb, surface 82%, accent 18%) 45%,     │
│   │       transparent)                                       │
│   ├──→ border (when not provided, fallback to accent)        │
│   └──→ 各 agent 原生 token 的 alpha 变体:                    │
│       ├── traework: --vscode-focusBorder = alpha(accent,.6)  │
│       ├── qoderwork: --color-primary = accent                │
│       ├── workbuddy: --cb-vscode-button-background = accent  │
│       ├── doubao: --dbx-fill-* = accent based                │
│       ├── codex: --color-token-primary = accent              │
│       └── zcode: --color-accent = accent                     │
│                                                               │
├── secondary ──────────────────────────────────────────────────┤
│   ├──→ --agentskin-secondary (direct)                        │
│   ├──→ --agentskin-secondary-raw (toRgbTriple)               │
│   └──→ 光晕色 (glowColor): 当 secondary 饱和度 > 0.3 且      │
│       与 accent 不同色相时使用 secondary，否则回退 accent      │
│                                                               │
├── background ─────────────────────────────────────────────────┐
│   ├──→ --agentskin-bg (direct)                               │
│   ├──→ --agentskin-bg-raw (toRgbTriple)                      │
│   ├──→ buttonPrimaryFg = isLight '#fff' :                    │
│   │       shade(background, 'black', 0.85)                   │
│   └──→ 背景 wash 不透明度由 luminance(bg) 决定:               │
│       ├── bgLum < 0.012: washLeft=26, washMid=8, washBottom=20│
│       ├── bgLum < 0.03:  washLeft=32, washMid=12, washBottom=26│
│       ├── 暗色默认:      washLeft=38, washMid=14, washBottom=32│
│       └── 亮色:          washLeft=42, washMid=14, washBottom=38│
│                                                               │
├── foreground ─────────────────────────────────────────────────┐
│   ├──→ --agentskin-text (direct)                             │
│   ├──→ --agentskin-text-raw (toRgbTriple)                    │
│   ├──→ mutedFg 计算系数: alpha(foreground, .42) → disabled  │
│   └──→ buttonSecondaryFg = foreground (direct)               │
│                                                               │
├── surface ───────────────────────────────────────────────────┤
│   ├──→ --agentskin-surface (direct)                          │
│   ├──→ --agentskin-surface-raw (toRgbTriple)                 │
│   ├──→ inputMix = color-mix(srgb,                            │
│   │       color-mix(srgb, surface 82%, accent 18%) 45%,     │
│   │       transparent)                                       │
│   ├──→ sidebarMix = color-mix(srgb,                          │
│   │       color-mix(srgb, surface 82%, accent 18%) 22%,     │
│   │       transparent)                                       │
│   └──→ 各 agent 表面透明渐变 (color-mix %, transparent)       │
│                                                               │
├── surfaceElevated ───────────────────────────────────────────┤
│   ├──→ --agentskin-surface-elevated (direct)                 │
│   └──→ popoverBg = color-mix(srgb, surfaceElevated 94%,     │
│       transparent)                                            │
│                                                               │
├── border ─────────────────────────────────────────────────────┐
│   ├──→ --agentskin-border (direct)                           │
│   └──→ --agentskin-border-raw (toRgbTriple)                  │
│                                                               │
├── muted ──────────────────────────────────────────────────────┤
│   ├──→ --agentskin-muted (direct)                            │
│   └──→ --agentskin-muted-raw (toRgbTriple)                   │
│                                                               │
├── codeBackground ─────────────────────────────────────────────┐
│   └──→ --agentskin-code-bg (direct, fallback: background)    │
│                                                               │
├── codeForeground ─────────────────────────────────────────────┐
│   └──→ --agentskin-code-fg (direct, fallback: foreground)    │
│                                                               │
├── inputBackground ───────────────────────────────────────────┘
│   └──→ --agentskin-input-bg (direct, but agent CSS overrides
│       with color-mix derivation)
│
├── buttonBackground
│   └──→ --agentskin-button-bg (direct in tokenBlock)
│
├── buttonForeground
│   └──→ --agentskin-button-fg (used by some agents)
│
└── focusRing
    └──→ --agentskin-focus-ring (direct)
```

**关键派生函数**：

| 函数 | 位置 | 作用 |
|------|------|------|
| `parseColor(input)` | theme-utils.mjs | 将 HEX/HEXA/RGBA 解析为 {r,g,b,a} |
| `alpha(input, a)` | theme-utils.mjs | 颜色 × alpha 乘算 → rgba() |
| `shade(input, target, a)` | theme-utils.mjs | 向白/黑混合 → 提亮/暗化 |
| `rawRgb(input)` | theme-utils.mjs | → "R, G, B" 供 rgba(var, alpha) 模式 |
| `toRgbTriple(input)` | build-palette.mjs | 同上，用于 palette.css 的 -raw 派生 |
| `luminance(input)` | theme-utils.mjs | 相对亮度 0-1（决定 wash 强度） |
| `saturation(input)` | theme-utils.mjs | HSL 饱和度 0-1（决定 glow 强度） |
| `computeArtParams(t)` | theme-utils.mjs | 根据 bg 亮度和 accent 饱和度计算叠加层参数 |
| `buildContext(id, manifest, scheme)` | theme-utils.mjs | manifest → 生成器上下文对象 |

---

## 4. 主题元数据结构（Manifest Schema）

### 4.1 核心字段

```typescript
interface ThemeManifest {
  // === 必需 ===
  id: string;                  // ^[a-z0-9][a-z0-9_-]*$
  name: string;                // 1-64 字符
  version: string;             // semver
  icon: string;                // 文件名（不含路径分隔符）
  preview: string;             // 文件名
  colors: {
    background: string;        // 必需
    foreground: string;        // 必需
    accent?: string;
    secondary?: string;
    muted?: string;
    surface?: string;
    surfaceElevated?: string;
    border?: string;
    codeBackground?: string;
    codeForeground?: string;
    inputBackground?: string;
    buttonBackground?: string;
    buttonForeground?: string;
    focusRing?: string;
    extended?: Record<string, string>;       // v2.2+ 扩展色集
    inference?: Record<string, 'provided' | 'derived' | 'default'>; // v2.2+
  };

  // === 运行时生成（不手写）===
  generated?: { generatorVersion, appVersion, generatedAt };
  depth?: 'L1' | 'L2' | 'L3';

  // === 推荐 ===
  schemaVersion?: 1 | 2 | 3;  // 固定 2
  displayName?: string;        // 本地化显示名
  description?: string;        // ≤500 字符
  mode?: 'dark' | 'light' | 'auto';
  hero?: string;
  author?: { name: string; url?: string };
  category?: string;
  tags?: string[];             // ≤10
  license?: string;
  targets?: Record<AgentId, { css: string; verification?: {...} }>;
  supportedAgents?: AgentId[];

  // === v2.1 可选 ===
  dynamic?: 'aurora' | 'particles' | 'gradient' | 'waves' | false;
  wallpaper?: { workshopId? } | { video: string; ... };
  fonts?: Array<{ family, src, weight?, style?, preload? }>;  // ≤5
  minAppVersion?: string;
  homepage?: string;
  repository?: string;
  colorSchemes?: string[];     // ≤20，配色方案 id 列表

  // === v2.2/v2.5 前瞻字段 ===
  designLanguage?: string;     // v2.5 设计语言 id
  componentVariations?: Record<string, { path, name?, default? }>;  // v2.5
  palettes?: Record<string, string>;  // v2.5 多调色板
  cosmetics?: string[];        // v2.5 可选润色模块
  depends?: { engine?: string; fonts?: string[] };  // v2.5
  signature?: string;          // 例："aurora-glass" → 启用签名层

  // === 运行时扩展 ===
  assets?: { background?, images?: Record<string, string> };
  decorations?: { layouts?: Array<{asset, anchor, anchorPosition?, offset?, width?, height?, zIndex?, motion?, flash?}> };
  probe?: { tokenNamespaces?: string[]; styleContract?: string };
  art?: boolean;               // 默认 true；false = 纯 CSS flat 主题
}
```

### 4.2 additionalProperties 约束

`colors` 和 manifest 顶层均为 `additionalProperties: false`，意味着：
- `colors` 中只允许 schema 定义的顶级字段（包括 `extended` 和 `inference` 两个扩展用 object）
- manifest 顶层不允许任意添加字段（设计严谨，防止拼写错误静默失效）

---

## 5. deriveTokens() 派生逻辑（buildContext + tokenBlock）

AgentSkin 没有单独的 deriveTokens() 函数，派生逻辑分布在两个阶段：

### 5.1 阶段一：buildContext() — manifest → 生成器上下文

```
输入: (id, manifest, scheme|null)
  ↓
1. 选择颜色源：scheme.colors ?? manifest.colors
  ↓
2. 强制校验：background + foreground 必须存在，否则 throw
  ↓
3. 遍历 COLOR_KEYS（14 个 key），逐个 validate：
   - 值存在且 parseColor 成功 → 使用原值
   - 否则 → 使用 COLOR_FALLBACKS[key]
  ↓
4. 确定 mode：(scheme?.mode ?? manifest.mode) === 'light' ? 'light' : 'dark'
   （auto → dark，暗色画布优先）
  ↓
输出: {
  id, name, mode, isLight,
  signature: manifest.signature ?? null,
  colors: { 14 个经过 fallback 的 color value }
}
```

### 5.2 阶段二：tokenBlock(t) — 生成器上下文 → CSS 变量声明

```
输入: t (context), host (选择器，默认 ':root')
  ↓
直接映射 12 个核心 token 到 --agentskin-*
  ↓
派生 2 个计算型 token:
  - --agentskin-input-bg = color-mix(srgb, color-mix(srgb, surface 82%, accent 18%) 45%, transparent)
  - --agentskin-button-bg = accent (direct)
  ↓
派生 2 个语义 token:
  - --agentskin-selection = alpha(accent, 0.32)
  - --agentskin-text-shadow = isLight ? light-shadow : dark-shadow
  ↓
输出: 完整 :root { ... } 声明块（14 个契约 token 齐全）
```

### 5.3 兜底机制

| 缺失场景 | 行为 |
|---------|------|
| background 或 foreground 缺失 | buildContext() 抛出错误（硬性拒绝） |
| 其他 12 个 color 任一缺失/格式错误 | 使用 COLOR_FALLBACKS 默认值（暗色系），并打印 console.warn |
| border 缺失 | buildPaletteCss 中 fallback 到 accent |
| codeBackground 缺失 | fallback 到 background |
| codeForeground 缺失 | fallback 到 foreground |
| focusRing 缺失 | fallback 到 color-mix(accent 40%, transparent) |
| selection 缺失 | fallback 到 color-mix(accent 32%, transparent) |

---

## 6. tokenBlock() 的 CSS 生成逻辑

```javascript
export function tokenBlock(t, host = ':root') {
  const c = t.colors;
  return `${host} {
  color-scheme: ${t.isLight ? 'light' : 'dark'} !important;
  --agentskin-accent: ${c.accent};
  --agentskin-secondary: ${c.secondary};
  --agentskin-bg: ${c.background};
  --agentskin-surface: ${c.surface};
  --agentskin-surface-elevated: ${c.surfaceElevated};
  --agentskin-text: ${c.foreground};
  --agentskin-muted: ${c.muted};
  --agentskin-border: ${c.border};
  --agentskin-code-bg: ${c.codeBackground};
  --agentskin-code-fg: ${c.codeForeground};
  --agentskin-input-bg: color-mix(in srgb, color-mix(in srgb, ${c.surface} 82%, ${c.accent} 18%) 45%, transparent);
  --agentskin-button-bg: ${c.accent};
  --agentskin-focus-ring: ${c.focusRing};
  --agentskin-selection: ${alpha(c.accent, 0.32)};
  --agentskin-text-shadow: ${t.isLight ? '0 1px 2px rgba(255,255,255,0.6)' : '0 1px 3px rgba(0,0,0,0.5)'};
  text-shadow: var(--agentskin-text-shadow);
}`;
}
```

**关键设计点**：
1. 使用 color-scheme 声明让浏览器原生控件（滚动条、表单）跟随主题
2. text-shadow 直接应用在 :root 上（全局文字阴影提升毛玻璃上文字可读性）
3. input-bg 使用双层 color-mix 创建半透明"玻璃"质感（surface+accent 混色后 45% 不透明度）
4. 所有值通过 c.xxx 引用已经过 buildContext 兜底处理的颜色

---

## 7. 扩展点与预留机制

### 7.1 已消费的扩展点

| 扩展点 | 机制 | 状态 |
|--------|------|------|
| manifest.signature | 可选 aurora-glass → auroraGlassSignature() 追加签名层 | 已实现 |
| manifest.colorSchemes | 配色方案变体（polar, magma 等），每方案独立生成 CSS 子目录 | 已实现 |
| manifest.dynamic | 主题分类标签（aurora/particles/gradient/waves） | 仅分类，P2 才消费 |
| colors.extended | Catppuccin 风格 26 色扩展色集 | P1 存储，P2/P3 生成器消费 |
| colors.inference | 色值推导来源标记（provided/derived/default） | 已定义，可追溯可审计 |

### 7.2 Schema 已定义但未消费的 v2.5 字段

| 字段 | 说明 | 消费状态 |
|------|------|---------|
| designLanguage | 设计语言 id，用于 Theme Studio 识别同语言变体 | 未消费 |
| componentVariations | 组件形态变体（圆角/字体/阴影/间距/材质） | 未消费 |
| palettes | 多调色板映射表 | 未消费 |
| cosmetics | 可选润色模块（滚动条/选区/光标等） | 未消费 |
| depends | 引擎最低版本 + 依赖字体 | 未消费 |

### 7.3 预留机制总结

1. **Aurora Glass 签名模式**：通过 manifest.signature 声明，generate-theme-css.mjs 在生成 CSS 后追加签名层 — 此模式可复用于未来其他签名风格
2. **colors.extended 扩展色集**：以 Record<string, string> 存储，不限制 key 命名 — 生成器可按需消费子集
3. **Formula 注入点**：tokenBlock() 中的 color-mix 公式是硬编码的，未来可改为从 manifest 或 generator config 读取参数
4. **原生缺陷修正注册表**：native-defect-fixes.mjs 集中管理硬编码缺陷修正，生成器通过 nativeDefectFixCss() 自动拼接 — 新增缺陷无需修改主题

---

## 8. 当前体系的强项

### 8.1 架构层面

1. **单一事实源**：manifest.json colors 是唯一输入，所有 6 个 agent CSS 自动生成，杜绝手动编辑导致的不一致
2. **严格门禁**：check-themes.mjs 校验全部 14 token 存在 + color-scheme 一致性，CI/husky 强制卡点
3. **分层注入**：L0-L4 清晰分离（palette → tokens → cosmetic → theme → JS adapter），各层职责明确
4. **多 agent namespace 隔离**：每个 agent 独立 token 系统（--vscode-* / --color-* / --cb-* / --dbx-* / --color-token-*），互不影响
5. **Schema 版本兼容**：v1/v2/v3 schemaVersion 枚举支持渐进迁移，旧客户端忽略未知字段

### 8.2 工程层面

6. **纯函数生成器**：theme-utils.mjs 全部为纯函数（color in, CSS string out），可独立测试、复用
7. **颜色解析鲁棒性**：parseColor 支持 HEX/HEXA/RGBA，tryParseColor 兜底防护
8. **确定性输出**：--verify 模式可验证生成物是否过期，保证 CI 可重复
9. **派生可观测**：computeArtParams() 基于物理亮度/饱和度计算叠加层参数，避免主观调参
10. **SPDX 头一致性**：所有脚本和源代码强制 MPL-2.0 许可证头

### 8.3 扩展性层面

11. **签名层机制**：aurora-glass 模式证明可在不修改核心生成器的前提下添加可选视觉增强
12. **配色方案系统**：colorSchemes 支持同一主题的多种配色变体（独立目录结构）
13. **decorations 声明式布局**：manifest 可声明素材锚定于稳定表面（2b RFC）
14. **资源预算控制**：MAX_THEME_IMAGES=32, 8MB 累积 base64 上限，防止资源滥用

---

## 9. 当前体系的不足

### 9.1 结构性缺失

1. **无 spacing token 体系**：gap-3.5 (14px)、py-[22px] 等间距值直接硬编码在 Tailwind 类中，主题无法控制间距密度。Swiss 设计系统推崇的 4/8/16/24/32/48 递进序列未能通过 token 表达。
2. **无 typography token 在主题契约中**：--font-display / --font-ui / --font-mono 在 globals.css 定义，但主题无法通过 manifest 自定义字体。字号阶梯（44/22/13/12/11/10/9.5/8.5px）同样是 CSS 硬编码。
3. **无 radius/shadow token 在主题契约中**：--radius: 2px 和 shadow-* 系列定义于 globals.css，主题无法控制圆角大小和阴影风格。Swiss 风格的 rounded-[2px] 无法通过主题切换。
4. **无 motion token 在主题契约中**：--duration-* 系列硬编码，主题无法控制动画节奏。

### 9.2 派生逻辑的脆弱性

5. **color-mix() 公式硬编码**：tokenBlock()、shellTokenOverrides()、各生成器中重复出现相同的 color-mix(in srgb, color-mix(in srgb, surface 82%, accent 18%) 45%, transparent) 公式 — 调整一个参数需同步修改 6+ 处。
6. **hover/active/disabled 状态系数散落**：alpha(c.accent, 0.12) / alpha(c.accent, 0.18) 等状态变化系数硬编码在各生成器内，缺乏统一状态层。
7. **glow/wash 计算仅用于 art layer**：computeArtParams() 根据亮度和饱和度计算叠加层强度，但这些计算结果未暴露为 token — 组件无法消费"主题对比度"信息。

### 9.3 验证盲区

8. **无 WCAG 对比度校验**：check-themes.mjs 只检查 token 是否存在，不检查 foreground/background 对比度是否满足 WCAG AA/AAA。
9. **无语义一致性校验**：不校验 accent 是否真与 secondary 互补、text 是否真与 bg 有足够反差。
10. **无跨 agent 语义等价性验证**：不保证同一主题在 6 个 agent 上的感知一致性。

### 9.4 文档与实现的分裂

11. **docs/THEME_SPEC.md vs themes/THEME_SPEC.md 双份并存**：前者为向后兼容保留（2026-08-07），后者为权威。可能造成混淆。
12. **design-tokens.md 第 10 节已知问题**：--cr-brand-violet 命名与值不符（名为紫实为红）、light 下 --brand-red 未覆盖等问题已知但未修复。
13. **v2.5 schema 字段大量预留**：designLanguage、componentVariations、palettes、cosmetics、depends 在 schema 中定义但生成器完全不消费 — 新用户可能误以为填写有效。

---

## 10. 可扩展方向与约束边界

### 10.1 可扩展方向

| 方向 | 描述 | 侵入性 | 优先级 |
|------|------|--------|--------|
| Extended colors 消费 | colors.extended 26 色由 GENERATORS 消费 → 生成 per-agent --agentskin-ext-* 变量 | 低：纯生成器扩展 | P2 |
| 状态系数 Token 化 | 将 alpha(accent, .12) 等 hover/active 系数提取为 manifest 可配字段 | 中：需修改 tokenBlock + 各生成器 | P2 |
| morphology/radius token | 增加 --agentskin-radius / --agentskin-shadow-float 等可控 token | 中：需 tokenBlock 扩展 | P2 |
| spacing token 注入 | 增加 --agentskin-space-* 4/8/16/24/32/48 序列 | 高：需改 CSS 生成 | P3 |
| 字体 token | 增加 --agentskin-font-* manifest 字段 | 高：需重构字体系统 | P3 |
| WCAG 校验 | check-themes.mjs 增加对比度校验门禁 | 低：纯校验扩展 | P1 |
| 公式参数化 | color-mix 公式系数从 manifest 读取 | 中：需约定字段格式 | P2 |
| 统一定义 deriveTokens() | 将分散的派生逻辑集中为可测试的纯函数 | 中：重构，需全 agent 回归 | P1 |
| componentVariations 消费 | v2.5 组件形态变体由生成器消费 | 中：需约定 variants JSON 格式 | P3 |
| 多调色板切换 | v2.5 palettes 字段由生成器/运行时消费 | 中：需理解与 colorSchemes 的关系 | P3 |

### 10.2 约束边界（不可逾越）

| 约束 | 来源 | 含义 |
|------|------|------|
| **C2 不变量：14-token 契约** | check-themes.mjs + AGENTS.md | 每个 agent CSS 必须声明且仅声明这 14 个 token，不可增删 |
| **Schema additionalProperties: false** | manifest-v2.schema.json | 不允许 manifest 中出现 schema 未声明的顶层字段和 colors 子字段 |
| **RFC 触发条件** | AGENTS.md 第 5/6 条 | 注入架构重构、新增 UI 页面、新增适配器、修改核心数据模型需 RFC |
| **禁止新增适配器** | AGENTS.md 黄金规则 1 | 除非用户基数大且无原生主题能力 |
| **禁止间距散值** | AGENTS.md 黄金规则 6 | 间距必须使用 Tailwind 标准档位 |
| **npm run check 全绿才 push** | AGENTS.md 黄金规则 7 | 所有校验脚本必须通过 |
| **注入执行层禁止 import 语义量化层** | check-semantic-contract.mjs | runtime/ 不得引用 semantic-quant/ |
| **check-themes 双组契约分离** | PALETTE_TOKENS vs REQUIRED_TOKENS | palette.css 不要求 button-bg/input-bg；agent CSS 不要求 -raw 派生（引用 palette 的即可） |
| **palette.css 唯一生成入口** | build-palette.mjs | 主题作者不应手动编辑 palette.css |
| **agent CSS 唯一生成入口** | generate-theme-css.mjs | 主题作者不应手动编辑 assets/css/<agent>.css |

### 10.3 推荐的扩展路径

**最小侵入路径（P1，不触碰契约）**：
1. 增加 deriveTokens() 纯函数，集中管理所有派生逻辑
2. 增加 WCAG 对比度校验（check-themes.mjs 新增检查项）
3. 消费 colors.extended 存储字段（纯生成器扩展，不改 manifest 校验）
4. 实现 v2.5 componentVariations 消费（schema 已定义，生成器扩展）

**中等侵入路径（P2，扩展契约但向后兼容）**：
5. manifest 增加可选 morphology 字段（radius/shadow/spacing），生成器消费，缺失时使用当前默认值
6. 状态系数 token 化：manifest 增加可选 states 字段（hover/active/disabled 系数），生成器消费
7. 公式参数化：将 color-mix 系数抽为 manifest 可配或 generator config

**高侵入路径（P3，需 RFC）**：
8. 将 14-token 扩展为 N-token（如 +radius +shadow +spacing +font），需 RFC + schema 升级
9. 主题运行时动态切换 morphology（需 Studio 适配 + runtime 注入机制）

---

## 附录：关键文件路径索引

| 文件 | 作用 |
|------|------|
| `docs/THEME_SPEC.md` | 主题包规范 v2.1（向后兼容保留） |
| `themes/THEME_SPEC.md` | 主题规范 v2.1.0 重写版（权威，对齐实际流水线） |
| `docs/ARCHITECTURE.md` | 架构总览（活文档） |
| `docs/design-tokens.md` | Swiss/International 设计 token 文档 v1.0 |
| `src/main/catalog/manifest-v2.schema.json` | 权威 JSON Schema（逐字节同步到 docs/） |
| `scripts/build-palette.mjs` | manifest colors → palette.css 生成器 |
| `scripts/generate-theme-css.mjs` | 读取 manifest → 调用 GENERATORS → 写入 agent CSS |
| `scripts/theme-generators.mjs` | 门面模块，聚合 6 个生成器 + re-export buildContext |
| `scripts/theme-utils.mjs` | 纯函数库（parseColor/alpha/shade/tokenBlock/artLayerCss/buildContext 等） |
| `scripts/check-themes.mjs` | CI/husky 门禁（14 token 存在性 + color-scheme 一致性） |
| `scripts/generators/traeworkCss.mjs` | TRAE Work 端到端生成器（最详细的参考范本） |
| `scripts/generators/qoderworkCss.mjs` | QoderWork 生成器 |
| `scripts/generators/workbuddyCss.mjs` | WorkBuddy 生成器 |
| `scripts/generators/doubaoCss.mjs` | 豆包生成器 |
| `scripts/generators/codexCss.mjs` | Codex 生成器 |
| `scripts/generators/zcodeCss.mjs` | ZCode 生成器 |
| `src/shared/types/theme.ts` | TypeScript 主题类型定义（ThemeManifest / InstalledTheme / ThemeColorsFromImage 等） |
| `src/shared/theme-mapping.ts` | manifest 语义名 ↔ --agentskin-* token 双向映射 |
| `src/shared/theme-id.ts` | Theme ID 安全校验（SAFE_ID_REGEX） |
| `themes/aurora-glass/manifest.json` | 参考 manifest 范本（含 signature/colorSchemes） |

---

*本分析基于 2026-08-21 代码状态，涵盖 docs/、scripts/、src/shared/types/、themes/ 的实际代码证据。*
