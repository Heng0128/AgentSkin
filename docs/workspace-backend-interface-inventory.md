# 工作台后端接口梳理

> 日期：2026-08-20
> 分支：`feature/inspection-2026-08-13-1400-J-theme-contract`
> 范围：WorkspacePage / workspaceStore / AgentLivePreview / TweakPanel

---

## 1. 已有接口（直接可用）

### 1.1 实时微调接口

| 接口 | 签名 | 用途 | 状态 |
|------|------|------|------|
| `pushTweak` | `(session: TweakSession, overrides: ToolOverride) => Promise<boolean>` | 实时推送 override 到运行中的 agent | ✅ 已有 |
| `saveTweakAsCustomCss` | `(session: TweakSession, overrides: ToolOverride) => Promise<boolean>` | 保存 override 到 customThemeCss | ✅ 已有 |
| `resetTweak` | `(session: TweakSession) => Promise<boolean>` | 重置 tweak 层（不扰动已应用主题） | ✅ 已有 |

### 1.2 CSS 编辑接口

| 接口 | 签名 | 用途 | 状态 |
|------|------|------|------|
| `listStyleSheets` | `(port: number) => Promise<Array<...>>` | 列出 agent 样式表 | ✅ 已有 |
| `getStyleSheetText` | `(port: number, styleSheetId: string) => Promise<string>` | 获取样式表 CSS 文本 | ✅ 已有 |
| `applyRawCssEdit` | `(port: number, agentId: AgentId, css: string) => Promise<{ ok: boolean; error?: string }>` | 应用原始 CSS 编辑 | ✅ 已有 |

### 1.3 快照接口

| 接口 | 签名 | 用途 | 状态 |
|------|------|------|------|
| `snapshotBaseline` | `(agentId: AgentId, options?) => Promise<ThemeVisualSnapshot>` | 捕获 agent 原生（无主题）DOM | ✅ 已有 |
| `snapshotThemeDom` | `(agentId: AgentId, themeId?, options?) => Promise<ThemeVisualSnapshot>` | 捕获已主题化的 DOM | ✅ 已有 |

### 1.4 诊断接口

| 接口 | 签名 | 用途 | 状态 |
|------|------|------|------|
| `onThemeHealthReport` | `(listener: (report: HealthCheckReport) => void) => () => void` | 订阅主题健康报告 | ✅ 已有 |

### 1.5 状态接口

| 接口 | 签名 | 用途 | 状态 |
|------|------|------|------|
| `refreshStatus` | `() => Promise<SystemStatus>` | 刷新 agent 运行状态 | ✅ 已有 |
| `onStatusChanged` | `(listener: () => void) => () => void` | 订阅状态变化推送 | ✅ 已有 |

---

## 2. 缺失接口（需要新建）

### 2.1 undo/redo（M3）

> 无需新增 IPC 接口。undo/redo 历史栈仅在内存中维护，不跨进程持久化。

**实现方式**：纯前端 Zustand store 内部状态。

### 2.2 命名 tweak 预设（M7）

> 无需新增 IPC 接口。命名预设存储在 localStorage，不跨进程。

**实现方式**：纯前端 `workspace.tweakPresets` localStorage key。

### 2.3 A/B 双预览对比（M5）

> 无需新增 IPC 接口。

**实现方式**：
- 主预览：正常 `snapshotBaseline` + overrides 渲染
- 辅预览：`snapshotBaseline`（无 overrides）渲染，共享同一 CDP 连接
- 仅渲染层复用，无需新 IPC

### 2.4 元素选取 Inspect-to-Tweak（M8）

**需要新增 IPC 接口**：

| 接口 | 签名 | 用途 |
|------|------|------|
| `startElementInspect` | `(port: number) => Promise<{ ok: boolean }>` | 启动元素选取模式 |
| `stopElementInspect` | `() => Promise<{ ok: boolean }>` | 停止元素选取模式 |
| `onElementInspected` | `(listener: (node: { selector: string; tag: string; ref: string }) => void) => () => void` | 订阅选取结果 |

**备注**：可复用现有 `startInspect`/`stopInspect`/`onInspectResult` 接口（用于 DevTools 级 inspect），但语义不同。建议：

**方案 A（推荐）**：复用 `startInspect`/`stopInspect`/`onInspectResult`，在 workspaceStore 层做语义适配
- 优点：零新接口，利用现有 CDP session
- 缺点：DevTools inspect 功能会被临时占用

**方案 B**：新增专用 `startElementInspect` 接口
- 优点：功能隔离，不影响 DevTools inspect
- 缺点：新增 IPC handler，需注册新 channel

**推荐方案 A**：DevTools inspect 与 workspace 元素选取是互斥场景（用户不可能同时用两者），复用成本低。

### 2.5 导出/导入（M9）

> 无需新增 IPC 接口。

**实现方式**：
- 导出：纯前端 JSON 序列化（overrides → JSON string → clipboard/文件）
- 导入：JSON Schema 校验 → 应用 overrides → 调用已有 `pushTweak`

### 2.6 防抖 flush（M2）

> 无需新增 IPC 接口。

**实现方式**：纯前端 setTimeout 防抖机制。

### 2.7 localStorage 版本迁移（M4）

> 无需新增 IPC 接口。

**实现方式**：纯前端 localStorage 读写。

---

## 3. 接口影响面评估

### 3.1 需要新增 IPC 的情况

| 场景 | 接口 | 优先级 | 备注 |
|------|------|--------|------|
| 元素选取 | 复用 `startInspect`/`stopInspect`/`onInspectResult` | P1 | 推荐复用方案，不新增 |

### 3.2 无需新增 IPC 的情况

| 场景 | 存储方式 | 优先级 |
|------|----------|--------|
| undo/redo | 内存（Zustand store） | P1 |
| 命名预设 | localStorage | P1 |
| A/B 对比 | 共享 CDP 连接 | P1 |
| 导出/导入 | 前端 JSON + clipboard/文件 | P2 |
| 防抖 | 前端 setTimeout | P1 |
| 版本迁移 | 前端 localStorage | P2 |

---

## 4. 接口契约（复用确认）

### 4.1 `startInspect` / `stopInspect` / `onInspectResult`

```ts
// 复用确认：现有接口签名
startInspect(agentId: AgentId): Promise<{ ok: boolean }>;
stopInspect(): Promise<{ ok: boolean }>;
onInspectResult(listener: (node: InspectedNode | { error: string }) => void): () => void;

// InspectedNode 结构（已含所需字段）
interface InspectedNode {
  agentId: AgentId;
  tag: string;
  path: string;       // ← selector path
  cascade: NodeCascade;
}
```

**适配方案**：
- `startElementInspect(port)` → 直接调用 `startInspect(agentId)`
- `onElementInspected` → 订阅 `onInspectResult`，提取 `path` → `ref` 映射
- TweakPanel 根据 `ref` 高亮对应 TransformLedger 条目

### 4.2 `pushTweak` / `saveTweakAsCustomCss` / `resetTweak`

```ts
// 已有接口，签名不变
pushTweak(session: TweakSession, overrides: ToolOverride): Promise<boolean>;
saveTweakAsCustomCss(session: TweakSession, overrides: ToolOverride): Promise<boolean>;
resetTweak(session: TweakSession): Promise<boolean>;

// TweakSession 结构
interface TweakSession {
  agentId: AgentId;
  port: number;
  overrides: ToolOverride;
  dirty: boolean;
}
```

---

## 5. 总结

| 类别 | 数量 | 说明 |
|------|------|------|
| 已有可用接口 | 8 | pushTweak / saveTweakAsCustomCss / resetTweak / listStyleSheets / getStyleSheetText / applyRawCssEdit / snapshotBaseline / onThemeHealthReport |
| 复用接口 | 3 | startInspect / stopInspect / onInspectResult（用于元素选取） |
| 需新增 IPC | 0 | 全部复用或纯前端实现 |
| 纯前端实现 | 6 | undo/redo、命名预设、A/B 对比、导出/导入、防抖、版本迁移 |

**关键结论**：方案 B 的所有改动**无需新增任何 IPC 接口**，仅复用已有接口 + 纯前端实现。这意味着改动爆炸半径小、风险低、回滚简单。

---

## 6. 后端接口现状总览（IPC Channel 维度）

```typescript
// 本次改动涉及的 IPC通道（均已有 handler）
enum IpcChannel {
  PUSH_TWEAK = 'workspace:tweak:push',           // 实时推送
  SAVE_TWEAK = 'workspace:tweak:save',           // 保存为 customCss
  RESET_TWEAK = 'workspace:tweak:reset',         // 重置
  LIST_STYLESHEETS = 'workspace:styles:list',    // 列出样式表
  GET_STYLESHEET_TEXT = 'workspace:styles:text', // 获取样式表文本
  APPLY_RAW_CSS = 'workspace:css:apply',         // 应用原始 CSS
  SNAPSHOT_BASELINE = 'workspace:snapshot:baseline', // 基线快照
  START_INSPECT = 'workspace:inspect:start',     // 启动 inspect
  STOP_INSPECT = 'workspace:inspect:stop',       // 停止 inspect
}
```

---

## 7. 下一步行动

| 阶段 | 行动 | 负责 |
|------|------|------|
| 批次 1 | 确认 startInspect 复用方案，编写适配层 | 前端 |
| 批次 1 | localStorage 版本迁移实现 | 前端 |
| 批次 2 | undo/redo 历史栈实现 | 前端 |
| 批次 2 | 命名 preset CRUD | 前端 |
| 批次 3 | A/B 双预览面板实现 | 前端 |
| 批次 3 | 元素选取适配层（复用 startInspect） | 前端 |
| 批次 3 | 导出/导入 + JSON Schema 校验 | 前端 |
| 批次 4 | 全量测试 + 接口契约校验 | 前端+测试 |
