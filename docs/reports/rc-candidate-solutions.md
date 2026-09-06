# 12 根因候选方案矩阵

> 生成日期: 2026-08-29
> 范围: AgentSkin 项目 12 根因（RC1-RC12）候选方案
> 根因来源: 巡检报告系列（方向 A-J）

---

## RC1: Design-token 违规（硬编码 hex/rgba）

**现状**: 5 处硬编码颜色值绕过 CSS custom property 契约：
- `CenterTabThemeEditor.tsx:390` — `#0a0a10` 作为背景兜底
- `PreviewWindow.tsx` — `#888` 作为中性色
- `inspector-element.tsx:209,218` — `rgba(234,88,12,0.4)` / `rgba(59,130,246,0.3)` 作为 box model 标注色
- `TemplatePicker.tsx:234-235` — `#888` / `#fff` 作为 swatch 对比色

违反项目规则 §7 黄金规则第 6 条 + C6 不变量。

---

### 方案 A: 直接迁移到 CSS 变量

**核心策略**: 将每个硬编码值替换为 `var(--agentskin-*)` 或 `var(--*)` 中已有的语义变量；缺失的变量在 `globals.css` 中补充定义。

**影响范围**:
- `src/ui/globals.css`（新增 2-3 个变量）
- `src/ui/components/studio/center/CenterTabThemeEditor.tsx`
- `src/ui/components/studio/PreviewWindow.tsx`
- `src/ui/components/studio/inspector-element.tsx`
- `src/ui/components/studio/TemplatePicker.tsx`

**优点**:
1. 完全符合 C6 不变量，消除所有硬编码颜色
2. 改动量小、风险低，每个替换独立可验证

**缺点**:
1. 需要为 box model 标注色等新增 CSS 变量，略微扩大变量表
2. 某些 rgba 半透明值需要拆分为 `color-mix` 或新增 `--*-alpha` 变量

**风险**:
- 新增变量可能与已有命名冲突，需 check-design-tokens 验证

**实施成本**: 5 文件 / ~25 行改动 / 复杂度 S

**长期价值**: 彻底消除此类违规，check-design-tokens 脚本可自动捕获回归

**回归验证**: `npm run check` 全绿（含 check-design-tokens）；视觉回归对比截图

**回滚方式**: git revert 单文件即可

---

### 方案 B: 通过 design/colors.ts 中转

**核心策略**: 在 `design/colors.ts` 中定义 JS 侧颜色常量，组件从该模块引用而非 CSS 变量。inline style 使用常量，className 使用 CSS 变量。

**影响范围**:
- `src/ui/design/colors.ts`（新增常量）
- 同方案 A 的 4 个组件文件

**优点**:
1. JS 内联场景有单一数据来源，与 CSS 变量保持同步
2. 未来新增内联颜色只需改一处

**缺点**:
1. 引入第二来源（JS 常量 + CSS 变量），维护两处同步
2. 违反"所有颜色必须通过 CSS custom properties"规则的精神

**风险**:
- JS 常量与 CSS 变量可能不同步，产生新的维护负担

**实施成本**: 5 文件 / ~35 行 / 复杂度 S

**长期价值**: 中等——解决内联场景但引入双源问题

**回归验证**: `npm run check` + 手动验证 inline 颜色与 CSS 变量一致

**回滚方式**: 删除 design/colors.ts 新增常量，还原组件引用

---

### 方案 C: 提取 Studio 局部变量层

**核心策略**: 在 `src/ui/components/studio/` 下新建 `studio-tokens.css`，定义 Studio 专有的标注色/中性色变量，组件引用该局部变量层。

**影响范围**:
- `src/ui/components/studio/studio-tokens.css`（新建）
- `src/ui/globals.css`（@import 局部层）
- 同方案 A 的 4 个组件文件

**优点**:
1. Studio 特有变量不污染全局 globals.css
2. 局部变量层可独立扩展，不影响其他页面

**缺点**:
1. 新增文件增加架构复杂度
2. 局部变量与全局变量的边界需文档化

**风险**:
- 局部变量可能被误用于非 Studio 场景

**实施成本**: 6 文件 / ~40 行 / 复杂度 M

**长期价值**: 高——为 Studio 组件建立独立的 token 层，可扩展性好

**回归验证**: `npm run check` + 确认变量仅被 Studio 组件引用

**回滚方式**: 删除 studio-tokens.css，组件还原为全局变量引用

---

## RC2: 类型安全失效（as unknown as 双断言）

**现状**: 7 处 `as unknown as SomeType` 绕过类型检查：
- `StudioImageToThemePanel.tsx:311` — `imageToThemePalette as unknown as Record<string, string>`
- `NativeProfilePanel.tsx:46` — IPC 返回值双断言
- `capture-store.ts:164` — `finalPalette as unknown as Record<string, string>`
- `image-wallpaper-store.ts` — 类型不匹配
- 测试文件：`WorkspacePage.test.tsx:83`, `ThemesPage.test.tsx:197`, `apply-result.test.ts:100`

---

### 方案 A: 类型守卫 + satisfies 替换

**核心策略**: 为每个双断言场景编写类型守卫函数（type guard），用运行时检查替代编译期绕过；对象字面量使用 `satisfies` 关键字。

**影响范围**:
- `src/ui/components/studio/StudioImageToThemePanel.tsx`
- `src/ui/components/studio/NativeProfilePanel.tsx`
- `src/ui/studio/capture-store.ts`
- `src/ui/studio/image-wallpaper-store.ts`
- `src/ui/hooks/apply-result.test.ts`
- `src/ui/pages/WorkspacePage.test.tsx`
- `src/ui/pages/ThemesPage.test.tsx`
- `src/shared/types/`（可能新增类型守卫工具）

**优点**:
1. 运行时安全 + 编译期类型完整，双保险
2. 类型守卫可复用，覆盖同类场景

**缺点**:
1. 需要为每个场景编写守卫函数，代码量增加
2. 守卫函数本身需要测试覆盖

**风险**:
- 守卫逻辑可能与实际数据不匹配，导致运行时异常

**实施成本**: 8 文件 / ~80 行 / 复杂度 M

**长期价值**: 高——建立类型安全文化，消除 `as unknown as` 模式

**回归验证**: `npx tsc --noEmit` 0 错误 + `npm test` 全绿

**回滚方式**: 逐个文件还原为原始断言

---

### 方案 B: 修正源头类型定义

**核心策略**: 追溯每个双断言的根源——通常是接口/类型定义过严或过松——修正源头类型使调用方无需断言。

**影响范围**:
- `src/shared/types/index.ts`（修正 ThemeColorsFromImage 等接口）
- `src/shared/types/ipc.ts`（修正 IPC 返回类型）
- `src/ui/studio/capture-store.ts`
- `src/ui/studio/image-wallpaper-store.ts`
- 同上组件文件

**优点**:
1. 治本：消除断言需求而非绕过
2. 类型定义更准确，惠及所有调用方

**缺点**:
1. 需要深入理解每个类型的语义边界
2. 修正源头类型可能影响其他调用方

**风险**:
- 类型放宽过度会掩盖真正的类型错误

**实施成本**: 6 文件 / ~50 行 / 复杂度 M

**长期价值**: 最高——类型系统健康度根本性提升

**回归验证**: `npx tsc --noEmit` + 全量测试 + 检查其他调用方无回归

**回滚方式**: 还原类型定义 + 恢复断言

---

### 方案 C: 测试侧用 Partial/Stub 类型替代

**核心策略**: 仅针对测试文件中的双断言，使用 `Partial<T>` 或 `satisfies Partial<T>` 替代 `as unknown as T`，降低测试 mock 的类型压力。

**影响范围**:
- `src/ui/pages/WorkspacePage.test.tsx`
- `src/ui/pages/ThemesPage.test.tsx`
- `src/ui/hooks/apply-result.test.ts`
- `src/ui/components/studio/center/CenterTabThemeEditor.test.tsx`
- `src/ui/components/studio/center/ExtendedColorsEditor.test.tsx`
- `src/ui/components/studio/__tests__/inspector-element.test.tsx`
- `src/ui/components/studio/__tests__/StudioDrawer.test.tsx`
- `src/ui/components/studio/__tests__/StudioImageToThemePanel.test.tsx`
- `src/ui/components/studio/__tests__/StudioInspector.test.tsx`

**优点**:
1. 测试文件改动集中，不影响生产代码
2. `Partial<T>` 是标准 TypeScript 模式，可读性好

**缺点**:
1. 不解决生产代码中的双断言
2. 测试 mock 仍可能遗漏必要字段

**风险**:
- 测试与生产代码的类型安全水平不一致

**实施成本**: 9 文件 / ~30 行 / 复杂度 S

**长期价值**: 中等——仅解决测试侧，生产代码仍需后续处理

**回归验证**: `npx tsc --noEmit` + `npm test`

**回滚方式**: 还原测试文件中的断言

---

## RC3: 测试覆盖缺失（核心分支零覆盖）

**现状**: 8 处核心逻辑零测试：
- `TransformSection` API 调用路径
- `renameProject` rollback 分支
- `exportTheme` error 处理
- `file-too-large` 分支
- `Apply button` 点击逻辑
- `extracting && file` 状态渲染

---

### 方案 A: 按组件补全测试（逐文件推进）

**核心策略**: 对每个零覆盖组件/方法，新建或扩展测试文件，覆盖所有分支路径。

**影响范围**:
- `src/ui/components/studio/__tests__/inspector-element.test.tsx`（扩展）
- `src/ui/components/studio/__tests__/StudioImageToThemePanel.test.tsx`（扩展）
- `src/ui/studio/__tests__/project-store.test.ts`（新建 renameProject 测试）
- `src/ui/studio/__tests__/capture-store.test.ts`（扩展）

**优点**:
1. 每个测试文件独立，可并行开发
2. 覆盖率高，直接针对缺失分支

**缺点**:
1. 需要 mock 多个外部依赖（api, notificationStore 等）
2. 测试文件数量增加，维护成本上升

**风险**:
- mock 过度导致测试变成"验证 mock 被调用"而非验证逻辑

**实施成本**: 4 文件 / ~200 行 / 复杂度 M

**长期价值**: 高——建立核心路径回归保护网

**回归验证**: `npm test` 全绿 + 覆盖率报告确认新增分支覆盖

**回滚方式**: 删除新增测试用例

---

### 方案 B: 集成测试优先——真实 store + mock IPC

**核心策略**: 使用真实 Zustand store + 仅 mock IPC 层（api 客户端），编写集成测试覆盖完整用户流程。

**影响范围**:
- 同上 + `src/ui/studio/__tests__/integration-*.test.ts`（新建）

**优点**:
1. 测试更接近真实运行场景，捕获 store 间交互问题
2. 减少 mock 维护成本

**缺点**:
1. 集成测试运行更慢
2. 失败时定位问题更难

**风险**:
- 集成测试可能因 Electron 环境依赖而无法在 CI 运行

**实施成本**: 5 文件 / ~250 行 / 复杂度 L

**长期价值**: 最高——集成测试保护核心用户流程

**回归验证**: `npm test` 全绿 + 手动验证测试覆盖真实路径

**回滚方式**: 删除集成测试文件

---

### 方案 C: 参数化测试 + 表格驱动

**核心策略**: 对同类分支（如 error/loading/success 状态）使用 `it.each` 参数化测试，一行定义覆盖多状态。

**影响范围**:
- 同方案 A 的测试文件

**优点**:
1. 代码量最少，覆盖密度最高
2. 新增状态只需添加一行参数

**缺点**:
1. 参数化测试可读性稍差
2. 不适合复杂交互流程

**风险**:
- 过度参数化导致测试意图不清晰

**实施成本**: 4 文件 / ~120 行 / 复杂度 S

**长期价值**: 高——参数化模式可复用于其他组件

**回归验证**: `npm test` 全绿 + 确认每个参数独立执行

**回滚方式**: 删除参数化测试块

---

## RC4: 测试质量薄弱（假断言/弱断言/partial mock）

**现状**: 9 处测试质量问题：
- `as unknown as UiMessages` mock
- `toHaveProperty` 仅检查存在性
- `typeof toBe('function')` 弱断言
- `mutable let` mock 状态泄漏

---

### 方案 A: 假断言专项清理 + 强断言替换

**核心策略**: 逐文件扫描假断言模式，替换为验证具体行为/值的强断言。

**影响范围**:
- 散布在 10+ 测试文件中

**优点**:
1. 直接提升测试可信度
2. 每个替换独立，可分批进行

**缺点**:
1. 需要理解每个测试的真实意图
2. 工作量大，ROI 分散

**风险**:
- 替换后的强断言可能因 mock 不完整而失败

**实施成本**: 12 文件 / ~150 行 / 复杂度 M

**长期价值**: 高——测试真正具备回归捕获能力

**回归验证**: `npm test` 全绿 + 人为制造 bug 确认测试能捕获

**回滚方式**: 还原为原始断言

---

### 方案 B: Mock 工厂函数集中化

**核心策略**: 将分散的 mock 对象创建提取到共享工厂函数，确保 mock 完整性和一致性。

**影响范围**:
- `src/ui/studio/test-helpers/`（新建）
- 各测试文件引用工厂

**优点**:
1. 消除 mock 不完整问题
2. 新增测试自动获得完整 mock

**缺点**:
1. 工厂函数需要随接口变化维护
2. 初始提取工作量大

**风险**:
- 工厂函数可能与实际接口脱节

**实施成本**: 15 文件 / ~200 行 / 复杂度 L

**长期价值**: 最高——mock 质量系统性提升

**回归验证**: `npm test` 全绿 + 接口变更时工厂同步更新

**回滚方式**: 删除工厂函数，还原各文件内联 mock

---

### 方案 C: ESLint/Biome 规则自动检测假断言

**核心策略**: 配置 lint 规则检测 `expect(true).toBe(true)`、`typeof x` 等假断言模式。

**影响范围**:
- `.biome.json` 或 eslint 配置
- CI 配置

**优点**:
1. 自动防止新增假断言
2. 零人工审查成本

**缺点**:
1. 不修复存量假断言
2. 自定义规则开发成本高

**风险**:
- 规则可能误报合法测试模式

**实施成本**: 2 文件 / ~30 行 + 规则开发 / 复杂度 M

**长期价值**: 高——自动化守门

**回归验证**: lint 规则对假断言样本触发告警

**回滚方式**: 移除 lint 规则配置

---

## RC5: 性能热点

**现状**: 3 处性能问题：
- `rotateHueN` O(n) 色相旋转（每步一次 hex→hsl→hex 往返）
- `TemplatePicker` N+1 IPC 调用
- `buildCombinedState` 每次渲染创建新对象

---

### 方案 A: 算法优化 + 记忆化

**核心策略**: `rotateHueN` 改为直接计算最终角度（`steps * 30`）一次旋转；`TemplatePicker` 添加请求去重/缓存；`buildCombinedState` 已用 `useMemo` 但可进一步优化依赖。

**影响范围**:
- `src/ui/components/studio/center/CenterTabThemeEditor.tsx`（rotateHueN）
- `src/ui/components/studio/TemplatePicker.tsx`（IPC 去重）
- `src/ui/studio/useStudioStore.ts`（buildCombinedState）

**优点**:
1. 根本性消除性能瓶颈
2. 算法优化不增加架构复杂度

**缺点**:
1. `rotateHueN` 优化需验证与逐次旋转的视觉效果一致性
2. IPC 缓存需要失效策略

**风险**:
- 一次旋转与逐次旋转在色相环绕时可能有微小差异

**实施成本**: 3 文件 / ~40 行 / 复杂度 S

**长期价值**: 高——消除 O(n) 浪费，用户体验更流畅

**回归验证**: 性能基准测试（旋转 1000 次计时）+ 视觉对比截图 + `npm test`

**回滚方式**: 还原为原始实现

---

### 方案 B: Web Worker 卸载计算

**核心策略**: 将 `rotateHueN` 和 `buildCombinedState` 中的重计算移至 Web Worker 线程。

**影响范围**:
- 新建 `src/ui/workers/color-worker.ts`
- 修改 `CenterTabThemeEditor.tsx` 和 `useStudioStore.ts`

**优点**:
1. 主线程不阻塞，UI 保持响应
2. 可处理更大规模的计算

**缺点**:
1. 增加架构复杂度（Worker 通信序列化）
2. 对于当前数据规模属于过度工程

**风险**:
- Worker 通信延迟可能抵消计算收益

**实施成本**: 4 文件 / ~100 行 / 复杂度 L

**长期价值**: 中等——为未来更大规模计算预留能力

**回归验证**: 主线程帧率测试 + `npm test`

**回滚方式**: 删除 Worker 文件，还原为同步计算

---

### 方案 C: 虚拟滚动 + 懒渲染

**核心策略**: 对 `TemplatePicker` 的卡片网格使用虚拟滚动，仅渲染可视区域内的卡片，IPC 请求按需触发。

**影响范围**:
- `src/ui/components/studio/TemplatePicker.tsx`
- 可能引入 `@tanstack/react-virtual` 或类似

**优点**:
1. 大幅减少初始渲染量和 IPC 调用
2. 模板数量增长时性能不退化

**缺点**:
1. 引入新依赖（违反技术栈规则）
2. 虚拟滚动增加 DOM 复杂度

**风险**:
- 滚动体验可能与原生不一致

**实施成本**: 2 文件 / ~60 行 + 1 新依赖 / 复杂度 M

**长期价值**: 高——支持模板数量无限增长

**回归验证**: 大模板数量下帧率测试 + `npm test`

**回滚方式**: 移除虚拟滚动，还原为全量渲染

---

## RC6: React 渲染期副作用

**现状**: 2 处渲染期副作用：
- `actionsRef.current = getState()` 在 render 函数体内执行
- `subscribe` 回调中 `prevRef` 可能持有过期引用

---

### 方案 A: useEffect 同步 ref

**核心策略**: 将 `actionsRef.current = getState()` 从 render 体移入 `useEffect`，确保副作用在提交后执行。

**影响范围**:
- `src/ui/studio/useStudioStore.ts`

**优点**:
1. 符合 React 最佳实践
2. 改动极小，风险最低

**缺点**:
1. ref 更新延迟一帧（通常无影响）
2. 需要验证所有依赖 ref 的消费者不受影响

**风险**:
- 某些场景可能依赖 ref 在 render 期间同步更新

**实施成本**: 1 文件 / ~5 行 / 复杂度 S

**长期价值**: 高——消除 StrictMode 下的双重渲染隐患

**回归验证**: `npm test` + React StrictMode 下运行无警告

**回滚方式**: 还原为 render 体内赋值

---

### 方案 B: useSyncExternalStore 替代手动订阅

**核心策略**: 使用 React 18+ 的 `useSyncExternalStore` 替代手动 `subscribe` + `useRef` 模式。

**影响范围**:
- `src/ui/studio/useStudioStore.ts`

**优点**:
1. React 官方推荐的外部 store 订阅方式
2. 自动处理 tearing 和过期引用问题

**缺点**:
1. 需要重构 store 的 subscribe 接口
2. 对 Zustand store 的集成需要适配层

**风险**:
- `useSyncExternalStore` 的 getSnapshot 必须返回稳定引用

**实施成本**: 1 文件 / ~30 行 / 复杂度 M

**长期价值**: 最高——使用 React 官方并发安全 API

**回归验证**: `npm test` + React StrictMode + 并发渲染测试

**回滚方式**: 还原为手动订阅模式

---

### 方案 C: 拆分 actionsRef 为独立 hook

**核心策略**: 将 actions 缓存逻辑提取为 `useStudioActions` 自定义 hook，内部使用 `useMemo` + `useRef` 正确管理。

**影响范围**:
- `src/ui/studio/useStudioStore.ts`
- 可能新建 `src/ui/studio/hooks/useStudioActions.ts`

**优点**:
1. 关注点分离，主 hook 更简洁
2. actions 缓存逻辑可独立测试

**缺点**:
1. 新增文件/抽象层
2. 消费者需要从新的 hook 导入

**风险**:
- 过度抽象增加理解成本

**实施成本**: 2 文件 / ~40 行 / 复杂度 M

**长期价值**: 中等——代码组织更清晰

**回归验证**: `npm test` + 确认所有 actions 消费者无回归

**回滚方式**: 合并 hook 回主文件

---

## RC7: 模块级可变状态泄漏

**现状**: 4 处模块级可变状态：
- `wallpaperPreviewTimer` (image-wallpaper-store.ts:46)
- `busyLocks` Set (capture-store.ts:58)
- `undoCoalesce` 对象 (capture-store.ts:74)
- `_activeProjectCache` (project-store.ts:39)

---

### 方案 A: 迁移到 Zustand store 内部状态

**核心策略**: 将模块级变量移入对应 Zustand store 的 state 接口，利用 store 的生命周期管理。

**影响范围**:
- `src/ui/studio/image-wallpaper-store.ts`
- `src/ui/studio/capture-store.ts`
- `src/ui/studio/project-store.ts`

**优点**:
1. 状态生命周期与 store 绑定，无泄漏
2. 可测试性提升（通过 store API 访问）

**缺点**:
1. store 接口变大，state 字段增多
2. 某些"私有"状态暴露为 store 内部

**风险**:
- 消费者可能误用内部状态字段

**实施成本**: 3 文件 / ~60 行 / 复杂度 M

**长期价值**: 高——消除模块级状态，统一生命周期管理

**回归验证**: `npm test` + 确认多实例场景下状态隔离

**回滚方式**: 还原为模块级变量

---

### 方案 B: 闭包封装 + 符号导出

**核心策略**: 使用 IIFE 或闭包封装可变状态，仅通过受控 API 访问，不暴露状态本身。

**影响范围**:
- 同方案 A 的 3 个文件

**优点**:
1. 状态完全私有，无法从外部访问
2. 不改变 store 接口

**缺点**:
1. 调试困难（DevTools 不可见）
2. 闭包模式在 TypeScript 中表达不够直观

**风险**:
- 内存泄漏（闭包引用无法释放）

**实施成本**: 3 文件 / ~50 行 / 复杂度 M

**长期价值**: 中等——状态封装但调试困难

**回归验证**: `npm test` + 长时间运行无内存增长

**回滚方式**: 还原为模块级变量

---

### 方案 C: WeakRef/FinalizationRegistry 自动清理

**核心策略**: 使用 `WeakRef` 包装缓存状态，配合 `FinalizationRegistry` 在 store 实例被 GC 时自动清理。

**影响范围**:
- 同方案 A 的 3 个文件
- 可能新建 `src/ui/studio/lib/weak-cache.ts`

**优点**:
1. 自动内存管理，无泄漏风险
2. 现代 JavaScript 特性，性能优

**缺点**:
1. `WeakRef` 行为依赖 GC 时机，不可预测
2. 调试和测试困难
3. 增加代码复杂度

**风险**:
- GC 时机不确定可能导致缓存过早失效

**实施成本**: 4 文件 / ~80 行 / 复杂度 L

**长期价值**: 中等——技术先进但实用性存疑

**回归验证**: 内存泄漏测试 + `npm test`

**回滚方式**: 还原为强引用

---

## RC8: 错误处理缺失

**现状**: 3 处错误处理缺失：
- `TransformSection` IPC 调用无 try-catch
- `refreshEntry` 无错误处理
- `NativeProfilePanel.buildNativeProfile` 无错误边界

---

### 方案 A: 统一 try-catch + 错误状态

**核心策略**: 为每个异步操作添加 try-catch，错误通过 notificationStore 或 local state 展示。

**影响范围**:
- `src/ui/components/studio/inspector-element.tsx`
- `src/ui/components/studio/NativeProfilePanel.tsx`
- `src/ui/components/studio/TransformSection`（如存在独立文件）

**优点**:
1. 用户可见错误反馈
2. 改动量小，每个操作独立处理

**缺点**:
1. 错误处理逻辑重复
2. 需要为每个组件添加 error state

**风险**:
- 错误信息可能不够友好

**实施成本**: 3 文件 / ~50 行 / 复杂度 S

**长期价值**: 高——用户体验提升，错误可观测

**回归验证**: `npm test` + 模拟 IPC 失败确认错误展示

**回滚方式**: 移除 try-catch，还原为无处理

---

### 方案 B: 错误边界 + 集中式错误处理

**核心策略**: 创建 Studio 级 ErrorBoundary 组件，配合全局错误处理 hook，集中捕获和展示错误。

**影响范围**:
- `src/ui/components/studio/ErrorBoundary.tsx`（新建或扩展）
- `src/ui/studio/hooks/useErrorHandler.ts`（新建）
- 同上组件文件

**优点**:
1. 统一错误 UI/UX
2. 组件内无需重复 try-catch

**缺点**:
1. ErrorBoundary 无法捕获异步错误（需配合 state）
2. 初始搭建成本较高

**风险**:
- 错误边界粒度不当可能过度渲染 fallback UI

**实施成本**: 5 文件 / ~100 行 / 复杂度 M

**长期价值**: 最高——建立统一错误处理体系

**回归验证**: `npm test` + 模拟各类错误确认捕获和展示

**回滚方式**: 移除 ErrorBoundary 和 hook

---

### 方案 C: Result 类型 + 模式匹配

**核心策略**: 定义 `Result<T, E>` 类型，所有异步操作返回 Result，调用方通过模式匹配处理成功/失败。

**影响范围**:
- `src/shared/types/result.ts`（新建）
- 同上组件文件
- 可能影响 IPC 层类型

**优点**:
1. 类型安全：编译期强制处理错误
2. 无遗漏的错误处理

**缺点**:
1. 需要修改现有函数签名
2. 团队需要学习 Result 模式

**风险**:
- 过度工程化，简单场景不需要 Result 类型

**实施成本**: 6 文件 / ~120 行 / 复杂度 L

**长期价值**: 高——函数式错误处理范式

**回归验证**: `npx tsc --noEmit` + `npm test` + 确认所有调用方处理 Result

**回滚方式**: 还原函数签名，移除 Result 类型

---

## RC9: 重复代码

**现状**: 3 处重复代码：
- `FileInfoCard` markup 在 `StudioImageToThemePanel` 中重复（extracting 状态 vs file-selected idle 状态）
- `hexToRgbDisplay` 与 `harmony.ts` 中逻辑重复

---

### 方案 A: 提取共享组件/函数

**核心策略**: 将重复的 markup 提取为 `FileInfoCard` 组件，将 `hexToRgbDisplay` 逻辑统一到 `harmony.ts` 或 `color-utils.ts`。

**影响范围**:
- `src/ui/components/studio/StudioImageToThemePanel.tsx`
- `src/ui/components/studio/FileInfoCard.tsx`（新建）
- `src/ui/components/studio/harmony.ts` 或 `src/shared/color/`

**优点**:
1. 单一来源，修改只需一处
2. 组件可独立测试

**缺点**:
1. 新增文件增加项目体积
2. 提取可能引入不必要的抽象

**风险**:
- 过度抽象导致组件 props 过多

**实施成本**: 3 文件 / ~60 行 / 复杂度 S

**长期价值**: 高——DRY 原则，维护成本降低

**回归验证**: `npm test` + 视觉回归对比

**回滚方式**: 删除提取的组件/函数，还原为内联代码

---

### 方案 B: 渲染函数 + 配置驱动

**核心策略**: 将重复的 UI 模式定义为渲染函数，通过配置参数区分差异。

**影响范围**:
- `src/ui/components/studio/StudioImageToThemePanel.tsx`

**优点**:
1. 不新增文件，改动集中
2. 配置驱动灵活

**缺点**:
1. 渲染函数增加组件内部复杂度
2. 配置参数可能膨胀

**风险**:
- 渲染函数降低 JSX 可读性

**实施成本**: 1 文件 / ~30 行 / 复杂度 S

**长期价值**: 中等——减少重复但增加组件复杂度

**回归验证**: `npm test` + 确认两种状态下 UI 一致

**回滚方式**: 还原为原始 JSX

---

### 方案 C: 组合模式（Compound Component）

**核心策略**: 将 FileInfoCard 设计为组合组件（Root + Preview + Info + Actions），消费方按需组合。

**影响范围**:
- `src/ui/components/studio/FileInfoCard/`（新建目录）
- `src/ui/components/studio/StudioImageToThemePanel.tsx`

**优点**:
1. 最大灵活性，支持多种使用场景
2. 符合 React 组合模式最佳实践

**缺点**:
1. 对于当前两种使用场景属于过度设计
2. 文件数增加，理解成本上升

**风险**:
- 组合模式在小场景下显得笨重

**实施成本**: 4 文件 / ~100 行 / 复杂度 M

**长期价值**: 中等——扩展性好但当前场景不需要

**回归验证**: `npm test` + 确认两种使用场景渲染正确

**回滚方式**: 删除组合组件目录，还原为内联 JSX

---

## RC10: 未消费状态/桩实现

**现状**: 3 处未消费状态/桩实现：
- `hueOffsets` 状态已定义但从未 commit 到持久化
- `domTree={null}` 桩传参
- `resetAll` 死代码（仅测试调用）

---

### 方案 A: 移除死代码 + 补齐缺失逻辑

**核心策略**: 删除 `resetAll`（仅测试使用则迁移到测试内部）；补齐 `hueOffsets` 的持久化逻辑；`domTree={null}` 改为条件渲染。

**影响范围**:
- `src/ui/studio/image-wallpaper-store.ts`
- `src/ui/components/studio/center/CenterTabThemeEditor.tsx`
- `src/ui/components/studio/InspectorProfile.tsx`
- `src/ui/studio/__tests__/image-wallpaper-store.test.ts`

**优点**:
1. 代码更精简，无歧义
2. `hueOffsets` 补齐后功能更完整

**缺点**:
1. `hueOffsets` 持久化需要设计存储位置
2. 删除 `resetAll` 需修改测试

**风险**:
- 删除可能影响未发现的消费者

**实施成本**: 4 文件 / ~40 行 / 复杂度 S

**长期价值**: 高——代码精简 + 功能完整

**回归验证**: `npm test` + 确认无其他调用方

**回滚方式**: git revert

---

### 方案 B: 标记 @deprecated + 计划性移除

**核心策略**: 对死代码添加 `@deprecated` JSDoc 标签，在下一个版本中移除；`hueOffsets` 添加 TODO 注释标记待补齐。

**影响范围**:
- 同方案 A 的文件

**优点**:
1. 不破坏现有功能
2. 团队知晓移除计划

**缺点**:
1. 代码仍包含死逻辑
2. 需要跟踪 TODO

**风险**:
- @deprecated 可能永远不被移除

**实施成本**: 3 文件 / ~10 行 / 复杂度 S

**长期价值**: 低——延迟问题而非解决

**回归验证**: `npm run check` 无新增警告

**回滚方式**: 移除 @deprecated 注释

---

### 方案 C: 功能补齐（hueOffsets → 持久化 + UI 提交按钮）

**核心策略**: 不仅修复问题，还补齐功能——为 `hueOffsets` 添加"应用色相偏移"按钮和持久化逻辑，使其成为完整功能。

**影响范围**:
- `src/ui/components/studio/center/CenterTabThemeEditor.tsx`
- `src/ui/studio/capture-store.ts` 或 `project-store.ts`
- `src/ui/studio/image-wallpaper-store.ts`（清理 resetAll）

**优点**:
1. 化问题为机会，提升产品能力
2. 用户可保存自定义色相偏移

**缺点**:
1. 功能范围扩大，需要产品设计确认
2. 持久化存储位置需设计

**风险**:
- 功能需求未经用户验证

**实施成本**: 4 文件 / ~80 行 / 复杂度 M

**长期价值**: 高——从修复到功能增强

**回归验证**: `npm test` + 用户验收测试

**回滚方式**: 移除新增按钮和持久化逻辑

---

## RC11: 魔法数字

**现状**: 5 处魔法数字：
- `rotateHue` 默认 30°
- `UNDO_COALESCE_MS` 700
- `UNDO_LIMIT` 30
- `radiusSm = rScale - 1`, `radiusLg = rScale + 4`
- `durNormal = Math.max(durNum * 2, 50)`

---

### 方案 A: 命名常量提取

**核心策略**: 将每个魔法数字提取为模块级 `const` 常量，附带注释说明含义和选择依据。

**影响范围**:
- `src/ui/components/studio/center/CenterTabThemeEditor.tsx`
- `src/ui/studio/capture-store.ts`
- `scripts/design-language.mjs`

**优点**:
1. 改动最小，风险最低
2. 常量名自文档化

**缺点**:
1. 常量散布在各模块中
2. 无法形成统一的 token 体系

**风险**:
- 常量命名不当反而降低可读性

**实施成本**: 3 文件 / ~20 行 / 复杂度 S

**长期价值**: 中等——消除魔法数字但缺乏体系

**回归验证**: `npm run check` + `npm test`

**回滚方式**: 还原为字面量

---

### 方案 B: 设计 token 集中注册

**核心策略**: 在 `scripts/design-language.mjs` 或新建 `src/shared/design-constants.ts` 中集中定义所有魔法数字为命名导出。

**影响范围**:
- `src/shared/design-constants.ts`（新建）或 `scripts/design-language.mjs`
- 同上组件/store 文件

**优点**:
1. 单一数据来源，便于全局调整
2. 与设计系统 token 对齐

**缺点**:
1. 新增文件增加导入链路
2. 部分常量仅在一处使用，集中化收益不大

**风险**:
- 过度集中导致文件膨胀

**实施成本**: 4 文件 / ~40 行 / 复杂度 S

**长期价值**: 高——建立设计常量体系

**回归验证**: `npm run check` + `npm test`

**回滚方式**: 删除常量文件，还原为模块内常量

---

### 方案 C: 配置对象 + 默认值

**核心策略**: 将相关魔法数字组织为配置对象（如 `UNDO_CONFIG = { coalesceMs: 700, limit: 30 }`），通过解构默认值使用。

**影响范围**:
- 同方案 A

**优点**:
1. 相关常量分组，语义更清晰
2. 便于整体覆盖配置

**缺点**:
1. 解构语法增加代码量
2. 对于独立常量显得冗余

**风险**:
- 配置对象可能被误修改

**实施成本**: 3 文件 / ~25 行 / 复杂度 S

**长期价值**: 中等——组织化但增加复杂度

**回归验证**: `npm test` + 确认配置对象不可变

**回滚方式**: 还原为独立常量或字面量

---

## RC12: 组件归属边界不清

**现状**: 2 处边界问题：
- `FloatingToolbar` 未出现在 component-inventory checklist 的"需确认"列表中
- `DomHighlight` 位于 `components/studio/` 但被 `PreviewWindow` 使用，职责边界模糊

---

### 方案 A: 重命名 + 文档化归属

**核心策略**: 保持现有文件位置，更新 INDEX.md 和 component-inventory 明确标注归属和消费者关系。

**影响范围**:
- `src/ui/INDEX.md`
- `docs/reports/component-inventory-2026-08-26.md`

**优点**:
1. 零代码改动，纯文档化
2. 快速解决归属不清问题

**缺点**:
1. 不解决物理位置与逻辑归属的不一致
2. 文档可能与代码实际脱节

**风险**:
- 文档更新不及时

**实施成本**: 2 文件 / ~20 行 / 复杂度 S

**长期价值**: 中等——文档化但物理边界未理清

**回归验证**: 文档与代码交叉检查

**回滚方式**: 还原文档

---

### 方案 B: 物理移动 + 重新导出

**核心策略**: 将 `DomHighlight` 移至 `components/studio/preview/` 子目录（如存在）或 `components/workspace/`（根据实际消费者）；`FloatingToolbar` 确认归属后更新 checklist。

**影响范围**:
- `src/ui/components/studio/dom-highlight.tsx`（移动）
- `src/ui/components/studio/PreviewWindow.tsx`（更新导入）
- `src/ui/INDEX.md`

**优点**:
1. 物理位置与逻辑归属一致
2. 新开发者更容易理解组件层次

**缺点**:
1. 移动文件影响 git blame
2. 需要更新所有导入路径

**风险**:
- 移动后可能发现其他隐式依赖

**实施成本**: 3 文件 / ~15 行 / 复杂度 S

**长期价值**: 高——物理边界清晰

**回归验证**: `npm run check` + `npm test` + 确认导入路径正确

**回滚方式**: git mv 还原

---

### 方案 C: 组件注册表 + 自动化归属校验

**核心策略**: 创建声明式组件注册表（JSON/YAML），记录每个组件的归属域、消费者、依赖关系；编写 check 脚本自动校验。

**影响范围**:
- `scripts/check-component-ownership.mjs`（新建）
- `src/ui/component-manifest.json`（新建）
- CI 配置

**优点**:
1. 自动化防止归属漂移
2. 新人 onboarding 有明确的组件地图

**缺点**:
1. 初始建设成本高
2. 注册表需要随组件变化维护

**风险**:
- 注册表与实际代码不一致

**实施成本**: 4 文件 / ~150 行 / 复杂度 L

**长期价值**: 最高——自动化守门 + 组件地图

**回归验证**: 新脚本运行通过 + 人为制造归属错误确认捕获

**回滚方式**: 删除注册表和检查脚本

---

## 总结矩阵

| RC | 根因 | 推荐方案 | 实施成本 | 长期价值 |
|----|------|---------|---------|---------|
| RC1 | Design-token 违规 | A（直接迁移） | S | 高 |
| RC2 | 类型安全失效 | B（修正源头类型） | M | 最高 |
| RC3 | 测试覆盖缺失 | A（逐文件补全） | M | 高 |
| RC4 | 测试质量薄弱 | B（Mock 工厂集中化） | L | 最高 |
| RC5 | 性能热点 | A（算法优化） | S | 高 |
| RC6 | React 渲染期副作用 | A（useEffect 同步） | S | 高 |
| RC7 | 模块级可变状态泄漏 | A（迁移到 store） | M | 高 |
| RC8 | 错误处理缺失 | A（统一 try-catch） | S | 高 |
| RC9 | 重复代码 | A（提取共享组件） | S | 高 |
| RC10 | 未消费状态/桩实现 | A（移除+补齐） | S | 高 |
| RC11 | 魔法数字 | A（命名常量） | S | 中 |
| RC12 | 组件归属边界不清 | B（物理移动） | S | 高 |
