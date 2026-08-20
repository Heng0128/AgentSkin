# Radix UI Colors 色彩架构深度分析

> 分析日期: 2026-06-16
> 数据源: github.com/radix-ui/colors (v3.0.0) + radix-ui.com/colors/docs
> 分析目标: 提炼 Radix 12 步色阶系统的设计思想与 AgentSkin 可借鉴点

---

## 1. 项目结构总览

```
@radix-ui/colors v3.0.0
├── src/
│   ├── light.ts       // 亮色模式所有色相 (58KB)
│   ├── dark.ts        // 暗色模式所有色相 (58KB)
│   ├── blackA.ts      // 通用黑色透明叠加层 (rgba)
│   ├── whiteA.ts      // 通用白色透明叠加层 (rgba)
│   └── index.ts       // 统一导出
└── scripts/
    └── build-css-modules.js  // CSS 变量输出

每个色相 × 4 个文件:
  {color}         // 纯色 sRGB hex
  {color}A        // 透明色 sRGB hex+alpha
  {color}P3      // 纯色 display-p3 宽色域
  {color}P3A     // 透明色 display-p3 宽色域
```

**关键事实**: 每个色相一次性导出 4 个变体 (sRGB纯色 / sRGB透明 / P3纯色 / P3透明)，通过独立 ts 文件提供亮/暗两套。

---

## 2. 完整色相列表

### 中性灰系列 (6 个)
| 色相 | 特征 |
|------|------|
| gray | 纯中性灰 |
| mauve | 带紫调的灰 (Dusty purple) |
| slate | 带蓝调的灰 (Cool gray) |
| sage | 带绿调的灰 (Sage green gray) |
| olive | 带黄绿调的灰 (Muted olive) |
| sand | 带暖黄调的灰 (Warm sand gray) |

### 彩色系列 (21 个)
| 色相 | 特征 |
|------|------|
| tomato | 偏橙的红 (Tomato orange-red) |
| red | 标准红 |
| ruby | 偏玫红的红 |
| crimson | 深玫红 |
| pink | 亮粉 |
| plum | 暗紫红 |
| purple | 标准紫 |
| violet | 蓝紫色 (Vivid violet) |
| iris | 中蓝紫 |
| indigo | 靛蓝 |
| blue | 标准蓝 |
| cyan | 青蓝 (Cyan) |
| teal | 青绿 (Teal) |
| jade | 玉绿 (Jade green) |
| green | 标准绿 |
| grass | 草绿 (Yellow-green) |
| brown | 棕色 |
| bronze | 青铜色 (Bronze) |
| gold | 金色 (Gold) |
| sky | 天蓝 (Light blue) |
| mint | 薄荷绿 (Mint green) |
| lime | 酸橙绿 (Bright lime) |
| yellow | 黄色 |
| amber | 琥珀橙 (Amber orange) |
| orange | 橙色 |

总计 **27 个色相** × 12 步 × 4 变体 × 2 模式 = **2592 个颜色值**。

---

## 3. 12 步色阶语义分工图

这是 Radix Colors 最核心的设计创新。每一步都有明确的语义定位：

```
+------------+-------------------------+---------------------------------------+
|  步骤      |  语义角色                |  典型应用场景                          |
+============+=========================+=======================================+
|   1        |  应用底色               |  页面/CSS根级背景                     |
|   2        |  微妙底色               |  Card/Sidebar/弹窗背景                |
+------------+-------------------------+---------------------------------------+
|   3        |  组件背景 (默认)         |  按钮/输入框/Tab 默认态背景            |
|   4        |  组件背景 (悬停)         |  按钮/输入框 Hover 态背景              |
|   5        |  组件背景 (激活)         |  按钮按下 / 选中态 / 按压态            |
+------------+-------------------------+---------------------------------------+
|   6        |  微弱边框/分隔线         |  非交互组件边框:卡片/头部/分隔符        |
|   7        |  交互组件边框            |  输入框/按钮常态边框 + focus ring      |
|   8        |  强化边框               |  输入框/按钮 Hover 态边框              |
+------------+-------------------------+---------------------------------------+
|   9        |  纯色背景               |  主按钮/徽标/Overlay/阴影/强调边框     |
|   10       |  纯色背景(悬停)          |  主按钮 Hover 态背景                   |
+------------+-------------------------+---------------------------------------+
|   11       |  低对比度文本            |  次要文本/占位符/辅助说明              |
|   12       |  高对比度文本            |  主标题/正文/关键文本                  |
+------------+-------------------------+---------------------------------------+
```

### 12 步的设计逻辑 (为什么是 12 步)

```
Layer 0 — Backgrounds     (2步):  1-2   -> 从白到浅灰的细微变化
Layer 1 — Interactive BG  (3步):  3-5   -> 组件 默认/悬停/激活 三态
Layer 2 — Borders         (3步):  6-8   -> 非交互边框 / 交互边框 / 强化边框
Layer 3 — Solids          (2步):  9-10  -> 纯色态 + 纯色悬停态
Layer 4 — Text            (2步):  11-12 -> 次要文本(>=Lc60) + 主文本(>=Lc90)
```

**为什么是 12 步 (vs Catppuccin 的 5 步)**:

1. **交互态覆盖**: Catppuccin 5 步只覆盖"深浅"，无法区分默认/悬停/激活三态。Radix 用 5 步 (3-5) 单独覆盖组件交互背景。
2. **边框层级**: Catppuccin 没有独立的边框步骤。Radix 用 3 步 (6-8) 分离非交互边框、交互边框、强化边框。
3. **文本对比度**: Radix 的 11-12 步是**以 APCA 对比度为硬约束**设计的 (11=Lc60, 12=Lc90)。Catppuccin 没有对比度保障机制。
4. **语义完整性**: 12 步覆盖了 UI 的全部色彩需求层 —— 背景、交互、边框、纯色、文本。Catppuccin 的 5 步仅覆盖"配色美感"维度。

---

## 4. APCA 对比度保障体系

这是 Radix 与市面上大多数色板系统的**最关键区别**。

### APCA vs WCAG 2.x

| 标准 | 算法本质 | 暗色模式适用性 |
|------|----------|----------------|
| WCAG 2.x | 基于相对亮度的线性公式 | 差 — 暗色下对比度预测失真 |
| APCA (WCAG 3.0草案) | 基于人眼感知的非感知模型 | 优 — 专为多模式设计 |

### Radix 的对比度硬约束

```
Step 11 (低对比度文本) — 保证 Lc 60 APCA (~ WCAG 4.5:1)
Step 12 (高对比度文本) — 保证 Lc 90 APCA (~ WCAG 7:1)

关键特性:
  - Step 11/12 保证在其同色相 Step 2 背景上的对比度
  - 即: 在任何色相中，{color}-11 文本放在 {color}-2 背景上，对比度 >= Lc60
  - 即: 在任何色相中，{color}-12 文本放在 {color}-2 背景上，对比度 >= Lc90
  - Step 9 色在白色文本上对 Sky/Mint/Lime/Yellow/Amber 特殊处理为深色文本
```

这意味着选择正确的步骤组合即可**天然保证可访问性**，无需手动调试对比度。

---

## 5. 暗色模式步进策略

观察 light.ts 与 dark.ts 的 gray 色相：

```typescript
// Light mode (从白到黑)
gray1:  "#fcfcfc"   // 最亮 — 背景
gray12: "#202020"   // 最深 — 文本

// Dark mode (从黑到白)
gray1:  "#111111"   // 最暗 — 背景
gray12: "#eeeeee"   // 最亮 — 文本
```

**设计原则**: 语义编号不变 × 数值反转

```
Light Step 1 = 最亮  -> Dark Step 1 = 最暗
Light Step 12 = 最深  -> Dark Step 12 = 最亮

语义层镜像映射:
  Light Step 1 (背景)   = Dark Step 1 (背景)
  Light Step 12 (文本)  = Dark Step 12 (文本)
```

Radix 为每个色相独立生成 dark 变体，而非简单反转 HSL。这保证了：
- 蓝色色相在暗色下仍保持视觉正确的色相偏移
- 饱和度在不同明度级上按感知均匀性调整

---

## 6. Alpha 透明变体系统

### 实现方式

```
{color}A:  sRGB hex + alpha channel
{color}P3A: display-p3 + alpha channel

例: grayA1 = "#00000000" (完全透明黑)
    grayA12 = "#000000df" (92% 不透明黑)
```

### 叠加层语义

Radix 将透明层分为两类：

```
通用叠加层 (不绑定色相):
  blackA1-12: rgba(0,0,0, [0.05..0.95])  — 亮色模式上叠用
  whiteA1-12: rgba(255,255,255,[0.05..0.95]) — 暗色模式上叠用

色相透明层 (绑定具体色相):
  {color}A1-12: 低饱和度 + 透明度 — 用于悬浮/高亮/遮罩
```

**设计意图**: 
- `blackA/whiteA` 用于不改变色相只需变亮/变暗的通用场景 (如阴影、遮罩)
- `{color}A` 用于需要特定色相透明度的场景 (如红色警告边框悬停态)

---

## 7. P3 广色域支持

每个色相都导出 `color(display-p3 ...)` 格式：

```css
/* sRGB fallback + P3 override */
.example {
  background-color: #e54d2e;                    /* sRGB */
  background-color: color(display-p3 0.831 0.345 0.231);  /* P3 */
}
```

**意义**: P3 色域比 sRGB 大 25%，在支持的显示器上呈现更鲜艳的颜色。Radix 的策略是 sRGB 为兜底、P3 为增强，不影响不支持 P3 的设备。

---

## 8. 命名规范

### 色相命名

```
规则: 全小写英文单词，直接描述自然色相
避免: camelCase、kebab-case 后缀

正确:  gray, slate, tomato, crimson, violet, amber
避免:  grayColor, slate-1, TomatoRed
```

### 步骤命名

```
规则: {色相名}{步骤数字} (无分隔符)
例:   gray1, gray12, tomato9, slateA5

透明变体: {色相名}A{步骤数字}
例:   grayA1, grayA12

P3 变体: {色相名}P3 + {步骤数字}
例:   grayP3-1, tomatoP3-9
P3 透明: {色相名}P3A + 步骤数字
例:   grayP3A-1, tomatoP3A-9
```

---

## 9. 对 AgentSkin 的借鉴点

### 9.1 可直接借鉴的设计思想

#### (a) APCA 对比度硬约束
AgentSkin 的 14-token 契约中，text tokens 应明确嵌入对比度承诺。建议：

```
当前: text-primary / text-secondary / text-muted
改进:  text-lc60 / text-lc90  (或暴露 APCA 数值)

约束规则: 
  - text-secondary (step 11-like) 必须 >= Lc 60 在其对应 BG 上
  - text-primary (step 12-like)   必须 >= Lc 90 在其对应 BG 上
```

#### (b) 12 步语义分层 → 将 14-token 扩展色按语义编号

14-token 契约 (neutral + 3 accents) 中的 accent 颜色可以从当前的单色声明扩展为有语义编号的色阶：

```
当前:
  accent: "#3b82f6"                    // 仅单色

建议:
  accent-bg:      accent-3             // 组件背景
  accent-bg-hover: accent-4            // 悬停背景
  accent-border:  accent-7             // 交互边框
  accent-solid:   accent-9             // 纯色
  accent-text:    accent-11            // 低对比度文本
  accent-text-hi: accent-12            // 高对比度文本
```

#### (c) Alpha 变体独立管理
AgentSkin 的透明效果应从当前硬编码 alpha 改为使用 Radix 风格的独立 alpha token：

```
// 当前 (潜在问题):
color-mix(in srgb, var(--accent) 60%, transparent)

// 建议 (参考 Radix):
--accent-a9: color-mix(in srgb, var(--accent-solid) 60%, transparent)
// 或存储独立 alpha hex: #3b82f699
```

#### (d) 12 → 14 扩展映射方案

Radix 的 12 步如何映射到 AgentSkin 的 14-token 契约：

| Radix 步骤 | 14-Token 对应 | 说明 |
|-----------|---------------|------|
| 1-2 | bg-base / bg-subtle | 已有对应，无需改动 |
| 3-5 | bg-interactive-* | AgentSkin 当前只有 bg-active，可扩展 bg-default/bg-hover/bg-active |
| 6-8 | border-* | AgentSkin 有 border-subtle/border-strong，可补 border-interactive |
| 9-10 | accent-solid / accent-hover | 当前 accent 单一值 → 拆为两值 |
| 11-12 | text-lc60 / text-lc90 | 嵌入对比度约束 |
| **额外** | 增加 2 步 | AgentSkin 相比 Radix 多的 2 token 可以是 solid-text (step 9上的文字颜色) 和 focus-ring (step 8 的特殊 use) |

### 9.2 架构层面的借鉴

#### (e) 亮/暗双文件模式
```
当前 AgentSkin: 单一 CSS 变量集 + 媒体查询切换
参考 Radix:    light.ts + dark.ts 独立文件，避免 :is(.dark) 嵌套
              生成更清晰、无 specificity 问题
```

#### (f) P3 兜底策略
```
@supports (color: color(display-p3 1 1 1)) {
  :root { --accent-p3: color(display-p3 ...) }
}
不支持 P3 的设备自动回退到 sRGB
```

#### (g) 应用语义编号而非光影描述
```
// 不推荐:
--accent-light: #93c5fd;
--accent-dark:  #1d4ed8;

// 推荐 (Radix 方式):
--accent-3: #93c5fd;
--accent-9: #1d4ed8;
```

语义编号跨模式一致性更高 —— Step 9 永远是"纯色主色"，无论亮色暗色模式。

---

## 10. 不适合 AgentSkin 的部分

### (a) 27 色相的过度丰富
AgentSkin 作为注入式主题引擎，仅需 1 套中性灰 + 3-4 套 accent 色相。加载 27 个色相的 sRGB + P3 + alpha 三套文件将造成不必要的 CSS 体积膨胀。

**建议**: 移植 12 步语义编号体系，但只生成 neutral + accent 所需的 4-5 个色相。

### (b) 静态 CSS 变量非动态注入场景
Radix 设计为静态 CSS 变量注入场景（编译时确定）。AgentSkin 的核心运行时是 CDP 注入 + JS 动态覆盖 CSS 变量。这意味着：
- Radix 的 TypeScript 色板文件不是 AgentSkin 直接消费形式
- 需要从 Radix 的数值提取后转写为 AgentSkin 的 token 格式

### (c) 文件粒度过细
Radix 每个色相思 4 个文件 (light/dark + 4 variants) = 108 个文件。对于 AgentSkin 应当合并为：
```
themes/neutral/12-step.ts    // 中性色 12 步 + alpha/P3
themes/accent/{brand}.ts     // 单个 accent 色相的 12 步 + alpha/P3
```

### (d) 对比度数值的绝对性
APCA Lc 60/90 约束对内容文本有意义，但对装饰性元素（图标、分割线、阴影）可能过度严格。AgentSkin 的工具型 UI 中部分装饰元素不需要强制满足 Lc 60。

---

## 11. 总结: AgentSkin 改造建议清单

| # | 改造项 | 优先级 | 工作量 |
|---|--------|--------|--------|
| 1 | 在 theme store 中嵌入 APCA 对比度约束定义 | P0 | 中 |
| 2 | 将 accent 单 token 扩展为 6 token 阶梯 (bg/bg-hover/border/solid/text/text-hi) | P0 | 中 |
| 3 | 独立管理 alpha token (从硬编码 mix 改为独立变量) | P1 | 低 |
| 4 | 将 light/dark 主题拆为独立文件 | P1 | 低 |
| 5 | 引入 P3 广色域兜底 (渐进增强) | P2 | 低 |
| 6 | 为 border 增加第三步 (border-interactive) | P2 | 低 |

---

## 附录 A: Radix 12 步 → CSS 变量命名参考

```
--accent-1:  ; /* App background (solid)  */
--accent-2:  ; /* Subtle bg (solid)        */
--accent-3:  ; /* UI element bg             */
--accent-4:  ; /* Hovered UI element bg     */
--accent-5:  ; /* Active UI element bg      */
--accent-6:  ; /* Subtle border             */
--accent-7:  ; /* UI element border/focus   */
--accent-8:  ; /* Hovered border            */
--accent-9:  ; /* Solid bg (highest chroma) */
--accent-10: ; /* Hovered solid bg          */
--accent-11: ; /* Low-contrast text (Lc 60) */
--accent-12: ; /* High-contrast text (Lc 90)*/

--accent-a1  through --accent-a12  /* Alpha variants */
```

---

*分析完成。请结合 AgentSkin 的 14-token 契约 (THEME_SPEC.md) 对照阅读。*
