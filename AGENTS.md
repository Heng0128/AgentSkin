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
| scripts/ | scripts/INDEX.md | 44 个校验脚本 |
| engines/ | engines/INDEX.md | CDP 注入引擎 |

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

## 5. 黄金规则

1. 禁止新增适配器（除非用户基数大且无原生主题能力）
2. 禁止 Studio 新增创作类功能
3. 禁止自建内容 CDN、账号系统、服务端
4. 注入架构重构需 RFC 评审——当前架构良好，非必要不重构。确需重构时提交 RFC 文档，经评审后方可执行。
5. UI 页面新增需 RFC 评审——六页封顶为默认约束（dashboard/workspace/themes/wallpaper/settings/studio）。确需新增时提交 RFC 文档，经评审后可突破上限。
6. 禁止 10/12/14px 间距，仅用 4/8/16/24/32/48
7. 禁止未经 npm run check 全绿就 push

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
