# Studio 重构 P1/P2/P3 最终交付报告

| 字段 | 值 |
|------|------|
| 日期 | 2026-08-24 |
| 阶段 | P1（测试）+ P2（集成）+ P3（增强） |
| 全量测试 | **504/504 通过（44 files）** |
| Biome | **0 errors** |
| 状态 | **全部完成** |

---

## P1 交付：测试基础设施

### 1. 依赖安装
- `@testing-library/react@^16` — 修复 6 个已有测试文件
- `@testing-library/jest-dom@^6` — 配套断言库

### 2. 新增测试文件

| 文件 | 测试数 | 覆盖场景 |
|------|--------|---------|
| src/ui/hooks/__tests__/use-element-picker.test.ts | 17 | 初始化、选择器构建、mousemove/click/leave、enabled 切换、rAF 清理、null iframe |
| src/ui/components/studio/__tests__/inspector-element.test.tsx | 7 | null path、null iframe、元素不存在、正常流程、CSS 变量过滤、关闭按钮、深层 breadcrumb |
| src/ui/studio/__tests__/project-store.test.ts | 12 | CRUD、getActiveProject、编辑态 |
| src/ui/studio/__tests__/bundle-store.test.ts | 9 | refresh/install/delete 成功+失败路径 |
| src/ui/studio/__tests__/capture-store.test.ts | 9 | override/undo/redo/reset + 合并窗口 |
| src/ui/studio/__tests__/image-wallpaper-store.test.ts | 5 | idle/clear/resetAll |

**P1 新增测试合计：59 tests**

---

## P2 交付：hooks 与组件对接

### 1. PreviewWindow.tsx 改造
- 集成 `useElementPicker` hook
- 集成 `usePseudoForce` hook（hover 联动伪态）
- 集成 `DomHighlight` overlay 组件
- 新增 props：`pickEnabled`、`onPick`、`externalPickedPath`
- 透明 overlay div 捕获鼠标事件（button 元素，Biome 兼容）
- 保持现有 override 注入、scale、loading/error 状态不变

### 2. StudioInspector.tsx 改造
- 新增 "element" tab
- 渲染 `InspectorElement` 组件
- 新增 optional props：`iframeRef`、`pickedPath`、`onClearPicked`
- 向后兼容：现有调用点 `<StudioInspector t={t} />` 无需改动

### 3. 类型与 i18n
- `InspectorTabId` 扩展为 `'profile' | 'element'`
- `INSPECTOR_TABS` 新增 `{ id: 'element', label: 'Element' }`
- `uiMessages` 新增 `studioTabElement: '元素' / 'Element'`

---

## P3 交付：A/B 翻转 + Device Frame

### 1. ab-flix.tsx（A/B 翻转对比）
- 双 iframe 叠加（baseline + current）
- 三种视图模式：baseline / current / split（clip-path）
- Diff 高亮：DFS 两棵树比较 style，注入 dashed orange outline
- 控制栏：三个模式按钮 + Diff toggle + 状态标签
- 使用现有 `#ov` 协议注入 override CSS

### 2. device-frame.tsx（设备视口预设）
- 4 个桌面分辨率：1280×720 / 1440×900 / 1920×1080 / 2560×1440
- 两种模式：纯缩放 / 显示器外壳（bezel + stand）
- `useResolutionPreset` hook 管理状态
- `RESOLUTION_PRESETS` 常量导出

---

## 最终验证

| 维度 | 结果 |
|------|------|
| 全量 UI 测试 | **44 files, 504 tests, 全部通过** |
| Biome lint | **0 errors, 0 warnings** |
| 路径污染 | 无 |
| 新第三方依赖 | 仅 @testing-library/react + jest-dom（测试用） |

---

## 分级下一步

### 已完成 ✓
- α 架构减重（5 子 store + facade）
- β 预览交互 hooks（element-picker / pseudo-force）
- β 预览交互组件（dom-highlight / inspector-element）
- P1 全量测试（59 tests）
- P2 组件对接（PreviewWindow + StudioInspector）
- P3 A/B 翻转 + device frame

### 下一步建议
1. **StudioStage 集成**：在 StudioStage 中将 PreviewWindow 用 DeviceFrame 包裹，并传递 iframeRef/pickedPath 给 StudioInspector
2. **e2e 验证**：用 Playwright 启动 Electron，验证 overlay 点击、元素拾取、A/B 切换在真实 iframe 中工作
3. **性能探针**：60fps 拖动 override 滑条时 overlay 重算不卡顿
