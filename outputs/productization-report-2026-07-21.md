# AgentSkin 产品化优化报告（2026-07-21）

范围：把项目从 CodeDrobe 迁移状态优化为真正独立的 AgentSkin 产品。
原则坚守：不破坏主题系统 / 不删除核心能力 / 不重写 `@codedrobe/core` 引擎 / 不开发 installer UI / 不修改主题生命周期。

---

## 任务 1：品牌系统彻底统一

**修改文件**
- `src/global.d.ts`：删除 `window.codeDrove`，仅保留 `window.agentSkin`（旧品牌 API 已移除）。
- `src/main/file-open.test.ts`：测试 fixture `'CodeDrobe.exe'` → `'AgentSkin.exe'`。
- `package-lock.json`：`name` `codedrobe-desktop` → `agentskin-desktop`。
- `README.md` / `README_zh.md`：`CodeDrobe Desktop` → `AgentSkin`、账号/品牌/`codedrobe://` 等文案统一。
- `SOURCE_CODE.md` / `THIRD_PARTY_NOTICES.md` / `TRADEMARKS.md` / `ASSETS_LICENSE.md`：品牌文案统一为 AgentSkin。

**删除文件**：无（旧 `window.codeDrove` API 在 `global.d.ts` 中已删除）。
**新增文件**：无。

**风险**
- `@codedrobe/core` 包名与 `.codedrobe-theme` 文件格式是引擎内部契约，按既有约束保留（不重写引擎）。
- 仍出现的 "CodeDrobe" 字符串仅位于 `node_modules/@codedrobe/core`（引擎 README）与 `out/`（过期构建产物，下次 package 刷新），非产品代码。

**当前验证**：`npm test` 65/65 通过。

---

## 任务 2：主题格式升级为 .agenttheme

**修改文件**
- `src/legacy/codedrobe-core-runtime.ts`：新增产品级常量 `agentThemeExtension = '.agenttheme'`（与引擎 `themeExtension`/`legacyThemeExtension` 并列）。
- `src/main/file-open.ts`：`isThemePackagePath` 现接受 `.agenttheme`（+ 兼容 `.codedrobe-theme`/`.codex-theme`）。
- `src/main/theme-library.ts`：`withNormalizedPackage` 现接受 `.agenttheme`（**修复**：此前导入 `.agenttheme` 会被 `invalidPackage` 拒绝）；内部存储仍用引擎 `themeExtension`（`.codedrobe-theme`），未破坏 ThemeLibrary。
- `src/main.ts`：导出默认扩展名由 `themeExtension` → `agentThemeExtension`（导出文件为 `.agenttheme`）；导入对话框已含 `.agenttheme`（L162）。
- `electron-builder.yml`：fileAssociations 扩展名 `agentskin-theme`/`agentskin-theme` → `agenttheme` + 保留 `codedrobe-theme`（legacy 兼容，便于迁移）。
- `src/main/file-open.test.ts`：新增 `.agenttheme` 断言。

**删除文件**：无。**新增文件**：无。

**风险 / 决策（需你确认）**
- "清理 .codedrobe-theme / .codex-theme" 的处理：将 `.agenttheme` 设为产品的**规范/用户可见格式**（导入对话框、导出默认、文件关联、拖放均优先），但**保留引擎层旧格式读取兼容**——原因：(a) 稳定性分支明确要求"不删除 codedrobe-theme 兼容支持"；(b) 引擎 `@codedrobe/core` 内部存储格式不可改；(c) 既有用户已装主题以 `.codedrobe-theme` 存储，硬删需做存储迁移（会破坏已装主题）。
- 内部存储扩展名仍为 `.codedrobe-theme`（引擎格式，用户无感）。若确需存储也改为 `.agenttheme`，需为 ThemeLibrary 增加迁移逻辑，请确认是否要做。

**当前验证**：`npm test` 65/65 通过（含 `.agenttheme` 断言）；`npm run package` 成功，asar 含 `themes/`。

---

## 任务 3：图标系统统一

**修改文件**
- `src/main.ts`：dock 图标由 `app.getAppPath()/assets/icon.png` → `brandingRoot()/icon.png`。**修复打包后 dock 图标缺失**：原路径在 asar 之外且被 `ignore` 过滤排除；现与窗口/托盘图标同源（`resources/runtime`）。
- `forge.config.ts`：所有图标路径 `assets/icon*` → `assets/branding/icon*`；`theme-file.icns` 的 `extraResource` 路径 → `assets/branding/theme-file.icns`。
- `electron-builder.yml`：`win.icon` → `assets/branding/icon.ico`；fileAssociations icon → `assets/branding/theme-file.ico`。
- `scripts/generate-desktop-icons.mjs`：SVG 源与输出路径统一到 `assets/branding/`。

**移动（统一来源，非新增）**
- `assets/icon.png|ico|icns`、`assets/theme-file.ico|icns`、`assets/icon.svg`、`assets/trayTemplate.svg`、`assets/theme-file.svg` → `assets/branding/`。
- 生成缺失的 `assets/runtime/icon.png`（窗口/坞图标，此前缺失）。

**删除文件**：无（旧图标移动到 branding，未删）。**新增文件**：无。

**风险 / 说明**
- 统一来源：`assets/branding/`（规范 SVG+PNG/ICO/ICNS 源）+ `assets/runtime/`（由脚本生成、`extraResource` 复制到 `resources/runtime` 供主进程运行时读取窗口/坞/托盘图标）。
- "无白边、透明背景"：app 图标为品牌深色圆角砖、主题文件图标为白底文档——均为各自图标类型的标准做法；未对 SVG 做透明化重设计（属美术工作，无法在此环境目视校验；若需全透明字形需单独设计 pass）。
- 托盘图标由 `generate-tray-icons.mjs`（sharp）从 `branding/app-icon.png` 生成，已存在。

**当前验证**：`npm run package` 成功；打包产物 `resources/runtime/{icon.png,tray-icon.png,trayTemplate.png,trayTemplate@2x.png}`、`resources/theme-file.icns`、`app.asar/themes/{cyber-neon,arctic-white,sakura}/manifest.json`（3）均在位；renderer 的 `branding/app-icon` 已 Vite 打包进 `.vite/renderer`。

---

## 任务 4：产品结构清理

**删除文件（均确认无引用 / 过期）**
- `name`（空文件，stray）
- `mkdir/`（空目录，stray）
- `generated-images/`（空目录）
- `dist/`（过期 `vite build` 产物，未被任何 vite/forge 配置引用；forge 用 `out/.vite`）
- `src/shared/utils/icon-normalizer.ts`（无引用的文档模块，死代码）
- `scripts/make-ico.mjs`（被 `generate-desktop-icons.mjs` 取代的冗余脚本）

**修改文件**：无。**新增文件**：无。

**风险**
- 删除均为无引用/过期产物；未触碰主题资源、运行时资源、核心 adapter。
- 保留：`docs/`、`licenses/`、`outputs/`（交付物）、`scripts/` 中仍在用的生成脚本、以及 `crc-test.mjs`/`png-check.mjs`（独立调试工具）。

**当前验证**：`npm test` 65/65 通过；`npm run package` 成功。

---

## 任务 5：产品信息更新

**检查结论**：`package.json` 已完成 AgentSkin 品牌化，无需修改：
- `name`: `agentskin-desktop`
- `productName`: `AgentSkin`
- `description`: "Agent theme management platform for domestic AI coding tools and extensible desktop agents."
- `author`: `AgentSkin`
- `version`: `2.1.0`、`license`: `MPL-2.0`

**修改文件**：无。**删除文件**：无。**新增文件**：无。

**当前验证**：`npm run package` 正常读取 `package.json`。

---

## 总体验证

| 项目 | 结果 |
|---|---|
| `npm test` | ✅ 65/65 通过 |
| `npm run package` | ✅ win32 x64 成功；asar 含 `themes/`（3 主题）；`resources/runtime` 图标齐备；`resources/theme-file.icns` 在位 |
| `npm run check`（tsc） | ⚠️ 被 `src/ui/App.tsx` 与 `src/ui/components/install-progress.tsx` 的**并发 UI 编辑错误**中断：`XIcon`/`RotateCcwIcon`/`FileTextIcon` 未从 `@hugeicons/core-free-icons` 导出、`LogEntry \| null` 类型、`handler` 签名不匹配 |

**关于 tsc 中断的说明**：这些错误位于 UI 页面 / installer 组件，明确**超出本任务范围**（"禁止：不要开发 installer UI / 不要修改主题生命周期"），且为并发 agent 进行中的工作。本任务所有非 UI 改动（main / theme-library / file-open / forge / electron-builder / 脚本 / 文档）逻辑测试与打包均通过。建议待该 UI 工作落地后再跑完整 `tsc --noEmit`。

## 待你决策
1. 是否要将 `.codedrobe-theme`/`.codex-theme` 的**导入兼容**也彻底移除（需配套 ThemeLibrary 存储迁移，会重命名既有已装主题文件）。
2. 是否需要对图标 SVG 做**全透明字形**重设计（当前为品牌标准圆角砖 / 文档页）。
3. UI 类型错误（App.tsx / install-progress.tsx）是否交由对应 UI 工作收尾，或需要我单独修。
