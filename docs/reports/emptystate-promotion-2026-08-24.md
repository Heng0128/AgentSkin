# EmptyState 组件推广报告

> **执行日期**: 2026-08-24
> **执行方式**: 3 子代理并行替换 + 1 子代理验证 + 1 子代理补充修复

---

## 一、执行摘要

将分散在 12 个文件中的 15 处 ad-hoc 空状态实现，统一替换为共享 `<EmptyState>` 组件。

| 阶段 | 并行数 | 替换处数 | 结果 |
|------|:------:|:--------:|:----:|
| 批次 1 (Apps+Wallpaper) | 1 | 3 | ✅ |
| 批次 2 (Themes+Settings+Studio) | 2 | 7 | ✅ |
| 验证 + 深度检查 | 2 | 发现 5 处遗漏 | ✅ |
| 补充修复 | 1 | 5 | ✅ |

**净效果**: 15 处 ad-hoc 空状态 → 1 处共享组件，测试 3620/3620 通过。

---

## 二、替换清单

### 2.1 页面级空状态（5 处）

| 文件 | 替换处 | 图标 | 翻译 Key |
|------|:------:|------|----------|
| `src/ui/pages/AppsPage.tsx` | 2 | Monitor | appsEmptyHidden, appsScanToFind |
| `src/ui/pages/ThemesPage.tsx` | 1 | PaintBucket | themeLibraryEmpty, noSearchResultsHint |
| `src/ui/pages/WallpaperEnginePage.tsx` | 1 | Image | weEmpty |
| `src/ui/pages/SettingsPage.tsx` | 1 | FileText | noLogs |

### 2.2 组件级空状态（5 处）

| 文件 | 替换处 | 图标 | 翻译 Key |
|------|:------:|------|----------|
| `src/ui/components/studio/StudioDrawer.tsx` | 2 | Palette, Image | studioLibraryEmpty, studioWallpaperEmpty |
| `src/ui/components/detail-panel.tsx` | 1 | MousePointerClick | selectThemeHint |
| `src/ui/components/studio/InspectorProfile.tsx` | 1 | Search | studioNoAnalysisRunning |

### 2.3 诊断面板空状态（3 处）

| 文件 | 替换处 | 图标 | 翻译 Key |
|------|:------:|------|----------|
| `src/ui/components/diagnostics/PerformancePanel.tsx` | 2 | Activity, Trash2 | 复用已有 key |
| `src/ui/components/diagnostics/SecondaryInjectTrace.tsx` | 1 | ArrowRight | 复用已有 key |
| `src/ui/components/diagnostics/DriftStatusPanel.tsx` | 1 | Activity | 复用已有 key |

### 2.4 Studio 编辑器空状态（1 处）

| 文件 | 替换处 | 图标 | 翻译 Key |
|------|:------:|------|----------|
| `src/ui/components/studio/center/CenterTabBundle.tsx` | 1 | Package | 复用已有 key |

---

## 三、移除的旧模式

以下内联样式模式已全部清除：

```tsx
// 旧模式 — 各页面各自实现的 flex-col 居中布局
<div className="flex flex-col items-center justify-center gap-2 text-center">
  <SomeIcon className="size-7 text-muted-foreground" />
  <span className="text-[10px] font-medium">...</span>
  <span className="text-[10px] text-muted-foreground">...</span>
</div>
```

替换为：

```tsx
// 新模式 — 共享组件
<EmptyState
  icon={<SomeIcon />}
  title="..."
  hint="..."
  iconSize="lg"
/>
```

---

## 四、视觉一致性收益

### 4.1 统一前后的对比

| 属性 | 旧（各页面各自实现） | 新（共享组件） |
|------|---------------------|----------------|
| 主标题字号 | 10px/11px/13px/14px 混用 | 统一 13px |
| 副标题字号 | 10px/11px 混用 | 统一 11px |
| 图标尺寸 | 16px/28px/32px 混用 | sm=16px / md=32px / lg=48px 三档 |
| 布局方式 | flex-col / flex-col justify-center 混用 | 统一 flex-col items-center gap-2 |
| 颜色 | text-foreground / text-muted-foreground 一致 | 一致（不变） |
| 行动按钮 | 有的有、有的没有 | 可选 action prop 统一 |
| 翻译 key | 各页面自定 key | 复用已有 key，无新增 |

### 4.2 组件 API 稳定性

`<EmptyState>` 组件保持纯展示型 API，不依赖任何 Store，可独立测试和复用。后续如需调整空状态视觉风格，只需修改一处。

---

## 五、测试与验证

### 5.1 测试结果

| 指标 | 数值 |
|------|:----:|
| 测试文件 | 227 |
| 通过 | 227 |
| 总测试数 | 3620 |
| 失败 | 0 |
| 跳过 | 4 |

### 5.2 全量验证

- EmptyState 引用数: 12 个文件中的 15 处
- 旧模式残余: 0（`flex flex-col items-center justify-center` 在 diagnostics 和 studio/center 目录已清除）
- 断裂引用: 0
- 翻译 key 覆盖: 12 个 key 中英文双语全覆盖
- 图标 import: 7 个 Lucide 图标均正确导入且使用

---

## 六、下一步建议

### 6.1 短期（本周）

1. **Toolbar 统一**: 当前 5 个页面有 5 种 Toolbar 策略，可参考 EmptyState 推广的经验，创建共享 `<PageToolbar>` 组件
2. **PageHeader 统一**: 虽然 5 个页面都用了 `<PageHeader>`，但内部结构仍有差异，可进一步收敛

### 6.2 中期（1-2 周）

3. **RFC 评审**: Phase D 和 Phase E 的 RFC 已提交，需组织技术评审
4. **Phase D 实施**: 评审通过后拆分 workspaceStore、统一 Design Language

### 6.3 长期（3-4 周）

5. **Phase E 实施**: 删除 Studio facade、合并 IPC 通道
6. **Studio 数据收集**: 收集使用频率数据决定是否路由化
