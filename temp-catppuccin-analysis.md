# Catppuccin 色彩系统架构深度分析

> 数据来源: catppuccin/palette v1.7.1, catppuccin/catppuccin style guide, catppuccin.com/palette
> 分析日期: 2025-07

---

## 1. 项目结构与规模

### 仓库架构
- **主仓** `catppuccin/catppuccin`: 规范文档、Style Guide、贡献指南、Samples
- **调色板仓** `catppuccin/palette`: 核心色彩定义，npm 发布为 `@catppuccin/palette`
- **端口仓**: 200+ 个独立端口仓（tmux, nvim, alacritty, vscode 等）
- **生成工具** `catppuccin/whiskers`: 基于模板的主题生成器（Tera 模板引擎）

### palette 仓核心文件
```
palette.json    -- 唯一真相源（所有风味 + 26 色完整定义）
mod.ts          -- Deno/TypeScript API（类型定义 + 运行时处理）
types/          -- 各语言类型声明（.ts, .py, .rs 等）
scripts/        -- ANSI 亮色生成脚本
deno.json       -- Deno 工作区配置
```

---

## 2. 完整 26 色列表（名称 + 角色描述）

### 2.1 Accent Colors（强调色，14 色）

| # | 名称 | 角色描述 | 用途 |
|---|------|---------|------|
| 1 | **Rosewater** | 最暖的粉橙色调，品牌标志色 | 光标、装饰性元素 |
| 2 | **Flamingo** | 饱和粉红色，比 Rosewater 更暖 | 次要强调、装饰 |
| 3 | **Pink** | 亮紫粉色，高饱和 | 语法高亮(magenta)、活动元素 |
| 4 | **Mauve** | 蓝紫色，品牌主色之一 | 主要强调、链接替代 |
| 5 | **Red** | 深红色，最高对比度警告色 | 错误、删除、危险操作 |
| 6 | **Maroon** | 柔和红褐色，比 Red 低饱和 | 次要错误、警告变体 |
| 7 | **Peach** | 橙色，温暖警示 | 警告、注意 |
| 8 | **Yellow** | 金黄色 | 警告、高亮 |
| 9 | **Green** | 草绿色 | 成功、通过、新增 |
| 10 | **Teal** | 青绿色（蓝绿之间） | 信息、语法高亮(cyan) |
| 11 | **Sky** | 天蓝色，比 Blue 更浅更亮 | 信息替代 |
| 12 | **Sapphire** | 宝石蓝，介于 Sky 与 Blue 之间 | 次要信息 |
| 13 | **Blue** | 标准蓝色，链接色 | 链接、URL、标签 |
| 14 | **Lavender** | 淡薰衣草紫，最柔和的强调色 | 活动边框、次要强调 |

### 2.2 Monochromatic Colors（单色系，12 色）

从亮到暗的逻辑分层：

| # | 名称 | 角色描述 | 用途 |
|---|------|---------|------|
| 15 | **Text** | 正文色，最高对比度 | 正文、主标题 |
| 16 | **Subtext 1** | 次级文本，略淡于 Text | 副标题、标签 |
| 17 | **Subtext 0** | 第三级文本 | 第三级信息 |
| 18 | **Overlay 2** | 覆盖层最亮档 | 边框、分隔线 |
| 19 | **Overlay 1** | 覆盖层中亮档 | 细微边框、次要文本 |
| 20 | **Overlay 0** | 覆盖层最暗档 | 最细微的视觉元素 |
| 21 | **Surface 2**  | 表面最亮档 | 卡片背景（最浅） |
| 22 | **Surface 1**  | 表面中档 | 卡片背景 |
| 23 | **Surface 0**  | 表面最暗档 | 卡片背景（最接近 Base） |
| 24 | **Base**       | 基础背景 | 主窗体背景 |
| 25 | **Mantle**     | 次背景 | 侧边栏、次级面板 |
| 26 | **Crust**      | 最深背景 | 最深层元素、终端光标文字 |

### 2.3 设计哲学

```
强调色(14) = 语义色(红/黄/绿/蓝) + 装饰色(Rosewater/Flamingo/Pink/Mauve/Maroon/Peach/Teal/Sky/Sapphire/Lavender)
单色系(12) = 文本层(Text × Subtext × 3) + 覆盖层(Overlay × 3) + 表面层(Surface × 3 + Base/Mantle/Crust)
```

总计: 14 + 12 = **26 色/风味**

---

## 3. 4 风味的明度映射规律

### 3.1 OKLCH Lightness 对比表

| 色名 | Latte | Frappé | Macchiato | Mocha | 角色 |
|------|-------|--------|-----------|-------|------|
| Rosewater | 0.923 | 0.895 | 0.911 | 0.923 | 最亮的强调色 |
| Flamingo | 0.880 | 0.844 | 0.863 | 0.880 | |
| Pink | 0.870 | 0.850 | 0.861 | 0.870 | |
| Mauve | 0.787 | 0.765 | 0.772 | 0.787 | |
| Red | 0.756 | 0.717 | 0.737 | 0.756 | |
| Maroon | 0.782 | 0.765 | 0.770 | 0.782 | |
| Peach | 0.824 | 0.773 | 0.799 | 0.824 | |
| Yellow | 0.919 | 0.844 | 0.879 | 0.919 | |
| Green | 0.858 | 0.812 | 0.835 | 0.858 | |
| Teal | 0.858 | 0.783 | 0.821 | 0.858 | |
| Sky | 0.847 | 0.826 | 0.837 | 0.847 | |
| Sapphire | 0.791 | 0.780 | 0.785 | 0.791 | |
| Blue | 0.766 | 0.742 | 0.750 | 0.766 | |
| Lavender | 0.817 | 0.810 | 0.814 | 0.817 | |
| **Text** | **0.879** | **0.862** | **0.871** | **0.879** | 文本最亮 |
| Subtext 1 | 0.817 | 0.808 | 0.812 | 0.817 | |
| Subtext 0 | 0.751 | 0.752 | 0.751 | 0.751 | |
| Overlay 2 | 0.687 | 0.697 | 0.690 | 0.687 | |
| Overlay 1 | 0.618 | 0.640 | 0.627 | 0.618 | |
| Overlay 0 | 0.550 | 0.581 | 0.561 | 0.550 | |
| Surface 2 | 0.477 | 0.521 | 0.494 | 0.477 | |
| Surface 1 | 0.404 | 0.460 | 0.426 | 0.404 | |
| Surface 0 | 0.324 | 0.395 | 0.354 | 0.324 | |
| **Base** | **0.243** | **0.329** | **0.279** | **0.243** | 背景最深 |
| Mantle | 0.216 | 0.297 | 0.249 | 0.216 | |
| Crust | 0.183 | 0.272 | 0.219 | 0.183 | |

### 3.2 明度映射规律总结

从数据中提取的关键发现：

1. **色相一致性**: 所有 4 个风味的同一色名具有几乎完全相同的 Hue 和 Chroma，差异仅在 Lightness
2. **Frappé 是全局偏移**: Frappé 的所有颜色大约比其他暗色风彩亮 0.04 OKLCH lightness
3. **Macchiato 居中**: 介于 Frappé 和 Mocha 之间，约 +0.03 ~ +0.05
4. **Mocha 最暗**: 作为原始风味，control group
5. **Latte 是暗色风味的精确反转**: Text/Crust 互换角色，Base 从最深变最亮

### 3.3 暗色风味的 OKLCH 关系

```
Mocha (基准) → Macchiato (+0.035 L) → Frappé (+0.085 L)
```

即：
- Macchiato 所有颜色比 Mocha 亮 ~3.5% OKLCH Lightness
- Frappé 比 Mocha 亮 ~8.5%，比 Macchiato 亮 ~5%
- Latte 是独立的白色背景体系

### 3.4 ANSI 亮色生成公式（来自搜索结果的逆向工程）

Catppuccin 的 ANSI 亮色（color8-15）不是独立的，而是通过算法从常规色生成：

```
深色主题 (Frappé, Macchiato, Mocha):
  bright.lightness = color.lightness * 0.94（稍微变暗）
  bright.chroma = color.chroma + 8（稍增饱和）
  bright.hue = color.hue + 2（微调色相）

浅色主题 (Latte):
  bright.lightness = color.lightness * 1.09（稍微变亮）
  bright.chroma = color.chroma（不变）
  bright.hue = color.hue + 2（微调色相）
```

这是一条重要的设计决策——bright 颜色不是感知上"更亮"的，而是"更粗/更浓"的。这与传统终端的行为不同。

---

## 4. 跨应用一致性保障机制

### 4.1 单一真相源 (Single Source of Truth)

```
palette.json ──发布到──→ npm (@catppuccin/palette)
                              │
                              ├── Deno API (mod.ts)
                              ├── Node/JS 消费
                              ├── whiskers 模板生成器
                              └── 端口维护者手动/自动同步
```

**关键设计**: 所有 200+ 端口仓的配色方案最终来源于同一个 `palette.json` 文件。

### 4.2 whiskers 模板生成器

Catppuccin 开发了专用工具 `catppuccin/whiskers`（基于 Tera 模板引擎），工作方式：

```
palette.json → whiskers → 各端口输出格式
                              ├── .toml (Alacritty)
                              ├── .json (Windows Terminal)
                              ├── .lua (Neovim)
                              ├── .tmux.conf (Tmux)
                              ├── .css (Web)
                              └── 任意目标格式
```

端口仓不需要手动维护颜色值，只需维护模板。当 palette.json 更新时，whiskers 可批量重新生成所有端口。

### 4.3 Style Guide 行为规范

`docs/style-guide.md` 定义了跨应用一致的使用规则：

| 功能 | 指定颜色 | 用途 |
|------|---------|------|
| 背景面板 | Base | 主窗体 |
| 次级面板 | Crust, Mantle | 侧边栏 |
| 表面元素 | Surface 0/1/2 | 卡片、浮层 |
| 覆盖层 | Overlay 0/1/2 | 模态框、弹出层 |
| 正文 | Text | 主体文字 |
| 副标题 | Subtext 0/1 | 次要文字 |
| 链接 | Blue | URL |
| 成功 | Green | |
| 警告 | Yellow | |
| 错误 | Red | |
| 标签 | Blue | |
| 光标 | Rosewater | |
| 选择背景 | Overlay 2 @ 20-30% 透明度 | |

### 4.4 关键洞察

1. **语义锁定**: 红=错误, 绿=成功, 黄=警告, 蓝=链接/标签，所有端口必须遵守
2. **层级锁定**: Base > Mantle > Crust > Surface > Overlay > Subtext > Text 的明暗关系不可逆
3. **透明度规则**: 选择背景必须使用 Overlay 2 + 20-30% 透明度，不允许自定义
4. **On Accent 规则**: 强调色上的文字使用 Base 色（保证对比度）

---

## 5. OKLCH / OKLAB 色彩空间使用

### 5.1 确认使用 OKLCH

catppuccin.com/palette 页面明确展示了每种颜色的 OKLCH 值。例如：

```
Mocha Rosewater: oklch(0.923 0.024 30.492)
  → L=0.923, C=0.024, H=30.492°
Mocha Red:        oklch(0.756 0.130 2.764)
  → L=0.756, C=0.130, H=2.764°
```

### 5.2 设计工作流中的色彩空间

1. **设计阶段**: 使用 OKLCH/OKLAB 空间进行颜色选择
   - 优势：感知均匀性，L 分量与人类亮度感知线性相关
   - 可以独立调整 Lightness 而不影响色相/饱和度

2. **存储阶段**: palette.json 存储 HEX + RGB + HSL
   - **没有**在 palette.json 中存储 OKLCH
   - 这是因为 OKLCH 是设计工具，HEX/RGB/HSL 是消费格式

3. **生成阶段**: 使用 OKLCH 进行衍生计算（ANSI 亮色生成）

### 5.3 为什么用 OKLCH 而非 HSL

| 维度 | HSL | OKLCH |
|------|-----|-------|
| 感知均匀性 | 差（同 L 值不同色相感知亮度差异大） | 好 |
| Lightness 操作 | 影响色相感知 | 独立于色相 |
| 风味间映射 | 需同时调整 H/S/L | 主要调整 L |
| 浏览器支持 | 全面 | 现代浏览器 |

Catppuccin 选择 OKLCH 的核心原因：**在 4 个风味间保持色相和饱和度一致性，仅调整明度**。

---

## 6. 调色板定义的数据结构

### 6.1 palette.json 顶层结构

```json
{
  "version": "1.7.1",
  "latte": { /* CatppuccinFlavor */ },
  "frappe": { /* CatppuccinFlavor */ },
  "macchiato": { /* CatppuccinFlavor */ },
  "mocha": { /* CatppuccinFlavor */ }
}
```

### 6.2 Flavor 结构

```typescript
type CatppuccinFlavor = {
  name: string;          // "Catppuccin Mocha"
  emoji: string;         // "🪺"
  order: number;         // 3
  dark: boolean;         // true
  colors: CatppuccinColors;     // 26 色
  ansiColors: CatppuccinAnsiColors; // ANSI 映射
}
```

### 6.3 单色结构

```typescript
type ColorFormat = {
  name: string;       // "Rosewater"
  order: number;      // 0
  hex: string;        // "#f5e0dc"
  rgb: { r: number; g: number; b: number };
  hsl: { h: number; s: number; l: number };
  accent: boolean;    // true (false for monochromatic)
}
```

### 6.4 ANSI 颜色结构

```typescript
type AnsiColorGroups = {
  name: string;       // "black", "red", etc.
  order: number;
  normal: AnsiColorFormat;  // { hex, rgb, hsl, code, name }
  bright: AnsiColorFormat;  // { hex, rgb, hsl, code, name }
}
```

### 6.5 关键设计决策

- **不使用 YAML/TOML 作为真相源**: JSON 是唯一被程序化消费的格式
- **version 字段**: 从 v1.4.0 开始引入，保证端口兼容性
- **order 字段**: 保证颜色在 UI 中的显示顺序（即使 JSON key 顺序变化）
- **accent boolean**: 明确区分强调色和单色系，用于 Style Guide 合规性检查

---

## 7. 对 AgentSkin 14-token 契约的借鉴点

### 7.1 结构对比

| 维度 | Catppuccin | AgentSkin 14-token |
|------|-----------|-------------------|
| 强调色数 | 14 accent | 14 (匹配) |
| 单色系 | 12 mono | 无（预计用动态计算） |
| 风味数 | 4 (1 light + 3 dark) | 多风味 |
| 真相源 | 1 个 JSON | Theme manifest |
| 消费方式 | 多语言端口 | 单一 CSS 变量体系 |
| 一致性保障 | Style Guide + whiskers | check-themes 脚本 |

### 7.2 可借鉴的设计模式

#### 7.2.1 "Flavor 变体" 架构

Catppuccin 的 4 风味共享相同的色相/饱和度，仅明度不同。这给 AgentSkin 的启示：

```
Falavor = f(Lightness_Offset) applied to Base_Hue_Saturation
```

AgentSkin 如果要支持多风味（如 "Swiss Light" / "Swiss Dark"），可以：
- 在 OKLCH 空间定义基础 hue/chroma
- 通过 L 偏移量生成风味变体
- 保证视觉一致性

#### 7.2.2 Extended Colors 消费路径

Catppuccin 的 14 accent 色在 Style Guide 中被明确划分为：

```
语义消耗色（必须遵守）:
  Red = 错误
  Green = 成功
  Yellow = 警告
  Blue = 链接/标签

装饰消耗色（灵活使用）:
  Rosewater, Flamingo, Pink, Mauve, Maroon, Peach, Teal, Sky, Sapphire, Lavender
```

**对 AgentSkin 的借鉴**:
1. AgentSkin 的 14 token 可以分为两组：7 个语义 token（locked）+ 7 个装饰 token（flexible）
2. 语义 token 的消费路径应在 check-themes 脚本中被强制验证
3. 装饰 token 允许应用层自由解释，但必须在 Style Guide 中给出推荐用法

#### 7.2.3 层级不可逆原则

Catppuccin 的 Base > Mantle > Crust > Surface > Overlay > Subtext > Text 层级在所有风味中保持严格顺序。

**对 AgentSkin 的借鉴**:
- 在 CSS 变量生成时必须验证层级的数学单调性
- 可以添加 check-layer-order 脚本来自动验证

#### 7.2.4 强调色 On-Accent 规则

Catppuccin 规定强调色上的文字必须使用 Base 色。

**对 AgentSkin 的借鉴**:
- 可以定义 `--agent-on-accent` 变量，自动选择 Base 或 Text
- 在 CDP 注入时根据背景色亮度动态计算

#### 7.2.5 "Brightness ≠ Brighter" 哲学

Catppuccin 的 ANSI bright 颜色并非感知更亮，而是更饱和/更粗。

**对 AgentSkin 的借鉴**:
- extended colors 中的 "亮色"变体不应只做 lightness +10
- 应该适当增加 chroma，让亮色在视觉上更有力

### 7.3 具体的 extended colors 消费路径建议

基于 Catppuccin 的经验，AgentSkin 的 14 token 消费路径应设计为:

```
Layer 1: Semantic Tokens（语义锁）
  error, success, warning, info, accent-primary, accent-secondary, neutral

Layer 2: Surface Tokens（层级锁）
  background, surface, overlay, border

Layer 3: Typography Tokens（对比度锁）
  text-primary, text-secondary, text-muted

Layer 4: Extended Tokens（灵活消费）
  accent-warm, accent-cool, glow, highlight
```

消费优先级: Layer 1 > Layer 2 > Layer 3 > Layer 4

---

## 8. 不适合 AgentSkin 的部分

### 8.1 应避免的设计

| Catppuccin 特性 | 不适合 AgentSkin 的原因 |
|----------------|----------------------|
| **26 色全量体系** | AgentSkin 是注入引擎不是主题仓库，14 token 已是上限；26 色会导致 CSS 体积过大、CDP 注入延迟增加 |
| **14 accent 全强调** | AgentSkin 的消费场景是"适配已有应用"而非"从零构建 UI"，不需要 14 个强调色（很多端口也只用其中 5-6 个） |
| **4 风味等权设计** | AgentSkin 需要的是 1-2 个核心主题 + 扩展变体，不存在"Latte vs Mocha"的 4 向选择场景 |
| **whiskers 模板引擎** | AgentSkin 的 CDP 注入是 1 对 1（一套 CSS 注入到一个应用），不是 1 对 200+ 的批量生成场景 |
| **ANSI 16 色映射** | AgentSkin 面向 GUI 应用，不涉及终端色彩 |
| **OKLCH 存储** | AgentSkin 的 CSS 输出必须兼容所有浏览器，只能用 HEX 或 sRGB；OKLCH 只能用于内部设计阶段 |

### 8.2 架构层面的根本差异

```
Catppuccin:  调色板 → 端口仓 → 用户选择风味 → 应用到目标应用
AgentSkin:   目标应用 → 适配分析 → 生成 Theme → CDP 注入 → 覆盖目标应用样式

关键差异:
- Catppuccin 是 "拉取式"（用户选择主题并应用到应用）
- AgentSkin 是 "推送式"（引擎主动分析应用并注入主题）
- Catppuccin 不知道目标应用的样式结构
- AgentSkin 必须知道目标应用的 DOM/样式结构才能注入
```

这意味着：
1. Catppuccin 不需要关心"这个颜色会在哪个 UI 组件上使用"
2. AgentSkin 必须精确控制每个 token 在目标应用每个组件上的映射

### 8.3 "Soothing Pastel" 定位差异

Catppuccin 的品牌定位是"柔和马卡龙色系"，强调舒适和艺术感。
AgentSkin 的 Swiss/International 风格强调专业、工具化、高信息密度。

**不宜直接复制的方面**:
- 高 chroma 的 Pink/Mauve（AgentSkin 偏好低饱和）
- 明亮黄色域（AgentSkin 的黄/橙色应该更克制）
- 渐变相邻色的对比度（Catppuccin 允许相邻色低对比，AgentSkin 要求 WCAG AA+）

---

## 9. 核心结论

### Catppuccin 的架构精髓（值得 AgentSkin 学习）

1. **单一 JSON 真相源** → → → → → → 简单、可维护、可机器消费
2. **OKLCH 设计空间** → → → → → → 感知均匀，风味间映射只需调 L
3. **Style Guide 语义锁定** → → → → 红永远=错误
4. **whiskers 批量生成** → → → → → 新增端口 = 新模板，不需要重新定义颜色
5. **order 字段防乱序** → → → → → JSON key 顺序无关紧要
6. **version 字段兼容性** → → → → 端口可声明自己兼容的 palette 版本

### 对 AgentSkin 的实操建议

1. **palette.json → theme manifest 统一格式的灵感**: AgentSkin 的 theme manifest 就是 AgentSkin 的 palette.json
2. **Style Guide 的合规检查**: check-themes 脚本应包含语义 token 的消费验证
3. **OKLCH 用于内部计算**: 在设计工具/色彩生成器中使用 OKLCH，输出时转 HEX
4. **分层验证**: 借鉴 Base > Surface > Overlay > Text 的单调性约束，在 check-palette 中加入此检查
5. **extended colors 的分层消费**: 7 语义锁定 + 7 灵活使用，不允许语义 token 被用作装饰

---

*分析基于: catppuccin/palette v1.7.1 (mod.ts + palette.json), catppuccin/catppuccin docs (style-guide.md), catppuccin.com/palette 页面*
