# scripts — 校验与构建脚本

## 用途
项目全量校验、主题构建、资源生成、依赖分析与审计工具集。通过 `npm run check` 触发全量校验。

## 结构

### 目录

| 路径 | 用途 |
|------|------|
| `generators/` | 6 个适配器专用 CSS 生成器（每个适配器一个 .mjs） |

### 校验脚本（check-*）

| 脚本 | 用途 |
|------|------|
| `check-architecture-boundaries.mjs` | 验证分层依赖方向（C4）：UI → preload → IPC → 主进程 → 适配器 |
| `check-injection-contract.mjs` | 验证 AgentId 四源一致（C1）：主进程、渲染进程、引擎、Store 中的 AgentId 一致 |
| `check-themes.mjs` | 验证 14-token 主题契约（C2）：每个主题包必须包含完整的 14 个设计 token |

### 构建脚本（build-*）

| 脚本 | 用途 |
|------|------|
| `build-agent-profiles.mjs` | 构建 Agent 配置文件，扫描并序列化所有 Agent 元数据 |
| `build-palette.mjs` | 构建调色板，从图像资源生成主题调色板 |
| `build-theme-package.mjs` | 构建主题包，将源文件打包为可分发主题 |

### 生成脚本（generate-*）

| 脚本 | 用途 |
|------|------|
| `generate-desktop-icons.mjs` | 生成桌面图标资源 |
| `generate-nsis-assets.mjs` | 生成 NSIS 安装包资源 |
| `generate-theme-assets.mjs` | 生成主题静态资源（缩略图、预览图等） |
| `generate-theme-css.mjs` | 生成主题 CSS 文件，从 token 映射到 CSS 变量 |
| `generate-theme-icons.mjs` | 生成主题图标 |
| `generate-tray-active-icons.mjs` | 生成托盘激活态图标 |
| `generate-tray-icons.mjs` | 生成托盘图标集 |
| `generators/traeworkCss.mjs` | traework 适配器 CSS 生成器 |
| `generators/qoderworkCss.mjs` | qoderwork 适配器 CSS 生成器 |
| `generators/workbuddyCss.mjs` | workbuddy 适配器 CSS 生成器 |
| `generators/doubaoCss.mjs` | doubao 适配器 CSS 生成器 |
| `generators/codexCss.mjs` | codex 适配器 CSS 生成器 |
| `generators/zcodeCss.mjs` | zcode 适配器 CSS 生成器 |

### 审计脚本（audit-*）

| 脚本 | 用途 |
|------|------|
| `_audit-orphans.mjs` | 审计孤立文件：检测未被任何模块引用的代码 |
| `_audit-palette.mjs` | 审计调色板一致性 |
| `_audit-pkg-diff.mjs` | 审计包差异，对比主题包间的结构差异 |
| `audit-api-surface.mjs` | 审计 API 表面，检测公开接口变更 |
| `audit-compiled-themes.mjs` | 审计已编译主题的完整性与一致性 |

### 分析脚本（analyze-*）

| 脚本 | 用途 |
|------|------|
| `analyze-complexity.mjs` | 代码复杂度分析，检测圈复杂度超标的函数 |
| `analyze-deps.mjs` | 依赖关系分析，生成模块依赖图 |
| `analyze-rendering-necessity.mjs` | 分析渲染必要性，检测可跳过的渲染操作 |

### 其他工具脚本

| 脚本 | 用途 |
|------|------|
| `_debug-contract.cjs` | 契约调试器，辅助排查注入契约违规 |
| `automation-guard.mjs` | 自动化守卫，防止 CI 流程中未提交代码运行 |
| `automation-lock.mjs` | 自动化锁，防止并发 CI 冲突 |
| `branding.config.mjs` | 品牌配置，统一产品名、包名、版权信息 |
| `capture-trae.ps1` | 截屏脚本（traework 专用） |
| `cdp-full-extract.mjs` | CDP 全量提取，从目标应用导出完整 DOM/CSS |
| `cdp-probe-screenshot.mjs` | CDP 截屏探针，获取目标应用截图用于调试 |
| `cdp-probe-v2.mjs` | CDP 探针 v2，增强版应用状态探测 |
| `clean-out.ps1` | 清理构建产物 |
| `color-theory.mjs` (`.d.ts`) | 色彩理论工具，色相/饱和度/亮度计算与对比度验证 |
| `create-builtin-themes.mjs` | 创建内置主题包 |
| `deploy-theme-assets.mjs` | 部署主题资源到构建目录 |
| `detect-dead-code.mjs` | 死代码检测 |
| `dev-workspace.bat` | 开发工作区启动脚本 |
| `fix-sakura-muted.mjs` | 修复 Sakura 主题 muted 色彩 |
| `madge-dep-graph.json` | Madge 生成的依赖图数据（JSON 格式） |
| `normalize-hero-images.mjs` | 标准化 Hero 区域图片资源 |
| `rebuild-all-themes.mjs` | 全量重建所有主题包 |
| `regen-studio-packages.mjs` | 重新生成 Studio 主题包 |
| `run-step.ps1` | 分步运行脚本的 PowerShell 封装 |
| `theme-generators.mjs` | 主题生成器入口，编排多个生成步骤 |
| `theme-utils.mjs` | 主题工具函数，被多个生成/校验脚本复用 |
| `update-theme-manifests.mjs` | 更新主题 manifest 文件 |
| `validate-themes.ts` | 主题验证器（TypeScript 实现） |
| `verify-nsis-assets.mjs` | 验证 NSIS 资源完整性 |

## 约定

1. **命名规范**：校验脚本 `check-*`、构建脚本 `build-*`、生成脚本 `generate-*`、审计脚本 `audit-*`、分析脚本 `analyze-*`。
2. **前缀约定**：下划线前缀（`_audit-*`、`_debug-*`）表示内部辅助脚本，不直接对外暴露。
3. **语言选择**：校验与构建工具优先使用 `.mjs`（ESM），TypeScript 仅用于需要类型检查的场景（如 `validate-themes.ts`）。
4. **`npm run check` 守卫**：所有 `check-*` 脚本必须在 `npm run check` 时全绿，否则禁止 push（不变量 C1-C7）。
5. **生成器就近**：各适配器 CSS 生成器集中在 `generators/` 目录，与 `engines/` 下对应适配器一一对应。
