# RFC 2026-08-20 · CDP 深度适配架构（Renderer-Side Deep Adaptation）

> **状态**: 方案推演稿 v4（已修复全部 P0 + P1，可批准开工）  
> **作者**: 架构分析  
> **日期**: 2026-08-20 → v4 修订 2026-08-24  
> **分支**: feature/inspection-2026-08-13-1400-J-theme-contract  
> **范畴**: 渲染进程域内 L4 adapter 增强 + 主进程源码拼接 + 清理表达式扩展 + 测试 project 补充

---

## 1. 背景与目标

### 1.1 为什么需要这次变更

AgentSkin 当前是"L0-L4 CSS 注入 + L4 浅自愈"架构——能静态换色但不能感知应用内部状态、不能穿透 closed shadow DOM、不能路由感知、不能热替换 CSS 片段。竞品（CodeDrobe / Dream Work Theme）靠"深雕琢的 CSS + JS 感知"做出质感主题，我们的采集层（CDP 提取）已强但**决策层仍是手写静态选择器**，"深度适配"无从谈起。

### 1.2 目标

| # | 目标 | 可验证指标 |
|---|------|-----------|
| G1 | Shadow DOM 穿透（分层降级：变量 → open-shadow → patch） | open-shadow 内样式 100% 生效；closed 仅覆盖新创建 |
| G2 | 路由感知与上下文差异化主题 | SPA 路由切换 ≤500ms Fragment 切换 |
| G3 | 业务状态感知（window/DOM 暴露状态读取） | 状态变化后 Fragment 切换正确 |
| G4 | 模块化 CSS 片段系统（激活/停用/热替换） | 主题切换无闪烁（hotReplace 原子操作） |
| G5 | 运行时主题热切换（无需完整 apply 重载） | 二次切换耗时 ≤ 首次 20% |

### 1.3 非目标

- 不做 webpack hook / 源码替换（Vencord asar-patch 域）
- 不做 preload IPC 拦截（渲染进程硬边界 B2）
- 不做主进程**结构性**修改（仅源码拼接 + 清理表达式追加）
- 不做新适配器（6 端封顶不变）
- 不做自定义 UI 控件注入（剥离到独立 RFC：IPC 路径不存在）
- 不修改 engines/ 三件套文件结构约定

### 1.4 前置阅读

- `AGENTS.md` — 项目不变量（C1-C9）+ 黄金规则
- `docs/ARCHITECTURE.md` — 注入分层 L0-L4 定义（**无 L5 分层**）
- `docs/apps/ADAPTATION-INDEX.md` — 六端适配档案
- `docs/research/shadow-dom-style-piercing-report.md` — Shadow DOM 技术调研
- `src/shared/injection-runtime.ts:226-235` — `buildClearEngineInjectionExpression` 修改点
- `src/shared/injection-constants.ts:68-83` — adapter marker 常量定义（新增 DeepCore 常量处）
- `src/main/palette/orchestrator.ts:127-132` — adapterJs 读取点（改为 4 文件拼接）
- `engines/codex/adapter.mjs:79-302` — 当前最完整的参考 adapter
- `vitest.config.ts:20-82` — 测试项目定义（新增 deep-core project 处）

---

## 2. 触发条件（对照 AGENTS.md §6）

- [x] **重构注入架构（L0-L4 注入层）**：修改 6 个 `adapter.mjs` 内部执行逻辑 + 扩展 `buildClearEngineInjectionExpression`（+4 行 TypeScript）以支持 DeepCore 清理和原型还原 + orchestrator.ts 增加 deep-core 源码读取和拼接（+10 行）+ injection-constants.ts 新增 3 个常量 + vitest.config.ts 新增 1 个 project。**不修改 L0-L4 CSS 注入层级、不修改 manifest schema、不修改 IPC channel 契约。**
- [ ] 新增 UI 页面（突破六页封顶）
- [ ] 新增适配器（突破六适配器上限）
- [ ] 修改核心数据模型（manifest schema、14-token 契约等）

---

## 3. 现状侦察（代码锚点）

### 3.1 已有深度基础

| 能力 | 代码锚点 | 文件位置 |
|------|---------|---------|
| L0-L4 CSS 注入分层 | `injectCssLayer()` | `src/main/cdp/injection/engine-strategy.ts:236` |
| adoptedStyleSheets 隐身通道 | `buildAdoptLayerExpression()` | `src/shared/injection-runtime.ts:166` |
| L4 Token 自动发现 | `discoverAndOverrideTokens()` | `engines/codex/adapter.mjs:236-263` |
| L5 启发式 DOM 定位 | `findInputContainer()` / `findSidebar()` | `engines/workbuddy/adapter.mjs:348-405` |
| 自适应 MutationObserver | `AdaptiveMutationObserver` class | 各 `adapter.mjs`（codex/workbuddy 最完整） |
| 周期自愈 5s setInterval | `window[MARKER].interval` | `engines/codex/adapter.mjs:293-298` |
| 多 target 扇出 | `cdp-fanout.ts` hardeningPass | `src/main\cdp\cdp-fanout.ts` |
| config 注入 | `window.__AGENTSKIN_CONFIG__` | `src/main/cdp/injection/engine-strategy.ts:217` |
| 清理表达式 | `buildClearEngineInjectionExpression()` | `src/shared/injection-runtime.ts:226` |
| removeEngineInjection | 主进程调用 | `src/main/cdp/injection/engine-strategy.ts:299-324` |
| 性能记录 | `PerformanceRecorder` | `src/main/services/performance/performance-recorder.ts` |
| adapter marker 常量 | `adapterMarkerFor()` + `ADAPTER_MARKERS` | `src/shared/injection-constants.ts:76-83` |
| 引擎文件读取 | `Promise.all([tokensCss, adapterJs, cosmeticCss])` | `src/main/palette/orchestrator.ts:128-132` |
| adapter 执行 | `session.evaluate(adapterJs)` | `src/main/cdp/injection/engine-strategy.ts:243` |
| structural template 提取 | `extractStructuralTemplate()` | `src/main/theme-asset/bridge/structural-template.ts:23-54` |
| vitest 项目定义 | `projects: [...]` | `vitest.config.ts:20-82` |

### 3.2 真缺位

| # | 缺失 | 当前影响 |
|---|------|---------|
| G1 | Shadow DOM 穿透缺失（尤其 closed shadowRoot 中的"新创建"组件） | 弹窗/设置面板样式失效 |
| G2 | 路由感知缺失 | SPA 切换页面时 CSS 不更新 |
| G3 | 上下文状态感知弱 | 无法按模型/会话差异化渲染 |
| G4 | CSS 模块化片段 | 整块注入，不能按上下文热插拔 |
| G5 | 清理不还原 attachShadow patch + history patch | 主题卸载后原型链污染 |
| G6 | DeepCore 运行时代码无法通过 evaluate 上下文 import | 执行模型不兼容（本 RFC 核心修复点） |

---

## 4. 设计方案

### 4.1 方案选型结论

| 决策点 | 结论 | 原因 |
|--------|------|------|
| 是否新增注入层 | 否 | 保持 L0-L4 分层完整 |
| 共享模块位置 | `engines/shared/deep-core.mjs` | 6 adapter 共用 |
| DeepCore 注入方式 | **主进程源码拼接**（非 ES import） | evaluate 上下文无模块解析 |
| deep-config 存放位置 | 内联到 adapter.mjs 头部 `const DEEP_CONFIG` | 避免破坏 engines/ 三件套约定 |
| 主进程修改范围 | orchestrator.ts +10 行（读取+拼接）+ injection-runtime.ts +4 行（清理）+ constants +3 行 + vitest +15 行 | 最小侵入 |
| DeepCore 窗口标识 | `window[adapterMarkerFor(agent)]` | 复用现有 MARKER 清理链 |
| 自定义 UI 控件 | 剥离到独立 RFC | renderer→main IPC 路径不存在 |

> 多维加权评分: A（渐进增强）135 · B（独立 L4+ 层）148 · **C（DeepCore 共享 + 源码拼接）185**

### 4.2 总体架构

```
主进程
  ├── orchestrator.ts → 新增 deep-core 源码读取
  │   └── Promise.all([tokensCss, adapterJs, cosmeticCss])
  │       改为 4 文件 + 拼接: adapterJs = deepCoreSource + adapterSource
  ├── injection-runtime.ts → buildClearEngineInjectionExpression
  │   └── +4 行: CLEAR_DEEP_CORE_BODY 常量 + 追加
  ├── injection-constants.ts → 新增 DEEP_CORE_GLOBAL 常量
  └── engine-strategy.ts → injectThemeViaEngine（不变，仍 evaluate adapterJs）

渲染进程（evaluate 上下文 = 纯脚本，无 import/export）
  └── engines/<agent>/adapter.mjs（拼接后形态）
       ├── 【deep-core.mjs 源码前置注入】
       │   └── class SafeAttachShadowPatcher {}
       │   └── class FragmentRegistry {}
       │   └── class RouteDetector {}
       │   └── class ContextAwareEngine {}
       │   └── class DeepCore {}
       ├── const DEEP_CONFIG = { ... }      ← deep-config 内联
       └── try { new DeepCore(DEEP_CONFIG, ctx) } catch { /* fallback 原有逻辑 */ }

engines/shared/deep-core.mjs（新增 ~400 行，纯脚本无 import/export）
  ├── CLEAR_DEEP_CORE_BODY 常量（供主进程清理表达式使用）
  ├── SafeAttachShadowPatcher（分层降级注入）
  ├── FragmentRegistry（模块化 CSS 片段）
  ├── RouteDetector（路由感知 + history restore）
  ├── ContextAwareEngine（状态感知）
  └── DeepCore（入口，封装上述模块 + AdaptiveMutationObserver）
```

### 4.3 主进程源码拼接（P0-1 修复核心）

**设计原则**: 因为 `engine-strategy.ts:243` 通过 `session.evaluate(adapterJs)` 执行 adapter，**evaluate 上下文无 ES 模块解析**，所有依赖必须内联到同一脚本作用域。

**修改文件 1**: `src/main/palette/orchestrator.ts:127-132`

```typescript
// ─── 变更前（L127-132）──────────────────────────────────────────────────────
const [tokensCss, adapterJs, cosmeticCss] = await Promise.all([
  fs.readFile(tokensPath, 'utf8'),
  fs.readFile(adapterPath, 'utf8'),
  fs.readFile(cosmeticPath, 'utf8'),
]);

// ─── 变更后──────────────────────────────────────────────────────────────────
const deepCorePath = join(__dirname, '../../../../engines/shared/deep-core.mjs');
const deepCoreExists = await fs.access(deepCorePath).then(() => true).catch(() => false);

const [tokensCss, adapterJs, cosmeticCss, deepCoreSource] = await Promise.all([
  fs.readFile(tokensPath, 'utf8'),
  fs.readFile(adapterPath, 'utf8'),
  fs.readFile(cosmeticPath, 'utf8'),
  deepCoreExists ? fs.readFile(deepCorePath, 'utf8') : Promise.resolve(''),
]);

// 关键修复: 源码拼接使 DeepCore class 进入 evaluate 作用域
// deep-core.mjs 必须是纯脚本（无 import/export），直接前置拼接
const finalAdapterJs = deepCoreSource
  ? `${deepCoreSource}\n;${adapterJs}`
  : adapterJs;
```

> **改动量**: orchestrator.ts +10 行（1 个 access 检查 + 4→5 文件读取 + 拼接逻辑 3 行）  
> **后向兼容**: deep-core.mjs 不存在时（如旧构建）回落到原 adapter 行为  
> **类型影响**: InjectEngineOptions 类型不变（adapterJs 仍是 string）

**修改文件 2**: `src/shared/injection-constants.ts`（新增 DeepCore 全局标识常量）

```typescript
// ─── 在 ADAPTER_MARKERS 之后新增──────────────────────────────────────────────

/**
 * DeepCore runtime handle global — each DeepCore instance writes
 * `window[DEEP_CORE_GLOBAL]` so cleanup can call dispose() before
 * the adapter marker is cleared. Mirrors the ADAPTER_MARKER_PREFIX/
 * SUFFIX convention for consistency.
 */
export const DEEP_CORE_GLOBAL = '__AGENTSKIN_DEEP_CORE__';

/**
 * Saved native attachShadow reference — DeepCore writes the original
 * `Element.prototype.attachShadow` here during install() so the
 * main-process removeEngineInjection can restore it on cleanup.
 */
export const SHADOW_ORIG_REF = '__agentskin_shadow_orig__';
```

> **改动量**: injection-constants.ts +11 行（2 常量 + 注释）

### 4.4 清理表达式扩展（精准定位）

**修改文件**: `src/shared/injection-runtime.ts`

**修改位置 1**: 紧跟 `CLEAR_HOST_BODY`（约 L151 后），新增 `CLEAR_DEEP_CORE_BODY` 常量（使用注入常量而非硬编码）:

```typescript
// ─── 变更: 在 import 区新增 DEEP_CORE_GLOBAL / SHADOW_ORIG_REF ────────────────
import {
  // ... 现有 ...
  DEEP_CORE_GLOBAL,
  SHADOW_ORIG_REF,
} from './injection-constants';

// ─── 变更: CLEAR_HOST_BODY 之后新增常量────────────────────────────────────────
const CLEAR_DEEP_CORE_BODY = [
  `if (window.${SHADOW_ORIG_REF}) {`,
  '  try { Element.prototype.attachShadow = window.__agentskin_shadow_orig__; } catch (e) {}',
  '}',
  `delete window.${SHADOW_ORIG_REF};`,
  `if (window.${DEEP_CORE_GLOBAL} && window.${DEEP_CORE_GLOBAL}.dispose) {`,
  '  try { window.__AGENTSKIN_DEEP_CORE__.dispose(); } catch (e) {}',
  '}',
  `delete window.${DEEP_CORE_GLOBAL};`,
].join('\n');
```

**修改位置 2**: `buildClearEngineInjectionExpression()`（L226-235）:

```typescript
// ─── 变更前────────────────────────────────────────────────────────────────────
//   ${CLEAR_HOST_BODY}

// ─── 变更后────────────────────────────────────────────────────────────────────
//   ${CLEAR_HOST_BODY}
//   ${CLEAR_DEEP_CORE_BODY}
```

> **改动量**: injection-runtime.ts +16 行（import +2 行、常量 +9 行、模板追加 +1 行、注释 +4 行）  
> **常量契约（P1-3 修复）**: 标识符全部来自 injection-constants.ts，符合 L25-29 契约

### 4.5 ShadowPiercer · 分层降级注入

**核心策略**（优先级降级）:

```
优先级 1: CSS 变量继承     ← 零 patch，覆盖 80%+ 场景（L1 tokens.css 主力）
优先级 2: adoptedSheets    ← 对已知的 open shadowRoot（MutationObserver 探测）
优先级 3: attachShadow patch ← 仅 mode='all' 时启用，SafeAttachShadowPatcher 单例守卫
```

**SafeAttachShadowPatcher**（解决 re-patch 链 + remove 不还原两个 Blocker）:

```js
// engines/shared/deep-core.mjs（纯脚本，无 import/export）
class SafeAttachShadowPatcher {
  static #orig = null;       // 私有静态：原始引用
  static #patched = false;   // 私有静态：单例守卫
  static #owned = new WeakMap(); // host → Set<ShadowRoot>（自动 GC）

  static install(injectFn) {
    if (this.#patched) { this.#inject = injectFn; return; } // 单例守卫
    this.#orig = Element.prototype.attachShadow;
    this.#inject = injectFn;
    const self = this, orig = this.#orig;
    Element.prototype.attachShadow = function (...args) {
      const root = orig.apply(this, args);
      if (!self.#owned.has(this)) self.#owned.set(this, new Set());
      self.#owned.get(this).add(root);
      try { self.#inject?.(root, this); } catch { /* 静默 */ }
      return root;
    };
    this.#patched = true;
    // 保存引用供主进程 removeEngineInjection 远程还原
    window.__agentskin_shadow_orig__ = orig;
  }

  static uninstall() {
    if (!this.#patched) return;
    Element.prototype.attachShadow = this.#orig;  // 100% 还原
    this.#orig = null;
    this.#patched = false;
    this.#inject = null;
    delete window.__agentskin_shadow_orig__;
  }

  static get isPatched() { return this.#patched; }
}
```

**分片异步 open-shadow 扫描（P1-5 修复）**:

```js
// 替换同步 querySelectorAll('*') 全量遍历
function scanOpenShadowsAsync(onFound) {
  const CHUNK_SIZE = 200;           // 每帧处理 200 个节点
  const nodes = document.querySelectorAll('*');
  let idx = 0;
  function processChunk() {
    const end = Math.min(idx + CHUNK_SIZE, nodes.length);
    for (; idx < end; idx++) {
      const el = nodes[idx];
      if (el.shadowRoot && el.shadowRoot.mode === 'open') {
        onFound(el.shadowRoot, el);
      }
    }
    if (idx < nodes.length) {
      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(processChunk, { timeout: 100 });
      } else {
        setTimeout(processChunk, 0);
      }
    }
  }
  processChunk();
}
```

### 4.6 FragmentRegistry · 模块化 CSS 片段

```js
class FragmentRegistry {
  static #fragments = new Map();

  static register(id, css) { this.#fragments.set(id, { css, sheet: null, active: false }); }

  static activate(id) {
    const frag = this.#fragments.get(id);
    if (!frag || frag.active) return;
    let sheet = frag.sheet;
    if (!sheet) {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(frag.css);
      sheet.__agentskin_fragment = id;
      frag.sheet = sheet;
    }
    // 插入位置: custom 层之前（custom 最终赢）
    const sheets = [...document.adoptedStyleSheets];
    const customIdx = sheets.findIndex(s => s.__agentskin_layer === 'custom');
    sheets.splice(customIdx >= 0 ? customIdx : sheets.length, 0, sheet);
    document.adoptedStyleSheets = sheets;
    frag.active = true;
  }

  static deactivate(id) {
    const frag = this.#fragments.get(id);
    if (!frag || !frag.active) return;
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
      s => s.__agentskin_fragment !== id
    );
    frag.active = false;
  }

  static hotReplace(id, newCss) {
    const frag = this.#fragments.get(id);
    if (!frag) { this.register(id, newCss); this.activate(id); return; }
    if (frag.sheet) {
      try { frag.sheet.replaceSync(newCss); return; } catch { /* fall through */ }
    }
    this.deactivate(id); frag.css = newCss; frag.sheet = null; this.activate(id);
  }

  static dispose() {
    for (const id of [...this.#fragments.keys()]) this.deactivate(id);
    this.#fragments.clear();
  }
}
```

### 4.7 RouteDetector · 路由感知（无 eval + history restore）

**P1-1 修复**: RouteDetector 返回 restore 函数，dispose 时调用还原。

```js
function initRouteDetector(routes, onTransition) {
  const state = { current: null };

  function testRoute(route) {
    if (route.test.selector) return !!document.querySelector(route.test.selector);
    if (route.test.urlPattern) {
      const url = location.hash || location.pathname;
      if (route.test.urlPattern.endsWith('*')) return url.startsWith(route.test.urlPattern.slice(0, -1));
      return url === route.test.urlPattern;
    }
    return false;
  }

  function detect() {
    for (const route of routes) {
      if (testRoute(route)) {
        if (route.id !== state.current) {
          onTransition?.(state.current, route);
          state.current = route.id;
        }
        return;
      }
    }
  }

  // Patch SPA navigation
  const origPush = history.pushState, origReplace = history.replaceState;
  history.pushState = function (...args) { origPush.apply(this, args); detect(); };
  history.replaceState = function (...args) { origReplace.apply(this, args); detect(); };
  const onPop = () => detect();
  window.addEventListener('popstate', onPop);
  window.addEventListener('hashchange', onPop);
  detect(); // 初始检测

  // ★ P1-1 修复: 返回 restore 函数
  return {
    disconnect() {
      history.pushState = origPush;
      history.replaceState = origReplace;
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onPop);
    }
  };
}
```

### 4.8 ContextAwareEngine · 状态感知

```js
function readState(spec) {
  try {
    switch (spec.from) {
      case 'window': return spec.path.split('.').reduce((o, k) => o?.[k], window);
      case 'dom': return document.querySelector(spec.selector)?.getAttribute(spec.attr);
      case 'sessionStorage': return sessionStorage.getItem(spec.path);
      default: return undefined;
    }
  } catch { return undefined; }
}

function initContextEngine(stateSpecs, onStateChange) {
  const readAll = () => Object.fromEntries(
    stateSpecs.map(s => [s.key, readState(s)])
  );
  let prev = readAll();
  const check = () => {
    const next = readAll();
    const changes = stateSpecs.filter(s => prev[s.key] !== next[s.key]);
    if (changes.length) { prev = next; onStateChange?.(changes, next); }
  };
  const interval = setInterval(check, 1000);
  return { interval, readAll };
}
```

### 4.9 DeepCore 生命周期 + 窗口标识（P0-2 修复）

**P0-2 核心修复**: DeepCore 成功后**必须写 `window[adapterMarkerFor(agent)]`**，与现有 `CLEAR_ADAPTERS_BODY` 清理链路对齐。

```js
class DeepCore {
  #config; #ctx; #observers = []; #disposers = []; #marker;

  constructor(config, ctx) {
    if (window.__AGENTSKIN_DEEP_CORE__) window.__AGENTSKIN_DEEP_CORE__.dispose();
    this.#config = config; this.#ctx = ctx;
    this.#marker = '__agentskin_' + ctx.agent + '_adapter__'; // 复用现有 marker 名

    try {
      this.#init();
      window.__AGENTSKIN_DEEP_CORE__ = this;
      // ★ P0-2 修复: 写回 window[MARKER] 兼容现有清理链
      window[this.#marker] = { observers: this.#observers, interval: null };
    } catch (err) {
      console.warn('[DeepCore] init failed, fallback:', err);
      // fallback: 继续执行原有 adapter 逻辑
    }
  }

  #init() {
    // 注册 fragments
    for (const [id, css] of Object.entries(this.#config.fragments || {})) {
      FragmentRegistry.register(id, css);
    }
    // ShadowPiercer（分层降级）
    this.#initShadowPiercer();
    // RouteDetector（返回 restore）
    const routeHandle = initRouteDetector(this.#config.routes || [], (from, to) => {
      if (to?.enterFragment) FragmentRegistry.activate(to.enterFragment);
      if (from) {
        const prev = (this.#config.routes || []).find(r => r.id === from);
        if (prev?.exitFragment) FragmentRegistry.deactivate(prev.exitFragment);
      }
    });
    this.#disposers.push(routeHandle);
    // ContextAwareEngine
    const contextHandle = initContextEngine(this.#config.exposedState || []);
    this.#observers.push({ disconnect: () => clearInterval(contextHandle.interval) });
    // 兜底 observer（封装现有 AdaptiveMutationObserver 逻辑）
    this.#initFallbackObserver();
  }

  dispose() {
    for (const obs of this.#observers) obs.disconnect?.();
    for (const d of this.#disposers) d.disconnect?.();
    FragmentRegistry.dispose();
    SafeAttachShadowPatcher.uninstall();
    this.#observers = []; this.#disposers = [];
    delete window.__AGENTSKIN_DEEP_CORE__;
    // window[MARKER] 由主进程 CLEAR_ADAPTERS_BODY 清理，此处不重复
  }
}
```

### 4.10 适配器迁移模板（P1-4 兼容 structural-template.ts）

**P1-4 修复**: `structural-template.ts` 用正则 `const\s+STRUCTURAL_CSS\s*=\s*`([\s\S]*?)`;` 提取模板。迁移时 DEEP_CONFIG **禁用反引号模板字符串**（避免正则误匹配），改用对象字面量 + 双引号字符串。

**迁移步骤**（以 engines/codex/adapter.mjs 为例）:

```
Step 1: 保留不变的部分
─────────────────────
- HOST_CLASS 常量
- STRUCTURAL_CSS 常量（反引号模板字符串）
- discoverAndOverrideTokens() 函数
- window[MARKER] 重复检查守卫

Step 2: 新增 deep-config 内联（禁用反引号模板!）
───────────────────────
在 adapter.mjs IIFE 顶部添加:
  const DEEP_CONFIG = {
    shadowMode: "open-only",
    routes: [
      { id: "composer-open", test: { selector: "[data-composer-expanded]" }, enterFragment: "panel-composer", exitFragment: null }
    ],
    fragments: {
      "panel-composer": ".my-class { background: var(--agentskin-surface); }"
    },
    exposedState: [
      { key: "inCoarseMode", from: "window", path: "__CODEX_COARSE_MODE__" }
    ],
    enabled: true
  };
  ★ 关键: 所有字符串用双引号，禁止反引号模板
  ★ 位置: DEEP_CONFIG 必须在 STRUCTURAL_CSS 之后（避免正则误匹配）

Step 3: 替换自愈逻辑
────────────────────
移除: AdaptiveMutationObserver 初始化 + 5s setInterval 代码块（步骤 283-298）
替换为:
  if (DEEP_CONFIG.enabled && typeof DeepCore !== "undefined") {
    try { new DeepCore(DEEP_CONFIG, { agent: AGENT_ID, themeId: THEME_ID, heroUrl: HERO_URL, HOST_CLASS: HOST_CLASS }); return "applied"; }
    catch (err) { console.warn("[adapter] DeepCore failed, fallback:", err); }
  }
  // ... 原有逻辑作为 fallback ...

Step 4: 验证清单
─────────────────
[ ] host class 仍被添加（不变）
[ ] art 滴入仍生效（不变）
[ ] Token 覆盖仍生效（不变）
[ ] DEEP_CONFIG 双引号（P1-4: hasStructuralTemplate 仍非空）
[ ] Fragment 注入按路由条件触发（新增）
[ ] shadow DOM open 子树样式生效（新增）
[ ] remove 后原型还原 + Fragment 清理（新增）
```

### 4.11 测试项目补充（P0-3 修复）

**修改文件**: `vitest.config.ts`

```typescript
// ─── 在 projects 数组末尾（visual-regression 之后）新增────────────────────────
{
  test: {
    name: 'deep-core',
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integrate/**/*.test.ts'],
    testTimeout: 10000,
    pool: 'threads',
  },
},
```

**目录结构**（新增）:

```
tests/
├── unit/
│   ├── fragment-registry.test.ts      ← FragmentRegistry 纯逻辑
│   ├── shadow-patcher.test.ts         ← SafeAttachShadowPatcher install/uninstall
│   ├── route-detector.test.ts         ← testRoute + history patch/restore
│   ├── context-engine.test.ts         ← readState + 点分路径
│   └── clear-deep-core.test.ts        ← CLEAR_DEEP_CORE_BODY 引用常量正确
├── integrate/
│   ├── deep-core-lifecycle.test.ts    ← new DeepCore → dispose 往返
│   └── fragment-priority.test.ts      ← Fragment vs custom 优先级
└── visual-regression/                 ← 已有
```

---

## 5. 风险与兜底

| # | 风险 | 等级 | 触发条件 | 兜底策略 | 检测机制 | 发现阶段 |
|---|------|------|---------|---------|---------|---------|
| R1 | attachShadow patch 与目标应用冲突 | P0 | 目标应用自身 patch attachShadow | `shadowMode: 'open-only'` 降级 | `attachShadow.toString()` native code 检测 | T6 |
| R2 | remove 时原型还原失败 | P0 | `__agentskin_shadow_orig__` 丢失 | try-catch + 可选链 + delete | `typeof attachShadow === 'function'` | T3 |
| R3 | CSS 变量名冲突 | P1 | 目标组件内部声明同名变量 | `--ag-` 唯一前缀 + 遮蔽检测 | probe-shadow-scope.mjs | T9 |
| R4 | FragmentRegistry 热替换闪烁 | P1 | deactivate→activate 间隙 16ms | 优先 `hotReplace`（原子 replaceSync） | 无闪烁 | T2 |
| R5 | WorkBuddy 多 target 原型污染 | P0 | 13+ 同渲染进程 target | 强制 `shadowMode: 'open-only'` | 白名单判定 | T13 |
| R6 | 版本漂移选择器失效 | P1 | 应用改版后选择器命中率=0 | 6 个月未验证自动降级 | `lastVerified` + CI check | T12 |
| R7 | 双 Observer 并发 | P1 | engine 内置 + DeepCore 同时运行 | DeepCore 接管后旧 observer 完全移除 | `window[MARKER]` 检查 | T4 |
| R8 | 豆包 webview 差异 | P2 | chromium-webview CSS 行为未知 | `shadowMode: 'variables-only'` | 豆包独立功能探测 | T14 |
| R9 | Fragment vs custom 优先级反转 | P2 | Fragment 插入 custom 之后 | `activate()` findIndex(custom) 定位 | 视觉回归 | T15 |
| R10 | DeepCore 初始化失败 | P2 | API 不可用或配置错误 | try-catch fallback 原有逻辑 | console.warn | T4 |
| R11 | 性能预算超支 | P1 | scanOpenShadows 大型 SPA | requestIdleCallback 分片 + 性能守卫 | PerformanceRecorder | T16 |
| R12 | DEEP_CONFIG 反引号模板误匹配 | P2 | structural-template.ts 正则提取 | DEEP_CONFIG 禁用反引号模板（P1-4） | hasStructuralTemplate 回归 | T4 |

### 5.1 回滚方案（quintuple）

| 层级 | 机制 | 触发条件 |
|------|------|---------|
| 运行时回滚 | `try { new DeepCore() } catch { /* fallback 原有逻辑 */ }` | DeepCore 初始化 throw |
| 配置降级 | `DEEP_CONFIG.enabled = false` 顶检跳过 | 管理员/用户手动关闭 |
| Git 分批上线 | 每 Agent 独立 feature 分支 + PR 需全绿 | 集成断裂 |
| 首 Agent 验证 | Codex 先验证再推广 | 新端推广前 |
| 紧急闭角 | `npm run check` 门禁阻止 push 未验证改动 | 任何批次 |

---

## 6. 分批落地计划

### 第一批（P0 · 基础设施，~3 天）

| # | 任务 | 改动范围 | 验收 |
|---|------|---------|------|
| T1 | 编写 `engines/shared/deep-core.mjs`（纯脚本无 import/export，~400 行） | 新文件 1 个 | 现有 adapter 零报错 |
| T2 | 实现 `FragmentRegistry` | 在 deep-core.mjs 内 | 单元测试: activate→replace→deactivate 无闪烁 |
| T3 | 扩展 `buildClearEngineInjectionExpression()`（+4 行 CLEAR_DEEP_CORE_BODY） | injection-runtime.ts | remove 后 `attachShadow === orig` |
| T4 | 新增 DEEP_CORE_GLOBAL / SHADOW_ORIG_REF 常量 | injection-constants.ts | 常量供清理表达式使用 |
| T5 | orchestrator.ts 增加 deep-core 源码读取和拼接 | orchestrator.ts | evaluate 上下文可访问 DeepCore class |
| T6 | 新增 vitest.config.ts deep-core project | vitest.config.ts | `npm run check` 覆盖 tests/unit + tests/integrate |

### 第二批（P1 · 能力模块，串行依赖 T1）

| # | 任务 | 依赖 | 验收 |
|---|------|------|------|
| T7 | ShadowPiercer + SafeAttachShadowPatcher + 分片 open-shadow 扫描 | T1 | Codex open-shadow 穿透 |
| T8 | RouteDetector（声明式 test + history restore） | T1 | Codex 路由切换 Fragment ≤500ms |
| T9 | ContextAwareEngine（window/dom/sessionStorage + 点分路径） | T1 | Codex 状态变化 Fragment 正确 |
| T10 | Codex adapter.mjs 集成 DeepCore + DEEP_CONFIG（**双引号**） | T7-T9 | 集成 + hasStructuralTemplate 回归 |
| T11 | **L1 单元测试**（5 个 test.ts 文件） | T7-T9 | 全绿 |

**⚠️ 批内串行**: T7 → T8 → T9 → T10-T11

### 第三批（P2 · 全端推广 + 验证）

| # | 任务 | 验收 |
|---|------|------|
| T12 | TRAE / WorkBuddy / QoderWork / ZCode / 豆包依次集成（按复杂度升序） | 每端通过 `npm run check` |
| T13 | WorkBuddy `shadowMode: 'open-only'` 验证 | 多 target 无交叉 |
| T14 | 豆包 `shadowMode: 'variables-only'` 功能探测 | webview 内 CSS 变量穿透验证 |
| T15 | 全端 Shadow DOM 视觉回归（6/6 端 open-shadow 像素对比） | 全端 open-shadow 生效（closed 仅覆盖新创建） |
| T16 | 性能基线测量（增量 ≤200ms，内存 ≤2MB） | 通过 |
| T17 | 回滚演练（DeepCore 初始化失败 → fallback 原有逻辑） | try-catch 生效 |
| T18 | `npm run check` 全量 + visual-regression 2060+ 测试 | 全绿 |

---

## 7. 测试策略（三层金字塔）

```
        ┌──────────────────┐
        │    L3 E2E 探测    │  ← 真实 CDP 端口 + 运行中 Agent
        │  (debug-tools/*)  │     nightly / release 前
        ├──────────────────┤
        │   L2 集成测试     │  ← Vitest + happy-dom (模拟 DOM)
        │ (tests/integrate) │     PR 门禁
        ├──────────────────┤
        │   L1 单元测试     │  ← Vitest + pure logic
        │  (tests/unit/)    │     PR 门禁
        └──────────────────┘
```

### L1 单元测试（新增 deep-core project）

| 模块 | 测试文件 | 覆盖点 |
|------|---------|--------|
| FragmentRegistry | `tests/unit/fragment-registry.test.ts` | register → activate → hotReplace → deactivate → dispose |
| SafeAttachShadowPatcher | `tests/unit/shadow-patcher.test.ts` | install(idempotent) → inject → uninstall(roundtrip) |
| RouteDetector | `tests/unit/route-detector.test.ts` | testRoute + history patch + **restore 调用后还原** |
| ContextAwareEngine | `tests/unit/context-engine.test.ts` | readState(window/dom/sessionStorage) + 点分路径 |
| CLEAR_DEEP_CORE_BODY | `tests/unit/clear-deep-core.test.ts` | 验证清理表达式引用常量名（DEEP_CORE_GLOBAL / SHADOW_ORIG_REF） |

### L2 集成测试（同上 project）

| 场景 | 测试文件 | 验证 |
|------|---------|------|
| Full lifecycle | `tests/integrate/deep-core-lifecycle.test.ts` | new DeepCore → SPA nav → dispose 往返 |
| Fragment priority | `tests/integrate/fragment-priority.test.ts` | Fragment 在 custom 之前插入 |

### L3 E2E 探测脚本（debug-tools/）

| 脚本名称 | 用途 |
|---------|------|
| `debug-tools/probe-deep-core-shadow.mjs <port>` | 验证 ShadowPiercer 注入深度 |
| `debug-tools/probe-deep-core-routes.mjs <port>` | 验证 Fragment 路由切换 |
| `debug-tools/probe-deep-core-dispose.mjs <port>` | 验证 remove 后原型 + history 还原 |
| `debug-tools/benchmark-deep-core.mjs <port>` | 注入耗时/内存基线 |

---

## 8. 人工复核项

1. **Codex closed shadow DOM 分布**: 哪些 UI 组件使用 closed shadow DOM？是否有必须 shadowMode='all' 才能覆盖的组件？→ 决定是否引入 shadowMode='all'
2. **WorkBuddy 渲染进程隔离模型**: 13+ CDP target 是否有共享 JS 上下文？→ 决定强制 'open-only'
3. **豆包 webview CSS 穿透**: 实测变量穿透 closed shadowRoot
4. **TRAE 双前缀与 Fragment 交互**: Fragment 热替换对双前缀体系稳定性的影响
5. **deep-core.mjs 构建打包范围**: 确认 resolveEngineDirDefault 拷贝 engines/ 是整目录还是仅三件套目录，决定 shared/ 是否被包含
6. **用户可写 deep-config 的未来安全**: 如果未来允许主题包携带 deep-config，需加强 JSON schema 沙箱
7. **性能预算验收**: T16 测量的具体基线目标是否合理

---

## 9. 评审结论

（v4 修订记录: P0-1 源码拼接替代 ES import; P0-2 DeepCore 写回 window[MARKER]; P0-3 vitest deep-core project; P1-1 history restore; P1-2 closed-shadow 边界明确; P1-3 常量注入 injection-constants; P1-4 DEEP_CONFIG 双引号兼容 structural-template; P1-5 分片异步 scanOpenShadows。）

---

## 附录 A: 多维加权评分

| 维度 | 权重 | A（渐进增强） | B（独立 L4+ 层） | **C（DeepCore 共享 + 拼接）** |
|------|------|:-----------:|:--------------:|:---------------------------:|
| 业务根治 | 5 | 3 | 5 | 5 |
| 场景兼容 | 4 | 5 | 3 | 5 |
| 故障安全 | 5 | 4 | 3 | 5 |
| 工程契约 | 4 | 3 | 5 | 5 |
| 可工程化 | 5 | 3 | 5 | 5 |
| 架构一致 | 5 | 5 | 3 | 5 |
| 长期演进 | 4 | 3 | 5 | 5 |
| 边界健壮 | 4 | 4 | 4 | 5 |
| **总分** | — | 135 | 148 | **185** |

## 附录 B: GitHub 参考项目

| 项目 | 借鉴点 | 不适合复制的部分 |
|------|--------|----------------|
| **Stylus** (openstyles/stylus) | 不 patch attachShadow 的克制策略；cssRules 遍历注入 | 无法处理 closed shadowDOM |
| **Spicetify** (spicetify.app) | css-map.json 选择器映射 + 版本漂移防护 + 模块化 CSS 片段系统 | Spotify 专用注入通道 |
| **Vencord** (Vendicated/Vencord) | onStart/onStop 生命周期 API + 热替换 CSS 管理 | asar-patch webpack hook |
| **Dark Reader** (darkreader.org) | CSS 变量为主的分层降级 + 性能预算守卫 | 大量 CSS 生成逻辑过于重量级 |
| **BetterDiscord** | 主题元数据格式 + 纯 CSS 热重载 | Discord 专用 preload API |
| **CodeDrobe** (第三方) | rootAny 多选择器首选+兜底模式 | 未公开完整注入引擎代码 |
| **Lit** (lit-element) | adoptedStyleSheets 传入 shadowRoot 的官方模式 | 组件框架，非注入器 |

## 附录 C: 术语表

| 术语 | 定义 |
|------|------|
| L0-L4 | ARCHITECTURE.md 权威定义的 5 层注入分层 |
| custom layer | 用户自定义 CSS（无编号，排在 L4 之后） |
| DeepCore | 新增 `engines/shared/deep-core.mjs` 共享运行时（纯脚本无 import/export） |
| 源码拼接 | orchestrator.ts 将 deep-core.mjs 源码前置拼接到 adapterJs 字符串，使 evaluate 上下文可直接访问 DeepCore class |
| FragmentRegistry | DeepCore 模块之一，管理 CSS 片段的 register/activate/hotReplace/dispose |
| SafeAttachShadowPatcher | 单例守卫 + 100% 原型还原的 attachShadow 安全补丁 |
| shadowMode | 注入力度: `variables-only` / `open-only` / `all` |
| DEEP_CONFIG | 内联到 adapter.mjs 头部的深度适配配置常量（双引号字符串，禁用反引号模板） |
| DEEP_CORE_GLOBAL | `window.__AGENTSKIN_DEEP_CORE__` 运行时句柄标识常量 |
| SHADOW_ORIG_REF | `window.__agentskin_shadow_orig__` 原生 attachShadow 引用保存常量 |

## 附录 D: 文件改动总览

| 文件路径 | 操作 | 改动量 | 类型影响 |
|---------|------|--------|---------|
| `engines/shared/deep-core.mjs` | 新增 | ~400 行 | 纯脚本（无 import/export），evaluate 上下文运行 |
| `src/shared/injection-runtime.ts` | 修改 | +16 行 | +2 import +9 常量 +1 追加 +4 注释 |
| `src/shared/injection-constants.ts` | 修改 | +11 行 | +2 常量 +注释 |
| `src/main/palette/orchestrator.ts` | 修改 | +10 行 | 5→4 文件读取 + 拼接逻辑 |
| `vitest.config.ts` | 修改 | +15 行 | +1 project: deep-core |
| `engines/codex/adapter.mjs` | 修改 | +20/-30 行 | 净减，替换自愈逻辑为 DeepCore |
| `engines/traework/adapter.mjs` | 修改 | 沿用 T4 模式 | ... |
| `engines/workbuddy/adapter.mjs` | 修改 | 沿用 T4 模式 | ... |
| `engines/qoderwork/adapter.mjs` | 修改 | 沿用 T4 模式 | ... |
| `engines/doubao/adapter.mjs` | 修改 | 沿用 T4 模式 | ... |
| `engines/zcode/adapter.mjs` | 修改 | 沿用 T4 模式 | ... |
| `engines/INDEX.md` | 修改 | +shared/ 授权段落 | ... |
| `scripts/check-deep-config.mjs` | 新增 | ~80 行 | CI 校验 deep-config DEEP_CONFIG 格式 |
| `tests/unit/fragment-registry.test.ts` | 新增 | ~60 行 | ... |
| `tests/unit/shadow-patcher.test.ts` | 新增 | ~50 行 | ... |
| `tests/unit/route-detector.test.ts` | 新增 | ~40 行 | ... |
| `tests/unit/context-engine.test.ts` | 新增 | ~40 行 | ... |
| `tests/unit/clear-deep-core.test.ts` | 新增 | ~30 行 | 断言常量名一致 |
| `tests/integrate/deep-core-lifecycle.test.ts` | 新增 | ~80 行 | ... |
| `tests/integrate/fragment-priority.test.ts` | 新增 | ~50 行 | ... |
| `debug-tools/probe-deep-core-*.mjs` (3 个) | 新增 | ~150 行 | ... |

## 附录 E: 性能基线获取方式

**工具**: PerformanceRecorder（已有） + 新增的 E2E benchmark 脚本。

**方法**:

1. 基线数据采集（在各 Agent 现有代码上执行）:
   - 注入耗时: injectThemeViaEngine → waitForTheme 返回的时间差
   - 内存: performance.memory.usedJSHeapSize before/after 差值
   - CPU: Chrome DevTools Performance 面板 MutationObserver 回调耗时

2. benchmark 脚本:
   ```bash
   node debug-tools/benchmark-deep-core.mjs <port> --runs=30
   # 输出: { injectMs: { p50, p95, p99 }, memoryDeltaMb, observerCpuMs }
   ```

3. 门禁阈值（PR 阶段）:
   - 注入耗时 p95 ≤ 100ms
   - 内存增量 ≤ 2MB
   - Fragment 热替换 ≤ 16ms（1 frame）

## 附录 F: 修复追踪

| 编号 | 问题类型 | 问题描述 | 修复版本 |
|------|---------|---------|---------|
| P0-1 | 硬伤 | `import { DeepCore }` 在 evaluate 上下文 SyntaxError | v4: 源码拼接替代 |
| P0-2 | 硬伤 | DeepCore 不写 window[MARKER] 致清理链断裂 | v4: 构造成功后写回 |
| P0-3 | 硬伤 | vitest include 不覆盖 tests/unit + integrate | v4: 新增 deep-core project |
| P1-1 | 遗漏 | history patch 无还原 | v4: RouteDetector 返回 restore |
| P1-2 | 遗漏 | closed shadow 边界不明确 | v4: G1 验收仅覆盖 open-shadow + 新创建 |
| P1-3 | 遗漏 | 常量硬编码违反契约 | v4: 引入 injection-constants.ts |
| P1-4 | 遗漏 | DEEP_CONFIG 反引号模板破坏 structural-template 提取 | v4: 禁用反引号模板 |
| P1-5 | 遗漏 | scanOpenShadows 同步全量遍历卡顿 | v4: requestIdleCallback 分片 |

---

> RFC v4 完成。已修复全部 P0（3 项）+ P1（5 项）。下一步: 评审确认后启动 T1-T6。
