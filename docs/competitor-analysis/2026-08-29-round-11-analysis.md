# 竞品分析第 11 轮 — 2026-08-29 01:00

> 执行摘要：本期覆盖 5 个高价值新项目，发现 **aqua5230/usage**（302⭐）是目前 AI 工具配额追踪领域最活跃的跨平台菜单栏应用，其"自我修复 hook 版本管理"机制极具参考价值；**zhu1090093659/dsh-web**（6,375⭐）是增长最快的 AI 插件生态，"一切皆插件"架构和创意工坊分发模式值得研究；**vlln/whale-girl**（297⭐）的桌面宠物状态机设计为 AgentSkin 的 InjectDock 状态感知提供了新思路。提取可借鉴设计思想 12 项，推荐立即实施 2 项。

---

## 1. 轮换策略与项目选择

**已覆盖项目（避免重复，累计 102+ 个）**：
- Rotation 0-28 + Round 4-10：覆盖 102+ 个项目（详见各轮报告）

**本轮选择**：从"跨平台菜单栏应用 + 插件生态 + 桌面宠物 + 可配置皮肤系统 + Web 端换肤工具"五个维度选取 5 个新项目。

| # | 项目 | Stars | 活跃度 | 核心亮点 | 与 AgentSkin 关联 |
|---|------|-------|--------|---------|-------------------|
| 1 | aqua5230/usage | 302 | 🔥 极高（今日仍有提交） | 跨平台配额追踪 + 10 主题 + 自我修复 hook | 托盘 UX + 状态管理参考 |
| 2 | zhu1090093659/dsh-web | 6,375 | 🔥 极高（今日 10+ commits） | 插件聚合生态 + 创意工坊 + 救助模式 | 插件架构 + 生态分发参考 |
| 3 | vlln/whale-girl | 297 | 🔥 高（昨日仍有提交） | 桌面宠物状态机 + Agent 状态联动 | InjectDock 状态感知参考 |
| 4 | naniwet/dsh-themes | 1 | ⚠️ 停滞（11 天无更新） | 可配置皮肤系统 + 图片指纹缓存 | 主题缓存机制参考 |
| 5 | codexskin-cn/codexskin.cn | 1 | ⚠️ 停滞（45 天无更新） | Web 端 CDP 注入换肤 + SEO 运营 | 运营策略参考 |

---

## 2. 核心发现与行业趋势

### 趋势 1：AI 工具配额追踪成为独立赛道
`aqua5230/usage` 在 3 个月内从 0 增长到 302 Stars，证明"AI 工具使用量可视化"是真实刚需。其独特之处在于：
- **Local-first 架构**：零 LLM API 调用，所有数据来自本地日志
- **跨平台覆盖**：macOS 菜单栏 + Windows 系统托盘 + TUI 降级
- **自我修复 hook**：版本管理 + 自动替换过期脚本

### 趋势 2：AI 插件生态进入"创意工坊"时代
`zhu1090093659/dsh-web` 从 0 到 6,375 Stars 仅用 16 天，标志着 AI 工具生态从"功能竞争"转向"平台竞争"。其核心策略：
- **低门槛插件开发**：打标签即插件
- **创意工坊分发**：dsh-market.com 试穿→一键安装闭环
- **聚合包模式**：全家桶 + 独立插件双轨并行

### 趋势 3：桌面宠物成为 AI 客户端差异化手段
`vlln/whale-girl` 证明"桌面宠物 + Agent 状态联动"能显著提升用户粘性。其状态机设计（sleep/working/celebrate/interact）和积累型成长系统为 AgentSkin 的 InjectDock 提供了"从静态图标到动态伙伴"的演进方向。

### 趋势 4：配置驱动型皮肤系统趋向成熟
`naniwet/dsh-themes` 虽体量极小（3 个 JS 文件），但架构设计精巧："一个插件服务所有皮肤"的理念、图片指纹缓存机制、浏览器本地切换模式，与 AgentSkin 的 14-token 契约形成互补参考。

### 趋势 5：Web 端 CDP 注入工具开始涌现
`codexskin-cn/codexskin.cn` 验证了"桌面 AI 应用换肤"的市场需求，但其闭源模式与 AgentSkin 的开源路线形成对比。其中文 SEO + QQ 群运营策略值得参考。

---

## 3. 各项目详细分析

### 3.1 aqua5230/usage — AI 工具配额追踪器

#### 3.1.1 核心架构

```
用户 → 菜单栏/托盘 → 本地日志解析 → 配额/成本计算 → 可视化展示
                ↕
        self-heal hook（版本管理 + 自动修复）
```

#### 3.1.2 技术亮点

1. **跨平台实现**：
   - macOS：`rumps` + `pyobjc`（menubar 子包）
   - Windows：自研 `wintray/` + Edge WebView2
   - 降级方案：Rich + asyncio TUI

2. **自我修复 hook 机制**：
   - `TERSE_REMINDER_HOOK_VERSION` 常量管理版本
   - `_installed_terse_reminder_version()` 检测已安装版本
   - 版本不匹配时自动更新（非仅首次安装）
   - SessionStart hook + Resume hook + Reminder hook 三钩协同

3. **多语言支持**：
   - 从 sidecar 读取会话语言（而非环境变量）
   - 支持中/英/日等 5 种语言
   - 语言检测失败时回退到英文

4. **10 套主题**：
   - Catppuccin 配色系统集成
   - 明暗主题切换

#### 3.1.3 与 AgentSkin 对比

| 维度 | usage | AgentSkin |
|------|-------|-----------|
| 定位 | 配额追踪器 | 主题注入引擎 |
| 跨平台 | macOS + Windows + TUI | Electron（单窗口） |
| 主题系统 | 10 套预设主题 | 14-token 契约 + 无限主题 |
| 自我修复 | hook 版本管理 | automation-lock |
| 状态反馈 | 菜单栏实时数据 | InjectDock 静态图标 |

#### 3.1.4 可借鉴点

1. **【高可行性】自我修复版本管理**：当前 automation-lock 解决并发问题，但缺乏"安装脚本版本追踪 + 自动更新"能力。可引入类似的版本常量 + 检测 + 自动替换机制。
2. **【中可行性】状态感知托盘图标**：将 InjectDock 从静态图标升级为实时状态指示器（注入中/成功/失败/空闲）。
3. **【低可行性】多语言自动检测**：从 sidecar 读取语言而非环境变量的模式，可应用于 AgentSkin 的 i18n 系统。

---

### 3.2 zhu1090093659/dsh-web — 插件聚合生态包

#### 3.2.1 核心架构

```
dsh-web-all（聚合包）
├── dsh-client-ui-skin-center（皮肤中心）
├── dsh-client-ui-task-board（任务看板）
├── dsh-client-ui-git-graph（Git 图谱）
├── dsh-client-ui-mobile-bridge（移动端远程控制）
├── dsh-client-ui-ssh-terminal（SSH 运维终端）
├── dsh-client-ui-image-understanding（图像理解）
├── dsh-doctor（救助模式）
└── ...（18+ 独立 npm 包）
```

#### 3.2.2 技术亮点

1. **Cordis 元框架**：
   - 运行时是插件树（Profile → Bundle → Patch）
   - 插件通过 Service 注册 + 类型化事件 + 可逆效果协作
   - 卸载时自动撤销注册，零残留

2. **皮肤资产与逻辑分离**：
   - skin-center 插件负责加载逻辑
   - 皮肤只是纯资产包（skin.json + 样式/贴图/特效脚本）
   - 创意工坊做分发，试穿预览即时生效

3. **救助模式（Doctor）**：
   - 事务式救援：快照→应用规则→健康门禁→原子提升→失败字节回滚
   - 自我修复能力是其他项目完全没有的

4. **pnpm monorepo**：
   - 18+ 独立 npm 包（`@linxin666/dsh-*` scope）
   - 聚合包 + 独立安装双轨并行

#### 3.2.3 与 AgentSkin 对比

| 维度 | dsh-web | AgentSkin |
|------|---------|-----------|
| 注入层 | DSH Web UI 的 Cordis 插件树 | Electron 主进程 + CDP 注入 |
| 皮肤机制 | skin-center + skin.json 资产包 | 分层注入引擎 + 14-token 契约 |
| 主题契约 | skin.json（无严格 token 限制） | 14-token 强制契约 |
| 生态分发 | 创意工坊 dsh-market.com | 本地主题目录 + Studio |
| 治理成熟度 | 较弱（1.1 万插件仅约 1,000 能用） | 强（check-themes / C2 不变量守卫） |

#### 3.2.4 可借鉴点

1. **【中高可行性】创意工坊式社区分发**：dsh-market.com 的"试穿→一键安装→按设备点赞排序"闭环极大降低用户尝试门槛。AgentSkin 可在 Studio 中嵌入类似的社区主题浏览/试穿/安装体验（需遵守"禁止自建 CDN/服务端"规则，可借助 GitHub 静态托管）。
2. **【中可行性】事务式救助/回滚机制**：dsh-doctor 的"快照→修复→门禁→原子提升→字节回滚"模式对 AgentSkin 的注入失败回滚有直接参考价值。
3. **【参考警示】插件治理缺失的教训**：DSH 生态因"打标签即插件"导致 90% 插件质量存疑——反向证明 AgentSkin 的强约束治理是正确方向。

---

### 3.3 vlln/whale-girl — 桌面宠物插件

#### 3.3.1 核心架构

```
用户交互（拖拽/投喂/玩耍）
    ↓
状态机（sleep/working/celebrate/interact）
    ↓
守卫条件（armWorking/interactFromSleep/sizeConfigured）
    ↓
动画系统（CSS + SVG 帧动画）
    ↓
持久化（等级/互动历史）
```

#### 3.3.2 技术亮点

1. **状态机设计成熟**：
   - 状态转换有明确的守卫条件（guard）
   - `interactFromSleep` 捕获交互时刻状态而非轮询判定
   - `armWorking` 防止 working 插曲被 refresh 轮询重排

2. **Agent 状态联动**：
   - 宠物不是孤立动画循环
   - 与 Agent 的 turn/step 事件流绑定
   - 可通过 `agent.followup()` 反向与 Agent 交互

3. **积累型成长系统**：
   - 投喂/玩耍驱动等级成长
   - 数据持久化，用户有长期留存动力

4. **竞态修复意识**：
   - `sizeConfigured` 标志位取代 `lastConfigRevision` 数字比较
   - 多源配置竞争的实战解决方案

#### 3.3.3 与 AgentSkin 对比

| 维度 | whale-girl | AgentSkin |
|------|-----------|-----------|
| 定位 | DSH 生态内嵌桌宠 | 跨 6 适配器的桌面主题引擎 |
| 状态反馈 | 宠物动画实时反映 Agent 状态 | InjectDock 静态图标 |
| 用户互动 | 拖拽/投喂/玩耍/成长 | 主题切换/设置 |
| 事件来源 | DSH Session 事件流 | 主进程 IPC + CDP 注入 |

#### 3.3.4 可借鉴点

1. **【高可行性】状态感知托盘图标**：将 InjectDock 从静态图标升级为状态指示器——注入中/注入成功/注入失败/空闲四种状态对应不同图标或微动画。AgentSkin 已有 `status` store 和 `bootProgress` store，只需在 tray 渲染层增加状态→图标映射。
2. **【高可行性】事件驱动 UI 状态机**：whale-girl 的守卫条件模式可直接迁移到 AgentSkin 的注入状态管理。
3. **【中可行性】积累型互动系统**：为 InjectDock 增加轻量互动反馈——每次成功注入后托盘图标有微妙的"成长"动画。

---

### 3.4 naniwet/dsh-themes — 可配置皮肤系统

#### 3.4.1 核心架构

```
Node 半层（index.js + theme-route.js）
├── 配置校验（schemastery schema）
├── 图片 HTTP 服务
└── manifest 生成

浏览器半层（client.js, 25KB）
├── 纯展示层（无 React、无模块图）
├── 零构建依赖
└── localStorage 持久化
```

#### 3.4.2 技术亮点

1. **图片指纹缓存**：
   - `SHA1(filePath:mtime:size)` 作为查询后缀
   - 防止预设切换时浏览器缓存提供过期图片
   - 实现成本极低但效果显著

2. **浏览器本地切换**：
   - 用户选择存入 localStorage 而非配置文件
   - 每台设备有独立偏好而不污染主题文件
   - 即时生效，无需重载

3. **作用域隔离**：
   - 所有 CSS 规则嵌套在 `[data-dsh-theme]` 属性选择器下
   - 卸载时移除该属性和 `<style>` 元素即可完全恢复

4. **调色板设计**：
   - 7 个 palette key + displayFont
   - 直接覆盖应用自身的语义 token（`--dsh-alias-*`）
   - 明暗独立调优（accentLight/labelLight 独立值）

#### 3.4.3 与 AgentSkin 对比

| 维度 | dsh-themes | AgentSkin |
|------|-----------|-----------|
| 注入方式 | 平台插件 + HTTP 路由 | CDP WebSocket |
| Token 体系 | 7 key + font | 14-token 契约 |
| 主题格式 | YAML 配置块 | .agentskin-theme 包 |
| 切换持久化 | localStorage | IPC + Zustand Store |
| 明暗方案 | 独立值 | 14 token 含 light/dark |

#### 3.4.4 可借鉴点

1. **【高可行性】图片指纹缓存机制**：AgentSkin 当前缺少主题资源缓存清除机制。引入 `SHA1(path+mtime:size)` 查询后缀可彻底解决主题切换时的资源缓存问题。
2. **【高可行性】浏览器本地偏好持久化**：将用户选择存入 localStorage 而非修改主题包，允许每台设备有独立偏好。
3. **【中可行性】明暗独立调色值**：为关键 token 增加显式 light/dark 双值，而非从暗色方案派生。

---

### 3.5 codexskin-cn/codexskin.cn — Web 端 CDP 注入工具

#### 3.5.1 核心架构

```
用户 → 桌面客户端 → CDP WebSocket → Codex Desktop
                ↓
        主题库（10 款预设 + 自定义）
```

#### 3.5.2 技术亮点

1. **CDP 注入方式**：
   - `codex.connect({ transport: 'cdp', scope: 'localhost' })`
   - `theme.breathe('rose-room')` 命名引用主题
   - 不修改官方安装包，纯运行时注入

2. **极简体验**：
   - 四步流程：下载-浏览-连接-应用
   - 零配置门槛

3. **运营策略**：
   - 中文 SEO（长尾关键词堆叠）
   - QQ 群社区运营（群号 1026151952）
   - 自定义主题定制服务

#### 3.5.3 与 AgentSkin 对比

| 维度 | CodexSkin.cn | AgentSkin |
|------|-------------|-----------|
| 适配范围 | 仅 Codex 1 款 | 6 款 |
| 注入引擎 | CDP（单引擎） | 四引擎 + 编排层 |
| 主题格式 | 未公开 | .agentskin-theme |
| 开源程度 | 闭源 | 开源 |

#### 3.5.4 可借鉴点

1. **【高可行性】SEO/流量策略**：中文 SEO 意识强，AgentSkin 当前无对应落地页。
2. **【中可行性】主题别名引用**：`theme.breathe('rose-room')` 用命名而非路径引用主题，降低用户心智负担。
3. **【低可行性】QQ 群社区运营**：中文即时反馈渠道对桌面工具用户粘性有价值。

---

## 4. 推荐实施方案

### 方案 A：图片指纹缓存机制（来源：naniwet/dsh-themes）

**问题**：AgentSkin 切换主题或壁纸时，浏览器可能提供过期缓存图片，导致视觉不一致。

**方案**：为所有主题资源 URL 添加基于文件内容的指纹查询后缀。

**实现位置**：`src/shared/theme/` 新增 `asset-fingerprint.ts`

**预期收益**：
- 彻底解决主题切换时的资源缓存问题
- 实现成本极低（几行代码）
- 零副作用

### 方案 B：状态感知托盘图标（来源：vlln/whale-girl）

**问题**：AgentSkin 的 InjectDock 托盘图标是静态的，无法反映当前注入状态。

**方案**：将托盘图标从静态升级为状态指示器，根据 `status` store 的状态动态切换图标。

**实现位置**：`src/main/tray.ts` + `src/shared/status/`

**预期收益**：
- 用户可直观感知注入状态
- 提升产品专业感
- 已有 `status` store 基础，实现成本低

---

## 5. 下一步计划

1. **立即执行**：方案 A（图片指纹缓存）— 高可行性、低风险、解决实际痛点
2. **立即执行**：方案 B（状态感知托盘）— 高可行性、用户体验提升
3. **后续研究**：创意工坊式社区分发（需评估"禁止自建 CDN/服务端"规则的边界）
4. **持续关注**：aqua5230/usage 的自我修复 hook 机制演进

---

*分析基于 2026-08-29 实时数据，信息来源：GitHub API、仓库 README、官网等公开渠道。*
