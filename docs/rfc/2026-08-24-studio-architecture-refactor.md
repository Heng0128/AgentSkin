# RFC: Studio 架构减重 + 预览交互增强

| Field | Value |
|-------|-------|
| 状态 | 待评审 |
| 日期 | 2026-08-24 |
| 分支 | — |
| 范围 | `src/ui/stores/studioStore.ts`, `src/ui/components/studio/`, `src/ui/hooks/`, `src/ui/studio/`（新增） |
| 关联 RFC | `docs/rfc/studio-preview-interaction-enhancement.md`（β 子方案已独立评审） |

---

## 1. 背景与目标

### 1.1 现状痛点

**studioStore 膨胀**：当前 `src/ui/stores/studioStore.ts` 是一个 800+ 行的单一 Zustand store，承载了 projects、bundles、baselines、preview/inspect、capture controls、image-to-theme、wallpaper-to-theme、export、visual analysis、health check 共 10 个独立域的状态与逻辑。这导致：

- 任意域的状态更新都触发全量 selector 重订阅，性能随状态增长线性退化；
- 跨域耦合（如 `selectProject` 需要重置 `undoStack`、`pinnedSelectors`、`pseudoStates` 等）使修改难以安全推进；
- 测试文件 `studioStore.imageToTheme.test.ts` 需要 mock 整个 store 才能测试单一域行为。

**预览交互缺失**：Studio 预览目前仅能"看"——用户无法拾取元素、模拟伪状态、对比 A/B 差异、查看元素详情。这限制了 Studio 作为"设计调试工具"的核心价值。

### 1.2 目标

1. 将 studioStore 拆分为 5 个职责单一的子 store + 1 个 facade，每个 store 不超过 200 行；
2. 新增元素拾取、伪状态模拟、A/B 翻转、元素详情面板四项预览交互能力；
3. 保持 100% 向后兼容——现有消费方（22 处 `useStudioStore` 调用、4 处 `getState()` 调用）无需修改即可继续工作；
4. 不引入任何新第三方库。

### 1.3 非目标

- 不重构注入架构（L0-L4 层）；
- 不新增 UI 页面（仍在六页封顶内）；
- 不新增适配器；
- 不修改 14-token 主题契约；
- 不做移动端视口模拟（仅桌面分辨率预设）；
- 不做 100% 原始 `:hover` 样式还原（首版仅做占位反馈）。

---

## 2. 触发条件（对照 AGENTS.md §6）

- [x] 重构注入架构（L0-L4 注入层）—— **否**，不涉及注入层
- [x] 新增 UI 页面（突破六页封顶）—— **否**，仍在 Studio 页内
- [x] 新增适配器（突破六适配器上限）—— **否**
- [x] 修改核心数据模型（manifest schema、14-token 契约等）—— **否**，studioStore 是 UI 层本地状态，非核心数据模型

**结论**：本次变更不触发 AGENTS.md §6 的 RFC 强制条件，但鉴于改动跨 10+ 文件且涉及 store 架构调整，主动提交 RFC 供评审。

---

## 3. 现状侦察（代码锚点）

| 锚点 | 文件 | 说明 |
|------|------|------|
| `StudioStoreState` 接口 | `studioStore.ts:85-272` | 10 个域的状态 + 50+ 方法 |
| `useStudioStore` 创建 | `studioStore.ts:312` | `create<StudioStoreState>()` |
| `selectProject` 跨域重置 | `studioStore.ts:433-447` | 重置 undo/redo/pinned/pseudo/scheme/inspecting |
| `pushOverrides` 直读 contentDocument | `PreviewWindow.tsx:102-115` | 父框架直读 iframe DOM 模式 |
| `sandbox="allow-scripts allow-same-origin"` | `PreviewWindow.tsx:169` | 允许父框架访问 contentDocument |
| `<style id="ov">` 注入占位 | `dom-export.ts:361` | override CSS 写入目标 |
| `SCALE_PRESETS` | `PreviewWindow.tsx:48` | 纯 CSS scale 缩放机制 |
| `baselines` 数据结构 | `studioStore.ts:107` | `Partial<Record<AgentId, ThemeVisualSnapshot>>` |
| `pseudoStates` | `studioStore.ts:127` | 已有伪状态字段 |
| `inspectMode / toggleInspect / liveNode` | `studioStore.ts:119,186,762-788` | 已有 inspect 基础设施 |
| `useStudioStore.getState()` 外部调用 | `StudioApp.tsx:68`, `DockTabExport.tsx:36-37`, `StudioCenterPanel.tsx:38`, `StudioTopBar.tsx:47,50,118` | 4 处外部 getState 调用 |
| `useStudioStore` 订阅调用 | 22 处（遍布 studio 组件） | selector 订阅模式 |

---

## 4. 设计方案

### 4.1 α：studioStore 架构减重

#### 4.1.1 子 store 拆分

将单一 `StudioStoreState` 按域拆分为 5 个子 store：

```
src/ui/studio/
  project-store.ts          # Zustand create：projects/activeProjectId/CRUD/agent binding
  bundle-store.ts           # Zustand create：bundles/refreshBundles/install/delete
  capture-store.ts          # Zustand create：previewView/baseline/liveDom/export/inspect
  image-wallpaper-store.ts  # Zustand create：imageToTheme/wallpaperPreview/wallpaperApply
  sync-hooks.ts             # onAgentChange 跨域同步机制
  index.ts                  # re-export 所有子 store + 旧 useStudioStore 类型别名
useStudioStore.ts           # facade：import 各子 store 并 re-export 兼容 API
```

#### 4.1.2 各子 store 职责

**project-store.ts**（~150 行）

```ts
interface ProjectState {
  projects: StudioProject[];
  activeProjectId: string | null;
  creatingProject: boolean;
  newName: string;
  newAuthor: string;
  newAgent: AgentId;
  importing: boolean;
  editingId: string | null;
  editName: string;
  editAuthor: string;
  installedThemes: ThemeCatalogItem[];
  themeLibraryOpen: boolean;
  // actions
  refreshProjects(): Promise<void>;
  createProject(): Promise<void>;
  importProject(): Promise<void>;
  deleteProject(id: string): Promise<void>;
  renameProject(p: StudioProject, name: string, author: string): Promise<void>;
  saveActiveProject(patch: Partial<StudioProject>): Promise<void>;
  selectProject(id: string | null): void;
  changeAgent(agentId: AgentId): Promise<void>;
  // ... simple setters
}
```

**bundle-store.ts**（~100 行）

```ts
interface BundleState {
  bundles: StudioBundle[];
  bundlesLoading: boolean;
  refreshBundles(): Promise<void>;
  importAndInstallBundle(): Promise<string | null>;
  installBundle(id: string): Promise<void>;
  deleteBundle(id: string): Promise<void>;
}
```

**capture-store.ts**（~200 行）

```ts
interface CaptureState {
  previewView: PreviewView;
  inspectingIdx: number | null;
  searchQuery: string;
  hoveredIdx: number | null;
  toolOverrides: ToolOverride | null;
  undoStack: (ToolOverride | null)[];
  redoStack: (ToolOverride | null)[];
  inspectMode: boolean;
  liveNode: InspectedNode | null;
  liveError: string | null;
  pinnedSelectors: string[];
  pseudoStates: string[];
  captureSchemes: boolean;
  customSelectorInput: string;
  pseudoView: string | null;
  schemeView: 'light' | 'dark' | null;
  baselines: Partial<Record<AgentId, ThemeVisualSnapshot>>;
  baselineLoadingMap: Partial<Record<AgentId, boolean>>;
  baselineErrorMap: Partial<Record<AgentId, string>>;
  exportName: string;
  exportAuthor: string;
  exportState: ExportState;
  // actions
  baselineSnapshot(): Promise<void>;
  restoreAgent(): Promise<void>;
  exportTheme(): Promise<void>;
  toggleInspect(): Promise<void>;
  setOverride(key, value): void;
  resetOverrides(): void;
  undo(): void;
  redo(): void;
  // ... capture setters
}
```

**image-wallpaper-store.ts**（~150 行）

```ts
interface ImageWallpaperState {
  // Image → Theme
  imageToThemeStatus: 'idle' | 'extracting' | 'ready' | 'error';
  imageToThemeError: string | null;
  imageToThemeMode: 'light' | 'dark' | null;
  imageToThemePalette: ThemeColorsFromImage | null;
  imageToThemeAccent: string | null;
  // Wallpaper → Theme
  wallpaperPreviewPalette: ThemeColorsFromImage | null;
  wallpaperPreviewLoading: boolean;
  wallpaperPreviewError: string | null;
  wallpaperApplyLoading: boolean;
  wallpaperApplyError: string | null;
  // actions
  extractImageFromImage(base64: string): Promise<void>;
  applyImageToTheme(): void;
  clearImageToTheme(): void;
  setImageAccent(hex: string): void;
  previewWallpaperTheme(wallpaperId: string): void;
  applyWallpaperTheme(wallpaperId: string): Promise<boolean>;
  clearWallpaperPreview(): void;
}
```

#### 4.1.3 跨域同步机制（sync-hooks.ts）

跨域同步通过 `subscribe` 实现，避免子 store 直接依赖彼此：

```ts
// sync-hooks.ts
import { useProjectStore } from './project-store';
import { useCaptureStore } from './capture-store';
useProjectStore.subscribe(
  (state) => state.activeProjectId,
  (activeId, prevId) => {
    if (activeId !== prevId) {
      // 场景 1: selectProject 变化 → 重置 captureStore
      useCaptureStore.setState({
        previewView: 'theme',
        undoStack: [],
        redoStack: [],
        pinnedSelectors: [],
        pseudoStates: [],
        inspectingIdx: null,
      });
    }
  }
);

// 场景 2: deleteBundle → 如删的是当前 activeProjectId 绑定的 bundle
import { useBundleStore } from './bundle-store';
// 在 bundle-store 的 deleteBundle action 内：
// if (deletedBundle.projectId === useProjectStore.getState().activeProjectId) {
//   useProjectStore.getState().saveActiveProject({ activeBundleId: null });
// }

// 场景 3: projectStore.changeAgent → captureStore 的 liveDom 需要重新拉取
useProjectStore.subscribe(
  (state) => state.activeProjectId,
  () => {
    useCaptureStore.setState({ liveNode: null, liveError: null });
  }
);

// 场景 4: captureStore.baselines 更新 → imageWallpaperStore 不联动（确认无关）
```

#### 4.1.4 Facade 兼容层（useStudioStore.ts）

```ts
// useStudioStore.ts — facade
import { useProjectStore } from './project-store';
import { useBundleStore } from './bundle-store';
import { useCaptureStore } from './capture-store';
import { useImageWallpaperStore } from './image-wallpaper-store';

/**
 * @deprecated 新代码请直接 import 对应子 store。
 * 本 facade 仅为兼容现有消费方，将在 v2 移除。
 */
export const useStudioStore = <T>(selector: (state: CombinedState) => T): T => {
  const project = useProjectStore();
  const bundle = useBundleStore();
  const capture = useCaptureStore();
  const imageWallpaper = useImageWallpaperStore();
  const combined = { ...project, ...bundle, ...capture, ...imageWallpaper };
  return selector(combined);
};
```

**注意**：Facade 模式对 `getState()` 的兼容需要特殊处理——由于 facade 是 hook，无法直接 `getState()`。解决方案：

```ts
// 扩展 facade 以支持 getState
useStudioStore.getState = () => ({
  ...useProjectStore.getState(),
  ...useBundleStore.getState(),
  ...useCaptureStore.getState(),
  ...useImageWallpaperStore.getState(),
});
```

#### 4.1.5 兼容性要点

| 消费方 | 当前用法 | 兼容方案 |
|--------|----------|----------|
| `StudioApp.tsx:68` | `useStudioStore.getState().initAnalysisProgressSubscription()` | facade 提供 `.getState()` |
| `DockTabExport.tsx:36-37` | `useStudioStore.getState().setExportName(...)` | facade 提供 `.getState()` |
| `StudioCenterPanel.tsx:38` | `useStudioStore.getState().setPreviewView(v)` | facade 提供 `.getState()` |
| `StudioTopBar.tsx:47,50,118` | `useStudioStore.getState().undo()/redo()/setPreviewView()` | facade 提供 `.getState()` |
| `studioStore.imageToTheme.test.ts` | 22 处 `useStudioStore.getState()` | 迁移到 `useImageWallpaperStore.getState()` |
| 22 处组件订阅 | `useStudioStore((s) => s.xxx)` | facade selector 透传 |

---

### 4.2 β：预览交互增强

> 详细方案见 `docs/rfc/studio-preview-interaction-enhancement.md`。本节仅列出与 α 的集成点和新增文件。

#### 4.2.1 新增文件

| 文件 | 职责 |
|------|------|
| `src/ui/hooks/use-element-picker.ts` | 元素拾取：`elementFromPoint` 反查、mousemove/click 事件注册、暴露 `{ overlayRect, highlightRect, isPicking, pickedPath, hoveredPath }` |
| `src/ui/hooks/use-pseudo-force.ts` | 伪状态模拟：向 srcDoc head 注入 `<style id="pseudo-fallback">` 包含 `[data-studio-*]` 规则，暴露 `{ forceHover(path), forceFocus(path), forceActive(path), clear() }` |
| `src/ui/components/studio/dom-highlight.tsx` | overlay 高亮框组件：接收 hoveredPath / pickedPath / iframeRef / scale，渲染两个绝对定位 div（hover=蓝色 translucent，pick=橙色边框） |
| `src/ui/components/studio/inspector-element.tsx` | 元素详情面板：当选中 tab='element'，展示 tag/cls/size/computed styles/css vars/breadcrumb |
| `src/ui/components/studio/ab-flip.tsx` | A/B 翻转对比：FlipContainer 包装两个 iframe（baseline vs current），展示差异 dashed outline + 同步 hover |

#### 4.2.2 改造现有文件

| 文件 | 改造内容 |
|------|----------|
| `src/ui/components/studio/PreviewWindow.tsx` | 加 overlay 层（`position: absolute; inset: 0`）+ 设备分辨率 preset dock（1280/1440/1920） |
| `src/ui/components/studio/StudioInspector.tsx` | 新增 `element` tab，选中时渲染 `InspectorElement` |
| `src/ui/hooks/useLiveDom.ts` | 注入伪态 fallback CSS 到 srcDoc `<style id="ov">` 尾部 |
| `src/ui/stores/studioStore.ts` | 由 α 减重任务改写（保留 preview* 数据给 capture-store） |

#### 4.2.3 技术决策

1. **父框架 overlay 代理**（非 iframe 内注入脚本）：利用 Electron `sandbox="allow-scripts allow-same-origin"` 允许父框架直接访问 `contentDocument` 的能力，所有交互逻辑在父框架执行，不破坏"无 inline script"安全契约。

2. **Attribute Toggle + 预生成伪类映射**：伪状态通过向 iframe 内元素设置 `[data-studio-hover]` 等 attribute，并在 `#ov` 中预生成 `:pseudo-class → [data-studio-*]` 的映射规则实现。首版不做 100% 原始 `:hover` 视觉还原。

3. **双 iframe + diff walk**：A/B 对比通过双 iframe 层叠 + opacity 过渡实现翻转动画，差异节点通过 O(n) DOM walk 按 depth-first index 对齐后注入 dashed outline。

4. **纯 scale + resolution presets**：保留现有 CSS `transform: scale()` 机制，新增三个桌面分辨率标签（1280/1440/1920），不做 tablet/mobile 预设。

5. **scroll/resize 同步**：注册 `contentWindow.scroll` 事件 + rAF 重算 overlay 坐标；`ResizeObserver` 观察 `contentDocument.body` 重新计算首屏高亮。

---

## 5. 改动文件清单

### 5.1 新增文件（11 个）

| 文件 | 所属方案 |
|------|----------|
| `src/ui/studio/project-store.ts` | α |
| `src/ui/studio/bundle-store.ts` | α |
| `src/ui/studio/capture-store.ts` | α |
| `src/ui/studio/image-wallpaper-store.ts` | α |
| `src/ui/studio/sync-hooks.ts` | α |
| `src/ui/studio/index.ts` | α |
| `src/ui/studio/useStudioStore.ts` | α |
| `src/ui/hooks/use-element-picker.ts` | β |
| `src/ui/hooks/use-pseudo-force.ts` | β |
| `src/ui/components/studio/dom-highlight.tsx` | β |
| `src/ui/components/studio/inspector-element.tsx` | β |
| `src/ui/components/studio/ab-flip.tsx` | β |

### 5.2 改造文件（4 个）

| 文件 | 所属方案 | 改造幅度 |
|------|----------|----------|
| `src/ui/components/studio/PreviewWindow.tsx` | β | 加 overlay 层 + resolution presets |
| `src/ui/components/studio/StudioInspector.tsx` | β | 新增 element tab |
| `src/ui/hooks/useLiveDom.ts` | β | 追加伪态 fallback CSS |
| `src/ui/stores/studioStore.ts` | α | 拆分为子 store 后缩减为 deprecated re-export |

### 5.3 测试迁移（1 个）

| 文件 | 说明 |
|------|------|
| `src/ui/stores/__tests__/studioStore.imageToTheme.test.ts` | 迁移到 `src/ui/studio/__tests__/image-wallpaper-store.test.ts` |

---

## 6. 技术决策

### D1: 为什么用 facade 而非直接替换所有消费方？

**选择**：保留 `useStudioStore` facade 作为兼容层，新代码直接 import 子 store。

**理由**：
- 22 处组件订阅 + 4 处 `getState()` 外部调用，全部替换需要同步修改所有消费方，风险高；
- facade 模式允许渐进迁移——消费方按需切换到子 store，无需一次性全量修改；
- facade 标记 `@deprecated`，在 v2 移除。

**替代方案**：直接替换所有消费方。被否决——改动面大、风险高、无额外收益。

### D2: 为什么用 `subscribe` 跨域同步而非直接调用？

**选择**：`sync-hooks.ts` 通过 `useProjectStore.subscribe()` 监听变化，跨域重置其他 store。

**理由**：
- 子 store 之间无直接依赖，保持模块边界清晰；
- `subscribe` 是 Zustand 原生 API，无额外开销；
- 同步逻辑集中在一处，便于排查和测试。

**替代方案**：在 `selectProject` action 内直接调用 `useCaptureStore.setState()`。被否决——project-store 将依赖 capture-store，破坏模块边界。

### D3: 为什么 capture-store 保留 previewView 而非 project-store？

**选择**：`previewView` 放在 capture-store。

**理由**：
- `previewView` 控制预览区显示模式（theme/wallpaper/bundle/raw），与 capture/inspect 流程强关联；
- `StudioTopBar` 的 tab 切换调用 `setPreviewView`，与 undo/redo 同属 capture 域；
- `selectProject` 重置 `previewView='theme'` 通过 sync-hooks 完成，语义清晰。

### D4: 为什么不做 100% 原始 `:hover` 样式还原？

**选择**：首版仅做 attribute toggle + 通用 fallback 反馈。

**理由**：
- 100% 还原需要 CDP `CSS.getMatchedStylesForNode` 管线在 snapshot 阶段采集伪类规则，工程量大；
- 首版目标是"有交互反馈"，非"与原 site 一致"；
- 完整还原可后续迭代（配合 CDP pseudoStates 扩展 roadmap）。

---

## 7. 替代方案

### A: 不拆分 store，仅加预览交互

**描述**：保持 studioStore 现状，仅新增 β 交互能力。

**优点**：改动小，风险低。

**缺点**：studioStore 膨胀问题持续存在，后续维护成本递增；新增的 capture-store 逻辑会进一步加剧膨胀。

**结论**：被否决——α + β 联合实施一次性解决架构问题，避免后续反复。

### B: 完全重写 studioStore（不保留 facade）

**描述**：拆分子 store 同时替换所有消费方。

**优点**：无 deprecated 代码，架构最干净。

**缺点**：改动面大（26+ 文件），回归风险高；无渐进迁移路径。

**结论**：被否决——facade 方案在零风险前提下达成相同目标。

### C: 引入 Redux Toolkit 替代 Zustand

**描述**：借机迁移到 RTK + createSlice。

**优点**：RTK 生态更成熟。

**缺点**：违反 AGENTS.md §2"技术栈不可随意新增"；全仓库 12 store 迁移成本极高；Zustand v5 已满足需求。

**结论**：被否决。

---

## 8. 实施计划

### Phase 1: α — store 拆分 + facade（低风险，~2 天）

1. 创建 `src/ui/studio/` 目录
2. 实现 `project-store.ts`（迁移 projects + activeProjectId + CRUD）
3. 实现 `bundle-store.ts`（迁移 bundles + refreshBundles/install/delete）
4. 实现 `capture-store.ts`（迁移 preview/inspect/capture/baseline/export）
5. 实现 `image-wallpaper-store.ts`（迁移 imageToTheme + wallpaperPreview/Apply）
6. 实现 `sync-hooks.ts`（跨域同步）
7. 实现 `useStudioStore.ts` facade（兼容层）
8. 实现 `index.ts`（re-export）
9. 迁移测试 `imageToTheme.test.ts` → `image-wallpaper-store.test.ts`
10. 验证：`npm run check` 全绿，现有 26 处消费方零修改通过

**验证清单**：
- [ ] `npm run check` 全绿
- [ ] 现有 22 处 `useStudioStore` 订阅正常工作
- [ ] 现有 4 处 `useStudioStore.getState()` 调用正常工作
- [ ] `selectProject` 跨域重置行为不变
- [ ] undo/redo 行为不变
- [ ] imageToTheme 流程不变

### Phase 2: β — 核心交互（中风险，~3 天）

1. 实现 `use-element-picker.ts` hook
2. 实现 `dom-highlight.tsx` 组件
3. 改造 `PreviewWindow.tsx`：加 overlay 层 + 拾取事件接入
4. 实现 `inspector-element.tsx` 组件
5. 改造 `StudioInspector.tsx`：新增 element tab
6. 实现 `use-pseudo-force.ts` hook
7. 改造 `useLiveDom.ts`：注入伪态 fallback CSS

**验证清单**：
- [ ] iframe 内元素可拾取，高亮框位置准确（含 scale 缩放）
- [ ] scroll 同步：iframe 滚动时 overlay 坐标实时更新
- [ ] resize 同步：body 尺寸变化时 overlay 重新计算
- [ ] 伪状态模拟：hover/focus/active 可触发视觉反馈
- [ ] 元素详情面板：tag/cls/size/computed styles 正确显示
- [ ] 60fps 滑条拖动不受影响
- [ ] `npm run check` 全绿

### Phase 3: β — 对比 + 打磨（低风险，~2 天）

1. 实现 `ab-flip.tsx` 组件
2. 实现 diff 算法（O(n) DOM walk，按 depth-first index 对齐）
3. 改造 `PreviewWindow.tsx`：加 Flip 按钮 + resolution presets
4. 同步 hover 跨双 iframe
5. 差异清单面板（property baseline → current）

**验证清单**：
- [ ] A/B 翻转动画流畅
- [ ] 差异节点 dashed outline 正确标注
- [ ] 同步 hover 在 baseline/current 双 iframe 间正确联动
- [ ] 分辨率 preset 切换正常
- [ ] `npm run check` 全绿

---

## 9. 风险与兜底

| # | 风险 | 等级 | 触发条件 | 兜底策略 | 检测机制 |
|---|------|------|----------|----------|----------|
| R1 | facade selector 性能劣化 | 中 | 多个子 store 状态同时变化 | facade 内使用 `shallow` equality；必要时回退为直接订阅子 store | 性能 profiling（Chrome DevTools Performance tab） |
| R2 | sync-hooks 时序问题 | 中 | 跨域同步触发顺序不一致 | 使用 Zustand `subscribeWithSelector` middleware 精确监听；添加集成测试 | 手动验证 selectProject → captureStore 重置时序 |
| R3 | iframe scroll 同步抖动 | 低 | 快速滚动时 overlay 坐标延迟 1 帧 | rAF 节流已覆盖；用户几乎无感 | 手动快速滚动测试 |
| R4 | 伪态 fallback CSS 与 override CSS 冲突 | 低 | `#ov` 内规则优先级问题 | fallback CSS 追加在 override CSS 之后；使用 `:where()` 降低 specificity | 视觉回归测试 |
| R5 | 测试迁移遗漏导致回归 | 中 | 迁移后部分行为未覆盖 | 迁移时保持 100% 测试覆盖率不变；新增边界用例 | `npm test` 覆盖率报告 |
| R6 | Electron 版本差异导致 contentDocument 访问失败 | 低 | 特定 Electron 版本安全策略变更 | try-catch 包裹 + 降级为"无交互模式"（仅展示） | 多 Electron 版本 CI 测试 |

---

## 10. 向后兼容

| 项目 | 兼容性保证 |
|------|-----------|
| `useStudioStore` hook | 100% 兼容——facade 透传所有 selector |
| `useStudioStore.getState()` | 100% 兼容——facade 扩展 `.getState()` |
| `StudioStoreState` 类型 | 通过 `index.ts` re-export 保持可用 |
| 测试文件 | 迁移后保持 100% 测试通过 |
| 外部 IPC 接口 | 不变——本次改动仅限 UI 层 |
| 持久化数据 | 不变——无 schema 变更 |

---

## 11. 人工复核项

1. **facade 性能**：`useStudioStore` facade 每次渲染合并 4 个子 store 状态，是否会导致不必要的重渲染？需在实际场景 profiling 验证。
2. **sync-hooks 时序**：`selectProject` → `captureStore` 重置是否为原子操作？是否存在中间状态被订阅者观察到的窗口？
3. **iframe 安全契约**：`use-pseudo-force.ts` 注入 `[data-studio-*]` attribute 是否被所有 6 个适配器的目标应用允许？（部分应用可能有严格的 attribute 白名单）
4. **测试迁移完整性**：`studioStore.imageToTheme.test.ts` 的 22 处 `getState()` 调用是否全部正确迁移？

---

## 12. 评审结论

（评审意见汇总，由评审人填写）

---

*End of RFC.*
