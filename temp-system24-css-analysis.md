# system24 CSS 变量分层方法论分析

> 分析对象: [refact0r/system24](https://github.com/refact0r/system24) (v2.1.0)
> 分析日期: 2025-07
> 分析目标: 提炼 CSS 变量架构方法论，供 AgentSkin 设计系统参考

---

## 1. 仓库结构与文件组织

```
system24/
├── src/                          # 源码层（模块化 CSS 片段）
│   ├── main.css                  # 入口：午夜导入 + 字体 + 公共默认值 + 调色板
│   ├── ascii.css                 # ASCII 频道标题与加载动画
│   ├── colors.css                # System24 特定的状态色别名
│   ├── panel-labels.css          # 可选面板标签
│   ├── spotify-bar.css           # 可选 Vencord Spotify 进度条
│   └── unrounding.css            # 方形化：面板、头像、状态指示器
├── theme/
│   ├── system24.theme.css        # 用户主题文件（公共变量 + 导入 build）
│   └── flavors/                  # 调色板变体（独立主题文件）
│       ├── system24-light.theme.css
│       ├── system24-auto.theme.css
│       ├── system24-catppuccin-mocha.theme.css
│       ├── system24-everforest.theme.css
│       ├── system24-rose-pine.theme.css
│       ├── system24-tokyo-night.theme.css
│       └── ...（共 10 种）
├── build/
│   └── system24.css              # 构建产物（由 src/*.css 拼接，不手动编辑）
└── scripts/
    ├── theme.config.js           # Source order 配置
    ├── build.js                  # 确定性构建器
    └── dev.js                    # 文件监听 + 热更新
```

**关键设计决策**：
- `src/*.css` 是编辑的源，`build/system24.css` 是构建产物，两者都提交到 git
- 模块顺序由 `scripts/theme.config.js` 中的 `sourceFiles` 数组严格控制
- 每个 flavor 是独立文件，只覆盖变量值，不改变规则

---

## 2. 变量分层模型

### 层级图：三层派生体系

```
┌─────────────────────────────────────────────────────────────────────┐
│ Level 0: 基础色（Primitive / Base Colors）                          │
│ 位于 :root，定义 oklch 色彩空间的原子值                             │
│                                                                     │
│   --red-1 ~ --red-5      （5 档明度递减，oklch L-C-H 格式）         │
│   --green-1 ~ --green-5                                              │
│   --blue-1 ~ --blue-5                                                │
│   --yellow-1 ~ --yellow-5                                            │
│   --purple-1 ~ --purple-5                                            │
│                                                                     │
│   命名规则: --{hue}-{n}，n ∈ [1,5]，1=最亮 5=最暗                  │
│   色彩空间: oklch(L C H) — 感知均匀，便于系统化调整                 │
│   例: --purple-1: oklch(75% 0.12 310);                              │
│       --purple-5: oklch(55% 0.12 310);                              │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ var() 引用
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Level 1: 语义色（Semantic / Intent Colors）                         │
│ 位于 :root，将基础色映射到语义角色                                  │
│                                                                     │
│   文本层级:                                                          │
│     --text-0           ← var(--bg-4)      反转文本色               │
│     --text-1 ~ --text-5   （oklch 灰度递减，95%→40%）              │
│                                                                     │
│   背景层级:                                                          │
│     --bg-1 ~ --bg-4       （oklch 灰度，31%→19%，递增深度）        │
│     --hover              ← oklch(54% 0 0 / 0.1)                    │
│     --active             ← oklch(54% 0 0 / 0.2)                    │
│     --active-2           ← oklch(54% 0 0 / 0.3)                    │
│                                                                     │
│   强调色（派生自基础色）:                                            │
│     --accent-1 ~ --accent-5  ← var(--purple-1) ~ var(--purple-5)    │
│     --accent-new             ← var(--red-2)                         │
│     --mention / --mention-hover  ← color-mix(accent-2, transparent) │
│     --reply / --reply-hover      ← color-mix(text-3, transparent)   │
│                                                                     │
│   状态色（派生自基础色）:                                            │
│     --online     ← var(--green-2)                                   │
│     --dnd        ← var(--red-2)                                     │
│     --idle       ← var(--yellow-2)                                  │
│     --streaming  ← var(--purple-2)                                  │
│     --offline    ← var(--text-4)                                    │
│                                                                     │
│   边框色（派生自语义色）:                                            │
│     --border-light   ← var(--hover)                                 │
│     --border         ← var(--active)                                │
│     --border-hover   ← var(--accent-2)                              │
│     --button-border  ← hsl(220, 0%, 100%, 0.1)                      │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ var() 引用
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Level 2: 功能色 / 组件变量（Functional / Component Variables）      │
│ 位于 body，定义布局和组件级变量                                     │
│                                                                     │
│   间距系统:                                                          │
│     --gap: 12px              面板间距（所有布局以此为基准）          │
│     --divider-thickness: 4px                                       │
│     --border-thickness: 2px                                        │
│                                                                     │
│   字体系统:                                                          │
│     --font: 'DM Mono'                                               │
│     --code-font: 'DM Mono'                                          │
│                                                                     │
│   动画系统:                                                          │
│     --animations: on/off                                            │
│     --list-item-transition: 0.2s ease                               │
│     --dms-icon-svg-transition: 0.4s ease                            │
│                                                                     │
│   布局开关:                                                          │
│     --custom-window-controls: off/on                                │
│     --window-control-size: 14px                                     │
│     --top-bar-height: var(--gap)                                    │
│                                                                     │
│   功能开关（on/off 枚举）:                                          │
│     --custom-dms-icon, --custom-dms-background                       │
│     --background-image, --transparency-tweaks                        │
│     --panel-blur, --unrounding, --round-pfp                          │
│     --custom-spotify-bar, --ascii-titles, --ascii-loader             │
│     --panel-labels, --small-user-panel                               │
│                                                                     │
│   派生变量:                                                          │
│     --label-color: var(--text-muted)  ← 引用 midnight 变量         │
│     --bg-floating: var(--bg-3)                                      │
│     --dms-icon-color-before: var(--icon-subtle)                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 关键发现：三层之间存在严格的单向依赖

- Level 0 不引用任何变量（原子值）
- Level 1 仅引用 Level 0（`--accent-1: var(--purple-1)`）
- Level 2 引用 Level 0 和 Level 1（`--label-color: var(--text-muted)`）
- **不存在反向引用**，无循环依赖

---

## 3. 变量命名规范总结

### 3.1 命名模式

| 模式 | 示例 | 语义 |
|------|------|------|
| `--{hue}-{n}` | `--red-1`, `--purple-5` | 基础色 + 明度档位 |
| `--text-{n}` | `--text-0` ~ `--text-5` | 文本层级（0=反转，1=最亮，5=最暗） |
| `--bg-{n}` | `--bg-1` ~ `--bg-4` | 背景层级（1=最亮，4=主背景） |
| `--accent-{n}` | `--accent-1` ~ `--accent-5` | 强调色档位 |
| `--{state}` | `--hover`, `--active`, `--active-2` | 交互状态 |
| `--{role}` | `--online`, `--dnd`, `--idle` | 语义角色 |
| `--{component}-{prop}` | `--button-border`, `--border-hover` | 组件属性 |
| `--custom-{feature}` | `--custom-dms-icon`, `--custom-spotify-bar` | 功能开关 |
| `--{feature}-{state}` | `--dms-icon-color-before`, `--dms-icon-color-after` | 组件状态 |

### 3.2 命名原则

1. **语义优先于外观**：`--text-3` 而非 `--text-gray-700`，`--accent-1` 而非 `--purple-light`
2. **数字档位表示强度/层级**：1=最亮/最浅，5=最暗/最深（基础色）；0=特殊反转
3. **组件变量用连字符分隔**：`--border-hover-transition`, `--dms-icon-svg-url`
4. **功能开关用 `on/off` 枚举**：`--animations: on`, `--unrounding: on`
5. **自定义功能前缀 `custom-`**：`--custom-dms-icon`, `--custom-window-controls`
6. **状态后缀 `before/after`**：`--dms-icon-color-before`（默认） / `--dms-icon-color-after`（悬停/选中）

### 3.3 色彩空间选择

- 全部使用 `oklch(L C H)` 而非 HSL/HEX
- 优势：感知均匀，调整明度时色相不变
- 格式：`oklch(75% 0.12 310)` = 75% 明度、0.12 饱和度、310 色相
- 透明度直接在 oklch 中内联：`oklch(54% 0 0 / 0.1)`

---

## 4. 条件覆盖与模块片段系统

### 4.1 `@property` + `@container` 条件模块

system24 使用 CSS Houdini `@property` 注册自定义属性，然后通过 `@container body style(...)` 查询其值来条件启用模块：

```css
/* 1. 注册属性（定义语法、继承性、初始值） */
@property --unrounding {
    syntax: 'off | on';
    inherits: false;
    initial-value: on;
}

/* 2. 条件容器查询 */
@container body style(--unrounding: on) {
    /* 仅在 --unrounding: on 时生效的规则 */
    *::before, *::after {
        border-radius: 0 !important;
    }
}

/* 3. 组合条件 */
@container body style(--round-pfp: off) and style(--unrounding: on) {
    /* 仅在 unrounding=on 且 round-pfp=off 时生效 */
}
```

### 4.2 模块开关清单

| 变量 | 默认值 | 控制的模块 |
|------|--------|-----------|
| `--colors` | `on` | 是否启用 midnight 自定义色板 |
| `--unrounding` | `on` | 方形化面板、按钮、滚动条 |
| `--round-pfp` | `off` | 头像方形/圆形 |
| `--remove-pfp-decor` | `off` | 隐藏头像装饰 |
| `--ascii-titles` | `on` | ASCII 字体频道标题 |
| `--ascii-loader` | `system24` | 加载动画样式 |
| `--panel-labels` | `on` | 面板标签（nav/user/chat...） |
| `--custom-spotify-bar` | `on` | 文本风格 Spotify 进度条 |
| `--animations` | `on` | 全局动画开关 |
| `--panel-blur` | `off` | 面板背景模糊 |
| `--transparency-tweaks` | `off` | 透明模式优化 |
| `--background-image` | `off` | 背景图片 |

### 4.3 设计模式总结

1. **每个模块文件对应一个 `@property` + `@container` 对**
2. **模块完全封装**：关闭开关时，模块内所有规则完全不生效（零运行时开销）
3. **组合条件支持**：多个 `@property` 可组合（`and`）实现复杂条件
4. **`inherits: false`**：防止变量意外继承到子作用域
5. **`syntax` 声明**：提供类型安全，无效值回退到 `initial-value`

---

## 5. 暗色/亮色主题切换机制

### 5.1 Flavor 系统

system24 不使用 CSS 媒体查询或 JS 切换主题，而是提供独立的 **flavor 文件**：

```
theme/flavors/
├── system24-light.theme.css          # 亮色变体
├── system24-auto.theme.css           # 跟随系统（prefers-color-scheme）
├── system24-catppuccin-mocha.theme.css
├── system24-everforest.theme.css
├── system24-rose-pine.theme.css
├── system24-tokyo-night.theme.css
├── system24-nord.theme.css
└── system24-vencord.theme.css
```

### 5.2 Flavor 工作原理

每个 flavor 文件结构相同：
1. `@import url('...build/system24.css')` — 导入相同的构建产物
2. 覆盖 `body { ... }` 中的布局变量
3. 覆盖 `:root { ... }` 中的颜色变量

**关键发现**：
- 亮色 flavor 添加 `color-scheme: light` 到 `:root`
- 亮色 flavor 反转了 text/bg 的 oklch 明度值（text-1: 95%→20%, bg-4: 19%→94%）
- 基础色（red-1~5 等）在 flavor 间保持不变，仅语义层被覆盖
- 亮色 flavor 调整了 `--accent` 档位映射（accent-1: purple-1→purple-3，使用更深的强调色）

### 5.3 Auto 主题

`system24-auto.theme.css` 使用 `prefers-color-scheme` 媒体查询在暗/亮之间切换，但具体实现需要查看该文件内容。

---

## 6. 构建系统与 Source Order

### 6.1 确定性构建

```js
// scripts/theme.config.js
module.exports = {
    sourceFiles: [
        'main.css',        // 1. 午夜导入 + 基础变量
        'ascii.css',       // 2. ASCII 模块
        'colors.css',      // 3. 状态色别名
        'panel-labels.css',// 4. 面板标签
        'spotify-bar.css', // 5. Spotify 进度条
        'unrounding.css',  // 6. 方形化
    ],
};
```

构建器按数组顺序拼接 `src/*.css` → `build/system24.css`。

### 6.2 不变量

- 构建器验证 `sourceFiles` 与 `src/` 目录中实际文件的一致性
- 不匹配时构建失败（防止遗漏新文件）
- `build/system24.css` 提交到 git，用户可直接 `@import` 使用

---

## 7. 值得 AgentSkin 借鉴的设计模式

### 7.1 强烈推荐

#### ① oklch 色彩空间 + 数字档位系统

**做法**：`--{hue}-{n}` 5 档明度，oklch 格式
**优势**：
- 感知均匀，调整明度不偏色
- 5 档足够覆盖大多数 UI 场景
- 新增色相只需复制一组 5 档

**AgentSkin 适配建议**：
- 当前 AgentSkin 使用 14-token 主题契约，可考虑将 token 值基于 oklch 派生
- 每个色相 5 档可映射到 token 的亮度变化

#### ② 三层单向依赖

**做法**：Primitive → Semantic → Functional，无反向引用
**优势**：
- 修改基础色自动传播到所有语义色
- 语义色变化不影响基础色
- 调试时追踪链清晰

**AgentSkin 适配建议**：
- 当前 14-token 契约可重新审视是否隐含了层级关系
- 建议显式定义：基础色板 → 语义 token → 组件 token

#### ③ `@property` + `@container` 条件模块

**做法**：每个功能模块由 CSS 变量开关控制
**优势**：
- 零运行时开销（浏览器原生支持）
- 模块完全封装，无副作用
- 用户可通过修改变量值开关功能

**AgentSkin 适配建议**：
- 适用于 Electron 环境（Chromium 支持 @property 和 @container）
- 可用于控制：动画开关、模糊效果、紧凑模式等
- 注意：CDP 注入场景需确认目标浏览器的支持程度

#### ④ Flavor 调色板变体系统

**做法**：独立文件覆盖变量值，共享相同规则
**优势**：
- 新增调色板无需修改任何规则代码
- 用户选择即安装
- 维护成本极低

**AgentSkin 适配建议**：
- 当前 Theme Library 可参考此模式
- 每个主题 = 一个变量覆盖文件 + 可选规则扩展
- 区分 "调色板"（仅变量）和 "主题"（变量 + 规则）

#### ⑤ 功能开关前缀 `custom-`

**做法**：`--custom-dms-icon`, `--custom-spotify-bar`
**优势**：
- 一眼区分原生变量与扩展变量
- 命名空间隔离，避免冲突

**AgentSkin 适配建议**：
- 当前 14-token 契约中的扩展变量可考虑统一前缀
- 如 `--custom-compact-sidebar`, `--custom-reduced-motion`

### 7.2 谨慎参考

#### ① `!important` 策略

system24 在 `unrounding.css` 中大量使用 `!important` 来覆盖 Discord 原生圆角：
```css
*::before, *::after {
    border-radius: 0 !important;
    --radius-none: 0px !important;
    --radius-sm: 0px !important;
    /* ... */
}
```

**原因**：Discord 原生样式大量使用 `!important`，必须用 `!important` 覆盖
**AgentSkin 评估**：
- AgentSkin 通过 CDP 注入，目标应用可能也有 `!important` 规则
- 但应优先使用更具体的选择器，保留 `!important` 作为最后手段
- 这与 AGENTS.md 中 "Don't add `!important` merely to fight specificity" 一致

#### ② 硬编码选择器依赖

system24 完全依赖 Discord 的 CSS 类名（如 `.guilds__5e434`, `.panels__5e434`），这些类名由 Discord 生成，可能随版本变化。

**AgentSkin 评估**：
- AgentSkin 面向 6 个不同应用，每个应用的选择器不同
- 需要 Adapter 层抽象选择器差异
- 不建议在主题规则中硬编码选择器

---

## 8. 不适合 AgentSkin 的部分

### 8.1 明确不适用

| 特性 | 原因 |
|------|------|
| **Discord 类名硬编码** | AgentSkin 有 6 个目标应用，需要 Adapter 抽象层 |
| **`@container body` 查询** | 依赖 Chromium 容器查询支持，旧版 Electron 可能不支持 |
| **`@property` 注册** | 同上，需确认目标 Electron 版本的 Chromium 版本 |
| **`color-scheme` 切换** | AgentSkin 的主题切换由 JS 控制，非 CSS 原生 |
| **单一暗色默认** | AgentSkin 需要同时支持暗/亮/自定义 |
| **`font-face` 内联** | AgentSkin 的字体管理应由主进程控制 |
| **`gap: 12px` 间距基准** | AgentSkin 使用 4/8/16/24/32/48 序列，12px 不在标准档中 |

### 8.2 需要适配

| 特性 | 适配方案 |
|------|---------|
| **oklch 色彩空间** | 可保留，但需确认 Tailwind v4 的 oklch 兼容性 |
| **5 档明度系统** | 可映射到 AgentSkin 的 token 层级 |
| **flavor 文件结构** | 可借鉴，但需增加 Adapter 维度 |
| **`@container` 条件模块** | 可降级为 `[data-feature]` 属性选择器 |
| **构建器 source order** | AgentSkin 已有构建系统，可集成 |

---

## 9. 对比总结

| 维度 | system24 | AgentSkin |
|------|----------|-----------|
| **变量层级** | 3 层（Primitive → Semantic → Functional） | 14-token 契约（扁平） |
| **色彩空间** | oklch | 当前未指定（可能 HSL/HEX） |
| **主题切换** | 独立 flavor 文件 | JS 运行时切换 |
| **条件模块** | `@property` + `@container` | 无 / 需设计 |
| **命名规范** | 语义化 + 数字档位 | 待分析 |
| **构建系统** | 简单拼接 | 已有（CDP 注入） |
| **目标应用** | 单一（Discord） | 6 个（需 Adapter） |
| **模块封装** | 高（每个功能独立文件） | 待分析 |

---

## 10. 行动建议

1. **短期**：将 oklch + 5 档明度系统引入 AgentSkin 调色板定义
2. **中期**：建立三层变量架构，分离 Primitive / Semantic / Component
3. **中期**：设计条件模块系统（可降级为 `[data-*]` 属性选择器）
4. **长期**：Flavor 系统 → AgentSkin Theme Library 的调色板变体机制
5. **验证**：在目标 Electron 版本测试 `@property` 和 `@container` 支持度

---

*分析完成。本文件为临时分析产物，供后续与 AgentSkin 设计系统比对使用。*
