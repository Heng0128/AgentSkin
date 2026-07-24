# AgentSkin Release Audit Report

## 审计范围

- Agent 系统：名称链路、IPC、adapter、registry
- QoderWork CN：动态端口、CDP、竞态条件
- Theme 系统：安装、安全、rollback
- 安装体验：FirstLaunch、状态管理
- 日志系统：错误映射、用户提示
- UI 产品级：i18n、空状态、错误边界
- 工程质量：TypeScript、React、Electron

## P0 必须修复

### P0-1: `AppActionList` 迭代所有 `AGENT_IDS` 包含实验性 `qoder`

- **文件**: `src/ui/components/detail-panel.tsx` 第 50 行
- **原因**: `AGENT_IDS` 包含 `['workbuddy', 'qoderwork', 'traework', 'qoder']`，其中 `qoder` 是实验性代理。`AppActionList` 遍历所有 `AGENT_IDS`，在主题详情面板中显示一个用户不应操作的实验性代理。
- **影响**: 用户在主题详情面板看到 "Qoder"（实验性），虽然按钮禁用且显示"不支持"，但暴露了非正式产品。
- **建议方案**: 将 `AppActionList` 改为只遍历 `AGENT_IDS`（不含实验性代理），或使用 `controller.agents.filter(a => a.supported).map(a => a.id)`。

### P0-2: `theme-installer.ts` 缺少 icon/preview 路径穿越验证

- **文件**: `src/main/catalog/theme-installer.ts` 第 46、51 行
- **原因**: `path.join(packagePath, manifest.icon)` 和 `path.join(packagePath, manifest.preview)` 没有路径穿越检查。虽然 `ThemePackageLoader` 验证文件存在，但没有检查 `manifest.icon` 是否包含 `../`。
- **影响**: 如果内置主题包的 manifest 中包含恶意路径（如 `../../secret.txt`），可能读取任意文件。风险较低因为内置主题来自 app bundle，但如果未来支持用户自定义主题包则存在安全风险。
- **建议方案**: 在 `ThemePackageLoader.load()` 中添加对 `manifest.icon` 和 `manifest.preview` 的路径穿越检查，与 `validateBackgroundAssets` 保持一致。

## P1 应该修复

### P1-1: `PRODUCT_DISPLAY_NAMES` 包含实验性 `qoder` 条目

- **文件**: `src/main/agent-engine-service.ts`
- **原因**: `PRODUCT_DISPLAY_NAMES` 通过 `AGENT_META` 动态构建，包含 `qoder: 'Qoder'`。虽然 `AGENT_IDS` 不包含 `qoder`，但 `PRODUCT_DISPLAY_NAMES` 仍包含它。
- **影响**: 理论上如果某个代码路径错误地使用 `PRODUCT_DISPLAY_NAMES['qoder']`，会返回 `'Qoder'` 而非 `'QoderWork CN'`。目前无实际危害因为 `qoder` 不在 `AGENT_IDS` 中，但增加了认知负担。
- **建议方案**: 将 `PRODUCT_DISPLAY_NAMES` 改为只包含 `AGENT_IDS` 中的代理，或添加注释说明这是故意包含所有 `AgentId`。

### P1-2: `agent:list` IPC 返回所有代理包括实验性

- **文件**: `src/main.ts` 第 117-129 行
- **原因**: `agent:list` 返回 `agentCatalog.listAgents()` 的所有结果，包括 `supported: false` 的实验性代理（如 `qoder`、`codebuddy` 等）。
- **影响**: 渲染器收到所有代理，虽然 UI 层过滤（sidebar、environments 都检查 `supported`），但 `useAgents` 返回所有代理，`AppActionList` 遍历 `AGENT_IDS` 时可能查到实验性代理的 displayName。
- **建议方案**: 在 IPC 层过滤只返回 `supported: true` 的代理，或在 `useAgents` 中过滤。

### P1-3: `useAppController` 中 `refreshStatus` 的 `eslint-disable` 注释

- **文件**: `src/ui/hooks/useAppController.ts` 第 103 行
- **原因**: `useEffect` 依赖数组为空 `[]`，但 `refreshStatus` 是 `useCallback`。这导致 `refreshStatus` 在首次渲染后永远不会更新。
- **影响**: 如果 `refreshStatus` 的闭包捕获了过时的状态，可能产生 stale closure。但目前 `refreshStatus` 只调用 `window.agentSkin.refreshStatus()` 和 `setStatus`，不依赖外部状态，所以实际无害。
- **建议方案**: 添加注释说明为什么不需要 `refreshStatus` 在依赖数组中，或将 `refreshStatus` 移到 `useEffect` 内部。

## P2 优化建议

### P2-1: `theme-package-loader.ts` 中 `validateTarget` CSS 文件存在性检查被注释掉

- **文件**: `src/main/catalog/theme-package-loader.ts` 第 75 行
- **原因**: 注释说 "CSS file existence is optional for v2 targets"。这意味着如果 CSS 文件不存在，loader 不会报错。
- **影响**: 主题安装可能成功但 CSS 内容为空，导致主题应用后无视觉效果。
- **建议方案**: 考虑添加可选警告日志而非静默跳过。

### P2-2: `theme-installer.ts` 中 fallback CSS 硬编码颜色

- **文件**: `src/main/catalog/theme-installer.ts` 第 166-170 行
- **原因**: `generateFallbackCSS` 使用硬编码的默认颜色值。
- **影响**: 如果主题包没有提供任何 CSS 文件，fallback CSS 使用固定的黑色/白色，可能与主题设计意图不符。
- **建议方案**: 这是预期的 fallback 行为，无需修改。

### P2-3: `FirstLaunch` 组件缺少错误恢复 UI

- **文件**: `src/ui/components/first-launch/FirstLaunch.tsx`
- **原因**: 如果 `refreshStatus` 或 `catalog.themes.list()` 持续失败，FirstLaunch 仍然显示完成并跳转到主界面。
- **影响**: 用户可能在系统状态不确定的情况下进入主界面。
- **建议方案**: 添加"跳过初始化"按钮或错误重试选项。

### P2-4: `useNotifications` 中 toast 定时器使用 `Date.now()` 作为 id

- **文件**: `src/ui/hooks/useNotifications.ts`
- **原因**: `const id = Date.now() + Math.random()` 在快速连续调用时可能产生重复 id。
- **影响**: 极端情况下两个 toast 可能共享同一个 id，导致其中一个被错误清除。
- **建议方案**: 使用递增计数器或 `crypto.randomUUID()`。

### P2-5: `agent-catalog.ts` 中 `toItem` 的 fallback 逻辑冗余

- **文件**: `src/main/catalog/agent-catalog.ts` 第 53-56 行
- **原因**: `toItem` 中有 `if (!meta.displayName && adapter.coreId)` 的 fallback，但 `DISPLAY_META` 现在从 `AGENT_META` 引用 displayName，所以这个 fallback 永远不会触发。
- **影响**: 死代码，增加维护认知负担。
- **建议方案**: 简化 `toItem` 逻辑，移除不必要的 fallback。

### P2-6: `useThemeCenter` 中 `toCard` 函数未使用 `useCallback`

- **文件**: `src/ui/hooks/useThemeCenter.ts` 第 14-27 行
- **原因**: `toCard` 在每次 `allThemes` memo 计算时被重新创建。
- **影响**: 微小性能开销，实际影响可忽略。
- **建议方案**: 用 `useCallback` 包裹 `toCard`。

## Windows Release 风险

### 1. 路径分隔符兼容性

- **风险**: `theme-package-loader.ts` 使用 `path.resolve` 和 `startsWith` 进行路径穿越检查。在 Windows 上 `path.resolve` 返回带反斜杠的路径，而 `startsWith` 比较的是字符串。
- **评估**: 低风险。`path.resolve` 和 `path.join` 在 Windows 上都使用相同的分隔符，所以 `resolved.startsWith(path.resolve(packagePath))` 在 Windows 上也是正确的。

### 2. 权限问题

- **风险**: `theme-library.ts` 写入 `userData/themes/` 目录。如果用户没有写入权限，主题安装会失败。
- **评估**: 低风险。Electron 应用通常在用户目录下运行，用户对自己的 userData 有完全控制权。

### 3. 单实例锁

- **风险**: `main.ts` 使用 `requestSingleInstanceLock()`。如果用户同时运行多个 AgentSkin 实例，第二个实例会退出。
- **评估**: 这是预期行为，不是风险。

### 4. 托盘图标

- **风险**: macOS 上使用 `trayTemplate.png`（模板图像），Windows 上使用 `tray-icon.png`。如果打包时图标文件缺失，托盘图标会显示默认图标。
- **评估**: 低风险。构建脚本 `generate-tray-icons.mjs` 会生成这些图标。

### 5. 主题包大小

- **风险**: `MAX_IMPORT_BYTES = 50 * 1024 * 1024`（50MB）。如果用户尝试导入大于 50MB 的主题包，会收到错误。
- **评估**: 合理限制。正常主题包远小于 50MB。

## 当前完成度评分

| 维度 | 评分 | 说明 |
|------|------|------|
| Agent 稳定性 | 95/100 | 名称链路完整，`AGENT_META` 为单一事实来源。唯一问题是 `AppActionList` 显示实验性 `qoder` |
| Theme 稳定性 | 90/100 | 安装/恢复/删除流程完整，安全验证到位。`theme-installer.ts` 缺少 icon/preview 路径穿越检查 |
| 安装体验 | 85/100 | FirstLaunch 有结构化日志支持。缺少错误恢复 UI |
| UI 完成度 | 90/100 | i18n 完整，无硬编码英文残留。错误边界支持 i18n。Toast 堆叠支持 |
| 发布准备度 | 88/100 | TypeScript 编译通过。3 个预存测试失败（与本次审计无关）。P0-1 和 P0-2 需要在发布前修复 |

### 详细评分

- **Agent 稳定性: 95/100**
  - ✅ `AGENT_META` 是单一事实来源
  - ✅ `PRODUCT_DISPLAY_NAMES` 从 `AGENT_META` 动态构建
  - ✅ `DISPLAY_META` 引用 `AGENT_META`
  - ✅ `APP_META` 引用 `AGENT_META`
  - ✅ `agent:list` IPC 正确合并 catalog 和 status
  - ⚠️ `AppActionList` 迭代所有 `AGENT_IDS`（含实验性 `qoder`）

- **Theme 稳定性: 90/100**
  - ✅ 原子安装（临时文件 + rename）
  - ✅ 路径穿越验证（background assets）
  - ✅ 50MB 导入限制
  - ✅ 失败恢复（保留原始 activeThemeId）
  - ⚠️ `theme-installer.ts` 缺少 icon/preview 路径穿越检查

- **安装体验: 85/100**
  - ✅ FirstLaunch 有结构化日志
  - ✅ 安装进度有真实步骤序列
  - ⚠️ FirstLaunch 缺少错误恢复 UI

- **UI 完成度: 90/100**
  - ✅ 无 TODO/FIXME 标记
  - ✅ 错误边界支持 i18n
  - ✅ Toast 堆叠支持
  - ✅ 所有用户可见文本已 i18n

- **发布准备度: 88/100**
  - ✅ TypeScript 编译通过
  - ✅ 核心流程测试通过
  - ⚠️ 3 个预存测试失败（非本次引入）
  - ⚠️ P0-1 和 P0-2 需要修复

## 审计结论

AgentSkin 的代码质量较高，架构清晰。核心改进已完成：

1. **名称链路统一**: `AGENT_META` 作为单一事实来源，所有层（main、renderer、catalog）都从中派生显示名称。
2. **QoderWork CN 支持**: 动态端口解析、CDP 连接、错误处理流程完整。
3. **安全验证**: 路径穿越检查、文件大小限制、原子安装到位。
4. **i18n 完整**: 无硬编码英文残留。

待修复项：
- P0-1: `AppActionList` 过滤实验性代理（5 分钟修复）
- P0-2: `theme-installer.ts` 路径穿越检查（10 分钟修复）

预计修复后可达发布标准。
