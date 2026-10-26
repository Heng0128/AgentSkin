# 注入引擎时效性审计 — 锚点 / Token / DOM 类

- 日期：2026-09-08
- 状态：COMPLETED（只读审计，未改任何引擎文件）
- 方法：以 `doubao-skin-main`（2026-08/09 豆包·豆包工作·WorkBuddy 5.3.14 **实窗验证**证据，见 `doubao-skin-main-analysis-2026-09-08.md`）为外部镜像，交叉比对 `engines/` 六引擎的锚点、token 家族与启发式逻辑；辅以全引擎静态扫描（硬编码 hash / 异栈 UI 库类 / 写死色值 / 探针日期）
- 范围：engines/doubao、engines/workbuddy、engines/shared/semantic-selectors.json 为重点；codex/zcode/traework/qoderwork 给出方法论级结论

---

## 0. 证据基线说明

豆皮仓库对本轮审计的价值在于它是**同期、同宿主、实窗验证**的第三方证据源：

| 证据 | 来源 | 时效 |
|------|------|------|
| 豆包/豆包工作宿主变量家族清单 | `themes/*/styles/doubao-family.css`（34 套主题实窗生效） | 2026-08-29/31 |
| WorkBuddy 5.3.14 稳定 landmark | `verification.md`（无正文 DOM 探针：`.teams-container` `.conversation-list` `.main-content` `.chat-container` `.wb-home-composer` `.wb-button`）+ `workbuddy_css()` 结构规则 | 2026-08-31 |
| 豆包宿主行为特征（壳页假活 / `cross-site-support` / 关窗 renderer 冻结） | `live.rs` 注释与测试 | 2026-08/09 |
| 豆包 CSP nonce（`argus-csp-token`）、`#chat-route-main`、`.md-box-root`、`[class*="greeting-text-"]`、`[class*="show-scrollbar-thumb"]` | `theme.rs` / `live.rs` | 2026-08/09 |

注意：这是**交叉印证**而非真理——豆皮未覆盖我们的 traework/qoderwork/zcode/codex；对这四个引擎本报告只输出方法论与内部一致性发现。

---

## 1. engines/doubao — 问题最集中

### D1（高危）`tokens.css` 的 "dead/legacy" 注释与外部证据矛盾

`engines/doubao/tokens.css` L397-402 声称：

> `--dbx-*/--s-color-*/--ffc-*` above are **dead/legacy** but kept for safety. Probe (2026-07-23) confirmed … Semi (`--semi-color-*`) is the REAL system.

但豆皮 34 套主题（2026-08-29/31 在真实豆包与豆包工作窗口验证生效）的 `doubao-family.css` **主力覆写的正是** `--dbx-*`、`--s-color-*`、`--N*`、`--B*`、`--semi-color-primary*`、`--input-guidance-*`、`--chat-*`、`--g-*`、`--cr-composebox-*`——若 dbx/s-color 已死，这些主题不可能实窗生效。结论：

- 该注释要么基于**单页面探针**（普通豆包 webview 某页）以偏概全，要么已过时；
- 约 390 行被标注"dead"的覆写实际是**承重墙**；
- 最大风险不是注释本身，而是**后继维护者按注释删除这些块**造成静默回归。

**处置**：改写注释为"多家族并存（Semi + dbx + s-color + N/B 色阶），按页面/版本分布，全部承重"；并把 2026-07-23 探针升级为带 target 维度的复测（豆包 vs 豆包工作分开记录）。

### D2（缺口）宿主变量家族覆盖不全

对照豆皮实窗生效清单，我方 `tokens.css` + `dark-mode-remap` 缺失以下家族：

| 缺失家族 | 作用 | 证据 |
|---------|------|------|
| `--N00..--N950` + `-raw`（中性色阶） | 豆包工作主表面体系，宿主以 `rgb(var(--N100-raw))` 组合 | claude-warm/dessert-giggle CSS，实窗生效 |
| `--B50..--B900` + `-raw`（品牌色阶） | 品牌强调 | 同上 |
| `--g-send-msg-bubble-bg/-text`、`--g-msg-bubble-bg/-text`、`--color-g-send-msg-bubble-text` | **消息气泡**双方配色 | claude-warm semantic_css 扇出 |
| `--cr-composebox-*`、`--color-composebox-*`、`--composebox-border-radius`、`--max-composebox-height`、`--chat-input-icon-size` | 输入框别名族（宿主至少 3 套并行命名） | theme.rs L1694-1866 |
| `--chatarea-bg-color`（我方仅有 `--chat-bg-color`） | 聊天区底 | dessert-giggle L278-279 |
| `--md-box-color-fg` / `--md-box-color-fg-muted`（我方仅有 `--md-box-samantha-*`） | markdown 容器桥 | theme.rs L2000 |
| `--color-dbx-text-primary/secondary/disable`（`--color-` 前缀孪生） | 文本双命名 | dessert-giggle L124-129 |
| `--dbx-bg-blur-md`、`--s-shadow-level1`（非 brand 后缀） | 模糊/阴影 | theme.rs L1937/L2036 |
| `--font-dbx-sans-serif`、`--code-font-family-mono` | 字体钩子 | theme.rs L1583-1600 |

**处置**：按上表补齐映射（全部从 `--agentskin-*` 派生，保持 theme-agnostic）；气泡与 composebox 族优先——它们直接决定"主题在豆包工作上是否可见"。

### D3（过时）`dark-mode-remap` 元素覆写区是"猜测锚点 + 写死色"双重污染

`adapter-config.mjs` L441-507 `getDarkModeElementOverrides()`：

1. **22 处写死 VS Code 灰**（`#252526 #E8E8E8 #3E3E42 #1E1E1E #2D2D30 #333337 #7A7A7A #4A4A4E #A0A0A0`）——与"每个值从 `--agentskin-*` 派生"的自家原则冲突：任何非 VS Code 灰系主题在豆包深色 remap 路径下都会出现灰块泄漏。
2. **`.dbx-history-item` / `.dbx-titlebar` / `.dbx-suggestion-card` / `.dbx-composer-actions`** 四个类名在豆皮全部实窗证据中**零出现**（豆包组件类是 CSS Modules 哈希 + data-testid，不存在 `dbx-` 前缀语义类）——疑似早期按"dbx 前缀"规律**推测生成**的死锚点。
3. `[class*="history-item"]`、`[class*="conversation-item"]` 等子串候选与豆包真实类（`greeting-text-`、`show-scrollbar-thumb-` 等）不匹配概率高。

**处置**：该区整体重写——色值改 `--agentskin-*` 派生；锚点删除或经 CDP 实窗复验后登记进合同（见 D6）。

### D4（过时）硬编码 CSS Module hash

`SUGGEST_GLASS_KILLER` 中 `[class*="content-KTJ1Rj"]`（L597）——`KTJ1Rj` 是构建产物 hash 片段，豆包一次前端发版即轮换。同规则内 `[class*="suggest"]/[class*="recommend"]/[class*="topic"]` 已足够覆盖，此条是**纯僵尸候选**。同类问题：`findGreetingElement()` 依赖问候语文案正则（`有什么我能帮你的|今天想聊点什么|…`）——豆皮处理问候区用的是 `[class*="greeting-text-"]`（类名稳定、文案轮换），应改为类名优先、文案兜底。

### D5（逻辑过时）深浅色判定源错误

`isDarkModePreferred()` 仅读 `matchMedia('(prefers-color-scheme: dark)')`（**系统**外观）。豆皮实证：豆包系宿主在 `html[data-theme]` / `body[theme-mode]` 上声明**应用自身**外观，可与系统相反；其运行时按 `data-theme → theme-mode → 系统` 三级取值。我方 dark-mode remap 在"系统深色 + 应用浅色"组合下会**错误注入深色覆写**。

**处置**：remap 判定改为读宿主属性优先（`documentElement.dataset.theme || body.getAttribute('theme-mode') || 系统`），并像豆皮一样监听这些属性变更触发重算（我方 MutationObserver 已有 attributeFilter 基建，加 `data-theme/theme-mode` 即可）。

### D6（方法论）doubao 没有选择器溯源合同

codex 引擎已有 `selectors.contract.json` + C14 双向守卫（未登记→FAIL、零消费→FAIL），这是全仓最成熟的锚点卫生机制。doubao 引擎恰恰是**本次发现死锚点最多**的引擎，却无合同。**处置**：为 doubao 建合同，初始条目直接采用"豆皮实窗证据 ∪ 我方 CDP 复测"，把 D3/D4 类锚点要么验活登记、要么删除；`check-selector-provenance.mjs` 的扫描面从 `engines/codex` 扩到 `engines/doubao`。

### D7（配置）`tokenConfig.excludeSuffix: '-raw'` 与宿主组合色模式冲突

L4 自动发现跳过 `-raw` 孪生变量，但豆包系宿主大量使用 `rgb(var(--X-raw), α)` 组合——只覆写主变量不动 `-raw`，半透明表面仍从**原生 RGB** 取色。我方 tokens.css 手工补了一部分 `-raw`，但自动发现层系统性跳过它们。豆皮的做法可借鉴：其主题 CSS 对每个覆写变量**成对**给 `-raw`。处置：自动发现对 `-raw` 孪生做"跟随主变量派生"而非排除。

---

## 2. engines/workbuddy

### W1（存疑）`.sidebar-next` 遮蔽补丁块无当前版本证据

`tokens.css` L263-287 为 `.sidebar-next / .sidebar-next-main-header / .detail-panel / .detail-sidebar` 建了第二层覆写（注释称"WorkBuddy 新版侧栏"）。豆皮对 5.3.14 的实窗探针中侧栏体系是 `.conversation-sidebar` + `.conversation-list`，**未出现 sidebar-next**。两种可能：(a) 我们针对的是 5.4.x 新壳（豆皮未覆盖）——那应登记版本与证据；(b) 早期猜测——应实窗复验。当前无日期、无探针记录，属**证据悬空**条目。

### W2（过时）`semantic-selectors.json` workbuddy 条目混入 Fluent UI 猜测

`.ms-Dialog / .ms-Button / .ms-ContextualMenu`（Fluent UI 前缀）与 `body[data-application-name='workbuddy']` 在豆皮 5.3.14 全部证据中零出现；其验证的按钮类是 **`.wb-button`**。`--cb-*` 体系 + `wb-*` 自研 kit 与 Fluent 无涉——这批 `.ms-*` 疑似按"VS Code 系 = Fluent"规律推测生成。同时我方 `adapter-config.mjs` 的 SELECTORS 里 `.conversation-sidebar/.conversation-list/.teams-main-content/.chat-container/.wb-cb-chat` 与豆皮证据吻合（**这些是活的**），`[class*="_gridViewItem_"]/[class*="_mainArea_"]/[class*="_dropdownRoot_"]` 为 CSS Module local-name 子串（半稳定，可接受但应登记）。

### W3（方法论）"token 层 Stability: HIGH" 注释被实窗证据证伪

`tokens.css` 头部称 `--cb-*` 稳定即高枕无忧。豆皮 support-workbuddy 变更的完整踩坑记录证明：**WorkBuddy 存在多层不透明宿主表面**（白色 `.teams-content-wrapper` 父层、侧栏四层 0.51 alpha 叠底、类型轨道官方灰），纯 token 覆写穿透不了，必须补结构透明规则（`.teams-container :has(> .teams-content-wrapper){background:transparent}`、单一 shell + 内部全透明 + 选中强面）。我方 cosmetic.css 已有部分结构规则，但"该透明的不透明"这类**表面角色分层**（shell/track/control/strong 四档）值得作为 doubao+workbuddy 共同的审计专题：用计算样式探针逐角色断言 alpha，而非只看"颜色变了"。

### W4（保留意见）localStorage 猴子补丁的持久性

`initThemeStorageAwareness` 包装 `localStorage.setItem` 且无 destroy 路径——restore 后补丁仍在（幂等但残留）。豆皮的对应纪律：restore 白名单只清自有产物、**不碰宿主存储**。我方应给该补丁加 `__agentskin_destroy` 钩子纳入恢复链。

---

## 3. engines/shared/semantic-selectors.json — 三处硬伤

消费方：`scripts/build-theme-package/generic-electron-css.mjs`（构建期生成通用 Electron CSS），**是活数据**。

| # | 位置 | 问题 |
|---|------|------|
| S1 | L16 qoderwork sidebar | `"[role='navigation'"` **缺右括号**——该候选选择器语法非法，`querySelectorAll` 直接抛错或永不匹配（workbuddy adapter-config L225 的注释记录了同类逗号 bug 在 2026-09-07 才修复，说明此文件缺乏最低限度的"每条选择器可解析"守卫） |
| S2 | L36-38 doubao dialog/button/menu | `.ant-modal/.ant-btn/.ant-dropdown`——豆包是 **Semi Design** 栈（`--semi-color-*`、`.semi-popupview-*` 我方 tokens.css 自己都在用），Ant 类大概率零命中；应换 `.semi-modal/.semi-popup/.semi-button` 系 |
| S3 | L25 workbuddy main | `.conversation-surface` 无外部证据（豆皮证据链里是 `.conversation-list/.chat-container/.wb-cb-chat`） |

**处置**：修 S1（一行）；S2/S3 实窗复验后替换；并给该 JSON 加守卫脚本——所有选择器过一遍 `CSS.supports('selector(...)')`/DOMPurify 式解析检查，纳入 `npm run check`（新不变量候选 C15：**选择器可解析性**）。

---

## 4. 其余引擎（traework / qoderwork / zcode / codex）

- **codex**：C14 合同 + 双向守卫 + 版本区间验证（26.715→26.818）是全仓锚点卫生的**内部黄金标准**。本次 doubao/workbuddy 的整改以它为模板。
- **zcode**：有"probe-verified exact anchor"意识（`[data-workspace-sidebar-panel="true"]` 策略 0），但探针编号（50894）无日期与合同——建议同样合同化，成本低（锚点数量少）。
- **traework**：tokens.css 注释带探针编号（58510）与日期缺失；`[data-trae-ref]` 系锚点若为 Trae 官方埋点则较稳，需登记来源。
- **qoderwork**：2026-09-07 刚做过 CDP 复测（header 锚点更新），最新鲜；但 S1 语法 bug 说明**复测没覆盖 semantic-selectors.json**——守卫脚本应把该文件列入扫描面。

---

## 5. 方法论提炼（豆皮值得模仿的"做法"，非资产）

按"可直接照搬纪律"排序：

1. **所有权仲裁下沉到页面**：注入根元素 `data-skin=<themeId>`，watcher 每轮 Own/Missing/Foreign 三态判定，Foreign 即让位退出。模仿成本极低（我方 marker 已有，缺仲裁语义），根治多实例互踩与"恢复后残留 watcher 再应用"两类问题。
2. **恢复即白名单**：restore 脚本只允许触碰自有 id/属性/runtime，并用**契约测试断言它不含** `localStorage/indexedDB/宿主属性删除`。我方 remove 路径应补同款测试（对照 W4）。
3. **锚点必须带证据与版本区间**：C14 已在 codex 落地，豆皮的 `verifiedAgainst`（版本号 + 双端实测）证明这条路能长期防腐烂——推广到 doubao/workbuddy 即 §1 D6、§2 W1/W2 的根治手段。
4. **深浅色判定读宿主属性优先**，监听属性变更页内切换（双份载荷），系统 media query 只做兜底——见 D5。
5. **成对覆写 `-raw` 孪生**：凡宿主存在 `rgb(var(--X-raw))` 组合模式，主变量与 `-raw` 必须原子成对，否则半透明表面泄漏原生色——见 D7。
6. **表面角色分层审计**：用计算样式探针按"shell/track/control/strong"角色断言 alpha 与对比度（豆皮 `check-workbuddy-surface-semantics.js` 模式），比"截图看看变了没"可靠一个量级。我方巡检方向 B（注入可观测化）可吸收为 doubao/workbuddy 的实窗语义回路。
7. **失败优先 + 量化视觉 diff**：回归测试先红后绿并记录 exit code；视觉变更用像素差分 %/RMSE 阈值判定——直接可写入我们的 verification/巡检模板。
8. **CSS 沙箱 AST 化**：主题/自定义 CSS 校验从启发式（sanitizeCSS）升级为 AST 白名单（postcss 即可），选择器强制主题作用域根、布局/交互属性拒绝、`url()` 拒绝——是 C13/C14 的自然延伸。
9. **壳页假活检测**：豆包关窗后 renderer 会换成 `cross-site-support` 壳页且**仍应答 CDP**——任何存活判定必须校验 `location.href` 非壳页。我方 watchdog/preflight 若无此检查，会出现"探针显示存活但注入无效果"的假阳性（值得列入下轮巡检方向 A 用例）。
10. **文案锚点最后化**：一切以可见文案（问候语、按钮文字）为锚的逻辑降级为兜底，优先类名/属性/几何——豆皮问候区动画遮罩修复（2026-08-30）走的正是 `greeting-text-` 类名路线。

---

## 6. 修复优先级汇总

| 级别 | 项 | 动作 | 面 |
|------|----|------|----|
| P0 | S1 | 修 `[role='navigation'` 语法错误 | semantic-selectors.json（一行） |
| P0 | D1 | 改写 "dead/legacy" 注释为"多家族承重" | tokens.css 注释 |
| P0 | D3 | dark-mode 元素覆写区：删 4 个无证据 `.dbx-*` 类、22 处写死灰改派生色 | adapter-config.mjs |
| P0 | D4 | 删 `content-KTJ1Rj` hash 候选 | adapter-config.mjs |
| P1 | D2 | 补 `--N*/--B*/--g-*/--cr-composebox/--chatarea/--md-box-color-fg/--color-dbx-*` 家族映射 | tokens.css |
| P1 | D5 | 深浅色判定改宿主属性优先 + 属性监听 | adapter-config.mjs |
| P1 | D6/W1/W2 | doubao+workbuddy 选择器合同（C14 模板），死锚点验活或删除 | 新 contract ×2 + 守卫扩面 |
| P1 | D7 | `-raw` 孪生跟随派生 | unified engine token-discovery |
| P1 | S2/S3 | doubao `.ant-*`→Semi 系、workbuddy `.ms-*` 处置 | semantic-selectors.json + 守卫脚本（C15 选择器可解析性） |
| P2 | W3 | 表面角色 alpha 实窗语义回路探针（doubao/workbuddy） | 巡检工具 |
| P2 | 方法论 1/2/9 | 所有权三态仲裁、restore 白名单测试、壳页假活检查 | 引擎/watchdog |

> 所有 P1 及以上改动涉及注入引擎，按黄金规则 4 属"非必要不重构"边界内的**局部修正**（不动层所有权架构），无需 RFC；唯 C15 新不变量与守卫脚本新增需在 `scripts/INDEX.md` 登记。

---

## 7. 结论

我方注入架构（五层所有权、adoptedStyleSheets、持久 session、自愈巡逻）在**机制层面不落后**，甚至优于豆皮（CSP 免疫、6 宿主、壁纸引擎）。落后的是**锚点卫生的持续性**：codex 有 C14 合同，而本次审计在 doubao 一个引擎里就揪出 4 个推测类名、1 个构建 hash、1 组文案正则、22 处写死色、1 个判定源错误和一整族缺失变量；workbuddy 有 3 处证据悬空锚点；semantic-selectors.json 有 1 个语法错误和 2 组异栈猜测。豆皮用实窗证据回答了"当前宿主真正长什么样"——把它当**免费的外部验证源**，按 §6 清单逐项清洗并推广合同机制，比新增任何功能都更能提升注入质量的稳定性。

---

## 8. 实施记录（2026-09-08 当日推进）

审计过程中新发现（补录）：**双源漂移**——`dark-mode-remap.mjs` 是仅被自身测试引用的死模块，运行时生效的是 `adapter-config.mjs` 内联旧副本（写死灰版本）；且死模块使用坏变量名 `--agentskin-text-muted`（正名 `--agentskin-muted`，经 `themes/*/palette.css` 核实），其测试还把这两个问题锁死为断言。

### 已完成

| 项 | 文件 | 内容 |
|----|------|------|
| S1 | `engines/shared/semantic-selectors.json` | 修 `[role='navigation'` 缺括号语法错误 |
| S2 | 同上 | doubao `.ant-*` → Semi 公开类（`.semi-modal/.semi-portal/.semi-button/.semi-dropdown-menu/.semi-popover`），带修正注释 |
| S3/W2 | 同上 | workbuddy 删无证据 `.conversation-surface` 与 `data-application-name` 根锚点；`.ms-*` Fluent 猜测 → 实证 `.wb-button` + `[class*=popover/dropdown]`；composer 增实证 `.wb-home-composer` |
| D1 | `engines/doubao/tokens.css` | "dead/legacy" 注释改写为"多家族并存、全部承重"，引用豆皮实窗交叉证据，明令禁止按旧注释删块 |
| D2 | 同上 | 补齐缺失家族（全部 `--agentskin-*` 派生）：composer 别名族（`--color-composebox-*`/`--cr-composebox-*`）、消息气泡族（`--g-*-bubble-*`/`--color-g-*`）、`--chatarea-bg-color`、`--md-box-color-fg(-muted)` 桥、`--color-dbx-text-*` 孪生、caret；新增 **N/B 色阶块**（N00..N950/B50..B900 + `-raw` 孪生成对，方向随主题极性自动翻转） |
| D3 | `engines/doubao/adapter-config.mjs` + `dark-mode-remap.mjs` | 两份副本的元素覆写区：22 处写死 VS Code 灰 → `--agentskin-*` 派生；删 6 枚虚构 `.dbx-*` 精确类；加双源同步警告注释 |
| D4 | `engines/doubao/adapter-config.mjs` | 删 `[class*="content-KTJ1Rj"]` 构建 hash 僵尸候选；`findGreetingElement` 改类名优先（`greeting-text-` 实证类）→ 文案正则降为兜底 |
| D5 | 两份副本 | `isDarkModePreferred` 改宿主属性优先（`html[data-theme]`/`body[theme-mode]` → 系统 media query 兜底），与豆皮 appMode() 契约对齐 |
| 测试 | `dark-mode-remap.test.mjs` | 修正被锁死的错误断言（`--agentskin-text-muted`、`.dbx-account-info`）；新增 3 条宿主属性优先行为测试；35/35 通过 |

### 门禁结果（2026-09-08）

- `npm run check`：**20/20 全绿**（含 specificity-budget：doubao 614/650 在预算内；design-tokens、injection-contract、selector-provenance 全过）
- `npm test`：8306/8317 通过；6 个失败经依赖链甄别**全部为存量/WIP 问题**，与本次改动无关：
  - `scripts/selector-preflight.test.mjs`（1）→ 仅依赖 `src/engine/src/contracts/selector-contract.json`（工作区 WIP 改动中）
  - `src/engine/src/runtime/preflight.test.ts`（4）→ 仅依赖 `selectivity-registry.mjs`（工作区 WIP 改动中），失败签名 binding index 0→1
  - `src/main/wallpaper/preview-cache.test.ts`（1）→ 单跑通过，时序 flaky
- 本次修改的 5 个文件（semantic-selectors.json / doubao tokens.css / adapter-config.mjs / dark-mode-remap.mjs / 其测试）不在上述任何依赖链上

### 未完成（后续增量）

- ~~D6/W1 选择器合同~~ → **当日已完成**（见 §9：两份合同落盘，W1/W2 被实窗探针部分推翻并修正）
- **D7**：token-discovery 的 `-raw` 孪生"跟随派生"（改 `engines/unified/engine.mjs`，影响面大）
- **W4**：workbuddy localStorage 猴子补丁缺 destroy 钩子
- **C15 提案**：semantic-selectors.json 选择器可解析性守卫脚本（本次 S1 类 bug 的自动化防线）；以及把 `check-selector-provenance.mjs` 扫描面从 engines/codex 扩到 doubao/workbuddy（合同已就位，守卫扩面前合同为纯文档）
- **建议卡玻璃空转**：SUGGEST_GLASS_KILLER + native-defect suggest 规则当前构建全零命中（类名已哈希化），根治需豆皮式 aria-label 运行时标记（四类首页卡文案稳定），已登记 doubao 合同 `suggest-glass-family`
- **豆包工作（doubaowork://）实窗复验**：N/B 色阶与 `--cr-composebox-*` 族在消费版豆包为组件作用域/不存在，豆包工作侧仅有豆皮外部证据，待我方 doubaowork 探针收口

---

## 9. 实窗探针复核（2026-09-08 当日，六端口全开窗口期）

探针：`test-output/probe-live-2026-09-08.mjs`（gitignored），经 CDP 对 `doubao://doubao-chat`（首页/launcher/background 三页）与 Windows WorkBuddy 主 renderer 做只读存在性探测（未注入、未读正文）。

### 9.1 推翻审计判断的两项（诚实记录）

| 项 | 审计原判 | 实窗复核 | 处置 |
|----|---------|---------|------|
| W1 `.sidebar-next` 遮蔽补丁"证据悬空" | 疑为猜测 | **hit=11**，`detail-panel`=2、`detail-sidebar`=3 —— 当前 Windows 构建活跃 | 保留，登记合同 `sidebar-next` alive |
| W2 `body[data-application-name]` "无证据" | 已从 semantic-selectors 移除 | **hit=1** —— 移除属过当 | 恢复为 root 候选，登记合同 `app-identity` L1 |

（`.ms-*` Fluent 猜测维持移除——探针全 0；`.conversation-surface` 维持移除——全 0。）

### 9.2 验证修复正确的各项

- **D3**：6 枚虚构 `.dbx-*` 精确类探针全 0 ✓；`content-KTJ1Rj`=0 ✓（D4）
- **D4**：`greeting-text-`=1 ✓（类名优先正确）；4 枚 data-testid 全 alive ✓
- **D5**：宿主确在 `html[data-theme]` 声明外观（探针页 = dark）✓
- **D2 部分**：`--g-send-msg-bubble-*`、`--color-g-*`、`--chatarea-bg-color`、`--color-dbx-text-*` 孪生、`--chat-input-icon-size`、`--dbx-bg-blur-md`、`--s-shadow-level1`、`--font-dbx-sans-serif` 原生存在 ✓
- **方法论 9**：`doubao://doubao-chat/cross-site-support/` 壳页真实存在于 target 列表 ✓

### 9.3 新认知（修正 D1/D2 的粒度）

1. **N/B 色阶在消费版豆包是组件作用域**：宿主样式表扫描到 `--N*`=52、`--B*`=22 条声明，但 `:root/body` computed 为空——声明挂在组件级选择器上。我方 tokens.css 的 html/body 级 N/B 块在消费版会被组件局部声明遮蔽（无害），真正受益面是豆包工作（豆皮证据显示其主题在 html/body 级覆 N/B 实窗生效）。**结论：保留，语义从"覆写"降级为"兜底继承值"，豆包工作复验前不宣称已解决。**
2. **`--ffc-*` 才是真 legacy**：消费版豆包宿主样式表 ffc 声明数 = **0**。tokens.css 约 35 行 ffc 块在此构建纯空转（豆包工作未测）。讽刺点：旧注释把活的 dbx/s-color 标成 dead，真 dead 的 ffc 反而没标。
3. **`--cr-composebox-*`/`--color-composebox-*` 族在消费版不存在**（声明数 0）——豆皮扇出目标，判定为豆包工作专属。保留（无害）。
4. **WorkBuddy token 版图**：`--cb-*`=567、`--vscode-*`=867 声明（我方押注正确）；**新发现 `--cr-*`=233 声明未入任何映射与 knownPrefixes**（待专题）；`--sc-ui-*` 在此构建基本缺席（扫描仅 12 条 `--sc-*`，2026-08-19 补的 sc-ui 块在此空转——可能是版本漂移）；我方 tokens.css 里 `--cb-chat-*/--cb-markdown-*/--cb-input-*/--cb-editor-*/--cb-tab-*/--cb-badge-*/--cb-notification-*` 探针全空——**按命名规律推测的变量名**，登记为待清理候选（无害但误导）。
5. **WorkBuddy 外观声明 = class**（`dark cb-dark vscode-dark` 同时挂在 html+body）——豆皮 appMode() 的 class 正则路线在 Windows 同样成立；我方 workbuddy 引擎若无 class 路线深浅色判定，纳入 D5 后续。
6. **豆包 ARIA 稀薄**：`[role="navigation"]`/`[role="main"]`/`[role="button"]` 全 0（用原生标签）——`detectRoute()` 的 role 分支在此构建永不触发（有兜底，不死人），semantic-selectors doubao 的承载候选已按探针重排为 `main/aside/[contenteditable]/[role='textbox']`。

### 9.4 合同落盘

- `engines/doubao/selectors.contract.json` — 21 条目（alive 12 / view-dependent 5 / inert 3 / removed 1 组），status 字段扩展自 codex 格式
- `engines/workbuddy/selectors.contract.json` — 20 条目（alive 16 / partial 1 / view-dependent 1 / inert 1 / removed 1 组）
- 守卫扩面（`check-selector-provenance.mjs` 扫 doubao/workbuddy）留作下一步——当前两合同为证据登记，先积累 status 复验周期

---

## 10. 第二增量：探针数据驱动修复（2026-09-08 续）

深挖已落盘探针 JSON 的 `nativeDecls` 全量清单（宿主原生声明的每一个自定义属性名），得到比"存在性"更强的**逐名判定**：

### 10.1 WorkBuddy token 版图重绘（`engines/workbuddy/tokens.css`）

- **我方 22 个猜测 `--cb-*` 名仅 2 个真实**（`--cb-sidebar-bg`/`--cb-text-link`）——chat/markdown/input/tab/notification 五块大半是按命名规律推测的死名。旧块保留（版本漂移保险，注释已标注），**新增探针实证名映射**：
  - 输入框真名：`--cb-input-background/foreground/placeholder/border-color/border-primary/focus-border-color/active-border/hover-bg/button-background/button-foreground/area-container-secondary`
  - Markdown 代码块真名：`--cb-markdown-code-block-bg/header-bg/border/code-bg-color/action-fg/action-hover-bg/title-fg/table-*/border-color/symbol-*`、`--cb-send-button-loading-*`、`--cb-chat-menu-main-text`
  - 真 `--sc-*` 集（12 名：surface/surface-alt/body/title/muted/border/border-soft/hover…）——我方 2026-08-19 的 `--sc-ui-*` 块在此构建整体缺席（版本漂移，保留标注）
- **`--cr-*` 确认为完整平行主题系统**（233 声明：`--cr-accent/brand-primary/bg-canvas/bg-elevated/bg-code(-header/-inline)/code-fg/border-default(-elevated/-strong)/badge/chip/avatar/input-inset` + 语法高亮 `--cr-code-*`）——WorkBuddy 代码工作区 UI 此前从未被任何层触达。新增保守子集映射（仅名称语义明确者；语法高亮与语义色保持原生）。**待实窗视觉复验 `--cr-bg-primary/secondary/tertiary` 的极性方向后再扩面。**

### 10.2 W4 + 衍生发现 W5（workbuddy 恢复链）

- **W4**：`localStorage.setItem` / `serviceWorker.register` 猴子补丁改为**可逆**——`HOST_PATCHES` 注册表 + `restoreHostPatches()`（逆序执行），监听器与补丁加幂等守卫（persist 双执行防双包装/双监听）。
- **W5（本轮新发现，比 W4 更重）**：workbuddy 是**唯一从不设置 `window[MARKER]` 的适配器**——`already-applied` 守卫形同虚设，且 restore 清理链（`CLEAR_ADAPTERS_BODY` 按 marker 摘除 observer/interval）对 workbuddy 完全空转。修复：adapter.mjs 注册 marker（含 `storageRestore`/`patrolStop` 句柄），`src/shared/injection-runtime.ts` 两处清理循环（`CLEAR_ADAPTERS_BODY` + 内联 builder）新增通用钩子调用。

### 10.3 C15 落地（新不变量）

- `scripts/check-selector-parsability.mjs`：零依赖结构校验（括号/引号平衡、前/中/尾逗号卫生、非空），覆盖 S1（缺 `]`）与 2026-09-07 workbuddy（`:is(...),`）两类真实事故；导出 `validateSelector` 供自测。
- `scripts/check-selector-parsability.test.mjs`：16 用例（含 codex 长选择器、引号内逗号误报防御等真实形态）。
- 登记：`check-suite.mjs`（第 21 项）、`scripts/INDEX.md`、`AGENTS.md` §6 C15 行。
- 现状：155 候选 × 6 agent 全通过。

### 10.4 门禁与归属说明

- 本轮改动面：`engines/workbuddy/{tokens.css,adapter.mjs,adapter-config.mjs}`、`engines/shared/semantic-selectors.json`（探针重排 + 恢复 data-application-name）、`engines/{doubao,workbuddy}/selectors.contract.json`（新）、`scripts/check-selector-parsability.{mjs,test.mjs}`（新）、`scripts/{check-suite.mjs,INDEX.md}`、`src/shared/injection-runtime.ts`、`AGENTS.md`、本报告。
- 门禁中 `css-classes` 一度报 6 个缺失类名（SidebarTooltip/page-toolbar/SettingsPage/WorkspacePage/SidebarMenuItem 等工作区 WIP UI 文件）——经 `npm run build` 重建产物复核**全部正常产出**，根因是产物过期而非代码债；重建后守卫绿。

---

## 12. 六引擎全量 X 光（2026-09-08 第三增量，六端口全开窗口期）

探针 `test-output/probe-all6-2026-09-08.mjs`（v3，类型化锚点映射 + 全页 union + 噪声过滤）：对六引擎各提取**其文件引用的全部 DOM 锚点**（含 semantic-selectors）与 **tokens.css 覆写的全部宿主变量**，实窗测存活。数据落盘 `probe-all6-2026-09-08.json`。

### 12.1 总览

| 引擎 | 页面采样 | 锚点 alive/总 | tokens 真实/覆写 | 关键发现 |
|------|---------|--------------|-----------------|---------|
| traework | 主窗 ×1 | 35/91 | 129/150 | 核心 task-list/chat-input-v2/messageInput 族全活；21 幽灵 token（--vscode-input-validation-* ×9 等）；**未覆盖原生族 ~390 变量**（--bg-bg:45/--text-text:23/--brand-brand:22/--ras-*:185/--query-tag:26/--popup-menu:22） |
| qoderwork | 主窗+voice ×2 | 20/102 | **108/108 满分** | `.ant-*` 零命中（非 Ant 栈）已删；artifact/MCP/quickpick/canvas/writing 约 60 锚点全为面板懒加载（view-dependent） |
| workbuddy | 主窗 ×1 | 47/74 | 181/250 | 69 缺席名 = §10.1 猜测块清单精确吻合（实锤）；原生 `--wb-*` 组件 kit（wb-button:101/wb-bg:74/wb-input:53…）与 `--cr-internal:108` 未覆盖 |
| doubao | chrome:// 壳页 ×3 | 31/98 | 99/472* | *v3 采到 chrome:// 壳文档（dbx/s-color 样式表不在此文档）——**v1 的 doubao:// 数据仍有效**；greeting-text-/testid/conversation-item 复活 ✓；suggest/recommend/topic 与 dark-mode 元素区多数子串在真 UI 页也零（v1 已证） |
| zcode | 聊天窗 ×1 | 12/61 | 0/0（**有意占位**） | data-workspace-sidebar-panel/.dark/.theme-zai-dark 活；monaco/pdf/katex 全因编辑器窗口未开不可采 |
| codex | ChatGPT 主窗 ×2 | 38/71 | 0/0（占位） | **合同经受住考验**：data-* 语义锚点全活（app-shell-main-surface/composer-variant/response-annotation×19/sidebar-item×11）；CSS Module 名（_MainContentSurface_/_Header_/_markdown_）已轮换——多锚点设计兑现；合同 verifiedAgainst 建议补记 2026-09-08 |

### 12.2 方法论教训（写进探针纪律）

1. **单快照零命中 ≠ 死锚点**：v2 曾因 `[class*]` 子串被误映射为精确类匹配制造大量假零；v3 修正映射后 workbuddy alive 32→47、codex 26→38。任何"清理"必须以**类型化探针 + 多视图采样**为准——W1/W2 之覆辙不允许第三次。
2. **视图态覆盖矩阵**：会话消息流、弹窗/菜单、artifact/quickpick/canvas、编辑器窗、豆包工作（doubaowork://）各需一次采样才能把 view-dependent 转成判定。当前六应用停在"首页+无浮层"态，已覆盖的判定面到此为止。
3. **豆包双 scheme 文档差异待查**：v1（doubao://）与 v3（chrome://）两文档的样式表清单不同（dbx/s-color 声明扫描结果不一致）；但专属探针证实 **chrome://doubao-chat 同样承载全部 L1 testid 锚点**（非"壳页"，§12.1 初判已修正）——两文档样式表差异的确切原因（窗口重开时序/懒加载样式表）留待下轮带时序采样确认。

### 12.4 六引擎专属探针（最终形态，回应"一探针不能适配六宿主"）

通用 X 光只能扫"当前一帧"；已改建 `scripts/probe-engine/`：**每引擎一支专属探针**（lib 共享 CDP 底座），各自定制——页面分样规则（豆包 doubao:// 与 chrome:// 分文档、codex app:// 双路由、workbuddy 严格 renderer）、外观读取器（data-theme / `dark cb-dark vscode-dark` class 正则 / `.theme-zai-dark`）、token 期望（只列精确名，族名前缀不作期望）、**直接消费自家合同**做锚点活体复验，并对 zero-in-sample 输出"该打开哪个视图"的补采指引。实跑：doubao 13/20、workbuddy 17/18、traework 7/11、qoderwork 4/4 tokens、zcode L1 复验通过、**codex 18/29（合同复验闭环）**。登记 `scripts/INDEX.md`。

### 12.3 本轮落盘

- 合同 ×3：`engines/{traework,qoderwork,zcode}/selectors.contract.json`（status 分级 alive/partial/view-dependent/inert-or-view-dependent/removed + tokenNotes 覆盖缺口清单）
- `semantic-selectors.json`：qoderwork 块按探针重排（`.ant-*` 删，实证锚点前置）
- 至此**六引擎合同全覆盖**（codex 原有，其余五份本轮建立）
- 探针脚本与 JSON 均在 `test-output/`（gitignored）

---

## 13. 探测体系整合（2026-09-08 第四增量：六引擎深度适配）

应"六宿主各不相同、一探针不能通用、严禁套用、保持更新"四点要求，全仓探测文件整合完成。

### 13.1 盘点结论（整合前全仓探测资产）

| 资产 | 处置 |
|------|------|
| `scripts/anchors/index.mjs`（六 agent 精确锚点注册表，PROBE-DATE 2026-08-23 + build 号） | **保留为 A 源**（权威锚点面），由新探针活体复验；漂移即报警 |
| `scripts/lib/landmarks/*.mjs`（六份地标） | **保留为 B 源**；doubao 份已刷新（旧内容含虚构 `.dbx-composer`/`[data-testid="composer"]`，1/7 存活 → 刷新后 7/10，余 3 为仅主题注入后存在的自有产物，语义正确）；其余五份的过期条目由探针 DRIFT 持续暴露 |
| `engines/<id>/selectors.contract.json` ×6 | **C 源**（本轮建齐 5 份 + codex 原有），逐变体复验 |
| `scripts/cdp-probe-{v2,doubao,screenshot,traework-live}.mjs` | 锚点校验职能**并入 probe-engine**；截图专项保留 |
| `scripts/analyze-structure-compare/`、`scripts/cdp-full-extract/` | 结构对拍/DOM 全量提取专项，保留；端口发现逻辑与 anchors 注册表被 probe-engine 复用/消费 |
| `src/main/cdp/{baseline-capture,cdp-fingerprint,landmark-preflight,renderer-rank,...}` | 运行时（主进程）探测，与构建期探针分工不同，不动 |

### 13.2 `scripts/probe-engine/` 最终形态（六支深度适配探针）

每支探针五要素**各自定制、互不套用**：① 身份页面分样 ② 外观读取器 ③ 结构断言 ×3（引擎专属，如 workbuddy 侧栏双实现并存断言、zcode 聊天/编辑器窗识别、codex data-* 承载断言）④ token 精确名期望（族名前缀不作期望——本轮自纠的 bug；占位 L0 引擎置空）⑤ 四源锚点面 + **DRIFT 报警**（注册表/合同声明存活而实测全零 → 应用更新检测器）+ 视图补采指引。

### 13.3 实跑战果（首轮即抓到真问题）

- **codex 15/15 注册表锚点全活**（修掉 lib 顶层逗号切分 bug 后——`:is(a, b)` 曾被拆坏制造假 DRIFT；教训：探针自身也要失败优先复验）
- **真 DRIFT**：doubao `message`/`sendButton`（需会话视图）、qoderwork `navActive`/`rightPanel`（需面板视图）、workbuddy `mainArea`（与合同 inert 判定吻合，注册表该角色应更新）、zcode `header`/`assistantTurn`/`userRow`（需会话视图）
- **doubao landmarks 1/7 → 7/10**；validate-theme 消费方 29/29 通过
- 六引擎断言 18/18、token 期望 20/20 全过

### 13.4 保持更新机制（闭环）

应用更新 → 跑 `probe-engine/<id>.mjs` → DRIFT 行点名"注册表 role X 已零命中" → 人工实窗复验 → 更新 anchors 注册表/合同 status/landmarks → 再跑探针确认清零。注册表 PROBE-DATE 注释与合同 verifiedAgainst 是时间锚，探针是复验器——三者构成防腐闭环。

### 13.5 五份 landmark 刷新（第五增量）

按探针 B 源零命中清单逐份处理：workbuddy（detail-panel 改实证 `[class*="detail-panel"]`、main-area 删已轮换的 `_mainArea_`、codebuddy 时代遗留组标注"仅版本漂移保险"、workspace 组按实证重排）、traework（required 里删注册表判死的 `.solo-lite-layout`、panel-content 删死名）、qoderwork（**头注纠正"antd-based"为自研 agents-* + Tailwind v4**）、zcode（删零命中的 aside/textarea；header 组**拒绝臆造替代名**，留注待编辑器窗复验回填）、codex（composer 删裸 `.composer-surface-chrome`/`_multilineSurface_` 死变体）。validate-theme 消费方 29/29 通过。

**复跑时的意外收获**：用户正在实时切换六应用视图，探针立刻捕捉——doubao greeting 锚点随离开首页归零、workbuddy home-composer/scene-tabs/quick-actions 整组转零、DRIFT 行如实点名"view-dependent or drift"。这验证了两件事：① 漂移检测器对**状态变化**同样灵敏（探针报告必须绑定视图态解读）；② 六引擎的"全量判定"必须按 §13.4 闭环在**受控视图态**下逐视图跑，而非随手一采。最终门禁 20/21（css-classes 红灯为老板实时编辑的 sidebar WIP 与构建产物的时间差，非本次改动）。
