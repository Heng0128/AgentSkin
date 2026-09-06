# Ky233666/DouBao-Dream-Skin 深度分析

> 分析日期：2026-09-13 | 数据来源：GitHub API + README + 源码抽样

---

## 基本信息

| 字段 | 值 |
|------|-----|
| **仓库** | Ky233666/DouBao-Dream-Skin |
| **描述** | 豆包换肤（可恢复换肤工具） |
| **Stars** | 3 |
| **Forks** | 0 |
| **语言** | JavaScript（零 npm 依赖） |
| **License** | MIT |
| **创建日期** | 2026-07-17 |
| **最后更新** | 2026-07-21 |
| **最近提交** | 2026-07-18（`Add complete component theme system`） |
| **活跃度** | 低；单人开发，commit 集中在 2 天内（6 commits）；项目刚发布，处于 v0.5.0 早期阶段 |
| **版本** | 0.5.0（按 package.json） |
| **规模** | 约 15 MB（含截图示例）；源码精简，核心逻辑 3 个文件 |

---

## 技术实现亮点

### 1. 双端分离架构（Web 扩展 + 桌面 CDP）

项目将换肤拆成两条路径，互不影响：

- **浏览器扩展版**：标准 Chrome/Edge 扩展（Manifest V3），运行在 `doubao.com`。通过 `content.js` 注入 CSS 变量 + 背景 `<div>`，使用 `MutationObserver` 监听 DOM 变化并在背景层被移除时自动恢复。
- **桌面版**：通过豆包自带的 Chromium 调试接口（CDP），用 Node.js 手写 WebSocket 客户端（无第三方依赖）连接 `127.0.0.1:<port>`，注入完整的主题 CSS 和背景。

**亮点**：桌面版 Node.js 完全未引入 `ws`、`puppeteer` 等任何第三方包，所有 WebSocket 帧编解码、HTTP JSON 读取、掩码 XOR 都是自己实现的——体积控制在 300 行内。

### 2. CSS 变量注入策略

浏览器版在 `:root`（`document.documentElement`）上声明 **27 个自定义 CSS 变量**，命名空间 `--dbsw-*`：

```css
--dbsw-sidebar        /* 左侧栏底色 */
--dbsw-surface        /* 主区域底色 */
--dbsw-composer       /* 输入框底色 */
--dbsw-border / --dbsw-shadow / --dbsw-overlay / --dbsw-blur
--dbsw-sidebar-text / --dbsw-sidebar-muted
--dbsw-main-text / --dbsw-main-muted
--dbsw-composer-text / --dbsw-composer-muted
--dbsw-color-scheme
--dbsw-accent / --dbsw-accent-ink / --dbsw-accent-soft
--dbsw-card / --dbsw-user-bubble / --dbsw-assistant-bubble
--dbsw-radius / --dbsw-radius-sm / --dbsw-elevation
```

**关键技巧**：所有背景色 + 文字色预计算为"颜色 + 透明度"合体值（如 `rgba( rgba(255,241,232,0.48)`），直接注入变量；不需要再在各自选器上写 `background: var(...)` 之外的任何东西。这让 CSS 文件保持纯净的"主题 token → CSS 变量"映射，没有布局逻辑。

### 3. 智能文字对比度

Auto 模式对背景图进行**低分辨率本地采样**（把背景缩小后逐像素算亮度均值），根据结果分别为 sidebars/surface/composer 三个区域选取深色或浅色文字。全程本机完成，不会上传图片（README 明确强调隐私边界）。

### 4. 背景图/氛围图实现

- 背景以 `<div id="doubao-dream-skin-web-background">` 插入到 `document.body` 首部，`aria-hidden="true"` 避开无障碍树。
- 支持 `brightness / saturate / backgroundPosition / backgroundImage` 四个调整维度。
- 兜底是一个用 `radial-gradient + linear-gradient` 硬编码的暖色矢量渐变（无需加载图片也能看）。
- `MutationObserver` 监听父节点 childList 变化，一旦背景被 React 重渲染挤走就自动修复。

### 5. 可逆恢复机制

- 浏览器扩展：`removeSkin()` 遍历清理所有 `--dbsw-*` 变量 + 删除背景 div + 删除 data 属性标记 + 断开 observer。
- 桌面版：提供独立的 `restore-skin.ps1` + `恢复豆包外观.cmd`：

  1. 杀掉调试会话
  2. 正常重启豆包（不带调试端口参数）

  从而关闭调试端口——**不替换、不破解、不重新打包**。

### 6. 手写 CDP 的安全校验

`cdp-client.js` 对 WebSocket URL 做了严格白名单：

```js
const allowedHosts = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
// protocol 必须是 ws:
// port 必须等于预期
// pathname 必须是 /devtools/page/<id> 或 /devtools/browser/<id>
// 不允许 username/password/search/hash
```

拒绝一切非 loopback 或非标准路径的调试目标，防止注入到无关页面。

### 7. 四套预设主题 + 组件风格

| 预设名 | 风格关键词 | 组件风格 |
|--------|-----------|----------|
| 暖霞玻璃 | 暖色、人像、柔和圆角 18 | soft |
| 午夜霓虹 | 深色玻璃、青色高光、圆角 20 | solid |
| 樱花梦境 | 粉紫、动漫、圆角 22 | soft |
| 海盐微风 | 蓝绿、清爽、圆角 16 | outline |

`componentStyle` 三档（soft / outline / solid）控制边框和玻璃的表现形态——和 AgentSkin doubao 适配器的"single accent token"思路高度互补。

### 8. 主题 Studio（图形化）

`theme-studio.ps1` 是 36 KB 的 PowerShell GUI（Windows Forms/WPF），让非技术用户也能选图、调参数、实时预览——**不需要打开配置文件**。

---

## 与 AgentSkin doubao 适配器对比

| 维度 | DouBao-Dream-Skin | AgentSkin doubao 适配器 |
|------|-------------------|------------------------|
| **注入方式** | 桌面：Node.js 手写 CDP WebSocket 客户；浏览器：标准 content script | Electron 主进程服务 + CDP WebSocket，运行时 patch（`patchWindowsAdapters`） |
| **Token 体系** | 27 个 `--dbsw-*` 自定义变量，语义面向"侧栏/主区/输入框/气泡"三区域 | 14 个 `--agentskin-*` 契约变量 + 桥接覆盖 251 个原生 `--dbx-*` 与 `--semi-*` token |
| **CSS 生成** | 手写 content.js + 预设 JSON，无流水线 | `scripts/generators/doubaoCss.mjs` 从 manifest.json 的 colors 自动生成 |
| **选择器策略** | 未在公开代码中暴露具体选择器（内容脚本只有 CSS 变量，未见针对具体 class 的覆盖） | `(0,2,1)` 优先级（如 `html.agentskin-host-doubao:root`）+ Native token override（直接覆盖 `--dbx-*`） |
| **背景实现** | 插入独立 `<div>`，CSS filter 控制 brightness/saturate/blur | `--agentskin-art` 变量由引擎注入，承袭 art 图 + 半透明 surface overlay |
| **恢复机制** | 独立恢复脚本重启豆包；浏览器扩展 removeSkin 清理变量 | 引擎侧 IPC 移除注入；不重启应用 |
| **双端支持** | 明确支持 Web 扩展 + Windows 桌面两条路径 | 仅桌面端（ Electron 主进程 CD P ） |
| **第三方依赖** | **零依赖**（纯 Node.js 内置模块 + vanilla JS） | Electron + React + Zustand + 完整工程栈 |
| **发现路径** | 尝试从进程/卸载信息/常见目录寻找豆包，找不到让用户填 `config\app.json` | `executableCandidates` + `uninstallKeys` + `devToolsActivePortFile` 多源发现 |
| **matchTarget** | 浏览器：manifest 限定 `doubao.com`；桌面：URL/title 匹配 `豆包|doubao` | `rendererHints.preferredUrlPatterns` + `matchTarget` 双重，精准锁定 `chrome://doubao-chat/chat` |
| **用户群体** | 单用户桌面玩家 / 技术玩家 | 完整产品（Studio、主题商店、多 agent 统一引擎） |
| **主题生态** | 4 套内置预设 + 单用户本机调整 | 12+ 主题 + 在线 Studio + 社区 Gallery |
| **npm 检查** | `npm run check` = `node --check` 所有 JS 文件 + 跑 mock 测试 + browser extension 测试 | `npm run check` 全量校验（10 个不变量守卫） |

**核心差异总结**：
- DouBao-Dream-Skin 是一个**极简的独立注入器**；AgentSkin doubao 适配器是一个**工程化产品的子模块**。
- 前者重"一台机器的可逆换肤体验"，后者重"多 agent、多主题、多用户的一致交付"。
- 前者的双端支持（Web + 桌面）是其独特优势；AgentSkin 目前不覆盖豆包网页版。
- 前者的"手写 WebSocket CDP + 零依赖"和"URL 白名单校验"技术值得学习；后者的"14-token 契约 + 自动生成 + 变量桥接"体系更健壮。

---

## 14-token 契约兼容性评估

AgentSkin 的 14-token 契约面向 **doubao.css** 的 `:root` 声明。DouBao-Dream-Skin 自己没有这层契约（用 27 个 `--dbsw-*` 代替），但可以做**概念映射**：

| AgentSkin 14-token | DouBao-Dream-Skin 对应关系 | 能否覆盖 |
|--------------------|----------------------------|----------|
| `--agentskin-accent` | `--dbsw-accent` / `--dbsw-accent-ink` | ✅ 直接对应 |
| `--agentskin-secondary` | 无严格对应（用 `--dbsw-accent-soft` 部分覆盖） | ⚠️ 弱 |
| `--agentskin-bg` | 无直接变量（背景通过独立 div + 渐变/fill） | ❌ 无原生等价 |
| `--agentskin-surface` | `--dbsw-surface` | ✅ |
| `--agentskin-surface-elevated` | `--dbsw-card` 接近 | ⚠️ |
| `--agentskin-text` | `--dbsw-main-text` / `--dbsw-sidebar-text` 双轨 | ⚠️ 分区域 |
| `--agentskin-muted` | `--dbsw-main-muted` / `--dbsw-sidebar-muted` 双轨 | ⚠️ |
| `--agentskin-border` | `--dbsw-border` | ✅ |
| `--agentskin-code-bg/code-fg` | **完全没有** | ❌ |
| `--agentskin-input-bg` | `--dbsw-composer` | ✅ |
| `--agentskin-button-bg` | 无（按钮色由 `--dbsw-accent` 隐式决定） | ⚠️ |
| `--agentskin-focus-ring` | 无显式变量 | ❌ |
| `--agentskin-selection` | 无显式变量 | ❌ |

**结论**：DouBao-Dream-Skin 的变量集覆盖约 **9/14** 的 AgentSkin 契约，缺失的集中在代码块、焦点环、选区、次强调色这几个"桌面应用交互细节"。对于主要追求背景换肤 + 气泡重主题的场景够用；但对"完整 IDE 风格换肤"仍显不足。这说明 AgentSkin 的 14-token 契约在 doubao 桌面端确实比网页版有**更细粒度的交互状态需求**。

---

## 可借鉴点（按优先级排序）

### P0 — 直接可落地

1. **Web 扩展注入方案**
   - AgentSkin 目前不覆盖豆包网页版。DouBao-Dream-Skin 展示了一条完整路径：manifest 单域名限定 → content.js 监听插入背景 div → MutationObserver 自愈 → removeSkin 清理。
   - 可为 AgentSkin 新增一个"轻量 Web 版"模式（类似 Codex Dream Skin 的策略），让网页版豆包用户也能用 14-token 主题。

2. **选择器脱耦到 CSS 变量层**
   - DouBao-Dream-Skin 的 content.js 主体没有硬编码 `.chat-list`、`.message-item` 之类的选择器，只做 `--dbsw-*` 变量注入。这让**主题切换不需要重新选择 DOM**——只要变量变了，所有使用变量的组件自动更新。
   - 建议在 doubao.css 生成器中增加更多的"semantic variable only"用法，而非直接挂 class；可降低豆包前端 class 名变更带来的适配成本。

3. **背景层独立 div + MutationObserver 自愈**
   - `<div id="doubao-dream-skin-web-background">` 隔离于 React 渲染树之外，避免被 React 重渲染清掉；`MutationObserver` 随时修复。
   - 比当前 doubao.css 里直接用 `background-image` 挂在 body 更稳定——特别是面对 `data-theme` 切换时。
   - **建议**：AgentSkin doubao.css 的背景注入也改为"独立 div + observer"模式，避免依赖 `:root` 背景被 native 覆盖。

### P1 — 增强鲁棒性

4. **手写 CDP WebSocket 的安全校验模式**
   - 校验主机白名单（loopback only）、路径格式（`/devtools/(page|browser)/<id>`）、端口一致性。
   - 可在 AgentSkin 的 `src/legacy/agentskin-core-runtime.ts:patchWindowsAdapters` matchTarget 逻辑中加入类似守卫。

5. **多源进程发现 + fallback**
   - 同时读取进程列表 + 卸载注册表 + 候选路径 + 用户配置文件 `config\app.json`。
   - 当前 AgentSkin doubao 适配器已有 `executableCandidates + uninstallKeys + devToolsActivePortFile` 三源，但 DouBao-Dream-Skin 的"注册腾讯游戏目录非标准路径"（`com.tencent.pcgame.doubao`）值得纳入候选列表。

6. **智能文字对比度（本机采样）**
   - 在 AgentSkin wallpapers/主题流程中，可增加"背景亮度采样 → 自动选择 dark/light text"的能力，替代当前纯人工配置 `mode: dark|light`。

### P2 — 可参考但非必须

7. **零依赖设计哲学**
   - 整个项目只在 Node.js 内置模块之上构建，易分发、易审计。AgentSkin doubao 桌面注入器已接近这一思路（只用 Electron 内置 net/http），可以继续坚持。

8. **componentStyle 三档（soft / outline / solid）**
   - 用户不直接调圆角或边框，而是选一个风格名。
   - AgentSkin 可考虑在 Theme Studio 中增加"风格模板"层面的抽象，把 14-token 映射到几个预置风格（暖色玻璃、霓虹、极简、复古）。

9. **恢复脚本独立**
   - 独立 `restore-skin.ps1` 提供"出事了回滚"的心理安全感。
   - AgentSkin 已有"关闭注入即恢复"机制，但独立的"一键恢复"按钮/命令行入口可以提升用户信心。

---

## 建议

### 对 AgentSkin 团队

1. **短期 — 吸收"独立背景 div + MutationObserver"模式**
   - 在 `scripts/generators/doubaoCss.mjs` 生成的 CSS 中，用 JS 注入独立 div（类似 DouBao-Dream-Skin 的 `#doubao-dream-skin-web-background`）。
   - 当前 doubao.css 直接使用 `html.agentskin-host-doubao:root` 构造 background，在豆包切换 `data-theme` 时可能被原生覆盖；独立 div 方案更健壮。

2. **中期 — 考虑网页版支持（RFC 可选）**
   - 当前 AgentSkin 仅覆盖桌面端 Electron 应用，如果豆包网页版用户基数增长，可以为 doubao 新增 browser extension 注入层。
   - 需要走 RFC（突破当前 6 适配器 / 6 页面体系），但技术上可以直接参考 DouBao-Dream-Skin 的 content.js + Manifest V3 方案。

3. **长期 — 吸收智能对比度**
   - 在引擎服务中新增"背景亮度分析"模块：用户在 Studio 选主题时，自动推荐 `dark` or `light` mode，减少手动调整成本。
   - 同时保持 14-token 契约完整性（`code-*` / `focus-ring` / `selection` 三个缺失项可以由生成器默认派生，无需作者手填）。

4. **不作为 — 不建议照抄 DouBao-Dream-Skin 的全部设计**
   - DouBao-Dream-Skin 是单人作品，预设和色板数量有限；AgentSkin 已有完整的主题商店体系，重做是倒退。
   - DouBao-Dream-Skin 的 27 个 `--dbsw-*` 变量不符合团队维护的 14-token 契约；合并反而破坏一致性。
   - DouBao-Dream-Skin 没有 test coverage（`npm run check` 仅做语法检查 + 2 个测试），不具备产品级质量保证。

### 给 DouBao-Dream-Skin 作者的公开建议（可选阅读）

- 把 `THEME_PRESETS` 和 `DEFAULT_CONFIG` 抽成独立 JSON，便于外界贡献主题时只改配置不改代码。
- 补充对 `code` 块、`focus-ring`、`selection` 三个交互态变量的支持，让主题能覆盖更完整的"长相"。
- 增加一个"导入/导出 .json 主题包"功能，便于用户分享。
- 考虑加个 GitHub Actions 自动化，每次 push 构建 release artifact（binaries for Windows），降低非技术用户使用门槛。

---

## 附：仓库结构

```
DouBao-Dream-Skin/
├── .github/
├── assets/                      # 资源（含默认 SVG 渐变背景）
├── browser-extension/           # Chrome/Edge 扩展版
│   ├── manifest.json
│   ├── content/content.js       # 注入主逻辑（背景 div + CSS 变量）
│   ├── popup/                   # 弹出设置面板
│   ├── options/                 # 详细设置页
│   └── shared/
│       ├── defaults.js          # 预设主题、DEFAULT_CONFIG、normalizeConfig
│       └── color-engine.js      # 颜色与对比度引擎
├── config/
│   ├── theme.example.json       # 主题参数完整 schema
│   └── app.json                 # 用户填写豆包安装路径
├── scripts/                     # 桌面版 Node.js 脚本
│   ├── cdp-client.js            # 手写 WebSocket CDP 客户端
│   ├── injector.js              # 主题注入主逻辑
│   ├── common.ps1               # 共用 PowerShell 函数
│   ├── start-skin.ps1           # 启动豆包并注入
│   ├── restore-skin.ps1         # 移除注入并重启
│   ├── theme-studio.ps1         # 图形化主题 Studio（36 KB）
│   ├── install-shortcuts.ps1    # 创建桌面快捷方式
│   └── verify-skin.ps1          # 验证注入状态
├── tests/                       # mock CDP 测试 + browser extension 测试
├── themes/                      # 暂无主题文件（仅 .gitkeep）
├── package.json                 # 零依赖
├── LICENSE (MIT)
├── README.md
├── 皮肤设置.cmd / 启动豆包皮肤.cmd / 恢复豆包外观.cmd / 安装桌面快捷方式.cmd / 验证并截图.cmd
└── 示例/                         # 截图预览
```

---

## 结论

Ky233666/DouBao-Dream-Skin 是一个**技术精湛的早期作品**，在零 npm 依赖下实现了双端（Web + 桌面）可逆注入，并展示了几个对 AgentSkin 有实际借鉴价值的模式：

1. **独立背景 div + MutationObserver 自愈**（稳定性提升）
2. **CSS 变量层脱耦**（选择器独立于主题切换）
3. **智能文字对比度采样**（提升易用性）
4. **CDP URL 白名单 + 手写 WS 客户端**（安全意识）
5. **双端策略**（AgentSkin 目前缺失 Web 版）

项目本身受限于早期阶段（0.5.0 / 3 stars / 单人作者），在产品化维度（主题生态、测试覆盖、自动更新、Studio 深度）远不及 AgentSkin；但在"轻量可逆注入 + 单 agent 深耕"这一层，展示了一些值得 AgentSkin 吸收的巧思。**建议重点复用"独立背景 div"和"CSS 变量注入"两个模式，作为 doubao.css 生成器的下一次迭代方向。**
