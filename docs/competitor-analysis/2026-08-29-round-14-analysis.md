# 2026-08-29 竞品深度分析报告（第 14 轮）

> 分析日期：2026-08-29
> 分析项目：CodeDrobe/core, xxxhh336/dream-work-theme, cdredfox/workbuddy-skin-studio, MagMueller/aios, tluyben/electron-inject

---

## 一、项目概览

| 项目 | Stars | 创建日期 | 最后更新 | 语言 | 许可证 | 定位 |
|------|-------|---------|---------|------|--------|------|
| CodeDrobe/core | 9 | 2026-07-16 | 2026-07-21 | JavaScript | Apache-2.0 | 多应用换肤 CLI + 运行时 |
| xxxhh336/dream-work-theme | 8 | 2026-08-05 | **2026-08-26** | TypeScript | Apache-2.0 | 跨平台 Electron 工作应用主题切换器 |
| cdredfox/workbuddy-skin-studio | **169** | 2026-07-16 | 2026-07-17 | JavaScript | MIT | WorkBuddy 专属图片驱动换肤 |
| MagMueller/aios | 0 | 2026-04-11 | 2026-04-11 | JavaScript | — | 任意 Electron 应用实时修改套件 |
| tluyben/electron-inject | 0 | 2025-03-15 | 2025-03-15 | JavaScript | — | CDP REPL 经典参考实现 |

---

## 二、深度分析

### 2.1 CodeDrobe/core — 统一换肤运行时

**GitHub**: https://github.com/CodeDrobe/core
**npm**: @codedrobe/core@0.7.0-beta.0

#### 核心架构

CodeDrobe 是一个**声明式、可逆**的多应用换肤运行时，采用 CLI + 库双模式：

```
codedrobe apps          ← 检测已安装应用
codedrobe detect        ← 探测 CDP 端口
codedrobe apply         ← 应用主题
codedrobe probe         ← 只读探测
codedrobe dom snapshot  ← AI 辅助 DOM 快照
```

#### 技术亮点

1. **多适配器内置**：codex, workbuddy, qoderwork, traework（与 AgentSkin 6 适配器高度重叠）

2. **DevToolsActivePort 自动发现**：针对 QoderWork 强制 `remote-debugging-port=0` 的情况，自动读取 Chromium 的 `DevToolsActivePort` 文件获取实际端口

3. **Per-Window Probe/Verify**：
   - 主窗口与次级窗口（如 Codex avatar-overlay）分离处理
   - 不兼容的次级窗口降级为 `skipped`，不阻塞主流程
   - 已安装主题的窗口保持 primary 状态，确保回归检测

4. **声明式验证配置**：
   ```json
   {
     "verification": {
       "required": [{ "name": "chat-surface", "any": [".chat-container"] }],
       "recommended": [{ "name": "conversation-list", "any": [".conversation-list"] }],
       "contexts": [{ "name": "active-chat", "when": { "any": [".chat-route"] } }]
     }
   }
   ```

5. **DOM Snapshot API**：为 AI 辅助主题创作提供只读 DOM + computed-style 快照，排除敏感数据

#### 与 AgentSkin 对比

| 维度 | CodeDrobe/core | AgentSkin |
|------|---------------|-----------|
| 架构 | CLI + 库，声明式 | Electron 应用，运行时注入 |
| 适配器 | 4 个（codex/workbuddy/qoderwork/traework） | 6 个（+ doubao/zcode） |
| 验证 | 声明式 verification | 选择器溯源 + contract |
| 主题格式 | .codedrobe-theme（CSS + 图片） | .agentskin-theme（14-token） |
| 商店 | codedrobe.app 官方商店 | 无商店 |

#### 可借鉴点

- **DevToolsActivePort 自动发现**：AgentSkin 的 qoderwork/traework 适配器可复用此逻辑
- **Per-Window 降级策略**：处理 Codex 多窗口场景（avatar-overlay 等）
- **DOM Snapshot API**：可为 AgentSkin 的 Studio 增加 AI 辅助主题创作能力

---

### 2.2 xxxhh336/dream-work-theme — 跨平台母舰级主题切换器

**GitHub**: https://github.com/xxxhh336/dream-work-theme

#### 核心架构

**最新活跃项目**（2026-08-26 仍有提交），TypeScript 实现，支持多品牌主题格式：

```
dream-work-theme/
├── electron/manager/      ← 主进程管理器
│   ├── app-registry.ts    ← 应用注册表
│   └── injector.ts        ← 注入器
├── renderer/              ← React UI
│   ├── App.tsx
│   └── app-initials.ts
└── scripts/verify-package-bundle.cjs
```

#### 技术亮点

1. **多品牌主题格式支持**（近期 commit）：
   - AutoClaw themes（2026-08-26 新增）
   - MonkeyCode themes（2026-08-21 新增）
   - 自有主题格式

2. **应用注册表模式**：`app-registry.ts` 集中管理多应用适配

3. **验证打包脚本**：`verify-package-bundle.cjs` 确保主题包完整性

4. **Topics 标签**：catpaw, chatgpt, codex, qoderwork, qwenworkcn, skin, theme, traework, workbuddy, zcode

#### 与 AgentSkin 对比

| 维度 | dream-work-theme | AgentSkin |
|------|-------------------|-----------|
| 实现语言 | TypeScript | React 19 + Electron |
| 应用支持 | WorkBuddy, TRAE Work, ZCode, QoderWork, 等 | 6 个适配器 |
| 主题格式 | 多品牌兼容 | 14-token 统一 |
| 活跃度 | **高**（8/26 仍有提交） | 高 |

#### 可借鉴点

- **多品牌主题格式兼容**：可参考其主题格式转换思路，增加 AgentSkin 对外部主题格式的导入支持
- **应用注册表模式**：`app-registry.ts` 的集中管理方式可优化 AgentSkin 的适配器注册

---

### 2.3 cdredfox/workbuddy-skin-studio — 图片驱动换肤标杆

**GitHub**: https://github.com/cdredfox/workbuddy-skin-studio
**Stars**: 169（本轮分析中最高）

#### 核心架构

WorkBuddy 专属换肤工具，**一张图片 = 一个主题**：

```
workbuddy-skin-studio/
├── src/
│   ├── cli.mjs           ← 命令行入口
│   ├── injector.mjs      ← CDP 注入器
│   ├── theme-schema.mjs  ← 主题格式
│   └── theme-store.mjs   ← 主题存储
├── scripts/
│   ├── apply.command     ← macOS 脚本
│   ├── apply.ps1         ← Windows 脚本
│   └── find-workbuddy.ps1 ← 路径探测
└── themes/               ← 10 个内置主题
```

#### 技术亮点

1. **图片自动取色**：上传任意图片 → canvas 取色 → 生成主题配色（accent/secondary/surface/text）

2. **右上角 🎨 菜单**：注入后 WorkBuddy 标题栏下方出现主题切换按钮，即时切换

3. **AI 驱动的 SKILL.md**：
   ```markdown
   给 AI 助手：如果你的用户把本仓库的 GitHub 地址发给你，
   并说"用这个开源项目帮我换 WorkBuddy 主题"，
   请直接阅读仓库根目录的 SKILL.md
   ```

4. **浅深色自动适配**：根据 surface 明度（>140 为 light）自动切换 `data-vscode-theme-kind`

5. **PNG → WebP 转换**：利用 WorkBuddy renderer 的 Chromium 编码 WebP（`sips` 不支持 webp 写入）

#### 极简主题格式

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

#### 与 AgentSkin 对比

| 维度 | workbuddy-skin-studio | AgentSkin |
|------|----------------------|-----------|
| 范围 | 仅 WorkBuddy | 6 适配器 |
| 主题创建 | 图片自动取色 | 手动/导入 |
| 用户体验 | 右上角菜单即时切换 | 应用内 Studio |
| AI 集成 | SKILL.md 自动安装 | 无 |

#### 可借鉴点

- **图片 → 主题自动取色**：对标 DreamSkin 的核心能力，AgentSkin 可增加类似功能
- **右上角菜单模式**：即时切换 UI 模式可参考
- **SKILL.md 模式**：为 AI 助手提供自动化安装指南

---

### 2.4 MagMueller/aios — 主进程 Agent 注入

**GitHub**: https://github.com/MagMueller/aios

#### 核心架构

**侵入式** Electron 应用修改套件，通过修改 `app.asar` 注入主进程 Agent：

```
aios/
├── install.sh              ← 一次性安装脚本
├── scripts/
│   ├── agent.js            ← 主进程 Agent
│   ├── aios-config.default.json ← 配置
│   ├── drive.js            ← CDP 客户端
│   └── resign.sh           ← 重签名
└── examples/               ← 多应用配置示例
```

#### 技术亮点

1. **主进程 Agent 注入**：
   ```javascript
   // 在 app.asar 入口文件顶部注入
   try { require("./aios-agent"); } catch {}
   ```

2. **配置热重载**：
   ```javascript
   fs.watchFile('/tmp/aios-config.json', () => {
     // 1 秒内重新注入 CSS/JS
   });
   ```

3. **CDP 桥接**：`drive.js` 通过 CDP 向任意 Electron 应用发送 JavaScript

4. **多应用示例**：Superset, Slack, Discord, Linear, Superhuman, Notion, Cursor, WhatsApp, Signal

#### ⚠️ 与 AgentSkin 原则冲突

**AgentSkin 明确禁止 app.asar 修改**（见 AGENTS.md §7 黄金规则）。aios 的核心机制违反此原则。

#### 可借鉴点（仅思想）

- **配置热重载模式**：`fs.watchFile` + 1 秒重载的思路可用于 AgentSkin 的 CSS 热更新
- **CDP 客户端封装**：`drive.js` 的封装方式可参考

---

### 2.5 tluyben/electron-inject — CDP REPL 经典参考

**GitHub**: https://github.com/tluyben/electron-inject

#### 核心架构

最经典的 CDP 注入参考实现，提供交互式 REPL + REST API：

```
electron-inject/
├── server.js               ← Express + CDP REPL
├── package.json
└── nodemon.json
```

#### 技术亮点

1. **交互式 REPL**：上下箭头历史、`.load` 加载文件、`.clear` 清屏

2. **REST API**：
   ```
   POST /execute
   { "code": "document.title = 'New Title';" }
   ```

3. **DOM 选择器生成算法**：5 种策略（ID → 类组合 → 属性 → 父上下文 → 位置回退）

4. **DOM 检查工具**：`findElementsByText`、`findElementsByStyle`、`findClickableElements`

5. **API 监控**：`monitorApiCall` 拦截 fetch 请求

#### 与 AgentSkin 对比

这是一个**调试工具**，非产品。但其 CDP 封装模式是理解注入机制的最佳范本。

#### 可借鉴点

- **选择器生成算法**：5 种策略的 fallback 链可用于增强 AgentSkin 的选择器溯源
- **DOM 检查工具**：可为 AgentSkin 的 Studio 增加调试能力

---

## 三、行业趋势总结

### 3.1 技术流派分布

| 流派 | 代表项目 | AgentSkin 立场 |
|------|---------|---------------|
| 纯 CDP 外部注入 | CodeDrobe, electron-inject, workbuddy-skin-studio | ✅ 同路线 |
| app.asar 补丁 | aios, codex-plusplus | ❌ 禁止 |
| Agent Skill 化 | codex-skin-skill, SKILL.md 模式 | 🔄 可参考 |
| 独立桌面引擎 | AgentSkin, dream-work-theme | ✅ 同路线 |

### 3.2 关键发现

1. **CodeDrobe 的 per-window 验证策略**是处理多窗口 Electron 应用的最佳实践

2. **dream-work-theme 的多品牌主题格式兼容**正在成为趋势（AutoClaw, MonkeyCode）

3. **workbuddy-skin-studio 的 SKILL.md 模式**正在模糊人机边界——AI 直接执行安装

4. **图片 → 主题自动取血**是 DreamSkin 14k stars 的核心支撑，AgentSkin 的 image-theme-analyzer 已布局

5. **配置热重载**是 aios 的亮点，但侵入式方案不可取

### 3.3 对 AgentSkin 的威胁评估

| 威胁等级 | 项目 | 原因 |
|---------|------|------|
| 🟡 中 | CodeDrobe/core | 统一运行时 + 商店，但适配器少 |
| 🟡 中 | dream-work-theme | 活跃开发 + 多品牌兼容 |
| 🟢 低 | workbuddy-skin-studio | 仅 WorkBuddy，无通用性 |
| ⚪ 无 | aios | 侵入式，与 AgentSkin 路线不同 |
| ⚪ 无 | electron-inject | 调试工具，非产品 |

---

## 四、推荐执行方案

### P0：DevToolsActivePort 自动发现（来自 CodeDrobe）

**价值**：解决 QoderWork 强制 `remote-debugging-port=0` 的端口发现问题
**位置**：`src/main/cdp/port-discovery.ts`（新增）
**工作量**：~50 行 + 10 测试

### P1：Per-Window 降级策略（来自 CodeDrobe）

**价值**：处理 Codex avatar-overlay 等次级窗口，不阻塞主注入流程
**位置**：`src/main/cdp/injection-verifier.ts`（修改）
**工作量**：~80 行 + 15 测试

### P2：图片主题增强（来自 workbuddy-skin-studio）

**价值**：增强 image-theme-analyzer 的取色算法
**位置**：`src/main/profile/image-theme-analyzer.ts`（修改）
**工作量**：~100 行 + 20 测试

### P3：DOM Snapshot API（来自 CodeDrobe）

**价值**：为 Studio 提供 AI 辅助主题创作能力
**位置**：`src/main/cdp/dom-snapshot.ts`（新增）
**工作量**：~150 行 + 25 测试

---

## 五、下一步建议

1. **立即执行**：P0（DevToolsActivePort）+ P1（Per-Window 降级）— 解决实际注入稳定性问题
2. **短期规划**：P2（图片主题增强）— 对标 DreamSkin 核心能力
3. **中期规划**：P3（DOM Snapshot API）— 为 Studio 增加 AI 辅助创作
4. **持续关注**：dream-work-theme 的多品牌格式兼容进展
5. **Chromium 136+ 兼容性**：所有 CDP 注入工具需关注此变更

---

## 六、文件变更清单（待执行）

| 操作 | 文件 | 来源 |
|------|------|------|
| 新增 | `src/main/cdp/port-discovery.ts` | CodeDrobe |
| 新增 | `src/main/cdp/port-discovery.test.ts` | CodeDrobe |
| 修改 | `src/main/cdp/injection-verifier.ts` | CodeDrobe |
| 新增 | `src/main/cdp/dom-snapshot.ts` | CodeDrobe |
| 新增 | `src/main/cdp/dom-snapshot.test.ts` | CodeDrobe |
| 修改 | `src/main/profile/image-theme-analyzer.ts` | workbuddy-skin-studio |
