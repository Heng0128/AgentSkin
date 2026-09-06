# Codex Styler 学习成果 — AgentSkin 实施方案

> 基于对 [codex-styler](https://github.com/xuhuanstudio/codex-styler) 仓库的深入分析，提出 7 个具体实施方案，提升 AgentSkin 底层注入视觉质量和注入引擎。

---

## 一、Codex Styler 核心设计洞察

### 1.1 四层边界架构

```
React manager, theme editor, and Companion Studio
        │ validated commands
        ▼
Tauri command boundary ── theme package validator
        │
        ├── app-data theme, companion, project, and diagnostics
        ├── Codex detector and managed launcher
        └── CDP compatibility adapter
                    │
                    ▼
          isolated scene runtime
          (one idempotent root)
```

**关键洞察**：Compatibility adapter 是**唯一**了解目标应用 DOM 的层，主题包永远不包含选择器或 CSS。

### 1.2 Scene Model（场景模型）

```json
{
  "scene": {
    "layers": [
      { "type": "image", "src": "background.webp", "zIndex": 0 },
      { "type": "gradient", "colors": ["#000", "#fff"], "zIndex": 1 }
    ],
    "entities": [
      {
        "renderer": "sprite-atlas",
        "atlas": "companion-atlas.webp",
        "frames": 512,
        "behaviors": ["look-at-pointer", "parallax"],
        "anchor": { "x": "50%", "y": "80%" },
        "attachment": { "target": "composer", "edge": "bottom" }
      }
    ]
  }
}
```

**关键洞察**：显式声明 `layers[]` + `entities[]`，渲染器类型化，行为系统可组合。

### 1.3 Semantic Color Palette（语义色板）

- 5 个必需源色板：`accent`, `surface`, `text`, `mutedText`, `border`
- 高级主题可通过 `appearance.palette` 细化单个角色
- 这些是 **Styler 的稳定角色名**，不是目标应用的 CSS 变量
- 版本化兼容性适配器将它们映射到目标 token 系统

### 1.4 兼容性策略（三档）

| 策略 | 行为 |
|------|------|
| `conservative` | 只隔离背景、场景和伴侣层 |
| `enhanced` | 适配器可样式化已批准的语义表面，健康检查失败后回退 |
| `blocked` | 确认的不兼容版本无法主题化 |

**关键洞察**：版本变化本身不是自动失败。增强模式尝试语义样式化，仅在实时健康检查失败后才回退。

### 1.5 纯数据包安全模型

**允许**：theme.json + LICENSES.json + 本地 PNG/JPEG/WebP

**禁止**：脚本、CSS、SVG、字体、视频、可执行文件、远程 URL、绝对路径

**限制**：50 MiB 压缩 / 100 MiB 解压 / 20 MiB 单文件 / 8192×8192 单图

---

## 二、与 AgentSkin 的差距分析

| 维度 | Codex Styler | AgentSkin | 差距 |
|------|--------------|-----------|------|
| **场景模型** | 显式 `layers[]` + `entities[]` + 渲染器类型 | L0-L4 注入层（隐式） | 缺乏显式场景分层声明 |
| **色板系统** | 5 源色板 + 语义角色 + 版本化映射 | 14 token 直接映射 | 缺乏"语义角色→目标 token"中间层 |
| **外壳控制** | layout/iconStyle/decorations 三轴 | 无此概念 | 缺少不影响功能的纯视觉变化维度 |
| **兼容性策略** | conservative/enhanced/blocked 三档 | 适配器直接注入 | 缺乏分级回退机制 |
| **包验证** | 严格大小/类型限制 + magic bytes 检查 | 基础 schema 验证 | 验证相对宽松 |
| **生命周期** | 明确状态机 + revision 防覆盖 | bootProgress store | 状态管理较简单 |
| **诊断导出** | 结构化报告（排除敏感信息） | diagnostics store | 缺乏导出机制 |
| **恢复保证** | Pause/Restore 分离 | 一键回滚 | 缺乏细粒度恢复 |

---

## 三、实施方案

### 方案 4：兼容性策略分级（P0 / 高价值）

#### 3.1.1 目标

实现 conservative/enhanced/blocked 三档兼容性策略，使版本变化不自动失败，增强模式尝试语义样式化，健康检查失败才回退。

#### 3.1.2 现有架构分析

AgentSkin 当前架构中：
- `InjectionOrchestrator` 负责协调多引擎注入
- `InjectionStateMachine` 跟踪 10 状态生命周期
- `contract-validator.ts` 提供声明式验证
- `health-monitor.ts` 提供持续漂移检测

**问题**：这些组件缺乏统一的兼容性策略决策层。

#### 3.1.3 新增文件

```
src/shared/injection/
├── compatibility/
│   ├── compatibility-policy.ts        # 策略定义与决策
│   ├── compatibility-policy.test.ts   # 策略测试
│   ├── adapter-registry.ts            # 适配器版本注册
│   └── adapter-registry.test.ts       # 注册表测试
```

#### 3.1.4 核心代码设计

```typescript
// src/shared/injection/compatibility/compatibility-policy.ts

// SPDX-License-Identifier: MPL-2.0

/**
 * # Compatibility Policy — 三档兼容性策略
 * 
 * 借鉴 Codex Styler 的 conservative/enhanced/blocked 三档策略，
 * 使版本变化不自动失败，增强模式尝试语义样式化，健康检查失败才回退。
 */

import type { AgentId } from '../../types/agent';
import type { HealthCheckResult } from '../../../main/cdp/injection/health-monitor';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 兼容性策略三档 */
export type CompatibilityMode = 'conservative' | 'enhanced' | 'blocked';

/** 策略决策上下文 */
export interface PolicyContext {
  /** 目标应用当前版本 */
  targetVersion: string;
  /** 主题声明的最低兼容版本 */
  minCompatibleVersion: string;
  /** 主题声明的最高兼容版本（可选） */
  maxCompatibleVersion?: string;
  /** 上次健康检查结果（enhanced 模式） */
  lastHealthCheck?: HealthCheckResult;
  /** 连续健康检查失败次数 */
  consecutiveFailures: number;
}

/** 策略决策结果 */
export interface PolicyDecision {
  /** 决策的模式 */
  mode: CompatibilityMode;
  /** 决策原因 */
  reason: string;
  /** 是否允许注入 */
  allowInjection: boolean;
  /** 降级建议（enhanced → conservative 时） */
  fallbackAdvice?: string;
}

// ---------------------------------------------------------------------------
// Policy Engine
// ---------------------------------------------------------------------------

/** 连续失败阈值 — 超过此值从 enhanced 降级到 conservative */
const CONSECUTIVE_FAILURE_THRESHOLD = 3;

/**
 * 兼容性策略决策引擎
 * 
 * 决策流程：
 * 1. 版本不在声明范围内 → blocked
 * 2. 版本在范围内 + 无健康问题 → enhanced
 * 3. 版本在范围内 + 健康问题 + 连续失败 < 阈值 → enhanced（尝试修复）
 * 4. 版本在范围内 + 健康问题 + 连续失败 >= → conservative（降级）
 */
export function decideCompatibilityPolicy(
  context: PolicyContext,
): PolicyDecision {
  const { targetVersion, minCompatibleVersion, maxCompatibleVersion, consecutiveFailures } = context;

  // 1. 版本范围检查
  if (!isVersionCompatible(targetVersion, minCompatibleVersion, maxCompatibleVersion)) {
    return {
      mode: 'blocked',
      reason: `Target version ${targetVersion} is outside the compatible range [${minCompatibleVersion}, ${maxCompatibleVersion ?? 'latest'}]`,
      allowInjection: false,
    };
  }

  // 2. 保守模式 — 始终安全
  // 如果用户显式选择保守模式，直接返回
  // （此处可由用户设置控制）

  // 3. 增强模式 — 检查健康状态
  if (consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD) {
    return {
      mode: 'conservative',
      reason: `Consecutive health check failures (${consecutiveFailures}) exceeded threshold (${CONSECUTIVE_FAILURE_THRESHOLD})`,
      allowInjection: true,
      fallbackAdvice: 'Semantic styling disabled; using isolated layers only',
    };
  }

  // 4. 默认增强模式
  return {
    mode: 'enhanced',
    reason: 'Version compatible and health checks passing',
    allowInjection: true,
  };
}

/**
 * 语义化版本范围检查
 */
function isVersionCompatible(
  version: string,
  min: string,
  max?: string,
): boolean {
  const v = parseSemver(version);
  const minV = parseSemver(min);
  
  if (!v || !minV) return false;
  
  const cmpMin = compareSemver(v, minV);
  if (cmpMin < 0) return false;
  
  if (max) {
    const maxV = parseSemver(max);
    if (!maxV) return false;
    const cmpMax = compareSemver(v, maxV);
    if (cmpMax > 0) return false;
  }
  
  return true;
}

/** 解析 semver 字符串 */
function parseSemver(v: string): [number, number, number] | null {
  const match = v.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
}

/** 比较两个 semver — -1: a<b, 0: a=b, 1: a>b */
function compareSemver(a: [number, number, number], b: [number, number, number]): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}
```

#### 3.1.5 集成到 Orchestrator

```typescript
// 修改 src/shared/injection/orchestrator/injection-orchestrator.ts

import { decideCompatibilityPolicy } from '../compatibility/compatibility-policy';

// 在 doExecute 方法中添加策略检查
private async doExecuteWithPolicy(
  params: OrchestratorExecuteParams,
): Promise<InjectionResult> {
  // 获取策略决策
  const policy = this.getPolicyDecision(params.agentId);
  
  if (!policy.allowInjection) {
    return {
      success: false,
      layersAffected: 0,
      tokensWritten: 0,
      error: `Blocked by compatibility policy: ${policy.reason}`,
    };
  }
  
  // 根据模式调整注入行为
  if (policy.mode === 'conservative') {
    // 保守模式：只注入隔离层
    return this.executeConservative(params);
  }
  
  // 增强模式：完整注入
  return this.doExecute(params);
}
```

#### 3.1.6 测试策略

```typescript
// src/shared/injection/compatibility/compatibility-policy.test.ts

import { describe, it, expect } from 'vitest';
import { decideCompatibilityPolicy } from './compatibility-policy';

describe('CompatibilityPolicy', () => {
  it('should return blocked when version is below minimum', () => {
    const decision = decideCompatibilityPolicy({
      targetVersion: '1.0.0',
      minCompatibleVersion: '2.0.0',
      consecutiveFailures: 0,
    });
    expect(decision.mode).toBe('blocked');
    expect(decision.allowInjection).toBe(false);
  });

  it('should return enhanced when version is compatible and healthy', () => {
    const decision = decideCompatibilityPolicy({
      targetVersion: '2.5.0',
      minCompatibleVersion: '2.0.0',
      consecutiveFailures: 0,
    });
    expect(decision.mode).toBe('enhanced');
    expect(decision.allowInjection).toBe(true);
  });

  it('should downgrade to conservative after consecutive failures', () => {
    const decision = decideCompatibilityPolicy({
      targetVersion: '2.5.0',
      minCompatibleVersion: '2.0.0',
      consecutiveFailures: 3,
    });
    expect(decision.mode).toBe('conservative');
    expect(decision.allowInjection).toBe(true);
    expect(decision.fallbackAdvice).toBeDefined();
  });
});
```

#### 3.1.7 实施步骤

1. **创建 `compatibility-policy.ts`** — 实现策略决策引擎
2. **创建 `adapter-registry.ts`** — 注册每个适配器的版本兼容性信息
3. **修改 `injection-orchestrator.ts`** — 集成策略检查到执行流程
4. **修改 `health-monitor.ts`** — 在健康检查失败时更新策略状态
5. **编写测试** — 覆盖三种模式的决策逻辑
6. **更新 UI** — 在设置页面显示当前兼容性模式

#### 3.1.8 工作量估算

- 核心逻辑：2 天
- 集成到编排器：1 天
- 测试：1 天
- UI 展示：0.5 天
- **总计：4.5 天**

---

### 方案 7：生命周期 Revision 机制（P0 / 高价值）

#### 3.2.1 目标

引入 revision 机制，防止旧响应覆盖新选择，确保注入操作的幂等性和一致性。

#### 3.2.2 现有架构分析

AgentSkin 当前架构中：
- `InjectionQueue` 序列化每个 agent 的操作
- `InjectionLock` 防止并发

**问题**：缺乏 revision 机制，旧操作的响应可能覆盖新操作的结果。

#### 3.2.3 新增文件

```
src/shared/injection/orchestrator/
├── injection-revision.ts        # Revision 管理器
└── injection-revision.test.ts   # Revision 测试
```

#### 3.2.4 核心代码设计

```typescript
// src/shared/injection/orchestrator/injection-revision.ts

// SPDX-License-Identifier: MPL-2.0

/**
 * # Injection Revision — 注入版本控制
 * 
 * 借鉴 Codex Styler 的 revision 机制：每次 apply 递增 revision，
 * 旧 revision 的响应不能覆盖最新选择。
 */

import type { AgentId } from '../../types/agent';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 注入会话状态 */
export interface InjectionSession {
  /** Agent ID */
  readonly agentId: AgentId;
  /** 当前 revision 号 */
  revision: number;
  /** 当前正在应用的 theme ID */
  applyingThemeId: string | null;
  /** 已应用的 theme ID */
  appliedThemeId: string | null;
  /** 会话创建时间 */
  readonly createdAt: number;
  /** 最后更新时间 */
  updatedAt: number;
}

/** Revision 检查结果 */
export interface RevisionCheckResult {
  /** 是否允许应用 */
  allowed: boolean;
  /** 原因（不允许时） */
  reason?: string;
  /** 当前 revision */
  currentRevision: number;
  /** 请求的 revision */
  requestedRevision: number;
}

// ---------------------------------------------------------------------------
// Revision Manager
// ---------------------------------------------------------------------------

export class InjectionRevisionManager {
  /** Per-agent 会话状态 */
  private readonly sessions = new Map<AgentId, InjectionSession>();

  /** 最大 revision 历史数 */
  private readonly maxHistory: number;

  constructor(maxHistory = 100) {
    this.maxHistory = maxHistory;
  }

  /**
   * 获取或创建会话
   */
  getOrCreateSession(agentId: AgentId): InjectionSession {
    let session = this.sessions.get(agentId);
    if (!session) {
      session = {
        agentId,
        revision: 0,
        applyingThemeId: null,
        appliedThemeId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      this.sessions.set(agentId, session);
    }
    return session;
  }

  /**
   * 开始新的注入操作 — 递增 revision
   */
  beginApply(agentId: AgentId, themeId: string): number {
    const session = this.getOrCreateSession(agentId);
    session.revision++;
    session.applyingThemeId = themeId;
    session.updatedAt = Date.now();
    return session.revision;
  }

  /**
   * 完成注入操作
   */
  completeApply(agentId: AgentId, revision: number): boolean {
    const session = this.sessions.get(agentId);
    if (!session) return false;
    
    // 只有最新 revision 才能标记为已应用
    if (session.revision === revision) {
      session.appliedThemeId = session.applyingThemeId;
      session.applyingThemeId = null;
      session.updatedAt = Date.now();
      return true;
    }
    
    return false; // 旧 revision，忽略
  }

  /**
   * 检查 revision 是否有效
   */
  checkRevision(agentId: AgentId, revision: number): RevisionCheckResult {
    const session = this.sessions.get(agentId);
    if (!session) {
      return {
        allowed: true,
        currentRevision: 0,
        requestedRevision: revision,
      };
    }

    return {
      allowed: session.revision === revision,
      reason: session.revision !== revision
        ? `Revision mismatch: current=${session.revision}, requested=${revision}`
        : undefined,
      currentRevision: session.revision,
      requestedRevision: revision,
    };
  }

  /**
   * 获取当前 revision
   */
  getCurrentRevision(agentId: AgentId): number {
    return this.sessions.get(agentId)?.revision ?? 0;
  }

  /**
   * 获取已应用的 theme ID
   */
  getAppliedThemeId(agentId: AgentId): string | null {
    return this.sessions.get(agentId)?.appliedThemeId ?? null;
  }

  /**
   * 清除会话
   */
  clearSession(agentId: AgentId): void {
    this.sessions.delete(agentId);
  }

  /**
   * 获取诊断摘要
   */
  diagnosticSummary(): Map<AgentId, InjectionSession> {
    return new Map(this.sessions);
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const injectionRevisionManager = new InjectionRevisionManager();
```

#### 3.2.5 集成到 Orchestrator

```typescript
// 修改 src/shared/injection/orchestrator/injection-orchestrator.ts

import { injectionRevisionManager } from './injection-revision';

// 修改 execute 方法
async execute(params: OrchestratorExecuteParams): Promise<InjectionResult> {
  const { agentId, priority = 2 } = params;
  
  // 开始新的 revision
  const revision = injectionRevisionManager.beginApply(
    agentId, 
    params.owner
  );
  
  return this.queues.enqueue(agentId, async () => {
    const result = await this.doExecute(params);
    
    // 只有最新 revision 才能完成
    if (result.success) {
      injectionRevisionManager.completeApply(agentId, revision);
    }
    
    return result;
  }, priority);
}
```

#### 3.2.6 测试策略

```typescript
// src/shared/injection/orchestrator/injection-revision.test.ts

import { describe, it, expect, beforeEach } from 'vitest';
import { InjectionRevisionManager } from './injection-revision';

describe('InjectionRevisionManager', () => {
  let manager: InjectionRevisionManager;

  beforeEach(() => {
    manager = new InjectionRevisionManager();
  });

  it('should increment revision on each beginApply', () => {
    const rev1 = manager.beginApply('doubao', 'theme-a');
    const rev2 = manager.beginApply('doubao', 'theme-b');
    expect(rev2).toBe(rev1 + 1);
  });

  it('should only allow latest revision to complete', () => {
    const rev1 = manager.beginApply('doubao', 'theme-a');
    manager.beginApply('doubao', 'theme-b');
    
    // 旧 revision 不能完成
    const result = manager.completeApply('doubao', rev1);
    expect(result).toBe(false);
    
    // 最新 revision 可以完成
    const result2 = manager.completeApply('doubao', rev1 + 1);
    expect(result2).toBe(true);
  });

  it('should detect revision mismatch', () => {
    manager.beginApply('doubao', 'theme-a');
    manager.beginApply('doubao', 'theme-b');
    
    const check = manager.checkRevision('doubao', 1);
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain('Revision mismatch');
  });
});
```

#### 3.2.7 实施步骤

1. **创建 `injection-revision.ts`** — 实现 Revision 管理器
2. **修改 `injection-orchestrator.ts`** — 集成 revision 到执行流程
3. **修改 `injection-state-machine.ts`** — 在状态转换时记录 revision
4. **编写测试** — 覆盖 revision 递增、完成、冲突检测
5. **更新 UI** — 在诊断页面显示当前 revision

#### 3.2.8 工作量估算

- 核心逻辑：1 天
- 集成到编排器：0.5 天
- 测试：0.5 天
- **总计：2 天**

---

### 方案 1：Scene Model 显式声明（P1 / 高价值）

#### 3.3.1 目标

引入显式的 Scene Model，将当前的 L0-L4 注入层重新建模为 `layers[]` + `entities[]`，使主题作者可声明式控制注入层次。

#### 3.3.2 新增文件

```
src/shared/injection/
├── scene/
│   ├── scene-model.ts           # Scene Model 定义
│   ├── scene-model.test.ts      # Scene Model 测试
│   ├── scene-compiler.ts        # Scene → 注入计划编译
│   └── scene-compiler.test.ts   # 编译器测试
```

#### 3.3.3 核心代码设计

```typescript
// src/shared/injection/scene/scene-model.ts

// SPDX-License-Identifier: MPL-2.0

/**
 * # Scene Model — 显式场景模型
 * 
 * 借鉴 Codex Styler 的 Scene Model 设计，将注入层次显式声明。
 * 主题作者可声明式控制注入层次，编排器根据声明优化注入顺序。
 */

import type { AgentId } from '../../types/agent';
import type { LayerName, EngineName } from '../orchestrator/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 渲染器类型 */
export type SceneRendererType = 'css-variables' | 'structural-css' | 'override-css' | 'image' | 'gradient';

/** 行为类型 */
export type SceneBehaviorType = 
  | 'fade-transition'
  | 'parallax'
  | 'self-heal'
  | 'reduce-motion-fallback';

/** 场景层声明 */
export interface SceneLayer {
  /** 层唯一标识 */
  id: string;
  /** 层类型 */
  type: SceneRendererType;
  /** 负责的引擎 */
  engine: EngineName;
  /** CSS 层名 */
  layer: LayerName;
  /** 渲染优先级（z-index 概念，数值越大越在上层） */
  zIndex: number;
  /** 行为列表 */
  behaviors?: SceneBehaviorType[];
  /** 条件表达式（可选，决定是否启用此层） */
  condition?: string;
}

/** 场景实体声明 */
export interface SceneEntity {
  /** 实体唯一标识 */
  id: string;
  /** 渲染器类型 */
  renderer: SceneRendererType;
  /** 资源 URL（图片/渐变等） */
  src?: string;
  /** 锚点位置 */
  anchor?: { x: string; y: string };
  /** 附件目标 */
  attachment?: {
    target: 'composer' | 'main-surface' | 'thread-summary';
    edge: 'top' | 'bottom' | 'left' | 'right';
    offset?: number;
  };
  /** 行为列表 */
  behaviors?: SceneBehaviorType[];
  /** 透明度 */
  opacity?: number;
}

/** 完整场景声明 */
export interface SceneDeclaration {
  /** 场景版本 */
  version: '1.0';
  /** 层列表（按 z-index 排序） */
  layers: SceneLayer[];
  /** 实体列表 */
  entities: SceneEntity[];
}

// ---------------------------------------------------------------------------
// Default Scene
// ---------------------------------------------------------------------------

/** 默认场景 — 对应现有的 L0-L4 注入层 */
export const DEFAULT_SCENE: SceneDeclaration = {
  version: '1.0',
  layers: [
    {
      id: 'palette',
      type: 'css-variables',
      engine: 'engine-strategy',
      layer: 'palette',
      zIndex: 0,
      behaviors: ['fade-transition'],
    },
    {
      id: 'tokens',
      type: 'css-variables',
      engine: 'engine-strategy',
      layer: 'tokens',
      zIndex: 1,
    },
    {
      id: 'cosmetic',
      type: 'css-variables',
      engine: 'engine-strategy',
      layer: 'cosmetic',
      zIndex: 2,
    },
    {
      id: 'theme',
      type: 'css-variables',
      engine: 'engine-strategy',
      layer: 'theme',
      zIndex: 3,
    },
    {
      id: 'custom',
      type: 'css-variables',
      engine: 'engine-strategy',
      layer: 'custom',
      zIndex: 4,
    },
    {
      id: 'adapter',
      type: 'structural-css',
      engine: 'adapter-mjs',
      layer: 'adapter',
      zIndex: 10,
      behaviors: ['self-heal'],
    },
    {
      id: 'dynamic-overrides',
      type: 'override-css',
      engine: 'hybrid-injector',
      layer: 'dynamic-overrides',
      zIndex: 20,
    },
    {
      id: 'deep-core',
      type: 'structural-css',
      engine: 'deep-core',
      layer: 'deep-core',
      zIndex: 30,
    },
  ],
  entities: [],
};

// ---------------------------------------------------------------------------
// Scene Compiler
// ---------------------------------------------------------------------------

/** 编译后的注入计划 */
export interface CompiledInjectionPlan {
  /** 按引擎分组的注入步骤 */
  steps: InjectionStep[];
  /** 依赖关系图 */
  dependencies: Map<string, string[]>;
}

/** 单个注入步骤 */
export interface InjectionStep {
  /** 步骤 ID */
  id: string;
  /** 目标引擎 */
  engine: EngineName;
  /** 目标层 */
  layer: LayerName;
  /** 依赖的步骤 IDs */
  dependsOn: string[];
}

/**
 * 将场景声明编译为注入计划
 */
export function compileSceneToInjectionPlan(
  scene: SceneDeclaration,
): CompiledInjectionPlan {
  const steps: InjectionStep[] = [];
  const dependencies = new Map<string, string[]>();

  // 按 z-index 排序层
  const sortedLayers = [...scene.layers].sort((a, b) => a.zIndex - b.zIndex);

  for (const layer of sortedLayers) {
    const step: InjectionStep = {
      id: layer.id,
      engine: layer.engine,
      layer: layer.layer,
      dependsOn: [],
    };

    // 同引擎的前置层作为依赖
    const prevLayers = sortedLayers.filter(
      (l) => l.engine === layer.engine && l.zIndex < layer.zIndex,
    );
    step.dependsOn = prevLayers.map((l) => l.id);

    steps.push(step);
    dependencies.set(layer.id, step.dependsOn);
  }

  return { steps, dependencies };
}
```

#### 3.3.4 测试策略

```typescript
// src/shared/injection/scene/scene-model.test.ts

import { describe, it, expect } from 'vitest';
import { DEFAULT_SCENE, compileSceneToInjectionPlan } from './scene-model';

describe('SceneModel', () => {
  it('should have 8 layers in default scene', () => {
    expect(DEFAULT_SCENE.layers).toHaveLength(8);
  });

  it('should compile to ordered injection plan', () => {
    const plan = compileSceneToInjectionPlan(DEFAULT_SCENE);
    
    // 验证步骤按 z-index 排序
    for (let i = 1; i < plan.steps.length; i++) {
      const prev = DEFAULT_SCENE.layers.find(l => l.id === plan.steps[i - 1].id)!;
      const curr = DEFAULT_SCENE.layers.find(l => l.id === plan.steps[i].id)!;
      expect(curr.zIndex).toBeGreaterThanOrEqual(prev.zIndex);
    }
  });

  it('should establish correct dependencies', () => {
    const plan = compileSceneToInjectionPlan(DEFAULT_SCENE);
    
    // adapter 层没有同引擎的前置层
    const adapterStep = plan.steps.find(s => s.id === 'adapter')!;
    expect(adapterStep.dependsOn).toHaveLength(0);
    
    // tokens 层依赖 palette
    const tokensStep = plan.steps.find(s => s.id === 'tokens')!;
    expect(tokensStep.dependsOn).toContain('palette');
  });
});
```

#### 3.3.5 工作量估算

- Scene Model 定义：1 天
- 编译器实现：2 天
- 集成到编排器：2 天
- 测试：1 天
- **总计：6 天**

---

### 方案 2：语义色板映射层（P1 / 高价值）

#### 3.4.1 目标

在 14 token 之上增加"语义角色"层，引入"语义角色→目标 token"映射机制，使主题作者使用稳定角色名，不同 Agent 版本可映射到不同 token。

#### 3.4.2 新增文件

```
src/shared/injection/
├── semantic/
│   ├── semantic-roles.ts        # 语义角色定义
│   ├── semantic-roles.test.ts   # 角色测试
│   ├── role-mapper.ts           # 角色→Token 映射器
│   └── role-mapper.test.ts      # 映射器测试
```

#### 3.4.3 核心代码设计

```typescript
// src/shared/injection/semantic/semantic-roles.ts

// SPDX-License-Identifier: MPL-2.0

/**
 * # Semantic Roles — 语义角色系统
 * 
 * 借鉴 Codex Styler 的 Semantic Color Palette 设计，
 * 在 14 token 之上增加稳定的语义角色层。
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 5 个核心语义角色（对应 Codex Styler 的源色板） */
export type CoreSemanticRole = 'accent' | 'surface' | 'text' | 'mutedText' | 'border';

/** 扩展语义角色（高级主题使用） */
export type ExtendedSemanticRole =
  | 'canvas'
  | 'raised'
  | 'overlay'
  | 'sunken'
  | 'control'
  | 'tertiaryText'
  | 'focus'
  | 'borderStrong'
  | 'success'
  | 'warning'
  | 'danger';

export type SemanticRole = CoreSemanticRole | ExtendedSemanticRole;

/** 角色定义 */
export interface RoleDefinition {
  /** 角色名 */
  name: SemanticRole;
  /** 默认 token（CSS 变量名） */
  defaultToken: string;
  /** 回退值 */
  fallbackValue: string;
  /** 是否为核心角色 */
  isCore: boolean;
}

// ---------------------------------------------------------------------------
// Core Roles（5 个必需角色）
// ---------------------------------------------------------------------------

export const CORE_ROLES: Record<CoreSemanticRole, RoleDefinition> = {
  accent: {
    name: 'accent',
    defaultToken: '--agentskin-accent',
    fallbackValue: '#3B82F6',
    isCore: true,
  },
  surface: {
    name: 'surface',
    defaultToken: '--agentskin-surface',
    fallbackValue: '#FFFFFF',
    isCore: true,
  },
  text: {
    name: 'text',
    defaultToken: '--agentskin-text',
    fallbackValue: '#1F2937',
    isCore: true,
  },
  mutedText: {
    name: 'mutedText',
    defaultToken: '--agentskin-muted',
    fallbackValue: '#6B7280',
    isCore: true,
  },
  border: {
    name: 'border',
    defaultToken: '--agentskin-border',
    fallbackValue: '#E5E7EB',
    isCore: true,
  },
};

// ---------------------------------------------------------------------------
// Extended Roles（可选角色）
// ---------------------------------------------------------------------------

export const EXTENDED_ROLES: Record<ExtendedSemanticRole, RoleDefinition> = {
  canvas: {
    name: 'canvas',
    defaultToken: '--agentskin-canvas',
    fallbackValue: '#F9FAFB',
    isCore: false,
  },
  raised: {
    name: 'raised',
    defaultToken: '--agentskin-surface-raised',
    fallbackValue: '#FFFFFF',
    isCore: false,
  },
  overlay: {
    name: 'overlay',
    defaultToken: '--agentskin-overlay',
    fallbackValue: 'rgba(0,0,0,0.5)',
    isCore: false,
  },
  sunken: {
    name: 'sunken',
    defaultToken: '--agentskin-surface-sunken',
    fallbackValue: '#F3F4F6',
    isCore: false,
  },
  control: {
    name: 'control',
    defaultToken: '--agentskin-control',
    fallbackValue: '#FFFFFF',
    isCore: false,
  },
  tertiaryText: {
    name: 'tertiaryText',
    defaultToken: '--agentskin-text-tertiary',
    fallbackValue: '#9CA3AF',
    isCore: false,
  },
  focus: {
    name: 'focus',
    defaultToken: '--agentskin-focus',
    fallbackValue: '#3B82F6',
    isCore: false,
  },
  borderStrong: {
    name: 'borderStrong',
    defaultToken: '--agentskin-border-strong',
    fallbackValue: '#D1D5DB',
    isCore: false,
  },
  success: {
    name: 'success',
    defaultToken: '--agentskin-success',
    fallbackValue: '#10B981',
    isCore: false,
  },
  warning: {
    name: 'warning',
    defaultToken: '--agentskin-warning',
    fallbackValue: '#F59E0B',
    isCore: false,
  },
  danger: {
    name: 'danger',
    defaultToken: '--agentskin-danger',
    fallbackValue: '#EF4444',
    isCore: false,
  },
};

// ---------------------------------------------------------------------------
// Role Mapper
// ---------------------------------------------------------------------------

/** 版本化适配器映射 */
export interface AdapterRoleMapping {
  /** 适配器版本 */
  version: string;
  /** 角色→Token 映射 */
  mappings: Partial<Record<SemanticRole, string>>;
}

/**
 * 角色映射器 — 将语义角色解析为实际 CSS 变量
 */
export class RoleMapper {
  private readonly customMappings: Map<string, AdapterRoleMapping> = new Map();

  /**
   * 注册自定义映射
   */
  registerMapping(agentId: string, mapping: AdapterRoleMapping): void {
    this.customMappings.set(agentId, mapping);
  }

  /**
   * 解析角色为 CSS 变量名
   */
  resolveToken(agentId: string, role: SemanticRole): string {
    // 1. 检查自定义映射
    const customMapping = this.customMappings.get(agentId);
    if (customMapping?.mappings[role]) {
      return customMapping.mappings[role]!;
    }

    // 2. 使用默认映射
    const coreDef = CORE_ROLES[role as CoreSemanticRole];
    if (coreDef) return coreDef.defaultToken;

    const extDef = EXTENDED_ROLES[role as ExtendedSemanticRole];
    if (extDef) return extDef.defaultToken;

    // 3. 回退
    return `--agentskin-${role}`;
  }

  /**
   * 获取角色的回退值
   */
  getFallbackValue(role: SemanticRole): string {
    const coreDef = CORE_ROLES[role as CoreSemanticRole];
    if (coreDef) return coreDef.fallbackValue;

    const extDef = EXTENDED_ROLES[role as ExtendedSemanticRole];
    if (extDef) return extDef.fallbackValue;

    return '';
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const roleMapper = new RoleMapper();
```

#### 3.4.4 工作量估算

- 语义角色定义：1 天
- 角色映射器：1 天
- 集成到主题系统：2 天
- 测试：1 天
- **总计：5 天**

---

### 方案 5：主题包验证强化（P2 / 中等价值）

#### 3.5.1 目标

增加导入时的严格限制：大小限制、文件类型白名单、magic bytes 检查。

#### 3.5.2 新增文件

```
src/shared/import/
├── package-limits.ts            # 包限制常量
├── package-validator.ts         # 增强验证器
└── package-validator.test.ts    # 验证器测试
```

#### 3.5.3 核心代码设计

```typescript
// src/shared/import/package-limits.ts

// SPDX-License-Identifier: MPL-2.0

/**
 * # Package Limits — 主题包限制常量
 * 
 * 借鉴 Codex Styler 的严格包限制：
 * - 50 MiB 压缩归档
 * - 100 MiB 解压总计
 * - 20 MiB 单文件
 * - 8192×8192 单图
 * - 最多 32 个声明资产
 */

export const PACKAGE_LIMITS = {
  /** 压缩归档最大大小 (50 MiB) */
  compressedSize: 50 * 1024 * 1024,
  /** 解压后总大小最大 (100 MiB) */
  extractedSize: 100 * 1024 * 1024,
  /** 单文件最大大小 (20 MiB) */
  fileSize: 20 * 1024 * 1024,
  /** 图片最大尺寸 (8192×8192) */
  maxDimension: 8192,
  /** 最大资产声明数 */
  maxAssets: 32,
  /** 允许的图片 MIME 类型 */
  allowedImageTypes: ['image/png', 'image/jpeg', 'image/webp'] as const,
  /** 禁止的文件类型 */
  forbiddenTypes: [
    'text/css',
    'application/javascript',
    'application/x-javascript',
    'image/svg+xml',
    'application/x-font-ttf',
    'application/x-font-otf',
    'video/mp4',
    'video/webm',
  ] as const,
  /** 禁止的扩展名 */
  forbiddenExtensions: ['.css', '.js', '.mjs', '.svg', '.ttf', '.otf', '.woff', '.mp4', '.webm'] as const,
} as const;

/** Magic bytes 签名验证 */
export const MAGIC_BYTES: Record<string, number[]> = {
  png: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
  jpeg: [0xFF, 0xD8, 0xFF],
  webp: [0x52, 0x49, 0x46, 0x46], // RIFF header
  zip: [0x50, 0x4B, 0x03, 0x04],
};
```

```typescript
// src/shared/import/package-validator.ts

// SPDX-License-Identifier: MPL-2.0

/**
 * # Package Validator — 增强主题包验证器
 * 
 * 在 security-scanner.ts 基础上增加：
 * - 大小限制检查
 * - Magic bytes 验证
 * - 文件类型白名单
 */

import { PACKAGE_LIMITS, MAGIC_BYTES } from './package-limits';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface FileEntry {
  path: string;
  content: Uint8Array;
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

export function validatePackage(
  files: FileEntry[],
  compressedSize: number,
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. 压缩大小检查
  if (compressedSize > PACKAGE_LIMITS.compressedSize) {
    errors.push(
      `Compressed size ${compressedSize} exceeds limit ${PACKAGE_LIMITS.compressedSize}`,
    );
  }

  // 2. 解压总大小检查
  const totalSize = files.reduce((sum, f) => sum + f.content.length, 0);
  if (totalSize > PACKAGE_LIMITS.extractedSize) {
    errors.push(
      `Extracted size ${totalSize} exceeds limit ${PACKAGE_LIMITS.extractedSize}`,
    );
  }

  // 3. 资产数量检查
  const assetFiles = files.filter(f => isAssetFile(f.path));
  if (assetFiles.length > PACKAGE_LIMITS.maxAssets) {
    errors.push(
      `Asset count ${assetFiles.length} exceeds limit ${PACKAGE_LIMITS.maxAssets}`,
    );
  }

  // 4. 逐文件检查
  for (const file of files) {
    // 单文件大小
    if (file.content.length > PACKAGE_LIMITS.fileSize) {
      errors.push(
        `File ${file.path} size ${file.content.length} exceeds limit ${PACKAGE_LIMITS.fileSize}`,
      );
    }

    // 禁止扩展名
    if (isForbiddenExtension(file.path)) {
      errors.push(`File ${file.path} has forbidden extension`);
    }

    // Magic bytes 验证（图片文件）
    if (isImageFile(file.path)) {
      const magicResult = validateMagicBytes(file.content);
      if (!magicResult.valid) {
        errors.push(`File ${file.path}: ${magicResult.error}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

function isAssetFile(path: string): boolean {
  return /\/(assets|previews)\//.test(path);
}

function isImageFile(path: string): boolean {
  return /\.(png|jpg|jpeg|webp)$/i.test(path);
}

function isForbiddenExtension(path: string): boolean {
  const ext = path.toLowerCase().slice(path.lastIndexOf('.'));
  return (PACKAGE_LIMITS.forbiddenExtensions as readonly string[]).includes(ext);
}

function validateMagicBytes(content: Uint8Array): { valid: boolean; error?: string } {
  // PNG
  if (matchesMagic(content, MAGIC_BYTES.png)) return { valid: true };
  // JPEG
  if (matchesMagic(content, MAGIC_BYTES.jpeg)) return { valid: true };
  // WebP (RIFF header)
  if (matchesMagic(content, MAGIC_BYTES.webp)) return { valid: true };

  return { valid: false, error: 'Invalid image magic bytes' };
}

function matchesMagic(content: number[] | Uint8Array, magic: number[]): boolean {
  for (let i = 0; i < magic.length; i++) {
    if (content[i] !== magic[i]) return false;
  }
  return true;
}
```

#### 3.5.4 工作量估算

- 限制常量定义：0.5 天
- 验证器实现：1 天
- 集成到导入流程：0.5 天
- 测试：0.5 天
- **总计：2.5 天**

---

### 方案 6：诊断导出系统（P2 / 中等价值）

#### 3.6.1 目标

实现结构化诊断报告导出，排除敏感信息，便于问题排查。

#### 3.6.2 新增文件

```
src/main/cdp/diagnostics/
├── diagnostics-exporter.ts      # 诊断导出器
└── diagnostics-exporter.test.ts # 导出器测试
```

#### 3.6.3 核心代码设计

```typescript
// src/main/cdp/diagnostics/diagnostics-exporter.ts

// SPDX-License-Identifier: MPL-2.0

/**
 * # Diagnostics Exporter — 诊断导出器
 * 
 * 借鉴 Codex Styler 的诊断导出设计：
 * - 本地检查安装发现、CDP 状态、适配器结果
 * - 导出诊断报告（排除敏感信息）
 */

import type { AgentId } from '../../../shared/types';
import { injectionStateMachine } from '../../../shared/injection/orchestrator';
import { injectionHealthMonitor } from '../injection/health-monitor';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiagnosticsReport {
  /** 报告生成时间 */
  timestamp: string;
  /** AgentSkin 版本 */
  version: string;
  /** 应用安装状态 */
  installation: {
    detected: boolean;
    path?: string;
    version?: string;
  }[];
  /** CDP 连接状态 */
  cdp: {
    connected: boolean;
    port?: number;
    targetValid?: boolean;
  }[];
  /** 注入适配器状态 */
  adapter: {
    agentId: AgentId;
    state: string;
    mode: string;
    lastHealthCheck?: {
      healthy: boolean;
      driftCount: number;
      missingCount: number;
    };
  }[];
  /** 恢复可用性 */
  recovery: {
    available: boolean;
    lastAction?: string;
  };
}

// ---------------------------------------------------------------------------
// Exporter
// ---------------------------------------------------------------------------

/**
 * 生成诊断报告
 */
export function generateDiagnosticsReport(
  agentIds: AgentId[],
  appVersion: string,
): DiagnosticsReport {
  const adapterStatuses = agentIds.map((agentId) => {
    const snapshot = injectionStateMachine.getSnapshot(agentId);
    const healthResult = injectionHealthMonitor.getLastResult(agentId);

    return {
      agentId,
      state: snapshot.state,
      mode: 'enhanced', // TODO: 从兼容性策略获取
      lastHealthCheck: healthResult
        ? {
            healthy: healthResult.healthy,
            driftCount: healthResult.drift.length,
            missingCount: healthResult.missing.length,
          }
        : undefined,
    };
  });

  return {
    timestamp: new Date().toISOString(),
    version: appVersion,
    installation: [], // 由调用者填充
    cdp: [], // 由调用者填充
    adapter: adapterStatuses,
    recovery: {
      available: true,
    },
  };
}

/**
 * 导出为 JSON Blob
 */
export function exportDiagnosticsToBlob(report: DiagnosticsReport): Blob {
  return new Blob([JSON.stringify(report, null, 2)], {
    type: 'application/json',
  });
}
```

#### 3.6.4 工作量估算

- 诊断导出器：1 天
- UI 集成：0.5 天
- 测试：0.5 天
- **总计：2 天**

---

### 方案 3：Shell Treatment 维度（P3 / 中等价值）

#### 3.7.1 目标

新增 layout/iconStyle/decorations 控制，在不影响功能的前提下提供更丰富的视觉变化。

#### 3.7.2 新增文件

```
src/shared/injection/
├── shell/
│   ├── shell-treatment.ts       # Shell Treatment 定义
│   └── shell-treatment.test.ts  # 测试
```

#### 3.7.3 核心代码设计

```typescript
// src/shared/injection/shell/shell-treatment.ts

// SPDX-License-Identifier: MPL-2.0

/**
 * # Shell Treatment — 外壳视觉治疗
 * 
 * 借鉴 Codex Styler 的 Shell Treatment 设计：
 * - layout: native / editorial / immersive
 * - iconStyle: native / contained / theme-owned
 * - decorations: none / subtle / expressive
 * 
 * 不改变信息架构或交互语义，只提供视觉变化。
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 布局密度 */
export type LayoutDensity = 'native' | 'editorial' | 'immersive';

/** 图标风格 */
export type IconStyle = 'native' | 'contained' | 'theme-owned';

/** 装饰级别 */
export type DecorationLevel = 'none' | 'subtle' | 'expressive';

/** Shell Treatment 配置 */
export interface ShellTreatment {
  layout: LayoutDensity;
  iconStyle: IconStyle;
  decorations: DecorationLevel;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

export const DEFAULT_SHELL_TREATMENT: ShellTreatment = {
  layout: 'native',
  iconStyle: 'native',
  decorations: 'none',
};

// ---------------------------------------------------------------------------
// CSS Generation
// ---------------------------------------------------------------------------

/**
 * 根据 Shell Treatment 生成 CSS 变量覆盖
 */
export function generateShellCss(treatment: ShellTreatment): Record<string, string> {
  const vars: Record<string, string> = {};

  // Layout density
  switch (treatment.layout) {
    case 'editorial':
      vars['--agentskin-content-max-width'] = '900px';
      vars['--agentskin-content-padding'] = '2rem';
      break;
    case 'immersive':
      vars['--agentskin-content-max-width'] = '100%';
      vars['--agentskin-content-padding'] = '0';
      break;
    case 'native':
    default:
      // 使用应用默认值
      break;
  }

  // Icon style
  switch (treatment.iconStyle) {
    case 'contained':
      vars['--agentskin-icon-bg'] = 'var(--agentskin-surface-raised)';
      vars['--agentskin-icon-radius'] = '8px';
      break;
    case 'theme-owned':
      vars['--agentskin-icon-color'] = 'var(--agentskin-accent)';
      break;
    case 'native':
    default:
      break;
  }

  // Decorations
  switch (treatment.decorations) {
    case 'subtle':
      vars['--agentskin-decoration-opacity'] = '0.1';
      break;
    case 'expressive':
      vars['--agentskin-decoration-opacity'] = '0.3';
      break;
    case 'none':
    default:
      vars['--agentskin-decoration-opacity'] = '0';
      break;
  }

  return vars;
}
```

#### 3.7.4 工作量估算

- Shell Treatment 定义：0.5 天
- CSS 生成器：1 天
- 集成到主题系统：1 天
- 测试：0.5 天
- **总计：3 天**

---

## 四、实施优先级与路线图

### 4.1 优先级矩阵

| 优先级 | 方案 | 价值 | 工作量 | 风险 | 建议时间 |
|--------|------|------|--------|------|----------|
| **P0** | 方案 4：兼容性策略分级 | 高 | 4.5 天 | 低 | 第 1 周 |
| **P0** | 方案 7：生命周期 revision | 高 | 2 天 | 低 | 第 1 周 |
| **P1** | 方案 1：Scene Model | 高 | 6 天 | 中 | 第 2-3 周 |
| **P1** | 方案 2：语义色板映射 | 高 | 5 天 | 中 | 第 2-3 周 |
| **P2** | 方案 5：包验证强化 | 中 | 2.5 天 | 低 | 第 4 周 |
| **P2** | 方案 6：诊断导出 | 中 | 2 天 | 低 | 第 4 周 |
| **P3** | 方案 3：Shell Treatment | 中 | 3 天 | 低 | 第 5 周 |

### 4.2 总工作量估算

- **P0 方案**：6.5 天
- **P1 方案**：11 天
- **P2 方案**：4.5 天
- **P3 方案**：3 天
- **总计**：25 天（约 5 周）

### 4.3 建议实施顺序

1. **第 1 周**：方案 4 + 方案 7（基础鲁棒性）
2. **第 2-3 周**：方案 1 + 方案 2（核心架构升级）
3. **第 4 周**：方案 5 + 方案 6（安全与维护性）
4. **第 5 周**：方案 3（视觉增强）

---

## 五、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| Scene Model 重构导致现有主题不兼容 | 高 | 保留默认场景作为回退，渐进式迁移 |
| 语义色板映射引入额外复杂度 | 中 | 默认映射覆盖 14 token，扩展映射可选 |
| 兼容性策略误判导致注入失败 | 中 | 提供手动覆盖选项，诊断页面显示决策原因 |
| Revision 机制导致并发问题 | 低 | 仅在单 agent 内序列化，跨 agent 无影响 |

---

## 六、测试策略

### 6.1 单元测试

每个方案都包含对应的 `.test.ts` 文件，覆盖：
- 核心逻辑的正确性
- 边界条件
- 错误处理

### 6.2 集成测试

- 方案 4 + 7：验证策略决策与 revision 机制的协同
- 方案 1 + 2：验证 Scene Model 与语义色板映射的协同

### 6.3 回归测试

- 确保现有 765+ UI 测试全部通过
- 确保现有 4485+ main 测试全部通过

---

## 七、总结

本实施方案从 Codex Styler 学习了 7 个核心设计洞察，结合 AgentSkin 现有架构，提出了具体、可实施的方案。

**核心价值**：
1. **鲁棒性提升**：兼容性策略分级 + revision 机制使注入更稳定
2. **可维护性提升**：Scene Model 显式声明 + 语义色板映射使架构更清晰
3. **安全性提升**：包验证强化 + 诊断导出使系统更安全
4. **视觉质量提升**：Shell Treatment 提供更多视觉变化维度

**建议优先实施方案 4 和方案 7**，这两个方案价值高、工作量低、风险小，可以显著提升 AgentSkin 的鲁棒性。
