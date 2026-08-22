# RFC：三页面 CDP 注入职责边界重构（单一注入源 / Per-Agent 信号量 / Response-as-Truth / 幂等恢复 / Launch 契约）

> 状态：`待评审`
> 日期：2026-08-19
> 分支：`（待建）`
> 范围：`src/ui/stores/themeStore.ts`、`src/ui/stores/wallpaperStore.ts`、`src/ui/stores/appsStore.ts`、`src/ui/stores/statusStore.ts`、`src/ui/hooks/apply-result.ts`、`src/main/main-context.ts`、`src/main/ipc/theme-ipc.ts`、`src/main/ipc/wallpaper-ipc.ts`、`src/main/agent-engine-service.ts`、`src/shared/types/ipc.ts`、`src/shared/types/launch.ts`、`src/shared/settings/`（DTO）、`src/preload.ts`
> 上游依据：本会话《AgentSkin 三页面 CDP 注入根因级最优解方案》（方案 B）及其核验结论
> 关联 RFC：`2026-08-16-baseline-restore-architecture.md`（主进程 per-agent 锁的基础）、`2026-08-17-native-mode-inference-silent-switch.md`（注入流程级变更先例）

---

## 1. 背景与目标

### 现状痛点

29 个问题（P0-x / P1-x / I-x 编号，完整清单见会话前文核验报告）经核验**全部属实**，但它们不是 29 个独立缺陷，而是**五个职责域的边界错误**各自引发的连锁症状：

| 根因 | 症状问题（方案编号） |
|------|----------------------|
| R1 注入职责分散 | P0-1（三重注入）、I-2（skipped-concurrent 假成功）、P1-4（竞态） |
| R2 busy 全局单槽 | P0-2（busy key 粒度）、P1-2（50ms spin-wait）、P1-4、I-1（跨页 spinner）、I-4（restoreAll 占满并发槽） |
| R3 状态更新无单一权威 | P1-1（refreshStatus 多调）、P1-3（孤儿操作）、I-3（fan-out 无防抖）、P1-5（无真值源） |
| R4 恢复逻辑无幂等 | P0-3（双重恢复）、P0-4（remove 无 companion 守卫） |
| R5 launch 结果契约不完整 | P0-5（needs-restart 无 UI）、P0-6（preferredPort 未贯穿） |

### 目标（可验证）

1. **单一注入源**：CDP 注入（主题 CSS + 壁纸）只允许发生在主进程 `applyThemeFlow` 及其 background 链；renderer/companion 只发"意图"（apply/remove），不执行任何注入。
2. **Per-Agent 串行、跨 Agent 并行**：renderer 侧 busy 语义改为 `Map<AgentId, Promise>` 信号量；消除 50ms spin-wait、全局并发槽、单值 busy 状态。
3. **Response-as-Truth**：所有操作的**终态**由 IPC response 的 `system` 字段权威返回；`notifyStatusChanged` 50ms 防抖合并 fan-out；删除 renderer 侧全部 `refreshStatus()` 兜底调用。
4. **恢复幂等化**：restore 在无主题/无壁纸时为 no-op；删除/移除流程的恢复责任由主进程单一承担（壁纸偏好除外）。
5. **Launch 契约兑现**：`needs-restart` 状态有 UI 呈现（toast + 强制重启按钮）；`preferredPort` 从设置读入并贯穿 launch 全链路。

### 非目标

- 不新增适配器、不新增 UI 页面（不突破六页/六适配器上限）。
- 不修改 14-token 主题契约、manifest schema、L0-L4 注入分层语义。
- **不改主进程 `applyThemeFlow` 的 CDP 注入语义**（fast/full-init 双链、hardening → wallpaper 顺序、scheme sync、baseline 缓存全部保留）；本 RFC 只收敛"谁调用它"。
- 不实现 AbortSignal 取消（方案 C 范畴）；但信号量结构设计为其预留（§5.2 展望）。
- 不引入操作日志/审计 UI（同上，response.system 结构为其铺路）。

---

## 2. 触发条件（对照 AGENTS.md §6）

- [x] 重构注入架构（L0-L4 注入层）→ 注入职责收敛至主进程单一入口，busy/状态/恢复三域的职责边界重定义
- [ ] 新增 UI 页面（突破六页封顶）→ 不触发
- [ ] 新增适配器（突破六适配器上限）→ 不触发
- [x] 修改核心数据模型 → **settings schema 新增 `preferredPort` 字段**（数据模型变更，但非主题契约/manifest；属设置契约扩展，需同时过 C5 store-contract 校验）

> 裁决说明：本 RFC 重定义注入、并发、状态、恢复四个域的职责边界，属注入架构级重构（AGENTS.md 黄金规则 4 场景：非必要不重构，确需重构时必须 RFC 评审）。评审通过后按 §9 顺序分里程碑合入，每里程碑独立过 `npm run check`。

---

## 3. 现状侦察（代码锚点，已逐条核验）

> 以下行号为 2026-08-19 代码库核验结果。改动前若文件已漂移，以 `git log` 确认。

### 3.1 R1 注入职责分散 —— 三重注入成立

| # | 注入方 | 锚点 | 内容 |
|---|--------|------|------|
| ① | 主进程 background | `theme-apply-flow.ts:534-539`（hardening → `injectAgentWallpaperFromApply` 链） | CDP 壁纸注入（主题捆绑壁纸） |
| ② | renderer store | `themeStore.ts:255-267`（`activateThemeWallpaper` 调用链）→ `wallpaperStore.ts:248-284`：`setWallpaper` + `setAgentWallpaper` + `applyAgentWallpaper`（CDP 注入） | 主题 apply 成功后 renderer **再补一次**壁纸注入 |
| ③ | companion | `wallpaperStore.ts:297-323`（`runWallpaperCompanion`）：`extractThemeFromWallpaper` → `applyToApp` → `applyAgentWallpaper`（**re-apply**，line 314） | 壁纸→主题→壁纸回环中的重复注入 |

关键事实：②③ 全部依赖 renderer 对主进程的信任假设——主进程 `applyThemeFlow` 在 `applyOnResolvedPort`（`theme-apply-flow.ts:502-514`）**已经持久化 per-agent 壁纸设置**并排队 background 注入（534-539）。renderer 侧 ②③ 是对同一目标重复执行 CDP 注入，天然引入竞态（P1-4）与假成功语义（I-2）。

### 3.2 R2 busy 全局单槽 —— 与主进程锁是"两层锁"

renderer `themeStore.ts`：
- `busyKeys: Set<BusyKey>` + `MAX_CONCURRENCY = 6` + 50ms spin-wait + 60s 超时（line 74-84, 445-453）
- busy key 粒度 `apply:${appId}:${themeId}`（line 213）→ **同 agent 换主题可并发进入**，P0-2 成立
- 单值 `busy: BusyKey | null`（line 108, 455-466），Set 迭代序末尾覆盖 → 跨页 spinner 串扰（I-1）：`wallpaperStore.setAndApplyAgentWallpaper` → `runWallpaperCompanion` → `themeStore.applyToApp`（withBusy）→ **壁纸页触发、主题页显示 spinner**
- `restoreAll` 用 `Promise.all` 同时占 6 个槽（line 317-324）→ 期间任何 apply 最多等 60s（I-4）

主进程侧已有成熟 per-agent 锁（**必须复用，不重建**）：
- `agent-engine-service.ts:493, 544-546, 576-578`：`applyingTheme: Set<AgentId>`（lock/unlock）
- `agent-engine-service.ts:745-761`：`inflightOperations: Map<AgentId, {kind, promise, cleanup}>`，同 agent apply 去重、restore 排队在 apply 后（777-786）
- `theme-apply-flow.ts:258-264`：`skipped-concurrent` 带 `system` 快照返回

结论：renderer 信号量只解决"UI 层并发语义"（spinner 正确性、无 spin-wait），**真正的事务性串行由主进程锁保证**。两层职责对齐到 per-agent 后互不冲突。

### 3.3 R3 状态更新无单一权威

- `refreshStatus()` 全应用 7+ 处：themeStore 3 处（228/295/327）+ `useBoot.ts`（94/114）+ `StudioApp.tsx:53` + `WorkspacePage.tsx:92` + `status-bar.tsx:120` —— P1-1 成立
- `notifyStatusChanged()`（`main-context.ts:149-160`）无防抖直接双窗 fan-out；theme-ipc / wallpaper-ipc 每个 handler 完成即调（theme-ipc.ts:64/78/102/128/146/211；wallpaper-ipc.ts:52/95/115/136/155/175/189/256）—— I-3 成立
- `ApplyResponse.system` 字段已存在（`shared/types/ipc.ts:95-105`）且 `applyThemeFlow` 每条返回路径都带 `system: await deps.status()`（theme-apply-flow.ts:261/326/467/481/607）—— **Response-as-Truth 的载体已就绪，只差 renderer 用起来**
- 时序缺口（P1-3/P1-4）：IPC handler 在 `notifyStatusChanged()` 后立即 return result（theme-ipc.ts:62-65），而 apply 的 background 链（hardening/wallpaper/scheme）在 response 返回后仍在跑（`agent-engine-service.ts:748-753` 等 `background.finally` 才 cleanup）→ 第一次推送的 status 不反映终态

### 3.4 R4 恢复逻辑无幂等

- THEME_DELETE：主进程已遍历 `status.apps` 对 `activeThemeId === themeId` 调 `core.restore`（`theme-ipc.ts:189-203`），返回 `themes + status`（212-216）
- renderer `confirmDelete` 又对 affectedApps 调 `api.restoreApp`（`themeStore.ts:417-428`）→ **双重 CDP restore**（P0-3）
- 主进程 delete 不处理壁纸偏好 → renderer 的 `setAgentWallpaper(false)`（424）**必须保留**
- restore 语义：`agent-engine-service.ts:826-833` 注释确认"activeThemeId 为 null 时 restore 跳过"——**主进程 restore 已是部分幂等**（无主题时跳过 CDP），但"无壁纸时"分支行为需确认/补全

### 3.5 R5 launch 结果契约不完整

- `LaunchResult.state` 已含 `'running' | 'launched' | 'needs-restart' | 'failed'`（`shared/types/agent.ts:200-207`）
- `appsStore.launch`（216-248）只处理 `result.ok && result.pid`，**不分支 `needs-restart`** → P0-5 成立
- `launchElectronApp` 请求契约已支持 `preferredPort?`（`appsStore.ts:43-50`、`shared/types/launch.ts:15`），主进程 `electron-launcher.ts` 已实现 `resolvePort` 探针+递增（341-355, 468），**但 renderer `launch()` 调用不传该字段**（appsStore.ts:227-232）→ P0-6 成立
- **前置缺口（核验发现）**：settings 当前**没有** `preferredPort` 配置字段（全库 grep 仅 launch 请求契约与 launcher 实现出现）——"从 settings 读"需要先新增设置项（§5.5）

---

## 4. 目标架构：五域职责边界

```
┌─ renderer（UI 层）──────────────────────────────────────────────┐
│  themeStore.applyToApp ──意图──► applyTheme(themeId, appId)        │
│  wallpaperStore.applyAgentWallpaper ──意图──► applyAgentWallpaper  │
│  (busy 信号量 = Map<AgentId, Promise>，仅管 UI 反馈)                │
│  status = 主进程 response.system（唯一真值，不 refreshStatus）      │
└──────────────┬───────────────────────────────────────────────────┘
               │ IPC
┌──────────────▼───────────────────────────────────────────────────┐
│  主进程（唯一注入源）                                                 │
│  applyThemeFlow: CDP 发现 → 主题注入 → 壁纸注入 → scheme → 状态       │
│  restoreFlow / deleteFlow: CDP 恢复（幂等）                           │
│  notifyStatusChanged: 50ms 防抖合并 fan-out（终态）                   │
│  electron-launcher: launch 状态机（needs-restart 全态返回）            │
└───────────────────────────────────────────────────────────────────┘
```

边界规则（可执行判据）：
1. renderer 任何代码不得出现 `Page.applyStyle / CDP / Runtime.evaluate` 类调用；壁纸注入唯一入口在主进程。
2. 所有 mutation IPC 的 response 必须携带终态 `system`；renderer 状态更新只允许 `setStatus(response.system)`。
3. restore/remove 幂等：无目标即 no-op，调用方无需知道"当前状态"。

---

## 5. 逐文件改动清单

> 实施顺序（依赖序）：**R3 → R2 → R1 → R4 → R5**。R1 依赖 R3/R2 提供"主进程权威状态 + 正确 busy"，故排后。

### 5.1 根因三：状态真值 + 防抖 fan-out（先行，收益立现）

| 文件 | 改动 |
|------|------|
| `src/main/main-context.ts` | `notifyStatusChanged` 加 50ms 防抖窗口（module-level timer），窗口内多次调用合并为 1 次推送；提供 `notifyStatusChangedNow`（显式立即推送，仅用于后台任务终态） |
| `src/main/ipc/theme-ipc.ts` | THEME_APPLY / THEME_RESTORE / THEME_DELETE：**删除 handler 内 `notifyStatusChanged()`**，改为由 response 携带终态（已满足）；终态推送移入 `core.apply/restore` 的 background.finally 之后（见 agent-engine-service 改动） |
| `src/main/ipc/wallpaper-ipc.ts` | WALLPAPER_APPLY_AGENT / WALLPAPER_APPLY_TO_AGENT / WALLPAPER_REMOVE_FROM_AGENT / WALLPAPER_SET_AGENT：同样收敛：偏好类操作保留防抖推送；注入类操作以 response 终态为准 |
| `src/main/agent-engine-service.ts` | apply/restore 的 `background.finally(cleanupResolve)` 后追加 `notifyStatusChangedNow()`（终态推送）；`statusCache` 失效时机不变 |
| `src/ui/stores/themeStore.ts` | 删 `applyToApp:228`、`restoreApp:295`、`restoreAll:327`、`confirmDelete:406` 的 `refreshStatus()` / `setStatus`，统一改为 `setStatus(response.system)`（response 已含终态）；`confirmDelete` 用 delete 返回的 `status` 字段（theme-ipc.ts:214） |
| `src/ui/stores/statusStore.ts` | 保留 `refreshStatus`（启动/手动刷新仍需要），但所有 mutation 路径不再调它 |

**验收**：theme+wallpaper 组合操作 fan-out 从 4 次降至 1 次（I-3 灭）；无任何 mutation 路径依赖"事后拉取"（P1-1/P1-5 灭）；后台任务完成后的推送含终态（P1-3/P1-4 灭）。

### 5.2 根因二：Per-Agent 信号量（替换 withBusy）

| 文件 | 改动 |
|------|------|
| `src/ui/stores/themeStore.ts` | 重写 `withBusy` → `withAgentBusy(appId, fn)`：`Map<AgentId, Promise<void>>` 链式串行；busy key 归一为 `apply:${appId}`（去 themeId，P0-2 灭）；删除 `MAX_CONCURRENCY`、`MAX_BUSY_WAIT_MS`、50ms spin-wait（P1-2 灭）；`busy` 状态改为 `Record<AgentId, BusyKey | null>`（per-agent spinner，I-1 灭）；`restoreAll` 改按 agent 串行入链（I-4 灭） |
| `src/ui/stores/themeStore.ts` | `BusyKey` 类型收敛（不再需要 `apply:${appId}:${themeId}` 复合粒度）；UI 选择器更新（组件内 `busy === 'apply:' + appId` 判定改 per-agent 读取） |
| `src/ui/components/`（ThemesPage / 相关磁贴） | spinner 读取改 per-agent busy；删对全局 `busy` 的依赖 |

设计要点（为方案 C 铺路）：
- 信号量内部 `enqueue(appId, fn)` 返回 promise；AbortSignal 可注入（`fn(signal)`），取消 = 拒绝当前排队项，主进程侧以 epoch 翻转兜底（现有机制，无需改动）。
- **不与主进程锁冲突**：主进程 `inflightOperations` 仍做事务级 dedup/排队；renderer 信号量只保证 UI 层"同一 agent 一次一个 spinner"。

**验收**：6 agent 并行 apply 无丢操作、无 spin-wait CPU 空转；壁纸页触发 apply 时主题页不再显示 spinner（I-1 灭）；`busy` 永不为"另一个页面"的服务（I-4 灭）。

### 5.3 根因一：单一注入源

| 文件 | 改动 |
|------|------|
| `src/ui/stores/themeStore.ts` | 删 success 分支的 `activateThemeWallpaper` 调用（255-267）；主题自带壁纸的注入完全由主进程 background 链完成（theme-apply-flow.ts:534-539 已实现）→ P0-1 #2 灭 |
| `src/ui/stores/wallpaperStore.ts` | `runWallpaperCompanion` 删除 re-apply 步骤（314）→ P0-1 #3 灭；`activateThemeWallpaper` 保留"全局壁纸偏好 setWallpaper + per-agent 偏好"（无 CDP 副作用的纯偏好写入，供 AgentSkin 自身背景与重启恢复），**删除 `applyAgentWallpaper` 注入调用**（261） |
| `src/ui/stores/themeStore.ts` | `applyToApp` 对 `skipped-concurrent` 的处理改为：直接 `setStatus(result.system)` 并返回主进程语义（不再补任何操作）→ I-2 灭 |

**行为差异标注（评审关注点）**：删除 renderer 注入后，"主题自带壁纸"的注入时点从"response 返回后立即"变为"主进程 background 完成时"。两者视觉上均为秒级，但**失败可见性**变化：壁纸注入失败目前由 renderer 显式 fail（wallpaperStore.ts:264-268），改为由主进程 background 失败日志承载（agent-engine-service.ts:748-753 已记录）。如评审要求保留用户可见失败提示，可在主进程 background.finally 追加 `sendLog` + 终态推送（终态已含壁纸状态，renderer 可据此 toast）。

**验收**：全仓 grep 确认 renderer 无任何 CDP 注入调用；主题+壁纸组合操作主进程仅注入一次（P0-1 灭）；`skipped-concurrent` 与真实 apply 返回同一语义（I-2 灭）。

### 5.4 根因四：幂等恢复 + 操作仲裁

| 文件 | 改动 |
|------|------|
| `src/ui/stores/themeStore.ts` | `confirmDelete` 删 `api.restoreApp` 循环（417-422），**保留** `setAgentWallpaper(false)`（424-427，主进程 delete 不处理壁纸偏好）→ P0-3 灭 |
| `src/main/agent-engine-service.ts`（restore flow） | restore 幂等化：activeThemeId 为 null **且** 无壁纸偏好时直接返回当前 status（no-op），不报错、不触 CDP → 任何重复调用安全（P0-3 灭的纵深） |
| 壁纸移除入口（`wallpaperStore.ts` 或 UI 调用点，WALLPAPER_REMOVE_FROM_AGENT 的 renderer 侧） | handler 开头检查 `companionBusyByAgent.has(appId)`：运行中 → toast「壁纸同步中」并拒绝 → P0-4 灭（注：companion 守卫在 renderer 进程，主进程侧无法感知；检查点必须放在 renderer 调用入口） |

**验收**：删除应用中的主题不产生第二次 CDP restore（抓包/日志确认）；连续两次 delete/restore 无副作用报错；移除壁纸时若 companion 运行中则被拒绝。

### 5.5 根因五：launch 状态机 + 端口全链路

| 文件 | 改动 |
|------|------|
| settings schema + DTO（`src/shared/settings/` 与相关 IPC） | 新增 `preferredPort?: Record<AgentId, number | null>`（或单值全局端口，评审定夺）；过 C5 store-contract 校验 |
| 设置 UI（六页内，建议 dashboard 应用磁贴或 settings 现有分区） | 端口配置入口（可选：仅高级设置内文字输入 + 校验 1-65535） |
| `src/ui/stores/appsStore.ts` | `launch()` 读 settings 传 `preferredPort`（227-232 补字段）；结果分支：`state === 'needs-restart'` → toast + 触发重启对话框（调 `launch` with `forceRestart: true`）→ P0-5 灭 |
| `src/shared/types/launch.ts` | 无改动（契约已完备） |
| `src/preload.ts` | 无改动（`launchElectronApp` 已透传） |

**验收**：设置端口后启动的应用以该端口（或递增候选）监听（P0-6 灭）；应用需重启时 UI 呈现 toast + 可一键强制重启（P0-5 灭）。

---

## 6. 不变量影响分析（AGENTS.md C1-C9）

| 不变量 | 影响 | 说明 |
|--------|------|------|
| C1 AgentId 四源一致 | 无 | 不新增 AgentId 来源 |
| C2 14-token 主题契约 | 无 | 不改主题管线 |
| C3 Palette-CSS 同步 | 无 | 不改生成器 |
| C4 分层依赖方向 | **受控** | renderer 删除注入调用后依赖方向更纯净；无新增反向依赖 |
| C5 Store 契约一致性 | **受影响** | settings 新增 `preferredPort` 字段 → 需同步 `check-store-contracts` 覆盖 |
| C6 设计 token 合规 | 无 | 新增 UI（若有）遵循现有 token |
| C7 SPDX 头部 | 无 | 新文件/改动文件保持头部 |
| C8 原生缺陷修正一致性 | 无 | 不涉及 engine 缺陷层 |
| C9 缺陷规范文档新鲜度 | 无 | 同上 |

> 若评审通过后实施，需同步：settings schema 变更 → 检查 `scripts/` 下相关契约脚本（store-contracts）与 `docs/` 设置文档。

---

## 7. 测试计划

1. **单元测试（必改）**：`themeStore.test.ts`（busy 语义、删 refreshStatus、companion 行为）、`wallpaperStore.test.ts`（companion 去 re-apply、remove 守卫）、`appsStore.test.ts`（needs-restart 分支、preferredPort 透传）、`main-context` 防抖（新增 timer 测试）、`theme-ipc.test.ts` / `wallpaper-ipc.test.ts`（推送收敛）。
2. **集成/契约**：`npm run check` 全绿（含 C5）；新增 settings 字段的 contract 测试。
3. **手工验收矩阵**（评审后执行）：
   - 双主题快速切换（同 agent）→ 无并发守卫误伤、spinner 正确
   - 6 agent 全量 apply / restoreAll → 无 60s 等待、无跨页 spinner
   - 删除应用中的主题 → 日志确认单次 restore；壁纸同步中移除 → 被拒绝
   - 设置端口启动 → 端口命中；未运行应用 apply → needs-restart 对话框 + 强制重启
   - 主题+壁纸组合 → fan-out 1 次、终态一致

---

## 8. 风险与回滚

| 风险 | 等级 | 缓解 |
|------|------|------|
| 删 renderer 注入后壁纸注入失败不再有用户可见 toast | 🟠 | 评审定夺：主进程 background.finally 发送终态，renderer 按终态壁纸字段 toast（增量改动，可后置） |
| notifyStatusChanged 防抖引入窗口期（≤50ms 内状态短暂滞后） | 🟡 | 窗口极小；终态推送用 `notifyStatusChangedNow` 不受防抖约束 |
| settings schema 变更波及 DTO/UI | 🟡 | 端口字段独立成节；不触发旧配置迁移（可选字段，缺省 null） |
| 主进程锁与 renderer 信号量语义重叠导致双重排队 | 🟡 | 已核验：主进程锁（事务）+ renderer 信号量（UI 反馈）职责不同；实施时以 R2 先行并单测锁定 |

**回滚**：5 个根因各为一独立提交，按 §9 里程碑推进；任一里程碑 `npm run check` 失败即停，可 revert 单提交（R1 的 renderer 侧删除是可逆的，恢复调用即可）。

---

## 9. 实施顺序与里程碑

| 里程碑 | 内容 | 依赖 | 验收 |
|--------|------|------|------|
| M1（R3） | 状态真值 + 防抖 | 无 | fan-out 4→1；mutation 路径无 refreshStatus |
| M2（R2） | Per-Agent 信号量 | M1（busy 语义依赖终态） | 无 spin-wait；per-agent spinner；restoreAll 不占全局槽 |
| M3（R1） | 单一注入源 | M2（正确并发语义）+ M1（权威状态） | renderer 零注入调用；三重注入收敛 |
| M4（R4） | 幂等恢复 + 仲裁 | M3（恢复责任已归主进程） | 单次 restore；remove 守卫生效 |
| M5（R5） | launch 契约 + 端口 | 无（可与 M1 并行） | needs-restart UI；preferredPort 命中 |

建议：M1/M2/M3 串行（依赖链），M5 可与 M1 并行；每个里程碑独立提交 + `npm run check`。

---

## 10. 实施修正记录（2026-08-19，评审通过后落地时修订）

| 原方案 | 实施修正 | 依据 |
|--------|----------|------|
| R3 需"background 完成后终态推送（notifyStatusChangedNow）" | **不实现终态推送**：`SystemStatus.apps` 不含壁纸字段（`shared/types/ipc.ts:39-53` 仅 activeThemeId/running/debugReady/port），background（hardening/壁纸注入/scheme sync）完成后 status 无增量 → 终态推送无价值。M1 = 50ms 防抖 + renderer 改用 `response.system` + 保留事件驱动链（useBoot onStatusChanged） | 核验 AppStatus 结构 |
| R5 需"settings schema 新增 preferredPort 字段" | **无需新增**：`DesktopSettings.apps: Record<AgentId, AppOverride>` 已有 `port` 字段（`shared/types/wallpaper.ts:145-150`），`settings-service.ts:342 setAppPort` + `settings-ipc.ts:91` 已完整暴露，设置 UI 已有 `saveAppPort`。P0-6 = appsStore.launch 读 `settings.apps[appId].port` 透传 `preferredPort` 即可 | 核验 settings 契约 |
| R4 "主进程 restore 幂等" | 落在 `agent-engine-service.restoreInternal`（`!activeThemeId && !wallpaperEnabled` → early-return status，免 CDP 往返）；主进程 restore flow 已有清壁纸偏好（theme-restore-flow.ts:175 无端口路径），有端口路径只 CDP 移除不清偏好 → renderer 的 `setAgentWallpaper(false)` 保留（非重复） | 核验 theme-restore-flow |
| M1 实施修正 | notifyStatusChangedNow 仍导出（供未来真正需要立即推送的场景），当前无调用方 | — |
| 附带修复（C6 传感器） | `check-design-tokens.mjs` 全部 8 个 exec 循环存在 `while (…) { if (白名单) continue; …; m = re.exec(line); }` 死循环——`continue` 跳过正则推进，任何含 `p-2` 等允许类的行都挂死整个 `npm run check`（该脚本从未成功跑完过）。已统一改为"先取 next 再处理"模式 | 复现：单跑脚本 30s 超时；修复后秒级完成 |

实施状态：M1-M5 全部落地，相关单测全绿；**`npm run check` 首次全绿**（2026-08-20）。C6 按评审裁决完成校准（脚本规则对齐项目实际视觉规范：6px rounded 体系 + 文档 §3.3/§7.2 字阶与间距 + w/h 布局尺寸豁免；修 var() fallback 检测与 rounded-[Npx] 索引 bug），代码清理 11 处偏离阶梯值，656 存量 violation → 0。遗留：AGENTS.md 黄金规则 6"禁 10/12/14px 间距"与校准后 C6（允许 12/14px，design-tokens.md §7.2 认可）冲突，文字待同步。

## 11. 开放问题（评审要点）

1. **P0-6 端口配置形态**：全局单端口 vs per-agent 端口？UI 入口放 dashboard 磁贴还是 settings 分区？（默认建议：settings 新增"启动端口（可选）"单值，per-agent 覆盖留待后续）
2. **壁纸注入失败的用户可见性**（§5.3 行为差异标注）：接受主进程日志承载，还是补终态 toast？
3. **29 问题完整编号与本文映射**：本 RFC 映射了方案 B 明确引用的 15 个编号；其余 14 个请评审时对照原核验报告确认均已落入 5 根因（若有未覆盖，补入对应根因）。
4. **`restoreAll` 的 UI busy**：恢复"一键恢复所有"的全局进度条是否保留（信号量 per-agent 后，全局进度需显式聚合）？
5. **C6 存量违规（实施暴露）**：`check-design-tokens.mjs` 死循环修复后首次真正运行，656 个存量 violation 浮现（含 `rounded-md` 与项目 6px 圆润规范的规则冲突）。需裁决：校准 C6 规则到当前视觉规范（推荐：rounded 体系允许 6px 基准 + w/h 布局常量豁免），还是按 656 处逐一整改？
