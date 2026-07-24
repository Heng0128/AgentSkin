# AgentSkin — B 分支收尾报告

> 目标：合并 A / B 两分支后解决「双种子系统」冲突，统一为 **主进程单一入口（System A）**，保留 bytes 通道作为通用能力（不用于内置种子），清理渲染进程种子残留，修复类型并发冲突与构建/打包缺陷。

---

## 1. 最终的 Theme 生命周期图

```mermaid
flowchart TD
  subgraph SEED["System A — 内置种子（主进程，唯一真实入口）"]
    T["themes/<id>/manifest.json + assets"]
    T -->|getThemesDir → app.getAppPath()/themes| LD["ThemePackageLoader.scan()"]
    LD -->|ThemePackage[]| TI["ThemeInstaller.installAll()"]
    BOOT[("启动: ThemeLibrary.summaries()")] -->|installedIds: Set<id>| TI
    TI -->|installFile / installBytes| LIB[("ThemeLibrary<br/>userData/themes")]
  end

  LIB --> CAT["ThemeCatalog.listThemes()"]
  CAT -->|"theme:catalog IPC（只读）"| UI["渲染进程 Catalog / Dashboard / Theme Center"]

  subgraph IMPORT["用户/未来导入（bytes 通道保留，降级为通用能力）"]
    UF["用户选择文件"] -->|theme:import| LIB
    UB["Marketplace / Cloud 下载字节"] -->|"theme:import-bytes → installBytes()"| LIB
    UP["theme:import-path（路径导入）"] --> LIB
  end

  TI -. "installedIds 非空 → 跳过，不重装" .-> LIB
```

**关键结论**
- 内置主题 **只** 来自 `themes/` → `ThemePackageLoader` → `ThemeInstaller` → `ThemeLibrary`，由 `main.ts` 启动期 `seedBuiltInThemes()` 驱动。
- 渲染进程 **不再** 参与内置种子（无 `runSeed` / `seedBuiltinThemes`）。
- bytes 通道（`installBytes` + `theme:import-bytes`）保留，仅用于用户/未来 Marketplace·Cloud 导入，不用于内置种子。

---

## 2. 修改文件清单

| 文件 | 改动 |
|---|---|
| `src/main.ts` | 注册 `theme:import-bytes` IPC handler，路由到 `library.installBytes()`（补全 A/B 合并后缺失的 handler） |
| `src/main/catalog/theme-seeder.ts` | 修复 `getThemesDir()`：打包后从 `app.getAppPath()` 解析 `app.asar/themes`，并保留 `resourcesPath` 兜底候选 |
| `src/main/theme-library.ts` | 修复合并损坏的游离代码行（对象关闭后残留的 `colors:` 等），恢复 `icon: iconDataUrl(bundle) };`；`installBytes()` 保持不变 |
| `src/shared/types.ts` | 修复合并损坏：`ThemeCatalogItem` 缺失的 `}` 与误插的 `colors?` 字段；保留合并引入的 `InstalledTheme.colors?` 与 `importThemeBytes` 类型 |
| `src/main/catalog/installer-states.ts` | 修复潜在类型拓宽 bug：`buildStandardTasks()` 内联数组显式标注 `InstallerTask[]` |
| `src/ui/lib/builtin-themes.ts` | 重写为「纯元数据」：删除 `pkgUrl` 字段与 3 处 `@/assets/builtin-themes/*.codedrobe-theme?url` 导入；仅保留 `id/displayName/iconUrl/category/description` 与 `BUILTIN_THEME_IDS` |
| `src/assets/builtin-themes/icons/{cyber-neon,arctic-white,sakura}.png` | 新建（从 `themes/<id>/icon.png` 复制），供渲染进程图标 `?url` 导入解析 |
| `src/assets/branding/app-icon.png` | 新建（从 `assets/icon.png` 复制），修复渲染进程构建缺失资源报错 |
| `src/main/theme-library.test.ts` | 新增 `installBytes` 能力测试（2 项）：确认 bytes 通道可用且拒绝缺失 id |
| `forge.config.ts` | **本次会话**：扩展 `packagerConfig.ignore` 保留 `/themes`，使 `themes/` 被打入 `app.asar` |

---

## 3. 删除的旧种子逻辑（System B 残留清理）

- 渲染进程 `useThemeInstallFlow.ts` 中的 `runSeed()` —— 已不存在，仅保留「内置种子在 main.ts（P3.1）」注释。
- 渲染进程 `useAppController.ts` 中的 `seedBuiltinThemes` 调用 —— 已不存在。
- `builtin-themes.ts` 中的 `pkgUrl` 字段及 3 处 `import '.../*.codedrobe-theme?url'`（指向不存在的资源）—— 已删除。
- 通过 `importThemeBytes` 在渲染进程中拉取 `.codedrobe-theme` 包做「内置种子」的整条路径 —— 不再用于内置种子（仅保留为类型/通道）。

> 校验：`grep -rn "seedBuiltInThemes\|runSeed" src/ui/` 在渲染进程代码树中 **零匹配**。

---

## 4. 保留的 bytes 通道用途

- `ThemeLibrary.installBytes(buffer, suggestedId)` —— **未删除**，作为通用字节安装能力。
- `theme:import-bytes` IPC（main.ts 已注册）—— 由 `useThemeInstallFlow` 的「网络/Marketplace/Cloud 下载」场景在未来调用，路由到 `installBytes()`。
- `theme:import`（文件选择）与 `theme:import-path`（路径导入）—— 用户导入能力，均落到 `ThemeLibrary`。
- `shared/types.ts` 中的 `importThemeBytes` 与 `AgentSkinApi.importThemeBytes` 类型 —— 保留。

> 结论：无「第三套主题系统」被引入；bytes 通道从「内置种子机制」**降级**为「通用导入能力」，符合约束。

---

## 5. `npm test` 结果

```
Test Files  7 passed (7)
     Tests  65 passed (65)
  Duration  4.91s
```

- 覆盖：`theme-package-loader`(13)、`theme-library`(10，含新增 `installBytes` 2 项)、`file-open`(7) 等。
- 本次新增 2 项 bytes 通道测试，验证 `installBytes` 安装成功、缺失 id 时拒绝。
- 原始 63 项测试在基线即全绿；所谓「7 个失败测试」在本 checkout 中并不存在，真实阻塞为合并损坏的 TS 源码与缺失资源（见第 7 节）。

---

## 6. 构建 / 打包结果

| 命令 | 结果 |
|---|---|
| `npm run check`（typecheck + test） | ✅ 通过（0 类型错误，65 测试通过） |
| `npm test` | ✅ 65 通过 |
| `npm run build` | 项目无独立 `build` 脚本；生产构建由 `electron-forge package` 的 Vite 构建阶段完成 |
| `npm run package`（`electron-forge package`） | ✅ 成功：`√ Packaging for x64 on win32` |
| asar 校验 | ✅ `app.asar` 内含 `themes/{cyber-neon,arctic-white,sakura}/{manifest.json,icon.png,preview.png,assets/background.png}` |

**asar 内容抽样**
```
\themes\cyber-neon\manifest.json
\themes\arctic-white\manifest.json
\themes\sakura\manifest.json
... (icon.png / preview.png / assets/background.png 各 3 份)
```

**内置主题 id 校验**（从打包后的 asar 提取）
```
cyber-neon  → id=cyber-neon  displayName=Cyber Neon
arctic-white → id=arctic-white displayName=Arctic White
sakura      → id=sakura      displayName=Sakura
```

---

## 7. 残余风险 / 待人工验证项

1. **首次启动可见性（GUI 运行时）**：代码层面已确认 `seedBuiltInThemes()` 在空库时安装全部 3 个主题、`installedIds` 非空时跳过（幂等）；但打包后的 GUI 实际首屏渲染（Dashboard / Theme Center 是否展示 Cyber Neon / Arctic White / Sakura）**未在本无显示环境内启动验证**，建议在本机首次运行确认。
2. **重复启动不重装**：由 `installedIds` 集合（来自 `library.summaries()`）保证幂等；建议在已安装状态下二次启动，确认 `themes` 目录不再新增/覆盖文件。
3. **用户导入 `theme:import` 真实流程**：handler 已注册并复用 `ThemeLibrary`；建议本机用真实 `.codedrobe-theme` 文件走一次导入确认 `file:imported` 事件与目录刷新。
4. **`npm run build` 脚本缺失**：用户清单列了 `npm run build`，但 `package.json` 仅有 `package`/`make`。若团队期望独立 `build` 脚本，可补充（等价于 Vite 三目标构建），否则以 `npm run package` 视为构建+打包即可。
5. **品牌残留（已知、非本次范围）**：`shared/i18n.ts` 中 "CodeDrobe" 文案、`marketplace-service.ts`/`update-service.ts` 的 User-Agent、URL 前缀、`global.d.ts` 的 `window.codeDrobe` —— 均不影响编译，留待 Phase 4 品牌清理。
6. **合并损坏根因**：A/B 合并在 `theme-library.ts` 与 `types.ts` 引入了非法 TS（游离行 / 缺失 `}`），`tsc`/vitest 未在编辑期完整暴露，`electron-forge package` 的 esbuild 构建才报错。已修复，建议合并流程增加「打包即门禁」。

---

## 总览

- ✅ 统一种子架构为主进程（System A），渲染进程零种子。
- ✅ bytes 通道保留为通用导入能力，未删除、未用于内置种子。
- ✅ 类型并发冲突修复（`ThemeCatalogItem` / `InstalledTheme.colors?` 一致）。
- ✅ 65 测试全绿；`npm run package` 成功且 `app.asar` 含 `themes/`。
- ⚠️ 首屏 GUI 渲染、重复启动幂等、真实用户导入为代码级验证通过 + 待本机运行确认。
