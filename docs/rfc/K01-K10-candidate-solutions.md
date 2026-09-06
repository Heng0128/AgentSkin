# K-01 ~ K-10 锚定需求候选方案对比矩阵

> Architect 输出 | 2026-08-20 | 覆盖 10 个锚定需求，每需求 3-4 个候选方案

---

## 通用约束

- 所有方案遵循项目技术栈：React 19 + Zustand v5 + Electron + TypeScript + Biome + Vitest
- 不引入不可控第三方依赖
- 方案必须可分阶段实施、可自动化验证、可安全回滚
- 间距遵循 Tailwind 标准档（C6 不变量）
- 新增文件遵守 §8 路径卫生规范

---

## K-01: window-manager.ts 窗口 backgroundColor 硬编码深色 #09090b

**问题根因**: `createMainWindow()` 和 `createStudioWindow()` 中 `backgroundColor: '#09090b'` 硬编码，亮色主题下窗口首次绘制时显示深色背景，随后 renderer 才完成主题注入，产生可见闪烁。

**验收标准**: 亮色主题下窗口背景为浅色，深色主题下为 #09090b，无可见闪烁。

### 方案 A: 主题 token 注入（推荐）

| 维度 | 说明 |
|------|------|
| 实现思路 | 从 `settingsStore` 或 `themeStore` 读取当前主题模式（light/dark），映射为对应背景色后传入 `BrowserWindow` 构造函数。亮色使用 `--background` token 的浅色值（如 `#fafafa`），深色保持 `#09090b` |
| 影响范围 | `src/main/window-manager.ts`（2 处：createMainWindow + createStudioWindow） |
| 验收覆盖度 | 100% — 直接消除首次绘制与主题不一致 |
| 优点 | 零运行时开销；与 14-token 体系一致；无闪烁（窗口创建即正确） |
| 缺点 | 需要主进程访问主题状态（当前主进程不直接持有 themeStore） |
| 风险点 | 主进程读取主题状态需通过 IPC 或共享状态；若主题未加载完成需 fallback |
| 实施成本 | 0.5 人时 |
| 可维护性 | 高 — 单一映射函数，新增主题模式只需扩展映射表 |
| 回归验证 | Vitest 单元测试：mock `getThemeMode()` 返回 light/dark，断言 `BrowserWindow` 构造参数 `backgroundColor` 值 |
| 回滚方式 | 恢复硬编码 `#09090b` 即可 |

### 方案 B: CSS 变量驱动 + show 延迟

| 维度 | 说明 |
|------|------|
| 实现思路 | 窗口 `backgroundColor` 设为 `transparent`，renderer 端 `:root` 设置 `background-color` 由 CSS 变量控制。窗口 `show: false` 直到 `ready-to-show` + 首帧绘制完成 |
| 影响范围 | `window-manager.ts`、`globals.css`、`main.ts`（show 逻辑） |
| 验收覆盖度 | 90% — 透明窗口可消除颜色闪烁，但透明窗口可能带来其他视觉副作用 |
| 优点 | 不依赖主进程主题状态 |
| 缺点 | 透明窗口在某些 OS/GPU 组合下产生渲染伪影；延迟 show 可能让用户感知启动变慢 |
| 风险点 | Electron 透明窗口的平台兼容性（Windows 上需要 GPU 加速） |
| 实施成本 | 1 人时 |
| 可维护性 | 中 — 需要维护 show 时序逻辑 |
| 回归验证 | 集成测试：验证 `ready-to-show` 后窗口可见且背景色正确 |
| 回滚方式 | 恢复 `backgroundColor: '#09090b'` 和原始 show 逻辑 |

### 方案 C: 启动参数传递

| 维度 | 说明 |
|------|------|
| 实现思路 | `main.ts` 在创建窗口前从持久化存储读取主题模式，通过 `createMainWindow({ backgroundColor })` 选项传入 |
| 影响范围 | `main.ts`、`window-manager.ts`（新增构造参数） |
| 验收覆盖度 | 100% |
| 优点 | 解耦主进程与主题 store；参数显式传递 |
| 缺点 | 需要修改 `WindowCreateOptions` 接口；调用方需负责读取主题 |
| 风险点 | 若调用方忘记传参，fallback 值仍需硬编码 |
| 实施成本 | 0.5 人时 |
| 可维护性 | 高 — 接口清晰 |
| 回归验证 | 单元测试：传入不同 `backgroundColor` 值，断言 `BrowserWindow` 构造参数 |
| 回滚方式 | 移除参数，恢复硬编码 |

**K-01 推荐**: 方案 A（主进程读取主题状态直接注入）

---

## K-02: window-manager.ts 窗口尺寸硬编码（1220x800 / 1340x860），未考虑 DPI 缩放

**问题根因**: `width: 1220, height: 800` 和 `width: 1340, height: 860` 为固定像素值，在高 DPI（如 125%/150%）显示器上窗口物理尺寸偏小。

**验收标准**: 使用 `screen.getPrimaryDisplay().scaleFactor`，窗口尺寸按比例放大且不超出屏幕 bounds。

### 方案 A: scaleFactor 缩放 + bounds 裁剪（推荐）

| 维度 | 说明 |
|------|------|
| 实现思路 | 读取 `screen.getPrimaryDisplay()`，计算 `Math.min(baseWidth * scaleFactor, workArea.width * 0.9)`，确保窗口不超过屏幕工作区 90% |
| 影响范围 | `src/main/window-manager.ts`（2 处窗口创建） |
| 验收覆盖度 | 100% |
| 优点 | 精确适配 DPI；bounds 裁剪防止超屏 |
| 缺点 | 需要 Electron `screen` 模块（已有依赖） |
| 风险点 | 多显示器场景下 `getPrimaryDisplay` 可能不是用户期望的显示器 |
| 实施成本 | 1 人时 |
| 可维护性 | 高 — 封装为 `getScaledWindowSize(baseWidth, baseHeight)` 工具函数 |
| 回归验证 | Vitest：mock `screen.getPrimaryDisplay()` 返回不同 scaleFactor，断言计算后的 width/height |
| 回滚方式 | 恢复硬编码尺寸 |

### 方案 B: 百分比布局

| 维度 | 说明 |
|------|------|
| 实现思路 | 窗口尺寸设为屏幕工作区的固定百分比（如 80% × 75%），不直接使用 scaleFactor |
| 影响范围 | `window-manager.ts` |
| 验收覆盖度 | 80% — 间接适配 DPI（因为 workArea 已考虑 DPI），但非精确缩放 |
| 优点 | 简单；无需计算 scaleFactor |
| 缺点 | 不同 DPI 下窗口占比一致但绝对尺寸不同；用户偏好固定尺寸 |
| 风险点 | 小屏幕下窗口可能过小 |
| 实施成本 | 0.5 人时 |
| 可维护性 | 中 — 百分比值需经验选择 |
| 回归验证 | 单元测试：mock 不同 workArea 尺寸，断言窗口尺寸 ≤ 90% workArea |
| 回滚方式 | 恢复硬编码 |

### 方案 C: 用户偏好持久化 + DPI 适配

| 维度 | 说明 |
|------|------|
| 实现思路 | 首次启动按 scaleFactor 计算默认尺寸；用户调整窗口后持久化到 settings；后续启动读取持久化值 |
| 影响范围 | `window-manager.ts`、`settings.ts`、`settingsStore.ts` |
| 验收覆盖度 | 100% + 额外用户体验提升 |
| 优点 | 兼顾 DPI 适配与用户偏好 |
| 缺点 | 实施复杂度高；需要持久化逻辑；超出需求范围 |
| 风险点 | 持久化值在显示器变更场景下可能不适用 |
| 实施成本 | 2 人时 |
| 可维护性 | 高 — 但引入了额外状态管理 |
| 回归验证 | 单元测试 + 集成测试：验证持久化读写和 DPI 计算 |
| 回滚方式 | 移除持久化逻辑，恢复硬编码 |

**K-02 推荐**: 方案 A（scaleFactor 缩放 + bounds 裁剪）

---

## K-03: ThemeDetailPanel.tsx 硬编码中文字符串

**问题根因**: `ThemeDetailPanel.tsx` 第 181-225 行使用 `locale === 'zh-CN' ? '下载' : 'Downloads'` 等三元表达式硬编码中文字符串。

**验收标准**: 替换为 `uiMessages[locale]` 键值，en 语言下显示英文。

### 方案 A: 直接迁移到 i18n 模块（推荐）

| 维度 | 说明 |
|------|------|
| 实现思路 | 在 `themes.ts` i18n 模块中新增 `downloads`/`rating`/`size`/`updated`/`colors`/`screenshots` 等键值，替换组件内所有 `locale === 'zh-CN' ? ... : ...` 表达式 |
| 影响范围 | `src/ui/components/themes/ThemeDetailPanel.tsx`、`src/shared/i18n/modules/themes.ts` |
| 验收覆盖度 | 100% |
| 优点 | 彻底消除硬编码；与现有 i18n 体系一致 |
| 缺点 | 需同步添加 zh-CN 和 en 两套翻译 |
| 风险点 | 遗漏某些硬编码字符串 |
| 实施成本 | 0.5 人时 |
| 可维护性 | 高 — 新增语言只需扩展 i18n 模块 |
| 回归验证 | Vitest：分别用 zh-CN 和 en locale 渲染组件，断言文本内容 |
| 回滚方式 | 恢复原始三元表达式 |

### 方案 B: 辅助函数封装

| 维度 | 说明 |
|------|------|
| 实现思路 | 创建 `localizedLabel(locale, zh, en)` 辅助函数，组件内调用该函数而非直接访问 i18n |
| 影响范围 | `ThemeDetailPanel.tsx`、新增辅助函数文件 |
| 验收覆盖度 | 100% |
| 优点 | 调用简洁 |
| 缺点 | 引入额外抽象层；与项目现有 i18n 模式不一致（其他组件直接访问 `uiMessages`） |
| 风险点 | 辅助函数可能被误用于其他场景导致不一致 |
| 实施成本 | 0.5 人时 |
| 可维护性 | 中 — 两套 i18n 访问模式并存 |
| 回归验证 | 同方案 A |
| 回滚方式 | 恢复原始代码 |

### 方案 C: 配置对象映射

| 维度 | 说明 |
|------|------|
| 实现思路 | 在组件文件顶部定义 `const META_LABELS: Record<AppLocale, { downloads: string; ... }>` 配置对象，通过 `META_LABELS[locale]` 访问 |
| 影响范围 | 仅 `ThemeDetailPanel.tsx` |
| 验收覆盖度 | 100% |
| 优点 | 自包含；不修改 i18n 模块 |
| 缺点 | 翻译文本分散在组件文件中，不利于统一管理；与项目 i18n 架构不一致 |
| 风险点 | 后续新增语言需修改组件文件而非 i18n 模块 |
| 实施成本 | 0.5 人时 |
| 可维护性 | 低 — 翻译文本与组件耦合 |
| 回归验证 | 同方案 A |
| 回滚方式 | 恢复原始代码 |

**K-03 推荐**: 方案 A（直接迁移到 i18n 模块）

---

## K-04: App.tsx density/motion 映射使用嵌套三元表达式硬编码

**问题根因**: 第 53 行 `density === 'compact' ? '0.85' : density === 'cozy' ? '1.15' : '1'` 和第 61 行 `motion === 'reduced' ? '0.5' : motion === 'none' ? '0' : '1'` 使用嵌套三元表达式。

**验收标准**: 改为 Record 配置对象，新增档位只需加一行配置。

### 方案 A: Record 配置对象（推荐）

| 维度 | 说明 |
|------|------|
| 实现思路 | 在 `src/ui/` 下创建 `lib/density-motion-config.ts`，导出 `DENSITY_SCALE: Record<Density, string>` 和 `MOTION_MULTIPLIER: Record<Motion, string>` 配置对象，App.tsx 中通过 `DENSITY_SCALE[density]` 访问 |
| 影响范围 | `App.tsx`、新增配置文件 |
| 验收覆盖度 | 100% |
| 优点 | 新增档位只需加一行配置；类型安全（TypeScript 会检查遗漏档位） |
| 缺点 | 新增一个文件 |
| 风险点 | 无 |
| 实施成本 | 0.5 人时 |
| 可维护性 | 高 — 配置与逻辑分离 |
| 回归验证 | Vitest：遍历所有 Density/Motion 值，断言 CSS 变量设置正确 |
| 回滚方式 | 恢复原始三元表达式 |

### 方案 B: 内联 Record（App.tsx 顶部定义）

| 维度 | 说明 |
|------|------|
| 实现思路 | 在 `App.tsx` 文件顶部定义 `const DENSITY_SCALE = { compact: '0.85', comfortable: '1', cozy: '1.15' } as const`，组件内直接引用 |
| 影响范围 | 仅 `App.tsx` |
| 验收覆盖度 | 100% |
| 优点 | 不新增文件；改动最小 |
| 缺点 | 配置与组件耦合；若其他组件需要相同配置则重复 |
| 风险点 | 无 |
| 实施成本 | 0.25 人时 |
| 可维护性 | 中 — 配置在组件文件内 |
| 回归验证 | 同方案 A |
| 回滚方式 | 恢复原始代码 |

### 方案 C: settingsStore 派生

| 维度 | 说明 |
|------|------|
| 实现思路 | 在 `settingsStore` 中添加 `densityScale` 和 `motionMultiplier` 派生 selector，App.tsx 通过 hook 获取 |
| 影响范围 | `settingsStore.ts`、`App.tsx` |
| 验收覆盖度 | 100% |
| 优点 | 配置在 store 中集中管理 |
| 缺点 | 过度设计 — 纯映射逻辑不需要 store 状态；增加 store 复杂度 |
| 风险点 | 无 |
| 实施成本 | 0.5 人时 |
| 可维护性 | 中 — 映射逻辑混入状态管理 |
| 回归验证 | 同方案 A |
| 回滚方式 | 恢复原始代码 |

**K-04 推荐**: 方案 A（独立 Record 配置对象文件）

---

## K-05: studio.ts i18n 导出目录占位符硬编码 Windows 路径

**问题根因**: `studioExportDirPlaceholder` 在 zh-CN 和 en 中均为 `'C:\\Users\\...\\exported-themes'`，macOS 用户看到 Windows 路径。

**验收标准**: macOS 显示 `~/exported-themes`，Windows 显示 `C:\Users\...\exported-themes`。

### 方案 A: 平台检测 + 条件返回（推荐）

| 维度 | 说明 |
|------|------|
| 实现思路 | 在 `studio.ts` i18n 模块中，`studioExportDirPlaceholder` 改为函数 `(platform: string) => string`，根据 `process.platform` 返回 `~/exported-themes`（darwin）或 `C:\\Users\\...\\exported-themes`（win32）。调用方 `DockTabExport.tsx` 传入当前平台 |
| 影响范围 | `src/shared/i18n/modules/studio.ts`、`src/ui/components/studio/DockTabExport.tsx` |
| 验收覆盖度 | 100% |
| 优点 | 精确适配平台；i18n 模块已有函数式键值先例（如 `studioExportDesc`） |
| 缺点 | 需要从 renderer 传递平台信息，或在 i18n 模块中直接引用 `process.platform`（renderer 端需通过 `navigator.userAgent` 判断） |
| 风险点 | renderer 端 `process` 不可用（sandbox 模式） |
| 实施成本 | 0.5 人时 |
| 可维护性 | 高 — 遵循现有函数式键值模式 |
| 回归验证 | Vitest：mock 平台值，断言返回正确路径字符串 |
| 回滚方式 | 恢复原始硬编码 |

### 方案 B: 通用路径占位符

| 维度 | 说明 |
|------|------|
| 实现思路 | 将占位符改为平台无关的通用文本，如 `'exported-themes'` 或 `'选择导出目录'` |
| 影响范围 | `studio.ts` |
| 验收覆盖度 | 70% — 不显示错误平台路径，但也不提供平台特定的路径提示 |
| 优点 | 最简单；无平台依赖 |
| 缺点 | 丢失了路径示例对用户的信息量 |
| 风险点 | 无 |
| 实施成本 | 0.1 人时 |
| 可维护性 | 高 — 无需维护平台逻辑 |
| 回归验证 | 渲染组件，断言占位符文本 |
| 回滚方式 | 恢复原始值 |

### 方案 C: 主进程注入默认路径

| 维度 | 说明 |
|------|------|
| 实现思路 | 主进程计算实际导出目录（基于 `app.getPath('documents')` + `exported-themes`），通过 IPC 传递给 renderer，作为输入框的 `defaultValue` |
| 影响范围 | `studio.ts`、`studio-ipc.ts`、`DockTabExport.tsx`、`capture-store.ts` |
| 验收覆盖度 | 100% + 额外 UX 提升（显示真实可用路径） |
| 优点 | 路径真实可用；用户体验最佳 |
| 缺点 | 实施复杂度高；超出需求范围（需求仅要求占位符正确） |
| 风险点 | IPC 通信失败时需 fallback |
| 实施成本 | 1.5 人时 |
| 可维护性 | 高 — 但引入了额外 IPC 依赖 |
| 回归验证 | 集成测试：验证 IPC 调用和路径显示 |
| 回滚方式 | 恢复原始占位符 |

**K-05 推荐**: 方案 A（平台检测 + 条件返回）

---

## K-06: settings.ts 使用 process.env.APPDATA 拼接用户数据目录

**问题根因**: `settings.ts` 第 31-35 行使用 `process.env.APPDATA` 拼接路径，不支持 portable mode，且 fallback 逻辑使用 `process.env.HOME`（Windows 上通常未设置）。

**验收标准**: 替换为 `app.getPath('userData')`，支持 portable mode。

### 方案 A: app.getPath('userData')（推荐）

| 维度 | 说明 |
|------|------|
| 实现思路 | 将 `loadSettings()` 和 `updateSetting()` 中的 `userDataPath` 计算替换为 `app.getPath('userData')`。由于 `settings.ts` 是主进程模块，可直接 import `app` from `electron` |
| 影响范围 | `src/main/config/settings.ts` |
| 验收覆盖度 | 100% |
| 优点 | Electron 官方 API；自动处理 portable mode、各平台差异 |
| 缺点 | 需要确保 `app` 模块在调用时已就绪（Electron 启动后可用） |
| 风险点 | 现有用户数据迁移（旧路径 → 新路径） |
| 实施成本 | 0.5 人时 |
| 可维护性 | 高 — 使用标准 API |
| 回归验证 | Vitest：mock `app.getPath()`，断言路径拼接和文件读写使用正确路径 |
| 回滚方式 | 恢复原始 `process.env.APPDATA` 逻辑 |

### 方案 B: 环境变量优先 + app.getPath fallback

| 维度 | 说明 |
|------|------|
| 实现思路 | 优先读取 `process.env.AGENTSKIN_USER_DATA`（允许用户自定义），fallback 到 `app.getPath('userData')` |
| 影响范围 | `settings.ts` |
| 验收覆盖度 | 100% + 额外灵活性 |
| 优点 | 支持高级用户自定义数据目录 |
| 缺点 | 引入未要求的功能；增加测试矩阵 |
| 风险点 | 环境变量注入安全风险（低风险，本地应用） |
| 实施成本 | 0.5 人时 |
| 可维护性 | 高 |
| 回归验证 | 单元测试：分别验证环境变量存在/不存在时的行为 |
| 回滚方式 | 恢复原始代码 |

### 方案 C: 路径解析抽象层

| 维度 | 说明 |
|------|------|
| 实现思路 | 创建 `resolveUserDataPath()` 工具函数，集中管理路径解析逻辑，`settings.ts` 和其他需要用户数据的模块统一调用 |
| 影响范围 | `settings.ts`、新增工具函数文件 |
| 验收覆盖度 | 100% |
| 优点 | 统一路径解析；其他模块可复用 |
| 缺点 | 当前仅 `settings.ts` 一处使用，抽象层可能过度设计 |
| 风险点 | 无 |
| 实施成本 | 0.5 人时 |
| 可维护性 | 高 — 但仅一处调用时略显冗余 |
| 回归验证 | 同方案 A |
| 回滚方式 | 恢复原始代码 |

**K-06 推荐**: 方案 A（app.getPath('userData')）

---

## K-07: install-detection.ts 对非 Win32 平台直接 return empty

**问题根因**: `detectInstallation()` 第 340 行 `if (platform !== 'win32' || !hints)` 直接返回空结果，macOS 上无法检测已安装的 agent。

**验收标准**: macOS 实现 `/Applications/*.app` 路径扫描 + `which` 命令检测。

### 方案 A: 平台策略模式（推荐）

| 维度 | 说明 |
|------|------|
| 实现思路 | 将 `detectInstallation` 重构为平台策略：定义 `PlatformDetector` 接口，实现 `WindowsDetector`（现有逻辑）和 `MacOSDetector`（扫描 `/Applications/*.app`、`~/Applications/*.app`、`which <cmd>`）。`detectInstallation` 根据 `platform` 选择 detector |
| 影响范围 | `src/main/install-detection.ts`（重构） |
| 验收覆盖度 | 100% |
| 优点 | 开闭原则 — 新增平台只需添加 detector；逻辑清晰 |
| 缺点 | 重构范围较大 |
| 风险点 | 重构可能引入回归；macOS `.app` 包结构需正确处理（Info.plist 解析） |
| 实施成本 | 2 人时 |
| 可维护性 | 高 — 各平台逻辑独立 |
| 回归验证 | Vitest：分别 mock win32/darwin 平台，验证调用正确的 detector；macOS 测试覆盖 `/Applications` 扫描和 `which` 检测 |
| 回滚方式 | 恢复原始 `if (platform !== 'win32') return empty` 逻辑 |

### 方案 B: 内联平台分支

| 维度 | 说明 |
|------|------|
| 实现思路 | 在 `detectInstallation` 中，将 `if (platform !== 'win32')` 改为 `if (platform === 'darwin') { /* macOS 逻辑 */ } else if (platform !== 'win32') { return empty }` |
| 影响范围 | `install-detection.ts` |
| 验收覆盖度 | 100% |
| 优点 | 改动最小；不引入新文件 |
| 缺点 | 函数体积膨胀；多平台时难以维护 |
| 风险点 | macOS 逻辑与 Windows 逻辑混杂 |
| 实施成本 | 1.5 人时 |
| 可维护性 | 中 — 单函数内多平台逻辑 |
| 回归验证 | 同方案 A |
| 回滚方式 | 恢复原始代码 |

### 方案 C: 独立 macOS 检测模块

| 维度 | 说明 |
|------|------|
| 实现思路 | 新建 `install-detection-macos.ts`，导出 `detectMacOSInstallation()`，在 `install-detection.ts` 中 import 并调用 |
| 影响范围 | 新增文件 + 修改 `install-detection.ts` |
| 验收覆盖度 | 100% |
| 优点 | 文件职责单一；macOS 逻辑独立可测试 |
| 缺点 | 与现有 Windows 代码风格不一致（Windows 逻辑仍在原文件） |
| 风险点 | 无 |
| 实施成本 | 2 人时 |
| 可维护性 | 高 |
| 回归验证 | 同方案 A |
| 回滚方式 | 删除新文件，恢复原始 import |

**K-07 推荐**: 方案 A（平台策略模式）— 长期可维护性最佳

---

## K-08: electron-launcher.ts 进程管理使用 PowerShell/tasklist/taskkill 仅支持 Windows

**问题根因**: `isPortOccupied()` 使用 PowerShell `Get-NetTCPConnection`，`killPids()` 使用 `taskkill`，非适配流程使用 `tasklist`，均仅支持 Windows。

**验收标准**: macOS 使用 `lsof`/`pkill`，Windows 保留现有实现。

### 方案 A: 平台抽象层（推荐）

| 维度 | 说明 |
|------|------|
| 实现思路 | 在 `electron-launcher.ts` 中封装 `processUtils` 对象，包含 `isPortOccupied(port)`、`killPids(pids)`、`isProcessRunning(exeName)` 三个方法，内部根据 `process.platform` 选择 Windows（PowerShell/tasklist/taskkill）或 macOS（lsof/pkill/ps）实现 |
| 影响范围 | `src/main/services/electron-launcher.ts` |
| 验收覆盖度 | 100% |
| 优点 | 接口统一；平台差异封装在内部；新增平台只需扩展内部实现 |
| 缺点 | 需要维护两套命令实现 |
| 风险点 | macOS `lsof` 输出格式可能与预期不同；需处理命令不存在的情况 |
| 实施成本 | 2 人时 |
| 可维护性 | 高 — 平台差异局部化 |
| 回归验证 | Vitest：mock `process.platform` 和 `execFile`，验证不同平台调用正确命令 |
| 回滚方式 | 恢复原始 Windows 实现 |

### 方案 B: 独立平台工具模块

| 维度 | 说明 |
|------|------|
| 实现思路 | 新建 `src/main/services/platform-process.ts`，导出 `isPortOccupied`、`killPids`、`isProcessRunning`，`electron-launcher.ts` import 使用 |
| 影响范围 | 新增文件 + 修改 `electron-launcher.ts` |
| 验收覆盖度 | 100% |
| 优点 | 工具函数可复用；文件职责单一 |
| 缺点 | 新增文件；当前仅 `electron-launcher.ts` 一处使用 |
| 风险点 | 无 |
| 实施成本 | 2 人时 |
| 可维护性 | 高 |
| 回归验证 | 同方案 A |
| 回滚方式 | 删除新文件，恢复原始实现 |

### 方案 C: 第三方库替代（如 `ps-list`、`portfinder`）

| 维度 | 说明 |
|------|------|
| 实现思路 | 使用 `ps-list` 替代 `tasklist`/`ps`，使用 `portfinder` 替代 PowerShell 端口检测 |
| 影响范围 | `electron-launcher.ts`、`package.json` |
| 验收覆盖度 | 100% |
| 优点 | 跨平台统一 API |
| 缺点 | 引入外部依赖；违反"不引入不可控第三方依赖"约束；`ps-list` 等库可能不支持所有 Electron 版本 |
| 风险点 | 第三方库维护状态、安全漏洞 |
| 实施成本 | 1 人时 |
| 可维护性 | 中 — 依赖外部库更新 |
| 回归验证 | 同方案 A |
| 回滚方式 | 移除依赖，恢复原始实现 |

**K-08 推荐**: 方案 A（平台抽象层内封装）

---

## K-09: DriftStatusPanel/PerformancePanel/date-picker.tsx 使用 date-fns format() 未传 locale

**问题根因**: `DriftStatusPanel.tsx` 第 105/109 行、`PerformancePanel.tsx` 第 330-331/396 行、`date-picker.tsx` 第 90 行使用 `format(date, 'HH:mm:ss')` 或 `format(date, 'PPP')` 未传 locale 参数，日期始终按浏览器默认 locale 格式化。

**验收标准**: 传入应用 locale，en 环境下日期显示英文格式。

### 方案 A: 应用 locale 注入 + date-fns locale 参数（推荐）

| 维度 | 说明 |
|------|------|
| 实现思路 | 利用现有 `src/shared/intl.ts` 中的 `formatDate()`/`formatTime()` 工具函数（已支持 `AppLocale` 参数），替换所有 `date-fns format()` 调用。`date-picker.tsx` 的 `format(date, 'PPP')` 改为使用 `date-fns` 的 `format` 并传入 `locale` 对象（`import { enUS, zhCN } from 'date-fns/locale`） |
| 影响范围 | `DriftStatusPanel.tsx`、`PerformancePanel.tsx`、`date-picker.tsx`、`intl.ts`（可能需扩展） |
| 验收覆盖度 | 100% |
| 优点 | 复用现有 `intl.ts` 工具；date-fns locale 已内置支持 |
| 缺点 | 需确保 `date-fns/locale` 的 locale 数据被正确 bundle（tree-shaking 友好） |
| 风险点 | `date-fns` locale 映射需与 `AppLocale` 对齐 |
| 实施成本 | 1 人时 |
| 可维护性 | 高 — 统一使用 intl 工具 |
| 回归验证 | Vitest：mock locale 为 en，断言 `format` 调用传入了正确的 locale 参数 |
| 回滚方式 | 恢复原始 `format()` 调用 |

### 方案 B: 全局 date-fns locale 设置

| 维度 | 说明 |
|------|------|
| 实现思路 | 在应用启动时设置 `date-fns` 全局 locale（通过 `setDefaultOptions` 或类似 API），所有 `format()` 调用自动使用 |
| 影响范围 | `main.ts` 或 `App.tsx`（启动逻辑） |
| 验收覆盖度 | 80% — date-fns v3 不支持全局 locale 设置，需每个 `format` 调用传参 |
| 优点 | 一处设置，全局生效 |
| 缺点 | date-fns v3 已移除全局 locale；此方案不可行 |
| 风险点 | API 不存在 |
| 实施成本 | 0.5 人时（后发现不可行需回滚） |
| 可维护性 | 不适用 |
| 回归验证 | 不适用 |
| 回滚方式 | 不适用 |

### 方案 C: 自定义 format 包装函数

| 维度 | 说明 |
|------|------|
| 实现思路 | 创建 `formatDateTime(date, format, locale)` 包装函数，内部调用 `date-fns format` 并传入 locale 参数，所有组件统一使用 |
| 影响范围 | 新增工具文件 + 修改 3 个组件 |
| 验收覆盖度 | 100% |
| 优点 | 统一接口；可扩展（如未来支持相对时间） |
| 缺点 | 与现有 `intl.ts` 功能重叠 |
| 风险点 | 两套 intl 工具并存 |
| 实施成本 | 1 人时 |
| 可维护性 | 中 — 功能重叠 |
| 回归验证 | 同方案 A |
| 回滚方式 | 恢复原始代码 |

**K-09 推荐**: 方案 A（应用 locale 注入 + date-fns locale 参数）

---

## K-10: logger.ts 时间戳硬编码 zh-CN locale

**问题根因**: `logger.ts` 第 42 行 `new Date().toLocaleTimeString('zh-CN', { hour12: false })` 和第 118 行 `mainDebug()` 中同样硬编码 `'zh-CN'`。

**验收标准**: 传入应用当前 locale，en 环境下时间戳格式正确。

### 方案 A: 注入 AppLocale（推荐）

| 维度 | 说明 |
|------|------|
| 实现思路 | 在 `logger.ts` 中维护模块级 `currentLocale: AppLocale`，通过 `setLoggerLocale(locale)` 函数更新。`emit()` 和 `mainDebug()` 中使用 `currentLocale` 替代硬编码 `'zh-CN'`。`main.ts` 在 locale 变更时调用 `setLoggerLocale()` |
| 影响范围 | `src/main/logger.ts`、`main.ts`（locale 变更回调） |
| 验收覆盖度 | 100% |
| 优点 | 精确；locale 变更实时生效；与 `intl.ts` 的 `formatTime()` 逻辑一致 |
| 缺点 | 需维护模块级状态 |
| 风险点 | 初始 locale 未设置时的 fallback（使用 `DEFAULT_LOCALE`） |
| 实施成本 | 0.5 人时 |
| 可维护性 | 高 — 单一状态源 |
| 回归验证 | Vitest：调用 `setLoggerLocale('en')`，触发 `mainInfo()`，断言时间戳格式为英文（如 `14:30:00` 而非 `14:30:00`） |
| 回滚方式 | 恢复硬编码 `'zh-CN'` |

### 方案 B: 复用 intl.ts formatTime

| 维度 | 说明 |
|------|------|
| 实现思路 | `logger.ts` 中 import `formatTime` from `intl.ts`，直接调用 `formatTime(new Date(), currentLocale)` 替代 `toLocaleTimeString` |
| 影响范围 | `logger.ts` |
| 验收覆盖度 | 100% |
| 优点 | 复用现有工具；不重复实现 locale 格式化 |
| 缺点 | 仍需维护 `currentLocale` 状态 |
| 风险点 | 同方案 A |
| 实施成本 | 0.5 人时 |
| 可维护性 | 高 — 格式化逻辑集中 |
| 回归验证 | 同方案 A |
| 回滚方式 | 恢复原始代码 |

### 方案 C: 主进程全局 locale 读取

| 维度 | 说明 |
|------|------|
| 实现思路 | `logger.ts` 中每次 `emit()` 时从 `locale-preferences.ts` 或主进程全局状态读取当前 locale，不维护模块级缓存 |
| 影响范围 | `logger.ts` |
| 验收覆盖度 | 100% |
| 优点 | 无模块级状态；locale 始终准确 |
| 缺点 | 每次 log 都需读取状态（性能开销可忽略）；需确保 locale 状态在 logger 之前初始化 |
| 风险点 | 初始化时序问题 |
| 实施成本 | 0.5 人时 |
| 可维护性 | 中 — 依赖外部状态读取时序 |
| 回归验证 | 同方案 A |
| 回滚方式 | 恢复原始代码 |

**K-10 推荐**: 方案 A（注入 AppLocale + 模块级状态）

---

## 汇总矩阵

| 需求 | 推荐方案 | 实施成本 | 复杂度 | 风险 |
|------|---------|---------|--------|------|
| K-01 | A: 主题 token 注入 | 0.5h | S | 低 |
| K-02 | A: scaleFactor + bounds 裁剪 | 1h | M | 低 |
| K-03 | A: 迁移到 i18n 模块 | 0.5h | XS | 极低 |
| K-04 | A: Record 配置对象 | 0.5h | S | 极低 |
| K-05 | A: 平台检测 + 条件返回 | 0.5h | XS | 低 |
| K-06 | A: app.getPath('userData') | 0.5h | S | 低 |
| K-07 | A: 平台策略模式 | 2h | M | 中 |
| K-08 | A: 平台抽象层 | 2h | M | 中 |
| K-09 | A: locale 注入 + date-fns 参数 | 1h | XS | 低 |
| K-10 | A: 注入 AppLocale | 0.5h | XS | 极低 |
| **总计** | | **9.5h** | | |

---

## 实施阶段建议

### Phase 1 — 低风险快速修复（K-03, K-04, K-05, K-09, K-10）
- 纯 UI/i18n 层修改，无主进程逻辑变更
- 预估 3 人时
- 可独立验证、独立回滚

### Phase 2 — 主进程核心修复（K-01, K-02, K-06）
- 涉及窗口创建和路径解析
- 预估 2 人时
- 需完整回归测试

### Phase 3 — 跨平台能力（K-07, K-08）
- 涉及平台检测和进程管理
- 预估 4 人时
- 需 macOS 环境验证（或 mock 测试）

---

## 自动化验证策略

1. **单元测试**: 所有方案均提供 Vitest 测试用例，覆盖平台分支和 locale 分支
2. **不变量检查**: 修改后运行 `npm run check` 确保 C1-C10 不变量不被破坏
3. **回归测试**: `npm test` 全量通过
4. **平台 mock**: 使用 `vi.stubGlobal('process.platform', 'darwin')` 模拟跨平台行为

---

## 回滚策略

- 所有修改均为**纯新增或纯替换**，不删除现有功能
- 每个需求独立 commit，可 `git revert <hash>` 单独回滚
- 主进程修改（K-01/K-02/K-06/K-07/K-08）建议通过 feature flag 控制，便于紧急关闭
