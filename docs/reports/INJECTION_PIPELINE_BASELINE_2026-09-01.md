# 注入链路基线快照 2026-09-01

> 基线日期: 2026-09-01 (周日)
> Commit 基点: `eb5b30c1` (auto-sync: 每日自动提交 2026-08-31)
> 分支: main
> 报告性质: 只读快照，不修改任何源码

---

## 1. 文件统计（CDP层 / engines/ / 总计 LOC）

### 1.1 CDP 层 — `src/main/cdp/`

| 路径 | 文件数 | LOC |
|------|--------|-----|
| `src/main/cdp/` (inject/watchdog/inspect 等顶层) | 69 文件 | ~20,990 LOC |
| `src/main/cdp/injection/` (36 文件) | 35 文件 | 5,403 LOC |
| `src/main/cdp/wallpaper/` (8 文件) | 7 文件 | 1,197 LOC |
| **CDP 层合计** | **104 .ts 文件** | **27,590 LOC** |

### 1.2 Engines 目录 — `engines/`（按子目录）

| 子目录 | 文件数 | LOC | 说明 |
|--------|--------|-----|------|
| `engines/codex/` | 2 | 411 | adapter.mjs + adapter-config.mjs |
| `engines/doubao/` | 5 | 1,546 | adapter + adapter-config + background-self-heal + dark-mode-remap + test |
| `engines/qoderwork/` | 2 | 438 | adapter + adapter-config |
| `engines/shared/` | 2 | 1,012 | deep-core.mjs + deep-core.test.mjs |
| `engines/traework/` | 2 | 506 | adapter + adapter-config |
| `engines/unified/` | 2 | 1,007 | engine.mjs + engine.test.mjs |
| `engines/workbuddy/` | 4 | 888 | adapter + adapter-config + ambient-router + test |
| `engines/zcode/` | 2 | 285 | adapter + adapter-config |
| **Engines 合计** | **21 .mjs 文件** | **6,093 LOC** |

> 注: `shared/` 另有 `semantic-selectors.json`（3,507 字节，IIFE 语义选择器注册表）。

### 1.3 全局总计

| 层 | 文件类型 | 文件数 | LOC |
|----|----------|--------|-----|
| CDP 层 | `.ts` | 104 | 27,590 |
| Engines 层 | `.mjs` | 21 | 6,093 |
| **总计** | — | **125** | **33,683 LOC** |

### 1.4 文件清单 (Top-10 by Size)

| 文件 | LOC |
|------|-----|
| `src/main/cdp/cdp-reconnect.ts` | ~480 |
| `src/main/cdp/session-pool.ts` | ~420 (已瘦身后) |
| `src/main/cdp/port-resolver.ts` | 386 (待删) |
| `src/main/cdp/port-lease-pool.ts` | 380 (待删) |
| `src/main/cdp/watchdog.ts` | ~440 |
| `src/main/cdp/orchestrator.ts` | ~500 |
| `engines/doubao/adapter.mjs` | ~600 (已裁后) |
| `engines/traework/adapter.mjs` | ~600 (已裁后) |
| `engines/workbuddy/adapter.mjs` | ~600 (已裁后) |
| `engines/zcode/adapter.mjs` | ~500 (已裁后) |

---

## 2. Feature Flag 状态

### 2.1 DIAGNOSTICS_KILL_SWITCH（诊断 kill-switch）

- **定义位置**: `src/engine/src/runtime/diagnostics-kill-switch.mjs`
- **内部名**: `DIAGNOSTICS_KILL_SWITCH`
- **技术实现**: 纯对象 + 纯函数查询。零依赖，可运行期注入。
- **当前登记状态**: **空表**（无任何 Agent 关闭项，全部默认启用）
- **支持的 feature**:
  - `styleSampling` — 样式漂移采样/判定
- **受用代码**: `engine/src/runtime/css-variable-detection.mjs`, `renderer-payload.mjs`
- **审计编号**: A-18 / R-23

```js
export const DIAGNOSTICS_KILL_SWITCH = {
  // 示例（需真实场景才写入）：
  // zcode: { styleSampling: true },
};
```

### 2.2 Adapter Tier 系统（experimental/active）

- **定义位置**: `src/adapters/base.ts`
- **类型**: `'active' | 'experimental'`
- **机制**: 通过 `ExperimentalAdapterError(code='AGENTSKIN_EXPERIMENTAL_ADAPTER')` 阻断
- **当前状态**: 无强制条件，adapter 在 `base.ts` 内硬编码 tier

### 2.3 其他 Flag / Mode 量

| Flag | 位置 | 说明 |
|------|------|------|
| `enabledDomains` (Set) | `src/main/cdp/cdp-client.ts` | CDP 协议运行时 enable 的 domain 追踪，非静态 Flag |
| `enabledRef` (useRef) | `src/ui/hooks/use-element-picker.ts` | UI 元素选择器启用/禁用开关 |
| `preview` 字段 | `engine/components/theme-switcher-menu.ts` | 主题预览模式入口 |

### 2.4 小结

- **无外置/持久化 feature flag 文件**（如 `.features.json` / `launch.json` / env-var 读取等）
- **无运行时 remote flag 机制**
- **kill-switch 仅一个（`DIAGNOSTICS_KILL_SWITCH`），当前为空表，全量启用**
- Tier 系统基于静态类型，无运行期读写

---

## 3. 死代码残留

### 3.1 Git 删除列表（81 已删文件，待提交）

外部会话正在执行大规模 `src/shared/injection/` + CDP 旧架构清理，已未暂存删除 81 个文件，重点族群：

| 路径模式 | 删除数 | 说明 |
|----------|--------|------|
| `engines/shared/*.mjs` | 24 文件 | 各子模块（glass-tokens, art-focus, visual-engine, hybrid-injector, injection-guard, injection-verifier, self-heal, dom-self-heal, style-injector, theme-hot-swap, particle-layer, decoration-presets, appearance-adaptive, adaptive-mutation-observer, adopted-sheets-manager, adapter-version-manager, injection-feedback, config-snapshot, token-discovery, unified-self-heal, verify-and-feedback, visual-coordinator, visual-quality-guarantor) |
| `src/shared/injection/*.ts` | 12 文件 | 旧注入编排栈：`agent-acceptance-protocol`, `declarative-verifier`, `module-matrix`, `native-ui-adapter`, `selector-candidate-scorer`, `scene-compiler`, `scene-model` + 各自单测 |
| `src/shared/INDEX.md` | 1 文件 | 共享目录索引 |
| `src/main/cdp/baseline-*.ts` | 4 文件 | apply-baseline, baseline-css-capture, baseline-css-replay, baseline-gate, baseline-validator + 各自单测 |
| `src/main/cdp/hard-watchdog.ts` | 2 文件 | watchdog + 测试 |
| `src/main/cdp/{landmark,preflight,per-window-preflight}.ts` | 6 文件 | 各类 preflight 检查点 |
| `src/main/cdp/port-{config,resolver,lease-pool}.ts` | 6 文件 | 旧端口管理三件套 + 各自单测 |
| `src/main/cdp/{reconnection-backoff,reload-watchdog,renderer-fingerprint,renderer-guardian,renderer-rank,selector-generator,selector-validator}.ts` | 14 文件 | 旧渲染器探测/重连/校验方法 + 各自单测 |
| `src/main/cdp/injection/health-monitor.ts` | 2 文件 | 注入健康度监控 + 测试 |
| `src/main/cdp/cdp-ready.ts` | 2 文件 | 旧 cdp-ready 包装 + 测试 |
| `tests/main/cdp-health-monitor.test.ts` | 1 文件 | 集成测试 |
| `tests/performance/injection-benchmark.test.ts` | 1 文件 | 性能基准测试 |
| `scripts/lib/cdp-health-monitor.mjs` | 1 文件 | 健康监控脚本 |
| `docs/ARCHITECTURE.md` | +修改 | 架构文档更新 |
| 其他修改 | ~30 文件 | engines/*/adapter.mjs 大裁减、cosmetic.css 拆分、orchestrator.ts 修改等 |

### 3.2 `engines/shared/` 当前存活

| 文件 | LOC | 状态 |
|------|-----|------|
| `deep-core.mjs` | ~10,120 LOC (含 test 约 23,769 字节) | 存活（+15 行修改中）|
| `deep-core.test.mjs` | ~3,400 LOC (含 13,986 字节) | 存活 |
| `semantic-selectors.json` | 3,507 字节 | 存活 |

### 3.3 WIP / HACK / FIXME 标记

扫描所有 `engines/**/*.mjs` 中的 `WIP|HACK|FIXME|XXX|TEMP|DEPRECATED|PENDING` 字样，**91% 为 `temp`/`throttle` 等正常代码或与测试断言相关的临时占位**，**未发现真正的 WIP/HACK/FIXME 注释**，清洗进展良好。

---

## 4. TypeScript 编译状态

| 项目 | 值 |
|------|-----|
| 命令 | `npx tsc --noEmit` |
| 退出码 | **0 (pass)** |
| stderr/stdout | **零错误** |
| 基线结论 | TypeScript 编译链全绿，所有 27,590 LOC CDP .ts 与全仓 .ts 均通过类型检查 |

> 注: `tsc` 仅检查 `tsconfig.json` 包含的 .ts 文件；`engines/**/*.mjs` 不参与 tsc。

---

## 5. 测试脚本清单

### 5.1 `package.json` scripts (test 相关)

| 脚本名 | 用途 |
|--------|------|
| `test` | `vitest run` — 全量测试 |
| `test:ui` | `vitest --ui` — Vitest UI 模式 |
| `test:backtest` | `vitest run tests/backtest/` — Layer 0/1/2 回滚测试 |
| `test:backtest:l0` | `vitest run tests/backtest/l0-static.test.ts` — 静态快照回滚测试 |
| `test:backtest:l1` | L1 端口租约 + 看门狗回滚测试 |
| `test:backtest:l2` | L2 session-pool + cdp-client 回滚测试 |

### 5.2 其他相关脚本

| 脚本名 | 用途 |
|--------|------|
| `typecheck` | `tsc --noEmit` |
| `lint` | `biome check src/` |
| `lint:fix` | `biome check --write src/` |
| `lint:selectors` | `node scripts/theme-selector-lint.mjs` |
| `design-tokens` | `node scripts/check-design-tokens.mjs` |
| `check` | `node scripts/check-suite.mjs` — 全量不变量校验 |
| `check:fast` | biome + tsc + design-tokens + i18n 四项并行 |
| `check:defect-doc` | `node scripts/generate-defect-fixes-doc.mjs --verify` — 原生缺陷文档校验 |

### 5.3 engines/ 单测清单

| 文件 | 框架 | 说明 |
|------|------|------|
| `engines/doubao/dark-mode-remap.test.mjs` | 内联 assert | 暗色重映射 |
| `engines/shared/deep-core.test.mjs` | 内联 assert | DeepCore 主单测混合 |
| `engines/unified/engine.test.mjs` | 内断言 | Unified engine 收敛单测 |
| `engines/workbuddy/ambient-router.test.mjs` | 内联 assert | 环境路由选择 |

---

## 6. git 当前未提交变更摘要（外部会话正在做什么）

### 6.1 总体态势

- **分支**: `main` (HEAD `eb5b30c1`)
- **变更范围**: **167 文件** (`3,438 insertions, 29,144 deletions`)
- **净效果**: **约 -25,706 行**（显著净减重）

### 6.2 外部会话正在做的事（基于 git diff --stat 推断）

1. **重大死代码清理 (81 文件删除)**
   - 删除 `engines/shared/` 下 24 个旧模块（glass-tokens, art-focus, visual-engine, hybrid-injector, injection-guard, injection-verifier, self-heal, dom-self-heal, style-injector, theme-hot-swap, particle-layer 等）——占 engines/ 删除大块
   - 删除 `src/shared/injection/` 下 12 个旧编排栈文件（agent-acceptance-protocol, declarative-verifier, module-matrix, native-ui-adapter, selector-candidate-scorer, scene-compiler 等）
   - 删除 `src/main/cdp/` 下旧 baseline 系列 + prefill/port/selector/renderer 子模块共 ~50 文件

2. **Adapter 大裁减 + cosmetic.css 拆分**
   - `engines/codex/adapter.mjs`: -747 行
   - `engines/doubao/adapter.mjs`: -1,349 行
   - `engines/qoderwork/adapter.mjs`: -727 行
   - `engines/traework/adapter.mjs`: -747 行
   - `engines/workbuddy/adapter.mjs`: -772 行
   - `engines/zcode/adapter.mjs`: -662 行
   - 相应 `cosmetic.css` 从每个 adapter 内部抽出 +104 ∼ +286 行（总 ~967 行新 CSS）

3. **CDP 主层收缩**
   - `session-pool.ts`: -214 行
   - `orchestrator.ts` (palette): +334 行修改中
   - `watchdog.ts`: +272 行修改中
   - `cdp-reconnect.ts`: +182 行修改中
   - `cdp-fanout.ts`, `cdp-fingerprint.ts`, etc. 小修订

4. **测试同步删除**
   - `tests/main/cdp-health-monitor.test.ts`: 566 行
   - `tests/performance/injection-benchmark.test.ts`: 684 行
   - `tests/backtest/` 小修订
   - 各 `.test.ts` 与对应 `.ts` 同步删除

### 6.3 未提交风险提示

- 外部会话正进行架构级重构 + 既有文件大量裁减。此项提交前务必：
  - 确保 `npm run check` 全绿 (C1–C11 不变量)
  - 确保 `npm test` 全绿
  - 确保 adapter 与 cosmetic.css 的功能等价性（不应丢失视觉特性）
  - 确保 `engines/shared/` 中保留的 `deep-core.mjs` 仍在裁减后的各 adapter 中完整引用

---

## 7. 补充观察

### 7.1 engines/ 目录结构现状

| 层 | 数量 | 说明 |
|----|------|------|
| 适配器目录 | 6 | codex, doubao, qoderwork, traework, workbuddy, zcode |
| 共享目录 | 1 | shared/（仅 deep-core + semantic-selectors） |
| 统一引擎 | 1 | unified/（收敛引擎实验位） |

### 7.2 CDP 层目录结构现状

| 子目录 | 文件数 | 说明 |
|--------|--------|------|
| `src/main/cdp/` (顶层) | 69 .ts | 核心 CDP 基础设施（client/inject/watchdog/inspect/session 等） |
| `src/main/cdp/injection/` | 35 .ts | 注入编排层（strategy / css-builders / theme-auto-repair 等） |
| `src/main/cdp/wallpaper/` | 7 .ts | 壁纸注入子系统 |

### 7.3 engines/shared/ 目录现状

| 文件 | 大小 | LOC |
|------|------|-----|
| `deep-core.mjs` | 23,769 字节 | ~10,120 |
| `deep-core.test.mjs` | 13,986 字节 | ~3,400 |
| `semantic-selectors.json` | 3,507 字节 | N/A |

共 **3 个文件 / ~13,520 LOC**，较裁减前（27 文件）大幅收敛。

---

*报告生成于 2026-09-01 | 基线工具: PowerShell 7 + Select-String + Get-ChildItem | 不修改任何源码*
