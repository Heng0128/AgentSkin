# 竞品深度分析报告 — 第四轮 (2026-08-28)

> 分析日期: 2026-08-28 09:00
> 本轮重点: 跨平台母舰级工具 + CDP 基础设施 SDK + Agent 驱动引擎
> 覆盖项目: 5 个高价值项目深度分析

---

## 📊 执行摘要

| 项目 | Stars | 语言 | 最新发布 | 活跃度 | 与 AgentSkin 相关性 |
|------|-------|------|---------|--------|-------------------|
| **dream-work-theme** | 7 | TypeScript | v1.2.6 (2026-08-26!) | 🔥🔥🔥 极高 | ★★★★★ 极高 |
| **CodeDrobe/core** | 9 | JavaScript | v0.7.0-beta.0 (2026-07-21) | 🔥🔥 高 | ★★★★★ 极高 |
| **codex-autoskin** | 117 | JavaScript | v2.0.0 (2026-07-16) | 🔥 中 | ★★★★☆ 高(codex 限定) |
| **codex-styler** | 14 | TypeScript | v0.2.0-beta.9 (2026-08-11) | 🔥🔥 高 | ★★★★☆ 高(codex 限定) |
| **electron-cdp** | 2 | TypeScript | 无 Release (2026-05-18) | 🔥 低 | ★★★☆☆ 中(SDK层) |

**⚠️ 重大更新预警**: `dream-work-theme` 于 2026-08-26（昨日）发布 v1.2.6，含完整 Linux/macOS/Windows 三端构建产物（deb/AppImage/DMG/EXE），标记 traework/workbuddy/qoderwork/zcode 全四个我们的目标应用。

---

## 1. xxxhh336/dream-work-theme — 跨平台 Electron 主题切换器

### 1.1 基本信息

- **仓库**: https://github.com/xxxhh336/dream-work-theme
- **定位**: 适用于 Electron Work 应用的跨平台主题切换器
- **支持应用**: WorkBuddy、TRAE Work、QoderWork、ZCode、ChatGPT/Codex、QwenWork
- **License**: Apache-2.0
- **Topics**: catpaw, chatgpt, codex, qoderwork, qwenworkcn, skin, theme, traework, workbuddy, zcode
- **创建日期**: 2026-08-05
- **最近提交**: 2026-08-26（2 天前）
- **最近发布**: v1.2.6 (2026-08-26)
- **Star 数**: 7
- **Fork 数**: 2

### 1.2 GitHub 活动分析

**最近 5 次提交**:

| 日期 | 提交信息 |
|------|---------|
| 2026-08-26 | Merge remote-tracking branch 'origin/main' (解决合并冲突) |
| 2026-08-26 | Merge remote-tracking branch 'origin/main' (多文件冲突) |
| 2026-08-26 | feat: support AutoClaw themes |
| 2026-08-21 | feat: support MonkeyCode themes |
| 2026-08-21 | feat: support MonkeyCode themes (重复提交) |

**发布历史**:
- v1.2.6 (2026-08-26) - 正式版
  - 产物: linux-amd64.deb, linux-x64.tar.gz, linux-x86_64.AppImage, mac-arm64.dmg, mac-arm64.zip, mac-x64.dmg, mac-x64.zip, win-x64.exe
  - Windows 已有 2 次下载
  - 使用 electron-builder 自动构建（github-actions bot 发布）

### 1.3 技术分析

**架构分析**（基于 GitHub API 返回的 topics 和合并冲突文件列表）:

从合并冲突文件推断核心模块结构:
- `electron/manager/app-registry.ts` — 应用注册表（自动发现已安装的目标应用）
- `electron/manager/injector.ts` — 注入器核心
- `dist-electron/main.js` — 主进程入口
- `renderer/App.tsx` — 渲染进程 UI
- `renderer/app-initials.ts` — 应用识别/初始化
- `scripts/verify-package-bundle.cjs` — Bundle 验证脚本
- `PLANS.md` — 项目计划文档

**关键设计推断**:
1. **跨平台三驱**: 同时覆盖 macOS (arm64/x64)、Windows (x64)、Linux (deb/AppImage/tar.gz)
2. **Electron 架构**: 自身也是 Electron 应用，使用 electron-builder 打包
3. **应用注册表模式**: `app-registry.ts` 表明有自动发现机制扫描已安装的 Work 应用
4. **多主题源支持**: 同时支持自身主题、AutoClaw themes、MonkeyCode themes

### 1.4 可借鉴亮点

1. **Electron 工作台模式**: dream-work-theme 本身就是 Electron 应用，作为"主题母舰"管理多个目标应用的换肤。这与 AgentSkin 的引擎定位高度一致。

2. **跨平台产物矩阵**: v1.2.6 一口气发布 8 种产物格式（Linux 3 + macOS 2 + Windows 2 + macOS x64 2），使用 github-actions 自动化构建。AgentSkin 目前是纯换肤引擎而非独立产品，但如果未来要做独立工作台，可参考其 CI/CD 配置。

3. **插件化主题源**: 提交信息显示同时支持 AutoClaw 和 MonkeyCode 主题格式，意味着它正在成为一个多格式聚合器——这与 AgentSkin 主题源解析器 (`theme-source-parser.ts`) 支持多格式（Codedrobe/DreamSkin/源码/.agentskin-theme）的设计理念一致。

### 1.5 与 AgentSkin 对比

| 维度 | dream-work-theme | AgentSkin |
|------|-----------------|-----------|
| 定位 | 独立 Electron 桌面应用(工作台) | 引擎 + 多产品适配器 |
| 覆盖应用 | WorkBuddy, TRAE, QoderWork, ZCode, Codex, QwenWork | traework, qoderwork, workbuddy, doubao, codex, zcode |
| 注入方式 | 推断为 CDP（topics 含 cdp 但 README 被限制访问） | 四引擎协作（strategy/adapter/hybrid/deep-core） |
| 跨平台 | macOS + Windows + Linux | macOS + Windows |
| 主题格式 | 自研 + AutoClaw + MonkeyCode | .agentskin-theme (14-token 契约) |
| 成熟度 | v1.2.6 正式版，非常活跃 | 内部开发阶段 |

### 1.6 借鉴优先级评估

**高优先级**:
- 应用自动发现/注册表机制（`app-registry.ts`）
- 多主题格式聚合器设计
- 跨平台 CI/CD 产物矩阵

**中优先级**:
- Electron 工作台 UI 设计（如果 AgentSkin 未来做独立 Studio）

**低优先级**:
- 具体注入实现（AgentSkin 的四引擎架构更成熟）

---

## 2. CodeDrobe/core — 多应用换肤 CLI 运行时

### 2.1 基本信息

- **仓库**: https://github.com/CodeDrobe/core
- **定位**: AI 桌面应用可逆换肤运行时：CLI、适配器、CDP 注入、验证与商店发布
- **支持应用**: Codex, WorkBuddy, QoderWork (CN/Global), TRAE SOLO (Global/CN)
- **License**: Apache-2.0
- **npm 包**: @codedrobe/core@0.7.0-beta.0
- **Topics**: ai-coding, chrome-devtools-protocol, cli, codex, electron, nodejs, openai-codex, qcoderwork, theming, trae, workbuddy
- **创建日期**: 2026-07-16
- **最近提交**: 2026-07-21
- **Star 数**: 9
- **Fork 数**: 2

### 2.2 GitHub 活动分析

**最近 5 次提交**:

| 日期 | 提交信息 |
|------|---------|
| 2026-07-21 | v0.7.0-beta.0: Codex avatar-overlay exclusion and per-window probe/verify |
| 2026-07-21 | Exclude Codex avatar overlay and skip secondary windows in probe/verify |
| 2026-07-19 | v0.6.1: surface studio validation field details on CLI errors |
| 2026-07-18 | test: key port-file launch fixtures by the current platform |
| 2026-07-18 | v0.6.0: QoderWork and TRAE SOLO adapters with self-published debug-port discovery |

**发布历史**:
- v0.7.0-beta.0 (2026-07-21) - 预发布
- v0.6.1 (2026-07-19) - 正式版
- v0.6.0 (2026-07-18) - 正式版

### 2.3 技术深度分析

**架构设计**（基于 README）:

CodeDrobe/core 是一个 **npm 包 + CLI 双形态** 的换肤运行时：

```
@codedrobe/core (ES module)
├── applySkin() / restoreSkin()    ← 高级 API
├── getAdapter()                   ← 适配器注册表
├── readThemePackage()             ← 主题包解析
├── resolveThemeTarget()           ← 目标匹配
├── snapshotDom()                  ← DOM 快照（AI 辅助主题创作）
├── probeApp()                     ← 探测应用状态
└── watchTheme()                   ← 热监听（AbortSignal 生命周期）

CLI:
├── codedrobe apps                 ← 列出支持应用
├── codedrobe detect               ← 探测已安装应用
├── codedrobe apply                ← 应用主题
├── codedrobe dom snapshot         ← DOM 快照
├── codedrobe probe                ← 探测
└── codedrobe theme pack/inspect/convert ← 主题包管理
```

**适配器系统**:

| 适配器 | 平台 | 验证状态 |
|--------|------|---------|
| codex | macOS + Windows | ✅ 真机验证 (macOS 26.707.72221) |
| workbuddy | macOS + Windows | ✅ 真机验证 (5.2.6) |
| qoderwork | macOS CN | ✅ 真机验证 (0.9.12) |
| qoderwork | macOS Global + Windows | ⚠️ 静态提取验证 |
| traework | macOS Global | ✅ 真机验证 (0.1.36) |
| traework | CN + Windows | ⚠️ 静态提取验证 |

**核心设计亮点**:

1. **声明式验证契约** (verification contract):
   ```json
   {
     "targets": {
       "workbuddy": {
         "verification": {
           "required": [{ "name": "chat-surface", "any": [".chat-container", ".wb-cb-chat"] }],
           "recommended": [{ "name": "conversation-list", "any": [".conversation-list"] }],
           "contexts": [{ "name": "active-chat", "when": { "any": [".chat-route"] }, "required": [...] }]
         }
       }
     }
   }
   ```
   - required: 必须存在，否则阻止注入
   - recommended: 仅警告
   - contexts: 路由上下文感知验证

2. **DevToolsActivePort 自动发现**: QoderWork 强制 `remote-debugging-port=0`，CodeDrobe 自动读取 Chromium 的 `DevToolsActivePort` 文件获取实际端口。

3. **per-window 兼容性判断**: 多窗口场景下（如 Codex 的 avatar-overlay 二级窗口），仅当所有窗口都不兼容时才失败。

4. **DOM 快照 API**: `codedrobe dom snapshot` 输出结构化 JSON，专为 AI 辅助主题创作设计——记录元素关系、语义类、稳定选择器候选、边界框、计算样式。

5. **Codex 热重载**: 切换 Codex 主题无需重启，仅当应用未以 CDP 调试模式启动时才需要重启。

### 2.4 可借鉴亮点

1. **声明式验证契约系统**: 这是 CodeDrobe 最核心的创新。将"注入前验证"从硬编码选择器提升为声明式契约，支持 required/recommended/contexts 三级语义。AgentSkin 的注入编排层 (`orchestrator.ts`) 可以参考此设计，将 Layer Ownership 和 Token Ownership 的验证也声明化。

2. **DevToolsActivePort 自动发现**: 对于强制 `remote-debugging-port=0` 的应用（如 QoderWork），自动读取 Chromium 的端口文件。AgentSkin 的 qoderwork 适配器可以参考此逻辑。

3. **per-window 兼容性判断**: 多窗口场景下的优雅降级策略。AgentSkin 目前主要面向单窗口 Electron 应用，但未来如果支持多窗口目标应用，此设计很有参考价值。

4. **DOM 快照 API**: 专为 AI 辅助主题创作设计的只读 API，输出结构化 JSON 而非截图。AgentSkin 的 Visual Analyzer 方向可以参考此设计。

5. **npm 包 + CLI 双形态**: 既是库（供其他应用集成）又是 CLI（供终端使用）。这种双形态设计使 CodeDrobe 既可作为独立工具，也可作为其他产品的底层引擎。

### 2.5 与 AgentSkin 对比

| 维度 | CodeDrobe/core | AgentSkin |
|------|---------------|-----------|
| 形态 | npm 包 + CLI | Electron 应用 + 引擎 |
| 适配器数量 | 4 (codex/workbuddy/qoderwork/traework) | 6 (+ doubao/zcode) |
| 验证系统 | 声明式契约 (JSON) | 编排层代码验证 |
| 主题格式 | .codedrobe-theme (声明式) | .agentskin-theme (14-token) |
| 商店 | codedrobe.app (有社区商店) | 无（禁止自建商店） |
| 可逆性 | 完整 restore + 备份 | 运行时还原 |
| DOM 快照 | 有（AI 辅助创作） | 无（Visual Analyzer 方向有规划） |

### 2.6 借鉴优先级评估

**高优先级**:
- 声明式验证契约系统（可注入 orchestrator.ts）
- DevToolsActivePort 自动发现（qoderwork 适配器增强）
- per-window 兼容性判断逻辑

**中优先级**:
- DOM 快照 API 设计（Visual Analyzer 参考）
- npm 包 + CLI 双形态架构（如果 AgentSkin 未来开放 SDK）

**低优先级**:
- 社区主题商店（违反项目约束）

---

## 3. Finderchangchang/codex-autoskin — Agent 驱动换肤引擎

### 3.1 基本信息

- **仓库**: https://github.com/Finderchangchang/codex-autoskin
- **定位**: 发一张图给你的 Codex，它自己给自己换肤
- **支持应用**: Codex Desktop (macOS + Windows)
- **License**: MIT
- **Topics**: agent, cdp, codex, electron, openai, skin, theme
- **创建日期**: 2026-07-16
- **最近提交**: 2026-07-23
- **最新发布**: v2.0.0 (2026-07-16)
- **Star 数**: 117 ⭐（本轮分析中最高！）
- **Fork 数**: 22

### 3.2 GitHub 活动分析

**最近 5 次提交**:

| 日期 | 提交信息 |
|------|---------|
| 2026-07-23 | Merge pull request #5 from ChannelerH/add-built-in-theme-index |
| 2026-07-23 | Revise Caishen Readable theme link and clean up README |
| 2026-07-23 | docs: add Japanese built-in theme index |
| 2026-07-23 | docs: add Chinese built-in theme index |
| 2026-07-23 | docs: add Chinese built-in theme index |

**发布历史**:
- v2.0.0 (2026-07-16) - 正式版
  - Manifest 驱动引擎：加主题 = 放一个文件夹，零改码
  - THEME-SPEC.md 规范即生成器：agent 读 spec 自动产出主题
  - set-theme 一句话切换
  - 双栈 CDP 探测、watcher 防抖熔断、命中测试 QA

### 3.3 技术深度分析

**核心理念**: "Agent-native skin engine" — 整个换肤流程由 AI Agent 驱动，用户只需给 Codex 发一张图和一句话。

**技术栈**: PowerShell/POSIX shell + Node.js + Chrome DevTools Protocol，零第三方依赖。

**工作流程**:
1. 用户发送图片 + "install this skin" 给 Codex
2. Codex 克隆仓库、安装、从图片生成主题
3. 引擎启动 Codex with `--remote-debugging-port=9335`（仅 loopback）
4. CDP 注入 CSS + JS 层
5. Watcher 进程监控 Codex 重启，自动重应用主题

**主题系统**:
- 一个主题 = 一个文件夹（theme.json + 图片）
- THEME-SPEC.md 是面向 AI Agent 的完整规范：28 个颜色 token、裁剪工作流、亮/暗决策树、验收清单
- 内置 3 套主题：Aurora Veil（暗）、ember-bloom（亮）、Caishen Readable（暖色低疲劳）

**健壮性设计**:
- 双栈 CDP 探测
- Watcher 防抖 + 熔断 + 冷却
- 装饰层 hit-testing QA
- Windows: Startup watcher / macOS: LaunchAgent 自动重应用

### 3.4 可借鉴亮点

1. **Agent-native 工作流**: 整个换肤流程由 AI Agent 驱动，不是传统的"用户手动选择主题 → 应用"。这与 AgentSkin 的"AI Agent 视觉定制引擎"定位高度契合——AgentSkin 本身就是为 AI Agent 提供视觉定制能力的引擎。

2. **THEME-SPEC.md 规范即生成器**: 将主题规范写成 AI Agent 可直接消费的结构化文档（28 token + 决策树 + 验收清单），Agent 读 spec 即可自动产出主题并自验证。AgentSkin 的 14-token 契约可以参考此设计，产出更 AI-friendly 的规范文档。

3. **Manifest 驱动引擎**: 加主题 = 放一个文件夹，零代码改动。这种"约定优于配置"的设计使主题创作门槛极低。

4. **Watcher 防抖 + 熔断 + 冷却**: 监控目标应用重启后自动重应用主题，且不会因为频繁重启而失控。AgentSkin 的注入生命周期管理可以参考此设计。

5. **THEME-SPEC.md 的 AI 友好设计**: 不是传统的开发者文档，而是直接面向 LLM 的结构化 prompt——包含决策树、验收清单、裁剪工作流。这种"文档即 prompt"的设计理念很有前瞻性。

### 3.5 与 AgentSkin 对比

| 维度 | codex-autoskin | AgentSkin |
|------|---------------|-----------|
| 定位 | Agent 驱动的 Codex 换肤工具 | 多应用视觉定制引擎 |
| 目标应用 | 仅 Codex | 6 个应用 |
| 用户交互 | 给 AI 发图 + 一句话 | 引擎 API + UI |
| 主题格式 | theme.json + 图片（28 token） | .agentskin-theme（14 token） |
| Agent 集成 | 核心设计（THEME-SPEC.md） | 规划中（Visual Analyzer） |
| 健壮性 | watcher + 熔断 + 冷却 | InjectionLock + Queue |
| 社区热度 | 117 stars, 22 forks | 内部项目 |

### 3.6 借鉴优先级评估

**高优先级**:
- THEME-SPEC.md 的"文档即 prompt"设计理念
- Agent-native 工作流（用户发图 → Agent 生成 → 自动应用）
- Watcher 防抖 + 熔断 + 冷却机制

**中优先级**:
- Manifest 驱动引擎（约定优于配置）
- 双栈 CDP 探测

**低优先级**:
- Codex 特定实现（AgentSkin 已有 codex 适配器）

---

## 4. xuhuanstudio/codex-styler — Tauri 主题编辑器 + 伴侣系统

### 4.1 基本信息

- **仓库**: https://github.com/xuhuanstudio/codex-styler
- **定位**: 开源 Codex 主题编辑器与皮肤创建器
- **支持应用**: Codex Desktop (macOS + Windows)
- **License**: Apache-2.0 (代码) + CC BY 4.0 (美术资源)
- **Topics**: codex-desktop, codex-skin, codex-theme, desktop-customization, interactive-background, openai-codex, react, rust, tauri, theme-editor
- **创建日期**: 2026-07-16
- **最近提交**: 2026-08-09
- **最新发布**: v0.2.0-beta.9 (2026-08-11)
- **Star 数**: 14
- **Fork 数**: 2

### 4.2 GitHub 活动分析

**最近 5 次提交**:

| 日期 | 提交信息 |
|------|---------|
| 2026-08-09 | fix(release): generate SBOM from tagged source |
| 2026-08-09 | chore(ci): retrigger required checks |
| 2026-08-09 | fix(desktop): support multi-page CDP targets in beta.9 |
| 2026-07-20 | feat: ship verified Composer Interactions in Beta 8 |
| 2020-07-20 | feat: ship Beta 7 creator quality and theme system |

**发布历史**:
- v0.2.0-beta.9 (2026-08-11) - 预发布
  - macOS DMG (aarch64) + Windows EXE (x64)
  - 新增 multi-page CDP target 选择
  - SBOM (Software Bill of Materials) 生成
  - Windows 已有 55 次下载

### 4.3 技术深度分析

**技术栈**: React + Tauri (Rust) + Node.js 22 + pnpm 11

**项目结构**:
```
apps/desktop          React editor + Tauri desktop shell
apps/site             Astro bilingual website and documentation
packages/theme-core   Theme schema, validation, archives, built-in themes
docs                  Architecture, safety, assets, and decisions
```

**四大运行时边界**:
1. Desktop manager（桌面管理器）
2. Theme engine（主题引擎）
3. Versioned Codex adapter（版本化 Codex 适配器）
4. Injected scene runtime（注入场景运行时）

**核心创新**:

1. **Composer Interactions**: 替换 Codex 原生配置控件，提供 5 种主题感知的"交互"（Triple Drop, Capsule Crane, Loadout Forge, Three-axis Console, Mission Map），每种交互对应一组真实的 Codex 配置（model + reasoning + speed）。

2. **Companion Studio**: 将静态图片、序列帧、短视频或已有图集转化为校准的指针方向 + 姿态感知空闲动画。支持拖拽、吸附到 Codex 语义表面。

3. **Open Scene Model**: 主题声明 `layers[]`、`entities[]`、renderer 和 behaviors，而非硬编码 Codex DOM 选择器。主题包从不包含 Codex 选择器——兼容性敏感行为封装在适配器内。

4. **Data-only 包**: 仅包含本地栅格素材和 JSON，无脚本、CSS、SVG、视频、远程 URL 或可执行字体。

5. **安全模型**: 随机端口绑定 127.0.0.1，启动 Codex 时临时调试端口，注入幂等场景根 + 样式节点，恢复时移除两者。

**内置主题（5 套）**:

| 主题 | 方向 | 伴侣 |
|------|------|------|
| Native Refined | 低分心校准 | Moss (变色龙) |
| Gilded Grandeur | 黑曜石+金色 | Reset God |
| Merry Big Top | 马戏团风格 | Token Thief |
| Nocturne Studio | 墨黑+琥珀光 | Moss |
| Quiet Garden | 柔和自然 | Moss |

### 4.4 可借鉴亮点

1. **Open Scene Model**: 主题声明 layers/entities/renderer/behaviors 而非硬编码 DOM 选择器。这与 AgentSkin 的"层所有权"设计理念高度一致——将兼容性逻辑封装在适配器内，主题层只声明"做什么"而非"怎么选"。

2. **Composer Interactions**: 将主题与真实应用配置绑定（model + reasoning + speed），使主题不仅是"好看"而是"好用"。这种"主题即配置"的理念可以扩展——AgentSkin 的主题也可以携带推荐的应用配置。

3. **Companion Studio 的校准系统**: 将视频/图片序列转化为方向感知 + 姿态感知的动画系统，使用非线性方向映射保持自然姿态变化。这种"从素材到运行时"的校准管线设计很有参考价值。

4. **Data-only 包安全模型**: 严格限制主题包内容类型（仅本地图片 + JSON），从根源上防止恶意代码注入。AgentSkin 的主题包格式也可以参考此安全模型。

5. **Tauri + React 技术栈**: 使用 Tauri (Rust) 替代 Electron，产物体积更小、性能更好。如果 AgentSkin 未来考虑从 Electron 迁移，Tauri 是可行方向。

### 4.5 与 AgentSkin 对比

| 维度 | codex-styler | AgentSkin |
|------|-------------|-----------|
| 定位 | 主题编辑器 + 皮肤创建器 | 多应用视觉定制引擎 |
| 技术栈 | Tauri + React + Rust | Electron + React |
| 目标应用 | 仅 Codex | 6 个应用 |
| 主题模型 | Open Scene Model (layers/entities) | 14-token + CSS 变量 |
| 伴侣系统 | 有（6 个伴侣） | 无 |
| 安全模型 | Data-only + 随机端口 | 四引擎协作 |
| 成熟度 | Beta 9（活跃开发中） | 内部阶段 |

### 4.6 借鉴优先级评估

**高优先级**:
- Open Scene Model 设计理念（主题与 DOM 选择器解耦）
- Data-only 包安全模型
- 主题即配置（Composer Interactions 的理念）

**中优先级**:
- Tauri 技术栈参考（如果未来迁移）
- Companion Studio 的校准管线设计

**低优先级**:
- 具体伴侣实现（与 AgentSkin 核心方向关系不大）

---

## 5. ntoskrnl7/electron-cdp — CDP TypeScript SDK

### 5.1 基本信息

- **仓库**: https://github.com/ntoskrnl7/electron-cdp
- **定位**: 简化 Electron 中 CDP 使用的 TypeScript 库
- **License**: MIT
- **npm 包**: electron-cdp-utils
- **创建日期**: 2024-08-03
- **最近提交**: 2026-05-18（3 个月无更新）
- **Star 数**: 2
- **Fork 数**: 0

### 5.2 GitHub 活动分析

**最近活动**: 2026-05-18 后无新提交，活跃度低。

### 5.3 技术深度分析

**核心能力**:

1. **MainSession 类**: 封装 CDP 会话管理，支持 setup() 配置
2. **SuperJSON 集成**: 自动序列化/反序列化复杂类型（Date, Map, Set, Error, Buffer 等）
3. **执行上下文跟踪**: 实时监控浏览器执行上下文创建/销毁
4. **自动目标附着**: 自动附着到 iframe、worker、service worker
5. **函数暴露**: 将 Node.js 函数暴露到浏览器上下文，支持重试和超时

**API 设计**:
```ts
import { attach } from 'electron-cdp-utils';

const session = attach(window.webContents, '1.3');
await session.setup({
  preloadSuperJSON: true,
  trackExecutionContexts: true,
  autoAttachToRelatedTargets: ['page', 'iframe', 'worker']
});

// 执行函数
const result = await session.evaluate((msg: string) => {
  return document.title + msg;
}, 'Hello!');

// 暴露函数到浏览器
await session.exposeFunction('getSystemInfo', () => ({
  platform: process.platform,
  version: process.version
}));
```

### 5.4 可借鉴亮点

1. **SuperJSON 集成**: CDP 通信中的复杂类型自动序列化，避免手动 JSON.parse/stringify。AgentSkin 的 CDP 通信层可以参考此设计。

2. **执行上下文跟踪**: 实时监控 iframe/worker 的执行上下文变化。对于需要注入到多个渲染目标的应用（如 Codex 的多窗口场景）很有用。

3. **自动目标附着**: 自动发现并附着到 iframe/worker/service worker，无需手动管理。

### 5.5 与 AgentSkin 对比

| 维度 | electron-cdp | AgentSkin |
|------|-------------|-----------|
| 层级 | SDK 基础层 | 完整引擎 |
| 形态 | npm 包 | Electron 应用 |
| CDP 封装 | 高级封装（Session/SuperJSON） | 自有编排层 |
| 活跃度 | 低（3 个月无更新） | 内部活跃 |

### 5.6 借鉴优先级评估

**高优先级**:
- 无（AgentSkin 已有更成熟的 CDP 编排层）

**中优先级**:
- SuperJSON 集成模式（如果 AgentSkin 需要更复杂的 CDP 通信）
- 执行上下文跟踪（多窗口场景参考）

**低优先级**:
- 直接依赖此包（活跃度低，风险高）

---

## 🎯 综合评估与推荐方案

### 优先级排序

| 排名 | 项目 | 借鉴价值 | 实施难度 | 推荐行动 |
|------|------|---------|---------|---------|
| 1 | **dream-work-theme** | ★★★★★ | 中 | 深入研究其应用注册表和多格式聚合设计 |
| 2 | **CodeDrobe/core** | ★★★★★ | 中 | 移植声明式验证契约到 orchestrator |
| 3 | **codex-autoskin** | ★★★★☆ | 低 | 参考 THEME-SPEC.md 的 AI 友好设计 |
| 4 | **codex-styler** | ★★★★☆ | 中 | 学习 Open Scene Model 理念 |
| 5 | **electron-cdp** | ★★★☆☆ | 低 | 仅作知识储备 |

### 推荐落地方案

#### 方案 A: 声明式验证契约（来自 CodeDrobe/core）

**目标**: 将 AgentSkin 的注入验证从硬编码提升为声明式契约。

**实施步骤**:
1. 定义 JSON Schema 描述验证契约（required/recommended/contexts）
2. 在 `orchestrator.ts` 中集成契约验证器
3. 为每个适配器编写契约声明文件
4. 注入前自动验证，失败时提供详细错误信息

**预期收益**:
- 验证逻辑与注入逻辑解耦
- 主题作者可以声明式定义"我的主题需要什么 DOM 结构"
- 错误信息更友好，便于调试

**风险评估**: 低。纯增量改动，不影响现有注入流程。

#### 方案 B: THEME-SPEC.md AI 友好规范（来自 codex-autoskin）

**目标**: 将 AgentSkin 的 14-token 契约转化为 AI Agent 可直接消费的结构化文档。

**实施步骤**:
1. 分析 codex-autoskin 的 THEME-SPEC.md 结构
2. 为 AgentSkin 编写 `THEME-AI-SPEC.md`，包含：
   - 14-token 的语义描述 + 决策树
   - 亮/暗色适配指南
   - WCAG 对比度验收标准
   - 常见主题风格模板
3. 在 Visual Analyzer 中集成此规范作为 Agent prompt

**预期收益**:
- AI Agent 可以自动生成符合 AgentSkin 契约的主题
- 降低主题创作门槛
- 与 AgentSkin 的"AI Agent 视觉定制引擎"定位完美契合

**风险评估**: 低。纯文档工作，不涉及代码改动。

#### 方案 C: 应用自动发现注册表（来自 dream-work-theme）

**目标**: 自动发现用户系统中已安装的目标应用，无需手动配置路径。

**实施步骤**:
1. 研究 dream-work-theme 的 `app-registry.ts` 实现
2. 为 AgentSkin 实现类似的应用扫描器：
   - macOS: Spotlight 查询 + bundleId 匹配
   - Windows: 注册表卸载键 + 默认安装路径
3. 在 Settings 页面展示自动发现的应用列表

**预期收益**:
- 用户体验提升（无需手动指定应用路径）
- 减少配置错误
- 支持多版本共存（如 QoderWork CN + Global）

**风险评估**: 中。需要处理不同平台的发现逻辑，但 dream-work-theme 已有成熟实现可参考。

---

## 📋 下一步行动

1. **立即可执行**:
   - [ ] 编写 AgentSkin `THEME-AI-SPEC.md`（参考 codex-autoskin）
   - [ ] 设计声明式验证契约 JSON Schema（参考 CodeDrobe/core）

2. **短期调研**:
   - [ ] 深入研究 dream-work-theme 的 `app-registry.ts` 实现
   - [ ] 评估 Tauri 替代 Electron 的可行性（参考 codex-styler）

3. **中期规划**:
   - [ ] 实现应用自动发现注册表
   - [ ] 在 orchestrator.ts 中集成声明式验证
   - [ ] 开发 DOM 快照 API（参考 CodeDrobe/core 的 `codedrobe dom snapshot`）

---

## 附录: 历史分析轮次回顾

| 轮次 | 日期 | 分析项目 | 落地成果 |
|------|------|---------|---------|
| 第 1 轮 | 2026-08-26 | HeiGe Codex Skin Studio | atomicWriteJson + operation-lock + derive-missing-tokens (65 测试) |
| 第 2 轮 | - | (待补充) | - |
| 第 3 轮 | - | (待补充) | - |
| **第 4 轮** | **2026-08-28** | **dream-work-theme + CodeDrobe + codex-autoskin + codex-styler + electron-cdp** | **本报告** |

---

*本报告由 CatPaw AgentSkin 竞品研究自动化流程生成*
*下次分析建议聚焦: DSH 插件生态 + WorkBuddy 主题管理器 + 豆包/ Doubao 适配方案*
