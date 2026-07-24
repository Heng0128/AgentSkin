# AgentSkin 产品体验优化 — 交付报告

日期：2026-07-21
范围：产品层优化（不修改主题核心生命周期、不动 @codedrobe/core、不动安装器/种子/ThemeLibrary）

## 1. 修改文件

| 文件 | 任务 | 改动 |
|---|---|---|
| `src/main/agent-engine-service.ts` | 任务 3（核心修复） | `apply()` 错误码匹配 `AGENTSKIN_RESTART_REQUIRED`→`CODEDROBE_RESTART_REQUIRED`、`AGENTSKIN_PORT_OCCUPIED`→`CODEDROBE_PORT_OCCUPIED`（L197/L206）。 |
| `src/ui/hooks/useThemes.ts` | 任务 1 + 任务 5 | `restoreApp` 提示改用规范名 `APP_META[appId].name`（原为引擎名 QoderWork/TRAE SOLO）；新增 `loading` 初始加载态。 |
| `src/shared/i18n.ts` | 任务 4 | `navThemes: '主题'` → `'主题中心'`（对齐 Theme Center）。 |
| `src/ui/components/app-mark.tsx` | 任务 2/5 | 官方 logo 加载失败时降级为中性字母占位（非 AgentSkin 品牌图标），满足「禁止默认图标」约束。 |
| `src/ui/components/themes/ThemeCard.tsx` | 任务 5 | `theme.icon` 覆盖图新增 onError 隐藏；修复 Source badge 死代码三元（原为 `=== 'local'`，在 `!== 'local'` 块内触发 TS2367），改为 `t.sourceCommunity`。 |
| `src/ui/pages/ThemesPage.tsx` | 任务 5 | 初始主题拉取期间显示 Spinner（消费 `controller.loading`）。 |

## 2. 新增文件
无。

## 3. 删除文件
无。

## 4. 风险
- **低**：错误码前缀修正使「已在运行 → 重启以应用」对话框现在对所有 Agent 生效（此前永不触发、直接抛原始报错）。这是预期行为修复，不改变引擎逻辑。
- **低**：`useThemes` 新增对 `@/components/app-mark` 的 import（hook→组件模块），经 tsc + 打包验证无循环依赖。
- **无**：未触碰 ThemeLibrary / installBytes / seed 机制 / @codedrobe/core / 主题格式 / 旧主题兼容 / 安装器，符合全部禁止项。
- 名称与图标统一已在上一轮完成并本轮复核未被并发编辑回退；Agent 官方名不在 i18n 中（catalog 规范字符串），TRAE Work CN / Qoder CN / WorkBuddy 不会被翻译。

## 5. 测试结果
- `npx tsc --noEmit`：**0 错误**。
- `npm run check`：**66/66 测试通过**（agent-catalog 11/11、theme-catalog 19/19、theme-library 10/10、file-open 7/7 等）。
- `npm run package`：**win32 x64 打包成功**。

## 任务 3 根因说明（为何 Qoder CN 此前像「需要改配置文件」）
@codedrobe/core 引擎在目标 Agent 已运行时抛出 `CODEDROBE_RESTART_REQUIRED`（原文："... is already running without CodeDrobe on port 9338. Close it or pass --restart-existing"）。AgentSkin 本应捕获该错误码并弹出中文「重启以应用」确认框，但 service 层匹配的是写错的 `AGENTSKIN_*` 前缀 —— 分支永远进不去，原始英文报错直接透传到 UI。Qoder 作为常驻 IDE，apply 时几乎总是「已运行」，因此用户稳定复现该报错；TRAE 多处于关闭/新拉起状态故看似正常。修正前缀后三者 apply/restore/status/theme switch 行为一致。
