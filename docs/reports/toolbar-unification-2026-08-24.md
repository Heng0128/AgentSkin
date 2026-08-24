# Toolbar 统一报告

> **执行日期**: 2026-08-24
> **执行方式**: 1 探索 + 3 并行替换 + 2 并行验证

---

## 一、执行摘要

创建共享 `<PageToolbar>` 组件，替换 4 个页面的 5 种 Toolbar 策略为统一模式。

| 阶段 | 并行数 | 内容 | 结果 |
|------|:------:|------|:----:|
| 探索 | 1 | 分析 5 个页面的 Toolbar 现状 | ✅ |
| 组件创建 + 替换 | 3 | PageToolbar 组件 + 3 组页面并行替换 | ✅ |
| 验证 + 深度检查 | 2 | 全量验证 + 遗漏检查 | ✅ |

**净效果**: 5 种 Toolbar 策略 → 1 个共享组件，测试 3620/3620 通过。

---

## 二、Toolbar 替换清单

| 页面 | 旧策略 | 新方案 | 替换处 |
|------|--------|--------|:------:|
| ThemesPage | 5 个控件（搜索+排序+方向+导入+Studio）塞进 PageHeader children | `<PageToolbar search={...} sort={...} sortOrder={...} actions={...} />` | 1 |
| WallpaperEnginePage | 独立 Toolbar 子组件（原生 input/select） | `<PageToolbar search={...} sort={...} left={<FilterChips />} />`，PageHeader 保留导入+开关 | 1 |
| AppsPage | 扫描按钮塞进 PageHeader children，FilterChips 在外部 | `<PageToolbar actions={<Button>扫描</Button>} />`，FilterChips 保持在 PageHeader 外部 | 1 |
| WorkspacePage | 刷新按钮塞进 PageHeader children | `<PageToolbar actions={<Button>刷新</Button>} />` | 1 |
| SettingsPage | Section rail 导航，无传统 Toolbar | 保持不变（section rail 不需要 Toolbar） | 0 |

---

## 三、PageToolbar 组件

文件: `src/ui/components/ui/page-toolbar.tsx`（89 行）

Props:
- `left?` — 左侧区域（FilterChips 等）
- `search?` — 搜索框（InputGroup + Search 图标，h-6 w-[240px]）
- `sort?` — 排序下拉（Select，h-6 w-[130px]）
- `sortOrder?` — 升降序切换（size-6 按钮 + ArrowUp/ArrowDown）
- `actions?` — 右侧操作按钮区
- `className?` — 透传

设计 token 合规: `rounded-sm`, `bg-muted`, `bg-card`, `text-[10px]`, `border-border`

---

## 四、视觉一致性收益

| 属性 | 旧（各页面各自实现） | 新（共享组件） |
|------|:-------------------:|:--------------:|
| 搜索框组件 | InputGroup(Themes) / 原生 input(Wallpaper) | 统一 InputGroup |
| 搜索框宽度 | 240px / min-180 max-240 | 统一 240px |
| 排序组件 | shadcn Select(Themes) / 原生 select(Wallpaper) | 统一 shadcn Select |
| 排序下拉宽度 | 130px / 不固定 | 统一 130px |
| 排序方向实现 | 原生 button + 手动图标 / 无 | 统一 size-6 按钮 + ArrowUp/Down |
| 操作按钮位置 | 直接在 PageHeader children 中 | PageToolbar actions slot 统一靠右 |
| 布局 | flex-wrap / flex-nowrap 混用 | 统一 `flex items-center gap-2` |
| 内边距 | 各页面不一致 | 统一 `px-3 py-2` |

---

## 五、附带收益

### 5.1 FilterChips 扩展
为 `FilterChips` 组件新增了 `className` prop，支持外部覆盖默认间距（WallpaperEnginePage 使用 `gap-1`）。

### 5.2 冗余 import 清理
ThemesPage 不再需要直接 import InputGroup、Select 等 UI 组件（由 PageToolbar 内部封装）。

### 5.3 WallpaperEnginePage 清理
删除了已有的 `Toolbar` 子组件及其 `ToolbarProps` interface。

---

## 六、验证结果

| 指标 | 数值 |
|------|:----:|
| 测试文件 | 227 |
| 通过 | 227 |
| 总测试数 | 3620 |
| 失败 | 0 |

深度检查确认:
- `we-sub` CSS 类: **已完全清除**
- 原生 input/select: **已完全清除**
- i18n key: **全部正确，无硬编码字符串**
- 冗余 import: **已清理**
- FilterChips className 兼容性: **无影响**

### 可以接受的非统一项

- **WallpaperEnginePage 导入按钮 + 启用开关**: 放在 PageHeader children 中而非 PageToolbar，属于合理的页面级操作（导入和启用/禁用是页面级主操作，不是 Toolbar 辅助操作）
- **SettingsPage 复制日志按钮**: section header 级别操作，非列表 Toolbar 场景

---

## 七、下一步建议

### 7.1 短期（本周）

1. **PageHeader children 规范**: 当前 PageHeader 直接传递 children 作为 Toolbar 区域，但缺乏明确约束。可考虑增加 `toolbar` prop 替代 `children`，使 API 更清晰
2. **Section 级别操作统一**: 探索 SettingsPage 的 section header 操作（如复制日志按钮）是否有统一模式

### 7.2 中期（1-2 周）

3. **RFC 评审**: Phase D（workspaceStore 拆分 + Design Language 统一）和 Phase E（Studio 治理）的 RFC 需组织评审
4. **Phase D 实施**: 评审通过后拆分 God Store，统一 Design Language

### 7.3 长期（3-4 周）

5. **Phase E 实施**: 删除 Studio facade，合并 IPC 通道
6. **Studio 数据收集**: 收集使用频率数据决定是否路由化

---

## 八、可复用模式总结

本次 Toolbar 统一和 EmptyState 推广使用了相同的多子代理模式，验证了该方法论的有效性:

1. **探索**: 1 个子代理分析现状，输出完整清单
2. **组件创建**: 1 个子代理创建共享组件
3. **并行替换**: 2-3 个子代理按页面分组并行替换
4. **并行验证**: 2 个子代理分别做全量验证和深度检查
5. **补充修复**: 1 个子代理修复验证发现的遗漏

整个流程可复用于后续的 PageHeader 统一、FormRow 统一、卡片系统统一等视觉收敛工作。
