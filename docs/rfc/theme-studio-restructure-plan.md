# Theme Studio 重构 — 方案推演选型报告

> 阶段一（纯推演，无落地执行）
> 日期：2026-08-21
> 基于：3 份并行分析报告（现状 + GitHub 对标 + 4 步后续）

---

## 一、现状诊断摘要

### 1.1 三大类问题

| 类别 | 严重度 | 数量 | 典型示例 |
|------|--------|------|---------|
| **虚假按钮 / 接口不通** | P0 | 5 | InspectorProfile 永无数据、FloatingToolbar Agent 切换是空操作、ExportDialog License 字段未接入 payload |
| **功能割裂 / 冗余** | P1 | 6 | StudioCenterPanel 80 行死代码、ToolboxPanel 900 行与 DockTabFX 重复、CenterTabDesignLanguage 150 行孤立运行 |
| **交互缺陷** | P2 | 6 | DockTabFX preset 仅保存 colors 丢失其他维度、Inspector 与 Inspect 无法联动、缩放控件重复 |

**死代码总计**：~1500 行（StudioCenterPanel + ToolboxPanel + CenterTabDesignLanguage）

### 1.2 用户满意现有布局但功能未集成

- 布局骨架（Drawer + Stage + Inspector + Dock）分工合理
- 问题：Stage 承担了双重角色（预览 + 多功能面板容器）
- Center Tab（wallpaper/bundle/inspect/raw）放在"预览区"定位不符

### 1.3 4 步后续现状

| 步骤 | 复杂度 | 现状 |
|------|--------|------|
| E2E 集成测试 | 中 | 完全缺失，无真实 manifest 加载测试 |
| 导航集成 | 低 | CenterTabDesignLanguage 已实现但从未引用 |
| i18n key 补充 | 低 | 19 个 studioDL* key 全部缺失 |
| 可视化编辑器 | 高 | 完全缺失，无 extended colors 编辑能力 |

---

## 二、GitHub 对标核心发现

| 项目 | Stars | 核心借鉴 |
|------|-------|---------|
| **Tokens Studio** | 1.6k | 左导航 + 中编辑 + 右预览的三栏布局；Token 引用系统 |
| **DbGate** | 8.3k+ commits | Electron 原生左栏 + 主内容 + 设置分区 |
| **BetterDiscord** | 9.2k | 注入架构分层（但 spaghetti code 需规避） |
| **MUI Theme Creator** | 462 | 实时预览联动机制 |
| **Panda CSS** | 6.1k | 类型安全 Token 契约 |

**核心借鉴模式**：
1. **Tokens Studio 三栏工作台**：分类导航 + 编辑 + 实时预览
2. **DbGate 桌面布局**：左栏资源 + 中央工作 + 右侧详情
3. **MUI Theme Creator 联动**：编辑 → 预览实时更新

**需规避反例**：
- BetterDiscord spaghetti code → 严格分层
- 纯 CSS 方案（ClearVision）→ 必须保留运行时能力

---

## 三、候选方案集合

### 方案 A：渐进整合（Progressive Consolidation）

**核心理念**：不改变布局骨架，清理冗余 + 修复虚假按钮 + 逐步集成新功能。

**改动内容**：

1. **死代码清理**（~1500 行）
   - 删除 StudioCenterPanel（未被引用）
   - 删除 ToolboxPanel（与 DockTabFX 重复）
   - 删除孤立的 CenterTabDesignLanguage（或保留但标记为"待集成"）

2. **P0 虚假按钮修复**（5 项）
   - InspectorProfile：添加启动分析的按钮或移除该 Tab
   - FloatingToolbar Agent 切换：实现真正的 Agent 切换或移除
   - ExportDialog：将 License/目录字段真正接入导出 payload
   - Drawer Bundle 导入：绑定 `importAndInstallBundle`
   - ExportDialog 目录选择器：修复为正确 IPC 通道

3. **P1 功能合并**（6 项）
   - 统一 `computeSignature`：删除 Toolbox.tsx 中的独立实现，复用 DockTabFX 内联逻辑
   - Inspect ↔ Inspector 联动：共享 landmark 选中态
   - Generator 入口合并

4. **4 步后续按序执行**：
   - i18n key 补充（19 key）→ 导航集成 → E2E 测试 → 可视化编辑器

**改动规模**：中（删除 1500 行 + 修改 ~20 文件 + 新增测试 ~500 行）

**对标项目启发**：DbGate 设置面板分区思路

---

### 方案 B：三栏工作台（Three-Column Workspace）

**核心理念**：借鉴 Figma/Photoshop + Tokens Studio 三栏布局，彻底重组。

**改动内容**：

1. **布局重构**：
   - **左栏**：工程 + 资源（精简后的 Drawer，移除 Agent 安全信息）
   - **中栏**：始终可见的预览画布 + 顶部 Tab 切换（FX / Inspect / Generator / Raw）
   - **右栏**：Inspector 融合所有检查/分析/调节功能
   - **移除** StudioDock（底部抽屉）
   - **顶部**：简化 TopBar 为工程名 + 撤销/重做 + 导出

2. **功能集成**：
   - FX / Inspect / Generator / Raw → 中栏 Tab 内容
   - Landmarks/Computed/Cascade/Fingerprint → 右栏 Inspector Tab
   - CenterTabDesignLanguage → 中栏新 Tab

3. **死代码一并清理**：StudioCenterPanel/ToolboxPanel 移除

4. **P0/P1 问题一并解决**：重构过程中统一修复

**改动规模**：大（重构布局 + 删除死代码 + 移动功能面板 + 修改 30+ 文件）

**对标项目启发**：Tokens Studio 三栏模式 + DbGate 桌面布局

---

### 方案 C：画布优先（Canvas-First）

**核心理念**：借鉴 MUI Theme Creator，"预览画布绝对固定 + 所有面板围绕画布"。

**改动内容**：

1. **布局重构**：
   - **中央**：iframe 预览窗口永远固定，不可关闭
   - **左栏**：Drawer 保留但缩减为工程/资源导航
   - **右栏**：Inspector 扩展为多功能面板（Tab 包含 Landmarks + FX + Inspector-Preview）
   - **底部**：Dock 保留但范围缩小为导出 + 预设管理
   - **新增**：可拖拽的浮动调节面板（替代固定 DockFX）

2. **Stage 职责精简**：
   - Stage 仅作为预览窗口容器，不再承载 CenterStageTab
   - Center Tab 内容移入 Inspector 新 Tab

3. **实时预览联动**：
   - 在 Inspector 中调节 Design Language → 中央 iframe 即时更新
   - MUI Theme Creator 式联动机制

4. **死代码 + P0/P1 一并清理**

**改动规模**：大（重构布局 + 实时联动机制 + 修改 30+ 文件）

**对标项目启发**：MUI Theme Creator 实时预览联动 + ClearVision CSS 变量契约

---

## 四、多维加权评估

### 4.1 权重校准

| # | 维度 | 权重 | 依据 |
|---|------|------|------|
| 1 | **业务根治** | 20% | 核心问题是功能割裂 + 虚假按钮，需最大化根治 |
| 2 | **场景兼容** | 15% | 6 种 Agent + 现有工作流必须保留 |
| 3 | **故障安全** | 15% | 重构风险需可控，可回滚 |
| 4 | **工程契约** | 12% | Schema + Store + 组件接口需闭环 |
| 5 | **可工程化** | 12% | 可测试 + CI 校验 |
| 6 | **架构一致性** | 10% | 对齐 ARCHITECTURE.md L0-L4 |
| 7 | **长期演进** | 10% | 为后续 E2E/编辑器/可视化铺路 |
| 8 | **边界健壮** | 6% | 极端场景兼容 |

### 4.2 评分表 (1-10)

| 维度 (权重) | A: 渐进整合 | B: 三栏工作台 | C: 画布优先 |
|------------|------------|-------------|------------|
| 1. 业务根治 (20%) | 7 | 9 | 8 |
| 2. 场景兼容 (15%) | 9 | 7 | 7 |
| 3. 故障安全 (15%) | 10 | 6 | 6 |
| 4. 工程契约 (12%) | 8 | 7 | 7 |
| 5. 可工程化 (12%) | 9 | 7 | 6 |
| 6. 架构一致性 (10%) | 9 | 7 | 7 |
| 7. 长期演进 (10%) | 6 | 9 | 9 |
| 8. 边界健壮 (6%) | 9 | 7 | 7 |

### 4.3 加权总分

| 方案 | 加权总分 | 排名 |
|------|---------|------|
| **A: 渐进整合** | **8.25** | **🥇 1** |
| B: 三栏工作台 | 7.50 | 🥈 2 |
| C: 画布优先 | 7.10 | 🥉 3 |

计算：
- A = 0.20×7 + 0.15×9 + 0.15×10 + 0.12×8 + 0.12×9 + 0.10×9 + 0.10×6 + 0.06×9 = 1.40+1.35+1.50+0.96+1.08+0.90+0.60+0.54 = **8.25**
- B = 0.20×9 + 0.15×7 + 0.15×6 + 0.12×7 + 0.12×7 + 0.10×7 + 0.10×9 + 0.06×7 = 1.80+1.05+0.90+0.84+0.84+0.70+0.90+0.42 = **7.50**
- C = 0.20×8 + 0.15×7 + 0.15×6 + 0.12×7 + 0.12×6 + 0.10×7 + 0.10×9 + 0.06×7 = 1.60+1.05+0.90+0.84+0.72+0.70+0.90+0.42 = **7.10**

---

## 五、交叉质询结论

### 为何 A > B？

方案 A 的核心优势是**故障安全**（10 分）和**场景兼容**（9 分），因为它不改变现有布局骨架。用户已满意现有布局（Drawer + Stage + Inspector + Dock），方案 A 仅清理内部问题，不破坏用户的心智模型。

方案 B（三栏工作台）虽然根治度更高（9 分），但：
- 需要移除 Dock 用户可能依赖
- 布局重排带来学习成本
- 改了用户满意的布局 → 违反了"用户满意现有布局"的核心约束

### 为何 B > C？

方案 B 的三栏布局有成熟的 GitHub 对标（Tokens Studio, DbGate），可借鉴度高。方案 C 的"画布优先"需要自研实时联动机制（MUI Theme Creator 仅支持 MUI 不可复用），可工程化得分较低（6 分）。

### 为何不直接选 B？

核心原因：**用户明确表示满意现有布局**。方案 B 需要：
- 移除底部 Dock（用户可能重度使用拖拽高度功能）
- 改变 TopBar 6 视图切换（用户已习惯）
- 将 FX 从 Dock 移入中栏（改变了操作流）

这些改动代价高但收益不明确（用户并未要求改布局）。

---

## 六、最终推荐：方案 A — 渐进整合

### 6.1 设计理念

**保留用户满意的骨架，治愈内部的病**。

- 不改变 Drawer + Stage + Inspector + Dock 四区布局
- 不做大的面板搬迁
- 仅清理死代码、修复虚假按钮、合并冗余
- 按优先级逐步集成 4 步后续

### 6.2 执行波次

#### 波次 1（立即 — 清创手术）

1. 删除 StudioCenterPanel（80 行死代码）
2. 删除 ToolboxPanel（900 行与 DockTabFX 重复）
3. 修复 InspectorProfile：添加分析启动入口
4. 修复 FloatingToolbar Agent 切换：实现或移除
5. 修复 ExportDialog TODO 字段
6. 修复 Drawer Bundle 导入按钮
7. 修复 ExportDialog 目录选择器 IPC

#### 波次 2（短期 — 功能集成）

8. i18n 补充 19 个 studioDL* key
9. 将 CenterTabDesignLanguage 集成到 Inspector 新 Tab（而非 Stage）
10. 扩展 DockTabFX preset：保存全部 8 维而非仅 colors
11. 添加 extended colors 编辑器（复用 Toolbox.tsx ColorRow）
12. 统一 computeSignature 实现

#### 波次 3（中期 — 测试与联动）

13. E2E 集成测试（`tests/integration/theme-pipeline.test.ts`）
14. Inspect ↔ Inspector 选中态联动
15. TopBar 缩放控件去重

#### 波次 4（长期 — 视觉优化）

16. Drawer 瘦身（Agent 安全信息独立popover）
17. 实时预览联动高级化（MUI Theme Creator 式 iframe 即时刷新）

### 6.3 GitHub 对标映射

| 对标项目 | 借鉴点 | 应用到波次 |
|---------|--------|----------|
| DbGate | 设置面板分区 + 桌面布局保留 | 波次 1（保留布局） |
| Tokens Studio | Token 编辑器 UI 组织 | 波次 2（颜色编辑器） |
| MUI Theme Creator | 实时预览联动 | 波次 4 |
| BetterDiscord | 注入分层规避 | 波次 3（E2E测试） |
| ClearVision | CSS 变量契约 | 波次 2（DL系统） |

---

## 七、全量风险清单

### 7.1 选型风险

| # | 风险 | 概率 | 影响 | 缓解 |
|---|------|------|------|------|
| R1 | 删除死代码可能误删"看似未使用"但实际被间接引用的模块 | 低 | 中 | 全面 grep 引用 + 完整测试套件 |
| R2 | CenterTabDesignLanguage 集成到 Inspector 而非 Stage 可能导致状态同步复杂 | 中 | 低 | 通过 shared store（themeStore）避免 |
| R3 | 修复 P0 虚假按钮时引入新的 IPC 通道可能破坏 preload 安全策略 | 低 | 中 | 提前审查 preload 白名单 |

### 7.2 边界限制

- 当前方案不引入新的 UI 组件库（除非必要）
- 不改变 React 19 + Zustand v5 的技术栈
- 不扩大 6 Agent / 4 Store 的现有架构

---

## 八、分级行动建议

### ✅ 优先执行（P0+P1 清理）

1. 删除三组死代码（StudioCenterPanel + ToolboxPanel + CenterTabDesignLanguage）
2. 修复 5 个 P0 虚假按钮
3. i18n 补充 19 个 key

### ⏳ 暂缓调研

4. Inspector 与 Inspect 的选中态联动 → 需先调研 studioStore 状态拆分方案
5. Drawer 瘦身 → 需用户反馈 Agent 安全信息是否常用

### ❌ 直接舍弃

6. 三栏工作台方案（B）→ 用户满意现有布局，不值得重构
7. 画布优先方案（C）→ 实时联动机制可工程化程度低

---

## 九、后续需要调研的 GitHub 仓库清单

| 仓库 | 目的 | 优先级 |
|------|------|--------|
| tokens-studio/figma-plugin | Token 编辑器 UI 交互模式 | P1 |
| dbgate/dbgate | Electron 桌面应用状态持久化 | P2 |
| bareynol/mui-theme-creator | 实时预览联动机制 | P2 |
| goabstract/Awesome-Design-Tools | 设计工具模式大全 | P2 |

---

*本报告为纯方案推演结果，不包含任何代码实现。落地执行需另行启动阶段二。*
