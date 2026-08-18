# 深度适配立项雏形（Deep-Adaptation Initiative）

> 状态: **雏形 / 待评审**（未执行，纯规划）
> 日期: 2026-08-19
> 关联: `cdp-asar-integration-plan.md`（仅方案未执行）、`THEME_AUTHORING_GUIDE.md`（v1.0 draft）
> 约束: 遵循 `AGENTS.md` 黄金规则——未新增适配器、未新增 UI 页、未改核心数据模型前不需要 RFC；凡触碰 manifest schema / 运行时注入层 / 六页封顶，先走本 RFC 评审。

---

## 0. 立项背景（一句话）

竞品（codedrobe / Dream Work Theme）靠"**深雕琢的 CSS**"做出质感主题，AgentSkin 目前只有"**14 契约 token 的浅适配**"——换皮不抓人。我们已把采集层（CDP + asar）做到 DevTools 级，但**决策层仍是手写静态选择器，采集数据没喂进注入决策**，导致"深适配"无从谈起。

立项目的：把"**采集数据 → 决策 → 注入**"接成闭环，让深适配成为可复现、可自动校验、可防版本漂移的能力。

---

## 1. 「手写 CSS」的概念澄清（对齐认知）

竞品的"手写 CSS"**不是逐字符手敲**，而是：**以基座生成 → 作者反复雕琢/修 bug/多版本迭代 → 沉淀出高精度、高适配、深度定制的结果**。

对 AgentSkin 的含义：生成器是"浅适配基座"，缺的是"**深雕琢层**"（覆写原生 token、挑稳定选择器、铺纹理/主视觉、逐表面修质感）。本立项要建的核心就是这层"雕琢"的引擎化 / 半自动能力。

---

## 2. 现状诊断（逐一核实后的真缺口）

### 2.1 分层模型
```
① 采集层   asar 解包 / CDP 提取 → 数据（锚点、fragilitySeeds、命名空间、token）
② 决策层   引擎此刻决定"用哪个选择器命中、挂哪类规则"
③ 执行层   把 CSS 注入目标应用
```
**断点在 ①②**：①建好了，②靠手写，采集数据不参与选择器决策。

### 2.1 已确认的真缺口

| # | 缺口 | 证据 | 判定 |
|---|------|------|------|
| 1 | **决策层手写静态选择器，采集数据未喂进决策** | [workbuddy.mjs](file:///c:/Users/snowb/Desktop/work/desktop-main/src/engine/src/adapters/workbuddy.mjs#L104) `{name:"sidebar", any:[...]}` 为手写字符串数组；`fragilitySeeds` 未参与注入决策 | ✅ 真 |
| 2 | **高定制多素材缺 3 个能力（见 2.2）**：①多资产注入通道 ②面级布局/定位语义 ③透明可动 overlay | 注入层仅单条 `--agentskin-art`（[hero-inject.ts](file:///c:/Users/snowb/Desktop/work/desktop-main/src/main/cdp/injection/hero-inject.ts#L73)）；无"素材绑面"声明、无 overlay 运行时入口 | ✅ 真 |
| 3 | **manifest 无版本漂移检测结构** | [manifest-v2.schema.json](file:///c:/Users/snowb/Desktop/work/desktop-main/src/main/catalog/manifest-v2.schema.json#L133-L152) `verification` 仅 `required`/`recommended`，无 `contexts`/`when` | ✅ 真 |
| 4 | **豆包 token 文档自相矛盾** | [THEME_SPEC.md](file:///c:/Users/snowb/Desktop/work/desktop-main/themes/THEME_SPEC.md#L170) 称豆包用 `--semi-color-*`、`--dbx-*` 已死；实际 aurora-glass `doubao.css` 中 `--dbx-` 76 次、`--semi-color-` 43 次 | ✅ 真 |
| 5 | ~~asar 数据全沉睡~~ | **收回**——`agents-profiles/` 已被 [visual-analyzer-ipc.ts](file:///c:/Users/snowb/Desktop/work/desktop-main/src/main/ipc/visual-analyzer-ipc.ts#L8) 消费；但实时 `CDP_EXTRACT` 仍是占位符 | ⚠️ 半真 |

> 修正点（相对旧口径）：真缺口不是"asar 数据没接"，而是**"实时 CDP 提取"整条未实现 + 已采集数据不参与选择器决策**。

### 2.2 高定制多素材——三个子缺口

"高定制主题"= **深度适配模板(基座 CSS) + 多张协调素材 + 面级布局 + 透明/可动元素**，而非单纯换色校色或单张壁纸。现有能力封顶在"中适配"（单背景图 + 自动取色），上不去"高定制"，是因为缺三条资产通道：

| 子缺口 | 能力 | 现状 | 目标 |
|--------|------|------|------|
| **2a 多资产注入** | 主题包声明"多张图，每张绑到哪个面" | 注入层只有 1 条 `--agentskin-art`（背景 hero） | 支持"背景 + 侧栏图 + 对话框图 + 按钮图…"多素材，彼此协调 |
| **2b 面级布局/定位** | "素材 + 坐标 + 尺寸 + z-index" 的声明式布局 | 无"素材绑面"声明能力 | 声明"侧栏左上 60×60 放宠物 GIF"这类布局 |
| **2c 透明可动 overlay 运行时** | SVG / GIF / 透明 PNG / 动画宠物 渲染，不挡点击 | 无 overlay 运行时入口（`CDP_EXTRACT` 仍占位） | DOM/Canvas/Video 覆盖层 + 定位 + 可动 + `pointer-events:none` |

---

## 3. 立项目标（S.M.A.R.T.）

1. **决策自动化**：让①数据驱动②选择器选择——从 asar 抽候选锚点 → 运行时 CDP 验证锚点真实存在 → 按 `fragilitySeeds` 分级自动挑最稳选择器。
2. **高定制可落地**：补上"多素材注入"能力（2a 多资产 + 2b 面级布局 + 2c 透明可动 overlay），让"背景 + 侧栏图 + 对话框 + 透明小人/GIF/动画宠物"的深度模板主题成为可批量产出的普通品，而非手工神作少数派。
3. **防版本漂移**：给 manifest `verification` 引入结构化漂移检测（when/contexts），应用改版选择器失效时自动告警而非静默崩。
4. **文档收敛**：统一豆包 token 口径，消除 THEME_SPEC 与已发布主题的矛盾。

---

## 4. 各缺口方案草稿

> 本阶段只列**方向可选**，不拍板实现细节；触碰 schema/注入层的项标注【需 RFC】。

### 4.1 缺口 1 · 决策层自动化
- **离线**：`extract-asar-summary.mjs` 产出候选锚点（`data-testid`/`id`/`fragilitySeeds high`）。
- **运行时**：CDP `Runtime.evaluate` 验证锚点是否存在于 DOM → 按 `fragilitySeeds` 分级排序 → 引擎选 highest-stability 挂载 theme layer。
- 兼容性：保留现有手写静态选择器为 fallback，仅在锚点可用时升级。
- **难点**：性能（不能每帧探测，需缓存 + 慢变化重试）、与 session pool 复用。

#### 外部参考实现（CodeDrobe core PR#7 · Codex build 535 root landmark 漂移修复）

> 一手证据来源：[CodeDrobe/core PR#7](https://github.com/CodeDrobe/core/pull/7)（`gaopengbin`，2026-08-01，**仍 Open**）。真实发生的选择器漂移案例，模式可直接抄进缺口1。

**实证**（用 `codedrobe dom snapshot` 实测 Codex 新版 build 535）：
- `main.main-surface` 不再匹配（root landmark 变了 → `#root main`）；
- `aside.app-shell-left-panel`、`.composer-surface-chrome` 仍匹配（只有 root landmark 漂移）。

**他们的解法（缺口1 的落地模板）：**
```js
// codex.mjs —— rootAny 从"单选择器" → "首选 + 兜底"
rootAny: ["main.main-surface", "#root main"],
```

**配套回归测试（灵魂，防止退化回过度宽泛）：**
```js
assert.ok(!adapter.verification.rootAny.includes("main"));
assert.ok(!adapter.verification.rootAny.some((s) => s.includes('[role="main"]')));
```

**对本缺口1 的增量（评审依据）：**
1. **首选 landmark + 锚定 `#root` 的严格兜底 + 拒绝裸 `main`/`[role="main"]`**（会被 route 级 aux main 误命中）——正是我们手册 §5 的"稳定表面 + 不裸选"哲学，他们用**代码 + 回归测试**强制了。缺口1 应照此模式实现：`rootAny: [稳定首选, 严格兜底]` + 回归断言"不得出现过宽裸选择器"。
2. **`lastVerified` 版本元数据**（`win32: { appVersion, build, verifiedAt }`）——每次验证记录应用版本，就是**缺口3 版本漂移检测的种子**，可直接对齐。

> 社区通用兜底技巧（PR#7 评论区 `thc282`）：`main:is(.main-surface, [data-app-shell-main-surface], [class*="_MainContentSurface_"])` → fallback `main, [role="main"]`。

### 4.2 缺口 2 · 高定制多素材注入【需 RFC】
> 升级自旧"纹理一等支持"。目标是把主题从"单背景 + 调色"提升为"多素材汇编 + 面级布局 + 透明可动"。

**2a 多资产注入通道**
- 注入层由单条 `--agentskin-art` 升级为"素材组"，如 `--agentskin-asset-bg` / `--agentskin-asset-sidebar` / `--agentskin-asset-chat` 等多变量，每个一个 Blob URL，CSS 可按面引用。
- 决策点：以命名变量（`--agentskin-asset-*`）还是结构化清单（manifest 声明 `assets: [{id, file, anchor}]`）表达？后者更利于"素材绑面"，边走 RFC 定。

**2b 面级布局 / 定位语义**
- 引入"素材 + 锚点面 + 坐标 + 尺寸 + z-index"的声明式布局（manifest 或专用布局 schema）。
- 例：`{ asset: "pet.gif", anchor: "left.sidebar.top", pos:[8,8], size:[60,60], zIndex: 10 }`。
- 决策点：布局声明放 manifest（需扩 schema）还是放每端 agent CSS（用 `position`/固定钩子）？需权衡 schema 侵入 vs 灵活。

**2c 透明可动 overlay 运行时**
- 建立 overlay 运行时：SVG / GIF / 透明 PNG / 动画宠物在 DOM/Canvas/Video 覆盖层渲染，支持定位 + 可动 + `pointer-events:none` 不挡点击。
- 现状：无入口（`CDP_EXTRACT` 仍占位）；需新增 overlay 注入/生命周期/低性能降级。
- 决策点：资源是否沿用 Blob URL（避开 CSP）？低配设备是否自动隐藏 overlay？

> 关联：壁纸功能（`image-injector`/`video-injector`）属"单壁纸渲染"通道，与此处"主题包内多素材面级注入"是两套，需在实现时明确边界、避免通道冲突。

### 4.3 缺口 3 · 版本漂移检测【需 RFC】
- 扩展 `targets.<agent>.verification`：新增 `contexts.when`（命中条件）+ 复用 `required`/`recommended`。
- 引擎侧：应用改版后，`required` 探测失败 → 记录"版本漂移"状态 → 通知/降级，而非沿用失效 CSS。
- 兼容：旧包不填 `contexts` 时不触发，向后兼容。

#### 外部参考实现（CodeDrobe core · `lastVerified` 版本种子 + verification 预检）

> 一手证据来源：[CodeDrobe/core PR#7](https://github.com/CodeDrobe/core/pull/7) 的 `lastVerified` 元数据 + core README 的 verification 机制。这告诉我们缺口3 的**最小种子**和**运行时行为**该长什么样。

**CodeDrobe 的做法（缺口3 落地参考）：**
```js
// 每次验证通过后记录应用版本（版本漂移检测的种子）
lastVerified: {
  win32: { appVersion: "26.727.6591", build: "535", verifiedAt: "<ISO>" }
}
```

- **运行时验证而非仅声明**：inject 前 `probe`（预检 required/recommended）、inject 后 `verify`（复核注入），**失败即回滚**（可逆）。这与我们缺口3"告警/降级而非静默崩"目标一致，且更早：他们直接**失败回滚**。
- **漂移闭环 = lastVerified 比对**：当 `probe` 的 required 选择器命中但与 `lastVerified` 记录的应用版本不符 → 判定版本漂移 → 触发重新适配（对齐他们"改版后重读 DOM 重新生成"的 Skill 工作流）或告警。
- 对我们 schema 的含义：`contexts.when` 结构（命中条件）可与 `lastVerified.appVersion`/`build` 字段配合——前者做"当前版本是否适配"的结构化判断，后者记录"上次验证通过时的版本"，两者构成完整的漂移检测闭环。

### 4.4 缺口 4 · 文档收敛（零风险 P0）
- 统一口径：豆包实际用 `--dbx-*`（251-token 生态主导），`--semi-color-*` 为遗留。
- 把 `THEME_AUTHORING_GUIDE.md` 第 4/5 节（深度适配技法 + 六端速查表）merge 进 `THEME_SPEC.md`，消除文档源分裂。

---

## 5. 实施优先级矩阵

| 优先级 | 项 | 风险 | 价值 | 前置条件 |
|--------|----|------|------|---------|
| P0 | 缺口4 文档收敛 | 零 | 中（作者不被误导） | 无 |
| P0 | 缺口1 决策层自动化（第一阶段：CDP 验证锚点存在） | 中 | ⭐⭐⭐⭐⭐ | 采集层已具备 |
| P1 | 缺口2 高定制多素材（2a→2b→2c 递进） | 高（动注入层 + schema + 新 overlay 运行时） | ⭐⭐⭐⭐⭐ | 缺口1 + RFC 通过 |
| P1 | 缺口3 版本漂移检测 | 高（动 schema） | ⭐⭐⭐⭐ | RFC 通过 |

---

## 6. 验收标准（草案）

- 缺口1：选择器命中率提升可量化；应用改版后锚点失效能自动切换/告警。
- 缺口2：存在至少 1 套"背景 + 侧栏图 + 透明小人/动画宠物"多素材叠加主题通过全部制作流程；overlay 不挡点击。
- 缺口3：造一个失效场景，能产出"版本漂移"状态而非静默崩。
- 缺口4：`npm run check` 全绿，THEME_SPEC 与已发布 doubao.css 口径一致。

---

## 7. 风险与约束

- **架构**：缺口2（注入层 + schema + overlay 运行时）/缺口3（schema）触碰核心架构 → 必须先走 RFC（本文件即雏形）。
- **通道边界**：壁纸（单壁纸渲染）与主题包多素材注入须明确隔离，避免注入冲突。
- **性能**：缺口1 的运行时探测与缺口2c 的 overlay 需控制频率/资源，低配自动降级，避免注入抖动。
- **兼容**：所有改动需对旧主题包向后兼容（不填新字段则行为不变）。
- **版权**：参考主题美术涉 IP，只学结构禁打包（沿用 `THEME_AUTHORING_GUIDE` 底线）。

---

## 8. 待决策项（评审时拍板）

1. 缺口2a：多资产用命名变量（`--agentskin-asset-*`）还是结构化清单（manifest `assets`）？
2. 缺口2b：面级布局声明放 manifest（扩 schema）还是放每端 agent CSS（固定钩子 + `position`）？
3. 缺口2c：overlay 资源是否沿用 Blob URL（避 CSP）？低配是否自动隐藏？
4. 缺口1：第一阶段只做"CDP 验证锚点存在"还是直接上"自动选择"？
5. 缺口3：`contexts.when` 命名与语义是否对齐参考主题 CodeDrobe？
6. 立项后第一批（P0）先交缺口4 还是缺口1？

---

> 本文件是**雏形**，仅做规划与分析，未修改任何代码。下一步在评审通过后才进入 RFC 细化与实现。