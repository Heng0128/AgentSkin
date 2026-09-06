# 第 24 轮竞品深度分析报告 — 桌面宠物 / AI 装饰生成 / 双应用母舰 / 一键安装器 / 117 预设生态

> 报告日期: 2026-08-30 07:00
> 分析项目: 5 个（覆盖 桌面宠物 / AI 装饰生成 / Skill 化 / WorkBuddy 专用 / macOS Tauri）
> 重点适配目标: traework, qoderwork, workbuddy, doubao, codex, zcode

---

## 一、⚠️ 重大发现：HeiGeAi 爆发至 443⭐ 并扩展 WorkBuddy

**HeiGeAi/heige-codex-skin-studio** 从上一轮分析的 25⭐ 爆发至当前 **443⭐ / 65 Forks**，且 v5.5.15 已扩展支持 **WorkBuddy（国产 AI）**。这是本轮最重大的竞品信号。

| 维度 | 数据 |
|------|------|
| Stars | 443（2 周内从 25 → 443，17 倍增长）|
| Forks | 65 |
| 版本 | v5.5.15 |
| 最后 push | 2026-08-23（7 天前，仍在活跃）|
| 许可 | MIT |
| 语言 | JavaScript |
| 架构 | macOS 独立启动器 + Windows 脚本 + 12 内置主题 |

> **战略意义**: HeiGeAi 已验证"图片即主题 + 二次元文化 + 一键安装"在国内市场的爆发力。其 WorkBuddy 适配说明它正从 Codex 单 agent 工具向多 agent 方向扩张，直接威胁 AgentSkin 的 WorkBuddy 阵地。

---

## 二、分析项目概览

| # | 项目 | Stars | 语言 | 创建 | 最后 push | 活跃度 | 与我们关系 |
|---|------|-------|------|------|-----------|--------|-----------|
| 1 | [waiterxiaoyy/codress](https://github.com/waiterxiaoyy/codress) | 5 | TypeScript | 2026-07-20 | 2026-07-26 | 停滞 | **双应用母舰**（Codex + WorkBuddy）+ 桌面宠物 |
| 2 | [sysxdc/workbuddy-skin-lab](https://github.com/sysxdc/workbuddy-skin-lab) | 0 | JavaScript | 2026-07-22 | 2026-08-10 | 停滞 | **WorkBuddy 专用**，AI 装饰生成 + 回环 CDP |
| 3 | [GiantClam/codex-theme-studio-skill](https://github.com/GiantClam/codex-theme-studio-skill) | 1 | JavaScript | 2026-07-17 | 2026-08-14 | 停滞 | **Skill 化换肤**，HeiGeAi fork + 独立运行时 |
| 4 | [zhouwei713/WorkBuddy-Dream-Skin](https://github.com/zhouwei713/WorkBuddy-Dream-Skin) | 20 | CSS | 2026-07-19 | 2026-07-24 | 停滞 | **WorkBuddy 专用**，14 主题 + 托盘 + GIF + 图片驱动 |
| 5 | [d100000/CodeX-Skin](https://github.com/d100000/CodeX-Skin) | 0 | JavaScript+Rust | 2026-07-18 | 2026-07-26 | 停滞 | **macOS Tauri**，117 预设 + 一键安装 + Studio UI |

---

## 三、各项目技术亮点深度剖析

### 3.1 waiterxiaoyy/codress — 双应用母舰 + 桌面宠物

**项目定位**: "Refresh your AI workspace. One-click themes, desktop pets, and local asset management for Codex and WorkBuddy."

**核心架构 — Electron 33 + Node 20 + Go 1.24 三语言栈**:

```
codress/
├── apps/desktop/          # Electron 桌面客户端
│   ├── src/main/          # CDP, launcher, pets, updates, IPC
│   └── src/renderer/      # React 桌面 UI
├── admin/                 # React + Ant Design 管理控制台
├── packages/skin-schema/  # 共享主题数据契约
├── server/                # Go API（主题/宠物/分类/版本）
└── deploy/                # MySQL + 部署配置
```

**高价值借鉴 — 桌面宠物系统**:

| 宠物类型 | 描述 |
|---------|------|
| Codex v2 Pets | 官方宠物，安装到 Codex 内部 |
| Floating Desktop Pets | 独立悬浮桌面伴侣（不依赖 Codex）|

> AgentSkin 当前无桌面宠物功能。Codress 的"浮动桌面伴侣"模式（独立于目标应用运行）是一种低耦合的宠物实现方式，可作为 AgentSkin 的可选增强。

**高价值借鉴 — 本地主题创建器**:

- 无账号即可使用，作品保存在用户本机
- 预览 + 调整构图、图片处理、外观
- 共享 background/panel/text/accent palette
- 账号同步、远程收藏、社区发布为隐藏功能（待就绪后解锁）

> AgentSkin 当前主题创建依赖 Studio 面板。Codress 的"无账号本地创建 + 可选社区发布"模式降低了创作门槛。

**高价值借鉴 — 安全边界**:

- CDP 连接限定 loopback 地址
- WebSocket 目标检查预期形状和进程
- 商店主题只含图片和元数据，不含可执行代码
- 注入运行时随 Codress 客户端一起提供，不从主题包动态加载

> 这与 AgentSkin 的"主题包零信任"理念一致。Codress 的"注入运行时与客户端绑定"模式可参考。

**支持矩阵**:

| 目标 | 主题 | 宠物 | 平台 |
|------|------|------|------|
| Codex | ✅ 支持 | Codex v2 + 浮动宠物 | macOS / Windows |
| WorkBuddy | ✅ 支持 | 尚不可用 | macOS / Windows |

---

### 3.2 sysxdc/workbuddy-skin-lab — AI 装饰生成 + 回环 CDP

**项目定位**: "给 WorkBuddy 换一张喜欢的背景、加一点好看的环境粒子，变成一件简单、可恢复、能长期使用的事。"

**核心创新 — AI 装饰生成系统**:

| 能力 | 说明 |
|------|------|
| 背景替换 | 保护边缘、输入框、回答区的可读性 |
| 环境粒子 | 模糊、雪花、雪花、爱心、星星、手画符号 |
| AI 生成 PNG | 一次性生成，之后无需 AI 即可复用 |
| 持久化 | 主题 + AI 装饰 + 运行状态保存到本机 |
| 一键恢复 | 删除当前显示效果，不删除主题文件 |

**高价值借鉴 — AI 装饰工作流**:

```
用户选择/上传图片 → AI 生成 3 个候选 PNG 装饰 → 用户选择 → 保存为主题
```

> **关键设计**: AI 只负责"一次性生成候选 PNG"，之后用户切换主题无需 AI。这避免了 API Key 依赖和隐私问题。AgentSkin 可借鉴此"AI 生成 + 本地缓存"模式实现装饰/壁纸智能推荐。

**高价值借鉴 — 装饰层设计**:

- 所有装饰都在背景层，`pointer-events: none`
- 不能点击、不会劫持输入框、按钮或卡片
- 系统启用"减少动画"时装饰自动静止

> 这与 AgentSkin 的 DeepCore 装饰层设计一致。`pointer-events: none` + `减少动画`适配是装饰系统的最佳实践。

**高价值借鉴 — 隐私保护**:

- 主题和 AI 装饰默认保存在本机 `%LOCALAPPDATA%\WorkBuddySkinLab\themes`
- 不使用 API Key、不创建远程图片链接或大型 Base64 写入主题
- 不把私人主题、截图、`.env` 或 API Key 提交到 GitHub
- AI 生成前确认图像生成服务的隐私政策与生成内容许可证

**三步上手**:

1. 从 Release 下载 `WorkBuddy-Skin-Lab-1.5.3-Windows.zip`
2. 完整解压后双击 `环境检测.bat`
3. 双击 `开始使用.bat`，确认后重启 WorkBuddy

> AgentSkin 当前安装流程较复杂（npm install + 构建）。Skin Lab 的"解压即运行"模式用户体验更优。

---

### 3.3 GiantClam/codex-theme-studio-skill — Skill 化换肤 + 独立运行时

**项目定位**: "Independent lightweight Codex Skin Studio: an AI-orchestrated ChatGPT Desktop skin Skill and local runtime."

**核心架构 — HeiGeAi fork + 独立化**:

- 父仓库: HeiGeAi/heige-codex-skin-studio (443⭐ / 65 Forks)
- GiantClam fork 于 2026-07-17，最后 push 2026-08-14
- 定位为"独立轻量版"，增加 AI 编排 + 本地运行时

**高价值借鉴 — Skill 化换肤**:

- 整个项目是一个被 AI Agent 消费的 Skill
- 用户说"帮我换个皮肤"，AI 自动克隆 → 运行 → 选主题 → 验证
- 无需人类手动操作

> 这与 AgentSkin 的 Studio Skill 定位类似。但 GiantClam 走得更远——整个产品就是 Skill，没有独立 GUI。

**战略性信号**:

- HeiGeAi 母库 443⭐ 说明"二次元 + 图片即主题"赛道仍在爆发
- GiantClam fork 说明社区在探索"Skill 化 + 独立运行时"方向
- 但 GiantClam 本身 1⭐ 且停滞，说明独立 fork 缺乏持续维护

---

### 3.4 zhouwei713/WorkBuddy-Dream-Skin — 14 主题 + 托盘 + GIF + 图片驱动

**项目定位**: "Community image-driven skin for Tencent WorkBuddy desktop. External CDP injection, fully reversible, zero-dep, Windows tray."

**核心能力矩阵**:

| # | 能力 | 说明 |
|---|------|------|
| 1 | WorkBuddy 窗口/对话/输入/设置/任务页面背景 | 含 Electron 37 窗口圆角适配 |
| 2 | GIF/静态/更新背景三图层 | 背景层 + 主题层 + 装饰层 |
| 3 | 图片位置/尺寸/模糊/亮度/整屏色调调整 | 精细控制 |
| 4 | 主题保存/加载/切换/删除 | JSON 结构化 |
| 5 | 运行时切换主题 + 页面刷新后自动重新注入 | 持久化 |
| 6 | 一键恢复官方外观 + 可选正常模式重启 | 安全还原 |
| 7 | 截图 + 结构化 JSON 结果留档 | 调试友好 |
| 8 | 输入图片分析（明暗/浓淡），自动匹配少女粉/薄荷花房/日出校园/深海夜航/命运红 UI 配色 | 智能配色 |
| 9 | GIF 背景 + 主题/自定义挂件 | 动态效果 |
| 10 | Windows 系统托盘图标 | 常驻后台 |
| 11 | 14 套内置主题 | 开箱即用 |
| 12 | 皮肤制作 Skill（skills/workbuddy-skin-maker）| AI 辅助创建 |

**高价值借鉴 — 14 套内置主题命名**:

| 主题名 | 风格 |
|--------|------|
| deep-sea-layered | 深海分层 |
| gilded-night-banquet | 镀金夜宴 |
| sunlit-campus | 日照校园 |
| pink-dream-petals | 粉梦花瓣 |
| mint-bloom-studio | 薄荷花房 |
| crimson-scifi | 赤红科幻 |
| neon-hatsune | 霓虹初音 |
| violet-midnight | 紫罗兰午夜 |
| stage-blackgold | 舞台黑金 |
| fortune-crimson | 命运红 |
| zero-bug-shrine | 零 Bug 神社 |
| zero-bug-shrine-maid | 零 Bug 巫女 |
| porcelain-bloom | 瓷花绽放 |
| amber-nightlamp | 琥珀夜灯 |

> 主题命名充满二次元/打工人文化（"零 Bug 神社"、"巫女"），说明 WorkBuddy 用户群体与二次元文化高度重合。AgentSkin 可参考此命名策略增强主题吸引力。

**高价值借鉴 — 托盘 + 一键还原**:

- 安装到 `%LOCALAPPDATA%\WorkBuddyDreamSkin\app`
- 创建桌面和开始菜单快捷方式
- 托盘图标：启用/禁用皮肤、切换主题、挂件显示、恢复默认
- 不修改 WorkBuddy 安装文件、不创建计划任务

> AgentSkin 的 InjectDock 是应用内浮动面板。Dream Skin 的系统托盘模式是另一种常驻后台思路。

**技术栈**:

| 技术 | 用途 |
|------|------|
| PowerShell 5.1 | 启动/恢复/重启/托盘/主题管理 |
| Node.js 22 | CDP WebSocket 客户端、页面探测、运行时注入 |
| Chrome DevTools Protocol | 连接 Electron 页面、执行脚本、监听导航 |
| JavaScript | 样式注入、图片 Blob URL 管理、截图 |
| CSS | 页面主题、分层背景、半透明面板、交互状态 |
| JSON | 主题 Schema、运行状态、恢复结果 |
| SVG | 内置背景 + 拍立得装饰卡 |

---

### 3.5 d100000/CodeX-Skin — macOS Tauri + 117 预设 + 一键安装

**项目定位**: "你的 Codex，不该只有一种样子。117 套主题，让 AI 编程第一次有了专属皮肤。"

**核心架构 — Tauri + React + Rust CDP**:

```
aha-codex/
├── src/              # React Studio UI + 预览 + 桌面窗口
├── src-tauri/        # macOS 应用 + 菜单栏 + 进程管理 + 原生 CDP 客户端
├── tools/
│   ├── build-skin-agent.mjs    # 从纯函数核心生成自包含 Skin Agent
│   └── build-image-themes.py   # 分析 Image/ 目录，生成装饰和主题
├── installer/
│   └── manager/00-core.js      # Studio 和注入器共用主题归一化、校验与 CSS 拼接
└── theme/            # 主题库 + manifest + schema (v2)
```

**高价值借鉴 — 117 套预设主题**:

| 类别 | 数量 | 说明 |
|------|------|------|
| 基础预设 | 4 | 4 套基础配色 |
| AI 生成图片主题 | 113 | 按人物风格与主色智能生成 |

> 117 套预设来自"基础预设 + AI 生成图片主题"组合。AgentSkin 当前 15 套内置主题，可借鉴"基础 + AI 生成"的组合模式扩展预设数量。

**高价值借鉴 — 一键安装器**:

```bash
curl -fsSL https://raw.githubusercontent.com/d100000/CodeX-Skin/main/install.sh | bash
```

- 无需 DMG、无需绕过 Gatekeeper
- 装完直接启动
- 之后每次升级由应用自动完成

> AgentSkin 当前安装流程复杂。CodeX-Skin 的"一行命令安装"模式用户体验极致简化。

**高价值借鉴 — Studio 1:1 模拟**:

- Studio 内置 1:1 的 Codex 模拟画面
- 改一个参数，预览立变
- 打开"应用皮肤"，Codex 界面同步跟着变

> AgentSkin 的 Studio 面板是独立 UI，不模拟目标应用。CodeX-Skin 的"1:1 模拟预览"模式提供更直观的主题编辑体验。

**高价值借鉴 — 安全模型**:

| 限制 | 实现 |
|------|------|
| 不碰 ASAR | 不从 Applications 里动 Codex 安装包 |
| 皮肤随时暂停/恢复 | Codex 立回到原样 |
| 签名验证 | 每个更新包都经 minisign 签名校验 |
| 循环地址锁定 | 换肤通道只绑定本机回环地址 |
| 自动版本适配 | 检测到 Codex 版本变化自动提示安全重启 |

**主题存储**:

- 主题库保存在 `~/Library/Application Support/com.dolskin.studio/library.json`
- 支持从 v1 到 v2 的 schema 迁移
- IndexedDB 本地主题管理
- 运行时 loopback-only、no-ASAR、no-data-URL 安全限制

---

## 四、跨项目对比与 AgentSkin 定位

### 4.1 主题契约对比

| 维度 | AgentSkin | codress | skin-lab | Dream Skin | CodeX-Skin |
|------|-----------|---------|----------|------------|------------|
| 契约大小 | 14 token | 共享 schema | 无显式 | CSS + JSON | v2 manifest |
| 注入方式 | CDP 四引擎 | CDP 运行时 | CDP 回环 | CDP + PowerShell | Rust CDP |
| 桌面宠物 | ❌ | ✅ Codex v2 + 浮动 | ❌ | ❌ | ❌ |
| 主题数量 | 15 内置 | 商店 | 本机生成 | 14 内置 | 117 内置 |
| 一键安装 | ❌ | ❌ | ✅ 解压即运行 | ✅ 脚本安装 | ✅ curl \| bash |
| 目标应用 | 6 固定 | 2（Codex+WB）| 1（WB）| 1（WB）| 1（Codex）|
| 平台 | Electron | Electron 33 | Node CLI | PowerShell + Node | Tauri |

### 4.2 AgentSkin 结构性优势

1. **多引擎编排** — 4 引擎分工 + 编排层 + InjectionLock/Queue，竞品无此架构
2. **6 适配器** — 覆盖 6 个目标应用，竞品多为单应用
3. **14-token 显式契约** — 比 Dream Skin 的 CSS 隐式更稳定
4. **原子写入 + 并发控制** — atomicWriteJson + epoch-manager + automation-lock
5. **版本化适配器** — 每个 Agent 有独立适配器

### 4.3 AgentSkin 可追赶方向

1. **桌面宠物** — codress 的浮动桌面伴侣模式（独立于目标应用）
2. **AI 装饰生成** — skin-lab 的"AI 一次性生成 + 本地缓存"模式
3. **一键安装** — CodeX-Skin 的 `curl | bash` 极致简化
4. **1:1 模拟预览** — CodeX-Skin 的 Studio 内嵌目标应用模拟
5. **托盘常驻** — Dream Skin 的系统托盘模式（补充 InjectDock）
6. **预设数量** — 117 套预设的"基础 + AI 生成"组合模式

---

## 五、可借鉴方案优先级排序

| 优先级 | 方案 | 来源 | 工作量 | 价值 |
|--------|------|------|--------|------|
| **P0** | 一键安装脚本 — `curl \| bash` 极致简化 | CodeX-Skin | 低 | 高 — 用户体验质的飞跃 |
| **P0** | 桌面宠物系统 — 浮动桌面伴侣 | codress | 中 | 高 — 差异化竞争力 |
| **P1** | AI 装饰生成 — 一次性生成 + 本地缓存 | skin-lab | 中 | 中 — 智能推荐 |
| **P1** | 1:1 模拟预览 — Studio 内嵌目标应用模拟 | CodeX-Skin | 中 | 中 — 直观编辑 |
| **P2** | 托盘常驻模式 — 系统托盘 + 一键切换 | Dream Skin | 低 | 中 — 补充 InjectDock |
| **P2** | 预设扩展 — 基础 + AI 生成组合 | CodeX-Skin | 中 | 低 — 锦上添花 |
| **P3** | Skill 化换肤入口 | GiantClam | 需 RFC | 低 — 长期方向 |

---

## 六、禁止事项清单（本轮确认）

| 禁止项 | 来源 | 原因 |
|--------|------|------|
| ❌ 新增非目标应用适配器 | 全部 | 黄金规则 1 — 仅 6 个目标应用 |
| ❌ 修改 app.asar / 签名文件 | 全部 | 黄金规则 — 零修改目标安装 |
| ❌ 自建 NestJS/Go 后端 | codress (Go server) | 黄金规则 3 — 禁止自建服务端（学习其安全模型即可）|
| ❌ 移植 WorkBuddy 专用 CSS 选择器 | Dream Skin, skin-lab | 仅学习其设计思想，选择器需适配 AgentSkin 的 workbuddy 适配器 |

---

## 七、实施计划

### 7.1 本轮推荐 3 项可立即实施（无需 RFC）

1. **P0-1: 一键安装脚本**
   - 位置: `scripts/install.sh` + `scripts/install.ps1`
   - 内容: 检测平台 → 下载最新 Release → 解压到用户目录 → 创建快捷方式
   - 预期: `curl -fsSL https://agentskin.dev/install.sh | bash` 一键安装
   - 工作量: 1-2 天 + 测试

2. **P0-2: 桌面宠物系统（浮动伴侣模式）**
   - 位置: `src/main/pets/` + `src/ui/components/PetViewer.tsx`
   - 内容: 独立悬浮窗口 + 宠物资源包 + 位置记忆 + 独立开关
   - 预期: 不依赖目标应用，独立运行
   - 工作量: 2-3 天 + 测试

3. **P1-1: AI 装饰生成（一次性 + 本地缓存）**
   - 位置: `src/main/profile/decoration-generator.ts`
   - 内容: 调用本地图像分析 → 生成装饰 PNG → 缓存到主题目录
   - 预期: 无需 API Key，一次性生成后离线使用
   - 工作量: 2-3 天 + 测试

### 7.2 需 RFC 评审（长期方向）

1. **Skill 化换肤入口**: 为已适配的 6 个应用增加 Agent-native 交互层
   - 需 RFC 评审（新增交互模式）
   - 参考: GiantClam/codex-theme-studio-skill
   - 价值: "换个皮肤"一句话完成，无需打开 UI

---

## 八、下一步建议

### 8.1 持续追踪项目

| 项目 | 追踪理由 | 检查频率 |
|------|---------|---------|
| HeiGeAi/heige-codex-skin-studio | 443⭐ 爆发中，已扩展 WorkBuddy | 每日 |
| zhouwei713/WorkBuddy-Dream-Skin | 20⭐，WorkBuddy 专用竞品 | 每周 |
| d100000/CodeX-Skin | 117 预设 + Tauri 架构 | 每周 |
| sysxdc/workbuddy-skin-lab | AI 装饰生成创新 | 每 2 周 |
| waiterxiaoyy/codress | 双应用 + 宠物 | 每 2 周 |

### 8.2 下一步行动

| 编号 | 建议 | 优先级 |
|------|------|--------|
| N24-1 | 实施 P0-1: 一键安装脚本 | 本轮立即执行 |
| N24-2 | 实施 P0-2: 桌面宠物系统 | 本轮立即执行 |
| N24-3 | 实施 P1-1: AI 装饰生成 | 本轮立即执行 |
| N24-4 | 起草 Skill 化换肤 RFC | 下轮准备 |
| N24-5 | 评估 Tauri 替代 Electron 的可行性 | 长期调研 |

---

## 附录：子报告位置

- waiterxiaoyy/codress 深度分析: 本报告 §3.1
- sysxdc/workbuddy-skin-lab 深度分析: 本报告 §3.2
- GiantClam/codex-theme-studio-skill 深度分析: 本报告 §3.3
- zhouwei713/WorkBuddy-Dream-Skin 深度分析: 本报告 §3.4
- d100000/CodeX-Skin 深度分析: 本报告 §3.5

---

> 本轮分析覆盖了"桌面宠物"（codress）、"AI 装饰生成"（skin-lab）、"Skill 化换肤"（GiantClam）、"WorkBuddy 专用极致体验"（Dream Skin）、"macOS Tauri 一键安装"（CodeX-Skin）五个方向。最重大发现是 HeiGeAi 从 25⭐ 爆发至 443⭐ 并扩展 WorkBuddy，直接威胁 AgentSkin 的 WorkBuddy 阵地。建议立即实施一键安装脚本 + 桌面宠物系统，保持用户体验领先。
