# 变更日志

本项目的所有显著变更都会记录在此文件中。格式遵循 [Keep a Changelog 1.0](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循 [语义化版本规范](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- TypeScript `moduleResolution: "Bundler"` 模式，配置路径别名 `@/*` / `@shared/*` / `@agentskin/engine`
- Zustand Store 聚合层重构（Phase 1 + Phase 2）：拆分为 shell / notification / status / agent / settings / theme / environment 等独立 store；原 `useAppController` 巨型 hook 退化为各 store 的 orchestrator
- Theme Studio 完整功能：undo/redo 双栈模型、Inspire 灵感面板（真实色彩和谐规则生成）、ImageToTheme 衍生色阶展开、调色板预设库、全局快捷键
- IPC 超时全链路保护：为 34 个 HIGH/MED handler 增加 `withTimeout` 包装；序列化、监控、渲染端超时识别
- 注入可靠性闭环：`agent-engine-service` 编排器重构、注入层 `fs.promises` 异步化、`waitForTheme` 轮询替换固定盲等
- Diagnostics IPC：lifecycle disposal pattern；timeout panel
- 15 个内置主题（含配色方案扩展）+ 24 套配色方案，配置驱动批量生成（326 文件）
- 注入契约断言脚本（`check-injection-contract.mjs`、`check-themes.mjs`、`check-theme-staleness`）
- 设计系统 Token 文档与 UI 信息架构方案评审文档
- 环境预设（Environment Preset）数据模型与 env-preset-store

### Changed

- `useAppController` → Zustand 聚合层：跨 store 调用使用 `getState().action()`；IPC 事件订阅收敛至各 store 的 `create()` 内部
- boot-profiler 启动性能埋点精细化
- UI 架构调整：Agents 视图独立化、Dashboard 转型为概览页、Settings 重分区
- `tonal-palette` 从 profile 层迁至 shared 层，渲染层可直接引用
- 主题管线的选择器 / `valueForToken` 优先级 / `buttonFg` 亮度派生逻辑优化
- 统一版本号为 `1.0.0`，移除自动升级机制
- 所有核心页面消除硬编码中文，改用 i18n 处理

### Fixed

- **React Error #185**（Maximum update depth exceeded）：`useSyncExternalStore` tearing 导致启动后无限循环崩溃。根因是 `queueMicrotask` 在 React passive-commit 阶段触发同步 `store.set()`；改用 `requestAnimationFrame` 将初始化推迟到 commit 之后
- drawer 动画闪烁（CSS transition 与 React commit 时序冲突）
- Theme Studio i18n 残留硬编码 + 安全修复 + 架构优化
- Studio export 时选择状态泄漏（selection 泄漏）
- 设计系统 token 一致性问题
- pkg-parser 空 magic 导致的 Scene 解析崩溃
- env-preset-store legacy 数据回填
- 移除 `ThemeWatchdog` / `AgentProcessMonitor` / `CdpWatcher` 三处死代码
- 存量 lint 清零（40 errors + 7 warnings → 0）

### Regenerated

- 全量重导 15 个 `.agentskin-theme` 分发包（修复 selection / buttonFg / sidebar 相关样式）

## [1.0.0] - 2026-08-10

###里程碑

- 产品版本号统一收敛至 `1.0.0`
- 六适配器（codex / doubao / qoderwork / traework / workbuddy / zcode）统一 CDP 注入链路稳定
- 声明式主题管线 + 多配色方案 + custom.css 用户层
- Wallpaper Engine 库集成与壁纸注入、壁纸取色自动生成主题
- `.agentskin-bundle` 环境组合包格式
- Theme Studio 拆分做实 + Workspace 环境组合（P0 主线）
- 文档体系重建（ARCHITECTURE / ROADMAP / PRODUCT / THEME_SPEC / THEME_API）
- PR 级 CI 门禁
- 存量 lint 清零
