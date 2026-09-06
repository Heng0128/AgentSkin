# 竞品项目深度分析报告 — 第 5 轮

> 执行时间: 2026-08-28 11:00
> 分析范围: 图片驱动换肤 + Agent Skills 架构 + 多页面 CDP + 编辑器模型
> 深度分析 4 个高价值项目（1 个项目仓库不存在）

---

## 一、本轮分析目标

本轮聚焦**前几轮未覆盖**的高价值项目，重点关注：
- 图片驱动的主题自动生成（降低创作门槛）
- Agent Skills 架构（AI 可执行的指令层）
- 多页面 CDP 支持（复杂窗口场景）
- 主题编辑器模型（Open Scene Model）

## 二、项目总览

| # | 项目 | Stars | License | 语言 | 最近更新 | 核心亮点 |
|---|------|-------|---------|------|---------|---------|
| 1 | CodeDrobe/skills | 245 | Apache-2.0 | CSS | 2026-08-27 | Agent Skills 仓库 + 分层验证 + DOM 隐私快照 |
| 2 | cdredfox/workbuddy-skin-studio | 168 | MIT | JavaScript | 2026-08-26 | 图片取色算法 + SKILL.md + 零依赖 |
| 3 | Finderchangchang/codex-autoskin | 117 | MIT | JavaScript | 2026-08-24 | THEME-SPEC.md + Agent-native + 安全机制 |
| 4 | xuhuanstudio/codex-styler | 14 | Apache-2.0 | TypeScript | 2026-08-27 | Open Scene Model + 多页面 CDP + 2D Companions |
| 5 | comeonzhj/WorkBuddy-theme-skill | — | — | — | — | ⚠️ 仓库不存在 |

---

## 三、深度分析摘要

### 3.1 CodeDrobe/skills — Agent Skills 架构标杆

**定位**: AI 桌面应用换肤的 Agent Skills 仓库（指令层，无运行时）

**核心架构**:
- 四仓库分离: core(运行时) / skills(指令层) / desktop(管理器) / store(商店)
- 双 Skill 结构: codedrobe-theme(面向用户) + codedrobe-adapter-dev(面向维护者)
- 适配器定义完整契约: id/platforms/verification/matchTarget

**技术亮点**:
1. **DOM Snapshot 隐私边界** — 排除文本/表单值/链接，保留选择器候选+几何位置+计算样式
2. **选择器优先级体系** — 4 级优先级（稳定id → 语义类 → 结构选择器 → 生成类）
3. **分层验证节点** — rootAny(阻塞) / required(跨路由) / recommended(可隐藏) / contexts(上下文)
4. **双阶段验证** — probe(预检) + verify(确认)
5. **CSS 模板结构** — 8 段式顺序规范

**与 AgentSkin 对比**:
- CodeDrobe 无统一 token 契约，CSS 变量自由定义
- AgentSkin 的 14-token 契约更严格、更稳定
- CodeDrobe 的验证节点分层更细粒度

**可借鉴点（按可行性排序）**:
1. ⭐⭐⭐ DOM Snapshot 隐私边界 — 优化 AgentSkin 的 DOM 分析
2. ⭐⭐⭐ 选择器优先级体系 — 强化适配器选择器规范
3. ⭐⭐⭐ 双阶段验证 — 分离验证为预检+确认
4. ⭐⭐ 参考图工作流 — Visual Analyzer 参考流程
5. ⭐⭐ CSS 模板结构 — 规范主题 CSS 组织

---

### 3.2 cdredfox/workbuddy-skin-studio — 图片驱动换肤标杆

**定位**: 纯 Node.js 零依赖的 WorkBuddy 换肤工具

**核心架构**:
- 零第三方依赖，仅 Node.js 内置模块
- 单文件 CDP 客户端（CdpSession 类）
- CSS 变量覆盖（--cb-* 60+ 个）+ color-mix 动态半透明

**技术亮点**:
1. **图片→主题取色算法** — 色相分桶(6扇区×2饱和度) + 饱和度平方加权
2. **SKILL.md 模式** — AI Agent 可执行操作手册（YAML frontmatter + Markdown）
3. **零依赖纯 Node.js** — 手写 PNG 编码 + CDP WebSocket
4. **深浅色自动适配** — 亮度阈值 140 判断 light/dark

**与 AgentSkin 对比**:
- workbuddy-skin-studio 是单层 CSS 注入，无编排层
- AgentSkin 四引擎分层架构更复杂但支持深度适配
- 两者都支持可逆注入

**可借鉴点（按可行性排序）**:
1. ⭐⭐⭐ SKILL.md 模式 — 外部 AI 自动安装 AgentSkin 的操作手册
2. ⭐⭐⭐ 客户端图片取色算法 — "上传图片自动生成主题"
3. ⭐⭐ 单文件 CDP 客户端错误处理 — CdpProtocolError/CdpEvaluationError 分级
4. ⭐⭐ color-mix 模式 — 减少硬编码颜色值
5. ⭐ 零依赖理念 — CLI 工具保持轻量

---

### 3.3 Finderchangchang/codex-autoskin — Agent-native 换肤引擎

**定位**: "发一张图，Codex 自己给自己换肤" 的单应用换肤引擎

**核心架构**:
- 主题即纯数据（themes/<name>/ = theme.json + art.png + extra.css）
- 注入守护进程扫描主题目录 + 动态生成 manifest
- 页面内运行时（renderer-inject.js）管理状态 + MutationObserver 自动恢复

**技术亮点**:
1. **THEME-SPEC.md** — 写给 AI Agent 读的"作业指导书"，28 个 token 的取法与验收清单
2. **图片→主题自动转换** — quick-theme.ps1 30 秒出 80 分初版
3. **安全机制** — 双栈探测 + 防抖 + 熔断 + 限频 + 单实例锁
4. **QA Inventory** — 三层测试清单（功能/视觉/探索）

**与 AgentSkin 对比**:
- codex-autoskin 是 28-token（含 art crop/overlay/hero 文案），AgentSkin 是 14-token
- codex-autoskin 无 UI，纯 CLI + Agent；AgentSkin 有完整 Electron UI
- 两者都有可逆注入机制

**可借鉴点（按可行性排序）**:
1. ⭐⭐⭐ THEME-SPEC.md 模式 — 为 AgentSkin 编写 Agent 可读的主题生成规范
2. ⭐⭐⭐ 图片→主题自动转换 — 降低创作门槛
3. ⭐⭐⭐ QA Inventory 体系 — 三层测试清单保障质量
4. ⭐⭐ Watcher 安全机制 — 双栈探测 + 防抖 + 熔断 + 限频
5. ⭐ 28-Token 精细化 — 增加 art crop/overlay 等 token（需评估兼容性）

---

### 3.4 xuhuanstudio/codex-styler — 主题编辑器模型探索

**定位**: 以图片驱动、可逆运行为安全边界的单应用主题编辑器

**核心架构**:
- 四层运行时边界: Desktop Manager / Theme Engine / Versioned Adapter / Injected Scene
- Tauri (Rust) + React + Astro + pnpm monorepo
- 主题包纯数据（禁止脚本/CSS/SVG/视频/远程URL）

**技术亮点**:
1. **Open Scene Model** — layers/entities/renderer/behaviors 语义抽象，主题不依赖 Codex DOM
2. **Multi-page CDP Targets** — 并发评估 + 就绪检查 + 3 次连续稳定采样
3. **2D Companions** — 可拖拽桌面宠物 + Companion Studio 七步工作流
4. **Composer Interactions** — 五种短时主题自适应交互玩法
5. **双模式安全策略** — Enhanced / Conservative

**与 AgentSkin 对比**:
- codex-styler 是 Tauri，AgentSkin 是 Electron
- codex-styler 单应用深度优化，AgentSkin 多应用覆盖
- Open Scene Model 是统一场景图抽象，AgentSkin 是分层注入

**可借鉴点（按可行性排序）**:
1. ⭐⭐⭐ Multi-page CDP 并发评估 — 解决多窗口/多标签目标选择
2. ⭐⭐ Enhanced/Conservative 双模式 — 兼容性回退选项
3. ⭐⭐ 修订感知 session reducer — 防止过时响应覆盖
4. ⭐ 红acted diagnostics ZIP — 增强排障能力
5. ⭐ Open Scene Model — 长期参考，需评估复杂度成本

---

## 四、跨项目共性与差异分析

### 4.1 共性趋势

| 趋势 | 涉及项目 | 说明 |
|------|---------|------|
| **图片驱动创作** | workbuddy-skin-studio, codex-autoskin, codex-styler | 降低主题创作门槛，用户上传图片自动生成主题 |
| **Agent 集成** | CodeDrobe/skills, codex-autoskin, workbuddy-skin-studio | AI Agent 参与主题生成/安装/验证 |
| **可逆注入** | 全部 | 所有项目都强调不修改官方文件、可还原 |
| **零/低依赖** | workbuddy-skin-studio, codex-autoskin | 纯 Node.js 实现，减少依赖膨胀 |
| **SKILL.md 模式** | CodeDrobe/skills, workbuddy-skin-studio, codex-autoskin | 结构化 Markdown 作为 AI 可执行文档 |

### 4.2 架构差异

| 维度 | CodeDrobe | workbuddy-skin-studio | codex-autoskin | codex-styler |
|------|-----------|---------------------|----------------|--------------|
| **复杂度** | 中（指令层） | 低（单层注入） | 中（守护+运行时） | 高（四层边界） |
| **目标应用** | 4 个 | 1 个 | 1 个 | 1 个 |
| **运行时** | 外部 CLI | 自包含 | 自包含 | Tauri 应用 |
| **UI** | 无（纯 Skill） | 页面内菜单 | 无（CLI+Agent） | 完整编辑器 |
| **主题格式** | JSON manifest | 4色+hero图 | 28-token JSON | 纯数据包 |

---

## 五、Top 可借鉴方案（按优先级排序）

### 🥇 方案 A: THEME-SPEC.md 模式（Agent 可读主题规范）

**来源**: codex-autoskin
**可行性**: ⭐⭐⭐ 高
**价值**: 让 AI Agent 成为主题生成器，用户上传图片 + Agent 辅助创建主题

**实施路径**:
1. 基于 AgentSkin 14-token 体系，编写 Agent 可读的主题生成规范文档
2. 定义每个 token 的取法、从图片映射的方法、验收标准
3. 添加决策树（干净艺术图 vs 带字截图 → 不同策略）
4. 明确禁止事项（不改引擎文件、不遮挡控件、不用真人肖像）

**预期收益**: 大幅降低主题创作门槛，与 AgentSkin 的 AI Agent 定位高度契合

---

### 🥈 方案 B: 图片→主题自动转换（Visual Analyzer 增强）

**来源**: workbuddy-skin-studio, codex-autoskin
**可行性**: ⭐⭐⭐ 高
**价值**: 用户上传图片自动生成主题，30 秒出 80 分初版

**实施路径**:
1. 实现客户端取色算法（色相分桶 + 饱和度平方加权）
2. 从 4 色扩展到 14-token 映射（需额外规则补充）
3. 集成到 Theme Studio 的"图片导入"功能
4. 支持明暗路线自动判定

**预期收益**: 与 THEME-SPEC.md 配合，形成"图片→自动主题→Agent 精修"完整闭环

---

### 🥉 方案 C: SKILL.md 模式（外部 AI 可执行手册）

**来源**: workbuddy-skin-studio, CodeDrobe/skills
**可行性**: ⭐⭐⭐ 高（纯文档）
**价值**: 让外部 AI（Claude/Cursor）能自动执行 AgentSkin 的部署和换肤

**实施路径**:
1. 编写 AgentSkin 安装/换肤的 SKILL.md 操作手册
2. 定义触发条件、前置条件、平台检测、工作流、Guardrails
3. 添加验证步骤（doctor/status/--check 三重验证）

**预期收益**: 扩展 AgentSkin 的 AI 集成能力，降低非技术用户使用门槛

---

### 方案 D: 双阶段验证机制

**来源**: CodeDrobe/skills
**可行性**: ⭐⭐ 中
**价值**: 将验证分离为预检+确认，提升注入可靠性

**实施路径**:
1. 将现有 check-themes 拆分为 probe（预检）+ verify（确认）两阶段
2. probe 阶段验证适配器地标 + 主题上下文
3. verify 阶段确认已安装主题的 id/version/样式/图片

**预期收益**: 更早发现问题，减少注入失败后的回滚成本

---

### 方案 E: Multi-page CDP 并发评估

**来源**: codex-styler
**可行性**: ⭐⭐ 中
**价值**: 解决多窗口/多标签场景下的目标选择问题

**实施路径**:
1. 并发评估所有 loopback CDP page
2. 实时就绪检查 + 3 次连续稳定采样
3. 失败时进入可操作错误状态

**预期收益**: 提升 codex 适配器在多窗口场景下的健壮性

---

## 六、风险与注意事项

### 6.1 不可借鉴的方面

| 项目 | 不可借鉴 | 原因 |
|------|---------|------|
| CodeDrobe | 商店系统 | 与 AgentSkin "无服务端" 定位冲突 |
| CodeDrobe | 自由 CSS 变量模式 | 破坏 AgentSkin 14-token 契约 |
| codex-styler | 2D Companions | AgentSkin 禁止 Studio 新增创作类功能 |
| codex-styler | Tauri 替代 Electron | 迁移成本极高 |
| codex-autoskin | 28-token 直接照搬 | 需评估与 14-token 的兼容性 |

### 6.2 借鉴原则

1. **只学习设计思想，不直接复制代码**
2. **保持 AgentSkin 14-token 契约不变**
3. **保持四引擎分层架构不变**
4. **新增功能需 RFC 评审**
5. **所有改动必须可测试、可回滚**

---

## 七、下一步行动建议

### 短期（本次执行）
1. ✅ 输出竞品分析报告
2. 🔄 执行方案 A（THEME-SPEC.md 模式）
3. 🔄 执行方案 B（图片→主题自动转换）
4. 🔄 执行方案 C（SKILL.md 模式）

### 中期（后续轮次）
5. 执行方案 D（双阶段验证）
6. 执行方案 E（Multi-page CDP）
7. 持续关注 CodeDrobe/skills 的演进（245 stars，活跃）

### 长期观察
8. codex-styler 的 Open Scene Model 成熟度
9. codex-autoskin 的 THEME-SPEC.md 迭代
10. workbuddy-skin-studio 的取色算法优化

---

## 八、仓库不存在说明

**comeonzhj/WorkBuddy-theme-skill** 仓库经多次验证确认不存在：
- 作者 comeonzhj 的 GitHub 主页仅有 6 个公开仓库，无 WorkBuddy 相关
- 直接访问返回失败
- 关键词搜索无匹配结果

可能原因：仓库已删除、设为私有、或拼写有误。已跳过此项目。

---

*分析基于 2026-08-28 公开可获取的 GitHub 仓库信息。所有分析均基于实际获取的 README、文档、目录结构和提交历史。*
