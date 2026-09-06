# 第 26 轮竞品深度分析报告 — 桌宠伴侣 / Skill 化换肤 / Tauri 注入 / 多应用母舰 / 皮肤管理器

> 报告日期: 2026-08-30 09:00
> 分析项目: 5 个（覆盖 桌宠伴侣 / Agent Skill / Tauri 注入 / 多应用母舰 / 跨平台管理器）
> 重点适配目标: traework, qoderwork, workbuddy, doubao, codex, zcode

---

## 一、⚠️ 重大发现：Clawd 桌宠爆发至 6071⭐ 且今日仍在活跃

**rullerzhou-afk/clawd-on-desk** 当前 **6071⭐ / 630 Forks**，今天（2026-08-30）仍有提交，是当前 AI 伴侣赛道最火项目。它不是换肤工具，而是**通过 hook 感知 Agent 状态并播放像素动画的桌面宠物**。

| 维度 | 数据 |
|------|------|
| Stars | 6,700+（2 周内从 0 爆发）|
| Forks | 630 |
| 今天提交 | ✅ 2026-08-30 00:07:45（仍在活跃）|
| 许可 | AGPL-3.0 |
| 语言 | JavaScript + Electron |
| 架构 | HTTP hook 服务器 + 状态机 + 权限气泡 + 远程通知 |

> **战略意义**: Clawd 验证了"Agent 伴侣"赛道的巨大需求。AgentSkin 专注 UI 换肤，Clawd 专注状态感知+陪伴，两者互补而非竞争。可借鉴其 HTTP hook 服务器架构、权限自动化策略、远程通知模式。

---

## 二、分析项目概览

| # | 项目 | Stars | 语言 | 创建 | 最后 push | 活跃度 | 与我们关系 |
|---|------|-------|------|------|-----------|--------|-----------|
| 1 | [rullerzhou-afk/clawd-on-desk](https://github.com/rullerzhou-afk/clawd-on-desk) | 6700+ | JS+Electron | 2026-03-18 | **2026-08-30** | 🔥🔥 爆发中 | 桌宠伴侣，28+ Agent 集成 |
| 2 | [CodeDrobe/skills](https://github.com/CodeDrobe/skills) | 246 | CSS | 2026-07-15 | 2026-08-09 | ⚠️ 停滞 | Agent Skill 化换肤 |
| 3 | [CodeDrobe/desktop](https://github.com/CodeDrobe/desktop) | 52 | TypeScript | 2026-07-15 | 2026-07-19 | 停滞 | 多应用母舰（Codex/WorkBuddy/QoderWork/TRAE）|
| 4 | [Cmochance/agent-theme](https://github.com/Cmochance/agent-theme) | 1 | Rust+Tauri | 2026-05-26 | 2026-07-20 | 停滞 | Tauri 伴侣，CDP 注入 + 11 主题 |
| 5 | [ZhjGo/codex-skin-manager](https://github.com/ZhjGo/codex-skin-manager) | 25 | CSS | 2026-07-16 | 2026-07-16 | 停滞 | Electron CDP 注入 + 7 主题 |

---

## 三、各项目技术亮点深度剖析

### 3.1 rullerzhou-afk/clawd-on-desk — Agent 伴侣新范式（最值得关注）

**项目定位**: 通过 hook / 日志轮询 / plugin / extension 感知 AI coding agent 的工作状态，并播放像素风动画的 Electron 桌宠。

**核心架构 — HTTP Hook 服务器 + 状态机**:

```
Agent (CLI) → command hook → POST /state → Clawd HTTP Server
                                                ↓
                                     src/agent-runtime-main.js
                                                ↓
                                          src/state.js (状态机)
                                                ↓
                                     IPC → Pet Window (动画)
```

**技术亮点**:

1. **统一 HTTP Hook 服务器** (`src/server.js` + `src/server-route-state.js` + `src/server-route-permission.js`)
   - 固定端口范围 `127.0.0.1:23333-23337`
   - 运行时端口写入 `~/.clawd/runtime.json`
   - 两个核心端点: `/state` (状态上报) 和 `/permission` (权限审批)
   - 自定义 HTTP Agent 通过读取 `runtime.json` 发现端口

2. **多 Agent 注册表** (`agents/registry.js`)
   - 每个 agent 声明 capabilities: `permissionApproval`, `interactiveBubble`, `subagentTracking`, `sessionEnd`
   - 28+ agent 集成: Claude Code, Codex CLI, Copilot CLI, Gemini CLI, Cursor, WorkBuddy, ZCode, QoderWork, QwenCode, DeepSeek Harness 等
   - **直接覆盖我方目标**: Codex, WorkBuddy, ZCode, QoderWork

3. **权限自动化策略** (`src/permission-automation-policy.js`)
   - 三级模式: `off` / `auto-tools` / `unattended`
   - 显式白名单 `KNOWN_PERMISSION_AGENTS` 控制哪些 agent 可走自动化
   - per-session grant: 每个会话独立授权
   - 工具分类因 mode/adapter 而异

4. **远程通知通道**
   - Telegram / 飞书 Lark: 交互式远程审批
   - Slack: 仅通知（Block Kit 富文本卡片）
   - 远程通道失败不产生决定，回到 agent 原生流程

5. **手机伴侣 PWA**
   - 局域网桥广播状态
   - 令牌防护 + 自动轮换
   - 只读设计（PWA 无法操作电脑）

6. **会话智能**
   - 多会话追踪 → 最高优先级状态
   - 子代理感知: 1 个耳机律动, 2+ 个三球杂耍
   - 进程存活检测: 10 秒内清理孤儿会话
   - 启动恢复: Clawd 重启时保持清醒

**与 AgentSkin 对比**:

| 维度 | Clawd | AgentSkin |
|------|-------|-----------|
| 定位 | Agent 状态感知 + 桌宠陪伴 | UI 换肤 + 主题引擎 |
| 集成方式 | HTTP hook + 日志轮询 | CDP 注入 |
| 多 Agent | 28+ agent 统一注册表 | 6 agent 适配器 |
| 权限管理 | 自动化策略 + 远程审批 | 无 |
| 通知通道 | Telegram/飞书/Slack | 无 |
| 手机伴侣 | PWA + 原生 Android | 无 |

**可借鉴点**:
- HTTP hook 服务器架构（可扩展为 AgentSkin 的 Agent 状态感知层）
- 权限自动化策略的分级模式
- 远程通知的降级语义（通道失败不产生决定）

---

### 3.2 CodeDrobe/skills — Agent Skill 化换肤范式

**项目定位**: 可安装的 Agent Skills，让 AI 自动创建、应用、验证、修复、发布主题。

**核心架构 — Skill + Core CLI 分离**:

```
AI Agent → codedrobe-theme SKILL.md → @codedrobe/core CLI
                                                ↓
                                    codedrobe dom snapshot (CDP)
                                                ↓
                                    语义节点选择 + CSS 注入
```

**技术亮点**:

1. **双 Skill 架构**
   - `codedrobe-theme`: 面向用户和主题作者（创建/应用/验证/修复/发布）
   - `codedrobe-adapter-dev`: 面向 Core 维护者（适配器开发）

2. **隐私保护的主题创建**
   - 参考图仅用于艺术方向
   - 实时 CDP DOM snapshot 用于选择器（不截图上传）
   - 样式真实应用而非覆盖截图

3. **社区发布流程**
   - `codedrobe theme publish --submit`
   - 设备流 sign-in + 服务端包校验 + 审核
   - 10 分类商店分类法

4. **双模式主题**（最新 commit）
   - Miku × Neon Skyline WorkBuddy 主题
   - CSS 作用域: `:not(.dark)` 亮色 / `.dark` 暗色
   - 自动跟随 WorkBuddy 亮/暗切换

**与 AgentSkin 对比**:

| 维度 | CodeDrobe Skills | AgentSkin |
|------|-----------------|-----------|
| 主题创建 | AI Agent 自动创建 | 手动 + Studio |
| 验证 | 自动截图比对 | health-monitor |
| 发布 | 社区商店 | 无 |
| 适配器开发 | 独立 Skill | 代码内适配器 |

**可借鉴点**:
- AI 自动创建主题的 Skill 化模式
- 双模式主题（亮/暗自动切换）的 CSS 作用域方案
- 社区发布 + 审核流程

---

### 3.3 CodeDrobe/desktop — 多应用母舰标准化

**项目定位**: 可视化换肤管理器，一个主题包可覆盖 Codex / WorkBuddy / QoderWork / TRAE SOLO。

**技术亮点**:

1. **v2 完整重构**
   - Tailwind CSS + shadcn 风格组件
   - 多应用支持: 一个主题包覆盖多个应用
   - OAuth 2.0 PKCE 账户登录

2. **Deep Link 协议**
   - `codedrobe://themes/apply?theme=<slug>&app=<id>`
   - 网站一键安装 + 应用内确认

3. **智能应用流程**
   - 已运行 + 调试连接 → 实时切换
   - 首次启动才请求重启
   - 端口冲突不再循环弹窗

4. **文件关联**
   - `.codedrobe-theme` / `.codex-theme` 文件类型注册
   - macOS UTIs + Windows NSIS
   - 拖放导入 + 冷启动 argv 处理

**可借鉴点**:
- Deep Link 协议（网站 → 应用一键应用）
- 文件关联 + 拖放导入的统一流程
- 端口冲突的优雅处理

---

### 3.4 Cmochance/agent-theme — Tauri 伴侣 + 11 主题

**项目定位**: 独立桌面应用（Tauri v2），通过 CDP 向 Codex Desktop / Antigravity 注入 CSS。

**技术亮点**:

1. **theme.json 配色旋钮**
   - 与代理无关的 `--cl-*` 变量
   - 两个注入器各自翻译成对应平台令牌
   - 分级文字: `ink` / `ink2` / `ink3` / `ink4`
   - 可读性 scrim: `scrimTop` / `scrimMid` / `scrimBot`

2. **磨砂玻璃效果**
   - 各模块不同透明度 `glass*` + `blur`
   - `backdrop-filter` 实时采样面板背后图像

3. **CDP 注入方式**
   - `Page.addScriptToEvaluateOnNewDocument` 页面加载前注入
   - 保存 `identifier` 以便 `Page.removeScriptToEvaluateOnNewDocument` 清除
   - 代理重启后自动重新注入

**与 AgentSkin 对比**:

| 维度 | Cmochance | AgentSkin |
|------|-----------|-----------|
| 技术栈 | Tauri v2 + Rust | Electron + React |
| 主题格式 | theme.json 配色旋钮 | 14-token 契约 |
| 磨砂玻璃 | backdrop-filter 实时采样 | 无 |
| 自动重注入 | 检测端口自动恢复 | health-monitor |

**可借鉴点**:
- 磨砂玻璃实时采样面板背后图像
- 可读性 scrim 渐变（从上到下暗化）
- 代理重启后自动重注入

---

### 3.5 ZhjGo/codex-skin-manager — 跨平台皮肤管理器

**项目定位**: Electron 桌面应用，通过 CDP 为 Codex / ChatGPT 注入 CSS + JS。

**技术亮点**:

1. **零残留清理** (`engine/purge-all.mjs`)
   - `PURGE` 常量白名单
   - 自动清洗注入的 DOM 节点、CSS 样式、全局 state、粒子定时器
   - 杜绝交叉样式污染

2. **底色主题同步写入**
   - 自动适配 `~/.codex/config.toml`
   - 应用皮肤时同步切换系统底色与编辑器主题

3. **皮肤目录结构**
   ```
   skins/<id>/
   ├── skin.json
   └── assets/
       ├── <id>-skin.css
       ├── renderer-inject.js (含 ensure 与 cleanup)
       └── <id>-reference.png
   ```

**可借鉴点**:
- 零残留清理的白名单机制
- 底色主题同步写入（不修改 UI 但同步系统配置）

---

## 四、AgentSkin 差距分析

| 能力 | 竞品现状 | AgentSkin 现状 | 差距 |
|------|---------|---------------|------|
| Agent 状态感知 | Clawd: HTTP hook + 28+ agent | 无 | 高 |
| 权限自动化 | Clawd: 三级策略 + per-session | 无 | 中 |
| 远程通知 | Clawd: Telegram/飞书/Slack | 无 | 中 |
| 手机伴侣 | Clawd: PWA + 原生 App | 无 | 低 |
| AI 创建主题 | CodeDrobe: Skill 自动创建 | 手动 + Studio | 中 |
| 社区发布 | CodeDrobe: 商店 + 审核 | 无 | 低 |
| 双模式主题 | CodeDrobe: CSS 作用域 | 14-token 亮/暗 | 低 |
| 磨砂玻璃 | Cmochance: backdrop-filter 实时采样 | 无 | 中 |
| 零残留清理 | ZhjGo: PURGE 白名单 | 无 | 低 |
| Deep Link | CodeDrobe: codedrobe:// | 无 | 低 |

---

## 五、推荐落地方案

### P0: 主题健康度自动修复系统（对标 CodeDrobe 验证 + Clawd 状态感知）

**目标**: 当目标应用更新导致主题失效时，自动检测并修复。

**实现路径**:
1. 新增 `src/main/cdp/injection/theme-auto-repair.ts`
2. 基于现有 `health-monitor.ts` 扩展
3. 截图比对 → 选择器重定位 → CSS 变量重映射
4. 回滚机制: 修复失败恢复原主题

### P1: 权限自动化策略引擎（对标 Clawd 三级模式）

**目标**: 为主题应用和敏感操作提供分级自动化策略。

**实现路径**:
1. 新增 `src/shared/permission/permission-automation-policy.ts`
2. 三级模式: `off` / `auto-tools` / `unattended`
3. per-session grant: 每个 agent 会话独立授权
4. 显式白名单控制哪些操作可自动化

### P2: 伴侣模式 — 轻量状态指示器（对标 Clawd 桌宠，但聚焦换肤状态）

**目标**: 在系统托盘/菜单栏显示当前主题状态，无需打开主窗口。

**实现路径**:
1. 扩展现有 shell store
2. 托盘菜单: 当前主题 / 快速切换 / 最近使用
3. 状态指示: 注入状态 / 漂移检测 / 更新可用

---

## 六、测试计划

- P0 方案: 新增 30+ 测试覆盖自动修复流程
- P1 方案: 新增 20+ 测试覆盖策略引擎
- P2 方案: 新增 10+ 测试覆盖托盘交互

---

## 七、下一步建议

1. **P0 优先**: 实施主题健康度自动修复（直接提升用户体验）
2. **P1 次之**: 权限自动化策略（减少用户确认疲劳）
3. **P2 可选**: 伴侣模式（低频需求，可作为后续迭代）
4. **持续关注**: Clawd 的 HTTP hook 服务器架构（未来可集成为 Agent 状态感知层）
5. **持续关注**: CodeDrobe 的 Skill 化换肤范式（AI 自动创建主题是趋势）
