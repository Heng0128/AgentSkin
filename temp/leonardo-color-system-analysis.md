# Adobe Leonardo 色彩系统深度分析

> 分析日期: 2026-08-20  
> 数据源: GitHub adobe/leonardo README + llms.txt + contrast-colors README + index.d.ts + demo.js + package.json + leonardocolor.io  
> 分析目标: 评估 Leonardo 对比度驱动方法论对 AgentSkin 引擎的适用性

---

## 1. 项目全貌

**Leonardo** 是 Adobe 开源的对比度驱动色彩系统生成器，核心 npm 包为 `@adobe/leonardo-contrast-colors`（Apache 2.0 协议），作者 Nate Baldwin。

### 核心定位
- **对比度驱动 (contrast-driven)**: 以目标对比度比率为起点生成色彩，而非选色后校验
- **自适应 (adaptive)**: 用户可实时调整 lightness / contrast / saturation，整个配色系统自动重新计算
- **引擎 + 工具**: 提供核心 JavaScript 库 + Web UI (leonardocolor.io) + MCP Server

### Monorepo 结构
| 路径 | 说明 |
|------|------|
| `packages/contrast-colors/` | 核心库 `@adobe/leonardo-contrast-colors` |
| `docs/ui/` | Vite Web 应用 (leonardocolor.io) |
| `skills/leonardo-colors` | AI tooling (MCP) |

### 技术依赖
- `apca-w3` — WCAG 3 APCA 算法
- `chroma-js` — 色彩空间插值 + 转换
- `ciecam02` — CIE CAM02 色彩外观模型
- `hsluv` — 感知均匀色彩空间
- `ciebase` — CIE 基础函数

---

## 2. 对比度驱动方法论详解

### 2.1 核心理念差异

```
传统流程:  选色相 H → 选明度 L → 输出 HEX → 事后校验对比度 → 不合格则回退
Leonardo:  选色相(colorKeys) → 指定目标对比度(ratios) → 输出满足对比度的 HEX
```

**关键反转**: Leonardo 以对比度比率为"自变量"，颜色值为"因变量"。

### 2.2 工作流程

```
1. 定义 BackgroundColor (背景色基色 + 对比度阶梯)
   └─ colorKeys: ['#4a5b7b', '#72829c', '#a6b2c6']
   └─ ratios: [-1.1, 1, 1.12, 1.25, 1.45, 1.75, 2.25, 3.01, 4.52, 7, 11, 16]

2. 定义 Color (前景色 / 强调色 / 语义色)
   └─ name: 'blue'
   └─ colorKeys: ['#5CDBFF', '#0000FF']
   └─ ratios: [3, 4.5]

3. 创建 Theme
   └─ colors: [gray, blue, red, ...]
   └─ backgroundColor: gray
   └─ lightness: 97  (整体背景明度)
   └─ contrast: 1   (全局对比度倍率)
   └─ saturation: 100  (全局饱和度)

4. 输出
   └─ contrastColors: 结构化 JSON
   └─ contrastColorPairs: { key: hex } 扁平键值对
   └─ contrastColorValues: 纯值数组
```

### 2.3 对比度比率语义

| 符号 | 含义 | 用途 |
|------|------|------|
| 正比率 `3`, `4.5`, `7` | 比背景更**深**的颜色 | 浅色背景上的深色文字/图标 |
| 负比率 `-1.1`, `-1.3` | 比背景更**浅**的颜色 | 深色背景上的浅色文字 |
| `1` | 与背景对比度 1:1 (同色) | 背景色本身 |

**关键**:
- 比率 `[3, 4.5, 7]` 对应 WCAG AA / AAA 文本标准
- 比率 `[1.12, 1.3]` 对应非文本对比度 (WCAG 1.4.11)
- 负比率用于 dark mode 或深色面板上的浅文字

### 2.4 命名规则

```
正比率数组 [3, 4.5]  → blue100, blue200   (增量 100)
负比率数组 [-1.4, -1.3, -1.2] → gray25, gray50, gray75  (增量 100/(n+1))
自定义对象 { 'blue--largeText': 3 } → blue--largeText  (BEM 风格命名)
```

---

## 3. WCAG 2.1 / APCA 双重支持

### 3.1 公式选择

```js
// WCAG 2.x (默认) — 基于相对亮度的比率
new Theme({ formula: 'wcag2' })

// APCA / WCAG 3 — 基于感知对比度和视觉权重
new Theme({ formula: 'wcag3' })
```

### 3.2 关键差异

| 维度 | WCAG 2.1 | APCA (WCAG 3) |
|------|----------|---------------|
| 基础 | 相对亮度差 | 感知外观模型 + 空间频率 |
| 文本敏感度 | 不考虑字号/字重 | 高分辨率：Lc 60 ≈ 普通 4.5:1 |
| 非文本 | 3:1 最低 | 根据不同上下文变化 |
| 极性 | 绝对值对称 | 区分正负极性 (白底黑字 vs 黑底白字) |
| 当前状态 | 正式标准 | 工作草案 |

### 3.3 对 Leonardo 的影响

Leonardo 通过 `formula` 参数切换两种算法，输出不同的颜色值，但 API 完全一致。这使得 Leonardo 能随 WCAG 3 标准成熟平滑升级。

**实际应用**: Leonardo 的 demo 使用比率数组 `[1, 1.12, 1.3, 2, 3.01, 4.52, 7, 11, 16]`，这在 WCAG 2.1 中对应:
- 1.12+ ≈ 非文本 UI 对比度阈值
- 3.01+ ≈ 大文本 (18px+ bold 或 24px+ regular)
- 4.52+ ≈ 正常文本 AA
- 7+ ≈ 正常文本 AAA
- 11+ ≈ 高对比度
- 16+ ≈ 极高对比度 (接近黑与白)

---

## 4. Color System 输出格式与结构

### 4.1 三种输出格式

```js
// 1. contrastColors — 结构化 JSON (含对比度元数据)
[
  { background: '#e0e0e0' },
  {
    name: 'gray',
    values: [
      { name: 'gray100', contrast: 1, value: '#e0e0e0' },
      { name: 'gray200', contrast: 2, value: '#a0a0a0' }
    ]
  },
  {
    name: 'blue',
    values: [
      { name: 'blue100', contrast: 3, value: '#8d63ff' },
      { name: 'blue200', contrast: 4.5, value: '#623aff' }
    ]
  }
]

// 2. contrastColorPairs — 扁平键值对 (直接用于 CSS 变量)
{
  "gray100": "#e0e0e0",
  "gray200": "#a0a0a0",
  "blue100": "#8d63ff",
  "blue200": "#623aff"
}

// 3. contrastColorValues — 纯值数组
['#e0e0e0', '#a0a0e0', '#8d63ff', '#623aff']
```

### 4.2 输出色彩空间

`output` 参数控制，默认 `HEX`:
```
HEX | RGB | HSL | HSV | HSLuv | LAB | LCH | OKLAB | OKLCH | CAM02 | CAM02p
```

### 4.3 工作流集成示例

Leonardo 官方推荐的使用模式:

```js
// 生成主题
const theme = new Theme({ colors: [...], backgroundColor: gray, lightness: 97 });

// 提取 CSS 变量
const colorPairs = theme.contrastColorPairs;
for (const [key, value] of Object.entries(colorPairs)) {
  document.documentElement.style.setProperty(`--${key}`, value);
}

// 用户交互时实时调整
theme.lightness = 15;    // dark mode
theme.contrast = 1.2;   // 增强对比度
theme.saturation = 80;  // 降低饱和度
// 上述赋值后重新读取 contrastColorPairs 即可获取新的色板
```

---

## 5. 参数化配置接口

### 5.1 Theme 配置

| 参数 | 类型 | 范围 | 说明 |
|------|------|------|------|
| `colors` | `Color[]` | — | 前景色列表 |
| `backgroundColor` | `BackgroundColor` | — | 背景色定义 |
| `lightness` | `number` | 0–100 | 背景明度 |
| `contrast` | `number` | 0.25–3+ | 全局对比度倍率 |
| `saturation` | `number` | 0–100 | 全局饱和度 |
| `output` | `Colorspace` | — | 输出色彩空间 |
| `formula` | `ContrastFormula` | wcag2 / wcag3 | 对比度算法 |

### 5.2 Color 配置

| 参数 | 类型 | 说明 |
|------|------|------|
| `name` | `string` | 颜色名 (输出键前缀) |
| `colorKeys` | `string[]` | 关键色 (插值锚点) |
| `colorSpace` | `InterpolationColorspace` | 插值空间: LCH / LAB / CAM02 / HSL / HSLuv / HSV / RGB / OKLAB / OKLCH |
| `ratios` | `number[]` 或 `Record<string, number>` | 目标对比度 |
| `smooth` | `boolean` | 启用贝塞尔平滑 |
| `output` | `Colorspace` | 输出格式 |
| `saturation` | `number` | 独立饱和度控制 |

### 5.3 动态更新 API

```js
// 添加颜色
theme.addColor = newColor;

// 移除颜色
theme.removeColor = { name: 'blue' };

// 更新某颜色的参数
theme.updateColor = { name: 'blue', ratios: [3, 4.5, 7] };

// 实时调整全局参数 (触发重新计算)
theme.lightness = 50;
theme.contrast = 1.1;
theme.saturation = 90;
```

---

## 6. On-Accent 颜色选择逻辑

### 6.1 Leonardo 中的 "On-Accent"

Leonardo **没有内置的 "on-accent" 概念** (不像 Material Design 的 `onPrimary`、Radix 的 `accentContrast`)。但可以通过对比度驱动的工作流**间接实现**:

### 6.2 隐式 On-Accent 推导

核心思路: 在同一 Theme 中，前景色与背景色的对比度是已知的。当需要在某个前景色(如 `blue300`) 上叠放文字时:

**方案 A — 对比度查找法**:
```js
// 1. 获取目标 accent 色的实际值
const accentValue = '#623aff'; // blue300

// 2. 使用 contrast() 函数计算与候选文字色的对比度
const ratio = contrast(
  hexToRgb(accentValue),  // 前景色背景
  hexToRgb('#ffffff'),    // 候选文字色
  undefined,
  'wcag2'
);
// ratio >= 4.5 则通过
```

**方案 B — 比率阶梯法 (推荐)**:
```js
// 在定义 Color 时，同时定义深浅两套比率
const blue = new Color({
  name: 'blue',
  colorKeys: ['#5CDBFF', '#0000FF'],
  ratios: {
    'blue--bg-subtle': 1.12,    // 极浅蓝背景
    'blue--bg': 1.3,            // 浅蓝背景
    'blue--text': 4.5,          // 蓝文字 (白底)
    'blue--on-accent': -1.3     // 深蓝文字 (蓝底) — 负比率 = 比背景浅
  }
});
```

**方案 C — 双 Theme 法**:
```js
// 浅色主题
const lightTheme = new Theme({ lightness: 97, ... });

// 深色主题 (以 accent 色为"背景"生成 on-accent 文字)
const accentAsBg = new BackgroundColor({
  name: 'on-blue',
  colorKeys: ['#623aff'],
  ratios: [4.5, 7]
});
const onAccentTheme = new Theme({
  backgroundColor: accentAsBg,
  lightness: 30,
  colors: [accentAsBg]
});
```

### 6.3 与 Radix 的对比

| 维度 | Radix Colors | Leonardo |
|------|-------------|----------|
| On-accent 概念 | 内置 `accentContrast` token | 无内置，需手动推导 |
| 实现方式 | 预定义 `accent` + `accentContrast` 配对 | 通过 contrast() 或负比率动态计算 |
| 灵活性 | 固定配对 | 任意目标对比度 |
| 自适应 | 静态 | 实时可调 |

---

## 7. 与其他色彩系统的本质区别

### 7.1 Leonardo vs Catppuccin

| 维度 | Catppuccin | Leonardo |
|------|-----------|----------|
| **定位** | 美学驱动的静态色板 | 功能驱动的生成引擎 |
| **生成方式** | 手工调色的固定色板 | 参数化算法生成 |
| **对比度** | 事后校验 (部分通过) | 事前保证 (生成即满足) |
| **自适应** | 无 (固定 light/dark 两套) | 实时 lightness/contrast/saturation 调整 |
| **语义** | 语义化命名 (base/surface/text) | 数字阶梯命名 (gray100/200/300) |
| **WCAG** | 部分组合不达标 | 所有输出满足目标比率 |
| **输出** | CSS 变量 / Tailwind 插件 | CSS 变量 / JSON / 设计 token |
| **可扩展** | 手工添加新色相 | 添加 Color 定义即可 |
| **适用场景** | 个人项目、终端美化 | 企业级设计系统、无障碍产品 |

### 7.2 Leonardo vs Radix Colors

| 维度 | Radix Colors | Leonardo |
|------|-------------|----------|
| **生成方式** | 手工调色的 12 步色阶 | 算法生成的 N 步色阶 |
| **对比度** | 每步有目标值但非严格保证 | 严格满足目标比率 |
| **语义层** | 9 层语义映射 (accent/bg/canvas...) | 无内置语义层，需自建 |
| **Alpha 变体** | 内置 P3 / Alpha 版本 | 无 (需自行处理透明度) |
| **On-accent** | 内置 `accentContrast` | 需手动推导 |
| **自适应** | 静态 (light/dark 两套) | 实时可调 |
| **色彩空间** | 感知均匀 (OKLCH 系) | 可选 10 种插值空间 |
| **WCAG 3** | 尚未支持 | 支持 APCA |
| **适用场景** | 组件库、设计系统 | 无障碍优先、动态主题 |

### 7.3 Leonardo vs Primer (GitHub)

| 维度 | Primer | Leonardo |
|------|--------|----------|
| **生成方式** | 手工 + 部分算法 | 纯算法 |
| **对比度** | 有系统但非严格驱动 | 对比度驱动 |
| **可扩展** | 固定色板 | 无限扩展 |
| **自适应** | 有限 (dark_dimmed/dark_high_contrast) | 连续可调 |

### 7.4 核心差异总结

```
Catppuccin:  "选最好看的颜色，希望它满足对比度"
Radix:       "选经过验证的颜色，提供语义层"
Leonardo:    "指定需要的对比度，输出满足条件的颜色"
```

**Leonardo 的本质**: 将色彩选择从"艺术问题"转化为"工程问题"——输入约束条件，输出满足约束的解。

---

## 8. 与 AgentSkin WCAG 校验的集成可能性

### 8.1 AgentSkin 当前 WCAG 校验模式

根据 AGENTS.md 不变量 C1-C9，AgentSkin 已有:
- `check-themes.mjs` — 14-token 主题契约校验
- `check-theme-staleness.mjs` — Palette-CSS 同步校验
- `check-design-tokens.mjs` — 设计 token 合规校验

### 8.2 Leonardo 集成方案

#### 方案 A — 对比度预校验 (推荐)

在主题构建阶段使用 Leonardo 的 `contrast()` 函数替代或增强现有 WCAG 校验:

```js
// scripts/wcag-contrast-check.mjs
import { contrast } from '@adobe/leonardo-contrast-colors';

function checkThemeAccessibility(themeTokens) {
  const failures = [];
  
  // 检查所有文本/背景组合
  const combinations = [
    { fg: themeTokens['--color-text-primary'], bg: themeTokens['--color-bg-primary'], level: 'AA', target: 4.5 },
    { fg: themeTokens['--color-text-secondary'], bg: themeTokens['--color-bg-primary'], level: 'AA', target: 4.5 },
    { fg: themeTokens['--color-text-on-accent'], bg: themeTokens['--color-accent'], level: 'AA', target: 4.5 },
    // ... 更多组合
  ];
  
  for (const { fg, bg, level, target } of combinations) {
    const ratio = contrast(hexToRgb(fg), hexToRgb(bg), undefined, 'wcag2');
    if (ratio < target) {
      failures.push({ fg, bg, ratio, target, level });
    }
  }
  
  return failures;
}
```

#### 方案 B — 主题生成器

使用 Leonardo 作为主题生成的核心引擎:

```js
// scripts/theme-generator.mjs
import { Theme, Color, BackgroundColor } from '@adobe/leonardo-contrast-colors';

function generateAgentSkinTheme({ brandColor, mode = 'light' }) {
  const lightness = mode === 'light' ? 97 : 11;
  const baseRatios = mode === 'light' 
    ? [1, 1.12, 1.3, 2, 3.01, 4.52, 7, 11, 16]
    : [-1.1, -1.05, 1, 1.12, 1.3, 2, 3.01, 4.52, 7, 11, 16];
  
  const gray = new BackgroundColor({
    name: 'gray',
    colorKeys: ['#4a5b7b', '#72829c', '#a6b2c6'],
    colorSpace: 'HSL',
    ratios: baseRatios
  });
  
  const accent = new Color({
    name: 'accent',
    colorKeys: [brandColor],
    colorSpace: 'OKLCH',
    ratios: [3, 4.5, 7]
  });
  
  const theme = new Theme({
    backgroundColor: gray,
    colors: [gray, accent],
    lightness,
    contrast: 1,
    output: 'HEX'
  });
  
  return theme.contrastColorPairs;
}
```

#### 方案 C — 实时对比度监控

在 AgentSkin 运行时注入阶段，使用 Leonardo 验证注入后的实际对比度:

```js
// 注入后采样实际渲染颜色
const actualBg = getComputedStyle(element).backgroundColor;
const actualFg = getComputedStyle(element).color;
const actualRatio = contrast(hexToRgb(actualFg), hexToRgb(actualBg));
if (actualRatio < 4.5) {
  // 触发修正逻辑
}
```

### 8.3 集成风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| 新增 npm 依赖 | 中 | Leonardo 仅 4 个运行时依赖，总 < 500KB |
| 与现有 14-token 契约冲突 | 低 | 作为预校验层，不替代现有契约 |
| 性能开销 | 低 | contrast() 是纯计算，无 IO |
| 学习曲线 | 中 | 团队需理解对比度驱动思维 |

---

## 9. Leonardo Color Output 对 AgentSkin Extended Colors 的适用性

### 9.1 AgentSkin 的 14-Token 契约

根据 THEME_SPEC.md，AgentSkin 主题使用 14 个核心 token:
```
--color-bg-primary
--color-bg-secondary
--color-bg-tertiary
--color-text-primary
--color-text-secondary
--color-text-muted
--color-border
--color-accent
--color-accent-hover
--color-success
--color-warning
--color-error
--color-info
--color-overlay
```

### 9.2 Leonardo 输出映射

Leonardo 的 `contrastColorPairs` 输出是 `{ name: hex }` 扁平结构，映射到 AgentSkin 14-token:

```js
// 映射示例
const leonardoOutput = theme.contrastColorPairs;

const agentSkinTokens = {
  '--color-bg-primary': leonardoOutput['gray100'],      // 对比度 1 (背景本身)
  '--color-bg-secondary': leonardoOutput['gray200'],    // 对比度 2
  '--color-bg-tertiary': leonardoOutput['gray300'],     // 对比度 3
  '--color-text-primary': leonardoOutput['gray800'],    // 对比度 7+
  '--color-text-secondary': leonardoOutput['gray700'],  // 对比度 4.5+
  '--color-text-muted': leonardoOutput['gray600'],      // 对比度 3+
  '--color-border': leonardoOutput['gray300'],
  '--color-accent': leonardoOutput['blue400'],
  '--color-accent-hover': leonardoOutput['blue500'],
  '--color-success': leonardoOutput['green400'],
  '--color-warning': leonardoOutput['gold400'],
  '--color-error': leonardoOutput['red400'],
  '--color-info': leonardoOutput['blue400'],
  '--color-overlay': leonardoOutput['gray900a'],  // 需额外处理 alpha
};
```

### 9.3 适用性评估

| AgentSkin 需求 | Leonardo 支持度 | 说明 |
|---------------|----------------|------|
| 背景色阶 | 完全支持 | BackgroundColor 直接生成 |
| 文本色阶 | 完全支持 | 正比率生成深色文字 |
| 语义色 (accent/success/error) | 完全支持 | 多 Color 实例 |
| Dark mode | 完全支持 | 负比率 + lightness 调整 |
| Alpha 变体 | 不支持 | 需自行处理透明度 |
| On-accent 文字 | 间接支持 | 需 contrast() 辅助 |
| 实时主题切换 | 完全支持 | Theme setter 实时重算 |
| 用户自定义对比度 | 完全支持 | contrast 参数 |
| 色盲安全 | 完全支持 | 内置色盲模拟 |
| 14-token 命名 | 需适配 | Leonardo 使用数字阶梯 |

### 9.4 关键缺口

1. **Alpha 通道**: Leonardo 不输出带透明度的颜色。AgentSkin 的 `--color-overlay` 需要额外处理。
2. **语义命名**: Leonardo 输出 `blue400` 而非 `--color-accent`，需要中间映射层。
3. **On-accent 配对**: 需要额外的 contrast() 计算或双 Theme 方案。
4. **非文本 UI 对比度**: Leonardo 的比率系统天然支持 (1.12+ 阈值)，但 AgentSkin 需要显式定义哪些 token 对需要非文本对比度。

---

## 10. 不适合 AgentSkin 的部分

### 10.1 架构层面

| Leonardo 特性 | 不适合原因 |
|--------------|-----------|
| **完整色彩系统** | AgentSkin 是注入引擎，不需要从零生成色彩系统 |
| **Web UI 工具** | AgentSkin 有独立的 Studio UI，不需要 leonardocolor.io |
| **MCP Server** | AgentSkin 的 AI 集成走自己的编排层 |
| **端用户个性化** | AgentSkin 面向的是被注入应用，不是最终用户 |
| **数据可视化色板** | AgentSkin 是 UI 主题引擎，不涉及图表色板 |

### 10.2 工作流层面

| Leonardo 工作流 | AgentSkin 实际 |
|----------------|---------------|
| 设计师在 Web UI 选色 → 导出参数 | AgentSkin 主题由开发者预定义，运行时注入 |
| 用户实时调整 lightness/contrast | AgentSkin 通过设置面板调整，非连续滑块 |
| 输出 CSS 变量到 :root | AgentSkin 通过 CDP 注入到目标应用 |
| 设计 token 共享 (W3C spec) | AgentSkin 有自己的 14-token 契约 |

### 10.3 技术层面

| 技术决策 | 不适合原因 |
|---------|-----------|
| **Chroma.js 依赖** | AgentSkin 已有自己的色彩处理 (color-theory.mjs) |
| **D3 色彩空间** | AgentSkin 不需要 2D/3D 色彩可视化 |
| **APCA 优先** | WCAG 2.1 仍是法定合规标准，APCA 是草案 |
| **连续 lightness 调整** | AgentSkin 主题是离散的 (light/dark/high-contrast) |

### 10.4 核心矛盾

```
Leonardo: "我生成完整的色彩系统，你使用它"
AgentSkin: "我注入主题到已有应用，我需要的是适配和覆盖"
```

Leonardo 是**色彩系统生成器**，AgentSkin 是**主题注入引擎**。两者的交集在于:
- Leonardo 的 `contrast()` 函数可作为 AgentSkin 的 WCAG 校验工具
- Leonardo 的 Theme 生成逻辑可启发 AgentSkin 的主题构建脚本
- Leonardo 的比率驱动思维可指导 AgentSkin 的 token 对比度规范

但 Leonardo 的**完整工作流** (Web UI → 导出 → 集成) 与 AgentSkin 的**注入引擎**定位不匹配。

---

## 11. 推荐集成策略

### 11.1 推荐: 轻量级 contrast() 集成

**仅引入 `contrast()` 函数** (或自行实现 WCAG 2.1 对比度公式)，用于:
1. 主题构建时的预校验 (替代/增强 check-themes.mjs 中的对比度检查)
2. 注入后的实际对比度验证
3. 用户自定义主题时的实时反馈

**不引入** Theme / Color / BackgroundColor 等高层 API。

### 11.2 推荐: 对比度驱动的主题规范

借鉴 Leonardo 的思维，为 AgentSkin 建立**对比度驱动的主题规范**:

```js
// 每个 token 声明其目标对比度
const tokenContrastSpec = {
  '--color-text-primary': { bg: '--color-bg-primary', target: 7 },
  '--color-text-secondary': { bg: '--color-bg-primary', target: 4.5 },
  '--color-text-muted': { bg: '--color-bg-primary', target: 3 },
  '--color-text-on-accent': { bg: '--color-accent', target: 4.5 },
  '--color-border': { bg: '--color-bg-primary', target: 1.12 },
  // ...
};
```

### 11.3 不推荐: 完整 Leonardo 集成

- 引入完整 Leonardo 会增加不必要的抽象层
- AgentSkin 的主题结构 (14-token) 与 Leonardo 的输出格式不匹配
- 两者的用户场景差异过大

---

## 12. 总结

### Leonardo 的核心价值
1. **对比度驱动**: 将色彩选择从"事后校验"转为"事前保证"
2. **自适应**: 实时调整 lightness/contrast/saturation
3. **双标准**: WCAG 2.1 + APCA 双支持
4. **工程化**: 将色彩问题转化为参数化问题

### 对 AgentSkin 的启示
1. **思维层面**: 对比度驱动 > 色相驱动
2. **工具层面**: contrast() 函数可用于校验
3. **规范层面**: 为每个 token 声明目标对比度
4. **架构层面**: 不引入完整系统，仅借鉴方法论

### 最终判断
> Leonardo 是**设计系统色彩生成的标杆项目**，其对比度驱动方法论值得 AgentSkin 学习。但两者的产品定位差异决定了 AgentSkin 应**借鉴其思维而非引入其代码**——在现有 14-token 契约基础上，增加对比度驱动的预校验层，而非替换为 Leonardo 的完整工作流。

---

## 附录 A: Leonardo API 速查

```js
import { Theme, Color, BackgroundColor, contrast, createScale, convertColorValue } from '@adobe/leonardo-contrast-colors';

// 核心类
const gray = new BackgroundColor({ name: 'gray', colorKeys: ['#cacaca'], ratios: [2, 3, 4.5, 8] });
const blue = new Color({ name: 'blue', colorKeys: ['#5CDBFF', '#0000FF'], ratios: [3, 4.5] });
const theme = new Theme({ colors: [blue], backgroundColor: gray, lightness: 97 });

// 输出
theme.contrastColors;    // 结构化 JSON
theme.contrastColorPairs; // { key: hex }
theme.contrastColorValues; // [hex, hex, ...]

// 动态调整
theme.lightness = 50;
theme.contrast = 1.2;
theme.saturation = 80;

// 工具函数
contrast([255,255,255], [0,0,0], undefined, 'wcag2'); // → 21
contrast([255,255,255], [0,0,0], undefined, 'wcag3'); // → ~100 (APCA Lc)

// 色彩空间转换
convertColorValue('#ff0000', 'HSL'); // → "hsl(0deg 100% 50%)"
```

## 附录 B: 参考资源

- GitHub: https://github.com/adobe/leonardo
- npm: https://www.npmjs.com/package/@adobe/leonardo-contrast-colors
- Web UI: https://leonardocolor.io
- Demo: https://leonardocolor.io/demo.html
- 作者 Nate Baldwin: https://natebaldw.in/
- 文章: "Adaptive Color in Design Systems" (Medium)
- 文章: "Leonardo: an open source contrast-based color generator" (Medium)
