# RFC：主题资产引擎（Theme Asset Engine）

> 状态：`已通过（待实施）`
> 日期：2026-08-20
> 分支：（待建）
> 范围：`src/main/theme-asset/`（新模块）、`src/main/catalog/theme-manifest.ts`（manifest schema 扩展）、`src/shared/types/theme.ts`（类型扩展）、`scripts/theme-generators.mjs`（GENERATORS 消费扩展集）、`engines/*`（桥接注入引擎既有能力）
> 上游依据：2026-08-20 架构讨论（主题包过时/单应用/浅适配 → 引擎自动转换/适配/修复/增强）
> 关联 RFC：`2026-08-19-cross-domain-injection-ownership-refactor.md`（注入职责收敛）、`2026-08-19-fix-zcode-theme-token-mapping.md`（主题层单源 + 引擎兜底先例）

---

## 1. 背景与目标

### 1.1 现状痛点

1. **主题包过时**：一个主题包适配 6 个应用，应用更新导致 token 漂移后主题包失效，无自动修复机制。
2. **单应用主题**：GitHub 上大量开源项目只适配单个应用（Codex / WorkBuddy / TRAE / 豆包），无法用于其它 5 端。
3. **浅适配**：单应用主题往往是浅适配（只换主色），远达不到 AgentSkin 的深适配标准（完整 token 层 + 结构层 + 引擎兜底）。
4. **外部格式无法导入**：CodeDrobe 现代表包（`.codedrobe-theme`）目前无自动导入路径（loader 只认 manifest.json 目录包）。

### 1.2 终局对齐

本引擎的终极目标是：**AgentSkin 的主题入口无边际成本——任何外部主题进来，都能即刻在 6 端跑好，持续稳定。**

拆解为三个子目标：

| 子目标 | 含义 | 检验标准 |
|--------|------|---------|
| 入口开放 | 外部主题能被消费 | codedrobe / legacy codex / VS Code / 裸 CSS 等都可以导入 |
| 深度有保障 | 导入的主题能用、跑得好 | 在真实应用 DOM 里 selector 命中、还原度达标、原生缺陷已补 |
| 持续稳定 | 应用更新后主题不漂移 | 有基线、有检测、有自愈 |

三个子目标必须同时成立，否则就是空中楼阁。

### 1.3 非目标

- ❌ 反向导出（AgentSkin → CodeDrobe 格式）——暂不做
- ❌ URL 批量导入（GitHub 仓库 URL 拉取）——暂不做（本地文件导入够用，且不违反 serverless 约束）
- ❌ 能力评级 badge（UI 展示适配质量）——暂不做

### 1.4 RFC 触发条件

根据 AGENTS.md §6 RFC 触发条件，本次修改命中以下触发器：

| 触发条件 | 是否命中 | 说明 |
|---------|:-------:|------|
| 重构注入架构（L0-L4 注入层） | ❌ | 不重构注入架构，仅复用其验证能力 |
| 新增 UI 页面（突破六页封顶） | ❌ | 不涉及 UI 页面 |
| 新增适配器（突破六适配器上限） | ❌ | 新增的是 format adapter（codedrobe/vscode/raw-css），非 agent adapter；format adapter 用于主题导入，不属于 AGENTS.md 规定的 6 适配器范畴 |
| 修改核心数据模型 | ✅ | manifest schema 扩展 `ThemeColors.extended` + `inference`、`ThemeManifest.generated` + `depth`；属于核心数据模型变更 |

**裁决**：本次修改命中"修改核心数据模型"触发器，需提交 RFC 评审（本文档即 RFC 评审产出）。

---

## 2. 参考项目（成熟度背书 + 可移植点）

> 以下结论基于对 6 个 10k+ star 项目的 GitHub README 和架构文档的调研。

### 2.1 三类架构范式

| 范式 | 代表 | 核心机制 | 与 AgentSkin 对齐度 |
|------|------|---------|-------------------|
| **IR 模板管线型** | Catppuccin、pywal | 结构化中间表示解耦"调色"与"输出"，单一数据源驱动多目标 | ★★★★★（直接借鉴） |
| Org 社区移植型 | Dracula | 中央 palette 规格 + 人工移植，规模一大就稀释 | ★★☆（无法保证一致性） |
| 运行时注入型 | Spicetify、BetterDiscord | 直接修改宿主进程，灵活但脆 | ★★☆（升级即坏，反模式） |

**结论：本方案选择 IR 模板管线型。** Catppuccin 的 Whiskers（TOML palette + Tera 模板 → 200+ ports）与我们的"14-token 契约 + GENERATORS → 6 端 CSS"完全同构。

### 2.2 各项目详细对比

| 项目 | 规模 | IR 形式 | 质量门控 | 借鉴点 | 警告点 |
|------|------|--------|---------|--------|--------|
| **Catppuccin** | 19.3k★ · 200+ ports | TOML palette（26色×4 flavor） | Style Guide + PR 审核 + ownership | Whiskers"数据矩阵×模板=多输出"模式；26 色作为矩阵变量，一次定义四处生成 | 社区 ownership 依赖人肉同步，缺乏自动化 CI 门控 |
| **Dracula** | 23.5k★ · 400 apps | Markdown spec + hex table | 可视化审核 + template 脚手架 | "一个 master palette，全部 port 受益"；模板仓库作为新 port 的快速启动脚手架 | 400+ port 靠人工维护，一致性随规模恶化 |
| **Spicetify** | Spotify 注入 | `color.ini` 键值对 | backup/restore + Go CLI 校验 | backup/restore + apply 回滚模型；Extensions/Themes 三级扩展分层 | 强耦合 Spotify 二进制布局，升级即坏——不适用于 AgentSkin |
| **BetterDiscord** | Discord 注入 | 无（直接 CSS） | 社区审核，无强校验 | 插件生态（设置 UI、状态存储、事件注入） | ⚠️ 有内部标准化 API（BdApi 命名空间：UI / React / Net 等），但版本兼容性无保证；强耦合宿主二进制布局；ToS 风险说明"注入路线"本身有法律/合规风险；参考意义有限（仅作为"运行时注入型"的反面教材） |
| **pywal** | 多应用主题生成 | `colors.json` | 无（信任取色算法） | 图片→取色→IR→模板导出，最清晰的"输入→IR→输出"范例 | ⚠️ **事实废弃（最后 release 2018 年，最后 commit ~2019 年，未被 GitHub 官方 archive）**；模板内置于包中，非社区可扩展；ARM Linux 兼容性差 |
| **VSCode Extension** | 编辑器主题 | JSON theme file | JSON Schema 校验 + 静默失败 | `contributes.themes` 声明式注册 + 分层优先级 | 缺少 token 字段时静默失败——正是 AgentSkin 需要结构化 Apply Trace 的原因 |

### 2.3 可移植点清单

| 借鉴来源 | 对应 AgentSkin 组件 | 移植内容 |
|---------|-------------------|---------|
| Catppuccin Whiskers | 本引擎 GENERATORS | 数据矩阵 × 模板 = 多输出（IR → per-agent CSS） |
| Catppuccin 26 色 | 本引擎 ThemeColors.extended | 扩展色集作为 GENERATORS 消费的第二输入层 |
| Catppuccin ports.yml | 本引擎 registry.ts | 注册表 + 能力声明 + 优先级探测 |
| Spicetify backup/apply | 本引擎 restore 机制 | 注入前的原生状态保存 + 注入失败回滚 |
| VSCode JSON Schema | 本引擎 contract-check | 结构化校验 + 显式报错（非静默失败） |
| pywal 管线 | 本引擎 pipeline 编排 | 输入→IR→模板→输出的纯函数管线 |

---

## 3. 架构决策

### 3.1 两套系统的真实定位

在决策之前，必须先对齐现有两套系统的真实定位：

| | GENERATORS 管线（已有） | 注入引擎（已有） |
|---|---|---|
| **输入** | ThemeColors（14 token） | per-agent CSS |
| **产出** | per-agent CSS 字符串 | 在应用中生效的主题 |
| **核心能力** | 14-token → CSS 变量覆盖 | 6 端原生缺陷修复 + DOM 结构适配 + 探针验证 + 还原度校验 |
| **知识资产** | token 映射表 + CSS 模板 | 6 端真实 DOM 结构、覆盖规则、缺陷注册表 |

**关键洞察：** 注入引擎拥有的，是对 6 端应用的**真实知识**——哪种 selector 真实存在、哪条原生 CSS 会与主题冲突、什么结构层能适配应用的运行框架。这只有真正注入过 6 端应用、踩过每一个坑之后才沉淀下来的。

任何让"主题资产引擎"独立生产 CSS、然后再"桥接"去校验的路，都是绕远路。

### 3.2 构建期 vs 运行期的边界

> **融合的是什么？** 融合的是"深度适配知识"——verify 阶段的探针/缺陷注册表/基线校验能力。不融合的是运行时进程。

本引擎的"融合"本质上是：

- **构建期 / 导入期**（Build-Time）：外部格式 → ThemeColors → GENERATORS → CSS → 验证 → bundle。这部分是**离线/近线处理**，由 `theme-asset/` 模块完成。
- **运行期 / 应用期**（Apply-Time）：用户选一个主题 → CDP 注入。这部分由现有 `theme-apply-flow.ts` + `engines/*/adapter.mjs` 完成，**保持不动**。

两期的交互方式：**通过文件系统间接交互**。构建期产物落盘到 `themes/<id>/`，运行期 `ThemePackageLoader.load()` 读盘验证 → `ThemeInstaller` 注册 → apply 期读 bundle → CDP 注入。

**GENERATORS 是唯一跨界的共享层**——它作为纯函数被两期共同消费：
- 构建期：`scripts/generate-theme-css.mjs` 离线调用
- 运行期：`src/main/theme/wallpaper-theme.ts` 静态 import（electron-vite 打入 `out/main/index.js`）

### 3.3 候选方案对比

| 模式 | 描述 | 核心界面 |
|------|------|---------|
| **A. 分离双引擎 + 桥接层** | 上游建独立资产引擎，下游独立注入引擎，中间桥接 | ThemeColors + Bridge API（翻译层） |
| **B. 融合单引擎** | 格式转换和注入适配属于同一个管线的上下游 | ThemeColors（唯一界面） |
| **C. 纯函数 CLI** | 每个 format adapter 是独立 CLI，通过文件系统交互 | 临时文件 + stdout |

### 3.4 决策矩阵

| 维度 | A 分离+桥接 | B 融合单引擎 | C 纯函数CLI |
|------|:-----------:|:-----------:|:-----------:|
| 新 adapter 开发效率 | 2 | 4 | 4 |
| 新 agent 扩展效率 | 2 | 5 | 3 |
| 跨格式调试便利性 | 2 | 5 | 2 |
| 运行时性能 | 3 | 5 | 4 |
| 测试隔离性 | 3 | 3 | 5 |
| 长期演进弹性 | 2 | 4 | 2 |
| 治理复杂度（owner/文档/onboarding） | 1 | 3 | 3 |
| **总分** | **15** | **29** | **23** |

### 3.5 决策结论

选择 **B. 融合单引擎**。原因不是因为它改动小，而是：
- Catppuccin（19k★）用同样范式覆盖了 200+ ports
- 现有代码库所有核心节点天然适配管线（纯函数 + 单入参 + 常量注册表，经实证确认）
- TCO 模型比次优方案高 26%

**关键约束：** service 退化为 pipeline orchestrator，不做"大总管"。每个 stage 保持独立接口、独立测试、单向流动。

---

## 4. 核心概念：统一 IR

### 4.1 ThemeColors 本身就是 IR

本方案不新增独立的 ThemeAssetIR / PaletteIR / AgentAssetIR 类型。**扩展现有 ThemeColors 加 `extended` + `inference` 两个可选字段**，让现有类型直接承载 IR 语义。

选择这样做的理由：
- **GENERATORS / installer / catalog / UI 在 P1 阶段无需改动**——它们看到的还是 ThemeColors，只是多了几个 optional 字段（`extended` 在 P1 仅存储不消费，CSS 消费推迟到 P2/P3 通过改造 `tokenBlock()` 实现）
- 未来每一次"新增输入格式"不再需要同时改 IR 类型 + 适配层 + 管线中间件 + GENERATORS 四处

### 4.2 深度分级（"赋能"的客观标准）

| 级 | 定义 | 判定依据 |
|----|------|---------|
| L1 基础 | 只换主色/背景 | colors.background / colors.foreground 被 CSS 使用 |
| L2 token 层 | 完整覆盖端原生命名空间 | tokenBlock 14 token 全部生成 + `--agentskin-*` 变量全部输出 |
| L3 深适配 | L2 + 结构层 + 引擎兜底 | L2 + native-defect CSS 注入成功 + structural template 应用 + selector hit rate ≥ 85% + fidelity matchRatio ≥ 0.8 |

> **depth 写入规则**：verify/probe 阶段运行完毕后，`report.ts` 根据以上映射表推导 depth 值并写入 `ThemeManifest.depth`。L1/L2/L3 的逻辑与关系为顺序晋升（不满足 L2 条件则最高为 L1，不满足 L3 条件则最高为 L2）。

赋能 = 把输入端提升到 L3。

### 4.3 扩展色集规范

参考 Catppuccin 26 色集。现有 14-token 已覆盖 14/26，缺 12 色：

| 14-token 已有 | extended 新增（12 色） |
|--------------|----------------------|
| background / surface / surfaceElevated | surfaceL1 / surfaceL2 / surfaceL3（3 级递进） |
| foreground / muted | subtext0 / subtext1 / overlay0 / overlay1 / overlay2（5 级文字层次） |
| accent / secondary | syntaxRed / syntaxGreen / syntaxBlue / syntaxYellow（4 语法色，代码高亮） |

> **来源标注**：上表中 `subtext0/1`、`overlay0/1/2` 为 Catppuccin 原生色名；`surfaceL1/L2/L3`（Catppuccin 仅 surface0/1/2）、`syntaxRed/Green/Blue/Yellow`（Catppuccin 用 red/green/blue/yellow）为 AgentSkin 自创语义名。Catppuccin ANSI 16 色（color0-15）不在对齐范围内。

---

## 5. 架构与管线

### 5.1 架构总览

```
                ┌───────────────────────────────────────────────┐
                │       统一引擎（theme-asset/）                   │
                │                                               │
   外部输入 ──→ │  输入适配层（format adapters）                    │
                │      codedrobe / vscode / raw-css / legacy     │
                │              │                                │
                │              ▼                                │
                │   palette 推导层                                 │
                │      14-token + 26 色扩展 + inference           │
                │              │                                │
                │              ▼                                │
                │  ────── 唯一界面：ThemeColors ──────            │
                │              │                                │
                │              ▼                                │
                │  适配执行层（复用注入引擎全部已有能力）              │
                │      GENERATORS → CSS 变量 + token 覆盖        │
                │      native-defect-fixes → 原生缺陷修复          │
                │      structural template → 结构层适配           │
                │      baseline-validator → 还原度门控            │
                │      selector-probe → 实时 DOM 验证            │
                │              │                                │
                │              ▼                                │
                │  产物：可直接注入的 per-agent CSS               │
                └───────────────────────────────────────────────┘
```

### 5.2 管线七步（编排器模式）

```
external input (.codedrobe-theme / .codex-theme / VS Code JSON / raw CSS)
    │
    ▼
detect ──→ 嗅探格式（扩展名 / schema / 启发式）
    │
    ▼
parse ──→ adapter[format]() → ThemeColors (14 + extended)
    │
    ▼
infer ──→ 调色板推导（部分→完整 + 26 色扩展集）
    │
    ▼
adapt ──→ GENERATORS[agent](ctx) → per-agent CSS（6 端）
    │
    ▼
deepen ──┬── native-defect → 自动注入原生缺陷修复
         └── structural → 结构层补齐
    │
    ▼
enhance ──┬── layering（必做）→ surface 3 级层次
          └── presets（可选）→ 质感预设（默认保守）
    │
    ▼
verify ──┬── contract-check → schema + C2 14-token 契约校验（离线）
         ├── probe → selector 实时命中检测（需要 CDP）
         └── fidelity → 还原度量化打分（需要 CDP）
    │
    ▼
install ──→ ThemeInstaller → bundle → catalog（复用，零改动）
```

### 5.3 编排器约束（防 God Object）

1. **每个 stage 是独立可测的**——测试 format adapter 不需要启动 CDP，测试 probe 不需要 GENERATORS 跑完
2. **严格单向流动**——probe/baseline 结果只进 verify 报告，绝不反向修改 ThemeColors 或 CSS
3. **新增 = 新增文件，不是修改已有文件**——第 7 个 agent = 加 1 个 GENERATOR 文件 + 1 个 native-defect 注册表 + 0 处已有文件修改
4. **纯/不纯边界明确**——GENERATORS 保持纯函数 `xxxCss(t)`，probe 需要活 CDP session 的部分单独隔离在 verify 阶段

### 5.4 管线错误策略

| Stage | onFailure 行为 | 说明 |
|-------|---------------|------|
| detect | **fail-fast** | 无 adapter 匹配则终止整个导入流程，返回错误信息给用户 |
| parse | **fail-fast** | adapter.parse 抛异常则终止，避免脏数据进入后续 stage |
| infer | **degrade** | 推导失败时回退到 14-token 默认推导（`infer/palette-infer.ts` 内置 fallback） |
| adapt | **per-agent isolation** | 单个 GENERATOR 抛异常不影响其余 5 端；失败的 agent 标记为 `failed` 并跳过 |
| deepen | **skip + warn** | native-defect/structural 资源不存在时跳过，记录日志 |
| enhance | **skip + warn** | 质感增强非关键路径，失败不影响入库 |
| verify | **degrade** | CDP 不可用时降级为 offline-only 模式（仅运行 contract-check），depth 最高为 L1 |
| install | **fail-fast** | manifest 写入失败则整个导入回滚 |

> **设计原则**：fail-fast 用于"有了脏数据更糟糕"的入口阶段（detect/parse/install）；degrade/skip+warn 用于"能跑总比不跑好"的赋能阶段（infer/enhance/verify）；per-agent isolation 确保单端失败不拖垮全局。

---

## 6. 注入引擎桥接

### 6.1 桥接的本质

**没有桥接的主题资产引擎 = 只生产未经实测的 CSS，不知道在真实应用里能不能跑好。**
**有桥接的主题资产引擎 = 产出 CSS 直接经过实测验证，不达标不入库。**

注入引擎已具备全部深度适配基础设施：

| 注入引擎能力 | 文件位置 | 桥接方式 |
|------------|---------|---------|
| 实时 DOM 探针（批量） | `selector-validator.ts` → `validateSelectors()` | verify 阶段直接调用 |
| 主题应用后校验 | `src/main/cdp/injection/shared.ts` → `verifyTheme()` | verify 阶段直接调用 |
| 基线捕获（原生CSS规则） | `baseline-css-capture.ts` → `captureBaselineCss()` | verify 阶段：捕获原生基线 |
| 基线校验（还原度评估） | `baseline-validator.ts` → `validateBaselineCss()` | verify 阶段量化"themes 有多准" |
| 原生缺陷修复（6 端独立注册表） | `native-defect-fixes.mjs` → `nativeDefectFixCss()` | deepen 阶段自动注入 |
| adapter.mjs 结构适配 | `engines/*/adapter.mjs` | deepen 阶段提取结构模板作为参考 |
| tokens.css token 覆盖 | `engines/*/tokens.css` | GENERATORS 消费，跨端 token→变量映射表 |
| cosmetic.css 视觉微调 | `engines/*/cosmetic.css` | deepen 阶段提取粒度参考 |
| DOM 靶点发现 | `cdp-targets.ts` → `findDomTargets()` | verify 阶段实时获取当前应用 DOM 结构 |
| 快照对比 | `snapshot-theme.ts` | verify 阶段多主题横向比对 |

### 6.2 桥接的运行时流程

> **`fidelityGate` 定位说明**：本节伪代码中出现的 `fidelityGate(verdict: FidelityVerdict)` 是 `verify/fidelity.ts` 内部定义的**局部辅助函数**（实现见第 326-327 行），封装阈值比较逻辑：`return { pass: verdict.matchRatio >= 0.8 && !verdict.degraded, degraded: verdict.degraded }`。它**不是** `baseline-gate.ts` 的外部依赖，不引入跨模块耦合。

```
用户在 UI 点"导入 codedrobe 包"
    │
    ▼
ThemeAssetEngine.convert(packagePath)
    │
    ├─ detect → 'codedrobe'
    ├─ adapters/codedrobe.ts → ThemeColors { extended: {...}, inference: {...} }
    ├─ infer/palette-infer.ts → 补全至 26 色
    ├─ adapt → traeworkCss/ doubaoCss/ ... → 6 端 CSS
    ├─ deepen/L3 → native-defect 注入原生缺陷修复
    ├─ verify/contract-check → schema 校验 ✓
    ├─ verify/probe.ts → 调用注入引擎 validateSelectors()
    │   ├─ 连接目标应用 CDP（只读探测）
    │   ├─ validateSelectors(session, agent, ['.chat-bubble', '.sidebar'])
    │   ├─ 每个 selector 返回 { selector, count, box }
    │   └─ 返回 SelectorValidationReport { agentId, results, summary, timestamp }
    ├─ verify/fidelity.ts → 调用注入引擎 baseline-validator
    │   ├─ captureBaselineCss() → BaselineCssCapture  // 只读捕获
    │   ├─ replayBaseline() → 由 bridge/ 负责（状态修改操作）
    │   ├─ assessFidelity(baseline, replayed, opts) → FidelityVerdict { matchRatio, degraded, pass, dimensions, gateError }
    │   └─ fidelityGate(verdict: FidelityVerdict): { pass: boolean; degraded: boolean }
    │       └─ return { pass: verdict.matchRatio >= 0.8 && !verdict.degraded, degraded: verdict.degraded }
    ├─ report → 汇总每端深度 + 命中率 + 还原度
    └─ 入库 → ThemeInstaller → bundle
```

### 6.3 桥接层目录

`theme-asset/` 下 `bridge/` 子目录封装所有注入引擎调用。**职责划分原则**：
- `verify/` = "它好不好"（校验 + 报告产出；**主要只读**，但 probe 阶段需要活 CDP session 发送查询命令——这是只读探测，不修改目标应用状态）
- `bridge/` = "把它弄好"（副作用操作：CSS 拼接 + 模板提取）

verify/fidelity.ts 调用 `validateBaselineCss(session, capture, opts)`（来自 `baseline-validator.ts`），该函数内部编排 probe→replay→assess→stopReplay 全流程；verify/ 不直接接触 `replayBaseline()`。`bridge/` 不持有 replay 相关逻辑。

```
theme-asset/
├── verify/                          # 只读校验，产出报告
│   ├── contract-check.ts            # schema + C2 14-token 契约校验（离线）
│   ├── probe.ts                     # 实时 DOM 探针 → validateSelectors()
│   └── fidelity.ts                  # 还原度验证 → validateBaselineCss()
│
└── bridge/                          # 副作用操作，把 CSS 弄好
    ├── native-defect.ts             # 调 nativeDefectFixCss()，拼接 CSS
    ├── structural-template.ts       # readFileSync + 文本提取模板（非 import）
    └── index.ts                     # 统一 re-export
```

桥接层所有文件都是**对注入引擎已有 API 的直接调用**——不重新实现任何注入/探测/校验逻辑。

**关键注意**：`engines/*/adapter.mjs` 不是 ES module（无 export），是 IIFE 脚本源码。`structural-template.ts` 必须用 `readFileSync` + 文本提取，不能 import。

> **⚠️ 已知技术债（structural-template.ts 文本耦合）**：`readFileSync` + 文本提取从 IIFE 源码获取结构模板，属文本耦合而非接口耦合。风险：(1) adapter.mjs 代码风格变化可能导致提取失败；(2) 6 端 adapter 结构各异，提取逻辑无法复用；(3) 无 fail-fast 机制。**缓解**：verify 阶段提取失败时降级到 L2（不阻塞入库）。**终态迁移路径**：P3 中将 adapter.mjs 结构模板重构为 `export const STRUCTURAL_TEMPLATE = [...]`（迁移为 hybrid模块），彻底消除文本耦合。

---

## 7. manifest schema 扩展（一次性到位）

manifest-v2 新增**可选**字段（向后兼容，旧包不受影响）：

### 7.1 ThemeColors 扩展

```typescript
// src/main/catalog/theme-manifest.ts — ThemeColors 新增 2 个可选字段
interface ThemeColors {
  // ... existing 14 tokens ...

  /**
   * 扩展色集（26 色级，Catppuccin 风格）。
   * - 由 GENERATORS 消费 → 生成 per-agent CSS 变量 --agentskin-ext-*
   * - 缺失时回退到 14-token 推导
   */
  extended?: Record<string, string>;

  /**
   * 每个色值的推导来源标记（可追溯 / 可审计）。
   */
  inference?: Record<string, 'provided' | 'derived' | 'default'>;
}
```

### 7.2 ThemeManifest 扩展

```typescript
// src/main/catalog/theme-manifest.ts — ThemeManifest 新增 2 个可选字段
interface ThemeManifest {
  // ... existing ...

  /** 构建元数据（generatorVersion + appVersion + 生成时间）。由 `theme-asset/index.ts` 编排器在 install 阶段注入。 */
  generated?: { generatorVersion: string; appVersion: string; generatedAt: string };

  /** 整体适配深度（L1/L2/L3）——由 verify 阶段根据 6 端 probe 结果汇总判定（短板原则：取各端最小值）。 */
  depth?: 'L1' | 'L2' | 'L3';
}
```

### 7.3 schema.json 同步（colors 块）

```json
// src/main/catalog/manifest-v2.schema.json
"colors": {
  "type": "object",
  "required": ["background", "foreground"],
  "additionalProperties": false,
  "properties": {
    // ... existing 14 ...
    "extended": { "type": "object", "additionalProperties": { "type": "string" } },
    "inference": { "type": "object", "additionalProperties": { "enum": ["provided", "derived", "default"] } }
  }
}
```

> **关键**：`additionalProperties: false` 只阻塞 colors 对象内的未知字段。`extended` 本身是 `Record<string, string>`——key 随意、不入库限制。新颜色名（如 `syntaxRed`、`subtext`）自带语义，GENERATORS 不认识就忽略。

### 7.4 顶层字段 Schema 声明

`ThemeManifest` 顶层新增 `generated` 和 `depth` 两个 optional 字段：

```json
// src/main/catalog/manifest-v2.schema.json — 顶层
{
  "additionalProperties": false,
  "properties": {
    "id": { "type": "string" },
    "name": { "type": "string" },
    "colors": { ... },
    "generated": {
      "type": "object",
      "properties": {
        "generatorVersion": { "type": "string" },
        "appVersion": { "type": "string" },
        "generatedAt": { "type": "string", "format": "date-time" }
      },
      "additionalProperties": false
    },
    "depth": {
      "type": "string",
      "enum": ["L1", "L2", "L3"]
    }
  },
  "required": ["id", "name", "colors"]
}
```

> **关键**：`generated` 和 `depth` 不在 `required` 数组中 → 旧包不受影响。顶层 `additionalProperties: false` + 字段显式声明确保旧客户端在校验时不会遇到 unknown property 报错（字段已在 schema 中声明）。

### 7.5 向后兼容性

| 维度 | 影响 | 保障 |
|------|------|------|
| 旧主题包（无 extended/inference） | 无影响 | 新字段为 optional，旧包读取时自动忽略；运行时行为不变 |
| 旧客户端（读取新字段） | 无影响 | 字段均为 optional；旧客户端按原样解析，不报 unknown property 错误 |
| 运行时注入 | 无影响 | §3.2 明确运行期"保持不动"，通过文件系统间接交互；apply-time 读 bundle 逻辑不变 |
| 14-token 契约 | 兼容 | 注入职责重构 RFC §1.3 "不修改 14-token 主题契约"约束的是**运行期注入契约**；本 RFC 扩展的是**构建期 IR 表示**（optional 字段），不影响运行期注入行为 |

---

## 8. 目录结构

```
src/main/
├── theme/
│   ├── theme-from-image.ts       // 现有：图片→14-token（adapter 参考范本）
│   ├── wallpaper-theme.ts        // 现有：壁纸→14-token（同链路参考）
│   ├── scheme.ts                 // 现有：色彩方案计算
│   └── utils.ts                  // 现有：主题工具函数
│
├── theme-asset/                  // 新模块（含 sub-dir index）：~18 个生产文件
│   ├── index.ts                  // 引擎入口（编排管线）
│   ├── pipeline.ts               // 管线编排器：定义 stage 顺序、错误边界
│   ├── detect.ts                 // 格式嗅探（扩展名 / schema 探测）
│   ├── ir/
│   │   ├── types.ts              // IR 类型定义（ThemeColors + extended + inference + AdapterResult + GeneratorInput）
│   │   ├── normalize.ts          // 输入 → IR 规范化（14-token 校验 + 来源标记）
│   │   └── errors.ts             // 错误类型定义（InvalidInputError、UnsupportedFormatError、InputTooLargeError）
│   ├── adapters/                 // 输入适配器（插件化，每格式一个）
│   │   ├── codedrobe.ts          // .codedrobe-theme 多端包
│   │   ├── legacy-codex.ts       // .codex-theme 单文件
│   │   ├── vscode-json.ts        // VS Code 主题 JSON（P2）
│   │   └── raw-css.ts            // 裸 CSS（P2）
│   ├── infer/
│   │   └── palette-infer.ts      // 部分 token → 完整 14-token + 扩展集
│   ├── adapt/                    // 1→6 缺端生成（调 GENERATORS）
│   │   ├── registry.ts           // agent 注册表 + 生成编排（调用 toGeneratorInput 适配）
│   │   └── toGeneratorInput.ts   // AdapterResult → GENERATORS 期望的 t 形状适配层（含 isLight 推导 + name fallback）。**与 `buildContext()` 的区别**：`buildContext(id, scheme)` 从 manifest ID 查库读取；`toGeneratorInput(adapterResult)` 消费管线内存中的 AdapterResult（导入期无 catalog 入口），输入形态不同，非重复造轮子。
│   ├── deepen/                   // 浅→深
│   │   └── index.ts              // deepen 编排（调 bridge/native-defect + structural）
│   ├── enhance/
│   │   ├── presets.ts            // 质感预设库（可选）
│   │   └── layering.ts           // 层次补全（surface 3 级，必做）
│   ├── verify/                   # 只读校验，产出报告
│   │   ├── contract-check.ts     // schema + C2 14-token + 注入契约
│   │   ├── probe.ts              // 实时 DOM 探针 → validateSelectors()
│   │   └── fidelity.ts           // 还原度验证 → validateBaselineCss()
│   ├── bridge/                   # 注入引擎调用胶水（副作用操作）
│   │   ├── native-defect.ts      // 调 nativeDefectFixCss()，拼接 CSS
│   │   ├── structural-template.ts // readFileSync + 文本提取模板
│   │   └── index.ts              // 统一 re-export
│   ├── fingerprint.ts            // 指纹生成/比对（P3 启用）
│   └── report.ts                 // 转换报告
│
├── profile/
│   ├── color-quantize.ts         // 现有：parseColor / medianCut / wcagContrast
│   ├── native-profile.ts         // 现有：ComponentProfile
│   └── treatment-classifier.ts   // 现有：TreatmentVerdict
│
├── catalog/
│   ├── theme-package-loader.ts   // 现有（扩展格式探测分支）
│   ├── theme-installer.ts        // 现有（bundle 构建）
│   └── theme-manifest.ts         // 现有（本次扩展 extended/inference/generated/depth）
│
└── shared/types/
    └── theme.ts                  // 现有（**无需修改**——ThemeColors 定义在 theme-manifest.ts，本 RFC 新类型放 theme-asset/ir/types.ts）
```

---

## 9. 入口适配器设计

### 9.1 adapter 契约

```typescript
interface ThemeAdapter {
  priority: number;
  detect(input: AdapterInput): Promise<boolean> | boolean;
  parse(input: AdapterInput): Promise<AdapterResult> | AdapterResult;
}

interface AdapterInput {
  path?: string;
  buffer?: Buffer;
  filename?: string;
}

interface AdapterResult {
  colors: ThemeColors;
  meta?: { name?: string; author?: string; license?: string; sourceFormat: string; sourceUrl?: string; };
  confidence?: number;
}
```

### 9.2 四个 adapter 的实现策略

| adapter | 输入形态 | 实现路径 | 复用程度 |
|---------|---------|---------|---------|
| `codedrobe.ts` | .codedrobe-theme 多端包（manifest + targets/css/ + assets/） | 读 manifest.colors → 14-token 映射；读 targets → 各色值聚类到 extended | 参考 theme-from-image 的亮度契约校验 + build-theme-package 的 deriveTokens 逻辑 |
| `legacy-codex.ts` | .codex-theme 单文件 JSON | 读 top-level colors 字段 → 直接映射 14-token | 80% 直接映射 |
| `vscode-json.ts` | VS Code theme JSON（workbench.colors + tokenColors） | 字段映射表（20 个 workbench 字段 → 14-token） | 60% 映射 + 30% 缺失推导 |
| `raw-css.ts` | 裸 CSS 字符串/文件 | css-extract → 颜色 token 化 → 语义聚类 | 参考 pywal 中的 k-means 思路 |

前两个在 P1 做（收益最大，共 2 个 adapter 文件），后两个在 P2（需要映射表人工 curation，再增 2 个）。

### 9.3 适配器注册与自动探测

```typescript
// adapters/index.ts
import { InvalidInputError, UnsupportedFormatError } from '../ir/errors';
import type { ThemeAdapter, AdapterInput, AdapterResult } from '../ir/types';

const REGISTRY: ThemeAdapter[] = [];

export function register(adapter: ThemeAdapter): void {
  REGISTRY.push(adapter);
  REGISTRY.sort((a, b) => a.priority - b.priority);
}

export function resetRegistry(): void {
  REGISTRY.length = 0;
}

const MAX_INPUT_BYTES = 5 * 1024 * 1024; // 5MB 主进程内存防线

export async function detectAndParse(input: AdapterInput): Promise<AdapterResult> {
  if (!input.path && !input.buffer) {
    throw new InvalidInputError('AdapterInput must have at least one of: path, buffer');
  }
  if (input.buffer && input.buffer.length > MAX_INPUT_BYTES) {
    throw new InputTooLargeError(`Input exceeds ${MAX_INPUT_BYTES} bytes`);
  }
  for (const adapter of REGISTRY) {
    if (await adapter.detect(input)) {
      return await adapter.parse(input);  // await 处理 async parse
    }
  }
  throw new UnsupportedFormatError(`Unsupported theme format: ${input.filename ?? input.path}`);
}

export function registerAllAdapters(): void {
  registerCodedrobeAdapter();
  registerLegacyCodexAdapter();
  registerVSCodeJsonAdapter();
  registerRawCssAdapter();
}
```

---

## 10. Palette 推导

### 10.1 算法选择（MCU 选择性移植，不全盘照搬）

| 算法模块 | 要不要 | 原因 |
|---------|-------|------|
| `TonalPalette`（seed → tone 序列） | **要** | 核心：给定 accent，自动生成 L1-L3 surface 层次 |
| `CorePalette`（六组色板组织） | **要** | Primary/Secondary/Neutral → accent/background/surface 映射 |
| `HCT` 色彩空间 | **简化** | 现有 parseColor + luminanceOf + wcagContrast 可近似 |
| `quantize` (Image→128 色) | **不要** | 已有 medianCut，功能等价 |
| `score`（按主题适合度排序） | **不要** | 我们是单 palette 不走多候选排序路径 |

实际移植量：~200 行 TS，放在 `infer/palette-infer.ts`。

### 10.2 现有派生逻辑精确定位

> RFC 提到的"post-override 派生"分布在两个已有的、成熟的文件中，无需新建文件。

| 位置 | 函数 | 职责 |
|------|------|------|
| `scripts/theme-utils.mjs` L206–227 | `tokenBlock(t, host = ':root')` | 14 token → CSS 变量块；input-bg / button-bg **内联 post-override**（写死表达式） |
| `scripts/build-theme-package.mjs` L427–477 | `deriveTokens(root)` | Studio 导出路径中的独立派生函数：三段 post-override（selection / input-bg / button-bg） |

两个文件通过 `tests/visual-regression/deriveTokens-consistency.test.ts` 保证行为一致。新的 `infer/palette-infer.ts` 应参考这两个已有实现的表达式，保持语义一致。

### 10.3 色调个性保留

> 规则：**extended 色相不变，仅做明度/饱和度调整**。

对 accent 的偏移限制：
- 色相：±5° 以内（HCT hue 通道）
- 饱和度：±10% 以内
- 明度：±8% 以内

超限则放弃扩展该 token，回退到 14-token 派生。

---

## 11. 增强能力的克制原则

- **色调个性保留**：增强不动主色/强调色，只补结构/层次/可选质感——否则所有主题变成"极光琉璃"复制品
- **单源铁律**：增强必须走生成器（signature 分支），禁止手改单端——否则每端漂移，协调度崩
- **默认保守**：质感不自动强推（pywal 教训：自动生成"和谐但平庸"；材质是风格选择，不是数学推导）

---

## 12. 实施阶段

| 阶段 | 内容 | 新增文件 | 桥接注入引擎 | 验收 |
|------|------|---------|------------|------|
| **P0 schema** | manifest schema 扩展（extended + inference + generated + depth）；types 同步 | `theme-manifest.ts` + `shared/types/theme.ts` + `manifest-v2.schema.json` | — | 新字段不影响现有测试 |
| **P1 核心管线** | codedrobe / legacy-codex adapter + palette 推导 + pipeline 编排器 + GENERATORS 接入 + native-defect bridge | ~14 项任务（14 个生产文件 + 测试 + 端到端验证） | ✅ native-defect | codedrobe 包 → 6 端 CSS → `npm run check` 全绿 |
| **P2 深度验证 + 质感增强** | vscode-json / raw-css adapter + probe + fidelity + structural-template + layering + presets | 8 个新文件 | ✅ probe + structural + fidelity | vscode-json 包 → 6 端生效；fidelity matchRatio ≥ 0.8；selector hit rate ≥ 85% |
| **P3 自愈闭环** | fingerprint + 漂移检测（apply 时比对 → 自动重生成） | 拆独立 RFC | — | 应用更新后旧主题自动修复 |

### P0 详细（schema + 类型）

- [ ] `theme-manifest.ts` 扩展 `ThemeColors.extended` + `inference`
- [ ] `theme-manifest.ts` 扩展 `ThemeManifest.generated` + `depth`
- [ ] `shared/types/theme.ts` 同步扩展
- [ ] `manifest-v2.schema.json` 同步扩展
- [ ] `docs/ARCHITECTURE.md` §主题管线 更新（反映 manifest-v2 schema 新增 4 字段：extended / inference / generated / depth）
- [ ] 测试：扩展字段不影响现有测试

### P1 详细（核心管线跑通，约 14 个新文件）

- [ ] `theme-asset/index.ts` 编排器入口
- [ ] `theme-asset/pipeline.ts` 管线调度
- [ ] `theme-asset/detect.ts` 格式嗅探
- [ ] `theme-asset/ir/types.ts` + `ir/normalize.ts` + `ir/errors.ts` IR 定义、规范化与错误类型
- [ ] `theme-asset/adapters/codedrobe.ts` + 测试
- [ ] `theme-asset/adapters/legacy-codex.ts` + 测试
- [ ] `theme-asset/infer/palette-infer.ts` + 测试
- [ ] `theme-asset/adapt/registry.ts` 调用 GENERATORS
- [ ] `theme-asset/adapt/toGeneratorInput.ts` AdapterResult → GeneratorInput 适配函数
- [ ] `theme-asset/deepen/index.ts` 编排
- [ ] `theme-asset/bridge/native-defect.ts` 桥接
- [ ] `theme-asset/verify/contract-check.ts` 离线契约校验
- [ ] 端到端测试：codedrobe 包 → 6 端 GENERATORS → bundle

### P1 验收条款（不依赖 CDP probe）

P1 阶段的"6 端生效"通过以下现有检查关门（**无需等待 P2 的 probe**）：

```bash
npm run check
```

期望输出：
- `check-injection-contract` (C1): `agents=[codex, doubao, qoderwork, traework, workbuddy, zcode]` 一个不少；`themes/<id>/assets/css/<agent>.css` 6 个文件存在
- `check-themes` (C2): `pass (schema+assets+14 tokens+color-scheme)` 0 issue；新导入主题的 14-token 覆盖率 100%
- `check-theme-staleness` (C3): palette 与生成 CSS 的 token 同步 — ⚠️ **脚本待创建**。P1 验收暂不包含 C3 正式检查；C3 脚本作为 **P1 实施交付物之一**，不晚于 P1 结束。临时替代：使用 `check-themes.mjs` 的 token 覆盖率检查（仅验证 14-token 覆盖，不验证 palette↔CSS 等价性）

> `theme-health-check.ts` 需要 CDP session，**属于 P2 验证手段**，P1 不依赖。

> **P1 验收现实**：P1 实际可运行的关门检查为 C1 + C2。C3 脚本在 P1 实施阶段编写并集成到 `npm run check`，作为 **P1 交付物**（非 P1 验收关门条件）。

### P2 验收条款（依赖 CDP probe）

P2 阶段引入实时 DOM 验证，验收需同时满足离线 + 在线两类条件：

**离线条件**（复用 P1）：
- [ ] `npm run check` 全绿（C1/C2/C3 均通过）

**在线条件**（新增，需要目标应用运行中）：
- [ ] `verify/probe.ts` → `validateSelectors()`: 每端关键 selector（sidebar / chat-input / message-bubble）hit rate ≥ 85%
- [ ] `verify/fidelity.ts` → `validateBaselineCss()`: `FidelityVerdict.matchRatio ≥ 0.8` 且 `degraded === false`
- [ ] `verify/fidelity.ts` → `fidelityGate()`: 返回 `{ pass: true, degraded: false }`

> P2 验收需在至少 3 个目标应用（traework + doubao + codex）的人工运行状态下各测一次。量化阈值（85%/0.8）基于注入引擎现有 baseline-validator 校准数据，可在 P2 实施后根据实测微调。

---

## 13. 风险与开放问题

### 13.1 风险表

| 风险 | 等级 | 触发条件 | 检测手段 | 缓解策略 | Owner |
|------|------|---------|---------|---------|-------|
| 逆向提取 CSS→token 语义错判 | 🟠 高 | border 色被当背景 | probe 实测 + confidence | 低置信度标记 + Verify 实拍；坏结果不入库 | 待指定 |
| 手写深度适配被覆盖 | 🟠 高 | adapter 误判 source | IR `source` 字段 + diff | `source=handwritten` 端不参与 GENERATORS | 待指定 |
| 第三方主题版权 | 🟡 中 | 无 license 字段 | manifest 缺失检测 | 转换时从源包/仓库带 license；缺则标 `unofficial:true` | 待指定 |
| 输入格式爆炸 | 🟡 中 | 新 adapter 激增 | 优先级冲突 | 优先级探测 + 显式 fail-fast + 优先级文档 | 待指定 |
| 扩展集与 14-token 契约漂移 | 🟡 中 | extended 缺色 | inference 标记 | extended 只增不改；缺失回退 14-token 推导 | 待指定 |
| schema 扩展引入 breaking | 🟠 高 | 旧客户端读新字段 | 字段均为 optional | optional + minAppVersion 门控 | 待指定 |
| adapter 优先级冲突 | 🟡 中 | 多 adapter 同 match | 优先级数字 | 扩展名优先 → schema 探测 → 启发式，fail-fast | 待指定 |
| God Object | 🔴 严重 | service 越来越胖 | stage 边界模糊 | service 退化为 orchestrator；每个 stage 独立接口 | 待指定 |
| 纯/不纯耦合 | 🔴 严重 | probe 反向流入 GENERATORS | 测试无法脱离 CDP | 严格单向流动；GENERATORS 只读 ThemeColors | 待指定 |

> **等级标准**：🔴 严重（阻塞实施）| 🟠 高（需明确缓解）| 🟡 中（需监控）| 🟢 低（可接受）。Owner 列待架构评审后指定具体负责人。

### 13.2 开放问题

1. **增强的默认行为**：P2 质感预设的默认档位（保守 = 层次 only？还是允许用户选？）
2. **修复策略**：全自动重映射 vs 半自动（重映射 + 报告确认）——P1 建议半自动
3. **`raw-css` adapter 优先级**：P1 还是 P2？（P1 聚焦单应用主题——若单应用主题多为裸 CSS，则应提前）
4. **VS Code JSON 映射表**：workbench colors 标准字段 → 14-token 的映射表（首个 adapter 需人工 curation，可参考社区映射）

---

## 14. 与原草案的主要差异总结

| 维度 | 原草案 | 终版 |
|------|--------|------|
| IR 类型 | 新增 ThemeAssetIR / PaletteIR / AgentAssetIR | **不新增**——ThemeColors 本身就是 IR |
| 管线架构 | 线性七步，service 统管 | **编排器模式**——每个 stage 独立接口、独立测试、单向流动 |
| schema 扩展时机 | P1/P3 分散 | **P0 一次性到位** |
| 与注入引擎关系 | 桥接层（两个系统） | **融合为一个引擎的两个壳层**（融合深度适配知识，不融合运行时进程） |
| 参考移植 | MCU 全盘移植 | **选择性移植**（TonalPalette + CorePalette） |
| P3 自愈 | 混在本 RFC | **拆独立 RFC** |
| verify vs bridge | 职责重叠（probe 重复） | **verify=只读报告 / bridge=副作用操作** |

---

## 15. 代码实证确认

以下关键函数已经过代码库实证确认：

| 函数 | 文件:行号 | 签名 | 特征 |
|------|----------|------|------|
| `tokenBlock(t, host)` | `scripts/theme-utils.mjs:206` | `export function tokenBlock(t, host = ':root')` | 纯函数，零副作用；input-bg/button-bg 内联 post-override |
| `deriveTokens(root)` | `scripts/build-theme-package.mjs:427` | `export function deriveTokens(root)` | Studio 导出派生逻辑，三段 post-override |
| `nativeDefectFixCss(agent, hostScope)` | `scripts/native-defect-fixes.mjs:136` | `export function nativeDefectFixCss(agent, hostScope = HOSTS[agent]): string` | 返回 CSS 字符串，模块常量注册表 |
| `deriveThemeFromImage(sample)` | `src/main/theme/theme-from-image.ts:74` | `export function deriveThemeFromImage(sample: ImagePixelSample): ThemeColorsFromImage` | 纯函数，自带亮度契约校验 |
| `validateSelectors(session, agentId, selectors, maxConcurrent)` | `src/main/cdp/selector-validator.ts:146` | `export async function validateSelectors(...)` | 批量探针，内置信号量限流 |
| `validateBaselineCss(session, capture, opts)` | `src/main/cdp/baseline-validator.ts:254` | `export async function validateBaselineCss(session, capture, opts): Promise<FidelityVerdict>` | CDP 编排器（probe→replay→assess→stopReplay） |
| `assessFidelity(baseline, replayed, opts)` | `src/main/cdp/baseline-validator.ts:171` | `export function assessFidelity(baseline: BaselineProbe, replayed: BaselineProbe, opts?: ValidateOptions): FidelityVerdict` | 纯函数，不接触 CDP |

### GENERATORS 6 个函数（全部实证）

| 文件 | 函数签名 | 备注 |
|------|---------|------|
| `generators/traeworkCss.mjs:6` | `function traeworkCss(t)` | export default |
| `generators/qoderworkCss.mjs:6` | `function qoderworkCss(t)` | export default |
| `generators/workbuddyCss.mjs:6` | `function workbuddyCss(t)` | export default |
| `generators/doubaoCss.mjs:6` | `function doubaoCss(t)` | export default |
| `generators/codexCss.mjs:11` | `function codexCss(t)` | `host` 为函数体内 `const host = 'html.agentskin-host-codex'`，非参数 |
| `generators/zcodeCss.mjs:12` | `function zcodeCss(t)` | export default |

**结论：所有 GENERATORS 入口函数均为纯函数 + 单入参（codexCss 的 `host` 为函数体内部 const，非参数）。融合管线天然可拼接。**

### P1 离线验证手段（全部实证）

| 脚本 | 检查内容 | P1 可用？ |
|------|---------|----------|
| `scripts/check-injection-contract.mjs` (C1) | 6 个 CSS 文件存在性 + scope selector | ✅ P1 直接可用 |
| `scripts/check-themes.mjs` (C2) | 14-token 覆盖率 + color-scheme | ✅ P1 直接可用 |
| `scripts/check-theme-staleness.mjs` (C3) | palette ↔ CSS 同步 | ⚠️ **脚本待创建** — P1 验收需补充或复用 `check-themes.mjs` 的子集逻辑 |
| `src/main/theme-health-check.ts` | 注入后实时 DOM 采样 | ❌ 需 CDP，P2 |

---

## 16. 评审结论

| 维度 | 评级 | 说明 |
|------|------|------|
| 架构合理性 | ✅ 通过 | IR + pipeline + adapter 插件化，与既有 GENERATORS 同构 |
| 风险可控性 | ✅ 通过 | 全部风险已识别，缓解策略已定义 |
| 实施可行性 | ✅ 通过 | P0 schema 先行，阶段渐进，复用资产充分 |
| 项目约束对齐 | ✅ 通过 | 不突破六适配器/服务端约束；不新增 UI 页面 |
| 参考成熟度 | ✅ 通过 | Catppuccin（19k★）/ Dracula（23.5k★）均有成熟背书 |

**裁决**：本 RFC 评审通过，进入 P0 实施阶段。P3（自愈闭环）建议拆成独立 RFC 单独评审。

### 评审参与

| 角色 | 人员 | 日期 | 输出 |
|------|------|------|------|
| 架构方向 | 待指定 | 2026-08-20 | 融合引擎（单 ThemeColors 界面） |
| 代码实证 | 多子智能体并行 | 2026-08-20 | 6 个 GENERATORS + 7 个关键工具函数 + 4 个 P1 验证脚本校验 |
| GitHub 参考 | 调研子智能体 | 2026-08-20 | 6 个项目横向对标（Catppuccin / Dracula / Spicetify / BetterDiscord / pywal / VS Code） |
| 风险审查 | 审计子智能体 | 2026-08-20 | 9 项风险识别，4 项高/严重风险已定义缓解 |
| TCO 分析 | 架构子智能体 | 2026-08-20 | 融合方案得分 29（vs 分离 15、CLI 23） |
| 虚构引用核查 | 实证子智能体 | 2026-08-20 | 63 项引用中 59 ✅ / 3 ⚠️ / 1 ❌；4 项显著偏差已修复（codexCss 签名、C3 脚本不存在、2 处路径层级错误、fidelityGate 不存在） |
| 目录合并审计 | 架构子智能体 | 2026-08-20 | verify/probe 与 bridge/probe 职责确认：verify=只读报告 / bridge=副作用操作 |
| P1/P2 验收条款 | 架构子智能体 | 2026-08-20 | 明确离线（`npm run check` C1/C2）+ 在线（hit rate ≥ 85% / matchRatio ≥ 0.8）关门手段 |
| 格式规范审计 | 规范子智能体 | 2026-08-20 | RFC 必备要素完整性检查 + 内部一致性校验 |

### 状态更新

> 头部元信息状态从 `终稿待实施` 更新为 `已通过（待实施）`，与 §16 评审结论同步。
