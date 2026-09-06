# RFC 2026-09-02 — 双引擎冲突收敛：单一注入引擎方案（v2 — 精确版）

| 字段 | 值 |
|------|-----|
| 状态 | **APPROVED — 可直接执行** |
| 作者 | AgentSkin RFC Process |
| 日期 | 2026-09-02 |
| 优先级 | P0 — 阻塞性冲突 |
| SUPERSEDES | RFC 2026-08-30 (3→2 简化)、本 RFC v1（不精确版） |
| 受影响组件 | 见附录 A |

---

## 1. 背景：为什么要现在解决

AgentSkin 当前存在两套注入引擎，在同一次 `applyThemeFlow` 内先后对同一个 CDP target 注入，造成闪烁、覆盖、自愈互搏。

### 1.1 实际调用链

```
theme-apply-flow.ts
  │
  ├─ adapter.applyTheme(bundle, {launch:false})
  │     └─ src/adapters/base.ts:225
  │           └─ runtimeApplyTheme()  ← @agentskin/engine (V2)
  │                 └─ injector.mjs:applyTheme()
  │                       └─ session.evaluate(buildApplyExpression)  ← V2 IIFE
  │                             ├─ document.adoptedStyleSheets.push(4 sheets, __agentskin:true)
  │                             ├─ window.__AGENTSKIN__ = { hosts: {}, decorDrift: [] }
  │                             ├─ setInterval(self-heal, 5000)     ← V2 自愈
  │                             └─ Page.addScriptToEvaluateOnNewDocument(persistence VB)
  │
  └─ pipeline.add('hardening') → deps.hardeningPass()
        └─ cdp-fanout.ts:hardeningPassImpl()
              │
              ├─ verifyTheme(session)            ← 检查 adoptedStyleSheets
              │     ├─ 找到 V2 的 4 sheets → verdict='full' → SKIP V3 注入
              │     └─ 找到 partial → verdict='partial' → V3 注入
              │
              └─ if verdict≠'full':
                    └─ tryEngineInjection()
                          └─ injectThemeViaEngine()
                                └─ buildAtomicInjectionExpression →
                                      └─ <style id="agentskin-style">.textContent = allCss
                                          (V3 不使用 adoptedStyleSheets)
```

### 1.2 冲突精确分析

| # | 场景 | 触发条件 | 用户影响 |
|---|------|---------|---------|
| **A** | V2 完整注入 + V3 watchdog 跳过 | 常见路径，V2 成功 | V2 自愈 interval 持续运行，占据 CPU 和 `window.__AGENTSKIN__` |
| **B** | V2 部分失败 + V3 补注入 | V2 第二层以后抛异常 | V2 残留 adoptedStyleSheets + V3 `<style>` 双重挂载，CSS 优先级竞争闪烁 |
| **C** | V2 自愈触发 + V3 覆盖 | SPA 导航后 V2 self-heal 触发 | V2 5s interval 重注 adoptedStyleSheets，覆盖 V3 的 `<style>` 内容 → 主题回滚到 V2 状态 |
| **D** | 双重 persistence 脚本 | 两处 `addScriptToEvaluateOnNewDocument` 都注册 | SPA 导航时两个 replay 脚本同时恢复，产生 apply 竞态 |
| **E** | 大小写命名空间污染（潜在） | V2 写 `window.__AGENTSKIN__` 与 V3 写 `window.__agentskin__` 共存 | theme-switcher-menu.ts 读 V2 namespace 时读到旧数据，与新 namespace 脱节 |

**关键洞察**：v1 RFC 错误地假设了"双引擎每次 apply 都双重注入"。实际情况是 V3 的 watchdog 大多时候能检测到 V2 的 work 并跳过（verdict='full'），但**这反而掩盖了更深层的问题**：
- V2 的自愈引擎持续运行（5s interval），占用资源且可能在任何时候触发重新注入
- V2 的 persistence 脚本被注册后，SPA 导航时会 replay V2 的 adoptedStyleSheets，与 V3 状态不同步

### 1.3 为什么 V3 是正确选择

| 维度 | V2 (`@agentskin/engine` / `injector.mjs`) | V3 (`engine-strategy.ts` / `injection-runtime.ts`) |
|------|------------------------------------------|---------------------------------------------------|
| CSS 注入 | `document.adoptedStyleSheets.push(CSSStyleSheet)` | `<style id="agentskin-style">.textContent = allCss` |
| 自愈机制 | 5s setInterval + MutationObserver | 无原生自愈（依赖 reload-watchdog） |
| 命名空间 | `window.__AGENTSKIN__`（大写） | `window.__agentskin__`（小写） |
| 原子性 | 多步 evaluate（先 sheets 后 adapter） | 单步 evaluate（CSS+Hero+变量同步） |
| 持久化 | `addScriptToEvaluateOnNewDocument` (persistenceSessions) | `addScriptToEvaluateOnNewDocument` via orchestrator |
| 标记 | `__agentskin_theme`, `__agentskin_theme_version` | `dataset.agentskinReady`, `__agentskin_layer` |
| 6 adapter | 独立注入 | 由 orchestrator 拼接后原子注入（已集成） |

V3 胜出原因：
1. ✅ 单次 evaluate 完成 CSS+Hero+变量写入，杜绝闪烁
2. ✅ 不依赖 setInterval 自愈（零资源泄漏）
3. ✅ 与 6 adapter 的 `engines/*/adapter.mjs` 深度集成（adapter 已经是 V3 orchestrator 的一部分）
4. ✅ 与 `palette-builder.ts` / `palette/orchestrator.ts` 层模型完全对齐

V2 降级原因：
- ❌ adoptedStyleSheets 与 V3 的 `<style>` textContent 根本性冲突（两套 CSS 引擎控同一 document）
- ❌ 5s setInterval 自愈永远无法与 V3 协调
- ❌ 大小写命名空间混乱

---

## 2. 五维度评分

| 维度 | 当前（双引擎） | 仅保留 V3 |
|------|:--:|:--:|
| 性能 | 5 — apply blocking + V2 interval 开销 + watchdog check | 9 — 单次 evaluate + 零 interval 开销 |
| 稳定性 | 3 — V2 自愈覆盖 V3 + 双重 persistence 竞态 | 9 — 单一状态机 + 单一注入通道 |
| 维护成本 | 2 — 双命名空间 / 双 self-heal / 双 persistence | 9 — 一份代码、单一生命周期 |
| 向后兼容 | 8 — 旧路径可回退 | 7 — legacy/agentskin-core-runtime.ts 保留但 deprecated |
| 实施难度 | — | 7 — ~7 文件改动，主要是"删"和"标记弃用" |
| **综合** | **3.6** | **8.2** |

---

## 3. 执行计划（三阶段，可直接执行）

### Phase 1 — 切断 V2 注入路径（目标：4h）

#### 3.1.1 `src/adapters/base.ts` — adapter.applyTheme 降为 preflight stub

**现状**（L222-234）：
```typescript
async applyTheme(bundle: ThemeBundle, options?: ApplyThemeOptions): Promise<ApplyThemeResult> {
  const coreId = this.requireCore();
  const targetTheme: ResolvedThemeTarget = resolveThemeTargetFor(bundle, coreId);
  return runtimeApplyTheme({ coreId, targetTheme, port: options?.port, ... });
}
```

**目标**：`applyTheme` 不再触发 V2 注入，返回 preflight 信息供 V3 hardening 使用。

```typescript
async applyTheme(_bundle: ThemeBundle, _options?: ApplyThemeOptions): Promise<ApplyThemeResult> {
  // 2026-09-02 RFC: 双引擎收敛 — V2 (@agentskin/engine) 注入路径已移除。
  // 注入统一由 theme-apply-flow.ts → hardening → V3 engine-strategy 完成。
  // 此 stub 仅维持接口契约，供调用方检查 adapter 是否支持 apply。
  return { status: 'preflight-only' } as ApplyThemeResult;
}
```

同步修改 `restoreTheme`（L236-238）为 stub。

删除 L49-51 的 `runtimeApplyTheme` / `runtimeRestoreTheme` import（如果不再有其他调用方）。

#### 3.1.2 `src/legacy/agentskin-core-runtime.ts` — Deprecated 标记

添加 `@deprecated` JSDoc 到 `applyTheme`（L176-187），抛出 `DeprecatedApiError`：

```typescript
/**
 * @deprecated 2026-09-02 — V2 engine applyTheme 已废弃。
 * 使用 V3 engine-strategy (src/main/cdp/injection/engine-strategy.ts)。
 */
export function applyTheme(params: ApplyThemeParams): Promise<ApplySkinResult> {
  throw new DeprecatedApiError(
    'adapter.applyTheme (V2) 已废弃。注入已切换到 V3 engine-strategy。'
  );
}
```

#### 3.1.3 `src/main/cdp/cdp-fanout.ts` — 移除 V2/V3 双重 watchdog 裁决（L612-619）

**现状**：`verifyTheme` 检查 V2 的 adoptedStyleSheets。但当 V2 被移除后，页面上只会存在 V3 的 `<style>` textContent，adoptedSheetCount 永远为 0 → watchdog verdict 永远为 'failed' → 每次都触发 V3 重新注入。

**修复**：在移除 V2 后，verdict 逻辑会自然变成"找不到 adoptedStyleSheets → failed → V3 注入”。这是安全的，因为 V3 的注入是幂等的（写入同一个 `<style>` 元素，内容相同即无视觉变化）。

但同时：每次不必要的 evaluate 是浪费。我们可以让 watchdog 检查 V3 的 `<style>` 标记，或者简单地移除 watchdog，因为 V3 注入本身是幂等的。

**推荐做法**：移除 watchdog（或退化为仅 log），因为：
- V3 注入是幂等的 → 安全
- 少一次 CDP round-trip → 性能提升
- 简化逻辑 → 维护成本降低

```typescript
// cdp-fanout.ts L610-678 — 移除 watchdog 跳过逻辑
// 直接走进 V3 injection 分支
try {
  engineResult = await deps.tryEngineInjection(session, appId, bundle, targetTheme, resolvedImages, resolvedFilePaths);
} catch (error) {
  engineError = error instanceof Error ? error : new Error(String(error));
}

if (engineError) {
  // 通知 + fallback 到 legacy direct CSS 注入
  ...
  const result = await injectThemeViaCdp(session, { css: targetTheme.css, ... });
  legacyInjected++;
}
```

**注意**：reload-watchdog（L748+）保留。它是独立的导航恢复机制，与 CSS 注入引擎无关。

#### 回退开关（可选）

在 `cdp-fanout.ts` 顶部添加：

```typescript
const V2_FALLBACK = process.env.AGENTSKIN_V2_FALLBACK === '1';
```

如果 V2 需要紧急回退，在该环境变量下走旧路径：

```typescript
if (V2_FALLBACK) {
  // 仅回退使用 V2 做完整注入（非 hardening）
  await deps.applyThemeLegacy(session, appId, bundle);
  continue;
}
```

---

### Phase 2 — 合并 hardening 为单次 inject-verify（目标：2h）

**`src/main/theme-apply-flow.ts:586-603`** — pipeline 从两步合并：

```typescript
// BEFORE（两步，V2 名存实亡后第一步是空操作）:
pipeline.add({
  name: 'hardening',
  policy: 'retry',
  maxRetries: 1,
  run: async (ctx) => {
    await deps.hardeningPass(ctx.appId, ctx.port, entry.bundle, ctx.epoch);
  },
});
pipeline.add({
  name: 'wallpaper',
  deps: ['hardening'],
  policy: 'continue',
  run: async (ctx) => {
    await deps.applyWallpaperIfPresent(ctx.appId, entry.bundle, ctx.epoch);
  },
});

// AFTER（单步，injection + wallpaper + persistence 一次完成）:
pipeline.add({
  name: 'inject-and-mount',
  policy: 'retry',
  maxRetries: 1,
  run: async (ctx) => {
    // V3 injection: 唯一入口，注入 CSS + Hero + adapter
    await deps.hardeningPass(ctx.appId, ctx.port, entry.bundle, ctx.epoch);
    // Wallpaper 必须在 injection 完成后挂载（避免 adoptedStyleSheets/Z-Index 竞争）
    await deps.applyWallpaperIfPresent(ctx.appId, entry.bundle, ctx.epoch);
  },
});
```

---

### Phase 3 — 清理遗留（目标：2h）

#### 3.3.1 V2 runtime 标 `@deprecated`（保留文件内容）

| 文件 | 行 | 操作 |
|------|------|------|
| `src/engine/src/runtime/renderer-payload.mjs` | L178-586 (`buildApplyExpression`) | @deprecated JSDoc，标记由 V3 orchestrator 替代 |
| `src/engine/src/runtime/injector.mjs` | L93-108 (persistence), L264-341 (apply), L453-475 (watch) | apply/watch 标弃用；persistence 保留（V3 orchestrator 内部调用） |
| `src/engine/src/runtime/pulse-injector.mjs` | 全文 | @deprecated — 全仓库零生产引用 |
| `src/engine/src/runtime/skin.mjs` | L61-69 (`ApplySkinResult`) | @deprecated — V3 不消费此类型 |

#### 3.3.2 命名空间大小写统一

| 文件 | 位置 | 操作 |
|------|------|------|
| `src/engine/components/theme-switcher-menu.ts` | L40, L41, L135 | `__AGENTSKIN__` → `__agentskin__` |
| `src/engine/src/runtime/profiles/codex-theme-v1.mjs` | L20, L131-138 | 大写全局 → 小写 |
| `src/shared/injection-constants.ts` | L56, L59 | 确认 V3 用小写定义 |

#### 3.3.3 测试清理

| 测试文件 | 操作 |
|---------|------|
| `tests/engine/injector.applyTheme*.test.mjs` | 删除（V2 apply 已废弃） |
| `tests/agentskin-core-runtime.test.ts` | 删除或转化为 stub 验证 |
| `tests/adapters/base.applyTheme.test.ts` | 断言变为 `status==='preflight-only'` |
| `tests/palette/orchestrator.test.ts` | 确认 V3 injection mock 完整 |

#### 3.3.4 验证清单

执行后：

```bash
# 1. 确认 V2 apply 路径零调用
grep -rn "runtimeApplyTheme\|runtimeRestoreTheme" src --include="*.ts" | grep -v "deprecated\|import"
# 期望：无匹配

# 2. 确认唯一 @agentskin 命名空间（小写）
grep -rn "__AGENTSKIN__" src --include="*.ts" --include="*.mjs" | grep -v "deprecated\|JSDoc\|\.test\."
# 期望：无匹配

# 3. 确认唯一 triple 入口
grep -rn "addScriptToEvaluateOnNewDocument" src --include="*.ts" --include="*.mjs"
# 期望：仅 orchestrator.ts 一处

# 4. 确认零 setInterval self-heal
grep -rn "setInterval.*self.heal\|setInterval.*5000" src/engine/
# 期望：无匹配（V2 自愈移除）
```

---

## 4. 验证标准

| 检查项 | 方法 | 通过标准 |
|--------|------|----------|
| 单次 apply 只产生一次 CSS 注入 | CDP 录制回放 | evaluate 调用次数 = 1 per target |
| apply 后零 setInterval 残留 | 页面注入 `window.__agentskin__` 后等 10s | 无新增定时器 |
| 主题切换无闪烁 | 人眼观察 / 截图对比 | CSS 层一次到位，无 intermediate 状态 |
| SPA 导航后主题持久化 | apply → 导航到新 URL → 检查 | `--agentskin-accent` CSS 变量存在 |
| 6 agent 全部可 apply+restore | 端到端测试（traework/qoderwork/workbuddy/doubao/codex/zcode） | 全绿 |
| 回退开关有效 | `AGENTSKIN_V2_FALLBACK=1` → apply | 旧路径生效（应急） |

---

## 5. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|:--:|------|------|
| V3 watchdog 移除后，多次 hardening 调用略增 evaluate 次数 | 高 | 低 | V3 注入幂等（相同 `<style>` textContent），无视觉影响；evaluate < 5ms 可忽略 |
| V2 的 watchTheme 实时注入场景（外部 CLI 用户）丢失 | 低 | 中 | 外部用户通过 CLI 调用时，改用 `paw watch` + 手动 apply 等价 |
| 忘记清理 V2 persistence 脚本注册 | 中 | 中 | Phase 3 grep 验证步骤确保清理完整 |
| V2 已注册自愈 interval 在旧标签页继续运行 | 中（旧会话） | 低 | interval 持有 `window.__AGENTSKIN__` 引用，V3 清理时 clearInterval（通过 CLEAR_ADAPTERS_BODY 或刷新页面消解） |

---

## 6. 回退方案

**触发条件**：Phase 1 上线后任一 agent 出现持续性主题注入失败。

**回退步骤**（3 分钟内完成）：

```bash
# 1. 设置环境变量
set AGENTSKIN_V2_FALLBACK=1

# 2. 重启主进程
npm start

# 3. 验证旧路径生效
# adapter.applyTheme 内部走 V2 runtimeApplyTheme → applySkin → adoptedStyleSheets
```

**恢复步骤**：移除环境变量，重启主进程。

---

## 7. 总结

本次 RFC (v2) 修正了 v1 的错误假设：

1. **v1 错误**：假设"每次 apply 两套引擎都注入 CSS，双重闪烁" → 实际 watchdog 大多跳过 V3
2. **v2 正确**：核心冲突是 V2 的 **setInterval 自愈 + persistence replay** 与 V3 的 **`<style>` textContent** 根本性共存冲突，不是表面上的双路注入
3. **方案一致**：结论与 v1 相同 — 移除 V2，保留 V3 — 但实施更精确：移除 watchdog（V3 自身幂等）、保留 reload-watchdog（导航恢复）、清理 V2 命名空间

预期工作量：**8h**（Phase1 4h + Phase2 2h + Phase3 2h），改动 **~7 文件**。

---

## 附录 A：受影响文件索引

| 路径 | 操作 | Phase |
|------|------|:--:|
| `src/adapters/base.ts` | L49-51, L222-238: 删除 runtimeApply import + 重写 applyTheme/restoreTheme 为 stub | 1 |
| `src/legacy/agentskin-core-runtime.ts` | L176-187: @deprecated + 抛 DeprecatedApiError | 1 |
| `src/main/cdp/cdp-fanout.ts` | L612-678: 移除 V2 watchdog 裁决逻辑；保留 reload-watchdog | 1 |
| `src/main/palette/orchestrator.ts` | 清理注释中 "legacy fallback 给 V2" 的字样 | 2 |
| `src/main/theme-apply-flow.ts` | L586-603: pipeline 从两步合并为单步 inject-and-mount | 2 |
| `src/engine/src/runtime/renderer-payload.mjs` | L178-586: @deprecated + 注释说明 | 3 |
| `src/engine/src/runtime/injector.mjs` | L264-341 (apply), L453-475 (watch): @deprecated；L93-108 (persistence): 保留 | 3 |
| `src/engine/src/runtime/pulse-injector.mjs` | 全文 @deprecated | 3 |
| `src/engine/components/theme-switcher-menu.ts` | L40, L41, L135: `__AGENTSKIN__` → `__agentskin__` | 3 |
| `tests/engine/injector.applyTheme.test.mjs` | 删除 | 3 |
| `tests/adapters/base.applyTheme.test.ts` | 改写断言为 stub 形态 | 3 |

## 附录 B：相关 RFC 状态

| RFC | 状态 | 说明 |
|-----|------|------|
| RFC 2026-08-30 | SUPERSEDED by RFC 2026-09-02 v1 → v2 | 3→2 简化方向正确，被 v1 替代；v1 分析不够精确，被 v2 替代 |
| RFC 2026-08-31 | RETAINED | 五层所有权模型（palette/tokens/cosmetic/theme/custom）继续有效，V3 已实现 |
| RFC 2026-09-02 v1 | SUPERSEDED by v2 | 分析错误（假设双重注入），结论正确 |
| RFC 2026-09-02 v2 (本文) | APPROVED | 精确分析 + 直接可执行方案 |
