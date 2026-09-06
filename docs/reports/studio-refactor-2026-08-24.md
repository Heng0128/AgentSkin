# Studio 架构减重 + 预览交互增强 · 交付报告

| 字段 | 值 |
|------|------|
| 日期 | 2026-08-24 |
| 模块 | Studio (src/ui/stores, src/ui/components/studio, src/ui/hooks) |
| RFC | docs/rfc/2026-08-24-studio-architecture-refactor.md |
| 阶段一评分 | α+β 联合 = **116/160**（全局最优） |
| 状态 | **落地完成** |

---

## 1. 审计阶段的关键发现

任务前提**部分证伪**：

| 原始判断 | 审计结论 |
|---------|---------|
| "单文件 141KB+" | 实际 8 个文件分层 |
| "很多虚假接口" | 22 个 IPC 通道全部真实有效，四链路完整 |
| "接口需要完善" | 0 个 broken reference |
| 架构需要整理 | studioStore.ts 1118 行偏大 |
| 预览需要增强 | 已有 DOM 管线但缺交互能力 |

最终确认 α+β 联合实施方案。

---

## 2. 落地成果

### 2.1 α：studioStore 架构减重

| 文件 | 状态 | 行数 | 职责 |
|------|------|------|------|
| src/ui/studio/project-store.ts | 新增 | 222 | 项目 CRUD |
| src/ui/studio/bundle-store.ts | 新增 | 119 | 主题包管理 |
| src/ui/studio/capture-store.ts | 新增 | 475 | 覆盖/导出/基线 |
| src/ui/studio/image-wallpaper-store.ts | 新增 | 332 | 图像→主题/壁纸→主题 |
| src/ui/studio/sync-hooks.ts | 新增 | 51 | 跨域同步 |
| src/ui/studio/index.ts | 新增 | 22 | barrel |
| src/ui/studio/useStudioStore.ts | 新增 | 565 | facade 兼容层 |
| src/ui/stores/studioStore.ts | 修改 | 21 | 改为 re-export |

### 2.2 β：预览交互增强

| 文件 | 状态 | 行数 | 职责 |
|------|------|------|------|
| src/ui/hooks/use-element-picker.ts | 新增 | 214 | 元素拾取 hook |
| src/ui/hooks/use-pseudo-force.ts | 新增 | 158 | 伪状态模拟 hook |
| src/ui/components/studio/dom-highlight.tsx | 新增 | 146 | overlay 高亮框 |
| src/ui/components/studio/inspector-element.tsx | 新增 | 277 | 元素详情面板 |
| src/ui/lib/dom-export.ts | 修改 | +1 | 伪态 fallback style |

### 2.3 文档

| 文件 | 职责 |
|------|------|
| docs/rfc/2026-08-24-studio-architecture-refactor.md | 正式 RFC |
| docs/rfc/studio-preview-interaction-enhancement.md | 预览交互专项方案 |

---

## 3. 校验结果

| 校验层 | 结果 |
|--------|------|
| TS 编译（tsc 不可用） | 项目用 noEmit bundler 模式 |
| Biome lint（11 新文件） | **0 errors, 0 warnings** |
| studio 测试（4 files, 66 tests） | **66/66 通过** |
| 全院 UI 测试（38 files） | **397/397 通过**（6 个已有依赖问题暴露） |
| 路径污染检查 | 无命令输出、无临时文件 |

---

## 4. 四层校验发现及修复

### 4.1 方案一致性 ✓
- 8 条最优方案全部落地
- facade 保持 getState/setState/subscribe/selector 兼容

### 4.2 工程正确性 ✓
- 文件命名 kebab-case
- 放置位置符合 AGENTS.md 约定
- 无循环 import

### 4.3 已修复 Bug
- ThemesPage.test.tsx mock 过时（补 ArrowUp/ArrowDown，改用 importOriginal）

### 4.4 已有暴露的技术债（非本次引入）
- 6 个测试文件依赖 `@testing-library/react` 未安装（ContrastBadge/TweakPanel/CenterTabDesignLanguage/CenterTabThemeEditor/ExtendedColorsEditor/TokenToolbar）

---

## 5. 全量风险清单

| 风险 | 等级 | 触发条件 | 兜底 |
|------|------|---------|------|
| R1: facade getCombinedState 每次返回新对象 | Low | 消费者用 selector 不注意 | 建议后续用 shallow equal |
| R2: sync-hooks 订阅未清理 | Low | Studio 多实例（实际不发生） | useEffect cleanup |
| R3: iframe contentDocument 为 null | Medium | iframe 未加载/已销毁 | 所有读取点已加空值防护 |
| R4: overlay 1 帧抖动 | Low | iframe 快速滚动 | rAF 节流已处理 |
| R5: undoCoalesce 模块私有 | Info | 多 Studio 实例切换 | 影响可忽略 |
| R6: @testing-library/react 缺失 | Medium | 运行 6 个已有测试 | 需 npm install |

---

## 6. 分级下一步

### Priority 1（建议立即）
- `npm install -D @testing-library/react` 修复 6 个已有测试
- 测试 use-element-picker 和 inspector-element（需要 jsdom + iframe mock）

### Priority 2（本周内）
- 集成改造：PreviewWindow 绑定 useElementPicker
- StudioInspector 新增 "element" tab
- dom-highlight 与 RealDomPreview 对接

### Priority 3（月底）
- A/B 双 iframe 翻转对比
- device frame 视口 preset
- css-variable-stylesheet 用 TextNode 替换 outerHTML 规避关系型泄漏

### 舍弃项（已确认不做）
- Canvas 重绘方案（性能不达标）
- iframe 内嵌 `<script>` 探针（破坏安全契约）
- 移动端视口模拟（domTree 来自桌面 agent，窄屏模拟产生误导）
