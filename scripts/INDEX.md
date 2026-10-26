# scripts — 校验与构建脚本

## 用途
项目全量校验、主题构建、资源生成、依赖分析与审计工具集。通过 `npm run check` 触发全量校验。

## 结构

### 目录

| 路径 | 用途 |
|------|------|
| `generators/` | （已迁移至 `src/shared/theme/generators/`） |
| `lib/` | 核心工具库（adapter-registry、agent-state-engine、cdp-port-lease、css-material、css-modules-matcher、mcp-debug-tools、nl-theme-intent、oklch-extract、purge-engine、render-plan、runtime-validator、semantic-color-guard、skin-watchdog、theme-distribution、theme-manifest-schema、theme-sha256sums、theme-switcher-menu、validate-theme、landmarks 等） |
| `anchors/` | per-agent 语义锚点注册表 |
| `utils/` | （color-utils.mjs 已迁移至 `src/shared/theme/utils/`） |

### 校验脚本（check-*）

| 脚本 | 用途 | 内部依赖 |
|------|------|---------|
| `check-suite.mjs` | 全量校验调度器：独立运行所有 check 脚本，收集结果并汇总（避免 `&&` 短路导致后续检查被跳过） | 无 import（通过 `spawnSync` 路径引用所有 check-* 脚本） |
| `check-architecture-boundaries.mjs` | 验证分层依赖方向（C4）：UI → preload → IPC → 主进程 → 适配器 | 无内部 import |
| `check-design-tokens.mjs` | 验证设计 token 合规（C6）：间距、字号、圆角、阴影、硬编码颜色、内联 box-shadow | 无内部 import |
| `check-injection-contract.mjs` | 验证 AgentId 四源一致（C1）：主进程、渲染进程、引擎、Store 中的 AgentId 一致 | 无内部 import |
| `check-dependency-audit.mjs` | 依赖供应链审计：扫描 install/postinstall 脚本、传递依赖阈值、Snyk 漏洞 | `../src/compiler/dependency-audit.mjs` |
| `check-native-defect-consistency.mjs` | 验证原生硬编码视觉缺陷修正规则一致性（C8）：adapter 内嵌副本必须覆盖共享注册表 | `../src/shared/theme/native-defect-fixes.mjs` |
| `check-specificity-budget.mjs` | 验证 CSS 特异性预算（λ P0-1）：模拟生成 6 适配器 CSS 并对照 specificity profile | `src/shared/theme/generators/*.mjs` |
| `check-themes.mjs` | 验证 14-token 主题契约（C2）：每个主题包必须包含完整的 14 个设计 token | `./theme-tokens.mjs`, `./wcag-apca-check.mjs` |
| `check-i18n.mjs` | 验证 i18n 完整性：中英 key 对齐、空翻译检测、孤儿 key 检测 | `glob` (外部) |
| `check-selector-fragility.mjs` | 选择器健壮性 lint（B3）：检测脆弱选择器，warn-only | 无内部 import |
| `check-css-scope.mjs` | 验证 adapter CSS 作用域：确保每条规则锚定在对应适配器的 host class 下，防止 CSS 泄漏到其他应用 DOM | 无内部 import |
| `check-css-classes.mjs` | 类名契约（C13）：以**构建产物**为真相源，反查 `src/` 里当类名用却从未生成规则的字符串（命名空间错配导致的死类名），并普查 CSS 重复选择器（含 `:root`/`*`/元素选择器）。产物缺失时 SKIP；`--update` 写基线，`--json` 机读 | 无内部 import |
| `css-classes.baseline.json` | C13 的已接受债务基线：记录已知死类名及其文件数上限、重复选择器组。只可缩减（新增引用即失败），防止守卫静默失效 | — |
| `check-theme-staleness.mjs` | 验证 Palette-CSS 同步（C3） | `./theme-tokens.mjs`, `./wcag-apca-check.mjs` |
| `check-store-contracts.mjs` | 验证 Store 契约一致性（C5） | 无内部 import |
| `check-license-header.mjs` | 验证 SPDX 头部（C7） | 无内部 import |
| `check-semantic-contract.mjs` | 验证语义 Quant 层契约 | `../src/engine/**` (跨目录) |
| `check-orphan-tests.mjs` | 检测孤立测试（C12）：测试文件找不到对应源码时 fail，支持 `.orphan-tests-ignore` 忽略列表、tsconfig 路径别名、`path.resolve(__dirname, ...)` 解析 | 无内部 import |
| `check-selector-provenance.mjs` | 选择器溯源（C14，codex）：engines/codex 各文件的每个 Codex DOM 锚点（类名/`[class*=]`/`[class~=]`/data-* 属性/data-testid 值）必须溯源到 `engines/codex/selectors.contract.json`；双向校验（未登记锚点 → FAIL；合同条目 0 消费 → FAIL），对标上游 Codex-Dream-Skin provenance 流程防化石选择器 | 无内部 import |
| `check-selector-parsability.mjs` | 选择器可解析性（C15）：`engines/shared/semantic-selectors.json` 全部候选的零依赖结构校验（括号/引号平衡、逗号卫生、非空），防 `[role='navigation'`（2026-09-08 审计 S1）与 `:is(...),`（2026-09-07 workbuddy）两类静默失效；导出 `validateSelector` 供 `.test.mjs` 自测 | 无内部 import |
| `probe-engine/` | **六引擎深度适配实窗探针（探测整合入口）**：`node scripts/probe-engine/<engine>.mjs --port <cdpPort> [--json]`。每引擎一支、各自适配（严禁互相套用）：① 身份页面分样（豆包 doubao:// 与 chrome:// 双文档、codex app:// 路由、workbuddy 严格 renderer、zcode 聊天/编辑器窗识别）② 外观读取器（data-theme / class 正则 / .theme-zai-dark / data-vscode-context 各走各的）③ 结构断言（每引擎 3 条专属，如 workbuddy 侧栏双实现并存、codex data-* 承载）④ token 精确名期望（族名前缀不作期望；占位 L0 引擎不设）⑤ **四源锚点面**：A=anchors/index.mjs 注册表（PROBE-DATE 2026-08-23，任一变体零命中→**DRIFT 报警**）、B=lib/landmarks、C=自家 selectors.contract.json 逐变体复验、D=引擎文件全量提取。取代 cdp-probe-*.mjs 的锚点校验职能（截图/结构对拍等专项仍归原脚本）；只读，不点击不读正文 | `../anchors/index.mjs`, `../lib/landmarks/index.mjs` |

### 适配器校验脚本（validate-*）

| 脚本 | 用途 | 内部依赖 |
|------|------|---------|
| `validate-adapter.mjs` | 新适配器接入校验 CLI：`node scripts/validate-adapter.mjs <agent-id>` — 检查 config/config 导出/必需字段/共享引擎引用/独立 MutationObserver/SPDX 头部/文件大小预算，exit 0 通过 | 无内部 import |

### 运行时校验脚本（runtime-*）

| 脚本 | 用途 | 内部依赖 |
|------|------|---------|
| `runtime-check-all.mjs` | CLI 入口：连接本地 CDP，读取 agentskin manifest 获取选择器配置，调用运行时验证器，输出结构化 JSON 报告 | `./lib/runtime-validator.mjs` |
| `selector-preflight.mjs` | 统一兼容性预检：在应用主题前检测目标应用的 DOM 选择器是否匹配。支持静态语法检查（无 `--port`）和 CDP 运行时验证（有 `--port`），输出 JSON 报告 | 无内部 import（运行时从 lib/ 动态加载） |

### 构建脚本（build-*）

| 脚本 | 用途 | 内部依赖 |
|------|------|---------|
| `build-agent-profiles.mjs` | 构建 Agent 配置文件，扫描并序列化所有 Agent 元数据 | 无内部 import |
| `build-palette.mjs` | 构建调色板，从图像资源生成主题调色板 | 无内部 import |
| `build-theme-package.mjs` | 构建主题包，将源文件打包为可分发主题 | `../src/compiler/sanitize.js`, `../src/compiler/specificity.js`, `../src/shared/theme-build-fingerprint.js`, `./lib/theme-sha256sums.mjs`, `./utils/color-utils.mjs` |

### 生成脚本（generate-*）

| 脚本 | 用途 | 内部依赖 |
|------|------|---------|
| `generate-desktop-icons.mjs` | 生成桌面图标资源 | 无内部 import |
| `generate-defect-fixes-doc.mjs` | 从共享注册表自动渲染 `docs/native-defect-fixes.md`（`--verify` 校验新鲜度，供 `check:defect-doc`） | `../src/shared/theme/native-defect-fixes.mjs`, `../src/shared/theme/theme-utils.mjs` |
| `generate-nsis-assets.mjs` | 生成 NSIS 安装包资源 | `./branding.config.mjs` |
| `generate-theme-assets.mjs` | 生成主题静态资源（缩略图、预览图等） | 无内部 import |
| `generate-theme-css.mjs` | 生成主题 CSS 文件，从 token 映射到 CSS 变量 | `./design-language.mjs`, `./extended-colors.mjs`, `../src/shared/theme/theme-generators.mjs`, `../src/shared/theme/theme-utils.mjs`, `./variations-loader.mjs` |
| `generate-theme-catalog.mjs` | 扫描 themes/ 目录，自动生成 themes/catalog.json 主题目录单一事实源 | 无内部 import |
| `generate-theme-icons.mjs` | 生成主题图标 | 无内部 import |
| `generate-tray-active-icons.mjs` | 生成托盘激活态图标 | 无内部 import |
| `generate-tray-icons.mjs` | 生成托盘图标集 | 无内部 import |
| `generators/traeworkCss.mjs` | （已迁移至 `src/shared/theme/generators/`） | — |
| `generators/qoderworkCss.mjs` | （已迁移至 `src/shared/theme/generators/`） | — |
| `generators/workbuddyCss.mjs` | （已迁移至 `src/shared/theme/generators/`） | — |
| `generators/doubaoCss.mjs` | （已迁移至 `src/shared/theme/generators/`） | — |
| `generators/codexCss.mjs` | （已迁移至 `src/shared/theme/generators/`） | — |
| `generators/zcodeCss.mjs` | （已迁移至 `src/shared/theme/generators/`） | — |

### 审计脚本（audit-*）

| 脚本 | 用途 | 内部依赖 |
|------|------|---------|
| `_audit-orphans.mjs` | 审计孤立文件：检测未被任何代码引用的文件 | 无内部 import |
| `_audit-palette.mjs` | 审计调色板一致性 | 无内部 import |
| `_audit-pkg-diff.mjs` | 审计包差异，对比主题包间的结构差异 | 无内部 import |
| `audit-api-surface.mjs` | 审计 API 表面，检测公开接口变更 | 无内部 import |
| `audit-compiled-themes.mjs` | 审计已编译主题的完整性与一致性 | 无内部 import |
| `audit-engine-coverage.mjs` | V3 引擎覆盖度门禁（RFC 2026-09-03）：Gate A 冻结≡生成器、Gate B token 缺口、Gate C 选择器缺口。退出码 0=三门全过 | `../src/shared/theme/theme-generators.mjs` |
| `port-generator-to-engine.mjs` | （V3 已弃用路线的辅助）生成器内容 → 引擎 tokens/cosmetic 移植实验工具 | 同上 |
| `upgrade-themes-to-v3.mjs` | V3 一次性切换：16 主题 assets/css → overrides/ + manifest v3 化 + 白名单剪枝（幂等） | 无（纯 fs/JSON） |

### 分析脚本（analyze-*）

| 脚本 | 用途 | 内部依赖 |
|------|------|---------|
| `analyze-complexity.mjs` | 代码复杂度分析，检测圈复杂度超标的函数 | 无内部 import |
| `analyze-deps.mjs` | 依赖关系分析，生成模块依赖图 | 无内部 import |
| `analyze-rendering-necessity.mjs` | 分析渲染必要性，检测可跳过的渲染操作 | 无内部 import |
| `analyze-structure-compare.mjs` | 运行时 × 静态结构对拍 | 无内部 import |

### 脚手架与 QA 脚本（scaffold-* / qa-*）

| 脚本 | 用途 | 内部依赖 |
|------|------|---------|
| `scaffold-skin-package.mjs` | 皮肤包脚手架生成器：输入 name/slug/agent/colors → 输出完整主题包（manifest + CSS + install/verify/restore 脚本 + SKILL.md + README.md），遵守 14-token 契约 | `./theme-tokens.mjs` |
| `qa-skin-package.mjs` | 皮肤包 QA 验证清单：manifest 格式、CSS 语法、图片资源、脚本可执行性、目录结构、路径泄漏、敏感信息 | 无内部 import |

### DOM 与快照工具（dom-*）

| 脚本 | 用途 | 内部依赖 |
|------|------|---------|
| `dom-snapshot.mjs` | DOM 快照 API（CDP 只读接口）：连接目标应用 CDP → 获取 DOM 树 → 过滤敏感信息 → 生成稳定选择器候选 → 输出结构化 JSON | 无内部 import |

### 系统脚本（.ps1 / .bat / .sh）

| 脚本 | 用途 | 内部依赖 |
|------|------|---------|
| `capture-trae.ps1` | TRAE 窗口截屏工具：Win32 API 截取 TRAE 应用窗口画面（User32 + GDI32 + System.Drawing） | 无内部 import |
| `clean-out.ps1` | 健壮清理 electron-vite + electron-builder 输出目录：解决 Windows Defender 实时扫描锁定大文件导致 `rd /s /q` 静默失败的问题 | 无内部 import |
| `dev-workspace.bat` | 开发工作区启动器：配置 Node.js 路径 + 启动开发环境 | 无内部 import |
| `install.sh` | macOS/Linux 一键安装脚本：检测平台 + Node.js >= 22 → 下载 GitHub Release → 解压到 `~/.agentskin/` → 创建快捷方式 | 无内部 import |
| `install.ps1` | Windows 一键安装脚本：检测 PowerShell >= 5.1 + Node.js >= 22 → 下载 GitHub Release NSIS 安装包 → 运行安装器 → 创建开始菜单快捷方式 | 无内部 import |
| `run-step.ps1` | 构建步骤执行器：流式输出到控制台 + 日志文件，返回退出码（供 build.bat 调用） | 无内部 import |
| `start.bat` | 开发启动批处理：设置 UTF-8 编码 + 启动 electron-vite dev | 无内部 import |

### 其他工具脚本

| 脚本 | 用途 | 内部依赖 |
|------|------|---------|
| `agentskin-compiler.mjs` | 统一编译 CLI（λ S4）：build/verify/diagnose 三子命令，集成 sanitize（P0-2）与 specificity（P0-1）护栏 | `../src/compiler/sanitize.js`, `../src/compiler/specificity.js`, `./build-theme-package.mjs` |
| `agent-skin-mcp-server.mjs` | MCP Server 核心框架：stdio transport，7 个工具（list-targets、get-server-status、take-screenshot、get-dom-snapshot、verify-injection、list-discovery-targets、get-applied-theme），JSON-RPC 2.0 协议 | `./lib/adapter-registry.mjs`, `./lib/cdp-port-lease.mjs`, `./lib/mcp-debug-tools.mjs` |
| `automation-guard.mjs` | 自动化守卫，防止 CI 流程中未提交代码运行 | `./automation-lock.mjs` |
| `automation-lock.mjs` | 自动化锁，防止并发 CI 冲突 | 无内部 import |
| `branding.config.mjs` | 品牌配置，统一产品名、包名、版权信息 | 无内部 import |
| `color-theory.mjs` / `color-theory.d.ts` | 色彩理论工具，色相/饱和度/亮度计算与对比度验证 | 无内部 import |
| `convert-codedrobe-theme.mjs` | Codedrobe → AgentSkin 格式转换器：读取 `.codedrobe-theme` 文件，映射自定义变量到 14-token 系统，为 6 个适配器生成 CSS | 无内部 import |
| `create-builtin-themes.mjs` | 创建内置主题包 | 无内部 import |
| `deploy-theme-assets.mjs` | 部署主题资源到构建目录 | 无内部 import |
| `derive-missing-tokens.mjs` | 自动推导缺失的主题 token，保持 14-token 契约，仅填充缺失键，保留显式值 | 无内部 import |
| `detect-dead-code.mjs` | 死代码检测 | 无内部 import |
| `extract-theme-from-image.mjs` | 从图片（BMP/PNG）提取 14-token 主题：medianCut 量化 → 14-token 映射 → WCAG 对比度安全修正，零外部依赖 | 无内部 import |
| `image-to-theme.mjs` | 从图片或 `--colors` 颜色列表生成完整 14-token 主题配色方案 | 无内部 import |
| `leonardo-wrapper.mjs` | Leonardo 对比度驱动配色：封装 `@adobe/leonardo-contrast-colors` 生成 WCAG 合规的 14-token 色板 | `@adobe/leonardo-contrast-colors` (外部), `./oklch-utils.mjs` |
| `merge-selector-harvest.mjs` | 离线扫描 → 运行时选择器候选：读取 extract-summary.json 的 fragilitySeeds，筛选高稳定性种子，映射为 CSS 选择器输出 | 无内部 import |
| `native-defect-fixes.mjs` | （已迁移至 `src/shared/theme/native-defect-fixes.mjs`） | — |
| `normalize-hero-images.mjs` | 标准化 Hero 区域图片资源 | 无内部 import |
| `oklch-utils.mjs` | OKLCH 色彩空间转换：HEX ↔ OKLCH 互转 + 明度/色相/彩度调整，纯函数零依赖 | 无内部 import |
| `rebuild-all-themes.mjs` | 全量重建所有主题包 | `./build-theme-package.mjs` |
| `regen-studio-packages.mjs` | 重新生成 Studio 主题包 | `./build-theme-package.mjs` |
| `theme-generators.mjs` | （已迁移至 `src/shared/theme/theme-generators.mjs`） | — |
| `theme-tokens.mjs` | 14 token 常量定义（单一事实源） | 无内部 import |
| `theme-utils.mjs` | （已迁移至 `src/shared/theme/theme-utils.mjs`） | — |
| `update-theme-manifests.mjs` | 更新主题 manifest 文件 | 无内部 import |
| `validate-theme-catalog.mjs` | 校验 themes/catalog.json 与实际 themes 目录一致性：孤立条目、缺失条目、元数据漂移 | 无内部 import |
| `validate-theme-package.mjs` | 主题包质量门禁：PNG alpha 通道检测、payload budget（builtin 50MB / community-imported 20MB）、CSS url() 引用完整性、manifest 结构完整性（schemaVersion + 必填字段 + hex 颜色） | 无内部 import |
| `validate-theme-metadata.mjs` | P2 署名链合规校验：构建期/CI 门禁，校验 themes/ 下所有 manifest.json 的元数据署名链合规 | 无内部 import |
| `validate-themes.mjs` | 主题验证器（MJS）：扫描 themes/ 目录，校验 14 个必需颜色令牌 | 无内部 import |
| `validate-themes.ts` | 主题验证器（TypeScript 实现） | `../src/main/catalog/theme-package-loader` |
| `variations-loader.mjs` | Component Variations 加载器：读取 manifest 中的 componentVariations 声明，加载 variations JSON 生成 CSS | 无内部 import |
| `verify-nsis-assets.mjs` | 验证 NSIS 资源完整性 | 无内部 import |
| `verify-theme-integrity.mjs` | 主题包 14-token 契约完整性校验 | 无内部 import |
| `verify-theme-sha256.mjs` | 主题包 SHA-256 完整性校验 CLI | 无内部 import |
| `verify-adapter-compat.mjs` | CI 适配器兼容性校验：扫描 themes/ 下所有主题，验证 palette.css 12 token 完整、manifest.json schemaVersion: 2、每个声明适配器 CSS 存在且语法合法、图片资源引用存在；输出 JSON 报告（ok/broken/unknown） | 无内部 import |
| `theme-package-integrity.mjs` | 主题包 SHA-256 完整性校验工具 | 无内部 import |
| `theme-selector-lint.mjs` | 主题包选择器静态 lint | 无内部 import |
| `design-language.mjs` | 设计语言注册表（无 I/O） | 无内部 import |
| `extended-colors.mjs` | 语义色块生成 + 对比度计算 | `./utils/color-utils.mjs` |
| `wcag-apca-check.mjs` | WCAG 2.1 + APCA 对比度引擎：验证 foreground/background 对比度 + 自动 on-color 对比度 | `./extended-colors.mjs` |
| `cdp-full-extract.mjs` | CDP 全量提取，从目标应用导出完整 DOM/CSS | 无内部 import |
| `cdp-probe-screenshot.mjs` | CDP 截屏探针，获取目标应用截图用于调试 | 无内部 import |
| `cdp-probe-v2.mjs` | CDP 探针 v2，增强版应用状态探测 | 无内部 import |
| `visual-qa-screenshot.mjs` | 运行时视觉 QA：CDP 截图 + 像素 diff + HTML 报告（P0-1） | `pngjs` (已有依赖) |
| `extract-asar-summary.mjs` | ASAR 静态逆向 | 无内部 import |

### 测试脚本（*.test.mjs / *.test.ts）

| 脚本 | 用途 | 内部依赖 |
|------|------|---------|
| `agent-skin-mcp-server.test.mjs` | MCP Server 协议与工具注册单元测试：mock 5 个 CDP 调试函数，测试 JSON-RPC 消息处理 | `vitest` |
| `automation-lock.test.mjs` | 自动化锁持有者身份验证测试：v2 锁格式、进程存活检测、isOwnLock() 区分、v1 兼容 | `vitest` |
| `check-selector-fragility.test.mjs` | 选择器健壮性 lint 内部函数测试 | `vitest` |
| `check-themes.test.mjs` | 14-token 主题契约校验测试：detectThemeSource、validateThemeMetadataInline、全流程集成 | `vitest` |
| `derive-missing-tokens.test.mjs` | 缺失 token 推导测试：显式 token 不被覆盖、暗/亮主题推导差异、inference 字段标记 | `vitest` |
| `dom-snapshot.test.mjs` | DOM 快照 API 测试：CDP 连接、DOM 捕获、过滤规则、选择器生成、landmark 匹配 | `vitest` |
| `extract-theme-from-image.test.mjs` | 图片→主题提取管线测试：medianCut 量化、模式检测、14-token 映射、WCAG 对比度 | `vitest` |
| `image-to-theme.test.mjs` | 图片→主题生成管线测试：参数解析、颜色验证、方案检测、token 映射、WCAG 计算 | `vitest` |
| `leonardo-wrapper.test.mjs` | Leonardo 配色生成测试：generate14TokenPalette、generateFromHue、generateLeonardoTheme、suggestForeground | `vitest` |
| `merge-selector-harvest.test.mjs` | 选择器候选合并管线测试：inferSemantics、isMappable、runPipeline | `vitest` |
| `oklch-utils.test.mjs` | OKLCH 色彩空间转换测试：hexToOklch、oklchToHex、adjustLightness、generateRamp、rotateHue | `vitest` |
| `selector-preflight.test.mjs` | 兼容性预检测试：参数解析、静态语法校验、JSON 输出、阈值逻辑、agent 验证 | `vitest` |
| `theme-package-integrity.test.mjs` | 主题包完整性 CLI 集成测试：临时目录创建、generate/verify 模式、边界情况 | `vitest` |
| `theme-selector-lint.test.mjs` | 主题选择器静态 lint 测试：7 种警告类型、边界情况、主题扫描器 | `vitest` |
| `verify-theme-integrity.test.mjs` | 主题包完整性 CLI 测试：generate/verify（有效/无效/缺失）、verify-all 批量 | `node:fs` |
| `visual-qa-screenshot.test.mjs` | 视觉 QA 测试：像素 diff 算法、HTML 报告生成、参数解析、维度不匹配处理 | `vitest`, `pngjs` |
| `verify-adapter-compat.test.mjs` | CI 适配器兼容性校验测试：完整主题通过、缺失 token 检测、manifest schema 错误、adapter CSS 缺失、图片引用缺失、CSS 语法错误、多适配器覆盖 | `vitest` |
| `validate-theme-package.test.mjs` | 主题包质量门禁测试：正常主题通过、CSS 引用错误、payload 超限、缺失 manifest 字段、PNG alpha 检测、跳过 bundle 目录 | `node:test` |
| `wcag-apca-check-enhanced.test.mjs` | 增强对比度检查测试：checkContrast（单对）、checkThemeContrastBatch（全主题）、向后兼容 | `vitest` |

### MCP 调试工具（mcp-*）

| 脚本 | 用途 | 内部依赖 |
|------|------|---------|
| `agent-skin-mcp-server.mjs` | MCP Server 核心框架（见上方"其他工具脚本"） | `./lib/adapter-registry.mjs`, `./lib/cdp-port-lease.mjs`, `./lib/mcp-debug-tools.mjs` |
| `lib/mcp-debug-tools.mjs` | CDP 调试工具集，5 个底层函数（takeScreenshot、getDomSnapshot、verifyInjection、listDiscoveryTargets、getAppliedTheme） | `../../src/engine/src/index.mjs` (跨目录) |

### CSS 工具（css-* / css-modules-*）

| 脚本 | 用途 | 内部依赖 |
|------|------|---------|
| `lib/css-modules-matcher.mjs` | CSS Modules 类名匹配工具：`generateCssModulesSelector`、`detectCssModulesPatterns`、`createMutationObserverConfig` | 无内部 import |

### 轻量注入工具（theme-switcher-menu）

| 脚本 | 用途 | 内部依赖 |
|------|------|---------|
| `lib/theme-switcher-menu.mjs` | 轻量主题切换菜单生成器：`createSwitcherMenu`、`generateThemeCss`、`switchTheme`、`persistTheme` / `getPersistedTheme`、`buildInjectionScript`、`injectMenu` | 无内部 import |

### Schema 与兼容性预检（theme-manifest-schema / validate-theme / landmarks）

| 脚本 | 用途 | 内部依赖 |
|------|------|---------|
| `lib/theme-manifest-schema.mjs` | Schema 驱动的兼容性预检契约定义：`ADAPTER_IDS`、`SEVERITY`、`validateVerificationBlock`、`validateLandmark`、`validateContext`、`isValidAdapterId` | 无内部 import |
| `lib/validate-theme.mjs` | 兼容性预检引擎：`validateThemePackage`、`checkLandmarks`、`getCompatibilityReport` | `./landmarks/index.mjs`, `./theme-manifest-schema.mjs` |
| `lib/landmarks/index.mjs` | 六适配器稳定 landmarks 注册表：`LANDMARK_REGISTRY`、`getLandmarksForAdapter` | `./codex.mjs`, `./doubao.mjs`, `./qoderwork.mjs`, `./traework.mjs`, `./workbuddy.mjs`, `./zcode.mjs` |
| `lib/landmarks/traework.mjs` | TRAE Work 稳定 landmarks | 无内部 import |
| `lib/landmarks/qoderwork.mjs` | QoderWork 稳定 landmarks | 无内部 import |
| `lib/landmarks/workbuddy.mjs` | WorkBuddy 稳定 landmarks | 无内部 import |
| `lib/landmarks/doubao.mjs` | 豆包稳定 landmarks | 无内部 import |
| `lib/landmarks/codex.mjs` | OpenAI Codex 稳定 landmarks | 无内部 import |
| `lib/landmarks/zcode.mjs` | ZCode 稳定 landmarks | 无内部 import |

### 核心工具库（lib/ — 基础设施）

| 脚本 | 用途 | 内部依赖 |
|------|------|---------|
| `lib/adapter-registry.mjs` | 多应用适配器注册表：统一注册、发现、兼容性检查、健康监控（6 适配器） | 无内部 import |
| `lib/agent-state-engine.mjs` | Agent 状态感知引擎：实时跟踪多并发会话的 AI Agent 工作状态，解析全局最高优先级状态 | 无内部 import |
| `lib/bundle-signature.mjs` | Bundle 签名生成与验证（RSA-2048 + SHA-256）：防篡改、签名完整性校验 | 无内部 import |
| `lib/cdp-health-monitor.mjs` | CDP 健康监控 + 三层看门狗：软看门狗（事件循环延迟）、CPU 看门狗（busy-loop 检测）、硬看门狗（worker 线程心跳） | 无内部 import |
| `lib/cdp-port-lease.mjs` | CDP 端口租约池：原子 mkdir 锁获取 + leaseId 所有权验证，管理 7 个并发 CDP 连接（端口 9223-9229） | 无内部 import |
| `lib/css-material.mjs` | CSS 材质片段生成器：Acrylic（SVG fractalNoise + backdrop-filter）和 Liquid Glass（多层 box-shadow）效果 | 无内部 import |
| `lib/mcp-debug-tools.mjs` | CDP 调试工具集（见上方 MCP 调试工具） | `../../src/engine/src/index.mjs` |
| `lib/nl-theme-intent.mjs` | 自然语言主题意图解析器：中英文自由文本 → ThemeIntent → ThemeParams（14-token 适配） | 无内部 import |
| `lib/oklch-extract.mjs` | OKLCH 感知色彩提取引擎：纯 JS 解码 24/32-bit BMP → OKLCH 直方图 → 14-token 主题清单 | 无内部 import |
| `lib/purge-engine.mjs` | 零残留清理引擎：白名单机制清理主题注入残留（DOM 装饰、CSS 变量、定时器、全局状态、body 类） | 无内部 import |
| `lib/render-plan.mjs` | RenderPlan 语义 IR：位于 14-token 主题定义与 per-agent CSS 生成之间的版本感知中间表示 | 无内部 import |
| `lib/runtime-validator.mjs` | 核心验证逻辑：对比度采样（WCAG AA）、水平溢出检测、组件选择器命中验证 | 无内部 import |
| `lib/semantic-color-guard.mjs` | 语义色彩保护规则引擎：区分"可自由装饰的强调色"与"语义保留的状态色"（success/error/warning/diff） | 无内部 import |
| `lib/skin-watchdog.mjs` | 启动看门狗自动重应用机制：监控目标应用进程，应用重启后自动重应用当前主题 | 无内部 import |
| `lib/theme-distribution.mjs` | 主题商店分发协议：完整性验证 + 深度链接处理 | 无内部 import |
| `lib/theme-manifest-schema.mjs` | Schema 驱动的兼容性预检契约定义（见上方 Schema 与兼容性预检） | 无内部 import |
| `lib/theme-sha256sums.mjs` | 主题包 SHA256SUMS.txt 生成与验证：兼容标准 `sha256sum` 命令格式 | 无内部 import |
| `lib/theme-switcher-menu.mjs` | 轻量主题切换菜单生成器（见上方轻量注入工具） | 无内部 import |
| `lib/validate-theme.mjs` | 兼容性预检引擎（见上方 Schema 与兼容性预检） | `./landmarks/index.mjs`, `./theme-manifest-schema.mjs` |

### 核心工具库测试（lib/*.test.mjs）

| 脚本 | 用途 | 内部依赖 |
|------|------|---------|
| `lib/css-modules-matcher.test.mjs` | CSS Modules 类名匹配工具单元测试 | `vitest` |
| `lib/mcp-debug-tools.test.mjs` | CDP 调试工具集单元测试：结构验证 + 离线场景 + mock CDP | `vitest` |
| `lib/semantic-color-guard.test.mjs` | 语义色彩保护规则引擎单元测试 | `vitest` |
| `lib/skin-watchdog.test.mjs` | 启动看门狗单元测试：启停生命周期、应用状态检测、自动重应用、重试机制 | `vitest` |
| `lib/theme-switcher-menu.test.mjs` | 轻量主题切换菜单生成器单元测试 | `vitest` |
| `lib/validate-theme.test.mjs` | 兼容性预检引擎单元测试：manifest 验证块结构校验 | `node:test` |

### 锚点注册表（anchors/）

| 脚本 | 用途 | 内部依赖 |
|------|------|---------|
| `anchors/index.mjs` | per-agent 语义锚点注册表：CSS 生成器使用的稳定选择器单一事实源，按 data-* 属性优先级排序 | 无内部 import |

---

## 工程联动图

> 以下展示脚本间的协作关系，形成完整工程管线。每个联动链标注了数据流方向。

### 联动链 1：校验流程 (check pipeline)

```
npm run check → check-suite.mjs
  ├─ check-design-tokens.mjs        (C6, 独立)
  ├─ check-i18n.mjs                  (独立)
  ├─ check-themes.mjs                ──→ theme-tokens.mjs + wcag-apca-check.mjs → extended-colors.mjs → color-utils.mjs
  ├─ check-architecture-boundaries.mjs (C4, 独立)
  ├─ check-injection-contract.mjs    (C1, 独立)
  ├─ check-store-contracts.mjs       (C5, 独立)
  ├─ check-native-defect-consistency.mjs → native-defect-fixes.mjs → theme-utils.mjs → color-utils.mjs
  ├─ check-license-header.mjs        (C7, 独立)
  ├─ check-theme-staleness.mjs       → theme-tokens.mjs + wcag-apca-check.mjs
  ├─ check-semantic-contract.mjs     (独立, 引用 src/engine/)
  ├─ check-specificity-budget.mjs    (独立)
  ├─ check-dependency-audit.mjs      (引用 src/compiler/)
  ├─ check-selector-fragility.mjs    (独立)
  ├─ check-orphan-tests.mjs          (独立, 孤立测试检测 C12)
  └─ generate-defect-fixes-doc.mjs --verify → native-defect-fixes.mjs + theme-utils.mjs
```

**联动效应**：17 个 check 脚本由 check-suite.mjs 统一调度，共享 theme-tokens / wcag-apca-check / native-defect-fixes / theme-utils / color-utils 五层基础工具，任何一层变更都可能影响多个校验维度。

### 联动链 2：主题生成流程 (theme build pipeline)

```
create-builtin-themes.mjs (定义 15 主题)
  → build-palette.mjs (manifest → palette.css)
    → generate-theme-css.mjs (palette → 6 agent CSS)
      ├── design-language.mjs
      ├── extended-colors.mjs → color-utils.mjs
      ├── theme-generators.mjs
      │   ├── generators/traeworkCss.mjs   ┐
      │   ├── generators/qoderworkCss.mjs  ┤
      │   ├── generators/workbuddyCss.mjs  ├→ native-defect-fixes.mjs + theme-utils.mjs
      │   ├── generators/doubaoCss.mjs     ┤
      │   ├── generators/codexCss.mjs      ┤
      │   └── generators/zcodeCss.mjs     ┘
      └── variations-loader.mjs
    → generate-theme-assets.mjs (缩略图/预览图)
```

**联动效应**：定义 → 调色板 → CSS → 资源四层流水线，native-defect-fixes 和 theme-utils 是 6 个适配器生成器的共享基础。

### 联动链 3：编译/构建产物流程 (compile pipeline)

```
agentskin-compiler.mjs build <theme-id>
  → build-theme-package.mjs
    ├── ../src/compiler/sanitize.js (P0-2)
    ├── ../src/compiler/specificity.js (P0-1)
    ├── ../src/engine/src/adapters/index.mjs
    ├── ../src/engine/src/theme/package.mjs
    ├── ../src/shared/theme-build-fingerprint.js
    ├── lib/theme-sha256sums.mjs
    └── utils/color-utils.mjs
```

**联动效应**：编译器集成 sanitize + specificity 双护栏 + 引擎适配器 + 指纹生成，一次调用完成主题包全量构建。

### 联动链 4：MCP 调试链路

```
agent-skin-mcp-server.mjs (stdio JSON-RPC 2.0)
  ├── lib/adapter-registry.mjs
  ├── lib/cdp-port-lease.mjs
  └── lib/mcp-debug-tools.mjs → ../../src/engine/src/index.mjs
```

**联动效应**：MCP Server 通过 adapter-registry 发现目标、cdp-port-lease 管理连接、mcp-debug-tools 执行操作，三层分工清晰。

### 联动链 5：运行时质量门禁

```
runtime-check-all.mjs --agent <x> --port <N>
  → lib/runtime-validator.mjs (对比度采样 + 溢出检测)

selector-preflight.mjs --agent <x> [--port <N>]
  → (静态语法校验) 或 (CDP 运行时校验)
```

**联动效应**：运行时验证器 + 选择器预检构成注入后的双重质量保障。

### 联动链 6：Studio 导出/重建流程

```
Theme Studio (renderer) → IPC → build-theme-package.mjs
  ↓
rebuild-all-themes.mjs → build-theme-package.mjs
regen-studio-packages.mjs → build-theme-package.mjs
```

**联动效应**：Studio 导出 + 全量重建 + 包再生三条路径共享 build-theme-package.mjs 核心。

### 联动链 7：CDP 工具链

```
cdp-full-extract.mjs (全量 DOM/CSS 导出)
cdp-probe-screenshot.mjs (截屏探针)
cdp-probe-v2.mjs (增强状态探测)
  ↓
lib/cdp-health-monitor.mjs (健康监控 + 三层看门狗)
lib/cdp-port-lease.mjs (端口租约池)
lib/mcp-debug-tools.mjs (调试工具集)
```

**联动效应**：CDP 工具链覆盖"探测 → 提取 → 监控 → 调试"完整生命周期。

### 联动链 8：色彩工具链

```
oklch-utils.mjs (HEX ↔ OKLCH 转换)
  ├── leonardo-wrapper.mjs (对比度驱动配色)
  └── oklch-extract.mjs (BMP → OKLCH → 14-token)

extended-colors.mjs (语义色块 + 对比度)
  ├── wcag-apca-check.mjs (WCAG + APCA 对比度引擎)
  └── generate-theme-css.mjs (CSS 生成)

color-utils.mjs (基础色彩工具)
  ├── theme-utils.mjs
  └── extended-colors.mjs
```

**联动效应**：oklch-utils 和 color-utils 是两条并行色彩管线的底层基础，最终都服务于 14-token 主题生成。

---

## 依赖方向图

```
无依赖（叶子层）
  ├── utils/color-utils.mjs
  ├── theme-tokens.mjs
  ├── branding.config.mjs
  ├── design-language.mjs
  ├── automation-lock.mjs
  ├── oklch-utils.mjs
  ├── variations-loader.mjs
  ├── lib/bundle-signature.mjs
  ├── lib/runtime-validator.mjs
  ├── lib/css-modules-matcher.mjs
  ├── lib/theme-manifest-schema.mjs
  ├── lib/theme-switcher-menu.mjs
  ├── lib/adapter-registry.mjs
  ├── lib/agent-state-engine.mjs
  ├── lib/cdp-health-monitor.mjs
  ├── lib/cdp-port-lease.mjs
  ├── lib/css-material.mjs
  ├── lib/nl-theme-intent.mjs
  ├── lib/oklch-extract.mjs
  ├── lib/purge-engine.mjs
  ├── lib/render-plan.mjs
  ├── lib/semantic-color-guard.mjs
  ├── lib/skin-watchdog.mjs
  ├── lib/theme-distribution.mjs
  ├── lib/theme-sha256sums.mjs
  ├── lib/landmarks/*.mjs (6 个)
  ├── anchors/index.mjs
  ├── capture-trae.ps1
  ├── clean-out.ps1
  ├── dev-workspace.bat
  ├── run-step.ps1
  ├── start.bat
  └── 大多数 check-* 脚本

单层依赖
  ├── wcag-apca-check.mjs → extended-colors.mjs
  ├── extended-colors.mjs → ../src/shared/theme/utils/color-utils.mjs
  ├── generate-theme-css.mjs → design-language, extended-colors, ../src/shared/theme/theme-generators, ../src/shared/theme/theme-utils, variations-loader
  ├── check-themes.mjs → theme-tokens, wcag-apca-check
  ├── check-theme-staleness.mjs → theme-tokens, wcag-apca-check
  ├── check-native-defect-consistency.mjs → ../src/shared/theme/native-defect-fixes
  ├── build-theme-package.mjs → compiler/*, engine/*, shared/*, lib/*, ../src/shared/theme/utils/color-utils
  ├── agentskin-compiler.mjs → compiler/*, build-theme-package
  ├── rebuild-all-themes.mjs → build-theme-package
  ├── regen-studio-packages.mjs → build-theme-package
  ├── automation-guard.mjs → automation-lock
  ├── leonardo-wrapper.mjs → oklch-utils
  ├── scaffold-skin-package.mjs → theme-tokens, ../src/shared/theme/theme-utils, ../src/shared/theme/utils/color-utils
  ├── generate-defect-fixes-doc.mjs → ../src/shared/theme/native-defect-fixes, ../src/shared/theme/theme-utils
  ├── derive-missing-tokens.mjs → ../src/shared/theme/theme-utils, ../src/shared/theme/utils/color-utils
  ├── runtime-check-all.mjs → lib/runtime-validator
  ├── lib/validate-theme.mjs → lib/landmarks/index, lib/theme-manifest-schema
  ├── lib/landmarks/index.mjs → lib/landmarks/*.mjs (6 个)
  └── convert-codedrobe-theme.mjs → (独立)

多层依赖（核心枢纽）
  ├── check-suite.mjs → spawnSync 调度 14 个 check 脚本
  ├── agent-skin-mcp-server.mjs → lib/adapter-registry, lib/cdp-port-lease, lib/mcp-debug-tools
  └── src/shared/theme/generators/*.mjs (6 个) → ../native-defect-fixes + ../theme-utils
```

---

## 核心消费者分布

| 模块 | 被引用次数 | 主要引用者类别 |
|------|-----------|---------------|
| `utils/color-utils.mjs` | （已迁移至 `src/shared/theme/utils/`） | — |
| `theme-utils.mjs` | （已迁移至 `src/shared/theme/`） | — |
| `theme-tokens.mjs` | 3 | check-themes, check-theme-staleness, scaffold-skin-package |
| `native-defect-fixes.mjs` | （已迁移至 `src/shared/theme/`） | — |
| `theme-generators.mjs` | （已迁移至 `src/shared/theme/`） | — |
| `build-theme-package.mjs` | 3 | agentskin-compiler, rebuild-all-themes, regen-studio-packages |
| `branding.config.mjs` | 1 | generate-nsis-assets |
| `wcag-apca-check.mjs` | 2 | check-themes, check-theme-staleness |
| `extended-colors.mjs` | 2 | wcag-apca-check, generate-theme-css |
| `design-language.mjs` | 1 | generate-theme-css |
| `variations-loader.mjs` | 1 | generate-theme-css |
| `oklch-utils.mjs` | 1 | leonardo-wrapper |
| `lib/runtime-validator.mjs` | 1 | runtime-check-all |
| `lib/mcp-debug-tools.mjs` | 1 | agent-skin-mcp-server |
| `lib/adapter-registry.mjs` | 1 | agent-skin-mcp-server |
| `lib/cdp-port-lease.mjs` | 1 | agent-skin-mcp-server |
| `lib/validate-theme.mjs` | 0+ | 独立模块，供选择器预检/兼容性检查调用 |
| `lib/landmarks/index.mjs` | 1 | lib/validate-theme |
| `automation-lock.mjs` | 1 | automation-guard |

---

## 约定

1. **命名规范**：校验脚本 `check-*`、构建脚本 `build-*`、生成脚本 `generate-*`、审计脚本 `audit-*`、分析脚本 `analyze-*`。
2. **前缀约定**：下划线前缀（`_audit-*`、`_debug-*`）表示内部辅助脚本，不直接对外暴露。
3. **语言选择**：校验与构建工具优先使用 `.mjs`（ESM），TypeScript 仅用于需要类型检查的场景（如 `validate-themes.ts`）。
4. **`npm run check` 守卫**：所有 `check-*` 脚本必须在 `npm run check` 时全绿，否则禁止 push（不变量 C1-C9）。
5. **生成器就近**：各适配器 CSS 生成器集中在 `generators/` 目录，与 `engines/` 下对应适配器一一对应。
6. **三层工具链**：校验层 (check-*) → 核心工具层 (lib/, utils/) → 生成层 (generate-*, generators/)，依赖方向严格单向。
7. **测试共置**：所有 `*.test.mjs` 文件与源文件同目录，使用 Vitest 或 node:test 框架。
8. **系统脚本隔离**：`.ps1` / `.bat` 系统脚本集中在根目录，不进入 lib/ 或 generators/。

---

## 变更影响速查

> 修改以下模块时需格外谨慎，影响范围广：

| 模块 | 风险等级 | 原因 |
|------|---------|------|
| `theme-utils.mjs` | 🔴 高 | 最大枢纽，被 12+ 文件引用 |
| `check-suite.mjs` | 🔴 高 | 全量校验调度器，影响所有 check 脚本 |
| `build-theme-package.mjs` | 🟡 中 | 主题包构建核心，被 3 个脚本引用 |
| `native-defect-fixes.mjs` | 🟡 中 | C8 注册表单一来源，影响 6 个生成器 |
| `theme-tokens.mjs` | 🟡 中 | 14 token 常量定义，影响校验脚本 |
| `theme-generators.mjs` | 🟡 中 | 生成器门面，影响 CSS 生成 |
| `utils/color-utils.mjs` | 🟡 中 | 色彩工具基础，被 4 个文件引用 |
| `wcag-apca-check.mjs` | 🟡 中 | WCAG 对比度引擎，影响主题校验 |
| `branding.config.mjs` | 🟢 低 | 品牌配置，仅被 NSIS 脚本引用 |
| `automation-lock.mjs` | 🟢 低 | 自动化锁，仅被 guard 引用 |
| `lib/adapter-registry.mjs` | 🟡 中 | MCP Server 核心依赖，影响调试工具链 |
| `lib/cdp-port-lease.mjs` | 🟡 中 | CDP 连接管理，影响 MCP 调试 |
| `lib/mcp-debug-tools.mjs` | 🟡 中 | CDP 调试工具集，影响 MCP Server |
| 其他模块 | 🟢 低 | 消费者 ≤ 3，影响可控 |
