# RFC：原生硬编码视觉缺陷修正规则收敛（Native Defect Fixes Consolidation）

> 状态：`待评审`
> 日期：2026-08-18
> 分支：`（待建）`
> 范围：`scripts/native-defect-fixes.mjs`（新）、`scripts/check-native-defect-consistency.mjs`（新）、`scripts/generators/{traework,qoderwork,workbuddy,doubao,codex,zcode}Css.mjs`、`engines/{traework,qoderwork,workbuddy,doubao,codex,zcode}/adapter.mjs`
> 上游依据：本会话 traework 气泡圈/导航遮罩/阴影带排查

---

## 1. 背景与目标

用户反复遇到：创建/重建主题后，被消除过的"阴影、圆角、灰底"又出现。本次排查确认根因有**两层**：

1. **临时性故障**：`engines/traework/adapter.mjs` 模板字符串内未转义反引号 → 适配器执行失败 → 结构修正未注入（已修，见 session）。
2. **结构性缺口**：缺陷修正规则**无单一来源**。同一套"消除原生硬编码 box-shadow / 渐变 mask / 灰底"的规则，在**生成器**（Node 侧）与 **adapter**（浏览器注入、自包含字符串）两层各手写一份，维护时极易漂移、漏改。用户因此担心"创建新主题时不知道这些规则，用了自己的规则"。

用户选定方向：**收敛成共享模块**。

**目标**：

- 缺陷修正规则**单一来源（Place of Truth）**落在 Node 侧共享模块。
- 6 个生成器调用共享模块 → **创建任意新主题自动带全**，无需额外心智。
- adapter 保持自包含（浏览器注入可执行），通过**一致性校验**守护与共享来源同步，杜绝漂移。
- 不改变注入架构 L0-L4；不改 manifest / 14-token 契约；不加适配器；不加 UI 页面。

**非目标**：

- 不重构注入层流程。
- 不收敛表面样式（毛玻璃、设计 token 覆盖、艺术层等）——仅收敛"消除原生硬编码缺陷"这一**子集**（box-shadow / background[image] / mask 渐变 / 灰/实底色 的清除）。
- 不做像素级还原。

---

## 2. 触发条件（对照 AGENTS.md §6）

- [x] 重构注入架构（L0-L4）→ **否**。不改注入流程，仅统一注入内容的 CSS 来源。但改动触及全部 6 个 adapter 与 6 个生成器，属**核心适配层**批量修改，按谨慎原则提交 RFC 评审。
- [ ] 新增 UI 页面
- [ ] 新增适配器
- [ ] 修改核心数据模型（manifest schema、14-token 契约等）→ 否

> 裁决：提交 RFC 评审后方实施。不突破六页封顶 / 六适配器上限，不修改主题契约。

---

## 3. 现状侦察（调研结论）

### 3.1 两层均有缺陷修正规则，且重复

`theme-utils.mjs` 已提供 `artLayerCss / sharedChromeRules / shellTokenOverrides / shellStructureCss / HOSTS / tokenBlock`，但**没有任何缺陷修正函数**。当前缺陷修正是各 agent 手动写在两处：

| agent | adapter STRUCTURAL_CSS 缺陷规则 | 生成器对应行 | 重复 |
|-------|--------------------------------|--------------|------|
| traework | 气泡 box-shadow（L158）、`user-message__text-box` 灰底（L174）、`user-message-navigator__mask` 渐变（L187） | traeworkCss.mjs L193-222 | **完全重复** |
| qoderwork | 聊天区阴影/背景图、任务列表底部渐变、用户消息面包屑/灰底、代码块背景（L100-466 分散） | qoderworkCss.mjs（待迁移） | 重复 |
| doubao | 输入区阴影、建议卡阴影+模糊、输入框伪元素边框（L146-615 分散） | doubaoCss.mjs L618-697 | 重复 |
| workbuddy | 聊天区阴影、主内容/输入区背景图、输入区灰底（L123-306） | workbuddyCss.mjs（待迁移） | 重复 |
| codex | 输入框阴影（L172-176） | codexCss.mjs L51-55 | 重复 |
| zcode | 气泡阴影、用户消息背景/背景图/边框、输入区阴影（L154-238） | zcodeCss.mjs（待迁移） | 重复 |

### 3.2 硬约束

- 6 个 adapter 均为**单块自包含字符串**（`const STRUCTURAL_CSS = \`...\``，经 `Sheet.replaceSync` 注入），作为文本注入浏览器执行，**不能 `import` Node 模块**。
- 6 个生成器均为纯函数，**可 `import` 共享模块**。

> 结论：外层（生成器/主题）能做到真正单一来源；adapter 因自包含限制只能"内嵌 + 校验守护"。

---

## 4. 设计

### 4.1 共享模块 `scripts/native-defect-fixes.mjs`（新）

```js
/** 单条缺陷修正规则：淘汰 selectors 命中元素上的原生硬编码视觉缺陷 */
export type NativeDefectRule = {
  label: string;          // 稳定标识，如 'chat-bubble-shadow'
  note: string;           // 一句话说明修的哪个原生缺陷（供维护）
  selectors: string[];    // 作用于 host 后代，函数会自动前置 hostScope
  props: string[];        // 形如 'box-shadow: none !important'
};

export const NATIVE_DEFECT_FIXES: Record<AgentId, NativeDefectRule[]> = { ... };

/** 生成 host 作用域下的缺陷修正 CSS 段落（无颜色注入，主题无关） */
export function nativeDefectFixCss(agent, hostScope): string
```

- `props` 仅允许"清除类"值（none/transparent），**不注入主题颜色**，保证主题无关、可用同一份注册表同时驱动生成器与 adapter。
- `hostScope` 默认取 `HOSTS[agent]`（复用 `theme-utils.mjs` 的 `HOSTS`）。

### 4.2 生成器接入（P0-P2 主战场）

各 `generators/<agent>Css.mjs` 把手写缺陷段落替换为拼接 `nativeDefectFixCss(agent, HOSTS[agent])`。效果：`generate-theme-css` 对任意新主题自动带上全部缺陷修正——直接消除"创建主题不知规则"的痛点。

### 4.3 adapter 一致性守护（P2）

新增 `scripts/check-native-defect-consistency.mjs`：解析每个 `adapter.mjs` 的 `STRUCTURAL_CSS`，提取缺陷修正规则并**与共享注册表比对**（选择器 + 清除属性），漂移即非零退出。并入 `npm run check`（与 C3 palette-CSS staleness 同思路，见 AGENTS.md §4）。

### 4.4 可选（P3，不阻塞本 RFC）

主进程注入时，将 `nativeDefectFixCss()` 生成的段落作为**独立 adoptedStyleSheet** 随注入写入（类似 tokens.css / cosmetic.css 的读取方式），使运行时也吃单一来源，`adapter.mjs` 内不再内嵌缺陷规则。**若 P3 落地，4.3 校验脚本相应放宽**。

---

## 5. 共享 API 草案

- `NATIVE_DEFECT_FIXES`（注册表，按 agent 索引）
- `nativeDefectFixCss(agent, hostScope?) => string`
- `getNativeDefectRules(agent) => NativeDefectRule[]`（供校验脚本复用）

依赖：`theme-utils.mjs` 的 `HOSTS`（避免 magic-string 重复）。

---

## 6. 阶段计划

| 阶段 | 内容 | 验收 |
|------|------|------|
| **P0** | 建 `native-defect-fixes.mjs`，先落地 **traework** 3 组规则；`traeworkCss.mjs` 接入共享函数（删除手写重复段） | `npm run generate:theme-css -- --verify` 绿；traework 生成 CSS 语义不变 |
| **P1** | 迁移其余 5 个 agent 的生成器（逐个核对当前手写规则后落地注册表） | 全部生成器接入共享，`--verify` 绿 |
| **P2** | adapter 内嵌对齐 + `check-native-defect-consistency.mjs` 并入 `npm run check` | `npm run check` 全绿 |
| **P3 可选** | 主进程将共享缺陷 CSS 作为独立层注入，adapter 去重 | 运行时吃单一来源 |

每阶段独立评审/回退；P0 先行以最小代价验证方案可行性。

---

## 7. 风险与回退

- **风险**：为收敛而批量改动 12+ 文件引入回归。缓解：P0 单 agent 先行、每阶段 `npm run check` + 人工 smoke；共享函数**仅抽取、不改语义**。
- **回退**：逐文件 `git revert`；注册表条目删除即可恢复手写段落，无残留。
- **兼容**：不改主题 manifest、不改 14-token、不改注入协议，现有主题 CSS 及注入行为不变。

---

## 8. 验收标准

- `npm run check` 全绿（含新的一致性校验）。
- `npm run generate:theme-css -- --verify` 全绿。
- traework 缺陷修正规则在生成器输出与 adapter 内嵌**一致**且与注册表一致。
- 新建任一主题后，`user-message__text-box` / `user-message-navigator__mask` / 气泡阴影等自动被修正，无需手改。