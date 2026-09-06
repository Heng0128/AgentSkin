# Visual Analyzer 核心根因候选方案对比矩阵

> 生成日期: 2026-08-29
> 根因来源: I-Visual Analyzer 巡检报告（27 问题 / 11 根因）
> 覆盖范围: RC1（功能未完整实现）、RC2（DOM/Profile 管线缺陷）、RC5（性能隐患）

---

## RC1: Visual Analysis 功能未完整实现 (Critical)

### 问题全景

| # | 文件:行 | 缺陷描述 |
|---|---------|---------|
| 1 | `VisualAnalysisPanel.tsx:217` | Export 按钮传入 `{}` 空对象，IPC handler 因无 `--agentskin-*` token 返回 `{ok:false}`，UI 静默失败 |
| 2 | `visual-analyzer-ipc.ts:302` | `CDP_EXTRACT` handler 是 stub，返回 `{status:'unavailable'}`，_live CDP 提取不可用 |
| 3 | `visualAnalysisStore.ts:62` | `loadTarget`/`currentTarget` 死代码 — store 有状态但面板不展示 |
| 4 | `preload.ts:246` | 6 个 IPC 通道有 `TODO: type-guard — 待渐进式加固` |
| 5 | `visual-analysis.ts:15` | `VisualAnalysisSummary` 类型已含 `brandDark/brandLight` 字段，但 `buildVisualAnalysisSummaries()` 从 `_profiles-summary.json` 读取时未传递这些字段（实际已在 ipc 文件 114-121 行实现提取，但依赖 raw profile 文件存在） |

### 方案 A: 最小修复 + 显式错误反馈（推荐）

**解决思路核心策略**
修复 Export 按钮的数据流（从 summary 卡片级直接传入 `root` 参数），移除死代码 `loadTarget/currentTarget`，将 stub handler 的返回值改为结构化错误信息，preload TODO 添加运行时 type-guard。

**影响范围**
- `src/ui/components/diagnostics/VisualAnalysisPanel.tsx` — 修复 exportTheme 调用参数
- `src/ui/stores/visualAnalysisStore.ts` — 移除死代码
- `src/main/ipc/visual-analyzer-ipc.ts` — stub 返回值增强 + 错误分类
- `src/preload.ts` — 6 处 TODO 替换为运行时 type-guard
- `src/shared/ipc-type-guards.ts` — 新增 visual-analysis 类型守卫

**优点**
1. 改动最小，不引入新架构，风险可控
2. Export 功能立即可用（传入正确的 root token 数据）
3. 用户获得明确错误信息而非静默失败

**缺点**
1. CDP_EXTRACT 仍为 stub，live 提取不可用（需后续 P2 实现）
2. 不解决 brandDark/brandLight 依赖 raw profile 文件的问题

**风险**
- 移除 `loadTarget` 可能影响未来扩展（但当前确认为死代码，可安全删除）
- type-guard 增加运行时开销（但 IPC 调用频率极低，可忽略）

**实施成本**
- 修改文件数: 5
- 代码行数: ~80 行
- 复杂度: **S**

**长期价值**
- 建立 IPC type-guard 模式，可复用到其他通道
- 为后续 CDP_EXTRACT 完整实现铺路

**回归验证方式**
1. `npm run check` 全绿
2. 手动验证：点击 Export 按钮，传入有效 root 数据 → 应弹出 "Exported: <path>"
3. 手动验证：传入空数据 → 应显示 "Export failed" 而非静默
4. 单元测试：为新增 type-guard 编写测试用例

**回滚方式**
- Git revert 单次提交即可（改动原子化）

---

### 方案 B: 完整实现 CDP_EXTRACT + Export 联动

**解决思路核心策略**
实现完整的 CDP live 提取管线：主进程连接目标 agent CDP → 提取 CSS 变量 + DOM 结构 → 构建 profile → 支持直接 Export。Export 按钮联动提取结果。

**影响范围**
- `src/main/ipc/visual-analyzer-ipc.ts` — 完整 CDP_EXTRACT handler
- `src/main/cdp/cdp-client.ts` — 复用现有 CDP 连接
- `src/ui/components/diagnostics/VisualAnalysisPanel.tsx` — 新增 "Extract" 按钮 + 进度展示
- `src/ui/stores/visualAnalysisStore.ts` — 新增 extract action + 状态
- `src/shared/types/visual-analysis.ts` — 扩展类型
- `scripts/build-agent-profiles.mjs` — 复用分析逻辑

**优点**
1. 端到端功能完整，消除所有 stub
2. 用户体验最佳：一键提取 + 导出

**缺点**
1. 实现成本高，涉及 CDP 连接管理、错误处理、超时控制
2. 需要目标 agent 正在运行才能提取
3. 测试复杂度高（需要 mock CDP）

**风险**
- CDP 连接不稳定可能导致提取失败
- 大 profile 文件读取可能阻塞主进程（与 RC5 相关）
- 需要处理 agent 未运行、CDP 未就绪等边界情况

**实施成本**
- 修改文件数: 6+
- 代码行数: ~400-600 行
- 复杂度: **L**

**长期价值**
- 建立完整的 live 分析能力
- 为 Theme Studio 的 "从 agent 提取主题" 功能铺路

**回归验证方式**
1. `npm run check` 全绿
2. 集成测试：启动 traework → 点击 Extract → 验证 profile 生成
3. 边界测试：agent 未运行 → 显示明确错误
4. 性能测试：提取过程不阻塞 UI

**回滚方式**
- 特性开关控制：新增 `enableLiveExtraction` 配置项，默认关闭
- Git revert 需回退多个文件

---

### 方案 C: 移除 Export 按钮 + 降级为只读展示面板

**解决思路核心策略**
承认当前功能不完整，移除 Export 按钮，将 VisualAnalysisPanel 降级为只读展示面板（仅展示 summary 数据），在 UI 上标注 "Export 功能即将推出"。

**影响范围**
- `src/ui/components/diagnostics/VisualAnalysisPanel.tsx` — 移除 Export 按钮
- `src/ui/stores/visualAnalysisStore.ts` — 移除 exportTheme action

**优点**
1. 改动最小，消除用户困惑
2. 不引入新风险

**缺点**
1. 功能进一步缩减，用户无法从分析结果导出主题
2. 不解决任何底层技术债务

**风险**
- 用户可能认为功能被删除而非暂不可用

**实施成本**
- 修改文件数: 2
- 代码行数: ~20 行
- 复杂度: **S**

**长期价值**
- 无

**回归验证方式**
1. `npm run check` 全绿
2. 验证面板不显示 Export 按钮

**回滚方式**
- Git revert

---

### 方案 D: 重构为独立 Visual Analysis 服务层

**解决思路核心策略**
将 visual analysis 逻辑从 IPC handler 中提取为独立服务类（`VisualAnalysisService`），统一管理 profile 读取、summary 构建、export 构建。IPC handler 仅做薄层转发。

**影响范围**
- 新增 `src/main/services/visual-analysis-service.ts`
- `src/main/ipc/visual-analyzer-ipc.ts` — 重构为薄层
- `src/ui/stores/visualAnalysisStore.ts` — 适配新接口
- `src/ui/components/diagnostics/VisualAnalysisPanel.tsx` — 适配

**优点**
1. 架构清晰，服务层可独立测试
2. 为未来功能扩展提供良好基础

**缺点**
1. 改动范围大，引入新文件
2. 不直接解决功能不完整问题

**风险**
- 重构可能引入新 bug
- 服务层与 IPC 层的接口设计不当可能导致后续修改困难

**实施成本**
- 修改文件数: 4 + 新增 1
- 代码行数: ~200 行
- 复杂度: **M**

**长期价值**
- 服务层模式可复用到其他分析功能

**回归验证方式**
1. `npm run check` 全绿
2. 服务层单元测试覆盖核心逻辑
3. 集成测试验证 IPC → 服务 → UI 数据流

**回滚方式**
- Git revert（需回退新文件 + 修改文件）

---

### RC1 方案对比矩阵

| 维度 | A: 最小修复+显式错误 | B: 完整 CDP 实现 | C: 移除降级 | D: 服务层重构 |
|------|---------------------|-----------------|------------|-------------|
| 实施成本 | S（5文件/80行） | L（6+/400-600行） | S（2/20行） | M（5/200行） |
| 功能完整度 | Export 可用，CDP 仍 stub | 完整 | 只读 | Export 可用 |
| 风险 | 低 | 高 | 极低 | 中 |
| 长期价值 | 中（type-guard 模式） | 高（live 能力） | 无 | 高（架构） |
| 推荐度 | ★★★ 首选 | ★★ P2 规划 | ★ 过渡 | ★★ 中期 |

---

## RC2: DOM/Profile 分析管线端到端缺陷 (Critical)

### 问题全景

| # | 文件:行 | 缺陷描述 |
|---|---------|---------|
| 1 | `build-agent-profiles.mjs:386` | `findVar` 假阳性：模糊匹配时 `--info` 会匹配到字体族变量而非颜色 |
| 2 | `build-agent-profiles.mjs:416` | `analyzeDomStructure` 引用 `node.r` 属性，但实际 DOM 树节点无此属性（应为 `node.role` 或 ARIA role） |
| 3 | `build-agent-profiles.mjs:255` | `classifyVariable` 正则重叠：`/fill(?!-)/` 在 backgrounds 中优先于 icon 的 `/fill-/`，导致误分类 |
| 4 | `build-agent-profiles.mjs:83` | `normalizedHex` 边界过滤异常：正则 `rgba?\([^)]*\d\s*\)/` 匹配逻辑有误 |
| 5 | `build-agent-profiles.mjs:291` | `extractDesignTokens` 未使用 `_rootVars` 参数（第一个参数被忽略） |
| 6 | `build-agent-profiles.mjs:488` | `tokenTree` 仅用 `variables.neutral.flat`，丢失 light/dark 变量 |
| 7 | `InspectorProfile.tsx:136` | `domTree={null}` 导致 `NativeProfilePanel` 功能不可用 |
| 8 | `build-agent-profiles.mjs:498` | `analyzeDomStructure` 结果未被 summary 消费（summary 不传递 dom structure 信息） |

### 方案 A: 精准修复每个缺陷 + 补充测试（推荐）

**解决思路核心策略**
逐行修复 8 个缺陷：修正 `findVar` 匹配策略（精确优先）、修正 `node.r` 引用、正则去边界、`normalizedHex` 逻辑修正、`_rootVars` 使用、tokenTree 全 scheme 遍历、InspectorProfile 传入真实 domTree、summary 消费 dom structure。

**影响范围**
- `scripts/build-agent-profiles.mjs` — 核心修复
- `src/ui/components/studio/InspectorProfile.tsx` — 修复 domTree 传递
- `scripts/build-agent-profiles.test.mjs` — 新增回归测试

**优点**
1. 每个修复独立可验证，风险可控
2. 补充测试防止回归
3. 不改变外部接口，不影响运行时行为

**缺点**
1. 脚本整体复杂度仍然较高
2. 不解决架构层面的可维护性问题

**风险**
- 正则修改可能影响其他变量的分类结果
- domTree 数据源依赖运行时 CDP 捕获

**实施成本**
- 修改文件数: 3
- 代码行数: ~120 行（含测试）
- 复杂度: **M**

**长期价值**
- 建立回归测试基线
- 为后续重构提供安全网

**回归验证方式**
1. `node scripts/build-agent-profiles.mjs --input agents-raw-data --output test-output/profiles` 验证输出正确性
2. 新增单元测试覆盖每个修复点
3. 对比修复前后 `_profiles-summary.json` 输出差异

**回滚方式**
- Git revert

---

### 方案 B: 重构为模块化 + 类型安全

**解决思路核心策略**
将 `build-agent-profiles.mjs` 拆分为多个模块：`color-utils.mjs`（已存在，复用）、`variable-classifier.mjs`、`dom-analyzer.mjs`、`token-extractor.mjs`、`profile-builder.mjs`。每个模块独立测试。

**影响范围**
- 新增 `scripts/lib/profile/` 目录下 4-5 个模块
- `scripts/build-agent-profiles.mjs` 重构为编排入口
- 新增各模块单元测试

**优点**
1. 架构清晰，每个模块职责单一
2. 可独立测试每个分析阶段
3. 便于后续扩展（新增分析维度）

**缺点**
1. 改动范围大，引入多个新文件
2. 不直接解决功能缺陷（需配合方案 A 的修复）

**风险**
- 模块拆分可能破坏现有数据流
- 接口设计不当可能导致后续修改困难

**实施成本**
- 修改文件数: 1 + 新增 5-6
- 代码行数: ~400 行
- 复杂度: **L**

**长期价值**
- 模块化架构便于维护和扩展
- 每个模块可独立优化

**回归验证方式**
1. 每个模块独立单元测试
2. 集成测试验证端到端输出与重构前一致
3. `npm run check` 全绿

**回滚方式**
- Git revert（需回退新文件 + 修改文件）

---

### 方案 C: 仅修复阻塞性缺陷（node.r + findVar）

**解决思路核心策略**
仅修复导致运行时错误或严重错误结果的缺陷（`node.r` 引用错误、`findVar` 假阳性），其余低优先级问题留待后续迭代。

**影响范围**
- `scripts/build-agent-profiles.mjs` — 仅修复 #1 findVar + #2 node.r

**优点**
1. 改动最小，快速消除阻塞性问题
2. 不引入新风险

**缺点**
1. 其他缺陷仍然存在
2. 不解决 tokenTree 单 scheme、domTree=null 等问题

**风险**
- 低

**实施成本**
- 修改文件数: 1
- 代码行数: ~30 行
- 复杂度: **S**

**长期价值**
- 低，仅消除阻塞

**回归验证方式**
1. 运行 build-agent-profiles 验证不再报错
2. 验证 findVar 返回正确颜色值

**回滚方式**
- Git revert

---

### 方案 D: 引入 Zod schema 验证 + 修复

**解决思路核心策略**
为 raw profile 数据引入 Zod schema 验证，在数据进入分析管线前验证结构正确性。同时修复现有缺陷。

**影响范围**
- 新增 `scripts/lib/profile/schema.mjs`（Zod schema 定义）
- `scripts/build-agent-profiles.mjs` — 添加验证 + 修复
- 新增 schema 测试

**优点**
1. 数据验证前置，减少运行时错误
2. Zod 提供类型推断，增强类型安全

**缺点**
1. 引入新依赖（zod）
2. 增加构建时开销

**风险**
- 依赖增加（但 zod 是成熟库，体积适中）
- schema 定义可能与实际数据不完全匹配

**实施成本**
- 修改文件数: 1 + 新增 1
- 代码行数: ~150 行
- 复杂度: **M**

**长期价值**
- 数据验证模式可复用到其他脚本

**回归验证方式**
1. 使用有效/无效数据测试 schema 验证
2. 验证修复后的分析结果正确性

**回滚方式**
- Git revert + 移除 zod 依赖

---

### RC2 方案对比矩阵

| 维度 | A: 精准修复+测试 | B: 模块化重构 | C: 仅修阻塞 | D: Zod+修复 |
|------|-----------------|-------------|------------|------------|
| 实施成本 | M（3/120行） | L（6+/400行） | S（1/30行） | M（2/150行） |
| 缺陷覆盖 | 8/8 全覆盖 | 需配合 A | 2/8 阻塞 | 8/8 + 验证 |
| 风险 | 低 | 中 | 极低 | 低-中 |
| 长期价值 | 中（测试基线） | 高（架构） | 低 | 中-高 |
| 推荐度 | ★★★ 首选 | ★★ 中期 | ★ 快速止血 | ★★ 可选 |

---

## RC5: 性能隐患 (Major)

### 问题全景

| # | 文件:行 | 缺陷描述 |
|---|---------|---------|
| 1 | `CdpPerformancePanel.tsx:63` | 1秒 `setInterval` 无新 trace 时仍计算 `operationsPerMinute`，浪费 CPU |
| 2 | `visual-analyzer-ipc.ts:94` | 同步 `fs.readFileSync` 阻塞主进程（读取 multi-MB profile 文件） |

### 方案 A: 条件计算 + 异步 I/O（推荐）

**解决思路核心策略**
1. `CdpPerformancePanel`：仅在 `recentTraces` 变化时触发计算，使用 `useEffect` 依赖 `recentTraces` 替代固定 interval；interval 仅做轮询检查是否有新 trace
2. `visual-analyzer-ipc.ts`：将 `buildVisualAnalysisSummaries()` 中的 `fs.readFileSync` 改为 `fsPromises.readFile`，并延迟到首次调用时执行

**影响范围**
- `src/ui/components/diagnostics/CdpPerformancePanel.tsx` — 重构计算逻辑
- `src/main/ipc/visual-analyzer-ipc.ts` — readFileSync → readFile

**优点**
1. 消除无意义 CPU 消耗
2. 主进程不再阻塞（异步 I/O）
3. 改动最小，不引入新依赖

**缺点**
1. interval 仍然存在（但仅在需要时计算）
2. 异步化后首次调用 summary 可能有延迟（但已有缓存机制）

**风险**
- 低：异步化可能改变时序，但 IPC handler 本身是 async

**实施成本**
- 修改文件数: 2
- 代码行数: ~40 行
- 复杂度: **S**

**长期价值**
- 建立"条件计算"模式，可复用到其他轮询场景

**回归验证方式**
1. `npm run check` 全绿
2. 性能对比：修改前后主进程 CPU 占用（无 trace 时应为 0）
3. 功能验证：summary 数据正确性不变

**回滚方式**
- Git revert

---

### 方案 B: 引入 requestAnimationFrame + Web Worker

**解决思路核心策略**
1. 使用 `requestAnimationFrame` 替代 `setInterval`，仅在页面可见时计算
2. 将 `buildVisualAnalysisSummaries` 移至 Web Worker 或子进程执行

**影响范围**
- `src/ui/components/diagnostics/CdpPerformancePanel.tsx` — rAF 替代
- `src/main/ipc/visual-analyzer-ipc.ts` — Worker 化
- 新增 worker 文件

**优点**
1. 最佳性能：rAF 在页面隐藏时自动暂停
2. Worker 化彻底消除主进程阻塞

**缺点**
1. 实现复杂度高
2. Worker 通信开销
3. Electron 中 Worker 与 IPC 交互复杂

**风险**
- Worker 化可能引入新的通信问题
- rAF 在 Electron 中的行为可能与浏览器略有不同

**实施成本**
- 修改文件数: 2 + 新增 1-2
- 代码行数: ~150 行
- 复杂度: **M**

**长期价值**
- Worker 模式可复用到其他重计算场景

**回归验证方式**
1. 验证页面隐藏时计算暂停
2. 验证 Worker 计算结果正确
3. 性能对比

**回滚方式**
- Git revert

---

### 方案 C: 降低轮询频率 + 缓存

**解决思路核心策略**
1. 将 1秒 interval 降为 5秒
2. 为 `buildVisualAnalysisSummaries` 添加文件 mtime 检查，未变化时直接返回缓存

**影响范围**
- `src/ui/components/diagnostics/CdpPerformancePanel.tsx` — 降频
- `src/main/ipc/visual-analyzer-ipc.ts` — mtime 检查

**优点**
1. 改动最小
2. 显著降低 CPU 消耗

**缺点**
1. 仍然是轮询，不是事件驱动
2. 5秒延迟可能导致数据显示不及时

**风险**
- 极低

**实施成本**
- 修改文件数: 2
- 代码行数: ~20 行
- 复杂度: **S**

**长期价值**
- 低

**回归验证方式**
1. 验证 CPU 占用降低
2. 验证数据正确性

**回滚方式**
- Git revert

---

### 方案 D: 事件驱动替代轮询

**解决思路核心策略**
1. 主进程在 new trace 到达时主动推送事件到 renderer
2. renderer 订阅事件触发计算，完全移除 interval
3. 异步 I/O 同方案 A

**影响范围**
- `src/ui/components/diagnostics/CdpPerformancePanel.tsx` — 移除 interval，改为事件驱动
- `src/main/ipc/performance-ipc.ts` — 确保 new trace 事件正确推送
- `src/ui/stores/diagnosticsStore.ts` — 确保 trace 到达时触发计算

**优点**
1. 最佳架构：事件驱动，无浪费
2. 实时性最好

**缺点**
1. 依赖现有事件推送机制的正确性
2. 需要验证 new trace 事件是否可靠

**风险**
- 如果事件推送有丢失，计算可能不触发

**实施成本**
- 修改文件数: 3
- 代码行数: ~50 行
- 复杂度: **M**

**长期价值**
- 事件驱动模式可复用到其他实时数据场景

**回归验证方式**
1. 验证 new trace 到达时计算触发
2. 验证无 trace 时不计算
3. 长时间运行无内存泄漏

**回滚方式**
- Git revert

---

### RC5 方案对比矩阵

| 维度 | A: 条件计算+异步I/O | B: rAF+Worker | C: 降频+缓存 | D: 事件驱动 |
|------|-------------------|-------------|------------|-----------|
| 实施成本 | S（2/40行） | M（3+/150行） | S（2/20行） | M（3/50行） |
| 性能提升 | 显著 | 最佳 | 中等 | 最佳 |
| 风险 | 低 | 中 | 极低 | 低-中 |
| 长期价值 | 中 | 高 | 低 | 高 |
| 推荐度 | ★★★ 首选 | ★★ 进阶 | ★ 快速 | ★★ 可选 |

---

## 综合推荐

### 实施路径建议

| 阶段 | 方案 | 根因 | 预期产出 |
|------|------|------|---------|
| P0（本周） | RC1-A + RC2-A + RC5-A | RC1/RC2/RC5 | 消除所有阻塞性缺陷，功能可用 |
| P1（下周） | RC2-B（模块化） | RC2 | 架构优化，便于后续扩展 |
| P2（规划） | RC1-B（CDP 实现） | RC1 | 完整 live 分析能力 |

### 总体实施成本估算

- P0 总计: 修改 ~10 文件，~240 行代码，复杂度 S-M
- P1 总计: 修改 ~6+ 文件，~400 行代码，复杂度 L
- P2 总计: 修改 ~6+ 文件，~500 行代码，复杂度 L

### 验收标准

1. `npm run check` 全绿
2. Export 功能可用（传入正确数据时成功）
3. build-agent-profiles 输出正确（findVar 返回颜色而非字体族）
4. CDP Performance Panel 无 trace 时 CPU 占用为 0
5. 所有新增测试通过
