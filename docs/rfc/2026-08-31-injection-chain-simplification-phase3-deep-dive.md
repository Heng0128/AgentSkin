# RFC 2026-08-31 (v2): Injection Chain 深度缩减 — 基于竞品对标

> **状态**: DRAFT  
> **作者**: Architecture Audit  
> **日期**: 2026-08-31  
> **范围**: 页面内引擎 + 主进程 CDP 层 + 适配器文件结构  
> **动机**: RFC v1 完成了 Phase 1-3（7→1 引擎合并 + Pipeline 形式化）。本轮对标 DreamWork / Codex-Dream-Skin / Deluze 三个开源项目，发现并规划剩余的 30% 冗余代码的清理。

---

## 1. 对标竞品架构发现

### 1.1 竞品核心结构

| 项目 | 总 LOC | 注入引擎 CDP 层 | 适配器设计 | 主题结构 |
|------|--------|----------------|-----------|---------|
| **DreamWork** | ~4,500 | `electron/manager/`: injector.ts + cdp.ts + discovery.ts (3 文件) | `app-profiles/{codex,workbuddy}.ts` (2 文件,纯数据) | `theme/{id}/`: theme.json + theme.css + hero.png |
| **Codex-Dream-Skin** | ~5,200 | `runtime/`: renderer-inject.js (单文件 IIFE ~1042 行) | `selectors.json` (数据文件) | `runtime/`: dream-skin.css + theme.json |
| **Deluze** | ~3,800 | `src/inject/`: 单一注入函数 | 无适配器概念 (纯 CSS) | `themes/`: 单一 JSON + CSS |
| **AgentSkin (当前)** | ~18,000 | `src/main/cdp/`: 35+ 文件, `engines/unified/` + `engines/shared/` | 6 个适配器目录 × 5 文件 = 30 文件 | agentskin-theme 包: manifest + palette.css + 6 CSS + 预览图 |

### 1.2 核心差异

#### 差异 1: 页面内执行方式

```javascript
// Codex-Dream-Skin (IIFE 单文件 renderer-inject.js)
((cssText, artDataUrl, themeConfig) => {
  const SELECTOR_CONTRACT = __DREAM_SKIN_SELECTORS_JSON__; // JSON 数据注入
  // ... 全部逻辑在一个闭包中 ...
})(INJECTED_CSS, INJECTED_ART, INJECTED_CONFIG);

// DreamWork (injector.ts 主进程控制一切)
class CdpSession {
  async applyTheme(theme) {
    const css = this.buildCss(theme); // 主进程生成完整 CSS
    await this.send('Runtime.evaluate', { expression: css }); // CSS 即注入
  }
}

// AgentSkin (我们): 主进程拼接多段 JS + CSS，页面内执行复杂引擎
// orchestrator.ts: palette.css → tokens.css → cosmetic.css → unified engine → adapter-config → adapter
```

**竞品启示**: DreamWork 和 Codex-Dream-Skin 都将复杂逻辑放在**主进程**或**CSS**中，页面内只有简单应用逻辑。AgentSkin 页面内引擎承载了过多职责。

#### 差异 2: 选择器管理

| 项目 | 方式 | 位置 |
|------|------|------|
| DreamWork | TypeScript 常量内联 | `app-profiles/codex.ts` |
| Codex-Dream-Skin | JSON 数据文件 (运行时读取) | `tools/selectors.json` |
| Deluze | CSS 自定义属性 + :has() | `src/css/vars.css` |
| **AgentSkin** | **JS 模块 + JSON 混合 + 运行时代码生成** | `adapter-config.mjs` + `token-discovery.mjs` |

**竞品启示**: 选择器应该是**数据**（JSON），不是**代码**（JS 模块）。Codex-Dream-Skin 的 `selectors.json` 有 8+ 版本验证记录，每条选择器都有 provenance。

#### 差异 3: 主题格式

| 项目 | 格式 | 主要字段 |
|------|------|---------|
| DreamWork | theme.json + theme.css | `colors: {bg, panel, accent, ...}` |
| Codex-Dream-Skin | theme.json + dream-skin.css | `colors` + `art` + `tokens` |
| **AgentSkin** | agentskin-theme 包 | manifest.json (schema v2) + palette.css (14 token) + 6 个 agent CSS + 预览图 |

**竞品启示**: 主题应该更简单。14-token 契约是 AgentSkin 的优势（设计令牌系统），但不应为每个 Agent 生成独立 CSS 文件。一份 CSS + 选择器数据足够。

---

## 2. AgentSkin 当前冗余点详细分析

### 2.1 engines/shared/ — 已弃用但未被删除 (7+5=12 文件)

```
engines/shared/
├── adapter-engine.mjs        ← DEPRECATED (已合并入 unified)
├── adapter-version-manager.mjs ← 未被 orchestrator 加载(死代码?)
├── adapter-version-manager.test.mjs
├── deep-core.mjs             ← DEPRECATED
├── deep-core.test.mjs
├── self-heal.mjs             ← DEPRECATED
├── semantic-selectors.json   ← 数据文件 (应保留)
├── style-injector.mjs        ← DEPRECATED
├── token-discovery.mjs       ← DEPRECATED
├── token-discovery.test.mjs
├── verify-and-feedback.mjs   ← DEPRECATED
└── visual-engine.mjs         ← DEPRECATED
```

**问题**: orchestrator.ts 已通过 `getSharedModuleList()` 加载 `engines/unified/engine.mjs`。旧模块不再被生产代码加载。

**影响**: 死代码占用仓库体积，混淆新开发者（不确定哪个才是真实路径）。

### 2.2 每个适配器目录的过度设计

```
engines/codex/
├── adapter-config.mjs  ← ~150 行: 选择器 + 条件逻辑 + 运行时代码
├── adapter.mjs         ← ~80 行:  结构适配 + 自愈
├── cosmetic.css        ← ~50 行:  视觉微调
└── tokens.css          ← ~30 行:  token 映射

engines/doubao/
├── adapter-config.mjs  ← ~200 行 (更复杂)
├── adapter.mjs         ← ~120 行
├── background-self-heal.mjs  ← ~100 行 (独有的背景层自愈)
├── cosmetic.css
├── dark-mode-remap.mjs       ← ~60 行 (暗色重映射)
├── dark-mode-remap.test.mjs
└── tokens.css

engines/workbuddy/
├── adapter-config.mjs
├── adapter.mjs
├── ambient-router.mjs  ← ~100 行 (路由感知透明度)
├── ambient-router.test.mjs
├── cosmetic.css
└── tokens.css
```

**问题**: 每个适配器约有 300-500 行 JS 代码，其中约 40% 是通用逻辑（应该已在 unified engine 中）。

**竞品对比**: DreamWork 只有 `app-profiles/codex.ts` (一个适配器约 80 行纯数据)，没有独立的 adapter.mjs。

### 2.3 src/main/cdp/ — 文件膨胀

```
src/main/cdp/ (35+ 文件)
├── apply-baseline.ts / .test.ts
├── baseline-css-capture.ts / .test.ts
├── baseline-css-replay.ts / .test.ts
├── baseline-gate.ts / .test.ts
├── baseline-manager.ts / .test.ts
├── baseline-validator.ts / .test.ts
├── cdp-client.ts / .test.ts
├── cdp-fanout.ts / .test.ts
├── cdp-fingerprint.ts
├── cdp-inject.ts / .test.ts
├── cdp-reconnect.ts / .test.ts
├── cdp-targets.ts / .test.ts
├── css-service.ts / .test.ts
├── dom-tree.ts
├── hard-watchdog.ts / .test.ts
├── inspect-session.ts / .test.ts
├── landmark-preflight.ts / .test.ts
├── markdown-injector.ts / .test.ts
├── node-cascade.ts
├── per-window-preflight.ts / .test.ts
├── port-config.ts / .test.ts
├── port-manager.ts
├── port-lease-pool.ts / .test.ts
├── port-resolver.ts / .test.ts
├── port-resolver-cap.ts / .test.ts
├── port-resolver-devtools.ts / .test.ts
├── preflight.ts
├── reconnection-backoff.ts / .test.ts
├── reload-watchdog.ts / .test.ts
├── renderer-fingerprint.ts / .test.ts
├── renderer-guardian.ts / .test.ts
├── renderer-rank.ts / .test.ts
├── renderer-tools.ts
├── secondary-inject.ts / .test.ts
├── selector-generator.ts / .test.ts
├── selector-utils.ts
├── selector-validator.ts / .test.ts
├── session-pool.ts / .test.ts
├── snapshot-theme.ts / .test.ts
├── surface-rect.ts
├── watchdog.ts / .test.ts
├── injection/ (子目录)
└── wallpaper/ (子目录)
```

**问题**:
1. 一对 `.ts` + `.test.ts` 模式导致文件数量翻倍
2. 多数文件 < 100 行逻辑代码（不含测试）
3. `baseline-*` 系列 6 个文件做的是同类基线管理
4. `port-resolver-*` 系列 4 个文件做的是端口发现

**竞品对比**: DreamWork 只有 `cdp.ts` (一个 CDP 会话类) + `discovery.ts` (发现) + `theme-paths.ts` (路径)。

### 2.4 adapter-version-manager.mjs — 200 行未使用的版本管理

```javascript
// engines/shared/adapter-version-manager.mjs
// 功能: 版本检测 + 选择器注册表 + 健康状态
// 导出: registerSelectors, getVersionSpecificSelectors, ...
// 实际被加载: 不确定 (orchestrator.ts 未引用)
```

**如果这个文件不被 orchestrator.ts 加载，它就是死代码。**

---

## 3. 新的缩减方案

### Phase 3-A: 清理 engines/shared/ 死代码 (阻塞率: 高, 风险: 低)

#### 3.1 确认 adapter-version-manager 是否被加载

```
任务: 搜索 orchestrator.ts / engine-strategy.ts / 主进程中是否 import/require:
  - "adapter-version-manager"
  - "adapterVersionManager"
  - "registerSelectors"
  - "getVersionSpecificSelectors"
```

**如果无引用**: 可直接删除 `adapter-version-manager.mjs` + `adapter-version-manager.test.mjs`

#### 3.2 删除 7 个 DEPRECATED 模块

| 文件 | 删除前需确认 |
|------|------------|
| `style-injector.mjs` | 无生产代码引用 (仅 token-discovery.test.mjs 可能 mock) |
| `adapter-engine.mjs` | 无生产代码引用 |
| `token-discovery.mjs` | 无生产代码引用 |
| `self-heal.mjs` | 无生产代码引用 |
| `deep-core.mjs` | 无生产代码引用 |
| `visual-engine.mjs` | 无生产代码引用 |
| `verify-and-feedback.mjs` | 无生产代码引用 |

**额外删除对应测试**:
- `token-discovery.test.mjs`
- `deep-core.test.mjs`

**保留**:
- `semantic-selectors.json` (数据文件, 可能被引用)

#### 3.3 重构 engines/ 目录结构

**目标结构**:

```
engines/
├── engine.mjs              ← 当前的 unified/engine.mjs (简化命名)
├── engine.test.mjs
├── selectors.json          ← 共享选择器 (当前是 semantic-selectors.json)
├── adapters/
│   ├── codex.json          ← adapter-config.mjs → JSON
│   ├── codex.mjs           ← 精简后的 adapter.mjs (~30 行)
│   ├── doubao.json
│   ├── doubao.mjs
│   ├── qoderwork.json
│   ├── qoderwork.mjs
│   ├── traework.json
│   ├── traework.mjs
│   ├── workbuddy.json
│   ├── workbuddy.mjs
│   ├── zcode.json
│   └── zcode.mjs
└── css/
    ├── codex-cosmetic.css
    ├── codex-tokens.css
    ├── doubao-cosmetic.css
    ├── doubao-tokens.css
    └── ...
```

**好处**:
- `engines/` 根目录只有 3-4 文件
- 适配器选择器是 JSON 数据 (Codex-Dream-Skin 模式)
- CSS 集中管理，不再散落在适配器目录
- 容易看清全局结构

### Phase 3-B: 适配器 JS → JSON 配置 (阻塞率: 中, 风险: 中)

#### 3.4 当前 adapter-config.mjs 分析

典型 adapter-config.mjs 的结构:

```javascript
// engines/codex/adapter-config.mjs (当前 ~150 行)
export const agentId = 'codex';
export const cosmeticSelector = 'html.agentskin-host-codex';
export const selectors = {
  mainSurface: ['main[class*="MainContentSurface"]', '[data-app-shell-main-surface]'],
  sidebar: ['aside.app-shell-left-panel'],
  chatInput: ['.composer-surface-chunk'],
  // ...
};
export const heuristics = {
  cspReport: (violation) => { /* ... 20 行逻辑 ... */ },
  darkMode: { /* ... 15 行 ... */ },
};
export function getContextState() { /* ... 30 行 ... */ }
```

**问题**: 选择器 + 条件判断 + 回调函数混合在一个模块中。

#### 3.5 JSON 转换方案

```json
// engines/adapters/codex.json
{
  "agentId": "codex",
  "version": "2.0",
  "hostSelector": "html.agentskin-host-codex",
  "selectors": {
    "mainSurface": {
      "candidates": [
        "main[class*=\"MainContentSurface\"]",
        "[data-app-shell-main-surface]"
      ],
      "probe": "count:2"
    },
    "sidebar": {
      "candidates": ["aside.app-shell-left-panel"],
      "probe": "count:1"
    },
    "chatInput": {
      "candidates": [".composer-surface-chrome", "[class*=\"_ComposerLayoutRoot_\"]"],
      "probe": "count:1"
    }
  },
  "signals": {
    "darkMode": "html.electron-dark",
    "lightMode": "html.electron-light"
  },
  "features": {
    "cspCheck": true,
    "darkModeRemap": false,
    "backgroundSelfHeal": false,
    "ambientRouter": false
  }
}
```

**好处**:
- 选择器数据有统一的 provenance (来源记录)
- 容易做版本对比和差异查看
- 未来可以工具化生成 / 校验
- 统一引擎只读 JSON，不需要执行动态模块

#### 3.6 adapter.mjs 精简

当前 adapter.mjs 的典型结构 (~100 行):

```javascript
// 当前 engines/codex/adapter.mjs
((config) => {
  const adapter = window.__agentskin_shared_engine__.createAdapter({ agentId: 'codex' });
  const me = window.__agentskin_token_discovery__.createAgent({ agentId: 'codex' });
  
  // 40 行: host class 添加/移除
  if (!document.documentElement.classList.contains(config.hostClass)) {
    document.documentElement.classList.add(config.hostClass);
  }
  
  // 30 行: structural CSS 注入
  const style = document.createElement('style');
  style.textContent = `/* 结构 CSS */`;
  document.head.appendChild(style);
  
  // 20 行: 自愈逻辑 (已有 unified engine 提供)
  if (config.needsSelfHeal) {
    window.__agentskin_self_heal__.createSelfHeal({ /* ... */ });
  }
  
  // 10 行: 运行状态反馈
  return { status: 'applied', agentId: 'codex' };
})(__ADAPTER_CONFIG__);
```

**精简后** (~30 行):

```javascript
// 目标 engines/adapters/codex.mjs
(config => {
  // 全部使用 unified engine API
  const skin = window.__agentskin__;
  skin.sheetManager.adopt(config.cssBlocks);
  skin.tokenDiscovery.createAgent({ agentId: config.agentId }).scan();
  return { ok: true, agentId: config.agentId };
})(ADAPTER_CONFIG_JSON);
```

**关键变化**: 不再重复实现 host class、structural CSS 注入、自愈。全部委托给 unified engine。

### Phase 3-C: 消除 per-adapter 独有 JS (阻塞率: 低, 风险: 低)

| 独有文件 | 功能 | 迁移方案 |
|---------|------|---------|
| `doubao/background-self-heal.mjs` | Doubao 反重置背景层 | 合并入 unified engine (通用 body style MutationObserver) |
| `doubao/dark-mode-remap.mjs` | Doubao 暗色模式重映射 | CSS 原生 `media (prefers-color-scheme: dark)` |
| `workbuddy/ambient-router.mjs` | 页面类型→透明度 | CSS `:has()` 选择器 + CSS 变量 |

**原理**: 这些"适配器独有"逻辑本质上是**通用模式**的特例。统一引擎可以提供一个标准的 CSS 变量 + MutationObserver 框架，不需要每种情况写一份。

### Phase 3-D: src/main/cdp/ 文件合并 (阻塞率: 高, 风险: 低)

#### 3.7 baseline-* 系列 → baseline.ts

**当前**: 6 个文件 (apply-baseline, baseline-css-capture, baseline-css-replay, baseline-gate, baseline-manager, baseline-validator) + 测试

**合并为**: 1 个 `baseline.ts` (~600 行内部模块)

```typescript
// src/main/cdp/baseline.ts
export class BaselineManager { /* ... */ }
export function applyBaseline() { /* ... */ }
export function captureBaselineCss() { /* ... */ }
export function replayBaselineCss() { /* ... */ }
export function validateBaseline() { /* ... */ }
export function gateBaseline() { /* ... */ }
```

**测试**: `baseline.test.ts` (一个测试文件包含所有相关测试)

#### 3.8 port-resolver-* 系列 → port-resolver.ts

**当前**: 4 个文件 (port-resolver, port-resolver-cap, port-resolver-devtools, port-lease-pool)

**合并为**: 1 个 `port-resolver.ts` (~400 行内部模块)

#### 3.9 preflight-* 系列 → preflight.ts

**当前**: `preflight.ts` + `per-window-preflight.ts` + `landmark-preflight.ts`

**合并为**: 1 个 `preflight.ts`

---

## 4. 预期收益

| 指标 | 当前 | Phase 3 后目标 | 减少 |
|------|------|---------------|------|
| `engines/shared/` 文件 | 12 | 1 (semantic-selectors.json) | ↓ 92% |
| `engines/` 总文件 | 42 | ~21 (adapters/*.json + *.mjs + css/) | ↓ 50% |
| `src/main/cdp/` 文件 | 35+ | ~20 (合并系列) | ↓ 43% |
| adapter JS 总行 | ~1800 | ~400 (纯 JSON + 精简 mjs) | ↓ 78% |
| 总注入引擎 LOC | ~8000 | ~3500 | ↓ 56% |

---

## 5. 执行计划

| # | 任务 | 依赖 | 风险 | 预计工作量 |
|---|------|------|------|----------|
| T1 | 验证 adapter-version-manager 加载情况 | 无 | 低 | 5 min |
| T2 | 删除 7 DEPRECATED 模块 + 测试 | T1 | 低 | 15 min |
| T3 | adapter-config.mjs → JSON 转换 | 无 | 中 | 2 hr |
| T4 | adapter.mjs 精简 (委托 unified engine) | T3 | 中 | 2 hr |
| T5 | 消除独有 JS (background-self-heal/dark-mode-remap/ambient-router) | T4 | 低 | 1 hr |
| T6 | src/main/cdp/ baseline 系列合并 | 无 | 低 | 1 hr |
| T7 | src/main/cdp/ port-resolver 系列合并 | 无 | 低 | 30 min |
| T8 | src/main/cdp/ preflight 系列合并 | 无 | 低 | 30 min |
| T9 | 验证: npm run check + 全量测试 | T1-T8 | — | 30 min |

---

## 6. 风险评估

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| adapter-version-manager 实际被某处动态加载 | 中 | 高 (功能缺失) | 全局 grep 包括注释/字符串/动态 require |
| JSON 转换遗漏 adapter-config 中的动态逻辑 | 中 | 中 | 先编译出每个 config 的统一 interface |
| adapter.mjs 精简破坏运行时多态 | 低 | 高 (主题应用失败) | 每转变一个 adapter 手动测试 |
| CDP 文件合并导致测试路径失效 | 低 | 低 | 使用 `vitest.config.ts` 的 module alias 或合并测试 |

---

## 7. Open Questions

1. `adapter-version-manager.mjs` 的真实加载位置在哪里？是否只是历史遗留？
2. 删除旧模块后，是否有主进程代码仍然 `import` 它们？
3. `semantic-selectors.json` 当前被哪些文件引用？
4. 6 个适配器的 `adapter-config.mjs` 中有多少是纯数据 vs 动态逻辑？

---

*RFC v2 结束 — 待 T1 验证结果后进入 Phase 3-A 执行*
