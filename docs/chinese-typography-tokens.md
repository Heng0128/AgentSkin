# 中文字体渲染优化 — CSS 变量扩展

> 版本：v1.0
> 日期：2026-08-29
> 关联模块：`src/shared/typography/chinese-font-optimizer.ts`
> 说明：本文档定义中文字体相关的 CSS 变量扩展集。这些变量**不修改**现有的 14-token 契约，仅作为扩展层叠加。

---

## 1. 设计背景

AgentSkin 的用户大量使用中文（traework / qoderwork / workbuddy 主要用户为中文用户）。竞品 ziyue67 / midnight-purple-2077-codex-theme 已专门针对中文 UI 字体优化。当前 AgentSkin 的 CSS 变量契约缺少中文字体相关的 token。

### 1.1 中文排版特殊性

| 特性 | 英文 | 中文 | 影响 |
|------|------|------|------|
| 字符宽度 | 比例字体，宽度不一 | 等宽方块字 | 中文需要更大行高留白 |
| 升部/降部 | 有（b/d/p/q） | 无（统一方块） | 行间距需增加 20-30% |
| 字重渲染 | 400 为标准 | 400 偏粗 | 正文建议 400，标题 500 |
| 标点符号 | 半角 | 全角（。） | 需支持全角标点 |

### 1.2 设计原则

- **不修改 14-token 契约**：所有中文变量以 `--agentskin-zh-*` 为前缀，独立于 `--agentskin-*` 色彩 token
- **平台感知**：根据 macOS / Windows / Linux 自动选择最优中文字体栈
- **上下文适配**：根据 body / heading / code / ui 场景提供不同的字重和行高

---

## 2. CSS 变量定义

### 2.1 核心变量

| 变量名 | 默认值（macOS / body） | 用途 |
|--------|----------------------|------|
| `--agentskin-zh-font-family` | `Inter, -apple-system, BlinkMacSystemFont, PingFang SC, Hiragino Sans SC, Hiragino Sans GB, Heiti SC, STHeiti, sans-serif` | 中文字体栈 |
| `--agentskin-zh-font-weight` | `400` | 中文字重 |
| `--agentskin-zh-line-height` | `1.75` | 中文行高（无单位） |
| `--agentskin-zh-letter-spacing` | `0.01em` | 中文字间距 |

### 2.2 平台差异

| 平台 | 首选字体 | 完整栈 |
|------|---------|--------|
| macOS | PingFang SC | `Inter, -apple-system, BlinkMacSystemFont, PingFang SC, Hiragino Sans SC, Hiragino Sans GB, Heiti SC, STHeiti, sans-serif` |
| Windows | Microsoft YaHei | `Inter, -apple-system, BlinkMacSystemFont, Microsoft YaHei, Microsoft YaHei UI, SimSun, SimHei, NSimSun, sans-serif` |
| Linux | Noto Sans CJK SC | `Inter, -apple-system, BlinkMacSystemFont, Noto Sans CJK SC, Noto Sans SC, WenQuanYi Micro Hei, WenQuanYi Zen Hei, Droid Sans Fallback, sans-serif` |

### 2.3 上下文差异

| 上下文 | 字重 | 行高 | 字间距 | 适用场景 |
|--------|------|------|--------|---------|
| body | 400 | 1.75 | 0.01em | 正文、段落、列表 |
| heading | 500 | 1.6 | 0.01em | 标题、小标题 |
| code | 400 | 1.7 | 0 | 代码块、内联代码 |
| ui | 400 | 1.6 | 0.01em | 按钮、标签、导航 |

---

## 3. 在主题中使用

### 3.1 基础用法

在主题的 CSS 文件中引用中文变量：

```css
/* traework.css / qoderwork.css / workbuddy.css */

/* 全局中文优化 */
.agentskin-host-traework {
  font-family: var(--agentskin-zh-font-family);
  line-height: var(--agentskin-zh-line-height);
  letter-spacing: var(--agentskin-zh-letter-spacing);
}

/* 标题优化 */
.agentskin-host-traework h1,
.agentskin-host-traework h2,
.agentskin-host-traework h3 {
  font-weight: var(--agentskin-zh-font-weight);
  line-height: 1.6;
}

/* 代码块保持 monospace */
.agentskin-host-traework code,
.agentskin-host-traework pre {
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  line-height: 1.7;
  letter-spacing: 0;
}
```

### 3.2 条件应用（基于内容检测）

当不确定内容语言时，可以使用 `shouldApplyChineseTypography()` 函数动态决定是否应用中文优化：

```typescript
import { shouldApplyChineseTypography } from 'shared/typography/chinese-font-optimizer';

// 在注入前检测内容
const elementText = targetElement.textContent || '';
if (shouldApplyChineseTypography(elementText, 0.3)) {
  targetElement.style.fontFamily = generateChineseFontStack('macos');
  targetElement.style.lineHeight = String(getOptimizedLineHeight('body'));
}
```

### 3.3 完整主题配置示例

```css
/* 在主题的 palette.css 或全局 CSS 中定义 */
:root {
  /* 14-token 契约（不变） */
  --agentskin-accent: #7C9CFF;
  --agentskin-background: #0a0a10;
  --agentskin-foreground: #e8eaf2;
  /* ... 其他 11 个 token ... */

  /* 中文扩展变量（新增） */
  --agentskin-zh-font-family: Inter, -apple-system, BlinkMacSystemFont, PingFang SC, Hiragino Sans SC, sans-serif;
  --agentskin-zh-font-weight: 400;
  --agentskin-zh-line-height: 1.75;
  --agentskin-zh-letter-spacing: 0.01em;
}
```

---

## 4. 工具函数 API

### 4.1 generateChineseFontStack(platform, options?)

生成平台感知的中文字体栈字符串。

```typescript
import { generateChineseFontStack } from 'shared/typography/chinese-font-optimizer';

// macOS 字体栈
const macStack = generateChineseFontStack('macos');
// → "Inter, -apple-system, BlinkMacSystemFont, PingFang SC, Hiragino Sans SC, Hiragino Sans GB, Heiti SC, STHeiti, sans-serif"

// 自定义 Latin 栈
const customStack = generateChineseFontStack('windows', {
  latinStack: ['SF Pro Display'],
});
```

### 4.2 getOptimizedLineHeight(context?)

获取上下文优化的行高值。

```typescript
import { getOptimizedLineHeight } from 'shared/typography/chinese-font-optimizer';

getOptimizedLineHeight('body');    // → 1.75
getOptimizedLineHeight('heading'); // → 1.6
getOptimizedLineHeight('code');    // → 1.7
getOptimizedLineHeight('ui');      // → 1.6
```

### 4.3 isChineseText(text)

检测字符串是否包含中文字符。

```typescript
import { isChineseText } from 'shared/typography/chinese-font-optimizer';

isChineseText('Hello');      // → false
isChineseText('你好');        // → true
isChineseText('Hello 你好');  // → true
```

### 4.4 shouldApplyChineseTypography(text, threshold?)

根据中文比例决定是否应用中文排版优化。

```typescript
import { shouldApplyChineseTypography } from 'shared/typography/chinese-font-optimizer';

shouldApplyChineseTypography('你好世界');    // → true (100% 中文)
shouldApplyChineseTypography('Hello 你好');  // → true (50% 中文，超过默认阈值 0.3)
shouldApplyChineseTypography('Hi 你');       // → false (33% 中文，低于默认阈值)
```

### 4.5 generateChineseTypographyCSS(platform?, context?)

生成完整的 CSS `:root {}` 块。

```typescript
import { generateChineseTypographyCSS } from 'shared/typography/chinese-font-optimizer';

const css = generateChineseTypographyCSS('macos', 'body');
// → :root {
//     --agentskin-zh-font-family: Inter, ...;
//     --agentskin-zh-font-weight: 400;
//     --agentskin-zh-line-height: 1.75;
//     --agentskin-zh-letter-spacing: 0.01em;
//   }
```

---

## 5. 与 14-token 契约的关系

### 5.1 不变量本保证

| 保证 | 说明 |
|------|------|
| 不修改现有 token | 14 个 `--agentskin-*` 色彩 token 完全不变 |
| 不新增 manifest 字段 | `manifest.json` 的 `colors` 对象不变 |
| 不新增引擎层 | 注入引擎四层架构不变 |
| 纯扩展 | 所有中文变量以 `--agentskin-zh-*` 为独立命名空间 |

### 5.2 变量命名空间

```
--agentskin-*          ← 14-token 契约（色彩，不可修改）
--agentskin-ext-*      ← 扩展色集（26 色级，已有）
--agentskin-zh-*       ← 中文排版扩展（本文档新增）
--agentskin-readable-* ← 可读性兜底（已有，contrast-utils）
```

---

## 6. 平台检测逻辑

`detectPlatform()` 函数按以下优先级检测平台：

1. **浏览器/Electron 渲染进程**：读取 `navigator.platform`
   - 包含 `mac` → `macos`
   - 包含 `win` → `windows`
   - 包含 `linux` → `linux`

2. **Node.js/Electron 主进程**：读取 `process.platform`
   - `darwin` → `macos`
   - `win32` → `windows`
   - `linux` → `linux`

3. **默认回退**：`windows`（中文桌面应用最大用户群）

---

## 7. 最佳实践

### 7.1 主题作者

1. 在 CSS 中使用 `var(--agentskin-zh-font-family)` 而非硬编码字体
2. 为 heading 元素单独设置 `line-height: 1.6`（更紧凑）
3. 代码块使用 `line-height: 1.7` 和 `letter-spacing: 0`
4. 不要覆盖 `--agentskin-zh-*` 变量，除非有明确的设计理由

### 7.2 引擎集成

1. 在 `engine-strategy` 中注入中文变量时，使用 `generateChineseTypographyCSS()` 生成 CSS
2. 在 `adapter.mjs` 中检测内容语言，按需应用中文优化
3. 中文变量应注入到 `adoptedStyleSheets` 的 `tokens` 层

### 7.3 性能注意

- `isChineseText()` 使用正则匹配，时间复杂度 O(n)，适合单次检测
- 避免在 MutationObserver 回调中对每个文本节点调用检测
- 建议在注入前批量检测，缓存结果

---

## 8. 测试覆盖

`src/shared/typography/chinese-font-optimizer.test.ts` 提供以下测试：

| 测试组 | 用例数 | 覆盖内容 |
|--------|--------|---------|
| generateChineseFontStack | 6 | 三平台字体栈生成、自定义选项 |
| getChineseStackForPlatform | 3 | 平台到字体栈映射 |
| getOptimizedLineHeight | 5 | 四上下文行高值 |
| getOptimizedFontWeight | 4 | 四上下文字重值 |
| isChineseText | 7 | 中文/英文/混合/标点/空串 |
| chineseTextRatio | 4 | 中文比例计算 |
| shouldApplyChineseTypography | 4 | 阈值判断 |
| getChineseTypography | 3 | 完整配置生成 |
| generateChineseTypographyCSS | 5 | CSS 输出格式 |
| cross-platform coverage | 4 | 平台栈完整性 |

**总计：45 个测试用例**
