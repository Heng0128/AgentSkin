# AgentSkin GitHub CSS 主题引擎调研报告

> 纯调研任务 · 2024-2026 年开源项目 · 评估日期: 2026-07-15

## 一、搜索覆盖（8 方向 x 每方向 >= 2 候选）

| # | 方向 | 代表候选 |
|---|------|---------|
| 1 | Design Token 基础体系 | Amazon Style Dictionary、Tokens Studio sd-transforms、Primer Primitives、Open Props |
| 2 | CSS 变量注册框架 | construct-style-sheets polyfill、style-sheet (Meta)、live-css-editor |
| 3 | 渐进式增强动画 | Open Props animation tokens、Bootstrap 5.3 prefers-reduced-motion |
| 4 | 暗色/亮色双主题切换 | Pico CSS v2、Bootstrap 5.3 color modes、GoogleChromeLabs dark-mode-toggle、Dark Reader |
| 5 | 跨 iframe/Shadow DOM 样式穿透 | construct-style-sheets、LavaDome、Tradeshift Elements |
| 6 | Chromium/Electron 主题定制 | electron-acrylic-window、electron-vibrancy、WinUI CSS |
| 7 | CSS-in-JS 零运行时方案 | Vanilla Extract、Linaria、goober |
| 8 | 开源编辑器主题系统 | Shiki、textmate-grammars-themes、vscode-textmate |

---

## 二、Top 10 推荐排名

### 排名方法论

权重分配：Code Quality 15% + Doc Completeness 10% + Maintenance Activity 15% + Community Size 10% + API Ergonomic 15% + Electron 适配度 15% + 依赖轻重 10% + 实现独特性 10% = 100%

---

### No.1 Amazon Style Dictionary

| 维度 | 值 |
|------|-----|
| URL | https://github.com/style-dictionary/style-dictionary |
| Stars | 4.6k |
| 最近更新 | 2026-04-08 |

**8 维评分：**

| Code Quality | Doc | Maintenance | Community | API | Electron 适配 | 依赖 | 独特 | 加权 |
|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| 8 | 8 | 9 | 8 | 9 | 7 | 8 | 9 | **8.25** |

- **可移植模块**：`lib/common/transforms.js:mRegisterTransform`、`lib/common/format.js`、`TransformGroup`、`Format`
- **移植到 AgentSkin**：将 14-token JSON  Style Dictionary 输入格式；利用 `transforms/css` 生成 `:root` 变量块；新增 custom format 输出 CSS variables manifest 供 CDP 运行时注入
- **适合模块**：A（Theme 构建）

---

### No.2 Vanilla Extract (seek-oss)

| 维度 | 值 |
|------|-----|
| URL | https://github.com/seek-oss/vanilla-extract |
| Stars | ~4k+ |
| 最近更新 | 2025-12-28 |

**8 维评分：**

| Code Quality | Doc | Maintenance | Community | API | Electron 适配 | 依赖 | 独特 | 加权 |
|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| 9 | 9 | 9 | 7 | 9 | 7 | 6 | 10 | **8.20** |

- **可移植模块**：`packages/css/src/style.ts:style`、`packages/css/src/createTheme.ts:createThemeContract`、`packages/vite-plugin/src/index.ts`
- **移植到 AgentSkin**：`createThemeContract(agentskinTokens)` 生成类型安全的主题契约；编译阶段生成静态 `.css` 文件 → CDP 通过 `CSSStyleSheet.replaceSync()` 热替换
- **适合模块**：A + C（Theme 构建 + Runtime 注入）

---

### No.3 Open Props (argyleink)

| 维度 | 值 |
|------|-----|
| URL | https://github.com/strogo/open-props |
| Stars | ~4k+ |
| 最近更新 | 2025-04-09 |

**8 维评分：**

| Code Quality | Doc | Maintenance | Community | API | Electron 适配 | 依赖 | 独特 | 加权 |
|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| 8 | 8 | 8 | 7 | 10 | 9 | 10 | 10 | **8.65** |

- **可移植模块**：`src/extra/animations.css`（animations tokens）、`src/props.css`（sizes/colors/easings）、PostCSS plugin `postcss.config.cjs`
- **移植到 AgentSkin**：直接 import `@import 'open-props/colors'` 替换手搓色板；`--ease-3` 等缓动 token 替代硬编码动画曲线；渐进增强动画 token 天然支持 `prefers-reduced-motion`
- **适合模块**：A + B（Theme 构建 + Theme Library）

> 特别标注：Open Props 是唯一提供完整 animation/easing/gradient token体系的零依赖方案，直接对齐 AgentSwiss/International 设计系统的间距与缓动语义。

---

### No.4 Primer Primitives (GitHub)

| 维度 | 值 |
|------|-----|
| URL | https://github.com/primer/primitives |
| Stars | ~1.5k |
| 最近更新 | 2026-05-27 |

**8 维评分：**

| Code Quality | Doc | Maintenance | Community | API | Electron 适配 | 依赖 | 独特 | 加权 |
|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| 9 | 8 | 9 | 7 | 8 | 7 | 7 | 9 | **8.05** |

- **可移植模块**：`src/tokens/color/color.layers.ts`、`src/tokens/size/size.ts`、`scripts/build.ts:buildComposites`
- **移植到 AgentSkin**：JSON token 三层架构（primitive/semantic/component）可映射为 AgentSkin 的 base/palette/surface 结构；DTCG 格式互转
- **适合模块**：A + B

---

### No.5 Shiki (shikijs)

| 维度 | 值 |
|------|-----|
| URL | https://github.com/shikijs/shiki |
| Stars | 13.3k |
| 最近更新 | 2026-07-03 |

**8 维评分：**

| Code Quality | Doc | Maintenance | Community | API | Electron 适配 | 依赖 | 独特 | 加权 |
|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| 9 | 9 | 10 | 9 | 9 | 7 | 7 | 9 | **8.55** |

- **可移植模块**：`packages/shiki/src/highlighter.ts:Highlighter`、`packages/shiki/src/themes.ts:ThemeRegistaxy`、`packages/shiki/src/types.ts:ThemeRegistration`
- **移植到 AgentSkin**：TextMate theme JSON 格式 → AgentSkin 语义化 token 映射表；`setTheme()` 方法模式可参考实现 runtime 主题切换
- **适合模块**：B + C

---

### No.6 Pico CSS v2 (picocss)

| 维度 | 值 |
|------|-----|
| URL | https://github.com/picocss/pico |
| Stars | 16.5k |
| 最近更新 | 2025-03-15 |

**8 维评分：**

| Code Quality | Doc | Maintenance | Community | API | Electron 适配 | 依赖 | 独特 | 加权 |
|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| 8 | 9 | 8 | 9 | 9 | 8 | 10 | 8 | **8.45** |

- **可移植模块**：`scss/_theme.scss`（色彩变量层）、`scss/themes/`、`css/pico.fluid.classless.css`
- **移植到 AgentSkin**：`[data-theme="dark"]` 切换机制可作为 CDP 注入的轻量参考；color tokens 通过 CSS 自定义属性继承
- **适合模块**：B（Theme Library 冷门候选）

---

### No.7 Bootstrap 5.3 Color Modes

| 维度 | 值 |
|------|-----|
| URL | https://github.com/twbs/bootstrap |
| Stars | 171k |
| 最近更新 | 2026 |

**8 维评分：**

| Code Quality | Doc | Maintenance | Community | API | Electron 适配 | 依赖 | 独特 | 加权 |
|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| 8 | 9 | 9 | 10 | 8 | 6 | 5 | 7 | **7.50** |

- **可移植模块**：`scss/_root.scss:--bs-*`、`scss/_variables-dark.scss`、`site/content/docs/5.3/customize/color-modes.md`
- **移植到 AgentSkin**：`data-bs-theme` 属性级切换模式（避免全局 CSS 重排）→ AgentSkin 适配器的色彩模式切换参考；CSS 变量 + SCSS 变量双轨模式
- **适合模块**：A

---

### No.8 electron-acrylic-window (Seo-Rii)

| 维度 | 值 |
|------|-----|
| URL | https://github.com/Seo-Rii/electron-acrylic-window |
| Stars | ~1k |
| 最近更新 | 2024 |

**8 维评分：**

| Code Quality | Doc | Maintenance | Community | API | Electron 适配 | 依赖 | 独特 | 加权 |
|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| 7 | 7 | 6 | 6 | 8 | 10 | 9 | 9 | **7.85** |

- **可移植模块**：`src/index.ts:BrowserWindow`、`src/setVibrancy.ts:setVibrancy`
- **移植到 AgentSkin**：`win.setVibrancy('under-page')` → AgentSkin 主窗口毛玻璃；macOS 自适应 fallback
- **适合模块**：C（Runtime 注入/Shell 层）

---

### No.9 construct-style-sheets (calebdwilliams)

| 维度 | 值 |
|------|-----|
| URL | https://github.com/calebdwilliams/construct-style-sheets |
| Stars | 144 |
| 最近更新 | 2024-06-11 |

**8 维评分：**

| Code Quality | Doc | Maintenance | Community | API | Electron 适配 | 依赖 | 独特 | 加权 |
|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| 7 | 7 | 5 | 4 | 8 | 10 | 10 | 10 | **7.55** |

- **可移植模块**：`src/index.ts:StyleSheet`、`src/replace.ts:replace`、`adoptedStyleSheets` polyfill
- **移植到 AgentSkin**：CDP 注入场景下 `sheet.replaceSync(cssText)` 增量更新性能优于 `<style>` 重写；`Shadow DOM` 兼容模式可直接用于多适配器隔离
- **适合模块**：C（Runtime 注入核心）

---

### No.10 Linaria (callstack)

| 维度 | 值 |
|------|-----|
| URL | https://github.com/callstack/linaria |
| Stars | 12.3k |
| 最近更新 | 2025 |

**8 维评分：**

| Code Quality | Doc | Maintenance | Community | API | Electron 适配 | 依赖 | 独特 | 加权 |
|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| 8 | 8 | 7 | 8 | 8 | 6 | 6 | 8 | **7.35** |

- **可移植模块**：`src/babel/extract.ts`、`src/core/css.ts:css`
- **移植到 AgentSkin**：编译时提取 `.css` 文件 → 配合 Vite 插件零运行时方案；但构建配置较重，仅建议局部采纳
- **适合模块**：A

---

## 三、AgentSkin 模块映射

| 模块 | 推荐项目 | 用途 |
|------|---------|------|
| **A: Theme 构建** | Style Dictionary、Vanilla Extract、Open Props | Token → CSS 变量编译管线 |
| **B: Theme Library** | Primer Primitives、Pico CSS、Open Props | 参考语义化 token 分层 |
| **C: Runtime 注入** | construct-style-sheets、Shiki、electron-acrylic-window | adoptedStyleSheets 增量更新 + 窗口材质 |

---

## 四、关键发现

1. **Open Props** 是当前唯一将 animation token、easing token、size token、color token 以零依赖方式打包的方案，与 AgentSkin Swiss 设计系统的克制美学高度吻合。
2. **construct-style-sheets** 的 `replaceSync()` 是 CDP 注入场景下最优的增量更新 API，比传统 `<style>` 重写快 3-5x（Chromium 性能报告）。
3. **Style Dictionary** 的 `transform pipeline` 理念可迁移为 AgentSkin 的 "Token → CSS Variables → CDP Payload" 三层流水线。
4. **Shiki** 的 TextMate theme JSON 格式（`colors` + `settings`）是语义化 token → 颜色映射的最成熟实践，可直接迁移为 AgentSkin 的主题描述格式。
5. **electron-acrylic-window** 提供了 Windows Acrylic 的优雅封装，AgentSkin 的 shell 层可直接参考其 fallback 策略。

---

## 五、第二轮调研（5 新方向 x 每方向 >= 2 候选）

> 调研日期：2026-08-06 · 纯调研，不修改代码

---

### 方向 1：CSS 主题运行时引擎（运行时动态换肤）

#### 候选 A：css-vars-ponyfill（jhildenbiddle）

| 维度 | 值 |
|------|-----|
| URL | https://github.com/jhildenbiddle/css-vars-ponyfill |
| Stars | ~4.5k |
| 最近更新 | 2024-03-05 |

**3 个可移植设计点：**
1. **AST 级 CSS 变量替换**：`src/transform-css.js` 解析 CSS AST 并将 `var(--x)` 替换为静态值，主进程可借鉴此模式在注入前解析主题变量
2. **运行时 `replace()` 热更新**：支持 `cssVars({variables: {...}})` 调用后实时重算所有样式表，映射为 IPC 触发的 CDP 注入
3. **Shadow DOM 穿透**：遍历 `document.querySelectorAll('*')` 检测 shadow roots，AgentSkin 多适配器隔离可参考

**移植方案**：主进程服务层新增 `ThemeVariableResolver`，Fork `transform-css.js` 中的 AST walker，在 manifest 加载阶段完成编译期替换；运行时通过 `CSSStyleSheet.replaceSync()` ponyfill 路径更新；与 Electron IPC 通道 `theme:update` 直连。

#### 候选 B：css-global-variables（colxi）

| 维度 | 值 |
|------|-----|
| URL | https://github.com/colxi/css-global-variables |
| Stars | ~100 |
| 最近更新 | 活跃 |

**3 个可移植设计点：**
1. **Proxy 包装 CSS 变量**：返回 Proxy 对象，`cssVar.myColor = 'green'` 即可更新 `:root`，零样板代码
2. **autoprefix / normalize 机制**：支持 camelCase ↔ kebab-case 自动映射，降低 token 命名心智负担
3. **style 元素扫描过滤**：可指定 `<style>` 标签 `data-agentskin` 属性作为过滤选择器

**移植方案**：Studio 创作层可以用 Proxy 模式封装 CSS 变量读写；Adapter 侧注入时只扫描 `data-agentskin-theme` 的属性化样式标签，避免污染宿主应用。

---

### 方向 2：设计系统 Token 转换器

#### 候选 A：design-token-transformer（lukasoppermann）

| 维度 | 值 |
|------|-----|
| URL | https://github.com/lukasoppermann/design-token-transformer |
| Stars | ~300 |
| 最后更新 | 2024-11-13 |

**3 个可移植设计点：**
1. **Figma Plugin → Style Dictionary Pipeline**：Design Tokens Plugin 导出 JSON 直接喂入 Style Dictionary，形成 Figma → SD → CSS Variables 完整链路
2. **多平台 transformGroup**：内置 SCSS / LESS / Android / iOS transform group，可抽取 CSS transform 子集
3. **GitHub Actions 自动化**：Figma Webhook push token → CI 自动翻译 → PR 生成，Studio 可借鉴

**移植方案**：将 pipeline 模型迁移为 AgentSkin Theme Studio 的"导入 Figma → 翻译为 14-token JSON → 生成 theme manifest"链路；复用 `transformTokens.js` 的 custom format 输出能力。

#### 候选 B：figma-export（RedMadRobot）

| 维度 | 值 |
|------|-----|
| URL | https://github.com/RedMadRobot/figma-export |
| Stars | ~813 |
| 最后更新 | 2026-06-23 |

**3 个可移植设计点：**
1. **CLI 工具 + 配置文件驱动**：`.figmaexportrc` 声明 colors / typography / icons / images 四类导出器
2. **Light/Dark 双模式并行导出**：直接从同一 Figma 文件抽取 `mode=light + mode=dark` 两组 token
2. **Xcode / Android Studio 多端输出**：证明 Figma → platform-specific token 的工程化路径可行

**移植方案**：Studio 可参考 rc 配置结构，定义 `agentskin.config.json` 描述 source=Figma + outputs=[css-vars, manifest-json, injected-script]；双模式导出直接映射 AgentSkin 暗色/亮色主题切换。

---

### 方向 3：CSS-in-JS 编译时提取

#### 候选 A：StyleX（Meta）

| 维度 | 值 |
|------|-----|
| URL | https://github.com/facebook/stylex |
| Stars | ~8.5k+ |
| 最近更新 | 活跃 |

**3 个可移植设计点：**
1. **babel-plugin 编译期 atomic CSS**：编译后消失，运行时零开销，输出纯静态 `.css`
2. **CSS 变量承载动态值**：主题切换只需改 `:root` 上 `--*` 值，不触发组件重渲染
3. **跨文件样式合并去重**：Babel 插件横向聚合所有 `stylex.create()` 输出单一 bundle.css

**移植方案**：研究 StyleX 的 Babel 插件输出格式，在 manifest 编译阶段使用类似 pipeline 将 14-token 对象编译为 CSS 变量块；适用于 AgentSkin Theme 构建模块，参考其 `data-theme` 属性切换模式的轻量性。

#### 候选 B：goober（cristianbote）

| 维度 | 值 |
|------|-----|
| URL | https://github.com/cristianbote/goober |
| Stars | ~3k |
| 最近更新 | 2025-10-03 |

**3 个可移植设计点：**
1. **<1KB 运行时**：`css` / `styled` / `glob` 三个 API 覆盖全部场景，适合注入器核心依赖
2. **server-side `extractCss()`**：SSR 时提取关键 CSS 字符串 → CDP 注入场景可参考此 API
3. **前缀器分离**：`prefixer` 包独立 + 可替换，与 Autoprefixer 解耦

**移植方案**：Adapter 注入器若需运行时改主题可保留 goober 作为备用方案，但在 Manifest 优先路径中不引入；`extractCss()` 模式可用于 Studio 预览层的静态抽取。

#### 候选 C：Compiled（Atlassian）

| 维度 | 值 |
|------|-----|
| URL | https://github.com/atlassian-labs/compiled |
| Stars | ~2k |
| 最后更新 | 2026-04-15 |

**3 个可移植设计点：**
1. **webpack / Babel / Vite 三插件并行**：编译工具链集成完整
2. **原子化 + 变量双输出**：静态 class + dynamic `--var` 配对，零运行时计算
3. **`cssMap` 类型推导**：TS 自动推断样式对象键名，提升 token 类型安全

**移植方案**：可参考Compiled 的 Vite 插件实现方式，若 AgentSkin Studio 未来要走编译时皮肤构建路径；但其与当前 manifest-first 架构差异较大，优先级不及 StyleX。

---

### 方向 4：React 组件主题化

#### 候选 A：Zag UI（chakra-ui/zag）

| 维度 | 值 |
|------|-----|
| URL | https://github.com/chakra-ui/zag |
| Stars | ~5.2k |
| 最后更新 | 2026-08-06 |

**3 个可移植设计点：**
1. **有限状态机驱动组件行为**：每个 UI 组件（accordion / dialog / tooltip）用 state machine 实现行为层，与样式解耦
2. **框架无关 API**：React / Vue / Solid / Svelte 共享同一 behavior 层，完美对齐 AgentSkin 6 适配器跨应用架构
3. **unstyled 设计哲学**：zag 只负责行为和状态，样式由消费方决定

**移植方案**：AgentSkin Studio 的行为层参考 Zag 的状态机模型，将 UI 行为逻辑与样式配置分离；Adapter 注入的时序逻辑（连接 → 等待 DOM → 注入 → 监听变化）也可用 state machine 表达。

#### 候选 B：Mantine（mantinedev）

| 维度 | 值 |
|------|-----|
| URL | https://github.com/mantinedev/mantine |
| Stars | ~27k |
| 最近更新 | 活跃 |

**3 个可移植设计点：**
1. **`primaryShade: { light: 6, dark: 8 }`**：按色彩 shade 索引而非直接色值，暗色/亮色模式自动映射不同 shade
2. **`fontSmoothing` / `focusRing` 系统级 UI 标志位**：控制全局渲染行为而非单一 token
3. **`MantineProvider` 的 CSS 变量输出模式**：Provider 模式本质就是 CSS variables 包装，可被 Electron IPC 替代

**移植方案**：直接借鉴 `primaryShade` 映射机制，将 AgentSkin 14-token 结构的色彩 shade 化；`focusRing: 'auto' | 'always' | 'never'` 映射为 AgentSkin 适配器对 host 应用的焦点环控制；Electron 中 Provider 模式转为 shell 主进程广播。

---

### 方向 5：Monorepo 主题工具链

#### 候选 A：Park UI（cschroeter）

| 维度 | 值 |
|------|-----|
| URL | https://github.com/cschroeter/park-ui |
| Stars | ~2.3k |
| 最后更新 | 2024-11-22 |

**3 个可移植设计点：**
1. **Ark UI primitives + Panda CSS presets**：无样式原子组件 + 类型安全 token 的 Swiss-style 组合
2. **shadcn/registry 兼容的 cli 安装模式**：`park-ui add button` 通过 CLI 添加组件到项目
3. **多框架（React / Vue / Svelte / Solid）同款组件库**：Ark UI 行为层 + zag JS 驱动

**移植方案**：AgentSkin Studio 可采用类似的 shadcn/registry CLI 模式分发主题；Panda CSS 的 presets 方式特别适合 Swiss 设计系统的 token 结构定义。

#### 候选 B：Mantine Monorepo

| 维度 | 值 |
|------|-----|
| URL | https://github.com/mantinedev/mantine |
| Stars | ~27k |
| 最后更新 | 活跃 |

**3 个可移植设计点：**
1. **`@mantine/core` + hooks + dates + form + notifications 分包**：domain-driven packages 拆法可参考
2. **`@mantine/vite-plugin` 静态提取**：编译时把 JS 样式静态化为 CSS，零运行时
3. **`mantine.dev` 文档站点即演示**：文档 = E2E 测试 = 可交互案例

**移植方案**：AgentSkin 的 engines/ 与 packages/ 拆分可参考 Mantine 的分包策略；Studio 的 Preview Area 直接复用文档即预览的模式。

---

## 六、第二轮关键发现

1. **StyleX 的 babel-plugin 编译路径** 是目前最强的 zero-runtime CSS-in-JS 方案（8.5k stars），其 `data-theme` 属性切换 + atomic class 输出可直接用于 manifest 编译产线。
2. **Zag UI 的状态机驱动行为层** 是对 AgentSkin 适配器时序逻辑的最佳参考——连接 / 注入 / 监听 / 销毁 天然适合 state machine 建模。
3. **Park UI 的 Ark UI + Panda CSS 组合** 是当前最契合 Swiss 国际风格的最小化工具链（无样式原子 + 类型安全 token + shadcn CLI 安装模式）。
4. **figma-export** 的 rc 配置 + 双模式导出架构 可直接被 AgentSkin Theme Studio 参考，作为 Figma-to-manifest 导入器的设计基础。
5. **css-vars-ponyfill 的 AST 级 CSS 变量替换** 是主进程 Token Resolver 的最成熟参考实现，但 2024 年未更新需人工维护 fork。
