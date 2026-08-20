# RFC 2026-08-20 工作台体验升级（Workspace UX Upgrade）

> 状态：`待评审`
> 日期：2026-08-20
> 分支：`feature/inspection-2026-08-13-1400-J-theme-contract`
> 范围：WorkspacePage / TweakPanel / AgentLivePreview / workspaceStore / workspace-presets

---

## 1. 背景与目标

### 1.1 现状痛点

工作台（Workspace）当前是"一次性会话式微调"——用户切换 agent 即丢失微调值（已通过 per-agent localStorage 缓解），但仍有核心体验短板：

| # | 痛点 | 用户影响 |
|---|------|----------|
| 1 | 无撤销/重做 | 误操作无法回退，单次 discard 丢失全部历史 |
| 2 | TweakPanel 控件平铺 | 7 个控件全平铺，扩展性为零，新增参数时 UI 线性增长 |
| 3 | 预览区无元素选取 | 用户不知道 "accent 控制哪个按钮"，参数-视觉认知鸿沟 |
| 4 | 无命名预设保存 | 无法保存/加载多组 tweak 配置，无法跨设备共享 |
| 5 | Preset 名实不符 | compare/multi-agent 暗示的功能未实现，用户困惑 |

### 1.2 目标

将工作台从"一次性会话式微调"升级为"专业级可视化微调工作站"：

- **撤销/重做**：内存维护 20 步历史栈，支持 Ctrl+Z / Ctrl+Shift+Z
- **参数分组**：按 shape/typography/color/motion 分组折叠，扩展性提升
- **元素选取**：点击预览区元素，自动定位对应参数
- **命名预设**：保存/加载多组 tweak 配置，支持跨设备导入/导出
- **预设增强**：compare 预设提供真正的 A/B 双预览对比

### 1.3 非目标

- 不突破六页封顶（工作台页面保留，不新增）
- 不重构注入架构（L0-L4 不动）
- 不修改 14-token 主题契约
- 不新增适配器
- 不打破 single-window 不变量（辅窗口仅做只读对比，不重复 TweakPanel）
- 不引入 Monaco Editor（保持 textarea，降低 bundle 压力）

---

## 2. 触发条件（对照 AGENTS.md §6）

- [x] 重构注入架构（L0-L4 注入层）— **否**
- [x] 新增 UI 页面（突破六页封顶）— **否**
- [x] 新增适配器（突破六适配器上限）— **否**
- [x] 修改核心数据模型（manifest schema、14-token 契约等）— **否**

**结论**：本次改动不触发 RFC 强制条件，但为保持工程透明度，仍提交 RFC 备查。

---

## 3. 现状侦察（代码锚点）

### 3.1 核心文件

| 文件 | 行数 | 职责 |
|------|------|------|
| `src/ui/pages/WorkspacePage.tsx` | 295 | 工作台页面编排 |
| `src/ui/stores/workspaceStore.ts` | 579 | 状态管理（overrides、dirty、pushError、rawCss） |
| `src/ui/components/workspace/AgentLivePreview.tsx` | 120 | 实时预览（DOM 快照缓存 + 后台刷新） |
| `src/ui/components/workspace/TweakPanel.tsx` | 251 | 调整面板（7 控件平铺） |
| `src/ui/types/workspace.ts` | 181 | 类型定义（PreviewWindowState、DockState、InspectorState、DrawerState） |
| `src/ui/stores/workspace-presets.ts` | 76 | 预设定义（5 种布局预设） |

### 3.2 关键类型

**ToolOverride**（20+ 字段，8 类）：

```ts
export interface ToolOverride {
  // shape
  radius?: string; spacing?: number; shadowLevel?: 'none' | 'sm' | 'md' | 'lg' | 'xl';
  blurPx?: number; borderWidth?: number;
  // color
  accent?: string; background?: string; foreground?: string; surface?: string;
  // typography
  fontSize?: number; fontFam?: string; lineHeight?: number;
  // motion
  duration?: string; timing?: string;
  // layout / density
  scale?: number; separators?: boolean;
  // filter
  invert?: boolean; contrast?: number; saturate?: number;
  // visual effects
  dim?: number; opacity?: number;
  // gradient
  gradientAccent?: boolean;
  // full semantic palette
  colors?: Record<string, string>;
}
```

**WorkspaceStore 关键字段**：

```ts
interface WorkspaceState {
  viewMode: ViewMode;           // Always 'single'
  windows: PreviewWindowState[]; // ← 永远只有 1 个元素，僵尸抽象
  activeWindowId: string | null;
  dock: DockState;
  inspector: InspectorState;
  drawer: DrawerState;
  activePresetId: string;
  // --- live tweak ---
  currentAgentId: AgentId | null;
  currentPort: number | null;
  currentOverrides: ToolOverride;
  dirty: boolean;
  overridesByAgent: Record<string, ToolOverride>; // per-agent 持久化
  pushError: string | null;
  // --- raw CSS editing ---
  rawSheets: Array<{ styleSheetId: string; label: string; ... }>;
  rawSheetIndex: number | null;
  rawCss: string;
  rawCssOriginal: string;
  rawDirty: boolean;
  rawError: string | null;
  rawLoading: boolean;
}
```

### 3.3 现有 IPC 接口

```ts
// 实时微调
pushTweak(session: TweakSession, overrides: ToolOverride): Promise<boolean>;
saveTweakAsCustomCss(session: TweakSession, overrides: ToolOverride): Promise<boolean>;
resetTweak(session: TweakSession): Promise<boolean>;
// CSS 编辑
listStyleSheets(port: number): Promise<Array<{ styleSheetId: string; ... }>>;
getStyleSheetText(port: number, styleSheetId: string): Promise<string>;
applyRawCssEdit(port: number, agentId: AgentId, css: string): Promise<{ ok: boolean; error?: string }>;
// 快照
snapshotBaseline(agentId: AgentId, options?: StudioSnapshotOptions): Promise<ThemeVisualSnapshot>;
snapshotThemeDom(agentId: AgentId, themeId?: string, options?: StudioSnapshotOptions): Promise<ThemeVisualSnapshot>;
```

---

## 4. 设计方案

### 4.1 改动总览

| # | 文件 | 改动类型 | 说明 |
|---|------|---------|------|
| M1 | `src/ui/stores/workspaceStore.ts` | 修改 | windows 数组清理为单一 window 字段 |
| M2 | `src/ui/stores/workspaceStore.ts` | 修改 | updateOverride 防抖 150ms |
| M3 | `src/ui/stores/workspaceStore.ts` | 修改 | undo/redo 历史栈（20 步） |
| M4 | `src/ui/stores/workspaceStore.ts` | 修改 | localStorage 版本迁移 |
| M5 | `src/ui/stores/workspace-presets.ts` | 修改 | compare 预设增强为 A/B 双预览 |
| M6 | `src/ui/components/workspace/TweakPanel.tsx` | 重构 | 参数分组折叠 + 覆盖指示 + 单维度重置 |
| M7 | `src/ui/components/workspace/TweakPanel.tsx` | 修改 | 命名预设 save/load UI |
| M8 | `src/ui/components/workspace/AgentLivePreview.tsx` | 修改 | 元素选取 click-listener + 降级方案 |
| M9 | `src/ui/pages/WorkspacePage.tsx` | 修改 | 快捷键绑定 + 预设增强 UI + 导出/导入 UI |
| M10 | `src/ui/types/workspace.ts` | 修改 | 新增 TweakPreset、HistoryEntry 类型 |
| T1 | `tests/ui/workspaceStore.test.ts` | 新增/修改 | 新增逻辑覆盖 |
| T2 | `tests/ui/WorkspacePage.test.tsx` | 新增 | 页面交互测试 |
| T3 | `tests/ui/TweakPanel.test.tsx` | 新增 | 参数分组 + 覆盖指示测试 |

### 4.2 M1：windows 数组清理

**问题**：`windows` 数组永远只有 1 个元素，`activeWindowId`、`setActiveWindow`、`updateWindow` 均为死代码。

**改动**：
1. 前置 grep 审计确认零消费
2. `windows: PreviewWindowState[]` → `window: PreviewWindowState`
3. `activeWindowId: string | null` → 移除
4. `setActiveWindow`/`updateWindow` → 移除
5. 类型注释更新，移除 "deprecated" 标注

### 4.3 M2：updateOverride 防抖

**问题**：slider 每次 `onChange` 触发完整 `pushTweak`，快速拖动产生大量 CDP 调用。

**改动**：

```ts
// 新增防抖机制
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 150;

updateOverride: async (key, value) => {
  // 乐观更新：UI 立即反映
  const next: ToolOverride = { ...get().currentOverrides, [key]: value };
  set({ currentOverrides: next, dirty: true, pushError: null });

  // 防抖推送：150ms 内多次变更只推送最后一次
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    void pushToAgent(get().currentAgentId, get().currentPort, next);
  }, DEBOUNCE_MS);
}
```

### 4.4 M3：undo/redo 历史栈

**问题**：单次 discard 即丢失全部操作历史，无法回退。

**改动**：

```ts
// 新增类型
interface HistoryEntry {
  overrides: ToolOverride;
  timestamp: number;
}

// 新增 state
history: HistoryEntry[];       // 历史栈
historyIndex: number;          // 当前指针（-1 = 无历史）
MAX_HISTORY = 20;              // 最大步数

// 新增 actions
pushHistory: (entry: HistoryEntry) => void;
undo: () => Promise<boolean>;
redo: () => Promise<boolean>;
canUndo: () => boolean;
canRedo: () => boolean;
```

**行为**：
- 每次 `updateOverride` 成功后压栈
- undo：historyIndex--，应用上一状态，不重复推送 CDP
- redo：historyIndex++，应用下一状态
- 新操作压栈时清除 redo 分支
- unmount 时清空

### 4.5 M4：localStorage 版本迁移

**问题**：`overridesByAgent` schema 变更时旧数据静默损坏。

**改动**：

```types
const STORAGE_KEY = 'workspace.overridesByAgent';
const STORAGE_VERSION_KEY = 'workspace.version';
const CURRENT_VERSION = 1;

interface StorageWrapper {
  version: number;
  data: Record<string, ToolOverride>;
}

function loadOverridesByAgent(): Record<string, ToolOverride> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    // 版本迁移
    if (parsed._version === 1) return parsed.data;
    // 旧格式（无 _version）直接返回
    if (typeof parsed === 'object' && !parsed._version) return parsed;
    return {};
  } catch {
    return {};
  }
}

function persistOverridesByAgent(map: Record<string, ToolOverride>): void {
  try {
    const wrapper = { _version: CURRENT_VERSION, data: map };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(wrapper));
    localStorage.setItem(STORAGE_VERSION_KEY, String(CURRENT_VERSION));
  } catch { /* quota 降级 */ }
}
```

### 4.6 M5：compare 预设增强

**问题**：preset 名为 "compare" 但无对比功能。

**改动**：

```ts
// workspace-presets.ts
{
  id: 'compare',
  label: 'A/B 对比',
  viewMode: 'single',
  dock: { open: true, height: 280 },
  inspector: { collapsed: false, width: 280 },
  drawer: { collapsed: true, width: 240 },
  // 新增：启用双预览对比模式
  dualPreview: true,
}
```

**UI 行为**：
- 选择 compare 预设时，预览区域垂直分割为左右两半
- 左半：当前主题+overrides 渲染
- 右半：原始基线（无 overrides）渲染
- 两半共享同一 TweakPanel，变更实时同步到左半
- 辅半仅渲染 RealDomPreview，不单独建立 CDP 连接

### 4.7 M6：TweakPanel 参数分组折叠

**问题**：7 控件全平铺，扩展性为零。

**改动**：

```ts
// 新增参数分组定义
const OVERRIDE_GROUPS = [
  {
    id: 'shape',
    label: '形状',
    fields: ['radius', 'spacing', 'shadowLevel', 'blurPx', 'borderWidth'],
  },
  {
    id: 'typography',
    label: '排版',
    fields: ['fontSize', 'fontFam', 'lineHeight'],
  },
  {
    id: 'color',
    label: '颜色',
    fields: ['accent', 'background', 'foreground', 'surface'],
  },
  {
    id: 'motion',
    label: '动效',
    fields: ['duration', 'timing'],
  },
] as const;
```

**UI 行为**：
- 每组一个可折叠 header（`<details>/<summary>` 语义化）
- 默认展开 color 组，其余折叠
- 每个控件前增加覆盖状态指示点（● 表示已覆盖，○ 表示默认）
- 每个控件右侧增加重置小按钮（↺）

### 4.8 M7：命名预设 save/load

**问题**：无法保存/加载多组 tweak 配置。

**改动**：

```ts
// 新增类型
interface TweakPreset {
  id: string;
  name: string;
  agentId: AgentId;
  overrides: ToolOverride;
  createdAt: string;
  updatedAt: string;
}

// 新增 state
tweakPresets: TweakPreset[];
activePresetId: string | null;

// 新增 actions
saveTweakPreset: (name: string) => Promise<boolean>;
loadTweakPreset: (id: string) => Promise<boolean>;
deleteTweakPreset: (id: string) => Promise<boolean>;
renameTweakPreset: (id: string, name: string) => Promise<boolean>;
```

**存储**：localStorage `workspace.tweakPresets`，LRU 淘汰（最多 50 组）。

### 4.9 M8：Inspect-to-Tweak 元素选取

**问题**：用户不知道参数控制哪个元素。

**改动**：

```ts
// AgentLivePreview 新增 props
interface Props {
  agentId: string;
  overrides: ToolOverride;
  t: UiMessages;
  inspectMode: boolean;       // 新增
  onElementPicked: (ref: string) => void; // 新增
}

// iframe 注入 click-listener（仅同域）
function injectClickInspector(iframe: HTMLIFrameElement, callback: (ref: string) => void) {
  try {
    const doc = iframe.contentDocument;
    if (!doc) return;
    doc.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const ref = target.getAttribute('data-as-ref') ?? target.tagName.toLowerCase();
      callback(ref);
      e.preventDefault();
      e.stopPropagation();
    }, { capture: true });
  } catch {
    // 跨域降级：listener 注入失败，不阻塞
  }
}
```

**降级方案**：
- 同域 iframe：正常注入 click-listener
- 跨域 iframe / CDP 不可用：显示手动输入 selector 输入框
- 选取超时（5 秒无操作）：自动退出 inspect 模式

### 4.10 M9：导出/导入

**问题**：tweak 配置无法跨设备共享。

**改动**：

```ts
// 导出：复制到 clipboard 或下载 JSON
exportTweakConfig: () => string;  // 返回 JSON string

// 导入：粘贴 JSON 或选择文件
importTweakConfig: (json: string) => Promise<{ ok: boolean; error?: string }>;
```

**安全**：
- JSON Schema 校验（必填字段、类型约束）
- try/catch 包裹，校验失败弹窗提示
- 导入后自动应用并压入历史栈

### 4.11 M10：类型扩展

```ts
// workspace.ts 新增
export interface TweakPreset {
  id: string;
  name: string;
  agentId: AgentId;
  overrides: ToolOverride;
  createdAt: string;
  updatedAt: string;
}

export interface HistoryEntry {
  overrides: ToolOverride;
  timestamp: number;
}

export type TweakGroupId = 'shape' | 'typography' | 'color' | 'motion';

export interface TweakGroupConfig {
  id: TweakGroupId;
  label: string;
  fields: Array<keyof ToolOverride>;
}
```

---

## 5. 风险与兜底

| # | 风险 | 等级 | 触发条件 | 兜底策略 | 检测机制 |
|---|------|------|----------|----------|----------|
| R1 | iframe 跨域注入失败 | 中 | Agent 页面 CSP/X-Frame-Options 限制 | 降级到手动输入 selector | 注入失败时 UI 切换 |
| R2 | undo/redo 内存增长 | 低 | 长时间使用 | 20 步上限 + unmount 清空 | 内存监控 |
| R3 | localStorage 配额超限 | 低 | 大量命名预设 | LRU 淘汰 + try-catch 降级 | 写入前大小检查 |
| R4 | JSON 导入污染 | 低 | 外部恶意 JSON | Schema 校验 + 错误弹窗 | 校验失败率统计 |
| R5 | 防抖导致"最后一步丢失" | 低 | 快速拖动后立即切换 agent | selectAgent 前 flush 防抖 | agent 切换时检查 |

---

## 6. 分批落地计划

### 批次 1：基础设施修复（M1+M2+M4）

| 任务 | 文件 | 验证 |
|------|------|------|
| M1 windows 清理 | workspaceStore.ts | grep 零引用确认 |
| M2 防抖 | workspaceStore.ts | slider 快速拖动测试 |
| M4 版本迁移 | workspaceStore.ts | 旧格式兼容测试 |

### 批次 2：核心交互增强（M3+M6+M7）

| 任务 | 文件 | 验证 |
|------|------|------|
| M3 undo/redo | workspaceStore.ts | 20 步历史栈测试 |
| M6 参数分组 | TweakPanel.tsx | 折叠/展开 + 覆盖指示测试 |
| M7 命名预设 | workspaceStore.ts + TweakPanel.tsx | save/load CRUD 测试 |

### 批次 3：高级功能（M5+M8+M9）

| 任务 | 文件 | 验证 |
|------|------|------|
| M5 A/B 对比 | workspace-presets.ts + AgentLivePreview.tsx | 双预览面板测试 |
| M8 元素选取 | AgentLivePreview.tsx | 同域/跨域降级测试 |
| M9 导出/导入 | WorkspacePage.tsx | JSON 校验 + 错误提示测试 |

### 批次 4：全量验收（M10 + T1-T3）

| 任务 | 文件 | 验证 |
|------|------|------|
| M10 类型扩展 | workspace.ts | tsc --noEmit |
| T1 单元测试 | workspaceStore.test.ts | 新增逻辑覆盖 ≥ 80% |
| T2 页面测试 | WorkspacePage.test.tsx | 交互测试通过 |
| T3 组件测试 | TweakPanel.test.tsx | 分组 + 覆盖指示测试 |

---

## 7. 人工复核项

1. **iframe 降级体验** — 跨域 iframe 的手动输入 selector 交互是否自然？
2. **A/B 对比布局** — 双预览面板在小屏（1280px 以下）是否可接受？
3. **参数分组的默认展开** — 是否应该记住用户上次展开的组？
4. **导出/导入的 UX** — 从哪个入口触发？侧栏按钮？右上角菜单？

---

## 8. 评审结论

（评审意见汇总，由评审人填写）

