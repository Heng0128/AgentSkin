# RFC · AgentSkin 面级布局 / 坐标定位（2b）

> 状态: **细则草案**（未实现）
> 上游: `deep-adaptation-initiative.md` 缺口 2b（面级布局/定位语义）
> 关联: `themes-asset-injection-2a.md`（asset 通道，先于本 RFC 落地）
> 约束: `AGENTS.md`——改注入架构需 RFC；不动适配器数量、不新增 UI 页、不建服务端
> 结论速览: 壁纸层的 `SurfaceRect`/`readSurfaceRect`/宿主坐标矩形定位地基**已存在**，2b 复用而不重造。核心是定义"素材 → 面(anchors) → 坐标 → 尺寸"的声明式布局。

---

## 0. 决策背景

2a 打通了"一张素材 → 一个 `--agentskin-asset-<id>` Blob 变量"。但素材拿到 `<html>` 上后，要放到"侧栏左上角 60×60""对话框下方"这些具体位置，2a 不做——这正是 2b 的范畴：**面级布局/坐标定位**。

定位难题在于目标应用是**多渲染表面**架构（vscode-work 系多 webview、doubao boot+主窗、WorkBuddy 多 target），每个 surface 有独立视口坐标系，跨文档无法直接比较 `getBoundingClientRect`。这个问题**壁纸层已经解过了**。

### 已核实现状（证据）

| 能力 | 现状 | 位置 |
|------|------|------|
| 宿主坐标矩形模型 | `SurfaceRect {x,y,width,height}` 已定义 | [injector-types.ts](file:///c:/Users/snowb/Desktop/work/desktop-main/src/main/wallpaper/injector-types.ts) |
| CDP 读 rect | `readSurfaceRect(session, selector)` 经 CDP 读取元素 rect | [unified-background.ts](file:///c:/Users/snowb/Desktop/work/desktop-main/src/main/wallpaper/unified-background.ts#L159-L177) |
| 跨文档坐标换算 | `computeContinuationLayout` 用宿主窗口矩形算副表面偏移 | [unified-background.ts](file:///c:/Users/snowb/Desktop/work/desktop-main/src/main/wallpaper/unified-background.ts#L80-L90) |
| 轻量覆盖层 | `buildContinuationMountJs`：`position:fixed` + `left/top/width/height/z-index:-2;pointer-events:none` | [unified-background.ts](file:///c:/Users/snowb/Desktop/work/desktop-main/src/main/wallpaper/unified-background.ts#L113-L139) |
| 调用方提供宿主边界 | `WallpaperInjectorDeps.resolveSurfaceRects` 契约 | [injector-types.ts](file:///c:/Users/snowb/Desktop/work/desktop-main/src/main/wallpaper/injector-types.ts#L132) |

> **关键复用结论**：2b 的数学（宿主坐标换算）、读取（CDP rect）、覆盖层模板（fixed + z-index + pointer-events:none）**都不必重写**，直接把壁纸的 `SurfaceRect` 模型与挂载/移除 JS 抽象成主题素材通用能力即可。

---

## 1. 目标（S.M.A.R.T.）

1. 声明式表达"素材 + 锚点面 + 坐标/对齐 + 尺寸 + z-index + 可动"，让主题作者**不写 JS** 也能布局多素材。
2. 复用 `SurfaceRect` 宿主坐标模型，正确跨 surface 定位（不用 CDP 文档内 rect 直接比较）。
3. 覆盖层 `pointer-events:none`，不挡点击；可整体开关、可低配降级。
4. 向后兼容：无布局声明的主题行为不变。
5. 与壁纸通道**隔离**：壁纸 `continuation` 是"背景共享连续性"，2b 是"主题装饰素材定位"，共用底层 rect 模型但各自挂载，不混用 ID。

---

## 2. 方案设计

### 2.1 概念模型：装饰面（anchor）→ 表面（surface）→ 布局声明

```
主题包 declares:   decorations.layouts[]
每个 layout:       asset id + anchor(挂到哪个面) + box(坐标/尺寸) + zIndex + motion
运行时 resolve:    anchor 选择器当前在 DOM 命中 → 取该元素 rect
                   （宿主坐标：主 surface 用 CDP rect，副 surface 用 resolveSurfaceRects）
注入产物:          overlay div { position:fixed; left/top; width/height; z-index; pointer-events:none }
```

**锚点分级**（复用脆弱性思路，见 `deep-adaptation-initiative.md` 缺口1）：
- `anchor` 用目标应用**稳定语义选择器**（复用第 5 节速查表的稳定表面：`.conversation-sidebar`、`aside.app-shell-left-panel` 等）。
- 锚点失效 → 该 layout 静默跳过（不阻塞整主题），并记录"漂移"，喂给缺口3 的告警。

### 2.2 manifest 声明（`decorations.layouts`）

对齐 2a 的 `assets.images` 与既有 `SurfaceRect`：

```jsonc
{
  "decorations": {
    "layouts": [
      {
        "asset": "mascot",                 // 引用 2a 的 assets.images.<id>
        "anchor": ".conversation-sidebar", // 稳定表面选择器
        "anchorPosition": "topRight",      // 相对锚点面：top/center/bottom × left/center/right（缺省在右下）
        "offset": { "x": 16, "y": 16 },    // 相对锚点位置的像素偏移
        "width": null, "height": 60,       // 覆盖层尺寸；null=auto（等宽可省略其一）
        "zIndex": 10,                      // 覆盖层层级（默认 0）
        "motion": "idle-fade",             // 可选可动装饰（见 2.4；无则静态）
        "flash": false                     // 挂载闪烁/动画开关
      }
    ]
  }
}
```

> 对齐 `SurfaceRect`：`offset` + `anchorPosition` 一起决定 `left/top`；`width/height` 决定 `width/height`。全部换算为宿主坐标后写成 `position:fixed` 覆盖层——这正是 `buildContinuationMountJs` 的模式。

### 2.3 运行时流程

1. **解析 manifest**：读 `decorations.layouts`（2a 之后已能拿到 `assets.images` Blob）。
2. **解析锚点 rect**：
   - 主 surface：`readSurfaceRect(session, anchor)`（CDP，命中才继续）。
   - 副 surface：走 `resolveSurfaceRects`（宿主坐标）——复用壁纸契约。
   - 锚点未命中 → 跳过该 layout（防崩溃），记漂移。
3. **挂载覆盖层**：按锚点 rect + `anchorPosition`/`offset` 算出宿主坐标 → 生成 overlay div（`pointer-events:none` + 对应 z-index）。
4. **可动装饰**：若有 `motion`，在 overlay 内加 `<img>`/GIF/SVG + 动画（见 2.4，属 2c 轻量预置，本 RFC 只定义静态/预置动效）。
5. **清理**：切换主题/恢复时移除全部 overlay（幂等）。

### 2.4 与 2c 的边界（明确本 RFC 不含）

- ❌ 本 RFC **不做**运行时"自由拖动/碰撞/宠物行为/复杂 CSS 动画引擎"——那是 2c 的透明可动 overlay 运行时。
- ✅ 本 RFC 只做"静态定位 + 简单预置动效（fade/float/breath）"占位，`motion` 字段先留 `null`/已知枚举，复杂动效 2c 扩展。

### 2.5 外部参考实现（CodeDrobe PR#3 · caishen）

> 一手证据来源：[CodeDrobe/skills PR#3](https://github.com/CodeDrobe/skills/pull/3)（`ChannelerH`，2026-07-22，"Caishen Readable Codex theme example"，**未合并**）。公开源码，非 IP 素材，可作结构范本。这是"高定制主题怎么产"的**已开源可复制样例**，与 2a/2b 规划逐点对应。

**已验证实现的技法（对照本 RFC）：**

| caishen 写法 | 对应本 RFC / 2a | 可吸收点 |
|---|---|---|
| `:root.codedrobe-host-codex` 私有调色板 `--caishen-*` | 2b 锚点面 + 手册 §4.1 | 集中声明语义色，后文全引用 |
| `--color-token-*` 原生 token 覆写（bg/text/border/input/hover/link/focus） | 手册 §5 Codex 命名空间 | 覆写层与布局层解耦 |
| `body` `linear-gradient + var(--codedrobe-image-texture) repeat` 铺纹理 | **2b 纹理变量** | CodeDrobe **已有 `--codedrobe-image-texture` 一等纹理变量**，非仅 hero → 佐证 2a 立项"纹理缺位"判断正确 |
| `aside.app-shell-left-panel` / `main.main-surface` / `.composer-surface-chrome` 每表面精修 | 2b 锚点面 = 稳定表面 | 与 §5 稳定表面速查表一致 |
| `[role="main"]:has([data-testid="home-icon"])` 用 `--codedrobe-image-hero` 铺主视觉 | 2a hero 别名 + 2b 锚点 | **`:has()` 做"路由上下文"探测**——首页才铺主视觉，是缺口3 版本漂移的轻量替代 |
| `@media (prefers-reduced-motion: reduce)` 降级动画 | 2c 低配降级 | 手册未写，**应补进 2c 边界** |
| `@media (max-width: 820px)` 响应式折叠 | 2b 尺寸自适应 | 可吸收 |

**对本 RFC 的直接增量（评审依据）：**
1. **`--codedrobe-image-texture` 已存在** → 缺口2b 的"纹理+主视觉双图"在 CodeDrobe 已落地，AgentSkin 2a 应保留此方向（当前仅 `--agentskin-art` 单 hero，正是差距）。
2. **`:has()` 上下文探测**可作 `anchor` 的增强选择器（如 `[role="main"]:has([data-testid="home-icon"])`），让"同一素材只在特定路由/上下文出现"，补强 §2.1 锚点分级。

> ⚠️ 仅学结构，不复制其 CSS 本体（依赖 `--codedrobe-image-*` 变量与 `html.codedrobe-host-codex` 作用域，跨引擎不可复用）。

---

## 3. 边界（本 RFC 明确不做）

- ❌ 运行时透明可动 overlay 实体（属 2c）：本 RFC 只铺静态定位层，GIF 作为 2a 的静态 blob 引用。
- ❌ 壁纸通道改造：壁纸 continuation 保持"背景共享连续性"独立职责，仅**复用** rect 模型，不与装饰 overlay 共用 ID/容器。
- ❌ 新增适配器 / 新增 UI 页。
- ❌ 缺口1（自动选择器）与缺口3（漂移告警）的实现——本 RFC 只定义"锚点失效→跳过+记录"的钩子契约，供后续接入。

---

## 4. 验收标准

1. manifest 声明 1 个 `decorations.layouts` → 运行时叠加层出现在预期锚点面的指定位置，`pointer-events` 不挡点击。
2. 多 surface（如 WorkBuddy 多 target）：装饰层在宿主坐标下位置正确，跨表面不漂移（复用 `resolveSurfaceRects` 校验）。
3. 锚点选择器失效 → 该 layout 跳过，其余正常，主题不崩。
4. 切换/恢复主题 → overlay 幂等移除，无残留。
5. 无 `decorations` 的旧主题 → 行为与现在完全一致。
6. `npm run check` 全绿（含 check-themes / staleness 契约）。

---

## 5. 风险

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| 锚点选择器随应用改版失效 | 高 | 中 | 按 layout 独立跳过 + 记漂移（喂缺3） |
| 覆盖层挡住交互 | 中 | 高 | `pointer-events:none`（复用壁纸）+ 验收测试 1 |
| 跨表面坐标算错 | 中 | 高 | 复用 `resolveSurfaceRects`/`computeContinuationLayout`，不新写数学 |
| overlay 残留/泄漏 | 低 | 中 | 幂等 mount/remove JS（复用 continuation 模式） |
| 与壁纸 continuation 冲突 | 低 | 高 | 隔离 ID/容器；本 RFC 用独立 `decorations-*` 前缀 |

---

## 6. 依赖 / 前置

- **前置**：2a（multi-image 通道）先落地，本 RFC 引用其 `assets.images.<id>`。
- **复用**：`SurfaceRect`、`readSurfaceRect`、`resolveSurfaceRects`、`buildContinuationMountJs` 的挂载/移除模式。
- **待补**：壁纸的 rect 模型层目前在 `wallpaper/` 下，语义上属通用上层——需评估是否抽到 `shared/` 或 cdp 层，避免注入层反向依赖 wallpaper 模块（依赖方向守卫 C4）。

---

## 7. 评审待决策

| # | 待决策 | 倾向建议 |
|---|--------|---------|
| 1 | `decorations.layouts` 放 manifest（扩 schema）还是各端 agent CSS？ | manifest 声明（声明式、跨端统一）；CSS 只做 `--agentskin-decor-<id>` 的最终造型钩子 |
| 2 | `anchorPosition` 用五宫格枚举（top/center/bottom × left/center/right）还是像素 left/top？ | 五宫格 + `offset`（稳定、可预测），绝对像素留高级写法 |
| 3 | rect 模型抽离位置：`wallpaper/` 内复用 vs 抽 `shared/`？ | 抽 `shared/` 或 cdp 层（复用于 2b/2c/壁纸），但需处理 C4 依赖方向 |
| 4 | `motion` 静态枚举初版含哪几个？ | 仅 `idle-fade`/`float`，复杂动效留 2c |
| 5 | 锚点失效时：跳过 vs 阻塞？ | 按 layout 跳过（不阻塞整主题）+ 记漂移 |

---

## 8. 分阶段实施（评审通过后）

- **阶段一（P0）**：rect 模型复用（SurfaceRect/readSurfaceRect/resolveSurfaceRects）抽到共享层 + 依赖方向检查。
- **阶段二（P0）**：`decorations.layouts` schema 扩展 + 运行时锚点解析 + 静态 overlay 挂载/移除 + 幂等清理。
- **阶段三（P2）**：锚点漂移钩子接入缺口1/3；`motion` 预置动效；多 surface 坐标回归。

---

> 本 RFC 是细则草案，未实现。2b 的核心判断：**定位数学与覆盖层模板都有成熟地基（壁纸层），2b 是"语义化 + 声明式 + 复用"，不是从零发明渲染器。**