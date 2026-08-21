# AgentSkin 前端设计系统全面审计报告

**审计日期**: 2026-08-21  
**审计范围**: `src/ui/` 全部页面、组件、CSS 基础层、设计文档  
**参照基准**: `docs/design-tokens.md` v2.0、`scripts/check-design-tokens.mjs` C6 规范、`AGENTS.md` 黄金规则  
**审计方法**: 多子智能体并行分析（UI 审计 + GitHub 对标 + CSS 架构分析）+ 交叉质询

---

## 一、执行摘要

本次审计覆盖 AgentSkin 全部前端设计系统，发现 **10 类关键问题**，识别 **15 个高价值 GitHub 对标项目**，推演出 **3 套候选方案**，经多维加权评估后选定 **方案 B「精准校准·渐进演进」** 为全局最优解。

### 关键发现

| 类别 | 数量 | 严重度 |
|------|------|--------|
| 设计令牌不一致（文档 vs 代码） | 14 处 | P0-P2 |
| 圆角基线矛盾（2px vs 6px） | 50+ 处 | P0 |
| 阴影违规（非标准阴影） | 6 处 | P0-P1 |
| 缩放/滑入动画违规 | 12 处 | P1 |
| 字号低于 10px 阈值 | 4 处 | P1 |
| 动效时长不在 token 阶梯 | 8 处 | P2 |
| CSS 文件臃肿（workspace.css 1396 行） | 1 处 | P0 |
| 未使用 Radix Colors 导入（30KB+ 浪费） | 18 个文件 | P1 |
| 工具类定义但零采用 | 5 个类 | P2 |
| 页面容器 padding 不一致 | 4 个页面 | P2 |

---

## 二、当前状态深度分析

### 2.1 设计令牌不一致清单（文档 vs 代码）

| # | 令牌 | 文档值 (`design-tokens.md`) | 代码值 (`globals.css`) | 严重度 |
|---|------|------------------------------|------------------------|--------|
| 1 | `--radius-base` | `2px` (§4.1) | `6px` (L71) | P0 |
| 2 | `--radius-sm` | `1.2px` | `3.6px` (`calc(6px * .6)`) | P0 |
| 3 | `--radius-md` | `1.6px` | `6px` | P0 |
| 4 | `--radius-lg` | `2px` | `9px` | P0 |
| 5 | `--duration-fast` | `150ms` | `120ms` | P1 |
| 6 | `--duration-base` | `200ms` | `180ms` | P1 |
| 7 | `--duration-slow` | `300ms` | `260ms` | P1 |
| 8 | `--duration-slower` | `500ms` | `400ms` | P1 |
| 9 | `--font-ui` | 无 Inter 前缀 | 以 `"Inter Variable", "Inter"` 开头 | P1 |
| 10 | `--shadow` | `0 1px 2px...` | `var(--shadow-elev1)` — 值完全不同 | P1 |
| 11 | `.g12` gap | `14px` (`gap-3.5`) | `16px` (`gap-4`) | P2 |
| 12 | 页面容器 padding | `px-[30px] py-[22px]` | 实际 `px-8 py-6` | P2 |
| 13 | `--cr-brand-violet` | 文档 §9.2 列出 | `globals.css` 中不存在 | P2 |
| 14 | `--cr-brand-amber` | 文档 §9.2 列出 | `globals.css` 中不存在 | P2 |

**根因分析**: `design-tokens.md` v2.0 标注日期 2026-08-21，但代码在 2026-08-14 完成了 "6px 圆润" 视觉改版、2026-08-20 校准了 C6 脚本。文档未能同步这些变更。

### 2.2 圆角基线矛盾（核心架构问题）

这是本次审计发现的**最根本的设计哲学矛盾**：

| 层级 | 实际值 | 来源 |
|------|--------|------|
| CSS 变量基线 | `--radius-base: 6px` | `globals.css` L71 |
| 设计文档规范 | `--radius: 2px` | `design-tokens.md` §4.1 |
| 实际 Tailwind 类 | `rounded-[2px]` 50+ 处 | 全部页面 + 基础组件 |
| shadcn 兼容层 | `rounded-md` (6px) | `shadcn-tailwind.css` |

**矛盾解读**: 代码变量声明为 6px，但实际 UI 实现大量使用 2px。这意味着：
- 要么变量基线应降回 2px（Swiss 锐利风格）
- 要么所有 `rounded-[2px]` 应升为 `rounded-md`（圆润工具风格）
- 当前状态是"文档说 2px、变量说 6px、实现混用两者"的三方分裂

### 2.3 阴影违规清单

| 文件 | 行号 | 违规内容 | 严重度 |
|------|------|----------|--------|
| `components/detail-panel.tsx` | 324 | `shadow-[inset_0_0_24px_var(--border)]` — 非标准内联阴影 | P0 |
| `styles/workspace.css` | 316 | `.pw[data-active]` 双阴影层级 | P1 |
| `styles/workspace.css` | 415 | `.ws-float-toolbar` `backdrop-filter: blur(8px)` — 过度毛玻璃 | P1 |
| `styles/workspace.css` | 638 | `.ws-dock` 自定义 `box-shadow` | P1 |
| `components/sidebar.tsx` | 38 | `shadow-[inset_3px_0_0_var(--primary)]` — 非标准内联阴影 | P2 |
| `components/themes/ThemeCard.tsx` | 36 | `shadow-[inset_3px_0_0_var(--primary)]` — 同上 | P2 |

**C6 规范要求**: 仅保留 `shadow-none` 和 `shadow-float` 两档。当前存在 6 处违规。

### 2.4 缩放/滑入动画违规（违反 Swiss 设计原则）

Swiss/International 设计原则明确禁止缩放和滑入动画。当前发现 12 处违规：

| 文件 | 行号 | 违规内容 | 严重度 |
|------|------|----------|--------|
| `components/apps/AppCard.tsx` | 101 | `hover:scale-[1.02]` | P1 |
| `components/apps/AppCard.tsx` | 102 | `active:scale-95` | P1 |
| `components/rename-dialog.tsx` | 54 | `scale-in-95 animate-in zoom-in-95` | P1 |
| `components/workspace/WorkspaceQuickActions.tsx` | 44 | `group-hover/action:scale-105` | P1 |
| `components/workspace/AgentStatusBar.tsx` | 231 | `group-hover/pill:scale-105` | P1 |
| `components/workspace/EnvironmentCard.tsx` | 177 | `group-hover/card:scale-105` | P1 |
| `pages/ThemesPage.tsx` | 195 | `active:translate-y-px active:scale-[.99]` | P1 |
| `components/ui/tooltip.tsx` | 39 | `zoom-in-95` / `slide-in-from-*` | P1 |
| `components/ui/navigation-menu.tsx` | 91, 108 | `zoom-in-95` / `zoom-out-95` | P1 |
| `components/status-bar.tsx` | 127, 146 | `active:translate-y-[1px]` | P2 |
| `components/themes/ThemeCard.tsx` | 111 | `animate-ping` | P2 |
| `components/ui/dropdown-menu.tsx` | 42 | `fade-in-0` + `duration-100` | P2 |

### 2.5 字号与排版问题

#### 字号低于 10px 阈值

| 文件 | 行号 | 字号 | 用途 | 严重度 |
|------|------|------|------|--------|
| `components/ui/badge.tsx` | 8 | `text-[9.5px]` | swiss label | P1 |
| `components/diagnostics/DriftStatusPanel.tsx` | 224 | `text-[9px]` | 数据标签 | P1 |
| `components/studio/ContrastBadge.tsx` | 59 | `text-[9px]` | AAA 徽章 | P1 |
| `components/studio/center/CenterTabThemeEditor.tsx` | 192, 197 | `text-[9px]` | 对比度徽章 | P1 |

#### 字体家族误用

| 文件 | 行号 | 问题 | 严重度 |
|------|------|------|--------|
| `pages/SettingsPage.tsx` | 384 | `font-mono text-[11px]` 用于描述段落 — 描述文字应使用 `font-ui` | P2 |
| `components/ui/dialog.tsx` | 103 | `font-heading text-lg` — `text-lg` (16px) 对 dialog title 过大 | P2 |

### 2.6 间距违规清单

#### 页面容器 padding 不一致

| 文件 | 行号 | 实际值 | 文档规范 | 严重度 |
|------|------|--------|----------|--------|
| `pages/AppsPage.tsx` | 165 | `px-8 py-6` (32/24px) | `px-[30px] py-[22px]` | P2 |
| `pages/archive/AgentsPage.tsx` | 154 | `px-8 py-6 pb-[70px]` | 同上 | P2 |
| `pages/archive/AgentDashboardPage.tsx` | 114 | `px-8 py-6 pb-[70px]` | 同上 | P2 |
| `pages/archive/UnifiedWorkspacePage.tsx` | 400 | `px-8 py-6 pb-[70px]` | 同上 | P2 |

#### 内联魔数间距

| 文件 | 行号 | 问题 | 严重度 |
|------|------|------|--------|
| `pages/AppsPage.tsx` | 165 | `style={{ paddingBottom: '320px' }}` | P2 |
| `pages/ThemesPage.tsx` | 115 | `style={{ width: '200px' }}` — 搜索框宽度 | P3 |
| `pages/WorkspacePage.tsx` | 194 | `mx-4 mb-3` — 16px/12px 非标准节奏 | P3 |

### 2.7 动效时长违规

Token 阶梯定义为：`instant=0ms / fast=120ms / base=180ms / slow=260ms / slower=400ms`

| 文件 | 行号 | 实际值 | Token 阶梯 | 严重度 |
|------|------|--------|------------|--------|
| `pages/AppsPage.tsx` | 220 | `duration-300` | 无 300ms 档位 | P2 |
| `components/inject-dock.tsx` | 63 | `duration-300` | 同上 | P2 |
| `components/title-bar.tsx` | 92 | `duration-400` | `--duration-slower: 400ms` ✓ 但类名应为 `duration-slower` | P2 |
| `components/status-bar.tsx` | 100, 146 | `duration-400` | 同上 | P2 |
| `components/apps/AppDetailsDrawer.tsx` | 53 | `duration-300` | 无 300ms 档位 | P2 |
| `components/ui/dropdown-menu.tsx` | 42 | `duration-100` | 无 100ms 档位 | P2 |

### 2.8 CSS 架构问题

#### 文件臃肿

| 文件 | 行数 | 问题 |
|------|------|------|
| `src/ui/styles/workspace.css` | 1396 | 所有 Studio 组件样式集中在一个文件，难以维护 |
| `src/ui/shadcn-tailwind.css` | 550 | scroll-fade 工具类占 420 行（8 个方向变体），过度复杂 |
| `src/ui/globals.css` | 671 | 主令牌文件，含冗余定义 |

#### 冗余定义

| 问题 | 位置 | 影响 |
|------|------|------|
| `--shadow-float` 自引用 | `globals.css` L125 定义，L395 又 `--shadow-float: var(--shadow-float)` | 理解成本增加 |
| `--card2` 重复定义 | `globals.css` L86 (dark) 和 L169 (light) | 维护负担 |
| Radix Colors 导入未使用 | `globals.css` L2-17 导入 18 个文件，实际使用 HSL 硬编码 | 30KB+ CSS 体积浪费 |
| `--scroll-fade-mask` 声明未使用 | `shadcn-tailwind.css` L112-115 | 死代码 |

#### 工具类采用率接近零

`globals.css` 第 480-531 行定义了 `.as-label` / `.as-micro` / `.as-mono` / `.as-kv` / `.as-big-num`，但组件中几乎全部使用字面量 `font-mono text-[11px]` 等。工具类采用率为 **接近 0%**。

---

## 三、GitHub 对标项目清单

### 3.1 必参考项目（契合度 ≥ 8 分）

| # | 项目 | Stars | 方向 | 契合度 | 可移植内容 |
|---|------|-------|------|--------|------------|
| 1 | [shadcn/ui](https://github.com/shadcn-ui/ui) | 121k | 组件库/设计系统 | 10/10 | 已采用，继续深化组件变体管理 |
| 2 | [radix-ui/primitives](https://github.com/radix-ui/primitives) | 19.1k | 底层组件原语 | 9/10 | 已采用，扩展 Dialog/Select/Slider |
| 3 | [pacocoursey/cmdk](https://github.com/pacocoursey/cmdk) | 12.8k | 命令面板 | 9/10 | CommandPalette 重构参考 |
| 4 | [clauderic/dnd-kit](https://github.com/clauderic/dnd-kit) | 16.8k | 拖拽排序 | 9/10 | Theme Studio 拖拽场景 |
| 5 | [chakra-ui/ark](https://github.com/chakra-ui/ark) | 350k org | 跨框架组件 | 8/10 | data 属性样式指南参考 |
| 6 | [omgovich/react-colorful](https://github.com/omgovich/react-colorful) | 3.5k | 颜色选择器 | 8/10 | Theme Studio 颜色选择器替换 |
| 7 | [inokawa/virtua](https://github.com/inokawa/virtua) | 3.5k | 虚拟列表 | 8/10 | VirtualThemeGrid 性能优化 |

### 3.2 推荐参考项目（契合度 6-7 分）

| # | 项目 | Stars | 方向 | 契合度 | 可移植内容 |
|---|------|-------|------|--------|------------|
| 8 | [swisspost/design-system](https://github.com/swisspost/design-system) | 活跃 | Swiss 设计系统 | 7/10 | 设计令牌架构、网格系统、Figma 集成 |
| 9 | [ibelick/motion-primitives](https://github.com/ibelick/motion-primitives) | 5.6k | 动效组件 | 7/10 | 入场动画模式参考 |
| 10 | [motiondivision/motion](https://github.com/motiondivision/motion) | 活跃 | 动画引擎 | 7/10 | 启动动画、页面过渡 |
| 11 | [react-component/segmented](https://github.com/react-component/segmented) | 活跃 | 分段控制器 | 7/10 | SegmentedControl 无障碍增强 |
| 12 | [bvaughn/react-window](https://github.com/bvaughn/react-window) | 经典 | 虚拟列表 | 6/10 | virtua 备选方案 |

### 3.3 可选参考项目（契合度 4-5 分）

| # | 项目 | Stars | 方向 | 契合度 | 可移植内容 |
|---|------|-------|------|--------|------------|
| 13 | [romboHQ/tailwindcss-motion](https://github.com/romboHQ/tailwindcss-motion) | 活跃 | Tailwind 动效 | 5/10 | 纯 CSS 微动画 |
| 14 | [timc1/kbar](https://github.com/timc1/kbar) | 活跃 | 命令面板 | 5/10 | cmdk 备选 |
| 15 | [Wombosvideo/tw-animate-css](https://github.com/Wombosvideo/tw-animate-css) | 760 | Tailwind v4 动效 | 5/10 | Tailwind v4 专用动画 |

### 3.4 移植优先级建议

| 优先级 | 项目 | 收益 | 成本 | 理由 |
|--------|------|------|------|------|
| P0 | shadcn/ui | 极高 | 零 | 已采用，继续深化 |
| P0 | Radix Primitives | 高 | 零 | 已采用，扩展组件 |
| P1 | cmdk | 高 | 低 | 命令面板是核心交互模式 |
| P1 | react-colorful | 高 | 极低 | Theme Studio 必需，2.8KB 零依赖 |
| P1 | virtua | 高 | 低 | 性能优化关键 |
| P2 | dnd-kit | 中 | 中 | Theme Studio 拖拽 |
| P2 | motion | 中 | 中 | 启动动画、页面过渡 |
| P2 | swisspost/design-system | 中 | 中 | 设计令牌架构参考 |
| P3 | Ark UI | 中 | 中 | API 设计范式参考 |
| P3 | motion-primitives | 中 | 低 | 动效模式参考 |
| P3 | tw-animate-css | 中 | 低 | Tailwind v4 微动画 |

---

## 四、候选方案推演

### 方案 A：「Swiss 纯粹主义」

**核心理念**: 回归 Swiss/International 设计本源，2px 锐利圆角，严格克制。

#### 改动范围

| 维度 | 内容 |
|------|------|
| 圆角 | `--radius-base` 从 6px 降回 2px，全局 `rounded-md` → `rounded-[2px]` |
| 阴影 | 仅保留 `shadow-none` 和 `shadow-float`，清理全部 6 处违规 |
| 动画 | 移除全部 12 处缩放/滑入动画，替换为 opacity 过渡 |
| 文档 | 以 `globals.css` 为唯一事实源重写 `design-tokens.md` |
| 文件 | workspace.css 拆分为 6 个模块文件 |
| 体积 | 删除 18 个未使用 Radix Colors 导入（-30KB+） |
| 工具类 | 推广 `.as-label` / `.as-micro` / `.as-mono`，消除字面量 |

#### 牺牲项
- 6px 圆润风格已投入的开发成本作废
- 部分用户可能偏好圆润风格
- 改动面较大（50+ 文件需修改）

#### 收益项
- 设计哲学完全统一
- Swiss 风格纯粹性最高
- 文档与代码完全同步

---

### 方案 B：「精准校准·渐进演进」

**核心理念**: 承认 6px 圆润风格已成为产品现实，以代码为准校准文档，渐进式清理违规。

#### 改动范围

| 维度 | 内容 |
|------|------|
| 圆角 | 保持 `--radius-base: 6px`，将 50+ 处 `rounded-[2px]` 统一为 `rounded-sm` (3.6px) 或 `rounded-md` (6px) |
| 阴影 | 清理 6 处违规，统一为 `shadow-none` / `shadow-float` |
| 动画 | 移除 6 处 P1 缩放动画，保留 6 处 P2 微动画（translate-y-px 等） |
| 文档 | 更新 `design-tokens.md` 与代码对齐（14 处不一致） |
| 文件 | workspace.css 拆分为 6 个模块文件 |
| 体积 | 删除 18 个未使用 Radix Colors 导入（-30KB+） |
| 工具类 | 推广 `.as-label` / `.as-micro` / `.as-mono`，消除字面量 |

#### 牺牲项
- Swiss 纯粹性略有妥协（6px vs 2px）
- 部分 P2 微动画保留（translate-y-px 等）

#### 收益项
- 改动范围可控（不推翻现有风格）
- 文档与代码同步
- 渐进式迭代，风险低
- 保留用户已熟悉的视觉风格

---

### 方案 C：「系统重构·长期演进」

**核心理念**: 引入完整的设计令牌管理系统（Style Dictionary），W3C DTCG 三层令牌架构，全面重构 CSS 基础层。

#### 改动范围

| 维度 | 内容 |
|------|------|
| 圆角 | 保持 6px，但纳入 Style Dictionary 管理 |
| 令牌 | 引入 W3C DTCG 三层架构（core → semantic → component） |
| 工具 | 引入 Style Dictionary 作为令牌管理工具 |
| 文件 | 全部 CSS 文件按 DTCG 层级重组 |
| 生成 | `build-palette.mjs` 适配新层级 |
| 文档 | 令牌文档从 Style Dictionary 自动生成 |
| 阴影/动画 | 同方案 B |

#### 牺牲项
- 改动规模最大（需引入新工具链）
- 学习曲线（团队需掌握 Style Dictionary）
- 迁移周期长（1-2 月）

#### 收益项
- 令牌全链路管理
- 多平台输出能力（CSS / TypeScript / Swift）
- 长期维护成本最低
- 支持多主题同时运行时

---

## 五、多维加权评估

### 5.1 评估维度与权重

| 维度 | 权重 | 说明 |
|------|------|------|
| 业务根治 | 20% | 彻底解决核心问题，非临时规避 |
| 场景兼容 | 15% | 全量适配现有 Agent、多客户端、存量业务 |
| 故障安全 | 15% | 故障爆炸半径小，支持降级、安全回滚 |
| 工程契约 | 10% | 数据结构、Schema、数据流完全闭环 |
| 可工程化 | 10% | 支持自动化测试、CI 校验、探针监测 |
| 架构一致性 | 15% | 严格对齐项目 ARCHITECTURE.md |
| 长期演进 | 10% | 预留扩展点，支持增量迭代 |
| 边界健壮 | 5% | 兼容极端异常场景、隐性边界问题 |

### 5.2 评分矩阵

| 维度 (权重) | 方案 A (Swiss 纯粹) | 方案 B (精准校准) | 方案 C (系统重构) |
|-------------|---------------------|-------------------|-------------------|
| 业务根治 (20%) | 9 | 8 | 9 |
| 场景兼容 (15%) | 6 | 9 | 7 |
| 故障安全 (15%) | 6 | 9 | 6 |
| 工程契约 (10%) | 8 | 8 | 9 |
| 可工程化 (10%) | 7 | 8 | 9 |
| 架构一致性 (15%) | 9 | 9 | 7 |
| 长期演进 (10%) | 7 | 8 | 9 |
| 边界健壮 (5%) | 7 | 8 | 7 |
| **加权总分** | **7.45** | **8.35** | **7.85** |

### 5.3 评分依据

#### 方案 A — Swiss 纯粹主义（7.45 分）

| 维度 | 得分 | 理由 |
|------|------|------|
| 业务根治 | 9 | 彻底解决圆角哲学矛盾，回归 Swiss 本源 |
| 场景兼容 | 6 | 6px → 2px 变化影响全部 50+ 组件，用户感知明显 |
| 故障安全 | 6 | 改动面大，回滚需还原 50+ 文件 |
| 工程契约 | 8 | 文档与代码可完全同步 |
| 可工程化 | 7 | C6 脚本需同步更新允许集 |
| 架构一致性 | 9 | 严格对齐 Swiss 设计原则 |
| 长期演进 | 7 | 纯手工维护，无自动化令牌管理 |
| 边界健壮 | 7 | 2px 圆角在部分场景可能过于锐利 |

#### 方案 B — 精准校准·渐进演进（8.35 分）🏆

| 维度 | 得分 | 理由 |
|------|------|------|
| 业务根治 | 8 | 解决核心矛盾（文档 vs 代码不同步），承认 6px 现实 |
| 场景兼容 | 9 | 保持现有视觉风格，用户无感知变化 |
| 故障安全 | 9 | 渐进式改动，每批可独立回滚 |
| 工程契约 | 8 | 文档与代码同步，C6 脚本更新 |
| 可工程化 | 8 | 现有 CI 体系可直接复用 |
| 架构一致性 | 9 | 对齐 ARCHITECTURE.md，不引入新架构 |
| 长期演进 | 8 | 为后续 Style Dictionary 集成预留空间 |
| 边界健壮 | 8 | 6px 圆润在各种场景下表现稳定 |

#### 方案 C — 系统重构·长期演进（7.85 分）

| 维度 | 得分 | 理由 |
|------|------|------|
| 业务根治 | 9 | 从根源建立令牌管理系统 |
| 场景兼容 | 7 | 新工具链需适配现有构建流程 |
| 故障安全 | 6 | 改动最大，迁移风险最高 |
| 工程契约 | 9 | W3C DTCG 标准契约 |
| 可工程化 | 9 | Style Dictionary 自动生成 + CI 校验 |
| 架构一致性 | 7 | 引入新工具链，与当前 Tailwind v4 集成需适配 |
| 长期演进 | 9 | 最佳长期演进能力 |
| 边界健壮 | 7 | 新工具链的边界情况需时间验证 |

---

## 六、最优方案确定

### 6.1 选定方案：方案 B「精准校准·渐进演进」

**加权总分**: 8.35（最高）

**核心决策依据**:
1. **场景兼容性最高**（9 分）：不推翻用户已熟悉的 6px 圆润风格，无感知迁移
2. **故障安全性最高**（9 分）：渐进式改动，每批可独立回滚
3. **架构一致性最高**（9 分）：严格对齐现有 ARCHITECTURE.md，不引入新架构风险
4. **改动范围可控**：不引入新工具链，复用现有 CI 体系

### 6.2 明确牺牲项

| 牺牲项 | 说明 | 补偿措施 |
|--------|------|----------|
| Swiss 纯粹性 | 6px 圆润 vs 2px 锐利 | 文档明确记录"AgentSkin Swiss 6px 变体" |
| 部分 P2 微动画 | 保留 translate-y-px 等微动画 | 限制在 `:active` 状态，不影响 Swiss 纯粹性 |
| 令牌自动化 | 未引入 Style Dictionary | 中期可集成，当前手动维护 |

### 6.3 明确收益项

| 收益项 | 量化指标 |
|--------|----------|
| 文档同步 | 14 处不一致全部消除 |
| 圆角统一 | 50+ 处 `rounded-[2px]` 统一为 `rounded-sm`/`rounded-md` |
| 阴影合规 | 6 处违规全部清理 |
| 动画合规 | 6 处 P1 缩放动画移除 |
| CSS 体积 | 删除 30KB+ 未使用 Radix 导入 |
| 文件维护 | workspace.css 从 1396 行拆分为 6 个模块 |
| 工具类采用 | 从 0% 提升至 80%+ |

---

## 七、落地实施计划

### 7.1 第一批（P0 — 立即修复，预计 1-2 天）

#### B1. 圆角基线统一

**目标**: 消除 50+ 处 `rounded-[2px]` 与 6px 基线的矛盾

**方案**: 将 `rounded-[2px]` 统一替换为 `rounded-sm` (3.6px) — 保持锐利感同时与 6px 基线协调

**改动文件**:
- `src/ui/pages/ThemesPage.tsx` — 10 处
- `src/ui/pages/AppsPage.tsx` — 2 处
- `src/ui/pages/WorkspacePage.tsx` — 3 处
- `src/ui/pages/SettingsPage.tsx` — 1 处
- `src/ui/components/ui/textarea.tsx` — 1 处
- `src/ui/components/ui/tabs.tsx` — 1 处
- `src/ui/components/ui/input-group.tsx` — 1 处
- `src/ui/components/sidebar.tsx` — 1 处
- `src/ui/components/themes/ThemeCard.tsx` — 1 处
- 其他组件 — 约 30 处

**验证**: `npm run check` 全绿 + 视觉回归测试

#### B2. 阴影违规清理

**目标**: 清理 6 处非标准阴影

**改动清单**:

| 文件 | 行号 | 当前值 | 改为 |
|------|------|--------|------|
| `components/detail-panel.tsx` | 324 | `shadow-[inset_0_0_24px_var(--border)]` | `shadow-none` + `border border-border` |
| `styles/workspace.css` | 316 | `.pw[data-active]` 双阴影 | `shadow-float` |
| `styles/workspace.css` | 415 | `backdrop-filter: blur(8px)` | 移除，改用 `bg-card/95` |
| `styles/workspace.css` | 638 | `.ws-dock` 自定义阴影 | `shadow-float` |
| `components/sidebar.tsx` | 38 | `shadow-[inset_3px_0_0_var(--primary)]` | `border-l-[3px] border-primary` |
| `components/themes/ThemeCard.tsx` | 36 | `shadow-[inset_3px_0_0_var(--primary)]` | `border-l-[3px] border-primary` |

#### B3. 文档同步

**目标**: 消除 `design-tokens.md` 与 `globals.css` 的 14 处不一致

**改动**: 更新 `docs/design-tokens.md`：
- §2.1 `--brand-red` 值从 `#ff453a` 改为 `hsl(4 76% 60%)`
- §4.1 `--radius` 从 `2px` 改为 `6px`（对齐 `--radius-base`）
- §3.1 `--font-ui` 补充 `"Inter Variable", "Inter"`
- §6.1 时长值与代码对齐（120/180/260/400ms）
- §9.2 补充缺失的 `--cr-brand-violet` / `--cr-brand-amber` 或标记为 deprecated

### 7.2 第二批（P1 — 本迭代修复，预计 3-5 天）

#### B4. 缩放动画清理

**目标**: 移除 6 处 P1 缩放动画

**改动清单**:

| 文件 | 行号 | 当前值 | 改为 |
|------|------|--------|------|
| `components/apps/AppCard.tsx` | 101 | `hover:scale-[1.02]` | `hover:bg-accent/50` |
| `components/apps/AppCard.tsx` | 102 | `active:scale-95` | `active:bg-accent/70` |
| `components/rename-dialog.tsx` | 54 | `scale-in-95 animate-in zoom-in-95` | `animate-page-enter` |
| `components/workspace/WorkspaceQuickActions.tsx` | 44 | `group-hover/action:scale-105` | `group-hover/action:bg-accent` |
| `components/workspace/AgentStatusBar.tsx` | 231 | `group-hover/pill:scale-105` | `group-hover/pill:bg-accent` |
| `components/workspace/EnvironmentCard.tsx` | 177 | `group-hover/card:scale-105` | `group-hover/card:border-primary/40` |

#### B5. workspace.css 拆分

**目标**: 将 1396 行 workspace.css 拆分为 6 个模块

**目标结构**:
```
src/ui/styles/workspace/
  tokens.css         ← workspace-tokens.css 内容（114 行）
  layout.css         ← .ws-root grid 布局 + topbar + drawer + stage + inspector + statusbar
  dock.css           ← .ws-dock 及其子组件
  dialog.css         ← .ws-dialog 及其子组件
  components.css     ← .ws-btn, .ws-chip, .ws-badge, .ws-input 等通用组件
  animations.css     ← 过渡动画
```

**验证**: `npm run check` 全绿 + Studio 功能回归

#### B6. 删除未使用 Radix Colors 导入

**目标**: 移除 18 个未使用 Radix Colors 文件导入（-30KB+）

**改动**: `src/ui/globals.css` L2-17 删除所有 `@import "@radix-ui/colors/*.css"`

**验证**: `npm run check` 全绿 + 视觉回归测试

### 7.3 第三批（P2 — 下一迭代，预计 5-7 天）

#### B7. 动效时长阶梯统一

**目标**: 将 8 处非标准时长统一为 token 阶梯

**改动清单**:

| 当前值 | 改为 | 涉及文件 |
|--------|------|----------|
| `duration-300` | `duration-slow` (260ms) | AppsPage, InjectDock, AppDetailsDrawer |
| `duration-400` | `duration-slower` (400ms) | TitleBar, StatusBar |
| `duration-100` | `duration-fast` (120ms) | DropdownMenu |

#### B8. 工具类推广

**目标**: 将 `.as-label` / `.as-micro` / `.as-mono` 工具类采用率从 0% 提升至 80%+

**改动**: 替换 20+ 处 `font-mono text-[11px]` 字面量为 `.as-label` / `.as-micro` / `.as-mono`

#### B9. 页面容器 padding 统一

**目标**: 统一 4 个页面的容器 padding

**方案**: 统一为 `px-8 py-6`（当前多数页面已使用此值，仅需更新文档）

---

## 八、全量风险清单

### 8.1 选型风险

| 风险 | 等级 | 概率 | 影响 | 缓解措施 |
|------|------|------|------|----------|
| 6px 圆润风格与 Swiss 纯粹性偏差 | 中 | 高 | 中 | 文档明确记录"AgentSkin Swiss 6px 变体"，保留未来切换能力 |
| 渐进式改动周期较长 | 中 | 中 | 低 | 分三批迭代，每批独立交付 |
| 工具类推广可能遗漏 | 低 | 中 | 低 | 新增 ESLint 规则强制检查 |

### 8.2 落地风险

| 风险 | 等级 | 概率 | 影响 | 缓解措施 |
|------|------|------|------|----------|
| 圆角统一可能影响部分组件视觉 | 中 | 中 | 中 | 每批改动后运行视觉回归测试 |
| workspace.css 拆分可能引入回归 | 中 | 低 | 高 | 拆分后 Studio 全功能回归测试 |
| 删除 Radix 导入可能影响隐藏依赖 | 低 | 低 | 中 | 全局搜索确认无变量引用 |

### 8.3 边界限制

| 限制 | 说明 |
|------|------|
| 不引入新工具链 | 当前方案不引入 Style Dictionary / Vanilla Extract，留待中期评估 |
| 不修改 CDP 注入层 | L0-L4 注入层不在本次改动范围 |
| 不新增 UI 页面 | 遵守六页封顶约束 |
| 不修改 14-token 契约 | 遵守 THEME_SPEC.md 不变量 |

---

## 九、分级下一步行动

### 9.1 优先执行（本周）

| # | 行动 | 预计工时 | 负责 |
|---|------|----------|------|
| 1 | 圆角基线统一（50+ 处 `rounded-[2px]` → `rounded-sm`） | 4h | 开发 |
| 2 | 阴影违规清理（6 处） | 2h | 开发 |
| 3 | 文档同步（14 处不一致） | 2h | 开发 |
| 4 | 删除未使用 Radix Colors 导入 | 0.5h | 开发 |
| 5 | `npm run check` 全绿验证 | 0.5h | CI |

### 9.2 暂缓执行（本迭代）

| # | 行动 | 预计工时 | 条件 |
|---|------|----------|------|
| 6 | 缩放动画清理（6 处 P1） | 3h | 第一批完成后 |
| 7 | workspace.css 拆分 | 6h | 第一批完成后 |
| 8 | 动效时长阶梯统一 | 2h | 第二批完成后 |
| 9 | 工具类推广 | 4h | 第二批完成后 |

### 9.3 中期评估（下迭代）

| # | 行动 | 预计工时 | 条件 |
|---|------|----------|------|
| 10 | Style Dictionary 集成评估 | 8h | 三批全部完成后 |
| 11 | cmdk 命令面板重构 | 6h | 评估通过后 |
| 12 | react-colorful 集成 | 2h | Theme Studio 增强时 |
| 13 | virtua 虚拟列表替换 | 4h | 性能优化阶段 |

### 9.4 舍弃项

| # | 行动 | 舍弃原因 |
|---|------|----------|
| 1 | 圆角降回 2px | 6px 圆润已成为产品现实，推翻成本过高 |
| 2 | CSS-in-JS 迁移 | Electron 单窗口应用运行时开销不值得 |
| 3 | 全面重构 CSS 架构 | 当前 Tailwind v4 集成方案已足够优秀 |

---

## 十、验收标准

### 10.1 第一批验收

- [ ] `npm run check` 全绿（typecheck + biome + vitest + C6）
- [ ] 50+ 处 `rounded-[2px]` 全部替换为 `rounded-sm` 或 `rounded-md`
- [ ] 6 处阴影违规全部清理
- [ ] `design-tokens.md` 14 处不一致全部消除
- [ ] 18 个 Radix Colors 导入全部删除
- [ ] 视觉回归测试通过（无意外变化）

### 10.2 第二批验收

- [ ] 6 处 P1 缩放动画全部移除
- [ ] workspace.css 拆分为 6 个模块文件
- [ ] Studio 全功能回归测试通过

### 10.3 第三批验收

- [ ] 8 处动效时长全部统一为 token 阶梯
- [ ] 工具类采用率 ≥ 80%
- [ ] 页面容器 padding 统一

---

## 附录 A：审计覆盖文件清单

### 页面文件
- `src/ui/pages/SettingsPage.tsx` (436 行)
- `src/ui/pages/AppsPage.tsx` (317 行)
- `src/ui/pages/WallpaperEnginePage.tsx` (327 行)
- `src/ui/pages/WorkspacePage.tsx` (467 行)
- `src/ui/pages/ThemesPage.tsx` (345 行)

### 基础组件
- `src/ui/components/ui/button.tsx` (61 行)
- `src/ui/components/ui/input.tsx` (21 行)
- `src/ui/components/ui/dialog.tsx` (131 行)
- `src/ui/components/ui/badge.tsx` (51 行)
- `src/ui/components/ui/textarea.tsx`
- `src/ui/components/ui/tabs.tsx`
- `src/ui/components/ui/checkbox.tsx`
- `src/ui/components/ui/input-group.tsx`
- `src/ui/components/ui/tooltip.tsx`
- `src/ui/components/ui/navigation-menu.tsx`
- `src/ui/components/ui/dropdown-menu.tsx`
- `src/ui/components/ui/select.tsx`
- `src/ui/components/ui/popover.tsx`
- `src/ui/components/ui/sheet.tsx`
- `src/ui/components/ui/progress.tsx`
- `src/ui/components/ui/scroll-area.tsx`
- `src/ui/components/ui/segmented-control.tsx`
- `src/ui/components/ui/switch.tsx`
- `src/ui/components/ui/accordion.tsx`
- `src/ui/components/ui/spinner.tsx`

### 业务组件
- `src/ui/components/sidebar.tsx` (167 行)
- `src/ui/components/title-bar.tsx` (171 行)
- `src/ui/components/status-bar.tsx` (171 行)
- `src/ui/components/inject-dock.tsx` (94 行)
- `src/ui/components/detail-panel.tsx` (335 行)
- `src/ui/components/rename-dialog.tsx` (90 行)
- `src/ui/components/apps/AppCard.tsx` (120 行)
- `src/ui/components/apps/AppDetailsDrawer.tsx` (85 行)
- `src/ui/components/themes/ThemeCard.tsx` (50 行)
- `src/ui/components/themes/VirtualThemeGrid.tsx` (126 行)
- `src/ui/components/wallpaper/WallpaperCard.tsx`
- `src/ui/components/wallpaper/InjectResultsPanel.tsx`
- `src/ui/components/workspace/AgentStatusBar.tsx`
- `src/ui/components/workspace/WorkspaceQuickActions.tsx`
- `src/ui/components/workspace/EnvironmentCard.tsx`
- `src/ui/components/workspace/AgentLivePreview.tsx`
- `src/ui/components/workspace/TweakPanel.tsx`
- `src/ui/components/diagnostics/DriftStatusPanel.tsx`
- `src/ui/components/diagnostics/PerformancePanel.tsx`
- `src/ui/components/studio/ContrastBadge.tsx` (66 行)
- `src/ui/components/studio/center/CenterTabThemeEditor.tsx`
- `src/ui/components/studio/center/CenterTabBundle.tsx`
- `src/ui/components/studio/center/ExtendedColorsEditor.tsx`
- `src/ui/components/studio/PreviewWindow.tsx`
- `src/ui/components/studio/InspectorProfile.tsx`
- `src/ui/components/studio/StudioTopBar.tsx`
- `src/ui/components/studio/StudioTitleBar.tsx`
- `src/ui/components/studio/StudioCenterPanel.tsx`
- `src/ui/components/studio/StudioDrawer.tsx`
- `src/ui/components/studio/StudioInspector.tsx`
- `src/ui/components/studio/StudioImageToThemePanel.tsx`
- `src/ui/components/studio/WorkspaceSwitcher.tsx`
- `src/ui/components/studio/WorkspaceDialog.tsx`
- `src/ui/components/studio/Toolbox.tsx`
- `src/ui/components/studio/kicker.tsx`
- `src/ui/components/studio/dock-internals.tsx`
- `src/ui/components/studio/center/TokenToolbar.tsx`
- `src/ui/components/studio/center/CenterTabDesignLanguage.tsx`
- `src/ui/components/install-progress.tsx`
- `src/ui/components/app-mark.tsx`
- `src/ui/components/logo.tsx`
- `src/ui/components/dynamic-background.tsx`

### CSS 文件
- `src/ui/globals.css` (671 行)
- `src/ui/shadcn-tailwind.css` (610 行)
- `src/ui/styles/workspace-tokens.css` (129 行)
- `src/ui/styles/workspace.css` (1626 行)

### 文档与脚本
- `docs/design-tokens.md` (全文)
- `scripts/check-design-tokens.mjs` (180 行)

---

## 附录 B：GitHub 对标项目完整清单

| # | 项目 | GitHub | Stars | License | 契合度 | 移植优先级 |
|---|------|--------|-------|---------|--------|------------|
| 1 | shadcn/ui | https://github.com/shadcn-ui/ui | 121k | MIT | 10/10 | P0（已采用） |
| 2 | Radix Primitives | https://github.com/radix-ui/primitives | 19.1k | MIT | 9/10 | P0（已采用） |
| 3 | cmdk | https://github.com/pacocoursey/cmdk | 12.8k | MIT | 9/10 | P1 |
| 4 | dnd-kit | https://github.com/clauderic/dnd-kit | 16.8k | MIT | 9/10 | P2 |
| 5 | Ark UI | https://github.com/chakra-ui/ark | 350k org | MIT | 8/10 | P3 |
| 6 | react-colorful | https://github.com/omgovich/react-colorful | 3.5k | MIT | 8/10 | P1 |
| 7 | virtua | https://github.com/inokawa/virtua | 3.5k | MIT | 8/10 | P1 |
| 8 | swisspost/design-system | https://github.com/swisspost/design-system | 活跃 | MIT | 7/10 | P2 |
| 9 | motion-primitives | https://github.com/ibelick/motion-primitives | 5.6k | MIT | 7/10 | P3 |
| 10 | motion | https://github.com/motiondivision/motion | 活跃 | MIT | 7/10 | P2 |
| 11 | segmented | https://github.com/react-component/segmented | 活跃 | MIT | 7/10 | P3 |
| 12 | react-window | https://github.com/bvaughn/react-window | 经典 | MIT | 6/10 | P4 |
| 13 | tailwindcss-motion | https://github.com/romboHQ/tailwindcss-motion | 活跃 | MIT | 5/10 | P4 |
| 14 | kbar | https://github.com/timc1/kbar | 活跃 | MIT | 5/10 | P4 |
| 15 | tw-animate-css | https://github.com/Wombosvideo/tw-animate-css | 760 | MIT | 5/10 | P3 |

---

**报告生成**: 2026-08-21  
**审计方法**: 多子智能体并行分析 + 交叉质询 + 多维加权评估  
**结论**: 方案 B「精准校准·渐进演进」以 8.35 分胜出，建议按三批迭代执行。
