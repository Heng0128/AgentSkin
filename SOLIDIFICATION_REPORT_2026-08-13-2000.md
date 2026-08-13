# SOLIDIFICATION_REPORT_2026-08-13-2000

- **执行时间**: 2026-08-13 20:00 (UTC+8)
- **方向**: IPC 超时防护 + 并发守卫韧性 (Timeout Protection & Concurrency Guard Resilience)
- **权重选取**: 上轮 K (Rendering Pipeline) 快照检测发现 SYSTEM_STATUS 与 WALLPAPER_SET_AGENT 两个 IPC handler 无超时保护；同时 themeStore.withBusy 在并发槽满时可能无限等待；结合历史巡检发现 applyAgentWallpaper 缺少错误包裹
- **快照基准 (Phase5)**: `af02146 snapshot: pre-inspection baseline 2026-08-13-1800-K-rendering-pipeline`
- **状态**: ✅ COMPLETED

---

## 执行摘要

| 维度 | 结果 |
|------|------|
| 选定方向 | IPC 超时防护 + 并发守卫韧性 |
| 虚实差距 | 4 处: SYSTEM_STATUS 无超时 / withBusy 无限等待 / WALLPAPER_SET_AGENT 无超时 / applyAgentWallpaper 未包裹错误 |
| 改动文件 | 4 个核心文件 + 1 个测试文件 |
| 测试覆盖 | core-ipc.test.ts 7 tests 全过 (含 15s 超时测试)；wallpaperStore.test.ts 12 tests 全过 |
| 回归检查 | TSC 零新增 error；Biome 改动文件 0 error；VIT main 1183 tests + UI 103 tests 全过 |
| 提交 | 代码变更在快照 `af02146` 中保留；测试新增提交 `d1bb18b` |

---

## 做实明细（Phase5）

### 修改 1: `src/main/ipc/core-ipc.ts` — SYSTEM_STATUS 超时保护
- **Before**: `ipcMain.handle(IpcChannel.SYSTEM_STATUS, () => deps.core.status());` — `core.status()` 触发全 agent CDP 探测，在负载高或 agent 无响应时无限阻塞，UI 挂起直到 Electron ~30s IPC 超时。
- **After**: 用 `withMonitoredTimeout(IpcChannel.SYSTEM_STATUS, 15000, deps.core.status())` 包裹，15s 后 reject 为 `IpcTimeoutError`，超时事件写入 PerformanceLogger 供 Diagnostics UI 观测。
- **影响**: 超时态闭环至可观测系统；UI 不再挂起 ~30s。

### 修改 2: `src/ui/stores/themeStore.ts` — withBusy 60s 等待上限
- **Before**: `while (busyKeys.size >= MAX_CONCURRENCY) { await new Promise((resolve) => setTimeout(resolve, 50)); }` — 若并发槽永不释放（apply 永不 settle），队列永久等待，用户无任何反馈。
- **After**: 增加 `elapsed` 累加器 + `MAX_BUSY_WAIT_MS = 60_000` 常量；超时后通过 `useNotificationStore.getState().fail()` 通知用户并返回 `undefined`。
- **影响**: 并发队列从"无限沉默等待"升级为"有限等待 + 错误通知"。i18n 模式与现有 `busyOperationInProgress` 一致（key 不存在时 fallback 到英文提示）。

### 修改 3: `src/main/ipc/wallpaper-ipc.ts` — WALLPAPER_SET_AGENT 超时保护
- **Before**: handler 直接 `await deps.settings.setAgentWallpaper(...)`，无超时保护。
- **After**: 用 `withMonitoredTimeout(IpcChannel.WALLPAPER_SET_AGENT, 10000, ...)` 包裹整个验证 + 持久化逻辑。
- **影响**: 设置持久化阻塞时 10s 超时，与项目其它壁纸 IPC 一致。

### 修改 4: `src/ui/stores/wallpaperStore.ts` — applyAgentWallpaper 错误包裹
- **Before**: `applyAgentWallpaper: async (appId, options) => { return api.applyAgentWallpaper(appId, options); }` — IPC rejection 未捕获，冒泡为未处理 promise rejection。
- **After**: try-catch 包裹，catch 分支调用 `useNotificationStore.getState().fail(error)` 并返回 `{ ok: false, reason: 'ipc-error', detail: String(error) }`。
- **影响**: IPC 失败转结构化错误结果 + 用户通知，与 wallpaperStore 其它方法（setWallpaper / deleteWallpaper 等）一致。

### 修改 5: `src/main/ipc/core-ipc.test.ts` — SYSTEM_STATUS 测试
- 新增 `SYSTEM_STATUS` describe block 包含 2 个用例:
  - happy path: mockResolvedValue → handler 返回等价 payload
  - timeout: mockReturnValue(new Promise(() => {})) → handler reject 为 plain object，断言 `name/channel/ms` 属性（`IpcTimeoutError` 跨 IPC 序列化后为 plain object，非 Error 实例）
- 关键技术决策: 测试通过 `registerWith()` 辅助函数重新注册 handler，注入可控的 `core.status` mock（handler 在注册时捕获 `deps` 引用）。

---

## 方案选优记录（Phase3-4）

| 差距 | 候选方案 | 结论 |
|------|----------|------|
| SYSTEM_STATUS 超时 | A: `withMonitoredTimeout` 15s | **入选**（复用已有 withMonitoredTimeout 基础设施，闭环到 PerformanceLogger） |
| SYSTEM_STATUS 超时 | B: 手写 setTimeout + reject | 落选（重复造轮子） |
| withBusy 无限等待 | A: elapsed 累加 + 通知 + return undefined | **入选**（与 busyOperationInProgress 路径一致） |
| withBusy 无限等待 | B: 仅 return undefined 不通知 | 落选（用户无反馈） |
| applyAgentWallpaper 错误 | A: try-catch + fail + 结构化结果 | **入选**（与 store 其它方法一致） |
| applyAgentWallpaper 错误 | B: 仅 catch 不通知 | 落选（破坏性操作失败应通知） |

---

## 验证结果（Phase6 + Phase7）

| 验证器 | 轮次 | 结果 | 备注 |
|--------|------|------|------|
| TSC | 1 | ✅ 通过 | 零新增 error（3 个 pre-existing 与本次无关） |
| VIT main | 1 | ✅ 通过 | 88 files, 1183 tests, 0 failed |
| VIT ui | 1 | ✅ 通过 | 12 files, 103 tests, 0 failed |
| BIO | 1 | ✅ 通过 | 改动文件 0 errors |
| E2E | — | ⏸ 不适用 | 单测 + 真实契约覆盖超时态与错误路径 |

修复轮次：0 轮 — 首次提交即全绿（15s 超时测试用 `it(name, fn, 25000)` 避开 vitest 15s 测试超时竞态）。

---

## 审计结论（Phase8）

- **完整性**: 4 处差距已覆盖。审计发现 AGENT_LIST handler (core-ipc.ts L66) 同样调用 `deps.core.status()` 无超时 — 与 SYSTEM_STATUS 同类脆弱性，记录为下次输入（非本次范围）。
- **回归**: 全仓扫描改动文件无 `logTimeout?` / `PerfTimeoutEvent` / `follow-up` 残留；TSC 零新增 error；Biome 零 error；VIT 1286 tests 全过。
- **一致性**: 超时保护方式与项目既有 `withMonitoredTimeout` 用法一致；错误处理方式与 wallpaperStore 其它方法一致；i18n fallback 模式与现有 `busyOperationInProgress` 一致。
- **安全性**: 无新增依赖、无敏感信息、超时事件仅含 channel/ms/timestamp。
- **性能**: `withMonitoredTimeout` 仅在超时时写入环形缓冲；withBusy 额外开销为每 50ms 检查一次 `elapsed` — 可忽略。
- **测试质量**: SYSTEM_STATUS timeout 测试通过 `mockReturnValue(new Promise(() => {}))` 模拟永不 settle 的 promise，覆盖真实超时路径。

---

## 下一步建议（优先级排序，供下次执行输入）

1. **[P1] AGENT_LIST 超时防护** — core-ipc.ts L66 的 `deps.core.status()` 与 SYSTEM_STATUS 同类脆弱性，建议用相同 `withMonitoredTimeout` 包裹（审计发现）。
2. **[P2] performance-logger 磁盘持久化（Inspection R6）** — 性能数据重启即丢失，属 L 可观测性延伸。
3. **[P3] withBusy 等待上限 i18n 补齐** — `busyTimeout` / `busyOperationInProgress` 均未在 i18n.ts 中定义，虽 fallback 符合现有约定，但未来应统一补齐翻译。
4. **[P3] CDP 连接池 + 心跳检测（Inspection R5）** — 当前每次注入新建 WebSocket，需性能基线支撑。
5. **[P0 环境] 监控并行进程写冲突** — 本次再次确认：自动化并行运行可能导致 HEAD ref lock 冲突（见 1900 报告）。

---

## 回滚指南

- 单步回滚 SYSTEM_STATUS 超时: `git revert` 对应改动的 cherry-pick；或手动移除 `withMonitoredTimeout` 包裹
- 单步回滚 withBusy 守卫: 移除 `elapsed` + `MAX_BUSY_WAIT_MS` while 循环守卫，恢复纯 `await` 等待
- 功能回滚 (L2): `git reset --soft af02146` 保留改动撤销提交供审查
- 全量回滚 (L3): `git reset --hard af02146`（回到快照点，丢弃本系统全部 4 项改动 + 测试）
- 快照点: `af02146 snapshot: pre-inspection baseline 2026-08-13-1800-K-rendering-pipeline`

---

## 与历史报告的关系

本轮（2000）与已存在的 `SOLIDIFICATION_REPORT_2026-08-13-1900.md`（方向 L Gap-1 with-monitored-timeout 死代码）、`SOLIDIFICATION_REPORT_2026-08-13-1800.md`（方向 L ENVIRONMENT_BLOCKED）、`SOLIDIFICATION_REPORT_2026-08-13-1634.md`（方向 A+I DETECT handler）互补，无重叠改动文件。
