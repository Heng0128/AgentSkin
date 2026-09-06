# RFC-2026-08-31: 引擎架构简化 — 27 模块 → 6 模块

> 状态: DRAFT
> 作者: CatPaw + snowb
> 日期: 2026-08-31
> 优先级: P1（架构债务阻碍开发效率）

---

## 1. 动机 (Motivation)

当前 AgentSkin 引擎层有 **27 个共享模块文件**（engines/shared/，含测试）+ **7 个主进程模块**（src/shared/injection/）+ 编排层（orchestrator/ + scene/）+ 6 个契约 JSON。

对比 DreamSkin 的注入引擎只有 **6 个核心文件**（cdp.ts / injector.ts / watcher.ts / theme-store.ts / app-registry.ts / injector.ts），AgentSkin 的复杂度是 DreamSkin 的 4 倍以上。

核心问题：
1. **视觉 token 定义 5 个文件**（glass-tokens / art-focus / particle-layer / decoration-presets / appearance-adaptive）遵循完全相同的 IIFE + CSS注入 + sheet_manager.adopt 模式，仅是 CSS 内容不同
2. **自愈/验证 7 个文件**（unified-self-heal / dom-self-heal / adaptive-mutation-observer / injection-guard / visual-coordinator / visual-quality-guarantor / injection-verifier）有大量重叠：每个都检查 token 是否存在、art 是否在渲染、host class 是否丢失
3. **Module Matrix** 是过度设计 — 从未触发过降级，却增加了模块注册/payload budget 的认知负担
4. **Scene Model + Scene Compiler** 在当前 6 适配器体系下使用率低，本质是"配置太多，运行时太少"
5. 新 contributor 需要阅读 455 行的 INDEX.md 才能理解注入流程

**目标：将 27 个共享模块合并为 6 个，主进程模块从 7 个减至 4 个，同时保留 AgentSkin 的全部独特能力。**

---

## 2. 当前状态盘点

### 2.1 engines/shared/ 的 27 个文件分类

| 类别 | 文件 | 行数（约） | 核心能力 |
|------|------|-----------|---------|
| **视觉 token** | glass-tokens.mjs | 114 | `--ag-glass-*` 变量 |
| | art-focus.mjs | 107 | `--ag-art-*` 变量 |
| | particle-layer.mjs | 180 | `--ag-particle-*` 变量 |
| | decoration-presets.mjs | 113 | `--ag-deco-*` 变量 |
| | appearance-adaptive.mjs | 114 | 亮暗自适应调整 |
| **视觉协调** | visual-coordinator.mjs | 139 | art+glass 联动 |
| **注入安全** | injection-guard.mjs | 182 | 边界检查 + 监控 |
| | visual-quality-guarantor.mjs | 300 | 质量根因保障 |
| | config-snapshot.mjs | 151 | 快照 + 回滚 |
| **自愈** | unified-self-heal.mjs | 150 | 协调入口 + cooldown |
| | dom-self-heal.mjs | 243 | MO 自愈循环 |
| | adaptive-mutation-observer.mjs | 94 | 节流 + 循环检测 |
| **注入器** | adopted-sheets-manager.mjs | 115 | setter 拦截 |
| | hybrid-injector.mjs | 295 | rAF 批量 + 原子替换 |
| **深度适配** | deep-core.mjs | 625 | Shadow DOM + 路由 |
| **Token 发现** | token-discovery.mjs | 444 | 增量扫描 + 分类 |
| **热切换** | theme-hot-swap.mjs | 172 | 运行时主题切换 |
| **验证** | injection-verifier.mjs | 521 | 综合验证报告 |
| **反馈** | injection-feedback.mjs | 147 | Overlay UI |
| **版本管理** | adapter-version-manager.mjs | 289 | 版本检测 + 选择器 |
| **测试** (10 个 .test.mjs) | 各模块测试 | ~1500 | CI 验证 |

### 2.2 src/shared/injection/ 的 7 个文件

| 文件 | 行数（约） | 职责 |
|------|-----------|------|
| agent-acceptance-protocol.ts | ~200 | 适配器验收协议 |
| contract-validator.ts | ~300 | CI 契约验证 |
| declarative-verifier.ts | ~200 | 声明式验证 |
| module-matrix.ts | ~150 | Payload budget 自动降级 |
| native-ui-adapter.ts | ~250 | 原生 UI 适配 |
| renderer-stable-wait.ts | ~200 | 渲染器稳定等待 |
| selector-candidate-scorer.ts | ~180 | 选择器评分 |

加上 orchestrator/types.ts（~100 行）+ scene/ 的 4 个文件（~500 行）。

---

## 3. 解决方案：合并方案

### 3.1 共享模块合并映射（27 → 7）

```
当前 27 个文件                    →  合并后 7 个文件
─────────────────────────────────────────────────────
glass-tokens.mjs                 ┐
art-focus.mjs                    │
particle-layer.mjs               ├→  visual-engine.mjs
decoration-presets.mjs           │
appearance-adaptive.mjs          │
visual-coordinator.mjs           ┘

unified-self-heal.mjs            ┐
dom-self-heal.mjs                │
adaptive-mutation-observer.mjs   ├→  self-heal.mjs
injection-guard.mjs              │
visual-quality-guarantor.mjs     ┘

adopted-sheets-manager.mjs       ┐
hybrid-injector.mjs              ├→  style-injector.mjs
injection-feedback.mjs           ┘

config-snapshot.mjs              ┐
injection-verifier.mjs           ├→  verify-and-feedback.mjs
                                 │
token-discovery.mjs              ──→  token-discovery.mjs  (保持)
deep-core.mjs                    ──→  deep-core.mjs  (保持)
adapter-version-manager.mjs      ──→  adapter-version-manager.mjs  (保持)
```

### 3.2 各合并后模块的职责边界

#### visual-engine.mjs（替代 6 个文件，约 667 行 → ~250 行）

**单一职责：定义所有视觉 CSS 变量 + 运行时视觉协调。**

包含：
- `--ag-glass-*` 毛玻璃 token（sm/md/lg）
- `--ag-art-*` 焦点定位 token
- `--ag-particle-*` 粒子效果 token
- `--ag-deco-*` 装饰预设 token（vignette / gradient / noise）
- `visual-coordinate()` — 根据 art 存在性自动调整 glass/text 强度
- `adaptAppearance()` — 根据 prefers-color-scheme 调整
- `hotSwap(options)` — 运行时主题切换（捕获状态 → 应用 → 可回滚）

**对外导出：**
```javascript
window.__agentskin_visual__ = {
  coordinate: fn,        // 视觉协调入口
  adapt: fn,             // 亮暗适应
  hotSwap: fn,           // 热切换
  rollback: fn,          // 回滚
};
```

**合并逻辑：** 原来 5 个 token 文件都是 `const CSS = ...; sheet.replaceSync(CSS); sheet_manager.adopt(sheet);` 模式，区别仅在 CSS 内容。合并后只需一个 :root 块定义全部变量。visual-coordinator 的协调逻辑（根据 art 状态调整 glass 强度）整合为一个函数。

---

#### self-heal.mjs（替代 5 个文件，约 970 行 → ~300 行）

**单一职责：注入持久化 + 自动恢复 + 安全边界。**

包含：
- `AdaptiveMutationObserver` 类 — 节流 + 循环检测（原 adaptive-mutation-observer.mjs）
- `createSelfHeal(config)` — 统一自愈协调器（原 unified-self-heal.mjs 的 cooldown 逻辑）
- 安全边界检查原子的简化版（原 injection-guard 的核心部分）
- 视觉质量 token/glass/art 的原位检查（原 visual-quality-guarantor 的 verifyTokens 部分）

**对外导出：**
```javascript
window.__agentskin_self_heal__ = {
  AdaptiveMutationObserver: class,
  createSelfHeal: fn,
  checkBoundaries: fn,
  verifyEssentials: fn,    // token + art 最小检查
};
```

**合并逻辑：** 原来的 dom-self-heal / unified-self-heal / adaptive-mutation-observer 三者协作时存在"谁负责 cooldown"的问题。合并后只有一个区间计时器 + 一套 MO 实例。injection-guard 的边界检查转为 self-heal 的内部验证函数（不单独暴露）。

---

#### style-injector.mjs（替代 3 个文件，约 557 行 → ~200 行）

**单一职责：CSS 交付 + lifecycle 管理。**

包含：
- `installSheetManager()` — setter 拦截（原 adopted-sheets-manager）
- `HybridInjector` 简化类 — 全量替换 + 热替换（去掉增量路径，因为我们用 single style element）
- `InjectionFeedback` 简化版 — 200 行 overlay UI 内联化

**对外导出：**
```javascript
window.__agentskin_style__ = {
  install: fn,
  adopt: fn,
  replace: fn,        // 全量替换
  hotReplace: fn,     // 无闪烁热替换
  release: fn,
  feedback: { show, hide, progress },
};
```

**合并逻辑：** adopted-sheets-manager 和 hybrid-injector 是同一件事的两面——都是"把 CSS 放进页面并提供生命周期管理"。合并后消除语义鸿沟。

---

#### verify-and-feedback.mjs（替代 2 个文件，约 672 行 → ~200 行）

**单一职责：注入质量验证 + 状态快照。**

包含：
- `captureSnapshot()` — 注入前状态快照
- `verify(level)` — 注入后验证（tokens + art + glass + controls + layout）
- `rollback()` — 失败回滚

**对外导出：**
```javascript
window.__agentskin_verify__ = {
  capture: fn,
  verify: fn,
  rollback: fn,
  getReport: fn,
};
```

**合并逻辑：** config-snapshot 和 injection-verifier 通常在同一个上下文使用（注入前 snapshot → 注入 → verify）。合并后验证逻辑调用 snapshot 比较更自然。去掉 injection-feedback（属于 style-injector），去掉 layout/overflow 扫描（过于细粒度，用即可）。

---

#### token-discovery.mjs — 保持独立

AgentSkin 的独特优势，不合并。但可以移除 `invalidateFull()` 中的 WeakSet hack（无意义的复杂性）。

#### deep-core.mjs — 保持独立

Shadow DOM piercing + RouteDetector 是 AgentSkin 的核心差异化能力，逻辑复杂度高，保持独立。

#### adapter-version-manager.mjs — 保持独立

版本检测是运行时必需能力，保持独立但可以简化 dynamic discovery 的 selector list。

### 3.3 主进程模块合并（7 → 4）

```
当前                       →  合并后
─────────────────────────────────────
contract-validator.ts   │
declarative-verifier.ts ├→  contract-validator.ts  (统一验证)
                        │
module-matrix.ts        ├→  删除（运行时从未触发）
native-ui-adapter.ts    │
agent-acceptance.ts     ├→  adapter-acceptance.ts  (简化命名)
                        │
renderer-stable-wait.ts ──→  renderer-stable-wait.ts  (保持)
selector-candidate-scorer.ts ──→  合并入 self-heal 的选择器探测流程
```

### 3.4 Scene Model 处理

**决策：删除 Scene Compiler，保留 Scene Types。**

scene-model.ts 和 scene-compiler.ts 是过度设计。当前 6 个适配器中没有 scene 声明的使用。Scene 类型定义可以保留为未来扩展点，但编译器逻辑删除（约 200 行）。

---

## 4. 不变量影响分析

| 不变量 | 影响 | 处理 |
|--------|------|------|
| C1 AgentId 四源一致 | 无影响 | adapter-id 不变 |
| C2 14-token 主题契约 | 无影响 | CSS 变量名不变 |
| C3 Palette-CSS 同步 | 无影响 | 仅合并引擎内部模块 |
| C4 分层依赖方向 | **微调** | 层数从 8 层减到 5 层（palette/tokens/cosmetic/theme/custom/visual/adapter/deep-core → palette/tokens/cosmetic/theme/custom + adapter[visual+adapter+deep-core]） |
| C5 Store 契约 | 无影响 | 不涉及 UI Store |
| C6 设计 token 合规 | 无影响 | CSS 值不变 |
| C7 SPDX | 无影响 | 合并后仍保留头 |
| C8 原生缺陷修正一致性 | 无影响 | 不涉及 |
| C9 缺陷规范文档 | 无影响 | 不涉及 |
| C11 注入引擎协作无冲突 | **需更新** | 验证 "self-heal 不重复创建 MO" + "visual-engine 不重复定义变量" |

### 4.1 层模型调整

合并前的 8 层：
```
palette → tokens → cosmetic → theme → custom → adapter → dynamic-overrides → deep-core
```

合并后的 5 层：
```
palette → tokens → cosmetic → theme → custom → adapter
                                          │
                                          ├── visual (--ag-* 在 adapter 注入时定义)
                                          ├── dynamic (热替换/协调)
                                          └── deep-core (Shadow DOM)
```

**关键变化：** visual 层从 engine-strategy 迁移到 adapter（因为在 style-injector 合并后，视觉 token 和 CSS 注入在同一上下文完成）。这不是能力缩减，而是"谁注入谁定义"的合理化。

---

## 5. 实施计划

### Phase 1: 合并（不改变行为）

1. 创建 `engines/shared/visual-engine.mjs`，从 6 个 token 文件提取 CSS 常量
2. 创建 `engines/shared/self-heal.mjs`，从 5 个自愈/安全文件提取类/函数
3. 创建 `engines/shared/style-injector.mjs`，从 3 个注入文件提取管理器
4. 创建 `engines/shared/verify-and-feedback.mjs`，从 2 个验证文件提取功能
5. 更新 `engine-strategy.ts` 的注入拼接顺序
6. 运行 `npm run check` + `npm test` 验证零行为变化

### Phase 2: 删除 + 清理

1. 删除已合并的源文件
2. 删除 `module-matrix.ts` 和 `scene-compiler.ts`
3. 合并 `declarative-verifier.ts` 入 `contract-validator.ts`
4. 更新 `engines/INDEX.md`（精简到 ~150 行）
5. 更新 `AGENTS.md` 的注入架构章节

### Phase 3: 验证

1. 全部 6 个适配器的测试套件通过
2. CI check 全绿
3. 手动验证：6 个适配器 + 主题切换 + 背景图 + DeepCore Shadow DOM

---

## 6. 收益量化

| 维度 | 合并前 | 合并后 | 改善 |
|------|-------|--------|------|
| 共享模块文件数 | 27（含测试 ~37） | 7（含测试 ~14） | -74% |
| 主进程注入文件 | 7 | 4 | -43% |
| INDEX.md 行数 | 455 | ~150 | -67% |
| 新增能力的文件阅读成本 | "读 27 个文件" | "读 7 个文件" | -74% |
| 层数 | 8 | 5 | -37% |
| 编排层文件 | 6 | 2 | -67% |
| `npm run check` 增量验证时间 | ~12s（估算） | ~8s（估算） | -33% |

---

## 7. 风险评估

| 风险 | 概率 | 缓解 |
|------|------|------|
| 合并时漏掉某个文件的独特逻辑 | 中 | 每个合并都有对应的测试用例覆盖，合并后运行测试 |
| 层模型变化导致主题兼容性问题 | 低 | CSS 变量名不变，层数减少不影响已在使用的变量 |
| self-heal 合并后性能退化 | 低 | 合并后反而减少了 MO 实例数量（3→1），性能应提升 |
| 调试时堆栈信息变"胖" | 低 | source map 支持，命名空间函数保留 `console.warn` 前缀 |

---

## 8. 反对意见与回应

### Q: 模块拆分不是更"干净"吗？合并后 ~300 行的 self-heal.mjs 不是新的"大文件"吗？

A: "干净"的标准是新 contributor 能在 30 分钟内理解注入流程。当前 27 个文件分散了关键概念（比如"自愈"这个概念被拆成了 adaptive-mutation-observer + unified-self-heal + dom-self-heal + visual-quality-guarantor 四个模块），实际上增加了认知负担。合并后 self-heal.mjs 有清晰的三个导出类/函数，一个文件内即可看到完整的自愈策略。

### Q: 为什么不参考 DreamSkin 直接简化成 1 个 injector.ts？

A: DreamSkin 的 `buildAppCss` 已经膨胀到 ~4000 行（if/else 分发 18 个应用），长期不可维护。AgentSkin 的核心优势是 token discovery + deep-core + 14-token 契约，这些是 DreamSkin 没有的。我们精简的是"模块组织复杂度"，不是"能力"。

### Q: 删除 scene-model 会不会限制未来扩展？

A: scene-model 的类型定义保留，只是删除编译器和运行时。未来如果需要场景编译，基于简化的模块结构重新添加编译器会更简单——因为要读的模块少了 74%。

---

## 9. 参考

- `C:\Users\snowb\Desktop\work\dream-work-theme-main\electron\manager\injector.ts` — DreamSkin 单文件注入（反面教材：4000 行 if/else）
- `C:\Users\snowb\Desktop\work\desktop-main\docs\reports\AGENTSKIN_VS_DREAMSKIN_COMPARISON.md` — 全面对比报告
- `engines/INDEX.md` — 当前模块详细说明

---

## 10. 审批

- [ ] 核心团队 review
- [ ] 确认层模型调整 (8 → 5 层)
- [ ] 确认 scene-compiler 删除
- [ ] 确认 module-matrix 删除
- [ ] 实施 Phase 1
- [ ] 全量 CI 验证
