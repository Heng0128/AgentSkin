# WorkBuddy `--cb-*` Token 系统参考

> 2026-08-30 | 基于 cdredfox/workbuddy-skin-studio (169 stars) 及 AgentSkin 工程实践整理  
> 关联文档：`docs/apps/workbuddy/ADAPTATION.md`、`docs/reports/workbuddy-skin-ecosystem-research-2026-08-29.md`

---

## 1. 背景

WorkBuddy 是腾讯的 Electron AI 聊天应用（月活 1115 万），基于 VS Code 架构。其 UI 由**三层 token 体系**驱动：

| 命名空间 | 角色 | 数量（实测） |
|----------|------|-------------|
| `--cb-*` | WorkBuddy 封装层（聊天面板/团队卡片/自绘组件） | 466 |
| `--vscode-*` | VS Code 工作台层（editor/sidebar/tab/panel） | 867 |
| `--sc-ui-*` | 独立组件库层 | 24+ |

社区换肤项目 cdredfox/workbuddy-skin-studio（169 stars，Star 数最高）仅通过覆盖 `--cb-*` 层即可实现"感知完整"的主题效果。其极简主题格式（4 色 + 1 张 hero 图）通过明度阈值自动判定深浅色模式，核心判定逻辑为：

```
surface 明度 > 140 → light 模式
surface ≤ 140 → dark 模式
```

并切换 `data-vscode-theme-kind` 属性，让 VS Code 原生控件跟随变化。

**本文聚焦 `--cb-*` 这一层**，记录 AgentSkin 的 14-token 系统如何通过它实现完整覆盖。

---

## 2. AgentSkin 14-token 底座

AgentSkin 的主题契约定义了 14 个语义 token（`THEME_SPEC.md`  §C2），在 WorkBuddy 适配器中先映射到一组中间变量 `--wb-*`，再由 `--wb-*` 派生全部 `--cb-*`：

| AgentSkin Token | 中间变量 | 语义角色 | 用途 |
|-----------------|----------|----------|------|
| `--agentskin-accent` | `--wb-accent` | accent | 主强调色（品牌色、链接、按钮） |
| `--agentskin-secondary` | `--wb-secondary` | accent | 次强调色（渐变、hover 辅助） |
| `--agentskin-bg` | — | background | 页面最底层背景 |
| `--agentskin-surface` | `--wb-surface` | surface | 面板/卡片/输入框底色 |
| `--agentskin-surface-elevated` | — | surfaceElevated | 弹出层/浮层底色 |
| `--agentskin-text` | `--wb-text` | text | 主文字颜色 |
| `--agentskin-muted` | — | text (muted) | 次级文字 |
| `--agentskin-border` | — | border | 边框/分隔线 |
| `--agentskin-code-bg` | — | codeBackground | 代码块背景 |
| `--agentskin-code-fg` | — | codeForeground | 代码文字 |
| `--agentskin-button-bg` | — | accent | 按钮背景 |
| `--agentskin-button-fg` | — | text | 按钮前景 |
| `--agentskin-input-bg` | — | surface | 输入框背景 |
| `--agentskin-focus-ring` | — | accent | 焦点环 |
| — | — | selection | 文本选区 |

> 注：`--agentskin-selection` 和 `--agentskin-text-shadow` 也是引擎产物（共 16 个 CSS 变量输出到 `:root`），但 manifest 的 13 + 1 (focusRing) = 14 个颜色源是主题作者的输入。

**核心映射公式**（`scripts/generators/workbuddyCss.mjs`）：

```
--wb-accent   = var(--agentskin-accent)
--wb-secondary = var(--agentskin-secondary)
--wb-surface  = var(--agentskin-surface)     ← 主表面色，决定全局色调
--wb-text     = var(--agentskin-text)
```

此后所有 `--cb-*` 由 `--wb-*` 通过 `color-mix()` 派生。

---

## 3. `--cb-*` Token 分组与推荐映射

下文按功能分组列出全部 WorkBuddy 封装层 token。标注：

- **[E]** Essential：必须覆盖，视觉完整性核心
- **[R]** Recommended：推荐覆盖，影响一致性
- **[A]** Accent-only：仅跟随强调色，派生简单

标注「竞品覆盖」表示 cdredfox 等社区方案是否通常覆盖此 token。

### 3.1 背景组（Backgrounds）

| Token | 用途 | 映射策略 | 优先级 | 竞品覆盖 |
|-------|------|----------|--------|----------|
| `--cb-bg-primary` | 页面主背景（body 级） | `--wb-surface` 直接赋值 | **E** | ✅ |
| `--cb-bg-secondary` | 次级面板底色 | `--wb-surface` 94% alpha | **E** | ✅ |
| `--cb-bg-tertiary` | 三级面板/卡片底色 | `--wb-surface` 82% + `--wb-accent` 6% | **R** | ✅ |
| `--cb-bg-overlay` | 弹窗遮罩/蒙层 | `--wb-surface` 90% alpha | **R** | 部分 |
| `--cb-panel-bg-primary` | 主面板底色 | `--wb-surface` 88% alpha | **E** | ✅ |
| `--cb-panel-bg-secondary` | 嵌套面板底色 | `--wb-surface` 78% + `--wb-accent` 10% | **R** | ✅ |
| `--cb-team-member-card-background` | 团队成员卡片背景 | `--wb-surface` 88% alpha | **R** | ✅ |

**映射模式**：所有 `-bg-*` 和 `-panel-bg-*` 都从 `--wb-surface` 出发，通过 `color-mix(in srgb, var(--wb-surface) X%, transparent)` 调整透明度，混入少量 `--wb-accent` 让冷/暖调跟随主题。

### 3.2 文字组（Text）

| Token | 用途 | 映射策略 | 优先级 | 竞品覆盖 |
|-------|------|----------|--------|----------|
| `--cb-text-primary` | 主标题/正文 | `--wb-text` 直接赋值 | **E** | ✅ |
| `--cb-text-secondary` | 副标题/描述文字 | `--wb-text` 70% alpha | **E** | ✅ |
| `--cb-text-tertiary` | 占位符/时间戳 | `--wb-text` 50% alpha | **R** | ✅ |
| `--cb-text-disabled` | 禁用态文字 | `--wb-text` 42% alpha | **R** | 部分 |
| `--cb-text-link` | 超链接颜色 | `--wb-accent` 直接赋值 | **E** | ✅ |
| `--cb-text-link-hover` | 链接悬停颜色 | `--wb-secondary` | **R** | 部分 |
| `--cb-text-error-active` | 错误态文字/活跃错误 | `--wb-accent` | **A** | 部分 |

**映射模式**：文字组从 `--wb-text` 出发派生 3–4 级透明度：primary = 100%, secondary = 70%, tertiary = 50%, disabled = 42%。链接和错误态跟随强调色。

### 3.3 侧栏与面板组（Sidebars & Panels）

| Token | 用途 | 映射策略 | 优先级 | 竞品覆盖 |
|-------|------|----------|--------|----------|
| `--cb-sidebar-bg` | 会话列表/文件树底色 | `--wb-surface` 15% alpha（玻璃效果） | **E** | ✅ |
| `--cb-vscode-sideBar-background` | VS Code 侧栏底色 | `--wb-surface` 15% alpha | **E** | ✅ |
| `--cb-vscode-panel-border` | 面板边框 | `--wb-accent` 30% alpha | **R** | ✅ |
| `--cb-vscode-panel-background` | 面板背景 | `--wb-surface` | **E** | ✅ |
| `--cb-input-placeholder` | 输入框占位符文字 | `--wb-text` 50% alpha | **R** | 部分 |

**映射模式**：侧栏背景使用极低透明度（12-15%）以透光透出 hero/art 图层，同时用 `backdrop-filter: blur()` 实现毛玻璃。面板边框强调色 30% alpha。

### 3.4 输入组（Inputs）

| Token | 用途 | 映射策略 | 优先级 | 竞品覆盖 |
|-------|------|----------|--------|----------|
| `--cb-vscode-input-background` | 输入框底色 | `--wb-surface` 88% alpha | **E** | ✅ |
| `--cb-vscode-input-foreground` | 输入框文字 | `--wb-text` | **E** | ✅ |
| `--cb-vscode-input-border` | 输入框边框 | `--wb-accent` 18% alpha | **R** | 部分 |
| `--cb-input-placeholder` | 占位符颜色 | `--wb-text` 50% alpha | **R** | 部分 |
| `--cb-vscode-dropdown-background` | 下拉菜单背景 | `--wb-surface` | **E** | ✅ |
| `--cb-vscode-dropdown-foreground` | 下拉菜单文字 | `--wb-text` | **E** | ✅ |
| `--cb-vscode-dropdown-border` | 下拉菜单边框 | `--wb-accent` 18% alpha | **R** | 部分 |

### 3.5 按钮组（Buttons）

| Token | 用途 | 映射策略 | 优先级 | 竞品覆盖 |
|-------|------|----------|--------|----------|
| `--cb-button-dark-background` | 主按钮背景 | `--wb-accent` | **E** | ✅ |
| `--cb-button-dark-foreground` | 主按钮文字 | 按 `--wb-accent` 明度选 `#fff` 或 `#000` | **E** | ✅ |
| `--cb-button-dark-hover-background` | 主按钮悬停 | `--wb-accent` 85% + black | **R** | 部分 |
| `--cb-button-ghost-hover-background` | 幽灵按钮悬停 | `--wb-accent` 16% alpha | **R** | ❌ |
| `--cb-vscode-button-background` | VS Code 按钮背景 | `--wb-accent` | **E** | ✅ |
| `--cb-vscode-button-foreground` | VS Code 按钮文字 | 按明度选白/黑 | **E** | ✅ |
| `--cb-vscode-button-hoverBackground` | VS Code 按钮悬停 | `--wb-accent` 85% + black | **R** | 部分 |

### 3.6 焦点与选区组（Focus & Selection）

| Token | 用途 | 映射策略 | 优先级 | 竞品覆盖 |
|-------|------|----------|--------|----------|
| `--cb-vscode-focusBorder` | 全局焦点边框/环 | `--wb-accent` 40-55% alpha | **E** | ✅ |
| `--cb-vscode-list-hoverBackground` | 列表/侧栏行悬停 | `--wb-accent` 16% alpha | **R** | ✅ |
| `--cb-vscode-list-activeSelectionForeground` | 列表选中项文字 | `--wb-text` | **R** | 部分 |
| `--cb-vscode-list-inactiveSelectionBackground` | 非活跃选中项背景 | `--wb-accent` 10% alpha | **R** | ❌ |
| `--cb-vscode-toolbar-hoverBackground` | 工具栏按钮悬停 | `--wb-accent` 16% alpha | **R** | ❌ |
| `--cb-vscode-scrollbarSlider-background` | 滚动条滑块 | `--wb-accent` 30% alpha | **R** | 部分 |
| `--cb-vscode-scrollbarSlider-hoverBackground` | 滚动条悬停 | `--wb-accent` 50% alpha | **R** | 部分 |

### 3.7 VS Code Editor 组（Workbench Chrome）

| Token | 用途 | 映射策略 | 优先级 | 竞品覆盖 |
|-------|------|----------|--------|----------|
| `--cb-vscode-editor-background` | 编辑器/视口底色 | `--wb-surface` | **E** | ✅ |
| `--cb-vscode-foreground` | 全局前景色 | `--wb-text` | **E** | ✅ |
| `--cb-vscode-editor-foreground` | 编辑器文字 | `--wb-text` | **E** | ✅ |
| `--cb-vscode-descriptionForeground` | 描述/提示文字 | `--wb-text` 70% alpha | **R** | 部分 |
| `--cb-vscode-titleBar-activeBackground` | 活动标题栏 | `--wb-accent` | **A** | 部分 |
| `--cb-vscode-titleBar-activeForeground` | 活动标题栏文字 | 按明度选 | **A** | 部分 |
| `--cb-vscode-titleBar-inactiveBackground` | 非活动标题栏 | `--wb-accent` 80% + `--wb-surface` | **A** | ❌ |
| `--cb-titlebar-control-hover-background` | 标题栏控件悬停 | `--wb-accent` 16% alpha | **A** | ❌ |

### 3.8 边框与分隔线组（Strokes）

| Token | 用途 | 映射策略 | 优先级 | 竞品覆盖 |
|-------|------|----------|--------|----------|
| `--cb-stroke-secondary` | 次级边框/分隔线 | `--wb-accent` 45% alpha | **R** | 部分 |
| `--cb-markdown-hr-border-color` | Markdown 分隔线 | `--wb-accent` 30% alpha | **R** | 部分 |
| `--cb-vscode-widget-border` | 浮层边框 | `--wb-accent` 45% alpha | **R** | 部分 |
| `--cb-vscode-panel-border` | 面板分隔线 | `--wb-accent` 30% alpha | **R** | 部分 |

---

## 4. 深浅色自动切换机制

### 4.1 竞品方案（cdredfox）

```javascript
// surface 明度 > 140 → light
const surfaceLuma = computeLuminance(surfaceColor);
if (surfaceLuma > 140) {
  document.documentElement.setAttribute('data-vscode-theme-kind', 'vscode-light');
} else {
  document.documentElement.setAttribute('data-vscode-theme-kind', 'vscode-dark');
}
```

通过切换 `data-vscode-theme-kind` 属性，让 VS Code 内置组件自动切换控件配色（滚动条、选择框、列表高亮等）。

### 4.2 AgentSkin 实现

AgentSkin 通过 manifest 的 `mode` 字段（`dark` / `light` / `auto`）或引擎的 `color-scheme` 声明实现：

```css
html.agentskin-host-workbuddy {
  color-scheme: dark !important;  /* 或 light */
}
```

`tokenBlock()` 函数在生成 CSS 时根据 `t.isLight` 自动选择 `color-scheme` 和文字阴影方向（light 模式下白阴影增强暗文字可读性，dark 模式下黑阴影增强亮文字可读性）。

**关键差异**：竞品依赖明度阈值自动判定，AgentSkin 由主题作者显式声明 `mode`，更可控但需作者理解深浅色对 token 派生的全部影响。

---

## 5. DOM 锚点系统

### 5.1 竞品使用 `[data-view-id]`

WorkBuddy 在关键布局容器上标注了 `data-view-id` 属性，社区方案用做稳定选择器：

```css
[data-view-id="sidebar"]   { /* 侧栏 */ }
[data-view-id="main-content"] { /* 主内容区 */ }
[data-view-id="detail-panel"] { /* 详情面板 */ }
```

这些锚点不随版本漂移（比类名稳定），是竞品做结构适配的核心依赖。

### 5.2 AgentSkin 使用方式

AgentSkin 的 `workbuddyCss.mjs` 同样使用 `[data-view-id]` 作为结构层选择器：

```css
/* 侧栏：毛玻璃 */
html.agentskin-host-workbuddy [data-view-id="sidebar"] {
  background: color-mix(in srgb, var(--agentskin-surface) 15%, transparent) !important;
  backdrop-filter: blur(24px) saturate(1.15);
}

/* 主内容区：上透下实渐变 */
html.agentskin-host-workbuddy [data-view-id="main-content"] {
  background: linear-gradient(180deg, transparent 0 55%,
    color-mix(in srgb, var(--agentskin-bg) 42%, transparent) 100%) !important;
}

/* 详情面板：毛玻璃 */
html.agentskin-host-workbuddy [data-view-id="detail-panel"] {
  background: color-mix(in srgb, var(--agentskin-surface) 72%, transparent) !important;
  backdrop-filter: blur(18px) saturate(1.08);
}
```

同时辅以 BEM 类名选择器（`.teams-container`、`.conversation-sidebar`、`.wb-home-composer` 等）覆盖更细粒度的组件。

---

## 6. 14-token 到 `--cb-*` 的完整覆盖路径

下图展示从 14 个 manifest 颜色到全部 `--cb-*` 的派生链路：

```
manifest.json (14 colors)
  │
  ├─ tokenBlock() → :root 级 --agentskin-* (16 CSS vars)
  │
  └─ workbuddyCss() → body 级 --wb-* (4 base vars)
       │
       ├─ --wb-accent ─────────────────────┐
       │   ├─ --cb-text-link               │
       │   ├─ --cb-button-dark-background  │
       │   ├─ --cb-vscode-button-background│
       │   ├─ --cb-vscode-focusBorder      │
       │   ├─ --cb-vscode-textLink-foreground
       │   ├─ --cb-stroke-secondary        │
       │   └─ (所有 hover/active alpha 派生)│
       │                                    │
       ├─ --wb-secondary ──────────────────┐│
       │   └─ --cb-text-link-hover         ││
       │                                    ││
       ├─ --wb-surface ────────────────────┐││
       │   ├─ --cb-bg-primary              │││
       │   ├─ --cb-bg-secondary (94%)      │││
       │   ├─ --cb-panel-bg-primary (88%)  │││
       │   ├─ --cb-bg-tertiary (82%+accent)│││
       │   ├─ --cb-sidebar-bg (15%)        │││
       │   ├─ --cb-vscode-editor-background│││
       │   ├─ --cb-vscode-sideBar-background│││
       │   ├─ --cb-vscode-input-background │││
       │   └─ (所有 panel/dropdown/terminal)│││
       │                                    │││
       └─ --wb-text ──────────────────────┐│││
           ├─ --cb-text-primary            ││││
           ├─ --cb-text-secondary (70%)    ││││
           ├─ --cb-text-tertiary (50%)     ││││
           ├─ --cb-text-disabled (42%)     ││││
           ├─ --cb-input-placeholder (50%) ││││
           └─ --cb-vscode-foreground      ││││
                                            ││││
  color-mix() ──────────────────────────────┘┘┘┘
```

**核心洞察**：14 个 manifest 颜色先收敛为 4 个 `--wb-*` 中间变量，再由 `color-mix()` 派生 60+ `--cb-*`。整个系统的"信息瓶颈"是 4 个 `--wb-*`，这意味着：

1. 只要 4 个基础色选得好，60+ `--cb-*` 自动和谐
2. 深浅色切换只需翻转 `--wb-surface` 和 `--wb-text` 的明暗关系
3. 所有 alpha 派生保持一致的"调性"（冷/暖）

---

## 7. 竞品极简格式 vs AgentSkin 完整格式对比

| 维度 | cdredfox 极简格式 | AgentSkin 14-token 格式 |
|------|-------------------|------------------------|
| 输入量 | 4 色 + 1 图 | 14 色 + 可选图 |
| 派生方式 | Canvas 像素取色 → 4 色 | 主题作者显式定义 |
| 深浅色判定 | 明度阈值自动 | manifest mode 显式声明 |
| 覆盖层 | 仅 `--cb-*` | `--cb-*` + `--vscode-*` + `--sc-ui-*` |
| 校验 | 无 | 11 项不变量 + 门禁 |
| 工程化 | 单 .ps1/.command 脚本 | 四引擎 + 编排层 + 765+ 测试 |

**结论**：竞品的极简格式适合"一句话安装"场景，但 AgentSkin 的 14-token 格式在覆盖深度（三层 token 体系）、工程化（测试/校验/门禁）和多适配器复用上具有结构性优势。两者不是替代关系，而是面向不同用户群体。

---

## 8. 推荐映射策略总结

### 8.1 浅适配（仅 `--cb-*` 层）

仅覆盖 `--cb-bg-*` / `--cb-text-*` / `--cb-panel-bg-*` 三组，约 10 个 token。适合快速主题、低维护成本。视觉完整度约 70%（VS Code 工作台层仍用原生色）。

### 8.2 中度适配（`--cb-*` + `--vscode-*` 精选）

在浅适配基础上增加 `--cb-vscode-editor-background` / `--cb-vscode-sideBar-background` / `--cb-vscode-foreground` / `--cb-vscode-button-*` / `--cb-vscode-focusBorder` 等关键 workbench token。约 25-30 个 token。视觉完整度约 90%。

### 8.3 深度适配（三层全覆盖）

覆盖 `--cb-*`（全部）+ `--vscode-*`（78 精选）+ `--sc-ui-*`（24 个），共 166+ 定义。AgentSkin 的 `workbuddyCss.mjs` 即采用此策略。视觉完整度接近 100%。

### 8.4 映射优先级决策树

```
token 是否直接影响主视觉？
  ├─ 是 → Essential (E) → 必须覆盖
  │   └─ 是否跟随 surface？
  │       ├─ 是 → color-mix(wb-surface, X%)
  │       └─ 否 → 直接赋值 wb-accent / wb-text
  └─ 否 → 是否影响一致性？
      ├─ 是 → Recommended (R) → 推荐覆盖
      └─ 否 → Accent-only (A) → 派生即可
```

---

## 9. 参考资源

| 资源 | 说明 |
|------|------|
| `scripts/generators/workbuddyCss.mjs` | AgentSkin 的 `--cb-*` CSS 生成器（166 定义） |
| `src/engine/src/adapters/workbuddy.mjs` | 适配器定义（bridge 映射 + 匹配规则） |
| `src/shared/injection/contracts/workbuddy.contract.json` | 注入验证契约 |
| `docs/apps/workbuddy/ADAPTATION.md` | 适配策略与实测结论 |
| `docs/reports/workbuddy-skin-ecosystem-research-2026-08-29.md` | 15 仓库竞品分析报告 |
| `docs/reports/workbuddy-engine-architecture-deep-dive-2026-08-29.md` | 引擎架构深度分析 |
| cdredfox/workbuddy-skin-studio (GitHub) | 169 stars，AI 优先极简方案 |
| comeonzhj/WorkBuddy-theme-skill (GitHub) | 18 stars，产品化方案 |
