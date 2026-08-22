# AgentSkin — Agent Harness
AI Agent 视觉定制引擎。通过 CDP 注入为 traework、qoderwork、workbuddy 等六款 AI 应用提供主题与界面定制。

## 1. 项目标识
- 产品名: AgentSkin / 包名: agentskin-desktop
- 定位: 引擎非产品，Studio 非平台，无服务端
- 架构分层: UI → preload → IPC → 主进程服务 → 适配器 → CDP WebSocket → 目标应用

## 2. 技术栈（不可随意新增）
- React 19 + Zustand v5 + Electron + Biome + Vitest + Tailwind v4
- 12 Store: agent, bootProgress, diagnostics, dialog, environment, installFlow, notification, settings, shell, status, studio, theme, wallpaper, workspace
- 6 适配器: traework, qoderwork, workbuddy, doubao, codex, zcode

## 3. 导航

| 目录 | INDEX.md | 用途 |
|------|----------|------|
| src/main/ | src/main/INDEX.md | 主进程服务、IPC |
| src/ui/ | src/ui/INDEX.md | React 组件、Store |
| src/shared/ | src/shared/INDEX.md | 共享类型、工具 |
| scripts/ | scripts/INDEX.md | 校验/构建/生成脚本 |
| engines/ | engines/INDEX.md | CDP 注入引擎 |
| docs/reports/ | docs/reports/INDEX.md | 审计/巡检/实施报告 |
| docs/rfc/ | — | RFC 方案与实施报告 |

## 4. 不变量与验证

| # | 不变量 | 守卫脚本 | 失败时阅读 |
|---|--------|---------|-----------|
| C1 | AgentId 四源一致 | check-injection-contract | docs/ARCHITECTURE.md#适配器 |
| C2 | 14-token 主题契约 | check-themes | THEME_SPEC.md |
| C3 | Palette-CSS 同步 | check-theme-staleness | docs/ARCHITECTURE.md |
| C4 | 分层依赖方向 | check-architecture-boundaries | docs/ARCHITECTURE.md |
| C5 | Store 契约一致性 | check-store-contracts | src/ui/stores/ |
| C6 | 设计 token 合规 | check-design-tokens | docs/design-tokens.md |
| C7 | SPDX 头部 | check-license-header | CONTRIBUTING.md |
| C8 | 原生缺陷修正一致性 | check-native-defect-consistency | native-defect-fixes.mjs + engines/ |
| C9 | 缺陷规范文档新鲜度 | check:defect-doc | docs/native-defect-fixes.md |
| C10 | 变量桥接契约 | check-variable-bridge | docs/ARCHITECTURE.md#变量桥接 |

## 5. 黄金规则

1. 禁止新增适配器（除非用户基数大且无原生主题能力）
2. 禁止 Studio 新增创作类功能
3. 禁止自建内容 CDN、账号系统、服务端
4. 注入架构重构需 RFC 评审——当前架构良好，非必要不重构。确需重构时提交 RFC 文档，经评审后方可执行。
5. UI 页面新增需 RFC 评审——六页封顶为默认约束（dashboard/workspace/themes/wallpaper/settings/studio）。确需新增时提交 RFC 文档，经评审后可突破上限。
6. 禁止间距使用任意散值（如 `gap-[9px]`、`px-[13px]`）；间距应使用 Tailwind 标准档（4px 网格，2–96px，含 12/14px 等实际档位）；`w-*`/`h-*` 布局尺寸不受限——由 `check-design-tokens.mjs`（C6）强制，允许集以脚本为准（2026-08-20 校准，对齐 design-tokens.md §3.3/§7.2 实际字阶与间距）
7. 禁止未经 npm run check 全绿就 push
8. **禁止路径污染**（详见 §8「文件与路径卫生规范」）

## 6. RFC 触发条件

以下变更需提交 RFC 文档（Markdown 格式，存放于 docs/rfc/ 目录）：
- 重构注入架构（L0-L4 注入层）
- 新增 UI 页面（突破六页封顶）
- 新增适配器（突破六适配器上限）
- 修改核心数据模型（manifest schema, 14-token 契约等）

RFC 模板见 docs/rfc/TEMPLATE.md（待创建）

## 7. 启动方式

| 命令 | 用途 |
|------|------|
| npm start | 启动开发 |
| npm test | 运行测试 |
| npm run check | 全量校验 |
| git worktree | 并行开发 |

## 8. 文件与路径卫生规范

**根目录不是垃圾桶，路径污染是被禁止的违规行为。** 以下规则必须无条件遵守：

### 8.1 禁止创建的命令输出文件

运行 `npm run check` / `tsc` / `biome` / `vitest` / `playwright` / `node scripts/xxx.mjs` 时，**禁止**通过 `>` 重定向在根目录生成 `.txt` / `.log` 输出文件。此类文件是历史污染的主要来源。

| ❌ 禁止 | ✅ 正确做法 |
|--------|------------|
| `npm run check > check-result.txt` | 直接看终端，或输出到 `test-output/` |
| `npx tsc --noEmit > tsc-output.log` | 用 `npm run typecheck` |
| `npx vitest run > test-ui.txt` | 用 `npm test` |
| `node scripts/x.mjs > test-output.txt` | 输出到 `test-output/`（唯一合法落点） |
| `npm start > .start-out.log` | 直接运行 `npm start` |

**例外**：确需持久保存输出时，唯一合法位置是 `test-output/`（已 gitignore）。

### 8.2 禁止在根目录创建的文件类型

以下文件类型禁止出现在仓库根目录：

- 命令输出捕获：`*.txt` / `*.log`（见 8.1）
- 编译器缓存：`*.tsbuildinfo`
- 以绝对路径命名的垃圾文件（如 `CUsers*.txt` —— PowerShell 重定向误产物）
- 咨询/审计交付物：`项目审计报告.md` / `战略审计报告.md`
- 探针截图 / 临时预览：`splash-preview.png` 等
- 一次性调试脚本：`test-*.mjs` / `run-*.mjs` / `_verify_*.mjs`

### 8.3 文件应放哪里

| 内容 | 位置 |
|------|------|
| 核心源码 | `src/` |
| 校验/构建/生成脚本 | `scripts/`（新增须登记 `scripts/INDEX.md`） |
| 主题 | `themes/` |
| 架构/设计/规范文档 | `docs/` |
| 审计/巡检/实施报告 | `docs/reports/`（登记 `docs/reports/INDEX.md`） |
| RFC 方案与实施报告 | `docs/rfc/` |
| 命令输出捕获 | `test-output/` |
| 构建产物 / 依赖 | `out/` `coverage/` `node_modules/`（已 gitignore） |

### 8.4 新增文件的默认判断流程

1. 该文件是否属于 `src/` 核心源码 → 否进入下一步
2. 是否属于 `scripts/` 工具脚本 → 否进入下一步
3. 是否属于 `themes/` / `engines/` 主题与适配器 → 否进入下一步
4. 是否属于 `docs/` 体系文档 → 按类型放入对应子目录
5. 都不是 → **默认放进 `test-output/` 或询问用户，严禁直接丢根目录**

### 8.5 遵守方式

- **AI/Agent 每次写完代码或运行命令后，自查是否在根目录留了文件**。
- 验收标准：`git status` 的根目录应只出现 `CONTRIBUTING.md`「根目录允许的文件」清单中的工程文件。
- 违反此规范会导致仓库重新污染、历史重建（代价极高），属严重违规。
