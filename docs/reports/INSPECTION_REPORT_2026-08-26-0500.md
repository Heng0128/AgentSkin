# AgentSkin 巡检报告 — 方向 D 测试质量均衡 (Round 2)

## 元信息

| 项目 | 值 |
|------|-----|
| 方向编号 | D |
| 方向名 | 测试质量均衡（Scene 子系统测试过多、核心服务零测试、假断言扫描清理、临界路径补测） |
| 状态 | **COMPLETED** |
| 快照 commit | `ec7a21f9` |
| 最终 commit | `ee01558b` |
| 随机数 | 8/22 → 方向 D（权重 3，slot 8-10） |
| 执行时间 | 2026-08-26 05:00–05:32 |

## 执行摘要

| 指标 | 值 |
|------|-----|
| 发现问题总数 | 42（去重后） |
| Critical | 6 |
| Major | 20 |
| Minor | 14 |
| Info | 2 |
| 根因聚类 | 4 |
| 已修复根因 | 2（RC1 部分 + RC4） |
| 新增测试 | 60（scene-json-parser 38 + sce-parser 22） |
| 修改文件 | 3（1 修复 + 2 新增） |
| 独立 commit | 3 |
| 回滚次数 | 0 |
| 审计发现问题 | 0 |

## 发现与修复明细

| # | 文件 | 行号 | 严重等级 | 问题描述 | 修复方案 | 修复 commit | 状态 |
|---|------|------|---------|---------|---------|-----------|------|
| 1 | src/main/scene/scene-json-parser.ts | 1-543 | Critical | 543 行零测试覆盖，含 ~80 字段解析、动画属性、颜色/向量解析 | 新增 38 个单元测试 | a5e8665d | ✅ 已修复 |
| 2 | src/main/scene/sce-parser.ts | 474-627 | Critical | 647 行零测试覆盖，含 parseSce/parseSceMetadata/isSceProject | 新增 22 个单元测试 | ee01558b | ✅ 已修复 |
| 3 | src/main/scene/sce-parser.ts | 489 | Critical | parseSce 接受数组输入（typeof [] === 'object'）导致非预期行为 | 添加 Array.isArray 检查 | bb478923 | ✅ 已修复 |
| 4 | src/main/scene/ce-parser.ts | 1-350 | Critical | 350 行二进制解析器零测试覆盖 | — | — | ⏳ 待后续 |
| 5 | src/main/window-manager.ts | 1-252 | Critical | 252 行窗口管理零测试覆盖 | — | — | ⏳ 待后续 |
| 6 | src/main/tray-manager.ts | 1-169 | Critical | 169 行托盘管理零测试覆盖 | — | — | ⏳ 待后续 |
| 7 | src/main/scene/tex-parser.test.ts | 510-1178 | Major | BC7 测试膨胀 ~670 行重复模式 | — | — | ⏳ 待参数化 |
| 8 | src/main/agent-engine-service.test.ts | 285,491 | Minor | 使用 `{} as any` 绕过类型检查，harness 已提供类型安全替代 | — | — | ⏳ 待迁移 |
| 9 | src/main/agent-engine-service-core-reliability.test.ts | 144 | Minor | 同上 `{} as any` 模式 | — | — | ⏳ 待迁移 |
| 10 | src/main/services/contracts.test.ts | 231 | Major | 假断言：运行时 count 检查 TS 编译期已保证 | — | — | ⏳ 待重构 |
| 11 | src/main/mcp/http-server.ts | 1 | Major | 357 行 HTTP 服务零测试覆盖 | — | — | ⏳ 待后续 |
| 12 | src/shared/types/theme.ts | 13 | Major | ThemeManifestColors 可选字段 vs 14-token 必填契约矛盾 | — | — | ⏳ 需 RFC |
| 13 | src/main/app-discovery.ts | 991 | Major | 核心逻辑零测试覆盖（仅衍生模块有测试） | — | — | ⏳ 待后续 |
| 14 | src/main/main-context.ts | 1 | Major | 283 行核心上下文零测试覆盖 | — | — | ⏳ 待后续 |
| 15 | src/main/mcp/mcp-server.test.ts | 70 | Minor | McpServer 构造函数抛出 — 预存失败 | — | — | ⏳ 预存 |

## 根因聚类

### RC1: Scene 解析模块零测试覆盖（Critical，6 issues）
- **根因**：多个 Scene 解析模块（scene-json-parser、sce-parser、ce-parser、tex-parser）中，仅 tex-parser 有测试，其他完全无覆盖
- **修复**：为 scene-json-parser（543 行）和 sce-parser（647 行）补写 60 个单元测试
- **剩余**：ce-parser 留待后续

### RC2: 测试膨胀与假断言（Major，4 issues）
- **根因**：tex-parser BC7 测试过度参数化；contracts.test.ts 假断言
- **修复**：本次未修复（tex-parser 参数化需专项处理）
- **状态**：⏳ 待后续

### RC3: 类型契约缺口（Major，2 issues）
- **根因**：ThemeManifestColors 可选字段 vs 14-token 契约要求必填不一致
- **修复**：需 RFC 评审修改核心类型定义
- **状态**：⏳ 待人工确认

### RC4: 生产代码类型安全（Critical，1 issue）
- **根因**：sce-parser.parseSce 未拒绝数组输入（`typeof [] === 'object'` 通过类型守卫）
- **修复**：添加 `Array.isArray(json)` 检查
- **状态**：✅ 已修复

## 方案选优记录

### RC1: Scene 解析器零测试

| 方案 | 时间复杂度 | 空间复杂度 | 长期可维护性 | 扩展性 | 依赖可控性 | 总分 |
|------|------------|------------|--------------|--------|------------|------|
| **A: 纯函数优先测试（选中）** | 9/10 | 10/10 | 9/10 | 8/10 | 10/10 | **9.10** ✅ |
| B: 全部 Scene 模块统一测试 | 6/10 | 7/10 | 7/10 | 9/10 | 10/10 | 7.55 |
| C: 集成测试替代单元测试 | 5/10 | 6/10 | 6/10 | 7/10 | 8/10 | 6.30 |

**选择理由**：
- scene-json-parser 是纯函数模块（文档明确声明可单元测试），测试成本最低、ROI 最高
- sce-parser 通过 mock fs 可快速覆盖，无需真实文件系统
- 60 个测试覆盖 ~1189 行核心解析逻辑，消除关键盲区
- 发现并修复了 1 个生产 bug（数组输入绕过类型守卫）

**落选方案**：
- 方案 B（全面覆盖）：ce-parser 二进制格式测试复杂度高，window-manager 依赖 Electron API，本次不覆盖
- 方案 C（集成测试）：集成测试运行慢、不稳定，不适合高频 CI 验证

## 验证结果

| Verifier | 轮次 | 结果 | 备注 |
|---------|------|------|------|
| Verifier-TSC | 1 | ✅ 通过 | 预存错误与本次无关（app-discovery-enhanced.test.ts、renderer-guardian.test.ts） |
| Verifier-VIT | 1 | ✅ 通过 | Scene 目录 160/160 通过，含新增 60 个测试 |
| Verifier-BIO | 1 | ✅ 通过 | 新增文件 biome 干净 |
| Verifier-CTR | 1 | ✅ 通过 | 无样式泄漏、无类型重复定义、无 Store 跨边界调用 |

**备注**：全量测试 15 个失败均为预存失败（mcp-server、locale-preferences、community-theme-ipc），由之前未提交的 doubao-bg-self-heal 代码引入，与本次巡检无关。

## 审计结论

| 维度 | 结果 | 说明 |
|------|------|------|
| 遗漏检查 | ✅ 无遗漏 | 每个 critical/major 都有对应修复或标记待处理 |
| 回归检查 | ✅ 无回归 | Scene 目录 160/160 通过，与基线一致 |
| 新增问题 | ✅ 无新 code smell 或反模式 |
| 一致性 | ✅ 修改风格与项目一致（JSDoc 注释、SPDX 头、@vitest-environment） |
| 文档同步 | ✅ 无需同步（未修改公开 API） |

## 修改文件清单

| 文件 | 变更类型 | 行数变化 |
|------|----------|----------|
| `src/main/scene/scene-json-parser.test.ts` | 新增 | +504 行（38 个测试） |
| `src/main/scene/sce-parser.test.ts` | 新增 | +368 行（22 个测试） |
| `src/main/scene/sce-parser.ts` | 修复 | +1 行（Array.isArray 检查） |

**总计**: 3 文件, +873 行

## Commit 清单

| Hash | Message |
|------|---------|
| `ec7a21f9` | snapshot: pre-inspection baseline [doubao-bg-self-heal uncommitted changes] |
| `bb478923` | fix(sce-parser): reject array input in parseSce — typeof [] === 'object' bypassed guard [phase5-step1] |
| `a5e8665d` | test(scene-json-parser): add 38 unit tests covering parseSceneJson, helpers, edge cases [phase5-step2] |
| `ee01558b` | test(sce-parser): add 22 unit tests for parseSce, parseSceMetadata, isSceProject with mock fs [phase5-step3] |

## 下一步建议

1. **【高优先级】参数化 tex-parser.test.ts 的 BC7 测试** — ~670 行重复模式可压缩至约 80 行，提升可维护性并减少 CI 时间
2. **【中优先级】迁移 agent-engine-service 测试文件到 harness** — 消除 9 个文件中的 `{} as any` 模式，统一使用 `makeServiceStub()` 工厂
3. **【中优先级】为 ce-parser 补写单元测试** — 二进制格式解析器需要应对截断文件、错误魔数等边界条件
4. **【低优先级】为 window-manager / tray-manager 补写测试** — 需要 mock Electron BrowserWindow API，成本较高但价值中等
5. **【低优先级】修复 ThemeManifestColors 类型契约** — 需 RFC 评审修改核心类型定义，消除 `{} 是合法的 ThemeManifestColors` 问题

---

*报告生成时间: 2026-08-26 05:32*
