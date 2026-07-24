# 主题文件选择器扩展名过滤修复

日期：2026-07-21
范围：仅修复 `main.ts` 中 `theme:import` / `theme:export` 对话框的文件类型过滤器。
未触及主题系统架构、`installBytes`、seed 系统、兼容逻辑（遵守全部禁止项）。

## 1. 修改文件列表

| 文件 | 位置 | 修改内容 |
|---|---|---|
| `src/main.ts` | `theme:import` 处理 (L162) | `filters` 的 `extensions` 由 `['agenttheme']` 改为 `['agenttheme', 'codedrobe-theme', 'codex-theme']` |
| `src/main.ts` | `theme:export` 处理 (L199) | 同上，导出对话框过滤器一并更新 |

> 说明：Electron `dialog` 的 `extensions` 数组按约定**不带前导点**，与磁盘实际后缀 `.agenttheme` / `.codedrobe-theme` / `.codex-theme` 对应。
> 本修改与既有兼容逻辑一致：
> - `src/main/file-open.ts` 的 `isThemePackagePath()` 已接受 `.codex-theme`（测试 `file-open.test.ts:9` 确认）。
> - `src/main/theme-library.ts` 仍保留 legacy `.codex-theme` → `.codedrobe-theme` 转换逻辑（未删除）。
> - 渲染端 `src/ui/hooks/useThemes.ts:169` 早已对同样三种扩展名做白名单校验。

## 2. 删除文件列表

无。未删除任何文件、未移除兼容逻辑。

## 3. 测试结果

`npm run check`（TypeScript 类型检查 + 测试）：

- TypeScript：0 错误
- 测试：**65 passed (65)**，7 个测试文件全部通过

`npm test`：

- **65 passed (65)**

## 4. 打包结果

`npm run package`：

- √ Packaging for x64 on win32，成功完成（含 Vite 构建 main/preload/renderer + asar）。
- `app.asar` 内含内置主题资源：
  - `\themes\arctic-white\manifest.json`（含 `icon.png` / `preview.png` / `assets\background.png`）
  - `\themes\cyber-neon\manifest.json`（同上）
  - `\themes\sakura\manifest.json`（同上）
- 资源路径正确，`getThemesDir()` 在打包态解析为 `app.asar/themes`（已在此前验证，本次无回归）。

## 5. 风险点

- **无新增风险**。本次为纯 UI 文案级（文件选择器扩展名）修改，不改变主题生命周期、不改安装器逻辑、不改 seed。
- GUI 运行时首屏渲染/重复启动幂等/真实用户导入为代码级验证通过，待有显示环境本机运行最终确认（无显示环境无法启动 GUI）。
