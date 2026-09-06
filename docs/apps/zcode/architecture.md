# zcode 架构文档 (AgentSkin)

> 逆向理解产物 = **静态 asar 解包层**（`extract-asar-summary.mjs`）+ **动态 CDP 层**（`cdp-full-extract`），未写回任何原应用文件。
> 动态布局来源：`agents-raw-data/zcode-full-extract.json`；
> 静态 asar 来源：`docs/apps/zcode/raw/extract-summary.{json,md}`（app.asar 解包汇总）。
> 目标：支撑深度主题注入 / 脆弱性分级 / 语义锚点维护。

## 1. 包身份（CDP 运行时侧）

| 项 | 值 |
|----|----|
| agent | `zcode` |
| family | react-app |
| 渲染 URL | `file:///C:/Program%20Files/ZCode/resources/app.asar/out/renderer/index.html?restoreSession=true&supportsSettings=true&zcodeLaunchMarks=%7B%22createdAt%22%3A1787041642532.9%2C%22mainStart%22%3A1787041644219%2C%22appReady%22%3A1787041645039%2C%22loadUrl%22%3A1787041647384%7D` |
| securityOrigin | `file://` |
| frameId | `E9FF27467BB8EBF609BD4FB247249CA4` |
| 快照时间 | 2026-08-18T13:47:17.009Z |

> 说明：目前无完整静态解包汇总，本节主要反映 CDP 运行时可见的渲染面身份。
> 完整进程模型 / 打包拓扑需补 `extract-asar-summary.mjs` 后回填。

## 2. 渲染面与安全上下文

- **scheme**：`file://`（决定 CDP 暴露面与 CSP 特征）。
- **frame**：主 renderer 单 frame，无多 frame 标记。
- **DOM 规模**：{"default":227,"dark":227,"light":227}（dataQuality.totalNodes）。
- **DOM 树实际可遍历节点**：227（dom.default 递归计数）。
- **stylesheets**：7 张，CORS 错误 0 张。
- **API 污染检测**：核心探测 API（querySelectorAll/getComputedStyle/matchMedia/getPropertyValue）仍为原生。

> 注入可行性先决：无 CORS 阻断、DOM 未截断、API 未被覆盖，CDP 动态注入才可信。

## 3. 变量体系（rootVariables + styleVars）

| scheme | rootVariable 数量 | 主要命名空间 |
|--------|------------------|--------------|
| default | 390 | `--color-*` ×256、`--tw-*` ×46、`--text-*` ×23、`--beam-*` ×14、`--container-*` ×10、`--radius-*` ×7、`--font-*` ×6、`--blur-*` ×6、`--default-*` ×4、`--leading-*` ×4、`--tracking-*` ×4、`--animate-*` ×3、`--ease-*` ×2、`--animated-*` ×2、`--aspect-*` ×1、`--none-*` ×1、`--ui-*` ×1 |
| dark | 390 | `--color-*` ×256、`--tw-*` ×46、`--text-*` ×23、`--beam-*` ×14、`--container-*` ×10、`--radius-*` ×7、`--font-*` ×6、`--blur-*` ×6、`--default-*` ×4、`--leading-*` ×4、`--tracking-*` ×4、`--animate-*` ×3、`--ease-*` ×2、`--animated-*` ×2、`--aspect-*` ×1、`--none-*` ×1、`--ui-*` ×1 |
| light | 390 | `--color-*` ×256、`--tw-*` ×46、`--text-*` ×23、`--beam-*` ×14、`--container-*` ×10、`--radius-*` ×7、`--font-*` ×6、`--blur-*` ×6、`--default-*` ×4、`--leading-*` ×4、`--tracking-*` ×4、`--animate-*` ×3、`--ease-*` ×2、`--animated-*` ×2、`--aspect-*` ×1、`--none-*` ×1、`--ui-*` ×1 |

### 变量来源形态

`rootVariables` 未带 `__host` 标注，走原生 `:root` 快路径（变量集中在设计系统 token 上）。

- **styleVars**（scheme 分布）：{"dark":410,"light":390,"neutral":476}。

## 4. DOM 与语义锚点

- **domNodes**：{"default":227,"dark":227,"light":227}。
- **稳定锚点**（stable id + 非 hash class）：共 203 个，样例：

- `.*:[a]:hover:text-foreground`
- `.*:[a]:underline`
- `.*:[a]:underline-offset-3`
- `.-translate-x-1/2`
- `.-translate-y-1/2`
- `.@container/conversation`
- `.@container/topoverlayer`
- `.[--markdown-table-lay`
- `.[--markdown-table-layout-left-inset:16px]`
- `.[app-region:drag]`
- `.[app-region:no-drag]`
- `.[scrollbar-gutter:stable]`
- `.absolute`
- `.afte`
- `.after:absolute`
- `.after:inset-0`
- `.after:rounded-full`
- `.aspect-square`
- `.before:block`
- `.before:content-[`
- `.before:flex-1`
- `.before:min-h-[52px]`
- `.before:w-full`
- `.bg-background`
- `.bg-background-win-alt`
- `.bg-clip-padding`
- `.bg-transparent`
- `.border`
- `.border-0`
- `.border-border`
- `.border-l`
- `.border-t`
- `.border-transparent`
- `.cursor-grab`
- `.dark`
- `.data-[state=closed]:animate-collaps`
- `.data-[state=open]:animate-collapsible-down`
- `.data-horizontal:flex-col`
- `.duration`
- `.duration-150`

> 锚点采集规则：过滤 css-module hash（`_pk7td_1`）、噪声类（`__as_*`）、单/双字符工具类。
> 升级后使用 `scripts/snapshot-compare.mjs` diff 语义锚点新增/消失。

### 4.1 锚点/变量前缀实测核验

> 以 `agents-raw-data/zcode-full-extract.json` 对照 §4 声称的锚点与变量前缀，裁决是否失准。

| 声称 | 本地实测 | 裁决 |
|------|---------|------|
| 变量前缀 `--color-*` | ✅ 6322 命中 | ✅ 属实（zcode 最大设计 token 桶） |
| `--beam-*`（zcode 特色光效 token） | ✅ 942 命中 | ✅ 属实 |
| `--ui-*`（功能面 token） | ✅ 32 命中 | ✅ 属实 |
| 锚点 `@container/conversation` | ✅ 6 命中 | ✅ 属实（容器查询定位） |
| AgentSkin 语义标记 `data-agentskin-*` | ABSENT | ⚠️ zcode 尚未注入 `data-agentskin-*` 标记（非失真，是标记应用缺口，待补） |

**结论**：zcode 核心变量前缀与锚点均与本地实测吻合。唯一注意项是 `data-agentskin-*` 语义标记尚未附着到 zcode 的 DOM（参考其余适配器的 `rendererHints` 语义锚点注入），若需跨 Agent 统一语义锚点可补。

## 5. 注入面与脆弱性提示

- **安全上下文**：`file://`。
- **多 frame / OOPIF**：否，单 target 即可覆盖。
- **DOM 截断**：{"default":false,"dark":null,"light":null}。
- **应用到注入的对象形态**：详见 `fragility.md`。

## 6. raw/ 快照与升级 diff

```bash
cd C:\Users\snowb\Desktop\work\desktop-main
node scripts/cdp-full-extract.mjs --agent zcode   # 生成新版 agents-raw-data/zcode-full-extract.json
node scripts/gen-agent-arch-docs.mjs --only zcode  # 重新生成 raw/ 快照与文档
node scripts/snapshot-compare.mjs agents-raw-data/zcode-full-extract.json agents-raw-data/zcode-full-extract.json --out docs/apps/zcode/raw/upgrade-diff.md
```

