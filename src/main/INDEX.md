# main — 主进程服务

## 用途
Electron 主进程入口，承载所有后端服务：CDP 注入、应用发现、主题渲染、壁纸注入、IPC 桥接、场景解析、MCP 服务器、视觉分析管线等。

## 结构

### 根目录（核心服务文件）

| 路径 | 用途 | 消费者 | 内部依赖 | 相关文档 |
|------|------|--------|---------|---------|
| `agent-engine-service.ts` | Agent 引擎门面（Facade），编排 apply/restore 生命周期，持有 EpochManager + 并发锁 | `boot-sequence`, `ipc/*`, 测试文件 | `agent-engine/delegates`, `app-discovery`, `cdp/*`, `epoch-manager`, `palette-builder`, `scheme-sync`, `services/*`, `theme-apply-flow`, `theme-restore-flow`, `wallpaper/*` | — |
| `agent-scheme.ts` | Agent 内部 light/dark scheme 同步原语（captureScheme / applyScheme / restoreScheme） | `scheme-sync`, `theme-apply-flow`, `theme-restore-flow` | `cdp/cdp-client` | — |
| `app-discovery.ts` | 应用发现与端口解析（resolveLivePort / ensureCdpReady / probeAppStatus） | `agent-engine-service`, `cdp/cdp-ready`, `theme-apply-flow` | `install-detection`, `services/contracts` | — |
| `app-discovery-enhanced.ts` | 多平台安装路径注册表 + 扫描器（quick/deep 策略） | IPC 层调用 | 仅 shared/types | — |
| `audio-level.ts` | 系统音频电平检测（PowerShell CoreAudio COM） | `agent-engine-service` | 无 | — |
| `boot-profiler.ts` | 启动性能埋点（每阶段耗时记录） | `boot-sequence` | 无 | — |
| `boot-progress.ts` | 启动进度基线（持久化每步耗时，下次启动用 EMA 权重） | `boot-sequence` | 无 | — |
| `boot-reporter.ts` | 启动进度报告器（平滑插值动画引擎） | `boot-sequence` | 无 | — |
| `boot-sequence.ts` | 启动序列编排，控制从 splash 到首屏的完整初始化顺序 | `main.ts`（Electron 入口） | `agent-engine-service`, `boot-profiler`, `boot-progress`, `boot-reporter`, `catalog/*`, `deep-link-handler`, `ipc`, `locale-preferences`, `logger`, `main-context`, `scene-renderer-async`, `services/*`, `settings-service`, `theme-library`, `tray-manager`, `wallpaper/*`, `warm-up/index` | — |
| `deep-link-handler.ts` | OS 级 `agentskin://` 深度链接路由（apply/restore/install/open） | `boot-sequence` | `deep-link-manager`, `main-context` | — |
| `deep-link-manager.ts` | 深度链接队列管理（boot 前缓冲，boot 后 flush） | `deep-link-handler`, `boot-sequence` | shared/deep-link-commands | — |
| `dom-snapshot.ts` | DOM 结构快照（已废弃，保留为参考实现） | 无活跃消费者 | `cdp/cdp-client`, `cdp/cdp-targets` | — |
| `env-preset-store.ts` | 环境预设持久化（Agent + Theme + Wallpaper 绑定） | `ipc/environment-ipc` | 无 | — |
| `epoch-manager.ts` | 每 Agent 单调递增纪元号，用于并发操作的取消守卫 | `agent-engine-service`, `scheme-sync`, `cdp-fanout` | 无 | — |
| `file-open.ts` | 文件打开服务（"打开方式"请求队列） | `agent-engine-service`, `boot-sequence` | 无 | — |
| `fs-utils.ts` | 原子写入工具（tmp → fsync → rename → dir-fsync 四步协议） | `agent-engine-service`, `settings-service`, `locale-preferences`（15+） | 无 | — |
| `install-detection.ts` | Agent 安装检测（文件系统路径 + Windows 注册表） | `app-discovery` | `fs-utils` | — |
| `locale-preferences.ts` | 语言偏好持久化 | `boot-sequence`, `window-manager` | `fs-utils` | — |
| `logger.ts` | 统一日志门面（文件日志 + IPC 上报 + 缓冲） | 几乎所有主进程模块（30+） | 无 | — |
| `lz4-decoder.ts` | 纯 JS LZ4 块格式解压器（解压场景 TEX 纹理） | 场景解析管线 | 无 | — |
| `main-context.ts` | 主进程运行时上下文单例（ctx），聚合所有服务实例 | 几乎所有主进程模块（25+） | `catalog/*`, `file-open`, `services/contracts` | — |
| `palette-builder.ts` | 调色板构建桶（barrel），实现在 `palette/` 子目录 | `agent-engine-service`, `agent-engine/delegates` | `palette/generator`, `palette/orchestrator` | — |
| `palette-extractor.ts` | 自动调色板提取引擎（median-cut 量化 → 14-token 色板） | `theme-from-image` | `profile/color-quantize` | — |
| `scene-pkg-parser.ts` | 场景 PKG 解析桶（barrel），实现在 `scene/` 子目录 | `scene-renderer-html`, `scene-renderer-worker` | `scene/pkg-parser`, `scene/tex-parser`, `scene/scene-json-parser` | — |
| `scene-renderer-async.ts` | 异步场景渲染（Worker Pool，避免重复创建开销） | `boot-sequence`, `wallpaper/media-registry` | `scene-renderer-worker`, `scene-renderer-types` | — |
| `scene-renderer-capability.ts` | 壁纸渲染能力检测（L1/L2/L3 tier 判定） | `wallpaper/media-registry` | 无 | — |
| `scene-renderer-coords.ts` | 场景渲染坐标计算（粒子/图层定位数学） | `scene-renderer-html`, `scene-renderer-worker` | 无 | — |
| `scene-renderer-html.ts` | 场景 HTML 渲染器（将 scene.pkg 转为自包含 HTML 页面） | `scene-renderer-worker`, `scene-renderer-async` | `scene-pkg-parser`, `scene-renderer-layers`, `scene-renderer-coords`, `scene-renderer-html-scripts`, `scene-renderer-types` | — |
| `scene-renderer-html-scripts.ts` | 场景 HTML 内联脚本生成（粒子模拟、动画循环） | `scene-renderer-html` | 无 | — |
| `scene-renderer-layers.ts` | 场景图层合成（z-index 排序、混合模式） | `scene-renderer-html`, `scene-renderer-worker` | 无 | — |
| `scene-renderer-particles.ts` | 粒子系统渲染（Canvas 2D 粒子模拟） | `scene-renderer-html` | 无 | — |
| `scene-renderer-types.ts` | 场景渲染共享类型定义 | `scene-renderer-html`, `scene-renderer-worker`, `scene-renderer-async` | 无 | — |
| `scene-renderer-worker.ts` | Worker 线程入口（CPU 密集场景解析移出主进程） | `scene-renderer-async` | `scene-pkg-parser`, `scene-renderer-html`, `scene-renderer-layers`, `scene-renderer-types` | — |
| `scheme-sync.ts` | Scheme 同步编排（syncSchemeWithStability / restoreOriginalScheme） | `agent-engine-service`, `agent-engine/delegates` | `agent-scheme`, `cdp/cdp-client`, `services/contracts` | — |
| `settings-service.ts` | 用户设置持久化（读写 settings.json，管理主题/壁纸/自定义 CSS） | `boot-sequence`, `main-context` | `fs-utils`, `ipc/ipc-validators`, `services/contracts` | — |
| `steam-path-resolver.ts` | Steam + Wallpaper Engine 安装路径解析 | `wallpaper/adapter` | shared/exec-async | — |
| `theme-apply-flow.ts` | 主题应用流程编排（CDP 发现 → adapter.applyTheme → 持久化 → 后续联动） | `agent-engine-service`, 测试文件 | `agent-scheme`, `app-discovery`, `catalog/theme-manifest`, `cdp/apply-baseline`, `cdp/cdp-ready`, `services/contracts`, `theme-library` | — |
| `theme-health-check.ts` | 注入后 DOM 健康检查（探测不透明背景遮挡 hero art） | 被 cdp-fanout 调用 | `cdp/cdp-client` | — |
| `theme-hot-reload.ts` | 主题热重载通知（apply 完成后推送到 renderer 窗口） | `agent-engine-service` | 仅 shared/types | — |
| `theme-library.ts` | 主题库向后兼容桶（barrel），实现在 `theme/store.ts` | `agent-engine-service`, `boot-sequence`, `wallpaper-injector` | `theme/scheme`, `theme/store`, `theme/utils` | — |
| `theme-restore-flow.ts` | 主题恢复流程编排（并发守卫 → CDP 端口 → 移除注入 → 恢复原始 scheme） | `agent-engine-service`, 测试文件 | `agent-scheme`, `services/contracts` | — |
| `tray-manager.ts` | 系统托盘图标与上下文菜单 | `boot-sequence` | `main-context` | — |
| `wallpaper-injector.ts` | 壁纸注入编排核心（injectAgentWallpaper / injectWithFallback / applyWallpaperToAgent）；自愈桩 `recordInjectionFailure` / `recordInjectionSuccess` 由 pipeline retry 策略替代自愈状态机 | `agent-engine-service`, `wallpaper-lifecycle` | `cdp/cdp-client`, `cdp/cdp-ready`, `cdp/cdp-wallpaper-inject`, `config/settings`, `theme-library` | — |
| `wallpaper-lifecycle.ts` | 壁纸生命周期控制（系统电源事件 → 暂停/恢复 agent 内视频壁纸） | `boot-sequence` | `cdp/cdp-client`, `wallpaper-injector` | — |
| `wallpaper-server.ts` | 本地 HTTP 媒体服务器，流式传输壁纸视频/图片到 agent 页面 | `boot-sequence`, `wallpaper-injector`, `wallpaper/media-registry` | 无（纯 Node.js http） | — |
| `wallpaper-service.ts` | 壁纸服务向后兼容桶（barrel），实际实现在 `wallpaper/adapter.ts` | `boot-sequence`, `main-context` | `wallpaper/adapter`, `wallpaper/utils` | — |
| `window-manager.ts` | 主窗口生命周期（创建/定位/隐藏/关闭到托盘）+ Studio 窗口管理 | `boot-sequence`, `ipc/index` | `ipc/trusted-sender`, `locale-preferences`, `main-context` | — |

### cdp/ — CDP 客户端与注入引擎

| 路径 | 用途 | 消费者 | 内部依赖 | 相关文档 |
|------|------|--------|---------|---------|
| `apply-baseline.ts` | 基线快照缓存（LRU + TTL），主题切换快速路径复用已验证 DOM 状态 | `cdp-fanout`, `agent-engine-service` | `cdp/injection/shared`, shared/errors | RFC §4.5/§4.6 |
| `baseline-css-capture.ts` | CSS 规则级基准采集（保存原生主题原始 CSS 规则文本） | `baseline-validator`, `baseline-css-replay` | `cdp/cdp-client`, `node-cascade` | RFC §6 |
| `baseline-css-replay.ts` | 原生基准 CSS 精确回注（ΔE→0 复刻应用原生亮/暗主题） | `baseline-validator` | `cdp/injection/shared`, `baseline-css-capture` | RFC §6 |
| `baseline-gate.ts` | 复刻校验 Gate（自定义主题加载前的前置闸门） | `agent-engine-service` | `baseline-validator`, `baseline-css-replay` | RFC §6 |
| `baseline-validator.ts` | 原生基准复刻校验器（还原度匹配，失败触发降级） | `baseline-gate` | `baseline-css-capture`, `baseline-css-replay` | RFC §6 |
| `cdp-client.ts` | CDP WebSocket 会话核心（connectCdp / connectEventCdp 双入口） | 20+ 文件（cdp/ 子模块、agent-engine-service、scheme-sync、wallpaper-injector） | shared/errors | — |
| `cdp-fanout.ts` | 多目标 CDP 分发（遍历所有 DOM-bearing 目标：page/webview/iframe） | `agent-engine-service`, `agent-engine/delegates`, `apply-baseline` | `cdp/cdp-client`, `cdp/cdp-targets`, `cdp/cdp-inject`, `cdp/session-pool` | — |
| `cdp-fingerprint.ts` | CDP 指纹采集助手（P3 自愈循环的指纹捕获步骤） | 自愈管线 | `cdp/cdp-client`, shared/ipc-channels | — |
| `cdp-inject.ts` | 主题注入策略桶（barrel），实现在 `cdp/injection/` 子目录 | `cdp-fanout`, `agent-engine-service` | `cdp/injection/*` | — |
| `cdp-ready.ts` | 统一 Agent CDP 就绪探测（主题 + 壁纸 apply 共用） | `agent-engine-service`, `theme-apply-flow`, `wallpaper-injector` | `app-discovery` | — |
| `cdp-targets.ts` | CDP 目标发现与分类过滤（page/webview/iframe 三策略） | `cdp-fanout`, `apply-baseline`, `dom-snapshot`, `agent-engine/delegates` | legacy/agentskin-core-runtime | — |
| `cdp-wallpaper-inject.ts` | CDP 壁纸注入边界层（chunked transfer、transport retry、MIME 检测），页面侧逻辑由 `engines/unified/engine.mjs §10` 承载 | `wallpaper-injector` | `engines/unified/engine.mjs §10` | — |
| `css-service.ts` | CDP CSS 域封装（读取 agent 样式表元数据 + 文本内容） | Studio CSS 源编辑器 | `cdp/cdp-client` | — |
| `dom-tree.ts` | 真实 DOM 子树全量捕获（序列化树 + computed-style + 内联图片） | Studio 预览 | `cdp/cdp-client` | — |
| `hard-watchdog.ts` | Worker 线程硬看门狗（免疫主线程 busy-loop） | 独立运行 | 无 | docs/watchdog-postmortem.md |
| `inspect-session.ts` | DevTools 风格实时元素选择器（Overlay.inspectNodeRequested） | Studio 检查面板 | `cdp/cdp-client`, `node-cascade` | — |
| `landmark-preflight.ts` | 注入前 DOM 锚点预检（验证目标页面有所需 landmark） | `engine-strategy`, `cdp-fanout` | `cdp/cdp-client` | — |
| `markdown-injector.ts` | Markdown 运行时样式注入（通过 CDP 插入 style 标签） | Studio | `cdp/cdp-client` | — |
| `node-cascade.ts` | DevTools 级单节点探针（CSS.getMatchedStylesForNode + 盒模型） | `snapshot-theme`, `inspect-session`, `baseline-css-capture` | `cdp/cdp-client` | — |
| `port-config.ts` | 每适配器首选 CDP 端口配置（9222-9227 + 回退范围） | `port-resolver` | 无 | — |
| `port-lease-pool.ts` | 固定端口池 + 文件系统原子锁（mkdir 互斥） | `port-resolver` | 无 | — |
| `port-resolver.ts` | CDP 端口可用性检测 + 自动递增 + 租约管理 | `app-discovery`, `electron-launcher` | `port-config`, `port-lease-pool` | — |
| `reload-watchdog.ts` | 页面重载守护（Page.loadEventFired → 重新注入丢失的 adoptedStyleSheets） | `cdp-fanout/hardeningPass` | `cdp/cdp-client`, `cdp/injection/engine-strategy` | RFC 2026-08-18 P3 |
| `renderer-fingerprint.ts` | 多渲染器指纹（适配器 primaryHints/secondaryHints 三档匹配） | `cdp-fanout`, `renderer-rank` | 无 | — |
| `renderer-guardian.ts` | CDP 渲染器稳定检测 + 自动重注入 + 健康检查 | `agent-engine-service` | `cdp/cdp-client`, `cdp/cdp-targets` | — |
| `renderer-rank.ts` | 主渲染器语义锚点判定（多 page target 时确定主窗口） | `cdp-fanout` | 无 | RFC 2026-08-18 P0 |
| `secondary-inject.ts` | 轻量 CSS-only 注入（webview/iframe 等非 page 目标） | `cdp-fanout` | `cdp/cdp-client`, shared/injection-constants | — |
| `selector-validator.ts` | CDP 选择器验证服务（语法检查 + 命中计数 + 边界框） | `theme-asset/verify/probe`, Studio | `cdp/cdp-client` | — |
| `session-pool.ts` | CDP 会话池（per-agent per-target 复用 + epoch 绑定 + 引用计数） | `cdp-fanout`, `apply-baseline`, `cdp-inject`, `agent-engine-service` | `cdp/cdp-client` | — |
| `snapshot-theme.ts` | DevTools 级 DOM 视觉探针（landmark 选择器 → 完整级联捕获） | Studio 快照 | `cdp/cdp-client`, `node-cascade` | — |
| `surface-rect.ts` | 宿主坐标几何的 CDP 读取能力 | `wallpaper/unified-background` | `cdp/cdp-client`, shared/surface-rect | RFC 2026-08-21 |
| `watchdog.ts` | 三层看门狗（CPU 滞缓检测 + 孤儿超时 + 僵尸清理） | 独立运行 | 无 | — |

### cdp/injection/ — 注入策略

| 路径 | 用途 | 消费者 | 内部依赖 | 相关文档 |
|------|------|--------|---------|---------|
| `engine-strategy.ts` | 多层引擎主题注入（L0-L4：palette + tokens + cosmetic + theme + adapter.mjs） | `cdp-fanout`, `reload-watchdog` | `cdp/cdp-client`, `landmark-preflight`, `cdp/injection/shared` | — |
| `cdp-strategy.ts` | 轻量主题注入（adoptedStyleSheets + hero blob，hardening pass） | `cdp-inject` | `cdp/cdp-client`, `cdp/injection/shared` | — |
| `css-inject.ts` | CSS 注入助手（adoptedStyleSheets 无名/命名层变体） | `cdp-strategy`, `engine-strategy` | `cdp/cdp-client`, shared/injection-runtime | — |
| `hero-inject.ts` | 图片注入助手（hero + multi-asset → Blob URL，绕过 file:// CSP） | `cdp-strategy`, `engine-strategy` | `cdp/cdp-client`, shared/injection-constants | — |
| `shared.ts` | 注入策略桶（barrel）+ 验证/延迟辅助函数 | `engine-strategy`, `cdp-strategy`, `apply-baseline`, `agent-engine/delegates` | shared/injection-runtime, shared/errors | — |
| `types.ts` | 注入策略共享类型（ThemeVerification 接口） | `shared.ts`, `engine-strategy`, `cdp-strategy` | 无 | — |

### cdp/wallpaper/ — 已删除（2026-08）

壁纸注入器子模块（`image-injector`, `video-injector`, `web-injector`, `css-render`,
`shared`, `constants`）已合并入 `engines/unified/engine.mjs` §10 与统一的
`cdp-wallpaper-inject.ts` 桶模块。合并后:

- 页面侧挂载/移除逻辑（video、img、iframe 元素构建、CSS 过滤器、对齐）:
  由 `engines/unified/engine.mjs` §10 `NS.wallpaper.*` 承载。
- CDP 边界层（Page.setBypassCSP、chunked transfer、transport retry、MIME 检测）:
  保留在 `cdp-wallpaper-inject.ts`，并以 `window.__agentskin__.wallpaper.apply*(…)` 的单次 evaluate 调用替代原来的 200 行内联脚本。
- 单元测试迁移: `render-css.test.ts` 移除（CSS 渲染器与 `shared/wallpaper-render.ts` 重合）；`cdp/cdp-wallpaper-inject.test.ts` 更新为新的 chunked-transfer + engine-mount 验证。

### ipc/ — IPC 处理器

| 路径 | 用途 | 消费者 | 内部依赖 | 相关文档 |
|------|------|--------|---------|---------|
| `index.ts` | IPC 注册聚合器（按序调用所有 register*Ipc） | `boot-sequence` | 所有 register*Ipc 函数 | — |
| `core-ipc.ts` | 跨域 IPC（app bootstrap / locale / system status / agent list / shell） | `ipc/index` | `main-context`, shared/i18n, shared/ipc-channels | — |
| `theme-ipc.ts` | 主题 IPC（catalog CRUD / apply/restore / package import/export/delete） | `ipc/index` | `main-context`, `catalog/*`, `agent-engine-service` | — |
| `wallpaper-ipc.ts` | 壁纸 IPC（list/import/delete media / set preference / apply/remove） | `ipc/index` | `main-context`, `wallpaper/*`, `theme-from-image` | — |
| `settings-ipc.ts` | 设置 IPC（get settings / pick install path / CDP port override） | `ipc/index` | `main-context`, `settings-service`, shared/safe-css | — |
| `studio-ipc.ts` | Studio IPC（snapshot / export / live inspect / probe） | `ipc/index` | `main-context`, `cdp/snapshot-theme`, `inspect-session` | — |
| `studio-project-ipc.ts` | Studio 工程 IPC（独立主题工程 CRUD） | `ipc/index` | `main-context` | — |
| `studio-templates-ipc.ts` | Studio 模板 IPC（模板列表 + 详情查询） | `ipc/index` | `profile/studio-theme-templates` | — |
| `studio-workspace-ipc.ts` | Studio 工作台 IPC（image→theme + wallpaper picker） | `ipc/index` | `theme-from-image`, `wallpaper/*` | — |
| `environment-ipc.ts` | 环境预设 IPC（main 进程持久化 env-presets.json） | `ipc/index` | `env-preset-store` | — |
| `electron-ipc.ts` | 应用快速启动 IPC（扫描本地 Electron 应用 + 启动） | `ipc/index` | `electron-scanner`, `electron-launcher` | — |
| `mcp-ipc.ts` | MCP IPC（get server status / start/stop HTTP server） | `ipc/index` | `mcp/mcp-server`, `mcp/context` | — |
| `visual-analyzer-ipc.ts` | 视觉分析 IPC（LIST/GET/EXPORT_THEME/DETECT） | `ipc/index` | `profile/*`, `catalog/*` | — |
| `window-ipc.ts` | 窗口控制 IPC（minimize/maximize/close/is-maximized） | `ipc/index` | Electron BrowserWindow | — |
| `bundle-ipc.ts` | 组合包 IPC（.agentskin-bundle 创建/安装） | `ipc/index` | `fs/tar-pack`, `catalog/*` | — |
| `community-theme-ipc.ts` | 社区主题 IPC（DreamSkin list/get/download/cancel） | `ipc/index` | `community/*` | — |
| `concurrency-metrics-ipc.ts` | 并发指标 IPC（main → renderer 5s 周期推送） | `ipc/index` | `agent-engine-service` | — |
| `coordinator-ipc.ts` | 运行时状态协调器 IPC（status push + snapshot/query） | `ipc/index` | `services/app-run-state-coordinator` | — |
| `native-profile-ipc.ts` | 原生档案 IPC（DomTreeNode → 摘要） | `ipc/index` | `profile/native-profile` | — |
| `performance-ipc.ts` | 性能诊断 IPC（read trace + push new trace） | `ipc/index` | `services/performance/*` | — |
| `theme-asset-ipc.ts` | 主题资源 IPC（convert + list adapters） | `ipc/index` | `theme-asset/index` | — |
| `transform-ledger-ipc.ts` | 变换台账 + 覆盖存储 IPC | `ipc/index` | `profile/transform-ledger`, `profile/overrides-store` | — |
| `treatment-classifier-ipc.ts` | 处置分类器 IPC | `ipc/index` | `profile/treatment-classifier` | — |
| `ipc-validators.ts` | IPC 参数验证助手（统一错误语义 + 本地化） | `core-ipc`, `theme-ipc`, `wallpaper-ipc`, `settings-ipc` | shared/i18n | — |
| `trusted-sender.ts` | 可信发送者守卫（记录主窗口 webContents.id） | `bundle-ipc`, `window-manager` | 无 | — |
| `with-monitored-timeout.ts` | 超时监控包装器（记录超时事件到 PerformanceLogger） | 多个 IPC 处理器 | shared/withTimeout, `services/performance/performance-logger` | — |
| `asar-ipc.ts` | ASAR 解包 IPC（discover / extract / scan / read-file）；扫描复用 `asar-architecture` 的源码遍历 | `ipc/index` | @electron/asar, shared/asar-architecture, `asar-architecture` | — |
| `asar-architecture.ts` | ASAR 架构剖析器：源码遍历（单一真源）+ 入口角色、依赖图（ESM/AMD/CJS/script）、CSP 强度、CDP 多页面面、token 命名空间 | `asar-ipc`, `asar-architecture.test` | shared/asar-architecture | — |
| `asar-cdp-bridge.ts` | 联合分析的 CDP 桥接层（唯一触碰 socket 的模块）：端口探测 → target 枚举 → WebSocket 连接 | `ipc/index` | `cdp/port-config`, `cdp/cdp-targets`, `cdp/cdp-fanout`, shared/cdp-discovery | — |
| `asar-joint-analysis.ts` | ASAR 静态 + CDP 动态联合分析编排：会话获取（targetKeyFor + 会话池）、landmark 预检、锚点探测、多页面覆盖率、健康分与注入就绪评估 | `ipc/index` | `cdp/landmark-preflight`, `cdp/selector-validator`, `cdp/renderer-rank`, `cdp/renderer-fingerprint`, `cdp/session-pool`, `asar-ipc`, shared/asar-architecture | — |

### services/ — 核心服务

| 路径 | 用途 | 消费者 | 内部依赖 | 相关文档 |
|------|------|--------|---------|---------|
| `contracts.ts` | 服务契约接口定义（ThemeLibraryApi / SettingsServiceApi / WallpaperServiceApi） | 20+ 文件（agent-engine-service、ipc/、catalog/、theme/、wallpaper/） | 无 | — |
| `agent-engine-options.ts` | 壁纸渲染选项合并（per-agent → global → theme 优先级链） | `agent-engine-service` | shared/types | — |
| `agent-engine-persist.ts` | 持久化序列化链 + 状态形状契约（PersistChain FIFO 队列） | `agent-engine-service` | `fs-utils` | — |
| `agent-engine-registry.ts` | AgentEngineService 可变状态容器（per-agent 持久化状态） | `agent-engine-service` | 无 | — |
| `app-icon.ts` | 应用图标提取（PE RT_ICON → PNG data URL） | `electron-scanner` | Electron nativeImage | — |
| `app-run-state-coordinator.ts` | 运行时状态协调器（running/debugReady/pid/port 统一管理） | `ipc/coordinator-ipc` | 无 | — |
| `electron-launcher.ts` | 快速应用启动器（adapted → 附加 --remote-debugging-port） | `ipc/electron-ipc` | `port-resolver`, `cdp/port-config` | — |
| `electron-scanner.ts` | 三层 Windows 扫描器（known agents + registry + filesystem） | `ipc/electron-ipc` | `services/scanner/*`, `install-detection` | — |
| `persistent-cdp-manager.ts` | 持久 CDP 端口管理（.lnk 快捷方式 / macOS launchd 注入） | `agent-engine-service` | 无 | — |
| `theme-bundle.ts` | 主题包契约接口（ThemeBundle 结构定义） | agent-engine-service、catalog/、cdp/、ipc/ | shared/types | — |
| `tweak-injector.ts` | 实时预览桥接（Workbench Live Tweak → CDP injectCssLayer） | `ipc/settings-ipc`, Studio | `cdp/cdp-client`, shared/safe-css | — |

### services/performance/ — 性能追踪

| 路径 | 用途 | 消费者 | 内部依赖 | 相关文档 |
|------|------|--------|---------|---------|
| `index.ts` | 性能追踪桶（barrel） | 外部消费者 | `performance-logger`, `performance-recorder` | — |
| `performance-logger.ts` | 内存环形缓冲区 + 聚合统计 + 内存采样器 | `ipc/performance-ipc`, `ipc/with-monitored-timeout` | shared/types | — |
| `performance-recorder.ts` | 高分辨率计时器（process.hrtime.bigint() → 分步 trace） | `agent-engine-service`, `theme-apply-flow`, `theme-restore-flow`, `cdp-client` | 无 | — |
| `types.ts` | 性能追踪类型（ThemeApplyTrace / PerformanceStep） | `performance-logger`, `performance-recorder` | 无 | — |

### services/scanner/ — 应用扫描器

| 路径 | 用途 | 消费者 | 内部依赖 | 相关文档 |
|------|------|--------|---------|---------|
| `index.ts` | 扫描器桶（barrel） | `electron-scanner` | `scanner/*` | — |
| `flags.ts` | 扫描管线版本开关（v1/v2） | `electron-scanner` | 无 | — |
| `probes.ts` | 适配器探针快照（6 个适配器的 identity + installHints） | `collectors/knownAgent`, `pipeline/match` | adapters/*, shared/types | — |
| `types.ts` | 扫描器共享类型（ScanCache / ElectronMarker / ScanRoot） | scanner 子模块 | shared/types | — |
| `util.ts` | 扫描器工具函数（hashPath / nameFromExe） | collectors/*, pipeline/* | 无 | — |
| `collectors/filesystem.ts` | 文件系统扫描（遍历 Program Files / AppData 根目录） | `electron-scanner` | `infra/ps`, `pipeline/match`, `util` | — |
| `collectors/knownAgent.ts` | 已知 Agent 扫描（委托 detectInstallation） | `electron-scanner` | `install-detection`, `infra/ps`, `probes` | — |
| `collectors/registry.ts` | 注册表扫描（HKLM Uninstall → app.asar 检测） | `electron-scanner` | `infra/ps`, `pipeline/match`, `util` | — |
| `collectors/shared.ts` | 采集器共享工具（辅助 exe 过滤 / findAnyExe） | `filesystem`, `knownAgent`, `registry` | 无 | — |
| `infra/cache.ts` | 内存扫描缓存（5 分钟 TTL） | `electron-scanner` | `types` | — |
| `infra/concurrency.ts` | PowerShell 子进程并发池（FIFO cap 8） | `ps`, `collectors/registry` | 无 | — |
| `infra/persist-cache.ts` | 跨会话持久扫描缓存（userData/scan-cache.json） | `electron-scanner` | `fs-utils` | — |
| `infra/ps.ts` | PowerShell PE 版本信息读取（readExeInfo） | collectors/*, `pipeline/match` | shared/exec-async | — |
| `infra/validate.ts` | 存在性验证（fs.access 检查缓存 exePath 是否仍存在） | `electron-scanner` | 无 | — |
| `pipeline/match.ts` | 适配器匹配评分（whole-word / whole-phrase 匹配） | collectors/* | shared/app-identity, `probes` | — |
| `pipeline/merge.ts` | 身份基多版本合并（v2：归一化 productName + 最高版本） | `electron-scanner` | shared/app-identity | — |
| `pipeline/stream-merge.ts` | 流式身份合并（扫描回调实时去重） | `electron-scanner` | shared/app-identity | — |

### theme-asset/ — 主题资产生成引擎

| 路径 | 用途 | 消费者 | 内部依赖 | 相关文档 |
|------|------|--------|---------|---------|
| `index.ts` | 主题资源引擎编排器入口（convert() → detect→parse→infer→adapt→deepen→enhance→verify） | `ipc/theme-asset-ipc` | `pipeline`, `ir/*` | — |
| `pipeline.ts` | 管线编排器（7 阶段顺序 + 错误边界） | `index` | `ir/*`, `adapt/*`, `bridge/*`, `deepen/*`, `enhance/*`, `verify/*` | — |
| `detect.ts` | 格式嗅探（根据文件名推断 codedrobe/legacy-codex/vscode-json/raw-css） | `pipeline` | `ir/types`, `ir/errors` | — |
| `fingerprint.ts` | 自愈循环指纹模块（apply-time 指纹采集 + 漂移检测 + 延迟再生） | 自愈管线 | `deferred-regen`, shared/types | RFC 2026-08-20 |
| `deferred-regen.ts` | 延迟再生协调器（agent 应用中以渐进退避排队，否则立即派发） | `fingerprint` | shared/types | RFC 2026-08-20 §8 |
| `adapt/registry.ts` | 适配器注册表（AgentId → coreId 映射） | `adapt/toGeneratorInput`, `deepen` | shared/types | — |
| `adapt/toGeneratorInput.ts` | 适配器结果 → 生成器输入转换 | `pipeline` | `ir/types`, `adapt/registry`, scripts/generators/* | — |
| `adapters/index.ts` | 适配器桶（register + 优先级排序 + 5MB 输入上限） | `pipeline` | `codedrobe`, `legacy-codex`, `raw-css`, `vscode-json` | — |
| `adapters/codedrobe.ts` | CodeDrobe .codedrobe-theme 多端包适配器 | `adapters/index` | `ir/*` | — |
| `adapters/legacy-codex.ts` | .codex-theme 单文件 JSON 适配器 | `adapters/index` | `ir/*` | — |
| `adapters/raw-css.ts` | 裸 CSS 适配器（css-extract → 颜色 token 化 → 语义聚类） | `adapters/index` | `ir/*` | — |
| `adapters/vscode-json.ts` | VS Code 主题 JSON 适配器（workbench.colors → 14-token 映射） | `adapters/index` | `ir/*` | — |
| `bridge/index.ts` | 桥接层桶（re-export native-defect + structural-template） | `deepen`, `enhance` | `native-defect`, `structural-template` | — |
| `bridge/native-defect.ts` | 原生缺陷修正 CSS 调用（委托 scripts/native-defect-fixes.mjs） | `deepen` | scripts/native-defect-fixes.mjs | — |
| `bridge/structural-template.ts` | 结构模板提取（从 engines/<agent>/adapter.mjs 提取 STRUCTURAL_CSS） | `enhance` | 无 | — |
| `deepen/index.ts` | 浅→深增强（为每个 agent CSS 追加 native-defect 修正） | `pipeline` | `bridge/native-defect`, `adapt/registry` | — |
| `enhance/layering.ts` | 层次补全（surface 3 级递进：surface → surfaceElevated → surfaceL1） | `pipeline` | `catalog/theme-manifest` | — |
| `enhance/presets.ts` | 质感预设库（aurora-glass / frosted / minimal） | `pipeline` | `catalog/theme-manifest` | — |
| `infer/palette-infer.ts` | 调色板推导（部分 token → 完整 14-token） | `pipeline` | `ir/normalize` | — |
| `ir/types.ts` | 管线内部类型（AdapterInput / AdapterResult / ThemeAdapter / ThemeColors） | theme-asset 全部子模块 | `catalog/theme-manifest` | — |
| `ir/errors.ts` | 管线错误类型（ThemeAssetError / UnsupportedFormatError / InvalidInputError） | `detect`, `adapters/*` | 无 | — |
| `ir/normalize.ts` | 颜色标准化（部分 token → 完整 14-token，回退 COLOR_FALLBACKS） | `infer/palette-infer`, `adapt/toGeneratorInput` | `ir/types` | — |
| `verify/contract-check.ts` | 离线契约校验（14-token 覆盖率静态检查） | `pipeline` | `ir/normalize` | — |
| `verify/fidelity.ts` | 还原度验证（baseline-validator 评估主题应用还原度） | `pipeline` | `cdp/baseline-validator`, `cdp/baseline-css-capture` | — |
| `verify/probe.ts` | 实时 DOM 探针（validateSelectors 选择器命中验证） | `pipeline` | `cdp/selector-validator` | — |

### catalog/ — 主题目录管理

| 路径 | 用途 | 消费者 | 内部依赖 | 相关文档 |
|------|------|--------|---------|---------|
| `agent-catalog.ts` | Agent 目录（6 个适配器的 capabilities + display metadata） | UI 层 | shared/types | — |
| `theme-catalog.ts` | 主题目录（UI 侧 display model：list/get/search/filter） | `ipc/theme-ipc`, UI 层 | `theme-package-loader`, shared/types | — |
| `theme-installer.ts` | 主题安装器（目录包 → ThemeLibrary 桥接） | `theme-seeder`, `ipc/theme-ipc` | `theme-package-loader`, `theme-manifest` | — |
| `theme-package-loader.ts` | 主题包加载器（themes/<id>/ → InstalledThemePackage + 校验） | `theme-catalog`, `theme-installer` | `manifest-validator`, shared/theme-build-fingerprint | — |
| `theme-seeder.ts` | 内置主题种子器（boot 时 themes/ → ThemeLibrary） | `boot-sequence` | `theme-package-loader`, `theme-installer` | — |
| `theme-manifest.ts` | 主题清单数据模型（v1/v2 manifest 解析 + ThemeColors） | catalog/ 全部模块 | shared/types | THEME_SPEC.md |
| `theme-compatibility.ts` | 主题兼容性解析（manifest.apps > registry > true 级联） | `theme-catalog` | shared/types | — |
| `theme-contract.ts` | 14-token 契约守卫（运行时安全校验） | `theme-catalog`, `theme-installer` | `theme-manifest` | THEME_SPEC.md |
| `theme-import-export.ts` | ZIP 导入校验 + 导出（yauzl 读 + node:zlib 写） | `ipc/theme-ipc` | `manifest-validator`, shared/safe-css | — |
| `theme-metadata.ts` | 主题元数据标准化（署名链合规校验） | `theme-package-loader` | `theme-manifest` | — |
| `manifest-validator.ts` | JSON Schema 校验器（draft-07 子集，零依赖） | `theme-package-loader`, `theme-import-export` | `manifest-v2.schema.json` | — |
| `featured-themes.ts` | 精选主题（manifest-level + config-level 双源排序） | `theme-catalog` | 无 | — |
| `types.ts` | 目录层共享类型（AgentCatalogItem / ThemeCatalogItem） | catalog/ 子模块 | shared/types | — |

### wallpaper/ — 壁纸引擎

| 路径 | 用途 | 消费者 | 内部依赖 | 相关文档 |
|------|------|--------|---------|---------|
| `adapter.ts` | 壁纸服务适配器（委托 we/scanner + local/importer + media-registry） | `wallpaper-service` | `we/scanner`, `local/importer`, `media-registry`, `utils` | — |
| `injection-state.ts` | 注入状态跟踪（media token / active wallpaper / fallback 追踪） | `wallpaper-injector` | 无 | — |
| `injector-types.ts` | 壁纸注入器类型定义（纯类型，无运行时导入） | `target-discovery`, `injection-state`, `wallpaper-injector` | 无 | — |
| `media-registry.ts` | 循环 URL + Token 生命周期管理（preview/video/web 三类） | `wallpaper-server`, `adapter` | 无 | — |
| `mutex.ts` | 每 Agent 互斥锁（串行化 apply/remove/fallback 临界区） | `wallpaper-injector` | 无 | — |
| `preview-cache.ts` | 三级渐进预览加载（L0 metadata / L1 1920px / L2 original） | UI 层 | Electron nativeImage | — |
| `target-discovery.ts` | CDP 目标解析 + 就绪轮询（HTTP vs base64 阈值决策） | `wallpaper-injector` | `cdp/cdp-targets`, `cdp/cdp-ready` | — |
| `theme-wallpaper.ts` | 运行期主题壁纸注册（theme.wallpaper.video → WallpaperService） | `boot-sequence`, `ipc/wallpaper-ipc` | `adapter` | — |
| `unified-background.ts` | 统一背景协调器（多渲染表面壁纸接缝连续性） | `wallpaper-injector` | shared/surface-rect, `cdp/surface-rect` | RFC 2026-08-18 §4.3 |
| `utils.ts` | 壁纸工具函数（MIME 推导 + 播放分类） | `adapter`, `we/parser` | shared/types | — |
| `types.ts` | 壁纸共享类型 + 常量（DiscoveredItem / BROWSER_PLAYABLE_VIDEO） | wallpaper 子模块 | shared/types | — |
| `local/importer.ts` | 本地壁纸导入器（scanCustomDir / importMedia / deleteLocal） | `adapter` | 无 | — |
| `we/parser.ts` | Wallpaper Engine project.json 解析 + 类型检测 | `we/scanner` | `utils` | — |
| `we/scanner.ts` | Wallpaper Engine 工坊目录迭代扫描 | `adapter` | `we/parser`, `steam-path-resolver` | — |

### mcp/ — MCP 服务器

| 路径 | 用途 | 消费者 | 内部依赖 | 相关文档 |
|------|------|--------|---------|---------|
| `index.ts` | MCP 模块桶（re-export + 注册全部工具） | 外部消费者 | `mcp-server`, `tools/*` | — |
| `mcp-server.ts` | MCP 服务器入口（@modelcontextprotocol/sdk McpServer + Stdio 传输） | `ipc/mcp-ipc` | `tool-registry`, `capability-orchestrator` | — |
| `auth.ts` | API Key 验证（registerApiKey / validateApiKey） | `http-server` | 无 | — |
| `capability-orchestrator.ts` | 工具统一调度层（查找 + 超时守卫 + 错误归一化） | `mcp-server` | `tool-registry`, `context` | — |
| `config.ts` | MCP 配置接口（enabled / authRequired / serverName / serverVersion） | `mcp-server`, `ipc/mcp-ipc` | 无 | — |
| `context.ts` | MCP 上下文（MainContext 安全只读视图） | `capability-orchestrator`, `tools/*` | `main-context` | — |
| `http-server.ts` | Streamable HTTP 传输（无状态 POST 模式） | `ipc/mcp-ipc` | `mcp-server`, `auth` | — |
| `status-sync.ts` | MCP → GUI 状态同步（写操作后触发通知） | `tools/*` | `main-context` | — |
| `tool-registry.ts` | 工具注册表（模块导入时自动注册） | `capability-orchestrator`, `mcp-server` | `types` | — |
| `types.ts` | MCP 工具层类型（ToolDefinition / ToolHandler / McpContext） | `tool-registry`, `tools/*` | `context` | — |
| `tools/cdp-tools.ts` | CDP 工具（5 个：DOM 快照 / 截图 / 注入验证 / computed-style / 高亮） | `mcp/index` | `cdp/*`, `mcp/context` | — |
| `tools/creation-tools.ts` | 创作工具（1 个：image→theme 创建 + 安装 + 可选 auto-apply） | `mcp/index` | `theme-from-image`, `catalog/*` | — |
| `tools/status-tools.ts` | 状态工具（6 个只读：list/get/search themes + list/get agents + system） | `mcp/index` | `catalog/*`, `agent-engine-service` | — |
| `tools/theme-tools.ts` | 主题工具（5 个：apply/restore/import/delete/export） | `mcp/index` | `agent-engine-service`, `catalog/*` | — |
| `tools/wallpaper-tools.ts` | 壁纸工具（3 个：list/set/preview-from-image） | `mcp/index` | `wallpaper/*`, `theme-from-image` | — |

### scene/ — 场景包解析

| 路径 | 用途 | 消费者 | 内部依赖 | 相关文档 |
|------|------|--------|---------|---------|
| `binary-reader.ts` | 小端二进制 Buffer 顺序读取器（PKG/TEX 格式基础） | `pkg-parser`, `tex-parser` | 无 | — |
| `pkg-parser.ts` | Wallpaper Engine scene.pkg 二进制容器解析 | `scene-extractor` | `binary-reader` | — |
| `tex-parser.ts` | Wallpaper Engine .tex 纹理解析（LZ4 + DXT/BC7 → PNG data URL） | `scene-extractor` | `binary-reader`, `lz4-decoder` | — |
| `particle-parser.ts` | Wallpaper Engine 粒子系统 JSON 解析 | `scene-extractor` | 无 | — |
| `sce-parser.ts` | Sucrose Wallpaper Engine (SCE) 项目解析 | `scene-extractor` | 无 | — |
| `ce-parser.ts` | Cyclone Engine (CE) 二进制场景格式解析 | `scene-extractor` | 无 | — |
| `scene-extractor.ts` | 场景提取编排器（PKG + TEX + scene.json → 统一 SceneData） | `scene-pkg-parser` | `pkg-parser`, `tex-parser`, `scene-json-parser`, `particle-parser` | — |
| `scene-json-parser.ts` | Wallpaper Engine scene.json 解析（general + objects + tags） | `scene-extractor` | 无 | — |
| `_workshop-test-helpers.ts` | 场景解析测试辅助（合成 scene.pkg 二进制 fixture） | scene 测试文件 | `binary-reader` | — |

### agent-engine/ — Agent 引擎委托

| 路径 | 用途 | 消费者 | 内部依赖 | 相关文档 |
|------|------|--------|---------|---------|
| `delegates.ts` | Facade 委托操作集，将编排器的一行委托包装为独立函数 | `agent-engine-service` | `cdp/*`, `services/*`, `wallpaper/*` | — |

### profile/ — 视觉分析配置

| 路径 | 用途 | 消费者 | 内部依赖 | 相关文档 |
|------|------|--------|---------|---------|
| `native-profile.ts` | AgentNativeProfile 数据模型与提取（DomTreeNode → 持久化档案） | `ipc/native-profile-ipc` | shared/types, `cdp/dom-tree` | MATURATION-PLAN §2 |
| `adaptive-theme-generator.ts` | 自适应主题生成器（图像分析结果 → 14-token 主题） | `ipc/visual-analyzer-ipc` | shared/tonal-palette, `color-quantize` | — |
| `color-quantize.ts` | 颜色量化基建（解析/亮度/对比度/median-cut 聚类） | `palette-extractor`, `image-analyzer`, `adaptive-theme-generator` | 无 | — |
| `image-analyzer.ts` | 图像分析引擎（Sobel 焦点检测 + 安全区推断 + 主色调） | `adaptive-theme-generator` | `color-quantize` | — |
| `overrides-store.ts` | 人工纠错持久化（白名单/黑名单/阈值覆盖/precision-recall） | `ipc/transform-ledger-ipc` | shared/types | MATURATION-PLAN §2 阶段 5 |
| `studio-history.ts` | Studio 撤销/重做栈（有界 before/after 快照） | Studio 组件 | 无 | — |
| `studio-theme-templates.ts` | Studio 精选模板库（5 个起始调色板 + overrides） | `ipc/studio-templates-ipc` | shared/types | — |
| `transform-ledger.ts` | 变换台账（remove/transparentize/frost/keep 记录 + CSS 生成） | `ipc/transform-ledger-ipc` | shared/css-escape, shared/types | MATURATION-PLAN §2 阶段 3 |
| `treatment-classifier.ts` | 处置分类器（属性驱动四档处置 + 依据输出） | `ipc/treatment-classifier-ipc` | shared/types | MATURATION-PLAN §2 阶段 2 |

### palette/ — 调色板生成

| 路径 | 用途 | 消费者 | 内部依赖 | 相关文档 |
|------|------|--------|---------|---------|
| `generator.ts` | 调色板 CSS 生成器（per-agent CSS → palette.css + --agentskin-*-raw RGB） | `orchestrator` | 无 | — |
| `orchestrator.ts` | 引擎注入编排器（加载引擎文件 + 构建 palette CSS + 委托 CDP 注入） | `palette-builder`, `agent-engine/delegates` | `generator`, `cdp/injection/engine-strategy` | — |

### theme/ — 主题存储与工具

| 路径 | 用途 | 消费者 | 内部依赖 | 相关文档 |
|------|------|--------|---------|---------|
| `store.ts` | 主题库存储（CRUD over .agentskin-theme 文件 + legacy 迁移） | `theme-library` | legacy/agentskin-core-runtime | — |
| `scheme.ts` | 主题 scheme 常量（agentskin-theme 协议名） | `theme-library`, `utils` | 无 | — |
| `theme-from-image.ts` | 图片→主题流水线（median-cut → 14-token + mode） | `ipc/studio-workspace-ipc`, `wallpaper-theme`, `mcp/tools` | `palette-extractor` | — |
| `token-generator.ts` | Tonal Palette → 14(+1)-token 映射器（HCT 感知均匀 tone 阶梯） | Studio | shared/tonal-palette | — |
| `utils.ts` | 主题工具函数（MIME/extension/cover 提取/mode 推断/磁盘缓存） | `theme-library`, `store` | shared/types | — |
| `wallpaper-color-engine.ts` | 壁纸→15-token 主题色生成（color-thief + HCT Tonal Palette） | `wallpaper-theme` | shared/tonal-palette | — |
| `wallpaper-theme.ts` | 壁纸取色→主题工程（pywal 式联动，nativeImage → 14-token → .agentskin-theme） | `boot-sequence`, `ipc/wallpaper-ipc` | `theme-from-image`, `wallpaper-color-engine`, scripts/generators | — |

### config/ — 配置管理

| 路径 | 用途 | 消费者 | 内部依赖 | 相关文档 |
|------|------|--------|---------|---------|
| `settings.ts` | 运行时设置缓存（imageBlobThresholdMB 等） | `wallpaper-injector` | `fs-utils` | — |
| `studio-window-state.ts` | Studio 窗口状态持久化（size/position/display） | `window-manager` | `fs-utils` | — |

### fs/ — 文件系统工具

| 路径 | 用途 | 消费者 | 内部依赖 | 相关文档 |
|------|------|--------|---------|---------|
| `tar-pack.ts` | 零依赖 tar.gz 打包/解包（.agentskin-bundle 容器） | `ipc/bundle-ipc` | 无（纯 node:zlib） | — |

### community/ — 社区主题

| 路径 | 用途 | 消费者 | 内部依赖 | 相关文档 |
|------|------|--------|---------|---------|
| `community-theme-api.ts` | DreamSkin API 客户端（Electron net 模块绕过 CORS） | `ipc/community-theme-ipc` | 无 | — |
| `community-theme-converter.ts` | DreamSkin ZIP → AgentSkin v2 目录包转换 | `ipc/community-theme-ipc` | `community-zip-extractor`, `community-color-bridge` | — |
| `community-color-bridge.ts` | DreamSkin 10-color → AgentSkin 14-token 颜色桥接 | `community-theme-converter` | `shared-color-utils` | — |
| `community-zip-extractor.ts` | 安全 ZIP 提取（路径穿越防护 + ZIP bomb 100MB 上限） | `community-theme-converter` | 无 | — |
| `dsh-skin-converter.ts` | DSH 皮肤转换器（已废弃，保留为参考实现） | 无活跃消费者 | `shared-utils`, `shared-color-utils` | — |
| `shared-color-utils.ts` | 共享颜色工具函数（已废弃，随 dsh-skin-converter 一起） | `community-color-bridge` | 无 | — |
| `shared-utils.ts` | 共享工具函数（已废弃，随 dsh-skin-converter 一起） | `dsh-skin-converter` | 无 | — |

### css/ — CSS 工具

| 路径 | 用途 | 消费者 | 内部依赖 | 相关文档 |
|------|------|--------|---------|---------|
| `readability-mask.ts` | 阅读遮罩算法（背景色/文字色/照片明暗度 → 动态遮罩样式） | Studio 预览 | 无 | — |

### platform/ — 平台适配

| 路径 | 用途 | 消费者 | 内部依赖 | 相关文档 |
|------|------|--------|---------|---------|
| `macos/launchd-manager.ts` | macOS LaunchAgent 生命周期管理（登录自启 + 崩溃重启） | `persistent-cdp-manager` | 无 | — |

### warm-up/ — 启动预热

| 路径 | 用途 | 消费者 | 内部依赖 | 相关文档 |
|------|------|--------|---------|---------|
| `index.ts` | 启动预热管线（预编译 theme CSS + 构建缩略图缓存索引） | `boot-sequence` | `catalog/*`, `wallpaper/*` | — |

### test-helpers/ — 测试辅助

| 路径 | 用途 | 消费者 | 内部依赖 | 相关文档 |
|------|------|--------|---------|---------|
| `mock-services.ts` | 类型安全 mock 服务工厂（消除测试中 as any 强转） | agent-engine-service 测试文件 | vitest, `services/contracts` | — |

---

## 工程联动图

### 联动链 1：CDP 注入流程（CDP Injection Pipeline）

```
agent-engine-service.ts [apply()]
  → theme-apply-flow.ts [applyThemeFlow()]
    → app-discovery.ts [ensureCdpReady / resolveLivePort]
    → cdp/cdp-ready.ts [ensureAgentCdpReady]
      → cdp/port-resolver.ts [findAvailablePort]
    → cdp/cdp-fanout.ts [hardeningPass]
      → cdp/cdp-targets.ts [findDomTargets]
      → cdp/session-pool.ts [acquireSession]
        → cdp/cdp-client.ts [connectCdp]
      → cdp/baseline-capture.ts [captureBaseline]
      → cdp/injection/engine-strategy.ts [injectThemeViaEngine]
        → cdp/injection/shared.ts [verifyTheme]
        → cdp/injection/css-inject.ts [injectViaAdoptedStyleSheets]
        → cdp/injection/hero-inject.ts [injectHeroBlob]
      → cdp/landmark-preflight.ts [preflightLandmarks]
      → cdp/reload-watchdog.ts [attachReloadWatchdog]
    → palette/orchestrator.ts [tryEngineInjection]
      → palette/generator.ts [buildPaletteCss]
    → cdp/baseline-capture.ts [evaluateReplicationGate (test-only, inlined in baseline-gate.test.ts)]
      → cdp/baseline-capture.ts [replayBaseline]
      → cdp/baseline-capture.ts [validateBaselineCss]
```

**联动效应**：编排器 → 端口发现 → 多目标分发 → 会话复用 → 多层引擎注入 → 基线复刻校验 → 重载守护，形成完整的"发现→注入→验证→守护"闭环。

### 联动链 2：主题应用流程（Theme Apply Pipeline）

```
IPC (renderer) → ipc/theme-ipc.ts → ctx.core.apply()
  → agent-engine-service.ts [apply()]
    → theme-apply-flow.ts [applyThemeFlow()]
      → catalog/theme-catalog.ts [getTheme]
      → theme-asset/index.ts [convert] (外部格式 → 6-agent CSS)
        → theme-asset/detect.ts [sniffFormat]
        → theme-asset/adapters/* [parse]
        → theme-asset/infer/palette-infer.ts [inferPalette]
        → theme-asset/adapt/toGeneratorInput.ts [toGeneratorInput]
        → theme-asset/deepen/index.ts [deepenAll]
        → theme-asset/enhance/layering.ts [补全层次]
        → theme-asset/verify/contract-check.ts [contractCheck]
      → services/agent-engine-persist.ts [PersistChain]
      → theme-hot-reload.ts [notifyThemeHotReload]
      → services/performance/performance-recorder.ts [record]
```

**联动效应**：IPC 入口 → 编排器 → 主题资源引擎（7 阶段管线）→ 持久化链 → 热重载通知 → 性能记录，实现"用户点击→主题转换→注入→持久化→UI 反馈"全链路。

### 联动链 3：应用发现流程（App Discovery Pipeline）

```
ipc/electron-ipc.ts [electron:scan]
  → services/electron-scanner.ts [scanElectronApps]
    → services/scanner/collectors/knownAgent.ts [scanKnownAgents]
      → install-detection.ts [detectInstallation]
    → services/scanner/collectors/registry.ts [scanRegistry]
      → services/scanner/infra/ps.ts [readExeInfo]
    → services/scanner/collectors/filesystem.ts [scanFilesystem]
      → services/scanner/infra/ps.ts [readExeInfo]
    → services/scanner/pipeline/match.ts [matchAgainstHints]
    → services/scanner/pipeline/merge.ts [mergeResults]
    → services/scanner/pipeline/stream-merge.ts [streamMerge]
    → services/scanner/infra/validate.ts [validateExistence]
    → services/scanner/infra/cache.ts [cacheResult]
    → services/scanner/infra/persist-cache.ts [persistCache]
  → shared/app-identity.ts [normalizeProductName / identityKey]
```

**联动效应**：IPC 入口 → 三层扫描器（known + registry + filesystem）→ PE 版本读取 → 适配器匹配 → 身份去重 → 存在性验证 → 缓存持久化，保证"Quark 7.0.5.931 和 7.0.7.940 是同一个产品"。

### 联动链 4：壁纸注入流程（Wallpaper Injection Pipeline）

```
IPC (renderer) → ipc/wallpaper-ipc.ts
  → wallpaper-injector.ts [applyWallpaperToAgent]
    → app-discovery.ts [ensureCdpReady]
    → wallpaper/target-discovery.ts [resolvePageTarget]
    → cdp/cdp-wallpaper-inject.ts [applyWallpaperToAgent]
      → engines/unified/engine.mjs §10 NS.wallpaper.* (image/video/web 元素挂载 + CSS 滤镜)
        → scene-renderer-async.ts [renderSceneToHtmlAsync]
    → wallpaper-server.ts [registerMedia]
    → wallpaper/media-registry.ts [registerToken]
    → wallpaper/mutex.ts [withMutex]
    → wallpaper/injection-state.ts [setActiveMediaToken]
    → wallpaper-self-heal.ts [recordInjectionFailure/Success]
    → wallpaper-lifecycle.ts [broadcast]
```

**联动效应**：IPC 入口 → 注入编排器 → 目标发现 → 三类注入器（image/video/web）→ 媒体服务器注册 → 互斥锁保护 → 自愈记录 → 生命周期广播。

### 联动链 5：IPC 注册与域处理器链路（IPC Registration）

```
boot-sequence.ts → ipc/index.ts [registerIpc(ctx, updateTrayMenu)]
  → core-ipc.ts      → ctx.core.status / locale / shell
  → theme-ipc.ts     → ctx.core.apply / catalog CRUD / theme-asset
  → wallpaper-ipc.ts → ctx.wallpapers / theme-from-image
  → settings-ipc.ts  → ctx.settings
  → studio-ipc.ts    → ctx.core + snapshot-theme
  → mcp-ipc.ts       → mcp/mcp-server.ts
  → window-ipc.ts    → ctx.mainWindow
  → performance-ipc.ts / concurrency-metrics-ipc.ts
  → bundle-ipc.ts    → fs/tar-pack + catalog
  → community-theme-ipc.ts → community/*
  → coordinator-ipc.ts → app-run-state-coordinator
  → native-profile-ipc.ts → profile/native-profile
  → visual-analyzer-ipc.ts → profile/*
  → transform-ledger-ipc.ts → profile/transform-ledger + overrides-store
  → treatment-classifier-ipc.ts → profile/treatment-classifier
  → environment-ipc.ts → env-preset-store
  → studio-project-ipc.ts / studio-templates-ipc.ts / studio-workspace-ipc.ts
```

**联动效应**：启动序列 → IPC 聚合器 → 17 个域处理器 → 统一依赖注入（MainContext）→ 托盘菜单更新回调，实现"一个 ctx 对象驱动全部 IPC 通道"。

### 联动链 6：MCP 工具执行链路（MCP Tool Execution）

```
MCP Client (Cursor/Windsurf)
  → mcp/http-server.ts [Streamable HTTP]
    → mcp/mcp-server.ts [McpServer]
      → mcp/capability-orchestrator.ts [executeTool]
        → mcp/tool-registry.ts [lookup]
        → mcp/tools/cdp-tools.ts / creation-tools.ts / status-tools.ts / theme-tools.ts / wallpaper-tools.ts
          → mcp/context.ts [McpContext 安全视图]
            → cdp/* / catalog/* / agent-engine-service / wallpaper/*
        → status-sync.ts [notifyStatusChanged]
```

**联动效应**：外部 AI Agent → HTTP 传输 → MCP 服务器 → 能力编排器 → 工具注册表 → 5 类工具（19 个具体工具）→ 安全上下文 → 主进程服务，将 AgentSkin 能力暴露为 AI Agent 可调用的工具集。

### 联动链 7：视觉分析与主题生成链路（Visual Analysis Pipeline）

```
ipc/visual-analyzer-ipc.ts [VISUAL_ANALYSIS_GET]
  → profile/native-profile.ts [extractProfile]
    → cdp/dom-tree.ts [captureDomTree]
    → profile/color-quantize.ts [medianCut / luminance]
  → profile/treatment-classifier.ts [classify]
    → profile/transform-ledger.ts [recordTransform]
  → profile/adaptive-theme-generator.ts [generate]
    → profile/image-analyzer.ts [analyze]
    → profile/color-quantize.ts [quantize]
  → profile/overrides-store.ts [applyOverrides]
  → theme-from-image.ts [deriveThemeFromImage]
  → theme/wallpaper-theme.ts [buildThemePackage]
```

**联动效应**：IPC 入口 → 原生档案提取 → 颜色量化 → 处置分类 → 台账记录 → 自适应主题生成 → 人工纠错闭环，形成"CDP 抓 DOM → 分析 → 分类 → 生成 → 纠错"的完整视觉分析管线。

---

## 依赖方向图

```
无依赖（叶子层）
  ├── logger.ts
  ├── epoch-manager.ts
  ├── fs-utils.ts
  ├── lz4-decoder.ts
  ├── audio-level.ts
  ├── deep-link-manager.ts
  ├── dom-snapshot.ts (已废弃)
  ├── boot-profiler.ts
  ├── boot-progress.ts
  ├── boot-reporter.ts
  ├── scene-renderer-capability.ts
  ├── scene-renderer-coords.ts
  ├── scene-renderer-html-scripts.ts
  ├── scene-renderer-types.ts
  ├── cdp/port-config.ts
  ├── cdp/surface-rect.ts
  ├── cdp/renderer-rank.ts
  ├── cdp/cdp-fingerprint.ts
  ├── cdp/injection/types.ts
  ├── ipc/trusted-sender.ts
  ├── services/performance/types.ts
  ├── services/scanner/flags.ts
  ├── theme/scheme.ts
  ├── theme-asset/ir/errors.ts
  ├── theme-asset/ir/types.ts
  ├── theme-asset/ir/normalize.ts
  ├── profile/color-quantize.ts
  ├── palette/generator.ts
  ├── config/settings.ts
  ├── config/studio-window-state.ts
  ├── community/shared-color-utils.ts (已废弃)
  ├── community/shared-utils.ts (已废弃)
  └── platform/macos/launchd-manager.ts

单层依赖
  ├── app-discovery.ts → install-detection, services/contracts
  ├── agent-scheme.ts → cdp/cdp-client
  ├── scheme-sync.ts → agent-scheme, cdp/cdp-client
  ├── wallpaper-self-heal.ts → shared/types
  ├── theme-hot-reload.ts → shared/types
  ├── install-detection.ts → fs-utils
  ├── locale-preferences.ts → fs-utils
  ├── settings-service.ts → fs-utils, ipc/ipc-validators
  ├── theme-library.ts → theme/scheme, theme/store, theme/utils
  ├── wallpaper-service.ts → wallpaper/adapter, wallpaper/utils
  ├── palette-builder.ts → palette/generator, palette/orchestrator
  ├── scene-pkg-parser.ts → scene/pkg-parser, scene/tex-parser, scene/scene-json-parser
  ├── cdp/cdp-ready.ts → app-discovery
  ├── cdp/cdp-targets.ts → legacy/agentskin-core-runtime
  ├── cdp/port-resolver.ts → port-config, port-lease-pool
  ├── cdp/renderer-fingerprint.ts → shared/types
  ├── cdp/selector-validator.ts → cdp/cdp-client
  ├── cdp/injection/shared.ts → shared/injection-runtime, shared/errors
  ├── cdp/injection/types.ts → 无
  ├── ipc/ipc-validators.ts → shared/i18n
  ├── ipc/with-monitored-timeout.ts → shared/withTimeout, services/performance/performance-logger
  ├── services/agent-engine-options.ts → shared/types
  ├── services/app-icon.ts → Electron nativeImage
  ├── services/electron-launcher.ts → port-resolver, cdp/port-config
  ├── services/persistent-cdp-manager.ts → 无（纯 Node.js）
  ├── services/theme-bundle.ts → shared/types
  ├── services/tweak-injector.ts → cdp/cdp-client, shared/safe-css
  ├── services/performance/performance-logger.ts → shared/types
  ├── services/performance/performance-recorder.ts → 无
  ├── services/scanner/types.ts → shared/types
  ├── services/scanner/util.ts → 无
  ├── services/scanner/collectors/shared.ts → 无
  ├── services/scanner/infra/cache.ts → types
  ├── services/scanner/infra/concurrency.ts → 无
  ├── services/scanner/infra/ps.ts → shared/exec-async
  ├── services/scanner/infra/validate.ts → 无
  ├── services/scanner/pipeline/match.ts → shared/app-identity, probes
  ├── services/scanner/pipeline/merge.ts → shared/app-identity
  ├── services/scanner/pipeline/stream-merge.ts → shared/app-identity
  ├── theme-asset/detect.ts → ir/types, ir/errors
  ├── theme-asset/fingerprint.ts → deferred-regen, shared/types
  ├── theme-asset/deferred-regen.ts → shared/types
  ├── theme-asset/adapt/registry.ts → shared/types
  ├── theme-asset/adapt/toGeneratorInput.ts → ir/types, adapt/registry, scripts/generators
  ├── theme-asset/adapters/*.ts → ir/*
  ├── theme-asset/bridge/native-defect.ts → scripts/native-defect-fixes.mjs
  ├── theme-asset/bridge/structural-template.ts → 无
  ├── theme-asset/deepen/index.ts → bridge/native-defect, adapt/registry
  ├── theme-asset/enhance/layering.ts → catalog/theme-manifest
  ├── theme-asset/enhance/presets.ts → catalog/theme-manifest
  ├── theme-asset/infer/palette-infer.ts → ir/normalize
  ├── theme-asset/verify/contract-check.ts → ir/normalize
  ├── theme-asset/verify/fidelity.ts → cdp/baseline-validator, cdp/baseline-css-capture
  ├── theme-asset/verify/probe.ts → cdp/selector-validator
  ├── catalog/agent-catalog.ts → shared/types
  ├── catalog/theme-compatibility.ts → shared/types
  ├── catalog/featured-themes.ts → 无
  ├── catalog/types.ts → shared/types
  ├── wallpaper/utils.ts → shared/types
  ├── wallpaper/types.ts → shared/types
  ├── wallpaper/injector-types.ts → 无（纯类型）
  ├── wallpaper/mutex.ts → 无
  ├── wallpaper/injection-state.ts → 无
  ├── wallpaper/media-registry.ts → 无
  ├── wallpaper/preview-cache.ts → Electron nativeImage
  ├── wallpaper/local/importer.ts → 无
  ├── wallpaper/we/parser.ts → utils
  ├── mcp/config.ts → 无
  ├── mcp/auth.ts → 无
  ├── mcp/types.ts → context
  ├── mcp/tool-registry.ts → types
  ├── mcp/status-sync.ts → main-context
  ├── scene/binary-reader.ts → 无
  ├── scene/particle-parser.ts → 无
  ├── scene/scene-json-parser.ts → 无
  ├── scene/ce-parser.ts → 无
  ├── scene/sce-parser.ts → 无
  ├── profile/image-analyzer.ts → color-quantize
  ├── profile/adaptive-theme-generator.ts → shared/tonal-palette, color-quantize
  ├── profile/studio-history.ts → 无
  ├── profile/studio-theme-templates.ts → shared/types
  ├── css/readability-mask.ts → 无
  ├── fs/tar-pack.ts → 无（纯 node:zlib）
  └── warm-up/index.ts → catalog/*, wallpaper/*

多层依赖（核心枢纽）
  ├── agent-engine-service.ts → 20+ 内部模块
  ├── boot-sequence.ts → 15+ 内部模块
  ├── theme-apply-flow.ts → app-discovery, cdp/*, catalog/*, services/*
  ├── wallpaper-injector.ts → cdp/*, config/*, theme-library
  ├── cdp/cdp-client.ts → shared/errors
  ├── cdp/cdp-fanout.ts → cdp-client, cdp-targets, cdp-inject, session-pool
  ├── cdp/cdp-inject.ts → cdp/injection/*
  ├── cdp/cdp-wallpaper-inject.ts → engines/unified/engine.mjs §10
  ├── cdp/injection/engine-strategy.ts → cdp-client, landmark-preflight, cdp/injection/shared
  ├── cdp/injection/cdp-strategy.ts → cdp-client, cdp/injection/shared
  ├── cdp/session-pool.ts → cdp-client
  ├── cdp/reload-watchdog.ts → cdp-client, cdp/injection/engine-strategy
  ├── cdp/renderer-guardian.ts → cdp-client, cdp-targets
  ├── cdp/apply-baseline.ts → cdp/injection/shared, shared/errors
  ├── cdp/baseline-css-capture.ts → cdp-client, node-cascade
  ├── cdp/baseline-css-replay.ts → cdp/injection/shared, baseline-css-capture
  ├── cdp/baseline-validator.ts → baseline-css-capture, baseline-css-replay
  ├── cdp/baseline-gate.ts → baseline-validator, baseline-css-replay
  ├── cdp/node-cascade.ts → cdp-client
  ├── cdp/landmark-preflight.ts → cdp-client
  ├── cdp/markdown-injector.ts → cdp-client
  ├── cdp/css-service.ts → cdp-client
  ├── cdp/dom-tree.ts → cdp-client
  ├── cdp/snapshot-theme.ts → cdp-client, node-cascade
  ├── cdp/inspect-session.ts → cdp-client, node-cascade
  ├── cdp/watchdog.ts → 无（独立运行）
  ├── cdp/hard-watchdog.ts → 无（独立运行）
  ├── cdp/port-lease-pool.ts → 无（纯 Node.js fs）
  ├── ipc/index.ts → 所有 register*Ipc 函数
  ├── ipc/core-ipc.ts → main-context, shared/i18n, shared/ipc-channels
  ├── ipc/theme-ipc.ts → main-context, catalog/*, agent-engine-service
  ├── ipc/wallpaper-ipc.ts → main-context, wallpaper/*, theme-from-image
  ├── ipc/settings-ipc.ts → main-context, settings-service, shared/safe-css
  ├── ipc/studio-ipc.ts → main-context, cdp/snapshot-theme, inspect-session
  ├── ipc/electron-ipc.ts → electron-scanner, electron-launcher
  ├── ipc/mcp-ipc.ts → mcp/mcp-server, mcp/context
  ├── ipc/visual-analyzer-ipc.ts → profile/*, catalog/*
  ├── ipc/bundle-ipc.ts → fs/tar-pack, catalog/*
  ├── ipc/community-theme-ipc.ts → community/*
  ├── ipc/concurrency-metrics-ipc.ts → agent-engine-service
  ├── ipc/coordinator-ipc.ts → app-run-state-coordinator
  ├── ipc/native-profile-ipc.ts → profile/native-profile
  ├── ipc/performance-ipc.ts → services/performance/*
  ├── ipc/theme-asset-ipc.ts → theme-asset/index
  ├── ipc/transform-ledger-ipc.ts → profile/transform-ledger, profile/overrides-store
  ├── ipc/treatment-classifier-ipc.ts → profile/treatment-classifier
  ├── ipc/environment-ipc.ts → env-preset-store
  ├── ipc/studio-project-ipc.ts → main-context
  ├── ipc/studio-templates-ipc.ts → profile/studio-theme-templates
  ├── ipc/studio-workspace-ipc.ts → theme-from-image, wallpaper/*
  ├── ipc/window-ipc.ts → Electron BrowserWindow
  ├── services/contracts.ts → 无（纯接口定义）
  ├── services/agent-engine-persist.ts → fs-utils
  ├── services/agent-engine-registry.ts → 无
  ├── services/app-run-state-coordinator.ts → 无
  ├── services/electron-scanner.ts → services/scanner/*, install-detection
  ├── services/scanner/index.ts → scanner/*
  ├── services/scanner/collectors/knownAgent.ts → install-detection, infra/ps, probes
  ├── services/scanner/collectors/registry.ts → infra/ps, pipeline/match, util
  ├── services/scanner/collectors/filesystem.ts → infra/ps, pipeline/match, util
  ├── services/scanner/collectors/shared.ts → 无
  ├── services/scanner/infra/persist-cache.ts → fs-utils
  ├── theme-asset/index.ts → pipeline, ir/*
  ├── theme-asset/pipeline.ts → ir/*, adapt/*, bridge/*, deepen/*, enhance/*, verify/*
  ├── theme-asset/bridge/index.ts → native-defect, structural-template
  ├── catalog/theme-catalog.ts → theme-package-loader, shared/types
  ├── catalog/theme-installer.ts → theme-package-loader, theme-manifest
  ├── catalog/theme-package-loader.ts → manifest-validator, shared/theme-build-fingerprint
  ├── catalog/theme-seeder.ts → theme-package-loader, theme-installer
  ├── catalog/theme-manifest.ts → shared/types
  ├── catalog/theme-contract.ts → theme-manifest
  ├── catalog/theme-import-export.ts → manifest-validator, shared/safe-css
  ├── catalog/theme-metadata.ts → theme-manifest
  ├── catalog/manifest-validator.ts → manifest-v2.schema.json
  ├── wallpaper/adapter.ts → we/scanner, local/importer, media-registry, utils
  ├── wallpaper/target-discovery.ts → cdp/cdp-targets, cdp/cdp-ready
  ├── wallpaper/theme-wallpaper.ts → adapter
  ├── wallpaper/unified-background.ts → shared/surface-rect, cdp/surface-rect
  ├── wallpaper/we/scanner.ts → we/parser, steam-path-resolver
  ├── mcp/mcp-server.ts → tool-registry, capability-orchestrator
  ├── mcp/capability-orchestrator.ts → tool-registry, context
  ├── mcp/context.ts → main-context
  ├── mcp/http-server.ts → mcp-server, auth
  ├── mcp/tools/cdp-tools.ts → cdp/*, mcp/context
  ├── mcp/tools/creation-tools.ts → theme-from-image, catalog/*
  ├── mcp/tools/status-tools.ts → catalog/*, agent-engine-service
  ├── mcp/tools/theme-tools.ts → agent-engine-service, catalog/*
  ├── mcp/tools/wallpaper-tools.ts → wallpaper/*, theme-from-image
  ├── scene/pkg-parser.ts → binary-reader
  ├── scene/tex-parser.ts → binary-reader, lz4-decoder
  ├── scene/scene-extractor.ts → pkg-parser, tex-parser, scene-json-parser, particle-parser
  ├── profile/native-profile.ts → shared/types, cdp/dom-tree
  ├── profile/treatment-classifier.ts → shared/types
  ├── profile/transform-ledger.ts → shared/css-escape, shared/types
  ├── profile/overrides-store.ts → shared/types
  ├── palette/orchestrator.ts → generator, cdp/injection/engine-strategy
  ├── theme/store.ts → legacy/agentskin-core-runtime
  ├── theme/utils.ts → shared/types
  ├── theme/theme-from-image.ts → palette-extractor
  ├── theme/token-generator.ts → shared/tonal-palette
  ├── theme/wallpaper-color-engine.ts → shared/tonal-palette
  ├── theme/wallpaper-theme.ts → theme-from-image, wallpaper-color-engine, scripts/generators
  ├── community/community-theme-api.ts → 无（纯 Electron net）
  ├── community/community-theme-converter.ts → community-zip-extractor, community-color-bridge
  ├── community/community-color-bridge.ts → shared-color-utils
  ├── community/community-zip-extractor.ts → 无
  ├── community/dsh-skin-converter.ts → shared-utils, shared-color-utils
  └── main-context.ts → catalog/*, file-open, services/contracts
```

---

## 核心消费者分布

| 模块 | 被引用次数 | 主要引用者类别 |
|------|-----------|---------------|
| `logger.ts` | 30+ | cdp/、services/、ipc/、wallpaper/ 模块 |
| `main-context.ts` | 25+ | boot-sequence、ipc/ 全部、window-manager、tray-manager |
| `cdp/cdp-client.ts` | 20+ | cdp/ 子模块、agent-engine-service、scheme-sync、wallpaper-injector |
| `services/contracts.ts` | 20+ | agent-engine-service、ipc/、catalog/、theme/、wallpaper/ |
| `fs-utils.ts` | 15+ | agent-engine-service、settings-service、locale-preferences、install-detection |
| `agent-engine-service.ts` | 10+ | boot-sequence、ipc/、theme-apply-flow、theme-restore-flow |
| `cdp/session-pool.ts` | 8+ | cdp-fanout、apply-baseline、cdp-inject、agent-engine-service |
| `epoch-manager.ts` | 6+ | agent-engine-service、scheme-sync、cdp-fanout、wallpaper-injector |
| `app-discovery.ts` | 6+ | agent-engine-service、agent-engine/delegates、cdp-ready、theme-apply-flow |
| `wallpaper-injector.ts` | 6+ | agent-engine-service、wallpaper-lifecycle、agent-engine/delegates |
| `cdp/cdp-fanout.ts` | 5+ | agent-engine-service、agent-engine/delegates、apply-baseline |
| `theme-library.ts` | 5+ | agent-engine-service、boot-sequence、wallpaper-injector、theme-apply-flow |
| `agent-scheme.ts` | 5+ | scheme-sync、theme-apply-flow、theme-restore-flow、agent-engine/delegates |
| `ipc/index.ts` | 4+ | boot-sequence |
| `cdp/cdp-targets.ts` | 4+ | cdp-fanout、apply-baseline、dom-snapshot、agent-engine/delegates |
| `wallpaper-server.ts` | 4+ | boot-sequence、wallpaper-injector、wallpaper/media-registry |
| `ipc/ipc-validators.ts` | 5+ | core-ipc、theme-ipc、wallpaper-ipc、settings-ipc |
| `ipc/with-monitored-timeout.ts` | 5+ | 多个 IPC 处理器 |
| `services/performance/performance-recorder.ts` | 4+ | agent-engine-service、theme-apply-flow、theme-restore-flow、cdp-client |
| `cdp/injection/shared.ts` | 5+ | engine-strategy、cdp-strategy、apply-baseline、agent-engine/delegates |
| `cdp/injection/engine-strategy.ts` | 5+ | palette/orchestrator、reload-watchdog、cdp-fanout |
| `theme-asset/index.ts` | 4+ | ipc/theme-asset-ipc |
| `catalog/theme-catalog.ts` | 4+ | ipc/theme-ipc、theme-seeder |
| `wallpaper/adapter.ts` | 4+ | wallpaper-service、theme-wallpaper |
| `mcp/tool-registry.ts` | 4+ | capability-orchestrator、mcp-server |
| `scene/scene-extractor.ts` | 3+ | scene-pkg-parser |
| `profile/native-profile.ts` | 3+ | ipc/native-profile-ipc |
| `services/electron-scanner.ts` | 3+ | ipc/electron-ipc |

---

## 约定

1. **服务单一职责**：每个 `.ts` 文件对应一个服务域，禁止跨域耦合。
2. **测试共置**：单元测试文件（`.test.ts`）与服务文件同目录同名，保持就近原则。
3. **IPC 收敛**：所有 IPC 通道注册集中在 `ipc/`，禁止在其他模块直接调用 `ipcMain.handle`。
4. **CDP 分层**：`cdp/` 内部按职责分为注入策略（`injection/`）和壁纸渲染（`wallpaper/`），禁止目录间循环引用。
5. **并发守卫**：共享状态操作必须使用 `epoch-manager` 或 `mutex` 保护。
6. **日志统一**：所有服务使用 `logger.ts` 输出的统一日志器，禁止 `console.log`。
7. **Barrel 文件模式**：`theme-library.ts`、`wallpaper-service.ts`、`palette-builder.ts`、`scene-pkg-parser.ts`、`cdp-inject.ts`、`cdp-wallpaper-inject.ts` 等 barrel 文件用于保持向后兼容。
8. **依赖注入**：IPC 处理器通过 `deps`（MainContext）注入依赖，禁止隐式单例导入。
9. **MCP 工具注册**：工具模块在 import 时通过 `registerTool()` 自动注册，导入即注册。
10. **废弃模块标记**：`dom-snapshot.ts`、`community/dsh-skin-converter.ts` 等已废弃模块保留为参考实现，标注 `@deprecated`。

---

## 变更影响速查

> 修改以下模块时需格外谨慎，影响范围广：

| 模块 | 风险等级 | 原因 |
|------|---------|------|
| `agent-engine-service.ts` | 🔴 高 | 系统核心枢纽，直接依赖 20+ 内部模块 |
| `logger.ts` | 🔴 高 | 全进程日志基础设施，30+ 文件依赖 |
| `main-context.ts` | 🔴 高 | 运行时上下文单例，25+ 文件依赖 |
| `cdp/cdp-client.ts` | 🔴 高 | CDP WebSocket 会话基础，20+ 文件依赖 |
| `services/contracts.ts` | 🔴 高 | 服务契约接口定义，20+ 文件依赖 |
| `boot-sequence.ts` | 🟡 中 | 启动序列编排，影响初始化流程 |
| `theme-apply-flow.ts` | 🟡 中 | 主题应用核心流程 |
| `wallpaper-injector.ts` | 🟡 中 | 壁纸注入核心 |
| `cdp/cdp-fanout.ts` | 🟡 中 | CDP 多目标分发 |
| `ipc/index.ts` | 🟡 中 | IPC 注册聚合器 |
| `fs-utils.ts` | 🟡 中 | 原子写入工具，15+ 文件依赖 |
| `cdp/session-pool.ts` | 🟡 中 | CDP 会话池，8+ 文件依赖 |
| `agent-scheme.ts` | 🟡 中 | Scheme 同步原语，5+ 文件依赖 |
| `cdp/injection/engine-strategy.ts` | 🟡 中 | 多层引擎注入策略 |
| `cdp/injection/shared.ts` | 🟡 中 | 注入策略共享助手，5+ 文件依赖 |
| `theme-asset/index.ts` | 🟡 中 | 主题资源引擎入口 |
| `catalog/theme-manifest.ts` | 🟡 中 | 主题清单数据模型 |
| `wallpaper/adapter.ts` | 🟡 中 | 壁纸服务适配器 |
| `mcp/mcp-server.ts` | 🟡 中 | MCP 服务器入口 |
| `services/electron-scanner.ts` | 🟡 中 | 应用扫描器编排器 |
| 其他模块 | 🟢 低 | 消费者 ≤ 5，影响可控 |

---

## 覆盖率统计

| 指标 | 数值 |
|------|------|
| 非测试 `.ts` 文件总数 | 264 |
| INDEX 已覆盖文件数 | 264 |
| 覆盖率 | **100%** |
| 根目录文件 | 48 |
| 子目录文件 | 216 |
| 子目录层级 | 30（含嵌套） |

**对比**：
- 改写前：~48 文件（仅根目录 + 子目录名称），覆盖率 ~18%
- 改写后：264 文件（全部展开到文件级），覆盖率 **100%**

---

## 测试分布

| 目录 | 测试文件数 | 说明 |
|------|-----------|------|
| 根目录 | ~25 | agent-engine-service（7 个专项测试）、boot-sequence、theme-apply-flow、wallpaper-* 等 |
| `cdp/` | ~20 | cdp-client、cdp-fanout、session-pool、apply-baseline、engine-strategy 等 |
| `ipc/` | ~12 | core-ipc、theme-ipc、wallpaper-ipc、settings-ipc 等 |
| `services/` | ~10 | electron-scanner、electron-launcher、tweak-injector、performance 等 |
| `catalog/` | ~10 | theme-catalog、theme-installer、theme-package-loader、manifest-validator 等 |
| `wallpaper/` | ~10 | adapter、media-registry、mutex、preview-cache、target-discovery 等 |
| `theme-asset/` | ~5 | detect、fingerprint、pipeline 等 |
| `profile/` | ~8 | native-profile、color-quantize、image-analyzer、transform-ledger 等 |
| `scene/` | ~6 | binary-reader、pkg-parser、tex-parser、particle-parser 等 |
| `mcp/` | ~2 | mcp-server、cdp-tools |
| `palette/` | ~2 | generator、orchestrator |
| `theme/` | ~2 | theme-from-image、wallpaper-sample |
| `community/` | 0 | 无专项测试 |
| `config/` | ~2 | settings、studio-window-state |
| `fs/` | ~1 | tar-pack |
| `css/` | ~1 | readability-mask |
| `platform/` | ~1 | launchd-manager |
| `test-helpers/` | — | mock-services.ts（测试辅助，非测试文件） |
| **合计** | **~117** | |
