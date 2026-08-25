# main — 主进程服务

## 用途
Electron 主进程入口，承载所有后端服务：CDP 注入、应用发现、主题渲染、壁纸注入、IPC 桥接、场景解析等。

## 结构

### 根目录（核心服务文件）

| 路径 | 用途 |
|------|------|
| `agent-engine-service.ts` | Agent 引擎核心服务，管理 6 个适配器的生命周期、注入调度与健康检查 |
| `agent-scheme.ts` | Agent Scheme 协议处理，跨应用 URL Scheme 同步与路由 |
| `app-discovery.ts` | 应用发现服务，扫描磁盘上的 traework / qoderwork / workbuddy 等目标应用 |
| `boot-sequence.ts` | 启动序列编排，控制从 splash 到首屏的完整启动流程 |
| `boot-progress.ts` | 启动进度计算，将各阶段耗时映射为 0-100% 进度值 |
| `boot-profiler.ts` | 启动性能埋点，记录各阶段 Trace 数据用于诊断 |
| `boot-reporter.ts` | 启动报告生成，汇总启动指标供 Diagnostics 页面展示 |
| `main-context.ts` | 主进程上下文聚合器，统一暴露各服务实例供 IPC 调用 |
| `install-detection.ts` | 安装检测，识别目标应用的版本、路径与安装状态 |
| `settings-service.ts` | 设置持久化服务，管理用户偏好、主题配置与运行时状态 |
| `theme-apply-flow.ts` | 主题应用流程编排，从选择到注入完成的完整管线 |
| `theme-restore-flow.ts` | 主题恢复流程，崩溃重启后自动恢复上次主题状态 |
| `theme-health-check.ts` | 主题健康检查，验证注入后 CSS 选择器是否命中目标 DOM |
| `wallpaper-injector.ts` | 壁纸注入器，通过 CDP 向目标应用注入视频/图片/Web 壁纸 |
| `wallpaper-server.ts` | 壁纸服务，管理壁纸资源加载、缓存与生命周期 |
| `wallpaper-lifecycle.ts` | 壁纸生命周期控制，处理挂起/恢复/销毁 |
| `wallpaper-self-heal.ts` | 壁纸自愈，检测注入失败后自动重试或降级 |
| `window-manager.ts` | 窗口管理，创建/定位/隐藏 AgentSkin 主窗口与预览窗口 |
| `scene-renderer-html.ts` | 场景 HTML 渲染器，将场景包渲染为目标页面背景 |
| `scene-renderer-layers.ts` | 场景图层管理，处理粒子/视频/图片的分层渲染 |
| `scene-renderer-particles.ts` | 粒子系统渲染，驱动场景中的动态粒子效果 |
| `scene-renderer-coords.ts` | 场景坐标转换，映射场景空间到屏幕空间 |
| `theme-library.ts` | 主题库管理，扫描本地已安装主题与内置主题 |
| `tray-manager.ts` | 系统托盘管理，创建托盘图标与上下文菜单 |
| `steam-path-resolver.ts` | Steam 路径解析，定位 Steam 安装目录用于游戏壁纸 |
| `logger.ts` | 统一日志服务，支持文件日志与 IPC 日志上报 |
| `fs-utils.ts` | 原子写入工具：tmp 文件 → fsync → rename → dir-fsync 四步协议，保证崩溃/断电不产生半写文件；含 `atomicWriteFile` / `atomicWriteJson` / `writeJsonAtomic` / `appendLogLine` |
| `lz4-decoder.ts` | LZ4 解压器，用于解包场景资源与压缩主题 |
| `palette-builder.ts` | 调色板构建器，从图像提取主色并生成 14-token 调色板 |
| `scheme-sync.ts` | Scheme 同步，保持主进程与渲染进程的 Scheme 状态一致 |
| `epoch-manager.ts` | 纪元管理器，用于并发操作的版本号隔离 |
| `audio-level.ts` | 音频电平检测，驱动音频可视化壁纸 |
| `file-open.ts` | 文件打开服务，处理系统"打开方式"请求 |
| `locale-preferences.ts` | 语言偏好管理，读写用户语言设置 |
| `env-preset-store.ts` | 环境预设存储，保存工作区环境默认配置 |

### 子目录

| 路径 | 用途 |
|------|------|
| `cdp/` | Chrome DevTools Protocol 客户端与注入引擎 |
| `cdp/injection/` | CDP 注入策略：CSS 注入、引擎注入、Hero 区域注入 |
| `cdp/wallpaper/` | CDP 壁纸注入器，视频/图片/Web 三类壁纸的 CSS 渲染 |
| `ipc/` | IPC 通道定义与处理器，所有渲染-主进程通信的注册中心 |
| `catalog/` | 主题目录（catalog）与 Agent 目录管理 |
| `scene/` | 场景包解析器：二进制读取、粒子解析、TEX 纹理解析 |
| `services/` | 辅助服务目录 |
| `services/performance/` | 性能日志与性能记录器 |
| `config/` | 配置模块（warm-up 入口） |
| `fs/` | 文件系统辅助工具 |
| `palette/` | 颜色量化、安全 CSS、转换审计、处理分类器 |
| `profile/` | 原生色彩 Profile、Override 存储、Studio 历史与主题模板 |
| `theme/` | Theme scheme/store、主题从图像生成、壁纸主题映射 |
| `wallpaper/` | 壁纸适配器、注入状态、媒体注册表、互斥锁、目标发现 |
| `wallpaper/local/` | 本地壁纸导入器 |
| `wallpaper/we/` | 网络壁纸解析器与扫描器 |
| `agent-engine/` | Agent 引擎委托模块 |

## 约定

1. **服务单一职责**：每个 `.ts` 文件对应一个服务域，禁止跨域耦合。
2. **测试共置**：单元测试文件（`.test.ts`）与服务文件同目录同名，保持就近原则。
3. **IPC 收敛**：所有 IPC 通道注册集中在 `ipc/`，禁止在其他模块直接调用 `ipcMain.handle`。
4. **CDP 分层**：`cdp/` 内部按职责分为注入策略（`injection/`）和壁纸渲染（`wallpaper/`），禁止目录间循环引用。
5. **并发守卫**：共享状态操作必须使用 `epoch-manager` 或 `mutex` 保护。
6. **日志统一**：所有服务使用 `logger.ts` 输出的统一日志器，禁止 `console.log`。
