# traework 架构文档 (AgentSkin)

> 逆向理解产物。基于 CDP 全量快照（`cdp-full-extract`）动态提取，未写回任何原应用文件。
> 动态布局来源：`agents-raw-data/traework-full-extract.json`；
> 静态 asar 层：_暂无解包汇总_（可跑 `extract-asar-summary.mjs` 后合并）。
> 目标：支撑深度主题注入 / 脆弱性分级 / 语义锚点维护。

## 1. 包身份（CDP 运行时侧）

| 项 | 值 |
|----|----|
| agent | `traework` |
| family | vscode-extension (solo-lite) |
| 渲染 URL | `vscode-file://vscode-app/c:/Users/snowb/AppData/Local/Programs/TRAE%20SOLO%20CN/resources/app/out/vs/code/electron-browser/solo/solo-lite.html` |
| securityOrigin | `vscode-file://vscode-app` |
| frameId | `785B1D0D652810201435550BFC9D32CE` |
| 快照时间 | 2026-08-18T13:47:12.008Z |

> 说明：目前无完整静态解包汇总，本节主要反映 CDP 运行时可见的渲染面身份。
> 完整进程模型 / 打包拓扑需补 `extract-asar-summary.mjs` 后回填。

## 2. 渲染面与安全上下文

- **scheme**：`vscode-file://vscode-app`（决定 CDP 暴露面与 CSP 特征）。
- **frame**：主 renderer 单 frame，无多 frame 标记。
- **DOM 规模**：{"default":576,"dark":576,"light":576}（dataQuality.totalNodes）。
- **DOM 树实际可遍历节点**：576（dom.default 递归计数）。
- **stylesheets**：63 张，CORS 错误 9 张。
- **API 污染检测**：核心探测 API（querySelectorAll/getComputedStyle/matchMedia/getPropertyValue）仍为原生。

> 注入可行性先决：无 CORS 阻断、DOM 未截断、API 未被覆盖，CDP 动态注入才可信。

## 3. 变量体系（rootVariables + styleVars）

| scheme | rootVariable 数量 | 主要命名空间 |
|--------|------------------|--------------|
| default | 4315 | `--vscode-*` ×3771、`--brand-*` ×92、`--bg-*` ×36、`--z-*` ×31、`--status-*` ×30、`--body-*` ×28、`--heading-*` ×27、`--query-*` ×25、`--radius-*` ×23、`--code-*` ×21、`--chat-*` ×18、`--viz-*` ×18、`--text-*` ×17、`--tw-*` ×17、`--icon-*` ×15、`--font-*` ×15、`--shadow-*` ×15、`--spacer-*` ×13、`--permission-*` ×13、`--Spacers-*` ×12、`--solo-*` ×9、`--accent-*` ×9、`--border-*` ×9、`--motion-*` ×6、`--spacing-*` ×6、`--Radius-*` ×6、`--special-*` ×5、`--monaco-*` ×5、`--user-*` ×4、`--transition-*` ×3、`--ul-*` ×3、`--welcome-*` ×2、`--gradient-*` ×2、`--prop-*` ×1、`--inline-*` ×1、`--workspace-*` ×1、`--slash-*` ×1、`--header-*` ×1、`--builtin-*` ×1、`--sheet-*` ×1、`--homepage-*` ×1、`--icube-*` ×1 |
| dark | 4315 | `--vscode-*` ×3771、`--brand-*` ×92、`--bg-*` ×36、`--z-*` ×31、`--status-*` ×30、`--body-*` ×28、`--heading-*` ×27、`--query-*` ×25、`--radius-*` ×23、`--code-*` ×21、`--chat-*` ×18、`--viz-*` ×18、`--text-*` ×17、`--tw-*` ×17、`--icon-*` ×15、`--font-*` ×15、`--shadow-*` ×15、`--spacer-*` ×13、`--permission-*` ×13、`--Spacers-*` ×12、`--solo-*` ×9、`--accent-*` ×9、`--border-*` ×9、`--motion-*` ×6、`--spacing-*` ×6、`--Radius-*` ×6、`--special-*` ×5、`--monaco-*` ×5、`--user-*` ×4、`--transition-*` ×3、`--ul-*` ×3、`--welcome-*` ×2、`--gradient-*` ×2、`--prop-*` ×1、`--inline-*` ×1、`--workspace-*` ×1、`--slash-*` ×1、`--header-*` ×1、`--builtin-*` ×1、`--sheet-*` ×1、`--homepage-*` ×1、`--icube-*` ×1 |
| light | 4315 | `--vscode-*` ×3771、`--brand-*` ×92、`--bg-*` ×36、`--z-*` ×31、`--status-*` ×30、`--body-*` ×28、`--heading-*` ×27、`--query-*` ×25、`--radius-*` ×23、`--code-*` ×21、`--chat-*` ×18、`--viz-*` ×18、`--text-*` ×17、`--tw-*` ×17、`--icon-*` ×15、`--font-*` ×15、`--shadow-*` ×15、`--spacer-*` ×13、`--permission-*` ×13、`--Spacers-*` ×12、`--solo-*` ×9、`--accent-*` ×9、`--border-*` ×9、`--motion-*` ×6、`--spacing-*` ×6、`--Radius-*` ×6、`--special-*` ×5、`--monaco-*` ×5、`--user-*` ×4、`--transition-*` ×3、`--ul-*` ×3、`--welcome-*` ×2、`--gradient-*` ×2、`--prop-*` ×1、`--inline-*` ×1、`--workspace-*` ×1、`--slash-*` ×1、`--header-*` ×1、`--builtin-*` ×1、`--sheet-*` ×1、`--homepage-*` ×1、`--icube-*` ×1 |

### 变量来源形态

`rootVariables` 未带 `__host` 标注，走原生 `:root` 快路径（变量集中在设计系统 token 上）。

- **styleVars**（scheme 分布）：{"dark":4613,"light":4614,"neutral":5381}。

## 4. DOM 与语义锚点

- **domNodes**：{"default":576,"dark":576,"light":576}。
- **稳定锚点**（stable id + 非 hash class）：共 220 个，样例：

- `.account-host-module__accountHostRoot___X7Cuc`
- `.accountRoot-RH11Aa`
- `.accountTrigger-rIX2_l`
- `.accountTriggerAvatar-Vg2xpA`
- `.accountTriggerMembership-YFr_R7`
- `.accountTriggerName-VvlLCu`
- `.accountVariantSidebar-zVnhmb`
- `.ai-chat`
- `.app-region-drag`
- `.channelContainer-jEphRA`
- `.channelContainerCentered-VYZL0C`
- `.chat-input-v2-container`
- `.chat-input-v2-container--empty`
- `.chat-input-v2-container--no-focus`
- `.chat-input-v2-editor-part`
- `.chat-input-v2-editor-part-lower-content`
- `.chat-input-v2-editor-part-lower__left`
- `.chat-input-v2-editor-part-lower__right`
- `.chat-input-v2-input-box--modern-scroll`
- `.chat-input-v2-input-box-editable`
- `.chat-input-v2-input-box-wrapper`
- `.chat-input-v2-placeholder`
- `.chat-input-v2-slot-header`
- `.chat-input-v2-slot-overlay`
- `.chat-input-v2-slot-toolbar-right`
- `.chat-input-v2-upper-area`
- `.chat-input-v2__paragraph`
- `.chat-session`
- `.codicon`
- `.codicon-icube-Up`
- `.codicon-icube-menuToggle`
- `.collapsed-expand`
- `.container-YafeHb`
- `.core-model-select-portal`
- `.dark`
- `.default-FjFsr_`
- `.fKEtMF`
- `.gdmXQK`
- `.global-assistant`
- `.global-assistant-card`

> 锚点采集规则：过滤 css-module hash（`_pk7td_1`）、噪声类（`__as_*`）、单/双字符工具类。
> 升级后使用 `scripts/snapshot-compare.mjs` diff 语义锚点新增/消失。

## 5. 注入面与脆弱性提示

- **安全上下文**：`vscode-file://vscode-app`。
- **多 frame / OOPIF**：否，单 target 即可覆盖。
- **DOM 截断**：{"default":false,"dark":null,"light":null}。
- **应用到注入的对象形态**：详见 `fragility.md`。

## 6. raw/ 快照与升级 diff

```bash
cd C:\Users\snowb\Desktop\work\desktop-main
node scripts/cdp-full-extract.mjs --agent traework   # 生成新版 agents-raw-data/traework-full-extract.json
node scripts/gen-agent-arch-docs.mjs --only traework  # 重新生成 raw/ 快照与文档
node scripts/snapshot-compare.mjs agents-raw-data/traework-full-extract.json agents-raw-data/traework-full-extract.json --out docs/apps/traework/raw/upgrade-diff.md
```

