# 第 20 轮竞品深度分析报告

> 执行时间：2026-08-29 14:00
> 分析项目：xuhuanstudio/codex-styler, waiterxiaoyy/codress, jiarong0423/dream-skin-forge, jiarong0423/codex-dream-skin-workflow-engine, MagMueller/aios

---

## 一、分析项目概览

| 项目 | 定位 | 技术栈 | 核心创新 |
|------|------|--------|----------|
| xuhuanstudio/codex-styler | Codex 主题编辑器 + 皮肤创建器 | React + Tauri + Rust | Composer Interactions + 开放场景模型 |
| waiterxiaoyy/codress | Codex/WorkBuddy 桌面外观工具 | Electron 33 + Go API | 主题商店 + 管理后台 + 双应用支持 |
| jiarong0423/dream-skin-forge | macOS Codex 内部热抽换工具 | Bash + Node.js ESM | Module Matrix + Fail-Closed 验证 |
| jiarong0423/codex-dream-skin-workflow-engine | OpenAI Build Week 2026 参赛作品 | Bash + Node.js + CDP | 原生 UI Adapter + 碰撞退让 + 几何验证 |
| MagMueller/aios | 任意 Electron 应用实时修改套件 | Node.js + CDP | 主进程 Agent + 配置热更新 + CDP 端点 |

---

## 二、逐项目深度分析

### 2.1 xuhuanstudio/codex-styler

**当前版本**：v0.2.0-beta.9 (Creator Beta)
**许可证**：Apache-2.0 (代码) + CC BY 4.0 (美术资源)
**平台**：macOS 13+ (Apple Silicon) / Windows 11 x64

#### 核心架构

```
apps/desktop          React editor + Tauri desktop shell
apps/site             Astro bilingual website and documentation
packages/theme-core   Theme schema, validation, archives, built-in themes
docs                  Architecture, safety, assets, and decisions
```

运行时四层边界：
1. Desktop manager（UI 层）
2. Theme engine（主题引擎）
3. Versioned Codex adapter（版本化适配器）
4. Injected scene runtime（注入场景运行时）

#### 关键创新点

1. **Composer Interactions（作曲家交互）**
   - 替换 Codex 原生配置控件为主题感知体验
   - 5 种交互模式：Triple Drop / Capsule Crane / Loadout Forge / Three-axis Console / Mission Map
   - 每次交互返回完整配置负载（model + reasoning effort + response speed）
   - 字段级 diff 展示 + 确认 + 写回验证

2. **Companion Studio（伴侣工作室）**
   - 将静态图片/序列帧/视频/图集转化为校准的指针方向 + 姿势感知空闲动画
   - 可视化时间轴 + 方向拨盘
   - 非线性方向映射（非恒定源视频速度）
   - 无损 alpha 裁剪 + 地面线校准

3. **开放场景模型（Open Scene Model）**
   - 主题声明 `layers[]`、`entities[]`、renderer、behaviors
   - 不接触 Codex DOM 内部结构
   - 兼容性敏感行为封装在适配器内

4. **数据-only 包格式**
   - `.codex-styler-theme`：验证 ZIP（theme.json + LICENSES.json + assets + previews）
   - `.codex-styler-companion`：校准姿势 + 姿势感知空闲剪辑 + 分页图集
   - 无脚本、任意 CSS、SVG、视频、远程 URL、可执行字体

#### 安全模型

- 随机端口绑定 127.0.0.1
- 启动已安装的 Codex 可执行文件 + 临时调试端口
- 验证返回的 page target
- 注入一个幂等 scene root + 一个 style node
- Enhanced mode：完整语义处理 + live anchor + computed style 检查
- Conservative mode：仅隔离背景 + 场景层

#### 可借鉴点

| 创新 | AgentSkin 适用性 | 优先级 |
|------|------------------|--------|
| Composer Interactions 模式 | 高 — 可应用于设置页面的交互体验优化 | P1 |
| 开放场景模型 | 高 — 与 AgentSkin 四层注入架构互补 | P1 |
| 数据-only 包格式 | 中 — 可强化主题包安全校验 | P2 |
| Companion Studio | 低 — AgentSkin 不做宠物功能 | P3 |
| 非线性方向映射 | 低 — 仅伴侣动画相关 | P3 |

---

### 2.2 waiterxiaoyy/codress

**技术栈**：Electron 33 + Node 20 + Go 1.24
**平台**：macOS (Apple Silicon + Intel) / Windows x64

#### 核心架构

```
codress/
├── platform/
│   ├── apps/
│   │   ├── desktop/          # Electron 桌面客户端
│   │   │   ├── src/main/     # CDP, launcher, pets, updater, IPC
│   │   │   └── src/renderer/ # React 桌面 UI
│   │   └── admin/            # React + Ant Design 管理后台
│   ├── packages/skin-schema/ # 共享主题数据契约
│   ├── server/               # Go API
│   └── deploy/               # MySQL, seed data, deployment config
```

#### 关键创新点

1. **双应用支持矩阵**

| 目标 | 主题 | 宠物 | 平台 |
|------|------|------|------|
| Codex | 支持 | Codex v2 + 浮动桌面宠物 | macOS / Windows |
| WorkBuddy | 支持 | 暂不可用 | macOS / Windows |

2. **管理后台（Admin Console）**
   - 管理主题、宠物、分类、适配器、客户端版本、运营数据
   - React + Ant Design 技术栈
   - JWT 认证 + 管理员密码

3. **安全边界**
   - CDP 连接限制在回环地址
   - WebSocket target 检查预期形状和进程
   - 商店主题仅包含图片和元数据，不含可执行代码
   - 注入运行时随客户端提供，不从主题包动态加载

4. **本地主题创建器**
   - 无需账号即可本地创建
   - 预览 + 调整构图、图片处理、外观
   - 共享 background/panel/text/accent 调色板

#### 可借鉴点

| 创新 | AgentSkin 适用性 | 优先级 |
|------|------------------|--------|
| 管理后台模式 | 高 — AgentSkin 缺少运营数据视图 | P1 |
| 双应用支持架构 | 高 — 直接适用于 AgentSkin 6 适配器 | P1 |
| 安全边界设计 | 中 — 可强化 CDP 连接校验 | P2 |
| Go API 后端 | 低 — AgentSkin 无服务端 | P3 |

---

### 2.3 jiarong0423/dream-skin-forge

**定位**：macOS Codex 桌面端内部主题热抽换工具（第二版）
**许可证**：MIT

#### 核心架构

```
dream-skin-forge/
├── macos/
│   ├── assets/              # theme.json, runtime-modules.json, theme.css, renderer-inject.js
│   ├── scripts/             # install.sh, start.sh, verify.sh, restore.sh, injector.mjs, module-matrix.mjs, theme-store.mjs
│   ├── tests/               # run-tests.sh
│   ├── launcher/            # Dream Skin Forge.app / .command
│   └── previews/
├── theme-packs/             # orange-mecha-cat, knife-shield-dog, orbital-stargazer-black-cat
│   ├── scripts/activate-pack.mjs
│   ├── tools/chroma_key.py
│   └── validate-packs.sh
└── scripts/forge-gate.sh
```

#### 关键创新点

1. **Module Matrix（模块矩阵）**
   - runtime module ownership + payload budget
   - 每个模块有明确责任和防线
   - `theme-packs-extension` 必须通过矩阵验证

2. **Fail-Closed 验证**
   - pack 验证：完整性、alpha、尺寸、预算、SVG、cleanup
   - 验证不允许 cache、Finder metadata、unsafe path、idle playback DOM、错误 frame count
   - 生成端：pack manifest 是唯一入口，CLI 不接受手动乱写 active theme

3. **热抽换架构**
   - 右侧 hot-swap bay 使用 selector 切换 active pack
   - 不重建 native frame
   - active-only 模式：大图不常驻多份 DOM

4. **Activation CLI**
   - `list`、`plan`、`activate`、`rollback`
   - `plan` read-only，`activate` 先备份
   - 回滚测试：`activate-pack.mjs rollback` 回复上一个 active theme backup

5. **Runtime 修复案例**
   - Hot-swap selector 消失 → injector 检查 hot-swap bay/select 完整度
   - Theme-pack cache 失效 → 检查 schema 与 data:image/... 安全性
   - Sidebar row 变形 → renderer 侦测 native side gutter 后 fail closed
   - Titlebar/sidebar 接缝 → CSS 改由 header `::after` 从 left shell width 之后开始画线

#### 可借鉴点

| 创新 | AgentSkin 适用性 | 优先级 |
|------|------------------|--------|
| Module Matrix 模式 | 高 — 可直接应用于 AgentSkin 四层注入引擎 | P1 |
| Fail-Closed 验证 | 高 — 强化注入失败处理 | P1 |
| 热抽换架构 | 中 — 可优化主题切换体验 | P2 |
| Activation CLI | 中 — 可参考设计主题管理命令 | P2 |
| Runtime 修复方法 | 高 — 直接应用于 AgentSkin 适配器维护 | P1 |

---

### 2.4 jiarong0423/codex-dream-skin-workflow-engine

**定位**：OpenAI Build Week 2026 参赛作品（Developer Tools 赛道）
**许可证**：MIT

#### 核心架构

```
codex-dream-skin-workflow-engine/
├── macos/
│   ├── assets/              # theme.json, runtime-modules.json, theme.css, renderer-inject.js, backgrounds/, icons/
│   ├── scripts/             # install.sh, start.sh, verify.sh, restore.sh, injector.mjs, customize.sh
│   ├── tests/               # run-tests.sh
│   ├── launcher/
│   └── previews/
├── .agents/skills/codex-dream-skin-workflow/  # Codex 技能
├── submission/              # Devpost 文案、素材库、demo 影片
└── docs/PROJECT_LOG.md
```

#### 关键创新点

1. **原生 UI 适配器（Native UI Adapter）**
   - 锚点 + 几何验证
   - 五种挂载平面：场景底层、原生 surface、独立装饰、动态 portal、手动互动
   - 碰撞退让机制：大型机甲猫在文字或右侧 panel 侵入时退让

2. **模块化策略**
   - 10 个独立模块：background, iconBadge, buttonGlyphs, character, characterRetreat, composerSurface, conversationSurface, workspacePickers, projectPanels, tableFlipCat
   - 每个模块有明确责任和加载策略
   - 三种主题模式：chrome-only / sidebar-art / wallpaper

3. **Button Glyphs 系统**
   - 15 个抽象猫系符号按钮图标
   - 每个按钮有独立 SVG 设计
   - 默认关闭，需显式启用
   - 分模块启用：sidebar navigation / titlebar navigation / composer controls / top utility actions / message actions / project panel rows

4. **工作流门控（Workflow Gate）**
   - `--runtime` 模式：本地运行时检查
   - `--submission` 模式：提交前严格检查
   - 只要影片、repository、README、feedback session ID 或 judge path 未完成，就阻挡提交

5. **GPT-5.6 / Codex 集成证据**
   - 视觉拆解：主题语言、safe area、撞色分区
   - 生图与选型：Image2 生成原创机甲猫
   - 截图除错：定位背景没盖上、黑框、透明度、文字穿透
   - 动画调整：翻桌猫从预载/常驻改成点击后才载入
   - 退让机制：碰撞判断让大型机甲猫退让
   - 效能优化：压缩背景、换 runtime WebP、分 asset group hash

#### 可借鉴点

| 创新 | AgentSkin 适用性 | 优先级 |
|------|------------------|--------|
| 原生 UI 适配器 | 高 — 直接适用于 AgentSkin 6 适配器 | P1 |
| 碰撞退让机制 | 高 — 解决注入覆盖原生 UI 的问题 | P1 |
| 模块化策略 | 高 — 与 AgentSkin 四层注入架构对齐 | P1 |
| Button Glyphs 系统 | 中 — 可参考设计图标替换方案 | P2 |
| 工作流门控 | 中 — 可应用于发布前检查 | P2 |

---

### 2.5 MagMueller/aios

**定位**：任意 macOS Electron 应用实时修改套件
**许可证**：MIT

#### 核心架构

```
aios/
├── install.sh                  # 一次性安装器
├── scripts/
│   ├── agent.js                # Electron 主进程 Agent
│   ├── aios-config.default.json  # 起始配置
│   ├── drive.js                # CDP 客户端
│   └── resign.sh               # ad-hoc 重签名辅助
└── examples/
    ├── superset.json
    ├── slack.json
    ├── linear.json
    ├── discord.json
    ├── superhuman.json
    └── cursor.json
```

#### 关键创新点

1. **主进程 Agent 注入**
   - 一行补丁：`try { require("./aios-agent"); } catch {}`
   - 应用入口文件修改：提取 asar → 补丁入口 → 重打包 → 去除隔离 → ad-hoc 重签名
   - Agent 能力：
     - 监控 `/tmp/aios-config.json` 变化
     - 1 秒内重新注入 CSS/JS 到所有 BrowserWindow
     - 启用 CDP 127.0.0.1:9222
     - 导航和重渲染时重新注入

2. **三轨修改机制**
   - **Config file watcher**：编辑 `/tmp/aios-config.json`，1 秒内生效
   - **CDP**：`node scripts/drive.js '<js>'` 一次性执行
   - **Agent replacement**：编辑 `scripts/agent.js` 后重新安装

3. **应用支持范围**
   - Superset, Slack, Discord, Linear, Superhuman, Notion, Cursor, WhatsApp, Signal
   - 不适用于：原生 macOS 应用、App Store 应用、Apple 自有应用

4. **签名处理**
   - 备份原始 asar：`<APP>/Contents/Resources/app.asar.original.bak`
   - 从内到外 ad-hoc 重签名
   - 去除 `com.apple.quarantine`：`xattr -cr`

#### 可借鉴点

| 创新 | AgentSkin 适用性 | 优先级 |
|------|------------------|--------|
| 主进程 Agent 模式 | 低 — AgentSkin 明确禁止修改 app.asar | P3 |
| 配置热更新机制 | 高 — 可应用于主题配置实时预览 | P1 |
| CDP 端点暴露 | 中 — 可参考设计调试 API | P2 |
| 多应用支持架构 | 低 — AgentSkin 固定 6 适配器 | P3 |
| 签名处理方法 | 低 — AgentSkin 不修改目标应用 | P3 |

---

## 三、跨项目共性模式与趋势

### 3.1 注入架构演进

| 代际 | 代表项目 | 架构特征 |
|------|----------|----------|
| 第一代 | MagMueller/aios | 修改 app.asar + 主进程 Agent + CDP |
| 第二代 | Codex-Dream-Skin | 纯 CDP 外部注入 + 临时调试端口 |
| 第三代 | codex-styler / dream-skin-forge | 四层边界 + 版本化适配器 + 模块矩阵 |
| 第四代 | AgentSkin | 四引擎编排 + 统一契约 + 6 适配器 |

### 3.2 主题格式标准化趋势

| 项目 | 格式 | 内容 |
|------|------|------|
| codex-styler | `.codex-styler-theme` | ZIP(theme.json + LICENSES.json + assets + previews) |
| codress | 共享 skin-schema | 主题数据契约 |
| dream-skin-forge | `pack.json` | source/runtime/animation/icon manifest |
| AgentSkin | `.agentskin-theme` | manifest.json + palette.css + icon + preview + assets/ |

### 3.3 验证策略对比

| 项目 | 验证方式 | 失败处理 |
|------|----------|----------|
| codex-styler | live anchor + computed style | Enhanced → Conservative 降级 |
| dream-skin-forge | module-matrix + forge-gate | Fail-Closed |
| workflow-engine | 几何验证 + 碰撞检测 | 范围化还原 / 单模块修补 |
| AgentSkin | Injection State Machine + Health Monitor | 自动修复 + 退避重试 |

---

## 四、AgentSkin 可落地的改进方案

### P1 优先级（高价值 + 高可行性）

#### P1-1: 模块矩阵治理系统

**来源**：dream-skin-forge 的 Module Matrix 模式

**目标**：为 AgentSkin 四层注入引擎建立模块所有权和 payload budget 治理

**实施要点**：
- 定义 `module-matrix.json`  schema
- 每个注入模块声明：owner engine、payload budget、dependencies、failure strategy
- 运行时检查模块所有权冲突
- 超 budget 自动降级或拒绝

#### P1-2: 原生 UI 适配器增强

**来源**：codex-dream-skin-workflow-engine 的 Native UI Adapter

**目标**：为 6 个适配器的注入逻辑增加碰撞检测和几何验证

**实施要点**：
- 定义 5 种挂载平面：scene-base / native-surface / independent-decoration / dynamic-portal / manual-interaction
- 实现碰撞检测：注入元素不得覆盖原生文字、按钮、输入框
- 几何验证：注入前验证目标元素的尺寸、位置、可见性
- 退让机制：检测到碰撞时自动调整注入元素位置或尺寸

#### P1-3: 配置热更新机制

**来源**：MagMueller/aios 的 Config file watcher

**目标**：主题配置修改后实时预览，无需重启目标应用

**实施要点**：
- 主进程监听主题配置文件变化
- 通过 CDP 增量更新注入的 CSS 变量
- 支持 variable-level diff（只更新变化的 CSS 变量）
- 防抖处理（300ms）避免频繁更新

### P2 优先级（中等价值 + 高可行性）

#### P2-1: 主题包安全校验增强

**来源**：codex-styler 的 data-only 包格式 + dream-skin-forge 的 fail-closed 验证

**目标**：强化 `.agentskin-theme` 包的安全校验

**实施要点**：
- 文件类型白名单（已有）
- Manifest schema 校验（已有）
- CSS 作用域校验（已有）
- 新增：payload budget 检查（单文件/总体积/图片尺寸）
- 新增：资源引用完整性检查
- 新增：许可证声明要求

#### P2-2: 主题管理 CLI

**来源**：dream-skin-forge 的 Activation CLI

**目标**：提供命令行工具管理本地主题

**实施要点**：
- `agentskin-theme list`：列出已安装主题
- `agentskin-theme validate <path>`：验证主题包
- `agentskin-theme apply <id>`：应用主题
- `agentskin-theme rollback`：回滚到上一个主题
- `agentskin-theme plan <id>`：预览应用效果（dry-run）

### P3 优先级（低价值或低可行性）

#### P3-1: 管理后台概念验证

**来源**：codress 的 Admin Console

**目标**：为 AgentSkin Studio 增加运营数据视图

**注意**：AgentSkin 无服务端，此方案仅限本地数据收集

#### P3-2: Composer Interactions 模式

**来源**：codex-styler 的 Composer Interactions

**目标**：在 AgentSkin 设置页面增加主题感知的交互体验

**注意**：需要评估与 AgentSkin 现有设置页面的集成难度

---

## 五、实施计划

### 第一批（并行实施）

| 子智能体 | 任务 | 预期产出 |
|----------|------|----------|
| A1 | 模块矩阵治理系统 | `src/shared/injection/module-matrix.ts` + 测试 |
| A2 | 原生 UI 适配器增强 | `src/shared/injection/native-ui-adapter.ts` + 测试 |
| A3 | 配置热更新机制 | `src/main/theme/theme-hot-reload.ts` + 测试 |

### 第二批（串行依赖第一批）

| 子智能体 | 任务 | 预期产出 |
|----------|------|----------|
| B1 | 主题包安全校验增强 | 增强 `src/main/theme/import/zip-security-validator.ts` + 测试 |
| B2 | 主题管理 CLI | `scripts/agentskin-theme.mjs` + 测试 |

### 第三批（可选）

| 子智能体 | 任务 | 预期产出 |
|----------|------|----------|
| C1 | 管理后台概念验证 | 本地数据收集 + 报告视图 |

---

## 六、下一步建议

1. **立即执行**：第一批 3 个子智能体并行实施 P1-1/P1-2/P1-3
2. **追踪 codress 更新**：双应用支持架构可作为 AgentSkin 6 适配器的参考
3. **关注 codex-styler v1 发布**：Composer Interactions 可能成为行业标准
4. **学习 workflow-engine 的碰撞检测**：直接适用于 AgentSkin 的注入稳定性
5. **评估 aios 的配置热更新**：可移植到 AgentSkin 的实时预览功能

---

## 七、附录：项目原始数据

### A. codex-styler 内置主题

| 主题 | 方向 | 交互 |
|------|------|------|
| Native Refined | 低分心校准 | Moss + 克制动画 |
| Gilded Grandeur | 黑曜石架构 + 镀金细节 | Reset God + 金色视差 |
| Merry Big Top | 马戏团色彩 + 圆润戏剧表面 | Token Thief + 轻盈动画 |
| Nocturne Studio | 墨黑架构 + 烟熏玻璃 + 琥珀光 | Moss + 电影视差 |
| Quiet Garden | 柔和自然深度 + 可读半透明表面 | Moss + 自然视差 |

### B. dream-skin-forge 主题包

| Pack | 素材 | 状态 |
|------|------|------|
| orange-mecha-cat | 机甲猫 + 橙色主题 | asset-ready-unmounted |
| knife-shield-dog | 刀盾狗 + 城堡/城市背景 | asset-ready-unmounted |
| orbital-stargazer-black-cat | 观星黑猫 + 太空/天文台背景 | asset-ready-unmounted |

### C. aios 支持应用

Superset, Slack, Discord, Linear, Superhuman, Notion, Cursor, WhatsApp, Signal

---

> 报告生成时间：2026-08-29 14:00
> 分析基于项目 README 和公开文档
> 下一轮建议分析项目：CodeDrobe 生态、DSH 皮肤插件矩阵、新兴 AI 客户端母舰工具
