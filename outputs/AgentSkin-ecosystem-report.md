# AgentSkin 生态能力优化 — 交付报告

> 日期：2026-07-21
> 范围：让 AgentSkin 成为真正的「多 Agent 主题平台」（非换皮）
> 验证命令：`npm test`（vitest）、`npm run package`（electron-forge）、`tsc --noEmit`

---

## 一、验证结果（结论先行）

| 验证项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `tsc --noEmit` | ✅ 0 error |
| 单元测试 | `npm test` | ✅ 7 个文件 / 68 个用例全部通过（exit 0） |
| 打包 | `npm run package` | ✅ `PKG_EXIT: 0`，产物 `out/AgentSkin-win32-x64`（334 MB，`AgentSkin.exe` 204 MB） |
| 内置主题打包 | asar 校验 | ✅ 3 套主题 + 全套资源已打入 `app.asar` |

---

## 二、任务完成情况

### 任务 1 — 完善 Agent Catalog ✅
统一 `AgentDefinition`：`{ id, displayName, officialName, region, icon, adapter, capabilities }`。
交付的 4 个 Agent（active）：

| id | displayName | officialName | region | 图标 | coreId |
|---|---|---|---|---|---|
| `traework` | TRAE Work CN | TRAE | CN | traework.png | traework |
| `qoderwork` | Qoder CN | Qoder | CN | qoderwork.png | qoderwork |
| `qoder` | Qoder | Qoder | International | qoder.png | qoderwork（共用） |
| `workbuddy` | WorkBuddy | WorkBuddy | Global | workbuddy.png | workbuddy |

- ❌ 已杜绝禁用名：`TRAE SOLO`、`QoderWork`（原 `QoderWork CN` 已改为 `Qoder CN`）。
- 新增 **Qoder International** 真实 Adapter（`QoderInternationalAdapter`，coreId 复用 `qoderwork`），区别于 Qoder CN。
- 官方名（officialName）**不进入 i18n 翻译**，直接来自 catalog 元数据。

### 任务 2 — Agent 图标系统优化 ✅
- 每个 Agent 使用各自官方 Logo（`src/ui/assets/apps/{traework,qoderwork,qoder,workbuddy}.png`）。
- 新增 `qoder.png`（国际版 Logo）。
- `app-mark.tsx` 的 `APP_META` 已按 Agent 绑定对应图标，**不再全部回退到 AgentSkin app-icon**。
- 验证：渲染产物 `renderer/assets/` 内已包含 `qoder-*.png`、`workbuddy-*.png` 等各自图标。

### 任务 3 — Theme Package 规范优化（`.agenttheme`）✅
- 用户态格式扩展名 `.agenttheme` 已在 `src/legacy/codedrobe-core-runtime.ts` 定义（`agentThemeExtension`）。
- 目录规范（参考 Codex-Dream-Skin / workbuddy-skin-studio）：
  ```
  theme-name/
    manifest.json      # id, name, author, version, description, supportedAgents, preview
    preview.png
    icon.png
    assets/
      css/{agentId}.css   # v1 结构
      background...       # 可选
  ```
- 引擎契约（`@codedrobe/core` 的 `ThemePackage`）严格保持不变：
  - `format: "codedrobe-theme"`，`schemaVersion: 1`（字面量）。
  - `targets: Record<coreId, { css: string /*真实 CSS 内容*/, verification? }>`。
  - `theme: { id, displayName, version, copy? }`，扩展元数据全部走 `theme.copy`（引擎透传，不破坏契约）。
- v2 清单（`theme-manifest.ts`）：`isV2Manifest()` + `getSupportedAgents()`，支持 `targets` 内联 CSS 或 `assets/css/{agentId}.css` 两种来源。
- `theme-package-loader.ts`：校验 manifest、`author`、`category`、`tags`、`colors.background`、v2 `targets`、background 资源路径防逃逸（支持字符串与对象两种形式）。

### 任务 4 — Theme Center 优化 ✅
`useThemeCenter` 已具备：
- **搜索** `query`：匹配 name / tags / category（不区分大小写）。
- **支持 Agent 过滤** `selectedAgent`：`theme.supportedAgents.includes(...)`。
- **分类过滤** `selectedCategory`。
- **排序** `sortBy`：`name | author | category | version`，version 走 semver 数值比较；`ThemeCard` 展示 `v{version}`、`author`、`category` 徽章、支持的 Agent 图标组。
- 设计语言沿用既有 design system，未引入新视觉规范。

### 任务 5 — 内置主题优化 ✅
三套内置主题（`cyber-neon` / `arctic-white` / `sakura`）均确认：

| 主题 | preview.png | icon.png | supportedAgents | 每 Agent CSS |
|---|---|---|---|---|
| cyber-neon | 1200×630 / 261 KB | 54 KB | 4 个全 | traework/qoderwork/qoder/workbuddy |
| arctic-white | 1200×630 / 300 KB | 36 KB | 4 个全 | 同上 |
| sakura | 1200×630 / 356 KB | 43 KB | 4 个全 | 同上 |

- **无 1×1 placeholder**（均为真实 1200×630 预览图）。
- 安装/导入/导出链路：loader.scan → installer.installAll → `theme-library.toInstalledTheme` 已从 `theme.copy` 正确回读 `author/category/tags/license/unofficial/mode/colors/supportedAgents`。
- 安装链路测试通过（`theme-library.test.ts` 的 `importPackage` / `imports legacy packages by converting them`）。

---

## 三、变更文件清单

### 新增（New）
- `src/ui/assets/apps/qoder.png` — Qoder 国际版官方 Logo
- `themes/{cyber-neon,arctic-white,sakura}/assets/css/{qoder,qoderwork,traework,workbuddy}.css` — 每 Agent 独立 CSS（v1 资源结构）

### 修改（Modified）
- `src/shared/types.ts` — `AgentId` 联合类型与 `AGENT_IDS` 增加 `'qoder'`
- `src/main/catalog/agent-catalog.ts` — 修正 `Qoder CN` 显示名；新增 `qoder`（International）条目
- `src/main/agent-engine-service.ts` — `PRODUCT_DISPLAY_NAMES`：traework=TRAE Work CN / qoderwork=Qoder CN / qoder=Qoder / workbuddy=WorkBuddy
- `src/ui/components/app-mark.tsx` — 按 Agent 绑定官方 Logo；修正 `qoderwork` 名为 `Qoder CN`
- `src/adapters/domestic/qoder.ts` — 新增 `QoderInternationalAdapter`（coreId `qoderwork`）
- `src/adapters/registry.ts` — 注册 `QoderInternationalAdapter`
- `src/main/catalog/theme-installer.ts` — 重写 `buildBundle`：AgentId→coreId 映射、真实 CSS 内联、`theme.copy` 携带扩展元数据、`schemaVersion=1`
- `src/main/theme-library.ts` — `toInstalledTheme` 优先从 `theme.copy` 读取展示元数据
- `src/main/catalog/theme-package-loader.ts` — `validateTarget` 改为 async + `fs.access`；`validateBackgroundAssets` 支持裸字符串 background 并防路径逃逸
- `src/main/catalog/agent-catalog.test.ts` — 断言改为 `Qoder CN`
- `themes/{cyber-neon,arctic-white,sakura}/manifest.json` — `supportedAgents` 补齐 4 个 Agent + v2 `targets`
- `themes/{cyber-neon,arctic-white,sakura}/{preview.png,icon.png}` — 替换为真实预览/图标资源

### 删除（Deleted）
- 无（禁用显示名仅做改名，无文件删除）

---

## 四、风险与已知事项

1. **International 与 CN 共享引擎目标**：`qoder`（国际版）与 `qoderwork`（CN）共用 coreId `qoderwork`，因此主题在引擎层落到同一 targets 键。二者差异仅体现在 catalog 元数据（region/displayName）。这是 `@codedrobe/core` 仅有单一 `qoderwork` coreId 的约束所致，**设计上可接受**；Theme Center 仍可凭 `supportedAgents` 中的 `qoder` 单独筛选国际版。
2. **实验性 Adapter 不可换肤**：`codebuddy / marscode / comate / tongyi_lingma / tencent_ai_code` 的 `coreId` 为空，installer 会跳过（不生成 targets）。与既有架构一致，不影响本次交付。
3. **品牌残留（非阻塞）**：`shared/i18n.ts`、`update-service.ts`（User-Agent）、`global.d.ts`（`window.codeDrobe`）仍含历史 `CodeDrobe` 字样，不影响编译/运行，已记录待后续 Phase 4 品牌清理。
4. **打包产物形态**：`npm run package` 仅产出 `out/AgentSkin-win32-x64`（免安装目录）。`out/make/` 下的 `AgentSkin-2.1.0-x64-Setup.exe` 来自更早一次的 `npm run make`（electron-builder，时间戳 16:37），本次 `npm run package` **未重新生成安装包**。如需新安装包，请单独执行 `npm run make`。
5. **沙箱写入一致性**：本次所有源码改动均通过 Bash 内写入（python 脚本 / 直接读写）落盘，`tsc` 与 `vitest` 均已可见并验证通过；非仅 Edit 工具预览。

---

## 五、下一步建议
- 若需发布安装包：执行 `npm run make`（electron-builder，基于已生成的 `out/AgentSkin-win32-x64`）。
- 规划 `.agenttheme` 用户态导入/导出 UI（当前引擎层已支持，前台导入/导出入口可增强）。
- 推进实验性 Adapter 的 coreId 接入，使其进入可换肤范围。
