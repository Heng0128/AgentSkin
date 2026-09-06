# 竞品项目深度分析报告 — 第 6 轮

> 执行时间: 2026-08-28 12:00
> 分析范围: 统一主题包格式 + 跨平台母舰工具 + CDP 治理 + 皮肤管理器
> 深度分析 5 个高价值项目

---

## 一、本轮分析目标

本轮聚焦**前几轮未覆盖**的高价值项目，重点关注：
- 统一主题包格式标准（.codedrobe-theme）
- 跨平台母舰级主题切换器（支持 TRAE Work、WorkBuddy、QoderWork、ZCode、豆包）
- CDP 生产级治理（端口租约、看门狗、状态机）
- macOS 皮肤管理器（三端管理 + 安全更新）

## 二、项目总览

| # | 项目 | Stars | License | 语言 | 最近更新 | 核心亮点 |
|---|------|-------|---------|------|---------|---------|
| 1 | CodeDrobe/core | 9 | Apache-2.0 | JavaScript | 2026-07-21 | 统一运行时 + CLI + 适配器 + 验证体系 |
| 2 | CodeDrobe/desktop | 51 | MPL-2.0 | TypeScript | 2026-08-26 | 可视化换肤管理器 + 主题商店 + Deep Link |
| 3 | xxxhh336/dream-work-theme | 7 | Apache-2.0 | TypeScript | 2026-08-26 | 跨平台主题切换器 + 400 内置主题 + 右下角菜单 |
| 4 | AI-Scarlett/LingGlow | 0* | MIT** | JavaScript | 2026-07-29 | macOS 三端皮肤管理器 + 安全更新 + 皮肤 Skill |
| 5 | Lumos-789/zcode-cdp | 1 | MIT | JavaScript | 2026-08-15 | ZCode CDP 接管框架 + 生产级治理 |

> *LingGlow 于 2026-07-29 刚开源， stars 尚在积累中
> **LingGlow 源码 MIT，签名公证安装包通过 GitHub Releases 分发

---

## 三、深度分析摘要

### 3.1 CodeDrobe/core — 统一换肤运行时

**定位**: CodeDrobe 生态的底层引擎，提供 CLI + 适配器 + CDP 注入 + 验证的完整性闭环。

**核心架构**:
- 四仓库分离: core(运行时) / skills(指令层) / desktop(管理器) / store(商店)
- 适配器注册表: codex / workbuddy / qoderwork / traework（含 CN 和国际版）
- 统一包格式: `.codedrobe-theme`（manifest + CSS + 内嵌图片，零 JavaScript）
- 双阶段验证: probe(预检) + verify(确认)

**技术亮点**:

1. **DOM Snapshot 隐私边界** — 排除文本内容、表单值、可访问名称、query/hash 数据、链接和媒体源。仅保留元素结构、语义类、选择器候选、边界框、计算样式子集。*AgentSkin 已实现类似机制（dom-snapshot.ts）*。

2. **分层验证节点体系** — `required`（阻塞注入）/ `recommended`（仅警告）/ `contexts`（路由上下文条件检查）。注入前预检，注入后验证，失败自动回滚。*AgentSkin 已实现 landmark-preflight.ts*。

3. **选择器 Lint 静态分析** — `codedrobe theme pack` 和 `codedrobe theme inspect` 报告非阻塞选择器 lint 警告：位置选择器、深层子选择器、本地化文本属性、生成类、超长选择器。**此静态分析能力是 AgentSkin 当前缺失的**。

4. **自发布调试端口发现** — QoderWork 强制在 main 进程设置 `remote-debugging-port=0`，Core 自动从 `DevToolsActivePort` 文件读取真实端口。*AgentSkin 已有类似的 port-resolver.ts*。

5. **watchTheme AbortSignal 生命周期** — Electron主进程可使用 `AbortSignal` 管理主题监听生命周期，不依赖进程信号。

**与 AgentSkin 对比**:

| 维度 | CodeDrobe/core | AgentSkin |
|------|---------------|-----------|
| 主题契约 | 零token，CSS变量自由定义 | 14-token严格契约 |
| 适配器数量 | 4个（codex/workbuddy/qoderwork/traework） | 6个（含 doubao/zcode） |
| 静态选择器检查 | ✅ 有（theme pack/inspect） | ❌ 缺失 |
| 运行时注入 | adoptedStyleSheets（单层） | 四引擎分层（strategy/adapter/hybrid/deepcore） |
| 隐私快照 | ✅ 排除敏感内容 | ✅ 同样排除 |
| 验证节点分层 | required/recommended/contexts 三级 | required/warning 两级 |

**可借鉴点（按可行性排序）**:

1. ⭐⭐⭐ **选择器静态 Lint** — 在打包/导入主题时静态分析 CSS 选择器，预警潜在问题（无需 CDP 运行时）
2. ⭐⭐⭐ **路由上下文条件检查** — `contexts` 允许为特定路由声明额外验证节点
3. ⭐⭐ **watchTheme AbortSignal** — 简化 Electron 主进程生命周期管理
4. ⭐ **统一 .codedrobe-theme 包格式** — 可作为 AgentSkin 导入转换器支持的目标格式

---

### 3.2 CodeDrobe/desktop — 可视化换肤管理器

**定位**: CodeDrobe 生态的桌面端管理器，提供主题商店浏览、一键应用、一键恢复功能。

**核心架构**:
- v2 完整重建: Tailwind CSS + shadcn 风格组件
- 多应用支持: 同一主题包可针对不同应用分别应用
- CodeDrobe 账户: OAuth 2.0 PKCE 系统浏览器登录
- Deep Link: `codedrobe://themes/apply?theme=<slug>&app=<id>`

**技术亮点**:

1. **主题包 SHA-256 校验** — 下载后验证 marketplace SHA-256 记录，确保包完整性。*AgentSkin 当前缺失此安全校验*。

2. **Smart Apply 流程** — 已运行且有调试连接的应用实时热切换；未运行的应用启动时带上主题。仅在首次需要重启或修改 host appearance settings 时才请求重启。

3. **Per-app Debug Ports 配置** — 当默认端口被占用时，用户可为每个应用单独配置调试端口。*AgentSkin 的 port-lease-pool.ts 已提供自动端口管理*。

4. **原地更新** — macOS 通过内置 updater 交换 app bundle；Windows 静默安装更新。

5. **Deep Link 协议** — `codedrobe://` scheme 从网站直接唤起桌面端安装主题。

**与 AgentSkin 对比**:

| 维度 | CodeDrobe/desktop | AgentSkin |
|------|-----------------|-----------|
| UI 框架 | Tailwind + shadcn | Tailwind + 自定义组件 |
| 主题来源 | 在线商店 + Deep Link | 本地 + 社区 + Studio |
| 账户系统 | OAuth 2.0 PKCE | 无（本地优先） |
| 包完整性校验 | SHA-256 必检 | 未校验 |
| 热切换 | 实时 live swap | 支持（injector + feedback） |

**可借鉴点**:

1. ⭐⭐⭐ **主题包完整性校验** — 下载/导入时验证 SHA-256，防止包被篡改
2. ⭐⭐ **Deep Link 协议** — 从浏览器一键安装应用到 AgentSkin
3. ⭐ **Per-app 端口配置** — 作为 port-lease-pool 故障时的手动兜底

---

### 3.3 xxxhh336/dream-work-theme — 跨平台母舰主题切换器

**定位**: 面向 Electron Work 类应用的跨平台主题管理器，支持 **WorkBuddy、TRAE Work、QoderWork、ZCode、豆包** — 覆盖 AgentSkin 6 个目标应用中的 5 个。

**核心架构**:
- 400 内置主题（支持亮/暗模式）
- 右下角主题菜单（注入到目标应用）
- 跨平台: Windows / macOS / Linux
- 最近支持 AutoClaw themes、MonkeyCode themes（可扩展格式支持）

**技术亮点**:

1. **App Registry 应用注册表** — `electron/manager/app-registry.ts` 集中注册支持的应用。新应用只需添加到注册表。*此模式可作为 AgentSkin 参考*。

2. **右下角快速切换菜单** — 注入到目标应用的右下角主题菜单，用户无需离开应用即可切换主题。*UX 模式可参考*。

3. **跨平台 Linux 支持** — 除 Windows/macOS 外还支持 Linux。*AgentSkin 当前无 Linux 支持*。

4. **可扩展主题格式** — 最近添加了 AutoClaw themes 和 MonkeyCode themes 支持，显示其架构的可扩展性。

**与 AgentSkin 对比**:

| 维度 | dream-work-theme | AgentSkin |
|------|-----------------|-----------|
| 支持应用 | WorkBuddy/TRAE Work/QoderWork/ZCode/豆包 + 更多 | 6个固定适配器 |
| 主题数量 | 400+ 内置 | 15+ 主题包 |
| 注入深度 | 单层 CSS 变量覆盖 | 四引擎分层（含 DeepCore） |
| 平台支持 | Win/macOS/Linux | Win/macOS |
| 快速切换 | 右下角菜单 | 无 |

**可借鉴点**:

1. ⭐⭐ **右下角快速切换菜单** — 无需打开 AgentSkin 主窗口即可切换主题
2. ⭐⭐ **应用注册表集中管理** — 更清晰的应用发现与管理架构
3. ⭐ **Linux 平台检测** — 可作为未来扩展参考（但当前无需实现）

**重大更新标记**: dream-work-theme 最后更新于 **2026-08-26**，非常活跃，最近添加了 AutoClaw themes 和 MonkeyCode themes 支持。

---

### 3.4 AI-Scarlett/LingGlow — macOS 三端皮肤管理器

**定位**: macOS 专属 AI Agent 主题/皮肤/个性化管理工具，支持 Codex/GPT、WorkBuddy、豆包。

**核心架构**:
- 按需下载: DMG 不再携带全部大图，用户只下载需要的皮肤
- 安全目录: 只允许声明式 JSON 与静态 WebP，包/定义/图片均校验 SHA-256
- 安全更新: App 更新校验摘要、Bundle ID、Developer Team ID、Developer ID 签名与 Apple 公证
- 配套 Skill: `skills/skin-abstract` 提供统一的三端皮肤制作流程

**技术亮点**:

1. **Featured 推荐元数据** — 通过 `featured` 元数据持续上新主打皮肤，不要求升级 App。*AgentSkin 当前主题目录是静态打包的*。

2. **深浅模式语义配色** — 皮肤声明 light/dark，语义文字和控件颜色不直接套用背景图颜色，而是经由语义映射。*AgentSkin 的 14-token 契约已包含 light/dark 语义*。

3. **连续阅读遮罩** — 豆包根据每套皮肤的表面色、文字色和照片明暗度计算连续阅读遮罩，提升正文、侧栏与输入框在复杂背景上的可读性。*AgentSkin 已实现 readability-mask.ts*。

4. **合成层动画** — 动画改为合成层位移，限制运行时 DOM 扫描范围，减少布局计算和重复扫描。*GPU 加速动画最佳实践*。

5. **三端独立图标与适配** — Codex/GPT、WorkBuddy、豆包使用各自真实客户端图标与独立适配能力。*AgentSkin 每个适配器有独立的 adapter.mjs*。

**与 AgentSkin 对比**:

| 维度 | LingGlow | AgentSkin |
|------|---------|-----------|
| 平台 | macOS 13+ | Win/macOS |
| 应用支持 | Codex/WorkBuddy/Doubao | 6个适配器 |
| 皮肤分发 | 远程目录 + 按需下载 | 本地 + 社区 + Studio |
| 安全更新 | Developer ID + Apple 公证 | N/A |
| 推荐系统 | featured 元数据 | 无 |

**可借鉴点**:

1. ⭐⭐ **Featured 推荐元数据** — 通过 JSON 元数据动态更新推荐主题，无需应用升级
2. ⭐⭐ **合成层动画最佳实践** — 使用 `will-change: transform` 和 `translate3d` 减少重排
3. ⭐ **按需下载模式** — 主题资源与索引分离，减少初始包体积

**重大更新标记**: LingGlow 于 **2026-07-29** 刚开源（2.3.18 版本），此前为闭源商业产品。这代表一种新的开源趋势：商业皮肤工具在积累足够用户后选择开源。

---

### 3.5 Lumos-789/zcode-cdp — ZCode CDP 生产级治理

**定位**: 为 AI Coding Agent 设计的"已登录浏览器接管"框架，让 agent 用真人已登录的 Chrome 干活。

**核心架构**:
- 统一端口租约池（9223–9229 共 7 槽）
- 三层看门狗（软 CPU lag / 孤儿超时 / 硬 worker 线程 SIGKILL）
- 状态机懒启动: IDLE → ENSURING → ACTIVE → CLOSING → IDLE
- Profile rsync 继承登录态

**技术亮点**:

1. **三层看门狗** — 软看门狗（事件循环延迟检测）/ CPU 看门狗（主进程 CPU% busy-loop 检测）/ 硬看门狗（独立 worker 线程，60s 无心跳即 SIGKILL）。*AgentSkin 已有 watchdog.ts 前两层，但缺少独立的 worker 线程硬看门狗*。

2. **Standard Backtest 标准回测** — L0 静态 / L1 端口租约 / L2 状态机三层回归，改代码后 `npm test` 一键跑。*分层测试模式值得借鉴*。

3. **挂起语义替代缓冲** — 激活期间 backend 连接在中继挂起，Chrome 就绪后自然流动；零应用层缓冲代码。

4. **Per-port Profile 隔离** — 每个端口独立 profile + 不同卡通头像，多账号天然隔离。*AgentSkin 的 appsStore 管理多应用状态*。

5. **relay 架构 v0.2.0** — 2026-08-14 发布的重大重构，删除双 backend 切换，改用本地 TCP 中继 + 单常驻 backend。

**与 AgentSkin 对比**:

| 维度 | zcode-cdp | AgentSkin |
|------|----------|-----------|
| 端口租约 | mkdir 原子锁 + leaseId | 相同（port-lease-pool.ts） |
| 看门狗 | 三层（含 worker 线程） | 两层（软+orphan+kill） |
| 状态机 | IDLE→ENSURING→ACTIVE→CLOSING | 无显式状态机 |
| 回测体系 | L0/L1/L2 分层 | 无分层回测 |
| 标准回测 | 文档化回测流程 | 无 |

**可借鉴点**:

1. ⭐⭐⭐ **标准回测框架** — L0 静态 / L1 端口租约 / L2 状态机三层回归模式
2. ⭐⭐ **Worker 线程硬看门狗** — 独立于主线程的 SIGKILL 机制，免疫 busy-loop
3. ⭐ **挂起语义** — 用挂起替代缓冲，简化连接管理

**重大更新标记**: zcode-cdp 于 **2026-08-14** 发布 v0.2.0 重大架构重构（relay 架构），非常活跃。

---

## 四、AgentSkin 现有能力对标总结

基于本轮分析，AgentSkin **已经实现**以下竞品能力：

| 能力 | 竞品来源 | AgentSkin 现状 | 文件位置 |
|------|---------|---------------|---------|
| 三层层看门狗 | zcode-cdp | ✅ 已实现（软+orphan+kill） | `src/main/cdp/watchdog.ts` |
| 端口租约池（mkdir 原子锁） | zcode-cdp | ✅ 已实现 | `src/main/cdp/port-lease-pool.ts` |
| Selector Validator | CodeDrobe/core | ✅ 已实现（CDP 探测） | `src/main/cdp/selector-validator.ts` |
| Landmark Preflight | CodeDrobe/core | ✅ 已实现（required/warning） | `src/main/cdp/landmark-preflight.ts` |
| DOM 隐私快照 | CodeDrobe/core | ✅ 已实现（排除敏感内容） | `src/main/dom-snapshot.ts` |
| 阅读遮罩算法 | LingGlow | ✅ 已实现（WCAG 对比度） | `src/main/css/readability-mask.ts` |
| 应用发现扫描 | dream-work-theme | ✅ 已实现 | `src/main/services/electron-scanner.ts` |
| 主题包解析器 | CodeDrobe | ✅ 已实现 | `src/shared/import/theme-source-parser.ts` |
| 原子写入 | heige-codex-skin-studio | ✅ 已实现 | `src/main/fs-utils.ts` |

**AgentSkin 当前缺失**的关键能力（按优先级排序）：

| # | 能力 | 来源 | 价值 | 复杂度 |
|---|------|------|------|--------|
| 1 | **选择器静态 Lint** | CodeDrobe/core | 打包/导入时静态预警 | 中 |
| 2 | **标准回测框架** | zcode-cdp | 分层回归测试 | 中 |
| 3 | **主题包 SHA-256 校验** | CodeDrobe/desktop | 下载完整性保证 | 低 |
| 4 | **Featured 推荐元数据** | LingGlow | 动态主题推荐 | 低 |
| 5 | **Worker 线程硬看门狗** | zcode-cdp | 免疫 busy-loop | 高 |

---

## 五、落地方案（按优先级执行）

### 方案 A: 选择器静态 Lint（优先级 ⭐⭐⭐）

**目标**: 在主题包打包/导入阶段静态分析 CSS 选择器，预警潜在问题，无需 CDP 运行时。

**来源**: CodeDrobe/core 的 `codedrobe theme pack` / `codedrobe theme inspect` 命令。

**实现范围**:
- 新增 `scripts/theme-selector-lint.mjs` 脚本
- 检测以下问题类型：
  - 位置选择器（:nth-child / :nth-of-type 不稳定）
  - 深层直接子链（> 超过 3 层）
  - 生成类（CSS module hash 模式）
  - 超长选择器（> 120 字符）
  - 无效选择器语法
- 输出结构化 JSON 报告
- 集成到 `npm run check` 校验流程

**测试**: 20+ 测试用例覆盖各类选择器模式

---

### 方案 B: 标准回测框架（优先级 ⭐⭐⭐）

**目标**: 建立 L0 静态 / L1 端口租约 / L2 CDP 状态机的分层回归测试模式。

**来源**: zcode-cdp 的 `docs/backtest.md` 三层回测体系。

**实现范围**:
- 新增 `tests/backtest/` 目录
- L0 静态测试: 类型检查 + 选择器语法（无 CDP 副作用）
- L1 端口租约: 原子锁 + leaseId ownership（mock fs）
- L2 状态机: 客户端-服务端交互模拟（mock WebSocket）

**测试**: 现有 watchdog / port-lease-pool / session-pool 测试按层级重组

---

### 方案 C: 主题包完整性校验（优先级 ⭐⭐）

**目标**: 下载/导入主题包时验证 SHA-256 哈希，防止包被篡改。

**来源**: CodeDrobe/desktop 的 marketplace SHA-256 校验。

**实现范围**:
- 为主题包生成 manifest 时记录 SHA-256
- 导入时重新计算并比对哈希
- 集成到 `theme-source-parser.ts`

**测试**: 10+ 测试用例

---

### 方案 D: Featured 推荐元数据（优先级 ⭐⭐）

**目标**: 通过 JSON 元数据动态更新推荐主题列表，无需应用升级。

**来源**: LingGlow 的 `catalog/v1/index.json` featured 元数据。

**实现范围**:
- 为现有主题 manifest 添加 `featured` 字段
- Studio 页面展示推荐主题逻辑
- 可通过本地 JSON 配置推荐列表

**测试**: 单元测试验证 featured 筛选逻辑

---

## 六、执行计划

按优先级分两批执行：

**第一批（并行执行）**:
- 方案 A: 选择器静态 Lint
- 方案 B: 标准回测框架

**第二批（串行执行，依赖第一批完成）**:
- 方案 C: 主题包完整性校验
- 方案 D: Featured 推荐元数据

---

## 七、风险提示

1. **方案 A 选择器 Lint**: 静态分析可能产生误报（如主题使用了 CSS-in-JS 生成的类名）。可通过白名单机制缓解。
2. **方案 B 回测框架**: 现有测试需要按层级重组，可能暂时增加 CI 时间。可通过 vitest projects 配置隔离。
3. **方案 C SHA-256**: 需要确保 manifest 哈希计算与打包流程一致，否则会导致合法包被拒绝。

---

## 八、下一步建议

1. ✅ 执行方案 A + B（本轮）
2. 下一轮分析关注: DSH 插件生态深度分析、更多 CDP 注入框架
3. 长期跟踪: dream-work-theme（最活跃）、zcode-cdp（架构重构中）

---

**附录: 竞品项目完整列表参考**

详见 `docs/competitor-analysis/AI_SKIN_ECOSYSTEM_LANDSCAPE.md`
