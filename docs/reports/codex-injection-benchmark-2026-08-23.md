# Codex 主题注入对比审计报告（2026-08-23）

> 背景：用户反馈 AgentSkin 在 **Codex** 上的主题渲染"整体错杂、定位不准、很难看，像把别的组件错乱地应用到 Codex 里"。其余 5 个 agent 仅细节问题。
> 方法：对照 GitHub 上更新活跃的 Codex 主题注入项目，用 CDP 探针实测真实 DOM，定位我们与成熟方案的机制级差异。

## 1. 对标项目（近期活跃）

| 项目 | 维护者 | Stars | 核心机制 |
|------|--------|-------|---------|
| **Codex Dream Skin** | Fei-Away | 11,600+ | CDP 运行时注入；`--dream-skin-art` Blob 变量渲染背景；注入面最小化（1 style + 1 chrome div）；MutationObserver+4s 兜底自愈 |
| **awesome-codex-skins** | Wangnov | — | `.codexskin` 官方 SPEC v1.1：theme.css 必须全部限定在 `html.codex-theme-studio` 作用域下；`--cts-*` 变量；单 class 整体反转 |
| **codex-skin-desktop** | KyrieWang233 | 新 | 主题包**不携带 CSS/选择器/脚本**；ThemeDefinition V2 → RenderPlan → CSS Compiler 动态编译；实机质量门禁（命中/对比度/回复表面/输入框/溢出）|
| **Codex-Skin** | Trentct | 新 | `themes/foundation.css` 语义基础层 + 每主题 character layer；`--theme-*` 变量契约；CDP 9229 注入 |

## 2. 我们的 Codex 适配器现状（探针实测）

### 2.1 破坏性操作 A：`discoverAndOverrideTokens()` 无差别透明化

**实测：会强制把 97 个 token 设为 transparent**，包括：
- `--vscode-button-background` → transparent（**按钮背景消失**）
- `--vscode-badge-background` / `--vscode-input-background` / `--vscode-menu-background` / `--vscode-dropdown-background` → transparent（**控件表面色全部丢失**）

**结果**：按钮、输入框、下拉框、菜单全部变透明，文字直接压在背景图上 → **"错杂、定位不准、很难看"**。

### 2.2 破坏性操作 B：`applyHeuristicStylesToElement()` 启发式正则染色

用语义类名正则（`/sidebar|surface|composer|header|popover|modal|dropdown|primary/`）去匹配 Codex 的 **Tailwind 原子类** DOM：

| 模式 | 命中数 | 实际命中对象 |
|------|--------|------------|
| `composer|multilineSurface` | **41** | 工具按钮 `no-drag cursor-interaction items-center...`（**不是 composer**）|
| `popover|modal|dropdown` | **20** | `_ComposerDropdownLabel_` 文本 span（**52x18 小标签，不是弹窗**）|
| `header|tint` | **21** | 侧边栏 header 区域 |
| `primary` | **27** | Tailwind 原子类（**无 primary 字样，全误报**）|

**矛盾**：adapter 注释自己承认"Codex 用 Tailwind utility classes + --color-token-* 变量，不是语义类名"，却用语义类名正则去强制染色 → **自相矛盾，错误命中**。

### 2.3 正确部分
- 主题 CSS 层（codex.css）只覆盖 `--color-token-*`（74 个），不动 vscode/wb token ✓
- `button.sidebar-item` 等精确锚点已在上一轮修复 ✓

## 3. 关键差异对比（我们 vs 成熟项目）

| 维度 | 成熟项目做法 | AgentSkin 现状 | 影响 |
|------|------------|---------------|------|
| **作用域** | 全部限定在单个 class（`html.codex-theme-studio`）下 | host class 已限定 ✓，但内部启发式染色无边界 | 组件错染 |
| **变量覆盖** | 只覆盖核心语义 token（bg-primary/secondary/text/accent/border/surface） | 覆盖 **97 个** token 含 vscode-*，全部透明化 | 控件表面丢失 |
| **控件表面色** | 保留按钮/输入/下拉/菜单的 surface，只透最外层 | 无差别透明 → 控件变透明 | "错杂难看" |
| **选择器策略** | 语义角色（RenderPlan）或最小精确选择器 | 启发式正则 + 语义类名（与 Tailwind 冲突）| 错染/定位不准 |
| **注入面** | 1 style + 1 chrome div，pointer-events:none | 注入 body::before art + 大量元素内联样式 | 污染增加 |
| **背景图** | Blob URL → CSS 变量（≤1.4MB/图，webp 优先） | data: URL → `--agentskin-art`（无大小限制）| 大图卡顿 |
| **可逆性** | 移除 class/style 即完全恢复 | 强制内联样式不易逆 | 残留 |

## 4. 确定性结论：覆盖少量核心 token 是"必要"不是"省事"

用 CDP 探针实测 Codex 真实 token 体系后确认：

### 4.1 Codex 是"单层变量驱动"架构

- 23 个 `--color-token-*` 变量定义在 `:root`：`bg-primary/secondary/tertiary`、
  `side-bar-background`、`main-surface-primary`、`text-primary/secondary/tertiary`、
  `border(-default/light/heavy)`、`input-border`、`dropdown-background`、
  `list-hover-background`、`primary`、`focus-border` 等。
- **组件不画背景**：按钮/输入框/侧边栏项的 computed `background-color` 实测均为
  `rgba(0,0,0,0)`（透明）；背景全部由页面级 token 逐层提供：
  - `aside.app-shell-left-panel` 实际背景 = `--color-token-side-bar-background`（#eff1f3）的半透明版
  - 页面主背景 = `--color-token-bg-primary`（#dadcdd）
- **组件只引用变量、不硬编码颜色** → 覆盖少量核心 token 即全局换肤。

**结论：成熟项目只覆盖少量核心 token 不是偷懒，而是看穿了 Codex 的架构**——
组件无自身背景、全靠变量级联，所以"少即是正确"。

### 4.2 `--vscode-*` 命名空间是"空壳"

- CSS 规则里确有 `var(--vscode-token-side-bar-background)` 等 15 处引用，
  但探针实测这些变量**从未被赋值**（`getPropertyValue` 返回空串）。
- 真正生效的是 `--color-token-*`。adapter 若把 `--vscode-*` 也透明化，是打空壳。

### 4.3 背景图大小对齐 `.codexskin` SPEC —— 撤回

`.codexskin` 的 ≤1.4MB 限制针对"zip 打包 + data: URL 注入"方案；我们走 CDP
直接设置 `--agentskin-art`（Blob URL）路径，两者机制不同，**该限制不适用**。
此条撤回，不作为修复项。

## 5. 根因结论（更新）

**Codex 渲染错乱的根源是两层破坏性机制**：

1. **`discoverAndOverrideTokens()` 把 97 个含 background 的 token 全部透明化**
   —— 包括正确的 `--color-token-side-bar-background`、`--color-token-bg-primary`、
   `--color-token-main-surface-primary`。这直接抹掉了 Codex 的层级背景，控件
   表面色全丢 → "错杂、难看"。
2. **`applyHeuristicStylesToElement()` 用语义类名正则匹配 Tailwind 原子类 DOM**
   —— 把工具按钮/文本标签当组件强制染色 → "像把别的组件安到 Codex"。

## 6. 修复建议（推荐方案：精准化）

1. **重写 `discoverAndOverrideTokens()`**：只把「最外层页面背景」token 透明化以
   透出 art —— 具体为 `--color-token-bg-primary`、`--color-token-bg-secondary`、
   `--color-token-side-bar-background`、`--color-token-main-surface-primary`；
   **保留** `dropdown-background`、`list-hover-background`、`input-border`、
   `border-*`、`scrollbar-*` 等控件/边框 token。
2. **移除 `applyHeuristicStylesToElement()`**：删除语义类名正则染色，改为只对
   `button.sidebar-item` 等精确锚点做 hover/active（已在主题 CSS 层实现）。
3. **保持单一 class 反转**：`html.agentskin-host-codex` 已是正确方向（对齐
   `.codexskin` SPEC 的 `html.codex-theme-studio`），确保移除时零残留。

## 7. 验证标准（更新）

- CDP 探针：`--color-token-bg-primary` / `side-bar-background` /
  `main-surface-primary` 被透明化（透出 art），但 `dropdown-background` /
  `list-hover-background` / `input-border` **保留原色**。
- CDP 探针：启发式染色元素数从 87 → 0（不再有正则染色）。
- 侧边栏项 hover 用 `--color-token-list-hover-background` 派生色（accent 混合），
  不是透明。
- `npm run check` 全绿。
