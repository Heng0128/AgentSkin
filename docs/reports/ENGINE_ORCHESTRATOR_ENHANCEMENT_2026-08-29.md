# 引擎与编排层增强方案 — 基于 Codex 生态竞品学习

> 日期: 2026-08-29
> 来源: 40 个 Codex 主题仓库竞品分析 + 当前架构审计
> 状态: 设计方案 → 实施中

---

## 一、竞品关键洞察回顾

| 竞品 | 核心能力 | AgentSkin 现状 | 差距 |
|------|---------|---------------|------|
| DreamSkin | 图片→主题自动生成 | 有 color-quantize 但未集成 | 高优先级 |
| DreamSkin | verify + 截图对比 | 有 contract-validator (DOM 选择器级) | 缺少 CSS 变量值级验证 |
| DreamSkin | 系统托盘一键还原 | 有 restore 但无状态机可视化 | 中等 |
| codex-plusplus | tweak 模块化扩展 | 4 引擎固定，无插件机制 | 低（设计哲学不同） |
| codex-autoskill | Agent-native 换肤 | 独立产品非 Agent 集成 | 低 |
| workbuddy-skin-studio | 图片驱动主题 | 有 wallpaper 但无图片→token 映射 | 高优先级 |

---

## 二、架构增强设计

### 2.1 注入状态机 (Injection State Machine)

**问题**: 当前编排层只有 `execute()` / `executeRestore()` 两个原子操作，缺少对注入生命周期状态的可观测性。调试注入失败时无法快速定位卡在哪个阶段。

**方案**: 新增 `injection-state-machine.ts`，为每个 agent 维护一个显式状态：

```
IDLE → CAPTURING → INJECTING → VERIFYING → HEALTHY
                 ↘            ↗
                  ROLLING_BACK → RESTORED
                 
HEALTHY → DEGRADED → SELF_HEALING → HEALTHY
                        ↘
                         FAILED → ROLLING_BACK
```

**状态转换触发**:
- `CAPTURING`: snapshot manager 正在读取当前 CSS 变量
- `INJECTING`: engine.inject() 执行中
- `VERIFYING`: contract-validator 验证中
- `HEALTHY`: 所有验证通过
- `DEGRADED`: health monitor 检测到 CSS 变量漂移
- `SELF_HEALING`: 自动修复中
- `FAILED`: 修复失败，需人工干预
- `ROLLING_BACK`: 快照回滚中
- `RESTORED`: 已恢复到注入前状态

**API**:
```ts
const sm = injectionStateMachine;
sm.transition('doubao', 'INJECTING', { engine: 'engine-strategy', themeId: 'midnight-aurora' });
sm.getState('doubao'); // { state: 'INJECTING', since: timestamp, context: {...} }
sm.getHistory('doubao'); // [{ from: 'IDLE', to: 'INJECTING', at: ts }, ...]
```

### 2.2 真实 CSS 变量快照 (Real CSS Variable Capture)

**问题**: 当前 `InjectionSnapshotManager` 的 `captureFn` 返回空对象 `{}`，回滚机制形同虚设。

**方案**: 新增 `createCssVariableCaptureFn(session)` 工厂函数，通过 CDP 读取当前 `:root` 上的所有 `--agentskin-*` CSS 变量值：

```ts
function createCssVariableCaptureFn(session: CdpSession): CaptureStateFn {
  return async (agentId) => {
    const result = await session.evaluate(`
      (() => {
        const vars = {};
        const style = getComputedStyle(document.documentElement);
        for (let i = 0; i < style.length; i++) {
          const prop = style[i];
          if (prop.startsWith('--agentskin-')) {
            vars[prop] = style.getPropertyValue(prop).trim();
          }
        }
        return JSON.stringify(vars);
      })()
    `);
    const cssVariables = JSON.parse(result || '{}');
    return { cssVariables, appliedStylesheets: {} };
  };
}
```

### 2.3 图像分析引擎 (Image Analyzer Engine)

**问题**: DreamSkin 的核心卖点是"导入一张图 = 一个主题"。AgentSkin 有 `color-quantize.ts` 但缺少从图片到 14 token 的完整映射。

**方案**: 新增 `src/main/profile/image-theme-analyzer.ts`，作为主进程服务：

```ts
interface ImageThemeAnalysis {
  tokens: Record<string, string>;  // 14 token → hex color
  palette: { dominant: string; accent: string; muted: string; background: string };
  appearance: 'light' | 'dark';
  confidence: number;  // 0-1, 配色可信度
}

async function analyzeImageForTheme(imagePath: string): Promise<ImageThemeAnalysis>
```

**14 token 映射算法**:
1. 使用 median-cut 量化提取 8-16 色
2. 按亮度排序 → 最暗色映射到 `--agentskin-bg`，最亮色映射到 `--agentskin-fg`
3. 饱和度最高的色 → `--agentskin-accent`
4. 中间色调 → `--agentskin-muted`, `--agentskin-border`
5. WCAG 对比度校验 → 不满足 AA 则调整
6. 生成 `.agentskin-theme` 包

### 2.4 批处理事务应用 (Batch Transactional Apply)

**问题**: 当前只能逐个 agent 应用主题，无法"一键应用到全部"。

**方案**: 在编排层新增 `executeBatch()`:

```ts
async function executeBatch(
  agentIds: AgentId[],
  params: OrchestratorExecuteParams,
  options?: { atomic?: boolean; continueOnError?: boolean }
): Promise<BatchResult>
```

- `atomic: true` — 全部成功或全部回滚
- `continueOnError: true` — 部分失败继续，返回每个 agent 的结果

### 2.5 健康监控 + 自动修复 (Health Monitor + Auto-Heal)

**问题**: 当前只有注入后的即时验证，缺少持续监控。

**方案**: 新增 `src/main/cdp/injection/health-monitor.ts`:

```ts
class InjectionHealthMonitor {
  // 每 5s 检查一次 CSS 变量是否仍匹配期望值
  startMonitoring(agentId: AgentId, expectedTokens: Record<string, string>): void
  stopMonitoring(agentId: AgentId): void
  // 检测到漂移 → 触发 self-heal (重新注入)
  // 连续 3 次修复失败 → 标记 FAILED 状态
}
```

---

## 三、文件变更清单

### 新增文件

| 文件 | 用途 |
|------|------|
| `src/shared/injection/orchestrator/injection-state-machine.ts` | 注入状态机 |
| `src/shared/injection/orchestrator/injection-state-machine.test.ts` | 状态机测试 |
| `src/shared/injection/css-variable-capture.ts` | 真实 CSS 变量捕获 |
| `src/shared/injection/css-variable-capture.test.ts` | 捕获函数测试 |
| `src/main/cdp/injection/health-monitor.ts` | 健康监控 + 自动修复 |
| `src/main/cdp/injection/health-monitor.test.ts` | 健康监控测试 |
| `src/main/profile/image-theme-analyzer.ts` | 图像→主题分析引擎 |
| `src/main/profile/image-theme-analyzer.test.ts` | 图像分析测试 |

### 修改文件

| 文件 | 变更 |
|------|------|
| `src/shared/injection/orchestrator/injection-orchestrator.ts` | 集成状态机 + 批处理 API |
| `src/shared/injection/orchestrator/types.ts` | 新增 BatchResult 类型 |
| `src/shared/injection/orchestrator/index.ts` | 导出新模块 |
| `src/shared/injection/injection-snapshot.ts` | 增强 capture 接口 |
| `docs/reports/INDEX.md` | 登记新报告 |

---

## 四、不变量与约束

| # | 约束 | 说明 |
|---|------|------|
| 1 | 不新增 UI 页面 | 全部为引擎/编排层内部增强 |
| 2 | 不新增适配器 | 图像分析引擎是主进程服务，非适配器 |
| 3 | 不修改 engine-strategy.ts 核心注入逻辑 | 只增强编排层 |
| 4 | 保持向后兼容 | 现有 execute/restore API 不变 |
| 5 | 零运行时依赖 | 图像分析使用 Node.js 内置模块 |
| 6 | 测试覆盖 | 所有新模块 ≥ 90% 覆盖率 |

---

## 五、实施优先级

1. **P0**: 真实 CSS 变量快照 — 修复现有回滚机制
2. **P0**: 注入状态机 — 提供可观测性
3. **P1**: 健康监控 + 自动修复 — 对标 DreamSkin verify
4. **P1**: 图像分析引擎 — 对标 DreamSkin 核心功能
5. **P2**: 批处理事务应用 — 提升多 agent 场景体验
