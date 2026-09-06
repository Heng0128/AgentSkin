# WorkBuddy 换肤生态学习报告

> 2026-08-29 | 对标 15 个 WorkBuddy 换肤仓库，提取可借鉴工程设计并对比 AgentSkin 差距

## 一、概述

### 1.1 背景

社区围绕腾讯 WorkBuddy（月活 1115 万）自发形成了换肤生态，与 AgentSkin 类似，均采用 CDP 注入方案（不修改 app.asar、不破坏签名）。这些仓库规模虽小（0-169 stars），但在用户体验、安装流程、社区运营等方面提供了有价值的参考。

### 1.2 样本说明

本报告覆盖 15 个仓库，按 Stars 分为三档：

| 档位 | Stars | 仓库数 | 代表 |
|------|-------|--------|------|
| 头部 | 100+ | 1 | cdredfox/workbuddy-skin-studio (169) |
| 腰部 | 10-30 | 3 | zhouwei713 (20)、comeonzhj (18)、itcastWsy (9) |
| 尾部 | 0-9 | 11 | 其余仓库 |

数据通过 web_search + raw README 抓取，2 个头部仓库获取了完整 README，其余通过文章/文档间接获取。

---

## 二、共性特征（全部 15 仓库的交集）

### 2.1 核心技术路线

| 维度 | 共识 |
|------|------|
| 注入方式 | 全部使用 CDP（`--remote-debugging-port` + 127.0.0.1 回环） |
| 文件安全 | 不修改 app.asar / 安装目录 / 代码签名 |
| 运行时机 | WorkBuddy 启动后注入，存活于 renderer 进程 |
| 可撤销 | 暂停/恢复脚本一键回到原生界面 |
| 主题热切换 | 无需重启 WorkBudy，注入后零等待切换 |

### 2.2 共同的用户体验

| 特征 | 说明 |
|------|------|
| 图片生成主题 | 任意图片 → 自动取色 → 生成配色方案 |
| 深浅色适配 | 根据主色明度自动切换 `data-vscode-theme-kind` |
| GIF 支持 | 部分仓库支持动态 GIF 背景 |
| 托盘/菜单 | 常驻托盘图标或右上角 🎨 菜单，即点即换 |

### 2.3 共同的技术边界

- WorkBuddy 完整重载后会丢失注入（CDP 天性），需重新 apply
- 调试端口仅绑定 127.0.0.1，拒绝局域网暴露
- 仅覆盖 WorkBuddy 的 `--cb-*` 变量系统（60+ 个 CSS 变量）
- 使用 `[data-view-id]` DOM 锚点做结构适配

---

## 三、头部仓库深度分析

### 3.1 cdredfox/workbuddy-skin-studio（169 stars）

**定位**：AI 优先的轻量换肤工具，Star 数最高。

#### 3.1.1 极简主题格式

```json
{
  "schemaVersion": 1,
  "id": "my-skin",
  "name": "My Skin",
  "hero": "hero.webp",
  "colors": {
    "accent": "#24C9D7",
    "secondary": "#EF8FD3",
    "surface": "#F7FBFF",
    "text": "#17344F"
  }
}
```

仅 4 个颜色字段（accent / secondary / surface / text），hero 图片必填，其余可选。这是所有竞品中最简单的主题格式。

#### 3.1.2 AI-First 安装流

仓库根目录内置 `SKILL.md`，AI 助手读取后自动完成：
1. 平台检测（macOS / Windows）
2. 运行对应 apply 脚本
3. 注入主题
4. 验证状态
5. 异常还原

用户只需说「用这个项目帮我换 WorkBuddy 主题」，完全无需手动操作。

#### 3.1.3 内置主题（10 套）

- Miku ×2、原神 ×2（晨曦/星夜）、鸣潮 ×2（共鸣/声骸）、火影忍者 ×2（鸣人/佐助）、恋与深空 ×2（晨曦/星辰）

#### 3.1.4 图片取色方案

Canvas 像素级扫描 → 提取主色/辅色/面板底色/文字色 → 压缩为 WebP → 持久化到 localStorage。

#### 3.1.5 深浅色判定

```
surface 明度 > 140 → light 模式
surface 明度 ≤ 140 → dark 模式
```

自动切换 `data-vscode-theme-kind`，让 VS Code 原生控件跟随变化。

#### 3.1.6 项目结构

```
├── SKILL.md                   # AI 安装流程
├── src/cli.mjs                # 命令行入口
├── scripts/
│   ├── apply.command          # macOS 安装
│   ├── apply.ps1              # Windows 安装
│   ├── pause.command/pa.ps1   # 恢复原生
│   └── find-workbuddy.ps1     # 环境排查
└── themes/                    # 内置主题目录
```

### 3.2 comeonzhj/WorkBuddy-theme-skill（18 stars）

**定位**：最「产品化」的方案，同时提供 Electron 桌面应用 + CLI + Agent Skill 三形态。

#### 3.2.1 主题格式

多文件结构，比 cdredfox 更完整：

```text
<theme-id>/
├── theme.json                # 元数据
├── theme.css                 # 完整 CSS 控制
├── preview.png               # 预览图
├── artwork.png               # 可选艺术图
└── preview.html              # 可选设计预览
```

#### 3.2.2 社区主题库同步

`registry.json` 作为索引 → 仅下载增量更新 → 逐文件 SHA-256 校验 → 原子化安装。这是 AgentSkin 目前不具备的能力。

#### 3.2.3 单实例守护进程

Theme Manager 以单实例运行，自动接管旧版 CLI 换肤工具留下的守护进程，避免多实例同时注入 CSS 导致主题闪烁。

#### 3.2.4 跨平台签名公证

- macOS：Developer ID Application + Hardened Runtime + Apple 公证 + Staple
- Windows：暂无代码签名（SmartScreen 提示）
- 构建：GitHub Actions 在 macOS/Windows 原生 Runner 上分别构建

#### 3.2.5 安全边界

| 维度 | 措施 |
|------|------|
| 端口 | 仅 127.0.0.1，不监听局域网 |
| 文件 | 不修改/解包 WorkBuddy |
| Electron | 上下文隔离 + 沙箱 + 严格 CSP + 最小 IPC API |
| ZIP 导入 | 拒绝可执行文件、远程样式、路径穿越、超限内容 |
| GitHub 同步 | 固定 HTTPS raw-content + 逐文件哈希校验 |
| 主题资源 | 必须在主题目录内，禁止远程脚本 |

#### 3.2.6 Agent 全流程 Skill

SKILL.md 不只教写 CSS，涵盖：设计契约 → 主题校验 → 打包 → 应用 → 状态检查 → 恢复 → 社区投稿。

### 3.3 zhouwei713/WorkBuddy-Dream-Skin（20 stars）

**定位**：Codex-Dream-Skin（12K stars）的 WorkBuddy 移植版，强调个性化。

#### 3.3.1 特色能力

- **托盘功能**：右下角系统托盘右键菜单（切主题/换图/开关挂件/恢复），原 Codex 项目没有
- **14 套主题**：赤霄科幻、深海夜航、绯樱少女、薄荷花房、Q 版打工财神爷、巫女 BUILD PASSED 御守等
- **像素级色调打分**：扫出主色相和明度 → 从粉/绿/青/金/蓝五套色板选最搭的 UI 配色
- **GIF 背景**：丢动图进去桌面立马活起来

### 3.4 majiabin2020/workbuddy-theme-skin-skill

**定位**：最「深入」的 Skill，提供完整 DOM 类名参考，不仅换肤还支持：

- 替换文字（应用名称、标语）
- 替换头像
- 隐藏界面元素（如广告按钮）
- 可重复使用的启动器

这比其他仓库的「只换 CSS」更进一层，触及了 DOM 结构操作。

---

## 四、腰部与尾部仓库特征

### 4.1 Stars 分布

```
169 █                    cdredfox
 20 █                    zhouwei713
 18 █                    comeonzhj
  9 █                    itcastWsy
  5 █                    huangama666, zhangxiaoqiang1991
  3 █                    sutongwuyanzu
  2 █                    quanzhankeji, TimekeeperXY
  1 █                    leeandrew94(→kimilee94), RED523
  0 █                    ozrwayne, sysxdc, shaozhengmao
```

### 4.2 共性

- 全部是个人开发者的小项目
- 多数为 CDRedfox 或 Codex-Dream-Skin 的 fork / 二改
- 多数已停更（最后一 commit 多在 2026 年 6-7 月）
- 仅 comeonzhj 有完整的贡献指南、版本规范、CI/CD

### 4.3 一个仓库的变迁

leeandrew94/workbuddy-ambient-skin → 更名 → kimilee94/workbuddy-ambient-skin，说明作者在维护但可能因品牌问题更名。

---

## 五、可借鉴的工程设计（优先级排序）

### P0：强烈建议采纳

#### 5.1 AI-First 安装流（来自 cdredfox）

**现状**：AgentSkin 需要用户手动运行 `npm start`，对非技术用户门槛高。

**借鉴点**：在仓库根目录放置 `SKILL.md`，描述：
1. 环境检测（Node 版本、应用是否安装）
2. 平台判别（macOS / Windows）
3. 启动注入器
4. 验证 + 异常还原

**用户价值**：把 GitHub 地址丢给任意 AI 助手 → 一句话完成安装。

**适配考虑**：AgentSkin 是完整 Electron 产品，安装流比这些轻量工具复杂。但可以针对「应用主题」场景提供类似的 Skill，让 AI 助手代劳。

#### 5.2 社区主题库同步（来自 comeonzhj）

**现状**：AgentSkin 的 Studio 是本地创作工具，无远程主题市场。

**借鉴点**：
- `registry.json` 作为中心化索引
- 增量同步（仅下载有更新的版本）
- SHA-256 校验（防篡改）
- 原子化安装（先下载到临时目录再 move）

**用户价值**：一键浏览和安装社区主题。

**风险提示**：违反 AGENTS.md §7 第 3 条「禁止自建内容 CDN、账号系统、服务端」。如需实施需 RFC 评审，或采用纯 GitHub 托管方案（无自建服务器）。

#### 5.3 极简主题格式（来自 cdredfox）

**现状**：AgentSkin 使用 14-token 严格契约，对社区创作门槛高。

**借鉴点**：
- 提供「轻量模式」：4 色即可生成主题
- 缺失 token 由 `derive-missing-tokens.mjs` 自动补齐
- 保留 14-token 模式给高级用户

**用户价值**：降低创作门槛，让普通用户也能做主题。

**适配考虑**：AgentSkin 已有 `derive-missing-tokens.mjs`（28 测试），但仅内部使用。可暴露为「快速创建」入口。

### P1：建议采纳

#### 5.4 图片智能取色（来自 zhouwei713）

**现状**：AgentSkin 的 `derive-missing-tokens.mjs` 基于规则推导。

**借鉴点**：
- 像素级色调打分（主色相 + 明度）
- 预置多套色板（粉/绿/青/金/蓝）
- 计算最佳匹配 + 遮罩强度

**用户价值**：丢一张图 → 自动生成和谐的主题配色。

**适配考虑**：可增强 Wallpaper 的「从图片提取主题」功能，或 Studio 的「以图生题」能力。

#### 5.5 单实例守护（来自 comeonzhj）

**现状**：AgentSkin 有 `automation-lock.mjs` 防止并发，但无单实例守护。

**借鉴点**：应用启动时检测是否已有实例在注入 → 接管或退出。

**用户价值**：避免用户多次启动导致的主题闪烁问题。

**适配考虑**：AgentSkin 是多适配器架构，单实例守护可由主进程统一管理。

#### 5.6 DOM 类名参考文档（来自 majiabin2020）

**现状**：AgentSkin 的适配器缺乏完整的 DOM 锚点文档。

**借鉴点**：维护一份各适配器的 `[data-view-id]` / 类名 / CSS 变量映射表。

**用户价值**：降低新适配器开发门槛，方便社区贡献。

### P2：可选采纳

#### 5.7 ZIP 导入校验（来自 comeonzhj）

借鉴点：文件类型白名单、体积限制、路径穿越防护、CSS 作用域检查。

AgentSkin 已有 `theme-source-parser.ts`，可增强安全校验。

#### 5.8 跨平台签名公证（来自 comeonzhj）

借鉴点：macOS 公证 + Staple、Windows code signing。

这是产品化阶段的需求，AgentSkin 当前是开发阶段。

---

## 六、与 AgentSkin 的差距对比

### 6.1 AgentSkin 的优势（竞品没有的）

| 维度 | AgentSkin | 竞品 |
|------|-----------|------|
| 架构完整性 | 四引擎分工（strategy/adapter/hybrid/deep-core） | 单一 CSS 注入 |
| 适配器数量 | 6 款（traework/qoderwork/workbuddy/doubao/codex/zcode） | 仅 WorkBuddy |
| 主题契约 | 14-token 严格 + 14 变量校验 | 4 色极简，无校验 |
| 工程化 | React 19 + Zustand + Electron + Vitest | 单个 .ps1/.command |
| 测试覆盖 | 765+ UI 测试 | 零测试 |
| 架构治理 | AGENTS.md + 12 RFC 触发条件 + 11 不变量 | 无 |

### 6.2 AgentSkin 的劣势（竞品有但 AgentSkin 没有）

| 维度 | 竞品 | AgentSkin |
|------|------|-----------|
| 安装门槛 | 一句话让 AI 帮装（SKILL.md） | 需手动 npm start |
| 主题创作门槛 | 4 色 + 1 张图即可 | 需理解 14-token 契约 |
| 社区主题市场 | registry.json 同步 | 无（受 §7 限制） |
| 图片直转主题 | 丢图即用（像素取色） | 有 derive-missing-tokens 但非图片感知 |
| 单实例守护 | 自动接管旧实例 | 依赖 automation-lock |
| 跨平台签名 | macOS 公证 + Windows 签名 | 开发阶段 |
| 产品成熟度 | 有 .dmg/.exe  Release | 仅源码 |

### 6.3 核心洞察

> **竞品走「轻量 + AI」路线，AgentSkin 走「完整 + 工程」路线。两者解决的不是同一个用户群体的问题。**

竞品的目标用户是「只想在 WorkBuddy 上换个皮肤」的普通用户，要的是「一句话搞定」。
AgentSkin 的目标用户是「多款 AI 应用 + 深度定制」的进阶用户，要的是「可控、可扩展、工程化」。

这意味着：
1. AgentSkin 不需要模仿竞品的轻量路线（会丧失自身优势）
2. 但竞品的 AI-First 安装流和社区运营思路值得借鉴
3. AgentSkin 的壁垒在于多适配器 + 架构治理 + 测试覆盖，这是竞品无法复制的

---

## 七、风险提示

### 7.1 AGENTS.md 合规性

| 建议 | 合规状态 |
|------|----------|
| AI-First 安装流（SKILL.md） | ✅ 安全，纯文档 |
| 极简主题格式 | ✅ 安全，已有 derive-missing-tokens |
| 图片智能取色 | ✅ 安全，纯前端 |
| 单实例守护 | ✅ 安全，主进程已有能力 |
| 社区主题库同步 | ⚠️ 需 RFC——涉及远程资源同步，可能触碰 §7 第 3 条 |

### 7.2 竞品代码质量

- 这些仓库均为个人作品，代码质量参差不齐
- 多数无测试、无 CI、无类型检查
- 不建议直接复制代码，仅借鉴设计思路
- 唯一例外：comeonzhj 有相对完整的工程实践

### 7.3 知识产权

- 竞品主题中使用大量 IP 素材（原神、火影、Miku 等）
- AgentSkin 的商业化需避免此类侵权
- 这些仓库的 MIT 代码可自由借鉴，但美术素材需自行处理

---

## 八、建议行动计划

### 短期（1-2 周）

1. **编写 SKILL.md**：为 AgentSkin 创建 AI 安装流程文档，降低非技术用户使用门槛
2. **极简主题模式**：基于 `derive-missing-tokens.mjs` 暴露「4 色快速创建」入口

### 中期（1-2 月）

3. **图片取色增强**：引入像素级色调分析，改善「以图生题」的用户体验
4. **DOM 参考文档**：为各适配器维护 `[data-view-id]` / 类名映射表

### 长期（需 RFC）

5. **社区主题同步**：如要实施，先提交 RFC 评审，探索纯 GitHub 托管方案（无自建服务器）

---

## 九、附录：15 仓库完整信息

| # | 仓库 | Stars | 状态 | 特色 |
|---|------|-------|------|------|
| 1 | cdredfox/workbuddy-skin-studio | 169 | ✅ | AI 优先、极简 4 色格式、10 内置主题、双平台 |
| 2 | ozrwayne/WorkBuddy-Skins | 0 | ✅ | — |
| 3 | zhouwei713/WorkBuddy-Dream-Skin | 20 | ✅ | 托盘、14 主题、GIF、像素取色 |
| 4 | sysxdc/workbuddy-skin-lab | 0 | ✅ | — |
| 5 | itcastWsy/workbuddy-skin | 9 | ✅ | — |
| 6 | huangama666/workbuddy-skin | 5 | ✅ | — |
| 7 | sutongwuyanzu/WorkBuddy-Skin- | 3 | ✅ | — |
| 8 | shaozhengmao/workbuddy-dream-theme | 0 | ✅ | — |
| 9 | leeandrew94/workbuddy-ambient-skin | 1 | ⚠️ | 更名 → kimilee94 |
| 10 | RED523/workbuddy-dream-skin-installer | 1 | ✅ | — |
| 11 | TimekeeperXY/workbuddy-dream-skin-skill | 2 | ✅ | — |
| 12 | zhangxiaoqiang1991/workbuddy-skin-skill | 5 | ✅ | — |
| 13 | quanzhankeji/cc-theme | 2 | ✅ | — |
| 14 | comeonzhj/WorkBuddy-theme-skill | 18 | ✅ | 产品化、签名公证、社区同步、单实例守护 |
| 15 | Christina121877/pink-crystal-workbuddy-skin | 5 | ✅ | — |

数据来源：GitHub API + web_search + raw README（2026-08-29）
