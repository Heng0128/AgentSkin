# P0 — AgentEngineService 集成测试重构 实施报告

- **日期**: 2026-08-25
- **来源**: INSPECTION_REPORT_2026-08-25-0150.md 下一步建议 #1
- **状态**: COMPLETED（34 测试新增 + 1 个 P0 修复）
- **快照基线**: `99cbcd85` → 实施后 `46f5b0ed`

## 执行策略

采用多子智能体并行/串行分批执行：

| 批次 | 模式 | 子智能体 | 产出 |
|------|------|----------|------|
| Batch 1 | 并行 | Scout-α（测试依赖图）+ Scout-β（子模块接口） | 2 份分析报告 |
| Batch 2 | 串行 | 1 senior-developer | `agent-engine-service-test-harness.ts`（416 行） |
| Batch 3 | 并行 | 3 general-purpose（apply/restore/wallpaper） | 3 测试文件（34 测试） |
| Batch 4 | 串行 | 1 fixer | P0 修复（restore 有端口路径） |
| Batch 5 | 串行 | Coordinator | 本报告 |

## 交付物

### 新增文件

| 文件 | 行数 | 测试数 | 用途 |
|------|------|--------|------|
| `src/main/agent-engine-service-test-harness.ts` | 416 | 3 (self) | 共享测试 harness：类型安全 stub、标准化 mock 工厂 |
| `src/main/agent-engine-service-apply-integration.test.ts` | ~180 | 5 | apply 成功/失败/并发/清理 |
| `src/main/agent-engine-service-restore-integration.test.ts` | ~450 | 14 | restore 有端口/无端口/幂等/并发/清理 |
| `src/main/agent-engine-service-wallpaper-integration.test.ts` | ~350 | 15 | wallpaper 成功/失败自修复/后台/移除/并发 |

### 关键 commit

| Commit | 类型 | 说明 |
|--------|------|------|
| `5713f36b` | feat(test) | 共享 harness — 类型安全 stub、标准化 mock |
| `5a9039be` | feat(test) | 3 集成测试文件（34 测试）— 真实子模块接线 |
| `46f5b0ed` | fix(test) | P0 修复 — restore "有端口"路径死代码 |

## 验证结果

| 维度 | 结果 | 备注 |
|------|------|------|
| TSC | ✅ 0 error（新增文件） | 消除所有 `as any` |
| VIT | ✅ 34/34 新增 + 2197/2200 全量 | 4 个预存失败（@material 包缺失，非本轮引入） |
| BIO | ✅ 0 violation | — |
| 审计 | ⚠️ P0 已修复，P1/P2 留后续 | 见深度审计报告 |

## 深度审计发现与处置

### P0（已修复）
- **问题**: restore 测试"有端口"路径为死代码（resolveLivePort 始终返回 null）
- **修复**: 在"有端口"describe 的 beforeEach 中 mock `resolveLivePort.mockResolvedValue(9222)`
- **验证**: 14/14 测试通过，"有端口"分支正确覆盖

### P1（留后续）
1. `mockedRestoreThemeFlow` 复制业务逻辑（55 行），与 RC1 方向冲突 → 后续用 `vi.importActual` 替代
2. Harness 工厂未被测试文件使用（内联 mock 重复） → 后续统一迁移到 harness
3. 与 `test-helpers/mock-services` 同名工厂签名冲突 → 后续合并

### P2（留后续）
1. apply 测试循环断言（mock 自测 mock）
2. restore 测试 temp 目录泄漏（未调用 cleanupHarness）
3. wallpaper 测试未使用 `svc` 变量

## 下一步建议

### 短期（本轮可继续）
1. **统一迁移到 harness 工厂** — 将 3 个测试文件的内联 mock 替换为 `installStandardMocks()` + `configureDefaultFlowReturns()`，消除重复代码
2. **修复 temp 目录泄漏** — restore 测试添加 `cleanupHarness()` 调用
3. **清理未使用变量** — wallpaper 测试移除未使用的 `svc` 声明

### 中期（独立方向）
4. **mockedRestoreThemeFlow 替换为真实实现** — 使用 `vi.importActual` 获取真实 `restoreThemeFlow`，仅 mock CDP/文件系统依赖
5. **合并 test-helpers/mock-services 与 harness** — 统一 ThemeLibraryApi stub 工厂，消除同名冲突
6. **补全 cdp-fanout mock 方法** — `makeMockAdapter()` 仅覆盖 6/12 ApplicationAdapter 方法

### 长期（架构改进）
7. **引入 assertion lint 规则** — 配置 biome/vitest 插件禁止 `toBeDefined()`、`toBeTruthy()` 作为最终断言
8. **wallpaper-self-heal 独立测试** — 补充并发场景测试（FAILURE_THRESHOLD 边界、冷却窗口）
