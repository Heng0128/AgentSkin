# 第 21 轮竞品深度分析报告

> 报告日期: 2026-08-30 04:00
> 分析项目: 5 个（覆盖 TRAE Work / WorkBuddy / Codex + 通用 Electron SDK + Agent Skill）
> 重点适配目标: traework, qoderwork, workbuddy, doubao, codex, zcode

---

## 一、分析项目概览

| # | 项目 | Stars | 语言 | 创建 | 最后 push | 活跃度 | 与我们关系 |
|---|------|-------|------|------|-----------|--------|-----------|
| 1 | [xxxhh336/dream-work-theme](https://github.com/xxxhh336/dream-work-theme) | 9 | TypeScript | 2026-08-05 | **2026-08-26** | ⚠️ 极高（4 天前） | 覆盖 QoderWork / TRAE Work / WorkBuddy / ZCode / CatPaw + 15 其他 |
| 2 | [cdredfox/workbuddy-skin-studio](https://github.com/cdredfox/workbuddy-skin-studio) | 170 | JavaScript | 2026-07-16 | 2026-07-17 | 停滞（1 天爆发） | WorkBuddy 专用，780 行 SKILL.md 给 AI 自动安装 |
| 3 | [Finderchangchang/codex-autoskin](https://github.com/Finderchangchang/codex-autoskin) | 117 | JavaScript | 2026-07-16 | 2026-07-23 | 停滞（1 周爆发） | **Agent-native** 设计，Codex 自己读 SKILL 给自己换肤 |
| 4 | [ArthurLobopro/electron-css-injector](https://github.com/ArthurLobopro/electron-css-injector) | 2 | TypeScript | 2023-02-19 | 2024-03-07 | 死亡 | Electron `protocol` API CSS 注入 SDK（内嵌式，非 CDP） |
| 5 | [comeonzhj/WorkBuddy-theme-skill](https://github.com/comeonzhj/WorkBuddy-theme-skill) | 18 | CSS | 2026-07-18 | 2026-07-18 | 停滞（1 天爆发） | 完整 Electron 主题管理器 + ZIP 安全校验 + 社区同步 |

---

## 二、各项目技术亮点深度剖析

### 2.1 xxxhh336/dream-work-theme — 最值得关注的竞品

**项目定位**: 面向所有 "Electron Work 类应用" 的主题管理器，不是单一应用换肤工具，而是"换肤母舰"。直接覆盖我方的 **QoderWork、TRAE Work、WorkBuddy、ZCode** 四个目标应用。

**核心架构亮点**:

1. **`AppDefinition` 注册表模式** (`electron/manager/app-registry.ts`)
   - 每个应用声明完整元数据: `id / name / exeNames / installPaths / processName / defaultPort / rendererHints / kind / devToolsActivePort / windowsPathScopedKill / webView2 / acceptsGenericThemes`
   - 包含 macOS `darwin.appBundles` + Linux `linux.desktopFiles` 完整多平台支持
   - 关键设计: `acceptsGenericThemes: boolean` — 决定是否接受通用主题

2. **端口发现三策略**:
   - 固定端口 (WorkBuddy=9339, Codex=9340, TRAE=9341, ZCode=9344, Doubao=9349)
   - `DevToolsActivePort` 文件读取 (QoderWork / 千问办公 / OpenCode / StepFun 等 Electron 应用)
   - Windows 幽灵端口检测 + 自动顺延到下一个可用端口

3. **`apps[appId].compat` 主题兼容性覆盖**:
   ```json
   "apps": {
     "some-app": { "compat": false },
     "another-app": { "compat": true, "layout": "compact" }
   }
   ```
   在 manifest 声明中对特定应用启用/禁用/使用紧凑布局。

4. **频率排序右下角菜单**: 按应用分别统计主题使用次数，排序后显示 Top 4 快捷入口。使用记录保存在 `theme-usage.json`。

5. **多 WebContents 应用适配**: Kimi Work 的 Work+Chat 双 renderer、SparkDesk 的多 Tab+Desk+Settings、StepFun 的 browser+chat+subscription — 全部使用 watcher 维护。

**重大信号**: 2026-08-21-26 四天密集提交，刚合并了 `feat: support MonkeyCode themes` 和 `feat: support AutoClaw topics`，正处于快速扩张期。

### 2.2 Finderchangchang/codex-autoskin — Agent-native 换肤范式

**项目定位**: "发一张图给 Codex，它自己给自己换肤"。整个项目是 **被 Codex 消费** 的，不是给人用的 GUI 工具。

**核心创新 — THEME-SPEC.md**:

1. **28-token spec 写给 AI agent 读的**: 每个 token 都标注"控制什么 / 怎么从图取"。例如:
   - `--dream-ink`: 正文色，备注"图片最深主色调压到近黑但保留色相 L≈20-30"
   - `--dream-page-bg-0/1`: 页面渐变浅/深端，备注"白里染 2%-10% 主色调"
   - `--dream-hero-overlay` / `--dream-fullscreen-overlay` 各有明暗两套模板

2. **四角色 hero crop 系统**: `banner / fullscreen / polaroid / chat` 四个角色分别有独立的 `art-size` / `art-position` / `overlay` / `wash` token。

3. **meta 字段 (brand/edition/signature)**: 主题自带品牌文案，注入后在首页展示主题名 + 版本名 + 签名。

4. **Sticker 装饰系统**: bubble(对话气泡) / board(推广牌) / corner(角饰) — 全部 `pointer-events: none`。

5. **主题校验 Iron Rule**: `extra.css` 每条选择器必须以 `html.dream-theme-<name>` 锚定，否则整体拒载。

6. **光照决策树**:
   ```
   源图 → A.干净艺术图 → A1.暗色→白标题+深色overlay / A2.亮色→深色标题+近白overlay
          B.带界面文字 → B1.有干净区→放大裁剪 / B2.无干净区→高斯模糊柔焦
   ```

### 2.3 cdredfox/workbuddy-skin-studio — WorkBuddy 专用极致简洁

**项目定位**: 170 stars 的 WorkBuddy 一键换肤。macOS 双击 `.command`，Windows 双击 `.ps1`。

**技术亮点**:

1. **SKILL.md 给 AI 自动安装**: 把 GitHub 地址发给任意 AI + "帮我换 WorkBuddy 主题" → AI 自动克隆→运行 apply→选主题→验证。无需人类干预。

2. **WorkBuddy `--cb-*` 变量系统**: 覆盖 60+ 个 `--cb-*` 设计 token（`--cb-bg-primary` / `--cb-text-primary` / `--cb-vscode-editor-background` 等）实现全局换色。

3. **`[data-view-id]` DOM 锚点**: 稳定选择器定位关键 UI 区域，不依赖易变的 class 名。

4. **`doctor` 命令**: 一键检查 app 路径、CDP 端口、平台兼容性。

5. **根据 `surface` 明度 (>140) 自动切换 `data-vscode-theme-kind`**: 深浅色自动适配 VS Code 原生控件。

### 2.4 comeonzhj/WorkBuddy-theme-skill — 完整主题管理 + 社区协议

**项目定位**: ZIP 安全导入 + 社区同步 + Electron UI 管理器的完整方案。

**技术亮点**:

1. **ZIP 安全校验**: 拒绝可执行文件 / 远程样式 / 路径穿越 / 超限内容。SHA-256 逐文件校验。

2. **单实例守护进程互斥**: Electron 管理器启动时自动接管 CLI 旧守护进程，避免多守护进程同时注入导致主题闪烁。

3. **`Permission Gate` 设计模式**: 需要重启 WorkBuddy 时先征得明确解释，然后执行 `--launch`。

4. **CSS 作用域限定**: 所有规则写在 `body[data-workbuddy-theme="<theme-id>"]` 下，还原时移除整个 `<style>` + body class。

5. **`--vscode-*` 变量优先**: 利用 WorkBuddy 5.2.6 暴露的 VS Code 兼容主题 token surface。

### 2.5 ArthurLobopro/electron-css-injector — Electron 内嵌 SDK (仅学习)

**项目定位**: 通过 Electron `protocol` API 拦截自定义协议 + `DOMContentLoaded` 注入 CSS。

**注意**: 此方案需要修改应用本身的 preload 脚本，属于**内嵌式 SDK**，与我们的 CDP 外部注入路线根本不同。**不可移植**（我们绝不修改目标安装文件，AgnesCode 那类极端案例除外）。

**唯一可学习点**: `protocol.registerSchemesAsPrivileged` + `session.protocol.registerFileProtocol` 的拦截模式 — 作为知识储备了解即可。

---

## 三、六大目标应用映射分析

| 我方应用 | dream-work-theme | codex-autoskin | workbuddy-skin-studio | WorkBuddy-theme-skill | 可借鉴 |
|---------|-----------------|----------------|----------------------|----------------------|--------|
| **TRAE Work** | ✅ (solo/solo-lite.html) | — | — | — | 端口 9341, vscode-work kind |
| **QoderWork** | ✅ (DevToolsActivePort) | — | — | — | 动态端口发现策略 |
| **WorkBuddy** | ✅ (app.asar/renderer/index.html) | — | ✅ 主力 | ✅ 主力 | **--cb-* 变量系统** / `[data-view-id]` / doctor |
| **豆包** | ✅ (doubao:// 定制 Chromium) | — | — | — | 9349 端口, dbx token 映射 |
| **Codex** | ✅ (ChatGPT.exe) | ✅ 主力 | — | — | 28-token spec / meta 字段 / sticker 系统 |
| **ZCode** | ✅ (9344 端口) | — | — | — | out/renderer/ 结构适配 |

---

## 四、可移植特性评估与实施优先级

### P0 — 立即可实施（低风险、高价值）

**P0-1: WorkBuddy `--cb-*` Token 系统**
- 来源: cdredfox/workbuddy-skin-studio
- 价值: WorkBuddy 有 60+ 个 `--cb-*` 变量，当前我们的 workbuddy adapter 只用了少量几个。完整映射可实现与 workbuddy-skin-studio 同等精度的换色。
- 实施: 扩展 `src/adapters/domestic/workbuddy.ts` 中的 token 映射表
- 工作量: 2-3 小时 + 测试

**P0-2: ZIP 安全校验增强**
- 来源: comeonzhj/WorkBuddy-theme-skill
- 价值: 当前 `scripts/import-theme.ts` 缺乏对可执行文件、远程 URL、路径穿越的严格检查
- 实施: 强化 `src/main/theme/zip-security-validator.ts`
- 工作量: 3-4 小时 + 测试

### P1 — 本周可实施（中等改动、显著提升）

**P1-1: 频率排序主题菜单**
- 来源: dream-work-theme
- 价值: 按应用统计主题使用频率，在 ThemeCard 网格中显示"最近使用"或"常用主题"排序，提升用户切换效率。
- 实施: 在 themeStore 中增加 usage stats + 修改 ThemeCard 排序逻辑
- 工作量: 1 天 + 测试

**P1-2: manifest `apps[appId].compat` 兼容覆盖**
- 来源: dream-work-theme
- 价值: 允许特定主题声明不兼容某个应用（例如某套二次元主题不适合 ZCode），或在特定应用使用 `compact` 布局。
- 实施: 扩展 `theme-manifest.ts` schema + adapter 适配判断逻辑
- 工作量: 半天 + 测试

**P1-3: `doctor` / 诊断命令**
- 来源: cdredfox/workbuddy-skin-studio
- 价值: 一键诊断应用路径、CDP 端口、平台兼容性。对 AgentSkin 的 diagnostics store 是直接增强。
- 实施: 扩展 `scripts/doctor.mjs` 或 `src/main/diagnostics/`
- 工作量: 半天 + 测试

### P2 — 规划评估（较大改动、长期价值）

**P2-1: THEME-SPEC.md Agent 友好规范**
- 来源: Finderchangchang/codex-autoskin
- 价值: 把 AgentSkin 的 14-token 系统写成机器可读的版本（含取色指引），让外部 Agent 能为 AgentSkin 自动生成主题。
- 工作量: 文档 0.5 天 + 校验脚本 1 天

**P2-2: meta 字段 (brand/edition/signature)**
- 来源: codex-autoskin
- 价值: 主题自带品牌信息渲染，对标 DreamSkin 商业化水平
- 工作量: schema 扩展 + 渲染逻辑 1-2 天

**P2-3: 四角色 hero crop**
- 来源: codex-autoskin
- 价值: 同主题在不同位置使用不同裁切（横幅 Banner / 全屏 / 拍立得小卡 / 聊天淡背景）
- 工作量: 图片处理 + CSS 生成较大改动

---

## 五、架构对比快照

| 维度 | AgentSkin | dream-work-theme | codex-autoskin | workbuddy-skin-studio |
|------|-----------|-----------------|----------------|----------------------|
| 适配应用数 | 6（固定） | 20+（可扩展注册表） | 1 | 1 |
| 注入方式 | CDP + Hybrid + DeepCore 四层编排 | CDP + 浮动菜单 | CDP + decorator | CDP |
| 主题格式 | 14-token agentskin-theme | 4-color JSON+hero | 28-token JSON+art+extra.css | 4-color JSON+hero |
| 端口策略 | 固定端口 | 固定+DevToolsActivePort+幽灵回退 | 单一固定端口 | 9223 固定 |
| 状态管理 | Zustand 12 Store | React state + JSON 文件 | 无状态（脚本） | 无状态（脚本） |
| Agent 集成 | Studio Skill | — | SKILL.md 自动安装 | SKILL.md 自动安装 |
| 并发控制 | InjectionLock + Queue | — | breaker + debounce | — |
| 健康检测 | Health Monitor + State Machine | — | — | — |

**结论**: AgentSkin 在注入架构（四层编排 + 状态机 + 健康监控 + 并发锁）上仍全面领先。主要差距在 **主题格式丰富度**（28-token vs 我们 14-token）和 **Agent 原生体验**（SKILL.md 范式）。

---

## 六、风险与机会

### ⚠️ 风险

1. **dream-work-theme 快速扩张**: 9 stars 但 4 天前还在合并新应用适配，且 tags 包含 `catpaw`, `qoderwork`, `traework`, `workbuddy`, `zcode` — 直接覆盖我方 4/6 目标。正处于爆发前夜。

2. **codex-autoskin 的 SKILL 范式扩散**: "把 repo 链接+图片发给 Codex 就自动换肤" 的体验可能很快成为社区标准，降低用户对独立桌面应用的需求。

### ✅ 机会

1. **AgentSkin 四层注入架构仍是护城河**: dream-work-theme 还在用单一 CDP + watcher 模式，没有 Shadow DOM 支持、没有状态机、没有健康监控。

2. **SKILL.md 范式可吸收**: 如果我们也有 SKILL.md，AgentSkin 也可以被任意 AI Agent"一句话安装+换肤"。

3. **工作群互斥机制**: comeonzhj 的"单实例守护进程互斥"设计可借鉴到我们的 injection lock。

---

## 七、实施计划（本次执行）

基于以上分析，本轮实施 P0 + P1 优先级项：

1. **P0-1**: WorkBuddy `--cb-*` 完整 token 系统移植 → 扩展 workbuddy adapter
2. **P0-2**: ZIP 安全校验增强 → 强化 zip-security-validator
3. **P1-3**: doctor 诊断脚本 → 一键诊断工具
4. **P1-2**: manifest apps compat 覆盖 → 扩展 manifest schema

P1-1 与 P2 系列留至后续。

---

## 八、下一步建议

1. **P1-1**: 实施频率排序主题菜单
2. **P2-1**: 编写 THEME-SPEC.md 的 agent 友好规范（但保持 14-token 契约不变）
3. **持续追踪**: dream-work-theme — 4 天 5 commit 的爆发期是否持续
4. **研究**: codex-autoskin 的 `sticker` 系统是否适合 AgentSkin 的 `decoration` 层
5. **探索**: electron-css-injector 的 `protocol` API 是否可用于某些"自注入"场景（如未来的 AgentSkin Studio）
