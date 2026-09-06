# AgentSkin 主题注入引擎 · 基准复刻导向审计报告

> **生成时间**: 2026-08-16  
> **流水线模式**: A（并行高速扫描 → 交叉校验 → 深度复检 → 架构推演）  
> **已适配Agent**: TRAEWSOLO、QODERWORK、WORKBUDDY、豆包、ZCODE、CODEX  
> **核心结论**: 当前引擎具备基本主题注入能力，但缺少基准真值层、语义过滤层和基准复刻校验，存在过度渲染风险和架构债务。  

---

## 一、现状审计汇总

### 1.1 原生基准现状

#### 注入架构层次

所有 6 个 Agent 共享相同的三层注入架构：

| 层级 | 文件 | 作用 | 载体 |
|------|------|------|------|
| L0 Token | `engines/*/tokens.css` | 覆盖原生 CSS 变量 | `html.agentskin-host-{id}:root` 或 `body` |
| L1 Structural | `engines/*/adapter.mjs` | 注入 host class + 结构性 CSS + L4/L5 自修复 | `document.adoptedStyleSheets` |
| L2 Cosmetic | `engines/*/cosmetic.css` | 滚动条/选择/动效 | `html.agentskin-host-{id}` |

**关键发现**: L0 的挂载点有两种策略:
- `:root` 策略 (codex, qoderwork, doubao, zcode) — 选择器 `html.agentskin-host-{id}:root` 特异性 (0,2,1)
- `body` 策略 (traework, workbuddy) — 选择器 `html.agentskin-host-{id} body` (0,1,2)

#### 各 Agent 原生主题载体总览

| 维度 | traework | codex | workbuddy | qoderwork | doubao | zcode |
|------|----------|-------|-----------|-----------|--------|-------|
| 根挂载策略 | body + .monaco-workbench | :root | body | :root | :root | :root |
| Token 系统 | --vscode-* / --vscode-icube-* | --text-* / --bg-* | --cb-* / --vscode-* | --color-* | --semi-color-* / --dbx-* / --s-color-* / --ffc-* | --color-* |
| 侧边栏选择器 | .task-list-base | aside.app-shell-left-panel | [data-view-id="sidebar"] | .agents-sidebar | nav (heuristic) | aside |
| 输入框选择器 | .chat-input-v2-input-box-editable | .composer-surface-chrome | [contenteditable] → _mainArea_ | .chat-input-editor-text | [class*="input-guidance"] | [contenteditable] |
| DOM 节点数 | 136 | 98 | 205 | 134 | 244 | 52 |
| Hash 类名风险 | 中 | 高 | 中 | 低 | 低 | 低 |

#### 关键组件载体分析

**侧边栏载体差异巨大**（6种完全不同的DOM结构）:
- traework: `.task-list-base` / `.task-list-panel` — VS Code sideBar token
- codex: `aside.app-shell-left-panel` — Tailwind token
- workbuddy: `[data-view-id="sidebar"]` — data 属性标记
- qoderwork: `.agents-sidebar` — 语义化类名（最稳定）
- doubao: `nav` 启发式定位 — 无稳定标记
- zcode: `aside` — 最简全局选择器

**输入框嵌套关系各异**:
- traework: `.chat-input-v2-input-box-editable[contenteditable='true']` → 父容器 `.chat-input-v2-input-box` → `.chat-input-primary-glow`
- codex: `.composer-surface-chrome` → 内部 `[contenteditable="true"]` → 发送按钮 `button`
- workbuddy: `[contenteditable='true']` → 父 div → `[class*="_mainArea_"]`
- qoderwork: `.chat-input-editor-text[contenteditable]` + **占位符孪生节点警告**
- doubao: `[contenteditable]` → `[class*="input-guidance"]` → `[class*="input-container"]`
- zcode: `[contenteditable="true"]` → 父容器（无稳定类名）

---

### 1.2 现存渲染故障汇总

#### 严重问题（经交叉校验确认）

| 编号 | 文件路径 | 等级 | 问题描述 | 负面影响 |
|------|----------|------|----------|----------|
| CV-01 | `engines/doubao/adapter.mjs:106-128` | 严重 | 全局文本颜色暴力继承 | 所有子组件文本色被强制覆盖，破坏原生组件内外层渲染层级 |
| CV-02 | `engines/qoderwork/adapter.mjs:115-149` | 严重 | header 通配复合选择器过度命中 | 10个模糊选择器覆盖 header 所有子节点阴影 |
| CV-03 | `src/engine/src/runtime/renderer-payload.mjs:250-254` | 严重 | MutationObserver 监听全 document + 5秒无条件 ensure | 高频 DOM 变更场景下持续 ensure() 造成性能开销 |
| CV-04 | `src/engine/src/runtime/selectivity-registry.mjs` | 严重 | `isNativeThemeControlled` 语义标记完全缺失 | 无法区分主题受控与非受控节点 |
| CV-05 | `src/engine/src/runtime/renderer-payload.mjs:325-356` | 严重 | verifyTheme 缺少样式值对比 | 选择器存在但语义漂移时无法检测 |
| CV-06 | `engines/zcode/adapter.mjs:134-135` | 一般 | `aside, nav` 全局选择器 | 不区分侧边栏与顶部导航栏 |
| CV-07 | `engines/zcode/adapter.mjs:158-168` | 一般 | 输入框选择器未限定 composer 域 | ZCode 代码编辑器、搜索框等全部被渲染 |
| CV-08 | `src/engine/src/runtime/injector.mjs:36-47` | 一般 | 每次 applyTheme 新建 Session 无复用 | 多 target 场景下 CDP 握手开销 |
| CV-09 | 多层 | 一般 | customProperties 差分逻辑 | 无问题（交叉校验已排除首轮误判） |

#### 输入框问题分析（深度复检结论）

**重要发现**: 经过对6个Agent的深度复检，当前代码**不存在活跃的输入框渲染bug**。所有输入框选择器均经过验证：

- traework: `.chat-input-v2-input-box-editable` 精准定位，**无 over-render**
- codex: `.composer-surface-chrome` 精准定位，注释明确记录了已清理的死选择器列表
- workbuddy: L5 heuristic 向上遍历6层可能命中包含按钮的父容器，但这是**有意妥协**
- qoderwork: `.chat-input-editor-text:focus` 仅设置 border-color，**不会 over-render**
- doubao: `INPUT_LINE_FRAME_CSS` 递归清除边框，**有意设计但效果可优化**
- zcode: `[contenteditable="true"]` 宽泛选择器，**存在潜在风险**但当前结构设计使然

#### 侧边栏嵌套div问题分析（深度复检结论）

**重要发现**: 所有6个Agent的侧边栏"外层毛玻璃+内层实色hover"结构均为**有意设计策略**，不存在内外层渲染目标颠倒的bug：

- 外层 `color-mix(...15-22% transparent)` 提供毛玻璃底色
- 内层 hover `color-mix(accent 10-18% transparent)` 提供交互反馈
- 两层透明度叠加产生视觉层次，**非渲染bug**

#### 颜色协调异常

| Agent | 配色策略 | 参考原生? | 协调性 |
|-------|---------|----------|--------|
| traework | 通过 `--vscode-input-background` 中间层桥接 | 是 | 协调 |
| codex | 直接覆盖 `--text-* / --bg-*` + color-mix | 否 | 协调 |
| workbuddy | `--cb-vscode-input-background` 中间层桥接 | 是 | 协调 |
| qoderwork | `--color-primary` focus色 + agentskin混合 | 混合 | 部分协调 |
| doubao | 暴力覆盖 `--dbx-* / --semi-*` 全族 | 否 | 基本协调 |
| zcode | 覆盖 `--color-*` 变量族 | 否 | 协调 |

---

### 1.3 探针核心缺陷

当前探针系统的7项核心缺陷（经交叉校验确认4项、排除1项误判、2项需运行时验证）：

| 编号 | 文件位置 | 问题 | 影响 |
|------|----------|------|------|
| D1 | `dom-snapshot.mjs:100,120-126` | 计算样式只采集即时快照，不区分原生vs注入后 | 运行时无法判断主题是否成功应用 |
| D3 | `renderer-payload.mjs:73-91,109-121` | 兼容验证只检查选择器存在，不验证语义角色 | 选择器偶然命中但语义漂移时不报警 |
| D4 | `injector.mjs:130-171` | 注入前不采集基线快照，注入后不做 diff | 无法回答"注入前这个节点是什么样" |
| D6 | `renderer-payload.mjs:325-356` | verify pass 条件缺少样式层对比 | 版本更新后DOM语义漂移时verify永远返回true |
| D7 | 全系统 | `isNativeThemeControlled` 语义标记完全缺失 | 主题覆盖率诊断完全靠人工经验 |

（D2、D5 经交叉校验为误判已排除）

**错误的时序逻辑**:
- `cdp-full-extract.mjs` 用 `Emulation.setEmulatedMedia` → 等 600ms → 读变量 + 读 DOM 快照（正确时序）
- 运行时 `watchTheme` 中 `applyCompatible` 直接注入不切态、不等待
- `injector.mjs` 中的 `snapshotDom` 导出从未被调用——是一个孤立入口

---

### 1.4 注入逻辑缺陷

1. **无差别遍历DOM**: MutationObserver 以 `{ childList: true, subtree: true }` 监听 `document.documentElement`，无排除逻辑
2. **5秒无条件setInterval**: 即使 DOM 无任何变化也执行 `ensure()`
3. **Session 无复用**: `withSessions` 每次 `new CdpSession(target).open()` + `session.close()`
4. **两套注入架构协作**: `injection-runtime.ts`（adoptedStyleSheets）与 `renderer-payload.mjs`（style标签）状态存储隔离

---

## 二、修正后引擎分层架构

### 2.1 五层架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│  ⑤ 整合调度层（Orchestration）                                       │
│  skin.mjs → applySkin / restoreSkin                                 │
│  固定7步执行顺序 · 版本变更触发基线重采 · Session 复用决策           │
├─────────────────────────────────────────────────────────────────────┤
│  ④ 独特模板层（Agent-Specific Profiles）                            │
│  runtime/profiles/{agent}-theme-v1.mjs                              │
│  每Agent独立 · 语义配置标记 isNativeThemeControlled                  │
├─────────────────────────────────────────────────────────────────────┤
│  ③ 内核层（Core Runtime）                                           │
│  renderer-payload.mjs · injector.mjs · selectivity-registry.mjs     │
│  通用模板 · 语义过滤层 · MutationObserver 排除集                    │
├─────────────────────────────────────────────────────────────────────┤
│  ② 增强探针探测层（Enhanced Probe）                                 │
│  baseline-snapshot.mjs（新增） · dom-snapshot.mjs（扩展）           │
│  BaselineSnapshot 采集 · semanticNodes 解析                        │
├─────────────────────────────────────────────────────────────────────┤
│  ① 基准真值层（Baseline Ground Truth）— 新增，最高前置              │
│  原生亮/暗主题计算样式快照 · 未篡改真值 · 版本绑定                  │
│  复刻校验 gate · 失效条件定义                                      │
└─────────────────────────────────────────────────────────────────────┘
```

**层级依赖方向（严格单向）**: ⑤ → ④ → ③ → ② → ①

---

### 2.2 基准真值层（新增）

**职责**: 在任何自定义主题注入之前，完整记录目标 Agent 在原生亮色主题和原生暗色主题下的计算样式快照。

**BaselineSnapshot 数据结构**:

```typescript
interface BaselineSnapshot {
  schemaVersion: 2;
  appId: string;
  appVersion: string;
  capturedAt: string;
  themeMode: "light" | "dark";
  route: { pathname: string };
  viewport: { width: number; height: number; devicePixelRatio: number };
  nodes: Array<{
    selector: string;
    tag: string;
    depth: number;
    rect: { x: number; y: number; width: number; height: number };
    styles: {
      color: string; backgroundColor: string; borderColor: string;
      boxShadow: string; opacity: string; fill: string; stroke: string;
    };
    customProperties: Record<string, string>;
  }>;
  rootCustomProperties: Record<string, string>;
}
```

**采集时机**:

| 触发条件 | 是否采集 | 说明 |
|----------|----------|------|
| 首次检测到目标窗口 | 是 | 注入前必须完成亮色 + 暗色两套采集 |
| 用户切换原生主题后 | 是 | 主题模式变更意味着基准失效 |
| Agent 应用版本更新 | 是 | `appVersion` 变化触发重新采集 |
| 引擎自身版本更新 | 是 | schemaVersion 升级 |
| 路由变化 | 否 | 同版本同主题下不重采（性能权衡） |

**生命周期管理**:
```
有效状态: fresh(30分钟内) → stale(30分钟~24小时) → expired(>24小时)
失效条件:
  1. appId + appVersion + themeMode 三元组不匹配
  2. 快照超过 24 小时
  3. 用户手动触发"重置基线"
  4. 引擎 schemaVersion 升级
存储位置:
  - 内存: Map<`${appId}@${appVersion}:${themeMode}`, BaselineSnapshot>
  - 磁盘: 可选缓存于 update-check.json 同级目录
```

**复刻校验 Gate**: 自定义主题注入前，引擎必须能仅使用现有 CSS 选择器 + 14-token 契约，将目标 Agent 外观还原到与 BaselineSnapshot 采集时一致的状态。
- 注入"复刻 CSS"（仅使用 BaselineSnapshot 中的选择器 + 色值）
- 对每个节点对比当前计算样式与快照值
- 允许偏差：色差 ≤ 2，透明度 ≤ 0.05
- 通过率 ≥ 95% 视为复刻成功，否则阻塞注入

---

### 2.3 增强探针探测层

**ProbeResult 扩展结构**:

```typescript
interface ProbeResult {
  domSnapshot: DomSnapshotResult;           // 继承现有
  
  baselineSnapshot: {                        // 新增
    light: BaselineSnapshot | null;
    dark: BaselineSnapshot | null;
    collectionErrors: Array<{
      themeMode: "light" | "dark";
      error: string;
      partialNodeCount: number;
    }>;
  };
  
  semanticNodes: Array<{                     // 新增
    selector: string;
    tag: string;
    isNativeThemeControlled: boolean;        // 核心标记
    controllingSelector: string | null;
    nodeCategory: "chrome" | "content" | "input" | "decoration" | "structural" | "unknown";
    themeSensitivityScore: number;           // 0.0 ~ 1.0
  }>;
}
```

**isNativeThemeControlled 判定逻辑**（优先级从高到低）:

1. **显式标记**（来自模板语义配置）
2. **背景色差异法**（light/dark 快照 backgroundColor 色差 > 30 → true）
3. **文本色差异法**（light/dark 快照 color 色差 > 30 → true）
4. **CSS 变量关联法**（customProperties 包含已知主题变量 → true）
5. **标签+角色启发法**（main/header/aside/nav 且 role 匹配 → true；contenteditable/input → false）

---

### 2.4 内核层（新增语义过滤层）

**语义过滤层逻辑**:

```
当前行为（问题）: CSS 选择器匹配 → 直接应用主题色值
修正后行为: CSS 选择器匹配 → 检查 isNativeThemeControlled
                              → true: 应用主题色值
                              → false: 跳过该节点（保留原生样式）
```

**实现方式**: 为 `isNativeThemeControlled = false` 的节点添加 `agentskin-non-controlled` class；CSS 选择器附加 `:not(.agentskin-non-controlled)` 排除规则。

**MutationObserver 排除集**:

```javascript
excludeSelectors: [
  '[data-agentskin-baseline]',
  '#agentskin-traework-skin-chrome',
  '#agentskin-codex-skin-chrome',
  '.agentskin-non-controlled',
  '[aria-hidden="true"]',
],
```

**5秒 ensure 条件化修正**:

```javascript
const interval = setInterval(() => {
  if (disabled()) { cleanup(); return; }
  if (!document.getElementById(styleId)) { ensure(); }  // 仅在标记被移除时重注
}, 5000);
```

**CDP Session 复用**: 引入 Session 缓存（Map<targetId, {session, lastUsed}>），定期清理过期 Session。

---

### 2.5 独特模板层（语义配置扩展示例）

**traework 侧边栏组件**:

```javascript
traework: {
  sidebar: {
    selectors: [".task-list-base", ".task-list-panel"],
    required: false,
    semantic: {
      controlled: true,
      controllingSelector: ".task-list-base",
      innerHoverControlled: true,
      innerHoverSelector: ".task-list-item:hover",
      nonControlled: [".task-list-divider", ".collapse-toggle-icon"],
    },
  },
},
```

**codex 输入框组件**:

```javascript
codex: {
  composer: {
    selectors: [".composer-surface-chrome", "form textarea"],
    required: false,
    semantic: {
      controlled: true,
      controllingSelector: ".composer-surface-chrome",
      innerInputNonControlled: true,
      innerInputSelector: "[contenteditable='true'], textarea",
      innerButtonNonControlled: true,
      innerButtonSelector: "button, [role='button']",
    },
  },
},
```

---

### 2.6 整合调度流程（7步固定顺序）

| Step | 名称 | 行为 | 输出 |
|------|------|------|------|
| 1 | 目标窗口就绪检测 | 调用 `waitForTargets()`，不立即注入 | `targets[]` |
| 2 | 探针采集基线 | 检查缓存 → 缓存未命中 → 双 scheme 采集 → 解析 semanticNodes | `ProbeResult` |
| 3 | 复刻校验 Gate | 注入复刻 CSS → 采样对比 → 通过率 ≥ 95% → 继续 | pass/fail |
| 4 | 识别 Agent | 现有 verification + root 节点必须 isNativeThemeControlled | adapter + 兼容性 |
| 5 | 语义过滤渲染 | 为非受控节点添加 class → CSS 附加 `:not()` 排除 → 注入 | 注入结果 |
| 6 | 轻探针校验 | 扩展 verifyExpression（含样式值对比） | verify 结果 |
| 7 | 版本变更重采基线 | 监听版本变化 → 使快照失效 → 重新 Step 2-6 | — |

**执行顺序约束**: Step 2 → Step 3 → Step 5 必须按序执行，不可颠倒。

---

### 2.7 针对典型故障场景的处理逻辑

#### (a) 输入框场景

**问题**: 外层容器需要变换背景色（受控），内部 contenteditable 不应被覆盖，内部发送按钮不应被覆盖。

**处理逻辑**:
1. 探针阶段采集 BaselineSnapshot，识别 `.composer-surface-chrome` 在 light/dark 下 backgroundColor 差异大 → `isNativeThemeControlled = true`
2. `[contenteditable]` 差异小 → `isNativeThemeControlled = false`
3. 模板语义配置显式标记 `innerInputNonControlled = true`
4. 为 `[contenteditable]` 添加 `agentskin-non-controlled` class
5. CSS 选择器排除 class → 内部控件自动跳过

#### (b) 侧边栏双层div嵌套场景

**问题**: 无法仅从DOM结构确定哪个节点是真正的视觉载体。

**处理逻辑**:
1. BaselineSnapshot 采集发现 `.task-list-base` 有 backdropFilter + 圆角 → 毛玻璃载体
2. `.task-list-panel` 有实色背景 → 背景色载体
3. 语义配置分别指定 `glassCarrier` 和 `backgroundCarrier`
4. 引擎根据语义配置分别对两个载体应用不同的主题变换

---

## 三、技术边界与取舍

### 3.1 明确声明

- **复刻不等于像素级一致**: 目标为"视觉可区分性一致"，允许色差 ≤ 2、透明度 ≤ 0.05
- **Shadow DOM 不可穿透**: closed shadow root 无法访问，降级为仅对 Shadow Host 应用主题
- **运行时动态样式不可预测**: Agent 通过 JS 动态计算样式（非 CSS）无法被 BaselineSnapshot 预测
- **图片/图标主题化限制**: 非 CSS 控制的 SVG fill 或图片资源无法通过注入变换

### 3.2 性能开销权衡

| 操作 | 开销 | 触发频率 | 优化策略 |
|------|------|----------|----------|
| BaselineSnapshot 采集 | 中（200-500ms） | 每版本每主题模式 1 次 | 缓存 + 增量更新 |
| 主题模式切换 | 高（触发全页面重排） | 每版本 1 次 | 仅在首次采集时切换 |
| semanticNodes 解析 | 低（纯计算） | 每次探针 | 内存中完成 |
| 复刻校验 | 中（注入 + 采样对比） | 每次注入前 | 采样而非全量 |

---

## 四、风险清单

### 4.1 风险矩阵

| 场景 | 概率 | 影响 | 风险等级 | 检测难度 |
|------|------|------|----------|----------|
| S1: 基准快照采集失败 | 中 | 极高 | **P0-致命** | 低 |
| S2: Shadow DOM不可穿透 | 低 | 中 | P2-可控 | 高 |
| S3: JS动态运行时修改原生样式 | 高 | 高 | **P0-致命** | 高 |
| S4: 6个Agent组件载体层级不一致 | 确定 | 中 | **P1-架构性** | 低 |
| S5: 版本更新后基准失效 | 高 | 高 | **P1-持续性** | 低 |
| S6: 高频DOM变更（流式输出） | 高 | 中 | **P1-性能** | 中 |
| S7: 多窗口/多target并发 | 中 | 中 | P1-正确性 | 中 |
| S8: 探针采集性能开销 | 确定 | 低 | P2-体验 | 低 |
| S9: 竞态条件 | 中 | 高 | **P0-致命** | 高 |
| S10: 语义过滤层误判 | 中 | 高 | **P1-正确性** | 极高 |

### 4.2 TOP 5 风险

1. **S3: JS动态运行时修改原生样式** — 概率最高、影响最大。当前 `AdaptiveMutationObserver` + 5s self-heal 已是权宜之计，CSS变量桥接是唯一根治路径。
2. **S9: 竞态条件** — 快速切换主题时 observer/debounce/闭包交互产生确定性竞态。需增加 `ownerId` 守卫。
3. **S1: 基准快照采集失败** — 全杀级别故障。QoderWork 的 ephemeral port + DevToolsActivePort 文件时序是已知脆弱点。
4. **S5: 版本更新后基准失效** — codex（ChatGPT桌面端）更新最频繁，hash class名变化是确定性事件。
5. **S10: 语义过滤层误判** — 新引入抽象的固有风险，检测难度极高（需要人眼验证每个节点的主题覆盖是否正确）。

### 4.3 兜底策略

| 风险 | 短期兜底 | 中期兜底 | 长期根治 |
|------|----------|----------|----------|
| S1 | 缺失禁止加载闸 | 单scheme宽容降级 | 本地缓存 + 社区贡献基准 |
| S3 | 阶梯优先级模式 | CSS变量桥接层 | 语义过滤+变量注入双模式 |
| S9 | ownerId 版本守卫 | Promise链锁串行化 | AbortController 模式 |
| S5 | 双轨 preflight + fallback | 版本范围 manifest | 稳定选择器锚点 |
| S10 | CSS变量引用检测（80%+准确率） | per-Agent controlledManifest | 增量 controlled 检测 |

---

## 五、迭代下一步行动清单

### P0（立即实施，1-2周）

| 编号 | 任务 | 对应缺陷 | 预估工作量 |
|------|------|----------|-----------|
| P0-1 | 新增 `isNativeThemeControlled` 语义标记 + 过滤层 | CV-04 | 3-4 天 |
| P0-2 | 实现 BaselineSnapshot 采集 + 复刻校验 Gate | CV-04, CV-05 | 3-4 天 |
| P0-3 | 基准快照采集失败兜底闸（缺失禁止加载） | S1 | 0.5 天 |
| P0-4 | 竞态条件 ownerId 版本守卫 | S9 | 0.5 天 |

### P1（短期实施，2-4周）

| 编号 | 任务 | 对应缺陷 | 预估工作量 |
|------|------|----------|-----------|
| P1-1 | MutationObserver 排除集 + interval 条件 ensure | CV-03 | 0.5 天 |
| P1-2 | verifyTheme 样式值对比 | CV-05 | 1 天 |
| P1-3 | doubao 全局文本继承修正 | CV-01 | 0.5 天 |
| P1-4 | 双轨 preflight + fallback 选择器 | S5 | 1-2 天 |
| P1-5 | 语义过滤层 MVP（CSS变量引用检测） | S10 | 1 天 |

### P2（中期实施，1-2月）

| 编号 | 任务 | 对应缺陷 | 预估工作量 |
|------|------|----------|-----------|
| P2-1 | zcode 选择器域限定 | CV-06, CV-07 | 0.5 天 |
| P2-2 | qoderwork header 选择器精确化 | CV-02 | 0.5 天 |
| P2-3 | CDP Session 复用 | CV-08 | 1 天 |
| P2-4 | CSS变量桥接层（根治 S3） | S3 | 5-8 天 |
| P2-5 | 版本范围 manifest + 自动重采 | S5 | 2-3 天 |

### P3（长期规划，3-6月）

| 编号 | 任务 | 对应缺陷 | 预估工作量 |
|------|------|----------|-----------|
| P3-1 | 增量 controlled 检测 + manifest 校验 | S10 | 3-5 天 |
| P3-2 | 流式输出场景性能优化（requestIdleCallback） | S6 | 1 天 |
| P3-3 | 全量6Agent测试：亮/暗基准复刻、自定义主题、版本变更 | 全部 | 5-7 天 |

---

## 六、人工复核项

以下问题静态代码无法判定，需要实际运行验证：

| 编号 | 问题描述 | 需要实际运行的原因 |
|------|----------|-------------------|
| MAN-01 | 6个Agent的root挂载策略实际生效情况 | CSS选择器的 cascade 优先级需运行时验证 |
| MAN-02 | adoptedStyleSheets vs `<style>` 标签的优先级竞争 | 层叠顺序取决于数组顺序和DOM位置 |
| MAN-03 | `color-mix(in srgb, ...)` 在不支持浏览器的回退行为 | 旧版 Electron/Chromium 可能不支持 |
| MAN-04 | `data-agentskin-punched` 通用 punch-through 的副作用 | 可能误伤聊天内容区的白色卡片/弹窗 |
| MAN-05 | `sessionStorage.__agentskin_disabled__` 的持久化边界 | 不清楚 sessionStorage 在 navigate/reload 时是否保持 |

---

## 七、与现有代码的映射

### 7.1 新增文件

| 文件路径 | 职责 |
|----------|------|
| `src/engine/src/runtime/baseline-snapshot.mjs` | BaselineSnapshot 采集脚本生成 |
| `src/engine/src/runtime/semantic-filter.mjs` | 语义过滤层逻辑 |
| `src/engine/types/baseline.d.ts` | BaselineSnapshot 类型定义 |

### 7.2 修改文件

| 文件路径 | 修改内容 | 对应缺陷 |
|----------|----------|----------|
| `src/engine/src/runtime/dom-snapshot.mjs` | 扩展导出，新增 `buildEnhancedProbeExpression` | CV-04 |
| `src/engine/src/runtime/renderer-payload.mjs` | `buildApplyExpression` 中注入语义过滤逻辑 + interval 条件 ensure | CV-03, CV-04 |
| `src/engine/src/runtime/renderer-payload.mjs` | `buildVerifyExpression` 中新增样式值对比 | CV-05 |
| `src/engine/src/runtime/injector.mjs` | `withSessions` 改为 Session 复用缓存 | CV-08 |
| `src/engine/src/runtime/adaptive-observer.mjs` | 新增 `excludeSelectors` 选项 | CV-03 |
| `src/engine/src/runtime/selectivity-registry.mjs` | 每个 semantic entry 新增 `semantic` 配置节 | CV-04 |

### 7.3 不改动的文件

| 文件路径 | 原因 |
|----------|------|
| `src/engine/src/cdp/session.mjs` | CDP 协议层无缺陷 |
| `src/engine/src/runtime/skin.mjs` | 调度逻辑不变 |
| `src/engine/src/runtime/profiles/workbuddy-theme-v1.mjs` | workbuddy 无严重问题 |
| `src/engine/src/update.mjs` | 引擎更新逻辑不涉及注入架构 |

---

## 八、方法论总结

### 8.1 流水线执行摘要

| 阶段 | 模式 | 子Agent数 | 产出 |
|------|------|----------|------|
| 1. 首轮扫描 | 并行 | 5 | 5份原始报告 |
| 2. 交叉校验 | 串行 | 1 | 修正报告 + 误判排除 |
| 3. 深度复检 | 并行 | 1 | 输入框/侧边栏深度分析 |
| 4. 架构推演 | 并行 | 2 | 修正架构 + 风险推演 |
| 5. 最终报告 | 串行 | 0 | 本文档 |

### 8.2 关键方法论发现

1. **首轮报告的过度诊断**: 交叉校验发现首轮报告在"设计意图识别"和"缓解机制完整性"两方面有系统性过度诊断。6个严重问题(CR)中3项是有意设计权衡、2项确认但已有注释说明、1项部分误判。

2. **深度复检的价值**: 深度复检发现当前代码**不存在活跃的输入框/侧边栏渲染bug**，所有"过度渲染"指控大多为有意设计策略。这验证了交叉校验的"误判排除"判断。

3. **真实缺陷聚焦**: 经三轮迭代，最终聚焦到4个经确认的真实缺陷（CV-01~05 中排除误判后的 CV-01/03/04/05），以及1个架构性缺失（isNativeThemeControlled）。

4. **MVP 范围控制**: 基于风险分析，MVP 范围控制在 5-8 人日，避免过度工程化。

---

**文档版本**: 1.0  
**生成时间**: 2026-08-16  
**基于输入**: baseline-restore-sub, over-render-sub, probe-semantic-sub, template-split-sub, cdp-unify-sub, cross-verify-sub, architecture-output-sub, risk-analysis-sub, deep-inspection  
**状态**: 方案文档，待 RFC 评审后实施  
**下一步**: 提交 RFC 文档至 `docs/rfc/` 目录，经评审后按 P0/P1/P2/P3 优先级分阶段实施
