# engines — CDP 注入引擎集

## 用途

通过 Chrome DevTools Protocol 为 6 款 AI 应用提供视觉定制注入。

## 引擎架构（2 个核心引擎）

AgentSkin 采用 2 个核心引擎的注入架构：

| 引擎 | 运行位置 | 职责 | 管理的层 |
|------|---------|------|---------|
| **engine-strategy** | 主进程 | 主题 CSS 定义 + 初始注入 | palette, tokens, cosmetic, theme, custom |
| **unified/engine.mjs** | 页面内统一引擎 | 合并自 7 个旧模块，提供完整的页面内生命周期 | adapter, dynamic-overrides, deep-core |

### 职责划分

```
┌─────────────────────────────────────────────────────────┐
│                  engine-strategy（主进程）                   │
│  职责：定义所有 CSS 变量 + 初始注入                         │
│  管理：--agentskin-* (14 token)                          │
└─────────────────────────────────────────────────────────┘
                           │ CDP 注入（脚本拼接）
                           ▼
┌─────────────────────────────────────────────────────────┐
│              unified/engine.mjs（页面内）                   │
│  统一引擎：合并自 7 个旧模块                               │
│    1. style-injector    → Sheet 管理 + rAF 注入          │
│    2. adapter-engine    → 适配器工厂 createAdapter        │
│    3. token-discovery   → 增量 token 发现                │
│    4. self-heal         → MutationObserver + 自愈        │
│    5. deep-core         → Shadow DOM piercing            │
│    6. visual-engine     → --ag-* 变量协调                │
│    7. verify-and-feedback → 注入验证（已弃用，主进程替代）│
│  管理：--ag-glass-*, --ag-art-*, --ag-particle-*, --ag-deco-* │
└─────────────────────────────────────────────────────────┘
```

### Token 所有权

| Token 前缀 | 所有者 | 说明 |
|-----------|--------|------|
| `--agentskin-*` | engine-strategy | 14 核心 token |
| `--ag-glass-*` | unified engine → visual | 毛玻璃强度 |
| `--ag-art-*` | unified engine → visual | 焦点定位 |
| `--ag-particle-*` | unified engine → visual | 粒子效果 |
| `--ag-deco-*` | unified engine → visual | 装饰预设 |
| `--ag-text-shadow` | unified engine → visual | 文本阴影 |

**原则**：`--agentskin-*` 由 engine-strategy 定义；`--ag-*` 由 unified engine 在 adapter 侧定义。

---

## 页面执行引擎（Unified）

| 文件 | 用途 | 状态 |
|------|------|------|
| `unified/engine.mjs` | 统一引擎（合并自 7 个旧模块） | **当前** |
| `shared/semantic-selectors.json` | 共享选择器数据（被 build-theme-package 使用） | 活跃 |

---

## 注入流程

### 阶段 1：CDP 连接与脚本拼接（主进程 orchestrator.ts）

```
palette.css + tokens.css + cosmetic.css + theme.css + custom.css  →  合并为 allCss
unified/engine.mjs（单一文件，不再拼接 7 模块）
<adapter>/adapter-config.mjs (可选)
<adapter>/adapter.mjs
  └→ 拼接为 finalAdapterJs（用 '\n;' 分隔）
```

### 阶段 2：CDP Runtime.evaluate（页面内）

```
Step 1: CLEAR_ADAPTERS_BODY + CLEAN_HOST_BODY（清理上次注入）
Step 2: injectHeroAssets（注入图片 blob URL）
Step 3: 设置 window.__AGENTSKIN_CONFIG__
Step 4: buildStyleExpression(allCss)  →  写入 <style id="agentskin-style">
Step 5: evaluate(finalAdapterJs)  →  执行 unified/engine.mjs + adapter-config + adapter.mjs
```

### 阶段 3：运行时主题更新

```
用户操作（主题切换 / 滑块）
  ├─ 增量（1-2 token）→ hotSwap(tokens)              →  ~1ms
  ├─ 完整切换          → CLEAN + re-inject（全量重拼接）→  ~10ms
  └─ CSS 继承          → :root 变量覆盖 → 子元素自动继承  →  O(1)
```

---

## 适配器清单

| 目录 | 目标应用 | 特殊能力 | 架构 |
|------|---------|---------|------|
| `traework/` | traework | VS Code shell, --vscode-icube-* token, solo-lite 适配 | IIFE |
| `qoderwork/` | qoderwork | --color-* token, DeepCore open-only shadow | IIFE |
| `workbuddy/` | workbuddy | --cb-* / --wb-* token, ambient-router | IIFE |
| `doubao/` | doubao | --dbx-* 系列 + dark-mode-remap + background-self-heal | IIFE |
| `codex/` | codex | 多版本选择器（`selectors.contract.json` 溯源合同 C14）+ codex-dream-skin 兼容 + CSP 降级链 | IIFE |
| `zcode/` | zcode | file:// 协议 + 启发式 token 发现, geometry-based 侧边栏检测 | **config-driven** |

### adapter.mjs 大小（约）

| 适配器 | 行数 | 复杂度 |
|--------|------|--------|
| traework | 490 | 中 |
| qoderwork | 410 | 低 |
| workbuddy | 570 | 中 |
| doubao | 1116 | 高 |
| codex | 416 | 中 |
| zcode | 65 (~380 in adapter-config) | 低（引擎抽象后） |

---

## 不变量与检查

| # | 不变量 | 守卫 |
|---|--------|------|
| C4 | 分层依赖方向 | 层数从 8 → 5：palette → tokens → cosmetic → theme → custom + adapter[visual, dynamic, deep-core] |
| C11 | 注入引擎协作无冲突 | 单 MO 实例 + 单 cooldown 状态 + 单 --ag-* 变量块 |
| C14 | codex 选择器溯源 | `codex/selectors.contract.json`（tier + 证据）；`check-selector-provenance.mjs` 双向校验 |

### 验证方式

```bash
npm run check   # 全量校验
npm test        # 单元测试
```

---

## 工程联动图（简化）

```
window.__agentskin__ 命名空间结构（由 unified/engine.mjs 注册）:
  .engine            — { createAdapter, installPersistScript }
  .sheetManager      — { install, adopt, release, releaseAll }
  .tokenDiscovery    — { createAgent }
  .selfHeal          — { AdaptiveMutationObserver, createSelfHeal, … }
  .visual            — { coordinate, adapt, hotSwap, … }
  .adapterVersionManager — { registerSelectors, getSelectors, … }
  .DeepCore          — DeepCore class
  .FragmentRegistry  — class

适配器通过 window.__agentskin__?.xxx 访问；
主进程 CLEAR_ADAPTERS 链依赖裸全局 key 做删除标记，故裸全局兼容保留。

zcode (config-driven):
  ├── adapter-config.mjs  ← 配置对象 (selectors, CSS, token, deep, hooks)
  └── adapter.mjs         ← 薄包装器 (createAdapter + apply)

doubao/ 额外：
  ├── background-self-heal.mjs  ← 独立背景层自愈
  └── dark-mode-remap.mjs        ← 暗色模式重映射
```

---

## 变更影响速查

| 模块 | 风险等级 | 原因 |
|------|---------|------|
| `unified/engine.mjs` | 高 | 统一引擎 — 所有页面内功能的单一入口 |
| `shared/adapter-engine.mjs` | 高（已弃用） | 所有使用 createAdapter 的适配器共用 — 保留供测试 |
| `shared/style-injector.mjs` | 高（已弃用） | 全部 6 适配器的 CSS 注入基础 — 保留供测试 |
| `shared/self-heal.mjs` | 高（已弃用） | 全部 6 适配器的自愈 + 安全 — 保留供测试 |
| `shared/token-discovery.mjs` | 中（已弃用） | 4 个适配器的 token 发现 — 保留供测试 |
| `shared/visual-engine.mjs` | 高（已弃用） | 所有 --ag-* 视觉变量 — 保留供测试 |
| `shared/verify-and-feedback.mjs` | 中（已弃用） | 注入验证 — 保留供测试 |
| `shared/adapter-version-manager.mjs` | 低 | codex / workbuddy 使用 |
