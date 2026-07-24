# Theme Package API 接口规范

本文档定义 AgentSkin 主题包系统的完整接口调用链、类型契约和错误码。

## 调用链总览

```
Renderer (AgentSkinApi)
  → IPC (ipcRenderer.invoke / ipcMain.handle)
    → AgentEngineService (状态持久化、端口编排、scheme 同步)
      → AdapterRegistry.requireAdapter(appId) → ApplicationAdapter
        → ThemeRuntime (agentskin-core-runtime.ts)
          → @agentskin/core (CDP 注入、host-settings 事务)
```

每一层只依赖下一层的 **接口**，不跨层调用。

## 层级职责

| 层 | 文件 | 职责 |
|---|---|---|
| Renderer API | `src/preload.ts` + `src/shared/types.ts#AgentSkinApi` | 暴露 IPC 通道给渲染进程 |
| IPC 路由 | `src/main.ts` | 参数校验 + 分发到 Service |
| 控制层 | `src/main/agent-engine-service.ts` | 状态持久化、CDP 端口发现、scheme 同步、重启策略 |
| 适配器 | `src/adapters/base.ts` + `src/adapters/registry.ts` | 应用身份 + 委托到 Runtime |
| 运行时 | `src/legacy/agentskin-core-runtime.ts` | 唯一导入 @agentskin/core 的模块 |
| 引擎 | `@agentskin/core` | CDP 协议、CSS 注入、应用发现 |

## 核心类型

### ThemeBundle (运行时层)

```typescript
// src/legacy/agentskin-core-runtime.ts
export type ThemeBundle = ThemePackage; // @agentskin/core 的完整解析结果
// 包含: theme (manifest), targets (Record<coreId, {css, ...}>), assets (images)
```

### ThemePackageRef (UI 层)

```typescript
// src/shared/types.ts
export interface ThemePackageRef {
  manifest: ThemeManifest;  // id, name, version, targets: AgentId[]
  sourcePath: string;       // 磁盘路径
}
```

> 注意：`ThemePackageRef` 是轻量引用，不含 CSS 内容。完整解析后的 `ThemeBundle` 仅存在于主进程。

### InstalledTheme (产品层)

```typescript
// src/shared/types.ts
export interface InstalledTheme {
  id: string;
  displayName: string;
  version: string;
  supportedAgents: AgentId[];
  coverDataUrl: string | null;
  colors?: Record<string, string>;
  mode?: 'dark' | 'light' | 'auto';
  contentHash?: string;
  // ... 其他元数据
}
```

### ApplyRequest / ApplyResponse (IPC 契约)

```typescript
export interface ApplyRequest {
  themeId: string;
  appId: AgentId;
  port?: number;
  restartExisting?: boolean;
}

export interface ApplyResponse {
  status: 'applied' | 'requires-restart' | 'port-occupied';
  message: string;
  system: SystemStatus;
}
```

## ThemeRuntime 接口 (运行时公开 API)

```typescript
export interface ThemeRuntime {
  // --- 生命周期 ---
  readTheme(filePath: string): Promise<ThemeBundle>;
  validateTheme(bundle: unknown): ThemeBundle;
  convertLegacyTheme(input: string, output: string, opts?: { force?: boolean }): Promise<ConvertLegacyThemeResult>;

  // --- 执行 ---
  applyTheme(params: ApplyThemeParams): Promise<ApplyThemeResult>;
  restoreTheme(params: RestoreThemeParams): Promise<RestoreThemeResult>;

  // --- 发现 ---
  discoverApplication(coreId: string, platform?: string, appPath?: string | null): Promise<DiscoveredApp | null>;
  findDebugTargets(coreId: string, port: number, timeoutMs?: number): Promise<CdpTarget[]>;
  findRunningProcesses(coreId: string, platform?: string, exe?: string | null): Promise<number[]>;
  resolveDebugPortsFor(coreId: string, platform?: string): Promise<number[]>;
  resolveThemeTargetFor(bundle: ThemeBundle, coreId: string): ResolvedThemeTarget;
  getCoreAdapter(coreId: string): CoreAppAdapter;
  listCoreAdapters(): CoreAppAdapter[];
}
```

单例实例：`export const themeRuntime: ThemeRuntime`。

## ApplicationAdapter 接口 (适配器层)

```typescript
export interface ApplicationAdapter {
  // 身份
  readonly id: string;
  readonly name: string;
  readonly type: ApplicationType;       // 'agent' | 'ide' | 'desktop'
  readonly tier: AdapterTier;           // 'active' | 'experimental'
  readonly coreId: string;
  readonly installHints?: InstallHints;

  // 规范面 (V3 spec)
  detect(platform: string, appPath?: string | null): Promise<boolean>;
  getPath(platform: string, appPath?: string | null): Promise<string | null>;
  applyTheme(bundle: ThemeBundle, options?: ApplyThemeOptions): Promise<ApplyThemeResult>;
  restoreTheme(port: number): Promise<RestoreThemeResult>;

  // 支撑面 (agent-engine-service 使用)
  discover(platform: string, appPath?: string | null): Promise<DiscoveredApp | null>;
  findTargets(port: number, timeoutMs?: number): Promise<CdpTarget[]>;
  findRunningPids(platform: string, executable?: string | null): Promise<number[]>;
  resolveDebugPorts(platform: string): Promise<number[]>;
  defaultPort(): number;
  displayName(): string;
}
```

## IPC 通道映射

| 通道 | 方向 | 处理 |
|---|---|---|
| `theme:apply` | invoke | → `AgentEngineService.apply(ApplyRequest)` |
| `theme:restore` | invoke | → `AgentEngineService.restore(AgentId)` |
| `system:status` | invoke | → `AgentEngineService.status()` |
| `theme:import` | invoke | → 文件对话框 + ThemeLibrary.import |
| `theme:import-path` | invoke | → ThemeLibrary.importFromPath |
| `theme:import-bytes` | invoke | → ThemeLibrary.importFromBytes |
| `theme:export` | invoke | → ThemeLibrary.export |
| `theme:delete` | invoke | → ThemeLibrary.delete |
| `theme:list` | invoke | → ThemeCatalog.listThemes |
| `theme:get` | invoke | → ThemeCatalog.getTheme |
| `theme:search` | invoke | → ThemeCatalog.search |
| `theme:filter` | invoke | → ThemeCatalog.filterByAgent |
| `runtime:log` | on (push) | ← AgentEngineService.logListener |

## 错误码

| 常量 | 值 | 含义 |
|---|---|---|
| `ERROR_CODES.RESTART_REQUIRED` | `CODEDROBE_RESTART_REQUIRED` | 目标应用需要重启才能注入 |
| `ERROR_CODES.PORT_OCCUPIED` | `CODEDROBE_PORT_OCCUPIED` | CDP 端口被占用 |
| `ERROR_CODES.TARGET_TIMEOUT` | `CODEDROBE_TARGET_TIMEOUT` | CDP 目标发现超时 |
| `ERROR_CODES.DOM_INCOMPATIBLE` | `CODEDROBE_DOM_INCOMPATIBLE` | DOM 结构不兼容 |
| `ExperimentalAdapterError.code` | `AGENTSKIN_EXPERIMENTAL_ADAPTER` | 实验性适配器不支持操作 |

## 主题包生命周期

```
1. 读取   readTheme(path) → ThemeBundle
2. 校验   validateTheme(bundle) → ThemeBundle (throws on invalid)
3. 解析   resolveThemeTargetFor(bundle, coreId) → ResolvedThemeTarget
4. 应用   applyTheme({coreId, targetTheme, port}) → ApplyThemeResult
5. 恢复   restoreTheme({coreId, port}) → RestoreThemeResult
```

## CDP 端口发现策略 (AgentEngineService)

不信任任何硬编码端口。发现顺序：

1. **DevToolsActivePort 文件** — 读取 core adapter 声明的路径
2. **PID → argv** — 从进程命令行提取 `--remote-debugging-port=N`
3. **PID → netstat** — 枚举进程监听端口，逐一探测 `/json/list`

仅接受 loopback 绑定 (127.0.0.1 / [::1])。

## Scheme 同步

应用主题后自动匹配 agent 的 light/dark 模式：

1. 首次应用时捕获原始 scheme → `schemeSnapshot` 持久化
2. 通过 CDP 注入目标 mode (html[data-theme] / body class / localStorage)
3. 稳定性窗口 (2s/5s/10s) 重检，防止 agent 自身渲染周期覆盖
4. 恢复主题时写回 snapshot

## 版本兼容

- `schemaVersion: 1` → 旧格式，仅基础字段
- `schemaVersion: 2` → 当前标准 (targets/author/category/tags)
- v2.1 扩展 (dynamic/wallpaper/fonts/minAppVersion) → 向后兼容
- 旧客户端忽略未知字段；使用新字段时建议设置 `minAppVersion`

## 豆包探针样式规范 (doubao.base.css)

### 选择器策略

作用域：`html.codedrobe-host-doubao:root`（特异性 0,2,1），高于豆包原生 `:root[data-theme="dark"]`（0,1,1）和亮色选择器（0,1,0）。

豆包使用 `--dbx-*` 设计 token 系统（251 个 token），通过 `:root[data-theme="dark"|"light"]` 和 `@media prefers-color-scheme` 切换明暗。探针仅覆写**语义层**（text/bg/fill/line/code），不触碰中性色阶、静态 alpha 梯度、彩色色板（red/orange/green/blue/purple/yellow）、圆角、断点和阴影 token。

固定语义色（danger / warning / success、static-white/black 梯度、color-*-100…800 色板）保持原值不覆写。

### Token 映射表 (--dbx-* → --agentskin-*)

#### 背景 (Backgrounds)

| 原生 Token | 映射值 |
|---|---|
| `--dbx-bg-body-web` | `var(--agentskin-bg)` |
| `--dbx-bg-base-web` | `var(--agentskin-bg)` |
| `--dbx-bg-base-2` | `color-mix(in srgb, var(--agentskin-surface) 55%, var(--agentskin-bg))` |
| `--dbx-bg-base-5` | `var(--agentskin-surface)` |
| `--dbx-bg-float` | `var(--agentskin-surface-elevated)` |
| `--dbx-bg-body-overlay-web` | `var(--agentskin-surface)` |
| `--dbx-bg-body-white` | `var(--agentskin-bg)` |
| `--dbx-bg-body-mac` | `color-mix(in srgb, var(--agentskin-bg) 85%, transparent)` |
| `--dbx-bg-base-mac` | `color-mix(in srgb, var(--agentskin-text) 3%, transparent)` |
| `--dbx-bg-browser-win` | `var(--agentskin-bg)` |
| `--dbx-bg-browser-mac` | `color-mix(in srgb, var(--agentskin-bg) 70%, transparent)` |
| `--dbx-bg-body-launcher` | `color-mix(in srgb, var(--agentskin-surface) 80%, transparent)` |
| `--dbx-bg-body-overlay-launcher` | `color-mix(in srgb, var(--agentskin-surface) 45%, transparent)` |
| `--dbx-bg-float-launcher` | `color-mix(in srgb, var(--agentskin-surface-elevated) 60%, transparent)` |
| `--dbx-bg-body-overlay-mac` | `color-mix(in srgb, var(--agentskin-surface) 60%, transparent)` |
| `--dbx-bg-body-overlay-white` | `color-mix(in srgb, var(--agentskin-surface) 60%, transparent)` |
| `--dbx-bg-base-1-overlay-mobile` | `var(--agentskin-bg)` |
| `--dbx-bg-base-2-mobile` | `var(--agentskin-surface)` |
| `--dbx-bg-base-2-overlay-mobile` | `var(--agentskin-surface)` |
| `--dbx-bg-base-3-mobile` | `var(--agentskin-surface-elevated)` |
| `--dbx-bg-base-3-enterprisebubble` | `var(--agentskin-surface-elevated)` |
| `--dbx-bg-base-4-action` | `var(--agentskin-text)` |
| `--dbx-bg-mask` | `rgba(0, 0, 0, 0.4)` |

#### 文本层级 (Text)

| 原生 Token | 映射值 |
|---|---|
| `--dbx-text-primary` | `var(--agentskin-text)` |
| `--dbx-text-secondary` | `var(--agentskin-muted)` |
| `--dbx-text-tertiary` | `color-mix(in srgb, var(--agentskin-muted) 70%, transparent)` |
| `--dbx-text-disable` | `color-mix(in srgb, var(--agentskin-muted) 40%, transparent)` |
| `--dbx-text-markdown` | `color-mix(in srgb, var(--agentskin-text) 95%, transparent)` |
| `--dbx-text-n00-primary` | `var(--agentskin-bg)` |
| `--dbx-text-n00-secondary` | `color-mix(in srgb, var(--agentskin-bg) 80%, transparent)` |
| `--dbx-text-n00-tertiary` | `color-mix(in srgb, var(--agentskin-bg) 60%, transparent)` |
| `--dbx-text-n00-disable` | `color-mix(in srgb, var(--agentskin-bg) 30%, transparent)` |
| `--dbx-text-highlight` | `var(--agentskin-accent)` |
| `--dbx-text-highlight-secondary` | `color-mix(in srgb, var(--agentskin-accent) 60%, transparent)` |
| `--dbx-text-highlight-hover` | `color-mix(in srgb, var(--agentskin-accent) 75%, #fff)` |
| `--dbx-text-highlight-disable` | `color-mix(in srgb, var(--agentskin-accent) 30%, transparent)` |

#### 品牌 / 填充 (Brand / Fill)

| 原生 Token | 映射值 |
|---|---|
| `--dbx-brand-default` | `var(--agentskin-accent)` |
| `--dbx-fill-highlight` | `var(--agentskin-accent)` |
| `--dbx-fill-highlight-hover` | `color-mix(in srgb, var(--agentskin-accent) 80%, #fff)` |
| `--dbx-fill-highlight-disable` | `color-mix(in srgb, var(--agentskin-accent) 30%, transparent)` |
| `--dbx-fill-highlight-trans-10` | `color-mix(in srgb, var(--agentskin-accent) 6%, transparent)` |
| `--dbx-fill-highlight-trans-10-blank` | `color-mix(in srgb, var(--agentskin-accent) 6%, transparent)` |
| `--dbx-fill-primary-50` | `var(--agentskin-accent)` |
| `--dbx-fill-primary-60` | `color-mix(in srgb, var(--agentskin-accent) 85%, #000)` |
| `--dbx-fill-primary-transparent-1` | `color-mix(in srgb, var(--agentskin-accent) 12%, transparent)` |
| `--dbx-fill-banner` | `var(--agentskin-surface-elevated)` |
| `--dbx-fill-trans-10` | `color-mix(in srgb, var(--agentskin-text) 3%, transparent)` |
| `--dbx-fill-trans-10-hover` | `color-mix(in srgb, var(--agentskin-text) 5%, transparent)` |
| `--dbx-fill-trans-10-disable` | `color-mix(in srgb, var(--agentskin-text) 3%, transparent)` |
| `--dbx-fill-trans-20` | `color-mix(in srgb, var(--agentskin-text) 5%, transparent)` |
| `--dbx-fill-trans-20-hover` | `color-mix(in srgb, var(--agentskin-text) 8%, transparent)` |
| `--dbx-fill-trans-20-disable` | `color-mix(in srgb, var(--agentskin-text) 5%, transparent)` |
| `--dbx-fill-trans-30` | `color-mix(in srgb, var(--agentskin-text) 8%, transparent)` |
| `--dbx-fill-trans-30-hover` | `color-mix(in srgb, var(--agentskin-text) 12%, transparent)` |
| `--dbx-fill-trans-30-disable` | `color-mix(in srgb, var(--agentskin-text) 8%, transparent)` |

#### 线条 / 边框 (Lines)

| 原生 Token | 映射值 |
|---|---|
| `--dbx-line-divider-5` | `color-mix(in srgb, var(--agentskin-border) 50%, transparent)` |
| `--dbx-line-divider-10` | `var(--agentskin-border)` |
| `--dbx-line-7` | `color-mix(in srgb, var(--agentskin-border) 70%, transparent)` |
| `--dbx-line-10` | `var(--agentskin-border)` |
| `--dbx-line-15` | `color-mix(in srgb, var(--agentskin-border) 80%, var(--agentskin-text) 20%)` |
| `--dbx-line-20-hover` | `color-mix(in srgb, var(--agentskin-border) 60%, var(--agentskin-text) 40%)` |
| `--dbx-line-highlight` | `color-mix(in srgb, var(--agentskin-accent) 20%, transparent)` |

#### 代码块 (Code)

| 原生 Token | 映射值 |
|---|---|
| `--dbx-code-text` | `var(--agentskin-code-fg)` |
| `--dbx-code-doc` | `var(--agentskin-muted)` |
| `--dbx-code-link` | `var(--agentskin-accent)` |

#### 功能色 / 开关 (Function / Symbol)

| 原生 Token | 映射值 |
|---|---|
| `--dbx-function-info` | `var(--agentskin-accent)` |
| `--dbx-function-info-hover` | `color-mix(in srgb, var(--agentskin-accent) 80%, #fff)` |
| `--dbx-function-info-disable` | `color-mix(in srgb, var(--agentskin-accent) 30%, transparent)` |
| `--dbx-symbol-switch-toggle-disable` | `color-mix(in srgb, var(--agentskin-muted) 30%, transparent)` |

### Art 层 (背景合成)

```css
html.codedrobe-host-doubao body {
  background:
    linear-gradient(90deg, surface 80%→32%→transparent),  /* 左侧遮罩 */
    linear-gradient(180deg, transparent→surface 76%),      /* 底部渐隐 */
    radial-gradient(120% 80% at 84% 14%, secondary 22%),   /* 右上辉光 */
    var(--codedrobe-art, none) right center / cover;       /* hero 图 */
}
```

### 结构性规则

| 规则 | 说明 |
|---|---|
| 透明穿透 | `[class*="container/chat-wrapper/message-list/conversation/sidebar/panel"]` → `background: transparent` |
| 毛玻璃侧栏 | `[class*="sidebar"]` → surface 72% + backdrop-blur(20px) + accent 边框 |
| 输入焦点环 | `input/textarea/[contenteditable]/[class*="editor"]:focus` → accent 40% 外发光 + secondary 20% 阴影 |
| 浮层毛玻璃 | `[role="dialog/menu/tooltip/listbox"]` + `[class*="popover/dropdown/modal/tooltip"]` → surface 94% + blur(20px) + accent 边框 |
| 消息文本 | `[class*="message"] [class*="content"]` / `article` → text-shadow 增强对比 |
| 代码块 | `code` / `pre` → code-bg + code-fg + accent 14% 边框 + 左侧 3px accent 50% 装饰线 |
| 链接 | `a` → accent 色 + hover 降低透明度 |
| 按钮渐变 | `button[class*="primary/send"]` → accent→secondary 135° 渐变 + focus-ring 阴影 + hover 上浮 |
| 选区色 | `::selection` → `var(--agentskin-selection)` |
| 滚动条 | accent→secondary 渐变 thumb，圆角 8px，hover 加深 |
| 减弱动效 | `@media (prefers-reduced-motion: reduce)` → 所有动画/过渡 0.01ms |

## WorkBuddy 探针样式规范 (workbuddy.base.css)

### 选择器策略

作用域：`body[data-application-name="workbuddy"]`（特异性 0,1,1）。

WorkBuddy 使用 `--cb-*` 设计变量系统（背景/文本/VS Code 包装/按钮/描边），探针通过中间变量 `--wb-accent / --wb-secondary / --wb-surface / --wb-text` 桥接到 `--agentskin-*` 14-token 体系。

### 中间变量桥接

| 中间变量 | 来源 |
|---|---|
| `--wb-accent` | `var(--agentskin-accent)` |
| `--wb-secondary` | `var(--agentskin-secondary)` |
| `--wb-surface` | `var(--agentskin-bg)` |
| `--wb-text` | `var(--agentskin-text)` |

### Token 映射表 (--cb-* → --agentskin-*)

#### 背景 (Backgrounds)

| 原生 Token | 映射值 |
|---|---|
| `--cb-bg-primary` | `var(--wb-surface)` |
| `--cb-bg-secondary` | `color-mix(in srgb, var(--wb-surface) 94%, transparent)` |
| `--cb-panel-bg-primary` | `color-mix(in srgb, var(--wb-surface) 88%, transparent)` |
| `--cb-team-member-card-background` | `color-mix(in srgb, var(--wb-surface) 88%, transparent)` |

#### 文本 (Text)

| 原生 Token | 映射值 |
|---|---|
| `--cb-text-primary` | `var(--wb-text)` |
| `--cb-text-secondary` | `color-mix(in srgb, var(--wb-text) 70%, transparent)` |
| `--cb-text-disabled` | `color-mix(in srgb, var(--wb-text) 42%, transparent)` |
| `--cb-text-link` | `var(--wb-accent)` |
| `--cb-text-error-active` | `var(--wb-accent)` |

#### VS Code 包装层 (VS Code Wrappers)

| 原生 Token | 映射值 |
|---|---|
| `--cb-vscode-editor-background` | `var(--wb-surface)` |
| `--cb-vscode-sideBar-background` | `color-mix(in srgb, var(--wb-surface) 90%, transparent)` |
| `--cb-vscode-foreground` | `var(--wb-text)` |
| `--cb-vscode-editor-foreground` | `var(--wb-text)` |
| `--cb-vscode-descriptionForeground` | `color-mix(in srgb, var(--wb-text) 70%, transparent)` |
| `--cb-vscode-titleBar-activeBackground` | `var(--wb-accent)` |
| `--cb-vscode-titleBar-activeForeground` | `#1f2937` |
| `--cb-vscode-titleBar-inactiveBackground` | `color-mix(in srgb, var(--wb-accent) 80%, var(--wb-surface))` |
| `--cb-vscode-titleBar-inactiveForeground` | `color-mix(in srgb, #1f2937 70%, transparent)` |
| `--cb-titlebar-control-hover-background` | `color-mix(in srgb, var(--wb-accent) 16%, transparent)` |
| `--cb-vscode-input-background` | `color-mix(in srgb, var(--wb-surface) 88%, transparent)` |
| `--cb-vscode-dropdown-background` | `color-mix(in srgb, var(--wb-surface) 94%, transparent)` |
| `--cb-vscode-list-hoverBackground` | `color-mix(in srgb, var(--wb-accent) 16%, transparent)` |
| `--cb-vscode-toolbar-hoverBackground` | `color-mix(in srgb, var(--wb-accent) 16%, transparent)` |
| `--cb-vscode-scrollbarSlider-background` | `color-mix(in srgb, var(--wb-accent) 30%, transparent)` |
| `--cb-vscode-scrollbarSlider-hoverBackground` | `color-mix(in srgb, var(--wb-accent) 50%, transparent)` |
| `--cb-vscode-textLink-foreground` | `var(--wb-accent)` |
| `--cb-vscode-widget-border` | `color-mix(in srgb, var(--wb-accent) 45%, transparent)` |
| `--cb-vscode-panel-border` | `color-mix(in srgb, var(--wb-accent) 30%, transparent)` |

#### 按钮 (Buttons)

| 原生 Token | 映射值 |
|---|---|
| `--cb-button-dark-background` | `var(--wb-accent)` |
| `--cb-button-dark-foreground` | `#1f2937` |
| `--cb-button-dark-hover-background` | `color-mix(in srgb, var(--wb-accent) 85%, #000000)` |
| `--cb-vscode-button-background` | `var(--wb-accent)` |
| `--cb-vscode-button-foreground` | `#1f2937` |
| `--cb-vscode-button-hoverBackground` | `color-mix(in srgb, var(--wb-accent) 85%, #000000)` |

#### 描边 (Strokes)

| 原生 Token | 映射值 |
|---|---|
| `--cb-stroke-secondary` | `color-mix(in srgb, var(--wb-accent) 45%, transparent)` |
| `--cb-markdown-hr-border-color` | `color-mix(in srgb, var(--wb-accent) 30%, transparent)` |

### Art 层 (背景合成)

```css
#root {
  background:
    linear-gradient(90deg, surface 80%→32%→transparent),  /* 左侧遮罩 */
    linear-gradient(180deg, transparent→surface 76%),      /* 底部渐隐 */
    radial-gradient(120% 80% at 84% 14%, secondary 22%),   /* 右上辉光 */
    var(--codedrobe-art, none) right center / cover;       /* hero 图 */
}
```

### 结构性规则

| 规则 | 说明 |
|---|---|
| 容器透明 | `.teams-container` / `.conversation-list` / `.chat-container` / `.wb-cb-chat` / `.main-content` / `.sidebar-next` → `background: transparent` |
| 面板毛玻璃 | `[data-view-id]` → surface 72% + backdrop-blur(18px) |
| 侧栏 | `[data-view-id="sidebar"]` → surface 72% + blur(20px) + accent 42% 右边框 |
| 主内容区 | `[data-view-id="main-content"]` → 顶部透明→底部 bg 74% 渐变 |
| 详情面板 | `[data-view-id="detail-panel"]` → surface 72% + blur(18px) |
| 浮层 | `.ant-popover/dropdown/select/tooltip` + `[role="dialog/menu/tooltip"]` → surface 94% + blur(20px) + accent 边框 |
| 输入焦点 | `[contenteditable]:focus` → accent 40% 外发光 + secondary 20% 阴影 |
| 消息文本 | `article` / `[class*="message"] [class*="content"]` → text-shadow 增强对比 |
| 选区色 | `::selection` → accent 32% |
| 滚动条 | accent→secondary 渐变 thumb，圆角 8px，hover 加深 |
| 菜单栏对比度 | `.menubar-menu-title` → 从 disabled(42%) 提升到 secondary(70%)，hover 到 primary |
| 减弱动效 | `@media (prefers-reduced-motion: reduce)` → 所有动画/过渡 0.01ms |

### 组件润色

| 组件 | 处理 |
|---|---|
| 主按钮 | `wb-button--primary` / `wb-button[class*="send"]` → accent→secondary 135° 渐变 + focus-ring 阴影 + hover 上浮 |
| 代码块 | `code` / `pre` → code-bg + code-fg + accent 14% 边框 + 左侧 3px accent 50% 装饰线 |
| 链接 | `a` → accent 色 + hover 降低透明度 |
| 侧栏项 | `[data-view-id="sidebar"] [class*="item"]` → 140ms background 过渡 |

## TRAE Work CN 探针样式规范 (traework.base.css)

### 选择器策略

作用域：`html.codedrobe-host-traework body`（特异性 0,1,2），高于 TRAE SOLO 原生 `body` 选择器（0,0,1）声明的 `--vscode-*` token。

TRAE Work CN 基于 VS Code solo-lite 壳，使用 `--vscode-*` 和 `--vscode-icube-*` 设计 token 系统。探针通过覆写这些 token 实现全局换肤，再叠加 hero art 和结构性润色。

### Token 映射表 (--vscode-* → --agentskin-*)

#### 文本 / 墨色 (Ink / Text)

| 原生 Token | 映射值 |
|---|---|
| `--vscode-foreground` | `var(--agentskin-text)` |
| `--vscode-icube-colorDefaultText` | `var(--agentskin-text)` |
| `--vscode-icube--text-text-default` | `var(--agentskin-text)` |
| `--vscode-icube-colorHighlightText` | `var(--agentskin-text)` |
| `--vscode-descriptionForeground` | `var(--agentskin-muted)` |
| `--vscode-icube-colorGrayText` | `var(--agentskin-muted)` |
| `--vscode-icube-colorDisableText` | `color-mix(in srgb, var(--agentskin-text) 42%, transparent)` |

#### 品牌 / 链接 / 按钮 (Brand / Links / Buttons)

| 原生 Token | 映射值 |
|---|---|
| `--vscode-textLink-foreground` | `var(--agentskin-accent)` |
| `--vscode-textLink-activeForeground` | `var(--agentskin-secondary)` |
| `--vscode-button-background` | `var(--agentskin-accent)` |
| `--vscode-button-foreground` | `#ffffff` |
| `--vscode-button-hoverBackground` | `color-mix(in srgb, var(--agentskin-accent) 85%, transparent)` |
| `--vscode-icube-colorBrand` | `var(--agentskin-accent)` |
| `--vscode-focusBorder` | `color-mix(in srgb, var(--agentskin-accent) 60%, transparent)` |

#### 线条 / 边框 (Lines / Borders)

| 原生 Token | 映射值 |
|---|---|
| `--vscode-icube-colorLine1` | `color-mix(in srgb, var(--agentskin-accent) 18%, transparent)` |
| `--vscode-icube-colorLine2` | `color-mix(in srgb, var(--agentskin-accent) 32%, transparent)` |
| `--vscode-icube--border-border-neutral-l1` | `color-mix(in srgb, var(--agentskin-accent) 18%, transparent)` |
| `--vscode-chat-requestBorder` | `color-mix(in srgb, var(--agentskin-accent) 25%, transparent)` |
| `--vscode-widget-border` | `color-mix(in srgb, var(--agentskin-accent) 18%, transparent)` |
| `--vscode-panel-border` | `color-mix(in srgb, var(--agentskin-accent) 18%, transparent)` |

#### 填充 / 悬停 (Fills / Hovers)

| 原生 Token | 映射值 |
|---|---|
| `--vscode-toolbar-hoverBackground` | `color-mix(in srgb, var(--agentskin-accent) 12%, transparent)` |
| `--vscode-icube-colorBtnHover` | `color-mix(in srgb, var(--agentskin-accent) 12%, transparent)` |
| `--vscode-icube-colorBtnHover2` | `color-mix(in srgb, var(--agentskin-accent) 18%, transparent)` |
| `--vscode-list-hoverBackground` | `color-mix(in srgb, var(--agentskin-accent) 12%, transparent)` |
| `--vscode-list-activeSelectionBackground` | `color-mix(in srgb, var(--agentskin-accent) 18%, transparent)` |
| `--vscode-icube--bg-bg-overlay-l2` | `color-mix(in srgb, var(--agentskin-accent) 12%, transparent)` |
| `--vscode-icube--bg-bg-overlay-l3` | `color-mix(in srgb, var(--agentskin-accent) 18%, transparent)` |
| `--vscode-input-background` | `color-mix(in srgb, var(--agentskin-accent) 7%, transparent)` |

#### 表面 (Surfaces)

| 原生 Token | 映射值 |
|---|---|
| `--vscode-editor-background` | `var(--agentskin-bg)` |
| `--vscode-icube-colorBg1` | `var(--agentskin-bg)` |
| `--vscode-icube-colorBg2` | `var(--agentskin-surface)` |
| `--vscode-icube-colorBg3` | `var(--agentskin-surface)` |
| `--vscode-editorWidget-background` | `var(--agentskin-surface)` |
| `--vscode-sideBar-background` | `color-mix(in srgb, var(--agentskin-surface) 88%, transparent)` |
| `--vscode-widget-shadow` | `color-mix(in srgb, var(--agentskin-accent) 15%, transparent)` |
| `--vscode-badge-background` | `color-mix(in srgb, var(--agentskin-accent) 65%, transparent)` |
| `--vscode-badge-foreground` | `#ffffff` |
| `--vscode-scrollbarSlider-background` | `color-mix(in srgb, var(--agentskin-accent) 22%, transparent)` |
| `--vscode-scrollbarSlider-hoverBackground` | `color-mix(in srgb, var(--agentskin-accent) 38%, transparent)` |
| `--vscode-scrollbarSlider-activeBackground` | `color-mix(in srgb, var(--agentskin-accent) 52%, transparent)` |

#### 选区 (Selection)

| 原生 Token | 映射值 |
|---|---|
| `--vscode-editor-selectionBackground` | `color-mix(in srgb, var(--agentskin-accent) 18%, transparent)` |
| `--vscode-selection-background` | `color-mix(in srgb, var(--agentskin-accent) 24%, transparent)` |

#### 应用级透明穿透

| 原生 Token | 映射值 |
|---|---|
| `--bg-bg-base-default` | `transparent` |

### Art 层 (背景合成)

```css
html.codedrobe-host-traework #root {
  background:
    linear-gradient(90deg, surface 80%→32%→transparent),  /* 左侧遮罩 */
    linear-gradient(180deg, transparent→surface 76%),      /* 底部渐隐 */
    radial-gradient(120% 80% at 84% 14%, secondary 22%),   /* 右上辉光 */
    var(--codedrobe-art, none) right center / cover;       /* hero 图 */
}
```

### 结构性规则

| 规则 | 说明 |
|---|---|
| 路由透明穿透 | `.panel-container` / `.solo-lite-layout` / `.solo-lite-chat-panel-container` / `[class*="chat-panel/message-list/conversation/main-content/workspace"]` → `background: transparent` |
| 侧栏毛玻璃 | `.task-list-base` / `.task-list-panel` → surface 72% + blur(20px) + accent 32% 右边框 |
| 侧栏项交互 | `[class*="item"]:hover` → accent 12%；`[class*="active"]` → accent 18% + inset 3px accent 左指示条 |
| 输入框 | `.chat-input-v2-input-box-editable` → input-bg + accent 边框 + 14px 圆角；`:focus` → accent 边框 + focus-ring 外发光 + secondary 20% 阴影 |
| 按钮渐变 | `button[class*="send"]` / `.solo-common-button[class*="primary"]` / `.chat-input-v2-send-button` → accent→secondary 135° 渐变 + focus-ring 阴影 + hover brightness(1.07) 上浮 |
| 消息文本 | `[class*="message"]` / `article` → text-shadow 0 1px 2px rgba(0,0,0,0.3) 增强对比 |
| 浮层毛玻璃 | `[role="dialog/menu/tooltip"]` / `.context-view` / `.monaco-hover` / `.quick-input-widget` → surface 94% + blur(20px) + accent 30% 边框 |
| 链接 | `a` → accent 色 |
| 选区色 | `::selection` → `var(--agentskin-selection)` |
| 输入控件 | `input/textarea/select` → input-bg + text + border；`:focus` → accent 边框 + focus-ring 2px |
| 代码块 | `code` / `pre` → code-bg + code-fg + accent 13.2% 边框 + 左侧 3px accent 50% 装饰线；`pre code` 去边框 |
| Markdown 列表 | `article/[class*="message"]` 内 `ol/ul` → outside 定位 + 1.75em padding；`li::marker` → accent 色 + 600 字重 |
| 代码行号 | `.code-line::before` / `[class*="line-number/gutter"]` → muted 色 + 0.7 透明度 |
| 滚动条 | accent→secondary 渐变 thumb，圆角 8px，hover 加深 |
| 减弱动效 | `@media (prefers-reduced-motion: reduce)` → 所有动画/过渡 0.01ms |

## QoderWork CN 探针样式规范 (qoderwork.base.css)

### 选择器策略

作用域：`html.codedrobe-host-qoderwork:root`（特异性 0,2,1），击败 QoderWork 原生 `:root[data-theme]`（0,2,0）。

QoderWork CN 使用 `--color-*` 设计 token 系统（111 个 token），通过 `html[data-theme="light"|"dark"]` 切换明暗。探针在 `:root` 级别覆写全部语义 token，实现全局换肤。

固定语义色（error / info / warning、diff-remove、shadow 系列、highlight 系列、slate/yellow/orange/blue 固定色板）保持硬编码不覆写。

### Token 映射表 (--color-* → --agentskin-*)

#### 主色 / 品牌 (Primary / Brand)

| 原生 Token | 映射值 |
|---|---|
| `--color-primary` | `var(--agentskin-accent)` |
| `--color-primary-hover` | `color-mix(in srgb, var(--agentskin-accent) 85%, #000)` |
| `--color-primary-active` | `color-mix(in srgb, var(--agentskin-accent) 85%, #000)` |
| `--color-primary-bg` | `color-mix(in srgb, var(--agentskin-accent) 8%, transparent)` |
| `--color-primary-bg-hover` | `color-mix(in srgb, var(--agentskin-accent) 14%, transparent)` |
| `--color-primary-border` | `color-mix(in srgb, var(--agentskin-accent) 35%, transparent)` |
| `--color-primary-border-hover` | `color-mix(in srgb, var(--agentskin-accent) 55%, transparent)` |
| `--color-primary-text` | `var(--agentskin-text)` |
| `--color-primary-text-hover` | `color-mix(in srgb, var(--agentskin-accent) 85%, #000)` |
| `--color-primary-text-active` | `color-mix(in srgb, var(--agentskin-accent) 85%, #000)` |
| `--color-text-on-primary` | `#ffffff` |

#### 文本层级 (Text Hierarchy)

| 原生 Token | 映射值 |
|---|---|
| `--color-text` | `var(--agentskin-text)` |
| `--color-text-secondary` | `var(--agentskin-muted)` |
| `--color-text-tertiary` | `color-mix(in srgb, var(--agentskin-text) 55%, transparent)` |
| `--color-text-quaternary` | `color-mix(in srgb, var(--agentskin-text) 40%, transparent)` |
| `--color-text-base` | `var(--agentskin-text)` |
| `--color-muted` | `var(--agentskin-muted)` |
| `--color-muted-foreground` | `color-mix(in srgb, var(--agentskin-muted) 80%, transparent)` |

#### 背景 (Backgrounds)

| 原生 Token | 映射值 |
|---|---|
| `--color-bg-container` | `var(--agentskin-bg)` |
| `--color-bg-elevated` | `var(--agentskin-surface)` |
| `--color-bg-layout` | `var(--agentskin-bg)` |
| `--color-bg-spotlight` | `var(--agentskin-bg)` |
| `--color-bg-base` | `var(--agentskin-bg)` |
| `--color-bg-mask` | `rgba(44, 40, 80, 0.4)` |
| `--color-bg-highlight` | `color-mix(in srgb, var(--agentskin-accent) 6%, transparent)` |
| `--color-bg-highlight-hover` | `color-mix(in srgb, var(--agentskin-accent) 10%, transparent)` |
| `--color-background` | `var(--color-bg-container)` |
| `--color-popover` | `var(--agentskin-surface)` |
| `--color-white-opacity` | `rgba(255, 255, 255, 0.9)` |
| `--color-black-opacity` | `rgba(0, 0, 0, 0.8)` |

#### 边框 (Borders)

| 原生 Token | 映射值 |
|---|---|
| `--color-border` | `var(--agentskin-border)` |
| `--color-border-secondary` | `color-mix(in srgb, var(--agentskin-accent) 13.2%, transparent)` |
| `--color-border-tertiary` | `color-mix(in srgb, var(--agentskin-accent) 7.7%, transparent)` |

#### 填充 (Fills)

| 原生 Token | 映射值 |
|---|---|
| `--color-fill` | `color-mix(in srgb, var(--agentskin-text) 12%, transparent)` |
| `--color-fill-secondary` | `color-mix(in srgb, var(--agentskin-text) 7%, transparent)` |
| `--color-fill-tertiary` | `color-mix(in srgb, var(--agentskin-text) 4%, transparent)` |
| `--color-fill-quaternary` | `color-mix(in srgb, var(--agentskin-text) 2%, transparent)` |
| `--color-fill-disable` | `color-mix(in srgb, var(--agentskin-text) 8%, transparent)` |

#### 链接 / 成功色 (Links / Success)

| 原生 Token | 映射值 |
|---|---|
| `--color-link` | `var(--agentskin-accent)` |
| `--color-success` | `var(--agentskin-accent)` |
| `--color-success-hover` | `color-mix(in srgb, var(--agentskin-accent) 85%, #000)` |
| `--color-success-bg` | `color-mix(in srgb, var(--agentskin-accent) 8%, transparent)` |
| `--color-success-bg-hover` | `color-mix(in srgb, var(--agentskin-accent) 14%, transparent)` |
| `--color-success-border` | `color-mix(in srgb, var(--agentskin-accent) 35%, transparent)` |
| `--color-success-border-hover` | `color-mix(in srgb, var(--agentskin-accent) 55%, transparent)` |

#### Diff

| 原生 Token | 映射值 |
|---|---|
| `--color-diff-insert` | `color-mix(in srgb, var(--agentskin-accent) 70%, transparent)` |
| `--color-diff-insert-bg` | `color-mix(in srgb, var(--agentskin-accent) 12%, transparent)` |
| `--color-diff-remove` | `#fc6b83`（固定） |
| `--color-diff-remove-bg` | `#e3d1d5`（固定） |

#### 派生色板 (Accent Palette)

| 原生 Token | 映射值 |
|---|---|
| `--color-pink` | `var(--agentskin-secondary)` |
| `--color-pink-bg` | `color-mix(in srgb, var(--agentskin-secondary) 10%, transparent)` |
| `--color-purple` | `color-mix(in srgb, var(--agentskin-accent) 85%, #000)` |
| `--color-purple-bg` | `color-mix(in srgb, var(--agentskin-accent) 8%, transparent)` |
| `--color-teal` | `color-mix(in srgb, var(--agentskin-accent) 85%, #000)` |
| `--color-teal-bg` | `color-mix(in srgb, var(--agentskin-accent) 8%, transparent)` |
| `--color-mauve` | `color-mix(in srgb, var(--agentskin-muted) 70%, transparent)` |
| `--color-mauve-bg` | `color-mix(in srgb, var(--agentskin-muted) 6%, transparent)` |
| `--color-lavender-bg` | `color-mix(in srgb, var(--agentskin-secondary) 8%, transparent)` |
| `--color-sage` | `color-mix(in srgb, var(--agentskin-accent) 85%, #000)` |
| `--color-sage-bg` | `color-mix(in srgb, var(--agentskin-accent) 6%, transparent)` |

#### 布局透明穿透 (Layout Tokens)

| 原生 Token | 映射值 |
|---|---|
| `--agents-layout-bg` | `transparent` |
| `--agents-content-area-bg` | `transparent` |
| `--agents-fade-bg` | `transparent` |
| `--agents-content-area-gap` | `4px` |
| `--agents-content-area-radius` | `6px` |
| `--settings-nav-row-selected-bg` | `var(--color-fill-secondary)` |

#### 聊天输入框 (Chat Input Parchment)

| 原生 Token | 映射值 |
|---|---|
| `--chat-input-parchment-edge` | `var(--agentskin-accent)` |
| `--chat-input-parchment-glow` | `var(--agentskin-secondary)` |
| `--chat-input-parchment-halo` | `color-mix(in srgb, var(--agentskin-accent) 40%, transparent)` |

### Art 层 (背景合成)

```css
html.codedrobe-host-qoderwork #root {
  background:
    linear-gradient(90deg, surface 80%→32%→transparent),  /* 左侧遮罩 */
    linear-gradient(180deg, transparent→surface 76%),      /* 底部渐隐 */
    radial-gradient(120% 80% at 84% 14%, secondary 22%),   /* 右上辉光 */
    var(--codedrobe-art, none) right center / cover;       /* hero 图 */
}
```

### 结构性规则

| 规则 | 说明 |
|---|---|
| 布局壳透明穿透 | `.agents-layout-root` / `.agents-layout-body` / `.agents-content-area` / `[class*="agents-content/chat-panel/message-list/conversation-panel/workspace-panel"]` / `[data-resizable-sidebar]:not(.agents-sidebar)` → `background: transparent` |
| 侧栏毛玻璃 | `.agents-sidebar` → surface 72% + blur(20px) + accent 32% 右边框 |
| 侧栏项交互 | `[class*="item"]:hover` → primary-bg-hover；`[class*="active"]` → primary-bg-hover + inset 3px primary 左指示条 + primary-border 内描边 |
| 输入焦点环 | `.chat-input-editor-text:focus/:focus-within` → primary 边框 + primary-bg-hover 3px 外发光 + secondary 20% 阴影 |
| 滚动条 | accent→secondary 渐变 thumb，圆角 8px，2px 透明边框 + padding-box 裁切，hover 加深 |
| 减弱动效 | `@media (prefers-reduced-motion: reduce)` → 所有动画/过渡 0.01ms |
