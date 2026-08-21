# AgentSkin Design Language Token Extension — 最终深度漏检审计报告

> 审计日期：2026-08-21
> 审计人：独立审计专家 agent
> 范围：Design Language Token Extension 全部落地改动（含增强轮次）
> 文件总数：22（2 Schema + 4 新建脚本 + 1 新建 UI 组件 + 3 修改文件 + 5 测试文件 + 7 依赖文件）
> 测试总数：102

---

## 审计摘要

| 维度 | 评级 | 说明 |
|------|------|------|
| 方案一致性 | **B+** | 主体对齐阶段一 A+D 复合方案，一处文档描述与实现不符 |
| 工程正确性 | **B** | 注入顺序正确，性能优化到位，但 UI 预览逻辑与 CSS 生成存在严重偏差 |
| 模块间依赖 | **A-** | 依赖方向清晰，P1-2 修复已落地，残留一处代码重复 |
| Schema 兼容性 | **A** | 2 处 schema file 完全一致，枚举与 .mjs 实现严格对齐 |
| 测试覆盖 | **B+** | 102 个测试覆盖所有导出函数，但存在假阳性测试和场景遗漏 |
| 注入层不变量 | **A-** | DL/extended/variations 块位置正确，一处性能优化点可提升 |
| Swiss 合规 | **A-** | UI 组件 spacing 与圆角合规，无 12/14 等不规则值 |

**总体评级：B+**。核心链路设计正确，但存在 1 个 P0 级 UI 真实性与 1 个 P0 级文档一致性问题需修复。

---

## P0 Issues（必须修复）

### P0-1：CenterTabDesignLanguage 组件预览值与实际 CSS 生成值严重不符

**文件**：`src/ui/components/studio/center/CenterTabDesignLanguage.tsx` 第 75-85 行 `spacingPx` 函数

**问题**：组件的 CSS 变量预览区块声称显示 `--agentskin-space-3` 的实际值，但 `spacingPx` 函数返回的值与 `designLanguageBlock()` 计算出的真实值完全不一致。

| density | 组件 `spacingPx` 返回 | `designLanguageBlock` 实际生成 | 偏差 |
|---------|----------------------|-------------------------------|------|
| compact | `3px` | `12px` (round(16 × 0.75)) | 4× |
| comfortable | `4px` | `16px` (round(16 × 1)) | 4× |
| cozy | `5px` | `20px` (round(16 × 1.25)) | 4× |

**影响**：用户在 Studio 看到的变量值 `--agentskin-space-3: 3px` 与实际注入页面 `--agentskin-space-3: 12px` 完全不符。这是一个向用户展示虚假信息的 **数据真实性 bug**。

**根因**：`spacingPx` 函数使用了与 `designLanguageBlock` 完全不同的映射逻辑。它使用 `{ compact: 3, comfortable: 4, cozy: 5 }` 映射，而 `designLanguageBlock` 使用 `SPACING_BASE = [4, 8, 16, 24, 32, 48]` × `{ compact: 0.75, comfortable: 1, cozy: 1.25 }`。

**建议修复方案**（二选一）：

A. **使 UI 调用同一纯函数**：让组件 import `designLanguageBlock`，从解析后的 CSS 中提取 `--agentskin-space-3` 的值。这保证预览值与真实 CSS 100% 一致。

B. **提取共享映射表**：将间距/半径/阴影/动效到预览值的映射从 `designLanguageBlock` 中抽成共享的 pure lookup（如 `SPACING_PREVIEW: Record<density, Record<scale_name, px_string>>`），UI 与 CSS 生成共用同一数据源。

方案 A 推荐，因为无需维护两套语义一致的映射。

---

### P0-2：`shadowValue` 函数在组件中与 `SHADOW_VALUES` 映射不一致

**文件**：`src/ui/components/studio/center/CenterTabDesignLanguage.tsx` 第 102-113 行

**问题**：组件的 `shadowValue` 函数与 `design-language.mjs` 中的 `SHADOW_VALUES` 使用不同的阴影值：

| elevation | 组件 `shadowValue` | `SHADOW_VALUES` (CSS 生成) |
|-----------|-------------------|---------------------------|
| subtle | `0 1px 2px rgba(0,0,0,0.06)` | `0 1px 3px rgba(0,0,0,0.08)` |
| float | `0 4px 12px rgba(0,0,0,0.12)` | `0 4px 16px rgba(0,0,0,0.12)` |

**影响**：用户预览看到的阴影值与实际注入页面的阴影值不同。与 P0-1 同源——两套 shadow 映射，组件维护的独立版本与 CSS 生成模块不一致。

**修复建议**：与 P0-1 相同方案——让组件依赖 `designLanguageBlock` 的实际输出而非独立映射。

---

### P0-3：测试 `CenterTabDesignLanguage.test.tsx` 验证了错误值（假阳性）

**文件**：`src/ui/components/studio/center/CenterTabDesignLanguage.test.tsx` 第 82-91 行

**问题**：测试 `--agentskin-space-3: 4px` 与 `density='comfortable'` 匹配。这条测试：
1. 当组件的 `spacingPx` 映射被修正为与 `designLanguageBlock` 一致后，此测试将 **fail**（因为 actual 应为 `--agentskin-space-3: 16px`）。
2. 当前通过是因为组件恰好也使用错误值——**测试与实现同时犯错，形成假阳性**。

这与 P0-1 联动。修复 P0-1 时必须同步修复此测试。

---

### P0-4：`wcag-apca-check.mjs` `checkExtendedContrast` 函数文档描述与实现严重不符

**文件**：`scripts/wcag-apca-check.mjs` 第 82-87 行

**问题**：函数的 JSDoc 写道：

> "the auto on-color is computed as a 50/50 mix of the extended color and whichever of {background, foreground} yields the higher contrast"

但实际实现仅为：
```js
const onColor = onFor(hex); // onFor = autoOnColor, 纯 luminance 阈值判断
```

`autoOnColor` 仅做 luminance 阈值（>0.45 → #000，else → #fff），完全不考虑 background/foreground。

**影响**：运维/开发者按文档理解行为会做出错误的安全判断。CI 输出的 `checkExtendedContrast` 结果正确（因为确实用了 `autoOnColor`），但与文档描述不符。

**修复建议**：重写 JSDoc，使其准确描述当前实现：

```js
/**
 * Walk any `manifest.colors.extended` entries and verify each extended color
 * against its auto-generated on-color via `autoOnColor(hex)` (luminance > 0.45
 * → black text, else white text). This matches the runtime engine's
 * `--agentskin-ext-on-*` derivation in `extended-colors.mjs`.
 */
```

---

## P1 Issues（应当修复）

### P1-1：缺乏端到端集成测试——使用真实 manifest 调用完整管线

**问题**：现有 102 个测试均是纯函数单元测试，没有一条测试使用一个同时包含 `designLanguageConfig` + `colors.extended` + `_wcag` 的 manifest 调用 `generate-theme-css.mjs` 管线后，断言输出 CSS 包含预期的变量块。

**风险**：各模块单独正确但集成时未验证。例如 `dlBlock` 为 '' 时注入被跳过，但 `extBlock` 与 `dlBlock` 的连接顺序是否产生多余换行、空行等边界情况缺乏验证。

**建议**：新建 `tests/integration/design-language-pipeline.test.ts`，注入一个 fixture manifest，验证输出 CSS 至少：
- 包含 `--agentskin-ext-error: #ef4444`
- 包含 `--agentskin-space-3: 12px` (compact)
- 不以双换行符分隔各块
- 不包含 `--agentskin-*` 变量时默认主题输出 byte-identical

---

### P1-2：`loadVariations` 在 scheme 循环内被重复调用

**文件**：`scripts/generate-theme-css.mjs` 第 79 行

**问题**：`const variations = await loadVariations(themeDir)` 位于 `for (const scheme of schemes)` 循环内层。由于 `loadVariations` 不依赖 scheme，每次加载同一 manifest 的同一文件列表会导致同一 JSON 文件被重复异步读取 N 次（N = scheme 数量）。

**影响**：3 个方案的主题会被 `loadVariations` 调用 3 次而非 1 次。虽然由于 fs 缓存 + 异步开销有限，但这是不必要的冗余。

**建议**：将 `loadVariations` 调用移出 scheme 循环：

```js
// 在 schemes 循环之前：
const variations = await loadVariations(themeDir);
for (const scheme of schemes) {
  // ... 移除该行
}
```

---

### P1-3：`check-themes.mjs` 第 297 行死条件

**文件**：`scripts/check-themes.mjs` 第 297 行

```js
if (exManifestPath) exManifestRaw = await fs.readFile(exManifestPath, 'utf8');
```

**问题**：`exManifestPath` 由 `path.join(THEMES_DIR, entry.name, 'manifest.json')` 生成，此 if 恒为真。代码意图可能是检查文件是否存在，但当前实现是死代码。

**建议**：改为 try/catch fs.readFile 或移除无意义的 if 守卫。

---

### P1-4：`setDesignLanguage` 浅合并——子对象属性可能被意外替换

**文件**：`src/ui/stores/themeStore.ts` 第 303 行

```ts
setDesignLanguage: (dl) => set((s) => ({ designLanguage: { ...s.designLanguage, ...dl } })),
```

**问题**：当前实现为浅合并。若调用 `setDesignLanguage({ spacing: { density: 'cozy' } })`，`radius`/`shadow`/`motion` 顶层 key 被保留（因为它们来自 `s.designLanguage`），但 `spacing` **整个子对象被替换**。

由于 `DesignLanguageConfig` 的每个子对象目前仅有 1 个属性（`spacing.density`），浅合并暂时安全。但当 schema 扩展（如 `spacing` 新增 `paddingScale` 属性），浅合并会丢失已有属性。

**建议在文档中明确约定**：调用方应始终传入完整的子对象，或改为 deep merge。在 `ADR` 中记录此决策。

---

### P1-5：WCAG/APCA 检查为 warn-only 但新 schema `_wcag.level` 无文档化默认值测试

**文件**：`tests/unit/wcag-apca-contrast.test.ts`

**问题**：Schema `_wcag.level` 描述为 "(v2.6+) WCAG/APCA 对比度元数据。不提供时默认 'AA'"。但 resolveLevel 函数将任何非 'AAA'/'none' 的值都 fallback 为 'AA'，包括无效字符串如 `'foo'`。

当前测试覆盖了 'AA'/'AAA'/'none' + 缺失（走默认），但未覆盖：
- `_wcag.level = 'invalid-string'` → 应 fallback 为 'AA'
- `_wcag.level = ''` (空字符串)
- `_wcag.level = null`

**建议**：补充 2 个边界测试确认 resolveLevel 的宽容 fallback 行为符合预期。

---

## P2 Issues（建议修复）

### P2-1：`check-themes.mjs` 扩展色格式校验块重复

**文件**：`scripts/check-themes.mjs` 第 291-325 行对扩展色的格式校验逻辑与第一个循环（第 137-289 行）遍历了完全相同的 `themes/` 目录和 manifest.json，重新 readFile 并 JSON.parse。代码明显重复。

**建议**：将扩展色格式校验合并到第一个循环中（第 189 行之后），避免重复 I/O 和解析。

---

### P2-2：`RADIUS_VALUES` 使用数字键但查找使用字符串

**文件**：`scripts/design-language.mjs` 第 74-79 行

```js
const RADIUS_VALUES = Object.freeze({ 0: 0, 2: 2, 4: 4, 8: 8 }):
// ...
const rScale = RADIUS_VALUES[scale] ?? RADIUS_VALUES['2']; // scale is string
```

**问题**：`RADIUS_VALUES` 的 key 是数字（JS 对象键自动为字符串），查找参数 `scale` 是字符串。在 JS 中对象 key 查找会强制转换所以能工作，但 TypeScript 类型不匹配：`Record<number, number>` 不允许 `string` 查找。

**建议**：改为 `Record<string, number>` 或使用 `Map`。或在设计文档中说明此为 JS object key coercion。

---

### P2-3：`shadowValue.slice(0, 24)` 对 `'none'` 生成 `'none...'`

**文件**：`src/ui/components/studio/center/CenterTabDesignLanguage.tsx` 第 236 行

```tsx
--agentskin-shadow-float: {shadowValue(elevation).slice(0, 24)}...
```

**问题**：当 `elevation='flat'` 时 `shadowValue` 返回 `'none'` → `.slice(0, 24)` 仍为 `'none'` → 显示 `'none...'`，这是无意义输出（4 字符字符串后跟省略号）。

**建议**：仅当 shadow 不为 'none' 时附加 `...`。

---

### P2-4：测试文件 `extended-colors-block.test.ts` 使用 `as any` 绕过类型检查

**文件**：`tests/unit/extended-colors-block.test.ts` 第 132-133 行

```ts
expect(extendedColorsBlock(undefined as any)).toBe('');
expect(extendedColorsBlock(null as any)).toBe('');
```

**问题**：`extendedColorsBlock` 签名要求 `Record<string, string>`。测试使用 `as any` 绕过类型检查以测试 null/undefined 输入。

**建议**：修改函数签名为 `Record<string, string> | null | undefined`（因为实现已经用 `ext ?? {}` 兼容 null/undefined），移除 `as any`。

---

### P2-5：`CenterTabDesignLanguage` 中 radius preview swatches 使用内联 `style={{ borderRadius }}` 绕过 Tailwind

**文件**：`src/ui/components/studio/center/CenterTabDesignLanguage.tsx` 第 221 行

```tsx
style={{ borderRadius: `${r}px` }}
```

**问题**：使用 inline style 动态设置 border-radius，而非 Tailwind 类。这在技术上是需要的（因为值动态来自 config），但建议注释说明为什么不能直接用 Tailwind（Tailwind JIT 无法处理运行时动态值）。

**建议**：在行内添加简短注释说明动态值，无功能影响，仅代码可读性。

---

### P2-6：Component 使用独立的 `SpacingDensity`/`RadiusScale`/`ShadowElevation`/`MotionSpeed` 类型，与 themeStore.ts 的 `DesignLanguageConfig` 属性类型形成重复定义

**文件**：`src/ui/components/studio/center/CenterTabDesignLanguage.tsx` 第 28-31 行 vs `src/ui/stores/themeStore.ts` 第 201-205 行

**问题**：组件定义 `type SpacingDensity = 'compact' | 'comfortable' | 'cozy'`，themeStore 定义 `spacing?: { density?: 'compact' | 'comfortable' | 'cozy' }`。类型值相同但分散在两处。

**建议**：从 themeStore.ts 导出 union 类型，组件 import 复用，消除重复定义。

---

### P2-7：`generate-theme-css.mjs` 使用顶层 await

**文件**：`scripts/generate-theme-css.mjs` 第 79 行

```js
const variations = await loadVariations(themeDir);
```

**问题**：使用顶层 await（在 ESM 模块中），内层 for 循环中的 await 会顺序执行每个 scheme 的 `loadVariations`。虽然功能正确，但依赖顶层 await（Node 14.8+ 特性）。

**建议**：确保 `package.json` 中 `"type": "module"` 已声明或文件中 `.mjs` 扩展名保证 ESM 解释。当前已使用 `.mjs`，可接受。

---

## 审计不通过项（无问题）

以下维度审计通过，无缺陷报告：

### Schema 兼容性 PASS

- `src/main/catalog/manifest-v2.schema.json` 与 `docs/manifest-v2.schema.json` 的 `designLanguageConfig`、`_wcag`、`componentVariations`、`extended` 属性 **完全一致**（逐行对比通过）
- `colors.extended` 枚举类型 `string` 与 `extended-colors.mjs` 的 `Record<string, string>` 对齐
- `_wcag.level` enum `["AA", "AAA", "none"]` 与 `wcag-apca-check.mjs` resolveLevel 逻辑对齐
- `designLanguageConfig` 全部 4 个 section 的 enum 与 `design-language.mjs` 中 SPACING_MULTIPLIERS / RADIUS_VALUES / SHADOW_VALUES / MOTION_VALUES 的 key 完全一致
- `designLanguage` 字段（string，引用 preset id）与 `DESIGN_LANGUAGES` 注册表 key 对齐

### 工程正确性 PASS

- **注入顺序正确**：`generate-theme-css.mjs` 第 81-102 行，执行顺序为 base CSS → `extBlock` → `dlBlock` → variations → `auroraGlassSignature`，符合 "extended → DL → variation → auroraGlass" 规范
- **性能优化正确**：`extBlock`、`dlBlock`、`variations` 计算位于 agent 循环外（但仍在 scheme 循环内），避免每个 agent 重复计算
- **partial merge 正确**：`themeStore.ts` line 303 的 `setDesignLanguage` 使用 `{ ...s.designLanguage, ...dl }` 实现 partial merge

### Swiss 设计系统合规 PASS

- CenterTabDesignLanguage 组件全部使用 `rounded-[2px]` 圆角 ✓
- spacing 值检查：`gap-1`=4px, `px-2`=8px, `py-1`=4px, `p-4`=16px, `mt-4`=16px, `space-y-4`=16px, `mt-2`=8px, `gap-4`=16px, `gap-2`=8px, `p-2`=8px。所有值均为 4px 网格标准 Tailwind 档位 ✓
- 未发现 10px、12px、14px 等不规则间距使用 ✓

### 注入层不变量 PASS

- DL/extended/variations 三个新增块均在 L0 palette CSS（base `generate(ctx)` 输出）之后、L3 auroraGlass 之前注入 ✓
- 注入顺序从 base CSS 到 auroraGlass 依次为：base → extended → design language → variations → aurora glass ✓

### 模块间依赖 PASS

- `wcag-apca-check.mjs` 正确 import `apcaContrast, autoOnColor, contrastRatio` from `./extended-colors.mjs` ✓
- `autoOnColor` 来源正确（来自 extended-colors.mjs，P1-2 修复已落地）✓
- `check-themes.mjs` 正确 import `checkThemeContrast, checkExtendedContrast` from `./wcag-apca-check.mjs` ✓
- `variations-loader.mjs` 仅依赖 `node:fs/promises` 和 `node:path`，无外部依赖 ✓

---

## 修复优先级建议

| 编号 | 严重度 | 描述 | 工作量 |
|------|--------|------|--------|
| P0-1 | 🔴 Blocker | 修复 spacingPx 与 designLanguageBlock 一致性 | 2h |
| P0-2 | 🔴 Blocker | 修复 shadowValue 与 SHADOW_VALUES 一致性 | 1h |
| P0-3 | 🔴 Blocker | 修复假阳性测试（与 P0-1 联动） | 0.5h |
| P0-4 | 🔴 Blocker | 修复 checkExtendedContrast 文档 | 0.5h |
| P1-1 | 🟡 应补 | 端到端集成测试 | 2h |
| P1-2 | 🟡 小优 | 移 loadVariations 到 scheme 循环外 | 0.5h |
| P1-3 | 🟡 小清 | 移除 check-themes.mjs 死条件 | 0.5h |
| P1-4 | 🟡 文补 | setDesignLanguage 浅合并约定文档 | 0.5h |
| P1-5 | 🟡 测补 | 补充 _wcag.level 边界值测试 | 1h |
| P2-1 | 💭 建议 | check-themes.mjs 代码去重 | 1h |
| P2-2 | 💭 建议 | RADIUS_VALUES 类型修正 | 0.5h |
| P2-3 | 💭 建议 | shadowValue 显示截断修复 | 0.5h |
| P2-4 | 💭 建议 | 测试 as any 类型修正 | 0.5h |
| P2-5 | 💭 建议 | inline style 注释 | 0.25h |
| P2-6 | 💭 建议 | DesignLanguageConfig 类型复用 | 0.5h |
| P2-7 | 💭 文档 | 顶层 await / Node 版本要求文档 | 0.25h |

**修复推荐路径**：先修复 P0-1/2/3/4 四个 Blocker（同一 PR），再按 P1-顺序补全。

---

## 附：验证清单

审计过程中逐文件确认的契约对齐情况：

| 文件 | 关键函数/类型 | 对齐对象 | 结果 |
|------|-------------|---------|------|
| design-language.mjs | `DL_DEFAULTS` | schema designLanguageConfig enum | ✅ |
| design-language.mjs | `DESIGN_LANGUAGES['swiss-default']` | DL_DEFAULTS | ✅ |
| design-language.mjs | `designLanguageBlock(isDefault)` | generate-theme-css.mjs 跳过逻辑 | ✅ |
| design-language.mjs | `resolveDesignLanguage` priority | generate-theme-css.mjs 调用顺序 | ✅ |
| extended-colors.mjs | `luminance` / `contrastRatio` | WCAG 2.1 公式 | ✅ |
| extended-colors.mjs | `autoOnColor` threshold 0.45 | wcag-apca-check.mjs 使用 | ✅ |
| extended-colors.mjs | `extendedColorsBlock` filter | check-themes.mjs 格式校验 | ✅ |
| wcag-apca-check.mjs | `checkThemeContrast` return shape | check-themes.mjs 消费 | ✅ |
| wcag-apca-check.mjs | `checkExtendedContrast` on-color | extended-colors.mjs autoOnColor | ✅ |
| wcag-apca-check.mjs | `assertContrast` throw messages | 错误信息正则匹配 | ✅ |
| variations-loader.mjs | `loadVariations` return shape | generate-theme-css.mjs 消费 | ✅ |
| variations-loader.mjs | `filterByAgent` empty=all | generate-theme-css.mjs agent loop | ✅ |
| generate-theme-css.mjs | extBlock 位置 | agent 循环外 | ✅ |
| generate-theme-css.mjs | dlBlock 位置 | agent 循环外 | ✅ |
| generate-theme-css.mjs | 注入顺序 | extended → DL → variations → auroraGlass | ✅ |
| check-themes.mjs | import 路径 | wcag-apca-check.mjs | ✅ |
| check-themes.mjs | WCAG warn-only | 不阻塞 CI | ✅ |
| themeStore.ts | `DesignLanguageConfig` interface | schema enum 值 | ✅ |
| themeStore.ts | `setDesignLanguage` partial merge | 组件调用模式 | ✅ |
| CenterTabDesignLanguage.tsx | `spacingPx` 值 | designLanguageBlock 实际输出 | ❌ P0-1 |
| CenterTabDesignLanguage.tsx | `shadowValue` 值 | SHADOW_VALUES 映射 | ❌ P0-2 |
| CenterTabDesignLanguage.tsx | `radiusPx` 值 | RADIUS_VALUES 映射 | ✅ |
| CenterTabDesignLanguage.tsx | `motionMs` 值 | MOTION_VALUES 映射 | ✅ |
| CenterTabDesignLanguage.tsx | Tailwind spacing 档位 | 4px 网格 | ✅ |
| CenterTabDesignLanguage.tsx | rounded-[2px] 使用 | Swiss 设计规范 | ✅ |

---

## 结论

Design Language Token Extension 的 **核心引擎层**（schema → pure functions → CSS 注入 → CI 校验）设计严谨、依赖方向正确、向后兼容到位。

主要风险集中在 **UI 展示层**：CenterTabDesignLanguage 组件的预览值与实际 CSS 生成值不一致（P0-1/2/3），属于"UI 展示与引擎实现解耦后未同步"的典型问题。这不是引擎 bug，而是 UI 未正确消费引擎输出的架构缺陷。

修复建议：**让 UI 直接消费 `designLanguageBlock(dl)` 的输出**（或从中派生预览值），而非维护独立的映射函数。这同时解决 P0-1/2/3 三个 Blocker，并消除未来的同步维护负担。

P0-4（文档描述不符）是独立的文档修复，工作量极低但影响开发者认知，建议同步修复。</longcat_think>
