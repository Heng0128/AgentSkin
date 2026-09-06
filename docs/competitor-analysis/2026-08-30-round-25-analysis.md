# 第 25 轮竞品深度分析报告 — 热抽取运行时 / 工作流引擎 / Rust 验证 / 进程发现 / 调色板转换

> 报告日期: 2026-08-30 08:00
> 分析项目: 5 个（覆盖 热抽取运行时 / 工作流引擎 / Rust 形式验证 / 进程发现 / 调色板转换）
> 重点适配目标: traework, qoderwork, workbuddy, doubao, codex, zcode

---

## 一、概览

| # | 项目 | Stars | 语言 | 创建 | 最后 push | 活跃度 | 与我们关系 |
|---|------|-------|------|------|-----------|--------|-----------|
| 1 | [jiarong0423/dream-skin-forge](https://github.com/jiarong0423/dream-skin-forge) | 1 | JavaScript | 2026-07-25 | 2026-07-25 | 停滞 | **热抽取运行时** + module matrix + fail-closed 验证 |
| 2 | [jiarong0423/codex-dream-skin-workflow-engine](https://github.com/jiarong0423/codex-dream-skin-workflow-engine) | 7 | JavaScript | 2026-07-19 | 2026-07-20 | 停滞 | **工作流引擎**（OpenAI Build Week 2026 Entry）|
| 3 | [ozrwayne/WorkBuddy-Skins](https://github.com/ozrwayne/WorkBuddy-Skins) | 0 | Rust | 2026-07-20 | 2026-07-20 | 停滞 | **WorkBuddy 专用**，.wbtheme 签名 + Rust 形式验证 |
| 4 | [z0rgoyok/codex-theme-controller](https://github.com/z0rgoyok/codex-theme-controller) | 4 | Swift | 2026-02-06 | 2026-02-08 | 停滞 | **进程发现** + 批量应用 + 托盘常驻 |
| 5 | [lafllamme/codex-themes](https://github.com/lafllamme/codex-themes) | 6 | TypeScript | 2026-03-28 | 2026-04-15 | 停滞 | **调色板转换**，.itermcolors → Codex JSON |

---

## 二、各项目技术亮点深度剖析

### 2.1 jiarong0423/dream-skin-forge — Module Matrix 模式（最值得借鉴）

**项目定位**: macOS Codex 桌面端的内部主题热抽换 runtime，重点是可验证、可切换、可回滚的主题包管理。

**核心架构 — 三层分离**:

```
theme-packs/          ← scratch/pack space（主题包草稿空间）
macos/assets/         ← runtime engine（运行时引擎）
user-local support    ← active state（活跃状态）
```

**关键创新 — `module-matrix.mjs`**:

1. **模块所有权（Module Ownership）**: 每个运行时模块声明归属引擎和 payload 预算
2. **Payload Budget**: 每个模块有明确的资源预算限制（frame count / alpha / SVG / payload size）
3. **Fail-Closed 验证**: 验证失败时模块不启用（而非降级运行）
4. **Runtime 修复矩阵**: 记录已知问题（hot-swap selector 消失 / cache 失效 / sidebar 变形 / titlebar 接缝）和修复方案

**与 AgentSkin 对比**:

| 维度 | dream-skin-forge | AgentSkin |
|------|-----------------|-----------|
| 模块所有权 | `module-matrix.mjs` 显式声明 | orchestrator.ts 层所有权（已存在）|
| 验证策略 | fail-closed（失败不启用）| InjectionLock + Queue |
| 修复机制 | 已知问题→修复的矩阵表 | health-monitor.ts 持续检测 |
| 主题包分离 | pack space / engine / active state 三层 | source / bundle 两层 |

**可借鉴点**: Module Matrix 的"payload budget + 显式所有权 + fail-closed"模式可增强 AgentSkin 的 orchestrator 层。

---

### 2.2 jiarong0423/codex-dream-skin-workflow-engine — Workflow Gate 范式

**项目定位**: OpenAI Build Week 2026 Entry，把"视觉需求 → 主题规格 → 素材管线 → 模块套用 → 验证 → 还原"整条链路封装成可测试的工作流。

**核心架构 — 五层挂载模型**:

| 平面 | 挂载规则 | 示例 |
|------|----------|------|
| 场景底层 | 只画在 document body，不建立全页遮罩 | 背景图与色彩层 |
| 原生 surface | 标记并就地处理真正节点，不重建尺寸 | Sidebar / composer / 对话泡泡 |
| 独立装饰 | 挂在 body 的 pointer-safe 元件，必须有 safe area | 机甲角色与 badge |
| 动态 portal | 交互后辨识可见外壳，关闭后清理 | Dialog / menu / listbox |
| 手动互动 | Idle 只保留 trigger，点击后才建立播放状态 | 翻桌猫动画 |

**关键创新 — Workflow Gate**:

```bash
# 运行时检查
bash .agents/skills/codex-dream-skin-workflow/scripts/workflow-gate.sh --runtime
# 提交前严格模式
bash .agents/skills/codex-dream-skin-workflow/scripts/workflow-gate.sh --submission
```

Gate 会检查：视频 / repository / README / feedback session ID / judge path 是否完整，任何一项未完成则阻断。

**碰撞退让机制（Character Retreat）**: 大型机甲猫角色在文字或右侧 panel 侵入时自动退让，不遮盖工作内容。

**与 AgentSkin 对比**:

| 维度 | workflow-engine | AgentSkin |
|------|-----------------|-----------|
| 注入分层 | 5 层挂载模型 | 4 引擎分层（已存在）|
| 验证流程 | workflow-gate.sh 统一 gate | check-injection-orchestration |
| 退让机制 | 碰撞检测 + 自动退让 | DeepCore Shadow DOM 隔离 |
| 状态持久化 | ~/Library/Application Support/ | Zustand + IPC |

**可借鉴点**: Workflow Gate 的"提交前阻断"模式可强化 AgentSkin 的注入前验证流程。

---

### 2.3 ozrwayne/WorkBuddy-Skins — Rust 形式验证 + 签名主题包

**项目定位**: Rust 重写的 WorkBuddy 主题管理器，核心安全特性是 `.wbtheme` 签名格式和 ZIP 白名单校验。

**架构 — 多 crate 分离**:

```
crates/
├── injector-core     # CDP 注入核心
├── manager-core      # 主题管理
├── platform-core     # 平台抽象（macOS / Windows）
├── theme-core        # 主题验证
└── workbuddy-skins-cli  # CLI 工具
```

**关键安全设计**:

1. **`.wbtheme` 签名格式**: 主题包包含数字签名，应用前验证
2. **ZIP 白名单**: 只允许 JSON / 图片 / 元数据 / 许可证 / 签名 — 禁止可执行代码
3. **公私钥体系**: `dist/` 目录存放公钥和签名主题包
4. **来源迁移**: 4 套内置主题从 Roland Wong 的 Codex Skins 迁移（玫瑰回路 / UQ Campus / UniMelb Old Quad / Harvard Widener）

**与 AgentSkin 对比**:

| 维度 | WorkBuddy-Skins | AgentSkin |
|------|-----------------|-----------|
| 主题格式安全 | 签名 + 白名单校验 | 14-token manifest 验证 |
| 实现语言 | Rust（形式验证友好）| TypeScript / Electron |
| 主题来源 | Codex Skins 迁移 | 自建 15 套 + 导入 |

**可借鉴点**: `.wbtheme` 签名 + ZIP 白名单的安全模式可增强 AgentSkin 主题导入的安全性。**注意**: 仅借鉴安全验证思想，不增加 WorkBuddy 适配器（已有）。

---

### 2.4 z0rgoyok/codex-theme-controller — 进程发现 + 批量应用

**项目定位**: 原生 macOS SwiftUI 应用，自动发现运行中的 Codex 实例并批量应用主题。

**核心创新**:

1. **进程发现**: 自动扫描运行中的 Codex 进程（PID / command / --remote-debugging-port）
2. **托盘常驻**: MenuBar icon + 独立控制器窗口
3. **批量应用**: "Apply to All" 一键应用到所有可注入实例
4. **启动时应用**: 新启动的 Codex 实例自动应用当前选中主题
5. **持久化**: 最后选中的主题在下次启动时恢复

**5 套内置主题**: Darcula / Dracula / Nord / Monokai / Teal

**与 AgentSkin 对比**:

| 维度 | codex-theme-controller | AgentSkin |
|------|----------------------|-----------|
| 进程发现 | 自动扫描 PID + debug port | 手动配置端口 |
| 批量操作 | Apply to All | 逐 agent 应用 |
| 托盘常驻 | MenuBar icon | InjectDock |
| 技术栈 | SwiftUI 原生 | Electron |

**可借鉴点**: 进程发现模式可增强 AgentSkin 的 agent 自动发现能力。批量 Apply to All 的 UX 值得参考。

---

### 2.5 lafllamme/codex-themes — 调色板生态复用

**项目定位**: 独立的 TypeScript 工具包，把 `.itermcolors` 等终端调色板转换为 Codex 兼容的 JSON 预设。

**核心设计**:

1. **基于 mbadolato/iTerm2-Color-Schemes**: 复用已有 200+ 终端调色板生态
2. **管线流程**: convert → rescore → test → generate
3. **独立运行**: 不依赖 Codex 运行时，纯离线转换

**与 AgentSkin 对比**:

| 维度 | codex-themes | AgentSkin |
|------|-------------|-----------|
| 调色板来源 | iTerm2-Color-Schemes 200+ | 自建 15 套 + 用户导入 |
| 转换目标 | Codex JSON 预设 | 14-token .agentskin-theme |
| 独立性 | 纯离线工具 | 运行时引擎 |

**可借鉴点**: 复用已有调色板生态的思路。AgentSkin 可考虑支持从 iTerm2 / Terminal.app / Windows Terminal 等主流终端调色板导入。

---

## 三、重大发现与战略信号

### 3.1 Module Matrix 模式的普遍性

dream-skin-forge 和 workflow-engine 出自同一作者（jiarong0423），两个项目都强调"模块所有权 + payload budget + fail-closed 验证"。这说明**模块矩阵**已成为复杂主题 runtime 的共识模式。

AgentSkin 的 `src/shared/injection/orchestrator.ts` 已有类似概念（Layer Ownership / Token Ownership），但缺少显式的 payload budget 和 fail-closed 验证机制。

### 3.2 Workflow Gate 的"阻断"哲学

workflow-engine 的 gate 哲学是"任何一项未完成则阻断提交"，这是一种**严格的前置验证**模式。AgentSkin 当前有 11 个不变量检查脚本，但缺少统一的"注入前 gate"——所有检查通过后才允许注入操作。

### 3.3 Rust 重写趋势的信号

WorkBuddy-Skins 选择 Rust 实现核心逻辑，理由：
1. 形式验证友好（主题安全性可证明）
2. 跨平台二进制分发（无运行时依赖）
3. 内存安全保证

这说明赛道开始关注**主题安全性**（而非仅功能），AgentSkin 的 TypeScript 栈虽无法完全对齐，但可在主题导入环节增加签名校验。

---

## 四、借鉴可行性评估与优先级

| # | 借鉴项 | 来源 | 可行性 | 优先级 | 适配目标 |
|---|--------|------|--------|--------|---------|
| 1 | Module Matrix 增强（payload budget + fail-closed） | dream-skin-forge | 高 | **P0** | 全 6 个应用 |
| 2 | 注入前 Workflow Gate | workflow-engine | 高 | **P0** | 全 6 个应用 |
| 3 | 主题包签名 + ZIP 白名单 | WorkBuddy-Skins | 中 | **P1** | 主题导入安全 |
| 4 | 进程发现自动扫描 | codex-theme-controller | 中 | **P1** | agent 自动发现 |
| 5 | 批量 Apply to All UX | codex-theme-controller | 高 | **P1** | 多 agent 操作 |
| 6 | 终端调色板导入 | codex-themes | 中 | **P2** | 主题生态扩展 |

---

## 五、与 AgentSkin 现有架构的映射

### 5.1 Module Matrix → orchestrator.ts 增强

**现状**: `src/shared/injection/orchestrator.ts` 已有 Layer Ownership 和 Token Ownership。

**差距**: 
- 缺少 per-module payload budget（每个模块的资源预算）
- 缺少 fail-closed 验证策略（当前是 best-effort + 回滚）

**方案**: 在 orchestrator 中新增 `ModuleBudget` 概念：
- 每个注入层声明 payload 预算上限
- 超出预算时 fail-closed（不注入）而非降级

### 5.2 Workflow Gate → 注入前验证

**现状**: 11 个独立 check 脚本，无统一 gate。

**差距**: 无"所有检查通过后才允许注入"的阻断机制。

**方案**: 新增 `injection-gate.ts`：
- 聚合所有前置条件（CDP 连接 / 目标状态 / 主题完整性）
- 全部通过后才解锁注入操作

### 5.3 主题包签名 → 导入安全增强

**现状**: `src/shared/import/theme-source-parser.ts` 支持多种来源格式。

**差距**: 无签名校验，恶意主题包可能包含危险 CSS/JS。

**方案**: 在 theme-source-parser 中增加签名验证和白名单过滤。

### 5.4 进程发现 → agent 自动发现

**现状**: agent 通过配置端口连接。

**差距**: 不支持自动发现运行中的 agent 实例。

**方案**: 新增 process scanner 模块，扫描 CDP debug port。

### 5.5 批量 Apply to All → 多 agent 操作

**现状**: 逐 agent 应用主题。

**差距**: 无批量操作 UX。

**方案**: 在 Dashboard 增加"应用到全部"按钮。

---

## 六、下一步行动建议

### P0（本轮实施）
1. **Module Budget 增强** — orchestrator.ts 增加 payload budget + fail-closed 验证
2. **Injection Gate** — 统一注入前验证 gate

### P1（后续轮次）
3. **主题包签名校验** — theme-source-parser 增强
4. **进程发现 scanner** — agent 自动发现模块
5. **批量 Apply to All** — Dashboard 多 agent 操作 UX

### P2（长期方向）
6. **终端调色板导入** — iTerm2 / Terminal.app → 14-token 转换
7. **碰撞退让机制** — 大型装饰元素与内容重叠时的自动退让

---

> 分析完成时间: 2026-08-30 ~08:30
> 下一步: 使用多子智能体并行实施 P0-1 和 P0-2
