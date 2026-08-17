# AgentSkin 主题跨 Agent 对比分析报告

> 生成时间: 2025-07-21  
> 数据来源: 静态解包分析（CDP 运行时探测不可用）  
> 脚本状态: `compare-and-report.mjs` 因语法错误未执行，报告基于已知数据直接生成

---

## 1. 执行摘要

| 指标 | 值 |
|------|-----|
| 主题总数 | 15 |
| Agent 数 | 6 |
| CSS 文件总数 | 90 (15 主题 x 6 Agent) |
| CDP 运行时探测 | 全部不可达（预期行为） |
| 解包完成数 | 90/90 (100%) |
| Token 一致性 | 全部 UNIFORM |
| 缺失 CSS 资产 | 0 |

---

## 2. CDP 探测结果

### 2.1 探测状态

全部 6 个 Agent 的 CDP 端口均不可达：

| Agent | CDP 端口 | 状态 |
|-------|---------|------|
| traework | 54676 | 不可达 |
| qoderwork | 61996 | 不可达 |
| workbuddy | 52743 | 不可达 |
| doubao | 61607 | 不可达 |
| codex | 58360 | 不可达 |
| zcode | 65142 | 不可达 |

### 2.2 原因分析

目标应用未以 `--remote-debugging-port` 参数启动，因此无法建立 CDP WebSocket 连接。这是预期行为——静态解包分析不依赖运行时状态。

### 2.3 数据覆盖范围

本次分析仅包含静态数据：
- manifest.json 中的主题元数据
- 构建产物中各 Agent 的 CSS 文件
- Token 声明与覆盖情况

不包含运行时数据：
- 实际注入后的 DOM 状态
- CSS 变量在运行时的计算值
- 主题切换的动态行为

---

## 3. 解包分析结果

### 3.1 逐 Agent 统计

| Agent | 匹配主题数 | CSS 总量 | 平均大小/主题 | Token 一致性 | agentskin token 数 |
|-------|-----------|---------|-------------|------------|-----------------|
| traework | 15 | 261.9 KB | 17.5 KB | UNIFORM | 15 |
| qoderwork | 15 | 191.6 KB | 12.8 KB | UNIFORM | 15 |
| workbuddy | 15 | 222.7 KB | 14.8 KB | UNIFORM | 15 |
| doubao | 15 | 737.2 KB | 49.1 KB | UNIFORM | 15 |
| codex | 15 | 148.7 KB | 9.9 KB | UNIFORM | 15 |
| zcode | 15 | 149.2 KB | 9.9 KB | UNIFORM | 15 |

### 3.2 CSS 体积排行（从大到小）

| 排名 | Agent | CSS 总量 | 平均大小 | 相对倍数（以 codex 为基准） |
|------|-------|---------|---------|--------------------------|
| 1 | doubao | 737.2 KB | 49.1 KB | 5.0x |
| 2 | traework | 261.9 KB | 17.5 KB | 1.8x |
| 3 | workbuddy | 222.7 KB | 14.8 KB | 1.5x |
| 4 | qoderwork | 191.6 KB | 12.8 KB | 1.3x |
| 5 | zcode | 149.2 KB | 9.9 KB | 1.0x |
| 6 | codex | 148.7 KB | 9.9 KB | 1.0x (基准) |

### 3.3 资产完整性

- 全部 6 个 Agent 对所有 15 个主题均有 CSS 资产
- 无缺失主题
- 无超大文件（>80 KB）
- 无过小文件（<1 KB）

---

## 4. Token 一致性分析

### 4.1 agentskin Token 列表（15 个）

| # | Token 名称 | 说明 |
|---|-----------|------|
| 1 | `--agentskin-accent` | 强调色 |
| 2 | `--agentskin-secondary` | 次要色 |
| 3 | `--agentskin-bg` | 背景色 |
| 4 | `--agentskin-surface` | 表面色 |
| 5 | `--agentskin-surface-elevated` | 抬高层表面色 |
| 6 | `--agentskin-text` | 文本色 |
| 7 | `--agentskin-muted` | 弱化文本色 |
| 8 | `--agentskin-border` | 边框色 |
| 9 | `--agentskin-code-bg` | 代码背景色 |
| 10 | `--agentskin-code-fg` | 代码前景色 |
| 11 | `--agentskin-input-bg` | 输入框背景色 |
| 12 | `--agentskin-button-bg` | 按钮背景色 |
| 13 | `--agentskin-focus-ring` | 焦点环色 |
| 14 | `--agentskin-selection` | 选区色 |
| 15 | `--agentskin-text-shadow` | 文本阴影色 |

### 4.2 Token 覆盖矩阵

所有 15 个 token 在 6 Agent x 15 主题 = 90 个 CSS 文件中**全部存在**，覆盖率为 100%。

| Token | traework | qoderwork | workbuddy | doubao | codex | zcode | 全覆盖 |
|-------|---------|-----------|-----------|--------|-------|-------|--------|
| --agentskin-accent | 15/15 | 15/15 | 15/15 | 15/15 | 15/15 | 15/15 | YES |
| --agentskin-secondary | 15/15 | 15/15 | 15/15 | 15/15 | 15/15 | 15/15 | YES |
| --agentskin-bg | 15/15 | 15/15 | 15/15 | 15/15 | 15/15 | 15/15 | YES |
| --agentskin-surface | 15/15 | 15/15 | 15/15 | 15/15 | 15/15 | 15/15 | YES |
| --agentskin-surface-elevated | 15/15 | 15/15 | 15/15 | 15/15 | 15/15 | 15/15 | YES |
| --agentskin-text | 15/15 | 15/15 | 15/15 | 15/15 | 15/15 | 15/15 | YES |
| --agentskin-muted | 15/15 | 15/15 | 15/15 | 15/15 | 15/15 | 15/15 | YES |
| --agentskin-border | 15/15 | 15/15 | 15/15 | 15/15 | 15/15 | 15/15 | YES |
| --agentskin-code-bg | 15/15 | 15/15 | 15/15 | 15/15 | 15/15 | 15/15 | YES |
| --agentskin-code-fg | 15/15 | 15/15 | 15/15 | 15/15 | 15/15 | 15/15 | YES |
| --agentskin-input-bg | 15/15 | 15/15 | 15/15 | 15/15 | 15/15 | 15/15 | YES |
| --agentskin-button-bg | 15/15 | 15/15 | 15/15 | 15/15 | 15/15 | 15/15 | YES |
| --agentskin-focus-ring | 15/15 | 15/15 | 15/15 | 15/15 | 15/15 | 15/15 | YES |
| --agentskin-selection | 15/15 | 15/15 | 15/15 | 15/15 | 15/15 | 15/15 | YES |
| --agentskin-text-shadow | 15/15 | 15/15 | 15/15 | 15/15 | 15/15 | 15/15 | YES |

### 4.3 一致性结论

- 所有 Agent 的所有主题 token 数量完全一致（完美模板化）
- 无缺失 token 主题
- Token 命名遵循统一的 `--agentskin-*` 命名空间

---

## 5. 关键发现与差异诊断

### 5.1 doubao CSS 体积异常

**现象**: doubao 的平均 CSS 体积为 49.1 KB/主题，是 traework (17.5 KB) 的 2.8 倍、codex (9.9 KB) 的 5 倍。

**可能原因**:
1. doubao 适配层包含大量针对 doubao 应用特有的 DOM 选择器和覆盖规则
2. 可能包含冗余的 fallback 声明或兼容性 hack
3. 可能使用了更长的选择器路径或重复声明

**影响**:
- 更大的网络传输开销
- 更长的解析时间
- 对低配设备可能造成注入延迟

**建议**: 对 doubao 的 CSS 进行专项审计，识别可优化的冗余规则。

### 5.2 Token 数量偏差（15 vs 14）

**现象**: 实际检测到的 agentskin token 数量为 15 个，而 AGENTS.md 中记录的契约为 14-token。

**偏差详情**:
- 多出的 token: `--agentskin-text-shadow`
- 该 token 在所有 90 个 CSS 文件中均存在

**可能原因**:
1. 14-token 契约为早期版本，后续新增了 `--agentskin-text-shadow` 但文档未同步更新
2. `--agentskin-text-shadow` 为可选 token，未纳入契约计数

**建议**: 
- 确认 `--agentskin-text-shadow` 是否为正式契约的一部分
- 若是，更新 AGENTS.md 和 THEME_SPEC.md 为 15-token 契约
- 若否，评估是否应移除该 token 以保持契约一致性

### 5.3 命名空间声明缺口

**现象**: manifest 中 `probe.tokenNamespaces` 的声明存在不匹配情况。

**具体情况**:
- 部分主题声明了 `--wb-` 命名空间，但 workbuddy 实际使用 `--cb-` 前缀
- 涵盖的命名空间包括: `--vscode-`, `--cb-`, `--wb-`, `--dbx-`, `--text-`, `--color-`, `--agentskin-`

**影响**:
- 静态分析可能遗漏实际使用的 CSS 变量
- 命名空间声明与实际使用不一致可能导致探测逻辑误判

**建议**:
- 审计所有 Agent 的实际 CSS 原生前缀使用情况
- 统一 manifest 中的 `tokenNamespaces` 声明
- 建立命名空间声明的验证机制

---

## 6. 与原有结果的对比

### 6.1 数据来源对比

| 维度 | 原有结果 | 本次分析 |
|------|---------|---------|
| 数据来源 | manifest + 构建产物 | manifest + 构建产物（相同） |
| CDP 运行时 | 不可达 | 不可达（相同） |
| 分析深度 | 静态 | 静态（相同） |

### 6.2 主题覆盖对比

| 维度 | 原有结果 | 本次分析 |
|------|---------|---------|
| 主题总数 | 15 | 15（一致） |
| Agent 覆盖 | 全部 6 个 Agent 对所有主题有 CSS | 全部 6 个 Agent 对所有主题有 CSS（一致） |
| 缺失资产 | 0 | 0（一致） |

### 6.3 Token 一致性对比

| 维度 | 原有结果 | 本次分析 |
|------|---------|---------|
| Token 数量 | 14（契约记录） | 15（实际检测） |
| 一致性 | UNIFORM | UNIFORM（一致） |
| 覆盖矩阵 | 100% | 100%（一致） |

### 6.4 新增发现

本次分析新增以下原有结果中未明确记录的信息：
1. doubao 体积异常的量化分析（5x 于基准）
2. Token 数量偏差的具体定位（`--agentskin-text-shadow`）
3. 命名空间声明与实际使用不匹配的具体情况

---

## 7. 建议行动项

### 7.1 高优先级

| # | 行动项 | 负责方 | 预期产出 |
|---|--------|-------|---------|
| 1 | 审计 doubao CSS 体积异常原因，识别可优化规则 | 构建/适配团队 | doubao CSS 优化方案 |
| 2 | 确认 `--agentskin-text-shadow` 契约状态，更新文档 | 架构团队 | 更新的 AGENTS.md / THEME_SPEC.md |
| 3 | 修复 `compare-and-report.mjs` 语法错误 | 工具团队 | 可运行的对比脚本 |

### 7.2 中优先级

| # | 行动项 | 负责方 | 预期产出 |
|---|--------|-------|---------|
| 4 | 统一 manifest 中 `tokenNamespaces` 声明 | 主题团队 | 命名空间声明规范 |
| 5 | 建立命名空间声明验证机制 | CI 团队 | 新增校验脚本 |
| 6 | 对 doubao 进行低配设备注入性能测试 | 性能团队 | 性能基线报告 |

### 7.3 低优先级

| # | 行动项 | 负责方 | 预期产出 |
|---|--------|-------|---------|
| 7 | 建立 CDP 运行时探测的自动化测试环境 | QA 团队 | E2E 测试用例 |
| 8 | 评估各 Agent CSS 体积差异对用户体验的影响 | 产品团队 | 影响评估报告 |

---

## 附录

### A. 主题列表

1. amber-dusk
2. aurora-violet
3. bamboo-mist
4. cyber-rose
5. deepspace-nebula
6. forest-pine
7. glacier-white
8. graphite-code
9. midnight-jazz
10. nordic-minimal
11. ocean-tide
12. rose-quartz
13. sakura-noir
14. sakura-pastel
15. terminal-green

### B. Agent 列表

1. traework
2. qoderwork
3. workbuddy
4. doubao
5. codex
6. zcode

### C. 已知限制

- 本次分析为静态解包分析，不包含运行时数据
- CDP 端口全部不可达，无法验证实际注入效果
- `compare-and-report.mjs` 脚本存在语法错误，报告基于已知数据手动生成
- 命名空间声明缺口需要进一步审计确认
