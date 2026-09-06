# 阶段二：社区多来源页面落地执行计划

> 关联RFC：`docs/rfc/2026-09-04-community-multi-source-page.md`
> 日期：2026-09-04
> 执行模式：**批次内多智能体全并行、批次间严格串行**
> 总批次数：4（B1 → B2 → B3 → B4）

---

## A. 执行阶段多层强制校验体系

每批次落地后必须通过以下四层校验，方可进入下一批次。

### A.1 第一层：方案一致性校验

逐条比对批次落地内容与RFC §4-§9 设计方案，检查项：

- [ ] 是否覆盖该批次全部 RFC 指明改动点
- [ ] 是否遗漏 RFC 要求的接口/类型/字段
- [ ] 是否私自简化或篡改RFC设计逻辑
- [ ] 错误边界/空状态/缓存策略/健康探针是否按 §6-§9 实现

### A.2 第二层：工程落地正确性校验

校验代码质量：

- [ ] 文件命名、文件路径符合项目约定
- [ ] 模块引用、导入导出路径正确
- [ ] 数据链路（store→component→IPC）完整
- [ ] 语法规范无报错（`npm run check` 全绿）
- [ ] TypeScript 类型无新增错误
- [ ] Biome lint 无违规新增

### A.3 第三层：RFC规范合规校验

全量核验落地内容符合RFC完整规范：

- [ ] 文件格式（SPDX 头部、JSDoc 注释）
- [ ] 兼容性策略（DreamSkin 行为不回归）
- [ ] 弃用策略（保留旧入口过渡期）
- [ ] 风险备注完整（R1-R7 已规避）
- [ ] 分批验收标准达成（§5 量化指标）

### A.4 第四层：落地深度漏检审计

独立反向审查：

- [ ] 隐性落地BUG（边界条件未覆盖）
- [ ] 适配遗漏（特定Agent/特定主题兼容性）
- [ ] 架构隐性冲突（新增store字段与现有 consuming 组件冲突）
- [ ] 技术债残留（TODO/FIXME/临时方案未清理）
- [ ] 落地后是否完整保留方案的短期根治能力+长期演进能力

---

## B. 批次详细执行方案

### B1：Source 抽象 + communityStore 重构（仅 DreamSkin，行为不变）

**目标**：将 `communityStore` 从扁平 DreamSkin 专有 store，重构为 source 驱动的通用 store。仅包含 DreamSkin 一个 source，行为与重构前完全一致。

**子任务分解**（可并行部分标注 ⟷）：

```
⟷ B1.1 类型层扩展
  文件: src/shared/types/community.ts
  改动:
    - 新增 `CommunitySourceId = 'dreamskin' | 'codedrobe'`
    - 新增 `CommunitySourceState` 接口（status/loading/error/independent RequestToken）
    - 新增 `InstallationRecord` 接口
    - 新增 `SourceCacheEntry<T>` 泛型接口
  不变: CommunityThemeSummary/Detail/ListParams/ListResult 保持原样

⟷ B1.2 Store 核心重构
  文件: src/ui/stores/communityStore.ts
  改动:
    - 新增 `sources: Record<CommunitySourceId, CommunitySourceState>` state
    - 新增 `activeSourceId: CommunitySourceId` state
    - 取消全局单一 RequestToken → 每 source 独立 RequestToken 实例
    - 新增 `installationLog: Map<string, InstallationRecord>` state
    - 缓存层: `SourceCacheEntry<T>` + `cacheTTL` 配置
    - 健康探针: `_probeSourceHealth()` 方法，按 §9 状态机转换
    - DreamSkin 专有逻辑封装为 `dreamskinSource: CommunitySource` 实例
  不变:
    - 对外 action 名称不变（loadThemes/loadMore/installTheme/cancelInstall）
    - 默认 `activeSourceId = 'dreamskin'`，所有不指定 source 的操作默认走 DreamSkin
    - 安装链路 IPC 调用序列不变
```

```
⟷ B1.3 Main 进程健康探针实现
  文件: src/main/community/（新增 health-probe.ts 或并入 community-theme-api.ts）
  改动:
    - 新增 `probeHealth(sourceUrl): Promise<boolean>` 工具函数
    - 导出供 preload IPC 调用
  不变: 现有 API 端点逻辑不受影响
```

```
⟷ B1.4 测试用例
  文件: src/ui/stores/communityStore.test.ts（扩展）
  新增测试:
    - 快速连续 source 切换（100ms 内切换 3 次）→ 最终状态与最后一次切换一致
    - source 独立 RequestToken：DreamSkin 请求进行中切换 source → DreamSkin 响应被丢弃但不影响新 source
    - 健康探针：模拟 4 次失败（2 degraded + 离线3 次中第2次成功恢复 online）
    - 缓存命中：5分钟缓存内切换 source → 无新 API 请求，数据来自缓存
    - installationLog 写入验证
    - 现有 load/install/cancel/loadMore 行为不回归 ≥12 用例
```

**B1 校验标准**：

| 层级 | 校验内容 | 通过条件 |
| --- | --- | --- |
| 方案一致性 | Source抽象接口+RequestToken隔离+缓存+健康探针按§4.3/§7/§9落地 | 无漏项 |
| 工程正确性 | TypeScript全绿、Biome无违规新增、导入路径正确 | `npm run check` 全绿 |
| RFC规范 | DreamSkin行为不回归、SPDX头部、安装链路不变 | B1.4 测试100%通过 |
| 深度漏检 | 竞态测试全部通过、缓存边沿条件覆盖、memory leak排查 | 独立审计通过 |

**B1 产出文件清单**（全部新增/修改）：
- `src/shared/types/community.ts` — 类型扩展
- `src/ui/stores/communityStore.ts` — 核心重构
- `src/main/community/health-probe.ts`（或并入现有文件）— 健康探针
- `src/ui/stores/communityStore.test.ts` — 测试扩展

---

### B2：新增顶级「社区」页 + 路由/侧边栏入口 + ThemesPage 迁出

**目标**：用户可在侧边栏看到「社区」入口，点击进入独立主题浏览页。ThemesPage 恢复单Tab。

**串行依赖**：必须 B1 全绿后执行。

```
串行步骤（建议按序执行，但部分组件可并行编写）:

Step 1: 路由层（可单独先做）
  文件: src/ui/types/navigation.ts
  改动: Route 联合新增 'community'
  验证: TypeScript 编译通过

Step 2: App.tsx 路由分支 + 骨架屏
  文件: src/ui/App.tsx
  改动:
    - 新增 `const CommunityPage = lazy(() => import('@/pages/CommunityPage'))`
    - community 分支加入路由渲染
    - RouteAwareSkeleton 新增 'community' 分支
  验证: 编译通过 + 导航跳转无报错

Step 3: ⟷ 新增 CommunityPage 组件
  文件: src/ui/pages/CommunityPage.tsx（新增）
  结构:
    - SourceRail 左侧栏
    - 中央：搜索/排序 + 主题网格（复用 CommunityTabPanel 核心）
    - 右侧：ThemeDetailPanel
    - ErrorBoundary 包裹（§6.1）
    - 空状态组件（§6.3 多级空状态）

Step 4: ⟷ 新增 SourceRail 组件
  文件: src/ui/components/themes/SourceRail.tsx（新增）
  功能:
    - 展示 sources 列表（名称+主题数+status徽标）
    - 单source时视觉弱化为顶部标签
    - ≥2 sources时展开为完整侧边栏
    - source切换时清空搜索词并重置排序
    - 降级/离线徽标（红色/灰色圆点）

Step 5: ⟷ 修改 SourceThemeGrid（从 CommunityTabPanel 抽取重构）
  文件: src/ui/components/themes/SourceThemeGrid.tsx（修改现有或新增）
  改动: 接受 `sourceId` prop，绑定对应 source 的 store 切片

Step 6: 修改 ThemesPage 迁出 community Tab
  文件: src/ui/pages/ThemesPage.tsx
  改动:
    - 删除 Tabs/TabsList/TabsTrigger/TabsContent 结构
    - 删除 CommunityTabPanel import 与使用
    - 保留 installed 网格 + DetailPanel
    - 工具栏保留「浏览社区」入口按钮（跳转 community 路由）
  不变: installed网格、导入拖放、粘贴导入等已安装主题功能

Step 7: 修改 sidebar.tsx 新增 navCommunity
  文件: src/ui/components/sidebar.tsx
  改动: NAV_ICONS 新增 community 条目（Users 图标）
  条件: 新增 navCommunity i18n key（中/英文）

Step 8: SourceDetailPanel（如需要独立于 ThemeDetailPanel）
  文件: src/ui/components/themes/SourceDetailPanel.tsx（可选新增）
  说明: 社区主题详情可能需展示来源信息（作者、评分、截图），可在 ThemeDetailPanel 基础上扩展
```

**B2 校验标准**：

| 层级 | 校验内容 | 通过条件 |
| --- | --- | --- |
| 方案一致性 | CommunityPage 结构、SourceRail、单source弱化、ThemesPage迁至§4.2落地 | 无漏项 |
| 工程正确性 | 所有新增/修改文件 tsc 全绿、Biome 无违规 | `npm run check` 全绿 |
| RFC规范 | ThemesPage 已安装功能不回归、E2E清单≥10项通过 | 手动走查通过 |
| 深度漏检 | 路由回退兼容、搜索词清空切换、source切换加载态展示 | 独立审计通过 |

**B2 产出文件清单**：
- 修改: `src/ui/types/navigation.ts`
- 修改: `src/ui/App.tsx`
- 新增: `src/ui/pages/CommunityPage.tsx`
- 新增: `src/ui/components/themes/SourceRail.tsx`
- 修改或新增: `SourceThemeGrid.tsx`
- 修改: `src/ui/pages/ThemesPage.tsx`
- 修改: `src/ui/components/sidebar.tsx`
- 新增测试: `CommunityPage.test.tsx`（≥5用例）+ ThemesPage测试迁移（≥6用例）

---

### B3：侧边栏可放宽/收起（基于 shellStore 已有基础设施）

**目标**：侧边栏支持 w-14（收起）/ w-48（放宽）两档切换，容纳社区来源子项。

**重要前提**：shellStore 已内置 `sidebarCollapsed` state + `toggleSidebar()` + localStorage 持久化（键名 `agentskin:sidebar-collapsed`）。**B3 不需要新增 store 状态**。

```
⟷ B3.1 sidebar 组件 CSS 变量映射
  文件: src/ui/components/sidebar.tsx
  改动:
    - navbar aside 类名: `w-14` → `w-[var(--sidebar-width,56px)]`
    - 新增 collapse 按钮（chevron 图标），仅在鼠标 hover sidebar 时显示
    - 放宽态（sidebarCollapsed=false）显示完整标签文本
    - 收起态 tooltip 逻辑保留
    - `--sidebar-width` CSS 变量通过 style 注入（来自 shellStore.sidebarCollapsed）

⟷ B3.2 ThemeCard/WallpaperCard 等其他内容区自适应
  文件: 各 page 组件根容器
  改动:
    - margin-left / padding-left 使用 `ml-[var(--sidebar-width,56px)]` 或 flex 自适应
  验证: 所有 7 页面在两档下不溢出

⟷ B3.3 布局断点测试（如用 Playwright / 手动视口）
  测试: 1280x720 / 1920x1080 视口下两档布局不溢出
  验证: sidebarCollapsed localStorage 持久化（关闭再打开保留状态）

⟷ B3.4 i18n 新增 sidebarCollapse 提示文案
  文件: src/shared/i18n/messages（如适用）
```

**B3 校验标准**：

| 层级 | 校验内容 | 通过条件 |
| --- | --- | --- |
| 方案一致性 | CSS变量映射、tooltip/w-48隐藏逻辑、持久化沿用 | 无漏项 |
| 工程正确性 | Biome/Tailwind标准档（w-48合规）、CSS变量无编译报错 | `npm run check` 全绿 |
| RFC规范 | 不修改shellStore状态声明（仅使用已存在）、持久化键名一致 | 检查通过 |
| 深度漏检 | 所有7页面双档布局无溢出、localStorage跨会话保留 | 视口测试通过 |

---

### B4：接入 CodeDrobe source（复用解析器 + 新 api client）

**目标**：社区页展示至少2个source（DreamSkin + CodeDrobe 或 占位「即将接入」），验证 source 抽象的扩展能力。

**串行依赖**：必须 B1-B3 全绿后执行。

```
⟷ B4.1 CodeDrobe API Client（main 进程）
  文件: src/main/community/codedrobe-api.ts（新增，如 CodeDrobe 有公开 API）
  或
  文件: src/community/sources/codedrobe-source.ts（无公开 API 时，仅注册占位）
  说明: 若 CodeDrobe 无公开 API，则注册为 offline 占位 source，展示「即将接入」

⟷ B4.2 注册 codedrobe source
  文件: src/community/sources/registry.ts（新增 registry）或 communityStore.ts
  改动:
    - 登记 codedrobeSource（DreamSkin + CodeDrobe 两个实例）
    - 首页 SourceRail 展示双 source

⟷ B4.3 离线降级展示测试
  验证:
    - CodeDrobe offline 时显示降级徽标
    - 不影响 DreamSkin 展示
    - 用户可点击 DreamSkin 正常浏览
```

**B4 校验标准**：

| 层级 | 校验内容 | 通过条件 |
| --- | --- | --- |
| 方案一致性 | Source注册≥2、单source故障隔离、降级展示 | 无漏项 |
| 工程正确性 | TypeScript全绿、parser注册表无误 | `npm run check` 全绿 |
| RFC规范 | DreamSkin用户行为不受CodeDrobe影响 | 测试通过 |
| 深度漏检 | CodeDrobe离线时不影响核心功能、来源追溯完整 | 独立审计通过 |

---

## C. 交叉评审机制

每批次执行Agent完成后，评审Agent专项核对：

| 核对项 | 内容 |
| --- | --- |
| 是否严格复刻RFC | 逐文件比对设计方案 vs 落地代码 |
| 有无落地损耗 | 缓存TTL降级、边界条件空实现、错误提示缺失误 |
| 有无私自增减改动 | 设计外的新增代码需标记并获确认 |
| 能力保留 | 验证短期根治能力（多source隔离）+ 长期演进能力（新source零代码接入） |

所有落地偏差须修复闭环后方可进入下一批次。

---

## D. 全局交付规范

阶段二完成后，输出以下成果：

### D1 完整落地成果

- [ ] 所有 RFC §4-§9 设计要求 100% 落地
- [ ] 100% 对齐最优方案（RFC v2）、符合 RFC 规范、无落地偏差
- [ ] 测试覆盖率：社区 store ≥15 用例、新页面 ≥5 用例、迁移页面保留 ≥6 用例
- [ ] `npm run check` 全绿（tsc/biome/test）

### D2 全量风险清单

详见 RFC §8 + 落地过程中发现的额外风险，如实公示。

### D3 分级下一步行动

| 优先级 | 行动 | 说明 |
| --- | --- | --- |
| 立即执行 | CR 评审 + 合入 | 4批次完成后提交合并请求 |
| 后续迭代 | CodeDrobe 真实API接入 | B4 占位待 API 公开后实现 |
| 后续迭代 | 跨源去重过滤器（可选） | 按§4.5不纳入本RFC |
| 舍弃 | 方案A/C 相关设计文档 | 不保留临时方案痕迹 |

---

## E. 执行启动 Checklist

开始 B1 前确认：

- [ ] RFC `2026-09-04-community-multi-source-page.md` 评审通过
- [ ] 当前工作分支 clean（无未提交改动）
- [ ] 确认无外部会话冲突文件（与 preview-cache.ts 改动协调）
- [ ] `npm run check` 在 main 分支全绿（建立基线）
- [ ] 创建特性分支 `feat/community-multi-source` 或类似命名

---

*本执行计划仅为规划文档，具体实施需逐批次按四层校验推进。*
