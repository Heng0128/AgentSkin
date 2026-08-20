# Midnight Discord CSS 变量分层方法论分析

> 仓库: https://github.com/refact0r/midnight-discord
> 分析日期: 2025-07
> 分析目的: 为 AgentSkin 主题引擎提炼可借鉴的 CSS 架构模式

---

## 一、仓库文件结构概览

```
midnight-discord/
├── src/                          # 源文件（多文件模块化）
│   ├── main.css                  # 主入口（@import 字体 + :root/body 变量）
│   ├── midnight.css              # 核心面板/布局样式
│   ├── user.css                  # 用户级覆盖与自定义
│   └── themes/
│       └── colors.css            # 颜色变量定义（核心）
├── themes/                       # 预置风味变体（flavors）
│   ├── midnight.theme.css        # 默认主题
│   ├── midnight-auto.theme.css   # 跟随系统深浅色
│   ├── midnight-background.theme.css  # 背景图片版
│   └── flavors/                  # 更多社区风味
├── build/                        # 构建输出
│   └── midnight.css              # 合并后的生产文件
├── scripts/                      # 构建脚本
└── test/                         # 颜色校验测试
```

**构建模式**: `npm run serve` 监听 src/ 变更 → 合并为 build/midnight.css → 同时输出到本地 Vencord/BetterDiscord 主题文件夹。

---

## 二、CSS 变量分层模型（三层架构）

### 层级图

```
┌─────────────────────────────────────────────────────────────────┐
│  Level 1: 原始基色 (Primitive Base Colors)                       │
│  ── 定义于 :root，使用 oklch 色彩空间，5 级亮度阶梯 ──            │
│                                                                 │
│  --red-1 ... --red-5    (oklch 75%→55%, c=0.12, h=0)          │
│  --green-1 ... --green-5  (hue=170)                             │
│  --blue-1 ... --blue-5   (hue=215)                              │
│  --yellow-1 ... --yellow-5 (hue=90)                             │
│  --purple-1 ... --purple-5 (hue=310)                            │
│                                                                 │
│  特征: 纯数学定义，不携带语义，可被任意语义层消费                    │
└────────────────────────────┬────────────────────────────────────┘
                             │ var(--blue-2) 等引用
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Level 2: 语义映射层 (Semantic Mapping)                          │
│  ── 定义于 :root，按功能角色命名，引用 Level 1 ──                 │
│                                                                 │
│  ┌─ 文本层级 ──────────────────────────────────────────────┐    │
│  │ --text-0: var(--bg-4)      │ 有色背景上的文字            │    │
│  │ --text-1: hsl(220,45%,95%) │ 纯白标题                   │    │
│  │ --text-2: hsl(220,25%,85%) │ 重要文本                   │    │
│  │ --text-3: hsl(220,20%,70%) │ 正文                       │    │
│  │ --text-4: hsl(220,15%,50%) │ 图标按钮/频道              │    │
│  │ --text-5: hsl(220,15%,35%) │ 禁用/时间戳                │    │
│  └─────────────────────────────────────────────────────────┘    │
│  ┌─ 背景层级 ──────────────────────────────────────────────┐    │
│  │ --bg-1: hsla(220,15%,20%,.6) │ 按下态按钮              │    │
│  │ --bg-2: hsla(220,15%,16%,.6) │ 默认按钮                │    │
│  │ --bg-3: hsla(220,15%,13%,.6) │ 次要间距元素            │    │
│  │ --bg-4: hsla(220,15%,10%,.6) │ 主背景                  │    │
│  │ --hover / --active / --active-2 │ 交互状态              │    │
│  │ --message-hover                 │ 消息悬停              │    │
│  └─────────────────────────────────────────────────────────┘    │
│  ┌─ 强调色 ───────────────────────────────────────────────┐    │
│  │ --accent-1: var(--blue-1)  │ 链接                      │    │
│  │ --accent-2: var(--blue-2)  │ 小强调元素                 │    │
│  │ --accent-3: var(--blue-3)  │ 强调按钮                   │    │
│  │ --accent-4: var(--blue-4)  │ 按钮悬停                   │    │
│  │ --accent-5: var(--blue-5)  │ 按钮按下                   │    │
│  │ --mention / --reply        │ 渐变合成声明               │    │
│  └─────────────────────────────────────────────────────────┘    │
│  ┌─ 状态指示 ─────────────────────────────────────────────┐     │
│  │ --online: var(--green-2)                               │     │
│  │ --dnd: var(--red-2)                                    │     │
│  │ --idle: var(--yellow-2)                                │     │
│  │ --streaming: var(--purple-2)                           │     │
│  │ --offline: var(--text-4)                               │     │
│  └─────────────────────────────────────────────────────────┘    │
│  ┌─ 边框 ────────────────────────────────────────────────┐      │
│  │ --border-light: var(--hover)                           │      │
│  │ --border: var(--active)                                │      │
│  │ --border-hover: var(--active)                          │      │
│  │ --button-border: hsl(220,0%,100%,0.1)                 │      │
│  └─────────────────────────────────────────────────────────┘    │
└────────────────────────────┬────────────────────────────────────┘
                             │ 被组件/布局直接消费
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  Level 3: 组件与布局变量 (Component / Layout Tokens)              │
│  ── 定义于 :root 和 body，直接用于属性值 ──                       │
│                                                                 │
│  ┌─ 间距系统 ─────────────────────────────────────────────┐    │
│  │ --gap: 12px               │ 面板间距                   │    │
│  │ --space-16 / --space-24   │ 内距档位                   │    │
│  │ --custom-guild-list-padding: 12px                       │    │
│  └─────────────────────────────────────────────────────────┘    │
│  ┌─ 圆角系统 ─────────────────────────────────────────────┐    │
│  │ --radius-sm               │ 小圆角（消息条/标签）       │    │
│  │ --radius-md               │ 中圆角（嵌入/按钮/输入框）  │    │
│  │ --radius-lg               │ 大圆角（面板/弹窗）         │    │
│  └─────────────────────────────────────────────────────────┘    │
│  ┌─ 边框系统 ─────────────────────────────────────────────┐    │
│  │ --border-thickness: 1px   │ 面板边框                   │    │
│  │ --divider-thickness: 4px  │ 未读分隔条                  │    │
│  └─────────────────────────────────────────────────────────┘    │
│  ┌─ 字体系统 ─────────────────────────────────────────────┐    │
│  │ --font: 'figtree'         │ 主字体（'' = 默认）         │    │
│  │ --code-font: ''           │ 代码字体                    │    │
│  │ --font-primary / --font-display / --font-code          │    │
│  └─────────────────────────────────────────────────────────┘    │
│  ┌─ 其他布局 ─────────────────────────────────────────────┐    │
│  │ --custom-guild-list-width: calc(...)                   │    │
│  │ --panel-backdrop-filter: none                          │    │
│  │ --top-bar-height / --window-control-size               │    │
│  │ --chatbar-height / --animations / --border-hover-transition│  │
│  │ --elevation-low / --elevation-medium / --elevation-high │    │
│  │ --blur-amount / --bg-floating                          │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### 关键设计原则

1. **Level 1 永不直接用于样式选择器** — 仅作为 Level 2 的引用源
2. **Level 2 是语义契约** — 组件只引用 `--text-3`、`--bg-4` 而非 `--blue-2`
3. **Level 3 是同一层级的物理属性** — 圆角/间距/边框粗细不使用 oklch，使用 px/rem
4. **渐变色在 Level 2 合成** — `--mention` 使用 `color-mix(in hsl, var(--accent-2), transparent 90%)` 生成

---

## 三、变量命名规范总结

| 维度 | 规范 | 示例 |
|------|------|------|
| 色相基色 | `--{color}-{1-5}` | `--red-1`, `--blue-3`, `--purple-5` |
| 文本语义 | `--text-{0-5}` | `--text-0` (反色), `--text-3` (正文), `--text-5` (禁用) |
| 背景层级 | `--bg-{1-4}` + 交互态 | `--bg-1` (最亮), `--bg-4` (主背景) |
| 交互状态 | `--{state}` | `--hover`, `--active`, `--active-2`, `--message-hover` |
| 强调色 | `--accent-{1-5}` | `--accent-1` (链接), `--accent-3` (按钮) |
| 状态指示 | `--{status}` | `--online`, `--dnd`, `--idle`, `--streaming`, `--offline` |
| 边框 | `--border-{role}` | `--border-light`, `--border`, `--border-hover`, `--button-border` |
| 间距 | `--{role}` / `--space-{px}` | `--gap`, `--space-16`, `--space-24` |
| 圆角 | `--radius-{size}` | `--radius-sm`, `--radius-md`, `--radius-lg` |
| 边框粗细 | `--{role}-thickness` | `--border-thickness`, `--divider-thickness` |
| 字体 | `--{role}-font` | `--font`, `--code-font` |
| 布局尺寸 | `--custom-{component}-{prop}` | `--custom-guild-list-padding`, `--custom-guild-list-width` |
| 功能性 | `--{feature}-{prop}` | `--blur-amount`, `--bg-floating`, `--animations` |

**命名规律总结**:
- 数字后缀越大 → 视觉权重越低（text-0 最高对比度 → text-5 最低）
- 0 索引专用：`--text-0` 表示"有色背景上的文字"（即背景色的反色），是特殊角色
- 基色 1-5 的 1 最亮，5 最暗（oklch lightness 递减）
- 自定义布局变量加 `--custom-` 前缀以区分主题原生变量
- 物理属性使用 px 而非 paso 到 Level 3 token

---

## 四、深度主题组件覆写策略

### 4.1 面板分离模式（Panel Separation）

Midnight 的核心视觉特征是通过给每个面板设置相同的背景、圆角和边框来实现"浮动卡片"效果：

```css
.guilds__5e434,
.sidebarList__5e434,
.panels__5e434,
.chatContent_f75fb0,
.container_c8ffbb,
/* ... 约 30+ 选择器 ... */ {
    background-color: var(--background-base-lower);
    border-radius: var(--radius-lg);
    border: var(--border-thickness) solid var(--border-subtle);
    backdrop-filter: var(--panel-backdrop-filter);
    box-sizing: border-box;
    transition: border-color var(--border-hover-transition);

    &:hover {
        border-color: var(--border-hover);
    }
}
```

**策略特点**:
- 大量选择器共享同一声明块（用逗号分隔）
- 用 CSS 注释标注每个选择器的语义（`/* server list */`）
- 通过 `--gap` 变量控制面板间间距
- 悬停反馈仅改变边框颜色（border-color）而非背景

### 4.2 ShadowDOM / 弹窗 / Popout 覆写

```css
/* popout 模态框容器 */
.container__8a031 {
    background-color: var(--background-base-lower);
    border-radius: var(--radius-lg);
    border: var(--border-thickness) solid var(--border-subtle);
}

/* VC 全屏弹出背景 */
#app-mount::backdrop {
    display: none;
}

/* 弹窗内容边距 */
.popout__0bd4a .content__0bd4a {
    margin: 0 var(--gap) var(--gap) var(--gap);
}
```

### 4.3 设置页背景移除

```css
/* 移除设置页多余背景实现透明效果 */
.standardSidebarView__23e6b,
.contentRegion__23e6b,
.contentRegionScroller__23e6b {
    background: none;
}
.standardSidebarView__23e6b {
    backdrop-filter: var(--panel-backdrop-filter);
}
```

### 4.4 背景图片支持

```css
body {
    --background-image: on;
    --background-image-url: url('https://...');
    /* 通过 --transparency-tweaks 和 --remove-bg-layer 配合 */
}
```

### 4.5 按钮边框统一圆角

```css
--button-border: hsl(220, 0%, 100%, 0.1); /* 中性按钮边框 */
```

---

## 五、暗色/亮色切换与配置机制

### 5.1 暗色方案（默认）

直接在 `:root` 中定义所有变量值，使用 `hsla` 实现半透明背景：

```css
:root {
    color-scheme: dark;
    --colors: on;
    --bg-4: hsla(220, 15%, 10%, 1);  /* 主背景 */
    --bg-3: hsla(220, 15%, 13%, 1);  /* 次要元素 */
    /* ... */
}
```

### 5.2 亮色方案（`prefers-color-scheme`）

```css
@media (prefers-color-scheme: light) {
    :root {
        color-scheme: light;
        /* 仅覆盖语义映射层 */
        --text-1: hsl(220, 15%, 5%);
        --text-2: hsl(220, 15%, 10%);
        --bg-4: hsla(220, 30%, 90%, 1);
        --bg-3: hsla(220, 30%, 87%, 1);
        /* 基色 oklch 不变 */
    }
}
```

### 5.3 风味变体（Flavors）

每个 flavor 是一个独立文件，通过 `@import` 引入 build CSS 后覆盖 body 和 :root 变量：

```css
/* midnight-background.theme.css */
@import url('https://refact0r.github.io/midnight-discord/build/midnight.css');

body {
    --background-image: on;
    --background-image-url: url('https://.../iceland.jpg');
    --transparency-tweaks: on;
    --panel-blur: on;
    --blur-amount: 12px;
    --custom-chatbar: separated;
}

:root {
    --colors: on;
    /* 全部颜色变量重写 */
}
```

### 5.4 用户自定义变量

用户仅需修改变量值即可定制：

```css
/* 在 QuickCSS 或主题文件中 */
:root {
    --bg-4: hsla(220, 15%, 10%, 0.7);  /* 透明背景 */
    --blur-amount: 16px;
}
body {
    --gap: 8px;  /* 更紧凑 */
    --font: 'inter';
}
```

---

## 六、值得 AgentSkin 借鉴的设计模式

### 6.1 强烈推荐

#### (1) oklch 基色 + 语义映射的双层颜色系统

**AgentSkin 现状**: 使用 HEX/HSL 混合定义，无色彩空间统一。
**借鉴点**: 定义 5-6 个基色色相（红/绿/蓝/黄/紫），每个色相 5 级亮度，全部使用 `oklch` 色彩空间。

**原因**:
- oklch 是感知均匀的，同亮度值在不同色相下视觉权重一致
- 亮度阶梯可通过单一参数（L）生成，方便自动化
- 切换深浅色只需重新映射语义层

```css
/* AgentSkin 适配示例 */
:root {
    /* 5 色相基色 */
    --sk-accent-base: oklch(70% 0.15 215);  /* 主强调色 */
    --sk-danger-base: oklch(65% 0.12 0);
    --sk-success-base: oklch(70% 0.11 170);
    --sk-warning-base: oklch(75% 0.11 90);
    --sk-info-base: oklch(70% 0.1 260);
}
```

#### (2) 数字权重的 text/bg 层级命名

**借鉴点**: `--text-0` ~ `--text-5`, `--bg-1` ~ `--bg-4` 模式。

**AgentSkin 适配**: 对齐 14-token 契约：
```
--sk-text-primary   (当前 --text-1 角色)
--sk-text-secondary (当前 --text-3 角色)
--sk-text-muted     (当前 --text-5 角色)
--sk-bg-surface     (当前 --bg-3 角色)
--sk-bg-base        (当前 --bg-4 角色)
```

#### (3) 渐变色在语义层使用 color-mix 合成

**借鉴点**: `--mention: linear-gradient(to right, color-mix(in hsl, var(--accent-2), transparent 90%) 40%, transparent);`

**AgentSkin 适配**: 消息高亮、选中态、进度条等需要半透明叠加的效果，全部在 Level 2 用 color-mix 合成，避免写死透明度数值。

```css
/* AgentSkin 示例 */
--sk-mention-bg: linear-gradient(
    to right,
    color-mix(in oklch, var(--sk-accent) 10%, transparent) 40%,
    transparent
);
```

#### (4) 风味变体（Flavor）的模块化切分

**借鉴点**: `@import` 基础构建 + 变量覆盖 = 完整主题。

**AgentSkin 适配**: 现有 14-token 契约的 Theme Library 可直接对齐。每个 theme 文件 = 一组变量预设，不涉及选择器覆写（除非是结构性调整）。

#### (5) 组件变量使用 px 数值而非语义命名

**借鉴点**: `--gap: 12px`, `--space-16`, `--radius-sm`。

**AgentSkin 适配**: 间距系统可直接复用 Swiss 设计系统的 4/8/16/24/32 序列。

### 6.2 有条件借鉴

#### (1) 面板浮动模式（Panel Separation）

Midnight 通过 `background-color` + `border` + `border-radius` 实现面板悬浮效果。

**适用条件**: AgentSkin 的 Workspace 视图、聊天窗口等密集面板场景。
**注意**: 过度使用会增加 GPU 合成层，需要在低配设备上做降级。

#### (2) prefers-color-scheme 自动切换

**适用条件**: AgentSkin 作为 Electron 应用，可以通过主进程读取系统主题，注入对应 class 或自定义属性。
**优势**: 无需 JS 监听，纯 CSS 媒体查询性能更佳。

#### (3) @supports 特性检测做降级

```css
@supports not (backdrop-filter: blur(12px)) {
    .panel {
        background-color: var(--bg-4-opaque); /* 不透明回退 */
    }
}
```

### 6.3 不适合 AgentSkin 的部分

| 设计决策 | 原因 | 建议 |
|---------|------|------|
| **纯 CSS 变量做动画开关** (`--animations: on`) | AgentSkin 使用 React 19，动画建议用 CSS `@keyframes` + `prefers-reduced-motion` | 保留 prefers-reduced-motion 而非自定义开关 |
| **`body` 上定义全局变量** | AgentSkin 运行时注入在 Shadow DOM 或 `:host` 中 | 应改为 `:root` 或 `:host`，并通过 `@property` 注册 |
| **大量逗号分隔选择器**（30+ 个） | Discord DOM 类名不稳定，AgentSkin 面对 6 个不同应用 | 抽象为 mixin 或 apply 指令，维护选择器列表 |
| **`hsla` 透明度背景** | Electron 透明窗口需要特定透明度，且跨平台表现不一致 | 用 oklch 的 alpha 通道 `--bg-4: oklch(10% 0.02 220 / 0.7)` |
| **Google Fonts @import** | Electron 离线场景 + CSP 限制 | 字体通过主进程本地加载或打包 |
| **`!important` 大量使用** | 覆盖策略依赖注入顺序特异性 | 通过提高选择器特异性或层（@layer）解决 |
| **级别过多**（gap/space/radius 混用） | AgentSkin Swiss 系统已有 4/8/16/24/32 规范 | 保持 Tailwind 间距档位，不另创一套 |
| **1px 边框 + 12px gap 的视觉密度** | Swiss/International 风格偏好更宽松间距 | AgentSkin 应根据产品调性调整 gap 数值 |
| **面板背景单一色** (background-base-lower) | AgentSkin 的多层环境/壁纸系统需要更丰富的层级 | 保持 3-4 层背景变量 |

---

## 七、对 AgentSkin 14-Token 契约的优化建议

基于对 Midnight 的分析，建议 AgentSkin 在现有 14-token 上进行如下增强：

### 7.1 基色层新增

```css
/* 新增 5 色相 oklch 基色（仅 5 个变量，不破坏契约数量） */
--sk-base-accent: oklch(70% 0.15 215);
--sk-base-danger: oklch(65% 0.12 0);
--sk-base-success: oklch(70% 0.11 170);
--sk-base-warning: oklch(75% 0.11 90);
--sk-base-info: oklch(70% 0.1 260);
```

### 7.2 语义层用 color-mix 替代固定值

```css
/* 当前 */
--sk-message-highlight: #ff000020; /* 不灵活 */

/* 优化 */
--sk-message-highlight: color-mix(in oklch, var(--sk-base-accent) 8%, transparent);
```

### 7.3 状态色用基色别名而非硬编码 HEX

```css
/* 当前 */
--sk-status-online: #3ba55d;

/* 优化 */
--sk-status-online: var(--sk-base-success);
```

### 7.4 增加交互状态变量

```css
--sk-hover: color-mix(in oklch, var(--sk-text-primary) 8%, transparent);
--sk-active: color-mix(in oklch, var(--sk-text-primary) 12%, transparent);
--sk-selected: color-mix(in oklch, var(--sk-base-accent) 15%, transparent);
```

---

## 八、总结

Midnight Discord 的核心架构优势：

1. **三层解耦**: 基色 → 语义 → 组件，使得换肤仅需覆盖中间层
2. **oklch 色彩空间**: 感知均匀，方便自动化生成色板
3. **color-mix 动态合成**: 减少硬编码透明度，支持任意基色主题
4. **风味变体模块化**: 即插即用的主题组合能力
5. **CSS 变量即配置**: 无需构建工具，QuickCSS 即可定制

AgentSkin 应借鉴的核心理念是 **"基色数学化 + 语义映射化 + color-mix 合成化"**，而非直接复制其间距、密度或面板样式。将这一方法论融入现有的 14-token 契约，可以显著提升主题引擎的灵活性和可维护性。

---

*本分析基于 2025-07 从 midnight-discord 仓库提取的公开代码。随着仓库持续演进（1022+ commits），部分变量命名可能已更新。*
