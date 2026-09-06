# RFC：AgentSkin Bundle 统一化演进（修正版）

> 状态：`待评审`
> 日期：2026-08-21
> 分支：（待建）
> 范围：`src/main/ipc/bundle-ipc.ts`（扩展）、`src/main/theme-apply-flow.ts`（扩展）、`src/shared/types/`（类型扩展）、`src/main/fs/tar-pack.ts`（不变）、`docs/THEME_SPEC.md`（规范更新）
> 上游依据：2026-08-21 统一化演进方案评估（代码实况核对）
> 关联 RFC：`2026-08-20-theme-asset-engine.md`（主题资产引擎）、`themes-surface-layout-2b.md`（面级布局）

---

## 1. 背景与目标

### 1.1 原方案诊断偏差

原统一化演进方案提出"环境组合包无统一标准、加载管线耦合严重、元数据协议不完整"三大痛点。经代码实况核对，**三大痛点中前两项与代码实况不符**：

| 原方案声称 | 代码实况 | 偏差 |
|-----------|----------|------|
| "环境组合包无统一标准，仅存在于概念设计" | `.agentskin-bundle` 已实现：`bundle-ipc.ts` + `tar-pack.ts` + `CenterTabBundle.tsx`，支持主题+壁纸组合包全流程 | ❌ 未调研现有实现 |
| "ThemeLibrary.store.ts 硬编码两种格式解析逻辑" | Store 仅读 `.agentskin-theme`，legacy 仅做启动迁移（`migrateLegacyDirectories()`），解析委托引擎 | ❌ 过度描述 |
| "AgentEngineService.apply() 只处理 ThemePackage" | 已是 Facade，delegate 给 `theme-apply-flow.ts`（已拆解为 7+ 子模块） | ❌ 架构已拆解 |
| "缺少统一 BundleRuntime 作为注入入口" | `installBundleFromPath()` 已实现解包→校验→装库→注册壁纸全流程 | ❌ 已存在 |

### 1.2 真正缺失的能力

代码实况核对后，确认以下能力**确实不存在**：

| 能力 | 现状 | 代码证据 |
|------|------|----------|
| **变量注入占位符** (`${user.token}`) | ❌ 不存在 | 搜索 `${` 模式仅发现模板字符串，无变量注入框架 |
| **生命周期钩子** (pre/post-inject) | ❌ 不存在 | 搜索 `preInject`/`postInject` 无结果 |
| **YAML manifest** | ❌ 不存在 | 当前 bundle 复用主题 `manifest.json` |
| **脚本编辑器** (Monaco) | ❌ 不存在 | 无 Monaco 依赖 |

### 1.3 目标

在现有 `.agentskin-bundle` 基础上，以**最小改动**补充变量注入与生命周期钩子能力：

1. **变量注入**：主题包可声明 `variables` 字段，安装/应用时替换 CSS 中的 `${variableName}` 占位符
2. **生命周期钩子**：主题包可声明 `hooks.preInject` / `hooks.postInject`，在注入前后执行沙箱脚本
3. **向后兼容**：无 `variables`/`hooks` 字段的主题包行为不变
4. **零新依赖**：不引入 YAML 解析器、Monaco 等重依赖

### 1.4 非目标

- ❌ 重构为三层管线（BundleValidator → BundleParser → BundleRuntime）—— 现有架构已覆盖
- ❌ 引入 YAML manifest —— JSON manifest 够用，YAML 增加认知负担
- ❌ 引入 Monaco 脚本编辑器 —— 远期需求，可用简单 textarea 起步
- ❌ ZIP 格式迁移 —— tar.gz 已零依赖实现，无替换必要
- ❌ 强制 `.codex-theme` → `.agentskin-bundle` 迁移 —— 现有 `.codex-theme` → `.agentskin-theme` 迁移已足够

### 1.5 RFC 触发条件

根据 AGENTS.md §6 RFC 触发条件：

| 触发条件 | 是否命中 | 说明 |
|---------|:-------:|------|
| 重构注入架构（L0-L4 注入层） | ❌ | 不重构注入架构，仅扩展现有 bundle 能力 |
| 新增 UI 页面（突破六页封顶） | ❌ | 不涉及 UI 页面 |
| 新增适配器（突破六适配器上限） | ❌ | 不涉及适配器 |
| 修改核心数据模型 | ✅ | `ThemeBundle` 新增 `variables` 和 `hooks` 可选字段 |

**裁决**：命中"修改核心数据模型"触发器，需提交 RFC 评审。

---

## 2. 已核实现状（代码锚点）

### 2.1 现有 `.agentskin-bundle` 实现

| 能力 | 位置 | 说明 |
|------|------|------|
| Bundle 扩展名定义 | `src/main/ipc/bundle-ipc.ts:32` | `BUNDLE_EXTENSION = '.agentskin-bundle'` |
| 打包 | `src/main/fs/tar-pack.ts:103-120` | `packDirToTarGz()` — 零依赖 tar.gz |
| 解包 | `src/main/fs/tar-pack.ts:166-184` | `extractTarGz()` — 含路径穿越防护 |
| 安装入口 | `src/main/ipc/bundle-ipc.ts:52-83` | `installBundleFromPath()` — 解包→校验→装库→注册壁纸 |
| IPC 注册 | `src/main/ipc/bundle-ipc.ts:85-150` | `registerBundleIpc()` — CREATE/INSTALL/OPEN_FILE |
| 壁纸注册 | `src/main/wallpaper/theme-wallpaper.ts` | `registerThemeWallpaperForInstalled()` |
| Studio UI | `src/ui/components/studio/center/CenterTabBundle.tsx` | Bundle 管理面板 |
| 架构文档 | `docs/ARCHITECTURE.md:98` | 已记录 `.agentskin-bundle` 为分发格式 |

### 2.2 现有 ThemeBundle 数据结构

```typescript
// src/shared/types/health-check.ts:128-139
export interface ThemeBundle {
  format: 'agentskin-theme';
  schemaVersion: 1;
  exportedAt?: string;
  theme: ThemeIdentity;
  targets: Record<string, ThemeTarget>;
  assets?: {
    images?: Record<string, ThemeImage>;
    art?: ThemeArt;  // @deprecated
  };
}
```

### 2.3 现有 Apply Flow

```
AgentEngineService.apply()
  → applyThemeFlow() / fastApplyThemeFlow()
    → applyOnResolvedPort()
      → adapter.applyTheme(entry.bundle, { port, launch: false, ... })
      → hardeningPass()
      → injectAgentWallpaperFromApply()
      → syncSchemeWithStability()
```

**关键注入点**：`adapter.applyTheme(entry.bundle, ...)` 是 CSS 注入的唯一入口，变量替换应在此前执行。

---

## 3. 设计方案

### 3.1 数据模型扩展

在 `ThemeBundle` 新增两个可选字段：

```typescript
// src/shared/types/health-check.ts — ThemeBundle 扩展
export interface ThemeBundle {
  // ... 现有字段 ...

  /**
   * 变量注入表 — 安装/应用时替换 CSS 中的 ${variableName} 占位符。
   * 键为变量名（不含 ${}），值为替换值（CSS 合法值）。
   * 示例：{ "accent": "#ff6600", "font-size": "14px" }
   */
  variables?: Record<string, string>;

  /**
   * 生命周期钩子 — 注入前后执行的沙箱脚本。
   * 脚本在 Node.js vm 模块沙箱中执行，仅暴露有限 API。
   */
  hooks?: {
    /** 注入前执行 — 可修改 CSS/变量，或中止注入（抛错）。 */
    preInject?: string;
    /** 注入后执行 — 可执行清理或通知。 */
    postInject?: string;
  };
}
```

**设计决策**：

| 决策点 | 选择 | 原因 |
|--------|------|------|
| 变量注入层级 | CSS 字符串替换 | 最小改动，不涉及 JS 运行时 |
| 变量语法 | `${variableName}` | 与 CSS `var()` 语法区分，避免冲突 |
| 钩子执行环境 | Node.js `vm` 模块 | 零依赖，沙箱隔离 |
| 钩子脚本语言 | JavaScript | 与项目技术栈一致 |
| 字段位置 | `ThemeBundle` 顶层 | 与 `targets`/`assets` 同级，序列化友好 |

### 3.2 变量注入实现

#### 3.2.1 替换时机

在 `theme-apply-flow.ts` 的 `applyOnResolvedPort()` 中，`adapter.applyTheme()` 调用**前**执行变量替换：

```typescript
// src/main/theme-apply-flow.ts — applyOnResolvedPort() 内
// 原代码：
await trace.step('applyTheme', () =>
  adapter.applyTheme(entry.bundle, { port, launch: false, ... })
);

// 修改为：
const bundleWithVars = resolveThemeVariables(entry.bundle, entry.filePath);
await trace.step('applyTheme', () =>
  adapter.applyTheme(bundleWithVars, { port, launch: false, ... })
);
```

#### 3.2.2 替换函数

```typescript
// src/main/theme-variable-resolve.ts（新文件）

/**
 * 解析主题包中的变量占位符，返回替换后的新 bundle。
 * 不修改原 bundle（不可变）。
 *
 * 占位符语法：${variableName}
 * 未定义变量 → 保留原占位符（不替换），并记录警告。
 * 非法变量名 → 跳过（变量名仅允许 [a-zA-Z0-9_-]）。
 */
export function resolveThemeVariables(
  bundle: ThemeBundle,
  sourcePath: string,
): ThemeBundle {
  const variables = bundle.variables;
  if (!variables || Object.keys(variables).length === 0) {
    return bundle; // 无变量，直接返回
  }

  const pattern = /\$\{([a-zA-Z0-9_-]+)\}/g;
  const replacedTargets: Record<string, ThemeTarget> = {};

  for (const [agentId, target] of Object.entries(bundle.targets)) {
    replacedTargets[agentId] = {
      ...target,
      css: target.css.replace(pattern, (match, varName) => {
        if (varName in variables) {
          return variables[varName];
        }
        // 未定义变量 → 保留原占位符，记录警告
        console.warn(`[theme-vars] Undefined variable "${varName}" in ${sourcePath}`);
        return match;
      }),
    };
  }

  return {
    ...bundle,
    targets: replacedTargets,
  };
}
```

#### 3.2.3 变量校验

```typescript
// src/main/theme-variable-resolve.ts

/** 校验变量值是否为合法 CSS 值（基础校验，防止注入）。 */
export function validateThemeVariable(name: string, value: string): void {
  // 变量名：仅允许 [a-zA-Z0-9_-]
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error(`Invalid variable name: "${name}"`);
  }
  // 值：禁止包含 `;{}` 等可能破坏 CSS 结构的字符（基础防护）
  if (/[;{}]/.test(value)) {
    throw new Error(`Invalid variable value for "${name}": contains illegal characters`);
  }
}
```

### 3.3 生命周期钩子实现

#### 3.3.1 执行时机

```typescript
// src/main/theme-apply-flow.ts — applyOnResolvedPort() 内

// 注入前钩子
if (entry.bundle.hooks?.preInject) {
  await trace.step('preInjectHook', () =>
    executeHookScript(entry.bundle.hooks.preInject, {
      themeId: entry.bundle.theme.id,
      agentId: appId,
      port,
      phase: 'preInject',
    })
  );
}

// ... adapter.applyTheme() ...

// 注入后钩子（fire-and-forget，不阻塞响应）
if (entry.bundle.hooks?.postInject) {
  backgroundTasks.push(
    executeHookScript(entry.bundle.hooks.postInject, {
      themeId: entry.bundle.theme.id,
      agentId: appId,
      port,
      phase: 'postInject',
    }).catch((err) => {
      deps.log(`[hook] postInject failed for ${entry.bundle.theme.id}: ${err.message}`);
    })
  );
}
```

#### 3.3.2 沙箱执行器

```typescript
// src/main/theme-hook-executor.ts（新文件）
import vm from 'node:vm';

export interface HookContext {
  themeId: string;
  agentId: string;
  port: number;
  phase: 'preInject' | 'postInject';
}

/**
 * 在 Node.js vm 沙箱中执行钩子脚本。
 *
 * 沙箱仅暴露：
 *   - console: 受限的日志输出
 *   - context: HookContext（只读）
 *   - 无 require/process/global 访问
 *
 * 脚本超时：5 秒（防止死循环）。
 * 脚本抛错 → preInject 阶段中止注入，postInject 阶段仅记录警告。
 */
export function executeHookScript(
  script: string,
  context: HookContext,
): Promise<void> {
  const sandbox = {
    console: {
      log: (...args: unknown[]) => console.log(`[hook:${context.phase}]`, ...args),
      warn: (...args: unknown[]) => console.warn(`[hook:${context.phase}]`, ...args),
      error: (...args: unknown[]) => console.error(`[hook:${context.phase}]`, ...args),
    },
    context: Object.freeze({ ...context }),
  };

  vm.createContext(sandbox);
  return new Promise((resolve, reject) => {
    try {
      const result = vm.runInContext(script, sandbox, {
        timeout: 5000,
        filename: `hook-${context.themeId}-${context.phase}.js`,
      });
      // 支持 async 脚本
      if (result && typeof result.then === 'function') {
        result.then(resolve, reject);
      } else {
        resolve();
      }
    } catch (error) {
      reject(error);
    }
  });
}
```

### 3.4 安装时处理

`installBundleFromPath()` 解包后，校验 `variables` 和 `hooks` 字段：

```typescript
// src/main/ipc/bundle-ipc.ts — installBundleFromPath() 内

// 解包后、装库前
const rawManifest = await readManifest(pkgRoot);
if (rawManifest.variables) {
  for (const [name, value] of Object.entries(rawManifest.variables)) {
    validateThemeVariable(name, value);
  }
}
if (rawManifest.hooks) {
  if (typeof rawManifest.hooks.preInject !== 'string' && typeof rawManifest.hooks.postInject !== 'string') {
    throw new Error('hooks must contain at least one of preInject or postInject');
  }
}
```

### 3.5 与现有系统集成

```
┌─────────────────────────────────────────────────────────────┐
│ Studio 导出 .agentskin-bundle                                │
│   → packDirToTarGz()  [现有]                                │
│   → manifest.json 包含 variables/hooks  [扩展]               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ installBundleFromPath()  [现有 + 扩展]                       │
│   → extractTarGz()  [现有]                                  │
│   → validateThemeVariables()  [新增]                        │
│   → ThemePackageLoader.load()  [现有]                       │
│   → ThemeInstaller.install()  [现有]                        │
│   → registerThemeWallpaperForInstalled()  [现有]            │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ applyThemeFlow()  [现有 + 扩展]                              │
│   → resolveThemeVariables()  [新增]                         │
│   → executeHookScript(preInject)  [新增]                    │
│   → adapter.applyTheme()  [现有]                            │
│   → executeHookScript(postInject)  [新增, fire-and-forget]  │
│   → hardeningPass()  [现有]                                 │
│   → injectAgentWallpaperFromApply()  [现有]                 │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. 风险与兜底

| # | 风险 | 等级 | 触发条件 | 兜底策略 | 检测机制 |
|---|------|------|----------|----------|----------|
| R1 | 变量注入破坏 CSS | 中 | 变量值包含 `;{}` 等字符 | 安装时校验拒绝非法值 | `validateThemeVariable()` |
| R2 | 钩子脚本死循环/超时 | 低 | 钩子脚本含 `while(true)` | vm 沙箱 5s 超时 | `timeout: 5000` |
| R3 | 钩子脚本访问敏感 API | 低 | 钩子尝试 `require('fs')` | vm 沙箱仅暴露 `console` + `context` | `vm.createContext(sandbox)` |
| R4 | 变量名与 CSS `var()` 冲突 | 低 | 主题同时使用 `${name}` 和 `var(--name)` | 文档明确区分两种语法 | 规范文档 |
| R5 | 旧版本无法解析新字段 | 中 | 旧版 AgentSkin 安装含 variables/hooks 的主题包 | 字段为可选，旧版忽略（但 CSS 占位符保留） | 版本检测 + 优雅降级 |
| R6 | 钩子脚本抛错阻塞注入 | 中 | preInject 脚本抛错 | preInject 抛错 → 中止注入并提示用户 | try/catch + 错误映射 |

---

## 5. 分批落地计划

### Phase 1：变量注入（Week 1，预计 3-5 天）

**改动范围**：
- 新增 `src/main/theme-variable-resolve.ts`（~60 行）
- 修改 `src/main/theme-apply-flow.ts`（+5 行）
- 修改 `src/main/ipc/bundle-ipc.ts`（+15 行校验）
- 新增测试 `tests/main/theme-variable-resolve.test.ts`（~15 测试）
- 更新 `docs/THEME_SPEC.md` 新增变量规范

**验收标准**：
- 主题包 manifest 声明 `variables: { "accent": "#ff6600" }`
- CSS 中 `${accent}` 被替换为 `#ff6600`
- 未定义变量保留原占位符并记录警告
- 非法变量值安装时拒绝
- 现有主题包（无 variables 字段）行为不变

### Phase 2：生命周期钩子（Week 2，预计 3-5 天）

**改动范围**：
- 新增 `src/main/theme-hook-executor.ts`（~70 行）
- 修改 `src/main/theme-apply-flow.ts`（+15 行）
- 新增测试 `tests/main/theme-hook-executor.test.ts`（~12 测试）
- 更新 `docs/THEME_SPEC.md` 新增钩子规范

**验收标准**：
- preInject 脚本可访问 `context.themeId`、`context.agentId`
- preInject 抛错 → 中止注入
- postInject 在注入后异步执行（不阻塞响应）
- 钩子脚本 5s 超时保护
- 钩子脚本无法访问 `require`/`process`/`global`

### Phase 3：Studio UI（按需，Week 3+）

**改动范围**：
- `CenterTabBundle.tsx` 新增变量编辑器（颜色选择器、文本输入）
- 可选：钩子脚本编辑器（textarea 起步，Monaco 远期）

**前置条件**：Phase 1-2 验证变量/钩子能力有价值。

---

## 6. 人工复核项

1. **变量注入语法**：`${variableName}` 是否与现有 CSS/模板语法冲突？
2. **钩子 API 设计**：`console` + `context` 是否足够？是否需要暴露更多上下文（如当前 CSS、变量表）？
3. **安全边界**：`validateThemeVariable()` 的字符白名单是否过于严格/宽松？
4. **向后兼容策略**：旧版遇到含 variables 的主题包时，是静默忽略还是提示升级？

---

## 7. 与原方案对比

| 维度 | 原方案 | 本 RFC |
|------|--------|--------|
| 核心思路 | 从零构建三层管线 + YAML manifest + ZIP | 扩展现有 `.agentskin-bundle` + JSON |
| 新依赖 | js-yaml + Monaco + vm2 | 无（使用 Node.js 内置 `vm`） |
| 改动范围 | 重构注入架构 + 新增 5+ 模块 | 新增 2 个文件 + 修改 2 个文件 |
| 开发成本 | 6-8 周 | 1-2 周 |
| 风险 | 高（架构破坏、新依赖漏洞） | 低（最小改动、零新依赖） |
| 向后兼容 | 需迁移工具 | 天然兼容（可选字段） |
| RFC 触发 | 重构注入架构 + 修改数据模型 | 仅修改数据模型 |

---

## 8. 评审结论

（评审意见汇总，由评审人填写）
