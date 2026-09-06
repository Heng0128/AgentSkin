# 预存问题与测试问题巡检报告 — 2026-08-26 12:00

## 1. 路径污染清理摘要

**扫描结果**: 无新污染，.gitignore 已覆盖所有已知污染模式。

| 类别 | 发现数 | 已处理 | 备注 |
|------|--------|--------|------|
| 根目录散落文件 | 10 | 0（已全部 gitignore） | .tsbuildinfo, *.log, *.txt 等 |
| 污染目录 | 8 | 0（已全部 gitignore） | .meituan-catpaw, .agnes, .workbuddy 等 |
| 一次性脚本 | 0 | 0 | 无 |

**结论**: 仓库路径污染状态良好，所有历史污染文件均已纳入 .gitignore 覆盖。

---

## 2. 测试问题修复摘要

### 2.1 修复统计

| 等级 | 数量 | 文件 |
|------|------|------|
| MAJOR（函数签名/实现变更导致测试失败） | 2 | session-pool.test.ts, theme-apply-flow.test.ts |
| MAJOR（mock 数据缺少新字段） | 1 | cdp-inject.test.ts |
| **总计** | **3 文件，4 测试** | |

### 2.2 修复明细

#### 修复 1: `src/main/cdp/session-pool.test.ts`

**根因**: `targetKeyFor(undefined, null)` 返回 `"unknown-N"`（N 为模块级单调计数器），测试期望静态字符串 `"unknown-target"`。

**分析**: 实现使用计数器确保多个 unknown target 的 key 唯一（正确设计，避免 session collapse）。测试期望过时。

**修复**: 更新测试断言使用正则 `/^unknown-\d+$/` 验证模式。

**Commit**: `6064e237`

#### 修复 2: `src/main/theme-apply-flow.test.ts`

**根因**: `probeThemeLiveOnPort` 函数签名变更为 `(port: number, appId: AgentId) => Promise<boolean>`，测试期望只传单参数 `(FAST_PORT)`。

**分析**: 实现新增了 appId 参数，测试期望未同步更新。

**修复**: 更新期望为 `toHaveBeenCalledWith(FAST_PORT, FAST_AGENT)`。

**Commit**: `6064e237`

#### 修复 3: `src/main/cdp/cdp-inject.test.ts`

**根因**: RC4-A 引入 `isThemeFullyApplyVerdict()` 分级验证逻辑，需要 `layers` 和 `artResolved` 字段才能返回 `'full'` verdict。`VERIFY_SUCCESS` 和 `VERIFY_NO_HERO` mock 数据缺少这些字段，导致 `waitForTheme` 轮询直到 3s 超时（~60 次调用）。

**分析**: 测试中 `verifyCallCount` 期望值为 2（首次失败、重试成功），实际为 53（完整超时循环）。

**修复**: 为 mock 数据添加 `layers: { palette: 1, tokens: 45, cosmetic: 12 }` 和 `artResolved` 字段。

**Commit**: `c9f58473`

### 2.3 未修复测试问题

| 文件 | 问题 | 原因 |
|------|------|------|
| `src/main/wallpaper/mutex.test.ts` | "different appIds: calls run concurrently" 偶尔失败 | 并发测试时序敏感，单独运行全通过，全量运行偶发超时（非确定性） |

**建议**: 后续可增大时间容差或改用确定性同步原语。

---

## 3. 全量验证结果

| 工具 | 结果 | 备注 |
|------|------|------|
| `npm test` | **PASS** | 4754/4754 通过, 4 skipped |
| `npx tsc --noEmit` | **PASS** | 0 错误 |
| `npm run check` | **FAIL (C6)** | 27 个设计 token 违规（预存问题，非本次引入） |

### 3.1 C6 设计 token 违规分布（预存问题）

| 违规类型 | 数量 | 涉及文件 |
|----------|------|----------|
| `text-[9px]` 非标准字号 | ~10 | DriftStatusPanel, CenterTabThemeEditor, ContrastBadge, inspector-element 等 |
| `rgba(...)` 硬编码颜色 | ~12 | dom-highlight, inspector-element, Logo 等 |
| 非标准 box-shadow | ~3 | inspector-element |

**状态**: 历史遗留问题，需在专项设计 token 合规冲刺中修复。

---

## 4. Commit 列表

| Commit | 描述 |
|--------|------|
| `325ce221` | snapshot: pre-fix baseline |
| `6064e237` | fix(tests): update session-pool and theme-apply-flow test expectations |
| `c9f58473` | fix(test): add layers/artResolved to cdp-inject VERIFY mock data |

---

## 5. 下一步建议

1. **设计 token 合规冲刺** — 修复 27 个 C6 违规（集中在 studio 组件）
2. **scanner 子系统补测试** — 10 个无测试文件待覆盖
3. **IPC handler 补测试** — 5 个无测试模块待覆盖
4. **模块级可变状态清理** — 18+ 处模块级 `let`/`const` Map/Set 构成隐式共享状态
5. **核心 Store 补测试** — agentStore/settingsStore/communityStore/secondaryInjectStore 仍零测试

---

*巡检代理: AgentSkin Pre-Inspection & Test Fix Agent v3.0*
*完成时间: 2026-08-26 12:40*
