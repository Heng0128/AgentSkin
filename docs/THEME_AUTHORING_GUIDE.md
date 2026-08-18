# AgentSkin 主题开发手册（Theme Authoring Guide）

> 版本：1.0.0（draft，对齐 `themes/THEME_SPEC.md` v2.1.0 + `manifest-v2.schema.json` + 实际生成器代码）
> 受众：**要亲手做出"自己风格"主题的开发者**，不是只看契约的人。
> 与 `THEME_SPEC.md` 的关系：THEME_SPEC 是**契约**（字段/变量/校验，运行时硬校验依据）；本手册是**怎么做**（心智模型、六端选择器速查、深度适配技法、现状缺口）。两者互补，冲突时以 THEME_SPEC + schema 为准。

---

## 0. 一句话心智模型

AgentSkin 的主题 = **一份 `manifest.json` + 6 份 agent CSS + 3 张图（icon/preview/hero）**。
作者要做的只有两件事：

1. 决定**颜色与风格**（填 token / 写 CSS）；
2. 让这 6 份 CSS 在 6 个目标应用里"真正生效"。

"生效"的难点不在写 CSS，而在**每个应用的 DOM 结构和原生设计 token 命名空间都不一样**。这就是本手册重点要给你的东西——一张**六端选择器 + token 命名空间速查表**（第 5 节），以及从参考主题提炼出的**深度适配技法**（第 4 节）。

> 参考范本：`C:\Users\snowb\Downloads\miku-future-beats-1.2.0.codedrobe-theme`
> 这是一个 **CodeDrobe 格式**的单 JSON 包主题（初音未来·Future Beats）。它的**结构**极具参考价值（每端手写深度适配 CSS + 上下文探测选择器 + 资源嵌入），但它的**美术素材涉及初音未来 IP，禁止打包进 AgentSkin**。只学它的"写法骨架"，不要抄图。

---

## 1. 两种主题路线

| 路线 | 做法 | 适合 | 上限 |
|------|------|------|------|
| **A. 生成器主题** | 填 14 个 `colors` token → `npm run generate:themes` 自动产出 6 份 CSS | 快速出"配色皮肤"、统一风格 | 只动 token，做不出纹理/主视觉/品牌感 |
| **B. 手写深度适配** | 在 A 的基础上，手写每端 CSS（覆写原生 token + 铺背景 + 每表面精修） | "自己的" distinctive 主题 | 需要你懂每端的 DOM（第 5 节） |

**结论**：路线 A 几分钟出主题但千篇一律；要做"属于自己"的主题，必须走路线 B，或至少用 A 打底再手写覆盖。本手册第 4、5 节就是路线 B 的全部干货。

---

## 2. 目录结构与 manifest 字段

```
themes/<your-theme>/
├── manifest.json           # 主题清单（颜色 + 元数据 + targets）★ 你主要编辑这个
├── icon.png                # 主题图标 128×128
├── preview.png             # 预览图 1280×720
├── hero.webp / .png        # 背景艺术图（可选；运行时注入为 --agentskin-art）
├── palette.css             # 【生成物】12 核心 token（勿手改）
└── assets/css/
    └── <agent>.css × 6     # 【生成物/或手维护】每端完整 CSS
```

### 2.1 manifest 字段（基于 `src/main/catalog/manifest-v2.schema.json` 权威字段）

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | ✅ | 主题唯一 id（slug） |
| `name` | string | ✅ | 英文名 |
| `displayName` | string | — | 中文显示名 |
| `version` | string | ✅ | semver |
| `icon` | string | ✅ | 图标文件名（同目录，不能含 `/`） |
| `preview` | string | ✅ | 预览图文件名 |
| `hero` | string | — | 背景艺术图文件名（png/webp/jpeg） |
| `art` | boolean | — | 是否带 hero 美术（默认 `true`） |
| `mode` | enum | — | `dark` / `light` / `auto`；**必须与每端 CSS 的 `color-scheme` 一致** |
| `colors` | object | ✅(background+foreground) | 14 个 token（见 2.2） |
| `colorSchemes` | string[] | — | v2.2+：备选配色 id，解析为 `color-schemes/<id>.json`（`default` 保留给主色） |
| `dynamic` | enum/boolean | — | 动态特效：`"aurora"` / `"particles"` / `"gradient"` / `"waves"` / `false` |
| `signature` | string/object | — | 见第 3.2 节（**注意：schema 未显式声明此字段**，代码侧读取；新增前先核对 schema additionalProperties 策略） |
| `targets` | object | ✅ | 每端 `{ css: "assets/css/<agent>.css", verification?: {...} }` |
| `supportedAgents` | string[] | — | 显式声明的 agent id（须是 6 个已知 id 之一，拼错即被 validator 拒绝） |
| `author` | object | — | `{ name, url }` |
| `category` / `tags` | — | — | 分类 slug / 搜索标签（≤10） |
| `license` | string | — | 如 `MPL-2.0` |
| `minAppVersion` | string | — | 最低 AgentSkin 版本 |
| `probe` | object | — | 声明本主题贡献的 token 命名空间（见 THEME_SPEC 探针契约） |

### 2.2 `colors` 字段（14 token，`additionalProperties:false`）

```jsonc
"colors": {
  "accent": "#6ee7d3",            // 主强调色
  "secondary": "#9b8cff",         // 次强调色
  "background": "#0a0e1a",        // 全局背景（必填）
  "foreground": "#e6ecf5",        // 主文本（必填）
  "muted": "#8a96ad",             // 次要文本
  "surface": "#121829",           // 表面色
  "surfaceElevated": "#1a2236",   // 提升表面
  "border": "rgba(110,231,211,.18)",
  "codeBackground": "#070b14",
  "codeForeground": "#cdd9e8",
  "inputBackground": "#16203a",
  "buttonBackground": "rgba(110,231,211,.14)",
  "buttonForeground": "#6ee7d3",
  "focusRing": "#6ee7d360"
}
```

> ⚠️ **`colors` 是 `additionalProperties:false`**——你不能在这里加自定义键（如 `"brandTeal"`）。自定义调色板变量（如 `--my-teal`）只能写进 agent CSS 的 `:root` 块，不要塞进 manifest。

---

## 3. 路线 A：生成器主题（快速出主题）

### 3.1 标准流程

```bash
# 1. 新建目录 + 写 manifest.json（colors 填 14 token，参考 themes/aurora-glass/manifest.json）
# 2. 准备 icon.png(128×128) + preview.png(1280×720) + hero（可选）
# 3. 生成
npm run generate:themes      # = generate:palette + generate:theme-css
# 4. 自检（14 token 齐全 / color-scheme 与 mode 一致 / schema 合法）
npm run check:themes
# 5. 重启 AgentSkin 自动 seed（loader 硬校验后入库）
```

生成器会：读 `colors` → 产 `palette.css`（12 核心 token + `-raw` 派生）→ 为 6 端各产一份 `assets/css/<agent>.css`（含 14 个 `--agentskin-*` 契约变量 + 原生 token 覆写骨架）。

### 3.2 signature：免写代码的"风格旋钮"

无需碰 CSS 即可微调形态。代码实现在 `scripts/build-theme-package.mjs` 的 `buildCraft(agentId, signature)`，按 `[class*=panel]`/`[class*=card]` 等通配选择器批量施加：

```jsonc
"signature": {
  "radius": "14px",          // 圆角（全局 button/input/panel/card）
  "spacing": 16,             // 面板/侧栏内边距(px)
  "shadowLevel": "md",       // none/sm/md/lg —— 浮起阴影
  "blurPx": 18,              // 侧栏/弹层/topbar 毛玻璃模糊
  "fontSize": 14,            // body 字号
  "fontFam": "\"PingFang SC\", sans-serif",
  "duration": "0.2s",        // 过渡时长
  "timing": "ease",          // 过渡曲线
  "accent": "#6ee7d3",       // 强调色（同时写 --agentskin-accent）
  "background": "#0a0e1a",   // 背景（body/root）
  "foreground": "#e6ecf5",   // 前景（body *）
  "surface": "#121829",      // 表面（panel/card）
  "gradientAccent": true,    // 渐变强调（accent→background 135deg）
  "borderWidth": 1,          // 边框宽度
  "lineHeight": 1.6          // 行高
}
```

> 高级扩展点（需改代码）：命名式签名。参考 `scripts/theme-utils.mjs` 的 `auroraGlassSignature(t, host)` + `scripts/generate-theme-css.mjs` 中 `if (ctx.signature === 'aurora-glass' && HOSTS[agent])` 分支。新增一个命名签名 = 在 `theme-utils.mjs` 加一个函数 + 在生成器里加一个 `if` 分支，**现有主题零改动**（默认 `null` 走原路径）。aurora-glass 的极光漂移/玻璃镜面就是这么做的。

### 3.3 路线 A 的天花板

生成器只做"token 重映射 + 通用形态旋钮"。它**无法**产出：背景纹理、主视觉大图、品牌点缀（音符/光斑）、每应用的差异化表面质感。这些正是"自己主题"的灵魂 → 必须走路线 B。

---

## 4. 路线 B：手写深度适配（做出"自己的"主题）

从参考主题提炼的**通用四步技法**（以初音未来主题为范本，但去 IP 化）：

### 4.1 步骤一：集中声明私有调色板

在每端 CSS 顶部 `:root` 里先声明你自己的语义色，后面全部引用它，方便统一调：

```css
:root.agentskin-host-workbuddy {
  --my-ink: #163f4b;
  --my-teal: #16bfc4;
  --my-pink: #ff8fc8;
  --my-line: rgba(22,191,196,.24);
  --my-shadow: rgba(12,105,119,.12);
}
```

### 4.2 步骤二：覆写应用原生 token（按端命名空间，见第 5 节）

这是"真正生效"的关键——目标应用自己有一套设计 token，你要在更高优先级的作用域里覆盖它们：

```css
html.agentskin-host-workbuddy body[data-application-name="workbuddy"] {
  --cb-bg-primary: var(--my-surface) !important;
  --cb-text-primary: var(--my-ink) !important;
  --cb-vscode-button-background: var(--my-teal) !important;
  /* …其余 --cb-* 见第 5 节 cheat-sheet… */
}
```

### 4.3 步骤三：铺背景（hero + 纹理 + 点缀层）

```css
/* 1) hero：运行时注入的 --agentskin-art（单图，Blob URL） */
html.agentskin-host-workbuddy body {
  background:
    linear-gradient(rgba(10,14,26,.86), rgba(10,14,26,.92)),
    var(--agentskin-art) center / cover no-repeat !important;
}

/* 2) 纹理层：⚠️ AgentSkin 没有原生纹理变量（见第 8 节缺口）。
      方案 a：把纹理 bake 进 hero PNG（最简单）；
      方案 b：自造 --my-texture，用内联 data-url（不被 chunk，注意体积）：
*/
html.agentskin-host-workbuddy body {
  --my-texture: url("data:image/png;base64,iVBOR..."); /* 小图平铺 */
  background-image:
    var(--my-texture),
    var(--agentskin-art) !important;
  background-size: 360px auto, cover !important;
  background-repeat: repeat, no-repeat !important;
}

/* 3) 点缀层：::before 光斑/网点（pointer-events:none，z-index 压低） */
html.agentskin-host-workbuddy body::before {
  content: ""; position: fixed; inset: 0; z-index: 0; pointer-events: none;
  background:
    radial-gradient(circle at 86% 8%, rgba(255,255,255,.5) 0 2px, transparent 3px);
  background-size: 83px 83px; opacity: .35;
}
```

### 4.4 步骤四：每表面精修

覆写完 token 后，对稳定表面单独调质感（毛玻璃、阴影、圆角、品牌色描边）：

```css
html.agentskin-host-workbuddy .conversation-sidebar {
  background: linear-gradient(180deg, rgba(...,.95), rgba(...,.92)),
              var(--my-texture) center / 590px auto repeat !important;
  border-right: 1px solid var(--my-line) !important;
  box-shadow: 12px 0 32px var(--my-shadow) !important;
  backdrop-filter: blur(18px) saturate(1.06) !important;
}
```

### 4.5 作用域约定（避免"写了不生效"）

优先级不够 = 主题不生效的头号原因。目标应用的 token 常写在 `:root` / `body` / `[data-theme=...]` 上，你必须用**更高优先级且带 host 作用域**的选择器：

| 端 | 推荐作用域选择器（实测） |
|----|--------------------------|
| workbuddy | `body[data-application-name="workbuddy"]` |
| traework | `html.agentskin-host-traework body` / `html.agentskin-host-traework .类名` |
| qoderwork | `html.agentskin-host-qoderwork:root` |
| codex | `html.agentskin-host-codex` |
| zcode | `html.agentskin-host-zcode` |
| doubao | `html.agentskin-host-doubao:root` |

> 规则：**不要裸 `:root{...}`**（会被应用自身 `:root[data-theme]` 反超）。一律加 `html.agentskin-host-<agent>` 或 `body[data-application-name=...]` 前缀，并对关键覆写加 `!important`。

---

## 5. 六端 token 命名空间 + 稳定表面速查表（核心）

> 来源：参考主题的 `verification` 选择器 + `themes/aurora-glass/assets/css/*.css` 实测。
> "稳定表面"指 DOM 结构改动较少、可放心挂背景/阴影的容器。

### WorkBuddy（`--cb-*` 体系，腾讯）
- 作用域：`body[data-application-name="workbuddy"]`
- 原生 token：`--cb-bg-primary` / `--cb-text-primary` / `--cb-vscode-button-background` / `--cb-vscode-titleBar-*` / `--cb-vscode-scrollbarSlider-*` / `--cb-button-dark-*` / `--cb-markdown-hr-border-color` / `--cb-stroke-secondary`
- 稳定表面：`.conversation-sidebar`、`.conversation-list`、`.chat-container`、`.wb-home-page`、`.wb-home-composer`、`.cb-markdown`、`.workbuddy-topbar`
- 参考：aurora-glass `workbuddy.css` 顶部 90 行

### TRAE Work（`--vscode-*` + `--vscode-icube-*` 体系，VS Code fork）
- 作用域：`html.agentskin-host-traework body`（壳层 token 写在 `body` 上）
- 原生 token：`--vscode-foreground`、`--vscode-editor-background`、`--vscode-button-background`、`--vscode-focusBorder`、`--vscode-list-hoverBackground`、`--vscode-icube-colorBg1/2/3`、`--vscode-icube-colorLine1/2`、`--vscode-icube-colorBrand`、`--vscode-icube--bg-bg-overlay-l2/l3`
- 稳定表面：`.task-list-base`（侧栏）、`.solo-lite-panel-border`、`.panel-content`、`.solo-lite-chat-panel-container`、`.solo-lite`（壳层 body class）
- 参考：codedrobe `traework` 目标（`body.solo-lite` / `.task-list-base` / `.panel-content`）

### QoderWork（`--color-*` 体系，antd）
- 作用域：`html.agentskin-host-qoderwork:root`
- 原生 token：`--color-primary`、`--color-primary-bg(-hover)`、`--color-text(-base/-secondary/-tertiary/-quaternary)`、`--color-border(-secondary/-tertiary)`、`--color-fill(-secondary/-tertiary/-quaternary)`、`--color-bg-container` / `--color-bg-elevated` / `--color-bg-layout` / `--color-bg-base`、`--color-link`
- 稳定表面：`.agents-layout-root`、`.agents-sidebar`、`.agents-content-area`、`.agents-parchment-paper-surface`、`.sidebar-section-title`
- 参考：codedrobe `qoderwork` 目标（`--color-*` 全覆盖）

### Codex / ZCode（`--color-token-*` 体系，与 QoderWork 同族）
- 作用域：`html.agentskin-host-codex` / `html.agentskin-host-zcode`
- 原生 token：`--color-token-bg-primary` / `-bg-secondary` / `-main-surface-primary` / `-side-bar-background` / `-foreground` / `-text-primary/-secondary/-tertiary` / `-input-background` / `-button-background` / `-border(-default/-heavy/-light)` / `-list-hover-background` / `-focus-border` / `-scrollbar-slider-background` / `-text-preformat-*`
- 稳定表面：`aside.app-shell-left-panel`、`main.main-surface`、`header.app-header-tint`、`.composer-surface-chrome`
- ZCode 是 Codex 派生壳，**建议直接复用 codex.css 再核对差异**（命名空间同族）。

### 豆包 Doubao（`--dbx-*` 体系，251-token，**不是 `--semi-color-*`**）
- 作用域：`html.agentskin-host-doubao:root`
- 原生 token：`--dbx-bg-body-web` / `-bg-base-web` / `-bg-base-2/5` / `-bg-float` / `-bg-mask` / `-bg-blur-md` / `--dbx-text-primary/-secondary/-tertiary/-disable` / `--dbx-fill-*` / `--dbx-line-*`
- 稳定表面：`.chat-container`、`.dbx-*` 语义容器（建议用 DevTools 实测当前版本类名）
- ⚠️ **文档纠错**：`themes/THEME_SPEC.md` 第 170 行称豆包用 `--semi-color-*`、`--dbx-*` 是"历史死 token，勿依赖"——**与代码事实相反**。实际 aurora-glass `doubao.css` 大量使用 `--dbx-*`，应以本表为准，THEME_SPEC 待修正。

---

## 6. 资源（assets）

| 资源 | 规格 | 用途 | 注入方式 |
|------|------|------|----------|
| `icon.png` | 128×128 | 卡片图标 | 随包读取 |
| `preview.png` | 1280×720 | 商店/列表预览 | 随包读取 |
| `hero.*` | 任意比（建议 16:9 / 16:10） | 背景艺术图 | 运行时转 Blob URL → CSS 变量 `--agentskin-art` |

### 动态主题
`manifest.dynamic` 支持 `"aurora" | "particles" | "gradient" | "waves"`（v2.1+）。aurora-glass 用 `dynamic:"aurora"`，其极光漂移由 `auroraGlassSignature` 在 CSS 里用 `@keyframes` 实现（见 `scripts/theme-utils.mjs`）。

---

## 7. 上下文探测 / verification（与参考主题的差距）

参考主题（CodeDrobe）每个 target 带 `verification.contexts`：`when`（命中条件）+ `required`/`recommended`（DOM 选择器）。这是**版本漂移检测**——当目标应用改版、选择器失效时，runtime 能知道"这个主题可能不适用于当前版本"。

**AgentSkin 现状**：`manifest-v2.schema.json` 的 `targets.<agent>.verification` **只有 `required` / `recommended` 数组（每项 `{name, any[]}`），没有 `when` / `contexts` 结构**。即：

- ✅ 你能声明"哪些选择器必须/推荐存在"（runtime 健康检查用）；
- ❌ 没有"按上下文自动切换/版本识别"的结构化规范。

**作者实操建议**：用 DevTools / CDP 探针（`src/main/cdp/injection/`，参考 `debug-tools/probe-*.mjs`）找每端的稳定容器类名，写进 agent CSS；并把关键表面选择器填进 `targets.<agent>.verification.required`，让 `src/main/theme-health-check.ts` 能帮你发现"应用改版导致主题失效"。第 5 节速查表就是这份探测的起点。

---

## 8. 打包与校验门禁

```bash
# 打包为 .agentskin-theme（scripts/build-theme-package.mjs）
npm run build:theme            # 若 package.json 有该脚本；否则直接 node scripts/build-theme-package.mjs

# 校验（CI / pre-commit 必过）
npm run check:themes           # schema + 14 token 齐全 + color-scheme 与 mode 一致
npm run check:theme-staleness  # --verify：已生成 CSS 是否过期（生成物落后 manifest 即红）
npm run check                  # 全量：typecheck+lint+test+contract+themes+staleness+architecture+semantic+defects
```

- 门禁红线：**6 端 CSS 必须各自声明全部 14 个 `--agentskin-*` 变量**；`color-scheme` 与 `manifest.mode` 一致；`icon/preview/hero` 路径不逃逸包根。
- 未经 `npm run check` 全绿**禁止 push**（AGENTS.md 黄金规则 7）。

---

## 9. 现状诊断：「还不行」清单（诚实版）

老板原话"主题开发文档不够详细，同时现在好像还不行"。以下是我对照代码核实后的缺口，**区分"已确认"与"待你确认"**：

### 🔴 已确认的事实缺口
1. **手写深度适配路径几乎无文档**：THEME_SPEC 只讲"填 token 跑生成器"和一句"`art:false` 跳过生成器手动维护 CSS"，但**没教怎么手写**——覆写哪些 token、挂哪些选择器、怎么做纹理/主视觉，全是空白。本手册第 4、5 节补的就是这块。
2. **THEME_SPEC 豆包 token 写错**：称豆包用 `--semi-color-*`、`--dbx-*` 是死 token。实际 aurora-glass `doubao.css` 用的是 `--dbx-*`（251-token 体系）。需修正 THEME_SPEC 第 170 行。
3. **单 hero 模型，无原生纹理变量**：运行时只注入 `--agentskin-art`（一张图）。参考主题的"纹理 + 主视觉 + 点缀层"三层叠加在 AgentSkin 落不了地（除非 bake 进 hero 或用内联 data-url 自造 `--my-texture`，后者不被 chunk、有体积风险）。要做 texture 主题，要么改注入层支持 `--agentskin-texture`，要么接受单图层。

### 🟠 待你确认的能力缺口
4. **Studio 编辑器（工作室）是否可用作作者 UX**：架构上存在 `StudioPage`（快照/检查/导出主题），理论上是"可视化做主题"的入口。但它当前能否导出**手写深度适配 CSS**（而非仅 14 token）？需要你确认 Studio 导出产物形态——若只导 token，则"自己主题"仍得手写在 `assets/css/`。
5. **缺乏"每端 DOM 上下文检测"结构化规范**：参考主题有 `verification.contexts.when`（版本漂移识别），AgentSkin schema 无对应结构。作者目前只能靠第 5 节速查表 + 手动探针，没有"应用改版自动告警"的能力。

### 🟡 建议补齐优先级
- P0：修正 THEME_SPEC 豆包 token 错误；把本手册第 4、5 节合并进 THEME_SPEC 或保留为独立 how-to。
- P1：决策"纹理"是否要成为一等公民（加 `--agentskin-texture` 注入，对齐参考主题）；确认 Studio 导出能力。
- P2：考虑引入 `verification.contexts.when` 结构，让主题支持版本漂移检测（对齐参考主题，降低"应用更新即主题崩"风险）。

---

## 10. 从 0 做一个"自己的主题"——实操清单

```bash
# 1. 起手：复制一个现有主题作底，改名改 id
cp -r themes/aurora-glass themes/my-theme
# 2. 改 manifest.json：id/name/displayName/colors(14 token)/mode/dynamic(可选)
# 3. 路线 A 打底
npm run generate:themes && npm run check:themes
# 4. 路线 B：逐端手写 assets/css/<agent>.css（参考第 4、5 节）
#    - 顶部声明私有调色板 --my-*
#    - 用带 host 作用域的选择器覆写原生 token（!important）
#    - 铺背景：var(--agentskin-art) + （自造 --my-texture 或 bake 进 hero）
#    - 精修稳定表面（侧栏/面板/顶栏）
# 5. 替换 icon.png / preview.png / hero
# 6. 门禁
npm run check:themes && npm run check:theme-staleness
# 7. 重启 AgentSkin 看效果，用 DevTools 核对每端选择器是否命中
```

**最小可抄样例**（workbuddy 端深度适配骨架，去 IP）：

```css
:root.agentskin-host-workbuddy { color-scheme: dark !important;
  --my-ink:#e6ecf5; --my-teal:#6ee7d3; --my-line:rgba(110,231,211,.18); --my-shadow:rgba(0,0,0,.4);
}
body[data-application-name="workbuddy"] {
  --cb-bg-primary: #0a0e1a !important;
  --cb-text-primary: var(--my-ink) !important;
  --cb-vscode-button-background: var(--my-teal) !important;
  --cb-vscode-focusBorder: rgba(110,231,211,.4) !important;
}
body[data-application-name="workbuddy"] {
  background: linear-gradient(rgba(10,14,26,.88), rgba(10,14,26,.92)),
              var(--agentskin-art) center / cover no-repeat !important;
}
body[data-application-name="workbuddy"] .conversation-sidebar {
  border-right: 1px solid var(--my-line) !important;
  box-shadow: 12px 0 32px var(--my-shadow) !important;
  backdrop-filter: blur(18px) saturate(1.06) !important;
}
```

---

## 附：与参考主题的字段映射（CodeDrobe → AgentSkin）

| CodeDrobe 字段 | AgentSkin 对应 | 备注 |
|----------------|---------------|------|
| `theme.id` / `displayName` / `version` | `manifest.id/name/displayName/version` | 直接对应 |
| `theme.copy` (brandTitle/signature/tagline…) | 暂无对应（Studio/品牌文案层） | AgentSkin 暂未消费，可议增 |
| `theme.catalog` (name.en/zh, description, categories) | `manifest.name` + `category` + `tags` | 多语言 catalog 可议增 |
| `targets.<h>.css` | `targets.<agent>.css` | 同构 |
| `targets.<h>.options.rendererProfile` | 暂无（引擎侧 adapter 隐式处理） | — |
| `targets.<h>.options.baseTheme` | 暂无 | codex 类 baseTheme 暂未建模 |
| `targets.<h>.verification.contexts.when` | ❌ schema 无 `when`/`contexts` | **缺口**（见第 9 节 P2） |
| `targets.<h>.verification.required/recommended` | `targets.<agent>.verification.required/recommended` | ✅ 同构 |
| `assets.images.hero/texture` (base64) | `hero` 文件 + `--agentskin-art`（**无 texture**） | **缺口**（见第 9 节 P1） |
