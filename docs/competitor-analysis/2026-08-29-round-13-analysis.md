# 竞品分析第 13 轮 — 2026-08-29 06:00（原生态深挖专题）

> 执行摘要：本期深挖 5 个"换血级"项目——Fei-Away/Codex-Dream-Skin（1.4w⭐ 生态源头）、Finderchangchang/codex-autoskin（Agent-native 范式革新）、zhouwei713/WorkBuddy-Dream-Skin（WorkBuddy 深度适配）、waiterxiaoyy/codress（Electron+Go 多语言架构）、AI-Scarlett/LingGlow（签名校验+Pipe 传输）。提取可借鉴设计思想 18 项，推荐立即实施 6 项。

---

## 1. 轮换策略与项目选择

**已覆盖项目（累计 120+ 个）**：Rotation 0-28 + Round 4-12

**本轮选择**：从"生态源头 + Agent-native + 原生多应用 + 安全加固 + 现代架构"五个维度选取 5 个新项目：

| # | 项目 | Stars | 活跃度 | 核心亮点 | 借鉴维度 |
|---|------|-------|--------|---------|---------|
| 1 | Fei-Away/Codex-Dream-Skin | 14,180 | 🔥 极高（昨日仍有提交） | Safe CSS 白名单 + 选择器溯源 + 安装快照 | 工程质量 + 安全模型 |
| 2 | Finderchangchang/codex-autoskin | 117 | 中（维护模式） | Agent-native THEME-SPEC + 28-token + 断路器 | 主题生成范式 + 守卫机制 |
| 3 | zhouwei713/WorkBuddy-Dream-Skin | 20 | ⚠️ 停滞（5 天无更新） | WorkBuddy 深度适配 + 7-gate 审计 + image-driven | WorkBuddy 适配参考 |
| 4 | waiterxiaoyy/codress | 5 | ⚠️ 停滞（3 天无更新） | Electron+Go 多语言 + 适配器热修复 + 桌面宠物 | 架构参考（仅参考） |
| 5 | AI-Scarlett/LingGlow | 0 | 🔥 极高（5 天 3 发） | CDP Pipe + 指纹链校验 + 7 日排程 | 安全加固 + 豆包参考 |

---

## 2. 核心发现与行业趋势

### 趋势 1：选择器溯源正在成为工程质量标杆
Fei-Away/Codex-Dream-Skin 的 `check-selector-provenance.mjs` 为每个 CSS 选择器标注证据强度（maintainer/reporter/fixture）和已知 gaps，CI 门禁防止声明覆盖与实际不一致。这代表 AI 皮肤工具正在从"能注入"向"可验证注入"演进。

### 趋势 2：Agent-native 换肤正在模糊人机边界
codex-autoskin 的 THEME-SPEC.md 是写给 Agent 读的规范——用户只需说"给我做个这样的皮肤"，Agent 读规范后自动生成主题文件夹。Codex 甚至能自己读取仓库、安装引擎、用附加图片生成并应用主题。这正在重新定义"换肤"的用户体验。

### 趋势 3：CDP Pipe 传输是安全敏感的终极方案
LingGlow 坚持 `--remote-debugging-pipe` 无 TCP 回退，从协议层消除端口暴露风险。配合 Bundle ID + Team ID + ASAR 指纹链校验，在应用更新时能防止适配器静默失效。这对 doubao 等安全敏感目标有直接参考价值。

### 趋势 4：图片驱动型主题生成成为标配
WorkBuddy-Dream-Skin 和 codex-autoskin 都实现了"一键从图片生成主题"——分析图片色调 + 亮度，自动选择 light/dark，映射到 CSS tokens。AgentSkin 的 image-theme-analyzer 已有基础，但可借鉴其决策树分类（A/B1/B2）。

### 趋势 5：Windows CDP Profile 问题成为兼容性分水岭
Codex Dream Skin v1.5.15 的 issue #235 揭示了 Chromium 136+ 对默认 data directory 不再响应 `--remote-debugging-port`，必须使用独立 profile。这意味着用户需要在注入器 profile 中重新登录 Codex。此问题对所有基于 CDP 的注入工具都是重大兼容性风险。

---

## 3. 各项目详细分析

### 3.1 Fei-Away/Codex-Dream-Skin — AI 皮肤生态源头（14,180⭐）

#### 3.1.1 项目概况

| 维度 | 数据 |
|------|------|
| Stars / Forks | 14,180 / 1,349 |
| License | MIT |
| Language | JavaScript (Node.js + Shell/PowerShell) |
| 范围 | 仅 Codex 单应用 |
| 平台 | macOS + Windows |
| 最新 Release | v1.5.16 (2026-08-27) |
| 官网 | dreamskin.cc |

#### 3.1.2 技术架构

**注入链路**: `start-dream-skin.ps1` → 启动 Codex with `--remote-debugging-port=9335` (loopback) → Node CDP client → 注入 `renderer-inject.js` (46KB)

**Safe CSS 白名单**: 
- `safe-css-policy.json` 定义 12 个可注入 UI parts
- `safe-css-validator.mjs` (22KB) 校验主题 CSS 仅作用于允许部分
- 与 AgentSkin 的 CSS 变量 token 契约形成对比——一个是"只能改这些 DOM"，一个是"只能改这些变量"

**选择器溯源系统** (Selector Provenance):
```json
{
  "selector": ".sidebar-nav-item",
  "provenance": {
    "source": "maintainer",
    "strength": "strong",
    "knownGaps": [],
    "coveredVersions": ["1.5.0", "1.5.16"]
  }
}
```

**Watcher 指数退避**: macOS watcher 从固定 500ms 升级为渐进式 (500ms→5s→30s)，空闲 10 分钟轮询从 ~1200 次降到 55 次。

#### 3.1.3 与 AgentSkin 对比

| 维度 | Codex Dream Skin | AgentSkin |
|------|-----------------|-----------|
| 适配器 | 1 (Codex) | 6 |
| 注入层 | 单层 renderer-inject.js | 四层编排 |
| 主题契约 | 12-part CSS 白名单 | 14-token CSS 变量 |
| 安全机制 | Safe CSS 验证器 | Layer Ownership + Token Ownership |
| 验证 | 选择器溯源 + 截图 | C1 check-injection-contract |
| 恢复 | 三态事务 + visibility 回滚 | Atomicity Guarantor |

---

### 3.2 Finderchangchang/codex-autoskin — Agent-native 范式革新（117⭐）

#### 3.2.1 核心理念

THEME-SPEC.md 是写给 Agent 读的规范。用户说"给我做个皮肤"→ Agent 读 THEME-SPEC.md → 自动生成主题文件夹（`theme.json` + 图片），不含可执行代码。引擎文件被严格保护。

#### 3.2.2 28-Token 主题系统

分为 7 组：全局色(4) + 页面底色与光晕(4) + 视觉图 crop(6) + 视觉图遮罩(3) + hero 文案(7) + 聊天页淡背景(4)

**对比 AgentSkin 14-token**: codex-autoskin 围绕"图片驱动"设计，token 数量绑定单应用深度适配；AgentSkin 的 14 token 语义化命名更适合多应用统一。

#### 3.2.3 守卫机制

- 双栈端口探测：127.0.0.1 / [::1] 的 /json/list
- 崩溃去重 + 断路器
- Startup Watcher：macOS LaunchAgent / Windows 计划任务
- 辅助窗口保护：initialRoute=/avatar-overlay 跳过注入
- extra.css 作用域校验：每条规则首选择器必须锚定 `html.dream-theme-<name>`

#### 3.2.4 图片→主题决策树

- A 类（干净艺术图）→ 直接取色 + 标准 overlay
- B1 类（带 UI 文字但有干净区）→ 放大裁剪取干净区
- B2 类（UI 四面包围无干净区）→ 高斯模糊柔焦策略

---

### 3.3 zhouwei713/WorkBuddy-Dream-Skin — WorkBuddy 深度适配（20⭐）

#### 3.3.1 项目概况

| 维度 | 数据 |
|------|------|
| Stars / Forks | 20 / 6 |
| 技术栈 | CSS + PowerShell + Node.js（零依赖） |
| 平台 | Windows only |
| 版本 | v0.7.6 |
| 适配目标 | WorkBuddy 5.3.3 on Electron 37 |

#### 3.3.2 三层注入模型

1. **CDP 连接层**: Node.js 原生 WebSocket，校验 title + root selectors
2. **渲染层**: `renderer-inject.js` (17KB) 通过 CSS custom properties 传递主题 token，监听 SPA 路由 + Page.loadEventFired 重注
3. **托盘 UX**: PowerShell NotifyIcon，11 项菜单

#### 3.3.3 7-Gate 审计体系

7 个 headless gate（hover/composer/scenes/pages/details/settings/verify）自动截图 + JSON 结构报告。

#### 3.3.4 Image-Driven 主题

`style-palettes.json` (7 palette family) + `customize-workbuddy-theme.ps1` 分析图片 hue + luminance 自动映射到 `--wbds-*` 变量。

---

### 3.4 waiterxiaoyy/codress — 现代多语言架构（5⭐）

#### 3.4.1 项目概况

| 维度 | 数据 |
|------|------|
| Stars / Forks | 5 / 0 |
| 技术栈 | TypeScript + Electron 33 + Node 20 + Go 1.24 + MySQL |
| 范围 | Codex + WorkBuddy |
| License | 无 |

#### 3.4.2 架构亮点

- 多语言 Monorepo：apps/desktop/ + apps/admin/ + packages/skin-schema/ + server/ (Go)
- 适配器热修复：管理端发布 config/CSS → 客户端注入前热拉取
- 桌面宠物：透明置顶悬浮窗，与主题平行
- Zod schema 共享

#### 3.4.3 关键限制

- 服务端依赖（Go + MySQL）违反 AgentSkin 铁律
- Claude 适配器已临时移除（多适配器维护压力）
- 单人开发，无 License

---

### 3.5 AI-Scarlett/LingGlow — 安全加固标杆（0⭐ 刚开源）

#### 3.5.1 项目概况

| 维度 | 数据 |
|------|------|
| Stars / Forks | 0 / 0（刚公开源码） |
| 技术栈 | SwiftUI 菜单栏 + Node.js 22 内置运行时 |
| 平台 | macOS 13+ only |
| 版本节奏 | v2.3.16 → v2.3.17 → v2.3.18（5 天 3 发） |
| 适配目标 | Codex + WorkBuddy + 豆包 |

#### 3.5.2 CDP Pipe 传输

仅用 `--remote-debugging-pipe`，**无 TCP 端口、无回退**。从协议层消除端口暴露风险。

#### 3.5.3 Adapter 指纹链校验

每个 adapter 含 main/nested CDHash + mainManifest/nestedExecutable/chromiumFramework/extensionManifest SHA-256。validation 分 staticBaseline → candidateEvidence → runtimeEvidence 三档递进。

**豆包 exact adapter 关键数据**:
```
bundleId: com.bot.pc.doubao
teamId: 96L78H6LMH
nestedBundleId: com.bot.pc.doubao.browser
chromium: 135.0.7049.72
extensionId: obkcimipmjdkghadnfcjojepocldeggd
capabilities: [background, palette, glass]
targetAllowlist: [doubao://doubao-chat/*, chrome://doubao-chat/*, 
  chrome-extension://obkcimipmjdkghadnfcjojepocldeggd/side_panel.html,
  https://www.doubao.com/chat/*]
```

#### 3.5.4 七天换肤排程

按 Agent × 周一~日矩阵，仅应用活跃使用时提醒，"现在切换/1小时后/今天跳过"三态。

---

## 4. 综合对比矩阵

| 维度 | Dream Skin | codex-autoskin | WorkBuddy-DS | codress | LingGlow | AgentSkin |
|------|-----------|---------------|-------------|---------|----------|-----------|
| Stars | 14,180 | 117 | 20 | 5 | 0 | — |
| 应用覆盖 | 1 | 1 | 1 | 2 | 3 | 6 |
| Token 系统 | 12-part | 28 | --wbds-* | 未公开 | 未公开 | 14 |
| 注入架构 | 单层 | 单层 | 三层 | engine+adapters | SwiftUI+Node | 四层编排 |
| 安全机制 | Safe CSS | extra.css 校验 | — | — | Pipe+指纹链 | Layer Ownership |
| 自动恢复 | Watcher backoff | LaunchAgent | — | — | — | — |
| 服务端 | 无 | 无 | 无 | Go+MySQL | 无 | 无 |
| 桌面宠物 | — | 有 | — | 有 | — | InjectDock |
| 审计 | 选择器溯源 | — | 7-gate | — | 3-stage | 11 不变量 |

---

## 5. 可借鉴点（按优先级排序）

### P0 — 高价值，可立即实施

| # | 借鉴点 | 来源 | 实施位置 | 预期收益 |
|---|--------|------|---------|---------|
| 1 | **选择器溯源系统** | Dream Skin | 扩展 C1 check-injection-contract | 防止声明覆盖与实际不一致，降低回归风险 |
| 2 | **Watcher 指数退避** | Dream Skin | engine-strategy / orchestrator 重连逻辑 | 减少无效轮询，降低日志噪声 |
| 3 | **CDP Pipe 传输选项** | LingGlow | 新增 pipe 模式（WebSocket 仍默认） | 对 doubao 等安全敏感目标消除端口暴露 |
| 4 | **Adapter 指纹链校验** | LingGlow | workbuddy/doubao adapter 增加版本指纹门控 | 防止应用更新后适配器静默失效 |
| 5 | **extra.css 作用域强制校验** | codex-autoskin | adapter CSS 加载时校验选择器锚定 | 防止主题 CSS 泄漏到其他应用 |
| 6 | **辅助窗口保护** | codex-autoskin | InjectDock 窗口检测逻辑增强 | 避免注入器误操作独立窗口 |

### P1 — 中等价值，需评估成本

| # | 借鉴点 | 来源 | 实施位置 | 预期收益 |
|---|--------|------|---------|---------|
| 7 | **安装前快照** | Dream Skin | installFlow store 增加首次注入快照 | 用户可一键回到"从未注入过"状态 |
| 8 | **图片→主题决策树** | codex-autoskin | image-theme-analyzer 增强分类策略 | 自动选择最佳处理策略 |
| 9 | **7-Gate 渲染后审计** | WorkBuddy-DS | 新增基于 CDP 的渲染后结构校验 | 超越静态 CSS 校验 |
| 10 | **双栈端口探测+断路器** | codex-autoskin | CDP 连接层增强 | 提升注入稳定性 |
| 11 | **合成层装饰动画** | LingGlow | DeepCore Shadow DOM 装饰层 | 减少布局抖动 |
| 12 | **豆包 URL scheme 参考** | LingGlow | doubao adapter 选择器补充 | 完善豆包适配覆盖 |

### P2 — 低优先级，长期参考

| # | 借鉴点 | 来源 | 说明 |
|---|--------|------|------|
| 13 | Safe CSS 白名单 | Dream Skin | 与现有 Token Ownership 可能重叠，暂不引入 |
| 14 | 三态事务配置编辑 | Dream Skin | 可强化 Atomicity Guarantor |
| 15 | Agent-native THEME-SPEC | codex-autoskin | 可为 Studio 提供 Agent 可读规范 |
| 16 | 适配器热修复 | codress | 无需服务端，仅配置文件热拉取 |
| 17 | 7 日排程提醒 | LingGlow | 与 Studio 定位冲突，仅参考 |
| 18 | 品牌覆盖 | LingGlow | 非 AgentSkin 方向 |

---

## 6. 实施计划

### Wave 1（立即实施，预计 1-2 天）

**目标**：选择器溯源 + Watcher 退避 + extra.css 校验

1. 扩展 `check-injection-contract` 脚本，为每个选择器增加 `provenance` 字段（source/strength/knownGaps/coveredVersions）
2. 修改 orchestrator 重连逻辑，实现渐进式 backoff（500ms→5s→30s）
3. 在 adapter CSS 加载时增加作用域校验（首选择器必须锚定目标应用）

### Wave 2（短期评估，预计 3-5 天）

**目标**：CDP Pipe + 指纹链 + 图片决策树

4. 评估 CDP Pipe 模式在 Electron 主进程侧的可行性
5. 为 workbuddy/doubao adapter 增加版本指纹门控
6. 增强 image-theme-analyzer 的图片分类决策树

### Wave 3（中期规划）

**目标**：安装快照 + 渲染后审计 + 豆包 URL scheme

7. installFlow store 增加首次注入快照
8. 新增基于 CDP 的渲染后结构校验 gate
9. 补充 doubao adapter 的 URL scheme 选择器

---

## 7. 风险与限制

- **Windows CDP Profile 问题**：Chromium 136+ 对默认 data directory 不再响应 `--remote-debugging-port`，所有基于 CDP 的注入工具都受影响
- **LingGlow 商业化路径**：Dodo Payments + 签名租约模式验证了变现可行性，但 AgentSkin 定位为引擎非产品
- **codress 服务端架构**：Go + MySQL 违反 AgentSkin 铁律，仅参考架构设计
- **单应用深度适配 vs 多应用统一**：Dream Skin/codex-autoskin 的 token 数量远超 AgentSkin 的 14 个，但这是单应用深度适配的结果，多应用场景下 AgentSkin 的抽象更合理

---

## 8. 下一步建议

1. **立即启动 Wave 1 实施**：选择器溯源 + Watcher 退避 + extra.css 校验（3 项 P0）
2. **评估 CDP Pipe 可行性**：对 doubao 适配的安全加固价值高，但需评估 Electron 主进程侧实现成本
3. **关注 Chromium 136+ CDP 兼容性**：此问题可能影响所有 6 个适配器的 Windows 端注入
4. **持续跟踪 LingGlow 商业化**：其 7 日排程 + VIP 模式虽不直接借鉴，但验证了用户付费意愿
