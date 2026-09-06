# RFC：CDP 注入性能优化（会话池 / 快速路径 / 缓存 / 轻量探针）

> 状态：`待评审`
> 日期：2026-08-16
> 分支：`（待建）`
> 范围：`src/main/cdp/`、`src/main/app-discovery.ts`、`src/main/theme-apply-flow.ts`、`src/main/agent-engine-service.ts`、`src/main/agent-engine/delegates.ts`、`src/shared/cdp-discovery.ts`

---

## 1. 背景与目标

当前"应用主题"完整走 `ensureAgentCdpReady → resolveLivePort → adapter.applyTheme → fan-out/hardening → wallpaper → scheme` 全链路。每次主题切换都完整重跑 `cdpDiscovery`，无 CDP 会话缓存；WorkBuddy 13 个 CDP target 各自独立建立/销毁 WebSocket（≈2.6s 额外握手开销）；端口发现缓存被 `ensureCdpReady` 轮询的 `bypassCache` 架空。

**目标**：

- 主题切换热路径从 2000–4000ms 降至 500–1000ms（70–80%）。
- 冷启动 `ensureCdpReady` 轮询消除 wmic/netstat 每 600ms 重复执行。
- 保持所有正确性不变量：epoch 取消、verifyTheme 核心校验、跨 epoch 无命令串扰。

**非目标**：不修改 L0-L4 CSS 注入层机制本身；不修改 adapter.applyTheme 黑色盒内部；不新增适配器；不破坏 `src/legacy/agentskin-core-runtime` 对 `shared/cdp-discovery.ts` 的共享导入契约。

---

## 2. 触发条件（对照 AGENTS.md §6）

- [x] 重构注入架构（L0-L4 注入层）→ 会话池 / 快速路径 / 轻量探针属注入流程架构级改动
- [ ] 新增 UI 页面
- [ ] 新增适配器
- [ ] 修改核心数据模型

---

## 3. 现状侦察（代码锚点）

基于 2026-08-16 静态审计确认：

| 模块 | 锚点 | 现状 |
|------|------|------|
| apply 编排 | `theme-apply-flow.ts:259-272` | 每次 apply 调 `ensureAgentCdpReady`，无会话缓存 |
| 轮询 | `app-discovery.ts:605-640` | `ensureCdpReady` 每 600ms `resolveLivePort(..., { bypassCache: true })`，TTL 1.5s 架空 |
| 端口发现 | `shared/cdp-discovery.ts:255-346` | Layer1 DevToolsActivePort + Layer2 PID/wmic/netstat，三套 1.5s TTL 快照 |
| 会话生命周期 | `cdp-fanout.ts`（secondary/hardening/remove） | 每个 target `connectWithRetry`→`connectCdp`→用后 `session.close()`，无复用 |
| 会话客户端 | `cdp-client.ts:326-336` | `connectCdp(wsUrl, openTimeoutMs=5000, commandTimeoutMs=8000)` |
| delegate | `agent-engine/delegates.ts:132-141` | `withPageSession` 每次 `connectCdp`→`close` |
| 验证 | `cdp/injection/shared.ts:97-118` `waitForTheme` | 固定 `minDelayMs=500` + 300ms 超时 |
| 探针 | `cdp/snapshot-theme.ts` | `comparePreview` 连续两次 `snapshotThemeVisuals`，第二次重 apply |

---

## 4. 设计方案

### 4.1 会话池优先原则（先解决报告内部矛盾）

原审计风险 #6 写"会话池 max-size=2"，同文又写要池化 WorkBuddy 13 个 target——自相矛盾。**本 RFC 的裁决**：

- **池化粒度 = per-target（key = `agentId:port:targetId`）**，不设全局 max-size=2。
- **内存上限改为按 agent 维度**：单 agent 目标数 × 单会话约 2MB；WorkBuddy 13 目标 ≈ 26MB，可接受（主进程常驻内存本就分配了该预算）。
- **生命周期约束**：
  - epoch 绑定：`agentEngineService` 持有 `Map<AgentId, Map<targetKey, CdpSession>>`，`bumpEpoch` 时清空该 agent 的全池并 `close()`。
  - `ws.onclose` 自动移除对应条目（复用 `cdp-client` 的 `closed` 守卫）。
  - **绝不跨 epoch 复用**：读池前必须 `isEpochCurrent(appId, epoch)` 校验。
- **会话池只服务于同一 apply/restore epoch 内的子任务复用**（secondary ↔ hardening ↔ remove ↔ health check），不跨操作复用，避免"快速路径状态分叉"风险。

适用接口：`cdp-fanout.ts` 的 `injectSecondaryTargets` / `removeSecondaryTargets` / `hardeningPass` / `hardeningRemove`，以及 `delegates.ts` 的 `withPageSession`。新增 `cdp/session-pool.ts` 提供 `acquire` / `release` / `invalidateEpoch`。

### 4.2 端口发现缓存 TTL 分层（P1）

- 保持现有 PID/netstat/进程快照 1.5s TTL 不变（进程/端口绑定变化快，无需改）。
- **新增 per-agent 已解析存活端口缓存**：`Map<AgentId, { port, capturedAt }>`，TTL 30s（端口一旦绑定不会轻易变化）。
- 失效条件：`bumpEpoch` 清空；`resolveLivePort` 探测失败置空；`reconcileZombiePorts` 命中时清空。
- 风险：「端口被 OS 回收复用」由 `key = agentId + port + targetId + sessionId` + 每次 send 前校验 `window.location.origin` 兜底（见 §5 风险 4）。
- 注意：`shared/cdp-discovery.ts` 被 `legacy` 共享，per-agent 缓存需放在 `app-discovery.ts`（main 侧）而非 shared，避免污染 legacy 导入面。

### 4.3 Target 列表 per-port 800ms TTL 缓存（P2）

- `cdp-targets.ts` 模块级 `Map<port, { targets, capturedAt }>`，TTL 800ms。
- 失效：TTL 过期；epoch 翻转清空；可选的 `Target.targetCreated` 增量更新。
- 消除同一 apply 内 `findDomTargets` 与 `findSecondaryTargets` 对同一端口的重复 HTTP `/json/list`。

### 4.4 主题切换快速路径（P2）

```
前提：agent 进程存活 + 会话池命中 + DOM 无重大结构变更
1. 跳过进程检测 / 端口扫描 / 重启 / 完整基准快照 / 全量探针
2. 读内存缓存：CDP 会话、baselineSnapshot、semanticNodes
3. 基于缓存语义节点做新主题颜色映射
4. 经现有会话发样式注入
5. 轻量探针校验关键受控节点；失败立即回滚上一可用主题

缓存失效（退回完整初始化）：
- agent 重启 / 会话断开 / 客户端版本变更 / 轻探针检测 DOM 重大结构改动
```

- 入口必须 `isEpochCurrent` 校验，防止快照与会话来自不同 apply 实例。
- 拆分两套执行链路：`applyThemeFlow` 保留完整初始化路径；新增 `fastApplyThemeFlow` 走缓存路径。

### 4.5 BaselineSnapshot + semanticNodes 内存缓存 + LRU（P3）

- 粒度：per-agent，key = `{agentId, url, themeId}`。
- 失效：URL 变更 / `Page.frameNavigated` / TTL 60s 兜底；LRU 上限 3 条目。
- 预算：WorkBuddy 2500 节点 ≈ 12–15MB，LRU 3 条目 ≈ 45MB 峰值，可接受。

### 4.6 轻量探针（P3）

- 仅校验关键受控节点：accent 颜色 + adoptedSheetCount + heroBlobActive（**完整保留 verifyTheme 核心检查**）。
- 校验失败 → 立即回滚上一可用主题，并标记缓存失效 → 退回完整初始化。
- 不做完整 DOM 快照。

### 4.7 会话存活检测 ping/pong 心跳（P4）

- session 级心跳，5s 间隔；连续 2 次失败标记 dirty 并丢弃，触发重建。
- send 前做 `probePortLive` 活体检测（可选，成本允许时）。

### 4.8 waitForTheme minDelay 调优（P4）

- 对已知快速生效 agent 将 `minDelayMs` 降至 200ms；`intervalMs` 100ms→50ms。
- 通过 `agent-engine-service` 按 agent 传入，不硬改默认值。

### 4.9 ensureCdpReady 显式 forceRestart + PerformanceRecorder 埋点（P5）

- `ensureCdpReady` 增加显式 `forceRestart` 参数（默认 false），替代隐式约定，防止未来调用方绕过用户确认直接杀进程。
- `PerformanceRecorder` 补充 `connectCdp` / `waitForTheme` / 子进程调用 独立 step 埋点。

### 4.10 并发 apply 返回语义（O4）

- `agent-engine-service.ts:236` 并发 apply 被跳过时返回 `{ status: 'skipped-concurrent' }`，与真实 `applied` 区分。

---

## 5. 风险与兜底

| # | 风险 | 等级 | 触发条件 | 兜底策略 | 检测机制 |
|---|------|------|----------|----------|----------|
| 1 | 语义节点过期染色错乱 | 高 | 旧 semanticNodes 缓存复用于新 themeId | key 内嵌 themeId + epoch；apply 时 bumpEpoch | 异步 snapshot 轻回读比对 `--agentskin-accent` |
| 2 | CDP 静默断连 | 高 | AV/防火墙断开 WS，closed 未前置检测 | 5s ping/pong 心跳；send 前活体检测 | 连续 2 次失败标记 dirty → 重建 |
| 3 | 轻探针漏判 DOM 迁移 | 中 | SPA 路由切换后关键 selector 移入 shadowDOM | 探针含 shadow-piercing 白名单；失败触发 full rediscovery | 定期与 findTargets 交叉校验 target 数量 |
| 4 | 多 agent 会话 Key 碰撞 | 中 | 随机端口被 OS 回收复用 | key 含 agentId+port+sessionId；send 前校验 origin | 每次 send 校验 `window.location.origin` |
| 5 | 快速路径状态分叉 | 中 | 快照与会话来自不同 apply 实例 | 快速路径入口 `isEpochCurrent` 校验 | PerformanceRecorder cdpDiscovery=0ms 时 telemetry 告警 |
| 6 | 会话池无界增长 | 中 | 频繁切换主题旧 session 未关 | **按 agent 池上限**（见 4.1）超限 LRU+close | Diagnostics 面板 poolSize 可视化 |

---

## 6. 分批落地计划

| 批次 | 内容 | 预估改动 | 风险 | 验证 |
|------|------|----------|------|------|
| **批 0（已完成）** | `ensureCdpReady` 轮询：先 probe 再 sleep + 仅首轮 bypassCache | ~25 行 `app-discovery.ts` | 低 | 相关测试全绿 |
| **批 1** | 会话池 `session-pool.ts` + fanout/delegates 接入 + epoch 绑定 | ~250 行 | 中 | fanout/delegates 单测 |
| **批 2** | 端口缓存 30s + Target 列表 800ms TTL | ~60 行 | 低 | discovery 单测 |
| **批 3** | 快速路径拆分 `fastApplyThemeFlow` | ~400 行 | 中 | apply 编排单测 |
| **批 4** | BaselineSnapshot/semanticNodes 缓存 + LRU + 轻量探针 | ~350 行 | 中 | snapshot/探针单测 |
| **批 5** | 心跳 + minDelay 调优 + forceRestart + 埋点 + skipped-concurrent | ~250 行 | 低 | service 单测 |
| **批 6** | 全量 6 Agent 集成验证 | 测试 | 高（耗时） | `npm run check` |

每批独立评审、独立合入，避免单次大爆炸。

---

## 7. 人工复核项

1. `adapter.applyTheme` 内部是否存在跨 target 连接复用？（黑色盒，需实际埋点验证）
2. WorkBuddy 13 个 target 是否每次都需要注入？部分可能是隐藏 webview / service worker。
3. 6 个 agent 的 CDP 端口释放/绑定行为差异，存活端口 30s TTL 对各 agent 是否安全？
4. single instance lock 清理后 spawn 成功的时间分布，600ms 轮询间隔是否匹配？
5. `app.quit()` 与 `taskkill /F` 对 CDP 端口释放的影响。

---

## 8. 评审结论

（待评审人填写）