# doubao-skin-main（豆皮）源码级学习报告

- 日期：2026-09-08
- 状态：COMPLETED
- 对象：`C:\Users\snowb\Desktop\work\doubao-skin-main`（GitHub: IchenDEV/doubao-skin，MIT/GPL 混合）
- 方法：逐文件通读其规范（design/theme-standard）、Rust 核心（crates/skin-core 全部 15 个模块）、主题包样例、devflow 工作流、Agent Skills；对照本项目 engines/ + src/main/palette/ + src/main/cdp/ 现状
- 定位：豆皮 = 豆包/豆包工作/WorkBuddy 三宿主换肤工具（Rust core + GPUI 桌面 + Next.js 画廊），与 AgentSkin 同赛道，其 doubao-work 与 workbuddy 两个宿主与我们的适配器直接重叠

---

## 1. 项目总览

```text
apps/desktop        GPUI 原生桌面应用（Rust，非 Electron）
apps/web            Next.js 在线主题库（Vercel 部署，构建期生成目录）
crates/skin-core    主题引擎、CLI、live/离线构建与协议桥（4920 行 theme.rs 为核心）
themes              34 套内置主题（唯一主题源，桌面与网站共享）
plugins             Codex / Claude Code 插件（同一 CLI 工具链）
design              主题 Schema（v1/v2/v3）与界面标准
workflow            Artifact 驱动研发链（intent→spec→plan→verification 四件套 × 15+）
```

三条运行路径：**原生主题管理**（浏览/安装/预览）、**Live 注入**（回环 CDP，不改包）、**克隆构建**（macOS 离线：克隆 App + 改 HTML/resources.pak + ad-hoc 重签）。

与 AgentSkin 的根本差异：豆皮是"单产品多宿主"（3 个目标写死在 Rust enum），我们是"引擎多宿主"（6 适配器 + 编排层）；豆皮有服务端（网站商店），我们无服务端（黄金规则 3）；豆皮主题走**结构化语义字段**路线（theme.json 声明意图，引擎生成 CSS），我们走 **14-token 重映射 + 生成器**路线。

---

## 2. Live 注入机制（live.rs / ws.rs / live/platform.rs）

### 2.1 目标发现与身份匹配

- 端口分配：豆包 `9223`、豆包工作 `9222`、WorkBuddy `9224`，各自支持环境变量覆盖（`DOUBAO_SKIN_*_CDP_PORT`）。
- **身份 URL 规则**（`matches_identity_url`）：
  - 豆包：`doubao://` 或 `chrome://doubao-` 前缀
  - 豆包工作：`doubaowork://` 或 `chrome://doubaowork-`
  - WorkBuddy：**严格全等**主 renderer 路径（macOS 为 `file:///Applications/WorkBuddy.app/.../app.asar/renderer/index.html`，允许 `?query#hash` 后缀；Windows 从已安装二进制路径推导期望值，大小写不敏感比较 + 严格 UTF-8 percent-decode，拒绝 `.`/`..`/非法转义）
- **两段式页面匹配**：`side_panel.html`/`popup.html`/`options.html` 这类通用扩展页只有在 `identity_confirmed`（同一 target 列表里已出现身份 URL）后才注入——防止串扰其他 Electron 应用。
- **端口所有权检查**：连接后先验证 `/json` 里的 page 属于目标应用（`targets_belong_to`），否则报 `WrongPortOwner` 拒绝注入；若发现端口上是**另一个受支持应用**的页面，直接报错"端口连接到了错误的应用"。

### 2.2 启动与生命周期（platform.rs）

- macOS 免改包开 CDP：`open -b <bundleId> --args --remote-debugging-address=127.0.0.1 --remote-debugging-port=<port>` + AppleScript `reopen`；优雅退出用 `osascript tell application id "..." to quit`，超时才 `pkill -f <精确二进制路径>`（绝不宽泛 pkill）。
- Windows：注册表双视图（HKLM/HKCU × 32/64 位）+ LOCALAPPDATA 路径表定位安装目录，直接带参启动 exe；`taskkill /IM <进程名> /T`。
- **启动标记文件**（`%TEMP%/doubao-skin-<app>-launched-at` 记录 unix 时间戳）：跨 watcher 进程共享，120 秒内视为"应用还在启动"，禁止卡死重启逻辑误杀启动中的应用。

### 2.3 Watcher 主循环（run_with_options，2 秒 tick）

每轮做四件事，工程细节密度很高：

1. **端口丢失策略**：`missing_port_action` — once 模式或 WorkBuddy → Stop（用户主动退出后**不自动拉起**）；连续 5 tick 端口消失 → 带调试端口重拉（仅豆包系）。
2. **所有权协议（最精彩的设计）**：对已注入页面复用保留的 CDP session，evaluate 一次 `{href, data-skin}`：
   - `data-skin === 自己的主题 id` → Alive（零成本心跳）
   - `data-skin` 缺失 → 页面发生过导航，**重注入**（因为特权 app scheme 下 `Page.addScriptToEvaluateOnNewDocument` 不总生效，marker 检查是兜底）
   - `data-skin` 是别人的主题 id → **Superseded：本 watcher 主动让位退出**（多实例互不打架，靠页面属性仲裁）
   - href 含 `cross-site-support` → Dead（豆包关窗后会把真 UI 换成壳页，CDP 仍应答但已无意义）
3. **死目标节流**：注入失败或无应答的 target 进 dead 集合静默跳过；首次成功注入前每 tick 重试（冷 renderer 可自愈），之后每 15 tick（~30s）才静默探测一次——因为每次探测都要在 renderer 里起一个完整 DevTools session，代价高。
4. **两阶段卡死恢复**（仅 watcher 启动 120s 内、且所有带窗口 target 全死时）：
   - 阶段 1：`reopen` + `activate` 唤醒（macOS 会冻结被遮挡应用的 renderer，这是最常见原因）
   - 阶段 2：唤醒后仍全死 → 硬杀重拉，且**只允许一次**（`wedge_restarted`）
   - 永不打扰稳态：用户主动关掉的窗口不会被重新打开

### 2.4 注入与恢复契约

- 注入 = `Page.addScriptToEvaluateOnNewDocument(js)` + 立即 `Runtime.evaluate(js)` 双通道；注入前先 `location.href` 探活（4s 超时）。
- 30 秒内没有任何页面注入成功 → 带最后一次错误返回失败（用户看到"应用失败"而非无限挂起）。
- **restore_js 是白名单式清理**：只删 `window.__doubaoSkinRuntime.destroy()`、`#doubao-skin-style`、`#doubao-skin-backdrop`、`[data-doubao-theme-icon]`、`[data-doubao-theme-composer]` 五类自有产物；有契约测试断言它**不得**包含 `localStorage`/`indexedDB`/`removeAttribute('data-skin')` 等越界操作。恢复成功 = 至少一个响应页面执行了清理（端口在听不算成功）。

### 2.5 页面内运行时（theme.rs 的 JS_BOOTSTRAP，约 130 行）

单个 IIFE 模板，`%SKIN%/%MODE/%TARGET%/%CSS%/%BACKGROUND%/%ICONS%` 六占位符渲染：

- **幂等替换**：入口先 `window.__doubaoSkinRuntime?.destroy()`——新注入永远先卸载旧运行时，同页多运行时不可能共存。
- **原始属性快照/还原**：`rememberOriginal()` 记录 `html[data-theme/data-skin/data-skin-target]` 与 `body[theme-mode]` 的 {had, value}，`destroy()` 精确还原（had=false 则 removeAttribute）——恢复默认不需要刷新页面。
- **外观双份载荷**：v3 主题一次注入 light+dark 两套 CSS/BG/ICONS（`{"__doubaoSkinByAppearance":true,"light":...,"dark":...}`），运行时读宿主 `data-theme`/`theme-mode`（WorkBuddy 读 class 正则 `dark|cb-dark|vscode-dark`）自行切换——**应用内切深浅色零往返主进程、零闪烁**。
- **单一 `<style id="doubao-skin-style">` + `nonce="argus-csp-token"`**：借用豆包自家 CSP nonce 绕过 style-src（我们用 adoptedStyleSheets 天然免疫 CSP，此招仅作知识储备）。
- **背景层**：`#doubao-skin-backdrop` div（image data URI / gradient / video 三态），`body.prepend`，`inset:-3%` 藏模糊边、`z-index:-1`、veil 用 `::after` 叠底、`prefers-reduced-motion` 停动画。
- **自愈三件套**：MutationObserver（attributeFilter 精确到 4 个外观属性 + aria-label/title；childList 检测 style/backdrop 被删）→ 外观脏走 `setTimeout(0)` 重应用、标记脏走 180ms 防抖；`scroll` 捕获监听触发标记重排（滚动中跳过昂贵的图标扫描）；2 秒 `setInterval(maintain)` 心跳兜底。
- **图标锚定启发式**（markIcons）：双语正则匹配 `aria-label/title/description/textContent`（如 `/搜索|search/i`、`/send|发送|提交/i`）→ 给 svg/img 打 `data-doubao-theme-icon="<slot>"`；找不到标签时退化为**几何启发式**（composer 检测：textarea 向上 12 层找 `border-radius≥12` 且宽度达标的容器；main logo：52–144px 近正方形 + 视口相对位置评分取最近者；无标签按钮按 x 坐标排序取第 N 个）。
- 恢复默认后 watcher 靠 `data-skin` 仲裁让位，与 2.3 呼应。

---

## 3. 主题包 v3 与 CSS 生成管线

### 3.1 分层合并模型（theme-v3.md + theme_package.rs）

```text
合并顺序（每个 target × appearance 组合）：
  shared → shared.variants.<mode> → targets.<id> → targets.<id>.variants.<mode>
规则：标量覆盖、对象递归合并、数组整体替换、null 删除继承、target preview 整体替换
```

- `targets` 的键是**唯一支持声明**：缺键 = 不支持，引擎连共享 CSS 都不加载（不做"尽量加载"）。
- **支持级别由解析器派生**（作者不填）：空目标层 = Shared；有实质差异（CSS/结构覆盖/外观差/专用预览）= Tailored；v1/v2 = 兼容模式。`target_has_substantive_delta` 会实际跑一遍合并再 diff，防止"抄了 shared 值假装专属"；重复 shared 值会出 warning。
- `null` 删除机制的实战用法：`"targets": {"workbuddy": {"icons": null}}`——WorkBuddy 不支持图标替换，用 null 切断 shared.icons 继承，校验器还有专条报错引导（"set targets.workbuddy.icons to null"）。
- **最小语义完备性**：每个有效 target/appearance 合并后必须解析出 18 个 composer/content 颜色字段 + radius（`validate_minimum_semantics`），杜绝"半套主题"在某外观下裸奔。

### 3.2 结构化字段 → 宿主 token 扇出（semantic_css，550 行）

主题作者写语义（`composer.sendButtonBackground: "#d97757"`），引擎扇出到宿主全部别名：

```text
composer.background → --input-guidance-input-container-background
                    → --color-composebox-background
                    → --cr-composebox-background-color
                    → --doubao-skin-runtime-composer-background（保留变量）
```

- **保留运行时变量** `--doubao-skin-runtime-*`：CSS 校验器禁止主题覆写该前缀，它们只由引擎生成、供引擎自己的结构规则引用（如 `[data-doubao-theme-composer]{background:var(--doubao-skin-runtime-composer-background)}`）——主题与引擎的信任边界用**变量命名空间**切分。
- 全部变量注入挂 `html[data-skin],html[data-skin] body{...!important}`。
- **`-raw` RGB 三元组**是豆包系宿主的命门：宿主用 `rgb(var(--N100-raw))` 组合色，覆写必须成对（`--N100` + `--N100-raw`）。
- **surfaceOpacity 分层剖面**：用户一个滑杆（0.35–1）经 `surface_opacity_profile` 派生 page/sidebar/layer/input 四档 alpha，再用 `rgba(var(--X-raw), α)` 重算十几个宿主背景变量——文字/图标/按钮不跟随变透明。WorkBuddy 侧同理映射到 `--wb-skin-*` 11 个表面角色。
- **图标管线**：主题图标文件 → base64 data URI → `--skin-icon-<slot>` 变量 → 运行时打 `data-doubao-theme-icon=<slot>` → CSS 按槽位桥接 `--doubao-theme-icon` → 单色 SVG 用 `mask + background-color:currentColor`，彩色 PNG 切 `full-color` 模式（`color:transparent + background`）。深浅色可各一套（variants.icons）。
- **CSS 装配顺序**（v3 固定级联契约）：引擎结构化样式 → shared CSS → shared 外观 CSS → target CSS → target 外观 CSS → surfaceOpacity 层 → 运行时安全层（不可被主题覆写的 `!important` 兜底，如 `#chat-route-main{background:transparent}`、reduced-motion 全局压制）。

### 3.3 CSS 沙箱（theme_css.rs，lightningcss AST）

主题 CSS 是**受控子集**，解析为 AST 后逐条审：

| 维度 | 规则 |
|------|------|
| 选择器 | 必须以 `html[data-skin="<id>"]` 为根（精确等值 + 大小写敏感属性匹配，AST 级检查复合选择器）；shared 文件禁 `data-skin-target`；target 文件必须含且仅含一个直接 target 作用域，且 target 必须真的引用了该文件 |
| 属性 | 白名单：color/background/shadow/opacity/filter/border*/outline*/font*/text*/transition*/svg stroke-fill/scrollbar/accent/mix-blend + 自定义属性；**display/position/width/grid/flex/pointer-events/content/z-index 全禁**（布局与交互归引擎结构层） |
| at-rule | 仅 @media 放行；@import/@font-face/@keyframes/@layer/@property… 全禁 |
| 资源 | `url()` 一律拒绝（资源必须走 theme.json 结构化字段，由引擎统一转 data URI）；嵌套规则禁止 |
| 迁移 | v2→v3 迁移器把旧选择器重写加 target 作用域，过滤非白名单属性与含 url() 声明，遇到 at-rule/嵌套直接拒绝自动迁移 |

错误信息带 JSON pointer + 文件 + 行列（`ThemePackageError{category,pointer,target,appearance,file,line,column}`），CLI `--json` 输出机器可读。

### 3.4 包安全（theme_package.rs + theme.rs 安装路径）

- 尺寸上限：manifest 1MiB / 单 CSS 512KiB / 解析后 CSS 合计 2MiB / SVG 2MiB / 资源 200MiB / zip 条目 2048 / 目录 5MiB。
- **路径解析三重锁**：`validate_relative_path`（拒空/绝对/`..`/反斜杠/`?`/`#`/空段）→ 逐段 `read_dir` **精确大小写匹配**（防 macOS/Windows 大小写不敏感绕过）→ 每段 `symlink_metadata` 拒符号链接 → canonicalize 后必须仍在 root 内。
- 资源内容嗅探：PNG/JPEG 实际解码验尺寸与格式一致（扩展名撒谎即拒）、GIF/WebP/MP4/WebM/WOFF/OTF 魔数校验、**SVG XML 消毒**（拒 DOCTYPE/script/foreignObject/iframe/on* 事件属性/非 fragment 的 href/src/javascript:/data:）。
- zip 安装：staged 解压 + 路径穿越测试（`rejects_zip_path_traversal`）+ 唯一临时目录 + 同 id 覆盖更新。
- schema 校验用嵌入的 JSON Schema（draft 2020-12，`include_str!`），并有**变异夹具契约测试**：`fixtures/v3/manifest-cases.json` 数据驱动地列出"改哪个 pointer 成什么值应当 valid/invalid"，schema 自身还要通过 meta-schema 校验。

### 3.5 离线克隆（build/macos.rs + pak.rs）— 知识参考

- 动机：macOS App Management (MACL) 禁止改官方包 → `cp -Rc`（APFS clonefile，瞬时零额外空间）克隆到 `~/Applications/DoubaoWork-Skin.app`。
- 豆包主聊天页烘焙在 Chromium `resources.pak` 里（gzip 条目）：解析 pak → 找 doctype + `og:url` + `doubao` 三特征命中的 HTML 条目 → `<head>` 后插 `<script nonce="argus-csp-token">bootstrap</script><style>css</style>` → `mtime=0` 确定性 gzip 回写 → 重建 pak。磁盘上的 side_panel/popup/options HTML 同样注入。
- `.orig` 备份幂等：重跑先还原再注入；备份里已含 MARKER 则拒绝（防套娃）。
- **必须在首次启动前 ad-hoc 重签**（`codesign --force --deep --sign -`）：LaunchServices 注册后 MACL 锁包；再清 quarantine xattr。
- 与 live 共用同一 bootstrap JS（`snippet()` 调 `bootstrap_js_for_target`），保证两条路径行为一致——"同一主题字段两条路径都支持"是显式设计目标。

### 3.6 协议桥（protocol_bridge.rs）— 不适用

把豆包工作原生聊天的模型请求经 CDP 拦截转发到 OpenAI 兼容端点。边界收窄做得极严（loopback、只转发纯文本、拒 Cookie/附件/工具/未知块、Origin 白名单 `chrome://doubaowork-chat`、TTL 180s）。**违反我们黄金规则 3（无服务端/不做产品功能），明确不借鉴**，仅记录其"窄协议"纪律。

---

## 4. 工程实践

### 4.1 devflow 变更工作流（scripts/devflow，454 行 bash）

- `workflow/changes/<date>-<slug>/` 四件套：intent.md → spec.md → plan.md → verification.md，frontmatter 状态机（`status/stage/owner/created/source/risk/approved_by/approved_at`）。
- **人批准、机记录**：`devflow approve <id> <stage> <human>` 只填字段；AGENTS.md 明文禁止 agent 从沉默/模糊回应推断批准。`devflow` 拒绝在前置 artifact 未 accepted 时创建下一阶段；`validate` 全仓校验。
- 校验器拒绝占位符（`[fill]/TODO/TBD/待补/待定`）、要求每个 `##` 节有实际内容、high/critical 风险的批准人 ≠ owner。
- 风险四级（low/medium/high/critical）映射到验证要求；CI 校验 PR 必须链接 artifact，Draft PR 可 pending 但 `failed` 阻塞 Ready。
- 事故闭环：`devflow incident` + `add-eval`——每个逃逸缺陷固化为永久 eval 用例。

### 4.2 验证纪律（verification.md 实例：support-workbuddy）

- **失败优先证据**：每条回归测试先记录"实现前按预期失败（exit 101，缺 X）"再记录"实现后 passed"——与我们 C14 选择器溯源双向检查同构。
- **量化视觉证据**：像素差分脚本（`check-workbuddy-*-visual-delta.sh`，阈值化色差百分比）+ RMSE 对照 + 实窗计算样式探针（alpha 值逐项断言侧栏层级），"构建成功不算验收"。
- **隐私取证协议**：截图前用临时 privacy-mask 替换任务/用户名为"示例"并 CDP 验证生效，保存后立即移除；4 次 mask 失效事件全部如实记录并要求独立验证者复核——诚实度极高。
- fresh-context 验证者给最终 verdict，实现会话不得自证。

### 4.3 Agent Skills 体系

- `plugins/doubao-skin/skills/{create,apply}-doubao-theme/SKILL.md`：Codex/Claude Code marketplace 插件 + 网站 `.well-known/agent-skills/index.json`（Agent Skills Discovery 0.2.0，带 sha256 digest）。
- SKILL.md 写法要点：CLI 三级解析（env → PATH → cargo run）、**只读动作免审批 / 副作用动作逐条当前会话审批**（"早前对别的 target 的批准不带过来"）、`check→preview→check→pack` 强制交付链、"listening port 不算成功，至少一个响应页面成功才算"、禁止手写归档脚本替代 CLI、禁止把合成预览说成真机效果。
- 这本质是"把 CLI 当 agent 工具面"——与我们 Studio GUI 路线互补：主题创作可以 Skill 化而不必新增 UI 页面。

### 4.4 其他值得记录的实践

- 主题数据流单一事实源：`themes/` 是包，桌面打包直接含源，网站 `pnpm sync` 生成 SQLite/catalog/ZIP——生成物必须与源同 commit，禁止手改生成目录。
- UI 反术语标准（design/theme-standard/README.md §2）：小白文案白名单 + 禁止 Live/CDP/端口/路径/内部 ID 出现在界面，错误必须附带一个可执行动作。
- 桌面状态按 target 串行、跨 target 并行（`begin_applying/mark_applied` + per-target generation），修复了"另一 target 推进全局 generation 吞掉完成消息"的并发缺陷（记录在 verification）。

---

## 5. 与 AgentSkin 现状对照

| 能力 | 豆皮 | AgentSkin 现状 | 判定 |
|------|------|---------------|------|
| 注入通道 | Runtime.evaluate + addScriptToEvaluateOnNewDocument，保留 session | 同（cdp-inject + PersistenceSessionManager + session-pool） | 持平 |
| CSP 免疫 | 借宿主 nonce | adoptedStyleSheets 天然免疫 | **我们更优** |
| 层所有权 | 固定装配顺序 + 保留变量前缀信任边界 | 5 层 ownership + token ownership（C11 守卫） | 持平，可吸收"保留变量前缀"思想 |
| 多实例仲裁 | 页面 `data-skin` 属性 Own/Missing/Foreign 三态让位 | applyEpoch 进程内 + fingerprint，无跨进程页面仲裁 | **对方更优 → P1** |
| 卡死恢复 | 两阶段（唤醒→重启）+ 启动宽限 + 死目标节流 | watchdog/reload-watchdog/renderer-guardian | 需核对是否覆盖"macOS 遮挡冻结"与"壳页假活"两形态 |
| 深浅色切换 | 双份载荷页内即时切换 | dark-mode-remap.mjs（主进程侧重注入路径） | **对方体验更优 → P1** |
| 主题格式 | v3：targets 显式声明 + 4 层合并 + null 删除 + 最小语义完备 | manifest v2：14 colors + per-agent css + verification | 各有侧重，见建议 |
| 主题 CSS 沙箱 | lightningcss AST：选择器根/属性白名单/url 禁令 | sanitizeCSS（启发式，仅 custom 层） | **对方更严格 → P1** |
| 包安全 | 大小写敏感解析 + symlink 拒 + 魔数 + SVG 消毒 + 变异夹具 | 导入解析器有基础校验 | **对方更完备 → P0/P1** |
| 图标替换 | 25 语义槽 + 启发式锚定 + mask/full-color 双模式 | 无（doubao 引擎未做图标管线） | **功能缺口 → P2** |
| surfaceOpacity 滑杆 | 单值→四档剖面→rgba(-raw) 重算 | wallpaper/hero 体系，无宿主表面透明剖面 | **可借鉴 → P2** |
| 离线持久化 | macOS pak 克隆 | 无（纯 live，符合定位） | 不借鉴 |
| 服务端/商店 | Next.js 画廊 + catalog | 无（黄金规则 3 禁止） | 不借鉴 |
| 变更流程 | devflow 四件套 + 人审批状态机 | RFC 评审（docs/rfc/）+ npm run check 全绿 | 同向，可吸收 artifact 格式 |
| 验证文化 | 失败优先 + 量化视觉 diff + 隐私 mask 协议 | 巡检报告 + C1–C14 守卫 + manual.test | 同向，可吸收量化探针 |
| Agent 接口 | CLI + SKILL.md + .well-known | GUI Studio + npm scripts | **可补 Skill 面 → P2** |

---

## 6. 可借鉴清单（学方法、不并生态）

> 2026-09-08 修订：本报告初稿曾把"导入其主题生态"列为 P0，经明确方向纠正——学习目标是**优点与方法论**，各格式保持各自演进，不做生态并入。引擎时效性问题的逐项证据与修复清单见姊妹报告 `engine-staleness-audit-2026-09-08.md`。

### P1 — 模仿其"做法"（改我方机制，不搬其资产）

1. **页面所有权三态仲裁**：注入根标记 + watcher 每轮 Own/Missing/Foreign 判定，Foreign 让位退出。根治多实例互踩。
2. **restore 白名单契约测试**：仿 `restore_script_only_removes_skin_owned_runtime_and_markers`，断言恢复路径只触碰自有产物（不碰 localStorage/indexedDB/宿主属性）。
3. **外观双份载荷**：light+dark 两套 CSS 一次注入，页内读宿主 `data-theme` 即时切换——应用内深浅色零往返主进程（我方现走系统 media query，存在判定源错误，见审计 D5）。
4. **AST 级 CSS 沙箱**：postcss 实现主题/自定义 CSS 审查（选择器强制主题作用域根、布局/交互属性白名单外拒绝、`url()` 拒绝），作为 C13/C14 姊妹检查。
5. **`-raw` 孪生成对覆写纪律**：凡 `rgb(var(--X-raw))` 组合模式，主变量与 `-raw` 原子成对（我方 token-discovery 现排除 `-raw`，见审计 D7）。
6. **schema 变异夹具**：仿 `manifest-cases.json` 数据驱动"改哪个 pointer 成什么值应 valid/invalid"，强化 C2。
7. **失败优先 + 量化视觉 diff**：回归测试先红后绿记录 exit code；视觉变更用像素差分 %/RMSE 阈值判定；写入巡检/verification 模板。
8. **壳页假活检测**：豆包关窗后 renderer 换 `cross-site-support` 壳页仍应答 CDP——存活判定必须校验 href 非壳页（列入巡检方向 A 用例）。
9. **表面角色 alpha 探针**：按 shell/track/control/strong 角色用计算样式断言透明层级与对比度，替代"截图看看变了没"。

### P2 — 需 RFC 或产品决策

10. **devflow artifact 格式并入 RFC 流程**：docs/rfc/ 加 frontmatter 状态机（intent/spec/plan/verification + risk + approved_by≠owner）与校验脚本，替代目前较松的 RFC 约定。
11. **Agent Skills 面**：为其主题创作/应用流的**写法**（只读免审批 vs 副作用逐条当前会话审批、`check→preview→check→pack` 强制链、"listening port 不算成功"）作为我方未来任何 agent 接口的措辞框架。零新 UI 页面。
12. **manifest 演进参考**：若未来主题包需要跨宿主分层（shared/target/variant + null 删除 + 派生支持级别），其 v3 合并语义是成熟参考；当前 14-token 契约运转良好，**不为改而改**（核心数据模型变更须 RFC）。
13. **图标槽管线**：其 25 槽 + 双语 label 正则 + 几何启发式的**锚定方法**可移植到我方引擎层（属引擎能力扩展，需评审）；资产与槽位定义按我方宿主重新实窗取证，不照抄。

### 明确不借鉴

- 协议桥（违反黄金规则 3）；离线克隆改包（与"不改官方安装包"定位冲突且平台受限）；在线商店/Vercel 部署（无服务端）；GPUI 重写（Electron 是既定栈）；**其主题包格式并入我方导入管线**（方向纠正：不并生态；顺带发现的 DreamSkin 解析器对 `schemaVersion>=3` 包的误认领风险已移交审计报告的守卫建议）。

---

## 7. 结论

豆皮是与我们定位最接近的竞品：**同一注入范式（回环 CDP + 双通道 + watcher），但把工程纪律推到了我们尚未完全达到的高度**。三个最值得吸收的内核：

1. **信任边界显式化**——保留变量前缀、CSS 属性白名单、AST 作用域强制、restore 白名单、大小写敏感路径解析：每一层都回答"主题作者/引擎/宿主各自能碰什么"。
2. **页面即仲裁者**——`data-skin` 所有权三态让位 + 外观双份载荷，把跨进程协调与深浅色往返都下沉到页面属性，watcher 因此极简。
3. **失败优先的验证文化**——回归测试先红后绿、视觉差异量化阈值、隐私取证协议与偏差如实登记，artifact 链把"证据"变成一等公民。

学习产出为两条线：本报告 §6 的"模仿做法"清单（P1/P2），以及以其证据为镜像的本仓引擎时效性审计 `engine-staleness-audit-2026-09-08.md`（doubao/workbuddy 死锚点、缺失 token 家族、判定源错误与 semantic-selectors 硬伤的逐项清单与修复优先级）。

---

## 附：本次通读的对方文件清单

`AGENTS.md`、`README.md`、`docs/architecture.md`、`docs/development-workflow.md`、`design/theme-standard/{README.md,theme-v3.md,theme-v3.schema.json}`、`themes/{claude-warm,doubao-dessert-giggle}/{theme.json,styles/doubao-family.css}`、`crates/skin-core/src/{lib.rs,live.rs,live/platform.rs,ws.rs,theme.rs(结构+semantic_css+backdrop+surface_opacity+icons+JS_BOOTSTRAP+workbuddy_css+装配),theme_css.rs,theme_package.rs,build.rs,build/macos.rs,auto_theme.rs(前 120 行),authoring.rs(preview/pack/发现字段),protocol_bridge.rs(前 90 行),bin/doubao-skin.rs(命令面)}`、`crates/skin-core/tests/theme_v3_schema.rs`、`scripts/{check.sh,devflow(前 160 行)}`、`workflow/changes/2026-08-31-support-workbuddy/{intent.md,verification.md}`、`plugins/doubao-skin/skills/*/SKILL.md`、`apps/web/public/.well-known/agent-skills/index.json`。
