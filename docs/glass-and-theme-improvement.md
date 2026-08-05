# AgentSkin 毛玻璃与主题工作流 — 改进方案

> 本文档聚焦两个核心薄弱点的改进：(1) 毛玻璃/透明化效果的质量与一致性 (2) 主题制作工作流的规范化。GitHub 参考项目已调研完毕，所有建议都有落地路径。

---

## 第一部分：毛玻璃 / 透明化效果改进

### 1.1 现状诊断

基于对 6 个 agent adapter.mjs 的深度分析：

| 问题 | 详情 |
|------|------|
| **blur 不统一** | zcode 用 16/20/24px 三级，doubao 用 24px，workbuddy/codex **完全没有 blur**，只有 color-mix 半透明 |
| **没有噪点层** | 真实的毛玻璃（iOS/macOS）都有细微噪点避免色带。AgentSkin 纯 blur + 半透明缺乏质感 |
| **没有暗/亮模式差异** | 没有根据 mode 调整 blur 暗色下 blur 效果更明显，亮色需要更强的 blur |
| **L4 发现过于激进** | workbuddy 的 `discoverAndOverrideTokens` 把非 accent 的 `--cb-*` token 全部改为 85% transparent，可能误伤 badge、头像背景 |
| **CSS 变量不共享** | 没有 `--glass-blur-tier-1/2/3` 这样的共享变量，每个 agent 独立写 |
| **Studio 一刀切** | Theme Studio 的 `blurPx` 对所有控件应用同一个值，没有分区域控制 |

### 1.2 GitHub 参考项目

| 项目 | 核心能力 | 借鉴 |
|------|---------|------|
| **electron-liquid-glass** (554★) | macOS/Windows 原生平台 API 实现真正的折射+模糊 | Electron 应用可使用原生绑定替代纯 CSS blur |
| **themesberg/glass-ui** (387★) | 纯 CSS 玻璃态 UI 库，通过 CSS 变量控制模糊度、透明度、边框光泽 | 直接搬变量组织方式 |
| **JUNGHERZ/GlassKit** | 24 个零依赖组件，使用 Design Tokens 控制明暗切换 | token 分层设计模式 |
| **ysfembyrk/Progressive-Acrylic** | 多层叠加亚克力效果，支持渐进式模糊分层 + 噪点纹理 | 低配降级策略 |
| **miketromba/css.glass** | 在线生成器，暴露 blur / opacity / noise / border / shadow 五参数 | Studio UI 面板设计的直接参考 |
| **lucaperullo/simple-liquid-glass** (6.5KB) | SVG filter 在低配设备上实现折射和色差的 fallback | 低配回退方案 |

### 1.3 统一毛玻璃设计变量系统（参考 themesberg/glass-ui + GlassKit）

在 `palette.css`（L0 层）新增标准化 glass tokens：

```css
/* === Glass Design Tokens (新增) === */
:root {
  /* 玻璃层级 — 按控件高度/面积分三级 */
  --glass-blur-sm: 8px;     /* 输入框、小型卡片 */
  --glass-blur-md: 16px;    /* 侧边栏、导航栏 */
  --glass-blur-lg: 24px;    /* 浮层、弹窗、抽屉 */
  
  /* 玻璃不透明度（bg tint%) */
  --glass-tint-sm: 0.45;    /* 输入框 */
  --glass-tint-md: 0.15;    /* 侧边栏 */
  --glass-tint-lg: 0.72;    /* 浮层 */
  
  /* 边框高光 */
  --glass-border-glow: 1px solid rgba(255, 255, 255, 0.08);
  
  /* 噪点层（CSS gradient 模拟） */
  --glass-noise: url("data:image/svg+xml,...");
}

/* 明度修正：亮色模式下 blur 效果较弱，需要更强 */
[data-agentskin-mode="light"] {
  --glass-blur-sm: 12px;
  --glass-blur-md: 20px;
  --glass-blur-lg: 32px;
  --glass-tint-md: 0.20;
}
```

### 1.4 分区域玻璃模板（替代当前每个 agent 自建方式）

创建一个 **shared glass adapter library**，取代各 agent 的硬编码：

```css
/* === engines/shared/glass-tokens.css (新建) === */

/* 侧边栏 */
[data-agentskin-region="sidebar"],
[class*="sidebar"],
aside {
  backdrop-filter: blur(var(--glass-blur-md)) saturate(1.15);
  background: color-mix(in srgb, var(--agentskin-surface) calc(var(--glass-tint-md) * 100%), transparent);
  border-right: var(--glass-border-glow);
}

/* 输入区 */
[data-agentskin-region="composer"],
[contenteditable],
textarea {
  backdrop-filter: blur(var(--glass-blur-sm)) saturate(1.2);
  background: color-mix(in srgb, var(--agentskin-surface) calc(var(--glass-tint-sm) * 100%), transparent);
  border: var(--glass-border-glow);
  border-radius: inherit;
}

/* 浮层/弹窗 */
[role="dialog"],
[role="menu"],
.modal,
.drawer {
  backdrop-filter: blur(var(--glass-blur-lg)) saturate(1.25);
  background: color-mix(in srgb, var(--agentskin-surface-elevated) calc(var(--glass-tint-lg) * 100%), transparent);
  border: var(--glass-border-glow);
}
```

### 1.5 噪点纹理层

**Progressive-Acrylic** 的噪点实现方案：

```css
/* 用 SVG data URI 内嵌 100x100 噪点纹理，不依赖外部文件 */
backdrop-filter: blur(var(--glass-blur-md)) saturate(1.15);

/* 叠加细微噪点层 */
.glass-noise-overlay::before {
  content: '';
  position: absolute;
  inset: 0;
  opacity: 0.03;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E");
  pointer-events: none;
}
```

### 1.6 低配降级策略

参考 Progressive-Acrylic 的多层叠加模式：

```
高配路径（GPU 可用）:
  backdrop-filter: blur(20px) saturate(1.2) + noise overlay

降级路径（GPU 禁用 / 低配模式）:
  backdrop-filter: blur(8px) + 较强 tint (透明度从 15% → 30%) + SVG noise

最低配路径（完全无 backdrop-filter 支持）:
  纯 color-mix 半透明 + 纹理图片 fallback，放弃模糊
```

**SDK 检测逻辑**：
```typescript
// 来自 AgentSkin 现有 app.disableHardwareAcceleration() 配置
const hwAccelDisabled = store.get('disableHardwareAcceleration', false);
const isLowEnd = navigator.hardwareConcurrency <= 4;

if (hwAccelDisabled || isLowEnd) {
  document.documentElement.classList.add('agentskin-glass-low');
} else {
  document.documentElement.classList.add('agentskin-glass-full');
}
```

### 1.7 原生 electron-liquid玻璃绑定

**electron-liquid-glass** 的做法（值得 AgentSkin 在主窗口面板上采用）：

```typescript
// 仅在 Windows 11 和 macOS 上启用
if (process.platform === 'win32' || process.platform === 'darwin') {
  // 调用原生窗口模糊 API（DWM/Mica on Windows, NSVisualEffectView on macOS）
  // 实现真正的 OS 级玻璃态背景
  // CSS backdrop-filter 只修饰内部组件
}
```

**优势**：原生 API 不耗 GPU，零 CPU 开销。可作为 AgentSkin Glass 的终极推荐模式。

### 1.8 改进优先级

| 优先级 | 改进项 | 吸取自 | 效果 |
|-------|--------|-------|------|
| 🔴 P0 | 统一 glass CSS 变量系统 | themesberg/glass-ui + GlassKit | 一次性解决 blur 不统一 + 暗亮模式差异 |
| 🔴 P0 | 分区域玻璃模板 | 自建 shared/ 目录 | 所有 agent 采用同一套标准，减少维护量 |
| 🟡 P1 | 噪点纹理层 | Progressive-Acrylic | 质感提升，告别"干净但塑料"感 |
| 🟡 P1 | 低配降级阶梯 | Progressive-Acrylic | 让低配模式下仍有可接受的玻璃感 |
| 🟢 P2 | 原生窗口玻璃绑定 | electron-liquid-glass | 终极体验，但不紧急 |
| 🟢 P2 | SVG filter 折射 fallback | simple-liquid-glass | Safari/WebKit 低配设备兼容 |

---

## 第二部分：主题制作工作流规范化

### 2.1 现状诊断

基于对 `scripts/validate-themes.ts`、`scripts/build-theme-package.mjs`、`scripts/generate-theme-css.mjs` 的分析：

| 问题 | 详情 |
|------|------|
| **CSS 纯生成，不可手写** | palette.css 注释 "do not edit"，无法添加自定义玻璃规则 |
| **blurPx 一刀切** | Studio 对所有控件应用同一个 `backdrop-filter: blur(Npx)`，没有分类 |
| **预览图纯渐变** | `buildPreview()` 只生成 bg→surface 渐变 + 一个 accent 矩形，不反映真实 UI |
| **生成脚本 100KB+ 单文件** | parseColor / color math / per-agent token map / CSS 输出全部塞在 `generate-theme-css.mjs` |
| **无 hot-reload** | 改颜色后必须 `node scripts/generate-theme-css.mjs`，没有 watch 模式 |
| **验证器单薄** | 只检查字段存在性和文件路径，不校验 CSS 语法 / WCAG 对比度 / selector 有效性 |
| **没有 tokens schema** | 主题包的 14 个核心 token 在脚本里硬编码，没有独立的 schema 定义 |

### 2.2 GitHub 参考项目

| 项目 | 核心能力 | 借鉴 |
|------|---------|------|
| **amzn/style-dictionary** (4.6k★) | JSON token 树 → 任意平台输出（CSS/Swift/Android） | 用标准 token pipeline，替代手写 CSS 生成 |
| **tokens-studio/sd-transforms** (249★) | 多主题集（token sets）、W3C DTCG 格式、颜色数学运算 | 一个 token 文件内同时包含 light/dark 变体 |
| **sergei-maertens/design-token-editor** | React + Storybook 的 token 实时编辑预览 | Studio 中实现 "改 token → 即时看效果" |
| **miketromba/css.glass** | 五参数面板（blur / opacity / noise / border / shadow） | Studio UI 增加玻璃效果控制面板 |
| **ysfembyrk/Progressive-Acrylic** | 多层叠加策略 | Studio 中预设多种玻璃效果模板 |

### 2.3 主题包格式标准化（升级至 v3）

当前 v2 manifest 缺少 glass 层定义，建议新增结构：

```jsonc
// manifest.json v3 新增字段示例
{
  "schemaVersion": 3,
  "id": "naruto-tobi",
  "name": "Naruto Tobi",
  "version": "3.0.0",
  
  "colors": {
    "background": "#0F1117",
    "foreground": "#E5E7EB",
    "surface": "#1A1D27",
    "accent": "#FF453A",
    // ... 现有字段保留
  },
  
  // ========== 新增 ==========
  
  "glass": {
    "enabled": true,
    "noise": true,           // 是否启用噪点纹理
    "blurScale": 1.0,        // 整体模糊缩放系数
    "tintScale": 1.0,        // 整体透明度缩放
    "tiers": {
      "sm": { "blur": 8,  "tint": 0.45 },   // 输入框
      "md": { "blur": 16, "tint": 0.15 },   // 侧边栏
      "lg": { "blur": 24, "tint": 0.72 }    // 浮层
    },
    "darkModeBoost": {       // 暗色模式修正
      "blur": 1.2,
      "tint": 0.9
    }
  },
  
  "fonts": {
    // 现有字段保留
  },
  
  "typography": {            // 新增可选字体层级预设
    "display": "Space Grotesk",
    "body": "Inter",
    "mono": "IBM Plex Mono"
  }
}
```

### 2.4 引入 Style Dictionary 作为 token 管道

**当前问题**：颜色变换、token 映射全部硬编码在 100KB 脚本里。

**Style Dictionary 替代方案**：

```javascript
// style-dictionary.config.js
module.exports = {
  source: ['tokens/*.json'],   // 主题设计 token JSON 文件
  platforms: {
    css: {
      transformGroup: 'css',
      buildPath: 'themes/output/',
      files: [{
        destination: 'palette.css',
        format: 'css/variables',
        options: { outputReferences: true }
      }]
    },
    // 未来可扩展更多平台
    // swift: { transformGroup: 'ios-swift', ... }
  }
};
```

**主题 token JSON 输入**（设计师直接编辑的文件）：
```jsonc
// tokens/naruto-tobi.json
{
  "color": {
    "bg":    { "value": "#0F1117", "type": "color" },
    "fg":    { "value": "#E5E7EB", "type": "color" },
    "surface": { "value": "#1A1D27", "type": "color" },
    "accent": { "value": "#FF453A", "type": "color", "description": "Primary action color" }
  },
  "glass": {
    "blur": { "value": 16, "type": "dimension", "description": "Default glass blur radius" },
    "tint": { "value": 0.15, "type": "number", "description": "Default glass tint opacity" }
  }
}
```

**迁移路径**：
1. 先用 Style Dictionary 替换 `palette.css` 的生成逻辑（输入 manifest.colors → 转为 SD JSON → 输出 CSS）
2. 再处理 per-agent token mapping（把硬编码在脚本中的 map 移到 JSON 文件）
3. 最终形成：设计师编辑 tokens/JSON → SD 构建 → 输出完整主题包

### 2.5 Theme Studio 改造方向

#### 2.5.1 5 参数玻璃控制面板（参考 css.glass）

在 Studio 现有面板基础上，新增 Glass Effects 标签：

```
┌────────────────────────────────────────────┐
│ Theme Studio                               │
│ ┌─ Appearance ─┐  ┌─ Glass Effects (新) ─┐ │
│ │              │  │                       │ │
│ │ Theme Colors │  │ Blur   ██████████ 16px│ │
│ │ Accent       │  │ Tint   ██████░░░░ 15% │ │
│ │ Surface      │  │ Noise  ✓              │ │
│ │ Background   │  │ Border ░░░░░░░░ 8%    │ │
│ │              │  │ Shadow ███░░░░░ 4dp   │ │
│ │              │  │                       │ │
│ │              │  │ [Low Preset] [Med] [Hi] │
│ └──────────────┘  └───────────────────────┘ │
└────────────────────────────────────────────┘
```

#### 2.5.2 实时预览增强（参考 design-token-editor）

**当前**：预览纯渐变，看不到真实 UI
**改进后**：
- 在 Studio 窗口的右侧内嵌一个 `<iframe>`，加载 6 个 agent 的 mock UI（或真实 agent 截图，应用 CSS filter 调色）
- 设计师调整 token 时，通过 `postMessage` 实时变更 iframe 内的 CSS 变量
- 无需重启 agent 即可看到效果

#### 2.5.3 生成脚本拆分（100KB → 模块）

```
scripts/
├── tokens/
│   ├── parse-color.mjs        # hex/rgb → {r,g,b,a}
│   ├── color-math.mjs         # darken/lighten/alpha/blend
│   ├── wcag-checker.mjs       # WCAG AA/AAA 对比度校验
│   └── glass-tokens.mjs       # 玻璃 token 生成
├── mapping/
│   ├── workbuddy-tokens.json    # workbuddy native → agentskin 映射表
│   ├── doubao-tokens.json
│   ├── zcode-tokens.json
│   └── ...
├── generate-theme-css.mjs     # 入口：编排上面的模块
├── validate-themes.mjs        # 校验：manifest schema + 文件 + WCAG + CSS 语法
└── watch-themes.mjs           # watch 模式：文件变更 → 自动 rebuild
```

### 2.6 主题质量校验增强

**新增 WCAG 对比度校验**：

```javascript
// scripts/tokens/wcag-checker.mjs

// WCAG AA 要求正常文本对比度 ≥ 4.5:1，大文本 ≥ 3:1
// WCAG AAA 要求正常文本 ≥ 7:1，大文本 ≥ 4.5:1

function checkContrast(bgHex, fgHex, fontSize = 'normal') {
  const ratio = contrastRatio(parseColor(bgHex), parseColor(fgHex));
  const threshold = fontSize === 'large' ? 3 : 4.5;
  
  if (ratio < threshold) {
    return { pass: false, ratio: ratio.toFixed(2), threshold };
  }
  return { pass: true, ratio: ratio.toFixed(2) };
}

// 在 validate-themes.mjs 调用：
// checkContrast(theme.colors.surface, theme.colors.text)
// checkContrast(theme.colors.background, theme.colors.foreground)
// 不通过 → 警告或阻止打包
```

**CSS 语法校验**：

```javascript
// 用 PostCSS 尝试解析每个 agent 的 CSS，捕获语法错误
import postcss from 'postcss';

function validateCss(css) {
  try {
    postcss.parse(css);
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err.message, line: err.line };
  }
}
```

### 2.7 完整主题制作流程（改造后）

```
设计师工作流：
  1. Theme Studio 新建主题
  2. 选色板（色相、饱和度、亮度 — 参考 HSL picker）
  3. 调玻璃效果（5 参数面板）
  4. 实时预览（右测 iframe + 真实 agent mock）
  5. 校验通过（WCAG + 文件完整）
  6. 一键构建（watch 模式自动增量 build）
  7. 导出 .agentskin-theme 包

技术端工作流：
  输入：tokens/<name>.json（设计 token JSON文件）
     ↓
  Style Dictionary transform group
     ├─ 转换 hex → RGB 三件套（供 rgba() 使用）
     ├─ 计算暗色衍生色（surface elevating）
     ├─ 生成玻璃 token（blur/tint/noise）
     └─ 输出 L0 palette.css
     ↓
  per-agent token mapping
     ├─ 读取映射表（每个 agent 一个 JSON）
     ├─ 替换 native var → agentskin var
     └─ 生成 assets/css/<agent>.css
     ↓
  校验
     ├─ manifest schema（JSON Schema 校验）
     ├─ 文件完整性（icon/preview/hero 存在性）
     ├─ CSS 语法（PostCSS parse）
     └─ WCAG 对比度（color-math 计算）
     ↓
  输出：可直接安装的主题包
```

### 2.8 改进优先级

| 优先级 | 改进项 | 吸取自 | 效果 |
|-------|--------|-------|------|
| 🔴 P0 | 引入统一 glass 变量到 palette.css | themesberg/glass-ui + GlassKit | 一键统一所有 agent 的毛玻璃表现 |
| 🔴 P0 | 拆分 generate-theme-css.mjs | 自建模块化 | 降低维护成本 + 为后续 Style Dictionary 迁移铺路 |
| 🔴 P0 | Studio 玻璃效果控制面板 | miketromba/css.glass | 设计师能直接调玻璃参数 |
| 🟡 P1 | manifest schema v3 + glass 字段 | W3C DTCG 格式 + 自研 | 让 glass 成为一级公民 token |
| 🟡 P1 | WCAG 对比度校验 | color-math 通用实践 | 保证主题可达性 |
| 🟡 P1 | Studio 实时预览（右测 iframe） | design-token-editor | 让设计师眼见为实 |
| 🔴 P2 | 引入 Style Dictionary 生成管道 | amzn/style-dictionary | 标准化 token 处理，便于多主题迭代 |
| 🟡 P2 | watch 模式（开发时热重载） | 通用 Node.js watch | 开发效率倍增 |
| 🟢 P3 | 多主题集（light/dark 并存） | sd-transforms | 一个主题包包含明暗两种变体 |
| 🟢 P3 | SVG filter 折射效果 | simple-liquid-glass | 终极视觉体验 |

---

## 两部分的关系

> 毛玻璃效果是主题的"可视化层"，主题玻璃变量通过注入管道最终体现在目标应用上。

```
Theme manifest (@ agentskin v3)
  ├─ colors → palette.css (L0)
  ├─ glass.tiers.sm/md/lg → 注入到 injected stylesheet
  └─ 由 engine-strategy 通过 CDP 注入到目标 agent

Studio 编辑器调整
  → 实时反映到预览 iframe
  → 用户确认后写入 manifest.json
  → CI/cd pipeline 自动构建完整主题包
```

玻璃效果的改进需要 **主题端 + 注入端** 协同升级，而主题工作流规范只涉及 Studio 和构建脚本，两者可以并行推进。

---

*文档版本: v1.0 | 创建日期: 2026-08-05 | 覆盖参考项目: 12 个*

---

## 第三部分：可执行实施方案 — 文件级改造清单

### 3.1 准备阶段 — 必须优先克隆的项目

| 排名 | 项目 | 理由 | 克隆到 |
|------|------|------|--------|
| 🥇 #1 | **electron-liquid-glass** (snaildos/electron-liquid-glass) | 原生 macOS/Windows 玻璃 API 绑定，554★ | `~/.agentskin/ref/electron-liquid-glass/` |
| 🥈 #2 | **themesberg/glass-ui** (GitHub) | CSS 变量控制玻璃态完整系统，387★ | `~/.agentskin/ref/glass-ui/` |
| 🥉 #3 | **miketromba/css.glass** | 在线 5 参数玻璃生成器，UI 面板参考 | `~/.agentskin/ref/css-glass/` |
| #4 | **amzn/style-dictionary** | 工业级 token pipeline，4.6k★ | `~/.agentskin/ref/style-dictionary/` |
| #5 | **tokens-studio/sd-transforms** | 多主题集 token sets，W3C DTCG | `~/.agentskin/ref/sd-transforms/` |
| #6 | **ysfembyrk/Progressive-Acrylic** | 多层叠加亚克力 + 噪点 + 低配降级 | `~/.agentskin/ref/progressive-acrylic/` |

### 3.2 新增依赖

```bash
npm install style-dictionary           # token pipeline
npm install color-convert              # 颜色空间转换（已有则不需）
npm install -D postcss                 # CSS 语法校验
npm install -D @csstools/css-parser-parse-literal  # CSS AST 解析（可选）
```

### 3.3 文件修改清单 — 按阶段

#### Phase 1 (Week 1)：统一 Glass CSS 变量到 palette.css

**文件 1**: `src/main/catalog/theme-package-loader.ts` 或 `src/main/services/theme-bundle.ts`
- **改动内容**: 扩展主题构建流程，让 palette.css 包含 glass tokens
- **方式**: 在构建 L0 palette 时，追加 glass tokens 模板

```typescript
// 在 palette.css 生成函数中新增：
const GLASS_TOKENS_TEMPLATE = /* css */ `
/* === Glass Design Tokens (auto-injected) === */
:root {
  --glass-blur-sm: 8px;
  --glass-blur-md: 16px;
  --glass-blur-lg: 24px;
  --glass-tint-sm: 0.45;
  --glass-tint-md: 0.15;
  --glass-tint-lg: 0.72;
  --glass-border-glow: 1px solid rgba(255, 255, 255, 0.08);
}
[data-agentskin-mode="light"] {
  --glass-blur-sm: 12px;
  --glass-blur-md: 20px;
  --glass-blur-lg: 32px;
  --glass-tint-md: 0.20;
}
`;

// 追加到 palette.css 输出末尾
paletteOutput += GLASS_TOKENS_TEMPLATE;
```

**文件 2-7**: 每个 agent 的 adapter.mjs 重写背光玻璃逻辑
- `engines/workbuddy/adapter.mjs`
- `engines/doubao/adapter.mjs`
- `engines/zcode/adapter.mjs`
- `engines/qoderwork/adapter.mjs`
- `engines/traework/adapter.mjs`
- `engines/codex/adapter.mjs`

改动方式：把硬编码的 `backdrop-filter: blur(24px)` 替换为变量引用

```javascript
// 修改前：
element.style backdropFilter = 'blur(24px) saturate(1.2)';

// 修改后：
// 根据区域选择 tier
const tier = isSidebar ? 'md' : isInput ? 'sm' : 'lg';
element.style.backdropFilter = `blur(var(--glass-blur-${tier})) saturate(1.15)`;
element.style.background = `color-mix(in srgb, var(--agentskin-surface) calc(var(--glass-tint-${tier}) * 100%), transparent)`;
```

#### Phase 2 (Week 2)：Studio 玻璃效果控制面板

**文件 8**: `src/ui/components/studio/Toolbox.tsx`
- **改动内容**: 新增 Glass Effects Tab（8 维工具箱 → Tab 分组）
- **方式**: 把目前 Effects 参数中的 blur 单独提取为 Glass Tab

```typescript
// 新增 GlassTab 组件
export function GlassTab({ overrides, onOverridesChange }) {
  return (
    <div className="space-y-3">
      <GlassSlider label="SM Blur" value={overrides.glass_sm_blur} 
        onChange={(v) => onOverridesChange({ ...overrides, glass_sm_blur: v })} 
        min={0} max={40} unit="px" />
      <GlassSlider label="MD Blur" value={overrides.glass_md_blur}
        onChange={(v) => onOverridesChange({ ...overrides, glass_md_blur: v })}
        min={0} max={40} unit="px" />
      <GlassSlider label="LG Blur" value={overrides.glass_lg_blur}
        onChange={(v) => onOverridesChange({ ...overrides, glass_lg_blur: v })}
        min={0} max={40} unit="px" />
      <Toggle label="噪点纹理" checked={overrides.glass_noise}
        onChange={(v) => onOverridesChange({ ...overrides, glass_noise: v })} />
    </div>
  );
}
```

**文件 9**: `src/ui/pages/ThemeStudioPage.tsx`
- **改动内容**: 将 Toolbox 组件从"8 维平铺"改为 Tabs 路由
- **方式**: 在 Toolbox 渲染区域添加 Tabs UI

```typescript
// 新增 Tabs 状态
const [activeTab, setActiveTab] = useState<'glass' | 'colors' | 'spacing' | 'typography'>('colors');

// 条件渲染 Toolbox 内部
{activeTab === 'glass' && <GlassTab overrides={overrides} onOverridesChange={setOverrides} />}
{activeTab === 'colors' && <ColorTokens ... />}
// ...
```

#### Phase 3 (Week 3)：生成脚本模块化

**文件 10**: `scripts/generate-theme-css.mjs` (当前 100KB)
- **改动方向**: 拆分为 5 个子文件

```
scripts/
├── theme-engine/
│   ├── parse-color.mjs        ← hex/rgb → {r, g, b, a}
│   ├── color-math.mjs        ← darken/lighten/alpha/blend
│   ├── wcag-checker.mjs      ← WCAG AA/AAA 对比度校验
│   ├── glass-tokens.mjs      ← 玻璃 token 生成（blur/tint/noise 模板）
│   └── agent-mapping.mjs     ← 每个 agent 的 token 映射表（从 JSON 加载）
├── mapping/
│   ├── workbuddy-tokens.json  ← workbuddy native → agentskin 映射表
│   ├── doubao-tokens.json
│   ├── zcode-tokens.json
│   ├── qoderwork-tokens.json
│   ├── traework-tokens.json
│   └── codex-tokens.json
├── generate-theme-css.mjs     ← 入口：编排上面的模块
├── validate-themes.mjs        ← 校验：manifest schema + 文件 + WCAG + CSS 语法
└── watch-themes.mjs           ← watch 模式：文件变更 → 自动 rebuild
```

#### Phase 4 (Week 4)：低配降级 + 噪点层

**文件 11**: `src/main/cdp/injection/engine-strategy.ts`
- **改动内容**: 在 injection 时检测目标设备能力，注入对应等级的 glass CSS

```typescript
// 新增：设备能力检测
async function detectGlassTier(session: CdpSession): Promise<'full' | 'low' | 'none'> {
  const result = await session.client.Runtime.evaluate({
    expression: `(() => {
      const hwDisabled = localStorage.getItem('disableHardwareAcceleration') === 'true';
      const lowCpu = navigator.hardwareConcurrency <= 4;
      const hasBackdropFilter = CSS.supports('backdrop-filter', 'blur(1px)');
      if (!hasBackdropFilter) return 'none';
      if (hwDisabled || lowCpu) return 'low';
      return 'full';
    })()`
  });
  return result.result.value;
}

// 注入时添加 class
const tier = await detectGlassTier(session);
await session.client.Runtime.evaluate({
  expression: `document.documentElement.dataset.agentskinGlass = '${tier}'`
});
```

**文件 12**: `src/main/catalog/manifest-v2.schema.json` 或新增 `docs/glass-tokens.schema.json`
- **改动内容**: 定义玻璃效果的 JSON Schema 约束

```jsonc{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "type": "object",
  "properties": {
    "glass": {
      "type": "object",
      "properties": {
        "enabled": { "type": "boolean" },
        "noise": { "type": "boolean" },
        "blurScale": { "type": "number", "minimum": 0, "maximum": 3 },
        "tintScale": { "type": "number", "minimum": 0, "maximum": 2 },
        "tiers": {
          "type": "object",
          "properties": {
            "sm": { "$ref": "#/definitions/glassTier" },
            "md": { "$ref": "#/definitions/glassTier" },
            "lg": { "$ref": "#/definitions/glassTier" }
          }
        }
      }
    }
  }
}
```

### 3.4 验证标准

| 验证项 | 命令/操作 | 期望 |
|--------|----------|------|
| Glass 变量生效 | 应用主题 → 检查 agent DOM `--glass-blur-md` 值 | CSS 变量值为 16px（暗色）/20px（亮色） |
| Studio Glass Tab | 打开 Theme Studio → 切换 Glass Tab | 显示 SM/MD/Lur 三段滑块 |
| 低配降级 | 设置 disableHardwareAcceleration=true | agent DOM 上 `data-agentskin-glass="low"` |
| 噪点层 | 启用 glass.noise=true → 检查 ::before | backdrop 上有 SVG noise overlay |
| 生成脚本拆分 | 运行 `node scripts/generate-theme-css.mjs` | 不报 Module not found 错误 |
| WCAG 校验 | 运行 `node scripts/validate-themes.mjs --wcag` | 输出对比度报告（pass/fail per pair） |
