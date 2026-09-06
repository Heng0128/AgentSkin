# 根因候选方案对比矩阵

> 生成时间: 2026-08-20 | 作者: Architect 子智能体 | 范围: RC1-RC6 全六项根因

---

## RC1: Store 架构耦合与跨层依赖失控 (critical)

### 现状分析

| Store | 跨 store 依赖数 | 依赖目标 |
|-------|:---:|---|
| themeStore | 5 | dialogStore, notificationStore, statusStore, environmentStore, wallpaperStore |
| appsStore | 4 | dialogStore, notificationStore, settingsStore, themeStore |
| environmentStore | 4 | dialogStore, notificationStore, themeStore, wallpaperStore |
| installFlowStore | 2 | notificationStore, themeStore |
| communityStore | 1 | notificationStore |

`check-architecture-boundaries.mjs` 仅校验文件级分层依赖（ui → shared → main → engine），**完全不检查** store 间横向依赖。

---

### 方案 A: 事件总线解耦（Event Bus Pattern）

**核心策略**: 引入轻量事件总线（pub/sub），store 不直接 `getState()` 调用彼此，改为发布事件和订阅事件。保留 `getState()` 仅用于"读取快照"场景，写入操作全部走事件。

**影响范围**:
- 新增: `src/shared/store-events.ts`（事件类型定义 + 总线实现）
- 修改: `themeStore.ts`, `appsStore.ts`, `environmentStore.ts`, `installFlowStore.ts`, `communityStore.ts`, `notificationStore.ts`, `statusStore.ts`, `dialogStore.ts`, `wallpaperStore.ts`
- 模块边界: src/ui/stores/ 内部

**优点**:
1. 彻底消除 store 间硬依赖，未来新增 store 无需修改已有 store
2. 事件流可观测——可在 devtools 中追踪事件序列，便于调试

**缺点**:
1. 调试链路变长：事件异步分发后，调用栈不再直观
2. 需要为每个跨 store 交互定义事件类型，增加 ~200 行类型代码

**风险**: 事件循环触发（A 发事件触发 B，B 又触发 A）；事件命名冲突
**实施成本**: 修改 10 文件 / +350 行 / 复杂度 L
**长期价值**: 高——为未来 store 扩展提供清晰契约
**回归验证**: 全量 npm run check + 手动验证 apply/restore/switch 流程
**回滚方式**: git revert 事件总线 commit，恢复 getState() 调用

---

### 方案 B: 编排层集中（Orchestrator Store）

**核心策略**: 新增 `orchestrationStore` 作为唯一跨 store 协调者。其他 store 不再互相 import，所有跨 store 操作由编排层串联。各 store 暴露"纯动作"，编排层负责顺序调用。

**影响范围**:
- 新增: `src/ui/stores/orchestrationStore.ts`
- 修改: `themeStore.ts`（剥离跨 store 逻辑）, `appsStore.ts`, `environmentStore.ts`, `installFlowStore.ts`
- 模块边界: src/ui/stores/ 内部

**优点**:
1. 跨 store 逻辑集中在一处，便于审计和修改
2. 保持同步调用链，调试体验不变

**缺点**:
1. orchestrationStore 成为新的"上帝对象"，可能膨胀
2. 每个跨 store 交互都需编排层转发，增加间接层

**风险**: orchestrationStore 与业务 store 职责边界模糊
**实施成本**: 修改 5 文件 / +200 行 / 复杂度 M
**长期价值**: 中——集中化本身不减少耦合总量，只是转移
**回归验证**: npm run check + 验证 apply-to-app / force-restart-launch / switch-environment 完整流程
**回滚方式**: 删除 orchestrationStore，将逻辑内联回各 store

---

### 方案 C: 依赖注入 + 接口隔离

**核心策略**: 为每个被依赖的 store 定义最小接口（interface），通过构造函数或工厂注入依赖。store 只依赖接口，不依赖具体实现。同时扩展 `check-architecture-boundaries.mjs` 增加 store 依赖校验。

**影响范围**:
- 新增: `src/ui/stores/interfaces.ts`（各 store 最小接口）
- 修改: 全部 12 个 store 文件（改为接收依赖注入）
- 修改: `scripts/check-architecture-boundaries.mjs`（增加 store 依赖规则）
- 模块边界: src/ui/stores/ + scripts/

**优点**:
1. 接口隔离使单元测试可以 mock 依赖 store
2. 架构守卫脚本化——CI 自动检测新增违规

**缺点**:
1. 改动面最大，几乎每个 store 都要改
2. Zustand 的 `create()` 模式与 DI 容器结合需要适配层

**风险**: DI 适配层引入运行时开销；接口设计不当导致频繁变更
**实施成本**: 修改 14 文件 / +500 行 / 复杂度 XL
**长期价值**: 高——接口契约 + 自动化守卫是长期健康的基础
**回归验证**: npm run check（含新增 store 边界检查）+ 全手动回归
**回滚方式**: revert 整个 DI 重构 commit

---

### 方案 D: 渐进式解耦 + 架构守卫增强（推荐）

**核心策略**: 分阶段实施——第一阶段仅扩展 `check-architecture-boundaries.mjs` 增加 store 依赖校验（阻止恶化），第二阶段按优先级逐个解耦（themeStore → appsStore → environmentStore），每解耦一个 store 一个 PR。

**影响范围**:
- 第一阶段: `scripts/check-architecture-boundaries.mjs`（增加 store 依赖矩阵校验）
- 第二阶段: 按优先级逐个修改 store 文件
- 模块边界: src/ui/stores/ + scripts/

**优点**:
1. 风险最低——每步改动可独立验证和回滚
2. 架构守卫先行，确保不继续恶化
3. 不需要引入新范式（事件总线/DI），保持 Zustand 原生模式

**缺点**:
1. 周期较长，需要多个 PR 完成
2. 解耦过程中可能需要临时引入回调注入等过渡方案

**风险**: 过渡期回调注入增加代码复杂度
**实施成本**: 第一阶段 1 文件 / +80 行 / S；第二阶段 每 store ~50 行 / M
**长期价值**: 高——可持续演进，无大爆炸式重构
**回归验证**: 每 PR 独立 npm run check + 手动回归
**回滚方式**: 每 PR 独立 revert

---

## RC2: 模块级可变状态与订阅资源泄漏 (major)

### 现状分析

| 位置 | 变量 | 问题 |
|------|------|------|
| skillsStore.ts:195 | `logIdCounter` | 无 reset，跨测试泄漏 |
| workspaceStore.ts:366-372 | `pushToken`, `PUSH_DURATION_HISTORY`, `debounceTimer` | 仅 2/3 有 reset（debounceTimer 无） |
| installFlowStore.ts:95-97 | `clearingHandle`, `installEpoch`, `lastSourcePath` | 无 reset，跨测试泄漏 |
| communityStore.ts:625 | `unsubCommunityDownloadProgress` | 导出 dispose 但未接入生命周期 |
| secondaryInjectStore.ts:83-84 | `unsubSecondaryInjectProgress/Summary` | 导出 dispose 但未接入生命周期 |
| runtime-t.ts:29 | `_localeReader` | 模块级可变，无 reset |
| notify.ts:26 | `_notifier` | 模块级可变，无 reset |
| cdp-discovery.ts:68 | `cachedProcessSnapshot` | TTL 缓存无显式清理 |
| port-manager.ts:119 | `allocations` | 仅测试清理方法，无运行时 GC |
| wallpaper-handler-registry.ts:34 | `wallpaperHandlers` | 数组只增不减 |

---

### 方案 A: 统一 Reset 注册表 + 生命周期钩子

**核心策略**: 新增 `src/ui/stores/reset-registry.ts`，提供 `registerReset(fn)` 和 `resetAllStores()` 接口。每个 store 在创建时注册自己的 reset 函数。在 app 启动/HMR 时调用 `resetAllStores()`。同时为 communityStore/secondaryInjectStore 的订阅接入 `renderer.tsx` 生命周期。

**影响范围**:
- 新增: `src/ui/stores/reset-registry.ts`
- 修改: `skillsStore.ts`, `workspaceStore.ts`, `installFlowStore.ts`, `communityStore.ts`, `secondaryInjectStore.ts`, `runtime-t.ts`, `notify.ts`, `renderer.tsx`
- 模块边界: src/ui/stores/ + src/ 入口

**优点**:
1. 单一入口管理所有 reset，测试和 HMR 都能复用
2. 显式生命周期管理，订阅泄漏问题根治

**缺点**:
1. 需要每个 store 主动注册，遗漏一个就存在泄漏
2. 模块级变量（runtime-t, notify）的 reset 需要跨目录协调

**风险**: reset 顺序依赖（如 notificationStore 被多个 store 依赖）
**实施成本**: 修改 10 文件 / +150 行 / 复杂度 M
**长期价值**: 高——为测试隔离和 HMR 稳定性提供基础设施
**回归验证**: 连续运行测试 10 次验证无状态泄漏；HMR 后验证 store 状态干净
**回滚方式**: 删除 reset-registry，各 store 恢复独立 reset 导出

---

### 方案 B: 封装为可实例化类（Class-based Store Modules）

**核心策略**: 将模块级可变状态封装到类实例中，store 创建时实例化，destroy 时清理。每个类实现 `Disposable` 接口（`dispose(): void`）。

**影响范围**:
- 修改: 全部含模块级状态的 store 文件
- 新增: 可能需 `src/shared/disposable.ts` 接口定义
- 模块边界: src/ui/stores/ + src/shared/

**优点**:
1. OOP 封装天然支持生命周期管理
2. 每个类的状态和清理逻辑内聚

**缺点**:
1. 与 Zustand 的函数式 create 模式风格不一致
2. 类实例在 HMR 场景下可能残留

**风险**: 类实例与 zustand store 生命周期不同步
**实施成本**: 修改 8 文件 / +200 行 / 复杂度 M
**长期价值**: 中——封装良好但引入新范式
**回归验证**: 同方案 A
**回滚方式**: revert 类封装，恢复模块级变量

---

### 方案 C: WeakRef + FinalizationRegistry 自动 GC

**核心策略**: 利用 `WeakRef` 和 `FinalizationRegistry` 让模块级缓存/订阅在不再被引用时自动清理。对 port-manager 的 allocations 和 cdp-discovery 的缓存使用 WeakRef 包装。

**影响范围**:
- 修改: `port-manager.ts`, `cdp-discovery.ts`, `wallpaper-handler-registry.ts`
- 模块边界: src/shared/ + src/ui/stores/

**优点**:
1. 无需显式生命周期钩子，减少遗漏
2. GC 自动管理，理论上零泄漏

**缺点**:
1. FinalizationRegistry 回调时机不确定，可能延迟清理
2. Node.js/Electron 中 FinalizationRegistry 行为有平台差异
3. 调试困难——无法确定何时被回收

**风险**: 平台兼容性；GC 时机不可控导致资源短暂泄漏
**实施成本**: 修改 3 文件 / +80 行 / 复杂度 S
**长期价值**: 低——依赖 GC 行为，不可靠
**回归验证**: 长时间运行测试 + 内存 profiling
**回滚方式**: 移除 WeakRef 包装，恢复强引用

---

### 方案 D: 分类治理 + 测试覆盖（推荐）

**核心策略**: 将模块级状态分为三类治理——(1) 计数器/Token 类：统一添加 reset 函数并在测试 beforeEach 调用；(2) 订阅句柄类：在 `renderer.tsx` 启动时注册 dispose，在 window unload 时调用；(3) 缓存类：添加 LRU 淘汰或 TTL 过期。每类补充专项测试。

**影响范围**:
- 修改: `skillsStore.ts`（添加 resetLogId）, `workspaceStore.ts`（添加 resetDebounceTimer）, `installFlowStore.ts`（添加 resetInstallFlow）, `communityStore.ts`（接入生命周期）, `secondaryInjectStore.ts`（接入生命周期）, `runtime-t.ts`（添加 resetLocaleReader）, `notify.ts`（添加 resetNotifier）, `renderer.tsx`（注册 dispose）
- 新增: 各 store 的 `.test.ts` 中泄漏检测测试
- 模块边界: src/ui/stores/ + src/ 入口

**优点**:
1. 针对不同状态类型采用最合适的治理策略
2. 改动最小，不引入新范式
3. 测试覆盖确保长期不回归

**缺点**:
1. 需要人工分类，可能遗漏
2. 生命周期接入点需要与 Electron 的 app/window 事件对齐

**风险**: 生命周期钩子未触发（如异常退出）
**实施成本**: 修改 10 文件 / +180 行 / 复杂度 M
**长期价值**: 高——分类治理可持续扩展
**回归验证**: 专项泄漏测试 + 长时间运行 + HMR 压力测试
**回滚方式**: 逐文件 revert

---

## RC3: 异步操作竞态条件 (minor)

### 现状分析

| Store | 位置 | 问题 |
|-------|------|------|
| appsStore.ts:302 | `launch()` | `await` 后 `useSettingsStore.getState()` 读取设置，期间设置可能已变 |
| communityStore.ts:385-465 | `installTheme()` | 多处 `await` 后读取 `installingIds` 判断是否已取消，存在 TOCTOU |
| environmentStore.ts:171-186 | `switchEnvironment()` | `await` 后读取 `presets` 创建新 preset，期间 presets 可能已被其他操作修改 |

---

### 方案 A: 快照一致性（Snapshot Consistency）

**核心策略**: 在异步操作开始时一次性读取所有需要的状态快照，整个操作期间使用快照而非重新 `get()`。将"读取-判断-写入"封装为原子操作。

**影响范围**:
- 修改: `appsStore.ts`, `communityStore.ts`, `environmentStore.ts`
- 模块边界: src/ui/stores/ 内部

**优点**:
1. 逻辑清晰——操作基于开始时的快照，不受并发修改影响
2. 不需要额外同步原语

**缺点**:
1. 快照可能过时（如用户恰好在操作中修改了设置）
2. 需要仔细设计快照粒度

**风险**: 快照过旧导致用户最新意图被忽略
**实施成本**: 修改 3 文件 / +60 行 / 复杂度 S
**长期价值**: 中——解决当前竞态但不提供通用模式
**回归验证**: 并发场景测试（快速连续操作）
**回滚方式**: 恢复 `get()` 调用

---

### 方案 B: 乐观锁 + 版本号

**核心策略**: 为共享状态（如 installingIds, presets）增加版本号字段。操作开始时记录版本号，写入前校验版本未变，否则重试或放弃。

**影响范围**:
- 修改: `communityStore.ts`, `environmentStore.ts`, 可能需修改 state 类型定义
- 模块边界: src/ui/stores/ 内部

**优点**:
1. 检测并发冲突，保证写入基于最新状态
2. 通用模式可复用于其他 store

**缺点**:
1. 增加版本号管理复杂度
2. 重试逻辑增加代码量

**风险**: 重试循环导致活锁
**实施成本**: 修改 3 文件 / +90 行 / 复杂度 S
**长期价值**: 中——提供通用并发控制模式
**回归验证**: 并发冲突注入测试
**回滚方式**: 移除版本号逻辑

---

### 方案 C: 操作序列化（Per-key Queue）

**核心策略**: 对同一资源的操作序列化——installTheme 对同一 themeId 串行执行，switchEnvironment 对同一 agentId 串行执行。利用 promise chain 实现。

**影响范围**:
- 修改: `communityStore.ts`, `environmentStore.ts`
- 模块边界: src/ui/stores/ 内部

**优点**:
1. 从根本上消除同一资源的并发竞态
2. 与 themeStore 的 ChainController 模式一致

**缺点**:
1. 跨资源操作可能死锁（如 A 等 B，B 等 A）
2. 队列管理增加复杂度

**风险**: 队列无限增长（操作持续涌入）
**实施成本**: 修改 2 文件 / +70 行 / 复杂度 S
**长期价值**: 高——与现有 ChainController 统一模式
**回归验证**: 并发操作压力测试
**回滚方式**: 移除队列逻辑

---

### 方案 D: 最小修复 + 竞态测试覆盖（推荐）

**核心策略**: 对三处竞态做最小修复——appsStore 在 launch 开始时一次性读取 settings；communityStore 在每次 `await` 后重新校验 installingIds（当前已部分实现，需补全）；environmentStore 在 switch 开始时读取 presets 快照。同时补充竞态专项测试。

**影响范围**:
- 修改: `appsStore.ts`, `communityStore.ts`, `environmentStore.ts`
- 新增: 竞态测试用例
- 模块边界: src/ui/stores/ 内部

**优点**:
1. 改动最小，风险最低
2. 测试覆盖确保不回归

**缺点**:
1. 不解决所有潜在竞态（如未来新增）
2. 部分场景仍存在理论竞态窗口

**风险**: 修复不完整导致间歇性 bug
**实施成本**: 修改 3 文件 / +40 行 / 复杂度 S
**长期价值**: 低——治标不治本，但当前风险可控
**回归验证**: 竞态注入测试 + 手动快速操作测试
**回滚方式**: 逐文件 revert

---

## RC4: 类型定义重复与契约歧义 (major)

### 现状分析

| 符号 | 定义位置 | 问题 |
|------|---------|------|
| `ThemeIdentity` | `src/engine/types/index.d.ts:138`, `src/main/services/theme-bundle.ts:40` | 重复定义，字段相同但维护两份 |
| `isValidAgentId` | `src/main/ipc/studio-project-ipc.ts:54`, `src/ui/stores/secondaryInjectStore.ts:27` | 重复定义，实现相同（硬编码 agent 列表） |
| `ThemeLibraryApi.find` | `src/main/services/contracts.ts:89` | 返回 `Promise<ThemeEntry>`（非 null），但调用方可能期望 null |
| `AgentCatalogItem.adapter` | `src/shared/types/agent.ts:268` | 类型为 `string`，实际应为 `AgentId` 或 `AgentId \| null` |

---

### 方案 A: 统一类型源 + 收紧类型

**核心策略**: (1) `ThemeIdentity` 统一到 `src/shared/types/`，engine 和 main 都从 shared 导入；(2) `isValidAgentId` 统一到 `src/shared/types/agent.ts`，两处都从 shared 导入；(3) `ThemeLibraryApi.find` 返回 `Promise<ThemeEntry \| null>`；(4) `AgentCatalogItem.adapter` 收紧为 `AgentId`。

**影响范围**:
- 修改: `src/shared/types/agent.ts`（添加 isValidAgentId）, `src/engine/types/index.d.ts`（改为 re-export）, `src/main/services/theme-bundle.ts`（改为 import from shared）, `src/main/ipc/studio-project-ipc.ts`（改为 import from shared）, `src/ui/stores/secondaryInjectStore.ts`（改为 import from shared）, `src/main/services/contracts.ts`（修改 find 返回类型）, `src/main/theme/store.ts`（实现 find 返回 null）
- 模块边界: src/shared/ + src/engine/ + src/main/ + src/ui/

**优点**:
1. 单一源原则——类型只定义一处
2. 类型收紧减少运行时错误

**缺点**:
1. 改动面跨多层（shared, engine, main, ui）
2. find 返回类型变更可能影响其他调用方

**风险**: 类型收紧后某些边缘 case 编译失败
**实施成本**: 修改 7 文件 / +50 行（净减）/ 复杂度 M
**长期价值**: 高——消除重复是长期健康的基础
**回归验证**: npm run typecheck + npm run check + 全量测试
**回滚方式**: 逐文件 revert

---

### 方案 B: 类型守卫集中 + 契约测试

**核心策略**: 将 `isValidAgentId` 等类型守卫集中到 `src/shared/type-guards.ts`，所有模块从 shared 导入。为 `ThemeLibraryApi.find` 添加运行时契约测试验证返回值。`AgentCatalogItem.adapter` 暂不收紧（避免破坏性变更）。

**影响范围**:
- 新增: `src/shared/type-guards.ts`
- 修改: `src/main/ipc/studio-project-ipc.ts`, `src/ui/stores/secondaryInjectStore.ts`, `src/engine/types/index.d.ts`, `src/main/services/theme-bundle.ts`
- 新增: `src/shared/type-guards.test.ts`
- 模块边界: src/shared/ + 消费者

**优点**:
1. 类型守卫集中管理，未来新增守卫有明确位置
2. 契约测试防止未来回归

**缺点**:
1. 不解决 ThemeIdentity 重复（需额外处理）
2. 契约测试增加 CI 时间

**风险**: 契约测试脆弱（实现细节变化导致测试失败）
**实施成本**: 修改 5 文件 / +80 行 / 复杂度 S
**长期价值**: 中高——集中化 + 测试覆盖
**回归验证**: npm run check + 契约测试
**回滚方式**: 删除 type-guards.ts，恢复本地定义

---

### 方案 C: 类型别名 + 渐进收紧

**方案 C**: 不立即删除重复定义，而是在 shared 中定义 canonical 类型，旧定义改为 `export type ThemeIdentity = SharedThemeIdentity`。逐步迁移消费者，最终删除别名。

**影响范围**: 同方案 A，但分阶段实施

**优点**:
1. 零破坏性——旧代码继续编译
2. 可按优先级渐进迁移

**缺点**:
1. 过渡期存在两套名称
2. 需要跟踪迁移进度

**风险**: 迁移不完全，长期存在别名
**实施成本**: 修改 7 文件 / +60 行 / 复杂度 M（分阶段）
**长期价值**: 中——渐进式但周期长
**回归验证**: 每阶段 npm run check
**回滚方式**: 逐阶段 revert

---

### 方案 D: 仅修复 isValidAgentId + find 契约（推荐）

**核心策略**: 优先解决影响最大的两项——(1) `isValidAgentId` 统一到 `src/shared/types/agent.ts`，两处改为导入；(2) `ThemeLibraryApi.find` 返回类型改为 `Promise<ThemeEntry \| null>`，实现同步调整。ThemeIdentity 重复暂不处理（engine 类型定义是独立的 .d.ts 文件，与 main 的运行时类型天然隔离）。

**影响范围**:
- 修改: `src/shared/types/agent.ts`, `src/main/ipc/studio-project-ipc.ts`, `src/ui/stores/secondaryInjectStore.ts`, `src/main/services/contracts.ts`, `src/main/theme/store.ts`
- 模块边界: src/shared/ + src/main/ + src/ui/

**优点**:
1. 改动集中，风险可控
2. 解决实际 bug 风险最高的两个问题

**缺点**:
1. ThemeIdentity 重复仍然存在
2. AgentCatalogItem.adapter 未收紧

**风险**: find 返回 null 后调用方未处理 null 导致运行时错误
**实施成本**: 修改 5 文件 / +30 行 / 复杂度 S
**长期价值**: 中——解决当前最紧迫问题
**回归验证**: npm run typecheck + 验证 find 返回 null 的场景
**回滚方式**: 逐文件 revert

---

## RC5: 测试覆盖不足与架构守卫缺陷 (major)

### 现状分析

- 跨 store 边界测试：缺失（无测试验证 store 间调用是否符合预期）
- `check-architecture-boundaries.mjs`：不验证 store 依赖方向
- `themeStore.test.ts`：脆弱——依赖模块级状态（chainController, moduleState）的 reset，但 reset 函数与实现紧耦合

---

### 方案 A: 全面补充测试 + 增强架构守卫

**核心策略**: (1) 为每个跨 store 交互编写集成测试；(2) 扩展 `check-architecture-boundaries.mjs` 增加 store 依赖校验规则；(3) 重构 themeStore 测试，使用 factory 模式替代直接 reset 模块状态。

**影响范围**:
- 新增: `tests/ui/stores/cross-store-boundary.test.ts`
- 修改: `scripts/check-architecture-boundaries.mjs`
- 修改: `src/ui/stores/themeStore.test.ts`
- 模块边界: tests/ + scripts/ + src/ui/stores/

**优点**:
1. 测试覆盖全面，长期质量保障
2. 架构守卫自动化，CI 拦截违规

**缺点**:
1. 编写跨 store 测试需要 mock 多个 store，工作量大
2. 测试可能脆弱（实现细节变化导致测试失败）

**风险**: 测试维护成本过高
**实施成本**: 新增 1 文件 / 修改 2 文件 / +300 行 / 复杂度 L
**长期价值**: 高——测试是长期质量的基石
**回归验证**: npm test 全绿 + npm run check
**回滚方式**: 删除新增测试，恢复原始架构守卫

---

### 方案 B: 仅增强架构守卫 + 关键路径测试

**核心策略**: 优先扩展 `check-architecture-boundaries.mjs` 增加 store 依赖校验（阻止恶化），仅对最关键的跨 store 交互（themeStore → statusStore, appsStore → dialogStore）编写测试。

**影响范围**:
- 修改: `scripts/check-architecture-boundaries.mjs`
- 新增: `tests/ui/stores/critical-store-interactions.test.ts`
- 模块边界: tests/ + scripts/

**优点**:
1. 改动适中，风险可控
2. 架构守卫先行，测试覆盖关键路径

**缺点**:
1. 测试覆盖不全
2. themeStore 测试脆弱问题未解决

**风险**: 架构守卫规则设计不当导致误报
**实施成本**: 新增 1 文件 / 修改 1 文件 / +150 行 / 复杂度 M
**长期价值**: 中高——守卫自动化 + 关键路径覆盖
**回归验证**: npm run check + 新增测试
**回滚方式**: 删除新增内容

---

### 方案 C: 测试工具化 + 渐进覆盖

**核心策略**: 先构建跨 store 测试工具（`tests/ui/stores/store-test-utils.ts`，提供 mock store 工厂），然后按优先级逐步添加测试。架构守卫分阶段扩展。

**影响范围**:
- 新增: `tests/ui/stores/store-test-utils.ts`
- 渐进添加测试文件
- 模块边界: tests/

**优点**:
1. 工具化降低后续测试编写成本
2. 渐进式，风险分散

**缺点**:
1. 初期投入工具建设
2. 覆盖速度慢

**风险**: 工具设计不当导致测试难以编写
**实施成本**: 新增 2 文件 / +200 行 / 复杂度 M
**长期价值**: 高——工具化支撑长期测试覆盖
**回归验证**: 同方案 A
**回滚方式**: 删除工具文件

---

### 方案 D: 架构守卫先行 + 脆弱测试重构（推荐）

**核心策略**: 第一阶段扩展 `check-architecture-boundaries.mjs` 增加 store 依赖校验规则（阻止新增耦合）；第二阶段重构 `themeStore.test.ts` 使用 `resetThemeModuleState()` 替代直接操作模块状态，并增加断言验证 reset 效果；第三阶段按需补充跨 store 测试。

**影响范围**:
- 第一阶段: `scripts/check-architecture-boundaries.mjs`
- 第二阶段: `src/ui/stores/themeStore.test.ts`
- 第三阶段: 按需新增测试
- 模块边界: scripts/ + src/ui/stores/ + tests/

**优点**:
1. 分阶段实施，每阶段可独立验证
2. 架构守卫先行阻止恶化
3. 脆弱测试重构提高维护性

**缺点**:
1. 跨 store 测试覆盖延迟
2. 架构守卫规则需要仔细设计

**风险**: 架构守卫规则与现有代码冲突（误报）
**实施成本**: 第一阶段 1 文件 / +80 行 / S；第二阶段 1 文件 / +50 行 / S
**长期价值**: 高——可持续演进
**回归验证**: 每阶段 npm run check
**回滚方式**: 逐阶段 revert

---

## RC6: 关键可靠性指标验证缺失 (critical)

### 现状分析

`collectConcurrencyMetrics()` 返回 `ConcurrencyMetrics` 接口定义的 9 个字段：
- `companionBusyByAgent`, `inflightOperations`, `selfHealingAgents`, `capturedTokens`, `persistChainDepth`, `deferredSelfHeals`, `switchEpochByAgent`, `persistFailures`

当前测试 (`agent-engine-service-reliability.test.ts:436-448`) 仅验证 5 个字段存在：
- `companionBusyByAgent`, `inflightOperations`, `selfHealingAgents`, `capturedTokens`

**缺失验证**: `persistChainDepth`, `deferredSelfHeals`, `switchEpochByAgent`, `persistFailures`

---

### 方案 A: 全量字段验证 + 边界值测试

**核心策略**: 扩展现有测试，对全部 9 个字段进行存在性验证 + 边界值验证（如 persistChainDepth 在队列空时为 0，入队后 > 0）。增加独立测试用例验证每个字段的语义正确性。

**影响范围**:
- 修改: `src/main/agent-engine-service-reliability.test.ts`
- 可能修改: `src/main/agent-engine-service.ts`（如实现有 bug）
- 模块边界: src/main/

**优点**:
1. 测试覆盖完整，每个字段都有验证
2. 边界值测试能发现实现 bug

**缺点**:
1. 测试用例数量增加
2. 部分字段（如 persistChainDepth）需要构造特定状态才能验证

**风险**: 测试过于依赖实现细节，重构时易碎
**实施成本**: 修改 1 文件 / +80 行 / 复杂度 S
**长期价值**: 高——关键指标有完整回归保障
**回归验证**: npm test 全绿
**回滚方式**: 删除新增测试用例

---

### 方案 B: 结构化断言 + 快照对比

**核心策略**: 定义 `EXPECTED_METRICS_SHAPE` 常量（包含所有 9 个字段及其类型），测试中使用 `expect(m).toMatchObject(EXPECTED_METRICS_SHAPE)` 一次性验证。同时增加"全零基线"测试（服务刚启动时所有计数器为 0）。

**影响范围**:
- 修改: `src/main/agent-engine-service-reliability.test.ts`
- 模块边界: src/main/

**优点**:
1. 简洁——一个断言验证所有字段
2. 新增字段时只需更新常量

**缺点**:
1. `toMatchObject` 不验证字段类型（仅验证存在性和值匹配）
2. 快照对比在实现变化时需要更新

**风险**: 类型变化未被检测
**实施成本**: 修改 1 文件 / +40 行 / 复杂度 S
**长期价值**: 中——简洁但覆盖有限
**回归验证**: npm test
**回滚方式**: 删除结构化断言

---

### 方案 C: 运行时指标校验 + 告警

**核心策略**: 在 `collectConcurrencyMetrics()` 实现内部增加自检逻辑——返回前验证所有字段为非负数、非 NaN。在开发模式下输出警告。测试中增加"返回值完整性"断言。

**影响范围**:
- 修改: `src/main/agent-engine-service.ts`（collectConcurrencyMetrics 方法）
- 修改: `src/main/agent-engine-service-reliability.test.ts`
- 模块边界: src/main/

**优点**:
1. 运行时自检，生产环境也能发现指标异常
2. 测试覆盖 + 运行时防护双重保障

**缺点**:
1. 运行时自检增加少量性能开销
2. 自检逻辑本身可能有 bug

**风险**: 自检逻辑误报导致告警泛滥
**实施成本**: 修改 2 文件 / +50 行 / 复杂度 S
**长期价值**: 高——运行时防护是可靠性的最后防线
**回归验证**: npm test + 手动触发异常场景
**回滚方式**: 移除自检逻辑

---

### 方案 D: 测试补全 + 类型守卫（推荐）

**核心策略**: (1) 在 `ConcurrencyMetrics` 接口中添加 `satisfies` 编译时检查，确保实现返回全部字段；(2) 测试中增加 `expect(Object.keys(m).sort()).toEqual(EXPECTED_KEYS)` 断言验证字段完整性；(3) 对缺失的 4 个字段各补充一个语义验证用例。

**影响范围**:
- 修改: `src/shared/types/concurrency.ts`（添加编译时检查）
- 修改: `src/main/agent-engine-service-reliability.test.ts`
- 模块边界: src/shared/ + src/main/

**优点**:
1. 编译时 + 测试时双重保障
2. 字段增减时编译器和测试同时报错
3. 改动最小

**缺点**:
1. TypeScript 的 satisfies 检查需要 TS 4.9+（当前项目已使用，可行）
2. 编译时检查增加少量编译时间

**风险**: 无显著风险
**实施成本**: 修改 2 文件 / +60 行 / 复杂度 S
**长期价值**: 高——编译时保障是最强防护
**回归验证**: npm run typecheck + npm test
**回滚方式**: 删除新增断言和类型守卫

---

## 方案对比总矩阵

| 根因 | 方案 | 成本 | 风险 | 长期价值 | 推荐 |
|------|------|------|------|----------|:----:|
| RC1 | A: 事件总线 | L | 中 | 高 | |
| RC1 | B: 编排层 | M | 中 | 中 | |
| RC1 | C: DI + 接口 | XL | 高 | 高 | |
| RC1 | D: 渐进式 + 守卫 | M | 低 | 高 | **✓** |
| RC2 | A: Reset 注册表 | M | 低 | 高 | |
| RC2 | B: 类封装 | M | 中 | 中 | |
| RC2 | C: WeakRef GC | S | 高 | 低 | |
| RC2 | D: 分类治理 | M | 低 | 高 | **✓** |
| RC3 | A: 快照一致性 | S | 低 | 中 | |
| RC3 | B: 乐观锁 | S | 中 | 中 | |
| RC3 | C: 操作序列化 | S | 中 | 高 | |
| RC3 | D: 最小修复 + 测试 | S | 低 | 低 | **✓** |
| RC4 | A: 统一类型源 | M | 中 | 高 | |
| RC4 | B: 守卫集中 + 契约 | S | 低 | 中高 | |
| RC4 | C: 别名渐进 | M | 低 | 中 | |
| RC4 | D: 仅修关键项 | S | 低 | 中 | **✓** |
| RC5 | A: 全面测试 + 守卫 | L | 中 | 高 | |
| RC5 | B: 守卫 + 关键测试 | M | 低 | 中高 | |
| RC5 | C: 工具渐进 | M | 低 | 高 | |
| RC5 | D: 守卫先行 + 重构 | S+ | 低 | 高 | **✓** |
| RC6 | A: 全量验证 | S | 低 | 高 | |
| RC6 | B: 结构化断言 | S | 低 | 中 | |
| RC6 | C: 运行时自检 | S | 中 | 高 | |
| RC6 | D: 测试 + 类型守卫 | S | 低 | 高 | **✓** |

---

## 推荐实施路径

### 第一阶段（阻断恶化）
1. **RC1-D**: 扩展 `check-architecture-boundaries.mjs` 增加 store 依赖校验
2. **RC5-D**: 同上（同一文件，合并实施）
3. **RC6-D**: 补全 `collectConcurrencyMetrics` 测试 + 类型守卫

### 第二阶段（高价值修复）
4. **RC2-D**: 分类治理模块级状态
5. **RC4-D**: 统一 `isValidAgentId` + 修复 `find` 契约

### 第三阶段（深度治理）
6. **RC1-D 第二阶段**: 按优先级逐个解耦 store
7. **RC3-D**: 修复异步竞态
8. **RC5-D 第三阶段**: 补充跨 store 测试

### 预估总工作量
- 修改文件数: ~25 文件
- 新增代码行数: ~800 行
- 总复杂度: L（分 3 阶段，每阶段可独立交付）
