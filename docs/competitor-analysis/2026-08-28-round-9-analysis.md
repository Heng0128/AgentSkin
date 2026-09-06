# 竞品项目深度分析报告 — 第 9 轮

> 执行时间: 2026-08-28 15:00
> 分析范围: 桌面宠物 + WorkBuddy 专项换肤 + 动态视觉主题 + 跨平台管理器 + 原生桥接
> 深度分析 5 个高价值项目

---

## 一、本轮分析目标

本轮聚焦**前几轮未覆盖**的高价值项目，重点关注：
- 桌面宠物与 AI 编码 Agent 实时联动（积累型伙伴系统）
- WorkBuddy 专项换肤工具（直接关联 AgentSkin workbuddy 适配器）
- 动态视觉主题系统（呼吸动效 + CDP 运行时渲染）
- 跨平台皮肤管理器（零残留清理机制）
- 原生桥接 tweak 系统（Owl 运行时 + Metal 加速）

## 二、项目总览

| # | 项目 | Stars | License | 语言 | 最近更新 | 核心亮点 |
|---|------|-------|---------|------|---------|---------|
| 1 | rullerzhou-afk/clawd-on-desk | 6,054 | AGPL-3.0 | JavaScript | 2026-08-28（今日） | 桌面宠物 + Agent 实时联动 + TraeCode 集成 |
| 2 | zhouwei713/WorkBuddy-Dream-Skin | 20 | MIT | CSS | 2026-08-26 | 图片驱动换肤 + Windows 托盘 + 自动化审计 |
| 3 | lntomF/codexskin | 14 | MIT | Rust | 2026-07-27 | 动态视觉主题 + 呼吸动效 + CDP 运行时渲染 |
| 4 | ZhjGo/codex-skin-manager | 25 | 无 | CSS | 2026-08-17 | 跨平台管理器 + 零残留清理 + 底色同步 |
| 5 | b-nnett/codex-plusplus | 3,749 | MIT | JavaScript | 2026-05-31 | Tweak 系统 + 原生桥接 + Owl 运行时 |

---

## 三、深度分析摘要

### 3.1 rullerzhou-afk/clawd-on-desk — 桌面宠物与 Agent 实时联动 (6,054⭐)

**定位**: 像素桌面宠物，实时监控 AI 编码 Agent（Claude Code、Codex、Cursor、Copilot、Gemini、Antigravity、Qwen 等）状态并做出反应。

**核心架构**:
- SVG 像素艺术动画系统
- 多 Agent 状态监听（通过终端输出/文件系统/进程检测）
- 15+ 状态机（sleep/thinking/typing/grooving/juggling/celebrate/permission bubble 等）
- 跨平台支持（Windows/macOS/Linux）
- 快捷键系统 + 权限气泡队列

**技术亮点**:

1. **Agent 实时联动** — 宠物根据 Agent 当前状态实时反应：思考时打字、多 subagent 时杂耍、完成任务时庆祝。*AgentSkin 的 InjectDock 可借鉴此实时状态联动设计，让 Dock 图标根据当前注入状态/主题切换做出反馈。*

2. **TraeCode (Trae CN) 集成** — 2026-08-27 新增 TraeCode hook 集成（PR #886），直接支持 TRAE Work 中文版。*这与 AgentSkin 的 traework 适配器高度相关，可参考其 hook 集成方式。*

3. **权限气泡系统** — 权限请求时宠物举起气泡，支持溢出队列（PR #944）。*AgentSkin 的 Dialog/Notification 系统可参考此非侵入式通知设计。*

4. **SVG 像素动画** — 纯 SVG 实现像素艺术动画，无需图片资源，文件极小。*AgentSkin 的启动动画/状态指示器可参考此轻量动画方案。*

5. **快捷键系统** — 2026-08-28 修复 macOS Control 修饰键保留（PR #946），精细的快捷键处理。

**与 AgentSkin 对比**:

| 维度 | clawd-on-desk | AgentSkin |
|------|---------------|-----------|
| 伙伴系统 | 实时 Agent 联动宠物 | InjectDock 静态图标 |
| 动画系统 | SVG 像素动画 | CSS 动画 |
| 状态反馈 | 15+ 状态实时切换 | 无 |
| 通知方式 | 宠物气泡 | Toast 通知 |
| 跨平台 | Win/Mac/Linux | Win/Mac |

**可借鉴点（按可行性排序）**:

1. ⭐⭐⭐ **实时状态联动** — InjectDock 根据注入状态/主题切换/错误状态展示不同动画反馈
2. ⭐⭐⭐ **SVG 轻量动画** — 启动进度/状态指示器使用 SVG 像素动画，减少资源占用
3. ⭐⭐ **TraeCode Hook** — 参考其 TRAE Work 中文版 hook 集成方式优化 traework 适配器
4. ⭐ **非侵入式通知** — 权限请求/重要事件用宠物气泡代替模态对话框

---

### 3.2 zhouwei713/WorkBuddy-Dream-Skin — WorkBuddy 专项换肤 (20⭐)

**定位**: 腾讯 WorkBuddy Windows 桌面端的外置换肤项目，通过本机 CDP 注入可逆 CSS 主题。

**核心架构**:
- PowerShell 5.1 启动/恢复/进程发现/端口校验
- Node.js 22 CDP WebSocket 客户端
- 图片→主题自动分析（色相+明度分析自动匹配色板）
- Windows 系统托盘控制
- 自动化审计脚本（7 个审计维度）

**技术亮点**:

1. **图片驱动自动配色** — 分析导入图片的综合色相与明度，自动匹配绯樱少女/薄荷花房/晴日校园/鎏金夜宴/深海夜航 UI 色板与明暗模式。*AgentSkin 的 Visual Analyzer 可参考此图片→配色自动推导算法。*

2. **三层图片结构** — 背景图、主视觉图、完整原图缩略卡三层分离，支持分别定位/尺寸/遮罩。*AgentSkin 的壁纸系统可参考此分层设计。*

3. **自动化审计体系** — 7 个审计脚本覆盖：悬停状态、输入区、场景、页面、详情弹窗、设置中心、任务场景。*AgentSkin 缺少自动化视觉验证能力，可参考此审计框架。*

4. **Windows 系统托盘** — 托盘菜单提供皮肤刷新、重启启用、主题切换、挂件显示、导入图片、恢复外观等功能。*AgentSkin 的 InjectDock 可参考此托盘交互模式。*

5. **动态挂件系统** — 主题专属动态挂件，自动匹配悬浮节奏、摆动姿态、轨道饰物、主题光点。*AgentSkin 的装饰系统可参考此动态挂件设计。*

**与 AgentSkin 对比**:

| 维度 | WorkBuddy-Dream-Skin | AgentSkin |
|------|----------------------|-----------|
| 目标应用 | 仅 WorkBuddy | 6 应用 |
| 图片分析 | 自动色相+明度匹配 | 无 |
| 审计体系 | 7 维度自动化 | 无 |
| 托盘控制 | Windows 托盘 | InjectDock |
| 动态挂件 | 主题专属动态挂件 | 无 |
| 恢复机制 | 一键恢复+正常模式重启 | 基础 restore |

**可借鉴点（按可行性排序）**:

1. ⭐⭐⭐ **图片→配色自动推导** — Visual Analyzer 增加图片色相+明度分析，自动推荐主题色板
2. ⭐⭐⭐ **自动化审计框架** — 建立注入后自动化视觉审计，覆盖关键 UI 节点
3. ⭐⭐ **托盘交互模式** — InjectDock 增加托盘菜单，提供快速主题切换/刷新/恢复
4. ⭐ **动态挂件系统** — 主题可配置动态装饰元素，增强主题差异化

---

### 3.3 lntomF/codexskin — 动态视觉主题系统 (14⭐)

**定位**: 为 Codex 桌面端提供随呼吸律动的数字化外衣，动态视觉美学 + 沉浸式主题定制。

**核心架构**:
- Tauri v2 + Rust 构建独立桌面应用
- CDP 运行时渲染（不修改官方文件）
- 动态视觉层（呼吸动效 + 图层微动 + 磨砂玻璃 + 赛博朋克）
- Electron 主进程 + 渲染进程分离

**技术亮点**:

1. **呼吸动效系统** — 主题有呼吸节奏，不是死板的静态样式。*AgentSkin 的启动动画可参考此呼吸节奏设计，让进度指示更自然。*

2. **图层微动** — 精巧的图层微动效果，增加视觉层次感。*AgentSkin 的 UI 组件可参考此微动效设计。*

3. **磨砂玻璃 + 赛博朋克** — 多种视觉风格（磨砂玻璃通透、赛博朋克霓虹），在不改变官方交互逻辑的前提下呈现。*AgentSkin 的主题风格系统可参考此多样化视觉方向。*

4. **CDP 运行时渲染** — 将定制主题直接映射至界面，无需解包或修改官方原生文件。*与 AgentSkin 的注入理念一致，可参考其 CDP 连接管理。*

5. **Tauri 架构** — 使用 Tauri v2 构建轻量独立应用，启动快、资源占用低。*AgentSkin 如果要做轻量版/便携版，可参考此 Tauri 架构。*

**与 AgentSkin 对比**:

| 维度 | codexskin | AgentSkin |
|------|-----------|-----------|
| 目标应用 | 仅 Codex | 6 应用 |
| 应用架构 | Tauri v2 独立应用 | Electron 单窗口 |
| 动态效果 | 呼吸动效 + 图层微动 | 固定时序动画 |
| 视觉风格 | 多风格（磨砂/赛博/二次元） | Swiss/International |
| 安全边界 | CDP 仅 127.0.0.1 | 同 |

**可借鉴点（按可行性排序）**:

1. ⭐⭐⭐ **呼吸动效设计** — 启动动画/加载指示器采用呼吸节奏，更自然舒适
2. ⭐⭐ **图层微动效** — UI 组件添加微动效，增加视觉层次感
3. ⭐ **Tauri 轻量架构** — 未来可考虑 Tauri 版 AgentSkin Lite

---

### 3.4 ZhjGo/codex-skin-manager — 跨平台皮肤管理器 (25⭐)

**定位**: 跨平台（macOS/Windows）ChatGPT 与 Codex 桌面客户端极速换肤管理器。

**核心架构**:
- Electron 应用 + Node.js 后端
- CDP 调试端口 CSS/JS 沙箱注入
- 底色主题同步写入（macOS `~/.codex/config.toml`）
- 零残留硬清理机制（purge-all.mjs）
- 6 套内置主题（凡人修仙/灵笼/赛博朋克/EVA/初音/Dream）

**技术亮点**:

1. **零残留清理机制** — `purge-all.mjs` 在切换皮肤或还原时自动清洗一切注入的 DOM 节点、CSS 样式、全局 state 状态及粒子定时器。*AgentSkin 的 restore 机制可参考此彻底清理设计，防止样式交叉污染。*

2. **底色主题同步** — 自动适配底层配置（如 macOS `~/.codex/config.toml`），应用皮肤时同步切换系统底色与编辑器主题。*AgentSkin 的 theme 系统可参考此"主题+底色"同步设计。*

3. **皮肤目录结构** — `skins/<id>/skin.json + assets/css + renderer-inject.js`，结构清晰，易于扩展。*AgentSkin 的主题包结构可参考此组织方式。*

4. **跨平台打包** — 支持 macOS (arm64/x64) 和 Windows (x64) 打包，使用 electron-builder。*AgentSkin 如果要做独立发行版，可参考其打包配置。*

5. **安全底线** — 不含任何网络上传代码，不收集/拦截/修改用户对话流、API Token、账号密码。*AgentSkin 的安全设计可参考此"零收集"原则。*

**与 AgentSkin 对比**:

| 维度 | codex-skin-manager | AgentSkin |
|------|-------------------|-----------|
| 目标应用 | Codex/ChatGPT | 6 应用 |
| 清理机制 | purge-all 零残留 | 基础 restore |
| 底色同步 | 同步系统底色 | 无 |
| 跨平台 | macOS + Windows | macOS + Windows |
| 皮肤结构 | skin.json + CSS + JS | manifest.json + CSS |

**可借鉴点（按可行性排序）**:

1. ⭐⭐⭐ **零残留清理机制** — 增强 restore 逻辑，彻底清理注入的 DOM/CSS/定时器
2. ⭐⭐ **底色主题同步** — 主题应用时同步切换系统外观设置
3. ⭐ **皮肤目录结构** — 优化主题包组织方式

---

### 3.5 b-nnett/codex-plusplus — Tweak 系统 + 原生桥接 (3,749⭐)

**定位**: Codex Desktop 的本地 tweak 加载器，支持 UI 修改、设置页面、主进程代码、原生 OS 功能。

**核心架构**:
- 修改本地 Codex app.asar 加载 Codex++ 运行时
- 运行时位于用户数据目录，不在应用包内
- Tweak 文件夹（manifest.json + index.js）
- Owl 运行时检测 + 原生桥接（AppKit/Metal/Helper 进程）
- 自动修复 watcher（Codex 更新后自动重新 patch）

**技术亮点**:

1. **Tweak 生态系统** — 类似浏览器扩展的 tweak 系统，支持 renderer/main-process 两种作用域。*AgentSkin 的适配器架构可参考此插件化思想（但不可新增适配器，仅借鉴解耦思路）。*

2. **Owl 运行时检测** — 检测 Codex 的 Owl 原生壳（macOS），通过 SDK 暴露 `api.codex.runtime.getCapabilities()`。*AgentSkin 可参考此运行时能力检测机制。*

3. **原生桥接** — 支持 AppKit、Metal、MetalKit、原生子面板、Metal 子窗口覆盖。*如果 AgentSkin 需要原生级 UI 效果（如 macOS 毛玻璃），可参考此原生桥接设计。*

4. **自动修复 Watcher** — Codex 更新后自动检测并重新应用 patch。*AgentSkin 的适配器可参考此"自动修复"机制，在目标应用更新后自动适配。*

5. **安全模式** — `codexplusplus safe-mode` 禁用所有 tweak 而不删除。*AgentSkin 可参考此"安全模式"设计，在注入出错时快速禁用所有适配器。*

**与 AgentSkin 对比**:

| 维度 | codex-plusplus | AgentSkin |
|------|----------------|-----------|
| 注入方式 | 修改 app.asar | 纯运行时 CDP |
| 插件生态 | 开放 tweak 市场 | 封闭 6 适配器 |
| 原生能力 | AppKit/Metal 桥接 | 无 |
| 自动修复 | Watcher 自动 re-patch | 无 |
| 安全模式 | safe-mode 快速禁用 | 无 |

**⚠️ 重要区别**: Codex++ **修改本地应用安装**（patch app.asar），这与 AgentSkin 的纯运行时注入理念完全不同。AgentSkin 坚持不修改官方安装包，更安全可逆。Codex++ 的设计仅供参考其插件化思想和自动修复机制，**不应直接移植其 patch 方式**。

**可借鉴点（按可行性排序）**:

1. ⭐⭐⭐ **自动修复机制** — 目标应用更新后自动检测并重新适配
2. ⭐⭐ **安全模式** — 注入出错时快速禁用所有适配器
3. ⭐ **运行时能力检测** — 检测目标应用能力，动态调整注入策略

---

## 四、重大更新预警

| 项目 | 更新内容 | 影响 |
|------|---------|------|
| **clawd-on-desk** | 2026-08-28 修复 macOS Control 修饰键 | 高 — macOS 用户交互修复 |
| **clawd-on-desk** | 2026-08-27 新增 TraeCode (Trae CN) hook | 极高 — 直接关联 traework 适配器 |
| **clawd-on-desk** | 2026-08-27 修复 macOS Dock 图标主题 | 中 — macOS Dock 集成 |
| **WorkBuddy-Dream-Skin** | 2026-07-24 主题库扩展至 14 套 | 中 — 主题制作参考 |

---

## 五、落地方案推荐

### 方案 A: 图片→配色自动推导（Visual Analyzer 增强）

**来源**: zhouwei713/WorkBuddy-Dream-Skin 的图片色相+明度分析

**目标**: 增强 Visual Analyzer，上传图片后自动推荐主题色板

**实现路径**:
1. 提取图片主色调（HSL 分桶算法）
2. 根据亮度自动判断 light/dark 模式
3. 匹配最接近的内置主题色板
4. 生成预览 + 一键应用

**优先级**: ⭐⭐⭐ 高（直接提升主题创作体验）

---

### 方案 B: 零残留清理机制（Restore 增强）

**来源**: ZhjGo/codex-skin-manager 的 purge-all.mjs

**目标**: 增强 restore 逻辑，彻底清理注入的 DOM/CSS/定时器

**实现路径**:
1. 建立注入资产注册表（DOM ID/CSS 变量/定时器/事件监听器）
2. restore 时按注册表逐一清理
3. 验证清理结果（DOM 查询 + CSS 变量检查）

**优先级**: ⭐⭐⭐ 高（防止样式交叉污染）

---

### 方案 C: InjectDock 实时状态反馈

**来源**: rullerzhou-afk/clawd-on-desk 的 Agent 实时联动

**目标**: InjectDock 根据注入状态/主题切换/错误状态展示不同动画

**实现路径**:
1. 定义 Dock 状态（空闲/注入中/成功/错误/主题切换）
2. 设计 SVG 像素动画（每种状态 2-3 帧）
3. 状态切换时播放过渡动画

**优先级**: ⭐⭐ 中（提升用户感知）

---

### 方案 D: 自动化注入审计框架

**来源**: zhouwei713/WorkBuddy-Dream-Skin 的 7 维度审计脚本

**目标**: 建立注入后自动化视觉审计，覆盖关键 UI 节点

**实现路径**:
1. 定义审计节点清单（每个适配器 10-20 个关键选择器）
2. 注入后自动截图 + DOM 验证
3. 生成审计报告（通过/失败/警告）

**优先级**: ⭐⭐ 中（提升质量保证）

---

### 方案 E: 目标应用自动修复机制

**来源**: b-nnett/codex-plusplus 的 Watcher 自动 re-patch

**目标**: 目标应用更新后自动检测并重新适配

**实现路径**:
1. 记录目标应用版本 + 适配器兼容性矩阵
2. 检测目标应用更新（文件哈希/版本号变化）
3. 触发适配器兼容性测试
4. 不兼容时告警 + 自动回滚到安全状态

**优先级**: ⭐ 低（当前手动适配更可控）

---

## 六、执行计划

### 第一批（并行执行）

| 方案 | 预计产出 | 预计测试 |
|------|---------|---------|
| A: 图片→配色推导 | theme-color-derive.ts | 20 测试 |
| B: 零残留清理 | injection-registry.ts | 15 测试 |

### 第二批（串行执行，依赖第一批完成）

| 方案 | 预计产出 | 预计测试 |
|------|---------|---------|
| C: Dock 状态反馈 | dock-animation.ts | 10 测试 |
| D: 自动化审计 | audit-framework.ts | 15 测试 |

### 第三批（长期跟踪）

| 方案 | 预计产出 | 预计测试 |
|------|---------|---------|
| E: 自动修复机制 | adapter-watchdog.ts | 10 测试 |

---

## 七、总结

本轮分析的 5 个项目中，**clawd-on-desk** 和 **WorkBuddy-Dream-Skin** 带来最高价值：

1. **clawd-on-desk** 的 TraeCode hook 集成直接关联 traework 适配器，其实时状态联动设计可启发 InjectDock 动画反馈
2. **WorkBuddy-Dream-Skin** 的图片→配色自动推导和自动化审计框架可直接移植到 AgentSkin
3. **codex-skin-manager** 的零残留清理机制是 restore 功能的最佳参考
4. **codex-plusplus** 的自动修复思想值得借鉴，但其 patch 方式与 AgentSkin 理念不符

**下一步行动**: 执行方案 A（图片配色推导）和方案 B（零残留清理），预计产出 2 个模块 + 35 测试。

---

> 报告生成时间: 2026-08-28 15:00
> 分析员: CatPaw AgentSkin 竞品研究自动化
> 下轮预告: DSH 插件生态深挖 + macOS 菜单栏控制器 + Windows 皮肤套件</longcat_think>
