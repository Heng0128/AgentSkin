# 第 29 轮深度分析报告（2026-08-30 13:00）

## 分析项目总览

| # | 项目 | Stars | 定位 | 开发状态 | 与 AgentSkin 相关度 |
|---|------|-------|------|---------|---------------------|
| 1 | xxxhh336/dream-work-theme | 9 | 跨平台 Electron Work 应用主题切换器 | v1.2.6 活跃（8-26 发布） | **极高 — 直接竞品** |
| 2 | whyihaveyou/dsh-suite | 49 | DSH 插件商店 + 脚手架 + 自研插件 | **极度活跃**（今日更新） | 中 — 生态模式可借鉴 |
| 3 | xuhuanstudio/codex-styler | 15 | Codex 主题编辑器 + 皮肤创建器 + Companion | v0.2.0-beta.9（8-09） | 高 — 深度定制方案 |
| 4 | lntomF/codexskin | 14 | Codex 动态视觉主题引擎（Windows only） | v0.1.2 停更（7-21） | 中 — 动态效果技术 |
| 5 | ZhjGo/codex-skin-manager | 25 | 跨平台 Codex 主题管理器 | 停更（7-16） | 中 — UI 参考 |

---

## 1. dream-work-theme — 最直接竞品（⚠️高度关注）

### 核心数据
- **仓库**: xxxhh336/dream-work-theme
- **Stars**: 9, Forks: 2
- **语言**: TypeScript + Electron + Vite
- **最后更新**: 2026-08-26 11:19（v1.2.6 发布）
- **协议**: Apache-2.0
- **Topics**: catpaw, chatgpt, codex, qoderwork, qwenworkcn, skin, theme, traework, workbuddy, zcode

### 支持的应用列表（直接对标 AgentSkin）
Dream Work Theme 在 app-registry.ts 中正式声明应用：
- WorkBuddy ✅（AgentSkin 适配）
- TRAE Work ✅（AgentSkin 适配）
- QoderWork ✅（AgentSkin 适配）
- 豆包 Desktop ✅（AgentSkin 适配）
- ZCode ✅（AgentSkin 适配）
- Codex / ChatGPT Desktop ✅（AgentSkin 适配）
- CatPaw, 千问办公（QwenWorkCN）, HanaAgent, Kimi Work, OpenCode Desktop, AgnesCode, MiniMax Code, AstronClaw（讯飞星辰）, SparkDesk（讯飞星火）, StepFun（阶跃 AI）, DeepSeek Harness, MonkeyCode, AutoClaw

### 架构亮点

#### 1.1 主题菜单使用频率排序（AgentSkin 可借鉴 ⭐⭐⭐）
**机制**：右下角浮动菜单最多显示 4 个快捷预置主题，不再固定绑定某几个主题 ID。Dream Work Theme 按当前应用中的切换次数排序，次数相同时优先最近使用的主题；没有使用记录时从当前应用实际兼容的主题中补足。

**关键特性**：
- 使用频率按应用分别统计，同一主题在不同应用中可以有不同排序
- 从 Dream Work Theme 点击「应用主题」或从目标应用右下角菜单切换预置主题都会计数
- 菜单初始化、watcher 自动补注入、自定义图片切换和「还原主题」不会计数
- 当前应用的主题会进入本次菜单；后续菜单根据累计次数和最近使用时间重新排序
- 使用记录保存在用户数据目录的 `theme-usage.json`

**AgentSkin 借鉴优先级**: P0 — 当前 AgentSkin 主题菜单固定顺序，高频使用更便捷

#### 1.2 多窗口应用智能注入（AgentSkin 可借鉴 ⭐⭐⭐）
**问题场景**：Kimi Work 的 Work 与 Chat 是两个独立 renderer：`app://localhost/kimi-agent.html` 和 `https://www.kimi.com/`。Dream Work Theme 在首次应用时同时注入两个页面。

**方案**：
- CDP target hint 匹配（`app://`、`https://www.kimi.com/`）
- Watcher 监控 Work/Chat target 的创建、导航和重载
- 从 Work 切换到 Chat、切回 Work 或 renderer 重建后自动恢复当前主题
- Kimi 首次注入不再使用固定 3-4 秒等待。CDP renderer 通过短暂稳定确认后立即应用主题

**AgentSkin 借鉴优先级**: P0 — TRAE Work、豆包等应用也存在多窗口场景

#### 1.3 应用专属 CSS 构建函数（架构参考 ⭐⭐）
**命名模式**: `build*Css()` 系列函数 — `buildAgnesCodeCss()`、`buildMiniMaxCodeCss()`、`buildAstronClawCss()`、`buildSparkDeskCss()`、`buildStepFunCss()`、`buildDeepSeekHarnessCss()`、`buildMonkeyCodeCss()`、`buildAutoClawCss()`

**设计理念**：
- 每个应用一个专属 CSS 构建函数
- 透明化大面积 surface，只在实际交互控件保留局部对比背景
- 各应用的原生主题偏好在 `localStorage.theme`、`window.astronDesktop.settings.get().general.theme` 等不同位置
- 还原时实时读取当前原生深浅状态，恢复正确的原生模式

#### 1.4 自定义图片主题（功能参考 ⭐⭐）
**机制**：
- 导入后缩放压缩为 WebP、自动提取主题配色
- 最多保存 5 张，支持切换和删除
- 由 Dream Work Theme 主进程集中保存到用户数据目录的 `custom-themes.json`
- 跨应用共享同一图片库
- 当前选中的自定义图片记录在本地，页面刷新或 renderer 重建后自动恢复

#### 1.5 暗色文字 token 重映射（技术参考 ⭐⭐）
**豆包适配要点**：
- 豆包原生界面只有亮色模式。暗色主题会重映射侧栏账号、搜索、历史对话、顶部标题、首页建议、对话内容以及输入框操作栏的 `dbx` / `s-color` 文字 token
- 避免黑色文字落在暗色背景上
- AI 创作页的 sticky 标题栏会保持透明

### 最近 Commit 记录（8 月活跃）
```
0a5f2fa Merge remote-tracking branch 'origin/main' — v1.2.6 release
da5b3a8 Merge remote-tracking branch 'origin/main'
7f81d2f feat: support AutoClaw themes
8d5df4f feat: support MonkeyCode themes
d3b9f42 feat: support MonkeyCode themes
6278afd feat: support StepFun/SparkDesk/AstronClaw multi-tab/window
```

### 竞争态势评估
Dream Work Theme 是 AgentSkin 最直接的竞品：
- 定位几乎相同（跨平台 Electron Work 应用主题切换器）
- 适配应用列表高度重叠
- AgentSkin 的结构性优势：多引擎编排 + 统一契约 + 6 适配器 — Dream Work Theme 是单引擎
- Dream Work Theme 的优势：上手即用、400+ 内置主题、社区应用覆盖广
- **需要密切关注**：该项目 v1.2.6 开发活跃，正在快速扩展应用支持

---

## 2. dsh-suite — 生态插件商店模式（活跃参考）

### 核心数据
- **仓库**: whyihaveyou/dsh-suite
- **Stars**: 49, Forks: 10
- **语言**: HTML + Cordis（DSH 框架）
- **最后更新**: **2026-08-30 03:09**（今日！daily compat check + 自研插件更新）
- **协议**: MIT
- **规模**: 收录 1794 个插件

### 核心创新

#### 2.1 L1+L2 皮肤契约（AgentSkin 可借鉴 ⭐⭐）
**设计**：
- **L1（Token 契约）**: 全部颜色经 `--dsw-alias-*` 令牌引用（字面量仅作旧宿主兜底），零按主题选择器
- **L2（语义属性契约）**:
  - `data-dsh-plugin`: 插件根属性，声明插件身份
  - `data-dsh-surface`: `settings-modal`、`chat-input` 等语义场景
  - `data-dsh-part`: `banner`、`card`、`button-ghost`、`input`、`textarea`、`select`、`chip`、`panel` 等组件级标记

**实施效果**：
- plugin-team-board 0.2.1：全部颜色走 `--dsw-alias-*` 令牌，明暗主题无破相
- plugin-deus 0.4.1：32 处 `data-dsh-part` + surface 标记
- create-dsh-plugin 0.2.1 脚手架生成的插件默认遵循契约

**AgentSkin 借鉴**: 可考虑为 AgentSkin 主题契约增加语义属性层，让主题能根据控件语义做更精细的适配。

#### 2.2 自动化兼容测试（工程实践参考 ⭐⭐）
**机制**：
- CI 每小时刷新插件数据（metadata、stars、description）
- 每天把收录的包真实装进临时 profile 重测兼容性
- 兼容徽章系统：🟢 ok（通过）、⚪ unknown（未测）、🔴 broken（失败）

#### 2.3 全家包聚合包（功能思路 ⭐）
**机制**: `@dsh-suite/all` 一次安装带入第一方全家桶：
- plugin-manager：内置商店
- plugin-notify：IM 通知
- plugin-session-export：会话导出
- plugin-team-board：多 agent 任务板
- 未来计划 package-center 工作台

### 今日 Commit（8-30）— 极其活跃
```
fdca28a compat: daily check 2026-08-30
4312f59 docs: add Theme & Skin Compatibility declarations to 6 first-party package READMEs
25abd8a plugin-deus 0.4.1: dsh-web 皮肤契约适配
efb65c4 feat(create-dsh-plugin): 0.2.1 — templates teach the DSH Web styling contract
de3fd80 fix(team-board): 0.2.1 — DSH Web styling contract compliance
```

---

## 3. codex-styler — Clojure 深度定制方案（技术参考）

### 核心数据
- **仓库**: xuhuanstudio/codex-styler
- **Stars**: 15, Forks: 2
- **语言**: TypeScript + React + Tauri + Rust
- **最后更新**: 2026-08-27（活跃）
- **版本**: v0.2.0-beta.9（8-09 发布）
- **Topics**: codex-desktop, codex-skin, codex-theme, tauri, rust, theme-editor, interactive-background, react

### 架构分析

#### 3.1 四层分离架构（AgentSkin 架构参考 ⭐⭐）
```
1. Desktop manager        — React 编辑器 + Tauri 桌面壳
2. Theme engine           — theme-core 包
3. Versioned Codex adapter — CDP 注入逻辑
4. Injected scene runtime  — 页面内运行时
```

**关键设计**: 主题包**永远不包含 Codex DOM 选择器**。所有与 DOM 兼容性敏感的行为都锁在 adapter 里。这避免了主题作者写死脆弱的 CSS 选择器，让主题能在 Codex 更新后继续适配。

#### 3.2 Composer Interactions（功能创新参考）
**概念**: 替换 Codex 原生配置控件，提供 5 种主题感知的 Codex 配置交互：
- Triple Drop
- Capsule Crane
- Loadout Forge
- Three-axis Console
- Mission Map

每交互执行后会 field-by-field diff，确认后才应用。**主题与配置选择结合** — 每个视觉主题可以选择对应的配置组合（模型+推理强度+响应速度）。

#### 3.3 Open Scene Model（主题格式参考 ⭐⭐）
**JSON 结构**: 主题声明 `layers[]`、`entities[]`、`renderer`、`behaviors`，而不是直接写 CSS。

**数据-only 包**: `.codex-styler-theme` 仅包含：
- theme.json
- LICENSES.json
- assets/*.png|*.jpg|*.webp
- previews/*.png|*.jpg|*.webp

#### 3.4 Companion Studio（功能参考）
**Companion 与主题独立**: built-in theme 可以推荐 pairing companion，但用户可以任意组合。

**来源类型支持**:
- 静态图片
- naturally sorted sequence — 自动校准 8 或 16 个指针方向
- 短视频 — 视觉时间轴 + 方向转盘校准
- 已有 atlas — 直接导入

**Companion package format**: `.codex-styler-companion` 存储校准后的姿势、姿势感知的空闲剪辑、分页图集、专用肖像和许可证。

---

## 4. codexskin — 动态视觉主题（技术参考）

### 核心数据
- **仓库**: lntomF/codexskin
- **Stars**: 14, Forks: 1
- **语言**: Rust + Tauri
- **最后更新**: 2026-07-21（停更）
- **版本**: v0.1.2

### 技术要点

#### 4.1 动态视觉美学
**特色效果**：
- 呼吸律动的数字化外衣
- 精巧的图层微动（parallax）
- 磨砂玻璃通透效果
- 赛博朋克霓虹

#### 4.2 技术实现
**Rust Tauri 桌面应用**：WebView 前端 + Rust 后端 CDP 连接

**壁纸规格**:
- PNG/JPEG/WebP
- 单文件最大 12 MiB
- 宽高均不超 8192 像素

#### 4.3 已知限制
- Windows only（Tauri）
- 依赖 CodeSkin 保持运行，退出后无法自动恢复
- 停更状态，后续无新功能

---

## 5. codex-skin-manager — 跨平台 Linux 优先管理器（UI 参考）

### 核心数据
- **仓库**: ZhjGo/codex-skin-manager
- **Stars**: 25, Forks: 6
- **语言**: Electron + CSS/HTML
- **最后更新**: 2026-07-16（停更）
### 架构分析

#### 5.1 目录结构
```
electron/        主进程 + preload
engine/          核心注入引擎
src/             React UI
skins/          预制皮肤
```

#### 5.2 特色功能
- 完整管理界面：浏览、一键应用、零残留清理
- 社区评价和 LINUX DO 社区认可
- 早期开发阶段，进度缓慢

---

## 横向对比：竞品能力矩阵

| 维度 | AgentSkin | dream-work-theme | dsh-suite | codex-styler | codexskin | codex-skin-manager |
|------|-----------|------------------|-----------|--------------|-----------|-------------------|
| **引擎架构** | 四引擎编排 | 单引擎 | 不适用 | 四层分离 | 单引擎 | 单引擎 |
| **应用覆盖** | 6 适配器 | 17+ | DSH only | Codex only | Codex only | Codex only |
| **主题契约** | 14-token 严格 | 4 字段精简 | dsh-web L1+L2 | layers/entities | - | - |
| **主题编辑器** | Studio | 无 | 有 | 无 | 高级 Studio | 无 | 无 |
| **Companion** | 无 | 无 | 高级 Studio | 有 | 有 | 无 | 无 |
| **Composer Interactions** | 无 | 无 | 无 | 有 | 无 | 无 |
| **使用频率排序** | 无 | 有 | 不适用 | 不适用 | 无 | 无 |
| **多窗口注入** | 基础 | 强 | 不适用 | 不适用 | 无 | 无 |
| **主题菜单** | 右下角固定 | 高频动态排序 | 不适用 | 独立窗口 | 系统托盘 | 独立窗口 |
| **生态/社区** | 内部 | GitHub 社区驱动 | 1794+ 插件 | 闭源 | GitHub 社区 | 早期 |
| **更新频率** | 活跃 | 每日活跃 | **非常活跃**（今日） | Beta 周更 | 停更 | 停更 |
| **主题包格式** | .agentskin-theme | theme.json | .dsh.bundle | .codex-styler-theme | .zip | .json |
| **跨平台** | ✅ | ✅（Win/Mac/Linux） | N/A | ✅ | Win only | ✅ |

---

## AgentSkin 可借鉴的改进方案

### P0 优先级 — 推荐实施

#### P0-1: 高频使用主题菜单
**来源**: dream-work-theme  
**收益**: 用户频繁切换的主题自动前置，减少滚动查找  
**实施范围**: 
- 新增 `themeUsageStore` (Zustand) 记录每个 agent+theme 的切换次数和最后使用时间
- InjectDock 右下角菜单按使用频率动态排序，最多显示 4-6 个
- 持久化到 settings 文件
- 清除逻辑：不兼容/已删除的主题不显示，不占位

#### P0-2: 增强多窗口注入器
**来源**: dream-work-theme (Kimi Work, SparkDesk, StepFun 适配)  
**收益**: TRAE Work、豆包等有多个独立窗口的应用主题自动恢复  
**实施范围**:
- 抽象 WindowMatcher 接口，支持 URL 模式匹配
- 每个 Adaptor 声明窗口提示列表（如 Kimi Work 的 ["app://localhost/kimi-agent.html", "https://www.kimi.com/"]）
- Watcher 监控 CDP target 创建事件，自动注入新窗口
- 窗口切换时保持主题一致性

### P1 优先级 — 后续跟进

#### P1-1: 语义属性契约层
**来源**: dsh-suite 的 L1+L2 契约 + codex-styler 的 adapter 分离  
**收益**: 主题更稳定，Codex 更新不易破损  
**实施范围**:
- 为每个 adapter 声明语义属性映射表（`data-agentskin-plugin`、`data-agentskin-role`）
- 主题 CSS 优先使用语义属性选择器，减少 DOM 结构依赖

#### P1-2: Composer Interactions 概念移植
**来源**: codex-styler  
**收益**: 主题+配置组合一键切换  
**实施范围**:
- 预置几种「模型+推理强度+响应速度+主题」组合（如日用模式、深夜模式、专注模式）
- 用户可保存和命名自己的组合

### P2 优先级 — 可选探索

#### P2-1: 主题画廊分页与排序
**来源**: codex-styler 的 companion 系统  
**收益**: 提升主题选择体验

#### P2-2: 独立 Companion/Pet 实体
**来源**: codex-styler Companion Studio  
**收益**: 不修改 Codex 即可添加动态宠物
**⚠️ 需 RFC 评审**: 新功能突破

---

## 关键发现与风险提示

### 重大发现
1. **dream-work-theme 是最直接竞品**: 适配应用高度重叠，且 v1.2.6 刚发布（8-26），持续活跃开发中
2. **dsh-suite 今日（8-30）仍在高强度开发**: 正在把 L1+L2 皮肤契约向生态所有插件推广 — 这是 DSH 生态的主题契约标准化趋势
3. **codex-styler 的四层分离架构 + 适配器模式** 是已知最健壮的 Codex 注入方案，其"主题不包含 DOM 选择器"原则值得学习
4. **codexskin 和 codex-skin-manager 已停更** — 仅做一次性分析，不再跟踪

### 风险提示
- Dream Work Theme 的 400+ 内置主题 + 零配置优势对休闲用户有吸引力
- 但 AgentSkin 的四引擎编排 + 严格契约 + 多引擎协作在可维护性和升级抗性上有结构性优势
- 建议持续监控 dream-work-theme 的更新，尤其关注其 CDP 注入层的演进

---

## 下一步建议

### 立即实施（第 30 轮）
1. ✅ 实施 P0-1: 高频使用主题菜单
2. ✅ 实施 P0-2: 增强多窗口注入器
3. 编写对应测试覆盖

### 后续关注
- 持续监控 dream-work-theme 发展（最直接竞品）
- 学习 dsh-suite 的自动化兼容测试机制
- 评估语义属性契约层（P1-1）对现有 14-token 契约的影响
