# 工作台 Per-Agent 持久化微调方案

> 状态：方案待确认  
> 日期：2026-08-15  
> 分支：`feature/inspection-2026-08-13-1400-J-theme-contract`  
> 范围：WorkspacePage / Live Tweak / workspaceStore

---

## 1. 背景与目标

工作台（WorkspacePage / Live Tweak）当前是"一次性会话式微调"——切换 agent 即丢失微调值，实时推送静默失败，预览切换闪烁。

**目标**：升级为"per-agent 持久化微调工作区"——overrides 按 agent 隔离并跨会话持久化，推送可靠可回执，预览平滑切换。

**非目标**：不突破六页封顶，不新增适配器，不修改 IPC 接口契约，不重构注入架构（L0-L4 不动）。

---

## 2. 现状侦察（代码锚点）

基于 2026-08-15 代码侦察确认：

### 2.1 workspaceStore 状态结构

| 字段名 | 类型 | 初始值 | 说明 |
|--------|------|--------|------|
| `currentAgentId` | `AgentId \| null` | `null` | 当前选中 agent，可为 null |
| `currentPort` | `number \| null` | `null` | 当前 agent CDP 端口，可为 null |
| `currentOverrides` | `ToolOverride` | `{}` | 当前实时编辑的 overrides |
| `dirty` | `boolean` | `false` | 是否有未保存修改 |

### 2.2 关键 Action 现状

**selectAgent**（硬重置，丢失历史）：
```ts
selectAgent: (agentId, port) =>
  set({
    currentAgentId: agentId,
    currentPort: port,
    currentOverrides: {},   // ← 直接清空，再次切回丢失
    dirty: false,
  }),
```

**updateOverride**（fire-and-forget，静默失败）：
```ts
updateOverride: (key, value) =>
  set((s) => {
    const next: ToolOverride = { ...s.currentOverrides, [key]: value };
    const session: TweakSession = {
      agentId: s.currentAgentId ?? ('codex' as AgentId),
      port: s.currentPort ?? 0,
      overrides: next,
      dirty: true,
    };
    void api.pushTweak(session, next);  // ← 丢弃 Promise，失败无感知
    return { currentOverrides: next, dirty: true };
  }),
```

**saveChanges**（全局保存，语义不变）：
```ts
saveChanges: async () => {
  const { currentAgentId, currentPort, currentOverrides } = get();
  const session: TweakSession = { agentId: ..., port: ..., overrides: currentOverrides, dirty: true };
  const ok = await api.saveTweakAsCustomCss(session, currentOverrides);
  if (ok) set({ dirty: false });  // ← 仅清除 dirty，不清空 overrides
  return ok;
},
```

### 2.3 ToolOverride 与 TweakSession 类型

**ToolOverride**（26 个可选字段，分 8 类）：

```ts
export interface ToolOverride {
  radius?: string;           // shape
  spacing?: number;
  shadowLevel?: 'none' | 'sm' | 'md' | 'lg' | 'xl';
  blurPx?: number;
  borderWidth?: number;
  accent?: string;           // color
  background?: string;
  foreground?: string;
  surface?: string;
  fontSize?: number;         // typography
  fontFam?: string;
  lineHeight?: number;
  duration?: string;         // motion
  timing?: string;
  scale?: number;            // layout / density
  separators?: boolean;
  invert?: boolean;          // filter
  contrast?: number;
  saturate?: number;
  dim?: number;              // visual effects
  opacity?: number;
  gradientAccent?: boolean;  // gradient
  colors?: Record<string, string>; // full semantic palette
}
```

**TweakSession**（4 个必填字段）：

```ts
export interface TweakSession {
  agentId: AgentId;
  port: number;
  overrides: ToolOverride;
  dirty: boolean;
}
```

### 2.4 IPC 接口签名（不变）

```ts
pushTweak(session: TweakSession, overrides: ToolOverride): Promise<boolean>;
saveTweakAsCustomCss(session: TweakSession, overrides: ToolOverride): Promise<boolean>;
resetTweak(session: TweakSession): Promise<boolean>;
```

三者均返回 `Promise<boolean>`，当前 `pushTweak` 被 `void` 丢弃。

### 2.5 TweakPanel 组件契约

`TweakPanel.onChange` 接收完整 `ToolOverride` 对象。TweakPanel 内部 `set` 函数每次只克隆并变更单个 key 后传入 `onChange`。每个控件（slider/color/select）**独立事件触发**，保证每次 `onChange` 调用只携带**单 key 变化**。

```ts
// TweakPanel.tsx L78-79
const set = (key: keyof ToolOverride, value: ToolOverride[keyof ToolOverride]) =>
  onChange({ ...overrides, [key]: value });
```

WorkspacePage 用 `for...break` 只取首项变化推送（由于 TweakPanel 保证单 key 变化，`break` 仅为防御性编程）：

```tsx
<TweakPanel
  overrides={currentOverrides}
  onChange={(next) => {
    for (const kv of Object.entries(next)) {
      const k = kv[0] as keyof typeof currentOverrides;
      if (currentOverrides[k] !== next[k]) {
        updateOverride(k, kv[1]);
        break; // ← 只推送第一个变化维度
      }
    }
  }}
/>
```

**结论**：TweakPanel 层面已保证单维度触发，无需在 Store 层做批量透传。

### 2.6 AgentLivePreview 现状

无缓存，每次 `agentId` 变化重新调用 `api.snapshotBaseline`，`loading` 为 true 时整个预览区域替换为 loading 文本，`RealDomPreview` 完全卸载。错误处理静默（空 catch 块）。

### 2.7 现有错误横幅模式

仅存在于 `AppsPage.tsx`（`scanError` banner）：

```tsx
{scanError && (
  <div className="mb-5 flex items-center justify-between gap-3 rounded-md px-4 py-3"
       style={{ background: 'var(--redbg)' }}>
    <p className="min-w-0 flex-1 truncate text-[12px]" style={{ color: 'var(--destructive)' }}>
      扫描失败：{scanError}
    </p>
    <Button variant="ghost" size="sm" onClick={() => void scan(true)}>重试</Button>
  </div>
)}
```

WorkspacePage 无类似机制。

---

## 3. 方案设计

### 3.1 改动总览

| # | 文件 | 改动类型 | 说明 |
|---|------|---------|------|
| M1 | `src/ui/stores/workspaceStore.ts` | 修改 | per-agent overrides 持久化 + 推送回执 + 错误状态 |
| M2 | `src/ui/pages/WorkspacePage.tsx` | 修改 | onChange 简化 + 推送失败横幅 |
| M3 | `src/ui/components/workspace/AgentLivePreview.tsx` | 修改 | snapshot 缓存 + 平滑切换 |
| T1 | `tests/ui/workspaceStore.test.ts` | 新增/修改 | 新增逻辑覆盖 |

UI 页面数不变，不触发 RFC。

---

### 3.2 M1：workspaceStore.ts

#### 3.2.1 新增持久化工具函数

文件顶部新增：

```ts
const OVERRIDES_STORAGE_KEY = 'workspace.overridesByAgent';

function loadOverridesByAgent(): Record<string, ToolOverride> {
  try {
    const raw = localStorage.getItem(OVERRIDES_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, ToolOverride>) : {};
  } catch {
    return {}; // quota / parse error → 降级为会话内
  }
}

function persistOverridesByAgent(map: Record<string, ToolOverride>): void {
  try {
    localStorage.setItem(OVERRIDES_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // quota 超限等 → 静默降级，不影响 UI
  }
}
```

#### 3.2.2 State 扩展

新增两个字段：

```ts
overridesByAgent: Record<string, ToolOverride>; // agentId → 持久化 overrides
pushError: string | null;                        // 最近一次推送失败信息
```

初始值：`overridesByAgent: loadOverridesByAgent()`，`pushError: null`。

#### 3.2.3 selectAgent — 恢复而非重置

```ts
selectAgent: (agentId, port) =>
  set((s) => ({
    currentAgentId: agentId,
    currentPort: port,
    currentOverrides: s.overridesByAgent[agentId] ?? {}, // 恢复该 agent 历史 overrides
    dirty: false,
    pushError: null,                                   // 清除上次推送错误
  })),
```

#### 3.2.4 updateOverride — 乐观更新 + 回执 + 串行化

**设计决策**：采用"乐观更新"——UI 立即反映意图状态，`api.pushTweak` 失败时保留用户值并显示错误横幅。这延续了原注释中"failed push does not block the UI"的设计意图，同时解决"用户以为生效实际没生效"的问题。

**串行化机制**：使用 monotonic token 保证最终推送一致。每次调用 `updateOverride` 递增 token，只应用最新 token 的回执结果，过期回执丢弃。避免 fire-and-forget 并发导致后发的旧值覆盖新值。

```ts
/** Monotonic token — 每次 updateOverride 调用递增，用于丢弃过期回执 */
let pushToken = 0;

updateOverride: async (key, value) => {
  const s = get();
  const next: ToolOverride = { ...s.currentOverrides, [key]: value };
  const session: TweakSession = {
    agentId: s.currentAgentId ?? ('codex' as AgentId),
    port: s.currentPort ?? 0,
    overrides: next,
    dirty: true,
  };

  // 乐观更新：UI 立即反映意图状态
  const overridesByAgent = { ...s.overridesByAgent, [session.agentId]: next };
  persistOverridesByAgent(overridesByAgent);
  set({ currentOverrides: next, overridesByAgent, dirty: true, pushError: null });

  // 捕获当前 token，用于回执时校验是否过期
  const token = ++pushToken;
  try {
    const ok = await api.pushTweak(session, next);
    // 仅最新 token 的回执生效，过期回执静默丢弃
    if (token !== pushToken) return;
    if (!ok) set({ pushError: 'push_failed' });
  } catch (err) {
    // 同上，仅最新 token 的回执生效
    if (token !== pushToken) return;
    set({
      pushError: err instanceof Error ? err.message : 'push_error',
    });
  }
},
```

#### 3.2.5 新增 clearPushError

```ts
clearPushError: () => set({ pushError: null }),
```

#### 3.2.6 saveChanges — 保存后持久化值同步

**设计决策**：`saveChanges` 将当前 overrides 持久化为全局 customThemeCss。保存成功后，为确保 `selectAgent` 恢复时与已保存状态一致，需**同步更新 `overridesByAgent`** 中当前 agent 的值为最终已保存值。

行为定义：
- 保存成功 → `overridesByAgent[currentAgentId]` 更新为 `currentOverrides`（即已保存值），`dirty` 置 false
- 保存失败 → 保留 `overridesByAgent` 与 `currentOverrides` 不变，用户可重试

```ts
saveChanges: async () => {
  const { currentAgentId, currentPort, currentOverrides } = get();
  const session: TweakSession = {
    agentId: currentAgentId ?? ('codex' as AgentId),
    port: currentPort ?? 0,
    overrides: currentOverrides,
    dirty: true,
  };
  const ok = await api.saveTweakAsCustomCss(session, currentOverrides);
  if (ok) {
    // 同步持久化值：确保 selectAgent 恢复时与已保存状态一致
    const overridesByAgent = {
      ...get().overridesByAgent,
      [session.agentId]: currentOverrides,
    };
    persistOverridesByAgent(overridesByAgent);
    set({ dirty: false, overridesByAgent });
  }
  return ok;
},
```

`discardChanges` 保持不变（调用 `api.resetTweak` + 重置 `currentOverrides: {}`）。

#### 3.2.7 改动影响面评估

| 调用点 | 影响 | 兼容性 |
|--------|------|--------|
| `updateOverride` 改 async | 返回值从 `void` 变 `Promise<void>` | WorkspacePage 已用 `void updateOverride(...)`，兼容 |
| `selectAgent` 恢复历史 | 调用后 `currentOverrides` 非空 | WorkspacePage 直接绑定，不影响其他逻辑 |
| localStorage 持久化 | 新增 `workspace.overridesByAgent` key | 容错已处理 |

---

### 3.3 M2：WorkspacePage.tsx

#### 3.3.1 onChange 简化

去掉 `for...break` 的可读性陷阱，保留"只处理一个变化维度"语义：

```tsx
<TweakPanel
  overrides={currentOverrides}
  onChange={(next) => {
    for (const [k, v] of Object.entries(next)) {
      if (currentOverrides[k as keyof ToolOverride] !== v) {
        void updateOverride(k as keyof ToolOverride, v);
        return; // 只处理一个变化维度后退出
      }
    }
  }}
  t={t}
/>
```

#### 3.3.2 推送失败横幅

在 TweakPanel 上方渲染，复用 AppsPage 的 banner 模式：

```tsx
const pushError = useWorkspaceStore((s) => s.pushError);
const clearPushError = useWorkspaceStore((s) => s.clearPushError);

{pushError && (
  <div
    className="mb-5 flex items-center justify-between gap-3 rounded-md px-4 py-3"
    style={{ background: 'var(--redbg)' }}
  >
    <p className="min-w-0 flex-1 truncate text-[12px]" style={{ color: 'var(--destructive)' }}>
      {t.workspacePushFailed ?? '实时推送失败：'}{pushError}
    </p>
    <Button variant="ghost" size="sm" onClick={clearPushError}>
      {t.commonDismiss ?? '关闭'}
    </Button>
  </div>
)}
```

**行为**：横幅常驻直至用户手动关闭或下次成功推送（`pushError` 被置 null）。

---

### 3.4 M3：AgentLivePreview.tsx

#### 3.4.1 snapshot 缓存 + 平滑切换

```tsx
const [snapshots, setSnapshots] = useState<Record<string, DomTreeNode | undefined>>({});
const [refreshing, setRefreshing] = useState(false);
const [refreshFailed, setRefreshFailed] = useState(false);

useEffect(() => {
  let cancelled = false;
  const cached = snapshots[agentId];

  if (cached) {
    // 有缓存 → 直接显示，后台刷新
    setRefreshing(true);
    setRefreshFailed(false);
    api.snapshotBaseline(agentId as never)
      .then((snap) => {
        if (cancelled) return;
        setSnapshots((prev) => ({ ...prev, [agentId]: snap.domTree }));
        setRefreshFailed(false);
      })
      .catch(() => {
        // 刷新失败 → 保留缓存，标记失败（细条变红提示用户）
        if (!cancelled) setRefreshFailed(true);
      })
      .finally(() => { if (!cancelled) setRefreshing(false); });
    return () => { cancelled = true; };
  }

  // 无缓存 → loading
  setLoading(true);
  api.snapshotBaseline(agentId as never)
    .then((snap) => {
      if (cancelled) return;
      setSnapshots((prev) => ({ ...prev, [agentId]: snap.domTree }));
    })
    .catch(() => { /* 保留 undefined → RealDomPreview fallback */ })
    .finally(() => { if (!cancelled) setLoading(false); });
  return () => { cancelled = true; };
}, [agentId]);
```

#### 3.4.2 渲染逻辑

```tsx
const domTree = snapshots[agentId];

if (loading && !domTree) {
  return (
    <div className="flex h-[280px] items-center justify-center rounded-md bg-card">
      <span className="font-mono text-[11px] text-muted-foreground">
        {t.workspacePreviewLoading}
      </span>
    </div>
  );
}

return (
  <div className="relative overflow-hidden rounded-md">
    {refreshing && !refreshFailed && (
      <div className="absolute inset-x-0 top-0 h-1 bg-primary/30 animate-pulse" />
    )}
    {refreshFailed && (
      <div
        className="absolute inset-x-0 top-0 h-1"
        style={{ background: 'var(--destructive)' }}
        title={t.workspacePreviewRefreshFailed ?? '刷新失败，显示缓存'}
      />
    )}
    <RealDomPreview domTree={domTree} overrides={overrides} t={t} />
  </div>
);
```

**效果矩阵**：

| 场景 | 首次进入 agentA | agentA → agentB | agentB → agentA |
|------|-----------------|-----------------|-----------------|
| 缓存状态 | 无 | agentB 无 | agentA 有 |
| 显示行为 | 全屏 loading | 全屏 loading | 缓存 + 顶部细条 |
| 后台行为 | — | — | 静默刷新 |
| 刷新失败 | — | — | 保留缓存 + 细条变红 |

---

## 4. 接口与数据变化

### 4.1 Store 状态变化

| 项目 | 变化 |
|------|------|
| 新增 state 字段 | `overridesByAgent: Record<string, ToolOverride>` |
| 新增 state 字段 | `pushError: string \| null` |
| 新增 action | `clearPushError: () => void` |
| 修改 action 返回值 | `updateOverride` 从 `void` → `Promise<void>`（外部调用点已 `void`，兼容） |

### 4.2 持久化变化

| 项目 | 变化 |
|------|------|
| localStorage 新增 key | `workspace.overridesByAgent`（JSON 序列化） |
| 读取时机 | store 初始化 |
| 写入时机 | 每次 `updateOverride` 后 |

### 4.3 IPC 接口

**无变化**。`pushTweak` / `saveTweakAsCustomCss` / `resetTweak` 签名与返回值均不变。

---

## 5. 风险点与缓解

| # | 风险 | 等级 | 缓解措施 |
|---|------|------|----------|
| R1 | localStorage 不可用（隐私模式/配额） | 低 | `loadOverridesByAgent` / `persistOverridesByAgent` 均 try-catch 降级 |
| R2 | async updateOverride 并发覆盖 | 低 | monotonic token 串行化：只有最新 token 的回执生效，过期回执静默丢弃；乐观更新保证 UI 一致性 |
| R3 | 快照缓存与真实 DOM 不一致 | 中 | 有缓存时后台刷新 + 顶部细条提示；刷新失败时细条变红弱提示；实时 override 仍通过 postMessage 生效，不依赖 snapshot |
| R4 | 推送失败横幅被忽略 | 低 | 横幅常驻直至用户手动关闭或下次成功推送 |
| R5 | AgentId 为 null 时持久化 key | 低 | `updateOverride` 中 `session.agentId` 已有 `?? 'codex'` fallback，key 始终有效 |
| R6 | 快照缓存内存增长 | 低 | 最多 6 个 adapter 对应缓存（实际更少）；如需可加 `MAX_SNAPSHOTS` LRU 限制 |
| R7 | 乐观更新与推送失败共存时用户困惑 | 中 | 错误横幅明确提示"实时推送失败"，但本地值保留；成功推送后横幅自动消失 |

---

## 6. 测试方案

| # | 测试 | 类型 | 覆盖点 |
|---|------|------|--------|
| T1 | `overridesByAgent` 初始化加载 | 单元 | store 初始化时调用 `loadOverridesByAgent` 且正确解析 |
| T2 | `selectAgent` 恢复历史 overrides | 单元 | persist agentA → selectAgent(agentB) → selectAgent(agentA) 恢复值 |
| T3 | `updateOverride` 持久化写入 | 单元 | 调用后 localStorage 对应当前 agentId 更新 |
| T4 | `updateOverride` 推送失败设置 pushError | 单元 | mock `api.pushTweak` throw → `pushError` 非 null |
| T5 | `updateOverride` 推送返回 false 设置 pushError | 单元 | mock `api.pushTweak` 返回 false → `pushError === 'push_failed'` |
| T6 | `clearPushError` 清除错误 | 单元 | 调用后 `pushError === null` |
| T7 | localStorage 配额异常降级 | 单元 | mock `localStorage.setItem` throw → 不崩溃 |
| T8 | localStorage 解析失败降级 | 单元 | mock `localStorage.getItem` 返回非法 JSON → 返回 `{}` |
| T9 | WorkspacePage onChange 变化检测 | 手动验证 | 单维度变化触发一次 store update — 依赖真实 agent 运行，CI 不可自动化 |
| T10 | AgentLivePreview 缓存命中 | 手动验证 | 第二次切换回同一 agent 不显示全屏 loading — 依赖真实 agent 运行，CI 不可自动化 |
| T11 | updateOverride 推送串行化 | 单元 | 快速连续调用 → 只有最后一次 pushTwrite 回执生效，过期回执被丢弃 |
| T12 | saveChanges 后 overridesByAgent 同步 | 单元 | 保存成功后 `overridesByAgent[agentId]` 与 `currentOverrides` 一致 |

---

## 7. 回滚方案

### 7.1 分支策略

在 `feature/inspection-2026-08-13-1400-J-theme-contract` 上新建 `feature/workspace-persistent-overrides`。

### 7.2 回滚粒度

| 改动 | 独立回滚方式 |
|------|-------------|
| M1 workspaceStore | 删除 `overridesByAgent` 相关代码，`selectAgent` 恢复硬重置 `currentOverrides: {}` |
| M2 WorkspacePage | 删除横幅代码，恢复原 `for...break` onChange |
| M3 AgentLivePreview | 删除 `snapshots` 缓存与 `refreshing` 状态，恢复 `loading` 全屏替换 |

### 7.3 数据清理

若回滚后需清理用户残留 localStorage，可在 store init 时加入版本 key 并迁移/清理。

---

## 8. 执行计划

| 阶段 | 任务 | 验证门 |
|------|------|--------|
| P1 · M1 | workspaceStore.ts 改动 | workspaceStore 测试通过 |
| P2 · M2 | WorkspacePage.tsx 改动 | WorkspacePage 测试 + 视觉回归 |
| P3 · M3 | AgentLivePreview.tsx 改动 | 组件测试通过 |
| P4 · 全量验证 | `npm run check` 全绿 + `tsc --noEmit` | 全绿 |
| P5 · 深度检查 | 持久化容错 / async 一致性 / 缓存一致性 / 保存语义影响 | 人工复核 |

每阶段完成后进入下一阶段，任一时间点失败则暂停并由人工复核。

---

## 9. 待确认项

1. **乐观更新 vs 阻塞 UI** — 当前方案采用"乐观更新 + 失败横幅"。若偏好"await 阻塞、失败回滚"需调整 M1。
2. **持久化范围** — `overridesByAgent` 存 localStorage。是否需要加密/隔离（当前无敏感数据，仅 UI 参数）。
3. **快照缓存策略** — 当前"有缓存时后台刷新 + 顶部细条"。是否需要 stale-while-revalidate 或 TTL。
4. ~~**保存语义**~~ — 已在 3.2.6 明确：`saveChanges` 成功后同步更新 `overridesByAgent`，确保恢复时与已保存状态一致。
5. **快照缓存 LRU** — 当前不设上限（最多 6 个 adapter）。是否需要 `MAX_SNAPSHOTS` 限制。

---

## 附录：文件绝对路径索引

| 文件 | 路径 |
|------|------|
| workspaceStore | `C:\Users\snowb\Desktop\work\desktop-main\src\ui\stores\workspaceStore.ts` |
| WorkspacePage | `C:\Users\snowb\Desktop\work\desktop-main\src\ui\pages\WorkspacePage.tsx` |
| AgentLivePreview | `C:\Users\snowb\Desktop\work\desktop-main\src\ui\components\workspace\AgentLivePreview.tsx` |
| TweakPanel | `C:\Users\snowb\Desktop\work\desktop-main\src\ui\components\workspace\TweakPanel.tsx` |
| AppsPage（banner 参考） | `C:\Users\snowb\Desktop\work\desktop-main\src\ui\pages\AppsPage.tsx` |
| override 类型 | `C:\Users\snowb\Desktop\work\desktop-main\src\shared\types\override.ts` |
| ipc 类型 | `C:\Users\snowb\Desktop\work\desktop-main\src\shared\types\ipc.ts` |
| workspaceStore 测试 | `C:\Users\snowb\Desktop\work\desktop-main\tests\ui\workspaceStore.test.ts`（待确认是否存在） |
