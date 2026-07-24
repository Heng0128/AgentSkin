# AgentSkin Desktop 项目全面病历报告

> **审计时间**：2026-07-22 16:00
> **审计范围**：`desktop-main` 仓库全部源码（110 文件，~12,570 行）
> **审计原则**：严格、完整、基于可验证代码、禁止推测
> **版本**：v2.1.12

---

## 一、架构设计问题

### 1.1 🔴 严重：`useAppController` 成为巨型上帝对象

**文件**：`src/ui/hooks/useAppController.ts`（167 行）

`useAppController` 组合了 6 个领域 Hook（`useNotifications`、`useDialogs`、`useAgents`、`useThemes`、`useSettings`、`useThemeInstallFlow`），并通过展开运算符将所有属性平铺到一个返回对象中。

```typescript
// useAppController.ts 第 113-138 行
return {
  // Shared (12 fields)
  t, locale, setLocale, appVersion, booting, route, setRoute,
  activeAgentId, setActiveAgentId, status, busy, toasts, logs, logsOpen, setLogsOpen,
  // Themes (spread)
  ...themesHook,
  // Install flow (10 fields)
  installSteps, flowState, currentTheme, lastError,
  isInstalling, isComplete, isFailed, isCancelled, progress,
  retryInstall, cancelInstall, runImportWithProgress,
  setSteps, setFlowState,
  // Dialogs (spread)
  ...dialogs,
  // Settings (spread)
  ...settingsHook,
  // Wallpaper
  wallpaper,
};
```

**问题**：
- 返回对象超过 40 个字段，任何一个组件拿到 `controller` 就能调用几乎所有 API
- `useAppController` 本身不拥有任何业务逻辑，只是搬运工——但它搬运的太多
- 新增领域功能时必须修改此文件（违反开闭原则）
- 所有 Hook 的依赖通过 props 传入（如 `useThemes` 需要 `showToast`、`fail`、`busy`、`setStatus`），形成循环依赖式的紧耦合

**影响**：组件间隐式耦合加深，重构困难，测试 `useAppController` 需要 mock 全部 6 个子 Hook

**建议**：拆分为 `useSharedState` + `useThemeDomain` + `useSettingsDomain` + `useNotificationDomain`，组件按需组合

---

### 1.2 🟡 中等：`useEnvironments` 与 `useEnvironmentActions` 共享可变计数器

**文件**：`src/ui/hooks/useEnvironments.ts` + `src/ui/hooks/useEnvironmentActions.ts`

```typescript
// useEnvironmentActions.ts 第 45-46 行
let refreshCounter = 0;
export function getRefreshCounter(): number { return refreshCounter; }
```

**问题**：
- 模块级可变变量 `refreshCounter` 是 React 组件间通信的 hack
- 违反 React 单向数据流原则——两个独立 Hook 通过外部可变状态同步
- 如果未来有 HMR（热模块替换），计数器不会重置，导致状态不一致
- `useEnvironments` 通过 `useMemo(() => getRefreshCounter(), [getRefreshCounter()])` 监听变化——但 `getRefreshCounter` 引用不变，实际依赖的是 `refreshKey` 的值，这依赖于 React 对闭包引用的理解，容易出错

**影响**：HMR 场景下可能出现预设丢失或 UI 不同步

**建议**：改用 React Context 或 Zustand/Jotai 等轻量状态管理

---

### 1.3 🟡 中等：`APP_META` 与 `AGENT_META` 双重定义

**文件**：`src/ui/components/app-mark.tsx`（第 12-17 行） vs `src/shared/types.ts`（第 26-30 行）

```typescript
// app-mark.tsx — 重复定义
export const APP_META: Record<AgentId, { name: string; icon: string }> = {
  workbuddy: { name: AGENT_META.workbuddy.displayName, icon: workbuddyIcon },
  qoderwork: { name: AGENT_META.qoderwork.displayName, icon: qoderworkIcon },
  traework:  { name: AGENT_META.traework.displayName,  icon: traeworkIcon },
};

// shared/types.ts — 权威定义
export const AGENT_META: Readonly<Record<AgentId, AgentMeta>> = Object.freeze({
  traework:  { id: 'traework',  displayName: 'TRAE Work CN',  officialName: 'TRAE',      region: 'CN',            tier: 'active' },
  qoderwork: { id: 'qoderwork', displayName: 'QoderWork CN',  officialName: 'Qoder',     region: 'CN',            tier: 'active' },
  workbuddy: { id: 'workbuddy', displayName: 'WorkBuddy',     officialName: 'WorkBuddy', region: 'Global',        tier: 'active' },
});
```

**问题**：
- `APP_META` 的 `name` 字段来自 `AGENT_META.displayName`，但 `name` 语义与 `displayName` 重叠
- `APP_META` 额外持有图标路径（`icon: string`），而 `AGENT_META` 不持有——这是正确的（图标属于 UI 层），但命名暗示它是元数据而非 UI 资源
- `detail-panel.tsx` 第 114 行使用 `APP_META[appId]?.name` 作为 fallback，但 `AGENT_META` 已有 `displayName`

**影响**：低——当前无功能问题，但语义混乱

**建议**：重命名为 `APP_ICONS`，移除 `name` 字段，直接使用 `AGENT_META[appId].displayName`

---

### 1.4 🟢 轻微：`ThemeCatalog` 无缓存，每次调用重新扫描

**文件**：`src/main/catalog/theme-catalog.ts`（第 37-42 行）

```typescript
async listThemes(): Promise<ThemeCatalogItem[]> {
  const themes = await this.source.summaries();
  return themes.map((theme) => this.toItem(theme));
}
```

**问题**：
- 每次 UI 搜索/过滤都调用 `listThemes()`，每次都重新读取文件系统 + 转换
- `useThemeCenter` 在 `useMemo` 中调用 `controller.installed.map(toCard)`——`installed` 数组本身是响应式的，但 `ThemeCatalog` 层的重复转换在 IPC 往返中也存在
- 对于当前规模（12 个内置主题 + 少量用户导入）性能不是问题

**影响**：极低——当前规模下可忽略

**建议**：考虑在 `ThemeCatalog` 层加一层简单的内存缓存（变更时失效）

---

## 二、代码质量问题

### 2.1 🔴 严重：`installer-wizard.ts` 全是 TODO 占位符，生产不可用

**文件**：`src/main/installer/installer-wizard.ts`（119 行）

```typescript
// 第 59-61 行 — 环境检查：空
await runStep(0, async () => {
  // TODO: 检查磁盘空间、OS 版本、权限等
});

// 第 64-66 行 — 验证安装包：空
await runStep(1, async () => {
  // TODO: 校验 buildDir 下文件完整性
});

// 第 76-78 行 — 复制程序：空
await runStep(3, async () => {
  // TODO: 将 buildDir 内容复制到 installDir
});

// 第 82-84 行 — 安装主题：空
await runStep(4, async () => {
  // TODO: 将内置主题复制到用户数据目录
});

// 第 87-89 行 — 注册组件：空
await runStep(5, async () => {
  // TODO: 注册文件关联、协议处理等
});

// 第 92-94 行 — 创建快捷方式：空
await runStep(6, async () => {
  // TODO: 创建桌面/开始菜单快捷方式
});

// 第 97-99 行 — 清理临时：空
await runStep(7, async () => {
  // TODO: 清理 buildDir 临时文件
});
```

**问题**：
- 9 个安装步骤中，只有 2 个有实际实现（创建目录、完成安装），其余 7 个全是 `TODO`
- 这个模块从未被 `main.ts` 或其他任何地方引用——是死代码
- 但存在于 `src/main/installer/index.ts` 的导出中，暗示它应该是生产代码的一部分

**风险评估**：
- 当前安装由 NSIS/Inno Setup 完成，这个模块是"计划中的 Electron 内置安装器"
- 如果迁移到 Inno Setup 后此模块仍未实现，则它是纯粹的死代码
- 如果计划保留它作为"应用内安装器"（替代 NSIS），则需要补全

**建议**：
- 如果不再需要 Electron 内置安装器 → 删除整个 `src/main/installer/` 目录
- 如果需要 → 标注为 `@deprecated` 或补全实现

---

### 2.2 🟡 中等：`QuickActions` 组件已标记 `@deprecated` 但仍被导出

**文件**：`src/ui/components/dashboard/QuickActions.tsx`（第 1 行）

```tsx
// @deprecated Migration residue (P2). Do not use in new code.
```

**问题**：
- 文件存在但无调用方（`WorkspacePage` 使用 `WorkspaceQuickActions`，非 `QuickActions`）
- 仍从 `src/ui/components/dashboard/` 目录导出
- 增加了维护负担（废弃代码也是代码）

**建议**：删除或移至 `__deprecated__/` 目录

---

### 2.3 🟡 中等：`friendlyMessage` 错误映射过于粗糙

**文件**：`src/ui/hooks/useNotifications.ts`（第 18-47 行）

```typescript
// 第 32-33 行 — 端口占用只显示通用错误
if (/port|端口|占用/.test(cleaned)) {
  return t.actionFailed;  // ← 丢失了具体信息！
}
```

**问题**：
- `agent-engine-service.ts` 已经提供了友好的 `portOccupiedMessage(port)`（第 375-383 行）
- 但 `friendlyMessage` 把端口相关的错误消息又替换成了通用的 `t.actionFailed`
- 这意味着如果 `applyTheme` 的异常消息恰好包含 "port" 字样，用户看到的会是"操作失败"而不是"端口被占用"

**影响**：中等——端口占用时用户得不到有价值的指引

**建议**：保留原始错误消息，或映射到更具体的友好消息

---

### 2.4 🟡 中等：`useThemeInstallFlow` 的进度计算不精确

**文件**：`src/ui/hooks/useThemeInstallFlow.ts`（第 62-68 行）

```typescript
function getProgress(steps: InstallStep[]): number {
  const total = steps.length;
  if (total === 0) return 0;
  const done = steps.filter((s) => s.status === 'done').length;
  const active = steps.some((s) => s.status === 'active') ? 0.5 : 0;
  return Math.round(((done + active) / total) * 100);
}
```

**问题**：
- 每个步骤权重相等（线性进度），但实际步骤耗时差异巨大
  - "读取清单"：~50ms
  - "复制资源"：可能 ~5s（大主题包）
  - "注册主题"：可能 ~2s
- 进度条会在最后一步（"完成"）之前突然跳到 85%，然后停留很久

**影响**：低——用户能理解，但体验不够好

**建议**：为每个步骤分配权重（如 `read: 5%, validate: 10%, copy: 40%, register: 30%, done: 15%`）

---

### 2.5 🟢 轻微：`theme-manifest.ts` 中 `ThemeBackgroundAssets` 已标记 `@deprecated` 但仍被解析

**文件**：`src/main/catalog/theme-manifest.ts`（第 32-43 行）

```typescript
/**
 * @deprecated Per-resolution background variants are NOT consumed by the
 * AgentSkin pipeline...
 */
export interface ThemeBackgroundAssets { ... }
```

**问题**：
- 类型定义存在但无人消费
- `theme-package-loader.ts` 第 153-173 行仍然对 `assets.background` 做路径安全检查并警告

**建议**：在 `theme-package-loader` 中完全跳过 `assets.background` 校验，或在 manifest 解析时静默忽略

---

### 2.6 🟢 轻微：CSS 动画定义过多，部分可能未被使用

**文件**：`src/ui/globals.css`（第 128-206 行）

定义了 10+ 个 `@keyframes`，其中：
- `agentskin-breathe` — 使用于 `EnvironmentCard` 的状态点
- `agentskin-page-enter` — 使用于路由切换
- `agentskin-progress` — 使用于 BootScreen 进度条
- `agentskin-boot-rise/pop/float/orbit/aurora-a/b/c/gradient-flow/exit` — 全部使用于 BootScreen
- `agentskin-float` — BootScreen Logo 浮动

**问题**：
- 所有动画都在 `@theme` 块中注册为 Tailwind `animate-*` utility
- BootScreen 动画（7 个）只在启动时短暂显示，但动画定义常驻 CSS bundle
- 对于 12MB+ 的 Electron 应用，CSS 体积不是问题，但增加了维护复杂度

**建议**：无紧急行动——当前规模可接受

---

### 2.7 🟡 中等：`EnvironmentCard` 的 `aria-label` 错误

**文件**：`src/ui/components/workspace/EnvironmentCard.tsx`（第 93 行）

```tsx
<div
  className={...}
  onClick={onClick}
  role={onClick ? 'button' : undefined}
  tabIndex={onClick ? 0 : undefined}
  onKeyDown={...}
  aria-label={t.environmentDelete}  // ← 永远是"删除"！
>
```

**问题**：
- `aria-label` 硬编码为 `t.environmentDelete`（"删除"），但卡片的功能是"切换环境"
- 屏幕阅读器会朗读"删除"，与实际行为不符
- 应该使用环境的名称或 `t.continueWorking`

**影响**：中等——无障碍体验差

**建议**：改为 `aria-label={env.name}` 或移除 `aria-label`（文本内容已足够）

---

### 2.8 🟢 轻微：`RenameDialog` 未使用 shadcn Dialog 组件

**文件**：`src/ui/components/rename-dialog.tsx`（45 行）

**问题**：
- 项目使用了 shadcn 的 `Dialog` 组件（`src/ui/components/ui/dialog.tsx`，134 行）
- 但 `RenameDialog` 手动实现了一个简陋的模态框（`fixed inset-0 z-50 flex items-center justify-center bg-black/40`）
- 缺少焦点管理、ESC 关闭（虽然有但没通过 Dialog 组件）、`trapFocus` 等无障碍特性

**建议**：迁移到 shadcn `Dialog` 组件

---

## 三、安全问题

### 3.1 🟡 中等：`install-detection.ts` 执行 PowerShell 脚本

**文件**：`src/main/install-detection.ts`（第 140-148 行）

```typescript
function buildRegistryScript(names: string[]): string {
  const nameArray = names.map((n) => "'" + n.replace(/'/g, "''") + "'").join(',');
  // ...
}
```

**问题**：
- PowerShell 脚本通过 `execFile` 执行，参数来自适配器硬编码的 `registryNames`
- 当前所有适配器的 `registryNames` 是常量（`['Trae']`、`['QoderWork CN']` 等），不受用户输入影响
- 但如果未来 `registryNames` 来自用户配置或主题包，可能存在注入风险

**当前风险**：低——所有输入都是硬编码常量

**建议**：保持当前设计（常量），在文档中标注"不可配置"

---

### 3.2 🟢 轻微：`theme-package-loader.ts` 路径遍历检查不完整

**文件**：`src/main/catalog/theme-package-loader.ts`（第 91-96 行）

```typescript
const resolved = path.resolve(cssPath);
if (!resolved.startsWith(path.resolve(packagePath))) {
  throw new ThemePackageValidationError(...);
}
```

**问题**：
- 检查了 CSS 路径不逃逸包根目录
- 但没有检查 `icon`、`preview`、`hero` 路径的相对性（虽然 `load()` 方法中对 `icon` 和 `preview` 做了 `fs.access` 检查，但对 `hero` 的路径遍历检查是独立的）
- `validateBackgroundAssets` 对 `background` 字段做了路径遍历检查

**当前风险**：低——`fs.access` 和 `path.resolve` 组合检查基本覆盖

---

### 3.3 🟡 中等：`ipcMain` 处理器缺乏深度输入校验

**文件**：`src/main.ts`（第 148-280 行）

```typescript
// 第 200-203 行
ipcMain.handle('theme:apply', async (_event, request: ApplyRequest) => {
  if (!request || !isAgentId(request.appId) || typeof request.themeId !== 'string') {
    throw new Error('Invalid apply request.');
  }
```

**问题**：
- `request.restartExisting` 未校验类型——虽然 TypeScript 类型是 `boolean | undefined`，但 IPC 传输可能绕过类型检查
- `settings:set-app-port` 的 `port` 参数校验了范围但没校验 `null` 时的行为（虽然代码中处理了）
- `wallpaper:set` 的 `next` 参数只做了 `?? {}` 默认值，没有校验 `enabled` 和 `id` 的类型

**建议**：对所有 IPC 参数做防御性校验，特别是 `wallpaper:set` 和 `theme:apply`

---

## 四、测试覆盖问题

### 4.1 🔴 严重：测试覆盖率估计低于 20%

| 测试文件 | 行数 | 覆盖模块 |
|----------|------|---------|
| `agent-catalog.test.ts` | 110 | AgentCatalog（部分） |
| `theme-catalog.test.ts` | 163 | ThemeCatalog（部分） |
| `theme-package-loader.test.ts` | 251 | ThemePackageLoader（部分） |
| `theme-seed-pipeline.test.ts` | 257 | ThemeSeeder（部分） |
| `agent-scheme.test.ts` | 181 | agent-scheme（部分） |
| `file-open.test.ts` | 68 | FileOpenQueue（部分） |
| `locale-preferences.test.ts` | 33 | LocalePreferences（部分） |
| `theme-library.test.ts` | 223 | ThemeLibrary（部分） |
| `i18n.test.ts` | 27 | i18n（部分） |
| **合计** | **1,313** | **~5,000 行核心代码** |

**缺失测试的关键模块**：
- `agent-engine-service.ts`（481 行）— 核心编排服务，**零测试**
- `install-detection.ts`（310 行）— Windows 安装检测，**零测试**
- `theme-library.ts`（336 行）— 主题包管理，**有测试但不完整**
- `theme-installer.ts`（253 行）— 主题安装器，**零测试**
- `wallpaper-service.ts`（285 行）— 动态壁纸服务，**零测试**
- `codedrobe-core-runtime.ts`（217 行）— 核心运行时封装，**零测试**
- `agent-scheme.ts`（228 行）— 亮暗色同步，**有测试**
- `install-detection.ts`（310 行）— 安装检测，**零测试**
- 所有 UI Hook（`useAppController`、`useThemes`、`useEnvironments`、`useEnvironmentActions`、`useThemeInstallFlow`）— **零测试**
- 所有 UI 组件 — **零测试**

**建议**：
1. 优先为 `agent-engine-service.ts` 编写单元测试（mock `@codedrobe/core`）
2. 为 `useAppController` 编写集成测试
3. 为 `install-detection.ts` 编写 Windows 专用测试（或抽象为可测试接口）

---

## 五、依赖与构建问题

### 5.1 🟡 中等：`@codedrobe/core` 锁定在 `0.6.0`，无版本范围

**文件**：`package.json`（第 29 行）

```json
"@codedrobe/core": "0.6.0"
```

**问题**：
- 使用精确版本号而非 `^0.6.0` 或 `~0.6.0`
- 优点：构建可重现
- 缺点：`@codedrobe/core` 的安全更新/bug 修复不会自动拉取，每次升级需要手动改版本号
- 如果 `@codedrobe/core` 是私有包或 monorepo 内的包，精确版本是合理的；如果是 npm 公共包，建议使用 `^`

**建议**：确认 `@codedrobe/core` 的来源。如果是公共 npm 包，改为 `^0.6.0`

---

### 5.2 🟡 中等：`electron-builder` 与 `@electron-forge/maker-wix` 并存

**文件**：`forge.config.ts`（第 50-54 行）+ `electron-builder.yml`

**问题**：
- Electron Forge 通过 `MakerWix` 构建 MSI 安装包
- `electron-builder` 通过 `npm run make:windows:installers` 构建 NSIS 安装包
- 两个构建系统同时存在，职责重叠
- `electron-builder.yml` 的 `nsis.include` 指向 `build/installer.nsh`，但 NSIS 构建完全绕过 Forge

**影响**：
- 构建流程分裂：Forge 管 macOS + Windows MSI，electron-builder 管 Windows NSIS
- 维护两套打包配置

**建议**：
- 迁移到 Inno Setup 后，考虑统一使用 Forge + Inno Setup 插件，或完全迁移到 electron-builder
- 至少将 `electron-builder.yml` 中的 NSIS 配置合并到 Forge 配置中

---

### 5.3 🟢 轻微：`sharp` 依赖可能不必要

**文件**：`package.json`（第 28 行）

**问题**：
- `sharp` 用于图像处理和缩略图生成
- 当前项目中只有 `theme-installer.ts` 读取图片资产并转为 base64，未使用 sharp
- 搜索代码库未找到 `sharp` 的 import 语句

**建议**：确认 `sharp` 是否仍在使用。如果未使用，可移除以减小安装体积

---

### 5.4 🟡 中等：NSIS 和 Inno Setup 安装器均未数字签名

**文件**：`build/installer.nsh` + `build/inno/agentskin.iss`

**问题**：
- 如前置探查报告所述，整个代码库无 Windows 签名配置
- 用户下载的 `.exe` 安装包会被 SmartScreen 标记为"未知发布者"
- 与 macOS 的完整签名流程（P12 证书 + Notarization）形成鲜明对比

**影响**：高——影响用户信任度和下载转化率

**建议**：迁移到 Inno Setup 时同步加入代码签名配置

---

## 六、UI/UX 问题

### 6.1 🔴 严重：`EnvironmentCard` 可点击但 `aria-label` 错误（见 2.7）

### 6.2 🟡 中等：`BootScreen` 动画可能引起晕动症

**文件**：`src/ui/components/boot-screen.tsx`（72 行）

**问题**：
- 启动画面包含 7 种动画：aurora 漂移（3 个）、logo 弹出、旋转光环、浮动、渐变流动、上升
- 这些动画在 500ms 内密集播放
- 虽然 `globals.css` 中有 `prefers-reduced-motion` 媒体查询（第 256-262 行），但动画通过 Tailwind 的 `animate-*` 类名应用，需要额外配置才能被 `prefers-reduced-motion` 正确拦截

**影响**：低——少数用户可能受影响

**建议**：确认 `prefers-reduced-motion` 是否正确作用于所有 `animate-*` 工具类

---

### 6.3 🟡 中等：`detail-panel.tsx` 中"应用到所有"按钮可能引发意外

**文件**：`src/ui/components/detail-panel.tsx`（第 44-51 行）

```tsx
<Button
  className="w-full"
  disabled={pendingAll || controller.busy !== null || eligibleApps.length === 0}
  onClick={() => void runAll()}
>
  {t.applyToAllAgents}
  {eligibleApps.length > 0 && (
    <span className="ml-1 text-xs opacity-70">({eligibleApps.length})</span>
  )}
</Button>
```

**问题**：
- "应用到所有 Agent" 按钮没有二次确认
- 如果用户误点，三个 Agent 会同时被应用主题
- 对于 `restartExisting: false` 的情况（正常 apply），同时应用三个主题是安全的
- 但对于 `restartExisting: true` 的情况（需要重启），同时触发三次重启可能有问题

**影响**：低——当前 `runAll()` 使用串行 `for` 循环，但无确认

**建议**：添加确认对话框或至少在按钮上加提示文字

---

### 6.4 🟢 轻微：`ThemesPage` 的分类筛选器使用原生 `<select>` 混合自定义按钮

**文件**：`src/ui/pages/ThemesPage.tsx`（第 82-92 行）

**问题**：
- 分类筛选使用自定义按钮（Apple-style segmented control）
- 排序使用原生 `<select>` 元素
- 风格不一致

**建议**：统一为自定义下拉组件或使用 shadcn 的 `Select` 组件

---

### 6.5 🟢 轻微：`InstallWizard` 使用硬编码的 `appIcon` 路径

**文件**：`src/ui/components/install-progress.tsx`（第 19 行）

```typescript
import appIcon from '../../../assets/branding/app-icon.png';
```

**问题**：
- 相对路径 `../../../assets/branding/app-icon.png` 脆弱——如果组件移动，路径会断
- 应使用别名 `@/assets/branding/app-icon.png` 或从 `@shared` 导入

---

## 七、国际化问题

### 7.1 🟡 中等：`i18n.ts` 超过 595 行，单文件承载全部翻译

**文件**：`src/shared/i18n.ts`

**问题**：
- 所有翻译字符串在一个文件中，中英文混排
- 新增翻译需要编辑同一个文件，合并冲突风险高
- 无法按模块/页面拆分翻译

**影响**：低——当前翻译条目约 200 条，尚 manageable

**建议**：按模块拆分（`i18n/workspace.ts`、`i18n/themes.ts`、`i18n/settings.ts`）

---

### 7.2 🟢 轻微：`categoryLabel` 函数硬编码了部分分类标签

**文件**：`src/shared/i18n.ts`（第 208-225 行）

```typescript
categoryLabel: (slug: string) => {
  const labels: Record<string, string> = {
    cyberpunk: '赛博朋克',
    minimal: '极简',
    anime: '动漫',
    naruto: '火影忍者',
    genshin: '原神',
    wuthering: '鸣潮',
    deepspace: '恋与深空',
    nature: '自然',
    retro: '复古',
    professional: '专业',
    creative: '创意',
    dark: '暗色',
    light: '浅色',
    art: '艺术',
  };
  return labels[slug] ?? slug;
},
```

**问题**：
- 分类 slug（`naruto`、`genshin`、`wuthering`、`deepspace`）是特定主题的硬编码值
- 如果新增分类，需要同时修改中英文两个 `categoryLabel` 函数
- 这些 slug 不是通用分类，而是具体 IP 名称——它们不应该出现在分类系统中

**建议**：将 IP 相关 slug 移出分类系统，或改为主题级别的标签

---

## 八、安装器问题

### 8.1 🟡 中等：NSIS 安装器仅记录日志，无实际功能

**文件**：`build/installer.nsh`（158 行）

**问题**：
- `customInit`、`customInstall`、`customUnInstall` 宏中所有操作都是 `DetailPrint` 和日志记录
- 实际的解压、注册表写入、快捷方式创建由 electron-builder 的 NSIS 模板自动处理
- `installer.nsh` 的唯一价值是增强日志输出

**影响**：低——功能正确，但代码意图不清晰

---

### 8.2 🟡 中等：Inno Setup 安装器引用不存在的资源文件

**文件**：`build/inno/agentskin.iss`（第 23-24 行）

```ini
SetupIconFile=..\..\resources\icon.ico
WizardImageFile=..\..\resources\installer-sidebar.bmp
WizardSmallImageFile=..\..\resources\installer-header.bmp
```

**问题**：
- 路径引用 `resources/` 目录，但该目录不存在
- 编译时会报错或缺省使用默认图标
- 与 NSIS 安装器使用的 `assets/branding/` 路径不一致

**建议**：修正路径为 `assets/branding/` 或创建 `resources/` 目录

---

### 8.3 🟢 轻微：`build-installer.bat` 硬编码 Node.js 路径

**文件**：`build-installer.bat`（第 47 行）

```bat
set "PATH=C:\Users\snowb\AppData\Local\nvm\v22.18.0;%PATH%"
```

**问题**：
- 路径包含用户名 `snowb`，不可移植
- 其他开发者无法直接运行此脚本

**建议**：使用 `nvm` 或 `volta` 等工具管理 Node.js 版本

---

## 九、主题系统问题

### 9.1 🟡 中等：`ThemeInstaller.buildBundle()` 为每个主题生成临时文件

**文件**：`src/main/catalog/theme-installer.ts`（第 103-119 行）

```typescript
const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-theme-'));
const tmpFile = path.join(tmpDir, `${manifest.id}.codedrobe-theme`);
await fs.writeFile(tmpFile, JSON.stringify(bundle), 'utf8');
try {
  const installed = await this.library.installFile(tmpFile);
  ...
} finally {
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
}
```

**问题**：
- 每个主题安装都创建临时目录 + 写入 JSON 文件 + 删除
- 12 个内置主题 = 12 次 mkdtemp/write/rm 操作
- 如果某个主题安装失败，`finally` 块中的 `catch(() => {})` 会吞掉清理错误

**建议**：考虑直接在内存中构建 `.codedrobe-theme` JSON 并通过 `library.installBytes()` 安装（如果支持）

---

### 9.2 🟢 轻微：`toInstalledTheme()` 对 `copy` 字段的提取逻辑复杂

**文件**：`src/main/theme-library.ts`（第 70-107 行）

```typescript
const copy = (bundle.theme.copy ?? null) as Record<string, unknown> | null;
const themeMeta = bundle.theme as unknown as Record<string, unknown>;
const pick = (key: string): unknown => {
  if (copy && key in copy) return copy[key];
  return themeMeta[key];
};
```

**问题**：
- `copy` 字段是引擎安全的自由表单记录，`themeMeta` 是旧版顶层字段
- `pick()` 函数优先从 `copy` 读取，回退到 `themeMeta`
- 这种双重来源逻辑增加了理解成本

**建议**：添加注释说明 `copy` vs `themeMeta` 的使用场景

---

## 十、IPC/API 设计问题

### 10.1 🟡 中等：`AgentSkinApi` 接口过度暴露

**文件**：`src/shared/types.ts`（第 276-313 行）

```typescript
export interface AgentSkinApi {
  getBootstrap(): Promise<BootstrapData>;
  setLocale(locale: AppLocale): Promise<void>;
  refreshStatus(): Promise<SystemStatus>;
  applyTheme(request: ApplyRequest): Promise<ApplyResponse>;
  restoreApp(appId: AgentId): Promise<SystemStatus>;
  importTheme(): Promise<DialogResult>;
  importThemeFromPath(path: string): Promise<FileImportResult>;
  importThemeBytes(bytes: Uint8Array, suggestedId: string): Promise<FileImportResult>;
  openThemeFile(path: string): Promise<void>;
  getPathForFile(file: File): string;
  exportTheme(themeId: string): Promise<DialogResult>;
  deleteTheme(themeId: string): Promise<DeleteThemeResult>;
  catalog: { agents: {...}; themes: {...} };
  getSettings(): Promise<DesktopSettings>;
  pickAppPath(appId: AgentId): Promise<...>;
  clearAppPath(appId: AgentId): Promise<...>;
  setAppPort(appId: AgentId, port: number | null): Promise<...>;
  listWallpapers(): Promise<WallpaperInfo[]>;
  setWallpaper(settings: WallpaperSettings): Promise<DesktopSettings>;
  importWallpaper(): Promise<WallpaperInfo[]>;
  showInFolder(path: string): Promise<void>;
  onRuntimeLog(listener: ...): () => void;
  onFileImported(listener: ...): () => void;
  onFileImportConfirm(listener: ...): () => void;
  onFileImportFailed(listener: ...): () => void;
  onTrayApply(listener: ...): () => void;
}
```

**问题**：
- 30+ 个方法，几乎全部暴露给渲染进程
- 渲染进程可以直接调用 `importThemeBytes`（从网络下载的主题包）
- 虽然 `contextBridge` 限制了直接访问 Node.js API，但 IPC 通道本身没有权限分级

**影响**：低——渲染进程本身已无 Node.js 访问权限，但 API 面过大增加了意外调用的风险

**建议**：考虑按权限域分组（`themeOps`、`settingsOps`、`systemOps`）

---

### 10.2 🟢 轻微：`preload.ts` 中 `subscribe` 函数未暴露取消方法的类型

**文件**：`src/preload.ts`（第 10-13 行）

```typescript
function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => listener(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}
```

**问题**：
- `subscribe` 返回取消函数，但 `AgentSkinApi` 中监听方法的返回类型是 `() => void`
- 这是正确的——但 `subscribe` 是私有函数，没有类型注解

**建议**：添加显式类型注解以提高可读性

---

## 十一、配置与脚本问题

### 11.1 🟡 中等：`forge.config.ts` 中 Deep Links 被注释掉

**文件**：`forge.config.ts`（第 36-37 行）

```typescript
// Deep links removed for offline/local-only version.
// macOS file associations: double-clicking a theme package opens AgentSkin
```

**问题**：
- Deep Links 被注释掉但代码仍在
- 注释暗示这是一个"离线/本地版本"的配置
- 如果这是正式发布的配置，Deep Links 应该在 CI/CD 中通过环境变量控制

**建议**：将 Deep Links 配置移到条件分支中，或通过环境变量控制

---

### 11.2 🟢 轻微：`scripts/` 目录中大量修复脚本残留

**文件**：`scripts/` 目录

**问题**：
- 存在 `fix_theme_installer.py`、`fix_theme_installer_v2.py`、`fix_use_environments.py`、`fix_i18n.js` 等多轮修复脚本
- 这些脚本是迭代过程中的补丁，不应长期保留
- 增加了目录噪音

**建议**：评估是否可以清理或删除

---

### 11.3 🟢 轻微：`tsconfig.json` 缺失

**文件**：项目根目录

**问题**：
- 搜索未找到 `tsconfig.json`
- 但 `package.json` 中有 `tsc --noEmit` 命令和 `typecheck` 脚本
- TypeScript 可能使用隐式配置或 `vite` 内置的 TypeScript 支持

**建议**：确认 `tsconfig.json` 是否存在于 `.gitignore` 中或被忽略

---

## 十二、可以省略/简化的部分

### 12.1 ✅ 可删除：`src/main/installer/` 目录（如果不再需要 Electron 内置安装器）

- `installer-wizard.ts`：119 行，7 个 TODO，未使用
- `installer/types.ts`：44 行，定义安装步骤类型
- `installer/index.ts`：5 行，导出

**总计**：168 行死代码

---

### 12.2 ✅ 可删除：`src/ui/components/dashboard/QuickActions.tsx`

- 已标记 `@deprecated`
- 无调用方
- 16 行

---

### 12.3 ✅ 可简化：`useAppController` 中的 `busy` 状态

**文件**：`src/ui/hooks/useAppController.ts`（第 30 行）

```typescript
const [busy, setBusy] = useState<string | null>(null);
```

**问题**：
- `busy` 被用作全局忙状态，但实际使用方式是 `busy: 'apply:themeId'`、`busy: 'restore:appId'`、`busy: 'import'` 等
- 多个 Hook 读写同一个 `busy` 状态，容易冲突
- 可以考虑拆分为 per-operation 的忙状态

**建议**：改为 `Map<operationType, boolean>` 或 per-hook 忙状态

---

### 12.4 ✅ 可简化：`ThemeCatalog` 的 `getTheme()` 方法

**文件**：`src/main/catalog/theme-catalog.ts`（第 45-48 行）

```typescript
async getTheme(id: string): Promise<ThemeCatalogItem | null> {
  const themes = await this.listThemes();  // ← 重新扫描全部主题
  return themes.find((t) => t.id === id) ?? null;
}
```

**问题**：
- `getTheme(id)` 调用 `listThemes()` 获取全部主题再查找
- 对于单个主题查询，效率低

**建议**：改为 `summaries()` 返回 Map 或单独查询

---

### 12.5 ✅ 可简化：`globals.css` 中的 `chart-*` 颜色变量

**文件**：`src/ui/globals.css`（第 25-29 行）

```css
--chart-1: #7c3aed;
--chart-2: #16a66a;
--chart-3: #b45309;
--chart-4: #0284c7;
--chart-5: #db2777;
```

**问题**：
- 项目中没有图表组件
- `semanticColors` 中引用了 `--chart-*` 但无实际使用

**建议**：如无图表需求，移除这些变量

---

## 十三、项目成熟度总评

| 维度 | 评分 | 说明 |
|------|------|------|
| **架构设计** | ⭐⭐⭐⭐⭐ | 分层清晰，适配器模式优秀，核心运行时隔离 |
| **代码质量** | ⭐⭐⭐ | 大量 TODO 占位符、废弃代码未清理、部分逻辑可简化 |
| **测试覆盖** | ⭐⭐ | 核心模块零测试，UI 层零测试 |
| **文档完整性** | ⭐⭐⭐⭐ | 代码注释详尽，README 完整 |
| **安全性** | ⭐⭐⭐⭐ | 上下文隔离到位，输入校验基本充分 |
| **可维护性** | ⭐⭐⭐ | 死代码待清理，`useAppController` 过重 |
| **可扩展性** | ⭐⭐⭐⭐⭐ | 适配器注册表、Catalog 接口预留扩展 |
| **用户体验** | ⭐⭐⭐⭐ | 动画精美，但无障碍细节需改进 |
| **安装/部署** | ⭐⭐⭐ | Windows 无签名，NSIS/Forge 双构建系统分裂 |

**综合评级**：⭐⭐⭐½ (3.5/5)

---

## 十四、行动优先级建议

### P0（立即处理）
1. 删除 `src/main/installer/` 目录（如果不需要 Electron 内置安装器）
2. 修复 `EnvironmentCard` 的 `aria-label` 无障碍问题
3. 为 `agent-engine-service.ts` 补充核心测试

### P1（下一迭代）
4. 拆分 `useAppController` 减少耦合
5. 修复 `RenameDialog` 使用 shadcn Dialog
6. 修复 `friendlyMessage` 端口错误映射
7. 统一 `ThemesPage` 排序控件风格

### P2（中期改进）
8. 清理 `scripts/` 中的修复脚本
9. 拆分 `i18n.ts` 为模块化文件
10. 统一 NSIS/Inno Setup 构建系统
11. 添加 Windows 代码签名

### P3（长期）
12. 为 UI 组件补充 E2E 测试
13. 评估 `sharp` 是否仍然需要
14. 实现 `ThemeCatalog` 内存缓存
15. 将 `refreshCounter` 改为 React Context
