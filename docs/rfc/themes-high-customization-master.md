# RFC · 高定制多素材主题——总方案（2a+2b+2c）

> 状态: **评审稿**（未实现）。
> 上游: `deep-adaptation-initiative.md` 缺口2（高定制多素材）。
> 子项: `themes-asset-injection-2a.md`（通道）、`themes-surface-layout-2b.md`（定位）。本文件为总纲 + 补足 2c（透明可动 overlay）并串联决策。
> 约束: `AGENTS.md`——改注入架构需 RFC；不动适配器、不新增 UI 页、不建服务端、依赖方向守 C4。

---

## 0. 一句话

把主题从"单背景 + 调色"提升为"**多素材汇编 + 面级定位 + 透明可动装饰**"，让高定制主题从"手工神作少数派"变成"可声明式产出的普通品"。三段各自实现通道、布局、运行时，**共用壁纸层的 `SurfaceRect`/`resolveSurfaceRects` 宿主坐标模型**，不重复造轮子。

---

## 1. 三段总览

| 段 | 交付 | 关键复用 | 子 RFC |
|----|------|---------|--------|
| **2a 多资产注入** | 素材从打包到运行时 `--agentskin-asset-<id>` | `bundle.assets.images` 既有校验 + `imageDataUrls` | `themes-asset-injection-2a.md`（已定稿） |
| **2b 面级定位** | "素材+锚点+坐标+尺寸"声明式布局 → overlay | `SurfaceRect`/`readSurfaceRect`/`resolveSurfaceRects` | `themes-surface-layout-2b.md`（已写） |
| **2c 透明可动 overlay** | overlay 运行时（透明/GIF动画/宠物，不挡点击） | 壁纸 host 坐标 + 新增 rAF/CSS 动画运行时 | 本文件 §3（补足） |

**数据流（端到端）**：
```
manifest.decorations
  → 2a: assets.images.<id> → Blob → --agentskin-asset-<id>
  → 2b: layouts[] → anchor rect → 宿主坐标 → overlay 静态位
  → 2c: overlay 内 <img>/GIF/SVG + motion 动画 → 可动的透明装饰层
```

---

## 2. 已定决策汇总（2a/2b）

| 决策 | 定值/方向 | 位置 |
|------|-----------|------|
| 素材承载 | 复用 `bundle.assets.images`，不另起结构 | 2a §2.1 ✅ |
| 数量上限 | `MAX_THEME_IMAGES = 32` | 2a §2.3 ✅ |
| GIF 准入 | `SAFE_IMAGE_TYPES` 已含 `image/gif`（动画小人 2a 即可） | 2a §2.3 ✅ |
| 累计体积 | 8MB base64（chunk 2MB/次兑底） | 2a §2.3.1 ✅ |
| 注入时机 | 全量 `transferImageSet`（按需留阶段三） | 2a §7 #2 ✅ |
| 布局声明位置 | manifest `decorations.layouts`（声明式、跨端统一） | 2b §7 #1 |
| 定位模型 | 五宫格 + offset（可预测） | 2b §7 #2 |
| rect 模型归属 | 抽 `shared/` 或 cdp 层（待定，涉及C4） | 2b §7 #3 |

---

## 3. 2c · 透明可动 overlay 运行时（本文件补足）

### 3.1 现状证据

- **无现成 overlay/动画运行时**：`grep` 确认 `page-visibility/rAF/@keyframes/animate/pet` 主要落在壁纸/场景(scene)管线下，主题装饰层没有。
- **已有可复用地基**：`SurfaceRect` 双表面模型、`resolveSurfaceRects`（宿主坐标）、`buildContinuationMountJs` 的 fixed+z-index+pointer-events:none 挂载模板。
- **场景层（`src/main/scene/`）存在**：`scene-renderer-html-scripts.ts` 等已有 HTML 渲染脚本，是 2c 动画运行时的现成借力点（非直接复用，需评估）。

### 3.2 范畴（含 / 不含）

**含**：
- 透明 PNG / GIF（动画）素材在 overlay 内渲染。
- 简单可动：`motion` 枚举（fade / float / breath + 可选 idle 摇摆）；CSS 动画优先，轻量 rAF 兜底。
- `pointer-events:none` 全程不挡点击；低配自动降级为静态图。
- 挂载/移除幂等，随主题切换清理。

**不含**（本段仍不做，属未来）：自由拖动、碰撞、宠物跟随光标、复杂交互动画。`motion` 只开放预置枚举。

### 3.3 设计

```
2c overlay 容器（复用 2b 的 host 坐标定位）
  ├─ <img src=--agentskin-asset-mascot>  透明/GIF 静态（无 motion 时）
  └─ motion 激活时：CSS @keyframes
       idle-fade → 周期透明度
       float     → 上下轻微漂移
       breath    → 缩放呼吸
  - visibility 降级：document.hidden 或低配 → 停动画/静态帧
```

### 3.4 与 2b 边界

- 2b 决定"放哪、多大"（定位），2c 决定"怎么动"（动画运行时）。
- 2b 的 `motion` 字段只是枚举占位，实际动画引擎在 2c 实现；两者共享 manifest 声明。

---

## 4. 三段依赖关系

```
2a ──前置──► 2b ──前置──► 2c
  通道          定位          运行时动画
```
- 2a 无依赖（独立可先落地）。
- 2b 依赖 2a 的 `assets.images`。
- 2c 依赖 2b 的 overlay 容器与定位。
- 三段共用：`SurfaceRect` 模型（需抽 `shared/`，守 C4）。

---

## 5. 总体实施顺位与验收

### 5.1 实施顺位（依赖驱动）

| 阶段 | 内容 | 对应 |
|------|------|------|
| P0-1 | 2a 通道：透传 `imageDataUrls` + 全量注入 + 门禁 + A线收包 | 2a 阶段一/二 |
| P0-2 | 2b 定位：rect 抽 shared + `decorations.layouts` + overlay 挂载 | 2b 阶段一/二 |
| P0-3 | 2c 动画：透明/GIF 渲染 + motion 预置动效 + 降级 | 2c 阶段一/二 |
| P2 | 按需注入、锚点漂移接入缺口1/3、复杂 motion | 各段阶段三 |

### 5.2 总体验收

1. 一个主题声明 `assets.images`(≥3) + `decorations.layouts`(多 anchor) + `motion` → 背景/侧栏/对话框多素材协调出现，透明小人/GIF 可动且不挡点击。
2. 多 surface 应用（WorkBuddy 多 target）：素材在宿主坐标下跨表面位置正确。
3. 锚点失效 → 该 layout 跳过 + 记漂移，整主题不崩；overlay 幂等清理。
4. 旧主题（无 decorations）→ 行为与现在完全一致；`npm run check` 全绿。

---

## 6. 各段风险/成本汇总

| 段 | 主要风险 | 成本量级 |
|----|---------|---------|
| 2a | Blob 传输耗时、体积膨胀 | 低（复用 chunk） |
| 2b | 锚点改版失效、跨表面坐标错 | 中（复用 rect 数学） |
| 2c | 动画性能、低配降级、与壁纸/场景冲突 | 高（新增运行时） |

**共同风险**：变更面广（manifest schema + 注入层 + 新增渲染运行时）→ 全部需走本 RFC；向后兼容是硬门禁。

---

## 7. 评审待决策（合并，未定项）

| # | 方向 | 倾向 | 归属 |
|---|------|------|------|
| 1 | rect 模型抽 `shared/` vs 留在 `wallpaper/`？ | 抽 `shared/` 或 cdp 层（复用面广、守C4） | 2b/2c |
| 2 | `motion` 初版开放哪几个枚举？ | `idle-fade`/`float`/`breath`，复杂留未来 | 2c |
| 3 | 动画引擎：纯 CSS keyframes vs 引入 rAF 调度？ | CSS 优先，rAF 兜底/降级 | 2c |
| 4 | 是否借力 `scene/` 渲染脚本？ | 仅评估，不默认复用 | 2c |
| 5 | 8MB 累计体积 × 32 上限是否够典型高定制？ | 够，放大器走 chunk | 2a(已定) |
| 6 | 三段是否分批实施 vs 一次性整体上？ | 分批（2a→2b→2c）低风险 | 总体 |

---

## 8. 审批门

- 依赖方向 C4 ✓（rect 抽 shared 后验证）。
- 素材路径安全 ✓（`resolveWithin`）。
- 向后兼容 ✓（旧主题不动）。
- `npm run check` 全绿后才允许实现落库。

---

> 总方案为评审稿。若批准，按 §5.1 顺位分阶段实现；每段拆分为独立 PR，逐段回归，避免一次性大变更。未批前不改代码。