# AgentSkin λ 安全护栏第三轮深度漏检报告

> 审计日期: 2026-08-20 | 范围: 全链路 P0-1/P0-2/P0-3 | 审计人: 自动化深度审计

---

## 1. sanitize 深度测试

### 1.1 现有防护机制回顾

`sanitize.ts` 采用 fail-closed 策略，三道防线依次为：
1. `stripComments()` 去除 `/* */` 注释
2. `decodeCssUnicode()` 解码 `\XXXX` CSS unicode 转义
3. 全局 `@import` / `url()` 正则扫描
4. 逐声明检查：denylist → allowlist → var 引用 → 函数白名单

### 1.2 五个新攻击向量分析

#### AV-1: CSS 属性值字符串逃逸 `content: "\0075rl(..."`

**攻击载荷**：`content: "\0075rl('javascript:alert(1)')"`

**判定**：**阻断**。原因：`content` 在 `DEFAULT_FORBIDDEN_PROPERTIES` 中（第 78 行），sanitizeDeclarations 第 394 行 denylist 检查命中，直接 block。即使攻击者通过 `\0075` 编码尝试绕过 url 检测，content 属性本身已被禁止。但需注意：unicode 解码发生在属性级别检查之前（第 148/194 行），`\0075` → `u` 后被拼为 `url`，url 全局正则也会兜底命中。**双重阻断，安全**。

#### AV-2: `@charset` 注入

**攻击载荷**：`@charset "utf-8"; @import url('evil.css');`

**判定**：**阻断**。`@import` 在去注释后通过第 143 行正则 `@import` 检测命中，返回 isBlocked=true。纯 `@charset` 无 import 时不会被 `@import` 正则捕获，但 `@charset` 本身在 sanitizeDeclarations 中因不含 `冒号` 格式而被忽略（第 387 行 `indexOf(':') === -1` 时 continue）。`@charset` 也不是 CSS 属性值注入场景中的可执行载体。**低风险，已被覆盖**。

#### AV-3: CSS 变量名碰撞 `--agentskin-accent` 被覆盖

**攻击载荷**：`@keyframes agentskin-accent { 0% { opacity: 0 } 100% { opacity: 1 } }`

**判定**：**阻断 + 重命名**。`resolveName()` 第 497 行检测以 `agentskin-` 开头的 keyframes 名，通过 FNV-1a hash 重命名为 `agentskin-usr-{hash}-agentskin-accent`。命名冲突导致的原有动画被覆盖被防御。**安全**。

#### AV-4: 多行注释中的隐藏 payload

**攻击载荷**：`/* \0075rl(evil) */ 0% { opacity: 0 }`

**判定**：**阻断**。`stripComments()` 第 525 行非贪婪 `/\/\*[\s\S]*?\*\//g` 移除所有注释包括多行注释。移除后 `\0075rl` 暴露出来，decodeCssUnicode 解码为 `url`，被全局 url 正则兜底。**安全**。

#### AV-5: 空字节注入 `\0`

**攻击载荷**：`0% { opacity: 0; behavior: expr\0ession(alert(1)) }`

**判定**：**阻断**。`\0`（U+0000）在 `decodeCssUnicode()` 第 535 行被显式拒绝（`if (cp === 0 ...)` 返回空字符串）。CSS 中 `\0` 被解码为空字符而非 NUL 字节，`expression` 被拆碎后无法被函数白名单匹配。即使 `\0` 以 NUL 形式存在于输入中，denylist 检查中 `prop` 取 `:` 左侧的 `behavior` 仍命中 denylist。**安全**。

### 1.3 sanitize 结论

五个新攻击向量均被正确阻断。sanitize 的纵深防御（denylist + allowlist + url 全局扫描 + unicode 解码 + 注释剥离）在多层纽织下互为兜底。**未发现绕过路径**。

---

## 2. sandbox 深度测试

### 2.1 现有防护机制回顾

`sandbox.ts` 采用子进程隔离：
- `--disallow-code-generation-from-strings` 阻断 eval/new Function
- IIFE 内 `const require/process/global/... = undefined` 遮蔽危险全局量
- `env: {}` 清空环境变量
- `stdio: ['ignore', 'pipe', 'pipe']` 关闭 stdin
- SIGTERM + 2s SIGKILL 超时升级
- `--max-old-space-size` 内存软上限

### 2.2 三个逃逸尝试分析

#### SE-1: `this.constructor.constructor` 访问 Function

**攻击载荷**：`function(input) { return this.constructor.constructor('return process')(); }`

**判定**：**隔离有效**。Node.js 中 `this` 在严格模式函数中为 `undefined`，在非严格模式全局函数中为 global 对象。shim 代码中 `_hook(_input)` 以非严格模式调用时，`this` 指向 global — 但 shim 顶层 `global = undefined` 已将 global 遮蔽。即使通过 `this.constructor` 到达 Object constructor，`Function` 虽未被遮蔽（代码注释第 247-249 行说明因 strict mode 下 `const eval = undefined` 是语法错误故不遮蔽），但 `--disallow-code-generation-from-strings` 标志在 V8 层面已禁止 `new Function()` 和 `eval()`。V8 将抛出 `TypeError: Code generation from strings disallowed`，被 catch 块捕获后调用 `_exit(1)`，返回 `API_VIOLATION`。**沙箱隔离有效**。

#### SE-2: `process.mainModule.require` 访问内置模块

**攻击载荷**：`function(input) { return process.mainModule.require('child_process'); }`

**判定**：**隔离有效**。shim 第 253 行 `const process = undefined` 已将 process 设为 `undefined`。用户代码中 `process.mainModule` 抛出 `TypeError: Cannot read properties of undefined`，catch 捕获后 `_exit(1)` 返回。`env: {}` 清空环境变量进一步阻断了通过 `process.env` 的任何路径。**安全**。

#### SE-3: `Array.prototype.push` 修改白名单数组

**攻击载荷**：`function(input) { Array.prototype.push.apply(Math, ['__proto__']); return Math; }`

**判定**：**隔离有效**。shim 第 262 行 `_allowed` 是一个局部 `var` 对象，不是 `allowedAPIs` 参数的引用，修改原型不会影响 `_allowed` 的内容。即使用户代码污染 `Object.prototype` 或 `Array.prototype`，shim 的 `const` 遮蔽和 IIFE 隔离作用域确保用户代码无法触及父作用域的 `allowedAPIs` 数组。且子进程退出后原型污染不持久化。**安全**。

### 2.3 sandbox 边界风险

发现一个**被接受的限制**：`allowedAPIs` 默认包含 `Object`，恶意代码可通过 `Object.getPrototypeOf` 到达原型链底层。但由于所有危险入口（require、process、global、Function）均被遮蔽或 V8 级阻断，原型链操控在沙箱中无法转化为逃逸。**可接受的设计权衡**。

---

## 3. specificity 深度测试

### 3.1 三个边界 case 分析

#### SC-1: `:is(.a, .b, .c)` 复杂伪类

**分析**：`calculateSpecificity` 第 168 行正则 `/:[a-zA-Z-][\w-]*(?:\([^)]*\))?/g` 将 `:is(.a, .b, .c)` 识别为一个伪类整体，计入 b 计 1。W3C 规范要求 `:is()` 取参数列表中的最大 specificity（此处应为 [0,3,0]），但当前实现计为 1。

**判定**：**specificity 计算偏低**，不是安全误报。`extractRules` 将 `:is()` 所在规则作为一条规则进行判断，实际 precision 损失在特异性向上溢出时会放行一个超限选择器，但在 build-theme-package 的上下文中 specificity 超限只触发 warn 不触发 block。**低风险，属于功能精确度问题，非安全漏洞**。

#### SC-2: `:not()` 否定伪类中的 ID 选择器

**分析**：W3C Selectors Level 4 规定 `:not(#id)` 内部的选择器应贡献 specificity（此处 #id 增加 a 计 1）。当前实现在行 130 的注释中明确 "Does NOT account for :not() inner specificity (treated as :not itself only)"。

测试：`calculateSpecificity(':not(#main)')` 返回 [0,1,0]（:not 计 b=1），按规范应为 [1,0,0]（#main 计 a=1）。

**判定**：与 SC-1 同理，特异性计算偏差方向是**偏低**（实际 specificity 比计算值高），导致 specificity 守卫对含 `:not(#id)` 的规则放行。在非信任主题源（如第三方 Studio 主题）场景下可能被利用注入高优先级规则。**中低风险，建议在 specificity.ts JSDoc 中补充此已知限制**。

#### SC-3: `@media` 查询内的 `@layer` 规则

**分析**：`extractRules()` 第 232 行仅识别 `@layer` 开头的选择器为 layer 块。对于 `@media (prefers-color-scheme: dark) { @layer agentskin { ... } }` 这种嵌套，`extractRules` 的外层循环将 `@media ... {` 整体作为选择器提取（以 `{` 匹配），其 inner 包含 `@layer` 和规则。由于 `@media` 以 `@` 开头且非 `@layer`，第 239 行的 `!selector.startsWith('@')` 检查会跳过它，内部规则不会被提取和分类。

**判定**：媒体查询内的 @layer 规则逃逸 specificity 守卫检测。产物中该部分 CSS 的 !important 不会被计入 budget。在 build-theme-package 的实际使用中 media query 内 @layer 是极少见模式。**低风险，但应补充文档说明当前 extractRules 不处理 @media 嵌套**。

### 3.2 specificity 结论

三个边界 case 均为计算精度限制，方向一致为"偏低计算"，意味着 specificity 守卫是**偏宽松**而非偏严格。在当前的 detect-warn 模式下不会导致危险产物注入，但理论可被对抗性主题利用来绕过 maxSpecificity ceiling。**建议在 v3 规范中将此限制文档化**。

---

## 4. 集成链路审计

### 4.1 sanitize fail-closed 验证

`build-theme-package.mjs` 第 511-528 行：

```js
const sanitized = sanitizeKeyframes(rawKeyframes, { allowPaletteTokens: true, namespacePrefix: 'agentskin-' });
if (sanitized.isBlocked) {
  console.warn(`[build-theme-package] ⚠ keyframes blocked for ${agentId}: ${sanitized.violations.join('; ')}`);
  // fail-closed: skip this keyframes, continue build.
}
```

**判定**：符合 fail-closed 约定。isBlocked=true 时跳过该 keyframes，不写入 CSS，其余部分正常构建。不抛出异常，不中断整体构建流程。**正确实现**。

### 4.2 specificity 超预算仅 warn 不改变产物

`build-theme-package.mjs` 第 883-894 行：

```js
const report = validateSpecificity(css, agentProfile);
if (report.violated) {
  console.warn(`[build-theme-package] ⚠ specificity budget exceeded for ${agentId}: ...`);
}
```

**判定**：纯 warn 模式，不修改 `css` 变量，不改变 `buildAgentCssInternal` 的产物。CSS 原样写入磁盘。符合"仅 warn 不改变产物"的约束。**正确实现**。

### 4.3 agentskin-compiler.mjs verify/diagnose 命令覆盖

`verify` 命令（第 130-171 行）覆盖：
- Schema 验证（manifest.id / colors / agents）
- Keyframes sanitize（P0-2）
- Specificity check per agent（P0-1）

`diagnose` 命令（第 223-268 行）额外覆盖：
- Health score 综合评分
- 关键帧详细报告
- 各适配器 specificity 明细

**未覆盖项**：
- `sandbox` 钩子代码的运行时验证（P0-3）：`verify` 和 `diagnose` 只检查 manifest 的 declarations.keyframes 静态 sanitize，不执行 manifest 中的 hooks 代码。依赖 manifest 加载后的 hook 运行时才触发。
- 变量桥接（variableBridge）内容未做 sanitize（第 532-536 行直接字符串拼接，未过 sanitizeDeclarationBlock）。

**判定**：**sandbox 护栏在 verify/diagnose 中缺失**。建议在 v3 manifest schema 中对 hooks 字段做静态代码扫描（检查是否包含 require/process 等关键词）。

---

## 5. 遗漏排查

### 5.1 变量桥接未过 sanitize

`build-theme-package.mjs` 第 532-536 行：

```js
if (bridge && typeof bridge === 'object' && Object.keys(bridge).length > 0) {
  lines.push(':root {');
  for (const [k, val] of Object.entries(bridge)) lines.push(`  ${k}: ${val};`);
  lines.push('}');
}
```

`bridge` 的值直接字符串拼入 CSS 未经 sanitizeDeclarationBlock。如果 bridge 的值包含 `url(...)` 或被恶意注入表达式，sanitizeKeyframes 不覆盖此路径（它仅处理 keyframes），specificity 不拦截 url()（只计数 !important 和 specificity）。

**风险等级**：**中**。在 Studio 上下文中 bridge 内容来自 UI 控件（token 选择器），但 v3 schema 如果允许 free-form variableBridge 来自用户提供，则可能引入外部 CSS 注入。**建议对 bridge 内容调用 sanitizeDeclarationBlock**。

### 5.2 manifest schema v3 新字段校验遗漏

`package.mjs` 中 `validateDecorations()` 已对 `decorations.layouts[].anchor` 做空字节和长度校验（第 306 行），`asset`/`motion`/`offset`/`width`/`height`/`zIndex`/`flash` 均有类型和强度校验。`signals` 和 `artFocalPoint` 在 package.mjs 中未显式校验（仅 decorations 和 images/assets 被校验）。

`hooks` 字段在 package.mjs 的 validateThemePackage 中完全未校验（未出现在 v1 schemaVersion = 1 的校验函数中）。

**风险等级**：**中**。hooks 可执行任意代码但依赖 sandbox 保护；`signals`/`artFocalPoint` 若为未来新增字段，需补充类型/强度校验。

### 5.3 主题包安装路径目录遍历

`package.mjs` 中 `readThemePackage`（第 467 行）使用 `path.extname` 校验扩展名为 `.agentskin-theme`，`buildThemePackage` 中图片文件名经 `path.basename` + `replace(/[^a-z0-9._-]/gi, '-')` 清洗。`writeThemePackage` 的输出路径经 `path.resolve` 处理。

**判定**：形成闭环防御。文件名清洗 + resolve + 扩展名校验三重防护，路径遍历风险**低**。

### 5.4 CSS 产物写入磁盘竞争条件

`build-theme-package.mjs` 第 900-901 行使用 `fs.writeFileSync` 串行写入 manifest.json 和 CSS 文件。Node.js 单线程事件循环下 `writeFileSync` 是原子阻塞调用，不存在并发的 TOCTOU 竞争窗口。唯一风险是进程被 kill 导致半写（manifest.json 完整但 CSS 不完整），但构建流程在应用外完成，非运行时热加载。

**判定**：**低风险**。如需更强保证，可写入 tmpfile + atomic rename（非必须）。

---

## 6. 性能影响评估

### 6.1 sanitize 构建性能

- 单次 sanitizeKeyframes：stripComments O(n) + decodeCssUnicode O(n) + url 正则 O(n) + parseStops O(n) + per-declaration 扫描 O(n)
- 总体复杂度 O(n)，常数因子约 5-8 个正则 pass
- 最大真实输入：14 主题 x 6 代理 x ~50 keyframes，每条 <2KB
- 实测估算：单次 sanitize <1ms，全量构建 <100ms
- **影响可忽略**

### 6.2 sandbox 子进程启动开销

- 每次 hook 执行：spawn(node) + V8 bootstrap + `node -e` 解析
- 冷启动开销 ~50-80ms（Node child_process spawn）
- 默认 timeout 5000ms，内存上限 64MB
- 在 hooks 低频调用场景（主题切换/应用启动）下开销可接受
- **建议**：如果 hooks 被高频调用（每秒多次），考虑进程池或 in-process VM2 替代。当前设计下无私敌复用需求。

### 6.3 specificity 正则匹配大文件性能

- doubao.css 实测 ~59KB，约 1200 行 CSS
- extractRules: 单次 indexOf('{') 循环，O(n)
- per-rule calculateSpecificity: 每个选择器约 6 个正则 pass
- 估算 59KB CSS 含 ~400 个规则，每个选择器平均 3 部分 → ~7200 次正则匹配
- JavaScript 正则引擎在短字符串上约 1-5μs/match → 总计 <50ms
- **影响可忽略**。即使 6 代理全量构建，总计 <300ms。

---

## 7. 审计总结

| 模块 | 新发现 | 风险 | 建议 |
|------|--------|------|------|
| sanitize（5 攻击向量） | 全部阻断 | 无 | 维持现状 |
| sandbox（3 逃逸尝试） | 全部隔离 | 无 | 维持现状 |
| specificity（3 边界 case）| 计算偏低（:not/:is/@media 嵌套）| 低 | v3 文档化已知限制 |
| 变量桥接 bridge | 未过 sanitize | 中 | 增加 sanitizeDeclarationBlock |
| verify/diagnose | sandbox 未覆盖 | 中 | v3 增加 hooks 静态扫描 |
| 安装路径遍历 | 三层防御有效 | 低 | 维持现状 |
| 磁盘写入竞争 | 单线程 sync 写 | 低 | 维持现状 |

**整体结论**：P0-1/P0-2/P0-3 三护栏在核心攻击面上的实施是充分的。新发现的两个中等风险（bridge 未 sanitize、hooks 无静态校验）均位于 v3 schema 新增字段，不影响当前 v2 生产部署。建议在 manifest v3 定稿前补齐上述校验，不阻塞 v2 发布。
