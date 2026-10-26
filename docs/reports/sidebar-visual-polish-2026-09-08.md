# 侧边栏视觉优化实施报告（2026-09-08）

> 状态：**COMPLETED**（Round 2 追加于同日） · 范围：`src/ui/components/sidebar/`（8 文件）+ `src/ui/globals.css` + 文档
> 验证：`npm run check` **21/21 全绿**（含 C13 类名契约 958 引用 / 1389 编译零死类）

---

## 0. Round 2（2026-09-08 追加）

Round 1 交付材质与 token 桥之后的交互细节深化：

| 项 | 内容 |
|----|------|
| **页头拖拽区** | `.as-sidebar-header` 整行设为 `-webkit-app-region: drag`（CSS 层），按钮 `no-drag` opt-out——与 TitleBar 拉通，窗口左上角沿品牌带可均匀抓取，不再「抓空」到死 chrome |
| **品牌线入场动画** | 新增 `as-brand-line-in` keyframes（scaleY 0.4→1 + fade，Spring 曲线）：主行与子导航激活指示线在路由切换时垂直展开落位，替代硬切 pop |
| **shell 消费 `--ag-sidebar-bg`** | Round 1 该 token 处于休眠（由 `bg-sidebar` 承载）；常态分支改为 `bg-[var(--ag-sidebar-bg,var(--sidebar))]`，token 真正上线 |
| **玻璃模式 hover 增强** | `--ag-sidebar-item-hover` 按 hasWallpaper 分档：常态 5%、玻璃模式 8%——面板 12% 半透明且壁纸在背后移动，5% 会被亮色内容淹没 |
| **子导航对齐** | `SidebarMenuSub` 行 hover 同款 motion-safe 3px 位移（基线 8px），容器挂载 `as-fade-in`，与主行构成同一动效系统 |
| **壳层 select-none** | `sidebarSurfaceClass` 加 `select-none`，防止面板内拖拽启动意外文本选择 |

---

## 0.1 Round 3（2026-09-08 追加）：收起/展开全部按钮统一

侧边栏收起/展开共 **4 类入口**：Rail 展开按钮、Content 收起按钮、菜单键盘（ArrowRight/ArrowLeft/Escape）、全局 Ctrl/Cmd+\ 快捷键。本轮统一前两类按钮的材质与可发现性，并补齐命令面板入口（第 5 条路径，等价于快捷键的可发现形式）：

| 项 | 内容 |
|----|------|
| **按钮材质统一** | `SIDEBAR_REVEAL_BUTTON_CLASS`：hover 从 `bg-card2` 改为 `--ag-sidebar-item-hover`（与菜单行同一表面派生材质——页头 affordance 与导航读作一个系统）；按压闪现品牌 accent（`--sidebar-accent` + `accent-foreground`，落实设计原则「rose marks interaction」） |
| **显现时序对齐** | reveal 过渡 `duration-fast`(100ms) → `duration-base`(150ms)，与 Rail logo 交叉渐变半程对齐——两个子元素此前 100ms vs 150ms 存在可感知的拖影，现作为一个 lockup 整体切换 |
| **快捷键可发现性** | 新增 `SIDEBAR_TOGGLE_SHORTCUT` 常量（`Control+\ Meta+\`，与 useAppController 实际 handler 单一来源对齐），两端头按钮补 `aria-keyshortcuts`——屏幕阅读器/工具提示可播报快捷键，无需用户偶然发现 |
| **命令面板入口** | CommandPalette 操作组新增「收起/展开侧边栏」（`PanelLeftIcon` + `⌘ \` 快捷键标注），消费 controller 已暴露的 `toggleSidebar`——收起后的侧边栏在纯键盘流下也可从 Cmd+K 恢复，不必依赖不可见的全局快捷键 |

> **关联修复（用户反馈）**：TitleBar 左侧的「AgentSkin ｜ 页面名」面包屑整体移除（`TitleBar.tsx`）——侧边栏页头已承载完整品牌 lockup，标题栏重复一遍属双重品牌；且社区路由下旧 `routeLabel` 兜底 `'AgentSkin'`，会渲染出「AgentSkin ｜ AgentSkin」病态重复。标题栏左段现为纯拖拽区，与 sidebar 页头拖拽区（Round 2）拉通。

---

## 1. 背景与目标

侧边栏（192px 展开体 / 56px 折叠栏）功能完整但视觉表达单薄：hover/激活材质不区分层次、分隔线为平板 border、滚动条继承全局灰色样式、圆角为字面量不随 `--dl-radius` 用户偏好。本次为纯视觉优化 pass——不改路由、不改 Store 契约、不改几何（`--sidebar-width` 仍由 App.tsx 独占）。

## 2. 改动清单

### 2.1 Token 桥 — `sidebar/sidebarSurface.ts`

新增 `bindSidebarSubTokens(hasWallpaper)`：在侧边栏根节点绑定 `--ag-sidebar-*` 子 token 家族，**全部由核心 `--sidebar-*` 家族经 `color-mix` 派生**，主题重着色导航只需调核心 token：

| 子 token | 派生 | 消费点 |
|----------|------|--------|
| `--ag-sidebar-bg` | 玻璃模式 88% 透明 / 常态 96%+card 提亮 | 预留（当前由 `bg-sidebar`/`as-glass` 承载） |
| `--ag-sidebar-item-hover` | `color-mix(sidebar-foreground 5%)` — 表面自身亮度派生，不引入外来色相 | 菜单行 hover |
| `--ag-sidebar-item-active` | `var(--sidebar-accent)` | 菜单行激活 |
| `--ag-sidebar-hairline` | `color-mix(sidebar-foreground 9%)` | 页头渐变 hairline + 底部分隔线 |
| `--ag-sidebar-scroll-hover` | `color-mix(sidebar-foreground 10%)` | 导航滚动条 hover |
| `--ag-sidebar-logo-halo` | `rgb(brand-rgb / 0.18)` | Rail Logo hover 光晕 |
| `--ag-sidebar-hover-shift` | `3px` | 展开行 hover 横向位移 |

所有 CSS 消费点带等值 `var()` 内联回退 → 未绑定的隔离渲染（单测等）自动退回 v2.7 外观。

`SIDEBAR_HEADER_CLASS`：`border-b` 平板线改为 `as-sidebar-header`（globals.css `::after` 渐变 hairline——内容侧深、边缘侧渐隐）；Rail 与 Content 共享同一类（twMerge 解析 flex→grid 冲突）。

`SIDEBAR_REVEAL_BUTTON_CLASS`：改用手写 `.sidebar-reveal` 规则（globals.css）——Tailwind `group-hover:` 编译为普通类选择器，无法表达「自身 group 被 hover」；新增 `:focus-within` 分支改善键盘可达性。

### 2.2 全局样式 — `globals.css`

- `.sidebar-nav-scroll`：滚动条作用域覆盖——静止隐藏、hover 显示 hairline 滑轨、`:active` 品牌色（替代全局灰色粗滚动条）
- `.group\/sidebar .sidebar-reveal`：affordance 显现规则（hover + focus-within）
- `.as-sidebar-header::after`：页头渐变 hairline

### 2.3 组件层

| 组件 | 改动 |
|------|------|
| `SidebarMenuItem` | hover 行内容右移 3px（Spring 曲线，`motion-safe:` 降级）；激活态图标品牌着色；`rounded-[8px]` → `rounded-md`（随 `--dl-radius` 派生）；注释同步 UX 审计 #13（禁图标 scale） |
| `SidebarMenuSub` | 激活源在 guide rail 上挂 3px 品牌短线（`-left-3` 精确对齐 rail 中心 20.5px）；圆角 token 化 |
| `SidebarMenu` | `scroll-fade-y` 滚动边缘渐隐（scroll-driven，静止零遮罩）；滚动条作用域类；底部 hairline 消费新 token（折叠态保持 `w-6` 居中短线） |
| `SidebarContent` | 品牌区新增真实 `appVersion` 两级字标（`shellStore.appVersion`，空则隐藏） |
| `SidebarRail` | Logo hover 品牌光晕；接入 `bindSidebarSubTokens`（折叠态菜单行 hover/激活依赖该绑定）；页头与展开态共享类 |
| `SidebarTooltip` | `rounded-[6px]` → `rounded-md` |

### 2.4 文档

- `docs/design-tokens.md` §4.3（Sidebar 圆角行 → `rounded-md` 派生）+ §9.1（`--ag-sidebar-*` 子 token 表 + v2.8 消费说明，修正「消费 bg-surface」的过时描述）
- `src/ui/INDEX.md` sidebar 条目（文件数 7 → 9 + 套件描述）

## 3. 设计决策记录

1. **hover 材质用表面亮度而非外来色**：`color-mix(sidebar-foreground 5%)` 保证任意主题重着色 `--sidebar` 后 hover 依然协调。
2. **3px 位移只在展开态**：56px rail 无横向空间；`motion-safe:` 前缀保证 `prefers-reduced-motion` 用户获得平面 hover。
3. **渐变 hairline 而非 border**：分隔线权重随内容变化（品牌头深、空白区浅），读取为「深度」而非「框线」。
4. **滚动条 brand-tint 而非全局灰**：侧边栏是品牌 chrome，滚动条也应遵守视觉语言。
5. **圆角全部 token 派生**：删除 3 处字面量（`rounded-[8px]`/`rounded-[6px]`×2），圆角随用户 radiusScale 偏好缩放，同时消除 §4.3 记录的字面量债。

## 4. 验证

| 门禁 | 结果 |
|------|------|
| `npm run check` 全量 | **21/21 ✓**（typecheck / biome / C6 design-tokens / i18n / C13 css-classes / C12 orphan-tests / C14 provenance / C15 parsability / 构建产物比对） |
| C13 类名契约 | 958 引用 / 1389 编译，零死类、零重复选择器 |
| theme-token-consistency 回归 | 530 tests ✓ |
| 产物抽查 | `.sidebar-reveal` / `.sidebar-nav-scroll` / `.as-sidebar-header` / `--ag-sidebar-hover-shift` / `group\/sidebar:hover` 全部编译进 globals-*.css |
| 路径卫生 | 无新增污染文件；`out/` 构建产物已 gitignore |
