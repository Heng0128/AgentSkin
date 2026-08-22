# P0-1 · CDP 注入 CSS Specificity 护栏（FM-2.1 失效模式）

> 状态: **设计稿**
> 日期: 2026-08-23
> 关联 RFC: `2026-08-22-theme-compiler-unified.md`（λ 方案 Stage 4 emit.ts）
> 失效模式: FM-2.1 — Emit 产物 specificity 未按 Agent 分层，单一规则在豆包/TRA Work 等端被原生样式覆盖，主题完全失效
> 范围: `scripts/generators/*.mjs`（6 文件）、`scripts/theme-utils.mjs`（tokenBlock）、`scripts/build-theme-package.mjs`（HOST_SELECTOR）、`src/compiler/emit.ts`（λ 新建）

---

## 1. 失效模式定义

**FM-2.1**: 编译器 Emit 阶段生成的 CSS selector specificity 未按目标宿主应用分层管理，导致 AgentSkin 声明的 token 被宿主应用原生样式覆盖，主题视觉完全失效。

**触发条件**: 当 manifest 同时有 14 核心 token + 6 装饰 token + 3 signal token（合计 23 token）时，各适配器 specificity 策略不一致，部分规则 specificity 低于宿主原生声明，被覆盖。

**影响范围**: 全部 6 适配器；当前 doubao.css 已因 specificity 不足导致 626 处 !important 补丁（P6 异常，59.3 KB）。

---

## 2. 当前 6 适配器 Specificity 策略审计

| 适配器 | host 变量 | tokenBlock 包装 | 实际 specificity | 策略枚举 |
|--------|-----------|-----------------|-----------------|----------|
| **doubao** | `html.agentskin-host-doubao` | `${host}:root` | (0,2,1) | `element:root` 双提升 |
| **codex** | `:root.agentskin-host-codex` | `${host}` 直接 | (0,1,0) | 单 class on `:root` |
| **traework** | `html.agentskin-host-traework` | `${host} body` | (0,1,2) | `element + body` 后代 |
| **workbuddy** | `html.agentskin-host-workbuddy` | `body[data-application-name="workbuddy"]` | (0,1,1) | `body + attribute` |
| **qoderwork** | `html.agentskin-host-qoderwork` | `${host}:root` | (0,2,1) | `element:root` 双提升 |
| **zcode** | `html.agentskin-host-zcode` | `${host}:root` | (0,2,1) | `element:root` 双提升 |

**关键发现**:

1. **策略碎片化**: 6 适配器使用 4 种不同的 specificity 策略，无统一 schema 约束。
2. **doubao 双轨制**: doubaoCss.mjs 内部用 `${host}:root`（0,2,1）声明 token，但 `${host}:root body`（0,2,2）覆盖 body 层——同一文件内 specificity 不一致，且 body 层 626 处 !important 是 specificity 失控的直接后果。
3. **workbuddy 最低**: `body[data-application-name="workbuddy"]` 仅 (0,1,1)，若 WorkBuddy 原生用更高 specificity 声明 `--vscode-*`，token 将被覆盖。
4. **build-theme-package.mjs 独立映射**: 该文件的 `HOST_SELECTOR` 常量（第 70-78 行）与 6 个 generator 文件的 host 变量**不完全一致**——codex 在 generator 用 `:root.agentskin-host-codex`，在 build-theme-package 用 `html.agentskin-host-codex`，存在 specificity 漂移风险。
5. **tokenBlock 无感知**: `theme-utils.mjs:214` 的 `tokenBlock(t, host, bridge)` 纯字符串拼接，不计算 specificity，不校验预算。

---

## 3. Specificity Profile Schema 设计

### 3.1 数据结构

```typescript
// src/compiler/types.ts（λ 方案扩展）

/** 每个 Agent 声明的 specificity 策略 */
export interface SpecificityProfile {
  /** Agent ID（对齐 C1 不变量） */
  agentId: AgentId;

  /**
   * 作用域策略枚举 — 决定 Emit 时 selector wrapper 的选择
   * - 'host-class'       : `${host}` 单 class（codex 模式，最低）
   * - 'element-host'     : `html.agentskin-host-{id}` 元素+类（zcode/qoderwork 模式）
   * - 'element-root'     : `${host}:root` 双提升（doubao 模式，最高）
   * - 'body-attribute'   : `body[data-application-name="{id}"]`（workbuddy 模式）
   */
  scopeStrategy: 'host-class' | 'element-host' | 'element-root' | 'body-attribute';

  /**
   * !important 预算 — 单文件最大 !important 数量
   * 超过时触发自动降级或 @layer 拆分
   * 推荐值: doubao ≤ 200（当前 626），其余 ≤ 50
   */
  importantBudget: number;

  /**
   * 降级顺序 — 超出 budget 时的自动策略
   * - 'wrap'    : 用更高 specificity 的 selector 包裹（如加 `:root`）
   * - 'layer'   : 拆分到 `@agentskin` layer，用层叠顺序取胜
   * - 'split'   : 将 token 拆分为多个文件，每文件独立 budget
   */
  fallbackOrder: Array<'wrap' | 'layer' | 'split'>;

  /**
   * 宿主应用原生最大 specificity — 来自 CDP 探测
   * Emit 产物 specificity 必须 > 此值才能保证覆盖
   * 例: doubao `:root[data-theme="dark"]` = (0,1,1)，traework `body` = (0,0,1)
   */
  hostMaxSpecificity: [number, number, number];

  /**
   * 是否需要 specificity 守卫的装饰 token
   * Swiss 单档位 shadow-float 的 --agentskin-shadow-accent 若被宿主原生
   * box-shadow 覆盖，需启用守卫
   */
  decorationGuard: boolean;
}
```

### 3.2 6 适配器 Profile 预设

```typescript
// src/compiler/constants.ts

export const SPECIFICITY_PROFILES: Record<AgentId, SpecificityProfile> = {
  doubao: {
    agentId: 'doubao',
    scopeStrategy: 'element-root',        // (0,2,1) — 当前策略
    importantBudget: 200,                  // 从 626 降至 200
    fallbackOrder: ['layer', 'wrap'],
    hostMaxSpecificity: [0, 1, 1],         // :root[data-theme="dark"]
    decorationGuard: true,                 // shadow-accent 需守卫
  },
  codex: {
    agentId: 'codex',
    scopeStrategy: 'host-class',           // (0,1,0) — 当前策略
    importantBudget: 30,
    fallbackOrder: ['wrap', 'layer'],
    hostMaxSpecificity: [0, 1, 0],         // :root 单 class
    decorationGuard: false,
  },
  traework: {
    agentId: 'traework',
    scopeStrategy: 'element-host',         // (0,1,1) — 当前 `${host} body`
    importantBudget: 50,
    fallbackOrder: ['wrap', 'layer'],
    hostMaxSpecificity: [0, 0, 1],         // body 原生
    decorationGuard: false,
  },
  workbuddy: {
    agentId: 'workbuddy',
    scopeStrategy: 'body-attribute',       // (0,1,1) — 当前策略
    importantBudget: 50,
    fallbackOrder: ['wrap', 'layer'],
    hostMaxSpecificity: [0, 1, 0],         // :root 或 [data-theme]
    decorationGuard: true,                 // VS Code 架构 box-shadow 覆盖风险高
  },
  qoderwork: {
    agentId: 'qoderwork',
    scopeStrategy: 'element-root',         // (0,2,1)
    importantBudget: 50,
    fallbackOrder: ['layer', 'wrap'],
    hostMaxSpecificity: [0, 1, 1],         // :root[data-theme]
    decorationGuard: false,
  },
  zcode: {
    agentId: 'zcode',
    scopeStrategy: 'element-root',         // (0,2,1)
    importantBudget: 30,
    fallbackOrder: ['layer', 'wrap'],
    hostMaxSpecificity: [0, 1, 0],
    decorationGuard: false,
  },
};
```

### 3.3 Emit 时自动选择 Selector Wrapper

```typescript
// src/compiler/emit.ts（λ 方案 Stage 4 扩展）

/**
 * 根据 SpecificityProfile 生成最优 selector wrapper
 * 返回 { selector, specificity } 供后续校验
 */
function resolveSelectorWrapper(
  profile: SpecificityProfile,
  baseHost: string
): { selector: string; specificity: [number, number, number] } {
  switch (profile.scopeStrategy) {
    case 'host-class':
      return { selector: `:root.agentskin-host-${profile.agentId}`, specificity: [0, 1, 0] };
    case 'element-host':
      return { selector: `html.agentskin-host-${profile.agentId}`, specificity: [0, 1, 1] };
    case 'element-root':
      return { selector: `html.agentskin-host-${profile.agentId}:root`, specificity: [0, 2, 1] };
    case 'body-attribute':
      return { selector: `body[data-application-name="${profile.agentId}"]`, specificity: [0, 1, 1] };
  }
}
```

---

## 4. Output 验证层设计

### 4.1 验证管线

```
Emit CSS 字符串
    │
    ▼
┌─────────────────────────────────────────────────────────┐
│  Step 1: Parse — 用 PostCSS 解析生成 CSS 为 AST        │
│  提取每条 rule 的 selector + declaration                │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│  Step 2: Calculate — 计算每条 selector 的 specificity   │
│  算法: ID×100 + class/attr/pseudo×10 + element×1       │
│  输出: Map<rule, [a,b,c]>                               │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│  Step 3: Predict — 与宿主应用已有 selector 做冲突预测   │
│  输入: profile.hostMaxSpecificity（CDP 探测基线）       │
│  规则: 若 emit specificity ≤ hostMax → 冲突预警        │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│  Step 4: Guard — 违反时自动修复                         │
│  4a. 若 !important 未超 budget → 加 !important          │
│  4b. 若已超 budget → 按 fallbackOrder 降级             │
│      - 'wrap': 用更高 specificity selector 包裹         │
│      - 'layer': 移入 @agentskin layer                  │
│      - 'split': 拆分为多文件                            │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
              验证通过的 CSS 产物
```

### 4.2 Specificity 计算函数

```typescript
// src/compiler/specificity.ts（新建）

/** 计算单条 selector 的 specificity [a, b, c] */
export function calculateSpecificity(selector: string): [number, number, number] {
  // 使用 PostCSS Selector Parser 拆解
  // a = ID 选择器数量
  // b = class + attribute + pseudo-class 数量
  // c = element + pseudo-element 数量
  // 实现参考 W3C CSS Selectors Level 4 规范
}

/** 比较两个 specificity: a > b 返回 1, a < b 返回 -1, 相等返回 0 */
export function compareSpecificity(
  a: [number, number, number],
  b: [number, number, number]
): number {
  if (a[0] !== b[0]) return a[0] > b[0] ? 1 : -1;
  if (a[1] !== b[1]) return a[1] > b[1] ? 1 : -1;
  if (a[2] !== b[2]) return a[2] > b[2] ? 1 : -1;
  return 0;
}
```

### 4.3 冲突预测与自动修复

```typescript
// src/compiler/specificity.ts

export interface SpecificityViolation {
  selector: string;
  emitted: [number, number, number];
  hostMax: [number, number, number];
  property: string;
  fix: 'add-important' | 'wrap-selector' | 'move-to-layer';
}

/** 扫描生成 CSS，返回所有 specificity 冲突 */
export function detectConflicts(
  cssAst: Root,
  profile: SpecificityProfile
): SpecificityViolation[] {
  const violations: SpecificityViolation[] = [];
  cssAst.walkRules((rule) => {
    const spec = calculateSpecificity(rule.selector);
    if (compareSpecificity(spec, profile.hostMaxSpecificity) <= 0) {
      violations.push({
        selector: rule.selector,
        emitted: spec,
        hostMax: profile.hostMaxSpecificity,
        property: rule.first?.prop ?? '',
        fix: profile.fallbackOrder[0] === 'wrap' ? 'wrap-selector' : 'move-to-layer',
      });
    }
  });
  return violations;
}
```

---

## 5. Swiss 单档位 shadow-float 兼容性

### 5.1 问题分析

Swiss 设计系统仅保留单一 `shadow-float` 档位。装饰层的 `--agentskin-shadow-accent` 作为 6 装饰 token 之一，在 Emit 时同样面临 specificity 竞争：

- **doubao**: 原生 `--s-shadow-lv*-brand` 系列（5 档位 brand shadow）已被显式设为 `none`（doubaoCss.mjs:651-661），但若有遗漏的 `box-shadow` 内联样式，`--agentskin-shadow-accent` 的 `box-shadow` 声明可能被覆盖。
- **workbuddy**: VS Code 架构的 `--vscode-widget-shadow` 直接作用于编辑器 widget，若 AgentSkin 用 `--agentskin-shadow-accent` 装饰 specificity 不足则失效。

### 5.2 守卫策略

| 场景 | 守卫方式 | 触发条件 |
|------|---------|---------|
| `box-shadow` 被宿主原生覆盖 | `decorationGuard: true` 时自动加 `!important` | specificity 冲突检测触发 |
| `shadow-accent` 引用链断裂 | Emit 时校验 `--agentskin-shadow-accent` 是否被声明 | tokenBlock 扩展时 |
| 装饰 token 整体失效 | `@agentskin-decorations` layer 隔离 | fallbackOrder 含 `layer` 时 |

**结论**: `decorationGuard` 字段已纳入 SpecificityProfile schema，doubao 和 workbuddy 启用，其余默认关闭。

---

## 6. 代码改动点清单（仅列出，不修改）

### 6.1 新增文件

| 文件路径 | 职责 | 行数估算 |
|---------|------|---------|
| `src/compiler/specificity.ts` | specificity 计算 + 冲突检测 + 自动修复 | ~200 行 |
| `src/compiler/specificity.test.ts` | specificity 计算单元测试 | ~150 行 |
| `src/shared/specificity-profiles.ts` | 6 适配器 SpecificityProfile 常量注册表 | ~80 行 |
| `scripts/check-specificity-budget.mjs` | 独立校验脚本（对齐 C6 check-design-tokens 模式） | ~120 行 |

### 6.2 需要修改的函数

| 文件 | 函数签名 | 行为变更 |
|------|---------|---------|
| `scripts/theme-utils.mjs` | `tokenBlock(t, host, bridge)` | 新增可选参数 `profile?: SpecificityProfile`，Emit 时根据 profile.scopeStrategy 自动选择 selector wrapper |
| `scripts/build-theme-package.mjs` | `HOST_SELECTOR` 常量（第 70-78 行） | 与 `SPECIFICITY_PROFILES` 对齐，消除 codex 的 `:root.` vs `html.` 差异 |
| `scripts/generators/doubaoCss.mjs` | `doubaoCss(t)` | 将 `${host}:root body` 的 626 处 !important 降至 ≤200，超量部分走 `@agentskin` layer |
| `scripts/generators/workbuddyCss.mjs` | `workbuddyCss(t)` | `body[data-application-name="workbuddy"]` 若 specificity 不足，自动升级为 `html.agentskin-host-workbuddy body[data-application-name]` |
| `src/compiler/emit.ts`（λ 新建） | `emitAgentCss(ast, profile)` | 集成 specificity 验证层，Emit 后自动调用 `detectConflicts` 并修复 |

### 6.3 需要的测试用例

| 测试类型 | 用例描述 | 验收标准 |
|---------|---------|---------|
| 单元 | `calculateSpecificity(':root.agentskin-host-codex')` | 返回 `[0,1,0]` |
| 单元 | `calculateSpecificity('html.agentskin-host-doubao:root')` | 返回 `[0,2,1]` |
| 单元 | `compareSpecificity([0,2,1], [0,1,1])` | 返回 `1` |
| 单元 | `detectConflicts` 对 doubao.css 扫描 | 识别所有 specificity ≤ (0,1,1) 的规则 |
| 集成 | 23 token × 6 adapter Emit 全量 | 每文件 !important 数 ≤ profile.importantBudget |
| 集成 | `decorationGuard: true` 时 `--agentskin-shadow-accent` Emit | 自动加 `!important` 或移入 layer |
| 回归 | 14 token（无装饰/signal）Emit 产物 | byte-identical 对比现有产物 |
| 回归 | 23 token Emit 产物 specificity 全部 > hostMax | 0 冲突 |

---

## 7. 风险与兜底

| # | 风险 | 等级 | 兜底策略 |
|---|:----:|------|---------|
| R1 | PostCSS 解析性能在低配设备不达标 | P2 | specificity.ts 用轻量正则替代完整 AST 解析（fallback 路径） |
| R2 | `hostMaxSpecificity` CDP 探测基线不准 | P1 | 保守估计 + 用户可手动覆盖 profile 配置 |
| R3 | 自动加 `!important` 导致级联战争 | P2 | 严格 budget 控制 + `@agentskin` layer 作为最终兜底 |
| R4 | 装饰 token 拆分到 layer 后动画关键帧引用断裂 | P3 | layer 内保持 token 声明顺序，@keyframes 注册在 layer 外 |
| R5 | 与 λ 方案 emit.ts 集成时序冲突 | P3 | specificity 护栏作为 emit.ts 的 post-process 阶段，不阻塞主流程 |

---

## 8. 与 λ 方案的关系

本护栏是 λ 方案 `emit.ts` 的**子模块**，不独立存在：

- **λ-1 阶段**: emit.ts 骨架 + 6 adapter CSS 生成 → 同步集成 specificity profile
- **λ-2 阶段**: optimize.ts 增量缓存 → specificity 校验结果纳入 cache key
- **λ-3 阶段**: diagnostics.ts → `check-specificity-budget.mjs` 逻辑迁入

**不修改现有脚本**直至 λ 方案批准落地；此前 `check-specificity-budget.mjs` 作为独立脚本先行运行，输出冲突报告但不修改产物。

---

## 9. 审批门

- [x] C1 不变量: agentId 四源一致（profile 以 agentId 为 key）
- [x] C2 不变量: 14-token 契约不变（specificity 护栏不修改 token 内容）
- [x] C4 分层: specificity.ts → emit.ts → compiler 包，无逆向依赖
- [x] C6 设计 token: decorationGuard 对齐 Swiss 单档位 shadow-float
- [ ] λ 方案批准后同步落地
- [ ] 6 适配器 hostMaxSpecificity 基线需 CDP 实测校准

---

**未批前不改代码。批准后随 λ 方案 Phase 顺序分批落地。**
