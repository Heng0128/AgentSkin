# workbuddy 架构文档 (AgentSkin)

> 逆向理解产物 = **静态 asar 解包层**（`extract-asar-summary.mjs`）+ **动态 CDP 层**（`cdp-full-extract`），
> 未写回任何原应用文件。
> 静态来源：`docs/apps/workbuddy/raw/extract-summary.{json,md}`（app.asar 解包汇总）；
> 动态来源：`agents-raw-data/workbuddy-full-extract.json`（CDP 全量快照）。
> 目标：支撑深度主题注入 / 脆弱性分级 / 语义锚点维护。

## 1. 包身份

| 域 | 项 | 值 |
|----|----|----|
| **静态 asar** | 打包版本 | `5.3.14` |
| | 安装源 | `C:\Program Files\WorkBuddy\resources` |
| | root asar | `resources/app.asar`（283,047,928 B） |
| | 进程/架构证据 | `cli/vendor/ripgrep/` 按 OS 分桶（x64/arm64 × win32/linux/darwin）；Windows 仅 win32 物理文件，其余 8 项在 Windows 解包时缺失、已容错跳过 |
| | preload(8) | `preload/index.js`、`main/splash/splash-preload.js`、`renderer/assets/preload-helper-*.js`、`resources/{client-menu,mcp-app,tdoc-import,tdoc-preview}-preload.js`、`tencent-docs/webview-preload.js` |
| **动态 CDP** | agent | `workbuddy` |
| | family | vscode-family (VS Code 架构) |
| | 渲染 URL | `file:///C:/Program%20Files/WorkBuddy/resources/app.asar/renderer/index.html` |
| | securityOrigin | `file://` |
| | frameId | `C62C3929398DCD0F7E964ECC882FE1BE` |
| | 快照时间 | 2026-08-18T14:29:49.878Z |

> 进程模型 / 打包拓扑由 `extract-asar-summary.mjs` 解包汇总得到（见 §1.1），
> 渲染面运行时身份来自 CDP 全量快照（`cdp-full-extract`）。两者都已归档到 raw/ 层。

### 1.1 静态安全策略（asar 解包）

| 项 | 值 |
|----|----|
| contextIsolation | `true` |
| webSecurity | `false` |
| sandbox | 非法式（JS 中检测到 `allowSameOrigin` 字段，具体以打包产物为准） |
| CSP | 打包 HTML 元素 meta（详见 raw/extract-summary.json 的 `security.csp`） |

### 1.2 静态 token 命名空间（CSS 规则级采样）

- 提取自解包 CSS 规则中的 `--var` 声明，按命名空间分桶（`varCount` 为各桶变量数）。
- 最大桶 `cb`（562 变量）等，与动态 `--cb-*`（466）分布一致，印证"分布式 inline/style 变量"是 {静态规则 + 动态实测} 共同确认。

## 2. 渲染面与安全上下文

- **scheme**：`file://`（决定 CDP 暴露面与 CSP 特征）。
- **frame**：主 renderer 单 frame，无多 frame 标记。
- **DOM 规模**：{"default":668,"dark":668,"light":668}（dataQuality.totalNodes）。
- **DOM 树实际可遍历节点**：668（dom.default 递归计数）。
- **stylesheets**：100 张，CORS 错误 0 张。
- **API 污染检测**：核心探测 API（querySelectorAll/getComputedStyle/matchMedia/getPropertyValue）仍为原生。

> 注入可行性先决：无 CORS 阻断、DOM 未截断、API 未被覆盖，CDP 动态注入才可信。

## 3. 变量体系（rootVariables + styleVars）

| scheme | rootVariable 数量 | 主要命名空间 |
|--------|------------------|--------------|
| default | 3560 | `--vscode-*` ×867、`--wb-*` ×863、`--cb-*` ×466、`--cr-*` ×190、`--sc-*` ×140、`--ec-*` ×86、`--dc-*` ×28、`--gray-*` ×28、`--mauve-*` ×28、`--slate-*` ×28、`--sage-*` ×28、`--olive-*` ×28、`--sand-*` ×28、`--amber-*` ×28、`--blue-*` ×28、`--bronze-*` ×28、`--brown-*` ×28、`--crimson-*` ×28、`--cyan-*` ×28、`--gold-*` ×28、`--grass-*` ×28、`--green-*` ×28、`--indigo-*` ×28、`--iris-*` ×28、`--jade-*` ×28、`--lime-*` ×28、`--mint-*` ×28、`--orange-*` ×28、`--pink-*` ×28、`--plum-*` ×28、`--purple-*` ×28、`--red-*` ×28、`--ruby-*` ×28、`--sky-*` ×28、`--teal-*` ×28、`--tomato-*` ×28、`--violet-*` ×28、`--yellow-*` ×28、`--black-*` ×12、`--white-*` ×12、`--fe-*` ×9、`--theme-*` ×6、`--ic-*` ×5、`--qad-*` ×3、`--chat-*` ×2、`--conversation-*` ×1、`--oneid-*` ×1、`--text-*` ×1 |
| dark | 3560 | `--vscode-*` ×867、`--wb-*` ×863、`--cb-*` ×466、`--cr-*` ×190、`--sc-*` ×140、`--ec-*` ×86、`--dc-*` ×28、`--gray-*` ×28、`--mauve-*` ×28、`--slate-*` ×28、`--sage-*` ×28、`--olive-*` ×28、`--sand-*` ×28、`--amber-*` ×28、`--blue-*` ×28、`--bronze-*` ×28、`--brown-*` ×28、`--crimson-*` ×28、`--cyan-*` ×28、`--gold-*` ×28、`--grass-*` ×28、`--green-*` ×28、`--indigo-*` ×28、`--iris-*` ×28、`--jade-*` ×28、`--lime-*` ×28、`--mint-*` ×28、`--orange-*` ×28、`--pink-*` ×28、`--plum-*` ×28、`--purple-*` ×28、`--red-*` ×28、`--ruby-*` ×28、`--sky-*` ×28、`--teal-*` ×28、`--tomato-*` ×28、`--violet-*` ×28、`--yellow-*` ×28、`--black-*` ×12、`--white-*` ×12、`--fe-*` ×9、`--theme-*` ×6、`--ic-*` ×5、`--qad-*` ×3、`--chat-*` ×2、`--conversation-*` ×1、`--oneid-*` ×1、`--text-*` ×1 |
| light | 3560 | `--vscode-*` ×867、`--wb-*` ×863、`--cb-*` ×466、`--cr-*` ×190、`--sc-*` ×140、`--ec-*` ×86、`--dc-*` ×28、`--gray-*` ×28、`--mauve-*` ×28、`--slate-*` ×28、`--sage-*` ×28、`--olive-*` ×28、`--sand-*` ×28、`--amber-*` ×28、`--blue-*` ×28、`--bronze-*` ×28、`--brown-*` ×28、`--crimson-*` ×28、`--cyan-*` ×28、`--gold-*` ×28、`--grass-*` ×28、`--green-*` ×28、`--indigo-*` ×28、`--iris-*` ×28、`--jade-*` ×28、`--lime-*` ×28、`--mint-*` ×28、`--orange-*` ×28、`--pink-*` ×28、`--plum-*` ×28、`--purple-*` ×28、`--red-*` ×28、`--ruby-*` ×28、`--sky-*` ×28、`--teal-*` ×28、`--tomato-*` ×28、`--violet-*` ×28、`--yellow-*` ×28、`--black-*` ×12、`--white-*` ×12、`--fe-*` ×9、`--theme-*` ×6、`--ic-*` ×5、`--qad-*` ×3、`--chat-*` ×2、`--conversation-*` ×1、`--oneid-*` ×1、`--text-*` ×1 |

### 变量来源形态

根据 `__host` 标注，变量为 **aggregated-inline-or-rules**（聚合 3560 个）。
> 提示：`aggregated-inline-or-rules` 或 `merged-root-plus-distributed` 表示变量分散在组件 inline style 与样式表规则中（典型如 VS Code 家族 WorkBuddy/QoderWork）。
> 这类应用 `rootVars` 必须走 `cdp-full-extract.getRootComputedVariables` 的聚合策略，仅读 `documentElement` 会误判为 0。

- **styleVars**（scheme 分布）：{"dark":3617,"light":3560,"neutral":4234}。

## 4. DOM 与语义锚点

- **domNodes**：{"default":668,"dark":668,"light":668}。
- **稳定锚点**（stable id + 非 hash class）：共 251 个，样例：

- `._input-area-container--empty-state_9z15h_102`
- `._input-area-container--opaque-main-area_9z15`
- `._input-area-container_9z15h_19`
- `.active`
- `.agent-card-more-button`
- `.cb-dark`
- `.cb-font-size-capped`
- `.cb-font-size-uncapped`
- `.cb-overview-empty`
- `.cb-overview-panel`
- `.cb-overview-section`
- `.cb-overview-section__title`
- `.cb-overview-section__title-label`
- `.cb-overview-section__title-toggle`
- `.cb-overview-section__toggle`
- `.chat-container`
- `.chat-container--welcome`
- `.claw-name-ready`
- `.close`
- `.codebuddy-menubar`
- `.collapsible-section`
- `.collapsible-section-chevron`
- `.collapsible-section-content`
- `.collapsible-section-header`
- `.collapsible-section-icon`
- `.collapsible-section-label`
- `.collapsible-section-title`
- `.conversation-agent-card`
- `.conversation-agent-card--group-child`
- `.conversation-agent-card--standalone`
- `.conversation-item`
- `.conversation-list`
- `.conversation-list-content`
- `.conversation-list-footer`
- `.conversation-list-header`
- `.conversation-list-logo`
- `.conversation-list-logo-row`
- `.conversation-list-tab-action-button`
- `.conversation-list-tab-actions`
- `.conversation-list-tab-button`

> 锚点采集规则：过滤 css-module hash（`_pk7td_1`）、噪声类（`__as_*`）、单/双字符工具类。
> 升级后使用 `scripts/snapshot-compare.mjs` diff 语义锚点新增/消失。

## 5. 注入面与脆弱性提示

- **安全上下文**：`file://`。
- **多 frame / OOPIF**：否，单 target 即可覆盖。
- **DOM 截断**：{"default":false,"dark":null,"light":null}。
- **应用到注入的对象形态**：详见 `fragility.md`。

## 6. raw/ 快照与升级 diff

```bash
cd C:\Users\snowb\Desktop\work\desktop-main
# ① 静态 asar 解包层（app.asar 解包 + 静态汇总）
node scripts/extract-asar-summary.mjs --app workbuddy --app-path "C:/Program Files/WorkBuddy/resources" --family vscode --out docs/apps/workbuddy/raw
# ② 动态 CDP 层
node scripts/cdp-full-extract.mjs --agent workbuddy   # 生成新版 agents-raw-data/workbuddy-full-extract.json
node scripts/gen-agent-arch-docs.mjs --only workbuddy  # 重新生成 raw/ 快照与文档
# ③ 升级 diff
node scripts/snapshot-compare.mjs agents-raw-data/workbuddy-full-extract.json agents-raw-data/workbuddy-full-extract.json --out docs/apps/workbuddy/raw/upgrade-diff.md
```

