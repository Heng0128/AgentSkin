# P0 安全护栏交叉评审报告

> 日期: 2026-08-24
> 评审范围: P0-1-specificity-guard / P0-2-keyframes-sanitize / P0-3-sandbox-isolation
> 上游参照: λ 方案（2026-08-22-theme-compiler-unified.md）

---

## 1. 文档间一致性

**共享引用**：三份文档均以 λ 方案为上游，引用关系正确。P0-1 与 P0-2 共同修改 `src/compiler/emit.ts` 和 `src/shared/token/animation-presets.ts`，改动边界清晰，无文件级冲突。

**类型定义冲突**：P0-2 定义 `SanitizeResult { cleaned, violations, isBlocked }`，而既有 `src/shared/safe-css.ts` 已存在同名接口 `SanitizeResult { clean, blocked, reasons }`。字段命名不一致（`cleaned` vs `clean`、`isBlocked` vs `blocked`），若两模块在同一 scope 下使用将造成混淆。建议统一命名或加命名空间前缀。

**Schema 耦合**：P0-3 将 manifest v3 的 `hooks` 字段从 `{preBuild, postBuild}` 扩展为 `{preBuild, postBuild, sandbox}`，与 λ 方案 §3.6 的 schema 定义兼容，但 P0-1 的 `SpecificityProfile` 未纳入 manifest schema，仅作为编译器内部常量。建议明确 specificity profile 是否应暴露为 manifest 字段（用户可覆盖）或保持硬编码。

---

## 2. 遗漏排查

### 2.1 λ 方案整体安全覆盖缺口

| 缺口 | 描述 | 风险 |
|------|------|------|
| **parse.ts schema 校验 DoS** | 恶意 manifest.json 含深层嵌套或超大字段，可导致 JSON Schema 校验超时 | P2 |
| **tokenize.ts 颜色注入** | OKLCH 转换前未校验 manifest colors 字段格式，`color-theory.mjs` 的 APCA 实现是否容忍非标准输入未验证 | P2 |
| **CDP 注入层（L0-L4）** | 三份护栏均聚焦编译管线，但 `hybrid-injector.mjs` 的 `CSSStyleSheet.replaceSync()` 注入路径无对应安全校验 | P1 |
| **bridge 脚本** | Codex/VSCode 桥接导入外部主题时，transformCss 的安全性不在三份护栏范围内 | P2 |

### 2.2 Fallback 路径完整性

- **P0-1**：PostCSS 解析失败时回退轻量正则，但未定义正则路径的 specificity 计算精度损失容忍度。
- **P0-2**：`isBlocked` 时 `continue` 跳过该 keyframes，但未说明是否向用户 UI 发出可见告警（仅日志不够）。
- **P0-3**：`isolated-vm` 不可用时回退 `child_process + seccomp`，但 seccomp 在 Windows 平台不可用，未提供 Windows 备选方案。

### 2.3 性能影响评估

- **P0-1**：PostCSS AST 解析 + 全量 rule 扫描，低配设备 84 文件 × 251 token 场景未给性能预算。
- **P0-2**：自研 PEG-lite 扫描器 O(n) 线性复杂度，性能可控；但未评估与 optimize.ts 增量缓存的交互——sanitize 结果应纳入 cache key。
- **P0-3**：base64 内嵌字体/图片导致主题包体积膨胀（R4），与 λ 方案"14 主题 ≤ 2 秒"目标存在张力。

### 2.4 低配设备考量

仅 P0-1 明确提及低配 fallback（正则替代 PostCSS）。P0-2 的 sanitize 虽零依赖但未做性能基线；P0-3 的 `isolated-vm` 在 4 核/8GB 设备上的启动开销未评估。

---

## 3. 架构冲突排查

### 3.1 sanitize 层与 optimize.ts 的关系

P0-2 的 sanitize 应在 optimize.ts 的 @keyframes 碰撞消解之前还是之后执行？当前设计未明确。若先 sanitize 后 optimize，重命名逻辑（`agentskin-usr-<hash4>-<原名>`）可能与 optimize.ts 的 `agentskin-breathing-{hash6}` 重命名冲突。**建议**：sanitize 在 optimize 之前执行，且两模块的 hash 命名空间需统一规范。

### 3.2 specificity profile 与 manifest v3 schema 的耦合

P0-1 的 `hostMaxSpecificity` 依赖 CDP 探测基线（§3.1），但当前 6 个值均为人工假设，未经验证。若 λ 方案落地后宿主应用版本更新导致原生 specificity 变化，硬编码 profile 将失效。**建议**：profile 中增加 `version` 字段标识基线校准版本，并在 diagnostics.ts 中增加运行时校验。

### 3.3 沙箱隔离对增量编译缓存的影响

P0-3 的 hooks 在沙箱中执行，其输出 `tokens` 影响最终 CSS 产物。但 λ 方案 §3.1 的增量缓存仅基于 AST hash，未包含沙箱执行结果。**建议**：cache key 应包含 hooks 输出的 hash，否则沙箱输出变化时增量缓存将返回过期产物。

---

## 4. 实施优先级

| 顺序 | 护栏 | 理由 |
|:----:|------|------|
| **1** | **P0-2 keyframes-sanitize** | 零依赖、自包含，不依赖 λ 方案即可独立实施；且 sanitize.ts 是 P0-3 hooks 安全执行的前提（hooks 可能输出 CSS） |
| **2** | **P0-3 sandbox-isolation** | 依赖 P0-2 的 sanitize 能力处理 hooks 产出物；dependency-audit 可独立先行 |
| **3** | **P0-1 specificity-guard** | 强依赖 λ 方案 emit.ts 骨架就绪；check-specificity-budget.mjs 可作为独立脚本先行运行产出报告 |

**关键路径**：P0-2 → P0-3 → P0-1。P0-2 是另外两个护栏的安全基础设施。

---

## 5. 测试覆盖度

### 5.1 P0-1 测试缺口

- 缺少 `decorationGuard: true` 时自动加 `!important` 的边界测试（budget 恰好为 0 时行为）
- 缺少 `hostMaxSpecificity` 基线校准的集成测试（需 CDP 实测）
- 缺少 6 适配器 × 23 token 全量 Emit 的性能回归测试

### 5.2 P0-2 测试缺口

- T11 覆盖 `@supports` 嵌套但未覆盖 `@layer` 嵌套规避
- 缺少 Unicode 编码绕过测试（如 `url(\000068ttp://...)`）
- 缺少多 `@keyframes` 块连续注入时的状态隔离测试（扫描器是否跨块泄漏状态）

### 5.3 P0-3 测试缺口

- **攻击树 B3（闭包逃逸）无对应测试用例**——isolated-vm 的 `constructor.callee` 逃逸是已知攻击模式
- C3（ReDoS）仅有风险评级无测试方案
- 缺少 `dependency-audit.mjs` 检测到 postinstall 脚本时的阻塞集成测试
- 缺少 CSP 注入与宿主应用（如 WorkBuddy 已有 CSP header）冲突的端到端测试

---

## 6. 修复建议汇总

| # | 建议 | 优先级 |
|---|------|:------:|
| 1 | 统一 P0-2 与 safe-css.ts 的 SanitizeResult 接口命名 | P1 |
| 2 | P0-3 补充 Windows 平台沙箱备选方案（无 seccomp） | P1 |
| 3 | 明确 sanitize 与 optimize 的执行顺序并统一 hash 命名空间 | P1 |
| 4 | P0-3 cache key 纳入 hooks 输出 hash | P1 |
| 5 | P0-2 补充 Unicode 编码绕过与 @layer 嵌套测试 | P2 |
| 6 | P0-3 补充闭包逃逸（B3）和 ReDoS（C3）测试用例 | P2 |
| 7 | P0-1 profile 增加基线校准版本字段 | P2 |
| 8 | 三份护栏统一增加"向用户 UI 发出可见告警"的 fallback 路径 | P2 |
| 9 | 评估 CDP 注入层（hybrid-injector）的安全校验缺口 | P2 |

---

**结论**：三份 P0 护栏整体设计质量较高，覆盖 λ 方案核心攻击面，但在接口命名统一、模块执行顺序、增量缓存交互、平台兼容性、测试覆盖完整度五个方面存在需修复的问题。建议按 P0-2 → P0-3 → P0-1 顺序实施，优先解决标记为 P1 的 4 项建议后再进入编码阶段。
