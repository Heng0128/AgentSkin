# AgentSkin 成熟化方案 v2（整合版）

> 版本: 2.0.0
> 日期: 2026-08-04
> 状态: 待评审（整合自 v1.0.0，新增"原生档案与透明化治理"中轴工程）

---

## 0. 总览

### 0.1 定位与竞品

AgentSkin 是目前唯一的跨 agent 统一主题平台（traework / qoderwork / workbuddy / doubao / codex / zcode 六引擎），并独有 Wallpaper Engine 识别与导入能力。竞品（Codex-Dream-Skin 13.1k★ 等）均为单应用 + 预设调色板路线，且依赖在线 Studio/Gallery。

本方案不引入任何需后端/证书的能力，不引入桌宠等噱头，全部本地完成。

### 0.2 主矛盾

当前主题注入与壁纸透明化"总有不达人意"，根因是四个层层递进的问题：

1. **说不清**——一个元素到底"不应渲染 / 该透明化 / 该保持原样"，全靠手写类名选择器猜，没有客观依据。
2. **无参照**——透明化后的渲染状态是 AgentSkin 凭空造的，原生 app 从不渲染透明版，出了问题没有地面真相可比对，"不好描述、更不好修改"。
3. **识别会错**——现有识别既过度（误报→把该渲染的内容打穿消失）又漏检（漏报→不该渲染的不透明层残留挡壁纸），两个方向的错叠加导致最终效果难看。
4. **错了没法修**——识别与处置写死在 CSS 里，错了静默错着，看不到是哪个元素误判，也无法单独纠正，重启后依旧错。

### 0.3 解法：五步闭环（治理中轴）

把"猜 + 盲调"升级为工程化闭环：

```
探针量化（测得准）
   ↓
处置分类（判处置：移除 / 透明化 / 保持原样）
   ↓
变换台账（每步变换命名 + 参数 + 可独立开关，作为缺失的参照物）
   ↓
可视化审查（看得见每个判定与对错）
   ↓
人工纠错并持久化（白/黑名单 + 阈值，重启不丢，精确率/召回率可查）
   ↓（回灌）
注入引擎（台账驱动生成打穿/毛玻璃 CSS）＋ 主题创作（原生档案当参考轨）
```

本方案由**一个中轴工程 + 三条支撑线**构成：

| 工程 | 内容 | 与 v1 关系 |
|------|------|-----------|
| **中轴：原生档案与透明化治理** | 五步闭环全链路 | v2 新增，原 Sprint D，升级为核心 |
| 支撑线 A：规范统一 | schema 强制校验、文档对齐 | v1 Sprint A |
| 支撑线 B：CDP 成熟化 | 事件监听、新 target、重试、watchdog | v1 Sprint B（B1 并入中轴） |
| 支撑线 C：原创主题产能 | 图片→主题、Studio 闭环、首批主题 | v1 Sprint C |

---

## 1. 现状盘点（源码验证，2026-08-04）

### 1.1 问题清单

| 编号 | 级别 | 问题 | 位置 / 证据 |
|------|------|------|-------------|
| P0-1 | P0 | 透明度正则错误，半透明背景全误判为不透明遮挡层，健康分不可信——它正是中轴分类器的种子逻辑，必须先修 | `src/main/theme-health-check.ts:159` `/[d.]+(?=s*)$/`；该文件零测试 |
| GOV-1 | P1 | 处置判定全靠硬编码类名选择器，agent 改名即失效，且无精确率/召回率保障 | `src/main/cdp/snapshot-theme.ts:88` `LANDMARK_SELECTORS` |
| GOV-2 | P1 | 透明化状态无原生参照，变换无记录，无法描述、无法单独修改 | 无台账机制；`image-injector.ts:117` scrim 叠加靠 querySelectorAll 去重兜底 |
| GOV-3 | P1 | 过度识别/漏识别无发现与纠正途径，错了静默错着 | 无白/黑名单、无持久化纠错 |
| GOV-4 | P0 | 壁纸透明化无文字可读性保护：punch-through 只按几何尺寸（宽高≥50% 或面积≥10%）打**全透明**，中央对话面板必然命中，底色被抽掉后文字颜色失去依托，壁纸/scrim 从底下透出把文字吞掉。判定不含"是否承载文字"维度，且只有全透明一种手段、无毛玻璃档——直接违反既有偏好"卡片背景可透明但内部文本须保可读（surface 65% + blur）" | `src/main/cdp/wallpaper/shared.ts:691-703`（`background-color:transparent`，无内容判定、无 frosted 选项） |
| SPEC-1 | P1 | 三份规范文档互斥：`themes/THEME_SPEC.md` 的 `_shared/@import` 机制不存在（实际由 `generate-theme-css.mjs` 产字面量）；`docs/THEME-ECOSYSTEM-OPTIMIZATION.md` 包名 `.agenttheme` ≠ 实际 `.agentskin-theme` | 三处文件比对 |
| SPEC-2 | P1 | `docs/manifest-v2.schema.json` 字段完整但零代码引用，无强制力；loader 手写校验构成双真相源 | 全项目 grep 零命中 |
| SPEC-3 | P1 | `validateTarget` 不校验 targetKey ∈ 已知 agent，拼错静默通过 | `theme-package-loader.ts:67-82` |
| SPEC-4 | P2 | THEME_SPEC 只记 4 agent，实际 6 引擎 | `engines/` |
| THEME-1 | P1 | 内置主题仅 naruto-tobi，且为动漫 IP 同人，分发有风险 | `themes/` |
| THEME-2 | P2 | Studio 基建在（studio-ipc / RealDomPreview / Toolbox）但未形成产能闭环 | `theme-workbench/out` 为空 |
| CDP-1 | P1 | 无 `setDiscoverTargets`，apply 后新窗口/webview 不自动上主题 | grep 零命中 |
| CDP-2 | P2 | 单 target 注入失败无重试 | `cdp-fanout.ts:290-298` |
| CDP-3 | P2 | 健康检查仅 apply 时跑一次，无周期 watchdog 与实时状态 | `hardeningPass` |
| CDP-4 | P2 | `cdp-client.ts` onmessage 丢弃无 waiter 事件，是 CDP-1 前置缺口 | `cdp-client.ts:95-113` |
| CDP-5 | 待复核 | 壁纸注入成功判定疑似 OR 语义（失败报成功），需复核现状 | `diagnosis_report.md` vs `wallpaper-injector.ts` |

### 1.2 可复用存量

探针侧：`snapshotThemeVisuals`（landmark 样式 + matchedRules 级联 + 平台字体 + 盒模型 + 伪类 + light/dark 变体 + 完整 domTree）、`snapshotBaseline`（原生未主题化抓取）、`node-cascade`（DevTools 级联）、health-check 的 opaque layer walk（分类器种子）。

Studio 侧：`RealDomPreview`（真实 DOM 回放 + 按角色重绑色）、`Toolbox`（8 维微调 + 粗色桶）、`studio-ipc`（snapshot/baseline/export/inspect）。

注入侧：两阶段就绪、全 DOM target fan-out + epoch、addScriptToEvaluateOnNewDocument 持久化、adoptedStyleSheets 加固、scheme 快照还原（P0-2 已修）。

主题侧：`generate-theme-css.mjs`（colors→6 agent CSS）、`build-theme-package.mjs`（导出 `.agentskin-theme`）、`@agentskin/engine` 已声明 `captureScreenshot`。

---

## 2. 中轴工程：原生档案与透明化治理

目标：把注入/透明化从"猜 + 盲调"变成"测→判→记→审→纠"的工程闭环。五个阶段对应五步闭环。

### 阶段 1 — 探针量化：AgentNativeProfile 数据模型

扩展现有 snapshot 基建，把"抓完即弃"的快照提炼为**持久化原生档案**，按 agent + appVersion 存档（`profiles/<agentId>/<appVersion>.json`），版本键用于后续漂移检测。

```
AgentNativeProfile {
  meta:      { agentId, appVersion, capturedAt, scheme, viewport }
  tokens:    { [tokenName]: { value, declaredOn, computedOn } }     // 原生设计 token 全表（按 agent 命名空间）
  components: [ {                                                     // 组件档案（按可识别区域/landmark）
      role: 'backdrop'|'sidebar'|'chatlist'|'message'|'composer'|'codeblock'|'button'|'scrollbar'|...,
      ref, boxModel, depth, area, areaRatio,
      quantified: { background, bgAlpha, color, border, radius, blur, shadow, font },
      hasText, hasInteractiveDescendant, descendantCount, zIndex
  } ]
  palette: {                                                          // 量化色板（归类后的颜色清单）
    backgrounds: [ {color, luminance, usage, role} ],                // 按亮度排成层级阶梯
    texts:       [ {color, luminance, contrastToBg, usage} ],
    accents:     [ {color, saturation, usage} ],
    borders:     [ ... ]
  }
  metrics: {                                                          // 量化指标
    elevationLadder: [ {level, color, deltaLuminance} ],
    contrastPairs:   [ {fg, bg, wcagRatio, pass} ],
    radiusScale, spacingScale, blurValues, shadowTokens
  }
}
```

- 复用 `snapshotBaseline` 抓原生（未注入）状态；tokens 用 `getComputedStyle(root).getPropertyValue` 全量枚举各命名空间（`--color-*`/`--vscode-*`/`--cb-*`/`--semi-color-*`）。
- 量化算法纯 TS（亮度/对比度/聚类），零新依赖；图像解码运行时用 Electron `nativeImage`（sharp 仅 devDep）。
- 交付物：`src/main/profile/native-profile.ts`（+test）。

### 阶段 2 — 处置分类器：属性驱动 + 文字可读性保护

新增 `src/main/profile/treatment-classifier.ts`（+test）。遍历 domTree，对每个元素输出**处置 + 依据**（而非只给结论）。相比现有 punch-through（`shared.ts:691`，只看几何尺寸打全透明），分类器**增加"是否承载文字"维度**，并把"透明化"拆成两档，直接修复 GOV-4：

| 处置 | 含义 | 量化判据（全部属性驱动，不依赖类名） |
|------|------|-------------------------------------|
| **移除** | 不应渲染，打掉 | areaRatio ≥ 0.8、不透明底色或自带 bg-image、无文本/可交互后代、层级最深（app 自带背景/品牌层） |
| **全透明** | 背景直接打掉 | 面积达标、有底色、**且不含可读文本**（纯布局壳/背景层） |
| **毛玻璃** | 半透明 surface + blur 透壁纸 | 面积达标、有底色、**且承载可读文本/控件**（侧栏/面板/卡片/**中央对话区**）——保文字可读 |
| **保持原样** | 不动 | 小面积、纯文本/可交互叶子（input/button/a）、前景色、代码块、阴影/badge；已有 backdrop-filter 的视为保持 |

**文字可读性保护（核心约束，GOV-4 的解）**——凡判据命中"承载文本"，一律不得全透明，改为毛玻璃并满足：

- `hasTextContent` 判定：子树内可见文本节点数量/文本密度超阈值，或含 input/可编辑区。
- 毛玻璃参数取既有偏好基线：surface 不透明度约 65% + `backdrop-filter: blur(20px)`，保证"背景画隐约可见 + 靠模糊保可读"。
- 文字对比度守门：毛玻璃后文字与有效背景（壁纸经 surface+blur 合成）的 WCAG 对比度需达标；不达标则自动加深 surface 不透明度，直至达标。
- 禁止把 punch-through 的全透明施加到任何含文本容器；现有 `shared.ts` 的几何阈值逻辑由分类器判定取代（几何只作初筛，内容判定作终裁）。

其余规则：

- 规则为**阈值驱动打分**，输出 `{ treatment, confidence, evidence:{测量值, hasTextContent} }`，evidence 供阶段 4 展示、阶段 5 调阈值。
- 明确输出精确率/召回率视角：误报→内容消失、漏报→遮挡残留（见阶段 5）。
- 取代 `LANDMARK_SELECTORS` 在处置判定中的角色（landmark 仍可用于 role 命名辅助）。

### 阶段 3 — 变换台账：缺失参照物的实体化

新增 `src/main/profile/transform-ledger.ts`（+test）。凡 AgentSkin 改变某元素渲染（打穿/加 wash/scrim/毛玻璃/移除），记一条台账：

```
LedgerEntry {
  id, targetRef,                                   // 稳定元素引用（结构路径 + 属性指纹，不依赖类名）
  action: 'remove'|'transparentize'|'frost'|'wash'|'scrim'|'keep',
  params: { opacity?, blurPx?, washColor?, washStrength?, ... },
  source: 'auto'|'manual-add'|'manual-override',
  enabled: boolean,                                // 单条可开关（待决策项，见 §7）
  baseline: { 原生渲染值 },
  after:    { 注入后渲染值 }
}
```

- 台账按 agent +（主题/壁纸）持久化，`profiles/<agentId>/ledger.json`。
- **台账就是缺失的地面真相**：透明主题从"说不清的视觉效果"变成"一组可命名、可量化、可单独回退的变换"。

### 阶段 4 — 可视化审查：Studio 面板

在 Theme Studio 新增（全中文界面，复用现有 `ThemeStudioPage` / `Toolbox` 骨架）：

| 面板 | 内容 |
|------|------|
| 色彩清单 | 色板按角色分组、亮度排序、使用频次、点击复制 |
| 层级阶梯 | bg→surface→elevated 实测差值可视化 |
| 组件档案 | 各组件量化样式表（圆角/间距/模糊/阴影刻度） |
| 对比度仪表 | 前景/背景 WCAG 比值与达标标注 |
| 处置审查 | 元素列表：处置 + evidence；可按处置筛选；高亮疑似错误（仍不透明的遮挡层 / 被标记移除却含内容的元素） |
| 原生↔注入 diff | 原生渲染 vs 注入后渲染 并排/叠加，台账条目作为标注 |
| 版本 diff | 两个 appVersion 档案对比 → token 改名/值变化检测（agent 升级漂移检测） |

### 阶段 5 — 人工纠错与持久化

新增 `profiles/<agentId>/overrides.json` + 对应 UI：

- 白名单/黑名单：把漏报元素手动补进处置集、把误报元素剔除。
- 单条台账开关/回退（若 §7 决策通过）。
- 阈值滑杆 + 实时预览调参。
- 全部纠正持久化，重启不丢；展示过度识别/漏识别计数，精确率/召回率可查。

### 回灌 — 一份数据喂两头

- **喂注入**：处置 + 台账 → 生成打穿/毛玻璃 CSS，替换引擎 cosmetic.css 中硬编码的透明化部分。处置决策从"写死"变"测出来 + 审过"。
- **喂创作**：原生档案作为 Studio 参考轨（改 surface 时看到原生层级差与对比度基线）；一键"生成还原主题"（manifest + CSS 复刻原生外观）——既是创作起点，又是注入保真度验证（还原主题应用后应与原生肉眼无差）。

### 中轴验收标准

1. 对任一 agent 抓出完整原生档案，色彩/层级/组件/对比度四面板数据正确。
2. 分类器对一个已知壁纸场景输出四档处置（移除/全透明/毛玻璃/保持），evidence 含 hasTextContent 且可读；人工能定位并纠正一处误报与一处漏报，纠正持久化后重启仍生效。
3. 台账每条变换可命名、可看参数；（若启用单条开关）可单独关闭一条并看到渲染回退。
4. 版本 diff 能检出一次模拟的 token 改名。
5. **GOV-4 回归**：壁纸激活时，承载文字的中央对话区不被全透明，改施毛玻璃；其内文字与有效背景对比度达标、肉眼可读，壁纸仍隐约可见。

---

## 3. 支撑线 A：规范统一（2~3 天）

| 项 | 内容 |
|----|------|
| A1 | schema 权威副本移入 `src/main/catalog/manifest-v2.schema.json`（可打包 import），`docs/` 留镜像 + vitest 断言逐字节一致；targets 键扩为 6 agent |
| A2 | 新增 `manifest-validator.ts`：零依赖 JSON Schema draft-07 子集解释器（type/required/properties/additionalProperties/enum/const/pattern/minLength/maxLength/items），加载权威 schema 驱动，接入 `ThemePackageLoader.load()`；附加跨字段校验（supportedAgents ⊇ targets 键、targetKey ∈ agent 集合，修 SPEC-3） |
| A3 | 新增 `scripts/check-themes.mjs`：schema 校验 + 14 变量齐全 + color-scheme 与 mode 一致；接入 husky（themes/** 变更触发） |
| A4 | 重写 `themes/THEME_SPEC.md`：6 agent、删 `_shared/@import`（不存在）、改为实际流程（colors→generate-theme-css→check）、包名统一 `.agentskin-theme`；`docs/THEME-ECOSYSTEM-OPTIMIZATION.md` 加废弃标注 |

验收：非法 manifest（缺 colors.background / 未知 targetKey / supportedAgents 缺项）被硬拒绝且含 JSON path；naruto-tobi 通过；schema 双副本一致。

---

## 4. 支撑线 B：CDP 成熟化（4~5 天）

| 项 | 内容 |
|----|------|
| B1 | **已并入中轴阶段前置**：修 `theme-health-check.ts:159` 正则 + 新增 `theme-health-check.test.ts`（opaque walk 是分类器种子，必须先修对） |
| B2 | `cdp-client.ts` 增加 `onEvent` 订阅（补 CDP-4），单测覆盖事件分发/交错/close |
| B3 | 新增 `cdp-watcher.ts`：browser 级 `/json/version` → `Target.setDiscoverTargets`，新 page/webview/iframe 自动注入（复用抽取出的 `injectSingleDomTarget`），去重 + 退避重连 + epoch 守卫；端点不可用则降级现状 |
| B4 | `hardeningPass`/`injectSecondaryTargets` connect+evaluate 限次重试（2 次，500/1500ms），仅连接/超时类重试；记录连续失败计数 |
| B5 | 新增 `theme-watchdog.ts`：60s 轻量探针（hostClass + adapter marker + sheet 存在），失败自愈（≤3 次/小时），状态经 IPC 实时推 UI；同 Sprint 内复核 CDP-5（壁纸 OR 语义），若仍在则改严格判定（渲染保持 Fill=cover，不引入 contain） |

验收：新窗口 10s 内自动上主题；杀进程重启后 watchdog 下周期自愈且 UI 实时反映；半透明不再计入 blocking。

---

## 5. 支撑线 C：原创主题产能（4~6 天 + 持续）

| 项 | 内容 |
|----|------|
| C1 | 新增 `theme-from-image.ts`：任意图（用户自有/AI 原创）→ nativeImage 解码降采样 → median-cut 提 accent + 亮度直方图定 mode/bg → 派生 14 token（守 THEME_SPEC 亮度契约）→ artParams → 产出 `themes/<id>/` → 调 `generate-theme-css.mjs` 生成 6 CSS → hero 落 JPEG → 自动跑 A3 校验。颜色工具抽为 `scripts/color-utils.mjs` 共享 |
| C2 | 真实预览：复用 `studio-ipc` snapshot 链路 + `captureScreenshot` 截真实 agent 界面存 preview.png；agent 未运行回退 hero+色板拼合；icon 程序化绘制；禁占位图入库 |
| C3 | 打通 Studio 调参闭环：UI→studio-ipc，8 维微调 + 草稿 CSS 经 CDP 实时预览，确认后 `studio:export` 产出 `.agentskin-theme`，自动过 A2 校验 |
| C4 | 首批内置主题：AI 生成原创 hero（人工逐张确认无 IP 元素）→ C1 流水线 → 微调，目标 8~12 个覆盖暗/亮/动漫/极简；naruto-tobi 移入 `examples/` 标注"同人不可再分发"或移除（待决策） |

验收：任意图进→合规目录出→应用视觉一致；全程本地无网络。

---

## 6. 执行顺序与依赖

```
B1(P0修复, 中轴种子) ─┬─→ 中轴阶段1(档案) → 阶段2(分类) → 阶段3(台账) → 阶段4(可视化) → 阶段5(纠错) ─→ 回灌注入/创作
                      │
A1→A2→A3→A4(规范) ────┴─→ C1(依赖A schema) → C2 → C4；C3 可后插
B2→B3→B4→B5(CDP 成熟化) 可并行推进
```

建议波次：

1. **波次一（地基）**：B1 + A1~A4 —— 健康分修对、规范有强制力。
2. **波次二（中轴成形）**：中轴阶段 1→2→3 —— 档案 + 分类 + 台账，先让透明化"可描述"。
3. **波次三（闭环）**：中轴阶段 4→5 + 回灌注入 —— 可视化审查 + 纠错持久化，真正解决"难修改"。
4. **波次四（并行）**：CDP B2~B5。
5. **波次五（产能）**：C1→C2→C4，C3 适时插入。

---

## 7. 待决策项

| # | 决策 | 建议 |
|---|------|------|
| 1 | 台账是否做到**每条规则可单独开关/回退** | 建议要（"好修改"的落点），代价是规则存储结构复杂些 |
| 2 | 分类结果用途：**(a)** 仅人工参考、CSS 手动确认入库；**(b)** 运行时自动生成注入 CSS | 建议先 (a) 后 (b) |
| 3 | naruto-tobi 处置 | 建议移出内置 seed 到 examples 并标注 |
| 4 | schema 校验灰度：直接硬拒绝 vs 先告警一版 | 建议先告警 |
| 5 | C4 首批主题数量与配比 | 建议 8 个：4 暗 / 2 亮 / 2 风格化 |

---

## 8. 风险评估

| 风险 | 级别 | 缓解 |
|------|------|------|
| 分类器阈值初始不准（过度/漏识别） | 高 | 阶段 5 纠错闭环兜底；先 (a) 人工确认后入库；阈值可迭代 |
| 台账 targetRef 在 agent 更新后失配 | 高 | 引用用结构路径+属性指纹而非类名；失配时降级为重新分类并提示 |
| schema 强制校验误伤存量/第三方主题 | 中 | 先告警灰度一版再硬拒绝 |
| browser 级 CDP 端点个别 agent 不暴露 | 中 | watcher 降级现状，不回归 |
| 自动提取调色板观感不佳 | 中 | C1 产出定位草稿，C3 人工微调兜底 |
| AI 生成 hero 混入 IP 元素 | 中 | 人工逐张审核 + prompt 约束 |
| watchdog 自愈与手动操作竞争 | 中 | 受 epoch + busyMutex 约束，UI 提示自愈事件 |

---

## 9. 修改文件清单（汇总）

**新增**：`src/main/profile/native-profile.ts`、`treatment-classifier.ts`、`transform-ledger.ts`（各+test）；`src/main/catalog/manifest-v2.schema.json`、`manifest-validator.ts`（+test）；`src/main/cdp/cdp-watcher.ts`（+test）；`src/main/theme/theme-from-image.ts`（+test）、`theme-watchdog.ts`（+test）；`src/main/theme-health-check.test.ts`；`scripts/check-themes.mjs`、`color-utils.mjs`；Studio 新面板组件。

**修改**：`theme-health-check.ts`（:159）；`cdp-client.ts`（onEvent）；`cdp-fanout.ts`（抽 injectSingleDomTarget + 重试）；`theme-package-loader.ts`（schema 接入）；`agent-engine-service.ts`（watcher/watchdog/台账回灌挂接）；`snapshot-theme.ts`（处置判定去硬编码化）；`wallpaper-injector.ts`（CDP-5 视复核结果）；`themes/THEME_SPEC.md` 重写；`package.json`/husky。

**删除**：无（向后兼容；naruto-tobi 移位不删）。

我先看一下现在 wash/scrim 这些覆盖层和文字内容的层级关系是怎么处理的，确认病根再加进方案。查看 8 个步骤看懂了，而且我在代码里定位到了病根。这条不是新问题，是透明化治理里一个一直缺失的维度，我先把机制说清楚。shared.ts:691-703 的 punch-through 逻辑是这样的：它只按几何尺寸决定打不打透明——宽和高都 ≥50% 视口、或面积 ≥10% 视口的元素，只要背景不透明，就直接 background-color: transparent 全透明打掉。中间那个对话面板恰好是大元素，必然命中，于是它的底色被整个抽掉。问题来了：面板里文字的颜色，是按"原来那块不透明底色"配的。底色一被抽掉，壁纸和 scrim 就从文字底下透出来，视觉上把文字吞掉了——这就是你说的"文字被透明化盖过去"。两个根因，正好补上方案里缺的东西：
透明化判定只看几何，不看内容——它从不问"这个元素里有没有需要可读背景的文字"。
只有"全透明"一种手段——没有毛玻璃档位。而你 USER 偏好里早就写了原则：按钮/卡片背景透明可以，但内部文本框/子元素必须保留可读性（surface 65% + blur）。现在的 punch-through 恰恰违反了这条。
所以这条要作为治理中轴的一条硬约束加进去。我把它落进方案。查看 4 个步骤现在把阶段 2 分类器的处置表升级，加入"承载文字"维度和毛玻璃档。查看 6 个步骤再更新验收标准，把"对话区文字可读"加进硬验收。
