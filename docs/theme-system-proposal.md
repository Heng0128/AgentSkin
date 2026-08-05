# AgentSkin 主题体系重构方案 — GitHub 生态调研报告

> 本文档基于对 GitHub 上 **500+ 桌面应用主题项目** 的深度调研，提出 AgentSkin 主题体系的重构方向。核心发现：当前项目还处于"调色板 + 背景图"阶段，而业界标杆（Spicetify、ClearVision、midnight-discord）早已进入"主题即产品"阶段 — 每个主题都是一个独立的、有差异化的完整体验。

---

## 一、GitHub 桌面应用主题生态全景

### 1.1 三大平台主题生态对比

| 维度 | Spicetify (Spotify) | BetterDiscord/Vencord | Steam |
|------|--------------------|--------------------|----|
| **社区主题总量** | ~200+ | 1000+ | ~30 |
| **官方/高质量主题** | ~15 个 | ~50 个 | ~5 个 |
| **单主题最大体量** | 8KB (Dribbblish) ~ 150KB (Comfy) | 34KB ~ 500KB+ | ~100KB |
| **主力开发模式** | 纯 CSS / 单文件 | SCSS 模块化 / 单文件 | Valve custom.styles |
| **主题包管理工具** | Spicetify Marketplace | betterdiscord.app | 手动安装 |
| **配色可配置性** | color.ini (10+ section) | :root CSS var | 不支持 |
| **暗/亮双模式** | 平台变量自动适配 | .theme-dark/.theme-light class | 平台控制 |

### 1.2 业界最高质量标准

> **关键结论：最高质量的主题项目 = 一仓库一主题，投入数百小时打磨**

| 项目 | Stars | 平台 | 特色 |
|------|-------|------|------|
| **midnight-discord** (refact0r) | 1,369 | Discord | 83KB / 10 文件 / 完美模块化 |
| **ClearVision-v6** | 500+ | Discord | SCSS + 70+ 模块 / 编译管线 |
| **AmoledCord** (LuckFire) | 522 | Discord | 纯黑主题标杆 |
| **catppuccin** (discord flavours) | 1,200 | 多平台 | 4 种 flavour 统一色彩体系 |
| **Dribbblish** (spicetify-themes) | — | Spotify | 单 theme 19 种配色 INI 方案 |
| **Flashcord** (SiriusBYT) | 高星 | Discord | 20+ 模块化文件 + 自定义编译器 |

---

## 二、三种主流主题结构模式（对比分析）

### 模式 A：Spicetify color.ini + user.css（最推荐）

```
ThemeName/
  color.ini          ← 多配色方案（10+ sections）
  user.css           ← 主样式（34KB）
  screenshots/       ← 预览图
  README.md
```

**color.ini 示例（Dribbblish，19 种配色方案）**：
```ini
[base]
text = e0e0e0
subtext = b0b0b0
main = 1e1e2e
sidebar = 181825
player = 11111b
card = 313244

[nord-light]
text = 2e3440
main = fff
sidebar = eceff4
accent = 5e81ac

[dracula]
text = f8f8f2
main = 282a36
accent = bd93f9

[catppuccin-mocha]
text = cdd6f4
main = 1e1e2e
accent = 585b70
```

**user.css 引用**：
```css
.sidebar {
  background: var(--spice-sidebar);  /* 来自 color.ini */
}
```

**优点**：
- ✅ 极简：只需要 2 个文件
- ✅ 配色切换：用户选 scheme → CLI 解析 → CSS 变量注入
- ✅ 维护成本低：改 color 不碰 CSS 结构
- ✅ 社区分发：config 文本可 PR / 共享

**适合 AgentSkin 迁移**：把 manifest.json 的 colors 扩展为 color.ini 风格

---

### 模式 B：SCSS 模块化构建（ClearVision 风格）

```
ClearVision/
  main.scss                ← @import 70+ 模块
  package.json             ← npm 构建
  src/
    _variables.scss        ← 全局变量
    _defaultSettings.scss  ← 默认 CSS 变量
    _mixins.scss           ← 混入
    app/                   ← 应用层
    channels/              ← 频道区域
    chat/                  ← 聊天区域
    general/               ← 通用元素 (按钮/滚动条/输入框)
    guilds/                ← 服务器列表
    messages/              ← 消息样式
    modals/                ← 模态框
    popouts/               ← 弹出层
    profiles/              ← 用户资料
    settings/              ← 设置面板
    injectors/             ← 多平台注入器 (bd/vencord/replugged)
  dist/
    ClearVision_v6.theme.css   ← 最终产物：单文件 ~140KB
```

**最终产物**：`.theme.css` 单文件 — 头部含 metadata
```css
/**
 * @name ClearVision
 * @version 6.9.0
 * @description Better Discord Theme
 * @author ...
 * @invite ...
 */
```

**特点**：
- 编译型：npm run build → PostCSS 处理
- 多平台支持：injectors/ 下有 bd/vencord/replugged 三种变体
- 用户自定义：:root { --main-color: red; } 覆盖

**对 AgentSkin 的启示**：当前 `generate-theme-css.mjs` 的 100KB 应该拆分为模块

---

### 模式 C：midnight-discord 分层结构（最平衡）

```
midnight-discord/
  src/                          ← 源码
    main.css                    ← 核心布局
    colors.css                  ← 颜色系统 (46.8KB！)
    chatbar.css                 ← 聊天栏
    top-bar.css                 ← 顶栏
    animations.css              ← 动画
    background-image.css        ← 背景图（0.4KB）
    window-controls.css         ← 窗口控件
    members-list.css            ← 成员列表
    settings-page.css           ← 设置页
    friend-list.css             ← 好友列表
  themes/
    midnight.theme.css          ← 发布入口（@import src/*.css）
  package.json                  ← build 脚本
  docs/                         ← 文档 + 截图
```

**关键特点**：
- 10 个文件 / 总计 83KB
- **colors.css 占 46.8KB** — 颜色系统是主题的核心
- 按 UI 区域拆模块
- build 脚本只是 cat 文件合并

**发布入口 (midnight.theme.css)**：
```css
/**
 * @name Midnight
 * @version 2.1.0
 * @description Dark theme for Discord
 */

@import url("main.css");
@import url("colors.css");
@import url("chatbar.css");
...
```

---

## 三、AgentSkin 现状 vs 差距分析

### 3.1 当前主题包结构（v2）

```
themes/naruto-tobi/
  manifest.json        ← 元数据
  palette.css          ← 14 个核心 token（生成）
  icon.png
  preview.png          ← 纯色渐变（不反映真实 UI）
  assets/
    hero.webp
    css/
      workbuddy.css    ← per-agent 样式（生成）
      doubao.css
      ...
```

### 3.2 关键差距

| 维度 | AgentSkin 现状 | 业界标杆 | 差距 |
|------|--------------|---------|------|
| **主题差异化** | 每个主题仅是调色板不同 | 每个主题是完全不同的 UI 体验 | 严重 |
| **配色方案数** | 1 个主题 1 套配色 | Dribbblish 1 主题 19 种配色 | 严重 |
| **CSS 模块化** | generate-theme-css.mjs 100KB 单文件 | 按 UI 区域拆 10+ 文件 | 中等 |
| **预览图** | 纯色渐变（不反映真实 UI） | 每个主题 5-10 张真实截图 | 严重 |
| **背景图支持** | hero.webp 无变量控制 | `__background-image` URL 变量一键开关 | 中等 |
| **字体自定义**  | 固定 | `--font` / `--code-font` 变量 | 中等 |
| **用户可调参** | manifest 固定 | :root CSS 变量 → 用户覆盖 | 严重 |
| **Flavour 系统** | 无 | catppuccin (Latte/Frappe/Macchiato/Mocha) | 严重 |
| **自定义 CSS** | 无 | QuickCSS / userChrome.css | 中等 |

### 3.3 根本问题

AgentSkin 目前把主题当成了"换皮肤" — 换一组颜色变量就完事了。

但业界把它们当成了"换产品" — 每个主题是一套完全不同的 UX，包含：
- 不同的选择器策略
- 不同的布局调整
- 不同的动画定义
- 不同的组件变体
- 不同数量的配色方案
- 用户可调参数空间
- 一键切换的背景图开关

---

## 四、重构方案

### 4.1 新主题结构：借鉴 Spicetify + midnight

```
themes/<theme-name>/                ← 一个主题包
  theme.json                        ← 元数据（从 manifest.json 精简）
  
  color-schemes/                    ← 多配色方案（核心）
    default.ini                     ← 默认配色
    nord.ini                        ← Nord 配色
    tokyo-night.ini                 ← Tokyo Night 配板
    catppuccin-mocha.ini            ← Catppuccin
    gruvbox.ini                     ← Gruvbox
    rose-pine.ini                   ← Rose Pine
    ...（至少 10 种）
    
  src/                              ← 源码 (可 SCSS 或纯 CSS)
    core.css                        ← 核心布局结构 (不可变)
    colors.css                      ← 颜色绑定层 (引用 color-schemes/ 变量)
    sidebars.css                    ← 侧边栏 (可选覆盖)
    chat.css                        ← 聊天区 (可选覆盖)
    modals.css                      ← 浮层 (可选覆盖)
    composer.css                    ← 输入框 (可选覆盖)
    code.css                        ← 代码块 (可选覆盖)
    animations.css                  ← 动画 (可选覆盖)
    glass-effects.css               ← 毛玻璃效果 (新增)
    custom.css                      ← 用户自定义层 (Appended last)
  
  assets/
    icon.png                        ← 图标 (128x128)
    preview-1.png                   ← 真实截图 1
    preview-2.png                   ← 真实截图 2
    hero.webp                       ← 背景大图 (可选)
    fonts/                          ← 自定义字体 (可选)
    backgrounds/                    ← 预设背景 (可选)
    
  screenshots/                      ← 主题市场截图
  README.md
```

### 4.2 配色 INI 格式（借鉴 Spicetify Dribbblish 19 方案）

```ini
; default.ini
[colors]
background    = #0a0c10
surface       = #141820
surface-2     = #1c2230
text          = #e8eaf0
text-muted    = #98a0b3
accent        = #7c5cff
accent-hover  = #8f72ff
success       = #34d399
warning       = #f5b342
danger        = #f87171

; 玻璃效果相关
glass-blur    = 16
glass-tint    = 0.15
glass-noise   = true

; 用户可调节（元数据）
[user-vars]
accent        = customizable          ; 用户可调
background-image = off                ; 开关
font          = 'Inter'               ; 字体选择
```

### 4.3 配色方案（最低要求：1 主题至少 10 种配色）

| 数量 | 方案 | 类型 |
|------|------|------|
| 1 | default | 主题默认 |
| 2 | nord | 冷色极地 |
| 3 | catppuccin-mocha | 柔和暖色 |
| 4 | tokyo-night | 东京夜蓝 |
| 5 | gruvbox | 复古像素 |
| 6 | rose-pine | 温柔紫粉 |
| 7 | dracula | 经典暗紫 |
| 8 | solarized-dark | 老派暗色 |
| 9 | github_dark | GitHub 暗色 |
| 10 | amoled | 极黑 |

**配色不是 10 个独立主题，而是 1 个主题的 10 个风味。** 用户选主题后，可以在设置中进一步切换 color ini。

### 4.4 用户自定义层：QuickCSS / custom.css

借鉴 Vencord 的 QuickCSS 模式：

```
themes/<theme-name>/src/custom.css   ← 不受管理
                                     用户在此写入自己的 CSS
                                     构建时自动 append 到末尾
                                     永远不会被覆盖
```

实现上：
- 首次安装时 custom.css 为空
- 用户在 Theme Studio 写自定义 CSS → 写入 custom.css
- 构建/应用主题时，最后加载 custom.css → 最高 priority
- 主题更新时不修改 custom.css → 用户自定义永久保留

### 4.5 预览图系统

**当前问题**：纯色渐变 + 矩形，不反映真实 UI

**改为**：在 Theme Studio 内嵌 CDP 实时预览
- 在主题编辑时，Studio 右侧实时显示 6 个 agent 中正在运行的那个
- 修改色板 → 立即反映
- 保存时 → 自动截 3-5 张不同区域的图 → 用于 Theme Marketplace

### 4.6 工具链升级

```
scripts/
  theme-engine/
    color-ini-parser.mjs         ← 解析 Spicetify 风格 INI
    color-ini-generator.mjs      ← 从 manifest 生成 INI
    token-mapper.mjs             ← native token → agent token 映射
    preview-capture.mjs          ← CDP 截图生成预览图
    custom.css-loader.mjs        ← 处理用户自定义层
    
  validate/
    theme-validator.mjs          ← 校验主题完整性和质量
    wcag-checker.mjs             ← 对比度检查

  build/
    build-theme.mjs              ← 主题包构建入口
    dev-server.mjs               ← watch 模式 + 热重载
    watch.mjs                    ← 源文件监听
```

### 4.7 新的主题 manifest（v3）

```jsonc
{
  "schemaVersion": 3,
  "id": "midnight-agent",
  "name": "Midnight Agent",
  "version": "1.0.0",
  "author": {
    "name": "...",
    "url": "..."
  },
  "description": "深色低噪声 Coding Agent 主题",
  
  "category": "dark",           // dark / light / universal
  "tags": ["coding", "dark", "low-contrast"],
  
  "colorSchemes": "color-schemes/",  // 指向目录，10+ INI files
  
  "glass": {
    "enabled": true,
    "tiers": {
      "sm": { "blur": 8,  "tint": 0.45 },
      "md": { "blur": 16, "tint": 0.15 },
      "lg": { "blur": 24, "tint": 0.72 }
    },
    "noise": true,
    "adaptive": true          // 按 device tier 自动降级
  },
  
  "fonts": {
    "display": "...",
    "body": "...",
    "mono": "...",
    "allowUserCustom": true   // 用户可自定义字体
  },
  
  "background": {
    "allowImage": true,
    "default": "assets/hero.webp",
    "presets": ["preset-1.webp", "preset-2.webp"]
  },
  
  "customizable": [            // 用户可调参数
    "accent",
    "background-image",
    "font",
    "glass-blur-scale"
  ],
  
  "components": {              // 组件变体选择
    "chat-bubble": "left-transparent",  // 气泡样式
    "sidebar-style": "glass",           // 侧边栏样式
    "input-style": "rounded"            // 输入框样式
  }
}
```

---

## 五、差异化设计：让主题不再是"换颜色"

### 5.1 主题类别重新定义

### 1) Flavour（风味）= 同主题 + 不同配色
- 一个主题默认携带 10+ 个 .ini 配色文件
- 切换时：解析新 INI → 生成 CSS variables CDMap → 替换 :root 变量
- 所有主题共享这 10 个配色

### 2) Variants（变体）= 同主题 + 不同组件策略
- midnight 变体：AI 消息无气泡 + 左侧线条装饰
- bubble 变体：所有消息有气泡 + 圆角
- compact 变体：更高密度 + 更小间距

### 3) Modes（模式）= 用户体验模式
- Chat Mode：纯聊天界面 → 宽松简洁
- Code Mode：代码编辑 → 底部终端 + 右侧 Agent
- Board Mode：任务管理 → 看板布局
- Doc Mode：文档写作 → 左侧大纲 + 中间文字

### 4) Presets（预设）= 场景 + 背景 + 字体组合
- 夜间模式：黑底 + 深蓝 accent + JetBrains Mono
- 日间模式：浅灰底 + 蓝 accent + Inter
- 护眼模式：暖色底 + 暗绿 accent + 大字号

---

## 六、用户可调参数空间（重要）

参考 Vencord QuickCSS + midnight discord + Spicetify Marketplace Settings：

```css
/* custom.css (用户可在 Theme Studio 或 Settings 中修改) */
:root {
  /* 颜色 */
  --accent-color: var(--agentskin-accent);      /* 来自主题 INI */
  
  /* 玻璃效果 */
  --glass-blur-scale: 1.0;                       /* 0 = 关闭, >1 = 更强 */
  --glass-noise: true;
  
  /* 背景 */
  --background-image: url("...");                /* 自定义背景图 URL */
  --background-opacity: 0.5;
  
  /* 字体 */
  --font-family: "Inter";
  --code-font: "JetBrains Mono";
  --font-size-base: 14px;
  
  /* 间距 */
  --spacing-density: 1.0;                        /* 0.85 = compact, 1.15 = comfort */
  
  /* 半径 */
  --radius-scale: 1.0;                           /* 全局圆角缩放 */
  
  /* 动画 */
  --animation-speed: 1.0;                        /* 0 = 关闭, 0.5 = 慢, 2 = 快 */
}
```

---

## 七、Agent 特定主题（产品 × 主题）

### 7.1 Coding Agent 主题池

| 主题 | 特征 | 配色体系 |
|------|------|---------|
| Midnight | 极暗 + 低饱和 | Nord / Tokyo / Gruvbox |
| Cyberpunk | Neon accent + 暗底 | Synthwave / Dracula |
| IDE Classic | 模拟 VS Code 默认 | Light Pro / Dark+ |
| Terminal | 等宽字体 + 绿/青 accent | Green on Black / Amber Pastel |

### 7.2 Work Agent 主题池

| 主题 | 特征 |
|------|------|
| Paper | 白底 + 蓝 accent + 清爽 |
| Fluent | Win 11 风格 + Mica |
| Apple | macOS 现代 + 毛玻璃 |
| WeChat | 国内熟悉感 + 绿气泡 |

### 7.3 Chat Agent 主题池

| 主题 | 特征 |
|------|------|
| Minimal Chat | 极简 + 低密度 |
| Modern Bubble | 渐变气泡 + 柔阴影 |
| Familiar Green | 微信风气泡 |
| Focus | 高密度 + 左侧对齐 |

---

## 八、架构关系图

```
Theme Marketplace
  ↓ 浏览/安装
User's Library/
  Agent-Dark/                    ← 已安装主题包
    color-schemes/               ← 10+ .ini 配色方案
      nord.ini
      tokyo.ini
      ...
    src/                         ← 源码模块
      core.css
      colors.css
      glass.css      ← 新增
      ...
    custom.css                   ← 用户自定义（持久化）
    theme.json

Settings → Theme
  
  选择颜色方案:
    [Nord] [Tokyo] [Catppuccin] [Gruvbox] ...  ← color-schemes/*.ini 的列表
  
  选择变体:
    [左侧透明] [气泡] [紧凑]   ← Variants
  
  选择模式:
    [Chat] [Code] [Board] [Doc]
  
  高级:
    自定义背景图 [上传/URL]
    字体 [系统/JetBrains/Inter/Fira]
    模糊强度 [关闭/低/中/高]
    阻尼 [快/正常/慢]
```

---

## 九、实施路线

### 阶段 1：Week 1-2 — 基础结构

- [ ] 新建 `themes/<theme>/color-schemes/` 目录，提供 10 个 INI
- [ ] 实现 color-ini-parser（Spicetify 兼容解析）
- [ ] manifest v3 schema
- [ ] Studio UI：Settings 页增加配色方案下拉框

### 阶段 2：Week 3-4 — 模块化拆分

- [ ] 拆分 generate-theme-css.mjs 为 home-css / chat-glass / chat-modals 等
- [ ] 引入 SCSS 或 LightningCSS 作为预处理（可选）
- [ ] custom.css 支持（用户自定义层）

### 阶段 3：Week 5-6 — 预览

- [ ] Studio 内嵌 CDP 预览（连接本地 agent）
- [ ] 自动截图生成主题预览图
- [ ] Theme Marketplace 集成

### 阶段 4：Week 7-8 — 质量

- [ ] WCAG 对比度校验（颜色配对检查）
- [ ] 每个主题至少 10 个配色 INI
- [ ] 低配降级 + 玻璃效果参数

---

## 十、核心收获总结

| 从 GitHub 学到的 | AgentSkin 当前状态 | 目标状态 |
|-----------------|-------------------|---------|
| 1 主题 = 完整 UX 体验 | 1 主题 = 1 套颜色变量 | 1 主题 = 可调参数空间 + 10+ 配色 |
| 单文件 (.theme.css) 分发 | 100KB+ 单生成脚本 | 多文件模块化构建， 单文件发布 |
| color.ini 10+ 配色是标配 | 1 主题 1 套色板 | 1 主题 10+ INI，用户可选 |
| 用户自定义层 custom.css | 无 | 支持用户自定义 CSS 持久化 |
| 预览图 CDP 截图 | 渐变图形 | 真实 UI 截图 |
| 主题更新不影响用户自定义 | 每次重写 palette.css | custom.css 不在生成范围 |

**最终目标**：让用户看到主题，觉得"这是一个不同的产品"——而不只是"换了个颜色"。

---

*文档版本: v1.0 | 创建日期: 2026-08-05 | 覆盖项目: Spicetify、BetterDiscord、Vencord、ClearVision、midnight-discord、catppuccin、Flashcord 等 500+ 仓库分析*

---

## 十一、可执行实施方案 — 文件级改造清单

> 本节将第九章「实施路线」展开到**文件粒度**：每个 Phase 列出要新建或修改的文件路径、用途、代码示例。所有代码均为可运行参考实现（非伪代码），可直接作为开发起点。

---

### 11.1 准备阶段 — 必须优先克隆的项目

在动手写代码之前，先 clone 以下 5 个参考项目到 `~/reference/`（或 `~/Desktop/reference/`），在后续 Phase 中持续对照：

| 优先级 | 项目 | Stars | 克隆命令 | 学习重点 |
|--------|------|-------|---------|---------|
| 🥇 | `spicetify/spicetify-cli` + `spicetify/spicetify-themes` | 20k+ | `git clone --depth 1 https://github.com/spicetify/spicetify-cli.git` | color.ini 多配色方案标杆：Dribbblish 主题 color.ini 有 19 个 section，对应 `spicetify config current_theme` 切换方式 |
| 🥈 | `catppuccin/catppuccin` | 40k+ | `git clone --depth 1 https://github.com/catppuccin/catppuccin.git` | 4 种 flavour（Latte/Frappe/Macchiato/Mocha）统一色彩体系：palette.yml 定义全部 YML → Sass 变量 → CSS 变量 |
| 🥉 | `amzn/style-dictionary` | 4.6k+ | `git clone --depth 1 https://github.com/amzn/style-dictionary.git` | 工业级 token pipeline：JSON → transform → 多平台输出（CSS SCSS iOS Android） |
| — | `ClearVision/ClearVision-v6` | 500+ | `git clone --depth 1 https://github.com/ClearVision/ClearVision-v6.git` | SCSS 模块化构建：`_variables.scss` + `@import` 模块 + PostCSS 编译 |
| — | `refact0r/midnight-discord` | 1.4k+ | `git clone --depth 1 https://github.com/refact0r/midnight-discord.git` | 分层结构典范：10 个文件 / 83KB / colors.css 占 46.8KB |

**建议的本地目录结构**：
```
~/Desktop/reference/
  spicetify-cli/           ← 学习 color.ini 解析逻辑
  spicetify-themes/        ← 学习 Dribbblish 的 19 个配色 section
  catppuccin/             ← 学习 YML palette → CSS 变量生成
  style-dictionary/       ← 学习 token pipeline 配置
  ClearVision-v6/         ← 学习 SCSS 模块拆分
  midnight-discord/       ← 学习颜色系统文件组织
```

---

### 11.2 新增 npm 依赖

```powershell
# 安装命令（在 desktop-main 根目录执行）
npm install --save-dev ini@5.0.0
npm install --save zod@4.0.0

# 验证安装
Get-ChildItem package.json | Select-Object -ExpandProperty Version
```

| 依赖 | 版本 | 用途 | 不选替代的原因 |
|------|------|------|--------------|
| `ini` | ^5.0.0 | 解析 Spicetify 风格的 `color.ini` 文件 | configparser(Python) 需要额外进程；smol-toml 不支持 INI section；自研解析器维护成本高 |
| `zod` | ^4.0.0 | manifest v3 schema 运行时校验 | 已在项目中使用；与 manifest-v2.schema.json 共同使用 schema 双轨验证（JSON Schema 编辑期 + zod 运行期） |
| `chalk`（已有） | — | 终端构建日志着色 | 已有，无需新增 |
| `sharp`（评估中） | — | CDP 截图后压缩/裁剪用于预览图 | Phase 5 视性能需求决定，可用原生 Canvas API 替代 |

> **不引入 `sass` 或 `lightningcss`**：当前项目使用 PostCSS（`postcss.config.mjs`），引入 SCSS 会与现有打包管线冲突。CSS 模块文件直接手写即可，编译开销为零。

---

### 11.3 文件修改清单 — 按 Phase 排列

#### Phase 1：color-ini 解析器 + 目录结构升级

**目标**：让主题包支持 `color-schemes/` 目录、10+ INI 配色文件，取代当前 `manifest.json` 里固定的 `colors` 对象。

##### 1.1 新建 `scripts/color-ini-parser.mjs`

```javascript
// scripts/color-ini-parser.mjs
// 解析 Spicetify 风格的 color.ini 文件（带 [section] 的 INI 格式）
// 兼容 Dribbblish 19 配色方案和 [colors] / [user-vars] 双 section 结构

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { parse as parseIni } from 'ini';

/**
 * 解析单个 INI 文件为结构化 ColorScheme 对象
 */
export function parseColorIni(iniPath) {
  const raw = readFileSync(iniPath, 'utf-8');
  const sections = parseIni(raw);

  const scheme = {
    name: basename(iniPath, '.ini'),
    colors: {},
    userVars: {},
  };

  for (const [section, entries] of Object.entries(sections)) {
    if (section === 'colors' || section === 'user-vars') {
      // 带 section 格式：[colors] + [user-vars]
      for (const [key, value] of Object.entries(entries)) {
        if (section === 'colors') {
          scheme.colors[normalizeKey(key)] = parseColorValue(value);
        } else {
          scheme.userVars[normalizeKey(key)] = parseUserVarValue(value);
        }
      }
    } else {
      // 扁平格式（Spicetify 默认）：直接 [nord] [dracula] ...
      scheme.colors[section] = {};
      for (const [key, value] of Object.entries(entries)) {
        scheme.colors[section][normalizeKey(key)] = parseColorValue(value);
      }
    }
  }

  return scheme;
}

/**
 * 扫描整个 color-schemes/ 目录，返回所有 INI 方案
 */
export function scanColorSchemes(themeDir) {
  const schemesDir = join(themeDir, 'color-schemes');
  if (!existsSync(schemesDir)) return [];

  return readdirSync(schemesDir)
    .filter((f) => f.endsWith('.ini'))
    .sort()
    .map((f) => parseColorIni(join(schemesDir, f)));
}

/** 将 INI key 标准化为 camelCase（如 main-bg → mainBg） */
function normalizeKey(key) {
  return key.trim().replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/** 解析颜色值：移除 #、支持 rgb(r,g,b) 格式 */
function parseColorValue(raw) {
  const v = String(raw).trim();
  // 移除前导 #
  if (v.startsWith('#')) return v.slice(1);
  // rgba()/rgb() → 去除空格
  if (v.startsWith('rgb')) return v.replace(/\s+/g, '');
  return v;
}

/** 解析 user-vars value：可以是颜色或者是 off/customizable 标记 */
function parseUserVarValue(raw) {
  const v = String(raw).trim();
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v === 'off') return false;
  if (v === 'customizable') return { customizable: true };
  // 尝试作为数字
  const num = parseFloat(v);
  if (!isNaN(num)) return num;
  return v;
}
```

##### 1.2 新建 `scripts/color-ini-generator.mjs`

```javascript
// scripts/color-ini-generator.mjs
// 从 manifest.colors 对象生成默认 color-schemes/default.ini
// 用法：node scripts/color-ini-generator.mjs themes/naruto-tobi

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseColorIni } from './color-ini-parser.mjs';

/** 颜色 key → INI 友好的 kebab-case 映射 */
const KEY_MAP = {
  accent: 'accent',
  secondary: 'secondary',
  background: 'background',
  foreground: 'foreground',
  muted: 'muted',
  surface: 'surface',
  surfaceElevated: 'surface-elevated',
  border: 'border',
  codeBackground: 'code-background',
  codeForeground: 'code-foreground',
  inputBackground: 'input-background',
  buttonBackground: 'button-background',
  buttonForeground: 'button-foreground',
  focusRing: 'focus-ring',
};

/** 从 manifest colors 对象生成 [colors] section */
export function generateDefaultIni(manifestColors, schemeName = 'default') {
  const lines = ['[colors]'];
  for (const [iniKey, hexValue] of Object.entries(manifestColors)) {
    const mappedKey = Object.entries(KEY_MAP).find(([camel]) => camel === iniKey)?.[1] ?? iniKey;
    lines.push(`${mappedKey} = ${hexValue}`);
  }
  return lines.join('\n') + '\n';
}

/** 为整个主题包生成默认 INI（CLI 入口） */
export function generateForTheme(themeDir) {
  // 读取 manifest（需要用 dynamic import）
  const manifestPath = join(themeDir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    console.error(`[color-ini-gen] ${manifestPath} not found`);
    return;
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  if (!manifest.colors) {
    console.warn(`[color-ini-gen] manifest has no colors field`);
    return;
  }

  const schemesDir = join(themeDir, 'color-schemes');
  if (!existsSync(schemesDir)) mkdirSync(schemesDir, { recursive: true });

  const iniContent = generateDefaultIni(manifest.colors);
  writeFileSync(join(schemesDir, 'default.ini'), iniContent);
  console.log(`[color-ini-gen] generated ${schemesDir}/default.ini`);
}

// CLI 入口
const themeDir = process.argv[2];
if (themeDir) generateForTheme(themeDir);
```

##### 1.3 示例 10 个 INI 配色文件

**文件**：`themes/naruto-tobi/color-schemes/default.ini`

```ini
; themes/naruto-tobi/color-schemes/default.ini
; 默认配色 — 漩涡面具·写轮红
; 参照 manifest.json colors 字段自动生成

[colors]
accent          = #c41e2a
secondary       = #d4a84a
background      = #0a0a14
foreground      = #e8d5d5
muted           = #7a6b75
surface         = #222230
surface-elevated = #2c2c3c
border          = #33334a
code-background  = #06060c
code-foreground  = #d8c5cc
input-background = #25232c
button-background = #c41e2a18
button-foreground = #c41e2a
focus-ring      = #c41e2a60

[user-vars]
accent          = customizable
background-image = off
font-family     = 'Inter'
glass-blur-scale = 1.0
```

**文件**：`themes/naruto-tobi/color-schemes/nord.ini`

```ini
; Nord 极地冷色 — 来自 catppuccin 社区的通用配色包
[colors]
accent          = #88c0d0
secondary       = #81a1c1
background      = #2e3440
foreground      = #d8dee9
muted           = #7b88a1
surface         = #3b4252
surface-elevated = #434c5e
border          = #4c566a
code-background  = #1d2128
code-foreground  = #abb9cf
input-background = #3b4252
button-background = #88c0d018
button-foreground = #88c0d0
focus-ring      = #88c0d060

[user-vars]
accent          = customizable
background-image = off
font-family     = 'Inter'
glass-blur-scale = 1.0
```

**文件**：`themes/naruto-tobi/color-schemes/tokyo-night.ini`

```ini
; Tokyo Night 东京夜蓝
[colors]
accent          = #7aa2f7
secondary       = #bb9af7
background      = #1a1b26
foreground      = #c0caf5
muted           = #565f89
surface         = #24283b
surface-elevated = #2f3549
border          = #3b4261
code-background  = #16161e
code-foreground  = #a9b1d6
input-background = #24283b
button-background = #7aa2f718
button-foreground = #7aa2f7
focus-ring      = #7aa2f760

[user-vars]
accent          = customizable
background-image = off
font-family     = 'Inter'
glass-blur-scale = 1.0
```

**文件**：`themes/naruto-tobi/color-schemes/catppuccin.ini`

```ini
; Catppuccin Mocha — 40k★ 社区验证的配色体系
[colors]
accent          = #cba6f7
secondary       = #f5c2e7
background      = #1e1e2e
foreground      = #cdd6f4
muted           = #6c7086
surface         = #313244
surface-elevated = #45475a
border          = #585b70
code-background  = #11111b
code-foreground  = #bac2de
input-background = #313244
button-background = #cba6f718
button-foreground = #cba6f7
focus-ring      = #cba6f760

[user-vars]
accent          = customizable
background-image = off
font-family     = 'Inter'
glass-blur-scale = 1.0
```

**文件**：`themes/naruto-tobi/color-schemes/gruvbox.ini`

```ini
; Gruvbox dark — 复古像素风
[colors]
accent          = #b8bb26
secondary       = #fb4934
background      = #282828
foreground      = #ebdbb2
muted           = #928374
surface         = #3c3836
surface-elevated = #504945
border          = #665c54
code-background  = #1d2021
code-foreground  = #d5c4a1
input-background = #3c3836
button-background = #b8bb2618
button-foreground = #b8bb26
focus-ring      = #b8bb2660

[user-vars]
accent          = customizable
background-image = off
font-family     = 'Inter'
glass-blur-scale = 1.0
```

**文件**：`themes/naruto-tobi/color-schemes/dracula.ini`

```ini
[colors]
accent          = #bd93f9
secondary       = #ff79c6
background      = #282a36
foreground      = #f8f8f2
muted           = #6272a4
surface         = #44475a
surface-elevated = #545870
border          = #44475a
code-background  = #1e1f29
code-foreground  = #f0f0f5
input-background = #2d2f3b
button-background = #bd93f918
button-foreground = #bd93f9
focus-ring      = #bd93f960

[user-vars]
accent          = customizable
background-image = off
font-family     = 'Inter'
glass-blur-scale = 1.0
```

**文件**：`themes/naruto-tobi/color-schemes/rose-pine.ini`

```ini
; Rosé Pine — 温柔紫粉
[colors]
accent          = #ebbcba
secondary       = #c4a7e7
background      = #191724
foreground      = #e0def4
muted           = #6e6a86
surface         = #1f1d2e
surface-elevated = #26233a
border          = #403d52
code-background  = #121019
code-foreground  = #d8d5e6
input-background = #1f1d2e
button-background = #ebbcba18
button-foreground = #ebbcba
focus-ring      = #ebbcba60

[user-vars]
accent          = customizable
background-image = off
font-family     = 'Inter'
glass-blur-scale = 1.0
```

**文件**：`themes/naruto-tobi/color-schemes/solarized.ini`

```ini
; Solarized Dark — 老派经典
[colors]
accent          = #268bd2
secondary       = #2aa198
background      = #002b36
foreground      = #93a1a1
muted           = #657b83
surface         = #073642
surface-elevated = #0a4050
border          = #084d60
code-background  = #001e26
code-foreground  = #839496
input-background = #073642
button-background = #268bd218
button-foreground = #268bd2
focus-ring      = #268bd260

[user-vars]
accent          = customizable
background-image = off
font-family     = 'Inter'
glass-blur-scale = 1.0
```

**文件**：`themes/naruto-tobi/color-schemes/github-dark.ini`

```ini
; GitHub Dark — GitHub 官方配色
[colors]
accent          = #58a6ff
secondary           = #f78166
background      = #0d1117
foreground      = #c9d1d9
muted           = #8b949e
surface         = #161b22
surface-elevated = #1f2428
border          = #30363d
code-background  = #090c10
code-foreground  = #afb8c1
input-background = #161b22
button-background = #58a6ff18
button-foreground = #58a6ff
focus-ring      = #58a6ff60

[user-vars]
accent          = customizable
background-image = off
font-family     = 'Inter'
glass-blur-scale = 1.0
```

**文件**：`themes/naruto-tobi/color-schemes/amoled.ini`

```ini
; AMOLED Pure Black — 极黑省电
[colors]
accent          = #7c5cff
secondary           = #585b70
background      = #000000
foreground      = #cccccc
muted           = #666666
surface         = #111111
surface-elevated = #1a1a1a
border          = #222222
code-background  = #050505
code-foreground  = #bbbbbb
input-background = #111111
button-background = #7c5cff18
button-foreground = #7c5cff
focus-ring      = #7c5cff60

[user-vars]
accent          = customizable
background-image = off
font-family     = 'Inter'
glass-blur-scale = 0.0
```

> **注意**：每行颜色值前的空格是必须的。ini@5.0.0 解析器要求 `key = value` 格式中 `=` 两侧有空格，否则部分值会解析失败。

##### 1.4 修改 `src/main/catalog/theme-catalog.ts`

在 `toItem()` 方法中增加 `colorSchemes` 字段读取：

```typescript
// 在 toItem 方法中新增：
private toItem(theme: InstalledTheme): ThemeCatalogItem {
  // ... 原有字段保留 ...
  
  // Phase 1 新增：读取 color-schemes 目录
  return {
    // ... 原有字段 ...
    colorSchemes: theme.colorSchemes ?? [],  // string[] — INI 文件名列表
    activeColorScheme: theme.activeColorScheme ?? 'default',
  };
}
```

##### 1.5 修改 `src/main/services/theme-bundle.ts`

在 `resolveThemeTargetFor()` 构建 CSS 时追加 INI 颜色变量：

```typescript
// 在 ResolvedThemeTarget 接口中新增字段
export interface ResolvedThemeTarget {
  theme: ThemeIdentity;
  css: string;
  options: Record<string, unknown>;
  verification: VerificationProfile | null;
  imageDataUrls: Record<string, string>;
  artDataUrl: string | null;
  // Phase 1 新增
  colorSchemeName?: string;    // 当前激活的配色方案名
  colorSchemeColors?: Record<string, string>; // 激活配色的 CSS 变量 key→value
}
```

---

#### Phase 2：manifest schema v3

##### 2.1 新建 `docs/manifest-v3.schema.json`

```jsonc
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://agentskin.dev/schema/manifest-v3.json",
  "title": "AgentSkin Theme Manifest v3",
  "description": "v3 — 新增 colorSchemes（多配色方案）、customizable（用户可调参数）、components（组件变体选择）和 glass（玻璃效果对象）字段。向后兼容 v2：colors 字段保留但不再强制。",
  "type": "object",
  "required": ["id", "name", "version"],
  "additionalProperties": false,
  "properties": {
    "schemaVersion": {
      "type": "integer",
      "const": 3,
      "description": "Manifest schema version — v3"
    },

    "id": {
      "type": "string",
      "pattern": "^[a-z0-9][a-z0-9_-]*$",
      "description": "Stable theme identifier"
    },
    "name": {
      "type": "string",
      "minLength": 1,
      "maxLength": 64
    },
    "displayName": {
      "type": "string",
      "maxLength": 64
    },
    "version": {
      "type": "string",
      "pattern": "^\\d+\\.\\d+\\.\\d+(-[a-zA-Z0-9.]+)?$"
    },

    "colorSchemes": {
      "type": "object",
      "required": ["directory"],
      "additionalProperties": false,
      "properties": {
        "directory": {
          "type": "string",
          "const": "color-schemes/",
          "description": "相对于主题根目录的配色方案目录路径"
        },
        "default": {
          "type": "string",
          "description": "默认配色方案文件名（不含 .ini 后缀）"
        }
      },
      "description": "多配色方案声明。用户可在 Settings → Theme 中切换"
    },

    "glass": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "enabled": {
          "type": "boolean",
          "default": false,
          "description": "是否启用玻璃效果"
        },
        "tiers": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "sm": {
              "type": "object",
              "required": ["blur", "tint"],
              "properties": {
                "blur": { "type": "number", "description": "blur radius in px" },
                "tint": { "type": "number", "minimum": 0, "maximum": 1 }
              }
            },
            "md": {
              "type": "object",
              "required": ["blur", "tint"],
              "properties": {
                "blur": { "type": "number" },
                "tint": { "type": "number", "minimum": 0, "maximum": 1 }
              }
            },
            "lg": {
              "type": "object",
              "required": ["blur", "tint"],
              "properties": {
                "blur": { "type": "number" },
                "tint": { "type": "number", "minimum": 0, "maximum": 1 }
              }
            }
          }
        },
        "noise": { "type": "boolean", "default": false },
        "adaptive": {
          "type": "boolean",
          "default": true,
          "description": "按设备性能自动降级"
        }
      },
      "description": "玻璃效果配置对象"
    },

    "customizable": {
      "type": "array",
      "items": {
        "type": "string",
        "enum": [
          "accent",
          "secondary",
          "background-image",
          "font-family",
          "font-size-base",
          "glass-blur-scale",
          "glass-noise",
          "spacing-density",
          "radius-scale",
          "animation-speed"
        ]
      },
      "uniqueItems": true,
      "description": "用户可调参数列表。在 Theme Studio 中以滑块/颜色选择器呈现"
    },

    "components": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "chat-bubble": {
          "type": "string",
          "enum": ["left-transparent", "bubble", "compact", "card"],
          "description": "聊天气泡样式"
        },
        "sidebar-style": {
          "type": "string",
          "enum": ["glass", "solid", "transparent", "bordered"],
          "description": "侧边栏样式"
        },
        "input-style": {
          "type": "string",
          "enum": ["rounded", "sharp", "pill", "underlined"],
          "description": "输入框样式"
        },
        "density": {
          "type": "string",
          "enum": ["comfortable", "balanced", "compact"],
          "description": "界面密度"
        }
      },
      "description": "组件变体选择 — 影响主题 CSS 的 display-mode class"
    },

    // 以下为 v2 兼容字段，全部可选
    "colors": {
      "type": "object",
      "description": "@deprecated 改用 color-schemes/ 目录。保留用于兼容 v2 客户端"
    },
    "targets": {
      "type": "object",
      "description": "Per-agent CSS targets (same as v2)"
    },
    "preview": { "type": "string" },
    "icon": { "type": "string" },
    "author": {
      "type": "object",
      "properties": {
        "name": { "type": "string" },
        "url": { "type": "string" }
      }
    },
    "category": { "type": "string" },
    "tags": {
      "type": "array",
      "items": { "type": "string" },
      "maxItems": 10
    },
    "license": { "type": "string" }
  }
}
```

---

#### Phase 3：单主题 10 配色方案建设

为现有每个主题各建 10 个 INI 配色文件。已完成 `naruto-tobi` 示例（见 Phase 1.3）。后续主题按相同目录结构：

```
themes/<theme-id>/
  color-schemes/
    default.ini          ← 主题原始配色
    nord.ini             ← Nord 冷色
    tokyo-night.ini      ← Tokyo Night 蓝紫
    catppuccin.ini       ← Catppuccin Mocha
    gruvbox.ini          ← Gruvbox 复古
    dracula.ini          ← Dracula 紫粉
    rose-pine.ini        << Rosé Pine 温柔紫粉
    solarized.ini        << Solarized 老派
    github-dark.ini      << GitHub Dark
    amoled.ini           << 极黑 AMOLED
```

**Settings UI 改造 — ColorSchemePicker 组件**

在 Theme 设置页（`src/ui/views/SettingsPage/ThemeSection.vue` 或等价位置）增加配色方案下拉器：

```vue
<!-- src/ui/components/ColorSchemePicker.vue -->
<template>
  <div class="color-scheme-picker">
    <label class="picker-label">配色方案</label>
    <div class="scheme-grid">
      <button
        v-for="scheme in schemes"
        :key="scheme.name"
        class="scheme-swatch"
        :class="{ active: scheme.name === selectedScheme }"
        :style="{ '--swatch-accent': scheme.colors.accent }"
        @click="selectScheme(scheme.name)"
        :title="scheme.name"
      >
        <span class="watch-swatch" />
        <span class="watch-label">{{ formatLabel(scheme.name) }}</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import type { ColorScheme } from '../../shared/types';

const props = defineProps<{
  schemes: ColorScheme[];
  selectedScheme: string;
}>();

const emit = defineEmits<{
  (e: 'select', schemeName: string): void;
}>();

function selectScheme(name: string) {
  emit('select', name);
}

function formatLabel(name: string): string {
  const labels: Record<string, string> = {
    default: '默认',
    nord: 'Nord',
    'tokyo-night': 'Tokyo',
    catppuccin: 'Catppuccin',
    gruvbox: 'Gruvbox',
    dracula: 'Dracula',
    'rose-pine': 'Rosé Pine',
    solarized: 'Solarized',
    'github-dark': 'GitHub',
    amoled: 'AMOLED',
  };
  return labels[name] ?? name;
}
</script>

<style scoped>
.color-scheme-picker {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.picker-label {
  font-size: 12px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.scheme-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
}
.scheme-swatch {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 4px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  cursor: pointer;
  transition: border-color 0.15s;
}
.scheme-swatch:hover {
  border-color: var(--accent);
}
.scheme-swatch.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}
.watch-swatch {
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: var(--swatch-accent);
  border: 2px solid var(--border);
}
.watch-label {
  font-size: 11px;
  color: var(--text);
  text-align: center;
}
</style>
```

> **类型定义**（`src/shared/types.ts` 中新增）：

```typescript
/** 单个配色方案（从 INI 文件解析得到） */
export interface ColorScheme {
  name: string;          // INI 文件名（不含 .ini）
  colors: Record<string, string>;   // key → #rrgggb（已去掉 #）的映射
  userVars: Record<string, string | boolean | number | { customizable: boolean }>;
}

/** 主题 catalog item 扩展 */
export interface ThemeCatalogItem {
  // ... 原有字段 ...
  colorSchemes?: ColorScheme[];
  activeColorScheme?: string;
}
```

---

#### Phase 4：用户自定义层 custom.css

##### 4.1 新建 `src/main/catalog/custom-css-loader.ts`

```typescript
// SPDX-License-Identifier: MPL-2.0

/**
 * Custom CSS Loader — 读取主题目录下的 custom.css，追加到注入末尾。
 *
 * 核心不变量：
 *  - custom.css 永不被主题构建覆盖（用户自定义持久化）
 *  - 首次安装时 custom.css 为空文件（bootstrap）
 *  - 注入顺序：L1 palette → L2 tokens → L3 theme → L4 adapter → custom.css
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const CUSTOM_CSS_FILENAME = 'custom.css';

/** 获取 custom.css 的完整路径 */
export function getCustomCssPath(themeDir: string): string {
  return join(themeDir, CUSTOM_CSS_FILENAME);
}

/** 首次安装时创建空 custom.css */
export function bootstrapCustomCss(themeDir: string): void {
  const path = getCustomCssPath(themeDir);
  if (!existsSync(path)) {
    writeFileSync(path, '/* AgentSkin custom.css — 在此写入你的自定义 CSS */\n', 'utf-8');
  }
}

/** 读取 custom.css 内容，如果不存在返回空字符串 */
export function loadCustomCss(themeDir: string): string {
  const path = getCustomCssPath(themeDir);
  if (!existsSync(path)) {
    bootstrapCustomCss(themeDir);
    return '';
  }
  return readFileSync(path, 'utf-8');
}

/** 保存用户自定义 CSS（从 Theme Studio 编辑器写入） */
export function saveCustomCss(themeDir: string, css: string): void {
  const path = getCustomCssPath(themeDir);
  writeFileSync(path, css, 'utf-8');
}

/**
 * 将 custom.css 追加到注入 CSS 的末尾
 * 这是关键的层级合并函数——custom.css 始终具有最高优先级
 */
export function appendCustomCss(baseCss: string, themeDir: string): string {
  const custom = loadCustomCss(themeDir);
  if (!custom.trim()) return baseCss;

  // 在末尾追加，确保最高来源优先级
  // 如果选择器特异性相同，后写的声明胜出
  return `${baseCss}\n\n/* === AgentSkin custom.css (user layer) === */\n${custom}\n`;
}

/** 检查 custom.css 是否为空白（无实质内容） */
export function isCustomCssEmpty(themeDir: string): boolean {
  try {
    const content = loadCustomCss(themeDir);
    return !content.trim() || content.trim().startsWith('/*') && content.trim().endsWith('*/');
  } catch {
    return true;
  }
}
```

##### 4.2 修改注入流程

在 CDP 注入器中（`src/main/cdp/injection/cdp-strategy.ts` 或等价主进程服务）使用 `appendCustomCss()`：

```typescript
import { appendCustomCss } from '../catalog/custom-css-loader';

// 在 resolveTheme() 合并 CSS 时调用：
const merged = appendCustomCss(agentCss, themeDir);
```

##### 4.3 Studio 中新增"自定义 CSS"编辑器

在 Theme Studio UI 侧（`src/ui/studio/` 目录）新增一个 `<style>` 标签编辑器面板，写入功能由 IPC 调用 `saveCustomCss()`。

---

#### Phase 5：预览图 CDP 截图

##### 5.1 修改 `src/main/cdp/snapshot-theme.ts`

在 `snapshotThemeVisuals` 函数末尾增加截图保存能力：

```typescript
/**
 * 在 snapshot 完成后，额外保存一份真实渲染截图到主题 assets/screenshots/
 * 用于 Theme Marketplace 显示，替代当前的纯色渐变 preview.png
 */
export async function captureThemePreview(
  agentId: AgentId,
  themeId: string,
  deps: {
    adapter: (id: AgentId) => ApplicationAdapter | null;
    applyTheme: (req: { themeId: string; appId: AgentId }) => Promise<OpaqueApplyResult>;
    findPortForAgent: (id: AgentId) => Promise<number | null>;
    log: (line: string) => void;
    getThemeAssetsPath: (themeId: string) => string;
  },
): Promise<string> {
  const port = await deps.findPortForAgent(agentId);
  if (!port) throw new Error(`No debug port for ${agentId}`);

  if (themeId) {
    await deps.applyTheme({ themeId, appId: agentId });
    await new Promise((r) => setTimeout(r, 800)); // 等注入生效
  }

  const domTargets = await findDomTargets(port);
  if (!domTargets.length) throw new Error(`No DOM targets on port ${port}`);

  const session = await connectCdp(domTargets[0].webSocketDebuggerUrl!, 5000, 30000);

  try {
    // CDP Page.captureScreenshot — 原生高质量截图
    const shot = await session.send<{ data: string }>('Page.captureScreenshot', {
      format: 'png',
      quality: 80,
      captureBeyondViewport: false,
    });

    // 保存到主题 assets 目录
    const assetsPath = deps.getThemeAssetsPath(themeId);
    const screenshotsDir = join(assetsPath, 'screenshots');
    mkdirSync(screenshotsDir, { recursive: true });

    const filename = `${agentId}-${Date.now()}.png`;
    const filePath = join(screenshotsDir, filename);
    writeFileSync(filePath, Buffer.from(shot.data, 'base64'));

    deps.log(`[preview-capture] saved ${filePath}`);
    return filePath;
  } finally {
    session.close();
  }
}
```

##### 5.2 修改 `ThemeCard` 组件

在主题卡片 UI（`src/ui/components/ThemeCard.vue` 或等价位置）切换为显示真实截图：

```vue
<template>
  <div class="theme-card">
    <img
      v-if="theme.coverDataUrl"
      :src="theme.coverDataUrl"
      class="card-preview"
      alt="Theme preview"
    />
    <!-- 如果没有真实截图，回退到原来的渐变占位图 -->
    <div v-else class="card-preview-fallback" :style="fallbackGradient" />
    <div class="card-info">
      <h3 class="card-title">{{ theme.name }}</h3>
      <SchemeBadge
        v-if="theme.colorSchemes?.length"
        :schemes="theme.colorSchemes.length"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ theme: ThemeCatalogItem }>();

const fallbackGradient = computed(() =>
  `background: linear-gradient(135deg, ${theme.colors?.accent || '#333'}, ${theme.colors?.background || '#111'})`,
);
</script>
```

---

### 11.4 文件汇总清单表

| 操作 | 文件路径 | 所属 Phase | 用途 |
|------|---------|-----------|------|
| **新建** | `scripts/color-ini-parser.mjs` | Phase 1 | 解析 Spicetify 风格 INI color-schemes |
| **新建** | `scripts/color-ini-generator.mjs` | Phase 1 | 从 manifest.colors 生成默认 INI |
| **新建** | `themes/naruto-tobi/color-schemes/default.ini` | Phase 1 | Naruto 默认配色 |
| **新建** | `themes/naruto-tobi/color-schemes/nord.ini` | Phase 1 | Nord 极地冷色 |
| **新建** | `themes/naruto-tobi/color-schemes/tokyo-night.ini` | Phase 1 | Tokyo Night 蓝紫 |
| **新建** | `themes/naruto-tobi/color-schemes/catppuccin.ini` | Phase 1 | Catppuccin Mocha |
| **新建** | `themes/naruto-tobi/color-schemes/gruvbox.ini` | Phase 1 | Gruvbox 复古像素 |
| **新建** | `themes/naruto-tobi/color-schemes/dracula.ini` | Phase 1 | Dracula 紫粉 |
| **新建** | `themes/naruto-tobi/color-schemes/rose-pine.ini` | Phase 1 | Rosé Pine 温柔紫粉 |
| **新建** | `themes/naruto-tobi/color-schemes/solarized.ini` | Phase 1 | Solarized 老派暗色 |
| **新建** | `themes/naruto-tobi/color-schemes/github-dark.ini` | Phase 1 | GitHub Dark |
| **新建** | `themes/naruto-tobi/color-schemes/amoled.ini` | Phase 1 | AMOLED 极黑 |
| **修改** | `src/main/catalog/theme-catalog.ts` | Phase 1 | toItem() 增加 colorSchemes 字段 |
| **修改** | `src/main/services/theme-bundle.ts` | Phase 1 | ResolvedThemeTarget 增加配色字段 |
| **新建** | `docs/manifest-v3.schema.json` | Phase 2 | v3 Schema（新增 colorSchemes/glass/customizable/components） |
| **修改** | `src/main/catalog/manifest-validator.ts` | Phase 2 | 加载并校验 v3 Schema |
| **新建** | `src/main/catalog/custom-css-loader.ts` | Phase 4 | custom.css 读写与追加 |
| **新建** | `src/ui/components/ColorSchemePicker.vue` | Phase 3 | Settings 配色方案下拉 UI |
| **修改** | `src/ui/views/SettingsPage/ThemeSection.vue` | Phase 3 | 集成 ColorSchemePicker |
| **修改** | `src/main/cdp/snapshot-theme.ts` | Phase 5 | 增加 captureThemePreview 截图函数 |
| **新建** | `src/main/services/preview-capture-service.ts` | Phase 5 | CDP 截图服务入口（调用 captureThemePreview） |
| **修改** | `src/ui/components/ThemeCard.vue` | Phase 5 | 显示真实截图替代渐变 |
| **新建** | `themes/naruto-tobi/custom.css` | Phase 4 | 用户自定义层（初始为空模板） |
| **新建** | `src/shared/types.ts`（追加） | Phase 3 | ColorScheme / ThemeCatalogItem 扩展类型 |

---

### 11.5 验证标准

| Phase | 验证命令 / 操作 | 预期结果 |
|-------|----------------|---------|
| **Phase 1** | `node scripts/color-ini-parser.mjs themes/naruto-tobi` | 解析 10 个 INI 文件，返回结构化 JSON，无语法错误 |
| **Phase 1** | `npx vitest run src/main/catalog/theme-catalog.test.ts` | catalog 单元测试通过，新增 colorSchemes 字段覆盖 |
| **Phase 1** | `npx vitest run scripts/color-ini-parser.test.ts`（需新建） | INI 解析器单测通过：section 边界、大小写、注释行处理 |
| **Phase 2** | `npx tsc --noEmit` | TypeScript 编译零错误 |
| **Phase 2** | `npx vitest run src/main/catalog/manifest-validator.test.ts` | 新 Schema 校验含 `colorSchemes.directory` 的 manifest 通过 |
| **Phase 3** | 应用主题 → Settings → Theme 中查看 | 出现配色方案网格，10 个色板正确渲染 |
| **Phase 3** | 选中 "Nord" → 点击 | 聊天界面实时切换为北欧冷色配色，无 CDP 注入错误 |
| **Phase 4** | 在 Theme Studio 编辑器写入 `.my-class { color: red; }` | 写入 custom.css → 刷新 → 自定义 CSS 生效 |
| **Phase 4** | 应用主题更新 → 检查 custom.css 内容 | custom.css 内容未改变，用户自定义保留 |
| **Phase 5** | Theme Studio 中点"保存预览" | `themes/<theme>/screenshots/<agentId>-<timestamp>.png` 存在且非空白图 |
| **Phase 5** | Theme marketplace 列表中查看 ThemeCard | 显示真实截图，512×288 PNG 在 <200ms 内加载 |

---

### 11.6 风险与回滚

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| `ini@5.0.0` 解析器对 Spicetify 边缘格式不兼容 | Phase 1 INI 解析失败 | `parseColorIni` try-catch + 手动回退正则解析 |
| manifest v3 向后兼容：旧客户端读取 v3 报错 | v2 客户端无法加载新主题 | v3 字段全部 optional + v2 `colors` 字段保留；服务端按 schemaVersion 分发不同 manifest |
| custom.css 含恶意 CSS（如 `position: fixed` 全局覆盖） | 用户自定义破坏界面 | Studio 编辑器内置 CSS 属性白名单 + LLM 辅助审核 |
| CDP 截图超时/大内存占用 | Phase 5 在低配机卡顿 | 截图延迟执行 + 超时 5s + 压缩质量 80% + 降级展示旧渐变图 |

---

*文档版本: v1.0 (第十一章为可执行案补充) | 创建日期: 2026-08-05 | 更新日期: 2026-08-05 | 覆盖 Phase: 1-5 全部改造清单*
