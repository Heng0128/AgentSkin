# RFC: workspaceStore 拆分

| Field | Value |
|-------|-------|
| 状态 | 待评审 |
| 日期 | 2026-08-24 |
| 分支 | — |
| 范围 | `src/ui/stores/workspaceStore.ts`, `src/ui/stores/workspace-presets.ts`, `src/ui/types/workspace.ts` |
| 关联 RFC | `docs/rfc/2026-08-24-design-language-unification.md`（Design Language 统一） |

---

## 1. 背景与目标

### 1.1 现状痛点

**workspaceStore 概念污染**：当前 `src/ui/stores/workspaceStore.ts` 是一个 1000+ 行的单一 Zustand store，承载了 26 个数据字段和 29 个 action，混杂了 5 个独立关注点：

| 关注点 | 字段 | action 数 |
|--------|------|-----------|
| Studio 布局 | viewMode, window, dock, inspector, drawer, activePresetId, dualPreviewActive | 16 |
| Tweak 实时编辑 | currentAgentId, currentPort, currentOverrides, dirty, overridesByAgent, pushError, lastPushDurationMs, avgPushDurationMs | 8 |
| Raw CSS 编辑 | rawSheets, rawSheetIndex, rawCss, rawCssOriginal, rawDirty, rawError, rawLoading | 6 |
| Undo/Redo 历史 | history, historyIndex | 4 |
| 命名预设 | tweakPresets, tweakPresetActiveId | 6 |

导致问题：

1. **概念污染**：Studio 布局（dock/inspector/drawer 位置）与 Tweak 实时编辑（override push）被塞入同一 `WorkspaceState`，两者生命周期完全不同但耦合在同一 store；
2. **维护困难**：修改 `selectAgent` 时必须理解 `applyPreset` 的逻辑反之亦然，认知负荷高；
3. **测试复杂**：`workspaceStore.test.ts` 需要 mock 整个 store（含 CDP push、localStorage、debounce timer）才能测试单一关注点；
4. **性能退化**：任意字段变化触发全量 selector 重订阅，如 `setRawCss` 时 `dock.open` 的订阅者也会收到通知。

### 1.2 目标

1. 将 workspaceStore 拆分为 3 个职责单一的子 store，每个 store 聚焦一个关注点；
2. 保持 100% 向后兼容——现有消费方（`useWorkspaceStore` hook / `getState()` 调用）无需修改；
3. 不引入任何新第三方库；
4. 拆分后各子 store 单元测试可独立运行，无需 mock 无关域。

### 1.3 非目标

- 不重构注入架构（L0-L4 层）；
- 不新增 UI 页面；
- 不修改 14-token 主题契约；
- 不修改 ThemeCatalogItem / ToolOverride 等共享类型；
- 不实现新的 Tweak 功能（如分组 undo、批量预设导入）；
- 不改变现有持久化 schema（localStorage key / 版本号保持不变）。

---

## 2. 触发条件（对照 AGENTS.md §6）

- [ ] 重构注入架构（L0-L4 注入层）—— **否**
- [ ] 新增 UI 页面（突破六页封顶）—— **否**
- [ ] 新增适配器（突破六适配器上限）—— **否**
- [ ] 修改核心数据模型（manifest schema、14-token 契约等）—— **否**

**结论**：本次变更不触发 AGENTS.md §6 的 RFC 强制条件。但鉴于 workspaceStore 是 UI 层核心 store，改动影响面覆盖 Studio 全部交互（dock/inspector/drawer/tweak/raw CSS），主动提交 RFC 供评审。

---

## 3. 现状侦察（代码锚点）

### 3.1 workspaceStore 字段清单（26 个）

| # | 字段名 | 类型 | 所属关注点 | 初始化来源 |
|---|--------|------|-----------|-----------|
| 1 | viewMode | ViewMode | Studio 布局 | 硬编码 'single' |
| 2 | window | PreviewWindowState | Studio 布局 | makeWindow('w1', 'codex') |
| 3 | dock | DockState | Studio 布局 | 内联默认值 |
| 4 | inspector | InspectorState | Studio 布局 | 内联默认值 |
| 5 | drawer | DrawerState | Studio 布局 | 内联默认值 |
| 6 | activePresetId | string | Studio 布局 | 硬编码 'default' |
| 7 | dualPreviewActive | boolean | Studio 布局 | 硬编码 false |
| 8 | currentAgentId | AgentId \| null | Tweak 编辑 | null |
| 9 | currentPort | number \| null | Tweak 编辑 | null |
| 10 | currentOverrides | ToolOverride | Tweak 编辑 | {} |
| 11 | dirty | boolean | Tweak 编辑 | false |
| 12 | overridesByAgent | Record<string, ToolOverride> | Tweak 编辑 | loadOverridesByAgent() |
| 13 | pushError | string \| null | Tweak 编辑 | null |
| 14 | lastPushDurationMs | number \| null | Tweak 编辑 | null |
| 15 | avgPushDurationMs | number \| null | Tweak 编辑 | null |
| 16 | history | HistoryEntry[] | Undo/Redo | [] |
| 17 | historyIndex | number | Undo/Redo | -1 |
| 18 | tweakPresets | TweakPreset[] | 命名预设 | loadTweakPresets() |
| 19 | tweakPresetActiveId | string \| null | 命名预设 | null |
| 20 | rawSheets | Array\<{styleSheetId,url,...}\> | Raw CSS | [] |
| 21 | rawSheetIndex | number \| null | Raw CSS | null |
| 22 | rawCss | string | Raw CSS | '' |
| 23 | rawCssOriginal | string | Raw CSS | '' |
| 24 | rawDirty | boolean | Raw CSS | false |
| 25 | rawError | string \| null | Raw CSS | null |
| 26 | rawLoading | boolean | Raw CSS | false |

### 3.2 workspaceStore action 清单（29 个）

| # | action 名 | 所属关注点 |
|---|-----------|-----------|
| 1 | setViewMode | Studio 布局 |
| 2 | setWindowScale | Studio 布局 |
| 3 | setDockOpen | Studio 布局 |
| 4 | toggleDock | Studio 布局 |
| 5 | setDockHeight | Studio 布局 |
| 6 | setDockTab | Studio 布局 |
| 7 | setInspectorOpen | Studio 布局 |
| 8 | toggleInspector | Studio 布局 |
| 9 | setInspectorWidth | Studio 布局 |
| 10 | setInspectorTab | Studio 布局 |
| 11 | setDrawerOpen | Studio 布局 |
| 12 | toggleDrawer | Studio 布局 |
| 13 | setDrawerWidth | Studio 布局 |
| 14 | setDrawerCollapsed | Studio 布局 |
| 15 | applyPreset | Studio 布局 |
| 16 | setDualPreviewActive | Studio 布局 |
| 17 | toggleInspectMode | Studio 布局 |
| 18 | selectAgent | Tweak 编辑 |
| 19 | updateOverride | Tweak 编辑 |
| 20 | saveChanges | Tweak 编辑 |
| 21 | discardChanges | Tweak 编辑 |
| 22 | clearPushError | Tweak 编辑 |
| 23 | testResetPushToken | Tweak 编辑 |
| 24 | undo | Undo/Redo |
| 25 | redo | Undo/Redo |
| 26 | canUndo | Undo/Redo |
| 27 | canRedo | Undo/Redo |
| 28 | saveTweakPreset | 命名预设 |
| 29 | loadTweakPreset | 命名预设 |
| 30 | deleteTweakPreset | 命名预设 |
| 31 | renameTweakPreset | 命名预设 |
| 32 | exportTweakConfig | 命名预设 |
| 33 | importTweakConfig | 命名预设 |
| 34 | loadRawSheets | Raw CSS |
| 35 | selectRawSheet | Raw CSS |
| 36 | setRawCss | Raw CSS |
| 37 | applyRawEdit | Raw CSS |
| 38 | resetRawEdit | Raw CSS |
| 39 | clearRawError | Raw CSS |

### 3.3 外部消费方

| 消费方文件 | 订阅模式 | 主要使用字段 |
|-----------|---------|-------------|
| `StudioApp.tsx` | `useWorkspaceStore.getState()` | applyPreset, selectAgent |
| `StudioTopBar.tsx` | `useWorkspaceStore(selector)` | viewMode, dock, dualPreviewActive |
| `StudioDock.tsx` | `useWorkspaceStore(selector)` | dock, currentOverrides, dirty |
| `StudioInspector.tsx` | `useWorkspaceStore(selector)` | inspector, currentAgentId |
| `StudioDrawer.tsx` | `useWorkspaceStore(selector)` | drawer |
| `TweakPanel.tsx` | `useWorkspaceStore(selector)` | currentOverrides, dirty, pushError, history |
| `RawCssEditor.tsx` | `useWorkspaceStore(selector)` | rawSheets, rawCss, rawDirty, rawError |
| `WorkspaceSwitcher.tsx` | `useWorkspaceStore(selector)` | activePresetId, applyPreset |
| `useUndoRedo.ts` | `useWorkspaceStore.getState()` | undo, redo, canUndo, canRedo |
| `useTweakPresets.ts` | `useWorkspaceStore.getState()` | saveTweakPreset, loadTweakPreset |

---

## 4. 设计方案

### 4.1 子 store 拆分

将单一 `WorkspaceState` 按关注点拆分为 3 个子 store + 1 个 facade：

```
src/ui/stores/
  studioLayoutStore.ts      # Studio 布局：viewMode, window, dock, inspector, drawer, activePresetId, dualPreviewActive
  tweakStore.ts             # Tweak 实时编辑 + Undo/Redo + 命名预设
  rawCssStore.ts            # Raw CSS 编辑
  workspaceStore.ts         # facade：re-export 兼容 API
```

### 4.2 各子 store 职责

#### 4.2.1 studioLayoutStore（~200 行）

```ts
interface StudioLayoutState {
  viewMode: ViewMode;
  window: PreviewWindowState;
  dock: DockState;
  inspector: InspectorState;
  drawer: DrawerState;
  activePresetId: string;
  dualPreviewActive: boolean;

  // actions
  setViewMode: (mode: ViewMode) => void;
  setWindowScale: (scale: number) => void;
  setDockOpen: (open: boolean) => void;
  toggleDock: () => void;
  setDockHeight: (h: number) => void;
  setDockTab: (tab: DockTabId) => void;
  setInspectorOpen: (open: boolean) => void;
  toggleInspector: () => void;
  setInspectorWidth: (w: number) => void;
  setInspectorTab: (tab: InspectorTabId) => void;
  setDrawerOpen: (open: boolean) => void;
  toggleDrawer: () => void;
  setDrawerWidth: (w: number) => void;
  setDrawerCollapsed: (collapsed: boolean) => void;
  applyPreset: (presetId: string) => void;
  setDualPreviewActive: (active: boolean) => void;
  toggleInspectMode: () => void;
}
```

**迁移规则**：
- 字段 1–7 迁移至此；
- action 1–17 迁移至此；
- `applyPreset` 依赖 `WORKSPACE_PRESETS` 保持不变；
- 内部不依赖任何其他 store。

#### 4.2.2 tweakStore（~500 行）

```ts
interface TweakState {
  // Live tweak
  currentAgentId: AgentId | null;
  currentPort: number | null;
  currentOverrides: ToolOverride;
  dirty: boolean;
  overridesByAgent: Record<string, ToolOverride>;
  pushError: string | null;
  lastPushDurationMs: number | null;
  avgPushDurationMs: number | null;

  // Undo/Redo
  history: HistoryEntry[];
  historyIndex: number;

  // Named tweak presets
  tweakPresets: TweakPreset[];
  tweakPresetActiveId: string | null;

  // Live tweak actions
  selectAgent: (agentId: AgentId, port: number) => void;
  updateOverride: (key: keyof ToolOverride, value: ToolOverride[keyof ToolOverride]) => Promise<void>;
  saveChanges: () => Promise<boolean>;
  discardChanges: () => Promise<boolean>;
  clearPushError: () => void;
  testResetPushToken: () => void;

  // Undo/Redo actions
  undo: () => Promise<boolean>;
  redo: () => Promise<boolean>;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Named tweak preset actions
  saveTweakPreset: (name: string) => Promise<boolean>;
  loadTweakPreset: (id: string) => Promise<boolean>;
  deleteTweakPreset: (id: string) => Promise<boolean>;
  renameTweakPreset: (id: string, name: string) => Promise<boolean>;
  exportTweakConfig: () => string;
  importTweakConfig: (json: string) => Promise<{ ok: boolean; error?: string }>;
}
```

**迁移规则**：
- 字段 8–15（Tweak 编辑）、16–17（Undo/Redo）、18–19（命名预设）迁移至此；
- action 18–33 迁移至此；
- 持久化逻辑（`loadOverridesByAgent` / `persistOverridesByAgent` / `loadTweakPresets` / `persistTweakPresets`）整体迁移；
- 性能度量（`pushToAgent` / `recordPushDuration` / `PUSH_DURATION_HISTORY`）整体迁移；
- 不再持有 studio 布局字段，`selectAgent` 不再涉及 dock/inspector/drawer。

#### 4.2.3 rawCssStore（~200 行）

```ts
interface RawCssState {
  rawSheets: Array<{
    styleSheetId: string;
    url: string;
    disabled: boolean;
    isInline: boolean;
    sourceURL: string;
    length: string;
    label: string;
  }>;
  rawSheetIndex: number | null;
  rawCss: string;
  rawCssOriginal: string;
  rawDirty: boolean;
  rawError: string | null;
  rawLoading: boolean;

  // actions
  loadRawSheets: () => Promise<Array<{ styleSheetId: string; label: string }>>;
  selectRawSheet: (index: number) => Promise<void>;
  setRawCss: (css: string) => void;
  applyRawEdit: () => Promise<boolean>;
  resetRawEdit: () => Promise<boolean>;
  clearRawError: () => void;
}
```

**迁移规则**：
- 字段 20–26 迁移至此；
- action 34–39 迁移至此；
- `loadRawSheets` / `selectRawSheet` 依赖 `tweakStore.getState().currentPort` 获取端口（跨 store 依赖通过 `getState()` 调用，不引入模块耦合）；
- `applyRawEdit` / `resetRawEdit` 同理依赖 `currentPort` + `currentAgentId`。

### 4.3 Facade 兼容层

```ts
// workspaceStore.ts — facade
import { useStudioLayoutStore } from './studioLayoutStore';
import { useTweakStore } from './tweakStore';
import { useRawCssStore } from './rawCssStore';
import { shallow } from 'zustand/shallow';

/**
 * @deprecated 新代码请直接 import 对应子 store。
 * 本 facade 仅为兼容现有消费方，将在 v3 移除。
 */
export const useWorkspaceStore = <T>(selector: (state: CombinedWorkspaceState) => T): T => {
  const layout = useStudioLayoutStore();
  const tweak = useTweakStore();
  const raw = useRawCssStore();
  return selector({ ...layout, ...tweak, ...raw });
};

// 扩展 facade 以支持 getState()
useWorkspaceStore.getState = () => ({
  ...useStudioLayoutStore.getState(),
  ...useTweakStore.getState(),
  ...useRawCssStore.getState(),
});
```

### 4.4 跨 store 依赖

拆分后存在 1 处跨 store 依赖：

| 场景 | 来源 | 目标 | 解决方式 |
|------|------|------|---------|
| Raw CSS 编辑需要当前 agent 的 port | `rawCssStore.loadRawSheets()` | `tweakStore.currentPort` | `useTweakStore.getState().currentPort` |

此依赖是只读的、单向的，不构成循环依赖。`rawCssStore` 不持有 `tweakStore` 的引用，仅在 action 执行时通过 `getState()` 即时读取。

---

## 5. 风险与兜底

| # | 风险 | 等级 | 触发条件 | 兜底策略 | 检测机制 |
|---|------|------|----------|----------|----------|
| R1 | facade selector 性能劣化 | 中 | 多个子 store 状态同时变化 | facade 内使用 `shallow` equality；必要时回退为直接订阅子 store | 性能 profiling（Chrome DevTools Performance tab） |
| R2 | `selectAgent` 不再重置 dock/inspector | 中 | 拆分后 `selectAgent` 仅存在于 tweakStore | 确认现有行为：`selectAgent` 原本就不操作 dock/inspector，仅重置 history | 手动验证 selectAgent 行为不变 |
| R3 | `applyPreset` 不再重置 tweak 状态 | 中 | 拆分后 `applyPreset` 仅存在于 studioLayoutStore | 确认现有行为：`applyPreset` 原本就不操作 currentOverrides/history | 手动验证 applyPreset 行为不变 |
| R4 | facade `getState()` 返回快照不一致 | 低 | 并发修改多个子 store | `getState()` 是同步操作，返回调用时刻的快照，不存在中间状态 | 代码审查 |
| R5 | 测试迁移遗漏导致回归 | 中 | 迁移后部分行为未覆盖 | 迁移时保持 100% 测试覆盖率不变；新增边界用例 | `npm test` 覆盖率报告 |
| R6 | `rawCssStore` 跨 store 读取 `currentPort` 为 null | 低 | 用户未选择 agent 就打开 Raw CSS 面板 | 保持现有行为：`loadRawSheets` 检测 `!currentPort` 后设置 `rawError` | 单元测试覆盖 |

---

## 6. 迁移策略

### Phase 1: 子 store 骨架 + facade（低风险，~1.5 天）

1. 创建 `src/ui/stores/studioLayoutStore.ts`，迁移 Studio 布局字段和 action；
2. 创建 `src/ui/stores/tweakStore.ts`，迁移 Tweak 编辑 + Undo/Redo + 命名预设字段和 action；
3. 创建 `src/ui/stores/rawCssStore.ts`，迁移 Raw CSS 编辑字段和 action；
4. 改写 `workspaceStore.ts` 为 facade，re-export 兼容 API；
5. 验证：`npm run check` 全绿，现有消费方零修改通过。

**验证清单**：
- [ ] `npm run check` 全绿
- [ ] 现有 `useWorkspaceStore` 订阅正常工作
- [ ] 现有 `useWorkspaceStore.getState()` 调用正常工作
- [ ] `applyPreset` 行为不变（dock/inspector/drawer 切换）
- [ ] `selectAgent` 行为不变（overrides 恢复、history 重置）
- [ ] `updateOverride` 行为不变（debounce push、dirty 标记）
- [ ] `undo/redo` 行为不变
- [ ] `loadRawSheets/selectRawSheet/applyRawEdit` 行为不变
- [ ] `saveTweakPreset/loadTweakPreset` 行为不变

### Phase 2: 测试迁移（低风险，~1 天）

1. 将 `workspaceStore.test.ts` 拆分为 `studioLayoutStore.test.ts`、`tweakStore.test.ts`、`rawCssStore.test.ts`；
2. 各子 store 测试独立运行，mock 范围缩小到本关注点；
3. 新增 facade 兼容性测试（验证 `useWorkspaceStore.getState()` 返回完整状态）。

**验证清单**：
- [ ] 各子 store 测试独立运行通过
- [ ] facade 兼容性测试通过
- [ ] 测试覆盖率不低于拆分前

### Phase 3: 渐进迁移消费方（低风险，~1 天）

1. 将高频消费方（`TweakPanel.tsx`、`RawCssEditor.tsx`、`StudioDock.tsx`）迁移到直接订阅子 store；
2. 保留 facade 供低频消费方继续使用；
3. 标记 facade 为 `@deprecated`。

**验证清单**：
- [ ] 迁移后的消费方功能正常
- [ ] 未迁移的消费方通过 facade 正常工作
- [ ] `npm run check` 全绿

---

## 7. 向后兼容

| 项目 | 兼容性保证 |
|------|-----------|
| `useWorkspaceStore` hook | 100% 兼容——facade 透传所有 selector |
| `useWorkspaceStore.getState()` | 100% 兼容——facade 扩展 `.getState()` |
| `WorkspaceState` 类型 | 通过 facade 保持可用 |
| 持久化数据 | 不变——localStorage key / 版本号保持不变 |
| 外部 IPC 接口 | 不变——本次改动仅限 UI 层 |
| 测试文件 | 迁移后保持 100% 测试通过 |

---

## 8. 验收标准

### 8.1 功能验收

- [ ] Studio 布局切换（dock/inspector/drawer 开合、预设切换）功能不变
- [ ] Tweak 实时编辑（slider 拖动、color picker、push to agent）功能不变
- [ ] Undo/Redo 功能不变
- [ ] 命名预设（保存/加载/删除/重命名/导出/导入）功能不变
- [ ] Raw CSS 编辑（加载 stylesheet/编辑/应用/重置）功能不变

### 8.2 技术验收

- [ ] `npm run check` 全绿
- [ ] `npm test` 全通过
- [ ] 测试覆盖率不低于拆分前
- [ ] 各子 store 文件行数：`studioLayoutStore.ts` ≤ 250 行，`tweakStore.ts` ≤ 550 行，`rawCssStore.ts` ≤ 250 行
- [ ] facade `workspaceStore.ts` ≤ 50 行
- [ ] 无新增第三方依赖

### 8.3 性能验收

- [ ] `setRawCss` 不再触发 `dock.open` 的订阅者重渲染
- [ ] `setDockOpen` 不再触发 `currentOverrides` 的订阅者重渲染
- [ ] `updateOverride` 不再触发 `rawSheets` 的订阅者重渲染

---

## 9. 人工复核项

1. **跨 store 依赖合理性**：`rawCssStore` 通过 `getState()` 读取 `tweakStore.currentPort` 是否可接受？或应通过 props 传递？
2. **facade 性能**：`useWorkspaceStore` facade 每次渲染合并 3 个子 store 状态，是否会导致不必要的重渲染？需在实际场景 profiling 验证。
3. **测试迁移完整性**：`workspaceStore.test.ts` 的所有用例是否全部正确迁移到子 store 测试？
4. **持久化时机**：拆分后 `overridesByAgent` 和 `tweakPresets` 的持久化时机是否与拆分前完全一致？

---

## 10. 评审结论

（评审意见汇总，由评审人填写）

---

*End of RFC.*
