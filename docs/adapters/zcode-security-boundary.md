# ZCode 适配器安全边界

> 文档日期：2026-08-28 | 适用适配器：`src/engine/src/adapters/zcode.mjs`
> 配套文档：
> - `docs/apps/zcode/architecture.md` — 渲染面与变量体系
> - `docs/apps/zcode/ADAPTATION.md` — 适配策略 + 实测结论
> - `docs/apps/zcode/fragility.md` — 脆弱性分级
>
> 本档定位：**AgentSkin 在 ZCode 客户端上的安全边界声明**——明确能做什么、不能做什么、已知机制与最佳实践。

---

## 1. 范围与定义

| 术语 | 含义 |
|------|------|
| AgentSkin | 本引擎，仅做视觉层（CSS 变量桥接 + 结构样式）注入，不修改目标应用逻辑 |
| ZCode 客户端 | `@zcode/desktop`（v3.6.5+），Windows 上为 Squirrel 安装器部署的 Electron app |
| 注入通道 | CDP WebSocket → `Runtime.evaluate`，主进程侧发起 |
| AgentSkin 适配器 | `src/engine/src/adapters/zcode.mjs`（L4 结构适配 + 桥接契约） |
| 引擎层 | `engines/zcode/`（adapter.mjs / tokens.css / cosmetic.css） |

**核心原则**：AgentSkin 是**只读注入方**，不请求、不拦截、不修改 ZCode 客户端的任何权限模型、hook 链路或用户交互闭环。

---

## 2. ZCode 客户端已知机制

以下信息来自第三方逆向研究（`Aealen/zcode-hooks-poc`、`Jia-Ethan/zcode-keysmith`），AgentSkin **不使用、不依赖、不触发**这些机制，仅做边界认知。

### 2.1 PermissionRequest 反向控制闭环

- **机制**：ZCode 客户端内部存在 `PermissionRequest` 协议，write/edit/bash 类操作可被外部 hook 完全接管（自动批准/拒绝）。
- **AgentSkin 边界**：
  - 不涉及任何权限请求的监听或拦截
  - 不模拟用户操作（点击、键盘输入）
  - 仅在 CDP `Runtime.evaluate` 中执行 CSS 相关 DOM 操作
  - **绝不**调用 `Page.addScriptToEvaluateOnNewDocument` 注入 JS 逻辑到 ZCode 的功能上下文

### 2.2 AskUserQuestion 完全接管

- **机制**：ZCode 客户端的 `AskUserQuestion` API 可被 hook 代理，含中文 "other" 自定义输入路径。
- **AgentSkin 边界**：
  - 不与任何用户问答 UI 交互
  - 不注入任何伪造的用户应答逻辑
  - 注入的 CSS/JS 仅在渲染层（renderer frame）生效，不影响主进程 IPC

### 2.3 macOS 系统角色入口（zcode-keysmith）

- **机制**：ZCode 在 macOS 上有系统级辅助功能 / 权限入口，可被用于自动化控制。
- **AgentSkin 边界**：
  - AgentSkin 仅在 Windows 平台运行（Electron desktop app）
  - 不调用任何系统级辅助功能 API（Accessibility、AppleScript 等）
  - 所有注入均限定在 CDP 协议范围内

### 2.4 Squirrel 安装器特性

- **机制**：Windows 上使用 Squirrel 安装器，应用位于 `C:\Program Files\ZCode\`，session 数据在 `%APPDATA%\ZCode\session\`。
- **AgentSkin 边界**：
  - 仅读取 `DevToolsActivePort` 文件以发现 CDP 端口
  - **绝不**修改 `app.asar` 包内容或任何应用文件
  - 不读取 ZCode 的 session / token / 用户数据

---

## 3. AgentSkin 注入的安全模型

### 3.1 注入层（L0-L3）的安全约束

| 层 | 操作 | 安全属性 |
|----|------|----------|
| L0 | `Page.addScriptToEvaluateOnNewDocument` | 仅注入 CSS 变量桥接代码（`css-var-bridge.mjs`），不执行任何功能逻辑 |
| L1 | `tokens.css` 注入 | 纯 CSS 自定义属性覆盖，位于 `engines/zcode/tokens.css`（当前为占位） |
| L2 | `cosmetic.css` 注入 | 视觉打磨样式，不覆写事件处理、不修改 DOM 结构 |
| L3 | `adapter.mjs` 结构适配 | MutationObserver 自愈；仅操作 `documentElement` CSS 变量、`body::before` hero 层；不修改 ZCode 的 React 组件状态 |

### 3.2 CSS 变量桥接（bridge 字段）

适配器定义的 5 个 CSS 变量桥接（见 `zcode.mjs` 第 60-66 行）：

```javascript
bridge: [
  { var: "--color-foreground", role: "text" },
  { var: "--color-foreground-subtle", role: "muted" },
  { var: "--color-accent", role: "accent" },
  { var: "--color-primary", role: "accent" },
  { var: "--color-border", role: "border" },
]
```

- **安全属性**：只覆盖 CSS 自定义属性的声明值，不涉及任何 JS 执行上下文
- **透明度保留**：art-transparent 变量（`--color-background`、`--color-surface` 等）**故意不桥接**，保证 hero/壁纸可见

### 3.3 运行时安全

- **注入身份**：CDP 连接由 AgentSkin 主进程（Electron main）发起，使用 ZCode 客户端自身开放的 DevTools 端口
- **执行上下文**：`Runtime.evaluate` 在 ZCode page 的 renderer frame 中运行，权限等同于页面自身脚本
- **数据隔离**：注入的代码不访问 `localStorage`、`sessionStorage`、IndexedDB、网络请求
- **无副作用**：注入逻辑在 `document.createElement('style')` 完成后即退出，无后台任务

---

## 4. 不做的事（安全红线）

以下操作明确不在 AgentSkin ZCode 适配器的范围内，且被架构约束禁止：

| 禁止项 | 原因 |
|--------|------|
| 拦截/修改 `PermissionRequest` 闭环 | 属于权限代理领域，非视觉定制 |
| Hook `AskUserQuestion` 或其变体 | 用户交互代理超出视觉注入范围 |
| 读取 ZCode 的认证 token / session | 用户数据保护 |
| 修改 `app.asar` 打包内容 | 应用完整性保护 |
| 调用系统级辅助功能 API | 隐私与安全合规 |
| 通过 CDP 代理网络请求 | 数据安全与传输层隔离 |
| 注入可执行 JS 到 ZCode 的功能上下文 | 最小权限原则 |
| 修改 ZCode 的 React fiber / state 树 | 应用稳定性保护 |

---

## 5. 已知风险与缓解

### 5.1 版本漂移风险

| 风险 | 概率 | 缓解 |
|------|------|------|
| Tailwind v4 语义变量重命名 | Unlikely | `matchTarget` 走 URL/title 匹配，不依赖变量名 |
| 257 个 `--color-*` 变量重构 | Low | 仅桥接 5 个核心语义变量，主题层覆盖 65+16，不追全量 |
| `#root` 选择器消失 | Low | Any: `["#root", "body"]` 兜底 |
| Squirrel 安装路径变化 | Low | 5 个 `executableCandidates` + 2 个 `devToolsActivePortFile` 兜底 |

### 5.2 竞品 hook 生态的联动风险

第三方 hook 项目（如 zcode-hooks-poc）如果同时运行，可能与 AgentSkin 的 CDP 连接共存。AgentSkin 的缓解措施：

- 注入的 CSS 变量桥接是**幂等的**（`AdaptiveMutationObserver` 兜底 + 幂等判断）
- 不修改 ZCode 的 JS 运行时，不与 hook 代理竞争
- 如果第三方 hook 改变了 DOM 结构，AgentSkin 的推荐锚点（sidebar/composer）会优雅降级为 `rootAny` 根挂载
- 引擎层的 bridge 契约是声明式的（`{ var, role }`），不依赖特定 DOM 查询

---

## 6. 安全最佳实践

### 6.1 适配器开发

1. **不扩展 bridge 范围**：当前 5 个语义变量是经过 RFC 评审的，扩大需走 RFC 流程
2. **不修改 L0 注入代码**：`Page.addScriptToEvaluateOnNewDocument` 注入的是编译产物，不在适配器层修改
3. **CSS 变量桥接保持声明式**：bridge 字段只描述"把 ZCode 的哪个变量映射到 AgentSkin 的哪个角色"
4. **验证锚点使用宽松匹配**：`recommended` 不是 `required`，校验走 soft-fail

### 6.2 运行时监控

- `npm run check` 中的 `check-injection-contract`（C1）保证四源一致
- `check-themes`（C2）保证 14-token 主题契约不越界
- `check-architecture-boundaries`（C4）保证 L0-L4 分层不被破坏

### 6.3 故障恢复

- `apply` 失败 → `restore` 还原：AgentSkin 的注入是双向可逆的，主进程保存 snapshot
- `epoch-manager.ts` 防止过期 apply 覆盖新操作，保证并发安全
- DOM 结构变化时 `MutationObserver` 自愈，不要求 ZCode 客户端重启

---

## 7. 与其他适配器的安全边界对比

| 维度 | ZCode | Codex | Doubao | TRAE Work | QoderWork | WorkBuddy |
|------|-------|-------|--------|-----------|-----------|-----------|
| 注入通道 | CDP Runtime.evaluate | CDP Runtime.evaluate | CDP Runtime.evaluate | CDP Runtime.evaluate | CDP Runtime.evaluate | CDP Runtime.evaluate |
| 渲染 scheme | file:// | app:// | app:// | app:// | app:// | app:// |
| 变量桥接 | 5 个 `--color-*` | 多个 `--token-*` | 多个 | 多个 | 多个 | 多个 |
| 透明通道 | 故意保留 art-transparent | 部分保留 | N/A | N/A | N/A | N/A |
| hook 生态 | 已知存在（外部项目） | 已知存在（explodex 等） | 未公开 | 未公开 | 未公开 | 未公开 |
| 系统角色入口 | macOS only（不涉及） | N/A | N/A | N/A | N/A | N/A |
| AgentSkin 使用 hook | 否 | 否 | 否 | 否 | 否 | 否 |

---

## 8. 参考

- **Aealen/zcode-hooks-poc** — ZCode 客户端 hook 机制的 PoC 验证项目（PermissionRequest / AskUserQuestion，v2.1.0 实测通过）
- **Jia-Ethan/zcode-keysmith** — ZCode macOS 系统角色入口管理工具
- **AgentSkin RFC 2026-08-19** — `docs/rfc/2026-08-19-fix-zcode-theme-token-mapping.md` 主题层全权接管方案
- **AgentSkin 架构** — `docs/ARCHITECTURE.md` L0-L4 注入层分层
- **AgentSkin 主题契约** — `docs/THEME-SPEC.md` 14-token 体系
