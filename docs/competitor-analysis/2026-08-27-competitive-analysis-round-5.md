# 竞品深度分析报告 — 第 5 轮（2026-08-27）

> 分析日期：2026-08-27 09:00
> 分析项目：5 个（CodeDrobe/desktop, CodeDrobe/skills, Lumos-789/zcode-cdp, AI-Scarlett/LingGlow, MagMueller/aios）
> 目标应用：traework, qoderwork, workbuddy, doubao, codex, zcode

---

## 一、项目概览

| 项目 | Stars | License | 语言 | 最近更新 | 与我们关系 |
|------|-------|---------|------|----------|------------|
| CodeDrobe/desktop | 51 | MPL-2.0 | TypeScript | 2026-08-26 | 直接竞品（主题管理器） |
| CodeDrobe/skills | 244 | Apache-2.0 | CSS | 2026-08-22 | 参考（Agent Skills 工作流） |
| Lumos-789/zcode-cdp | 1 | MIT | JavaScript | 2026-08-15 | 高价值参考（ZCode CDP） |
| AI-Scarlett/LingGlow | 0 | 无 | JavaScript | 2026-07-29 | 直接竞品（三端换肤） |
| MagMueller/aios | 0 | 无 | JavaScript | 2026-04-11 | 参考（通用注入框架） |

---

## 二、深度分析

### 2.1 CodeDrobe/desktop — 可视化主题管理器

**基本信息**
- 定位：OpenAI Codex / WorkBuddy / QoderWork / TRAE SOLO 可视化换肤管理器
- 版本：v2.1.1（2026-07-19）
- 架构：Electron + Tailwind CSS + shadcn 组件

**核心创新点**

1. **一包多端主题格式（.codedrobe-theme）**
   - 单一主题包内含多应用 CSS，按应用 ID 分发
   - Schema 声明依赖的界面节点，安装前做兼容性预检
   - 零 JavaScript，纯声明式配置 + CSS + 图片

2. **实时热切换**
   - 运行中的应用通过 CDP 连接直接热切换，无需重启
   - 首次启动或主机外观设置变化时才请求重启

3. **深度链接集成**
   - `codedrobe://themes/apply?theme=<slug>&app=<id>` 协议
   - 网站一键安装并应用主题

4. **OAuth 2.0 PKCE 登录**
   - 系统浏览器完成授权，应用内不处理密码
   - 支持收藏同步、点赞

**近期动态**
- 2026-07-19：v2.1.1 自动导入从系统打开的主题包
- 2026-07-18：v2.1.0 支持 QoderWork 和 TRAE SOLO
- 2026-07-17：一键原地更新

**与 AgentSkin 对比**

| 维度 | CodeDrobe Desktop | AgentSkin |
|------|-------------------|-----------|
| 应用支持 | 4 款（Codex/WorkBuddy/QoderWork/TRAE SOLO） | 6 款（含 Doubao/ZCode） |
| 主题格式 | .codedrobe-theme（单文件多端） | .agentskin-theme（14-token 契约） |
| 商店 | codedrobe.app 在线商店 | 本地 Studio |
| 登录 | OAuth 2.0 PKCE | 无账号系统 |
| 深度链接 | codedrobe:// 协议 | 无 |

**可借鉴点**
- 深度链接协议（P1）：实现 `agentskin://` 协议从外部触发主题应用
- 兼容性预检（P2）：安装前验证主题与当前应用版本的兼容性

---

### 2.2 CodeDrobe/skills — Agent Skills 工作流

**基本信息**
- 定位：给 AI 桌面应用换肤的 Agent Skills
- Stars：244（Apache-2.0）
- 包含两个 Skill：codedrobe-theme、codedrobe-adapter-dev

**核心创新点**

1. **参考图 → 皮肤工作流**
   - 用户上传参考图 + 描述目标应用
   - Agent 读取实时 CDP DOM → 生成整套 CSS → 打包 → 真机验证
   - 隐私保护：使用 CDP DOM 快照而非截图

2. **验证-修复闭环**
   - `verify --screenshot` 截图验证
   - 应用更新后自动分析 DOM 变化并修复主题

3. **商店发布流程**
   - 主题元数据填写 → 截图生成 → 发布到 codedrobe.app

**与 AgentSkin 对比**
- AgentSkin 已有 Studio 创作功能，但缺少标准化 Skill 工作流
- CodeDrobe 的 SKILL.md 模式可被任何 AI Agent 调用（Codex/Claude Code/Cursor）

**可借鉴点**
- Agent Skills 封装（P1）：将主题创建/验证/修复流程封装为标准 Skill
- DOM 快照驱动的主题生成（P2）：用实时 DOM 结构生成更精准的 CSS

---

### 2.3 Lumos-789/zcode-cdp — ZCode CDP 生产级框架

**基本信息**
- 定位：为 AI Coding Agent 设计的"已登录浏览器接管"框架
- 版本：v0.2.0（2026-08-15，重大架构升级）
- License：MIT

**核心创新点（高价值参考）**

1. **端口租约池（Port Lease Pool）**
   - 统一端口租约池：9223–9229 共 7 槽
   - 原子 `mkdir` 抢锁 + `leaseId` ownership 校验
   - 杜绝双 owner 竞态，多 agent 并发不抢端口

2. **三层看门狗（Watchdog）**
   - 软层：CPU lag 检测
   - 孤儿超时：agent 崩溃后 Chrome/proxy 残留清理
   - 硬层：worker 线程 SIGKILL 强制终止
   - 生产实测：扛过两次 EPIPE 异常风暴

3. **状态机懒启动**
   - 不碰浏览器的窗口 = 0 Chrome 进程
   - 首次 `browser_*` 调用才启动 Chrome
   - 长期存活（durable）+ 懒加载双模式

4. **Relay 架构（v0.2.0 新增）**
   - 本地 TCP 中继 + 单常驻 backend
   - 删除双 backend 切换，简化架构

**与 AgentSkin 对比**

| 维度 | zcode-cdp | AgentSkin |
|------|-----------|-----------|
| 端口管理 | 租约池 + 原子锁 | 单端口直连 |
| 进程守护 | 三层看门狗 | 无 |
| 并发控制 | leaseId ownership | epoch-manager |
| 状态机 | 懒启动 + durable | 即时连接 |

**可借鉴点（P0 高优先级）**
- 端口租约池机制：解决多 agent 并发 CDP 连接竞态
- 三层看门狗：提升注入进程稳定性，防止僵尸进程

---

### 2.4 AI-Scarlett/LingGlow — 三端换肤管理器

**基本信息**
- 定位：macOS AI Agent 主题、皮肤与个性化管理工具
- 版本：v2.3.18（2026-07-28）
- 支持：Codex/ChatGPT、WorkBuddy、豆包（Doubao）

**核心创新点**

1. **三端统一管理**
   - 单一应用管理 Codex/WorkBuddy/Doubao 三款皮肤
   - 各自真实客户端图标与独立适配能力
   - 深浅模式语义配色

2. **安全机制**
   - 只允许声明式 JSON 与静态 WebP
   - 包、定义文件和图片均校验 SHA-256
   - App 更新校验摘要、Bundle ID、Developer Team ID、签名与 Apple 公证

3. **动画优化**
   - 合成层位移减少布局计算
   - 限制 DOM 扫描范围减少卡顿
   - 空闲/后台/页面隐藏时暂停动画

4. **阅读遮罩**
   - 根据皮肤表面色、文字色和照片明暗计算连续阅读遮罩
   - 提升正文、侧栏与输入框在复杂背景上的可读性

**与 AgentSkin 对比**

| 维度 | LingGlow | AgentSkin |
|------|----------|-----------|
| 应用支持 | 3 款（Codex/WorkBuddy/Doubao） | 6 款 |
| 安全校验 | SHA-256 + 签名 + 公证 | 14-token 契约 |
| 动画系统 | 合成层位移 + 智能暂停 | CSS 注入 |
| 阅读遮罩 | 连续计算 | 无 |

**可借鉴点**
- 阅读遮罩算法（P1）：根据背景色动态计算文字遮罩，提升可读性
- 安全校验增强（P2）：主题包 SHA-256 校验

---

### 2.5 MagMueller/aios — 通用 Electron 注入套件

**基本信息**
- 定位：任意 macOS Electron 应用的实时修改套件
- 创建：2026-04-11（无后续更新）
- 包含：主进程 Agent、CDP 端点、热重载配置、Claude Code Skill

**核心创新点**

1. **主进程 Agent 注入**
   - 一行代码 patch 目标应用入口文件
   - `fs.watchFile('/tmp/aios-config.json')` 监听配置变化
   - 1 秒内重新注入 CSS/JS 到所有 BrowserWindow

2. **CDP 端点暴露**
   - 自动启用 `--remote-debugging-port=9222`
   - 任何进程可通过 WebSocket 驱动渲染层

3. **示例覆盖**
   - Slack、Discord、Linear、Superhuman、Notion、Cursor、WhatsApp、Signal

**与 AgentSkin 对比**
- aios 是通用注入框架，AgentSkin 是专用主题引擎
- aios 需要一次性 patch 应用入口文件（非纯运行时）
- AgentSkin 的 CDP 注入是纯运行时的，不修改目标应用

**可借鉴点**
- 热重载配置模式（P2）：通过文件监听实现配置热更新
- 注意：aios 的入口文件 patch 方式违反 AgentSkin 的"零修改应用"原则，仅作参考

---

## 三、优先级矩阵

### P0（立即执行）

| 编号 | 改进项 | 来源 | 预期影响 |
|------|--------|------|----------|
| P0-1 | 端口租约池机制 | zcode-cdp | 解决多 agent 并发 CDP 连接竞态 |
| P0-2 | 三层看门狗进程守护 | zcode-cdp | 防止僵尸进程，提升稳定性 |

### P1（本季度执行）

| 编号 | 改进项 | 来源 | 预期影响 |
|------|--------|------|----------|
| P1-1 | 阅读遮罩算法 | LingGlow | 提升复杂背景上的文字可读性 |
| P1-2 | 深度链接协议 | CodeDrobe/desktop | 支持外部触发主题应用 |
| P1-3 | Agent Skills 封装 | CodeDrobe/skills | 标准化主题创建/验证/修复流程 |

### P2（未来考虑）

| 编号 | 改进项 | 来源 | 预期影响 |
|------|--------|------|----------|
| P2-1 | 兼容性预检增强 | CodeDrobe/desktop | 安装前验证主题兼容性 |
| P2-2 | 主题包 SHA-256 校验 | LingGlow | 增强主题包完整性验证 |
| P2-3 | 热重载配置模式 | aios | 配置热更新 |

---

## 四、执行计划

### 4.1 P0-1: 端口租约池机制

**目标**：实现类似 zcode-cdp 的端口租约池，解决多 agent 并发 CDP 连接竞态

**实现方案**：
1. 创建 `src/main/cdp/port-lease-pool.ts`
2. 端口范围：9223-9229（7 槽）
3. 原子锁：使用文件系统的 `mkdir` 原子性实现抢锁
4. leaseId 所有权校验
5. 编写单元测试

### 4.2 P0-2: 三层看门狗进程守护

**目标**：实现类似 zcode-cdp 的三层看门狗，防止僵尸进程

**实现方案**：
1. 创建 `src/main/cdp/watchdog.ts`
2. 软层：CPU lag 检测（定时检查进程 CPU 使用率）
3. 孤儿超时：agent 崩溃后超时清理
4. 硬层：强制终止残留进程
5. 编写单元测试

### 4.3 P1-1: 阅读遮罩算法

**目标**：根据背景色动态计算文字遮罩，提升可读性

**实现方案**：
1. 创建 `src/main/css/readability-mask.ts`
2. 输入：背景色、文字色、照片明暗
3. 输出：连续阅读遮罩 CSS
4. 集成到主题应用流程
5. 编写单元测试

---

## 五、重大更新标记

| 项目 | 更新内容 | 影响 |
|------|----------|------|
| zcode-cdp | v0.2.0 relay 架构（2026-08-15） | 高：架构简化思路可参考 |
| CodeDrobe/desktop | v2.1.0 支持 QoderWork 和 TRAE SOLO | 中：竞品扩展应用支持 |
| LingGlow | v2.3.18 修复豆包 2.19.9 兼容性 | 低：豆包适配参考 |

---

## 六、下一步行动

1. ✅ 完成第 5 轮竞品分析
2. ⏳ 执行 P0-1：端口租约池机制
3. ⏳ 执行 P0-2：三层看门狗进程守护
4. ⏳ 执行 P1-1：阅读遮罩算法
5. ⏳ 验证所有修改并通过全量测试

---

## 附录：竞品项目完整数据

### CodeDrobe/desktop
- 仓库：https://github.com/CodeDrobe/desktop
- Stars：51 / Forks：4 / Issues：5
- License：MPL-2.0
- 最新 Release：v2.1.1（2026-07-19）
- 最近提交：
  - 2026-07-19：Auto-import theme packages opened from the OS
  - 2026-07-18：v2.1.0: core 0.6.0 with QoderWork and TRAE SOLO support
  - 2026-07-18：v2.0.2: core 0.4.0 with per-window preflight and Windows fixes

### CodeDrobe/skills
- 仓库：https://github.com/CodeDrobe/skills
- Stars：244 / Forks：22 / Issues：1
- License：Apache-2.0
- 最近提交：
  - 2026-08-09：feat: add dual-mode Miku × Neon Skyline WorkBuddy theme
  - 2026-07-19：docs: add community links to skill READMEs
  - 2026-07-19：CI: pack every bundled theme manifest

### Lumos-789/zcode-cdp
- 仓库：https://github.com/Lumos-789/zcode-cdp
- Stars：1 / Forks：0 / Issues：0
- License：MIT
- 最新 Release：v0.2.0（2026-08-15）
- 最近提交：
  - 2026-08-15：chore: openspec 规格工作流移出 git 跟踪
  - 2026-08-15：fix(takeover): 启动前从日常 profile 同步扩展工具栏 pin 状态
  - 2026-08-14：feat!: v0.2.0 relay 架构

### AI-Scarlett/LingGlow
- 仓库：https://github.com/AI-Scarlett/LingGlow
- Stars：0 / Forks：0 / Issues：0
- License：无
- 最新 Release：v2.3.18（2026-07-28）
- 最近提交：
  - 2026-07-29：公开 LingGlow 应用源码
  - 2026-07-28：发布 LingGlow 2.3.18
  - 2026-07-27：发布 LingGlow 2.3.17

### MagMueller/aios
- 仓库：https://github.com/MagMueller/aios
- Stars：0 / Forks：0 / Issues：0
- License：无
- 最近提交：
  - 2026-04-11：initial: aios electron-mod kit with SKILL.md, agent, drive.js, install.sh, examples
