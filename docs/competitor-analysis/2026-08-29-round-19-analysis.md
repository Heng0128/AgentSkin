# 第 19 轮竞品深度分析报告 — 额度可视化 / 调色板工具链 / 安全 ZIP 协议

> 执行时间：2026-08-29 13:00
> 分析项目：5 个（聚焦额度追踪 UX、调色板转换工具链、安全 ZIP 导入协议、CDP REPL 源头、Windows 安装器）

---

## 一、本轮分析项目概览

| 项目 | Stars | 平台 | 语言 | 最后更新 | 活跃度 | 与 AgentSkin 关系 |
|------|-------|------|------|---------|--------|-------------------|
| aqua5230/usage | 302 | macOS/Windows | Python | 2026-08-28 | 🔥 极高（日更 5+ commits） | ★★★★☆ 额度 UX + 主题系统参考 |
| comeonzhj/WorkBuddy-theme-skill | 18 | macOS/Windows | CSS/Node.js | 2026-08-09 | ⚠️ 停滞 | ★★★★★ WorkBuddy 安全 ZIP + 注册表协议 |
| lafllamme/codex-themes | 6 | 跨平台 | TypeScript | 2026-07-19 | ⚠️ 停滞 | ★★★★☆ 调色板→主题转换工具链 |
| tluyben/electron-inject | 0 | 跨平台 | JavaScript | 2025-03-15 | ❌ 停更 1.5 年 | ★★☆☆☆ CDP 注入源头参考 |
| zh1665/cobalt-for-codex | 1 | Windows | PowerShell | 2026-05-29 | ❌ 停滞 | ★☆☆☆☆ Windows 安装器反面教材 |

---

## 二、各项目核心发现

### 2.1 aqua5230/usage — 额度可视化标杆（302⭐）

**技术定位**：macOS 菜单栏 + Windows 系统托盘的 AI 编码额度追踪工具，Python 3.13 开发，AGPL-3.0 许可证。

**架构**：
- 数据源：本地日志文件被动读取（Claude Code JSONL、Codex 历史），零 LLM API 调用
- Antigravity 例外：通过 OAuth 凭证调用 Google 官方配额端点（元数据调用，不消耗模型配额）
- 14 个可视化主题（Classic / Matrix / Windows 95 / Newspaper / Cloud Observation / Midnight Aquarium / Prism Arcade / Black Hole / World Cup 2026 / Lepidoptera / Migration / Stained Glass / Origami / Catppuccin）
- 5 语言自动本地化（中繁/中简/英/日/韩）

**高价值借鉴**：

1. **"Token Saver"模式**：菜单栏开关让 Claude Code 和 Codex 回答更简洁，A/B 测试显示后期回复保持约 40% 更短而非漂移 84% 更长。这种"输出 token 预算"概念可移植到 AgentSkin 的设置页面。

2. **"Progress Concierge"**：打开新会话时自动将上次进度（最后请求、未提交更改、未完成 todos）交给 AI，无需 `/resume`。这验证了"会话连续性"需求。

3. **"Token-waste Health Check"**：每日后台诊断扫描日志中的浪费模式（重复文件读取、污染目录、嘈杂 Bash 输出），发现问题后一行提示，说"show me"即由 AI 引导修复。

4. **"AI Council"**：多轮讨论窗口，在 Claude Code / Codex / Antigravity 之间运行辩论，带 token 预估、共识统计、早期停止。

5. **"Spirit Companions"**：小动画白色剪影（Claude=凤凰、Codex=龙、Antigravity=狮子），随各自工具 token 燃烧率动态加速。这与 codress 的桌面宠物理念一致但更轻量。

**与 AgentSkin 差距**：
- usage 是额度监控工具，AgentSkin 是视觉定制引擎——功能正交
- usage 的 14 主题是其 UI 皮肤，与 AgentSkin 的 14-token 主题契约无关
- usage 的"Token Saver"概念可借鉴为 AgentSkin 的"输出预算"设置项

### 2.2 comeonzhj/WorkBuddy-theme-skill — 安全 ZIP 协议标杆（18⭐）

**技术定位**：给 WorkBuddy 一键换皮肤的跨平台桌面应用 + Agent Skill 开放协议。

**架构**：
- 调试端口只绑定 `127.0.0.1`，不监听局域网
- 不修改或解包 WorkBuddy 安装文件
- Electron 管理器启用上下文隔离、沙箱、严格 CSP 和最小 IPC API
- ZIP 导入拒绝可执行文件、远程样式、路径穿越和超限内容
- GitHub 同步固定到 HTTPS raw-content 源并逐文件校验 SHA-256
- 主题资源必须在主题目录内，禁止远程脚本和可执行 URL
- macOS 正式发行包使用 Developer ID Application 签名、Hardened Runtime 和 Apple 公证

**高价值借鉴**：

1. **ZIP 导入安全校验清单**：
   - 文件类型白名单（只允许 CSS/PNG/JPG/WebP/JSON）
   - 体积限制（单文件/总体积上限）
   - 路径遍历防护（拒绝 `../` 和绝对路径）
   - Manifest schema 校验
   - CSS 作用域校验（只允许注入到指定 DOM 区域）
   - 本地素材完整性检查

2. **注册表同步协议**：
   - `registry.json` 单一事实源
   - 只下载有更新的版本（增量同步）
   - 逐文件 SHA-256 校验
   - 原子化安装（先解压到临时目录，验证后移动到目标位置）

3. **"单实例守护进程"模式**：
   - 应用以单实例运行
   - 自动接管旧版命令行换肤工具留下的主题守护进程
   - 避免多个守护进程同时注入 CSS 导致主题闪烁

4. **Agent Skill 全流程**：
   - SKILL.md 包含设计契约、主题校验、打包、应用、状态检查、恢复和社区投稿
   - Agent 读完后能独立完成"参考图片 → 创建主题 → 验证 → 应用"全流程

**与 AgentSkin 差距**：
- AgentSkin 已有成熟的四引擎注入架构，不需要其守护进程模式
- AgentSkin 的 14-token 契约比其 theme.json 更丰富
- AgentSkin 缺少安全 ZIP 导入校验清单（当前直接解压无校验）
- AgentSkin 缺少注册表同步协议（当前主题安装是单次操作）

### 2.3 lafllamme/codex-themes — 调色板转换工具链（6⭐）

**技术定位**：独立 TypeScript 工具包，将原始主题调色板（.itermcolors 等）转换为 Codex 兼容的 JSON 预设。

**架构**：
- 基于 mbadolato/iTerm2-Color-Schemes（450+ 终端调色板）
- 四个命令：`convert` / `rescore` / `test` / `generate`
- 输出 Codex 兼容的 JSON 预设格式

**高价值借鉴**：

1. **"调色板→主题"转换管线**：
   - 输入：.itermcolors（XML plist）、JSON 调色板、YAML 主题
   - 解析：提取 16 色终端调色板（8 标准 + 8 亮色）+ 前景/背景色
   - 映射：终端色 → UI 语义色（foreground / background / accent / selection）
   - 输出：结构化 JSON 主题文件

2. **"rescore"命令**：归一化 codeThemeId 值，确保 ID 唯一性和一致性

3. **批量转换 + 烟雾测试**：
   - `pnpm test` 运行解析器烟雾测试
   - `pnpm generate` 运行完整管线（convert + rescore + test）

**与 AgentSkin 差距**：
- AgentSkin 的 image-theme-analyzer.ts 做像素 → 14 token 映射（更底层）
- lafllamme/codex-themes 做调色板 → JSON 预设（更上层）
- 两者互补：AgentSkin 可从图片提取调色板，lafllamme 可将调色板转为结构化主题

### 2.4 tluyben/electron-inject — CDP 注入源头（0⭐，停更）

**技术定位**：通过 CDP 向任意正在运行的 Electron 应用注入 JavaScript 的交互式 REPL。

**架构**：
- 连接 `--remote-debugging-port=9222` 启动的 Electron 应用
- 交互式 REPL + 命令历史
- REST API（POST /execute）
- 脚本文件执行

**历史价值**：
- 这是理解"CDP 注入"机制的经典范本
- 展示了最基础的 CDP 注入模式：连接 → Runtime.evaluate → 执行任意 JS
- 其局限性（CSP 阻止、contextIsolation）正是 AgentSkin 四引擎架构要解决的问题

**与 AgentSkin 对比**：
- electron-inject 是单文件直接注入（最原始模式）
- AgentSkin 是四引擎 + orchestrator（生产级模式）
- electron-inject 的 REST API 模式可参考用于 AgentSkin 的调试接口

### 2.5 zh1665/cobalt-for-codex — Windows 安装器反面教材（1⭐，停滞）

**技术定位**：Windows 版 Codex Desktop 的 Cobalt 主题安装器，PowerShell 编写。

**架构**：
- PowerShell 脚本直接操作 Windows 注册表
- 修改 Codex Desktop 主题配置

**反面模式警示**：
1. **单平台锁定**：仅 Windows，无 macOS 支持
2. **无安全校验**：直接修改注册表，无备份/回滚机制
3. **无更新机制**：停滞 3 个月，无社区维护
4. **无测试覆盖**：零测试，生产环境风险极高

**教训**：Windows 平台适配需要更健壮的方案（如 AgentSkin 的 Electron 主进程 + IPC 模式），而非 PowerShell 直接操作注册表。

---

## 三、跨项目共性发现

### 3.1 "安全 ZIP 导入"正在成为社区主题工具的标准配置

comeonzhj/WorkBuddy-theme-skill 的 ZIP 导入安全校验清单（文件类型/体积/路径遍历/CSS 作用域/本地素材完整性）代表了社区主题工具正在从"能导入"向"安全导入"演进。AgentSkin 当前的主题导入流程缺少这些校验。

### 3.2 "调色板→主题"转换是连接终端生态与桌面主题的桥梁

lafllamme/codex-themes 展示了如何将终端社区的 450+ 调色板资产转化为桌面主题。AgentSkin 的 image-theme-analyzer.ts 从图片像素出发，而 lafllamme 从终端调色板出发——两者可以形成互补：终端调色板 → 14 token → AgentSkin 主题。

### 3.3 "额度可视化"验证了用户对"状态可见性"的强需求

aqua5230/usage 的 302 stars 和日更活跃度证明：用户强烈需要"随时看到 AI 工具状态"。AgentSkin 的 InjectDock 和状态面板可以参考其设计模式（颜色编码、进度条、可拖动卡片、主题切换）。

### 3.4 "CDP 注入"的源头设计依然有其教学价值

tluyben/electron-inject 虽然停更 1.5 年，但其 60 行核心代码展示了 CDP 注入的最简模式。AgentSkin 的四引擎架构是在解决其局限性（CSP、contextIsolation、路由切换丢失）的基础上演进的。

---

## 四、实施建议优先级排序

| 优先级 | 建议 | 来源项目 | 目标模块 | 工作量 |
|--------|------|---------|---------|--------|
| P1 | 安全 ZIP 导入校验模块 | comeonzhj/WorkBuddy-theme-skill | src/main/theme/import/ | 中 |
| P2 | 调色板→14 token 转换工具链 | lafllamme/codex-themes | src/shared/theme/palette-import/ | 中 |
| P3 | 主题注册表同步协议 | comeonzhj/WorkBuddy-theme-skill | src/main/theme/registry/ | 中 |
| P4 | 状态面板主题切换增强 | aqua5230/usage | src/ui/components/StatusBar/ | 小 |
| P5 | CDP 调试 REST API | tluyben/electron-inject | src/main/cdp/debug-api/ | 小 |

---

## 五、下一步行动

1. **P1 实施**：新增 `src/main/theme/import/zip-security-validator.ts`，包含文件类型白名单、体积限制、路径遍历防护、Manifest schema 校验、CSS 作用域校验
2. **P2 实施**：新增 `src/shared/theme/palette-import/palette-converter.ts`，支持 .itermcolors / JSON 调色板 / YAML 主题 → 14 token 转换
3. **P3 实施**：新增 `src/main/theme/registry/theme-registry.ts`，实现 registry.json 解析 + 增量同步 + SHA-256 校验 + 原子化安装
4. **P4 实施**：在 AgentSkin 状态面板增加主题切换下拉菜单（14 个预设主题）
5. **P5 实施**：新增 CDP 调试 REST API（仅开发模式启用），参考 electron-inject 的 POST /execute 模式

---

## 六、累计覆盖统计

- 前 18 轮累计分析：~140 个项目
- 本轮新增：5 个项目
- 累计分析：~145 个项目
- 剩余未分析：~52 个（主要为 DSH 皮肤插件、Codex 主题合集、WorkBuddy 衍生 Fork）
