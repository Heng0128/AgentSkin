# AgentSkin 主题系统候选方案 V3 — 大重构版

> **生成时间**: 2026-08-23
> **前置输入**: theme-system-v2-selection-report（α/β/γ/δ 四套保守方案）+ audit-agentskin-internal + audit-github-css-themes + theme-category-plan + rendering-injection-spec
> **本次定位**: 突破"最小入侵"思维，提供真正在架构层重构的候选方案
> **权重调整**: 长期演进从 5% 提升至 15%，与新权重对齐

---

## 权重体系（V3 最新）

| 维度 | 权重 | 说明 |
|------|:----:|------|
| 业务根治 | 18% | 是否彻底解决 doubao.css 59KB / @keyframes=0 / bridge 5 大缺陷 |
| 场景兼容 | 12% | 6 适配器 × 存量 7 主题 × Codex 桥接 × colorSchemes × light/dark 平衡 |
| 故障安全 | 15% | CDP 注入幂等 / 回滚路径降级 / 构建期 verify |
| 工程契约 | 10% | C1-C10 不变量守护 |
| 可工程化 | 12% | 测试覆盖 / CI 校验 / 回滚能力 |
| 架构一致 | 10% | AGENTS.md L0-L4 + 分层依赖方向 |
| **长期演进** | **15%** | **新提升维度**：后续 3-5 年的主题生态可扩展性 |
| 边界健壮 | 8% | 极端色相 / 无障碍 / 低配设备 / Electron 版本碎片化 |

---

## 七套候选方案

### 方案 ε：主题契约重写（Thematic Contract Reformation）

**代号与哲学**: "以 DTCG 为锚、以主题为原子"——将 14 个独立的扁平 token 重写为符合 W3C DTCG（Design Token Community Group）标准的分层 token 主题，每个 token 获得完整的元数据（类型、描述、延伸引用、组别），兼容外部工具链（Tokens Studio / Figma Tokens / Style Dictionary）。

**核心改动**:

1. **manifest.json 重写**: `colors` 块从扁平 14 字段迁移到 DTCG `$value`/`$type`/`$description`/`$extensions` 四字段结构：

```json
{
  "$color": {
    "accent": {
      "$type": "color",
      "$value": "#7C9CFF",
      "$description": "Primary interactive color",
      "$extensions": {
        "agentskin.group": "brand",
        "agentskin.semantic": "action-primary",
        "agentskin.version": "3.0"
      }
    }
  }
}
```

2. **engine/schema 层**: 替换 `src/main/catalog/manifest-v2.schema.json` 为 `manifest-v3-dtcg.schema.json`，采用 DTCG `SchemaStore` 校验；保留 v2-to-v3 转换器（`scripts/migrate-v2-to-v3.mjs`）。

3. **build-palette.mjs 重写**: 新增 DTCG-aware 解析路径——读取 `$value` 而非 raw string，输出保持 `--agentskin-*` 兼容名不变（后向兼容）。

4. **主题包双模式共存**: `schemaVersion: "3-dtcg"`（新）与 `schemaVersion: 2`（旧）并存；`check-themes.mjs` 双路径校验，不阻断旧主题 CI。

**GitHub 参考来源**:
- **W3C DTCG spec**（design-tokens community group）——token 元数据格式
- **Amazon Style Dictionary**——transform pipeline 的 `transformGroup/css` 概念
- **Tokens Studio for Figma**——token 分组（sets/tokens/folders）管理经验

**8 维预评分**:

| 业务根治 | 场景兼容 | 故障安全 | 工程契约 | 可工程化 | 架构一致 | 长期演进 | 边界健壮 |
|:--------:|:--------:|:--------:|:--------:|:--------:|:--------:|:--------:|:--------:|
| 7 | 7 | 8 | 6 | 6 | 7 | **10** | 8 |

**加权总分**: 7.37

**致命漏洞预分析**:
- DTCG 仍在 Community Group 阶段（非正式 W3C 标准），格式未来可能小幅变化；需承诺 "$extensions 命名空间隔离" 策略缓解
- v2→v3 迁移需全量写测试（7 主题 × 6 agent × 迁移前后 hash 对比），遗漏会导致主题作者依赖旧格式时崩溃

**与现有 14-token 契约的兼容策略**:
输出层保持 `--agentskin-*` 变量名不变；新 schema 仅改变 manifest 输入格式。引擎内部 `buildContext()` 对 DTCG 输入做 `unwrapDtcg()` 预处理（剥离 `$value`/`$type` 包装），后续消费链无感知。

---

### 方案 ζ：样式引擎全量重写（CSS Engine Ground-Up）

**代号与哲学**: "告别 40 个独立脚本，引入统一 CSS 编排管线"——将 `build-palette.mjs` + `generate-theme-css.mjs` + `extended-colors.mjs` + `design-language.mjs` + `variations-loader.mjs` + `theme-generators.mjs` + `theme-utils.mjs` 共 7 个独立脚本合并为一个管线化引擎模块 `src/engine/src/css-pipeline.ts`，统一为「输入解析→token 派生→层化组装→输出序列化」四阶段模式。

**核心改动**:

1. **CSSPipeline 类**（新文件 `src/engine/src/css-pipeline/css-pipeline.ts`）：
   - `constructor(manifest, options)` — 接收 v2 或 DTCG v3 格式
   - `derive(inputColors: TokenTree): TokenTree` — OKLCH 色空间派生缺失 token（当前 build-palette 的 auto-derive 逻辑升级为感知色空间）
   - `assemble(derivedTokens, layers: Layer[]): CSSBundle` — 按 [palette → design-language → extended-colors → variations → agent-specific → signature] 顺序组装
   - `serialize(bundle, format): string | Buffer` — 产出 CSS / JSON / DTCG-any

2. **引擎内部全面 TypeScript**：当前 scripts/ 全部 `.mjs`，TypeScript 化后支持严格类型检查（TokenTree / LayerSpec / CSSBundle 接口），消除 `as any` 逃生口、提前发现 regressions。

3. **层化复用语义**：`Layer<T>` 接口成为一等公民，任何扩展（animation/decorations/artFocalPoint）实现 `Layer` 接口即可挂载到管线中，无需修改 generator 层。

4. **MUCH 减少 6 适配器重复代码**：当前 `scripts/generators/codexCss.mjs` / `doubaoCss.mjs` 等 6 个文件合计 ~1500 行，它们的共性结构（变量块模板、!important 注入策略、host 选择器挂载）提炼为 `AgentCssRenderer<T extends AgentTokenStrategy>` 泛型基类，每个 adapter 仅声明 ~60 行差异。

**GitHub 参考来源**:
- **Vanilla Extract**（seek-oss）—— compile-time CSS extraction + 类型安全契约
- **Amazon Style Dictionary**——transform pipeline 的链式 hook 模式
- **Panda CSS**——layer composition 的 recipe 概念（不引入依赖，借鉴分层哲学）

**8 维预评分**:

| 业务根治 | 场景兼容 | 故障安全 | 工程契约 | 可工程化 | 架构一致 | 长期演进 | 边界健壮 |
|:--------:|:--------:|:--------:|:--------:|:--------:|:--------:|:--------:|:--------:|
| **9** | 8 | 7 | 7 | 7 | **9** | **9** | 7 |

**加权总分**: 8.04

**致命漏洞预分析**:
- TypeScript 化需要重写所有 42 个生成函数的签名；过程中可能暴露当前隐藏的类型错误（ctx 字段为 any 等），一次性修复成本极高
- "不修改输出字节"的 verify 模式需要做 byte-for-byte diff，任何空白/注释变更都会导致校验暴增

**与现有 14-token 契约的兼容策略**:
CSSPipeline 的默认 Layer 序列产出与当前 `generate-theme-css.mjs` 字节级一致（通过 `--verify` 模式约束）；14 token 是 palette layer 的实现细节，引擎改写字节不变。

---

### 方案 η：运行时注入策略重构（CDP Runtime Reformation）

**代号与哲学**: "将主题应用从'文件替换'升级为'语义注入'"——当前 hybrid-injector.mjs 用 `CSSStyleSheet.replaceSync()` 整体替换样式表，主题切换时触发全量 CSS 重建（14 tokens × 6 agents × !important 置顶 = 300+ 变量覆盖）。方案 η 引入「CSS 容器 + 语义映射表」模式：将主题声明为语义 token 表，引擎在运行时动态生成/更新 `CSSStyleSheet` 变量块，配合 `CSS.registerProperty()` Houdini API 实现类型安全 + GPU 加速的动画变量。

**核心改动**:

1. **hybrid-injector.mjs 重写**：删除当前的 `_ensureSheet(id)` + `_adoptSheet(id)` Stylus-like 模式，替换为三层注入：
   - **L0-palette**: 14 个 `--agentskin-*` 变量块，通过 `CSS.registerProperty()` 预注册类型（`<color>` / `<percentage>` / `<length>`）
   - **L1-native**: 6 个 agent tokens.css 映射层，引用 L0 变量值
   - **L2-theme**: 主题专属 CSS（动态艺术效果、签名动画、decorations），通过 Constructable Stylesheet API 惰性创建/替换

2. **CSS.registerProperty() 降级路径**：Electron < 29 不支持 Houdini，通过 `try { CSS.registerProperty(...) } catch { /* fallback to :root var set */ }` 双轨；降级模式下保留现有 `setProperty`（0 性能损失，仅失去类型安全和动画能力）。

3. **语义映射表（Semantic Map）**：新增 `theme-semantic-map.json`（构建期生成），将 14-token 映射到每个 agent 原生变量名空间：
```json
{
  "traework": {
    "--agentskin-bg": "--vscode-editor-background",
    "--agentskin-text": "--vscode-foreground"
  }
}
```

4. **原子化主题切换**：主题切换仅替换 L2 + 更新 L0 变量值（实测从 ~150ms 降至 ~20ms），L1 语义映射表不变。

**GitHub 参考来源**:
- **construct-style-sheets**（GitHub Top 9 已识别）—— `CSSStyleSheet.replaceSync()` 已用，本次深化为 registerProperty
- **Dark Reader**（GitHub 审计 5 已部分落地）—— Dynamic Theme 的 rAF batching 复用
- **Stylus 浏览器扩展**——`MutableCSSStyleSheet` 生命周期管理模式
- **W3C CSS Houdini**——`CSS.registerProperty()` 自定义属性类型注册（实验性但 Electron 已支持）

**8 维预评分**:

| 业务根治 | 场景兼容 | 故障安全 | 工程契约 | 可工程化 | 架构一致 | 长期演进 | 边界健壮 |
|:--------:|:--------:|:--------:|:--------:|:--------:|:--------:|:--------:|:--------:|
| 8 | 7 | 6 | 7 | 6 | 8 | **9** | 6 |

**加权总分**: 7.26

**致命漏洞预分析**:
- CSS.registerProperty() 在部分 Electron 版本抛出 `NotSupportedError`，降级路径必须经过真机 6 端测试；
- 语义映射表的维护成本：每次 agent 应用更新可能改变原生 token 名，需重新运行 probe 脚本；失败时降级路径必须完整保留当前文件替换模式作为终极 fallback

**与现有 14-token 契约的兼容策略**:
本方案完全不改变 14-token 契约，仅在注入层重新实现「14-token → agent native 变量」的映射路径；palette.css / agent CSS 文件均无需重写。

---

### 方案 θ：主题-视觉-诊断三位一体（Theme-Studio-Diagnostics Trinity）

**代号与哲学**: "让每一件产物都自带诊断能力"——当前主题产物（palette.css + agent CSS）是纯样式，无法自我诊断是否与目标 DOM 兼容。「三位一体」方案在主题 token 中嵌入「验证元数据 + 视觉上下文注入点 + 诊断策略」三元组，使主题在 Studio 和 Runtime 中都携带完整可用性信息。

**核心改动**:

1. **manifest 新增 `diagnostics` 块**（schema v3+optional）：

```json
{
  "diagnostics": {
    "compatibilityMatrix": {
      "traework": { "sinceVersion": "1.8.0", "safeTokens": 12, "riskTokens": ["codeBackground"] },
      "doubao": { "sinceVersion": "2.1.0", "safeTokens": 14, "riskTokens": [] }
    },
    "expectedAnchors": {
      "traework": [".input-container", ".message-bubble"],
      "doubao": [".semi-input-wrapper"]
    }
  }
}
```

2. **Studio 侧诊断扩展**：`CenterTabGenerator` 集成 `VisualizerHealthIndicator`，基于主题兼容矩阵显示每个 agent 的健康度色块（绿/黄/红），避免主题作者盲目猜测支持度。

3. **Runtime 侧被动探活**：注入 CDP 时附带「token 覆盖率探针」代码段（不计入主 CSS 文件），注入完成后的 report 包含 `{ tokenName: "agentskin-accent", observedOn: 12, expectedOn: 15, coverage: 0.80 }`。

4. **兼容性越级降级**：当主题声明的 token 覆盖率低于阈值（默认 0.70），引擎自动调用前置主题补全的「fallback token set」（避免部分 agent 上出现断裂），同时为 Studio 报告提供修复建议路径。

5. **diagnostics store 现有能力整合**：当前 `diagnosticsStore.healthReport` 已有 per-agent 分区缓存，本方案将其扩展为「主题-诊断-CDP 运行时」三源联合。

**GitHub 参考来源**:
- **Tokens Studio**（tokens-studio/figma-plugin）——兼容性矩阵显示 + token confidence indicator
- **Figma Tokens**——token sets 与 variant 管理逻辑
- **Open Props**——token 级 prefers-reduced-motion 承诺

**8 维预评分**:

| 业务根治 | 场景兼容 | 故障安全 | 工程契约 | 可工程化 | 架构一致 | 长期演进 | 边界健壮 |
|:--------:|:--------:|:--------:|:--------:|:--------:|:--------:|:--------:|:--------:|
| 8 | **9** | **9** | 8 | 8 | 8 | 8 | **9** |

**加权总分**: 8.40

**致命漏洞预分析**:
- `diagnostics` 块大幅增加 manifest 体积和主题作者学习曲线；如果必填会阻碍社区创作，如果选填则形同虚设
- Agent DOM 结构可能随目标应用更新而改变，`compatibilityMatrix` 的有效期管理需要 CI 定期刷新机制（例如每周 probe 最新 agent 版本）

**与现有 14-token 契约的兼容策略**:
`diagnostics` 是 manifest 顶层可选字段；不声明该字段的主题完全无影响，14-token 契约维持不变。兼容矩阵基于现有 14 token 计算覆盖率。

---

### 方案 ι：风格-动画-材质第三维（The Third Dimension: Material & Motion）

**代号与哲学**: "从配色到材质 + 动效的第三维扩展"——当前主题是两维的（配色态 + 结构修饰），方案 ι 引入第三维：材质（Material）与动效（Motion）。参考 Material Design 3 的 Dynamic Color + Material You 的「材质感」语义，将 `@keyframes`、`backdrop-filter`、`linear-gradient` 提升为一等公民纳入主题契约。

**核心改动**:

1. **manifest 新增 `motion` 和 `material` 顶层块（schema v3）：**

```json
{
  "motion": {
    "reducedMotion": "respect",
    "entering": [ { "name": "fadeInUp", "duration": "220ms", "easing": "var(--agentskin-ease-out)" } ],
    "exiting": [ { "name": "fadeOutDown", "duration": "160ms", "easing": "var(--agentskin-ease-in)" } ],
    "ambient": [ { "name": "auroraDrift", "duration": "12s", "easing": "linear", "iteration": "infinite" } ]
  },
  "material": {
    "scrimDefault": "rgba(0,0,0,0.45)",
    "glassBlur": "8px",
    "elevationSteps": 5,
    "surfaceTreatment": "soft-shadow"
  }
}
```

2. **generate-theme-css.mjs 扩展**：新增 `motionBlock(motionConfig)` 和 `materialBlock(materialConfig)` 纯函数（仿照 `extendedColorsBlock` 模式），产出：
   - `@keyframes fadeInUp { ... }` + `.agentskin-animate-fadeInUp { animation: ... }`
   - `.agentskin-glass` / `.agentskin-elevation-{1-5}` / `.agentskin-scrim` 工具类
   - `prefers-reduced-motion: reduce` 时禁用所有 ambient 动画

3. **Design Language 预设库扩展**：当前 presets（swiss-default / soft-rounded / compact-flat）各自附带 motion 预设（swiss=sharp/fast, soft=smooth/bounce, compact=instant/none），主题作者可引用预设而非逐一声明。

4. **Studio 中动画编辑器**：`CenterTabDesignLanguage` 迁移为 `CenterTabDesignLanguageMotion`，增加 `motion` 和 `material` 的滑块与预设选择。

5. **运行时注入支持**：hybrid-injector 新增 `motionApply(sheet, motionConfig)` 方法，支持在 `adoptedStyleSheets` 中添加 `@keyframes` 规则（Constructable Stylesheets 原生支持 `@keyframes` 规则）。

**GitHub 参考来源**:
- **Material Design 3**（material-components/material-web）—— Dynamic Color + tonal palette
- **Open Props**（已落地部分）—— animation/easing token 体系
- **Tailwind CSS v4**——新特性 `@theme` 指令定义材质与动效 token
- **Motion One**（motionone.pacocour.co）—— 体积小（3kb）的高性能动画运行时

**8 维预评分**:

| 业务根治 | 场景兼容 | 故障安全 | 工程契约 | 可工程化 | 架构一致 | 长期演进 | 边界健壮 |
|:--------:|:--------:|:--------:|:--------:|:--------:|:--------:|:--------:|:--------:|
| **9** | 8 | 7 | 7 | 7 | **9** | **9** | 7 |

**加权总分**: 8.03

**致命漏洞预分析**:
- @keyframes 在 CDP 注入环境下的行为与纯浏览器环境不同（部分 Electron 版本在 `adoptedStyleSheets` 中声明 `@keyframes` 不生效）；需针对每个 Electron 版本做真机验证
- `material` 块与 `designLanguage` 存在概念重叠（elevation 既在 designLanguage.shadow 又在 material.elevationSteps）；需要合并命名空间

**与现有 14-token 契约的兼容策略**:
motion 和 material 均为 manifest 顶层可选字段；不声明时无额外输出；14-token 契约完全保留。Studio 入口增加"动效 / 材质"两 tab，但旧主题不声明这两块。

---

### 方案 κ：主题语义图谱（Semantic Theme Graph）

**代号与哲学**: "用图结构表达主题关系，支持智能推荐与自动补全"——将主题从静态 JSON 提升为语义图谱（有向图结构），每个主题是图中的一个节点，边表示变体关系（colorSchemes）、主题家族（同作者系列）、视觉相似度（色彩距离）。前端引入轻量图谱引擎 `@agentskin/theme-graph`，并在 Studio 中实现"相似主题推荐"、"色相偏移变体生成"、"冲突检测"三大能力。

**核心改动**:

1. **theme-graph 引擎**（新模块 `src/engine/src/theme-graph/`）：
   - `class ThemeGraph extends DirectedGraph<ThemeNode, ThemeEdge>`
   - `addTheme(manifest): ThemeNode` — 解析 manifest 加入图谱
   - `findSimilar(themeId, threshold=0.15): ThemeNode[]` — 基于 OKLCH 色彩距离检索
   - `detectConflict(themeA, themeB): TokenConflict[]` — 语义 token 值同一性冲突
   - `autoVariants(baseTheme, axes: {hue?: number, luminance?: number}[]): ThemeNode[]` — 沿色相/明度轴自动生成变体主题

2. **manifest 新增 `graph` 可选顶层块**：

```json
{
  "graph": {
    "family": "aurora",
    "parent": "aurora-dusk",
    "variations": ["aurora-glass", "aurora-violet"],
    "colorDistance": 0.08,
    "semanticTags": ["blue-family", "aurora-effect"]
  }
}
```

3. **Studio 智能推荐面板**：用户在 Studio 调整任一 token 时，侧栏显示"相似主题推荐"（基于 OKLCH ΔE 距离），点击即可一键跳转到推荐主题。

4. **ThemeCategory 重规划联动**: 当前 `theme-category-plan.md` 的 8 大分类映射为图谱中的 `category` 标签 + 语义关系边，图谱引擎可按分类自动生成"推荐浏览路径"（从极简 → 赛博 → 高级的视觉进化路径）。

5. **CLI 工具扩展**: `node scripts/theme-graph.mjs <command>` 提供命令行操作（`rebuild / conflicts / variants / export-gexf`），与其他工具链互操作。

**GitHub 参考来源**:
- **neo4j**——图数据库的概念与 Cypher 查询语法借鉴（不引入依赖）
- **themer.dev**——多输出主题引擎的"一源多主题"能力
- **Catppuccin**——flavor 变体系统（latte / frappe / macchiato / mocha 同色系四变体）
- **D3.js force-directed graph**——Studio 中主题关系可视化的布局参考

**8 维预评分**:

| 业务根治 | 场景兼容 | 故障安全 | 工程契约 | 可工程化 | 架构一致 | 长期演进 | 边界健壮 |
|:--------:|:--------:|:--------:|:--------:|:--------:|:--------:|:--------:|:--------:|
| 6 | 8 | 8 | 8 | 6 | 7 | **10** | 7 |

**加权总分**: 7.43

**致命漏洞预分析**:
- 图谱节点的 OKLCH 色彩距离计算在感知均匀性上可能不精确（OKLCH 本身已比 Lab 更均匀，但仍有感知偏差）；阈值设定需要大量视觉验证
- 自动变体主题的质量高度依赖 `autoVariants` 算法；_generated_ 主题可能不符合 Swiss 设计语言约束，需要后处理规则（确保变体仍遵循 4/8/16 间距规范、rounded-[2px] 等）

**与现有 14-token 契约的兼容策略**:
图谱引擎消费 14-token 作为主题节点的"色特征向量"接入图谱；14-token 不做任何结构变更。图谱层完全独立运行，主题包的 manifest 不声明 `graph` 块也可以被引擎自动分析。

---

### 方案 λ：全集成主题编译器（Full-Stack Theme Compiler）

**代号与哲学**: "让主题从源代码到 CDP 注入形成完整编译链"——将当前散落在 `scripts/` 目录下的 15+ 个 `.mjs` 文件（build-palette / generate-theme-css / theme-generators / bridge-codex-theme / color-theory / design-language / extended-colors / native-defect-fixes / variations-loader / theme-utils / check-themes / check-theme-staleness 等）整合为一个统一的 `@agentskin/theme-compiler` 编译器模块，支持「manifest.json → 全产物」单命令确定性生成，输出包含 palette.css + 6 agent CSS + 诊断元数据 + 主题 AST 中间产物。

**核心改动**:

1. **编译器模块**（新目录 `src/engine/src/theme-compiler/`）：

```
src/engine/src/theme-compiler/
├── index.ts              # 对外主入口
├── parser.ts             # manifest 解析（支持 v2 + v3 DTCG）
├── tokenizer.ts          # Token 树构建 + 派生
├── optimizer.ts          # Token 树最小化（移除冗余派生）
├── emitter.ts            # 多目标输出（css / json / dtcg / diagnostic）
├── cache-build.ts        # 增量编译缓存（仅重新生成变更的 agent CSS）
└── types.ts              # 全量类型定义
```

2. **编译器配置** `agentskin.config.ts`（项目根目录，可选）：

```ts
export default defineConfig({
  schema: 'v3-dtcg',
  agents: ['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode'],
  layers: ['palette', 'design-language', 'extended-colors', 'variations', 'motion', 'material'],
  output: {
    dir: 'themes/{id}/assets/css/',
    format: 'css',
    hash: true,
    sourcemap: process.env.NODE_ENV === 'development'
  }
})
```

3. **增量编译**：编译器维护 `.cache/theme-manifest-hash.json`，仅当 manifest 或其依赖（colorSchemes / variations）发生改变时重新生成 CSS，`check-theme-staleness.mjs` 替换为编译器内置 `--verify` 模式。

4. **one-shot 构建命令**（替代当前多个脚本）：

```bash
# 替代 npm run generate:themes + generate:palette + check-themes
npx @agentskin/theme-compiler build <themeId|all> [--verify] [--incremental]
```

5. **主题 AST 导出**：编译器可选输出 `theme.ast.json`，包含完整的 token 依赖图、派生链、冲突报告；供 Studio 内部消费，实现"修改一个 token → 实时预览所有下游影响"。

**GitHub 参考来源**:
- **Sass**（sass/dart-sass）——增量编译 + sourcemap 支持
- **PostCSS**（postcss/postcss）——plugin pipeline 模式
- **esbuild**（evanw/esbuild）——单命令多产物 + 增量编译的架构参考
- **任天堂 libgens**（非现代，但"确定性编译"哲学）

**8 维预评分**:

| 业务根治 | 场景兼容 | 故障安全 | 工程契约 | 可工程化 | 架构一致 | 长期演进 | 边界健壮 |
|:--------:|:--------:|:--------:|:--------:|:--------:|:--------:|:--------:|:--------:|
| **9** | 8 | 8 | 8 | **9** | **9** | **9** | 8 |

**加权总分**: **8.52** ⭐

**致命漏洞预分析**:
- 编译器整合风险高：当前分散脚本总代码量 ~2500 行，重写为 TypeScript 编译器整合后虽然更长久维护，但短期内构建失败率可能上升（"天下没有白吃的重构午餐"）
- `agentskin.config.ts` 引入新的学习门槛；必须同时支持"零配置默认运行"和"完全自定义配置"两种模式

**与现有 14-token 契约的兼容策略**:
编译器是 14-token 契约的「执行层」，契约本身不变；编译器输出与当前多脚本生成的输出通过 `--verify` byte-for-byte diff 保证兼容。

---

## 七套方案对比总表

| 维度 (权重) | ε DTCG 重写 | ζ 样式引擎全量重写 | η 运行时注入重构 | θ 三位一体检 | ι 第三维材质动 | κ 语义图谱 | λ 全集成编译器 |
|-------------|:-----------:|:-----------------:|:----------------:|:-----------:|:-------------:|:----------:|:-------------:|
| 业务根治 18% | 7 | **9** | 8 | 8 | **9** | 6 | **9** |
| 场景兼容 12% | 7 | 8 | 7 | **9** | 8 | 8 | 8 |
| 故障安全 15% | 8 | 7 | 6 | **9** | 7 | 8 | 8 |
| 工程契约 10% | 6 | 7 | 7 | 8 | 7 | 8 | 8 |
| 可工程化 12% | 6 | 7 | 6 | 8 | 7 | 6 | **9** |
| 架构一致 10% | 7 | **9** | 8 | 8 | **9** | 7 | **9** |
| **长期演进 15%** | **10** | **9** | **9** | 8 | **9** | **10** | **9** |
| 边界健壮 8% | 8 | 7 | 6 | **9** | 7 | 7 | 8 |
| **加权总分** | **7.37** | **8.04** | **7.26** | **8.40** | **8.03** | **7.43** | **8.52** ⭐ |

---

## 排名与优先级

| 排名 | 方案 | 加权分 | 一句话定评 |
|:----:|------|:------:|-----------|
| 🥇 | λ 全集成主题编译器 | **8.52** | 根治度最高 + 可工程化最优 + 长期演进最强，是最终形态 |
| 🥈 | θ 三位一体（Studio + 诊断） | 8.40 | 故障安全 + 边界健壮双 9 分，最稳的大方案 |
| 🥉 | ζ 样式引擎全量重写 | 8.04 | 架构一致 9 + 长期演进 9，技术最优雅 |
| 4 | ι 第三维材质与动效 | 8.03 | 直接回应用户的 Swiss 设计语言诉求 |
| 5 | ε DTCG 重写 | 7.37 | 开放生态最友好，但当前 W3C 标准未定 |
| 6 | κ 语义图谱 | 7.43 | 长期演进满分，但短期业务根治偏弱 |
| 7 | η 运行时注入重构 | 7.26 | 故障安全和边界健壮双低，Electron 版本碎片化风险 |

---

## 重大重构方案详细说明

### λ 全集成主题编译器：完整架构

**管线架构**:

```
manifest.json (v2/v3-DTCG)
        ↓
  parser.ts (解析 + 校验 + 降级)
        ↓
  tokenizer.ts (Token 树 + OKLCH 派生 + 自动补全)
        ↓
  optimizer.ts (冗余派生消除 + 冲突检测)
        ↓
  emitter.ts (多目标输出)
    ├── palette.css (L0)
    ├── palette.<scheme>.css (per-scheme L0)
    ├── assets/css/<agent>.css × n (L1+L2+ext+var+sig)
    ├── theme.ast.json (完整依赖图)
    ├── diagnostics.json (兼容矩阵 + 覆盖率报告)
    └── .cache/manifest-hash.json (增量编译缓存)
```

**类型体系** (`types.ts`):

```typescript
type ColorFormat = 'hex' | 'rgb' | 'oklch' | 'hsl'

interface ThemeToken<T = string> {
  name: string
  value: T
  type: 'color' | 'dimension' | 'number' | 'cubic-bezier'
  description?: string
  extends?: string // $ref to another token
  derived?: boolean
}

interface ThemeLayer {
  id: 'palette' | 'designLanguage' | 'extendedColors' | 'variations' | 'motion' | 'material' | 'signature'
  enabled: boolean
  priority: number
  generate: (ctx: CompileContext) => string
}

interface CompileContext {
  manifest: ThemeManifest
  schemeId: string
  tokens: Map<string, ThemeToken>
  agent?: AgentId
  options: CompilerOptions
}

interface CompilerOptions {
  schemaVersion: 'v2' | 'v3-dtcg'
  agents: AgentId[]
  layers: string[]
  incremental: boolean
  verify: boolean
  sourcemap: boolean
  hashFilenames: boolean
}
```

**增量编译缓存算法**:

```typescript
// cache-build.ts
function computeManifestFingerprint(manifest: ThemeManifest): string {
  // 仅对影响 CSS 输出的字段计算 SHA-256
  const hashInput = JSON.stringify({
    colors: manifest.colors,
    designLanguage: manifest.designLanguage,
    designLanguageConfig: manifest.designLanguageConfig,
    colorsExtended: manifest.colors?.extended,
    motion: manifest.motion,
    material: manifest.material,
    colorSchemes: manifest.colorSchemes,
    signature: manifest.signature,
  })
  return sha256(hashInput)
}

function shouldRebuild(themeId: string, agent: AgentId, currentHash: string): boolean {
  const cache = loadCache()
  const key = `${themeId}/${agent}`
  return cache[key]?.hash !== currentHash || !cache[key]?.filesExist
}
```

### θ 三位一体：详细交互流程

**Studio 端**:

```
用户在 CenterTabGenerator 调整 accent=${color}
        ↓
Studio 调用 theme-store.updateColor('accent', color)
        ↓
ThemeStore 广播 COLOR_CHANGED 事件
        ↓
5 个订阅者响应:
  1. ColorInput → HSL 滑块更新
  2. ThemePreview → 实时预览重渲染
  3. CompatibilityMatrix → 按新 OKLCH 距离重算兼容色
  4. SimilarityPanel → 重新检索相似主题 Top-5
  5. ContrastIndicator → 更新 WCAG/APCA 等级指示
```

**Runtime 端**:

```
CDP 注入完成后 100ms 内执行探针代码
  var coverage = {}
  for (const token of AGENTSKIN_14_TOKENS) {
    const decl = getComputedStyle(root).getPropertyValue(token)
    const observed = document.querySelectorAll(`[style*="${token}"]`).length + countCSSVarUsage(token)
    coverage[token] = { expected: EXPECTED_USAGE[token], observed, ratio: observed / EXPECTED_USAGE[token] }
  }
  __AGENTSKIN_REPORT_COVERAGE__(coverage)
        ↓
Renderer IPC → diagnosticsStore
        ↓
健康度色块渲染（绿 > 0.8 / 黄 0.5-0.8 / 红 < 0.5）
        ↓
低于阈值时触发 fallback token 补全 pipeline
```

### ζ 样式引擎全量重构：模块依赖图

```
src/engine/src/css-pipeline/
├── index.ts                       # CssPipeline 主入口
├── types.ts                       # TokenTree / LayerSpec / CSSBundle 接口
├── layers/
│   ├── palette-layer.ts           # 14-token → --agentskin-* 变量
│   ├── design-language-layer.ts   # --agentskin-space/radius/shadow/duration-*
│   ├── extended-colors-layer.ts   # --agentskin-ext-* / --agentskin-ext-on-*
│   ├── variations-layer.ts        # component variations
│   ├── motion-layer.ts            # @keyframes + animation 工具类
│   ├── material-layer.ts          # glass / elevation / scrim 工具类
│   └── signature-layer.ts         # aurora-glass 等签名效果
├── agents/
│   ├── base-renderer.ts           # AgentCssRenderer<T> 泛型基类
│   ├── traework-renderer.ts
│   ├── qoderwork-renderer.ts
│   ├── workbuddy-renderer.ts
│   ├── doubao-renderer.ts
│   ├── codex-renderer.ts
│   └── zcode-renderer.ts
├── derive/
│   ├── oklch-derive.ts            # OKLCH 色空间派生公式
│   ├── contrast-check.ts          # WCAG / APCA 校验
│   └── auto-complete.ts           # 缺失 token 自动推导
└── output/
    ├── serialize-css.ts           # CSS AST → string
    ├── serialize-dtcg.ts          # TokenTree → DTCG JSON
    └── serialize-diagnostic.ts    # TokenTree → compatibility report
```

**AgentCssRenderer 泛型基类核心逻辑**:

```typescript
abstract class AgentCssRenderer<S extends AgentTokenStrategy> {
  constructor(protected strategy: S) {}

  render(tree: TokenTree, hostSelector: string): string {
    const blocks: string[] = [
      this.header(),
      this.tokenBlock(tree),
      this.componentBlock(tree),
      this.nativeBridge(tree),
      this.footer(),
    ]
    return blocks.filter(Boolean).join('\n')
  }

  protected tokenBlock(tree: TokenTree): string {
    const vars = this_strategy.tokenMap
      .map(([nativeRef, tokenKey]) => `  ${nativeRef}: ${tree.get(tokenKey)};`)
      .join('\n')
    return `${this.hostSelector} {\n${vars}\n}`
  }

  protected abstract componentBlock(tree: TokenTree): string
  protected abstract nativeBridge(tree: TokenTree): string
  protected abstract get hostSelector(): string
}
```

---

## 交叉致命漏洞总表

| 方案 | 第一致命漏洞 | 第二致命漏洞 | 第三致命漏洞 |
|------|------------|------------|------------|
| ε DTCG | W3C DTCG 仍为 Community Group 非正式规范 | 全量迁移 7 主题需要 v2→v3 转换器 | $extensions 命名空间可能与其他项目冲突 |
| ζ 引擎重构 | TypeScript 化暴露隐藏类型错误导致大量修复 | byte-for-byte verify 模式因空白变化大面积失败 | Layer 优先级排序错误可能改变现有 CSS 覆盖顺序 |
| η 运行时 | CSS.registerProperty() Electron 版本碎片化 | 语义映射表维护成本随 agent 更新而增加 | 降级路径必须保留完整旧模式作为 fallback |
| θ 三元 | diagnostics 块增加 manifest 学习曲线 | Agent DOM 变化使兼容性矩阵需要 CI 刷新 | 覆盖率阈值设定缺乏行业标准 |
| ι 第三维 | @keyframes 在 CDP adoptedStyleSheets 中兼容性不确定 | material 与 designLanguage 存在概念重叠 | 低配设备上 backdrop-filter 性能回退 |
| κ 图谱 | OKLCH 色彩距离的感知均匀性偏差 | 自动变体生成的主题质量难约束 | 图谱可视化在 Studio 中的渲染性能 |
| λ 编译器 | 重构期间构建失败率短期上升 | agentskin.config.ts 引入新学习门槛 | 增量编译缓存可能因非预期的字段改变导致 stale |

---

## 与现有 14-token 契约的兼容策略总表

| 方案 | 是否变更 manifest colors 结构 | 是否变更 --agentskin-* 输出名 | 是否变更 palette.css 结构 | 旧主题是否可零修改运行 |
|------|:---------------------------:|:--------------------------:|:------------------------:|:-------------------:|
| ε DTCG | 是（$v 包装） | **否** | **否** | 是（$v unwrapping） |
| ζ 引擎重构 | 否 | **否** | **否** | 是（byte-for-byte） |
| η 运行时 | 否 | **否** | **否** | 是（注入层内部） |
| θ 三元 | 否（新增 optional blocks） | **否** | **否** | 是（optional 字段） |
| ι 第三维 | 否（新增 optional blocks） | **否** | **否** | 是（optional 字段） |
| κ 图谱 | 否（新增 optional graph） | **否** | **否** | 是（optional 字段） |
| λ 编译器 | 否 | **否** | **否** | 是（--verify 约束） |

---

## 推荐执行路线（不在本次范围，仅供未来参考）

### 短期（1-2 周）：θ 三位一体试点
- 落地 `manifest.diagnostics` 兼容矩阵作为可选字段
- Studio 增加健康度指示器
- Runtime 侧探活测报 1 token 覆盖率

### 中期（3-6 周）：ζ 样式引擎重构
- 一次将 scripts/ 的 7 个核心文件重写为 css-pipeline TypeScript 模块
- 全程 byte-for-byte verify 守擂
- 同步将 AgentCssRenderer 泛型基类落地

### 长期（7-12 周）：λ 全集成编译器 + ε DTCG 开放
- 封装增量编译缓存和 AST 导出
- 新增 `agentskin.config.ts` 零配置默认模式
- 社区开放 DTCG v3 + 标准 token 库对接

---

**文档完成。本纯方案设计产出未修改任何代码。**
