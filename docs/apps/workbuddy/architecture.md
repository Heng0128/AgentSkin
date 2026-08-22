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

### 1.3 静态-only 盲区成因（static-cdp-gap）

> 依据 `docs/apps/workbuddy/raw/static-cdp-gap.{md,json}` 逆向定位：静态 asar 有 341 个 token
> 命名空间，CDP 运行时 rootVars 仅 48 个覆盖，293 个为静态-only。逐一定位 CSS 源文件后，
> 成因三分，**绝大多数为「未加载 chunk」，非探针盲区，无需补采**：

| 盲区命名空间 | 变量数 | 静态源文件 | 成因 |
|-------------|--------|-----------|------|
| `--td-*`（tdoc/TDesign） | 249 | `renderer/assets/esm-pzWMy03t.css`（1.4MB） | 懒加载 chunk（腾讯文档/画板），未进主渲染帧，CDP 看不到属**预期** |
| `--base-*`（Radix `.rt-*`） | 36 | `main-content-core-DCwKsjo4.css` | Radix 组件级变量，值多走 `var(--x, fallback)` 内联，非 `:root` 暴露 |
| `--color-*` | 75 | `excalidraw-preview-component-MC91q8GC.css` 等 | excalidraw 画板独立库的 `--color-*`，未加载 chunk；注意与已加载 `--text-*` 等区分 |

- 同文件 `main-content-core` 内 `--cb-*`（156）已被 CDP 聚合到 `cb`(466)，但 `--base-*`
  未进入 rootVars——印证为「组件级变量 vs :root/聚合变量」的分层差异，而非漏扫。
- 运行时 DOM（`workbuddy-full-extract.json`）**无任何 `--td-`**：静态-only 不代表运行时会用到，
  据此判定为「未命中当前会话」而非真实缺口。

### 1.3.1 `--base-*` 回退链（已跟踪）

`--base-*`（Radix `.rt-*` 组件级）的 `var()` 回退链，按引用频率汇总其指向的目标 token：

| 引用目标命名空间 | 被 base 引用变量数 | 运行时 rootVars 存在? | 运行时真实位置 |
|-----------------|-------------------|----------------------|---------------|
| `--gray-*`（灰阶 + -a 透明） | 34 | ✅ 28 个 | `:root` rootVars |
| `--black-*` / `--white-*` | 20 / 4 | ✅ 12 / 12 | `:root` rootVars |
| `--space-*` | 13 | ❌ 0 | Radix 组件规则 `.rt-BaseDialogContent` 等 |
| `--base-*`（自引用） | 8 | ❌ 0 | 组件内链式传值 |
| `--card-*` | 6 | ❌ 0 | `.rt-Card` 组件规则 |
| `--checkbox-*` / `--radio-*` | 6 / 6 | ❌ 0 | 对应 Radix 组件规则 |
| `--color-*`（含 `--color-panel-solid`） | 5 | ❌ 0 | 组件规则 |

**关键判定**：`--base-*` 只引用两类目标——
1. **灰阶/黑白色板（`--gray-*/--black-*/--white-*`）**：运行时 rootVars **已有基底**，注入时可直接取到值（这是 `--base-*` 的可着色部分）。
2. **Radix 空间/尺寸/面板 token（`--space-*/--card-*/--color-panel-solid` 等）**：运行时**不出现在 rootVars**，而是分布在各 `.rt-*` 组件规则里（`variables.neutral.grouped`）。这类变量决定的是结构尺寸而非主题色，**不纳入 theme 注入作用域**——覆盖 `--base-*` 的颜色主题已能通过 #1 的色板间接生效。

**处理建议**：
- `--td-*`/excalidraw `--color-*`：直接忽略（未加载 chunk）。
- `--base-*`：**仅 `--gray-*/--black-*/--white-*` 回退链值得跟踪**（可着色基底已在运行时），
  `--space-*/--card-*` 结构类 token 无须补采——它们明确落在 Radix 组件规则而非 `:root`，
  是「分布式聚合」的固有形态，不是 CDP 丢失。

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

### 4.1 外部逆向情报核验（本地实测 vs 第三方归纳）

> 对照来源：第三方逆向归纳（workbuddy-skin-studio / WorkBuddy Theme Manager / CodeDrobe adapter
> 等，参考版本 v5.3.11）。下述以**本地 CDP+asar 实测**（基础版本 **5.3.14**）逐条裁决。

| 第三方主张 | 本地实测 | 裁决 |
|-----------|---------|------|
| `--cb-*` 设计变量约 **60+** 个 | 动态 rootVars `cb`=**466**，静态 asar `cb`=**562** | ⚠️ **严重低估**。`--cb-*` 只是变量体系一部分 |
| 业务设计变量前缀 `--cb-*` | **`--wb-*`** 才是主业务前缀：动态 863 / 静态 873 | ❌ **主前缀遗漏**。`--wb-*`(863) > `--cb-*`(466) |
| 深浅切换锚点 `data-vscode-theme-kind` | ✅ 存在，值 `vscode-light` / `vscode-dark`（CSS 规则 `body[data-vscode-theme-kind=...]`） | ✅ 属实 |
| 主容器 `.teams-container` | ✅ 存在（`[data-theme="dark"] .teams-container.is-mac` 等规则） | ✅ 属实 |
| React 根 `#root` | ✅ 存在 | ✅ 属实 |
| 视图锚点 `[data-view-id]` | ❌ **不存在**（全 JSON 零命中） | ❌ **错误**。本地稳定面是语义 class（`chat-container`、`conversation-list`、`collapsible-section`） |
| 深色 `.cb-dark` 类 | ✅ 存在（anchors 命中 `.cb-dark`） | ✅ 属实 |

**结论**：第三方情报在**内核判断**（VS Code 内核、`--vscode-*` 变量、`data-vscode-theme-kind` 深浅机制）上正确，
但在**变量规模**（`--cb-*` 60+ 低估近 10 倍）与**业务主前缀**（应为 `--wb-*`）上失准，且
**`[data-view-id]` 锚点不存在**——不可作为依赖锚点。
注入时应以本地实测为准：`--wb-*`/`--vscode-*` 为覆盖主体，`--cb-*` 为辅助，语义 class 为定位锚点。

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

