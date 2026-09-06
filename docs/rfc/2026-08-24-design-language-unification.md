# RFC: Design Language 统一

| Field | Value |
|-------|-------|
| 状态 | 待评审 |
| 日期 | 2026-08-24 |
| 分支 | — |
| 范围 | `src/ui/stores/themeStore.ts`, `src/ui/stores/settingsStore.ts`, `src/ui/stores/workspaceStore.ts`（拆分后 tweakStore）, `src/shared/types/override.ts` |
| 关联 RFC | `docs/rfc/2026-08-24-workspace-store-split.md`（workspaceStore 拆分）, `docs/rfc/design-language-token-extension.md`（历史方案） |

---

## 1. 背景与目标

### 1.1 现状痛点

**Design Language 三套马车**：当前 Design Language 被拆成 3 个 Store 的 4 种数据结构，各自独立演进：

| 存储位置 | 数据结构 | 持久化方式 | 消费路径 |
|----------|---------|-----------|---------|
| `themeStore.designLanguage` | `DesignLanguageConfig` | 主题 manifest 内嵌 | Studio UI + 生成 CSS |
| `settingsStore.radiusScale` | `RadiusScale` | localStorage (`agentskin.radiusScale`) | UI shell CSS 变量 |
| `settingsStore.density` | `Density` | localStorage (`agentskin.density`) | UI shell CSS 变量 |
| `settingsStore.motion` | `Motion` | localStorage (`agentskin.motion`) | UI shell CSS 变量 |
| `workspaceStore.currentOverrides` | `ToolOverride` | localStorage (`workspace.overridesByAgent`) | Tweak 实时 push |

导致问题：

1. **概念分裂**：`radius.scale` 在 `DesignLanguageConfig` 中是 `'0' | '2' | '4' | '8'`，在 `settingsStore` 中是同名 `RadiusScale`，在 `ToolOverride` 中是 `string`（`radius?` 字段）——同一概念有三种类型定义；
2. **持久化冲突**：`settingsStore.radiusScale` 写入 localStorage key `agentskin.radiusScale`，`themeStore.designLanguage.radius.scale` 写入主题 manifest JSON，`workspaceStore.currentOverrides.radius` 写入 `workspace.overridesByAgent`——三种持久化路径无优先级约定；
3. **消费路径混乱**：Studio 预览区消费 `currentOverrides.radius`，UI shell 消费 `settingsStore.radiusScale`，主题 CSS 消费 `designLanguage.radius.scale`——同一维度三处生效范围不同；
4. **优先级不明确**：当三者同时存在时，哪个生效？当前是"各自管各自的"，用户修改 `settingsStore.radiusScale` 不会影响 `themeStore.designLanguage`，导致用户困惑。

### 1.2 目标

1. 统一 Design Language 为单一 `DesignLanguageConfig` 类型，作为全仓库 Design Language 的唯一真相源；
2. 建立清晰的优先级链：manifest 默认值 → 用户偏好覆盖 → 实时 tweak 覆盖；
3. 统一持久化路径：用户偏好和实时 tweak 合并存储，消除三套 localStorage key；
4. 统一消费路径：一个 selector 返回完整 Design Language 状态，所有消费方通过此 selector 获取数据。

### 1.3 非目标

- 不修改 14-token 主题契约（`colors` 结构不变）；
- 不重构注入架构（L0-L4 层）；
- 不新增 UI 页面；
- 不修改 manifest schema（`designLanguageConfig` 字段已存在）；
- 不实现新的 Design Language 维度（如新增 `grain`、`texture` 等）；
- 不改变 UI shell 的 CSS 变量注入机制（`--agentskin-radius-scale` 等变量名不变）。

---

## 2. 触发条件（对照 AGENTS.md §6）

- [ ] 重构注入架构（L0-L4 注入层）—— **否**
- [ ] 新增 UI 页面（突破六页封顶）—— **否**
- [ ] 新增适配器（突破六适配器上限）—— **否
- [x] 修改核心数据模型（manifest schema、14-token 契约等）—— **部分涉及**：`DesignLanguageConfig` 类型扩展，但不修改 14-token 契约本身

**结论**：本次变更涉及核心数据模型（`DesignLanguageConfig`）的类型扩展和语义统一，触发 AGENTS.md §6 的 RFC 条件，需评审后实施。

---

## 3. 现状侦察（代码锚点）

### 3.1 三种数据结构字段对比

| 维度 | `DesignLanguageConfig` (themeStore) | `RadiusScale/Density/Motion` (settingsStore) | `ToolOverride` (workspaceStore) |
|------|-------------------------------------|---------------------------------------------|--------------------------------|
| **radius** | `radius?: { scale?: '0' \| '2' \| '4' \| '8' }` | `radiusScale: RadiusScale` (`'0' \| '2' \| '4' \| '8'`) | `radius?: string` |
| **spacing/density** | `spacing?: { density?: 'compact' \| 'comfortable' \| 'cozy' }` | `density: Density` (`'compact' \| 'comfortable' \| 'cozy'`) | `spacing?: number` |
| **motion** | `motion?: { speed?: 'instant' \| 'fast' \| 'smooth' }` | `motion: Motion` (`'full' \| 'reduced' \| 'none'`) | `duration?: string`, `timing?: string` |
| **shadow** | `shadow?: { elevation?: 'flat' \| 'subtle' \| 'float' }` | — | `shadowLevel?: 'none' \| 'sm' \| 'md' \| 'lg' \| 'xl'` |

### 3.2 持久化路径对比

| 维度 | 当前持久化 | key | 格式 |
|------|-----------|-----|------|
| themeStore.designLanguage | 主题 manifest 文件 | `*.agenttheme/designLanguageConfig` | JSON 内嵌 |
| settingsStore.radiusScale | localStorage | `agentskin.radiusScale` | 字符串 `'2'` |
| settingsStore.density | localStorage | `agentskin.density` | 字符串 `'comfortable'` |
| settingsStore.motion | localStorage | `agentskin.motion` | 字符串 `'full'` |
| workspaceStore.currentOverrides | localStorage | `workspace.overridesByAgent` | JSON `{ _version: 1, data: {...} }` |

### 3.3 消费路径对比

| 消费方 | 当前数据来源 | 获取方式 |
|--------|-------------|---------|
| Studio 预览区 CSS 生成 | `themeStore.designLanguage` | `useThemeStore((s) => s.designLanguage)` |
| UI shell CSS 变量 | `settingsStore.radiusScale/density/motion` | `useSettingsStore((s) => s.radiusScale)` 等 |
| TweakPanel slider 值 | `workspaceStore.currentOverrides` | `useWorkspaceStore((s) => s.currentOverrides)` |
| 主题 CSS 生成器 | `themeStore.designLanguage` | `useThemeStore.getState().designLanguage` |
| Raw CSS 编辑器 | `workspaceStore.currentOverrides` | `useWorkspaceStore((s) => s.currentOverrides)` |

### 3.4 类型定义锚点

| 类型 | 文件 | 行号 |
|------|------|------|
| `DesignLanguageConfig` | `src/ui/stores/themeStore.ts` | L201-206 |
| `RadiusScale` | `src/ui/stores/settingsStore.ts` | L34 |
| `Density` | `src/ui/stores/settingsStore.ts` | L37 |
| `Motion` | `src/ui/stores/settingsStore.ts` | L40 |
| `ToolOverride` | `src/shared/types/override.ts` | L9-42 |

---

## 4. 设计方案

### 4.1 统一类型定义

将 `DesignLanguageConfig` 扩展为完整的 Design Language 类型，覆盖当前三套数据结构的全部维度：

```ts
// src/shared/types/design-language.ts（新建，从 themeStore 提取）
export interface DesignLanguageConfig {
  /** 圆角缩放（UI shell + 预览区统一） */
  radius?: { scale?: '0' | '2' | '4' | '8' };
  /** 间距密度（UI shell + 预览区统一） */
  spacing?: { density?: 'compact' | 'comfortable' | 'cozy' };
  /** 阴影高度（预览区） */
  shadow?: { elevation?: 'flat' | 'subtle' | 'float' };
  /** 动效速度（UI shell + 预览区统一） */
  motion?: { speed?: 'instant' | 'fast' | 'smooth' };
}
```

**类型映射关系**：

| 来源 | 映射到 DesignLanguageConfig |
|------|---------------------------|
| `settingsStore.radiusScale` | `designLanguage.radius.scale` |
| `settingsStore.density` | `designLanguage.spacing.density` |
| `settingsStore.motion` | `designLanguage.motion.speed`（需值映射：`'full'→'fast'`, `'reduced'→'instant'`, `'none'→'instant'`） |
| `workspaceStore.currentOverrides.radius` | `designLanguage.radius.scale`（string → 枚举） |
| `workspaceStore.currentOverrides.spacing` | `designLanguage.spacing.density`（number → 枚举） |
| `workspaceStore.currentOverrides.shadowLevel` | `designLanguage.shadow.elevation`（需值映射） |
| `workspaceStore.currentOverrides.duration` | `designLanguage.motion.speed`（需值映射） |

### 4.2 优先级链

建立三层优先级，高优先级覆盖低优先级：

```
┌─────────────────────────────────────────────────────────┐
│  Layer 3: 实时 Tweak（最高优先级）                        │
│  tweakStore.currentOverrides → ToolOverride              │
│  用户拖动 slider 时实时生效，不持久化到 manifest          │
├─────────────────────────────────────────────────────────┤
│  Layer 2: 用户偏好（中优先级）                            │
│  settingsStore → DesignLanguageConfig                    │
│  持久化到 localStorage，跨主题生效                        │
├─────────────────────────────────────────────────────────┤
│  Layer 1: 主题默认（最低优先级）                          │
│  themeStore.designLanguage → DesignLanguageConfig        │
│  来自主题 manifest，随主题切换变化                        │
└─────────────────────────────────────────────────────────┘
```

**Selector 设计**：

```ts
// 统一 selector：返回当前生效的 DesignLanguage
function selectEffectiveDesignLanguage(state: CombinedState): DesignLanguageConfig {
  const manifest = state.theme.designLanguage;       // Layer 1
  const preference = state.settings.designLanguage;   // Layer 2
  const tweak = state.tweak.currentOverrides;        // Layer 3

  return {
    radius: { scale: tweak.radius ?? preference.radius?.scale ?? manifest.radius?.scale },
    spacing: { density: mapSpacingToDensity(tweak.spacing) ?? preference.spacing?.density ?? manifest.spacing?.density },
    shadow: { elevation: mapShadowToElevation(tweak.shadowLevel) ?? manifest.shadow?.elevation },
    motion: { speed: mapDurationToSpeed(tweak.duration) ?? preference.motion?.speed ?? manifest.motion?.speed },
  };
}
```

### 4.3 统一持久化

合并三套持久化为单一 key：

| 当前 key | 新 key | 格式 |
|----------|--------|------|
| `agentskin.radiusScale` + `agentskin.density` + `agentskin.motion` | `agentskin.designLanguage` | JSON `DesignLanguageConfig` |
| `workspace.overridesByAgent` | 保持不变（tweak 层独立） | 不变 |

**迁移策略**：
- 启动时检测旧 key，自动迁移到新 key；
- 迁移后清除旧 key（`agentskin.radiusScale` / `agentskin.density` / `agentskin.motion`）；
- 迁移逻辑封装为 `migrateDesignLanguagePreferences()` 纯函数，可独立测试。

### 4.4 统一消费路径

| 消费方 | 当前获取方式 | 统一后获取方式 |
|--------|-------------|---------------|
| Studio 预览区 CSS 生成 | `useThemeStore((s) => s.designLanguage)` | `useDesignLanguageSelector()` |
| UI shell CSS 变量 | `useSettingsStore((s) => s.radiusScale)` 等 | `useDesignLanguageSelector()` |
| TweakPanel slider 值 | `useWorkspaceStore((s) => s.currentOverrides)` | `useTweakStore((s) => s.currentOverrides)`（不变） |
| 主题 CSS 生成器 | `useThemeStore.getState().designLanguage` | `useDesignLanguageSelector()` |
| Raw CSS 编辑器 | `useWorkspaceStore((s) => s.currentOverrides)` | `useTweakStore((s) => s.currentOverrides)`（不变） |

### 4.5 值映射函数

由于 `ToolOverride` 的值域与 `DesignLanguageConfig` 不同，需要映射函数：

```ts
// ToolOverride.spacing (number) → DesignLanguageConfig.spacing.density (enum)
function mapSpacingToDensity(spacing?: number): 'compact' | 'comfortable' | 'cozy' | undefined {
  if (spacing === undefined) return undefined;
  if (spacing < 4) return 'compact';
  if (spacing < 8) return 'comfortable';
  return 'cozy';
}

// ToolOverride.shadowLevel → DesignLanguageConfig.shadow.elevation
function mapShadowToElevation(level?: string): 'flat' | 'subtle' | 'float' | undefined {
  if (level === 'none' || level === 'sm') return 'flat';
  if (level === 'md') return 'subtle';
  if (level === 'lg' || level === 'xl') return 'float';
  return undefined;
}

// ToolOverride.duration → DesignLanguageConfig.motion.speed
function mapDurationToSpeed(duration?: string): 'instant' | 'fast' | 'smooth' | undefined {
  if (!duration) return undefined;
  const ms = parseFloat(duration);
  if (ms <= 0) return 'instant';
  if (ms <= 150) return 'fast';
  return 'smooth';
}
```

### 4.6 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/shared/types/design-language.ts` | **新建** | 统一 `DesignLanguageConfig` 类型 + 映射函数 |
| `src/ui/stores/themeStore.ts` | **修改** | `DesignLanguageConfig` 类型改为从 `@shared/types/design-language` import |
| `src/ui/stores/settingsStore.ts` | **修改** | 删除 `RadiusScale` / `Density` / `Motion` 类型定义和字段，改为持有 `DesignLanguageConfig` |
| `src/ui/stores/tweakStore.ts` | **修改** | `ToolOverride` 中 radius/spacing/shadowLevel/duration 字段标记为 `@deprecated`，引导使用 `DesignLanguageConfig` |
| `src/ui/hooks/use-design-language.ts` | **新建** | 统一 selector hook，返回 `selectEffectiveDesignLanguage` |
| `scripts/design-language.mjs` | **修改** | 适配统一后的类型定义 |

---

## 5. 风险与兜底

| # | 风险 | 等级 | 触发条件 | 兜底策略 | 检测机制 |
|---|------|------|----------|----------|----------|
| R1 | 值映射函数精度丢失 | 中 | `ToolOverride.spacing` (number) 映射到 `density` (enum) 时信息丢失 | 映射函数设计为可逆（enum → number 有默认值）；tweak 层保留原始 `ToolOverride` 精度 | 单元测试覆盖所有映射边界 |
| R2 | 主题切换时 UI shell 闪烁 | 中 | 切换主题时 Layer 1 变化，Layer 2 不变，但 selector 重新计算触发 UI shell CSS 变量更新 | UI shell CSS 变量仅在 `DesignLanguageConfig` 实际变化时更新（shallow equality） | 手动切换主题验证无闪烁 |
| R3 | 旧 localStorage key 迁移失败 | 低 | 用户浏览器 localStorage 格式异常 | try-catch 包裹迁移逻辑，失败时静默降级为新 key 写入；旧 key 保留不删 | 单元测试覆盖迁移异常场景 |
| R4 | `motion` 值域不匹配 | 中 | `settingsStore.motion` 是 `'full' | 'reduced' | 'none'`，`DesignLanguageConfig.motion.speed` 是 `'instant' | 'fast' | 'smooth'` | 定义映射：`full→fast`, `reduced→fast`, `none→instant`；`'reduced'` 和 `'full'` 合并到 `'fast'` 是因为 UI shell 仅区分"有动效/无动效"两档 | 手动验证 UI shell 动效切换行为 |
| R5 | Tweak 实时编辑行为变化 | 中 | 统一后 `updateOverride` 需要同时更新 `ToolOverride` 和 `DesignLanguageConfig` | 保持 `updateOverride` 仅更新 `ToolOverride`，selector 自动从 Layer 3 读取最新值 | 手动验证 slider 拖动实时生效 |
| R6 | 消费方迁移遗漏 | 中 | 部分消费方仍使用旧字段（`settingsStore.radiusScale`） | 旧字段标记 `@deprecated` 但保留兼容 getter；编译时 lint 警告 | `npm run check` + 代码审查 |

---

## 6. 迁移策略

### Phase 1: 类型统一 + 兼容层（低风险，~1.5 天）

1. 新建 `src/shared/types/design-language.ts`，定义统一 `DesignLanguageConfig` 类型和映射函数；
2. `themeStore.ts` 改为从 `@shared/types/design-language` import 类型（零行为变化）；
3. `settingsStore.ts` 新增 `designLanguage: DesignLanguageConfig` 字段，保留旧字段作为兼容 getter；
4. 实现 `migrateDesignLanguagePreferences()` 迁移函数；
5. 新建 `use-design-language.ts` 统一 selector hook。

**验证清单**：
- [ ] `npm run check` 全绿
- [ ] 旧 localStorage key 自动迁移到新 key
- [ ] UI shell CSS 变量行为不变
- [ ] Studio 预览区 CSS 生成不变
- [ ] TweakPanel slider 行为不变

### Phase 2: 消费方迁移（低风险，~1 天）

1. UI shell CSS 变量消费方迁移到 `useDesignLanguageSelector()`；
2. Studio 预览区 CSS 生成迁移到 `useDesignLanguageSelector()`；
3. 主题 CSS 生成器迁移到 `useDesignLanguageSelector()`；
4. 删除 `settingsStore.radiusScale` / `density` / `motion` 兼容 getter。

**验证清单**：
- [ ] 所有消费方迁移完成
- [ ] 旧字段 getter 删除
- [ ] `npm run check` 全绿
- [ ] 行为与 Phase 1 完全一致

### Phase 3: ToolOverride 字段清理（中风险，~1 天）

1. `ToolOverride` 中 `radius` / `spacing` / `shadowLevel` / `duration` / `timing` 字段标记 `@deprecated`；
2. 新增 `designLanguage?: DesignLanguageConfig` 字段到 `ToolOverride`（可选，向后兼容）；
3. `updateOverride` 引导使用 `designLanguage` 字段而非已弃用字段；
4. 映射函数适配：当 `designLanguage` 字段存在时优先使用。

**验证清单**：
- [ ] 已弃用字段仍向后兼容
- [ ] 新字段 `designLanguage` 可正常使用
- [ ] `npm run check` 全绿
- [ ] 所有测试通过

---

## 7. 向后兼容

| 项目 | 兼容性保证 |
|------|-----------|
| `themeStore.designLanguage` | 100% 兼容——类型定义迁移到 shared，接口不变 |
| `settingsStore.radiusScale` 等 | Phase 1 保留兼容 getter；Phase 2 删除后需消费方迁移 |
| `workspaceStore.currentOverrides` | 100% 兼容——`ToolOverride` 字段不删除，仅标记 `@deprecated` |
| 持久化数据 | 旧 key 自动迁移到新 key，迁移后清除旧 key |
| 主题 manifest | 不变——`designLanguageConfig` 字段已存在，schema 不变 |
| 外部 IPC 接口 | 不变——本次改动仅限 UI 层 |

---

## 8. 验收标准

### 8.1 功能验收

- [ ] UI shell CSS 变量（圆角/间距/动效）行为不变
- [ ] Studio 预览区 CSS 生成行为不变
- [ ] TweakPanel slider 实时编辑行为不变
- [ ] 主题切换时 Design Language 正确更新
- [ ] 用户偏好持久化到 localStorage 且跨会话恢复
- [ ] 旧 localStorage key 自动迁移

### 8.2 技术验收

- [ ] `npm run check` 全绿
- [ ] `npm test` 全通过
- [ ] 统一 `DesignLanguageConfig` 类型定义在 `@shared/types/design-language.ts`
- [ ] 映射函数 100% 单元测试覆盖
- [ ] 无新增第三方依赖
- [ ] `settingsStore` 中旧字段在 Phase 2 后完全移除

### 8.3 性能验收

- [ ] `useDesignLanguageSelector()` 使用 memoized selector，避免不必要的重计算
- [ ] UI shell CSS 变量更新不触发预览区重渲染
- [ ] 主题切换时 selector 计算耗时 < 1ms

---

## 9. 人工复核项

1. **值映射精度**：`ToolOverride.spacing` (number) → `density` (enum) 的映射是否可接受？是否需要保留原始精度？
2. **motion 值域合并**：`settingsStore.motion` 的 `'full'` 和 `'reduced'` 合并到 `DesignLanguageConfig.motion.speed` 的 `'fast'` 是否合理？是否需要增加中间档？
3. **优先级链合理性**：Layer 3 (tweak) > Layer 2 (preference) > Layer 1 (manifest) 的优先级是否符合用户预期？
4. **迁移兼容性**：旧版本 AgentSkin 写入的 localStorage key 在新版本迁移后，如果用户回滚到旧版本，旧版本能否正常读取？
5. **ToolOverride 弃用策略**：`ToolOverride` 中已弃用字段的移除时间表是什么？是否需要在 v3 完全移除？

---

## 10. 评审结论

（评审意见汇总，由评审人填写）

---

*End of RFC.*
