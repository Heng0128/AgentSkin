# AgentSkin Sub-agent Prompt 模板

> 经过 4 轮方法论迭代验证的核心教训：每次 sub-agent 修复 prompt 必须显式写 "修复 + 补测试 + 主体验证"三阶段，否则 sub-agent 只修不测，留下回归风险。

## 使用方式

复制下方 TEMPLATE 块，替换 `[...]` 占位符后发给 sub-agent。每个占位符必须填入具体内容，不留空。

---

## TEMPLATE

### 任务：[一句话目标 — 例如 "修复 boot-sequence.ts 中 timer 泄漏"]

- 文件：[主要修改文件路径，如 `src/main/boot-sequence.ts`]
- 测试：[对应测试文件路径，如 `src/main/boot-sequence.test.ts` | "无 — 需新建"]

### 背景

[发生了什么 — 现象 / 报错 / 已定位的根因]
[为什么需要修复 — 影响范围 / 触发条件]
[已排除什么 — 确认无关的路径或假设]

### 目标

- [ ] [验收条件 1 — 可观察的行为]
- [ ] [验收条件 2 — 测试覆盖]
- [ ] [验收条件 3 — 无回归]

### 约束

- 仅修改指定文件和测试文件
- 不引入新依赖
- 不修改公共接口签名
- 每个行为变更必须对应至少 1 个测试
- 不重写或重构无关代码

### 实现指引（分步，≤ 5 步）

1. [步骤 1 — 例如：定位泄漏位置，确认 clearInterval 缺失]
2. [步骤 2 — 例如：添加清理逻辑]
3. [步骤 3 — 例如：新建测试文件，编写用例]
4. [步骤 4 — 例如：运行 tsc + 测试验证]
5. [步骤 5 — 例如：检查旧测试无回归]

### 验证清单

- [ ] `npx tsc --noEmit` 零新增错误
- [ ] 相关测试全部通过（至少 N 个新测试）
- [ ] 新测试名称描述了行为（清晰、无歧义）
- [ ] 旧测试不回归
- [ ] 修复 + 测试在同一 commit

### 输出

- 修改的文件列表
- 运行了什么命令（完整命令行）
- 测试了什么用例（test name）
- 实际输出（pass/fail 行数）

---

## 三阶段流程说明

### Phase 1 — 修复

定位根因，实施最小改动。不顺手重构、不加多余日志、不改无关文件。修复的目的是让测试通过且有意义，而不是让代码"更好看"。

### Phase 2 — 补测试

每个行为变更至少 1 个测试：happy path 1 个、边界 1 个、错误处理 1 个。测试名必须描述行为（如 `it('rejects with IpcTimeoutError when the handler does not finish in time')`），不能写 `test1` / `case-a`。

### Phase 3 — 独立验证

在 sub-agent 输出完之前，运行 `npx tsc --noEmit` + 相关测试命令，确认零新增错误、新测试通过、旧测试不回归。未通过则返回 Phase 1。

---

## 测试质量检查清单

| 维度 | 最少数量 | 示例 |
|------|----------|------|
| Happy path | 1 | 正常输入 → 预期输出 |
| 边界条件 | 1 | 空值 / 极值 / 超时 / 并发 |
| 错误处理 | 1 | 抛错 / reject / 非预期类型 |

测试命名规范：
- ✅ `it('returns the resolved value from the inner promise')`
- ✅ `it('rejects with IpcTimeoutError when the handler does not finish in time')`
- ❌ `it('test 1')`
- ❌ `it('case A')`

---

## 常见反模式警告

| # | 反模式 | 后果 | 防范 |
|---|--------|------|------|
| 1 | **只修不测** | 无回归保护，下次改动即爆 | 验证清单强制 N 个新测试 |
| 2 | **盲目重构** | 改动范围失控，引入新 Bug | 约束中明确"不重构无关代码" |
| 3 | **修改未授权文件** | 破坏其他模块 | 约束中限定文件范围 |
| 4 | **吞掉异常** | 线上故障无法追踪 | 错误处理要求显式 reject / throw |
| 5 | **硬编码配置** | 环境差异导致失败 | 读取配置文件或环境变量 |
| 6 | **跳过 tsc** | 类型错误延迟暴露 | 验证清单强制 `tsc --noEmit` |
| 7 | **测试名模糊** | 无法快速定位失败原因 | 测试名必须描述行为 |

---

## 已验证示例

### 示例 A：修复 timer 泄漏在 boot-sequence.ts

**场景**：`boot-sequence.ts` 中步间等待使用 `setTimeout`，但步骤失败时未调用 `clearTimeout`，导致内存泄漏和进度条卡死。

**Prompt 要点**：
- 文件：`src/main/boot-sequence.ts` + `src/main/boot-sequence.test.ts`
- 修复：在错误分支添加 `clearTimeout(handle)` 并在 `finally` 统一清理
- 测试：新增 "clears pending timer on step failure" + "resolves to DONE when all steps pass" 等 4 个用例
- 验证：tsc 零新增 + 测试 4/4 pass

### 示例 B：为 withTimeout 工具函数补单元测试

**场景**：`src/shared/withTimeout.ts` 覆盖了 resolve/reject/timeout/AbortSignal 等路径，但测试只覆盖 happy path。

**Prompt 要点**：
- 文件：`src/shared/withTimeout.ts` + `src/shared/withTimeout.test.ts`
- 修复：不改实现，纯补测试
- 测试：补齐
  - happy path（resolved value 类型保持）
  - 边界（`<= 0` 表示无限时）
  - 错误处理（IpcTimeoutError 携带 channel + ms）
- 验证：覆盖行数提升 + tsc 零新增
