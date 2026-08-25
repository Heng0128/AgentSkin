# 工程质量门禁 — 9 根因候选方案对比矩阵

> 生成日期: 2026-08-20
> 范围: AgentSkin 项目工程质量门禁（Quality Gate）系统性修复
> 根因来源: 工程质量审计报告（9 RC）

---

## 总览矩阵

| RC | 根因 | 严重度 | 方案数 | 推荐方案 |
|----|------|--------|--------|----------|
| RC-01 | npm run check 严重不完整 | critical | 4 | A（渐进式全收） |
| RC-02 | 14-token 契约三源分裂 | critical | 3 | A（canonical 抽离） |
| RC-03 | CI 守门脚本无测试覆盖 | critical | 4 | B（关键优先） |
| RC-04 | TS 类型绕过在测试中蔓延 | major | 3 | B（渐进收紧） |
| RC-05 | 覆盖率门禁形同虚设 | major | 4 | B（分阶段提标） |
| RC-06 | 多源硬编码 AgentId/profile/token | major | 3 | A（单一数据源） |
| RC-07 | C9/C10 不变量悬空 | major | 3 | A（一次性补齐） |
| RC-08 | 守门脚本代码级缺陷 | major | 3 | A（直接修复） |
| RC-09 | Biome 规则集过于宽松 | major | 3 | B（分层启用） |

---

## RC-01: npm run check 严重不完整

**现状**: `npm run check` 仅含 biome + tsc + design-tokens + i18n 共 4 步。13 个 check-* 脚本中 9 个未被 CI 触发。CI PR Gate 和 pre-push hook 直接依赖此不完整命令。

### 方案 A（推荐）: 渐进式全收 — 分阶梯完整化

**核心策略**: 将 `npm run check` 拆分为 `check:fast`（本地开发）和 `check:full`（CI/PR），按脚本稳定性分批纳入，每日收敛一个子集。

**影响范围**:
- `package.json`（scripts 段）
- `.github/workflows/pr.yml`（替换为 `check:full`）
- `.husky/pre-push`（替换为 `check:full`）
- `scripts/INDEX.md`（更新文档）

**优点**:
1. 对团队透明：本地 `npm run check` 仍快速（<30s），CI 独立运行完整版
2. 渐进收编避免一次性引入过多 breaking change，每个脚本可独立回滚

**缺点**:
1. 双轨运行期本地与 CI 门禁不一致，可能产生"本地过 CI 不过"的体验
2. 需要团队培训/文档同步更新

**风险**:
- 部分脚本（如 check-dependency-audit）依赖网络或重计算，CI timeouts 概率增加
- 如果分阶梯周期过长，团队可能习惯性忽略新脚本

**实施成本**: 4 文件 / ~60 行改动 / 复杂度 M
- 拆分 scripts 命名并调整 CI 配置约 40 行
- 每个脚本入编前需要单独验证稳定性约 15min/脚本

**长期价值**: 建立可持续演进的 CI 门禁体系，后续新脚本天然接入 `check:full`

**回归验证**: `npm run check:full` 全绿；删除一个脚本后 CI 报错确认敏感性

**回滚方式**: 从 package.json 移除对应 && 连接符即可

---

### 方案 B: 一次性全收 — 全部 13 脚本纳入 npm run check

**核心策略**: 将所有 check-* 脚本通过 `&&` 串联进 `npm run check`，同步更新 CI 和 hook。

**影响范围**: 同方案 A

**优点**:
1. 概念简单：一个命令守所有门
2. 一次性解决，无双轨期

**缺点**:
1. 本地 `npm run check` 可能从 ~15s 延至 60-90s，开发者体验下降
2. 任一脚本失败即阻断，网络依赖脚本（dependency-audit）可能造成 flaky CI

**风险**:
- CI 超时（当前 pr.yml timeout 为 15min，全脚本链可能逼近上限）
- 首次全量运行可能暴露大量存量违规，团队需一次性处理

**实施成本**: 3 文件 / ~30 行 / 复杂度 S

**长期价值**: 概念最简

**回归验证**: `npm run check` 全绿；人为制造一个 violation 确认捕获

**回滚方式**: 从 package.json 移除后缀脚本引用

---

### 方案 C: 并行管道 — concurrently 编排

**核心策略**: 使用 `concurrently` 或类似工具将所有 check 脚本并行执行，聚合 exit code。

**影响范围**:
- `package.json`（新增 `concurrently` 依赖）
- `.github/workflows/pr.yml`
- `.husky/pre-push`

**优点**:
1. 总耗时 = 最慢单脚本耗时，不随脚本数增长
2. 单脚本失败不阻断其他脚本运行（最后聚合报错）

**缺点**:
1. 增加新依赖（concurrently），违反"技术栈不可随意新增"规则
2. 并行日志交错，调试体验差
3. 某些脚本有文件系统写入冲突风险（如同时写 themes/）

**风险**:
- 输出竞态导致难以定位失败源
- 需验证所有脚本的 FS 操作是否幂等/隔离

**实施成本**: 4 文件 / ~50 行 + 1 新依赖 / 复杂度 M

**长期价值**: 可扩展性好

**回归验证**: 并行执行 + 串行执行结果一致性

**回滚方式**: 还原为 && 串联

---

### 方案 D: 元脚本编排器 — check-orchestrator.mjs

**核心策略**: 新建 `scripts/check-orchestrator.mjs`，读取声明式配置（JSON/TOML）编排所有 check 脚本，支持并行/串行/超时/忽略。

**影响范围**:
- `scripts/check-orchestrator.mjs`（新建）
- `scripts/check-manifest.json`（新建）
- `package.json`
- `.github/workflows/pr.yml`

**优点**:
1. 集中管理：timeout、severity、skip 条件一目了然
2. 支持 per-script 超时和失败降级（warn vs error）

**缺点**:
1. 自建编排器引入新的维护负担和 bug 面
2. 违反"脚本就近"原则，新增元脚本需登记 INDEX

**风险**:
- orchestrator 自身的正确性需要测试（元质量循环问题）
- 过度工程化

**实施成本**: 5 文件 / ~200 行 / 复杂度 L

**长期价值**: 高度可配置

**回归验证**: orchestrator 需自身有测试覆盖

**回滚方式**: 删除 orchestrator 文件，还原 package.json

---

## RC-02: 14-token 契约三源分裂

**现状**:
- `check-themes.mjs` 头注释声称 14 但 `REQUIRED_TOKENS` 数组含 15 项（含 `--agentskin-text-shadow`）
- `check-theme-staleness.mjs` 数组含 14 项（不含 `--agentskin-text-shadow`）
- `tests/contract/14-token-theme-contract.test.ts` 数组含 13 项且头注释声称 14

### 方案 A（推荐）: 抽离 canonical token 列表为共享模块

**核心策略**: 创建 `scripts/theme-tokens.mjs` 作为单一数据源，导出 `REQUIRED_TOKENS`、`PALETTE_TOKENS`、`RAW_TOKENS`，三处消费者 import 此模块。

**影响范围**:
- `scripts/theme-tokens.mjs`（新建）
- `scripts/check-themes.mjs`（移除本地定义，改为 import）
- `scripts/check-theme-staleness.mjs`（同上）
- `scripts/check-variable-bridge.mjs`（`AGENTSKIN_TOKENS` 也改为 import）
- `tests/contract/14-token-theme-contract.test.ts`（改为 import 或显式同步注释）

**优点**:
1. 真正的 single source of truth，消除漂移可能
2. 新增/删除 token 只需改一处

**缺点**:
1. 测试文件直接 import `.mjs` 需 ESM 支持，vitest 通常支持但需确认
2. `--agentskin-text-shadow` 的去留需要设计决策（保留或移除需更新 THEME_SPEC.md）

**风险**:
- 如果删除 `--agentskin-text-shadow`，已生成的 CSS 可能仍有此声明但不再被检查
- 测试文件的 import 路径需要正确配置 aliases

**实施成本**: 5 文件 / ~80 行 / 复杂度 M
- 新建共享模块 ~30 行
- 三处消费者改造各 ~15 行
- 设计决策评审 ~1 小时

**长期价值**: token 列表天然 single-source，THEME_SPEC.md 文档同步更新后全链路一致

**回归验证**: 三处消费者输出 identical token 列表；人为修改 canonical 模块确认三处均报错

**回滚方式**: 还原各文件本地定义，删除 theme-tokens.mjs

---

### 方案 B: 运行时交叉校验 — 脚本互校

**核心策略**: 新建 `check-token-list-sync.mjs`，在运行时比对三处数组的实际内容，exit 1 当不一致。

**影响范围**:
- `scripts/check-token-list-sync.mjs`（新建）
- `package.json`（加入 check 链）
- `scripts/INDEX.md`

**优点**:
1. 无需改动现有文件结构，零侵入
2. 能发现任何新引入的第四处分裂

**缺点**:
1. 不解决根源，只告警漂移
2. 需解析 AST 或正则提取数组内容，实现复杂

**风险**:
- 正则提取数组可能因格式变化产生 false negative
- 仅发现问题不修复，团队仍需手动同步

**实施成本**: 3 文件 / ~100 行 / 复杂度 M

**长期价值**: 作为辅助手段有效，但不替代 canonical 抽离

**回归验证**: 人为制造一处分裂确认脚本报错

**回滚方式**: 删除脚本，移除 package.json 引用

---

### 方案 C: 文档驱动 + codegen

**核心策略**: 将 token 列表定义在 `docs/THEME_SPEC.md` 的机器可读段（如 JSON block），所有脚本和测试从此文档解析。

**影响范围**:
- `docs/THEME_SPEC.md`（新增结构化 token 定义段）
- 全部三个消费者（改为解析文档）

**优点**:
1. 文档即契约，THEME_SPEC.md 成为真正的 single source
2. 设计与实现天然对齐

**缺点**:
1. 解析 Markdown 内的代码块增加运行时依赖
2. 改动范围最大，三个消费者全部重写

**风险**:
- Markdown 解析脆弱性（格式变化导致解析失败）
- 违反"文档只是文档"的惯用模式

**实施成本**: 4 文件 / ~150 行 / 复杂度 L

**长期价值**: 文档-代码一致性最强

**回归验证**: 修改文档中 token 列表确认消费者行为变化

**回滚方式**: 还原为消费者本地定义

---

## RC-03: CI 守门脚本无测试覆盖

**现状**: 13 个 check-* 脚本中至少 9 个完全没有对应测试文件。`scripts/` 目录下仅有 3 个 test 文件（leonardo-wrapper, oklch-utils, merge-selector-harvest），均为非 check-* 脚本。

### 方案 A: 全量补全 — 每个 check-* 脚本配一个 .test.mjs

**核心策略**: 为每个 check-* 脚本创建对应的 `scripts/*.test.mjs`，使用 fixtures（正常/异常/边界输入）验证 exit code 和输出。

**影响范围**:
- 9+ 新建 `scripts/**/*.test.mjs` 文件
- `vitest.config.ts`（scripts project 已配置 include）
- `scripts/INDEX.md`

**优点**:
1. 完整测试覆盖，每个脚本的正确性有人验证
2. 脚本修改时有安全网

**缺点**:
1. 工作量大（9+ 测试文件），每个需要构造 fixtures
2. 部分脚本依赖文件系统状态（themes/, engines/），测试需要 mock 或 fixtured 目录

**风险**:
- 测试本身可能有 bug，产生 false confidence
- fixtures 随代码演化需要维护

**实施成本**: 12+ 文件 / ~800 行 / 复杂度 XL

**长期价值**: 元质量闭环

**回归验证**: `npm test` 跑 scripts project 全绿；人为在 check 脚本中引入 bug 确认测试捕获

**回滚方式**: 删除测试文件

---

### 方案 B（推荐）: 关键优先 — 先守最重要的 5 个

**核心策略**: 按风险优先级排序，先为 C1/C2/C4/C5/C6（injection, themes, architecture, store, design-tokens）对应的脚本补全测试，其余按需补。

**影响范围**: 5 新建 `scripts/**/*.test.mjs` 文件

**优点**:
1. 投入产出比最高：覆盖最关键不变量的脚本先被验证
2. 剩余脚本可渐进补齐

**缺点**:
1. 非关键脚本仍无覆盖
2. 优先级排序本身需要评审

**风险**:
- 排序不当导致某重要脚本遗漏

**实施成本**: 5 文件 / ~400 行 / 复杂度 L

**长期价值**: 高价值脚本有保障

**回归验证**: 同上

**回滚方式**: 删除测试文件

---

### 方案 C: smoke-only — 仅验证每个脚本可执行且不抛异常

**核心策略**: 为每个脚本创建最小测试：执行脚本（使用合法输入），仅断言 exit code = 0 且不抛异常。

**影响范围**: 9 新建极简 `scripts/**/*.test.mjs`

**优点**:
1. 工作量最小（每文件 ~10 行）
2. 能捕获语法错误、import 失败等基础问题

**缺点**:
1. 不验证脚本逻辑正确性（false negative 无法捕获）
2. 价值有限——脚本本身能运行不代表检查逻辑正确

**风险**:
- 给团队"已有测试"的假象，实则安全网薄弱

**实施成本**: 9 文件 / ~100 行 / 复杂度 M

**长期价值**: 低，但优于零覆盖

**回归验证**: vitest scripts project 全绿

**回滚方式**: 删除测试文件

---

### 方案 D: 集成测试策略 — 在已知-good/bad 仓库快照上运行

**核心策略**: 准备一个包含正常内容和违规内容的小型 fixtures 仓库，在 CI 上对每个 check-* 脚本运行两次（good → exit 0, bad → exit 1）。

**影响范围**:
- `tests/fixtures/check-scripts/` 目录（新建，含 good/bad 快照）
- `scripts/check-integration.test.mjs`（新建）

**优点**:
1. 测试的是脚本在真实文件系统上的行为，不仅是语法
2. 测试脚本组合行为

**缺点**:
1. fixtures 维护成本高
2. 测试执行速度慢（需 I/O 操作）

**风险**:
- fixtures 与实际项目不同步时测试失去意义
- git 仓库中嵌入 fixtures 目录体积膨胀

**实施成本**: 5 文件 + / ~500 行 / 复杂度 L

**长期价值**: 最接近真实 CI 环境的验证

**回归验证**: 同上

**回滚方式**: 删除 fixtures 目录和测试文件

---

## RC-04: TypeScript 类型绕过在测试中蔓延

**现状**: agent-engine-service 系列测试最严重（3 文件约 20处），总计 50+ 测试文件含 `as any` / `as unknown as`。

### 方案 A: 全面清除 — 一次性修复全部 as any

**核心策略**: 全员手动修复每一处类型绕过，使用正确的类型断言或重构测试代码。

**影响范围**: 50+ 测试文件

**优点**:
1. 一次性解决，消除技术债
2. 提升测试的类型安全性

**缺点**:
1. 工作量大（可能需数天），且部分绕过需要理解被测代码的私有结构才能正确重构
2. 修复过程中可能引入回归

**风险**:
- 过度重构测试代码导致测试逻辑改变
- 某些 `as any` 实际上是合理的（如 mock 第三方库），误删导致测试失败

**实施成本**: 50+ 文件 / ~500 行 / 复杂度 XL

**长期价值**: 测试类型安全最高

**回归验证**: `npm test` 全绿；`npm run typecheck` 全绿

**回滚方式**: git revert 对应 commit

---

### 方案 B（推荐）: 渐进收紧 — Biome lint 先行 + 分批修复

**核心策略**:
1. 在 biome.json test overrides 中将 `noExplicitAny` 从 `warn` 提升为 `error`
2. 分批修复：每次 PR 处理 1-2 个文件的类型绕过
3. 对于确实无法避免的场景（如动态 mock），使用 `// biome-ignore` 注释说明原因

**影响范围**:
- `biome.json`（规则升级）
- 分批修改测试文件（每批 1-2 个文件）

**优点**:
1. 渐进式，不会一次性阻断团队
2. biome-ignore 注释提供审计痕迹

**缺点**:
1. 周期长（可能数周），期间 CI 红灯
2. `biome-ignore` 注释本身可能成为新的污染源

**风险**:
- 如果直接升为 error 而不分批修复，CI 将直接崩溃
- 需要 team lead 协调分批计划

**实施成本**: 1 文件（biome）+ 分批修复 50+ 文件 / ~300 行 / 复杂度 L

**长期价值**: 建立类型安全文化

**回归验证**: biome 检查通过 + vitest 全绿

**回滚方式**: 将 biome.json 中规则降回 warn

---

### 方案 C: 隔离绕过 — 允许测试文件中有限度使用 any

**核心策略**: 承认测试中 mock 的合理性，创建测试专用的类型辅助模块（如 `test-utils/types.ts`），提供安全的 mock 类型，避免裸 `as any`。

**影响范围**:
- `test-utils/types.ts`（新建）
- 测试文件替换裸 `as any` 为类型化 mock helper

**优点**:
1. 区分"合理的测试 mock"和"不合理的类型绕过"
2. 类型化 mock helper 可复用

**缺点**:
1. 创建类型化 mock 需深入理解每个被 mock 的接口
2. 维护成本随接口变化增加

**风险**:
- mock helper 本身可能与实际类型脱节

**实施成本**: 30+ 文件 / ~400 行 / 复杂度 L

**长期价值**: mock 类型安全

**回归验证**: typecheck + vitest 全绿

**回滚方式**: 还原测试文件

---

## RC-05: 覆盖率门禁形同虚设

**现状**: coverage.thresholds 极低（statements 45%、branches 40%、functions 35%、lines 45%），且 `npm test` 不带 `--coverage`、CI 也未单独运行覆盖率。

### 方案 A: 一次性提标 — 直接提高到 80/70/70/80

**核心策略**: 将 coverage thresholds 直接提升至行业常规水平，在 CI 中启用 `--coverage`。

**影响范围**:
- `vitest.config.ts`
- `.github/workflows/pr.yml`

**优点**:
1. 目标明确，一步到位
2. 高覆盖率驱动更多测试编写

**缺点**:
1. 当前实际覆盖率未知，大概率 CI 直接红灯
2. 团队需大量补写测试才能恢复绿灯，影响交付节奏

**风险**:
- 覆盖率数据尚未收集，盲目提标导致 CI 长期瘫痪

**实施成本**: 2 文件 / ~10 行 + 大量补写测试 / 复杂度 L

**长期价值**: 高

**回归验证**: 覆盖率报告不低于阈值

**回滚方式**: 降回原阈值

---

### 方案 B（推荐）: 分阶段提标 — 先测量再分步提升

**核心策略**:
1. 先在 CI 中启用 `--coverage` 但**不启用 thresholds**，运行 1-2 周收集基线
2. 根据基线数据，设定第一阶目标（如基线 + 10%）
3. 每 2 周一阶，逐步逼近最终目标

**影响范围**:
- `vitest.config.ts`（分阶段调整 thresholds）
- `.github/workflows/pr.yml`（加入 coverage 步骤）

**优点**:
1. 数据驱动，目标合理
2. 团队有适应期，不会一次性被打断

**缺点**:
1. 周期长（可能 2-3 个月）
2. 需要持续监控和调整

**风险**:
- 各阶段提升目标设定不当仍可能产生红灯

**实施成本**: 2 文件 / ~30 行 / 复杂度 M（不含补写测试工作量）

**长期价值**: 可持续的覆盖率提升

**回归验证**: 每阶段 CI 覆盖率报告

**回滚方式**: 回退 thresholds 值

---

### 方案 C: 增量门禁 — 仅看新增代码覆盖率

**核心策略**: 使用 `coverage.ignoreEmptyLines` + per-file threshold，只对 git diff 中的新增/修改文件应用覆盖率门禁。

**影响范围**:
- `vitest.config.ts`
- `.github/workflows/pr.yml`

**优点**:
1. 不触碰存量代码，零破坏
2. 新增代码天然高质量

**缺点**:
1. 存量代码仍为低覆盖率，整体指标可能停滞
2. vitest v8 provider 的 per-file coverage 配置较复杂

**风险**:
- 边界 case（文件重命名、大段重构）可能绕过增量检查

**实施成本**: 2 文件 / ~20 行 / 复杂度 M

**长期价值**: 增量代码质量有保障

**回归验证**: 新增低覆盖文件时 CI 报错

**回滚方式**: 移除增量配置

---

### 方案 D: 覆盖率可视化 + 定期审计

**核心策略**: 不设置硬门禁，而是在 CI 中生成覆盖率报告（lcov/json），上传为 artifact，每周人工审计趋势。

**影响范围**:
- `.github/workflows/pr.yml`

**优点**:
1. 零阻断风险
2. 可视化驱动改进

**缺点**:
1. 无强制力，改善速度依赖团队自觉
2. 与 RC-05 "门禁形同虚设"的修复目标不完全对齐

**风险**:
- 沦为"永远在看但没有行动"

**实施成本**: 1 文件 / ~15 行 / 复杂度 S

**长期价值**: 中低

**回归验证**: CI 生成覆盖率报告

**回滚方式**: 移除 coverage 步骤

---

## RC-06: 多源硬编码 AgentId/profile/token — 无 canonical 单一维护点

**现状**:
- `scripts/check-specificity-budget.mjs` 中 `PROFILES` 硬编码了 6 个 adapter 的 specificity 配置（含 maxSpecificity、importantBudget）
- 与 `src/compiler/specificity.ts` 中的 `AGENT_SPECIFICITY_PROFILES` 完全重复维护
- AgentId 列表在 `check-native-defect-consistency.mjs` 的 `agents` 数组中也独立维护
- 主题 CSS 生成器中的 host selector 也可能与 main-process 常量不一致

### 方案 A（推荐）: 单一数据源 — 全部从 canonical 导入

**核心策略**: 所有 `scripts/check-*.mjs` 中需要的 AgentId 列表和 profile 数据，统一从 `src/compiler/specificity.ts` 和 `src/shared/injection-constants.ts` 导入。

**影响范围**:
- `scripts/check-specificity-budget.mjs`（移除 PROFILES 改为 import）
- `scripts/check-native-defect-consistency.mjs`（移除 agents 数组改为 import）
- `scripts/check-injection-contract.mjs`（可能已使用 canonical 源）
- 可能需要在 `src/compiler/specificity.ts` 中添加 getter 函数供 .mjs import

**优点**:
1. 消除所有硬编码副本
2. 新增 agent 只需改一处

**缺点**:
1. TypeScript 文件被 .mjs 脚本 import，需确认 Node ESM 的 .ts import 支持（可能需要编译中间产物）
2. 可能需要将 shared 模块打包为 `.mjs` 或 dual-export

**风险**:
- Node 22 原生 TypeScript import 尚未完全稳定（需 `--experimental-strip-types` 或编译步骤）
- 可能需要在 tsconfig 中添加编译目标

**实施成本**: 5 文件 / ~100 行 / 复杂度 L

**长期价值**: AgentId/profile/token 天然单一数据源

**回归验证**: 修改 canonical 源确认所有脚本行为一致更新

**回滚方式**: 还原脚本中的本地定义

---

### 方案 B: 运行时交叉校验脚本

**核心策略**: 新建 `check-canonical-sync.mjs`，运行时比对所有硬编码列表是否与 canonical 源一致，exit 1 当漂移。

**影响范围**:
- `scripts/check-canonical-sync.mjs`（新建）
- `package.json`

**优点**:
1. 零侵入现有代码
2. 能发现任何新的硬编码副本

**缺点**:
1. 不解决根源（允许重复但检测漂移）
2. 增加 CI 运行时间

**风险**: 同 RC-02 方案 B

**实施成本**: 3 文件 / ~80 行 / 复杂度 M

**长期价值**: 中等，检测但不消除

**回归验证**: 人为制造漂移确认脚本报错

**回滚方式**: 删除脚本

---

### 方案 C: JSON 配置桥接 — 导出 canonical 数据为 JSON

**核心策略**: 在 `scripts/` 下创建 `canonical-bridge.mjs`，运行时 import TS 模块（通过 tsx 或编译后产物），将 AgentId/profile/token 列表导出为 JSON，check 脚本读取 JSON。

**影响范围**:
- `scripts/canonical-bridge.mjs`（新建）
- `scripts/canonical-data.json`（生成物，gitignore 或提交）
- 各 check 脚本改为读 JSON

**优点**:
1. .mjs 脚本不依赖 TS import
2. JSON 作为中间产物便于调试

**缺点**:
1. 引入 codegen 步骤，增加构建复杂度
2. JSON 文件可能过期

**风险**:
- bridge 脚本自身的依赖链可能有坑

**实施成本**: 6 文件 / ~120 行 / 复杂度 L

**长期价值**: 可行但有维护成本

**回归验证**: JSON 与 TS 源一致

**回滚方式**: 还原各脚本

---

## RC-07: C9/C10 不变量完全悬空

**现状**:
- `check:defect-doc` 在 package.json 中不存在，无脚本触发
- `check-variable-bridge` 未被列入 `npm run check`
- `check-native-defect-consistency` (C8) 同样无人触发
- C9 check 的实质是运行 `generate-defect-fixes-doc.mjs --verify`

### 方案 A（推荐）: 一次性补齐 C8/C9/C10

**核心策略**: 将三个缺失的不变量检查全部加入 `npm run check`，并为 C9 创建正确的 npm script。

**影响范围**:
- `package.json`（添加 `check:defect-doc`、将三个脚本加入 check 链）
- `AGENTS.md` §4 不变量表（更新守卫脚本列）
- `scripts/INDEX.md`

**优点**:
1. 一次性解决三个悬空不变量
2. 改动最小，概念最清晰

**缺点**:
1. C9 的 `generate-defect-fixes-doc.mjs --verify` 需要读取文件系统，CI 中可能较慢
2. 如果 `docs/native-defect-fixes.md` 当前已过期，首次运行会失败

**风险**:
- 需要先运行一次 `generate-defect-fixes-doc.mjs` 生成最新文档，再纳入 CI

**实施成本**: 3 文件 / ~15 行 / 复杂度 S

**长期价值**: C8/C9/C10 三个不变量全部有 CI 守卫

**回归验证**: 人为修改 native-defect-fixes.md 确认 CI 报错

**回滚方式**: 从 package.json 移除对应行

---

### 方案 B: 独立 job — 在 CI 中单独运行

**核心策略**: 在 `.github/workflows/pr.yml` 中为 C8/C9/C10 创建独立 step，不混入 `npm run check`。

**影响范围**:
- `.github/workflows/pr.yml`

**优点**:
1. 失败隔离：C8/C9/C10 失败不影响主 check 流程
2. 可独立设置超时和重试策略

**缺点**:
1. 概念分散：不变量检查不在 `npm run check` 中，违反 AGENTS.md §4 的"npm run check 全绿"规则
2. 本地开发者无法一键运行全部不变量检查

**风险**:
- 团队可能忘记在本地运行这些独立检查

**实施成本**: 1 文件 / ~20 行 / 复杂度 S

**长期价值**: 中

**回归验证**: CI 独立 step 失败确认

**回滚方式**: 移除 CI step

---

### 方案 C: 文档新鲜度作为 pre-commit hook

**核心策略**: 将 C9（defect-doc freshness）加入 `.husky/pre-commit` 的 `docs/**/*.md` 触发条件，而非 `npm run check`。

**影响范围**:
- `.husky/pre-commit`

**优点**:
1. 在提交时即时验证，反馈最快
2. 不增加 CI 负担

**缺点**:
1. 仅覆盖 C9，C8/C10 仍需其他方式
2. pre-commit hook 增加提交延迟

**风险**:
- 开发者可能 `--no-verify` 绕过

**实施成本**: 1 文件 / ~5 行 / 复杂度 S

**长期价值**: 低（仅解决 C9）

**回归验证**: 修改文档后提交确认 hook 拦截

**回滚方式**: 移除 hook 行

---

## RC-08: 守门脚本自身存在代码级缺陷

**现状**:
- `check-design-tokens.mjs` 的 `fileExists` 函数名实不符（实际检查 isDirectory 而非 isFile）
- `IGNORED_DIRS` 过滤逻辑问题（先检查 `.` 前缀再检查目录名，但 `.build-tmp` 等以 `.` 开头的目录会被第一个条件跳过）
- `check-native-defect-consistency.mjs` 的 `main()` 无 try/catch，异常直接 crash 而非友好报错

### 方案 A（推荐）: 直接修复 — 精准手术

**核心策略**: 逐一修复每个已知缺陷，添加防御性错误处理。

**影响范围**:
- `scripts/check-design-tokens.mjs`（修复 fileExists 函数名/逻辑）
- `scripts/check-native-defect-consistency.mjs`（添加 try/catch）

**优点**:
1. 改动最小，风险可控
2. 直接消除已知 bug

**缺点**:
1. 仅修复已知问题，可能有未知缺陷残留
2. 不建立防止同类问题再生的机制

**风险**:
- 修复 `fileExists` 时如果改为正确检查 isFile，可能影响 walkDir 的过滤逻辑

**实施成本**: 2 文件 / ~30 行 / 复杂度 S

**长期价值**: 脚本健壮性提升

**回归验证**: 人为制造 I/O 错误确认脚本友好退出

**回滚方式**: git revert

---

### 方案 B: 全面审查 + 修复 — 审计所有 13 个脚本

**核心策略**: 对全部 13 个 check-* 脚本进行代码审查，发现并修复所有潜在缺陷（不仅是已知三个）。

**影响范围**: 全部 13 个 check-* 脚本

**优点**:
1. 全面消除缺陷
2. 统一错误处理风格

**缺点**:
1. 工作量大（13 文件逐一审查）
2. 可能引入非预期改动

**风险**:
- 审查不充分可能遗漏问题

**实施成本**: 13 文件 / ~150 行 / 复杂度 M

**长期价值**: 整体脚本质量提升

**回归验证**: 每个脚本的单元测试（需配合 RC-03）

**回滚方式**: git revert

---

### 方案 C: 添加通用错误处理包装器

**核心策略**: 创建 `scripts/_check-wrapper.mjs`，为所有 check 脚本提供统一的错误处理、超时、日志格式。各脚本改为通过 wrapper 调用。

**影响范围**:
- `scripts/_check-wrapper.mjs`（新建）
- 全部 13 个 check-* 脚本（改为 export main 而非直接调用）
- `package.json`（更新调用方式）

**优点**:
1. 统一错误处理和日志格式
2. 未来新增脚本天然继承

**缺点**:
1. 改动范围大（13 文件重构）
2. 引入新的间接层

**风险**:
- wrapper 自身的 bug 影响所有脚本

**实施成本**: 14 文件 / ~200 行 / 复杂度 L

**长期价值**: 高（统一基础设施）

**回归验证**: 每个脚本通过 wrapper 正确执行

**回滚方式**: 还原各脚本

---

## RC-09: Biome 规则集过于宽松

**现状**: Biome 仅启用 `recommended: true` + 少量 style 覆盖。缺少 `noConsole`、`useExhaustiveDependencies`、`noUnusedVariables` 等关键规则。test override 中 `noExplicitAny` 仅为 `warn`。

### 方案 A: 激进收紧 — 一次性启用全部关键规则

**核心策略**: 在 biome.json 中启用所有关键质量规则（noConsole、useExhaustiveDependencies、noUnusedVariables、noExplicitAny error 等），一次性提升代码质量标准。

**影响范围**:
- `biome.json`
- 全部 src/ 文件（可能需要大量修复）

**优点**:
1. 质量标准一步到位
2. 捕获更多潜在 bug

**缺点**:
1. 存量代码可能产生大量 violations，团队需大量修复
2. CI 可能长期红灯

**风险**:
- `useExhaustiveDependencies` 对 React hooks 要求严格，可能产生大量 false positive
- `noConsole` 可能阻断合理的调试输出

**实施成本**: 1 文件 + 50+ 源文件修复 / ~500 行 / 复杂度 XL

**长期价值**: 代码质量最高

**回归验证**: biome check 全绿

**回滚方式**: 还原 biome.json

---

### 方案 B（推荐）: 分层启用 — 按规则风险分批激活

**核心策略**:
1. **第一批**（低风险高价值）: `noUnusedVariables` error、`noConsole` warn
2. **第二批**（中风险）: `useExhaustiveDependencies` warn → error
3. **第三批**（高风险）: `noExplicitAny` error（配合 RC-04 修复）
4. 每批启用后给团队 1 周修复期

**影响范围**:
- `biome.json`（分阶段修改）
- 源文件（分批修复）

**优点**:
1. 渐进式，CI 不长期瘫痪
2. 每批规则的影响可独立评估

**缺点**:
1. 周期长（3-4 周）
2. 需要持续跟踪进度

**风险**:
- 某批规则的 false positive 率高于预期

**实施成本**: 1 文件 + 分批修复 / ~300 行 / 复杂度 L

**长期价值**: 可持续的质量提升

**回归验证**: 每批 biome check 全绿

**回滚方式**: 还原对应规则配置

---

### 方案 C: 仅对新增代码生效 — biome + git diff

**核心策略**: 在 CI 中仅对 git diff 的新增/修改行运行严格规则，存量代码不受影响。

**影响范围**:
- `.github/workflows/pr.yml`（新增 biome diff 步骤）
- `biome.json`（保持宽松）

**优点**:
1. 零破坏存量代码
2. 新增代码天然高质量

**缺点**:
1. 不解决存量问题
2. biome 的 diff 模式需要额外工具支持（如 `biome check --changed`）

**风险**:
- biome 的 `--changed` 支持可能不完善

**实施成本**: 2 文件 / ~20 行 / 复杂度 S

**长期价值**: 中（仅增量改善）

**回归验证**: 新增违规代码 CI 报错

**回滚方式**: 移除 CI step

---

## 实施优先级建议

### Phase 1（Week 1-2）— 低成本高收益
| 动作 | RC | 方案 | 预估工时 |
|------|-----|------|----------|
| 修复 fileExists + try/catch | RC-08 | A | 2h |
| 补齐 C8/C9/C10 到 npm run check | RC-07 | A | 1h |
| 抽离 canonical token 列表 | RC-02 | A | 4h |
| 修复 14-token 头注释与数组不一致 | RC-02 | A | 1h |

### Phase 2（Week 3-4）— 结构性改善
| 动作 | RC | 方案 | 预估工时 |
|------|-----|------|----------|
| 渐进式全收 npm run check | RC-01 | A | 6h |
| 为 top-5 脚本补全测试 | RC-03 | B | 12h |
| 消除硬编码 AgentId/profile | RC-06 | A | 8h |

### Phase 3（Month 2-3）— 深度质量
| 动作 | RC | 方案 | 预估工时 |
|------|-----|------|----------|
| 分阶段提覆盖率阈值 | RC-05 | B | 持续 |
| 渐进收紧 Biome 规则 | RC-09 | B | 8h |
| 修复测试中 as any | RC-04 | B | 持续 |
| 剩余脚本补全测试 | RC-03 | B | 16h |

---

## 风险总览

| 风险 | 影响阶段 | 缓解措施 |
|------|----------|----------|
| CI 超时 | Phase 2 | 分阶梯纳入，监控 CI 时长 |
| 团队适应期 | 全 Phase | 文档同步 + 渐进式 |
| 存量违规爆发 | Phase 2-3 | 先测量再设目标 |
| 脚本测试维护成本 | Phase 3 | 优先 smoke test，按需深化 |
| TS 被 .mjs import 兼容性 | Phase 2 | 验证 Node 22 strip-types 或编译桥接 |
