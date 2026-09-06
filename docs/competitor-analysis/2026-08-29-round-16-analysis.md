# 竞品分析第 16 轮 — 2026-08-29 09:00（编辑器 + 氛围 UX + 质量门禁专题）

> 执行摘要：本期聚焦 5 个此前未深入分析的"换血级"项目——xuhuanstudio/codex-styler（主题编辑器标杆，15⭐，活跃）、Cmochance/agent-theme（Tauri 架构伴侣，停滞）、ArthurLobopro/electron-css-injector（应用内注入 SDK，已停更）、kimilee94/workbuddy-ambient-skin（氛围皮肤+OKLCH 提取）、jiarong0423/dream-skin-forge（热抽换+质量门禁+Fail-closed 原则）。提取可借鉴设计思想 22 项，推荐立即实施 4 项。

---

## 一、项目概览

| 项目 | Stars | 平台 | 语言 | 最后更新 | 活跃度 | 与 AgentSkin 相关性 |
|------|-------|------|------|---------|--------|-------------------|
| xuhuanstudio/codex-styler | 15 | macOS/Windows | TypeScript | 2026-08-27 | 🔥 极高（两周 10+ commits） | ★★★★★ 主题编辑器正面对标 |
| Cmochance/agent-theme | 1 | macOS | Rust (Tauri v2) | 2026-07-20 | ⚠️ 停滞 | ★★☆☆☆ 架构参考 |
| ArthurLobopro/electron-css-injector | 2 | Electron | TypeScript | 2024-03-07 | ❌ 停更 1.5 年 | ★☆☆☆☆ 技术路线对比参考 |
| kimilee94/workbuddy-ambient-skin | 1 | macOS/Windows | JavaScript | 2026-08-5 | ⚠️ 停滞 | ★★★★☆ WorkBuddy 氛围 UX + OKLCH |
| jiarong0423/dream-skin-forge | 1 | macOS | JavaScript | 2026-07-25 | ⚠️ 停滞 | ★★★★☆ 热抽换 + 质量门禁 |

---

## 二、深度分析

### 2.1 xuhuanstudio/codex-styler — 主题编辑器标杆

**仓库**: https://github.com/xuhuanstudio/codex-styler
**版本**: v0.2.0-beta.9 (2026-08-11)
**许可证**: Apache-2.0（代码） / CC BY 4.0（美术资产）
**活跃度**: 极高——8/27 推送 beta.9，8/9 还在修 SBOM generation

#### 2.1.1 核心架构

Codex Styler 定位为"Codex 主题编辑器+皮肤创建器"，分为三大模块：

1. **主题运行时（Reversible Runtime）**
   - 通过临时 loopback CDP 会话启动 Codex
   - 永不编辑 app.asar / 应用资源 / 签名
   - 数据包仅含 JSON + 本地栅格图片，无脚本/远程 URL/可执行字体

2. **Image-Adaptive Creator（图片自适应创建器）**
   - 导入 PNG/JPEG/WebP 后自动推导：
     - **Luminance**（亮度）
     - **Dominant Color**（主色）
     - **Accent**（强调色）
     - **Contrast**（对比度）
   - 将图片适配到四种精心策划的视觉系统
   - 无需手写 CSS 即可细化 layout/icon treatment/details/surfaces/radius/motion/companion placement

3. **Companion Studio（伴侣工作室）**
   - 将静态图片/序列帧/短动画/已有图集转化为校准的 pointer 姿态和方向感知的 idle 运动
   - 通过可视化时间轴和方向拨盘编辑
   - 无需编辑图集坐标或 JSON

4. **Composer Interactions（交互配置器）**
   - 替换 Codex 原生配置控制器
   - 五种主题感知交互模式：Triple Drop / Capsule Crane / Loadout Forge / Three-axis Console / Mission Map
   - 每次交互返回完整 loadout（model + reasoning effort + response speed）
   - 无 decoration score / disconnected reward——直接改 Codex 真实设置

#### 2.1.2 Open Scene Model

主题声明 `layers[]`、`entities[]`、renderer 和 behaviors——不触碰 Codex DOM 内部。这与 AgentSkin 的四层注入架构（engine-strategy / adapter / HybridInjector / DeepCore）形成有趣对比：

| 维度 | Codex Styler | AgentSkin |
|------|-------------|-----------|
| 抽象层 | Scene Model（layers/entities） | Injection Layers（L0-L4） |
| 主题格式 | 结构化声明（renderer + behaviors） | 14-token palette.css + CSS 覆盖 |
| 图片适配 | 自动推导 → 视觉系统匹配 | image-theme-analyzer.ts（像素 → 14 token） |
| 伴侣系统 | Companion Studio（时间轴+方向拨盘） | 无（InjectDock 仅图标） |
| 交互配置 | 五种主题感知交互模式 | 无 |

#### 2.1.3 关键发现

1. **"Companion Studio"是 AgentSkin 缺失的能力维度**
   - AgentSkin 的 InjectDock 是一个固定图标区域
   - Codex Styler 的 Companion Studio 允许创建 2D 伴侣动画 + 鼠标追踪 + idle 姿态
   - 这与我们的"六适配器+注入引擎"正交互补

2. **"Image-Adaptive"的视觉系统思路优于纯 token 映射**
   - 我们的 image-theme-analyzer.ts（2026-08-29 实施）做像素 → 14 token 映射
   - Codex Styler 额外做了 token → "视觉系统"适配（四种精心策划的方向）
   - 这给用户提供"选择风格"而非"调节参数"的体验

3. **Composer Interactions 是 Codex 独占功能**
   - 管理 Codex 设置（model/reasoning/speed）不属于 AgentSkin 的注入职责范围
   - 但"Theme-aware settings"的概念可移植：主题可声明推荐的模型设置

#### 2.1.4 可借鉴清单

| # | 设计思想 | 借鉴方式 | 优先级 |
|---|---------|---------|--------|
| 1 | Image-Adaptive Creator 视觉系统匹配 | 增强 image-theme-analyzer.ts 输出"风格预设"建议 | 中 |
| 2 | Companion Studio 2D 伴侣创作 | 可作为 Studio 扩展能力，但不属于核心 | 低 |
| 3 | Data-only packages 契约 | 已具备（主题是 CSS+图片），但可强化校验 | 低 |
| 4 | 中英双语 i18n | AgentSkin 目前主要中文，可补英文 | 低 |

---

### 2.2 Cmochance/agent-theme — Tauri 伴侣架构

**仓库**: https://github.com/Cmochance/agent-theme
**许可证**: MIT（通过 README badge 推断）
**创建时间**: 2026-05-26
**最后更新**: 2026-07-20（停滞）

#### 2.2.1 核心架构

- **Tauri v2 + Rust** 替代 Electron，更轻量 + 原生性能
- 通过 CDP 运行时注入，针对 Codex Desktop / Antigravity / Linear
- 11 套二次元主题，每套按背景图独立调色
- 受限重启：一键重启代理并附加调试端口
- 配置持久化到 `~/.codex/agent-theme/config.json`
- 单实例保护：防止多窗口并发

#### 2.2.2 关键发现

1. **适配应用超出 AgentSkin 范围**
   - 适配 Codex / Antigravity / Linear
   - AgentSkin 明确只适配 6 个应用（traework/qoderwork/workbuddy/doubao/codex/zcode）
   - Linear 适配不可移植（会违反"禁止新增适配器"规则）

2. **"单实例保护"已被覆盖**
   - AgentSkin 的 automation-lock.mjs + epoch-manager 远超此能力
   - 无需移植

3. **"双代理顶部切换栏"设计简洁**
   - 作为独立伴侣应用的 UI 模式合理
   - 但 AgentSkin 已经是完整 Electron 产品，不是伴侣工具

#### 2.2.3 可借鉴清单

| # | 设计思想 | 借鉴方式 | 优先级 |
|---|---------|---------|--------|
| 1 | 受限重启（仅作用于已支持代理） | 已有 IPC + 进程管理能力 | ❌ 不需要 |
| 2 | 顶部代理切换栏 UI | AgentSkin 已有 workspace 选择器 | ❌ 不需要 |
| 3 | Antigravity 适配 | 禁止新增适配器 | ❌ 不可移植 |

---

### 2.3 ArthurLobopro/electron-css-injector — 应用内注入 SDK

**仓库**: https://github.com/ArthurLobopro/electron-css-injector
**许可证**: 未明确
**最后更新**: 2024-03-07（停更 1.5 年）

#### 2.3.1 核心架构

```typescript
// 主进程
import "electron-css-injector/main"

// preload
import { injectCSS } from "electron-css-injector"
window.addEventListener("DOMContentLoaded", () => {
   injectCSS("path/to/archive.css")
})
```

利用 Electron 内部 protocol API 在 DOMContentLoaded 时注入样式。

#### 2.3.2 关键发现

1. **技术路线对立**
   - AgentSkin = 外部 CDP 注入（不修改目标应用）
   - electron-css-injector = 应用内集成（需修改主进程和 preload）
   - 无需移植——AgentSkin 明确禁止 app.asar 补丁

2. **对 AgentSkin 无实用价值**
   - 项目已停更 1.5 年
   - 功能单一（仅 CSS 注入）
   - 设计思路与 AgentSkin 零侵入原则相悖

#### 2.3.3 可借鉴清单

| # | 设计思想 | 借鉴方式 | 优先级 |
|---|---------|---------|--------|
| 1 | Protocol API 注入机制 | 作为 CDP 注入的对比参考 | ❌ 不需要实施 |

---

### 2.4 kimilee94/workbuddy-ambient-skin — 氛围皮肤 + OKLCH

**仓库**: https://github.com/kimilee94/workbuddy-ambient-skin
**许可证**: MIT（通过 SKILL.md 推断）
**创建时间**: 2026-07-21
**最后更新**: 2026-08-5

#### 2.4.1 核心架构

这是一个以 **Agent Skill** 形式分发的工作流工具，也可独立脚本调用。

**核心设计理念**："改空间，不改控件"——保留原生交互，用 Material Layer 处理各 UI 区域。

**氛围收敛 UX**（最关键创新）：
- **首页**：壁纸完整呈现，营造氛围
- **工作页**（进入对话/任务后）：自动降低壁纸对比度，回归工作专注
- **详情页**：进一步淡出，以内容为主

**OKLCH 感知色彩提取**：
- 从图片自动提取主色与差异化辅色
- 判断明暗、视觉焦点和文字安全区
- 在 OKLCH 空间计算，保证感知均匀性

**技术细节**：
- 固定端口 9347（若被占则明确失败，不选其他端口）
- CDP loopback-only
- 应用启动带 `--remote-debugging-port=9347`
- 检测到 CDP 已活跃时使用 `switch --theme ID` 实现无重启切换

#### 2.4.2 SKILL.md 设计亮点

- **"Never execute restart from Agent sandbox"**：绝不从 Agent 沙箱执行重启命令
- **"Return exactly one fenced command block for that OS"**：只返回适合用户系统的命令
- **"Replace ID with selected theme's real ID so command can be copied unchanged"**：模板化、零修改可复制
- **"Port 9347 is fixed. If occupied, fail clearly"**：固定端口+明确失败

#### 2.4.3 关键发现

1. **"氛围收敛 UX"是真正的换血级创新**
   - 目前所有 AI 皮肤工具（包括 AgentSkin）都是"全有或全无"——壁纸要么全开要么关掉
   - Ambient Skin 引入"环境感知强度"：根据页面上下文自动调整视觉强度
   - 这是"以用户为中心"而非"以工具为中心"的设计

2. **OKLCH 色彩空间比 RGB/HSL 更适合主题提取**
   - 感知均匀性保证亮度/色调变化符合人眼感知
   - 与 AgentSkin 的 image-theme-analyzer.ts 对比：我们目前用 RGB 像素量化

3. **"Material Layer 分层处理"值得适配**
   - 顶栏 / 侧栏 / 卡片 / 输入框 / 详情区 分别处理
   - 相对于 AgentSkin 的全局 CSS 覆盖，更精细

#### 2.4.4 可借鉴清单

| # | 设计思想 | 借鉴方式 | 优先级 |
|---|---------|---------|--------|
| 1 | 氛围收敛 UX（首页/工作页/详情详情页分级） | 可在 WorkBuddy 适配器实现路由感知的强度调节 | **高** |
| 2 | OKLCH 感知色彩提取 | 替换 image-theme-analyzer.ts 的 RGB 量化为 OKLCH | **高** |
| 3 | 固定端口+明确失败 | 与 PortLeasePool 理念一致，但策略不同 | 低 |
| 4 | Agent Skill 分发模式 | AgentSkin 已超出 Skill 层级 | 低 |

---

### 2.5 jiarong0423/dream-skin-forge — 热抽换 + 质量门禁

**仓库**: https://github.com/jiarong0423/dream-skin-forge
**许可证**: 未明确（README 含 CREDITS.md / NOTICE.md）
**创建时间**: 2026-07-25
**最后更新**: 2026-07-25（单 commit 项目，仅一天开发）

#### 2.5.1 核心架构

Dream Skin Forge 定位为"macOS Codex 桌面端的内部主题热抽换工具"，第二版重点不在外部展示包而在**可验证、可切换、可回滚的本地 runtime**。

**架构组件**：

1. **Hot-swap Theme Pack Runtime（热抽换运行时）**
   - 右侧 Hot-swap Bay：selector 切换 active pack
   - 不重建 native frame，仅替换视觉资产
   - Pack validation：manifest / source count / alpha / frame count / SVG / payload budget / manual-click-only / cleanup

2. **Activation CLI**
   - `list`：列出所有可抽换包
   - `plan`：模拟激活（不写入）
   - `activate`：先备份当前 + 激活新 pack
   - `rollback`：回滚到上一个 active theme backup

3. **Runtime 修复机制**
   - Hot-swap selector 消失：renderer 可跳过 core apply，但会检查 hot-swap DOM 完整性
   - Theme-pack cache 失效：旧 cache hash 看似一致但 payload 不是 renderer-safe data URL
   - Sidebar row 变形：官方 sidebar 有原生 gutter，冲突时 glyph module fail closed
   - Titlebar/sidebar junction：header divider 是 header 拥有，不应用 sidebar overlay 遮掉

4. **Module Matrix（模块矩阵）**
   - `module-matrix.mjs` 定位哪个模块坏掉（sidebar/header/right panel/hot-swap cache/renderer selector）
   - 视觉资产分层：source / runtime / preview / animation / icon map

5. **Subtractive Module Aggregation（减法模块聚合）**
   - 不是简单地叠加 CSS
   - 而是按模块分别处理：背景 / 图标 / 动画 / 触发器 / 交互素材
   - 每个模块独立加载、独立验证、独立清理

#### 2.5.2 测试脚本分析（forge-gate.sh / run-tests.sh）

项目包含一个 **40+ grep 检查** 的 CI 门禁脚本，确保：

- `injector.mjs` 包含必要的函数和字段
- `renderer-inject.js` 消费了必要的 payload
- `theme.css` 暴露了必要的 CSS 变量和样式
- `runtime-modules.json` 文档化了关键设计决策

代表性的门禁检查：
```bash
grep -q 'applyRuntimeDefaults' "$ROOT_DIR/scripts/injector.mjs" || cit_die "injector must normalize active themes through shared runtime defaults"
grep -q '"subtractive module aggregation"' "$ROOT_DIR/assets/runtime-modules.json" || cit_die "runtime module manifest must document subtractive module aggregation"
grep -q 'assetGroupsPruned' "$ROOT_DIR/scripts/injector.mjs" || cit_die "injector must prune stale persistent asset groups"
```

#### 2.5.3 关键发现

1. **"Hot-swap" 概念与 AgentSkin HybridInjector 部分对标**
   - HybridInjector 提供增量/全量/热替换 CSS 注入
   - Dream Skin Forge 的热抽换还支持"视觉资产包"级别切换（不仅是 CSS，还有图片/动画/交互素材）

2. **"Pack validation" 的质量门禁思路优秀**
   - 目前 AgentSkin 的 check-themes 仅验证 14-token 契约
   - Dream Skin Forge 额外验证：alpha通道 / frame count / payload budget / manual-click-only contract
   - 这显著降低主题包在运行时出错的概率

3. **"Module matrix" 诊断方法论**
   - 当注入失败时，快速定位是哪个模块（sidebar/header/right panel/cache/selector）出了问题
   - AgentSkin 目前没有模块级诊断——我们靠人工排查

4. **"Fail-closed" 原则贯穿始终**
   - Native sidebar gutter 冲突 → fail closed（不渲染）
   - Hot-swap DOM 不完整 → 重送 core
   - Cache payload 不安全 → 失效重送
   - 这种"宁可不出错也不能乱出"的安全思维值得学习

5. **"Subtractive module aggregation" 的资产分层**
   - source / runtime / preview / animation / icon map 分开管理
   - 避免单一 active theme 的资产混乱
   - AgentSkin 的主题资产结构（manifest.json + palette.css + assets/）可以借鉴这种分层

#### 2.5.4 可借鉴清单

| # | 设计思想 | 借鉴方式 | 优先级 |
|---|---------|---------|--------|
| 1 | Hot-swap pack 验证（alpha/frame count/payload budget/cleanup） | 在 bundle 构建流程增加 alpha + payload budget 检查 | **高** |
| 2 | Module matrix 诊断 | 创建 agent 模块健康诊断脚本 | 中 |
| 3 | Fail-closed 原则 | 在 adapter 注入器中对"不确定"情况 fail closed | 中 |
| 4 | Subtractive module aggregation | 主题资产结构增强（source/runtime/preview 分层） | 低 |
| 5 | Activation CLI 的 plan/activate/rollback | 引入 "dry-run apply" 模式 | 中 |
| 6 | 40+ grep CI 门禁 | 在我们的 check-themes.mjs 中增强结构完整性检查 | **高** |

---

## 三、AgentSkin 差距与机会矩阵

| 维度 | 当前 AgentSkin 能力 | 竞品最佳实践 | 差距 | 行动 |
|------|-------------------|------------|------|------|
| 主题创作 | Image-theme-analyzer 像素→14 token | Codex Styler 视觉系统匹配 + Companion Studio | 中等 | 增强 analyzer 输出风格预设 |
| 主题验证 | check-themes 14-token 契约 | Dream Skin Forge alpha/frame/payload/cleanup 7 项检查 | 大 | 增强 bundle 验证 |
| 氛围 UX | 全局 CSS 覆盖 | Ambient Skin 路由感知三级强度收敛 | 大 | 实现 WorkBuddy 路由感知注入 |
| 色彩提取 | RGB 像素量化 | Ambient Skin OKLCH 感知色彩 | 中 | 迁移到 OKLCH 提取 |
| 模块诊断 | 人工排查 | Dream Skin Forge module-matrix 自动定位 | 中 | 创建诊断脚本 |
| 热替换 | HybridInjector 增量/全量 | Dream Skin Forge pack 级热抽换 + 回滚 | 小 | 增强 pack 级热替换 |

---

## 四、推荐实施项目

### P1: 主题包质量门禁增强（Dream Skin Forge 启发）

**来源**: jiarong0423/dream-skin-forge 的 forge-gate.sh / 7 项 pack validation
**目标**: 在 `scripts/check-themes.mjs` 或独立脚本中增加：
- PNG alpha 通道校验（确保透明区域符合预期）
- Payload budget 校验（单主题包图片总大小不超过预算）
- Manual-click-only contract（交互素材仅手动触发，无自动播放）
- Cleanup contract（主题包清理后无残留 DOM 节点）
- Source/Runtime/Preview 三层结构完整性校验

**预期效果**: Bundle 构建时自动拒绝不合格主题，降低运行时出错概率。

**实施文件**:
- 新增: `scripts/validate-theme-package.mjs`
- 修改: `scripts/check-themes.mjs`（调用新验证器）
- 新增测试: `tests/main/validate-theme-package.test.ts`

**工作量估算**: 2-3 小时

---

### P2: 氛围路由感知注入（Ambient Skin 启发）

**来源**: kimilee94/workbuddy-ambient-skin 的"氛围收敛 UX"
**目标**: 在 WorkBuddy 适配器中实现：
- 路由感知注入（首页完整 → 工作页降强度 → 详情页淡出）
- 根据当前 WorkBuddy 页面类型动态调整 `--agentskin-background-opacity` 变量
- 可选：通过 MutationObserver 或 CDP 路由事件监听页面切换

**预期效果**: WorkBuddy 用户首页沉浸工作专注，自然过渡无需手动切换。

**实施文件**:
- 修改: `src/adapters/domestic/workbuddy.ts`（增加路由感知逻辑）
- 新增: `src/adapters/domestic/ambient-router.ts`（路由监听 + 强度映射）
- 新增测试: `tests/main/workbuddy-ambient-router.test.ts`

**工作量估算**: 3-4 小时

---

### P3: OKLCH 色彩提取升级（Ambient Skin 启发）

**来源**: kimilee94/workbuddy-ambient-skin 的 OKLCH 感知色彩提取
**目标**: 在 `src/main/profile/image-theme-analyzer.ts` 中：
- 新增 OKLCH 色彩空间转换
- 输出色板同时提供 OKLCH 表示（L/C/H 三分量）
- 根据 OKLCH 亮度自动判断深浅模式适配

**预期效果**: 主题生成结果感知更均匀，深色主题不会出现"刺眼亮色"。

**实施文件**:
- 修改: `src/main/profile/image-theme-analyzer.ts`
- 新增测试: `tests/main/oklch-color-extraction.test.ts`

**工作量估算**: 1-2 小时

---

### P4: Agent 模块健康诊断脚本（Dream Skin Forge 启发）

**来源**: jiarong0423/dream-skin-forge 的 module-matrix.mjs
**目标**: 创建独立诊断脚本 `scripts/diagnose-injection.mjs`：
- 检测每个适配器的注入状态
- 定位失败模块（CDP 连接 / CSS 注入 / DOM 标记 / Store 状态）
- 输出结构化诊断报告 + 修复建议

**预期效果**: 调试时间从小时级降至分钟级。

**实施文件**:
- 新增: `scripts/diagnose-injection.mjs`
- 新增测试: `tests/main/diagnose-injection.test.ts`（mock 状态）

**工作量估算**: 2-3 小时

---

## 五、不实施的项目（含原因）

| 项目 | 原因 |
|------|------|
| Codex Styler 的 Companion Studio | 伴侣创作能力不属于 AgentSkin 核心定位（注入引擎非内容平台），且已有 InjectDock 满足基础需求 |
| Codex Styler 的 Composer Interactions | 管理 Codex 设置超出注入引擎职责范围 |
| Cmochance/agent-theme 的 Tauri 架构 | AgentSkin 已是完整 Electron 产品，迁移成本高收益低 |
| Cmochance/agent-theme 的 Linear 适配 | 违反"禁止新增适配器"铁律 |
| electron-css-injector | 技术路线对立（应用内集成 vs 外部注入），已停更 1.5 年 |
| Dream Skin Forge 的 Activation CLI | AgentSkin 已有 CLI 体系（ipc.ts），不需要独立的 pack 级 CLI |
| Ambient Skin 的 Agent Skill 分发 | AgentSkin 定位超越 Skill 层级（引擎级产品） |

---

## 六、实施执行计划

### Wave 1（并行实施 — P1 + P2）

**P1 子智能体**: 实施主题包质量门禁增强
**P2 子智能体**: 实施氛围路由感知注入（WorkBuddy）

### Wave 2（串行依赖 Wave 1 完成 — P3 + P4）

**P3 子智能体**: 实施 OKLCH 色彩提取升级
**P4 子智能体**: 实施诊断脚本

### 验证阶段

- 运行 `npm run check` 全绿
- 运行 `npm test` 全绿
- 运行 `npx tsc --noEmit` 零新增错误

---

## 七、下一步建议

1. **追踪 Codex Styler v1.0 Stable**（预计 8 月底至 9 月）
   - 正式发布时评估是否需要跟进其"Image-Adaptive Creator"思路
   - 评估"Companion Studio"是否应作为 Studio 扩展能力

2. **关注 Ambient Skin 恢复更新可能**
   - 停滞仅 3 周，可能恢复
   - 如其开源更多 OKLCH 实现细节，可考虑更深度的色彩提取移植

3. **Dream Skin Forge 的 Module Matrix 思路**
   - 值得在 docs/ 中新增一篇"注入故障诊断方法论"文档
   - 将模块矩阵思维沉淀为团队知识

4. **长期机会：Electron 内嵌协议 API**
   - 如果 OpenAI/Tencent 未来官方支持主题 API（类似 DSH 的 `--dsw-*` token 系统）
   - AgentSkin 可以快速切换到"官方 API 优先，CDP 注入降级"的混合模式

---

> 第 16 轮分析完成 — 2026-08-29 09:00
