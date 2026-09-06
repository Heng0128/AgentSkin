# RFC 2026-09-02 Rev.3 — 双引擎收敛最终方案（选型落地版）

| 字段 | 值 |
|------|-----|
| 状态 | **APPROVED — 可直接执行** |
| 版本 | Rev.3 (基于多维选型) |
| 日期 | 2026-09-02 |
| 优先级 | P0 |

---

## 〇、选型方法论

本方案经「多子智能体双阶段工作流」产出：

- **阶段一**：3 套差异化候选 → 8 维加权评分 → 交叉质询致命弱点 → 深度漏检技术债
- **阶段二**：执行落地 + 四层校验 + 交叉评审

**选型规则**：全程由 AI 子智能体执行，不纳入人工学习/调试成本；多维加权综合最优 = 全局最优；改动规模仅作备注参考。

---

## 一、阶段一选型结果

### 1.1 候选方案

| | 方案 A 激进简化 | 方案 B 补齐型单引擎 | 方案 C aSS 统一重构 |
|---|---|---|---|
| 核心思路 | 直接移除 V2，V3 接管 | 移除 V2 + 补齐缺失 + 落地统一引擎 | 切到 adoptedStyleSheets 单引擎 |
| 工作量（参考） | ~7 文件，8h | ~12 文件，16h | ~20+ 文件，30h |

### 1.2 多维加权评分表

| 维度 | 权重 | A | B | C | 评分理由 |
|------|:--:|---|---|---|----------|
| 1. 业务根治（根除冲突根源） | ×2 | 4 | 8 | 9 | C 从结构消除竞争；B 单引擎+补齐后消除闪烁源；A 删 V2 丢 patrol，Doubao 回退 |
| 2. 场景兼容（6 agent） | ×2 | 5 | 8 | 6 | B 补齐后 6 agent 全覆盖；C 全改 adapter 风险高；A 缺 patrol Doubao 50ms 失效 |
| 3. 故障安全（爆炸半径/回退） | ×1.5 | 3 | 7 | 5 | B 增量移植，revert 可控；A 删除后无回退；C 20+ 文件大爆炸 |
| 4. 工程契约（类型/Schema 闭环） | ×1 | 6 | 8 | 4 | B 补齐对齐 types 最完整；C 重写接口 breaking 多 |
| 5. 可工程化（测试/CI/探针） | ×1 | 7 | 6 | 3 | A 改动最小 CI 最快；B 中等；C 30h+ 测试矩阵大 |
| 6. 架构一致性（对齐 ARCHITECTURE.md） | ×1.5 | 5 | 8 | 9 | C 完美对齐；B+补齐后接近完美；A 删除 V2 后分层缺实现 |
| 7. 长期演进（增量迭代能力） | ×1.5 | 5 | 8 | 6 | B 单引擎可单点演进；C 重写后 6 adapter 重绑 API |
| 8. 边界健壮（Doubao 50ms/CSP） | ×1.5 | 3 | 7 | 6 | B 补齐 patrol+fallback 覆盖极端；A 无 patrol Doubao 高频失效 |
| **加权总分** | — | **55** | **91** | **76** | |

**胜出：方案 B（91 分）**

### 1.3 交叉质询致命弱点

| 方案 | 致命弱点 | 被忽略假设 | 反例场景 | 妥协代价 |
|------|---------|-----------|---------|---------|
| A | 移除 V2 = 移除 MutationObserver 自愈，Doubao 50ms 删 style 无补丁 | V3 persistence 能兜底 | Doubao SPA 路由 → style 被剥 → 白屏无恢复 | 永久丢 Doubao 反注入对抗 |
| B | V3 pooled session 无常住能力，自愈需 persistent session 层 | 移植代码就能跑通 | navigation 后 CDP context GC → interval 销毁 → 重注失效 | 需要在 V3 内重建 mini-V2 |
| C | Doubao 已用 aSS，engine-strategy 用 textContent，只是把冲突从跨引擎移到引擎 vs 页面脚本 | aSS 不会触发反注入 | Electron v28+ 某些版本 aSS 在 webview 中为 read-only → 100% 失败 | 失去 textContent 兜底 |

### 1.4 深度漏检

**重大发现**（审计漏检优先级最高）：
> **`engines/unified/engine.mjs` 磁盘文件不存在。** `orchestrator.ts:268` 引用、ARCHITECTURE.md 描述、INDEX.md 登记的 V3 统一引擎是幻影 — `fs.readFile(unifiedEnginePath).catch(() => '')` 静默吞错；6 个 adapter.mjs 引用 `window.__agentskin_shared_engine__` 但该全局不存在。

这意味着：
- **V3 当前未真正运行**：`engine-strategy.ts:injectThemeViaEngine` 中 Step 5 `session.evaluate(adapterJs)` 时，`unifiedEngineSource` 为空字符串 → adapter 引用未定义全局 → TypeError → `catch (err) { adapterApplied = false }`
- **V2 才是唯一实际注入者**：`adapters/base.ts:225` 的 `runtimeApplyTheme` → `@agentskin/engine` 是真正干活的那套
- **方案 A/C 均不可行**：移除 V2 → 无引擎工作；在幻影引擎基础上重构 aSS → 落空

**方案 B 技术债（评分 5/10）**：

| 债务 | 等级 | 缓解 |
|------|------|------|
| 三层 observer 叠加 → 修复风暴 | P1 | patrol 用 setInterval 而非 observer；全局 cooldown token |
| WCAG fallback 计算开销 | P2 | 14 token × 配色方案预计算缓存；仅 apply 时一次性算 |
| Windows fs.watch 不可靠 | P2 | IPC 事件通道 + 防抖 + readdir 兜底 |
| watchTheme 无承载通路 | P2 | 复用 theme-applyFlow + IPC，不另开 session |

---

## 二、最终推荐方案：方案 B — 补齐型单引擎

### 2.1 核心决策

| 决策 | 说明 |
|------|------|
| 唯一注入入口 | `engine-strategy.ts` (V3) 为唯一注入引擎 |
| 统一引擎落地 | 文件 `engines/unified/engine.mjs` 从幻影落地为真实文件 |
| V2 处理 | 标 `@deprecated`，保留桥接文件作为应急回退入口（stub） |
| 补齐范围 | patrol self-healing + WCAG runtime fallback + watchTheme + persistence |
| 核心注入方式 | 保留 V3 当前的 `buildAtomicInjectionExpression` (单次 evaluate textContent) — 原子度高、无 FOUC、与 6 adapter 拼接机制兼容 |

**不切换 adoptedStyleSheets 的原因**：
1. Electron/webview 跨文档限制
2. 失去 textContent 兜底 → CSP 无降级路径
3. 6 adapter 重写 DOM 操作 → ~1800 行 CSS 重写
4. 统一引擎文件不存在 → aSS 重构无处落脚

### 2.2 选型权衡

| 收益项 | 牺牲项 |
|--------|--------|
| 单一注入引擎 → 零冲突 | 16h 工作量（vs A 的 8h） |
| 补齐 patrol/Doubao 不丢能力 | 需要从 V2 移植代码（非完全新写） |
| 补齐 WCAG fallback 提升可访问性 | 三层 observer 需 cooldown 防风暴 |
| 补齐 watchTheme 恢复 dev 热重载 | fs.watch 需兜底方案 |
| 保留 textContent 兜底（CSP 兼容） | adoptedStyleSheets 性能的潜在收益未取 |
| 渐进可行（不依赖引擎文件先落地） | — |

---

## 三、执行计划（方案 B）

### Phase 1 — 落地统一引擎骨架 + 切断 V2 注入路径（8h）

| # | 文件 | 操作 | 备注 |
|---|------|------|------|
| 1.1 | `engines/unified/engine.mjs` | **新建** — 合并 `engines/shared/adaptive-mutation-observer.mjs` 为内联实现，导出 `decodeFeature`, `createAdapter` 等 adapter.mjs 引用的接口 | 落地幻影文件 |
| 1.2 | `src/adapters/base.ts:L222-238` | 重写 `applyTheme`/`restoreTheme` 为 preflight-only stub，删除 `runtimeApplyTheme` import | 切断 V2 注入路径 |
| 1.3 | `src/legacy/agentskin-core-runtime.ts:@176-187` | @deprecated + 抛 `DeprecatedApiError` | 标记废弃 |
| 1.4 | `src/main/cdp/cdp-fanout.ts:L612-678` | 删除 verifyTheme watchdog 的 V2 裁决逻辑（V3 注入自身幂等）+ 保留 reload-watchdog | 消解 watchdog 'full' 跳过误判 |
| 1.5 | `src/main/theme-apply-flow.ts:L586-603` | 合并 pipeline 为单步 `inject-and-mount` | 简化流程 |

### Phase 2 — 补齐 V2 核心缺失（8h）

| # | 文件 | 补齐内容 | 移植来源 |
|---|------|---------|---------|
| 2.1 | `engines/shared/self-heal-patrol.mjs` | 新增 — 5s 定时检查 `document.getElementById('agentskin-style').textContent` 长度，若 ≠ 上次注入则触发重注 | V2 `renderer-payload.mjs` patrol 逻辑 |
| 2.2 | `src/shared/injection-runtime.ts` | 新增 `applyContrastFallbackOnce(root)` — 14 token × 配色方案对比度检测 + 注入 `--agentskin-readable-text`/`--agentskin-readable-shadow` | V2 `renderer-payload.mjs:474-490` |
| 2.3 | `src/main/main-context.ts` | 新增 IPC 通道 `THEME_RELOAD` + 文件监听（fs.watch → debounce 300ms → readdir 兜底 → 触发 applyThemeFlow） | 新能力 |
| 2.4 | `src/main/cdp/cdp-fanout.ts` | 修改 persistence 注册逻辑 — Session-bound 长会话管理（不是 pooled short-lived） | V2 `injector.mjs:25-37` persistenceSessions |

### Phase 3 — 清理与验证（4h）

| # | 文件/范围 | 操作 |
|---|----------|------|
| 3.1 | `src/engine/components/theme-switcher-menu.ts:L40-41,135` | `__AGENTSKIN__` → `__agentskin__` + 空指针守卫 + cleanup 兜底 |
| 3.2 | `src/engine/` 含子文件 | @deprecated 标注（保留内容） |
| 3.3 | tests | 删除 V2 apply 路径测试；stub 形态断言改写 |
| 3.4 | 四层校验 | 见下文 |

---

## 四、四层强制校验体系

### 第一层：方案一致性校验

逐行比对：RFC 设计是否 100% 落地到代码？是否有漏实现、私自篡改？

| 校验项 | 检查方法 | 通过标准 |
|--------|---------|---------|
| `engines/unified/engine.mjs` 是否创建 | `ls engines/unified/engine.mjs` | 文件存在 + 导出接口匹配 adapter.mjs 引用 |
| adapter.applyTheme 是否变为 stub | 阅读 `src/adapters/base.ts:L222-238` | 无 CDP 调用，仅返回 `{status:'preflight-only'}` |
| V2 是否标 deprecated | 阅读 `@deprecated` 标记 | `JSDoc @deprecated 2026-09-02` |
| watchdog 是否移除 V2 裁决 | 阅读 `cdp-fanout.ts` 注释 | 无 `isThemeFullyApplyVerdict` + 无 `adoptedSheetCount` |

### 第二层：工程落地正确性校验

| 校验项 | 检查方法 | 通过标准 |
|--------|---------|---------|
| 引用链完整 | `grep -rn "runtimeApplyTheme\|runtimeRestoreTheme" src --include="*.ts"` | 零匹配 |
| 命名空间统一 | `grep -rn "__AGENTSKIN__" src --include="*.ts" --include="*.mjs"`（排除 deprecated 标注行） | 零匹配 |
| 编译通过 | `npx tsc --noEmit` | 零新增错误 |
| 测试通过 | `npm test` | 662+ UI 测试全绿 + V2 apply 路径测试删除后不影响 |

### 第三层：RFC 规范合规校验

| 校验项 | 通过标准 |
|--------|---------|
| 格式完整 | 背景 / 方案 / 执行 / 验证 / 风险 / 回退 章节齐全 |
| 兼容性 | 6 agent 全量端到端 apply+restore+verify |
| 弃用策略 | @Deprecated 标记 + 错误提示引导 |
| 迁移方案 | V2 → V3 迁移路径明确 |
| 风险备注 | 三层 observer 风暴 + fs.watch Windows + WCAG 计算开销 |

### 第四层：深度漏检审计

| 审计项 | 方法 | 通过标准 |
|--------|------|---------|
| 修复风暴可能性 | 对 patrol 做 cooldown 全局 token 验证 | 注入后 5s window 内无二次 evaluate |
| Doubao 50ms 覆盖路径 | Doubao 实机 SPA 路由切换后 100ms 检查 | `--agentskin-accent` CSS 变量留存 |
| WCAG fallback 触发 | 浅色主题配浅色文字端到端注入 | `--agentskin-readable-text` 变量非空 |
| watchTheme 可靠性 | 修改 theme CSS 文件 → 5s 内观察到 CSS 变更 | fs.watch 正确触发 reload + apply |
| V2 残留检测 | `grep "applySkin\|applyTheme" src/engine/src/runtime` | 全挂 `@deprecated` + 无生产路径调用 |

---

## 五、交叉评审机制

执行 Agent 完成每批次后，评审 Agent 逐项核对：

| 核对维度 | 核查项 | 偏差处理 |
|---------|--------|---------|
| 方案执行完整度 | 是否实现 RFC 定义的每一行改动 | 缺失 → 补齐后再次编译+测试 |
| 落地损耗 | 是否有"有条件跳过"、"暂时跳过"等降级 | 有条件降级 → 视为偏差，修复 |
| 私自增删 | 是否有超出 RFC 范围的改动 | 超出范围 → revert |
| 长期能力保留 | patrol/watch/WCAG 是否完整移植 | 功能缺失 → 回到 V2 验证后移植 |

---

## 六、风险清单

| # | 风险 | 等级 | 缓解 |
|---|------|:--:|------|
| R1 | `unified/engine.mjs` 长久缺失后首次创建 → 与 6 adapter 引用不匹配 | P1 | 启动后立即 6 agent 全量 apply 回归 |
| R2 | patrol self-healing 与 6 adapter 各自 MutationObserver 形成三层嵌套 → 修复风暴 | P1 | patrol 用 setInterval + 全局 cooldown token；adapter observer 保留但增加 patrol-aware skip |
| R3 | V2 deprecated stub 被外部 CLI 调用方触发 DeprecatedApiError | P2 | 错误提示中列出迁移指引；向外部用户发 deprecation notice |
| R4 | WCAG fallback 预计算缓存未命中时 fallback 到运行计算 → 注入延迟 +30ms | P2 | 预计算缓存预热（apply 时阻塞计算一次） |
| R5 | Windows fs.watch 在主题文件 on network drive 失效 | P2 | readdir 兜底；超时 3s 自动降级 |
| R6 | 测试矩阵调整后遗漏 V2 残留引用 | P3 | 四层校验阶段 grep 定点排查 |

---

## 七、不可逆损失公示

| 损失项 | 说明 | 是否可逆 |
|--------|------|:--------:|
| V2 @agentskin/engine 的 apply 路径活跃使用 | 永久改为 deprecated | 是（恢复 import） |
| adoptedStyleSheets 统一的机会 | 本次不切 aSS，暂缓 | 是（后续 RFC） |
| V2 的 5s patrol 中 50-cycle 循环检测防抖逻辑 | 卸载本次不移植（简化为固定间隔检测） | 是（从 V2 源码移植） |

---

## 八、回退方案

**触发条件**：Phase 1 上线后任一 agent 注入失败 + 24h 内无法定位原因。

```bash
# 回退步骤：环境变量 + 重启
set AGENTSKIN_V2_FALLBACK=1
# main-process.ts 启动时检测该变量 → 走 deprecated stub → 抛 DeprecatedApiError
# 同时通过 IPC 推 warning 到前端 → AI agent 触发 V2 兜底 apply

# 完成回退后在 V2 apply 日志中分析根因 → 修复 V3 → FALLBACK=0 重新上线
```

---

## 九、分级行动计划

| 优先级 | 行动 | 负责 | 时限 |
|:--:|------|------|------|
| P0 | Phase 1 (8h) — 统一引擎骨架 + V2 stub | 主 developer | 立即 |
| P0 | V1 上线验证 | 全 agent QA | Phase 1 后 1 天 |
| P1 | Phase 2 (8h) — 补齐 patrol + WCAG + watch + persistence | 主 developer | P0 上线后 |
| P1 | 四层校验pass | reviewer | Phase 2 后 1 天 |
| P2 | Phase 3 (4h) — 清理 + 校验 | 主 developer | P1 上线后 |
| P2 | adoptedStyleSheets 重构预研 | 架构组 | 可选 — 视 V3 稳定后需求 |
| 舍弃 | 方案 A 激进简化 | — | — |
| 舍弃 | 方案 C aSS 统一重构 | — | — |

---

## 附录 A：8 维评分原始数据

| 维度 | 权重 | A | B | C |
|------|:--:|---|---|---|
| 业务根治 | ×2 | 4 | 8 | 9 |
| 场景兼容 | ×2 | 5 | 8 | 6 |
| 故障安全 | ×1.5 | 3 | 7 | 5 |
| 工程契约 | ×1 | 6 | 8 | 4 |
| 可工程化 | ×1 | 7 | 6 | 3 |
| 架构一致 | ×1.5 | 5 | 8 | 9 |
| 长期演进 | ×1.5 | 5 | 8 | 6 |
| 边界健壮 | ×1.5 | 3 | 7 | 6 |
| **加权总分** | — | 55 | **91** | 76 |

## 附录 B：选型决策树

```
双引擎冲突 → 
├─ unified/engine.mjs 存在？→ 否 → 方案 A/C 均不可行
├─ adoptedStyleSheets 统一是必须？→ 否（webview/CSP 兜底不足）
├─ 需补齐 patrol + WCAG + watchTheme？→ 是（避免功能回退）
├─ session-bound 长会话能移植到 V3？→ 是（persistence session）
└─ 结论：方案 B（补齐型单引擎）
```
