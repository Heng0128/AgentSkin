# 预存问题与测试问题巡检报告 — 2026-08-26 09:00

## 1. 路径污染清理摘要

本次巡检未发现新的路径污染。所有历史污染文件（`.tsbuildinfo`、`*.log`、`test-output/` 等）均已被 `.gitignore` 正确覆盖。`git status` 显示仅 2 个未跟踪的 scout 报告文件（`scout-alpha-b.json`、`scout-beta-b.json`），属于历史遗留的报告产物，非本次引入。

## 2. 预存问题修复摘要

### 2.1 测试基础设施修复（6 项，消除全部 15 个失败测试）

| # | 文件 | 问题 | 修复方式 |
|---|------|------|---------|
| 1 | `src/main/mcp/mcp-server.test.ts` | McpServer mock 不是构造函数，8 测试失败 | 改用 class-based mock + 修改断言为检查返回实例 |
| 2 | `src/main/locale-preferences.test.ts` | `readFileSync` 从 `fs/promises` 导入，2 测试失败 + 2 tsc 错误 | 新增 `fsSync` 导入，替换为 `fsSync.readFileSync` |
| 3 | `src/ui/stores/__tests__/notificationStore.test.ts` | mock 提供字符串但代码调用函数，1 测试失败 | 将 `studioTimeoutDesc` 从字符串改为函数 |
| 4 | `src/main/ipc/community-theme-ipc.test.ts` | mock 使用旧 `installBytes` API，1 测试失败 | 改为 `installFile` + 新增 `convertThemePackage` mock |
| 5 | `src/ui/components/workspace/TweakPanel.test.tsx` | mock 缺少 4 个 group-label i18n key，3 测试失败 | 补充 `workspaceGroupColor/Shape/Typography/Motion` |
| 6 | `src/main/community/dsh-skin-converter.ts` | 6 tsc 错误：`AgentSkinTokens`/`AgentSkinTokenKey` 未导入 | 添加 `import type` 语句 |

### 2.2 TypeScript 类型错误修复（4 项，消除 16 个 tsc 错误）

| # | 文件 | 问题 | 修复方式 |
|---|------|------|---------|
| 1 | `src/main/scene/sce-parser.test.ts` | Buffer 类型不匹配 + null 访问 + 无用 ts-expect-error | 使用 `as unknown as typeof fs.readFile` + `config!` 非空断言 + 移除过时 ts-expect-error |
| 2 | `src/main/app-discovery-enhanced.test.ts` | execFile mock 回调参数类型不匹配 | `cb` 辅助函数改用 `any` + 内联 mock 添加 `fn: any` + 补全第 3 个参数 |
| 3 | `src/main/cdp/renderer-guardian.test.ts` | 5 处访问 `private stableTargetId` | 改用 `(g as any).stableTargetId` |
| 4 | `src/main/wallpaper-self-heal.test.ts` | `thunk1()` 可能为 null | 改用 `thunk1!()` 非空断言 |

### 2.3 统计

- 修复前：15 失败测试 / 24 tsc 错误
- 修复后：0 失败测试 / 0 tsc 错误
- 净增测试：0（全部修复均为测试基础设施修正，非新增测试）

## 3. 架构与代码质量发现

### 3.1 模块级可变状态（已记录，不修复）

18+ 处模块级 `let`/`const` Map/Set 构成隐式共享状态。在 Electron 主进程中这是标准模式，但增加了测试隔离难度。高风险项：`mcp-server.ts` 的 `serverInstance`/`transportInstance` 每次 `createMcpServer()` 调用都重新赋值。

### 3.2 Store 跨调用边界耦合（已记录，不修复）

- `themeStore ↔ wallpaperStore`：循环依赖，通过 `getState()` 延迟访问避免运行时崩溃，但架构脆弱
- `themeStore` → 5 stores, `environmentStore` → 4 stores, `settingsStore` → 3 stores

### 3.3 静默错误吞没（已记录，不修复）

4 处 `void x.catch(() => {})` 在 `wallpaper-injector.ts` 和 `deferred-regen.ts` 中丢失 self-heal 和 regen 操作的错误。

### 3.4 测试覆盖盲区

- `src/main/services/scanner/` — 10 个文件无测试（三层扫描架构）
- `src/main/ipc/` — 5 个 IPC handler 无测试（bundle-ipc, concurrency-metrics, environment, mcp, window）

## 4. 全量验证结果

| 检查项 | 结果 |
|--------|------|
| `npx tsc --noEmit` | PASS（0 错误） |
| `npm test` | PASS（4609/4609 通过，4 skipped） |
| `npm run check` | biome 预存配置问题（schema 版本不匹配），非本次引入 |

## 5. 下一步建议

1. **修复 biome.json schema 版本** — 运行 `biome migrate` 将配置从 2.5.5 迁移到 2.5.10
2. **为 scanner 子系统补测试** — 优先覆盖 `services/scanner/pipeline/match.ts` 和 `services/scanner/infra/cache.ts`
3. **为 IPC handler 补测试** — 优先覆盖 `mcp-ipc.ts` 和 `bundle-ipc.ts`
4. **清理模块级可变状态** — 将 `mcp-server.ts` 的 `serverInstance`/`transportInstance` 改为 `createMcpServer` 的局部变量
5. **处理未跟踪的 scout 报告** — 将 `docs/reports/scout-*.json` 加入 gitignore 或提交
