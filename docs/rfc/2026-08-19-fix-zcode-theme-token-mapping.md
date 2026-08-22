# RFC：ZCode 主题层 token 映射修复（与 Codex 同构：主题层全权接管主视觉）

> 状态：`待评审`
> 日期：2026-08-19
> 分支：`（待建）`
> 范围：`scripts/generators/zcodeCss.mjs`、`scripts/theme-utils.mjs`、`engines/zcode/tokens.css`、`themes/*/assets/css/zcode.css`（7 主题重生成物）
> 上游依据：`scripts/cdp-full-extract.mjs` 实拍 ZCode:50894 → `agents-raw-data/zcode-full-extract.json`；`docs/apps/zcode/raw/cdp-summary.md`（2026-08-18 实拍）
> 关联：`commit dd4528e3`（codex 修复，本 RFC 与其余构完全对齐）

---

## 1. 背景与目标

### 1.1 现状（实拍 + 源码双证，非推演）

`scripts/generators/zcodeCss.mjs:17` 委托共享函数 `shellTokenOverrides(host, t)` 生成主题层 CSS——与 Codex 修复前同源同模式。但 ZCode 与 Codex 的原生 token 体系不同，且 zcode 引擎层另有自建语义层，导致问题形态**与 codex 不同**：

| 事实 | 数据 | 来源 |
|---|---|---|
| ZCode 原生主视觉命名空间 | **`--color-*` ×257**（Tailwind v4：`--color-background`/`--color-surface`/`--color-foreground`/`--color-border`/`--color-accent`…） | live 实拍 50894 |
| `--color-token-*` | 0 个 → ZCode 不是 Codex 族 | live 实拍 50894 |
| **主题层 `zcode.css` 覆盖 `--color-*`** | **0 处** → 主视觉完全无主题层入口 | 生成物扫描 |
| 引擎 L0 `tokens.css` 覆盖 `--color-*` | 65/257，93 处 `var(--agentskin-*)` → 调色板感知 | 源码 + 实拍 |
| 引擎自建扁平语义层 | 40 个（`--text-*`/`--bg-*`/`--accent-*`/`--button-*`/`--sidebar-bg`/`--input-bg`…），**adapter STRUCTURAL_CSS 消费**（`var(--x, fallback)`） | `engines/zcode/adapter.mjs` |
| 主题层扁平段 | 40 个，与引擎扁平段 **100% 重叠双写**，33 个值不同（var 引用 vs 展开字面量，渲染等价） | 双写对比脚本 |

### 1.2 真实问题定性（修正前版 RFC 的误判）

> ⚠️ **前版 RFC 误判已修正**：曾按"原生 rootVariables 是否存在"判 zcode.css 56 个 token 全 no-op。实测证明**引擎自建了扁平语义层并被 adapter 消费**——主题层扁平 token 覆盖的是引擎语义层、**有效**（虽冗余）。zcode **不是 codex 那种"双层 no-op 假完整"**。

真问题有三：

1. **主视觉作者失控**：`--color-*`（257 个中的主视觉面）完全由引擎层固定 65 映射把持。作者在主题层写的 14-token 色彩意图，只能通过引擎层那套"固定映射公式"间接呈现；想精细控制 ZCode 的 background/surface/foreground 差异（如某主题想要更深的 surface 或不同透明度），**无入口**。
2. **扁平语义层双写**：同一 40 个 token 在引擎 tokens.css 与主题层 zcode.css 各写一份，映射来源不同（引擎=var(--agentskin-*)，主题=展开字面量），是持续漂移/冲突隐患。
3. **与 codex 修复后架构割裂**：codex 已是"主题层单源 + 引擎层占位"；zcode 仍是"引擎层把持 + 主题层冗余"——两套心智模型并存。

### 1.3 目标

- 让 ZCode 主题化与 **codex 修复后逐字节同构**：主题层（作者可控层）全权接管主视觉 `--color-*`，引擎层退化为占位（保留文件满足 loader/契约）。
- 消除 40 个扁平 token 双写，语义层并入主题层生成器。
- 作者 14-token 一处控制，ZCode 主视觉与其余 5 端同一心智。

### 1.4 非目标

- 不改 ZCode 注入架构机制（L0-L4 分层、adapter、持久化均不动）。
- 不追"覆盖全部 257 个 `--color-*`"——只对齐主视觉语义面 + 引擎层原有 65 映射面，语义色（terminal 等）保留原生。
- 不新增适配器、不新增 UI 页、不建服务端（AGENTS.md 黄金规则 1/2/3）。

---

## 2. 触发条件（对照 AGENTS.md §6）

| 触发项 | 是否命中 | 说明 |
|---|---|---|
| 重构注入架构（L0-L4） | **是** | 清空引擎 `tokens.css` 的 `--color-*` + 扁平段（内容归主题层）→ 触碰 L0 注入层 → 需本 RFC |
| 新增 UI 页 / 适配器 / 改核心数据模型 | 否 | — |

---

## 3. 方案（推荐 = 方案 A′：主题层全接管，与 codex 同构）

### 方案 A′（推荐）：主题层全权接管主视觉 + 语义层，引擎层占位化

**做法**：

1. **`scripts/theme-utils.mjs` 新增 `zcodeColorTokenOverrides(host, t)`**：
   - 14-token 调色板 → ZCode 真实 `--color-*` 主视觉映射，**覆盖面 = 引擎层原有 65 映射面**（background/surface/card/panel/sidebar/header/tab/popover/menu/toast/tooltip/input + foreground 层级 + border 层级 + accent/brand/primary/secondary + interaction/node 系列 + diff/find/terminal + success/warning/destructive 保留原生语义色）。
   - 背景类延续引擎层"半透明透出艺术层"语义（`color-mix(...transparent)`），与 `adapter.mjs` 艺术层设计一致。
   - 语义色（`--color-destructive`/`--color-success`/`--color-warning` 等）**故意保留原生**，不随主题改（与 codex 的 `editor-warning-foreground` 保留同思路）。
2. **`zcodeCss.mjs`**：
   - `shellTokenOverrides(host, t)` → `zcodeColorTokenOverrides(host, t)`（主视觉接管）。
   - **保留**扁平语义段（由生成器按 14-token 产出，供 adapter 消费）——消除"引擎 var 引用"与"主题展开字面量"双写，改为**主题层单源**。
   - 同步改 import 与头注释。
3. **`engines/zcode/tokens.css` 占位化**：清空 65 个 `--color-*` + 40 个扁平 overrides → no-op 占位 + 解释注释（保留文件：`palette/orchestrator.ts:116` 三件套缺失→整层回退、`check-injection-contract.mjs:131` 列必需，与 codex 同处理）。
4. **兜底保障**：`adapter.mjs` 的 `var(--sidebar-bg, fallback)` 等全部带 fallback → 即使主题层某 token 未定义也不崩（fallback 用 `--agentskin-*`，仍调色板感知）。
5. `npm run generate:themes` 重生成 7 主题 `zcode.css`。

**利益（对比 B）**：

| 维度 | A′ | B（引擎单源） |
|---|---|---|
| 作者对 ZCode 主视觉控制 | **完整**（14-token 一处） | 无（引擎固定映射把持） |
| 架构心智 | 与 codex **完全同构**，6 端一个模型 | codex/zcode 两套并存 |
| 扁平双写 40 个 | 消除（主题层单源） | 保留（引擎层定义） |
| 换主题 ZCode 跟手度 | 全维度跟手 | 只跟引擎层那套 |
| 长期漂移隐患 | 低（单源 + 生成器校验） | 中（双写漂移） |
| 观感回归风险 | 中（需实拍验证 65 面覆盖完整） | 无 |

**结论：A′ 利益远大于 B**——付出"引擎层占位 + 生成器新增一函数"的代价，换来 ZCode 从"二等公民"升级为与 codex 同级的一等公民，且消灭双写、统一心智。这符合"利益最大化"而非"改动最小"的决策标准。

### 方案 B（次选）：引擎 L0 单源，主题层只留结构/art

仅删 `zcodeCss.mjs` 的 `shellTokenOverrides` 调用，保留引擎层 65 映射 + 40 扁平定义。改动小、零回归，但主视觉仍作者失控、双写仍在、与 codex 割裂——**只解决"no-op"表象，不解决"作者失控 + 双写"本质**。仅在 A′ 实拍验证失败时的降级路径。

---

## 4. 影响面

| 项 | A′ | B |
|---|---|---|
| 改生成器源 | `theme-utils.mjs`（新函数）+ `zcodeCss.mjs` | 仅 `zcodeCss.mjs` |
| 改引擎注入层 | `engines/zcode/tokens.css` 占位化 | 不改 |
| 重生成物 | 7 主题 `zcode.css` | 7 主题 `zcode.css` |
| 观感回归风险 | 中（需实拍 65 面覆盖完整性） | 无 |
| 契约/加载器 | `tokens.css` 保留占位（与 codex 同处理） | 不动 |

---

## 5. 验证计划

1. `npm run check:contract` / `check:theme-staleness --verify` / `check:themes` / `typecheck` / `lint(src)` / `biome(scripts)` 全绿。
2. 生成物核对：新 `zcode.css` 覆盖 `--color-*` 数量 ≥ 引擎层原有 65 面（无遗漏盲区）；扁平段单源（无引擎层重复定义）。
3. ZCode 运行端口实拍：`scripts/cdp-full-extract.mjs --port <PORT> --name zcode --out agents-raw-data`，对比注入前后 `--color-*` 关键值（background/surface/foreground/border/accent）确认主题化生效且观感不回归。
4. 结果记入 `agents-raw-data/` 与 `docs/apps/zcode/`。

---

## 6. 待决项

- [ ] **方案 A′ 拍板**（推荐，理由见 §3 利益表）。
- [ ] 若选 A′：`--color-*` 映射面是否严格按引擎层 65 个逐一对齐（推荐），还是只做主视觉子集（不推荐，会丢细粒度）。
- [ ] 落地分支命名与提交计划（未 push，按纪律）。
