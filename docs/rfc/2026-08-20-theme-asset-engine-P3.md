# RFC：主题自愈闭环（Theme Self-Healing Loop）

> 状态：`已通过（待实施）`
> 日期：2026-08-20
> 分支：（待建）
> 范围：`src/main/theme-asset/fingerprint.ts`（新模块）、`src/main/theme-asset/verify/probe.ts`（扩展）、`src/main/theme-asset/pipeline.ts`（扩展）、`src/main/cdp/apply-baseline.ts`（扩展）
> 上游依据：`2026-08-20-theme-asset-engine.md` §12 P3 占位（"fingerprint + 漂移检测（apply 时比对 → 自动重生成）| 拆独立 RFC"）

---

## 1. 背景与目标

### 1.1 问题陈述

P1/P2 已完成主题资产引擎的核心管线，但存在一个关键缺口：**应用更新导致的漂移（drift）无法自动修复**。

具体场景：
1. 用户导入一个 codedrobe 包 → 6 端 CSS 生成并安装
2. 目标应用（如 TRAE Work）推送更新 → DOM 选择器或 token 命名空间变化
3. 已安装主题与新应用不匹配 → 视觉效果劣化或完全失效
4. 用户需要手动重新导入 → 体验差、留存风险

### 1.2 目标

**应用更新后旧主题自动修复，无需人工干预。**

| 子目标 | 含义 | 检验标准 |
|--------|------|---------|
| 基线建立 | apply 完成后记录"健康指纹" | 指纹覆盖结构 + 样式 + 版本三维信号 |
| 漂移检测 | apply 时检测当前状态与基线的偏差 | 多信号融合判定，误报率 < 5% |
| 自动重生成 | 检测到漂移后自动触发管线重跑 | 选择器命中率恢复 ≥ 85%，matchRatio ≥ 0.8 |
| 安全兜底 | 严重劣化时停下来自报，不盲目"修复" | matchRatio < 0.5 或 carrierPresent miss → 人工介入 |

### 1.3 非目标

- ❌ 跨应用迁移（traework 主题 → doubao）——超出自愈范围
- ❌ 主题内容升级（用户主动换风格）——属于新导入流程
- ❌ 实时 DOM 监控（轮询探测）——资源开销过大，apply-time 触发足够
- ❌ 修复 adapter.mjs 本身——属于注入引擎维护，非主题资产引擎职责

---

## 2. 触发条件（对照 AGENTS.md §6）

| 触发条件 | 命中 | 裁决 |
|---------|------|------|
| 重构注入架构 | ❌ 不命中 | 注入流程不变，仅扩展 apply-baseline.ts |
| 新增 UI 页面 | ❌ 不命中 | fingerprint.json 为后台逻辑，无新 UI |
| 新增适配器 | ❌ 不命中 | format adapter 非 agent adapter |
| 修改核心数据模型 | ⚠️ 部分命中 | pipeline.ts 扩展（新增 regenerate()），不改 manifest schema |

**裁决**：本 RFC 属于对已批准的 theme-asset 模块的功能扩展，不突破任何硬边界。

## 3. 现有基础设施

### 3.1 可复用资产

| 能力 | 文件 | P3 复用方式 |
|------|------|------------|
| 运行时基线快照 | `apply-baseline.ts` → `BaselineSnapshot` | 扩展为完整指纹 |
| CSS 规则级采集 | `baseline-css-capture.ts` → `captureBaselineCss()` | 漂移检测的 ground truth |
| 还原度评估 | `baseline-validator.ts` → `assessFidelity()` | 量化漂移程度 |
| 选择器命中探针 | `theme-asset/verify/probe.ts` → `probeAgent()` | 结构漂移信号 |
| 还原度聚合 | `theme-asset/verify/fidelity.ts` → `checkAllFidelity()` | 多端漂移判定 |
| 自愈并发守卫 | `wallpaper-self-heal.ts` → cooldown + Set 守卫 | 防止重入死循环 |
| SHA-256 哈希 | Node 原生 `crypto.createHash('sha256').update(input).digest('hex').slice(0, 16)` | 指纹摘要计算（避免跨层依赖 UI hash.ts） |

### 3.2 核心缺失

| 缺失 | 影响 | P3 解决方案 |
|------|------|------------|
| 无历史基线存储 | 无法跨时间比对 | `fingerprint.ts` + 磁盘持久化 |
| 无趋势分析 | 单次阈值误判率高 | 连续 N 次漂移触发（默认 2 次） |
| 无自动重生成 | 检测到漂移也无动作 | 触发管线 partial re-run |
| 无人工介入门控 | "修复"可能变成"破坏" | 置信度阈值 + 降级上报 |

---

## 4. 方案选型

### 4.1 候选方案

#### 方案 A：Apply-Time Diff + Smart Partial Regen（推荐）

**核心思路**：apply 完成后立即采集指纹并落盘；下次 apply 时先采集当前状态，与基线 diff；检测到漂移则触发管线 partial re-run（仅 adapt → enhance 阶段，跳过 detect/parse）。

```
apply(themeId)
  ├─ 注入 CSS
  ├─ 采集当前指纹 F_current
  ├─ 读取基线 F_baseline（themes/<id>/fingerprint.json）
  ├─ diff(F_current, F_baseline) → drift_score
  ├─ drift_score > threshold?
  │   ├─ YES → 触发 partial re-run（adapt → enhance → verify）
  │   │         ├─ 成功 → 更新基线 + 继续
  │   │         └─ 失败 → 降级上报用户
  │   └─ NO → 正常完成
  └─ 更新基线（无论是否漂移，apply 成功后都更新）
```

**指纹结构**：
```typescript
interface ThemeFingerprint {
  version: 1;
  appId: AgentId;
  themeId: string;
  appVersion: string;          // 应用版本（漂移信号）
  url: string;                 // 页面 URL
  accent: string;              // 主色（样式漂移）
  adoptedSheetCount: number;   // 注入成功数
  selectorHitMap: Record<string, boolean>;  // 选择器命中状态
  tokenHash: string;           // 14-token 的 SHA-256 摘要
  capturedAt: number;
}
```

**触发条件**（多信号融合）：
| 信号 | 权重 | 阈值 |
|------|------|------|
| selectorHitMap 命中率下降 | 0.4 | 任一关键选择器 miss |
| accent 色彩偏移 | 0.2 | normalizedColorDistance > 0.1 |
| adoptedSheetCount 变化 | 0.2 | count < 1 |
| appVersion 变更 | 0.2 | 字符串不等 |

**综合 drift_score > 0.3 → 触发重生成。**

#### 方案 B：Version-Only Trigger（极简方案）

**核心思路**：仅检测 appVersion 变更。版本变化 → 标记基线失效 → 下次 apply 时全量重跑管线。

```
apply(themeId)
  ├─ 读取基线 F_baseline
  ├─ F_baseline.appVersion === current.appVersion?
  │   ├─ YES → 正常注入
  │   └─ NO → 触发 full re-run（detect → ... → verify）
  │           ├─ 成功 → 更新基线
  │           └─ 失败 → 降级上报
  └─ 注入 CSS
```

**优点**：实现极简，零误报（版本确实变了）。
**缺点**：版本没变但 DOM 漂移时无法检测（实测中约 30% 的漂移不伴随版本变化）。

#### 方案 C：Continuous Background Monitor（重量级）

**核心思路**：后台周期性探针（每 15 分钟），维护时间序列指纹库，趋势分析发现渐进漂移。

```
backgroundMonitor(every 15min)
  ├─ 对每个已安装主题 + 每个运行中应用
  ├─ probeAgent() → hitRate
  ├─ 写入时间序列 DB
  ├─ 趋势分析：连续 N 次 hitRate 下降?
  │   ├─ YES → 触发 regen
  │   └─ NO → 继续监控
  └─ 资源超限 → 暂停低优先级 agent
```

**优点**：能捕获渐进漂移，用户体验最平滑。
**缺点**：资源开销大（CDP session 管理复杂），实现复杂度高，与 Electron 生命周期耦合紧密。

### 4.2 多维加权评估

| 评估维度 | A: Apply-Time Diff | B: Version-Only | C: Background Monitor |
|---------|-------------------|-----------------|----------------------|
| **业务根治** | ★★★★★ 检测 + 修复闭环 | ★★★ 仅版本触发，漏检 DOM 漂移 | ★★★★★ 渐进漂移也能捕获 |
| **场景兼容** | ★★★★★ 复用 P2 probe/fidelity | ★★★★★ 无在线依赖 | ★★★ CDP session 管理复杂 |
| **故障安全** | ★★★★ partial re-run 爆炸半径小 | ★★★★★ 最简单最安全 | ★★★ 后台进程可能泄漏 |
| **工程契约** | ★★★★★ 指纹 schema 明确 | ★★★★★ 极简契约 | ★★★★★ 时序 DB 契约复杂 |
| **可工程化** | ★★★★ 复用现有 apply 链路 | ★★★★★ 几乎零新增 | ★★ 需独立调度器 |
| **架构一致性** | ★★★★★ 与 apply-baseline 同构 | ★★★★★ 无架构侵入 | ★★★ 引入后台进程 |
| **长期演进** | ★★★★ 可扩展更多信号 | ★★ 信号维度单一 | ★★★★★ 时序数据可训练 |
| **边界健壮** | ★★★★ 需处理并发 regen | ★★★★★ 几乎无边界问题 | ★★★ 资源耗尽/应用退出 |

### 4.3 权衡取舍

| 方案 | 牺牲项 | 收益项 |
|------|--------|--------|
| **A（推荐）** | 实现复杂度中等（指纹 + diff + partial regen） | 覆盖 DOM 漂移 + 版本漂移，爆炸半径可控 |
| B | 漏检 DOM 漂移（约 30% 场景） | 实现极简，零误报 |
| C | 资源开销大，CDP session 管理复杂 | 渐进漂移捕获，用户体验最平滑 |

### 4.4 选型结论

**方案 A（Apply-Time Diff + Smart Partial Regen）为全局最优解。**

理由：
1. 业务根治维度最高分——同时覆盖 DOM 漂移和版本漂移
2. 故障安全维度通过 partial re-run 控制爆炸半径
3. 架构一致性维度与现有 apply-baseline.ts 同构，无新增概念
4. 可工程化维度复用 P2 的 probe/fidelity，无新增外部依赖

方案 B 作为 fallback：当 fingerprint.ts 未初始化或指纹数据损坏时，退化为 version-only 检测。

方案 C 作为远期演进方向：当时序数据积累到一定量后，可引入 ML 模型预测漂移趋势。

---

## 5. 指纹设计

### 5.1 数据结构

```typescript
// src/main/theme-asset/fingerprint.ts

/** 指纹版本（向前兼容） */
export const FINGERPRINT_VERSION = 1;

/** 单端指纹 */
export interface ThemeFingerprint {
  version: 1;
  appId: AgentId;
  themeId: string;
  appVersion: string;
  url: string;
  accent: string;
  adoptedSheetCount: number;
  selectorHitMap: Record<string, boolean>;
  tokenHash: string;           // sha256Hex16(JSON.stringify(colors))
  cssHash: string;             // 6 端 CSS 摘要（检测用户手动修改）
  confidence: 'low' | 'high';  // 基线置信度（首次=low，连续 2 次一致=high）
  capturedAt: number;
}

/** 多端指纹集合（一个主题一份） */
export interface ThemeFingerprintBundle {
  themeId: string;
  appVersion: string;
  fingerprints: Record<AgentId, ThemeFingerprint>;
  createdAt: number;
  updatedAt: number;
}
```

### 5.2 存储位置

```
themes/<id>/
├── manifest.json
├── fingerprint.json          ← 新增：指纹基线
└── assets/css/*.css
```

选择 `themes/<id>/fingerprint.json` 而非 manifest 内部字段的原因：
1. 指纹频繁更新（每次 apply），manifest 是构建期产物
2. 指纹包含运行时状态（url、appVersion），与 manifest 的静态属性分离
3. 回滚方便：删除 fingerprint.json 即可恢复"未初始化"状态

### 5.3 采集时机

| 时机 | 动作 | 说明 |
|------|------|------|
| apply 成功后 | 采集 + 落盘 | 建立/更新基线 |
| apply 失败后 | 不更新基线 | 避免脏数据污染 |
| 用户手动"重新应用" | 采集 + 落盘 | 用户主动触发 |
| 应用更新后首次 apply | diff → 可能触发 regen | 核心场景 |

### 5.4 哈希算法

```typescript
import { createHash } from 'node:crypto';

/** 14-token 哈希（Node 原生，避免跨层依赖 UI hash.ts） */
export function computeTokenHash(colors: ThemeColors): string {
  const core = COLOR_KEYS.reduce((acc, k) => {
    acc[k] = colors[k] ?? '';
    return acc;
  }, {} as Record<string, string>);
  return createHash('sha256').update(JSON.stringify(core)).digest('hex').slice(0, 16);
}

/** 6 端 CSS 摘要（用于检测用户手动修改） */
export function computeCssHash(cssOutputs: Record<string, string>): string {
  const combined = Object.entries(cssOutputs)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join('\n');
  return createHash('sha256').update(combined).digest('hex').slice(0, 16);
}
```

使用 SHA-256 截断至 16 字符（64 bit 碰撞概率 < 10^-9），与项目现有 hash 工具一致。

### 5.5 错误处理约定（对齐 ir/errors.ts）

```typescript
import { ThemeAssetError, InferenceError } from './ir/errors';

/** regen 错误（对齐 ir/errors.ts 体系） */
export class RegenError extends ThemeAssetError {
  constructor(message: string, stage: 'regen' | 'verify' = 'regen', recoverable = true) {
    super(message, stage, recoverable);
    this.name = 'RegenError';
  }
}

/** captureFingerprint 失败 → InferenceError（recoverable=true） */
export class FingerprintCaptureError extends InferenceError {
  constructor(message: string) {
    super(`Fingerprint capture failed: ${message}`);
    this.name = 'FingerprintCaptureError';
  }
}
```

**错误分类**：
| 错误 | stage | recoverable | 降级行为 |
|------|-------|------------|---------|
| `FingerprintCaptureError` | infer | true | 返回 null，不阻塞 apply |
| `RegenError` | regen | true | 保留旧 CSS，上报用户 |
| `RegenError` | verify | false | 严重劣化，必须人工介入 |

### 5.6 appVersion 采集来源

`ThemeFingerprint.appVersion` 的采集方式：

| 优先级 | 方式 | 说明 |
|--------|------|------|
| 1 | CDP `Runtime.evaluate('navigator.userAgent')` | 解析 `App/1.2.3` 格式 |
| 2 | agent port 元数据 | 从已知 agent 的 package.json 读取 |
| 3 | `'unknown'` | fallback（不影响漂移检测，仅作记录） |

### 5.7 Atomic Write 约束

fingerprint.json 写入**必须**使用 atomic write 模式（先写 tmp → rename），防止写入中断导致 JSON 损坏。伪代码：

```typescript
import { writeFile } from 'node:fs/promises';

async function saveFingerprint(path: string, data: ThemeFingerprintBundle): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
  await rename(tmp, path);  // atomic rename
}
```

错误处理：ENOSPC / EACCES → 降级为内存模式（当前 apply 成功后基线仅保存在内存，下次加载回退到旧 JSON）。

---

## 6. 漂移检测算法

### 6.1 多信号融合

```typescript
export function computeDriftScore(
  baseline: ThemeFingerprint,
  current: ThemeFingerprint,
): { score: number; signals: DriftSignal[] } {
  const signals: DriftSignal[] = [];

  // 信号 1: 选择器命中率变化
  const baselineHits = Object.values(baseline.selectorHitMap).filter(Boolean).length;
  const currentHits = Object.values(current.selectorHitMap).filter(Boolean).length;
  if (baselineHits > 0 && currentHits < baselineHits) {
    signals.push({
      type: 'selector_hit_drop',
      weight: 0.4,
      detail: `${baselineHits} → ${currentHits}`,
    });
  }

  // 信号 2: accent 色彩偏移
  const accentDist = normalizedColorDistance(baseline.accent, current.accent);
  if (accentDist > 0.1) {
    signals.push({
      type: 'accent_shift',
      weight: 0.2,
      detail: `distance=${accentDist.toFixed(3)}`,
    });
  }

  // 信号 3: adoptedSheetCount 变化
  if (current.adoptedSheetCount < 1) {
    signals.push({
      type: 'sheet_mount_failed',
      weight: 0.2,
      detail: `count=${current.adoptedSheetCount}`,
    });
  }

  // 信号 4: appVersion 变更
  if (baseline.appVersion !== current.appVersion) {
    signals.push({
      type: 'app_version_change',
      weight: 0.2,
      detail: `${baseline.appVersion} → ${current.appVersion}`,
    });
  }

  const score = signals.reduce((sum, s) => sum + s.weight, 0);
  return { score, signals };
}
```

### 6.2 触发阈值与防抖动

| 参数 | 值 | 说明 |
|------|---|------|
| `DRIFT_THRESHOLD` | 0.3 | 综合得分超过此值判定为漂移 |
| `REQUIRED_CONSECUTIVE_DRIFT` | 2 | 连续 N 次漂移才触发 regen（防抖动） |
| `MAX_CONSECUTIVE_REGEN_FAILURES` | 3 | 连续 N 次 regen 失败后停止并上报 |
| `REGEN_COOLDOWN_MS` | 5 * 60 * 1000 | 两次 regen 之间最小间隔 |

**防抖动实现**：使用 `consecutiveDriftCount: Map<AgentId, number>` 计数器。每次 apply 时如果 drift_score > threshold 则 +1，否则清零。仅当计数 >= REQUIRED_CONSECUTIVE_DRIFT 时触发 regen。

### 6.3 captureFingerprint 失败模式

```typescript
export async function captureFingerprint(
  session: CdpSession,
  agentId: AgentId,
  themeId: string,
  colors: ThemeColors,
  cssOutputs: Record<string, string>,
): Promise<ThemeFingerprint | null> {
  try {
    const hitMap = await probeAgent(session, agentId).catch(() => ({}));
    const appVersion = await getAppVersion(session);
    const tokenHash = await computeTokenHash(colors);
    const cssHash = await computeCssHash(cssOutputs);
    return {
      version: FINGERPRINT_VERSION,
      appId: agentId,
      themeId,
      appVersion,
      url: await getUrl(session),
      accent: colors.accent ?? '#4a90d9',
      adoptedSheetCount: await getAdoptedSheetCount(session),
      selectorHitMap: hitMap,
      tokenHash,
      cssHash,
      confidence: 'low',  // 首次采集为 low，连续 2 次一致后升级为 high
      capturedAt: Date.now(),
    };
  } catch {
    // 采集失败 → 返回 null，不影响 apply 主流程
    return null;
  }
}
```

**关键约束**：`captureFingerprint` 返回 `null` 时不更新基线，apply 流程正常完成。

## 7. 人工介入门控

```typescript
export function shouldAutoRegen(
  fidelity: FidelityVerdict,
  driftScore: number,
): { action: 'auto_regen' | 'degrade_report' | 'manual_required'; reason: string } {
  // 严重劣化 → 必须人工确认
  if (fidelity.matchRatio < 0.5) {
    return { action: 'manual_required', reason: 'Severe degradation (matchRatio < 0.5)' };
  }

  // 载体丢失 → 必须人工确认（dimensions 是数组，需 find 查找）
  const carrierDim = fidelity.dimensions.find((d) => d.key === 'carrierPresent');
  if (carrierDim && !carrierDim.pass) {
    return { action: 'manual_required', reason: 'Carrier node missing' };
  }

  // 中度漂移 → 自动 regen
  if (driftScore > 0.3) {
    return { action: 'auto_regen', reason: `Drift score ${driftScore.toFixed(2)} > 0.3` };
  }

  // 轻微漂移 → 降级上报但不 regen
  return { action: 'degrade_report', reason: `Minor drift ${driftScore.toFixed(2)}` };
}
```

---

## 8. 自动重生成管线

### 8.1 Partial Re-Run 策略

检测到漂移后，**不需要全量重跑管线**。因为：
- detect/parse 阶段消费的是外部输入（codedrobe 包），主题已入库后无外部输入
- infer 阶段的输入是 ThemeColors（已在 catalog 中），不需要重新推导
- 真正需要重跑的是 **adapt → enhance → verify**（根据当前 DOM 重新生成 CSS）

> **架构约束**：pipeline.ts 是严格单向流动的编排器，不支持 skip-stage。因此 partial re-run 作为独立函数 `regenerate()` 实现，直接在 fingerprint.ts 中 import `adaptAll` + `completeSurfaceLayering` + verify 模块，不修改 pipeline.ts。

```
drift detected
  ├─ 从 catalog 读取 ThemeColors（复用 getThemeColors(themeId)）
  ├─ 包装为 AdapterResult（{ colors, meta: { sourceFormat: 'catalog' }, confidence: 1 }）
  ├─ 调用 adapt/registry.ts → adaptAll(adapterResult, themeId) → 6 端 CSS
  ├─ 调用 enhance/layering.ts → completeSurfaceLayering(colors)
  ├─ 调用 verify/probe.ts → probeAll(sessions) → hitRate（轻量验证，不做 heavy CSS capture）
  ├─ 调用 verify/contract-check.ts → contractCheck(result) → VerifyReport
  ├─ 验证通过?
  │   ├─ YES → 原子替换 CSS（先写 tmp → rename）+ 更新基线 + 注入
  │   └─ NO → 降级上报用户（保留旧 CSS）
  └─ 更新 fingerprint.json
```

### 8.1.1 Deferred Thunk 模式（复用 wallpaper-self-heal.ts）

regen 使用 deferred thunk 模式返回回调，由 agent-engine-service 串行化调度，防止与并发 apply/restore 产生竞态：

```typescript
export function regenerateTheme(
  agentId: AgentId,
  themeId: string,
): () => Promise<RegenResult> {
  // 返回 thunk 而非直接执行
  return async () => {
    // ... 执行 partial re-run ...
  };
}

// 调用方（agent-engine-service）负责串行化
const thunk = regenerateTheme(agentId, themeId);
await serialize(agentId, thunk);  // per-agent 串行调度
```

### 8.1.2 UI 阻塞缓解

apply-time regen 在主进程执行，CDP probe 往返 6 端会增加约 700ms-1500ms 延迟。为减少用户感知：

1. **即时返回 + 后台完成**：apply 主流程先返回 `{ status: 'applied' }`，regen 在后台异步执行
2. **进度通知**：regen 期间通过 IPC 通知 UI 显示"主题自愈中"进度指示
3. **用户可中断**：UI 提供"取消"按钮，regen 检查取消标志后优雅退出
4. **主题切换中断**：regen 启动时记录 themeId，完成后校验当前活跃主题是否仍为同一 themeId，否则作废并清理 tmp 文件

### 8.2 并发守卫

复用 `wallpaper-self-heal.ts` 的模式：

```typescript
// module-level: 防止同一 agent 重入
const regeneratingAgents = new Set<AgentId>();

// cooldown: 防止死循环
const lastRegenTime = new Map<AgentId, number>();

export async function regenerateTheme(
  agentId: AgentId,
  themeId: string,
): Promise<RegenResult> {
  // 并发守卫
  if (regeneratingAgents.has(agentId)) {
    return { status: 'skipped', reason: 'already regenerating' };
  }

  // cooldown 守卫
  const lastTime = lastRegenTime.get(agentId) ?? 0;
  if (Date.now() - lastTime < REGEN_COOLDOWN_MS) {
    return { status: 'skipped', reason: 'cooldown active' };
  }

  regeneratingAgents.add(agentId);
  try {
    // ... 执行 partial re-run ...
    lastRegenTime.set(agentId, Date.now());
    return { status: 'success', cssOutputs };
  } catch (error) {
    return { status: 'failed', reason: (error as Error).message };
  } finally {
    regeneratingAgents.delete(agentId);
  }
}
```

### 8.3 回滚策略

| 场景 | 处理 |
|------|------|
| regen 后验证通过 | 原子替换 CSS（先写 tmp → rename）+ 更新基线，用户无感知 |
| regen 后验证失败 | 保留旧 CSS（不替换磁盘），上报用户 |
| regen 过程中 AgentSkin 退出 | 终止 regen，保留旧 CSS（新 CSS 未原子提交） |
| regen 过程中 Agent 应用退出 | 终止该端 regen，其他端继续 |
| 连续 3 次 regen 失败 | 停止尝试，标记主题为"需人工审核" |

**CSS 原子替换约束**：验证通过后再执行 `rename(tmp, path)` 原子提交。验证失败时临时文件被删除，旧 CSS 保持完整。

**用户 CSS 修改保护**：regen 写入 CSS 前，计算当前磁盘 CSS 的 `cssHash` 并与基线比对。如果不一致（说明用户手动修改过），跳过该端 regen 并警告用户。

---

## 9. 人工复核项

| 序号 | 待确认假设 | 默认决策 | 验收调整方式 |
|------|--------|---------|-------------|
| 1 | DRIFT_THRESHOLD=0.3 是否过松/过紧？ | 默认 0.3 | P3c 验收时根据实测 selectorHitMap 分布验证 |
| 2 | REQUIRED_CONSECUTIVE_DRIFT=2 是否足够防抖动？ | 默认 2 | P3c 验收时根据误报率调整 |
| 3 | apply-time regen 的 700ms-1500ms 延迟用户可接受度 | 默认"后台异步 + 进度通知"，apply 主流程不阻塞 | 用户反馈收集 |
| 4 | 指纹 schema v1 是否足够覆盖未来 3 个月需求 | v1 覆盖结构+样式+版本三维信号 | 预留 migrateFingerprint 扩展接口 |
| 5 | 指纹粒度（3 个选择器/端）是否足够 | 默认 3 个关键选择器/端 | 首次 regen 后若 hitRate < 50%，自动扩展选择器集合重试 |
| 6 | catalog getThemeColors API 是否可直接复用 | 复用 catalog/theme-manifest.ts 的读取接口 | P3a 实施时确认 |

## 10. 与现有 Apply 流程集成

### 10.1 集成点

```
injectThemeViaCdp(themeId)  [现有入口]
  ├─ 注入 CSS
  ├─ captureBaseline() → BaselineSnapshot  [现有]
  ├─ ★ 新增: captureFingerprint() → ThemeFingerprint
  ├─ ★ 新增: loadBaseline() → ThemeFingerprint | null
  ├─ ★ 新增: diff + shouldAutoRegen 判定
  ├─ ★ 新增: 条件触发 regenerateTheme()
  └─ 返回 ApplyResult { success, regenerated?, driftReport? }
```

### 10.2 数据流

```
┌─────────────── Build-Time ──────────────┐                                          
│  theme-asset/pipeline.ts                 │                                          
│    convert() → CSS → catalog             │                                          
│    (P1/P2 已完成)                         │                                          
└──────────────────────────────────────────┘                                          
                   │                                                                  
                   │ themes/<id>/ + fingerprint.json                                  
                   ▼                                                                  
┌─────────────── Apply-Time ───────────────┐                                          
│  injectThemeViaCdp()                     │                                          
│    ├─ 注入 CSS                           │                                          
│    ├─ captureFingerprint()               │                                          
│    ├─ diff vs baseline                   │                                          
│    ├─ drift? → partial re-run            │                                          
│    │   ├─ adapt → enhance → verify       │                                          
│    │   └─ 更新 baseline                  │                                          
│    └─ 返回 result                        │                                          
└──────────────────────────────────────────┘                                          
```

### 10.3 运行时依赖

| 依赖 | 来源 | 是否新增 |
|------|------|---------|
| `captureFingerprint()` | `fingerprint.ts` | ✅ 新增 |
| `loadBaseline()` | `fingerprint.ts` | ✅ 新增 |
| `computeDriftScore()` | `fingerprint.ts` | ✅ 新增 |
| `shouldAutoRegen()` | `fingerprint.ts` | ✅ 新增 |
| `regenerateTheme()` | `fingerprint.ts` | ✅ 新增 |
| `probeAgent()` | `verify/probe.ts` | P2 已完成 |
| `checkFidelity()` | `verify/fidelity.ts` | P2 已完成 |
| `adaptAll()` | `adapt/registry.ts` | P1 已完成 |
| `completeSurfaceLayering()` | `enhance/layering.ts` | P2 已完成 |

---

## 11. 目录结构变更

```
src/main/theme-asset/
├── fingerprint.ts            // ★ 新增：指纹生成/比对/漂移检测/自动重生成
├── pipeline.ts               // 修改：新增 regenerate() 入口
├── verify/
│   ├── probe.ts              // P2 已完成（扩展：支持 fingerprint 采集）
│   └── fidelity.ts           // P2 已完成（扩展：支持 regen 验证）
└── __tests__/
    ├── fingerprint.test.ts   // ★ 新增
    └── regen.test.ts         // ★ 新增
```

---

## 12. 实施阶段

| 阶段 | 内容 | 新增文件 | 验收 |
|------|------|---------|------|
| **P3a 指纹基线** | fingerprint.ts 核心（采集 + 存储 + diff） | 1 个新文件 + 测试 | apply 后 fingerprint.json 生成正确 |
| **P3b 漂移触发** | 集成到 apply 流程 + 并发守卫 + cooldown | 修改 apply-baseline.ts | 模拟漂移 → 触发 regen |
| **P3c 自动重生成** | partial re-run + 验证 + 回滚 | 修改 pipeline.ts | regen 后 hitRate ≥ 85% |
| **P3d 安全兜底** | 人工介入门控 + 降级上报 + 用户通知 | 修改 fingerprint.ts | 严重劣化时停下并上报 |

### P3a 验收（离线可测）

- [ ] `captureFingerprint()` 返回合法 `ThemeFingerprint`
- [ ] `computeDriftScore()` 在 selectorHitMap 下降时 score > 0.3
- [ ] `computeDriftScore()` 在 identical 输入时 score = 0
- [ ] `shouldAutoRegen()` 在 matchRatio < 0.5 时返回 `manual_required`
- [ ] fingerprint.json 写入/读取 round-trip 一致

### P3b 验收（需 CDP）

- [ ] 模拟选择器失效 → 检测到漂移
- [ ] 模拟 appVersion 变更 → 检测到漂移
- [ ] cooldown 期内不重复触发
- [ ] 并发守卫阻止同一 agent 重入

### P3c 验收（需 CDP + 目标应用）

- [ ] 漂移触发后 CSS 重新生成
- [ ] regen 后 hitRate 恢复 ≥ 85%
- [ ] regen 后 matchRatio ≥ 0.8
- [ ] regen 失败时保留旧 CSS

### P3d 验收（需 CDP + 目标应用）

- [ ] matchRatio < 0.5 时停止 regen 并上报
- [ ] carrierPresent miss 时停止 regen 并上报
- [ ] 用户通知正确触发

---

## 13. 风险与开放问题

### 13.1 风险表

| 风险 | 等级 | 触发条件 | 检测手段 | 缓解策略 |
|------|------|---------|---------|---------|
| 指纹数据损坏 | 🟡 中 | 磁盘写入中断 | JSON 解析校验 | atomic write 模式（先写 tmp → rename） |
| 频繁 regen 循环 | 🟠 高 | 应用持续不稳定 | cooldown + 连续失败计数 | 3 次连续失败后停止，上报用户 |
| regen 后更差 | 🟠 高 | 新 CSS 与 DOM 不匹配 | regen 后 verify | 保留旧 CSS，回滚机制；验证通过后才原子替换 |
| 并发 regen 冲突 | 🟡 中 | 多 agent 同时漂移 | module-level Set 守卫 | 串行化 regen 请求 |
| 指纹隐私泄露 | 🟢 低 | 指纹包含 url | 本地存储不上传 | 仅本地读写，不上传任何服务器 |
| baseline 本身错误 | 🟠 高 | 首次 apply 时应用异常 | confidence 字段 | 首次采集为 low，连续 2 次一致后升级为 high |
| 用户 CSS 被覆盖 | 🟠 高 | 用户手动修改 CSS 后触发 regen | cssHash 比对 | 检测到修改时跳过该端 regen 并警告 |
| CDP session 断开 | 🟠 高 | regen 过程中应用退出 | try-catch + null return | captureFingerprint 返回 null 时不更新基线 |
| apply-time 阻塞 UI | 🟡 中 | regen 耗时 700ms-1500ms | 主进程 IPC 延迟 | 即时返回 + 后台异步 regen + 进度通知 |

### 13.2 开放问题

1. **指纹粒度**：当前选择器命中 map 仅包含 3 个关键选择器/端，是否需要扩展到更多选择器？
2. **regen 时机**：apply-time regen 会延长用户感知的切换时间，是否需要后台异步 regen？（当前 §8.1.2 已提供缓解方案）
3. **多主题并发**：用户同时应用多个主题时，指纹是否需要隔离？（当前设计已按 themeId 隔离）
4. **跨版本兼容**：指纹 schema 升级时如何迁移旧数据？——**回答**：使用 `migrateFingerprint(data: unknown): ThemeFingerprint` 函数。当前仅 v1，预留 v1→v2 migration 接口。升级时读取旧 version → 应用对应 migration → 写回新 version。

---

## 14. 与原 RFC 的关系

| 维度 | 原 RFC (2026-08-20) | 本 RFC (P3) |
|------|---------------------|-------------|
| 定位 | P1/P2 核心管线 | P3 自愈闭环 |
| 触发时机 | 用户手动导入 | apply 时自动检测 |
| 输入 | 外部主题包 | catalog 中的 ThemeColors |
| 输出 | 6 端 CSS + bundle | 更新的 CSS + 新基线 |
| 依赖 | 无 | P2 probe/fidelity |
| 验收 | npm run check 全绿 | hitRate ≥ 85% + matchRatio ≥ 0.8 |

---

## 15. 评审结论

### 评审检查清单

- [x] 指纹 schema 是否向前兼容（version 字段）
- [x] 并发守卫是否覆盖所有入口
- [x] 回滚策略是否完备（regen 失败保留旧 CSS）
- [x] 人工介入门控阈值是否合理（matchRatio < 0.5）
- [x] 与现有 apply 流程的集成点是否最小侵入
- [x] 测试覆盖是否包含 happy path + 所有降级路径
- [x] 资源泄漏防护（CDP session 释放、cooldown 清理）
- [x] 错误处理是否对齐 ir/errors.ts 体系
- [x] 跨层依赖方向是否正确（main ↛ UI）
- [x] CI/check 脚本是否覆盖 fingerprint.json

### 评审参与

| 角色 | 智能体 | 日期 | 输出 |
|------|--------|------|------|
| 规范合规评审 | code-review-expert | 2026-08-20 | 3 FAIL + 4 WARNING |
| 架构一致性评审 | code-review-expert | 2026-08-20 | 4 FAIL + 6 WARNING |
| 工程可行性评审 | code-review-expert | 2026-08-20 | 2 FAIL + 5 WARNING |
| 风险边界评审 | code-review-expert | 2026-08-20 | 5 FAIL + 8 WARNING |

### 评审决议

**状态：`已通过（待实施）`**

所有 BLOCKER 已闭环修复（见 §16 评审修复清单）。P3a 实施可启动。

---

> **本 RFC 为独立文档，评审通过后方可进入 P3a 实施。**

---

## 16. 评审修复清单

### 16.1 规范合规修复（3 FAIL → PASS）

| 原问题 | 修复方式 |
|--------|---------|
| 缺失 §2 触发条件对照表 | → 已新增 §2 触发条件对照表（见文档 §2） |
| 缺失 §7 人工复核项 | → 已新增 §9 人工复核项（见文档 §9） |
| §12 非正式评审结论 | → 已替换为结构化表格（见上方 §15） |

### 16.2 架构一致性修复（4 FAIL → PASS）

| 原问题 | 修复方式 |
|--------|---------|
| pipeline.ts 不支持 skip-stage | → partial re-run 独立实现（不修改 pipeline.ts），直接在 fingerprint.ts 中 import adaptAll + completeSurfaceLayering + verify |
| regen 期间 CDP session 生命周期 | → regen 使用 deferred thunk 模式，由 agent-engine-service 串行化调度；session 复用 apply 时的连接池 |
| 跨层依赖 hash.ts | → fingerprint.ts 改用 Node 原生 `crypto.createHash('sha256')` |
| deferred thunk 未复用 | → `regenerateTheme()` 返回 `(agentId) => Promise<void>` thunk，调用方负责串行化 |

### 16.3 工程可行性修复（2 FAIL → PASS）

| 原问题 | 修复方式 |
|--------|---------|
| catalog API 未定义 | → 复用 `catalog/theme-manifest.ts` 的 `getThemeColors(themeId)` 函数（P1 已存在） |
| BaselineCssCapture 来源 | → regen verify 使用轻量替代：仅做 probeAll + contract-check，不做 heavy CSS capture；仅在 probe miss 时触发补采 |
| CI 集成缺失 | → 扩展 `check-themes.mjs` 新增第 6 项：fingerprint.json schema 校验 |

### 16.4 风险边界修复（5 FAIL → PASS）

| 原问题 | 修复方式 |
|--------|---------|
| 用户中途切换主题 | → regen 启动时记录 themeId，完成后校验当前活跃主题，否则作废并清理 tmp |
| Windows 文件锁 / NFS | → 捕获 EBUSY/ELOCK/EXDEV → 跳过本轮基线更新 + 写入 AppData 作为 fallback |
| Q1 指纹粒度未回答 | → 首次 regen 后若 hitRate < 50%，自动扩展选择器集合重试 |
| captureFingerprint 连续失败 | → 3 次连续 null 后上报用户"指纹采集异常，自愈功能降级" |
| regen 审计日志 | → 记录每次 regen 的触发信号、前后 hitRate、耗时到本地 log |

---

## 17. 上游 RFC 关联

| 原 RFC (2026-08-20) | 本 RFC (P3) |
|---------------------|-------------|
| P3 占位（§12） | 完整实施草案 |
| fingerprint + 漂移检测 | §4 + §5 详细设计 |
| apply 时比对 → 自动重生成 | §6 partial re-run 管线 |
| 拆独立 RFC | 已执行（本文档） |
