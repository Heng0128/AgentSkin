# RFC：注入引擎从 3+1 收敛为二引擎架构（v2 — 修订版）

> 状态：`待评审`
> 日期：2026-08-30
> 修订日期：2026-08-30（基于静态代码审计发现）
> 分支：`（待建）`
> 范围：`engines/shared/`、`src/shared/injection/orchestrator/`、`src/main/cdp/injection/`、`docs/ARCHITECTURE.md`、`engines/INDEX.md`
> 上游依据：多引擎协调失败的用户实感（闪烁 / 样式覆盖 / 背景图消失 / 时区覆盖 / 主题包解析不一致）

---

## 1. 背景与目标

### 1.1 关键发现：编排层是死代码

静态代码审计揭示了一个**颠覆性事实**：

| 模块 | 设计定位 | 实际状态 |
|------|---------|---------|
| `InjectionOrchestrator` | 4 引擎协调中心 | **死代码** — 生产代码从未调用 `execute()` |
| `InjectionLock` | per-agent 互斥锁 | **死代码** — 从未实例化 |
| `InjectionQueue` | per-agent 优先级队列 | **死代码** — 从未实例化 |
| `InjectionStateMachine` | 10 状态生命周期 | **死代码** — 从未实例化 |
| `InjectionSnapshotManager` | 事务性快照回滚 | **死代码** — 从未实例化 |
| `InjectionEngine` 接口 | 4 引擎统一契约 | **零实现** — 无生产类实现该接口 |

**实际注入流程**（非编排层）：

```
主进程 engine-strategy.ts
  → CDP Runtime.evaluate(脚本拼接)
    → 页面内 window.* 全局变量交互（last-writer-wins）
      → adapter.mjs 自执行
```

引擎间协调实际依赖：
- `window.__agentskin_sheet_manager__`（adopted-sheets-manager.mjs）的脆弱规避
- 各脚本 IIFE 的幂等守卫（`__AGENTSKIN_*_LOADED__` 标志位）
- 6 个 adapter 各自为政的 MutationObserver 自愈

### 1.2 问题：3+1 引擎的协调失败

AgentSkin 的注入引擎从最初的 1-2 个扩展到当前的 **3+1 结构**：

| 引擎 | 运行位置 | 当前定位 | 实际状态 |
|------|---------|---------|---------|
| **engine-strategy** | 主进程 | 独立引擎 | ✅ 实际运行 |
| **adapter-mjs** | 页面内 | 独立引擎 | ✅ 实际运行 |
| **DeepCore** | 页面内 | 名义"组件" | ⚠️ 独立引擎（6 个 adapter 各 `new DeepCore()`） |
| **HybridInjector** | 页面内 | 名义"组件" | ❌ **从未被主进程调用** |

**实感症状**（用户报告）：

1. **注入闪烁**：主题切换时出现多次视觉跳变，不是一次平滑过渡
2. **样式覆盖持续问题**：某些 CSS 规则被反复覆盖，无法稳定生效
3. **背景图闪烁、消失、被覆盖**：art layer 在注入后不稳定，时而消失被底层覆盖
4. **时区注入被覆盖**：无论第几次注入时区，都会被后续操作覆盖掉
5. **主题包每个引擎解析不一致**：同一主题包在不同引擎处理下输出不一致

### 1.3 根因分析

这些症状的根因不是编排层（因为编排层是死代码），而是**页面内引擎边界的模糊和全局变量的失控**：

1. **30+ 个 window.* 全局变量**：`__agentskin_sheet_manager__`、`__agentskin_token_discovery__`、`__AGENTSKIN_DEEP_CORE__`、`__AGENTSKIN_HYBRID_INJECTOR_LOADED__` 等，无命名空间隔离，无事务边界
2. **6 份重复的 AdaptiveMutationObserver**：每个 adapter 内联 50+ 行相同类定义，节流参数存在微妙差异
6. **三套并行自愈机制竞争**：MutationObserver（300ms debounce）+ 2s interval + 1.5s watchdog，无协调，可能互相覆盖
4. **hybrid-injector 从未被主进程调用**：`window.HybridInjector` 定义后无生产代码引用，是死代码
5. **注入时序硬编码**：5 段脚本拼接顺序是隐式约束，无显式守卫

### 1.4 目标

**收敛为 2 个引擎**，内部模块化：

| 引擎 | 运行位置 | 职责 | 内部组件 |
|------|---------|------|---------|
| **engine-strategy** | 主进程 | CSS 变量定义 + 初始注入 + CDP 连接管理 | glass-tokens, art-focus, particle-layer, decoration-presets, appearance-adaptive |
| **adapter-engine** | 页面内 | 统一接管所有页面内注入逻辑 | sheet-manager, token-discovery, deep-core, hybrid-injector, self-heal, visual-coordinator, hot-swap, injection-guard, injection-verifier, visual-quality-guarantor, config-snapshot |

**关键变化**：
- 删除编排层死代码（或保留接口但标记为 experimental）
- `HybridInjector` 和 `DeepCore` 从独立引擎降级为 `adapter-engine` 的内部组件
- 清理 30+ 个 `window.*` 全局变量，统一为 `window.__agentskin__` 命名空间
- 6 个 adapter 的重复代码提取为共享模块
- 三套自愈机制合并为一套

### 1.5 非目标

- 不新增适配器 / 不新增 UI 页面
- 不修改 14-token 契约 / 不修改 manifest schema
- 不改变 6 个 agent 各自的视觉输出
- 不重构 `engine-strategy` 的核心逻辑（CSS 变量注入保持不变）
- 不合并 `engine-strategy` 和 `adapter-engine` 为单一引擎（Electron 物理约束）

---

## 2. 触发条件（对照 AGENTS.md §6）

- [x] **重构注入架构（L0-L4 注入层）** → **是**。本次收敛直接重构引擎的**注册方式与边界定义**，将 4 个注册引擎收敛为 2 个，并清理编排层死代码。
- [ ] 新增 UI 页面
- [ ] 新增适配器
- [ ] 修改核心数据模型（manifest schema、14-token 契约等）

> 裁决：提交评审后实施。命中 §6 首项（重构注入架构），必须走 RFC 经评审通过后方可执行。

---

## 3. 现状侦察（代码锚点）

### 3.1 全局变量完整映射表

**`window.__agentskin_*`（lower_snake_case，引擎侧）**：

| 全局变量名 | 定义位置 | 引用位置 |
|---|---|---|
| `__agentskin_sheet_manager__` | `adopted-sheets-manager.mjs:109` | 6 adapter + particle-layer + decoration-presets + art-focus + glass-tokens |
| `__agentskin_token_discovery__` | `token-discovery.mjs:440` | 4 adapter + traework |
| `__agentskin_originalAdoptedSheetsDesc` | `adopted-sheets-manager.mjs:72` | `injection-runtime.ts:200-203` |
| `__agentskin_snapshot_*` (4 个) | `config-snapshot.mjs:144-147` | 主进程服务层 |
| `__agentskin_hot_swap_*` (3 个) | `theme-hot-swap.mjs:166-168` | 主进程服务层 |
| `__agentskin_injection_guard__` | `injection-guard.mjs:172` | 主进程服务层 |
| `__agentskin_verify_*` (5 个) | `injection-verifier.mjs:513-517` | 主进程服务层 |
| `__agentskin_dom_healer__` | `dom-self-heal.mjs:234` | 主进程服务层 |
| `__agentskin_coordinate_visuals__` | `visual-coordinator.mjs:135` | 主进程服务层 |
| `__agentskin_vq_guarantor__` | `visual-quality-guarantor.mjs:291` | 主进程服务层 |
| `__agentskin_adapt_appearance__` | `appearance-adaptive.mjs:110` | 主进程服务层 |
| `__agentskin_init_particles__` | `particle-layer.mjs:176` | 主进程服务层 |
| `__agentskin_adapter_version_manager__` | `adapter-version-manager.mjs:277` | 主进程服务层 |

**`window.__AGENTSKIN_*`（UPPER_SNAKE_CASE，主进程注入）**：

| 全局变量名 | 定义位置 | 引用位置 |
|---|---|---|
| `__AGENTSKIN_CONFIG__` | `injection-constants.ts:53` | 6 adapter |
| `__AGENTSKIN__` | `renderer-payload.mjs:211` | renderer-payload + theme-switcher-menu + 测试 |
| `__AGENTSKIN_DEEP_CORE__` | `deep-core.mjs:435` | `injection-runtime.ts:238` + deep-core |
| `__AGENTSKIN_DEEP_CORE_LOADED__` | `deep-core.mjs:64` | deep-core + injection-runtime |
| `__AGENTSKIN_SHEET_MANAGER_LOADED__` | `adopted-sheets-manager.mjs:27` | adopted-sheets-manager |
| `__AGENTSKIN_TOKEN_DISCOVERY_LOADED__` | `token-discovery.mjs:77` | token-discovery |
| `__AGENTSKIN_HYBRID_INJECTOR_LOADED__` | `hybrid-injector.mjs:31` | hybrid-injector |
| `__AGENTSKIN_FEEDBACK_LOADED__` | `injection-feedback.mjs:18` | injection-feedback |
| `__AGENTSKIN_FEEDBACK__` | `injection-feedback.mjs:145` | 主进程服务层 |
| `__AGENTSKIN_CODEX_SKIN_DISABLED__` | `codex-theme-v1.mjs:20` | codex-theme-v1 内部 |
| `__AGENTSKIN_CODEX_SKIN_STATE__` | `codex-theme-v1.mjs:132` | codex-theme-v1 内部 |

**`window.DeepCore` / `window.AdaptiveMutationObserver` / `window.HybridInjector`**：

| 全局类名 | 定义位置 | 引用位置 |
|---|---|---|
| `window.DeepCore` | `deep-core.mjs:666` | 6 adapter 各 `new DeepCore()` |
| `window.AdaptiveMutationObserver` | `deep-core.mjs:669` | 6 adapter 各定义 fallback 类 |
| `window.HybridInjector` | `hybrid-injector.mjs:293` | **无生产代码引用** |

### 3.2 编排层死代码清单

| 文件 | 行数 | 状态 |
|------|------|------|
| `orchestrator/injection-orchestrator.ts` | ~200 | 死代码（生产未调用） |
| `orchestrator/injection-lock.ts` | ~80 | 死代码 |
| `orchestrator/injection-queue.ts` | ~100 | 死代码 |
| `orchestrator/injection-state-machine.ts` | ~150 | 死代码 |
| `orchestrator/types.ts` | ~50 | 仅测试使用 |

### 3.3 6 adapter 重复代码清单

| 重复代码 | 每份行数 | 总冗余 |
|---------|---------|--------|
| `AdaptiveMutationObserver` 类 | ~50 行 | ~300 行 |
| `scheduleReinject()` 函数 | ~20 行 | ~120 行 |
| `matchesHeuristicRules()` 函数 | ~30 行 | ~180 行 |
| `progressiveRetry` 2s×5 模式 | ~15 行 | ~90 行 |
| `periodic self-heal` 2s 轮询 | ~25 行 | ~150 行 |
| `sheet watchdog` 1.5s 轮询 | ~20 行 | ~120 行 |

---

## 4. 设计方案

### 4.1 收敛策略：二引擎 + 内部模块化 + 清理死代码

**目标形态**：

```
┌─────────────────────────────────────────────────────────────┐
│                  主进程注入流程                               │
│  engine-strategy.ts → CDP evaluate(脚本拼接) → 页面内执行     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │   engine-strategy（主进程）                          │   │
│  │   - CSS 变量定义（palette/tokens/cosmetic/theme/custom）│   │
│  │   - CDP 连接管理                                     │   │
│  │   - 脚本拼接顺序控制                                  │   │
│  └─────────────────────────────────────────────────────┘   │
│                           │                                 │
│                           ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │   adapter-engine（页面内）                           │   │
│  │   ├─ sheet-manager（adopted-sheets-manager）          │   │
│  │   ├─ token-discovery                                │   │
│  │   ├─ deep-core（Shadow DOM）                         │   │
│  │   ├─ hybrid-injector（动态更新）                     │   │
│  │   ├─ self-heal（统一自愈）                           │   │
│  │   ├─ visual-coordinator                             │   │
│  │   ├─ hot-swap                                       │   │
│  │   ├─ injection-guard                                │   │
│  │   ├─ injection-verifier                             │   │
│  │   ├─ visual-quality-guarantor                       │   │
│  │   └─ config-snapshot                                │   │
│  │                                                     │   │
│  │   6 adapter 差异部分作为配置：                        │   │
│  │   ├─ traework: { selectors, artStrategy }           │   │
│  │   ├─ qoderwork: { selectors, artStrategy }         │   │
│  │   ├─ workbuddy: { selectors, artStrategy }         │   │
│  │   ├─ doubao: { selectors, artStrategy, darkRemap } │   │
│  │   ├─ codex: { selectors, artStrategy, cspFallback }│   │
│  │   └─ zcode: { selectors, artStrategy, semantic }   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  统一全局命名空间：window.__agentskin__ = {                  │
│    apply, restore, getAdapter, config, state               │
│  }                                                          │
└─────────────────────────────────────────────────────────────┘
```

### 4.2 变更 1：清理编排层死代码

**文件**：`src/shared/injection/orchestrator/`

- 删除 `injection-orchestrator.ts`、`injection-lock.ts`、`injection-queue.ts`、`injection-state-machine.ts` 的生产实现
- 保留 `types.ts` 中的类型定义（供测试使用）
- 保留测试文件（标记为 `@deprecated`）

**替代方案**：保留接口定义但标记为 `@experimental`，未来如需重新启用编排层可基于此接口。

### 4.3 变更 2：统一全局变量命名空间

**之前**：30+ 个零散 `window.*` 全局变量

**之后**：统一为 `window.__agentskin__` 命名空间

```javascript
// 页面内初始化时
window.__agentskin__ = window.__agentskin__ || {};
Object.assign(window.__agentskin__, {
  // 核心 API
  apply: async (css) => { /* ... */ },
  restore: async () => { /* ... */ },
  getAdapter: (id) => { /* ... */ },
  
  // 配置
  config: window.__AGENTSKIN_CONFIG__,
  
  // 状态
  state: {
    loaded: true,
    adapterId: 'traework',
    // ...
  },
  
  // 内部模块引用（不对外暴露）
  _sheetManager: null,
  _tokenDiscovery: null,
  _deepCore: null,
  _hybridInjector: null,
});
```

**保留的全局变量**（仅用于外部探测）：
- `window.__AGENTSKIN_CONFIG__` — 主进程注入的配置对象（不变）
- `window.__agentskin__` — 统一的 adapter API

### 4.4 变更 3：提取共享模块

**新增文件**：`engines/shared/adaptive-mutation-observer.mjs`

```javascript
// 统一的 AdaptiveMutationObserver，消除 6 份重复
(function() {
  'use strict';
  
  class AdaptiveMutationObserver {
    constructor(options) {
      this.debounceMs = options.debounceMs || 300;
      this.throttleWindowMs = options.throttleWindowMs || 10000;
      this.maxMutations = options.maxMutations || 50;
      this.cooldownMs = options.cooldownMs || 2000;
      // ...
    }
    // ...
  }
  
  window.__agentskin__ = window.__agentskin__ || {};
  window.__agentskin__.AdaptiveMutationObserver = AdaptiveMutationObserver;
})();
```

**新增文件**：`engines/shared/schedule-reinject.mjs`

```javascript
// 统一的 scheduleReinject 工厂函数
(function() {
  'use strict';
  
  function createScheduleReinject({ sheet, HOST_CLASS, rebuildCss }) {
    let timer = null;
    return function scheduleReinject() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        // 统一的 reinject 逻辑
        const css = rebuildCss();
        sheet.replaceSync(css);
        // ...
      }, 100);
    };
  }
  
  window.__agentskin__ = window.__agentskin__ || {};
  window.__agentskin__.createScheduleReinject = createScheduleReinject;
})();
```

### 4.5 变更 4：内部化 HybridInjector 和 DeepCore

**核心思路**：将 `HybridInjector` 和 `DeepCore` 从独立的 `window.*` 导出改为 `adapter-engine` 内部的私有类。

**文件**：`engines/shared/hybrid-injector.mjs`、`engines/shared/deep-core.mjs`

- 移除 `window.__AGENTSKIN_HYBRID_INJECTOR_LOADED__` 全局幂等守卫
- 移除 `window.__AGENTSKIN_DEEP_CORE_LOADED__` 全局幂等守卫
- 改为 `window.__agentskin__` 命名空间内的模块注册

```javascript
// deep-core.mjs 改造后
(function() {
  'use strict';
  
  class DeepCore { /* ... */ }
  
  window.__agentskin__ = window.__agentskin__ || {};
  window.__agentskin__.DeepCore = DeepCore;
})();
```

### 4.6 变更 5：统一自愈机制

**之前**：三套并行自愈（MutationObserver + 2s interval + 1.5s watchdog）

**之后**：一套统一自愈，内部协调

```javascript
// engines/shared/unified-self-heal.mjs
(function() {
  'use strict';
  
  class UnifiedSelfHeal {
    constructor(options) {
      this.observer = new AdaptiveMutationObserver({ ... });
      this.checkInterval = null;
      this.cooldown = false;
    }
    
    start() {
      // 1. MutationObserver 作为主要触发
      this.observer.start(this.onMutation.bind(this));
      // 2. 2s interval 作为兜底（仅在 observer 未触发时执行）
      this.checkInterval = setInterval(() => {
        if (!this.cooldown) this.check();
      }, 2000);
    }
    
    onMutation(mutations) {
      this.cooldown = true;
      this.heal();
      setTimeout(() => { this.cooldown = false; }, 2000);
    }
    
    check() { /* 检查 sheet 是否完整 */ }
    heal() { /* 执行修复 */ }
  }
  
  window.__agentskin__ = window.__agentskin__ || {};
  window.__agentskin__.UnifiedSelfHeal = UnifiedSelfHeal;
})();
```

### 4.7 变更 6：简化注入拼接顺序

**之前**（5 段拼接）：
```
adopted-sheets-manager → token-discovery → deep-core → hybrid-injector → adapter.mjs
```

**之后**（2 段拼接）：
```
shared-utils.mjs（包含 sheet-manager + token-discovery + deep-core + hybrid-injector + self-heal）
→ adapter.mjs（精简版，使用共享模块）
```

### 4.8 变更 7：更新文档

- `docs/ARCHITECTURE.md`：更新"引擎与运行时层"章节，删除编排层描述
- `engines/INDEX.md`：更新"核心引擎架构"章节，从 3 个引擎改为 2 个引擎
- `src/shared/injection/orchestrator/index.ts`：标记为 `@deprecated`

---

## 5. 风险与兜底

| # | 风险 | 等级 | 触发条件 | 兜底策略 | 检测机制 |
|---|------|------|----------|----------|----------|
| 1 | 清理全局变量后，外部探测/健康检查失效 | 中 | `checkThemeHealth` 等脚本依赖 `window.DeepCore` 等变量 | 更新探测脚本使用新的 `window.__agentskin__` API | `npm run check` 中的 C1 检查 |
| 2 | 统一自愈机制后，某些 agent 自愈行为变化 | 高 | 6 个 agent 中任一因统一自愈导致行为差异 | 逐 agent 对比；保留 agent 级自定义钩子 | 单元测试 + 集成测试 |
| 3 | 共享模块引入新的耦合 | 中 | 共享模块的 bug 影响所有 6 个 agent | 共享模块保持纯函数，无副作用 | 单元测试 |
| 4 | 回归：某 agent 视觉输出变化 | 高 | 6 个 agent 中任一因收敛导致样式差异 | 逐 agent 对比截图；保留收敛前的全局变量作为临时 fallback（兼容模式） | 视觉回归测试（602 tests） |
| 5 | 编排层测试大面积失败 | 中 | 删除编排层代码影响测试 | 更新测试用例；保留 deprecated type alias 过渡期 | `npm test` |
| 6 | 第三方/外部脚本依赖全局变量 | 低 | Studio 或其他内部模块通过 `window.*` 调用 | 提供兼容 shim 层（deprecated，6 个月后移除） | 代码搜索 `window.__agentskin_` |

---

## 6. 分批落地计划

| 阶段 | 内容 | 验收 |
|------|------|------|
| **P0** | 文档先行：更新 `engines/INDEX.md` 和 `docs/ARCHITECTURE.md`，明确"二引擎"叙事 | 文档与代码一致 |
| **P1** | 清理编排层死代码：删除未使用的实现，保留类型定义 | `npm run typecheck` 绿 |
| **P2** | 提取共享模块：创建 `adaptive-mutation-observer.mjs` 和 `schedule-reinject.mjs` | 单 adapter 引用正常 |
| **P3** | 统一全局变量：将 30+ 个 `window.*` 收敛为 `window.__agentskin__` 命名空间 | 6 agent 全量 apply/restore 正常 |
| **P4** | 内部化 HybridInjector 和 DeepCore：改为 `window.__agentskin__` 命名空间注册 | 单 agent apply 正常 |
| **P5** | 统一自愈机制：三套 → 一套 | 6 agent 自愈行为一致 |
| **P6** | 简化拼接顺序：5 段 → 2 段 | 启动注入正常，无闪烁 |
| **P7** | 全量复验：`npm run check` 全绿 + 视觉回归测试 + 人工 smoke | 全绿，验收项全达成 |

每阶段独立评审/回退；P0 先行以最小代价验证可行性，P2/P3 先单 agent 解剖。

---

## 7. 人工复核项

- **编排层死代码的处置**：完全删除还是保留接口标记 `@deprecated`？
- **全局变量清理的兼容策略**：是否提供 deprecated shim 层？如果提供，保留多久？
- **adapter.mjs 精简后的文件组织**：是保持多文件拼接（`shared-utils.mjs` + `adapter.mjs`），还是合并为单文件 `adapter-bundle.mjs`？
- **Studio 子系统是否依赖 `window.*` 全局变量**：需要排查 `src/ui/lib/snapshot-to-override.ts` 等模块
- **健康检查脚本的更新范围**：`checkThemeHealth` 等脚本是否探测 `window.DeepCore` 等变量？

---

## 8. 评审结论

（评审意见汇总，由评审人填写）
