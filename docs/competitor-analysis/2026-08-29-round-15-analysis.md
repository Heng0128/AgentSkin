# 第 15 轮竞品深度分析报告 — CDP 接管 / 多应用引擎 / MCP 桥接

> 执行时间: 2026-08-29 08:00
> 分析项目: 5 个（聚焦 ZCode CDP 接管、多应用引擎架构、MCP Agent 桥接）

---

## 一、项目概览

| 项目 | Stars | 平台 | 语言 | 最后更新 | 与 AgentSkin 相关性 |
|------|-------|------|------|---------|-------------------|
| Lumos-789/zcode-cdp | 1 | macOS/Linux/Windows | JS | 2026-08-15 | ★★★★★ ZCode 适配器直接相关 |
| CodeDrobe/core + desktop | 51 | macOS/Windows | TS | 2026-07-21 | ★★★★★ 多应用引擎参考 |
| AI-Scarlett/LingGlow | 0 | macOS | Swift/JS | 2026-07-29 | ★★★★☆ 豆包/WorkBuddy/Codex 适配 |
| oussamaexe/electron-debugger | 1 | Node.js | TS | 2026-06-23 | ★★★★☆ MCP 调试桥接 |
| ntoskrnl7/electron-cdp | 2 | Node.js | TS | 2026-05-18 | ★★☆☆☆ 基础 CDP SDK（已停更） |

---

## 二、深度分析

### 2.1 Lumos-789/zcode-cdp — CDP 接管框架

**仓库**: https://github.com/Lumos-789/zcode-cdp
**版本**: v0.2.0 (2026-08-14)
**活跃度**: 8/14-8/15 密集提交（5 次 commits），非常活跃

#### 核心创新

这是一个为 AI Coding Agent 设计的"已登录浏览器接管"框架，核心价值是让 agent 用真人已登录的 Chrome 工作。

**架构组件**:
- `zcode-cdp-proxy` — 状态机懒加载代理（IDLE→ENSURING→ACTIVE→CLOSING→IDLE）
- `zcode-cdp-lease` — 端口租约治理
- `cdpcc` — Claude Code 端口预占包装器
- `cdp-takeover` — 直接接管工具

**可借鉴设计**:

1. **端口租约模型（Port Lease Pool）**
   - 统一 `mkdir` 原子抢锁 + `leaseId` ownership 校验
   - 端口池 9223-9229（7 槽），脚本固定端口 93xx
   - 防 PID 复用误删新锁
   - proxy / cdpcc / cdp-takeover 共享同一锁命名空间

2. **三层看门狗（Three-Layer Watchdog）**
   - 软看门狗：事件循环延迟检测（CDP_WATCHDOG_LAG_MS=2000ms）
   - CPU 看门狗：主进程 CPU% busy-loop 检测（阈值 85%，滑动窗口 5 次）
   - 硬看门狗：独立 worker 线程，60s 无心跳即 SIGKILL（免疫主线程卡死）

3. **懒加载 + 状态机**
   - 不碰浏览器的窗口 = 0 Chrome 进程
   - 首次 `browser_*` 调用才起 Chrome
   - 激活循环不重启 backend

4. **Relay 中继架构（v0.2.0 新增）**
   - 本地 TCP 中继 + 单常驻 backend
   - 挂起语义替代缓冲（零应用层缓冲代码）

5. **Profile 隔离**
   - 每端口独立 profile + 不同卡通头像
   - `rsync` 从日常 Chrome profile 继承登录态
   - 多账号天然隔离

#### 与 AgentSkin 对比

| 维度 | zcode-cdp | AgentSkin |
|------|-----------|-----------|
| 端口管理 | 原子租约池（7 并发槽） | 固定端口 / 简单互斥 |
| 进程守护 | 三层看门狗 | 无专门守护 |
| 生命周期 | 懒加载 + 状态机 | 全量注入 |
| 多会话 | 端口隔离 + profile 隔离 | 共享 CDP 连接 |
| ZCode 支持 | 原生 MCP 工具 | 自有适配器 |

**落地优先级: P0** — 端口租约 + 看门狗直接提升 AgentSkin 稳定性和并发能力。

---

### 2.2 CodeDrobe/core + Desktop — 多应用主题引擎

**仓库**: 
- Engine: https://github.com/CodeDrobe/core (v0.7.0-beta.0)
- Desktop: https://github.com/CodeDrobe/desktop (v2.1.0)
**Stars**: 51⭐ + 4 Forks
**活跃度**: desktop 7/18-7/19 后停更（进入稳定期），core 7/21 仍有 beta

#### 核心创新

**多应用适配器系统**:
- `codex` / `workbuddy` / `qoderwork` / `traework` 四适配器
- ES Module API: `applySkin()`, `restoreSkin()`, `getAdapter()`, `snapshotDom()`, `probe()`
- `watchTheme()` 接受 AbortSignal，Electron 主进程自主管理生命周期

**DOM Snapshot（AI 辅助主题创作）**:
```bash
codedrobe dom snapshot --app codex --output codex-dom.json
```
- 记录活跃主题、元素关系、语义类、稳定选择器候选 + 匹配计数、边界框、主题相关计算样式
- 排除文本、表单值、可访问名称、查询/哈希、链接、媒体源
- 默认只包含可见元素；`--include-hidden` 覆盖隐藏路由/对话框

**Deep Link 集成**:
```
codedrobe://themes/apply?theme=<slug>&app=codex
```
- 网站"Open in App"一键安装应用主题
- macOS 打包注册 URL Scheme
- 开发模式通过启动参数传递

**账户系统**:
- OAuth 2.0 Authorization Code + PKCE
- 浏览器登录回调，App 永不接触密码
- 凭证文件 mode 0600，与 CLI 同模型

#### 与 AgentSkin 对比

| 维度 | CodeDrobe | AgentSkin |
|------|-----------|-----------|
| 适配器 | 4（codex/workbuddy/qoderwork/traework） | 6（+ doubao/zcode） |
| 主题包格式 | .codedrobe-theme | .agentskin-theme |
| DOM Snapshot | 专用命令 + JSON 输出 | snapshot-theme.ts |
| 商店集成 | codedrobe.app 网站 + deep link | 自建 Studio |
| 账户系统 | OAuth PKCE | 无（禁止服务端） |
| 语言 | TypeScript | TypeScript |

**关键差异**: CodeDrobe 的 DOM Snapshot 输出格式详细（选择器候选 + 匹配计数 + 边界框），比我们的 snapshot-theme.ts 更结构化。但其选择了自建商店 + 账户系统路线，违反 AgentSkin"禁止服务端"原则。

**落地优先级: P1** — DOM Snapshot 格式增强和 deep link 可借鉴，商店路线不可取。

---

### 2.3 AI-Scarlett/LingGlow — macOS 商业化换肤工具

**仓库**: https://github.com/AI-Scarlett/LingGlow
**版本**: v2.3.18 (2026-07-28)
**活跃度**: 7/26-7/29 每日一版本，非常活跃
**商业模式**: 付费 VIP + 免费皮肤（39 套中 18 VIP + 21 免费）

#### 核心创新

**三端适配**:
- Codex/GPT、WorkBuddy、豆包
- 各自真实客户端图标与独立适配能力

**安全模型**:
- 皮肤包只允许声明式 JSON + 静态 WebP
- 包、定义文件、图片全部 SHA-256 校验
- 应用前检查客户端签名 + 兼容级别
- 保留恢复官方原版入口

**动效挂件（Desktop Pet）**:
- 输入框挂件（沿输入框往返漂浮）
- 合成层位移动画
- 只在生成回复时运行，空闲/后台/隐藏时暂停
- 按真实输入框宽度计算路程

**深浅模式语义**:
- 皮肤声明 light/dark
- 语义文字和控件颜色不直接套用背景图颜色
- 豆包根据表面色/文字色/照片明暗计算连续阅读遮罩

#### 与 AgentSkin 对比

| 维度 | LingGlow | AgentSkin |
|------|----------|-----------|
| 平台 | macOS 13+ | macOS + Windows |
| 适配 | 3 端（Codex/WorkBuddy/Doubao） | 6 端 |
| 商业模式 | VIP 付费 + Dodo Payments | 免费开源 |
| 动效 | 桌面宠物/挂件 | 无 |
| 安全 | SHA-256 + 签名校验 | Bundle 校验 |

**落地优先级: P1** — 深浅模式语义系统和安全校验可借鉴；VIP 模式不可移植（无服务端）。

---

### 2.4 oussamaexe/electron-debugger — MCP 调试桥接

**仓库**: https://github.com/oussamaexe/electron-debugger
**版本**: v3.0.0 (npm: @oussamaexe/electron-debugger)
**活跃度**: 6/22-6/23 密集后停更

#### 核心创新

**15 个 MCP 工具**:
- `get-dom-snapshot` — DOM 树快照
- `get-element-box` — CSS 选择器边界框
- `get-element-styles` — 计算样式
- `take-screenshot` — 页面/元素截图
- `get-console-logs` — 控制台日志
- `get-metrics` — 性能指标（FPS/内存/DOM 节点）
- `click-element` — 点击元素
- `type-text` — 输入文本
- `highlight-element` — 视觉高亮
- `list-windows` — 列出所有 BrowserWindow

**React Fiber 树遍历** — 让 Agent 直接理解 React 组件树结构

**两种使用模式**:
- MCP Server（stdio）: AI 助手直接调用
- CLI: `electron-debugger exec <command>`

#### 与 AgentSkin 对比

| 维度 | electron-debugger | AgentSkin |
|------|-------------------|-----------|
| 用途 | 调试工具 | 主题注入 |
| 暴露面 | DOM/样式/交互/控制台 | 仅 CSS 变量 |
| MCP 支持 | 原生 | 无 |
| React Fiber | 支持 | 不适用 |

**落地优先级: P2** — MCP 桥接模式可参考，但非核心功能。

---

### 2.5 ntoskrnl7/electron-cdp — TypeScript CDP SDK

**状态**: 已停更（最后提交 2026-05-18）
**价值**: 低 — 仅有 2 星，功能有限，无后续维护

---

## 三、评估矩阵

| 项目 | AgentSkin 原型 | RAG | 采用 | 理由 |
|------|---------------|-----|------|------|
| 端口租约池 (zcode-cdp) | 无 | 🟢 Green | ✅ | 直接解决并发连接竞态 |
| 三层看门狗 (zcode-cdp) | 无 | 🟢 Green | ✅ | 提升适配器稳定性 |
| 懒加载 + 状态机 (zcode-cdp) | 无 | 🟡 Amber | ⚠️ | 概念可借鉴，但 AgentSkin 是全量注入模式 |
| Relay 中继架构 (zcode-cdp) | 无 | 🔴 Red | ❌ | 架构差异大，不适合 |
| 懒加载 + 状态机 (zcode-cdp) | 无 | 🟡 Amber | ⚠️ | 概念可借鉴 |
| DOM Snapshot 格式 (CodeDrobe) | 有基础版 | 🟢 Green | ✅ | 增强 snapshot-theme.ts 输出结构 |
| Deep Link (CodeDrobe) | 无 | 🟡 Amber | ⚠️ | 需要 Electron 协议注册，可行但有工作量 |
| 深浅模式语义 (LingGlow) | 无 | 🟢 Green | ✅ | 增强 theme 系统感知 |
| 安全校验 (LingGlow) | 有基础 | 🟢 Green | ✅ | 补充 SHA-256 校验链条 |
| MCP 桥接 (electron-debugger) | 无 | 🟡 Amber | ⚠️ | 规划但非紧急 |

---

## 四、推荐实施方案

### Wave 1 — P0: 端口租约管理器

**来源**: zcode-cdp 的端口租约模型
**目标**: 替换现有固定端口分配，实现原子租约 + 并发安全

**设计要点**:
- 端口池管理（可配置范围）
- 原子 `mkdir` 抢占（Node.js `fs.mkdir` with `{ recursive: false }`）
- `leaseId` ownership 校验（UUID + PID + 时间戳）
- stale 锁回收（owner 已死 + 锁龄超阈值）

### Wave 1 — P0: 三层看门狗

**来源**: zcode-cdp 的 watchdog 架构
**目标**: 适配器进程崩溃自动恢复

**设计要点**:
- 软看门狗: 事件循环延迟检测
- CPU 看门狗: 主进程 busy-loop 检测
- 硬看门狗: worker 线程心跳监控
- 集成到 orchestrator 的 state machine

### Wave 2 — P1: DOM Snapshot 格式增强

**来源**: CodeDrobe 的 `dom snapshot` 输出格式
**目标**: 增强 snapshot-theme.ts 输出结构化程度

**新增字段**:
- 选择器候选 + 匹配计数
- 元素边界框
- 主题相关计算样式集合

### Wave 2 — P1: 深浅模式语义增强

**来源**: LingGlow 的声明式 light/dark + 语义色
**目标**: 14-token 系统扩展为 14-token × 2（light/dark 各一套）+ 语义文字/控件颜色独立

### Wave 3 — P2: MCP 调试工具桥接

**来源**: electron-debugger 的 MCP 工具暴露
**目标**: 将 AgentSkin 部分能力暴露为 MCP Server

---

## 五、重大更新标记

| 项目 | 状态 | 说明 |
|------|------|------|
| Lumos-789/zcode-cdp | 🟡 活跃维护 | v0.2.0 relay 架构，8/15 仍有提交 |
| CodeDrobe/core | 🟢 稳定 | v0.7.0-beta.0 (7/21) |
| CodeDrobe/desktop | 🟢 稳定 | v2.1.0 (7/18)，无重大更新 |
| AI-Scarlett/LingGlow | 🟡 活跃发布 | v2.3.18 (7/28)，每日一发 |
| oussamaexe/electron-debugger | 🔴 停更 | v3.0.0 (6/23) 后无活动 |
| ntoskrnl7/electron-cdp | 🔴 停更 | 5/18 后无活动 |

---

## 六、下一步建议

1. **Wave 1 实施**: P0-1 端口租约管理器 + P0-2 三层看门狗
2. **Wave 2 实施**: P1-1 DOM Snapshot 格式增强 + P1-2 深浅模式语义
3. **持续跟踪**: zcode-cdp 的 relay 架构演进（可能影响 ZCode 适配器设计）
4. **关注 LingGlow 商业化**: 验证"付费皮肤"模式的市场接受度
5. **CodeDrobe 适配器变更**: 其 qoderwork/traework 适配器更新可能启发我们的对应适配器
