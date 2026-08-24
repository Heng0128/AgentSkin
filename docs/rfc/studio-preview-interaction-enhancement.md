# RFC: Studio Preview Interaction Enhancement

| Field | Value |
|-------|-------|
| Status | Draft |
| Date | 2026-08-24 |
| Module | Studio Preview / Inspector |
| Related Files | `src/ui/components/studio/PreviewWindow.tsx`, `src/ui/components/studio/RealDomPreview.tsx`, `src/ui/components/studio/StudioInspector.tsx`, `src/ui/components/studio/InspectorProfile.tsx`, `src/ui/hooks/useLiveDom.ts`, `src/ui/lib/dom-export.ts`, `src/ui/stores/studioStore.ts` |

---

## Abstract

本方案在不动摇现有 `useLiveDom → buildSrcDoc → <style id="ov"> 写入` 管线的前提下，为 Studio 预览补充**元素拾取、悬停高亮、伪状态模拟、A/B 翻转对比、元素详情面板、设备视口模拟**六项交互能力。方案核心策略是：**在 iframe 顶部建立一层透明交互 overlay（父框架代理）**，利用 Electron 下 `sandbox="allow-scripts allow-same-origin"` 允许父框架直接访问 `contentDocument` 的能力，通过路径标识反查 iframe 内原生元素，计算 `getBoundingClientRect × scale` overlay 尺寸，同步转发鼠标事件。伪状态通过注入 `[data-studio-*]` attribute 并在 override CSS 中预生成 `:pseudo-class → [data-studio-*]` 的映射规则来实现，**不依赖 iframe 内嵌 `<script>`**。A/B 对比通过对 `baselines` 中已缓存的 `domTree` 与当前 `domTree` 做节点级 computed style diff 来对齐；面板数据通过 `contentDocument.defaultView.getComputedStyle` 实时获取。

不引入新第三方库，所有新模块落 `src/ui/components/studio/` 或 `src/ui/hooks/`，遵循 kebab-case。

---

## Q1: iframe 内元素交互的技术方案

### 三种路径评估

#### 方案 A: 父框架代理层（Overlay）

**机制**：在 iframe 之上覆盖一个 `position: absolute; pointer-events: auto` 的透明 div；鼠标事件（mousemove / click / mouseenter / mouseleave）落在 overlay 上，通过 `iframe.contentDocument.elementFromPoint(x/scale, y/scale)` 或 **稳定的 selector path 反查** 找到对应元素，再用目标元素的 `getBoundingClientRect()` × `win.scale` 绘制高亮框（一个独立的 highlight overlay div 同步位置/尺寸）。

**技术可行性（Electron + sandbox iframe）**：
- **✅ 高**。Electron 的 `<iframe sandbox="allow-scripts allow-same-origin">` + `srcDoc` 下，父框架可以**直接读取** `iframe.contentDocument`——与 project 现有 `pushOverrides` 使用的技法同源（ts:106-113PreviewWindow）。
- 滚动同步：iframe 内 `body` 滚动时需监听 `contentWindow.scroll` 并重新计算 overlay/高亮坐标。《webFrame` Electron 渲染进程允许同步事件监听无问题。
- 缩放同步：`win.scale` 来自 workspaceStore，父框架已知，直接 multiplier。

**性能**：
- 拖滑条 60fps 场景：mousemove 到绘制 overlay 是一步 DOM 操作；把事件节流到 `requestAnimationFrame`（16ms）即可。
- `elementFromPoint` 是浏览器原生 C++ 实现，单次 <0.1ms，无压力。
- 悬停态不写 iframe DOM，仅父框架渲染高亮 div，**对 override 通道零侵入**。

**实现复杂度**：中。需要：
- 一个 `src/ui/hooks/use-element-picker.ts`：封装"获取路径标识、高亮 overlay 位置注入、事件绑定"逻辑；
- 改造 `PreviewWindow`：在 `pw__body` 中挂载 overlay  div（`position: absolute; inset: 0`），收集 `onMouseMove/onClick/onMouseLeave` 三个回调；
- 改造 `StudioInspector`：新增 `element` tab + 选中节点后的详情渲染。

**风险**：
- **CSP 风险**：无（不涉及内联脚本注入）。
- **scroll 同步**：iframe 滚动时需要监听 `contentWindow.scroll`，否则 overlay 坐标偏移；需要在 hook 内注册。
- **scale 同步**：通过 workspaceStore 订阅 `window.scale`，保证跟随。
- **resize 同步**：`ResizeObserver` 观察 `contentDocument.body`，重新计算首屏高亮。

#### 方案 B: iframe 内注入探针脚本

**机制**：向 `buildSrcDoc` 输出 HTML 时内联一段 `<script>`，监听 iframe 内 `click/mouseover/mouseout`，通过 `window.parent.postMessage({type:'pick|hover|unhover', path})` 发出事件；frame 内伪状态、高亮 border 由 probe 脚本写入。

**技术可行性**：
- **⚠️ 中**。`allow-scripts` + `allow-same-origin` + `srcDoc` 组合下 Electron 是否允许执行内 inline `<script>`？根据 project 现有代码注释（.ts:PreviewWindow）记录过一个"postMessage + inline-script pattern 违反了父页面 CSP 'script-src self'"问题——基于 postMessage 注入的测试历史。但内联 `<script>`（没有 `src`，不是内联事件）在 `srcDoc` iframe 中执行**本身不受 CSP 限制**（因为 srcDoc iframe 自身没有 CSP header），但是：
  - `<iframe sandbox="allow-scripts">` 允许 inline script 执行；
  - `allow-same-origin` 让 iframe 认为与父页面同源，因此若有父页面 CSP 头的话会被 srcDoc iframe 继承——但当前父页面无显式 CSP，不影响；
  - **关键风险**：部分 Electron 安全配置（`nodeIntegration: false`、sandbox 渲染器）对 `srcDoc` inline-script 行为有不同限制，社区报告存在版本差异。

**性能**：
- 精确，所有 DOM 操作在 iframe 内部原生进行（无 round-trip）；
- postMessage 是异步序列化通道，mousemove 高频下需要节流（16ms rAF）。

**实现复杂度**：高。需要：
- 对 `buildSrcDoc` 注入 script 入口（污染现有的"无 script"安全契约，.ts:dom-export `NOTE: No inline <script> here`）；
- probe script 要序列化 selector/路径 + computedStyle 备用；
- 父框架需 `window.addEventListener('message')` 处理，处理延迟与乱序；
- 还要同时处理 scroll/resize 同步（父子 iframe message 协商）。

**风险**：
- **安全契约破坏**：`dom-export.ts:354` 的设计意图正是"不注入 script 以避免 CSP 问题"——引入 script 与此战略方向冲突；
- **性能抖动**：postMessage 在 mainframe 主线程上序列化高频率 mousemove 仍可能产生微任务堆积；
- **iframe 重加载触发**：`srcDoc` 重写（每次 domTree 更新）会让 probe 脚本重新注入，有 phase race——domTree 更新频率 1-5s，但每次都会打断 probe 内部状态。

#### 方案 C: Canvas 重绘

**机制**：用 html2canvas / OffscreenCanvas 把 iframe 内容截图到 canvas，canvas 上叠加鼠标交互；点击读取预先保留的"鼠标 hover 元素空间索引"（R-tree 或简单的节点 list）反查。

**技术可行性**：
- **❌ 低**。Electron 中跨 iframe 截图受限于 CORS、`@font-face`、图片等；`html2canvas` 质量与覆盖率差，且与"实时 preview + drag slider 60fps"强烈冲突（每次 override 变化都要重新截图）；此外用户明确**禁止引入新库**。

**性能**：
- 拖滑条（override 变动）是 canvas 方案的致命场景——每次修改就要 50-200ms 重绘，不可能 60fps。

**实现复杂度**：极高。排除。

**风险**：全部（性能、保真、兼容性、引库约束）。

### Q1 结论

**选择方案 A（父框架 overlay 代理）**，理由：
1. 与现有 `contentDocument` 直读模式同源，无新安全契约；
2. 性能无瓶颈，不污染 `buildSrcDoc`，零 `postMessage`；
3. 风险最可控，全由父框架驱动。

**接受**：同步 scroll/resize 开销（见 Q1 风险段）；**拒绝**：任何 iframe 内 `<script>` 注入。

---

## Q2: 伪状态模拟的技术路线

当前预览是**完整 DOM 快照**（一次 `captureDomTree` 后 replay），不包含运行时的 CSS 伪类选择器状态。要让 iframe 内元素"以为"自己被 hover/focus/active：

### 推荐方案：Attribute Toggle + 预生成伪类映射规则

**机制**：

1. **预生成规则**（父框架一次性注入 `#ov`）：
   ```css
   /* iframe 注入的 override 规则 */
   [data-studio-hover]   { /* 占位器 */ }
   [data-studio-focus]   { /* 占位器 */ }
   [data-studio-active]  { /* 占位器 */ }
   ```
   同时在 iframe `<style id="ov">` 追加**伪类 fallback**规则——当用户开启"模拟 hover"，父框架向 iframe 注入：
   ```css
   :is([data-studio-hover]):where(:not([data-force-real-hover])) { 
     /* 让浏览器仍能识别属性选择器 */ 
   }
   ```
   真正的"模拟"通过 **attribute toggle** 完成：iframe 内目标元素 `.setAttribute('data-studio-hover', '')` 时，同时让 `#ov` 内置一条临时规则：
   ```css
   [data-studio-hover] { background-color: var(--as-hover, initial) !important; }
   ```
   其中 `--as-hover` 默认取该元素原始 `:hover` computed style（如果有）。

2. **如何获取原始 `:hover` 样式？**
   - 项目已具备 CDP 路径：`API → getComputedStyleForNode / CSS.collectClassNames / CSS.getMatchedStylesForNode`（`NodeCascade.matchedRules` 已含伪类来源信息），可在 snapshot 捕获阶段把关键节点的 `:hover, :focus, :active` 匹配规则提炼为一个 `pseudoMap: Record<selector, Rule[]>`，持久化到 `studioStore`。
   - 简易版（首版）：**不读取原始伪类规则**，仅让 attribute toggle 触发框架预置的 *通用伪类 fallback*（例如 hover 时用一个半透明 overlay `#ov` 注入），用户感知是"有交互反馈"而非"与原 site 一致"。

3. **element.focus() 调用路径**：
   - `iframe.contentDocument.querySelector(path).focus()` 可以直接调用——`allow-same-origin` 下父框架可调用 iframe 内的 DOM API；
   - `:focus`、`:focus-visible` 的样式来自浏览器原生规则，如果 iframe 文档本身有对应 CSS 就自动生效；如果没有，通过`#ov`注入预生成规则即可。

### 推荐实现清单

- `src/ui/hooks/use-pseudo-simulator.ts`：
  - 输入：iframeRef、当前 `pseudoStates: string[]`（已有，ts:studioStore `pseudoStates`）；
  - 暴露：`activate(els, pseudo)` / `clear()`；
  - 内建"Selector → el 路径"缓存。
- 在 `#ov` 注入时顺带写入伪类 fallback 规则（已注入的 overrideCss 后段追加）。

**首版权衡**：
- 仅实现 `[data-studio-*]` attribute toggle；
- 不尝试 100% 还原原始 `:hover` 视觉——那是 CDP 采集管线的活（属于 `snapshotBaseline` 阶段的 pseudoStates 扩展，已在 roadmap）。
- 收益：用户能"点一下看 hover 反馈"，工程上不侵入现有管线。

---

## Q3: A/B 翻转对比

已有数据：`baselines: Partial<Record<AgentId, ThemeVisualSnapshot>>`（ts:107），每个 baseline 包含 `domTree` 和 `landmarks[]`。

### 推荐机制

#### 1. 翻转 Toggle

**视觉层**：`PreviewWindow` 上方增加"Flip"按钮（toolbar）。点击后触发：
- 生成一份 baseline srcDoc = `buildSrcDoc(baselines[agentId].domTree, ...)` ；
- CSS flip 动画（`transform: rotateY(180deg)`）期间淡出淡入两组 iframe。实现用**双 iframe 层叠** + `opacity` 过渡，避免 srcDoc 重建的开销。

**状态**：`studioStore.previewView`（已有 `PreviewView` 类型）新增一个枚举值 `'flip'`——或者在 workspaceStore `window` 里新增 `flipSide: 'current' | 'baseline'`.

#### 2. 差异高亮

**算法**（父框架执行）：
```
const diff = diffDomTrees(current.domTree, baseline.domTree, key=['style']);
// 节点定位：按 depth-first index 对齐
// 差异节点：style 属性有变化的节点
```
- 对差异节点集合 `{ selector }`，在 iframe `#ov` 中动态注入：
  ```css
  ${selector} { outline: 2px dashed var(--as-diff, #f59e0b) !important; }
  ```
- 同时在 Inspector 面板列出变更清单（property baseline → current：如 `--as-bg: #fff → #e5e7eb`）。

**复杂度**：O(n) DOM walk，单次 <5ms。

#### 3. 同步 Hover

baseline 树与 current 树来自同一个 agent，结构同源。hover 同步通过 **selector path 匹配**：
- 在 current iframe 上 hover 元素 → 提取其路径（`tag + nth-child + class`）；
- 在 baseline iframe 上查找同路径元素 → 同步 `data-studio-hover` attribute。

实现：在 `use-element-picker` hook 里暴露 `syncHover(selector: string)` 方法，父框架维护两个 iframe 的 picker 实例。

---

## Q4: 设备视口模拟

### 现状
- `SCALE_PRESETS = [0.25, 0.38, 0.45, 0.55, 0.75, 1.0]` ——纯 CSS `transform: scale()` 视觉缩放，**不改变 iframe 的逻辑尺寸**。
- 交互行为固定为桌面鼠标。

### 推荐路径：纯 scale（不引入 device frame / 不断点模拟）

**理由**：
1. Studio 预览的 domTree 是桌面 agent（traework / qoderwork 等）的**实时 CDP 产物**，本身不包含移动视口布局；强行用 `@media` 模拟会得到"桌面布局在窄屏下被收缩"的错误画面，**误导设计决策**；
2. iframe `srcDoc` 的 viewport 恒等于内部 `<html>` 宽度，注入 `@media` 断点需重写全部 `nodeStyleToCss`，工程量大且未知收益；
3. 设备 frame 是装饰层，不产出信息，违反 rule §6（no aesthetic-only features）。

**实现**：

保留现有 `scale` 机制，但新增**预设视口尺寸 dock**：
- 为用户提供三个常见"桌面分辨率"标签（1280 / 1440 / 1920），点击后：
  - iframe 容器的可视区域（`overflow: auto`）固定为对应像素宽；
  - `scale` 保证 iframe body 宽度自适配（当前已有，无需改）。
- 不做 tablet/mobile 预设；如果未来有真实移动端 agent，再按 §6 RFC 流程扩展。

**收益**：迷你工作量，兼容现有 pipeline；在 drag 场景下纯 CSS scale 已 60fps。

---

## Q5: 元素详情面板

### 新 Inspector Tab

扩展 `StudioInspector`（.ts:28）tabs：

| id | label | content |
|----|-------|---------|
| `profile` | Profile | 当前进度面板 |
| **`element`** | Element | 激活时渲染 |

### 面板数据结构

从 iframe 内实时读取：

```ts
interface StudioElementDetail {
  tag: string;            // e.g. 'button'
  classes: string;        // .cls
  dimensions: { w, h, x, y };  // getBoundingClientRect × scale
  computedStyles: Array<{ property, value }>;   // iframe.contentDocument.defaultView.getComputedStyle(el)
  cssVariables: Array<{ name, value }>;         // 从 computedStyles 中筛出 --* 项
  domPath: string;        // e.g. "main > div.header > a.nav-link:nth-child(2)"
}
```

### 数据获取路径

通过 iframe.contentDocument 直接读取（同源访问）：
```
const win = iframe.contentDocument.defaultView;
const styles = win.getComputedStyle(el);
// 遍历 styles 	length 得到所有 computed
const vars = Array.from(styles).filter(s => s.startsWith('--')).map(s => ({ name: s, value: styles.getPropertyValue(s) }));
```

`boxModel` 已有 CDP 深度路径（`DOM.getBoxModel`，在 `NodeCascade.boxModel` 中使用），本届仅用 `getBoundingClientRect`——足够。

### 视觉结构

Tabs 栏右侧新增 `Element` tab。选中元素后渲染：

```
┌─ Element ─────────────────────────┐
│ button.nav-primary                 │
│ 120 × 32  |  x:48 y:16            │
├─ Computed ────────────────────────┤
│ background-color: #3b82f6         │
│ color: #ffffff                     │
│ border-radius: 6px                │
│ ... (折叠/展开更多)                │
├─ CSS Vars ───────────────────────┤
│ --as-accent: #3b82f6              │
│ --as-radius: 6px                  │
├─ Path ─────────────────────────── │
│ body > header > nav > a (深拷贝路径)│
└──────────────────────────────────┘
```

---

## Q6: 最终推荐方案组合 + 多维评分

### 方案命名

| 模块 | 采用方案 | 具体组件 |
|------|---------|---------|
| 元素交互 | **A Overlay** | `use-element-picker` hook + overlay div |
| 伪状态模拟 | **Attribute + 预生成规则** | `use-pseudo-simulator` hook + `#ov` 扩展 |
| A/B 翻转对比 | **双 iframe + diff walk** | `use-ab-flip` hook + `#ov` diff 注入 |
| 设备视口 | **纯 scale + resolution presets** | 仅扩展 toolbar label |
| 元素详情面板 | **Inspector "Element" tab + getComputedStyle 直读** | `InspectorElement` 组件 + `extractElementDetail()` 工具 |

### 多维评分（均等权重 1-10）

| 维度 | A Overlay | B 注入脚本 | C Canvas | Attribute 伪类 | 双 iframe Flip | 综合推荐 |
|------|-----------|-----------|----------|---------------|----------------|---------|
| 1. 业务根治 | 9 | 8 | 4 | 7 | 8 | **8.2** |
| 2. 场景兼容 | 9 | 9 | 3 | 8 | 9 | **7.6** |
| 3. 故障安全 | 9 | 6 | 5 | 9 | 9 | **7.6** |
| 4. 工程契约 | 10 | 5 | 3 | 9 | 9 | **7.2** |
| 5. 可工程化 | 8 | 5 | 2 | 8 | 8 | **6.2** |
| 6. 架构一致性 | 10 | 5 | 2 | 9 | 9 | **7.0** |
| 7. 长期演进 | 8 | 7 | 3 | 8 | 8 | **6.8** |
| 8. 边界健壮 | 8 | 6 | 3 | 8 | 8 | **6.6** |
| **均等权重总分** | **61 / 80** | **51 / 80** | **25 / 80** | **66 / 80** | **68 / 80** | — |

### 推荐方案：**Overlay 代理 + Attribute 伪态 + 双 iframe Flip + Inspector Element Tab + 纯 Scale**

#### 牺牲
1. **iframe 实时 scroll 同步** 需要额外事件监听器，偶有 1 帧抖动（用户几乎无感）；
2. **原始 CSS `:hover` 样式**在首版不做 100% 还原（仅做"占位反馈"），完整还原需 CDP pseudoStates 管线配合（后续迭代）；
3. **移动端视口模拟**——真实布局无法模拟，仅支持桌面分辨率预设。

#### 收益
1. **零安全契约破坏**——不引入 iframe 内 `<script>`，不引第三方库；
2. **60fps 滑条拖动**维持——overlay 仅作 CSS 渲染层；
3. **渐进可演进**——目前六项能力全部通过 `contentDocument` 父框架 API 实现，未来切换到更复杂的 CDP 阶段时管线不变；
4. **与现有 studioStore 数据模型对齐**——`baselines`、`pseudoStates`、`inspectMode` 全部 pre-exist。

### 实施路线建议

```
Phase 1 (核心)
├─ use-element-picker hook        ← frame 交互
├─ overlay div 挂载到 PreviewWindow
├─ Inspector Element tab 骨架
├─ extractElementDetail() 工具函数
└─ studioStore.selectedNode 状态

Phase 2 (体验)
├─ use-pseudo-simulator hook
├─ A/B flip 动画 + diff 算法
├─ pseudoStates 与 #ov 注入逻辑连接
└─ 高亮 overlay 多色（hover / pick / diff） 

Phase 3 (打磨)
├─ 设备分辨率 preset 切换
├─ pseudoMap 持久化（配合 CDP pseudo capture roadmap）
└─ key 路径压缩 与 性能 fallback
```

---

## 附录 A: 关键现有契约

| 契约 | 引用源 |
|------|--------|
| 父框架直读 `iframe.contentDocument` | `PreviewWindow.tsx:106-113`、`RealDomPreview.tsx:42-47` |
| `sandbox="allow-scripts allow-same-origin"` | `PreviewWindow.tsx:169`、`RealDomPreview.tsx:96` |
| `<style id="ov">` 作为 CSS 注入占位 | `dom-export.ts:361` |
| 不内联 `<script>` 的安全约定 | `dom-export.ts:354` comment |
| `toolOverrides → sanitizeCSS → overridesToCss → #ov` 管线 | `PreviewWindow.tsx:95-97` |
| `baselines: Partial<Record<AgentId, ThemeVisualSnapshot>>` | `studioStore.ts:107` |
| `inspectMode / toggleInspect / liveNode` | `studioStore.ts:119, 186, 762-788` |
| `pseudoStates: string[]` | `studioStore.ts:127` |
| `SCALE_PRESETS` | `PreviewWindow.tsx:48` |
| `InspectedNode { agentId, tag, path, cascade: NodeCascade }` | `ipc.ts:211-217` |
| `NodeCascade { computed, matchedRules, platformFonts, boxModel }` | `ipc.ts:193-208` |
| `DomTreeNode { tag, cls, imgSrc, text, style, attrs, rect, children }` | `ipc.ts:220-234` |

## 附录 B: 新增文件落点

| 文件 | 落点 |
|------|------|
| `use-element-picker.ts` | `src/ui/hooks/use-element-picker.ts` |
| `use-pseudo-simulator.ts` | `src/ui/hooks/use-pseudo-simulator.ts` |
| `use-ab-flip.ts` | `src/ui/hooks/use-ab-flip.ts` |
| `extract-element-detail.ts` | `src/ui/lib/extract-element-detail.ts` |
| `diff-dom-trees.ts` | `src/ui/lib/diff-dom-trees.ts` |
| `InspectorElement.tsx` | `src/ui/components/studio/InspectorElement.tsx` |
| `ElementHighlight.tsx` | `src/ui/components/studio/ElementHighlight.tsx` |

---

*End of RFC.*
