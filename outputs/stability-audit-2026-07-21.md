# AgentSkin Desktop — 稳定分支维护 / 稳定性审计与构建验证报告

> 日期：2026-07-21
> 范围：底层稳定分支维护（非重构）。审计 6 个主题系统文件 + main.ts IPC，执行构建验证，输出报告。
> 约束遵守：未改 UI 页面、未改安装器体验、未改品牌视觉资源、未删 @codedrobe/core、未删 codedrobe-theme 兼容、未重新引入 renderer seed、未改 Theme 生命周期。

---

## 1. 修改文件列表

**本轮（稳定性审计 + 构建验证）未修改任何文件。**

- 仅做只读审计与构建命令执行。
- 发现 1 处真实缺陷（见第 5 节风险点 2），但属于「安装器/导入体验」边界，按约束「不修改安装器体验」「等待下一步指令」**未改动**，仅作为风险记录并给出推荐修复。
- 说明：次轮 `npm run check` 中途曾出现 `FirstLaunch.tsx` 找不到 `@/components/ui/progress` 的瞬时 TS2307 错误，复测已消失——根因为并发 agent 正在新增 `FirstLaunch.tsx` 与其依赖 `src/ui/components/ui/progress.tsx`，两次命令间该文件被创建完成。属并发编辑导致的瞬时态，非持久缺陷，无需修复。

## 2. 删除文件列表

**无。**

## 3. 测试结果

| 命令 | 结果 |
|---|---|
| `npm run check`（tsc --noEmit + vitest） | ✅ TypeScript **0 错误**；**65/65** tests passed（7 files） |
| `npm test`（vitest run） | ✅ 65 passed（同上，被 `check` 覆盖执行） |

测试覆盖关键路径：
- `theme-package-loader.test.ts`（13）：目录扫描、校验顺序、可选 asset 缺失容忍。
- `theme-library.test.ts`（10）：含 `installBytes` 能力测试（2 项：安装成功 / 缺失 id 拒绝）、原子安装、重复安装不覆盖、损坏包/缺 id 抛错、legacy `.codex-theme` 转换。

## 4. 打包结果

| 命令 | 结果 |
|---|---|
| `npm run package`（`electron-forge package`） | ✅ √ Packaging for x64 on win32；`out/AgentSkin-win32-x64` 产出 |
| asar 内含 `themes/` | ✅ 确认 `app.asar` 含：<br>`\themes\cyber-neon\manifest.json`<br>`\themes\arctic-white\manifest.json`<br>`\themes\sakura\manifest.json`<br>（各含 `icon.png` / `preview.png` / `assets/background.png`） |
| 打包后资源路径 | ✅ `getThemesDir()` 候选 `app.getAppPath()/themes` = `app.asar/themes` 在 asar 中存在；渲染进程资源（图标等）位于 `.vite/renderer/main_window/assets`，构建期已验证可解析。 |

## 5. 风险点

### 风险 1 — 审计清单文件 `installer-states.ts` 实际不存在
- 任务清单要求审计 `installer-states.ts`，但全仓（含 `src/`）`glob **/installer-states.ts` 与 `grep installer-states|buildStandardTasks|InstallerTask` **均无匹配**，该文件当前不存在，亦无任何文件 import 它（无破坏引用）。
- 判断：属历史清单/文档过时，非运行时问题。审计结论中相应项「无代码可审」，不影响稳定性。
- 建议：更新审计清单，移除该条目或确认其是否已被合并进 `theme-installer.ts` / 其他模块。

### 风险 2 — `theme:import` / `theme:export` 文件选择对话框扩展名过滤与真实格式不符（真实缺陷，未改，待指令）
- 事实：真实主题格式由 `@codedrobe/core` 的 `THEME_EXTENSION = ".codedrobe-theme"` 决定，`installFile` / `importPackage` 落盘与 `theme:open-file`（`isThemePackagePath`）均按 `.codedrobe-theme` 处理；磁盘上的内置包与用户导出包均为 `.codedrobe-theme`。
- 缺陷：`main.ts` 的 `theme:import`（L162）与 `theme:export`（L199）对话框 `filters` 的 `extensions` 为 `['agenttheme']`，**不含 `codedrobe-theme`**。
- 影响：macOS 下文件选择框按过滤器严格筛选，用户**无法选中 `.codedrobe-theme` 文件**（Windows 下可切「All Files」绕过，但非预期体验）；而 `.agenttheme` 并非 core 实际读写格式，即使选中也无法被 core 解析。
- 推荐修复（一行级，未执行）：将 `extensions` 改为 `['codedrobe-theme', 'agenttheme']`（与 `forge.config.ts` 中已注册的 UTType 扩展 `['agenttheme','codedrobe-theme']` 对齐）。可用 `themeExtension.replace(/^\./, '')` 派生避免硬编码。
- 未改原因：该改动触及「导入/安装入口体验」，属约束「不修改安装器体验」边界；且用户明确「等待下一步指令」。已识别并给出方案，待授权后实施。

### 风险 3 — `theme-installer.ts` 中 targets 硬编码（观察项，非 bug）
- `ThemeInstaller.buildBundle()` 将 targets 硬编码为 `['traework','qoderwork','workbuddy']`（当前 3 个 active adapter），未从 registry/adapter 列表派生。
- 影响：若未来新增/移除 active agent，需手动同步此处，否则内置主题的 target 集合会与运行时 adapter 不一致。
- 建议：作为后续改进项（不在本次稳定维护范围，且涉及架构，按约束不主动改）。

### 风险 4 — 真实 FS 并发编辑导致瞬时构建失败（流程风险）
- 本次执行期间，`FirstLaunch.tsx` 与其依赖 `progress.tsx` 正由并发 agent 写入；`npm run check` 在文件未就绪时短暂报 TS2307，文件就绪后复测绿。
- 影响：CI/本地连续构建若恰好撞上并发写入窗口，可能假性失败。
- 建议：稳定分支合并/构建前确保无并发写入；或构建门禁对「瞬时失败」做有限重试。

### 风险 5 — GUI 运行时验证（环境限制，非代码缺陷）
- 首屏渲染、重复启动幂等、真实用户导入（`theme:import` 选真实文件）为**代码级验证通过** + 待本机运行确认：
  - 首次启动自动安装：空库时 `installedIds` 为空 → `seedBuiltInThemes` 安装全部 3 个 ✅（代码确认）。
  - 已安装不重复：`installedIds`（来自 `library.summaries()`）过滤 → 二次启动跳过 ✅（代码确认）。
  - `installBytes`：`theme-library.ts` 保留且 IPC `theme:import-bytes` 已注册，测试覆盖 ✅。
  - 三条导入路径：`theme:import`→`importPackage`、`theme:import-path`→`importPackage`、`theme:import-bytes`→`installBytes` 均正确路由至 `ThemeLibrary` ✅（除风险 2 的对话框过滤问题）。
- 当前无显示环境，无法启动 GUI 做端到端确认；建议本机首次运行验证 Dashboard/Theme Center 展示 3 内置主题、二次启动无重装、用真实 `.codedrobe-theme` 走 `theme:import`。

---

## 审计确认摘要（4 项核心属性）

| 确认项 | 结论 | 证据 |
|---|---|---|
| 首次启动主题自动安装正常 | ✅ | `seedBuiltInThemes()` 在空库时安装全部 3 个；`getThemesDir()` 解析 `app.asar/themes` |
| 已安装主题不会重复安装 | ✅ | `installedIds` 过滤（`theme-seeder.ts:43`），幂等 |
| `installBytes` 正常工作 | ✅ | `theme-library.ts:188` 保留；`theme:import-bytes` 已注册；2 项测试通过 |
| 三条导入路径正常 | ✅（含 1 处对话框过滤风险） | `theme:import`/`theme:import-path`/`theme:import-bytes` 均正确路由；风险 2 为扩展名过滤不符 |

## 结论

- 主题系统生命周期稳定：System A 单一入口（main 进程），渲染进程零种子，bytes 通道保留为通用导入能力，无第三套系统，无架构漂移。
- 构建全绿：`npm run check` 0 错误 / 65 测试通过；`npm run package` 成功且 `app.asar` 含 `themes/`。
- 本轮**未修改、未删除任何文件**；发现 1 处真实缺陷（风险 2）与若干观察项，均记录待指令。
- 建议优先决策：是否授权修复风险 2（对话框扩展名过滤）。
