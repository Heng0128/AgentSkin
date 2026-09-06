# 路径污染清理报告 — 2026-08-26 06:00

## 扫描结果

### 已跟踪的污染文件（4 个，已从 git 移除）

| 文件 | 大小 | 来源 |
|------|------|------|
| madge-err.txt | 50 B | madge 循环依赖检查 stderr |
| madge-out.txt | 29 B | madge 循环依赖检查 stdout |
| tsc-errors.txt | 0 B | tsc 错误捕获（空文件） |
| test-outputimage-analyzer-run.txt | 69 KB | vitest 测试输出捕获 |

### 未跟踪的污染文件（13 个，已 gitignored）

| 文件 | 大小 | 来源 |
|------|------|------|
| bio-fix.txt | 41 B | Biome 修复输出 |
| bio-out.txt | 43 B | Biome 检查输出 |
| mcp-debug.log | 275 KB | MCP 调试日志 |
| mcp-stderr.log | 4 KB | MCP stderr |
| mcp-stdout.log | 2 KB | MCP stdout |
| test-outputatomic-test.log | 9 KB | vitest 输出 |
| test-outputport-test.log | 11 KB | vitest 输出 |
| test-outputscope-test.log | 1.2 MB | vitest 输出 |
| tsc-out.txt | 0 B | tsc 输出（空） |
| tsc-output.txt | 560 B | tsc 输出 |
| vit-inst.txt | 2 KB | vitest 输出 |
| vit-out.txt | 527 B | vitest 输出 |
| .tsbuildinfo | 798 KB | TypeScript 编译缓存 |

### 污染目录（9 个，已 gitignored）

| 目录 | 文件数 | 说明 |
|------|--------|------|
| tmp/ | 13 | 临时运行输出和调试文件 |
| .meituan-catpaw/ | 1 | IDE 副本 |
| .agnes/ | 75 | agnes 工具 |
| .workbuddy/ | 12 | workbuddy 工具 |
| .zcode/ | 3 | zcode 工具 |
| .solidify/ | 2 | solidify 工具 |
| .fixture-tmp/ | 11 | 临时 fixture |
| agents-run-now/ | 40 | 运行时代理 |
| debug-tools/ | 111 | 调试工具输出 |

## 处理操作

| 操作 | 文件数 | 说明 |
|------|--------|------|
| git rm --cached | 4 | 从 git 索引移除，保留本地文件 |
| 更新 .gitignore | 4 | 添加明确的模式防止重新添加 |
| 保持不变 | 13+9 | 未跟踪文件已 gitignored，无需额外操作 |

## Git 状态

清理后 git status 干净（仅 .gitignore 修改 + 4 个删除已提交）。

提交: `b0b2b4fc` — chore: remove tracked pollution files and update .gitignore
