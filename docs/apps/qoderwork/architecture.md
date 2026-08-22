# qoderwork 架构文档 (AgentSkin)

> 逆向理解产物 = **静态 asar 解包层**（`extract-asar-summary.mjs`）+ **动态 CDP 层**（`cdp-full-extract`），未写回任何原应用文件。
> 动态布局来源：`agents-raw-data/qoderwork-full-extract.json`；
> 静态 asar 来源：`docs/apps/qoderwork/raw/extract-summary.{json,md}`（app.asar 解包汇总）。
> 目标：支撑深度主题注入 / 脆弱性分级 / 语义锚点维护。

## 1. 包身份（CDP 运行时侧）

| 项 | 值 |
|----|----|
| agent | `qoderwork` |
| family | vscode-family (VS Code 架构) |
| 渲染 URL | `file:///C:/Program%20Files/QoderWork%20CN/QoderWork%20CN/resources/app.asar/out/renderer/index.html` |
| securityOrigin | `file://` |
| frameId | `E46079AA588E1AC95016E6352BD772FD` |
| 快照时间 | 2026-08-18T14:30:38.835Z |

> 说明：目前无完整静态解包汇总，本节主要反映 CDP 运行时可见的渲染面身份。
> 完整进程模型 / 打包拓扑需补 `extract-asar-summary.mjs` 后回填。

## 2. 渲染面与安全上下文

- **scheme**：`file://`（决定 CDP 暴露面与 CSP 特征）。
- **frame**：主 renderer 单 frame，无多 frame 标记。
- **DOM 规模**：{"default":474,"dark":474,"light":474}（dataQuality.totalNodes）。
- **DOM 树实际可遍历节点**：474（dom.default 递归计数）。
- **stylesheets**：12 张，CORS 错误 0 张。
- **API 污染检测**：核心探测 API（querySelectorAll/getComputedStyle/matchMedia/getPropertyValue）仍为原生。

> 注入可行性先决：无 CORS 阻断、DOM 未截断、API 未被覆盖，CDP 动态注入才可信。

## 3. 变量体系（rootVariables + styleVars）

| scheme | rootVariable 数量 | 主要命名空间 |
|--------|------------------|--------------|
| default | 132 | `--color-*` ×111、`--agents-*` ×5、`--tw-*` ×4、`--loading-*` ×3、`--font-*` ×3、`--chat-*` ×3、`--resizable-*` ×1、`--settings-*` ×1、`--none-*` ×1 |
| dark | 132 | `--color-*` ×111、`--agents-*` ×5、`--tw-*` ×4、`--loading-*` ×3、`--font-*` ×3、`--chat-*` ×3、`--resizable-*` ×1、`--settings-*` ×1、`--none-*` ×1 |
| light | 132 | `--color-*` ×111、`--agents-*` ×5、`--tw-*` ×4、`--loading-*` ×3、`--font-*` ×3、`--chat-*` ×3、`--resizable-*` ×1、`--settings-*` ×1、`--none-*` ×1 |

### 变量来源形态

根据 `__host` 标注，变量为 **aggregated-inline-or-rules**（聚合 132 个）。
> 提示：`aggregated-inline-or-rules` 或 `merged-root-plus-distributed` 表示变量分散在组件 inline style 与样式表规则中（典型如 VS Code 家族 WorkBuddy/QoderWork）。
> 这类应用 `rootVars` 必须走 `cdp-full-extract.getRootComputedVariables` 的聚合策略，仅读 `documentElement` 会误判为 0。

- **styleVars**（scheme 分布）：{"dark":141,"light":132,"neutral":384}。

### 3.1 `--text-*` 等 design-token 盲区成因（已跟踪）

静态 asar 提取到 `--text-*`(14)、`--radius-*`(6) 等 design-token，但 CDP rootVars(132)
**不含**它们（见 `static-cdp-gap.json`）。已定位为 CDP 聚合漏采，而非静态误报：

- **真来源**：这些是 Tailwind v4 `@theme` 生成的设计 token 表，定义在运行时 stylesheet 的
  **`:root, :host`** 多选择器规则下（实测 `variables.neutral.grouped[':root, :host']` 共 **233 个**变量：
  `--color-*`175、`--text-*`14、`--container-*`9、`--font-*`7、`--radius-*`5、`--tracking-*`5 等）。
  运行时字符串可命中 `--text-xs`——证明其在 stylesheet 规则中存在。
- **聚合漏采根因**：`getRootComputedVariables`（[cdp-full-extract.mjs](file:///c:/Users/snowb/Desktop/work/desktop-main/scripts/cdp-full-extract.mjs#L714-L773)）第 1 步
  `collectComputed(document.documentElement)` 拿到**非空**计算变量（132，主要来自组件 inline 的
  `--color-*/--agents-*`），随即 `if (rootCount && fallback) return` **提前返回**，从未进入第 2/3 步
  的样式表 `:root` 规则聚合。而 `documentElement` 计算样式不含 shadow 宿主上的 Tailwind token →
  `233 - 132 = 101` 个 token（`--text-*/--radius-*/--container-*` 等）被永久漏采。
- **性质判定**：这些 token 是**字体尺寸/圆角/间距**（结构性），非颜色主题，对主题注入无直接影响；
  但静态层仍将其报为盲区，属可收敛的噪音。
- **处理建议**：`--text-*`/`--radius-*`/`--container-*`/`--tracking-*` 结构类 token **不纳入注入作用域**；
  若需精确对齐，可放宽 `getRootComputedVariables` 提前返回条件（当命中 `:root, :host` 多选择器
  或变量分散在 shadow host 时强制走聚合回退）。

## 4. DOM 与语义锚点

- **domNodes**：{"default":474,"dark":474,"light":474}。
- **稳定锚点**（stable id + 非 hash class）：共 238 个，样例：

- `.-mx-1`
- `.-mx-5`
- `.-translate-y-20`
- `.Scrollbar-_r_4f_`
- `.SendButton-sen`
- `.[&>*]:block`
- `.[&>*]:leading-none`
- `.absolute`
- `.active:text-foreground`
- `.agents-chat-view-root`
- `.agents-content-area`
- `.agents-inner-view-clamp`
- `.agents-layout-body`
- `.agents-layout-root`
- `.agents-parchment-paper-surface`
- `.agents-sidebar`
- `.bg-bg-base`
- `.bg-border-tertiary`
- `.bg-border/30`
- `.bg-container`
- `.bg-fill-secondary`
- `.bg-fill-tertiary`
- `.bg-primary`
- `.bg-transparent`
- `.block`
- `.border`
- `.border-0`
- `.border-b`
- `.border-border-tertiary`
- `.border-border/30`
- `.bottom-0`
- `.bottom-0.5`
- `.bottom-1`
- `.bottom-4`
- `.bottom-[var(--agents-content-area-gap)]`
- `.break-words`
- `.chat-input-editor-text`
- `.chat-input-primary-glow`
- `.cursor-col-resize`
- `.cursor-default`

> 锚点采集规则：过滤 css-module hash（`_pk7td_1`）、噪声类（`__as_*`）、单/双字符工具类。
> 升级后使用 `scripts/snapshot-compare.mjs` diff 语义锚点新增/消失。

### 4.1 锚点/变量前缀实测核验

> 以 `agents-raw-data/qoderwork-full-extract.json` 对照 §4 声称的锚点与变量前缀，裁决是否存在失准。

| 声称 | 本地实测 | 裁决 |
|------|---------|------|
| 变量前缀 `--color-*` | ✅ 3819 命中 | ✅ 属实 |
| 业务前缀 `--agents-*` | ✅ 167 命中 | ✅ 属实（VS Code 家族自研层） |
| 锚点 `.agents-sidebar` | ✅ 20 命中 | ✅ 属实 |
| 锚点 `.agents-chat-view-root` | ✅ 7 命中 | ✅ 属实 |
| `--text-*` design-token | 见 §3.1：定义在 `:root, :host` 但被 CDP 聚合提前返回漏采 | ⚠️ 采集盲区（非锚点失真） |

**结论**：qoderwork 核心锚点（`.agents-*`）与变量前缀均与本地实测吻合，无像 workbuddy `[data-view-id]` 那样的失真锚点。唯一注意项是 §3.1 的 `--text-*` 聚合漏采——结构类 token，不纳入注入作用域。

## 5. 注入面与脆弱性提示

- **安全上下文**：`file://`。
- **多 frame / OOPIF**：否，单 target 即可覆盖。
- **DOM 截断**：{"default":false,"dark":null,"light":null}。
- **应用到注入的对象形态**：详见 `fragility.md`。

## 6. raw/ 快照与升级 diff

```bash
cd C:\Users\snowb\Desktop\work\desktop-main
node scripts/cdp-full-extract.mjs --agent qoderwork   # 生成新版 agents-raw-data/qoderwork-full-extract.json
node scripts/gen-agent-arch-docs.mjs --only qoderwork  # 重新生成 raw/ 快照与文档
node scripts/snapshot-compare.mjs agents-raw-data/qoderwork-full-extract.json agents-raw-data/qoderwork-full-extract.json --out docs/apps/qoderwork/raw/upgrade-diff.md
```

