# doubao 架构文档 (AgentSkin)

> 逆向理解产物。基于 CDP 全量快照（`cdp-full-extract`）动态提取，未写回任何原应用文件。
> 动态布局来源：`agents-raw-data/doubao-full-extract.json`；
> 静态 asar 层：_暂无解包汇总_（可跑 `extract-asar-summary.mjs` 后合并）。
> 目标：支撑深度主题注入 / 脆弱性分级 / 语义锚点维护。

## 1. 包身份（CDP 运行时侧）

| 项 | 值 |
|----|----|
| agent | `doubao` |
| family | chromium-webview |
| 渲染 URL | `chrome://doubao-chat/chat/38438115344509442` |
| securityOrigin | `chrome://doubao-chat` |
| frameId | `071EB788CC3E19AAEFD6221C5866054E` |
| 快照时间 | 2026-08-18T13:55:02.972Z |

> 说明：目前无完整静态解包汇总，本节主要反映 CDP 运行时可见的渲染面身份。
> 完整进程模型 / 打包拓扑需补 `extract-asar-summary.mjs` 后回填。

## 2. 渲染面与安全上下文

- **scheme**：`chrome://doubao-chat`（决定 CDP 暴露面与 CSP 特征）。
- **frame**：主 renderer 单 frame，无多 frame 标记。
- **DOM 规模**：{"default":956,"dark":956,"light":956}（dataQuality.totalNodes）。
- **DOM 树实际可遍历节点**：956（dom.default 递归计数）。
- **stylesheets**：92 张，CORS 错误 0 张。
- **API 污染检测**：核心探测 API（querySelectorAll/getComputedStyle/matchMedia/getPropertyValue）仍为原生。

> 注入可行性先决：无 CORS 阻断、DOM 未截断、API 未被覆盖，CDP 动态注入才可信。

## 3. 变量体系（rootVariables + styleVars）

| scheme | rootVariable 数量 | 主要命名空间 |
|--------|------------------|--------------|
| default | 1199 | `--s-*` ×298、`--semi-*` ×261、`--dbx-*` ×251、`--color-*` ×92、`--tw-*` ×60、`--md-*` ×34、`--text-*` ×27、`--spacing-*` ×18、`--bg-*` ×15、`--radius-*` ×14、`--font-*` ×12、`--chat-*` ×10、`--desktop-*` ×6、`--static-*` ×6、`--select-*` ×6、`--neutral-*` ×5、`--ctx-*` ×5、`--g-*` ×5、`--primary-*` ×4、`--default-*` ×4、`--conditional-*` ×3、`--hover-*` ×3、`--action-*` ×3、`--max-*` ×3、`--scrollbar-*` ×3、`--leading-*` ×3、`--fill-*` ×2、`--light-*` ×2、`--dot-*` ×2、`--os-*` ×2、`--tracking-*` ×2、`--msg-*` ×2、`--animate-*` ×2、`--none-*` ×2、`--ease-*` ×2、`--safe-*` ×2、`--icon-*` ×2、`--slide-*` ×2、`--container-*` ×2、`--self-*` ×1、`--chatarea-*` ×1、`--video-*` ×1、`--send-*` ×1、`--loading-*` ×1、`--base-*` ×1、`--input-*` ×1、`--header-*` ×1、`--sidebar-*` ×1、`--google-*` ×1、`--border-*` ×1、`--answer-*` ×1、`--button-*` ×1、`--line-*` ×1、`--shadow-*` ×1、`--selected-*` ×1、`--active-*` ×1、`--table-*` ×1、`--click-*` ×1、`--as-*` ×1、`--settingarea-*` ×1、`--btn-*` ×1 |
| dark | 1199 | `--s-*` ×298、`--semi-*` ×261、`--dbx-*` ×251、`--color-*` ×92、`--tw-*` ×60、`--md-*` ×34、`--text-*` ×27、`--spacing-*` ×18、`--bg-*` ×15、`--radius-*` ×14、`--font-*` ×12、`--chat-*` ×10、`--desktop-*` ×6、`--static-*` ×6、`--select-*` ×6、`--neutral-*` ×5、`--ctx-*` ×5、`--g-*` ×5、`--primary-*` ×4、`--default-*` ×4、`--conditional-*` ×3、`--hover-*` ×3、`--action-*` ×3、`--max-*` ×3、`--scrollbar-*` ×3、`--leading-*` ×3、`--fill-*` ×2、`--light-*` ×2、`--dot-*` ×2、`--os-*` ×2、`--tracking-*` ×2、`--msg-*` ×2、`--animate-*` ×2、`--none-*` ×2、`--ease-*` ×2、`--safe-*` ×2、`--icon-*` ×2、`--slide-*` ×2、`--container-*` ×2、`--self-*` ×1、`--chatarea-*` ×1、`--video-*` ×1、`--send-*` ×1、`--loading-*` ×1、`--base-*` ×1、`--input-*` ×1、`--header-*` ×1、`--sidebar-*` ×1、`--google-*` ×1、`--border-*` ×1、`--answer-*` ×1、`--button-*` ×1、`--line-*` ×1、`--shadow-*` ×1、`--selected-*` ×1、`--active-*` ×1、`--table-*` ×1、`--click-*` ×1、`--as-*` ×1、`--settingarea-*` ×1、`--btn-*` ×1 |
| light | 1199 | `--s-*` ×298、`--semi-*` ×261、`--dbx-*` ×251、`--color-*` ×92、`--tw-*` ×60、`--md-*` ×34、`--text-*` ×27、`--spacing-*` ×18、`--bg-*` ×15、`--radius-*` ×14、`--font-*` ×12、`--chat-*` ×10、`--desktop-*` ×6、`--static-*` ×6、`--select-*` ×6、`--neutral-*` ×5、`--ctx-*` ×5、`--g-*` ×5、`--primary-*` ×4、`--default-*` ×4、`--conditional-*` ×3、`--hover-*` ×3、`--action-*` ×3、`--max-*` ×3、`--scrollbar-*` ×3、`--leading-*` ×3、`--fill-*` ×2、`--light-*` ×2、`--dot-*` ×2、`--os-*` ×2、`--tracking-*` ×2、`--msg-*` ×2、`--animate-*` ×2、`--none-*` ×2、`--ease-*` ×2、`--safe-*` ×2、`--icon-*` ×2、`--slide-*` ×2、`--container-*` ×2、`--self-*` ×1、`--chatarea-*` ×1、`--video-*` ×1、`--send-*` ×1、`--loading-*` ×1、`--base-*` ×1、`--input-*` ×1、`--header-*` ×1、`--sidebar-*` ×1、`--google-*` ×1、`--border-*` ×1、`--answer-*` ×1、`--button-*` ×1、`--line-*` ×1、`--shadow-*` ×1、`--selected-*` ×1、`--active-*` ×1、`--table-*` ×1、`--click-*` ×1、`--as-*` ×1、`--settingarea-*` ×1、`--btn-*` ×1 |

### 变量来源形态

`rootVariables` 未带 `__host` 标注，走原生 `:root` 快路径（变量集中在设计系统 token 上）。

- **styleVars**（scheme 分布）：{"dark":2297,"light":1199,"neutral":2767}。

## 4. DOM 与语义锚点

- **domNodes**：{"default":956,"dark":956,"light":956}。
- **稳定锚点**（stable id + 非 hash class）：共 401 个，样例：

- `.!bg-transparent`
- `.!border-none`
- `.!leading-22`
- `.!size-36`
- `.!text-[10px]`
- `.!text-dbx-text-primary`
- `.*:!z-1`
- `.*:!z-[1200]`
- `.-mr-4`
- `.-mr-9`
- `.-mx-12`
- `.ProseMirror`
- `.ProseMirror-trailingBreak`
- `.[&_svg]:shrink-0`
- `.[@media(max-width:799px)]:translate-x-[0%]`
- `.[@media(max-width:799px)]:translate-y-full`
- `.[border-bottom-width:var(--border-g-header-wra`
- `.[max-height:min(var(--radix-popper-available-height),480px)]`
- `.[max-width:min(var(--radix-popper-available-width),420px)]`
- `.absolute`
- `.activeTab-B2SWbR`
- `.addressBar-z4NOHc`
- `.addressForm-qG7huX`
- `.afte`
- `.after:absolute`
- `.after:content-['']`
- `.after:rounded-dbx-4xl`
- `.basis-0`
- `.bg-[#F`
- `.bg-[linear-gradient(90deg,var(--s-color-bg-trans,rgba(0,0,0,0.02))_0%,rgba(102,102,102,0.02)_100%)]`
- `.bg-[var(--s-color-bg-mask)]`
- `.bg-dbx-bg-base-web`
- `.bg-dbx-bg-float`
- `.bg-dbx-fill-trans-20`
- `.bg-dbx-function-success`
- `.bg-dbx-line-10`
- `.bg-linear-to-t`
- `.bg-s-color-bg-body`
- `.bg-tra`
- `.bg-transparent`

> 锚点采集规则：过滤 css-module hash（`_pk7td_1`）、噪声类（`__as_*`）、单/双字符工具类。
> 升级后使用 `scripts/snapshot-compare.mjs` diff 语义锚点新增/消失。

## 5. 注入面与脆弱性提示

- **安全上下文**：`chrome://doubao-chat`。
- **多 frame / OOPIF**：否，单 target 即可覆盖。
- **DOM 截断**：{"default":false,"dark":null,"light":null}。
- **应用到注入的对象形态**：详见 `fragility.md`。

## 6. raw/ 快照与升级 diff

```bash
cd C:\Users\snowb\Desktop\work\desktop-main
node scripts/cdp-full-extract.mjs --agent doubao   # 生成新版 agents-raw-data/doubao-full-extract.json
node scripts/gen-agent-arch-docs.mjs --only doubao  # 重新生成 raw/ 快照与文档
node scripts/snapshot-compare.mjs agents-raw-data/doubao-full-extract.json agents-raw-data/doubao-full-extract.json --out docs/apps/doubao/raw/upgrade-diff.md
```

