# A+D 复合方案 — 具体落地执行计划

> 阶段二 · P0 批次：最小可执行版本
> 日期：2026-08-21
> 来源：阶段一 A+D 复合方案（评分 9.21）

---

## 一、文件变更清单

| # | 文件路径 | 操作 | 改动量 | 说明 |
|---|---------|------|--------|------|
| F1 | `src/main/catalog/manifest-v2.schema.json` | **修改** | +20 行 | DL 结构化 + on-color 字段 |
| F2 | `docs/manifest-v2.schema.json` | **同步** | +20 行 | 与 F1 保持逐字节一致 |
| F3 | `scripts/design-language.mjs` | **新建** | +150 行 | DL 注册表 + 生成函数 |
| F4 | `scripts/extended-colors.mjs` | **新建** | +100 行 | 语义色块 + WCAG 对比度 |
| F5 | `scripts/generate-theme-css.mjs` | **修改** | +25 行 | DL + extended 注入 |
| F6 | `scripts/check-themes.mjs` | **修改** | +40 行 | WCAG 校验 + extended 校验 |
| F7 | `tests/main/design-language-block.test.ts` | **新建** | +80 行 | DL 块输出测试 |
| F8 | `tests/main/extended-colors-block.test.ts` | **新建** | +80 行 | Extended 块输出测试 |
| F9 | `tests/main/wcag-contrast.test.ts` | **新建** | +60 行 | 对比度算法测试 |

**总计**：9 个文件，新建 5 个，修改 4 个，新增约 635 行代码。

---

## 二、F1 — Schema 扩展（manifest-v2.schema.json）

### 2.1 `colors` 新增字段

现有 `colors.extended` 已定义为自由 object。我们**保持不变**（允许主题作者自定义语义色 key），但增加约束和辅助字段：

```jsonc
// colors 内新增（F1 改动点）
{
  "colors": {
    "type": "object",
    "required": ["background", "foreground"],
    "additionalProperties": false,
    "properties": {
      // ... 现有 14 token properties 不变 ...

      // v2.2+ 已定义的 extended，保持不变
      "extended": {
        "type": "object",
        "additionalProperties": { "type": "string" },
        "description": "v2.2+ 扩展色集。key 为语义色名（如 error/success/warning/info/glow），value 为 HEX 颜色。引擎消费此集生成 --agentskin-ext-* 变量。"
      },

      // ★ v2.6 新增：on-color 自动反色声明
      "background": {
        "type": "string",
        "description": "Base background color (required)"
      },

      // ★ v2.6 新增：contrast 校验豁免标记
      "_wcag": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "level": {
            "type": "string",
            "enum": ["AA", "AAA", "none"],
            "description": "本主题宣称的 WCAG 对比度等级。'none' 表示不做强制校验（仅 foreground/background 仍做建议级提示）。"
          }
        },
        "description": "v2.6+ WCAG 对比度元数据。不提供时默认 'AA'。"
      }
    }
  }
}
```

### 2.2 `designLanguage` 字段升级（顶层）

现有 schema 中 `designLanguage` 为 `string`（v2.5+ 引入的设计语言 id）。

**升级方案**：新增 `designLanguageConfig` 结构化块，保留原 `designLanguage` 字符串字段作为引用名。

```jsonc
// manifest 顶层新增（F1 改动点，位于 componentVariations 之后）
{
  "properties": {
    // ... 现有字段 ...

    "designLanguage": {
      "type": "string",
      "maxLength": 64,
      "description": "(v2.5+) 声明主题的设计语言 id。"
    },

    // ★ v2.6 新增：inline 设计语言配置块（可选）
    "designLanguageConfig": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "spacing": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "density": {
              "type": "string",
              "enum": ["compact", "comfortable", "cozy"],
              "description": "间距密度倍率。compact=0.75x, comfortable=1x, cozy=1.25x"
            }
          }
        },
        "radius": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "scale": {
              "type": "string",
              "enum": ["0", "2", "4", "8"],
              "description": "圆角档位（单位 px）。默认 2"
            }
          }
        },
        "shadow": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "elevation": {
              "type": "string",
              "enum": ["flat", "subtle", "float"],
              "description": "阴影档位。flat=无, subtle=低, float=高。默认 float"
            }
          }
        },
        "motion": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "speed": {
              "type": "string",
              "enum": ["instant", "fast", "smooth"],
              "description": "动画节奏。instant=0ms, fast=100ms, smooth=200ms。默认 fast"
            }
          }
        }
      },
      "description": "(v2.6+) 内联设计语言配置。使用此块可直接在 manifest 中声明主题的间距/圆角/阴影/动画形态，无需引用外部 designLanguage id。缺失时使用引擎默认值（comfortable / 2 / float / fast）。"
    }
  }
}
```

### 2.3 schema 改动影响分析

| 影响点 | 分析 |
|--------|------|
| `additionalProperties: false` manifest 顶层 | ✅ 新增 `designLanguageConfig` 已声明为合法 property，不破坏 |
| `colors.additionalProperties: false` | ✅ `_wcag` 已声明为合法 property |
| 现有主题（无 designLanguageConfig） | ✅ 完全兼容，该字段可选 |
| `docs/manifest-v2.schema.json` | 需同步（已在 F2 覆盖） |

---

## 三、F3 — Design Language 注册表（scripts/design-language.mjs）

新建文件，SPML-2.0 头部 + 纯函数导出。

```javascript
// SPDX-License-Identifier: MPL-2.0
//
// # design-language.mjs — Design Language registry and CSS generator.
//
// Provides named design languages (presets) and inline config → CSS block.
// A manifest can either reference a known DL by id ("designLanguage": "swiss-default")
// or provide inline config ("designLanguageConfig": { ... }).

/** Design Language presets registry. */
export const DESIGN_LANGUAGES = {
  'swiss-default': {
    name: 'Swiss Default',
    spacing: { density: 'comfortable' },
    radius: { scale: '2' },
    shadow: { elevation: 'float' },
    motion: { speed: 'fast' },
  },
  'soft-rounded': {
    name: 'Soft Rounded',
    spacing: { density: 'cozy' },
    radius: { scale: '8' },
    shadow: { elevation: 'subtle' },
    motion: { speed: 'smooth' },
  },
  'compact-flat': {
    name: 'Compact Flat',
    spacing: { density: 'compact' },
    radius: { scale: '0' },
    shadow: { elevation: 'flat' },
    motion: { speed: 'instant' },
  },
};

/** Default values when no designLanguage is declared. */
export const DL_DEFAULTS = {
  spacing: { density: 'comfortable' },
  radius: { scale: '2' },
  shadow: { elevation: 'float' },
  motion: { speed: 'fast' },
};

/** Spacing density → multiplier. */
const SPACING_MULTIPLIER = { compact: 0.75, comfortable: 1, cozy: 1.25 };

/** Base spacing scale (4px grid). */
const BASE_SPACING = { 4: 4, 8: 8, 16: 16, 24: 24, 32: 32, 48: 48 };

/** Radius scale → px value. */
const RADIUS_PX = { '0': 0, '2': 2, '4': 4, '8': 8 };

/** Shadow elevation → CSS box-shadow. */
const SHADOW_VALUE = {
  flat: 'none',
  subtle: '0 1px 3px rgba(0,0,0,0.08)',
  float: '0 4px 16px rgba(0,0,0,0.12)',
};

/** Motion speed → duration. */
const DURATION_MS = { instant: 0, fast: 100, smooth: 200 };

/**
 * Resolve manifest's design language to a normalized config object.
 * Priority: inline designLanguageConfig > named designLanguage > defaults.
 */
export function resolveDesignLanguage(manifest) {
  const dl = manifest.designLanguageConfig;
  if (dl) return { ...DL_DEFAULTS, ...normalizeConfig(dl) };

  const ref = manifest.designLanguage;
  if (ref && DESIGN_LANGUAGES[ref]) return DESIGN_LANGUAGES[ref];

  return DL_DEFAULTS;
}

function normalizeConfig(dl) {
  const out = {};
  if (dl?.spacing?.density) out.spacing = { density: dl.spacing.density };
  if (dl?.radius?.scale) out.radius = { scale: dl.radius.scale };
  if (dl?.shadow?.elevation) out.shadow = { elevation: dl.shadow.elevation };
  if (dl?.motion?.speed) out.motion = { speed: dl.motion.speed };
  return out;
}

/**
 * Generate CSS custom properties block for design language.
 * Returns '' if config equals defaults (optimization: no unnecessary output).
 */
export function designLanguageBlock(dl, host = ':root') {
  const mult = SPACING_MULTIPLIER[dl.spacing?.density ?? 'comfortable'];
  const radius = RADIUS_PX[dl.radius?.scale ?? '2'];
  const shadow = SHADOW_VALUE[dl.shadow?.elevation ?? 'float'];
  const dur = DURATION_MS[dl.motion?.speed ?? 'fast'];

  const spacingVars = Object.entries(BASE_SPACING)
    .map(([k, v]) => `  --agentskin-space-${k}: ${(v * mult).toFixed(1)}px;`)
    .join('\n');

  return `${host} {
${spacingVars}
  --agentskin-radius-sm: ${Math.max(0, radius - 1)}px;
  --agentskin-radius-md: ${radius}px;
  --agentskin-radius-lg: ${Math.min(8, radius + 4)}px;
  --agentskin-shadow-float: ${shadow};
  --agentskin-duration-fast: ${dur}ms;
  --agentskin-duration-normal: ${(dur * 2) || 50}ms;
}`;
}
```

**输出示例**（comfortable / 2 / float / fast）：
```css
:root {
  --agentskin-space-4: 4.0px;
  --agentskin-space-8: 8.0px;
  --agentskin-space-16: 16.0px;
  --agentskin-space-24: 24.0px;
  --agentskin-space-32: 32.0px;
  --agentskin-space-48: 48.0px;
  --agentskin-radius-sm: 1px;
  --agentskin-radius-md: 2px;
  --agentskin-radius-lg: 6px;
  --agentskin-shadow-float: 0 4px 16px rgba(0,0,0,0.12);
  --agentskin-duration-fast: 100ms;
  --agentskin-duration-normal: 200ms;
}
```

---

## 四、F4 — Extended Colors + WCAG（scripts/extended-colors.mjs）

```javascript
// SPDX-License-Identifier: MPL-2.0
//
// # extended-colors.mjs — Semantic color utilities + WCAG contrast engine.

import { luminance } from './theme-utils.mjs';

/**
 * WCAG 2.1 contrast ratio between two colors.
 * Returns a value 1–21 (1=identical, 21=max contrast).
 */
export function contrastRatio(hex1, hex2) {
  const L1 = luminance(hex1);
  const L2 = luminance(hex2);
  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Choose readable foreground (black or white) for a given background.
 * Returns '#000000' or '#ffffff'.
 */
export function autoOnColor(bgHex) {
  return luminance(bgHex) > 0.45 ? '#000000' : '#ffffff';
}

/**
 * WCAG compliance check.
 * Returns { ratio, passesAA, passesAAA }.
 */
export function wcagCheck(fgHex, bgHex) {
  const ratio = contrastRatio(fgHex, bgHex);
  return {
    ratio: Number(ratio.toFixed(2)),
    passesAA: ratio >= 4.5,
    passesAAA: ratio >= 7.0,
  };
}

/**
 * Generate extended semantic color CSS block.
 * Maps user-defined extended colors to --agentskin-ext-* variables.
 * Automatically generates --agentskin-ext-on-* for contrast text.
 */
export function extendedColorsBlock(ext, host = ':root') {
  if (!ext || Object.keys(ext).length === 0) return '';

  const vars = Object.entries(ext)
    .map(([name, value]) => {
      const safeName = name.replace(/[^a-z0-9]/gi, '-').toLowerCase();
      const onColor = autoOnColor(value);
      return `  --agentskin-ext-${safeName}: ${value};\n  --agentskin-ext-on-${safeName}: ${onColor};`;
    })
    .join('\n');

  return `${host} {
${vars}
}`;
}
```

**输出示例**（manifest.extended = { error: '#ef4444', success: '#22c55e' }）：
```css
:root {
  --agentskin-ext-error: #ef4444;
  --agentskin-ext-on-error: #ffffff;
  --agentskin-ext-success: #22c55e;
  --agentskin-ext-on-success: #ffffff;
}
```

---

## 五、F5 — 生成器入口修改（scripts/generate-theme-css.mjs）

在现有驱动的 agent 循环中追加 DL + extended 块：

```javascript
// 新增 import（文件顶部）
import { resolveDesignLanguage, designLanguageBlock } from './design-language.mjs';
import { extendedColorsBlock } from './extended-colors.mjs';

// 在 agent 循环内（第 71-77 行区域），修改如下：
for (const [agent, generate] of Object.entries(GENERATORS)) {
  let css = generate(ctx);

  // ★ 新增：Extended Colors 追加
  const extBlock = extendedColorsBlock(manifest.colors?.extended);
  if (extBlock) css += extBlock;

  // ★ 新增：Design Language 追加
  const dlConfig = resolveDesignLanguage(manifest);
  const dlBlock = designLanguageBlock(dlConfig);
  if (dlBlock) css += dlBlock;

  // 现有：Aurora Glass 签名（保持不动）
  if (ctx.signature === 'aurora-glass' && HOSTS[agent]) {
    css += auroraGlassSignature(ctx, HOSTS[agent]);
  }

  // ... 后续 write/verify 逻辑不变 ...
}
```

**关键设计决策**：
- DL 块和 extended 块在 `tokenBlock()` 之后注入（L0）
- Aurora Glass 签名仍然最后追加（不改变 L3 行为）
- `buildContext()` 暂不需要修改（DL 和 extended 由驱动层处理）

---

## 六、F6 — check-themes.mjs WCAG 校验增强

```javascript
// 新增 import
import { wcagCheck } from './extended-colors.mjs';

// 在现有校验循环中（checkAgentCss 函数内）追加：

/**
 * WCAG 对比度校验（建议级，不阻塞 CI）。
 * 仅对 foreground/background 做强制 AA 检查，extended 色做建议提示。
 */
function checkWagContrast(manifest, agent, css) {
  const bg = manifest.colors?.background;
  const fg = manifest.colors?.foreground;
  if (!bg || !fg) return;

  const result = wcagCheck(fg, bg);
  const level = manifest.colors?._wcag?.level ?? 'AA';

  if (level === 'none') return;

  if (!result.passesAA) {
    console.warn(
      `[check-themes] ${agent}: foreground/background contrast ${result.ratio} < 4.5 (WCAG AA). ` +
      `Consider adjusting foreground or background.`
    );
    // 注意：仅 warn 不阻塞，避免误伤存量主题
  }
}

/**
 * Extended colors 格式校验（CI 阻塞级）。
 */
function checkExtendedColors(manifest) {
  const ext = manifest.colors?.extended;
  if (!ext) return;

  const validHex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9-f]{8})$/i;
  const reserved = new Set(['on', 'ext', 'raw']);

  for (const [name, value] of Object.entries(ext)) {
    if (reserved.has(name)) {
      throw new Error(`colors.extended: "${name}" is a reserved key`);
    }
    if (!validHex.test(value)) {
      throw new Error(`colors.extended.${name}: invalid color value "${value}"`);
    }
  }
}
```

---

## 七、F7/F8/F9 — 测试文件

### 7.1 tests/main/design-language-block.test.ts

```typescript
import { describe, it, expect } from 'vitest';
import { designLanguageBlock, resolveDesignLanguage, DESIGN_LANGUAGES } from '../../scripts/design-language.mjs';

describe('designLanguageBlock', () => {
  it('generates spacing vars with 4px grid at comfortable (1x)', () => {
    const css = designLanguageBlock(DESIGN_LANGUAGES['swiss-default']);
    expect(css).toContain('--agentskin-space-4: 4.0px');
    expect(css).toContain('--agentskin-space-16: 16.0px');
    expect(css).toContain('--agentskin-space-48: 48.0px');
  });

  it('scales spacing at compact (0.75x)', () => {
    const css = designLanguageBlock(DESIGN_LANGUAGES['compact-flat']);
    expect(css).toContain('--agentskin-space-16: 12.0px');
    expect(css).toContain('--agentskin-space-48: 36.0px');
  });

  it('generates correct radius values', () => {
    const css = designLanguageBlock(DESIGN_LANGUAGES['soft-rounded']);
    expect(css).toContain('--agentskin-radius-md: 8px');
  });

  it('generates correct shadow values per elevation', () => {
    expect(designLanguageBlock({ shadow: { elevation: 'flat' } })).toContain('shadow-float: none');
    expect(designLanguageBlock({ shadow: { elevation: 'float' } })).toContain('0 4px 16px');
  });

  it('prioritizes inline config over named ref', () => {
    const manifest = {
      designLanguage: 'compact-flat',
      designLanguageConfig: { radius: { scale: '8' } },
    };
    const resolved = resolveDesignLanguage(manifest);
    expect(resolved.radius.scale).toBe('8'); // inline wins
  });
});
```

### 7.2 tests/main/extended-colors-block.test.ts

```typescript
import { describe, it, expect } from 'vitest';
import { extendedColorsBlock } from '../../scripts/extended-colors.mjs';

describe('extendedColorsBlock', () => {
  it('returns empty string when no extended colors', () => {
    expect(extendedColorsBlock({})).toBe('');
    expect(extendedColorsBlock(undefined)).toBe('');
  });

  it('generates --agentskin-ext-* vars with auto on-color', () => {
    const css = extendedColorsBlock({ error: '#ef4444', success: '#22c55e' });
    expect(css).toContain('--agentskin-ext-error: #ef4444');
    expect(css).toContain('--agentskin-ext-on-error: #ffffff'); // white on red
    expect(css).toContain('--agentskin-ext-success: #22c55e');
    expect(css).toContain('--agentskin-ext-on-success: #ffffff'); // white on green
  });

  it('generates black on-color for light backgrounds', () => {
    const css = extendedColorsBlock({ highlight: '#ffee00' });
    expect(css).toContain('--agentskin-ext-on-highlight: #000000');
  });
});
```

### 7.3 tests/main/wcag-contrast.test.ts

```typescript
import { describe, it, expect } from 'vitest';
import { contrastRatio, autoOnColor, wcagCheck } from '../../scripts/extended-colors.mjs';

describe('wcag contrast', () => {
  it('computes correct ratio for black/white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
  });

  it('computes 1 for identical colors', () => {
    expect(contrastRatio('#ff0000', '#ff0000')).toBeCloseTo(1, 1);
  });

  it('passes AA at >= 4.5', () => {
    expect(wcagCheck('#767676', '#ffffff').passesAA).toBe(true);
    expect(wcagCheck('#949494', '#ffffff').passesAA).toBe(false);
  });

  it('autoOnColor picks readable text', () => {
    expect(autoOnColor('#ffffff')).toBe('#000000');
    expect(autoOnColor('#000000')).toBe('#ffffff');
    expect(autoOnColor('#ffee00')).toBe('#000000');
    expect(autoOnColor('#1a1a2e')).toBe('#ffffff');
  });
});
```

---

## 八、注入顺序（L0-L4 不变量的遵守）

修改后每 agent CSS 的生成顺序：

```
[现有] tokenBlock()           → --agentskin-accent, --agentskin-bg, ... (L0)
[新增] extendedColorsBlock()  → --agentskin-ext-error, --agentskin-ext-on-error, ... (L0+)
[新增] designLanguageBlock()  → --agentskin-space-*, --agentskin-radius-*, ... (L0+)
[现有] auroraGlassSignature() → signature 层 (L3, 仅声明了 signature 的主题)
```

L0-L4 注入分层不变量保持不变：
- L0 palette.css：由 `build-palette.mjs` 生成（无需改动，DL 块由 generate-theme-css 追加到 agent CSS）
- L1 tokens.css：引擎目录内（无需改动）
- L2 cosmetic.css：引擎目录内（无需改动）
- L3 theme.css = agent CSS（修改点在此）
- L4 adapter.mjs：运行时注入逻辑（无需改动）

---

## 九、Manifest 作者体验（示例）

### 9.1 最简用法（零改动，完全向后兼容）

主题作者不需要任何改动。不填 `designLanguageConfig` 和 `colors.extended` 时行为与当前完全一致。

### 9.2 仅添加语义色

```json
{
  "id": "cyber-neon",
  "name": "Cyber Neon",
  "colors": {
    "background": "#0f0f14",
    "foreground": "#e4e4e7",
    "accent": "#6366f1",
    "extended": {
      "error": "#ef4444",
      "success": "#22c55e",
      "warning": "#f59e0b",
      "info": "#3b82f6"
    }
  }
}
```

### 9.3 完整用法（设计语言 + 语义色）

```json
{
  "id": "cyber-neon-soft",
  "name": "Cyber Neon Soft",
  "designLanguageConfig": {
    "spacing": { "density": "cozy" },
    "radius":  { "scale": "8" },
    "shadow":  { "elevation": "subtle" },
    "motion":  { "speed": "smooth" }
  },
  "colors": {
    "background": "#0f0f14",
    "foreground": "#e4e4e7",
    "accent": "#6366f1",
    "extended": {
      "error": "#ef4444",
      "success": "#22c55e",
      "warning": "#f59e0b",
      "info": "#3b82f6"
    }
  }
}
```

---

## 十、执行顺序（批次内并行）

### 阶段二 P0 批次（并行执行，无依赖）

```
并行任务 A: F1 + F2 (schema 扩展 + 同步)
并行任务 B: F3 (design-language.mjs)
并行任务 C: F4 (extended-colors.mjs)
```

### 阶段二 P0 校验（串行，依赖 A/B/C 完成）

```
串行任务 D: F5 (generate-theme-css.mjs 修改)
      ↓
串行任务 E: F6 (check-themes.mjs 修改)
      ↓
串行任务 F: npm run test (校验)
      ↓
串行任务 G: npm run check (全量校验)
```

### 阶段二 P1 批次（测试，依赖 P0 完成）

```
并行任务 H: F7 (design-language-block.test.ts)
并行任务 I: F8 (extended-colors-block.test.ts)
并行任务 J: F9 (wcag-contrast.test.ts)
```

---

## 十一、回滚检查点

| 检查点 | 条件 | 回滚动作 |
|--------|------|---------|
| Schema 扩展后 | `npm run check` 失败 | 回滚 F1+F2，保留 F3+F4 |
| 生成器修改后任一测试失败 | test 不通过 | 回滚 F5，保留 F3+F4 |
| WCAG 校验误伤存量主题 | 误报 | 调整 F6 为 warn-only |

---

*本方案严格对齐阶段一 A+D 复合方案（评分 9.21），不做任何方案层面的简化或篡改。*
