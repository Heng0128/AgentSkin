# 第 27 轮竞品深度分析报告

> 执行时间: 2026-08-30 11:00
> 分析项目: xxxhh336/dream-work-theme, Fei-Away/Codex-Dream-Skin, waiterxiaoyy/codress, lntomF/codexskin, cdredfox/workbuddy-skin-studio

---

## 一、执行摘要

本轮分析聚焦 5 个高价值竞品项目，其中 **dream-work-theme** 是当前对 AgentSkin 威胁最大的直接竞品——它支持全部 6 个目标应用（WorkBuddy、TRAE Work、QoderWork、ZCode、豆包 Desktop、Codex），拥有 400 内置主题、per-app CSS 构建器、主题使用频率追踪、自定义图片配色提取等高级特性。**Codex-Dream-Skin** 以 14,195⭐ 仍是市场领导者，其 DreamSkin.cc 主题市场 + 一键换肤协议是行业标准。**Codress** 展示了多应用 + 桌面宠物 + Go 后端全栈架构。**CodeSkin** 用 Rust/Tauri 实现了动态背景。**workbuddy-skin-studio** 的"一张图即主题"模式值得参考。

---

## 二、竞品项目详解

### 2.1 xxxhh336/dream-work-theme ⭐9（直接竞品，威胁最大）

**仓库**: https://github.com/xxxhh336/dream-work-theme
**License**: Apache-2.0
**Language**: TypeScript + Electron
**最后更新**: 2026-08-26（极活跃）
**Stars**: 9 | **Forks**: 2

#### 2.1.1 核心架构

```
dream-work-theme/
├── electron/
│   ├── main.ts
│   ├── preload.ts
│   └── manager/
│       ├── app-registry.ts      ← 应用注册表（20+ 应用）
│       ├── app-profiles/        ← 应用专属配置
│       ├── cdp.ts               ← CDP 连接管理
│       ├── injector.ts          ← 注入器（240KB！）
│       ├── launcher.ts          ← 应用启动器
│       ├── watcher.ts           ← 主题守护/自动恢复
│       ├── discovery.ts         ← 应用发现
│       ├── theme-store.ts       ← 主题存储
│       ├── theme-updater.ts     ← 主题更新
│       ├── theme-paths.ts       ← 主题路径
│       ├── custom-theme-store.ts ← 自定义主题存储
│       ├── shortcuts.ts         ← 快捷方式
│       └── codex-dream-skin.css ← 162KB CSS（Codex 专用）
└── themes/                      ← 400 内置主题
```

#### 2.1.2 支持应用矩阵（20+ 应用）

| 应用 | 状态 | CDP 端口 | 特殊处理 |
|------|------|----------|----------|
| **WorkBuddy** | ✅ 完整 | 默认 | 标准注入 |
| **TRAE Work** | ✅ 完整 | 默认 | 标准注入 |
| **QoderWork** | ✅ 完整 | DevToolsActivePort | 动态端口 |
| **ZCode** | ✅ 完整 | 默认 | 标准注入 |
| **豆包 Desktop** | ✅ 完整 | 9349 (固定) | 定制 Chromium + 暗色 token 重映射 |
| **Codex/ChatGPT** | ✅ 完整 | 默认 | 162KB 专属 CSS |
| HanaAgent | ✅ 完整 | 9346 | renderer 重建自动恢复 |
| Kimi Work | ✅ 完整 | 9347 | Work/Chat 双 renderer |
| OpenCode Desktop | ✅ 完整 | DevToolsActivePort | 动态端口 |
| AgnesCode | ✅ 完整 | 9350 (Playwright) | **ASAR 补丁**（唯一修改安装文件的适配） |
| MiniMax Code | ✅ 完整 | 9351 | 标准注入 |
| AstronClaw | ✅ 完整 | 9352 | 端口回退机制 |
| SparkDesk | ✅ 完整 | 9354 | 多 Tab watcher |
| StepFun | ✅ 完整 | DevToolsActivePort | 多 WebContents |
| DeepSeek Harness | ✅ 完整 | 9355 | body[data-ds-dark-theme] |
| MonkeyCode | ✅ 完整 | 9356 | **Tauri/WebView2** via WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS |
| AutoClaw | ✅ 完整 | 9357 | **UAC 提权**启动 |

#### 2.1.3 关键技术亮点

**1. Per-App CSS 构建器模式**

每个应用有独立的 CSS 构建函数：
- `buildCodexCss()`
- `buildWorkBuddyCss()`
- `buildDoubaoCss()` — 暗色主题重映射 `dbx` / `s-color` token
- `buildAgnesCodeCss()` — 跳过通用渐变/模糊
- `buildKimiCss()` — 不使用 `backdrop-filter: blur()` 避免图片模糊
- `buildMonkeyCodeCss()` — 映射 DaisyUI token
- `buildAutoClawCss()` — `#root::before` 全窗口背景

**2. 主题使用频率追踪 + LRU 排序**

```typescript
// theme-usage.json 持久化
{
  "appId": {
    "themeId": { "count": 5, "lastUsed": 1693000000 }
  }
}

// 右下角菜单最多 4 个快捷预置主题
// 按切换次数排序，次数相同优先最近使用
// 没有使用记录时从兼容主题补足
```

**3. 自定义图片主题 + 自动配色提取**

- 支持 PNG、JPEG、WebP
- 导入后缩放压缩为 WebP
- 自动提取主题配色
- 最多保存 5 张
- 跨应用共享图片库（`custom-themes.json`）

**4. 多 Renderer Watcher**

- HanaAgent: renderer 重建后自动补注入
- Kimi Work: Work/Chat 双 renderer 同步
- SparkDesk: 多 Tab + 设置页同步
- StepFun: 多 WebContents + 会员页

**5. 端口管理策略**

- 首选端口 → TCP bind 检查 → 幽灵监听检测 → 自动顺延
- 特殊应用：DevToolsActivePort 文件读取（QoderWork、OpenCode、StepFun）
- WebView2: `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`

**6. AgnesCode ASAR 补丁（唯一修改安装文件）**

- 备份 `AgnesCode.exe` → `AgnesCode.exe.dream-work-original`
- 关闭 `EnableEmbeddedAsarIntegrityValidation` fuse
- 等长替换 `titleBarOverlay.color` 为 `#00000000`
- 使用 `original-fs` 读写 ASAR（不能用普通 `fs`）

#### 2.1.4 主题格式

```json
{
  "schemaVersion": 1,
  "id": "my-theme",
  "name": "我的主题",
  "author": "用户",
  "hero": "hero.png",
  "colors": {
    "accent": "#24c9d7",
    "secondary": "#ef8fd3",
    "surface": "#f7fbff",
    "text": "#17344f"
  },
  "apps": {
    "some-app": { "compat": false },
    "another-app": { "compat": true, "layout": "compact" }
  }
}
```

**兼容性模型**: 注册表默认 + manifest 显式覆盖。`acceptsGenericThemes` 控制是否接受通用主题。

#### 2.1.5 与 AgentSkin 对比

| 维度 | dream-work-theme | AgentSkin |
|------|-----------------|-----------|
| 支持应用数 | 20+（含全部 6 个目标） | 6（专注） |
| 内置主题数 | 400 | 15 |
| CSS 构建方式 | Per-app 专属函数 | 14-token + adapter |
| 自定义图片 | ✅ 自动配色提取 | ❌ 无 |
| 使用频率追踪 | ✅ LRU 排序 | ❌ 无 |
| 主题市场 | ❌ 无（本地） | ❌ 无 |
| 一键换肤协议 | ❌ 无 | ❌ 无 |
| 架构文档 | 一般 | 优秀（RFC + 不变量） |
| 测试覆盖 | 未知 | 优秀（4500+ tests） |
| 注入引擎编排 | 简单 watcher | 四引擎 + 编排层 |

---

### 2.2 Fei-Away/Codex-Dream-Skin ⭐14,195（市场领导者）

**仓库**: https://github.com/Fei-Away/Codex-Dream-Skin
**License**: MIT
**Language**: JavaScript
**最后更新**: 2026-08-28（极活跃）
**Stars**: 14,195 | **Forks**: 1,350

#### 2.2.1 核心特性

1. **DreamSkin.cc 主题市场**
   - 社区审核主题
   - 网页桌面模拟器试穿
   - 创作者榜单

2. **在线 Studio**
   - 浏览器内换背景图
   - 调主题色
   - 写 Safe CSS
   - 导出 .zip 主题包
   - 直接投稿到主题库

3. **一键换肤协议**
   - `dreamskin://apply?version=ver_...` 唤起本机 App
   - 只携带主题版本 ID，不能携带任意 URL/命令
   - 核对审核状态、兼容标记、版本号、包大小、SHA-256
   - 失败自动回滚

4. **Safe CSS 校验**
   - 主题 CSS 必须通过本机 Safe CSS 校验
   - 只作用于 12 个注册部件
   - 每次切换/应用重新校验

5. **导入器安全**
   - ZIP 最大 32 MiB、最多 32 条目、解压后最多 64 MiB
   - SHA-256 校验每个负载文件
   - 同 ID 新版本原地更新，清理旧重复目录

#### 2.2.2 可借鉴点

- **一键换肤协议**: 安全的自定义 URL scheme 设计
- **Safe CSS**: 白名单机制限制 CSS 作用范围
- **主题包完整性**: SHA-256 + 大小 + 版本校验
- **回滚机制**: 渲染失败自动恢复，可见性验证

---

### 2.3 waiterxiaoyy/codress ⭐5（多应用 + 全栈架构）

**仓库**: https://github.com/waiterxiaoyy/codress
**License**: 未知
**Language**: TypeScript + Go
**最后更新**: 2026-07-26
**Stars**: 5 | **Forks**: 0

#### 2.3.1 架构

```
codress/
├── platform/
│   ├── apps/
│   │   ├── desktop/              # Electron 桌面客户端
│   │   │   ├── src/main/         # CDP, launcher, pets, updater, IPC
│   │   │   └── src/renderer/     # React 桌面 UI
│   │   └── admin/                # React + Ant Design 管理后台
│   ├── packages/skin-schema/     # 共享主题数据契约
│   ├── server/                   # Go API
│   └── deploy/                   # MySQL, seed data
```

#### 2.3.2 核心特性

- **主题商店**: 浏览、搜索、过滤 Codex/WorkBuddy 主题
- **一键应用**: 检测目标应用，必要时重启启用 CDP
- **本地主题创建器**: 预览 + 调整构图/图片/外观/palette
- **桌面宠物**: Codex v2 宠物 + 浮动桌面伴侣
- **我的库**: 缓存主题、已安装宠物、运行中桌面宠物
- **外观**: 亮/暗/系统模式 + 自动系统主题更新
- **自动更新**: GitHub Releases 检查 + 下载 + 重启安装
- **管理后台**: 主题、宠物、分类、适配器、客户端版本、运营数据

#### 2.3.3 可借鉴点

- **Go 后端 API**: 主题/宠物/分类管理
- **Admin Console**: 运营管理界面
- **Desktop Pets**: 桌面宠物作为差异化功能
- **skin-schema 包**: 共享主题数据契约

---

### 2.4 lntomF/codexskin ⭐14（Rust/Tauri 实现）

**仓库**: https://github.com/lntomF/codexskin
**License**: MIT
**Language**: Rust + Tauri
**最后更新**: 2026-07-21
**Stars**: 14 | **Forks**: 1

#### 2.4.1 核心特性

- **技术栈**: Tauri v2 + Rust（非 Electron）
- **动态视觉**: 会呼吸的动效、图层微动
- **沉浸式主题**: 磨砂玻璃、赛博朋克霓虹
- **无感加载**: CDP 运行时渲染，不修改官方文件
- **Windows 专属**: 目前仅支持 Windows

#### 2.4.2 可借鉴点

- **Rust/Tauri 替代 Electron**: 更小体积、更低内存
- **动态背景**: 动画效果作为差异化
- **呼吸动效**: 微动画提升视觉体验

---

### 2.5 cdredfox/workbuddy-skin-studio ⭐170（WorkBuddy 专用）

**仓库**: https://github.com/cdredfox/workbuddy-skin-studio
**License**: MIT
**Language**: JavaScript
**最后更新**: 2026-07-17
**Stars**: 170 | **Forks**: 26

#### 2.5.1 核心特性

- **一张图即主题**: 上传图片自动生成完整主题
- **右上角菜单即时切换**: 无需重启应用
- **回环 CDP 注入**: 不改官方安装包
- **macOS/Windows 双平台**

#### 2.5.2 可借鉴点

- **图片驱动主题**: 降低用户创建门槛
- **即时预览**: 菜单栏快速切换
- **.wbtheme 签名**: 主题包格式

---

## 三、技术趋势总结

### 3.1 架构演进

1. **从单一应用到跨平台母舰**: dream-work-theme 支持 20+ 应用，AgentSkin 专注 6 个
2. **从静态主题到动态生成**: 图片 → 自动配色 → 主题（dream-work-theme、workbuddy-skin-studio）
3. **从本地到在线市场**: DreamSkin.cc 建立社区生态
4. **从简单注入到智能守护**: watcher 自动恢复、renderer 重建检测
5. **从 Electron 到 Tauri**: CodeSkin 探索 Rust 替代方案

### 3.2 UX 创新

1. **主题使用频率追踪**: LRU 排序快捷菜单
2. **一键换肤协议**: `dreamskin://` 安全唤起
3. **桌面宠物**: Codress 的差异化功能
4. **在线 Studio**: 浏览器内创建主题
5. **即时预览**: 无需重启应用

### 3.3 安全实践

1. **Safe CSS 白名单**: 限制 CSS 作用范围
2. **SHA-256 校验**: 主题包完整性
3. **回环 CDP**: 不暴露调试端口到网络
4. **回滚机制**: 渲染失败自动恢复
5. **URL Scheme 限制**: 只携带 ID，不携带命令

---

## 四、对 AgentSkin 的威胁评估

### 4.1 直接威胁：dream-work-theme

**威胁等级**: 🔴 高

**原因**:
1. 支持全部 6 个目标应用
2. 400 内置主题（AgentSkin 15 个）
3. 自定义图片主题（AgentSkin 无）
4. 主题使用频率追踪（AgentSkin 无）
5. 极活跃开发（8 月 26 日仍在提交）

**AgentSkin 优势**:
1. 架构更清晰（四引擎 + 编排层）
2. 测试覆盖更高（4500+ tests）
3. 14-token 契约更严格
4. 文档更完善（RFC + 不变量）

### 4.2 间接威胁：Codex-Dream-Skin

**威胁等级**: 🟡 中

**原因**:
1. 14,195⭐ 社区影响力
2. DreamSkin.cc 主题市场生态
3. 一键换肤协议标准

**AgentSkin 优势**:
1. 多应用支持（DreamSkin 仅 Codex）
2. 更严格的主题契约
3. 更清晰的架构

---

## 五、可借鉴特性优先级排序

### P0: 必须实施（直接提升竞争力）

1. **Per-App CSS 构建器增强**
   - 对标 dream-work-theme 的 `buildXxxCss()` 模式
   - 为每个目标应用编写专属 CSS 构建函数
   - 处理特殊 token 映射（如豆包的 `dbx`/`s-color`）

2. **自定义图片主题 + 自动配色提取**
   - 用户上传图片 → 自动提取配色 → 生成 14-token 主题
   - 对标 DreamSkin Studio + workbuddy-skin-studio

3. **主题使用频率追踪**
   - 记录每个主题的使用次数和最后使用时间
   - LRU 排序快速切换菜单
   - 持久化到用户数据目录

### P1: 应该实施（提升用户体验）

4. **一键换肤协议**
   - 注册 `agentskin://` 自定义 URL scheme
   - 安全校验：只携带主题 ID，核对 SHA-256
   - 失败自动回滚

5. **多 Renderer Watcher 增强**
   - 处理 WorkBuddy/ZCode 的多 renderer 场景
   - renderer 重建后自动补注入
   - 页面导航后自动恢复主题

6. **主题包完整性校验**
   - SHA-256 校验每个文件
   - 大小 + 版本 + 兼容性声明
   - 导入时验证，应用时再次验证

### P2: 可以实施（差异化竞争）

7. **在线主题 Studio**
   - 浏览器内创建/编辑主题
   - 实时预览
   - 导出/分享

8. **主题市场（轻量级）**
   - 社区主题浏览
   - 一键安装
   - 评分/评论系统

9. **Safe CSS 校验**
   - 白名单限制 CSS 作用范围
   - 防止恶意 CSS

---

## 六、实施计划

### 第一批（并行实施）

| 任务 | 子智能体 | 预计测试数 |
|------|---------|-----------|
| Per-App CSS 构建器增强 | Agent A | 25 tests |
| 自定义图片主题 + 配色提取 | Agent B | 30 tests |
| 主题使用频率追踪 | Agent C | 20 tests |

### 第二批（验证后实施）

| 任务 | 子智能体 | 预计测试数 |
|------|---------|-----------|
| 一键换肤协议 | Agent D | 15 tests |
| 多 Renderer Watcher 增强 | Agent E | 20 tests |
| 主题包完整性校验 | Agent F | 15 tests |

---

## 七、下一步建议

1. **立即实施 P0 三项**: Per-App CSS 构建器、自定义图片主题、使用频率追踪
2. **持续监控 dream-work-theme**: 它是最直接的竞品，发展迅速
3. **研究 DreamSkin.cc 模式**: 主题市场是生态护城河
4. **评估 Tauri 可行性**: Rust 替代 Electron 可降低资源占用
5. **考虑桌面宠物**: 差异化功能，但需评估与核心定位的契合度

---

## 八、附录：原始数据

### 8.1 GitHub API 数据

| 项目 | Stars | Forks | Language | Last Pushed | License |
|------|-------|-------|----------|-------------|---------|
| Fei-Away/Codex-Dream-Skin | 14,195 | 1,350 | JavaScript | 2026-08-28 | MIT |
| cdredfox/workbuddy-skin-studio | 170 | 26 | JavaScript | 2026-07-17 | MIT |
| captainfod/TRAE-Work-Dream-Skin | 14 | 3 | CSS | 2026-07-17 | MIT |
| lntomF/codexskin | 14 | 1 | Rust | 2026-07-21 | MIT |
| xxxhh336/dream-work-theme | 9 | 2 | TypeScript | 2026-08-26 | Apache-2.0 |
| waiterxiaoyy/codress | 5 | 0 | TypeScript+Go | 2026-07-26 | — |
| fishcold789/Taffy-Codex-Theme-Studio | 6 | 1 | JavaScript | 2026-07-28 | — |

### 8.2 关键文件路径

- dream-work-theme app-registry: `electron/manager/app-registry.ts`
- dream-work-theme injector: `electron/manager/injector.ts` (240KB)
- dream-work-theme watcher: `electron/manager/watcher.ts`
- codress desktop main: `platform/apps/desktop/src/main/`
- codress adapters: `platform/apps/desktop/src/main/adapters/`
- workbuddy-skin-studio menu: `src/skin-menu.mjs`

---

> 报告完成时间: 2026-08-30 11:15
> 下一步: 启动多子智能体并行实施 P0 三项改进
