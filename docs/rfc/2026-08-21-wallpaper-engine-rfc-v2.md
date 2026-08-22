# RFC 2026-08-21 v2 — 壁纸引擎增强与主题/注入联动

- **状态**: PROPOSED
- **作者**: AgentSkin Team
- **日期**: 2026-08-21
- **版本**: v2（GitHub调研 + 交叉质询后更新）
- **相关**: docs/ARCHITECTURE.md, theme-wallpaper.ts, scene-renderer-html.ts

---

## 一、问题陈述

当前壁纸系统存在以下核心短板：

| # | 问题 | 影响 |
|---|------|------|
| P1 | WallpaperEnginePage 仅为展示层，无真正引擎能力 | 用户体验停留在"选壁纸"而非"用引擎" |
| P2 | SCE/CE/PKG 文件解析不全 | 大量高质量壁纸无法识别或降级为静态图 |
| P3 | 壁纸↔注入引擎缺乏实时反馈闭环 | 注入失败无感知、theme↔wallpaper 不同步 |
| P4 | 自动生成主题功能仅限 image/video 类型 | scene/web 类壁纸无法驱动 14-token 主题 |
| P5 | scene-renderer-html.ts 同步阻塞 IPC | 大文件场景（50MB+）卡顿事件循环 |

### 根因分析（Why）

1. **历史演进路径**：壁纸系统最初是 theme 的附属模块（主题背景图），后续扩展为独立页面但保留了"展示为主"的架构。
2. **格式碎片化**：SCE（Sucrose）、CE（Cyclone）是逆向社区格式，无官方文档，逐版本跟进成本高。
3. **架构边界**：scene 解析与 theme 生成解耦但缺乏双向通道（theme→wallpaper 通过 `activateThemeWallpaper`，但 wallpaper→theme 仅有取色链路）。
4. **性能权衡**：同步渲染简单但阻塞 IPC；大文件场景（粒子系统、高纹理）未做异步拆分。

---

## 二、GitHub 参考项目调研

### 2.1 壁纸解析/渲染类

| 项目 | URL | 许可证 | 核心能力 | 可移植性 |
|------|-----|--------|---------|---------|
| **RePKG** | github.com/notscuffed/repkg | MIT | PKG/TEX 解析，V0001/V0002 格式 | ⭐⭐⭐⭐⭐ 强烈推荐 |
| **RePKG.Neo** | github.com/masterLazy/RePKG.Neo | MIT | RePKG 活跃分支，GUI + 批量操作 | ⭐⭐⭐⭐⭐ |
| **linux-wallpaperengine** | github.com/Almamu/linux-wallpaperengine | GPL-3.0 | 完整 WE 场景渲染（Irrlicht） | ⭐⭐⭐⭐ 架构参考 |
| **wallpaper-scene-renderer** | github.com/catsout/wallpaper-scene-renderer | GPL-2.0 | Vulkan 场景渲染器 | ⭐⭐⭐⭐ 渲染管线参考 |
| **WaifuX** | github.com/jipika/WaifuX | 商业 | 离线烘焙→MP4，Metal 渲染 | ⭐⭐⭐⭐ 烘焙架构参考 |
| **gnome-ext-hanabi** | github.com/ayasa520/gnome-ext-hanabi | GPL-2.0 | Rust 后端 + CEF/GStreamer | ⭐⭐⭐ 双后端参考 |

### 2.2 Electron/主题引擎类

| 项目 | URL | 核心能力 | 可借鉴点 |
|------|-----|---------|---------|
| **darkreader** | github.com/darkreader/darkreader | CSS 主题动态生成 | 三模式分层、站点修复配置、CSS 变量替换 |
| **cloakd** | github.com/Janlaywss/cloakd | 纯 CSS 注入换肤 | CSS 变量即主题、零侵入设计 |
| **caprine** | github.com/sindresorhus/caprine | Electron 桌面应用 | IPC 扁平化、CSS 文件分离注入、Vibrant 取色 |
| **puppeteer** | github.com/puppeteer/puppeteer | CDP 控制 | Session 复用、evaluateOnNewDocument 注入时机 |
| **openstyles/stylus** | github.com/openstyles/stylus | UserCSS 变量系统 | @preprocessor 变量编译、URL 匹配、动态注入 |
| **rainmeter** | github.com/rainmeter/rainmeter | 桌面皮肤系统 | Skin/Meter 分离、UpdateDivider 性能分层 |
| **wallpaper-mac** | github.com/zhulinghao/wallpaper-mac | Electron 壁纸引擎 | 壁纸窗口分层、IPC 单向流、多显示器匹配 |

### 2.3 关键借鉴结论

1. **TEX 解码**：RePKG (MIT) 可直接移植 C# 核心算法为 Rust WASM 或 Node.js N-API addon
2. **离线烘焙**：WaifuX 的"预渲染→视频回放"模式适合低配设备降级
3. **CSS 主题**：darkreader 的 Dynamic 模式 + cloakd 的纯 CSS 注入 = 14-token 契约最佳实践
4. **CDP 注入**：puppeteer 的 `evaluateOnNewDocument` + Session 复用 = 注入引擎联动技术基础

---

## 三、候选方案（4套）

### 方案 A：渐进式增强 + RePKG 移植（RECOMMENDED）

**核心思路**：以现有 PKG 解析→渲染→注入管线为骨架，分三阶段递增式补齐能力。移植 RePKG 的 TEX 解码算法为 Rust WASM 模块，解决性能瓶颈。

**阶段一：检测补齐 + 可观测层**
- `we/parser.ts` 新增 SCE/CE 类型推断
- `wallpaperStore` 新增 `renderEngineStatus` 状态
- WallpaperEnginePage 底部增加引擎健康指示

**阶段二：轻量解析 + 异步渲染管线**
- 新建 `sce-parser.ts` / `ce-parser.ts`
- `renderSceneToHtml` 迁移至 `worker_threads.Worker`
- 移植 RePKG TEX 解码为 Rust WASM（替换 JS DXT 解压）
- 渲染结果缓存（pkgPath:mtime 复合 key）

**阶段三：全类型主题联动 + 注入反馈闭环**
- `buildWallpaperTheme` 支持 scene→14-token 派生
- `unified-background.ts` 扩展 continuation 至 scene/web
- InjectResultsPanel 增加注入结果三态徽章

**新增依赖**：Rust WASM（wasm-pack 编译，运行时零依赖）
**改动规模**：12 个文件（3 新增 + 9 修改）

---

### 方案 B：引擎核心重构（IR + Three.js WebGL）

**核心思路**：引入三层引擎核心（统一 IR → WebGL 渲染 → 引擎编排器），壁纸页升级为可交互预览引擎。

**关键设计**：
- IR 中间表示：`SceneIR = { meta, layers, effects, particles, camera, audioReactive }`
- Three.js WebGL 后端 + EffectComposer（bloom/distort/wind 着色器映射）
- 低配设备 fallback 至现有 Canvas 2D

**SCE/CE 策略**：适配器 + IR 归一化，无新增外部依赖（纯协议解析）
**新增依赖**：Three.js（~500KB bundle，lazy import）
**改动规模**：~20 文件（全新 engine 核心层）

---

### 方案 C：混合适配（repkg + PixiJS + Adapter 抽象层）

**核心思路**：建立 `SceneAdapter` 抽象层，SCE/CE 优先调用第三方工具（repkg）转换，共用现有渲染管线。

**关键设计**：
- `SceneAdapter` 接口 + pkg/sce/ce 三个适配器
- PixiJS v8 作为 WebGL 后端（300KB gzip，lazy import）
- Canvas 2D 保留为 fallback

**致命缺陷**：repkg 的 Wallpaper Engine EULA 合规风险（WE 用户协议禁止逆向工程其文件格式）
**新增依赖**：PixiJS（lazy import）+ repkg CLI 子进程
**改动规模**：~12 文件（adapter 层 + 双后端）

---

### 方案 D：声明式壁纸描述语言（WDL）

**核心思路**：以 YAML 声明式描述替代 Wallpaper Engine 第三方依赖，壁纸即纯数据配置，运行时解释为 CSS/Canvas 原子动效。

**关键设计**：
- `.wdl.yaml` 文件 → 主进程解析器 → CSS Houdini + rAAF 解释器 → CDP 注入样式层
- CSS 变量桥接 14-token：`--ag-*` 变量继承，壁纸动效自动跟随主题配色
- 主进程预编译 DSL→CSS，解析一次缓存结果，IPC 开销恒定
- 彻底移除 WE 依赖，壁纸可离线、可版本化、可组合

**新增依赖**：零（YAML 解析可用轻量库如 `yaml` 或自研）
**改动规模**：8 个文件（3 新增 + 5 修改）

---

## 四、多维加权评估（v2 更新）

### 4.1 评分维度与权重

| 维度 | 权重 | 说明 |
|------|------|------|
| 1. 业务根治 | 20% | 彻底解决核心问题，非临时规避 |
| 2. 场景兼容 | 8% | 全量适配现有 Agent/客户端/存量场景 |
| 3. 故障安全 | 12% | 故障爆炸半径小，支持降级/熔断/回滚 |
| 4. 工程契约 | 5% | 数据结构/枚举/Schema/数据流闭环 |
| 5. 可工程化 | 12% | 支持自动化测试/CI校验/探针监测 |
| 6. 架构一致性 | 15% | 严格对齐 ARCHITECTURE.md |
| 7. 长期演进 | 18% | 预留扩展点，支持增量迭代 |
| 8. 边界健壮 | 10% | 兼容极端异常场景、规避已知坑点 |

### 4.2 四方案评分矩阵

| 维度 | 权重 | A 渐进增强 | B 引擎重构 | C 混合适配 | D 声明式DSL |
|------|------|-----------|-----------|-----------|------------|
| 1. 业务根治 | 20% | 8 | 9 | 7 | 7 |
| 2. 场景兼容 | 8% | 9 | 6 | 7 | 9 |
| 3. 故障安全 | 12% | 9 | 6 | 6 | 9 |
| 4. 工程契约 | 5% | 9 | 7 | 8 | 9 |
| 5. 可工程化 | 12% | 9 | 8 | 8 | 9 |
| 6. 架构一致性 | 15% | 10 | 7 | 7 | 9 |
| 7. 长期演进 | 18% | 8 | 10 | 8 | 8 |
| 8. 边界健壮 | 10% | 8 | 6 | 6 | 8 |
| **加权总分** | **100%** | **8.67** | **7.76** | **7.13** | **8.32** |

### 4.3 评分依据更新（v2）

**方案 A 上调理由**：
- RePKG (MIT) 可直接移植 TEX 解码，解决 JS 单线程性能瓶颈
- WaifuX 离线烘焙模式可作为阶段二的降级路径
- darkreader 的 CSS 变量系统验证了 14-token 契约的可行性

**方案 B 下调理由**：
- Three.js 在 Electron 低配设备的 WebGL 兼容风险被交叉质询确认
- 新增依赖违反"能少依赖就少依赖"原则
- 与现有 Canvas 2D 分层架构冲突

**方案 C 下调理由**：
- repkg 的 Wallpaper EULA 法律风险被交叉质询确认（致命缺陷）
- PixiJS WebGL context 与 CDP 注入 iframe 的 GPU 资源争抢
- Adapter 抽象层最接近"禁止新增适配器"违规边界

**方案 D 评分理由**：
- 零新依赖，复用现有注入管线
- 纯 CSS/Canvas 无兼容问题
- 但表达能力天花板（无法实现粒子流体等高级效果）

---

## 五、交叉质询关键发现

### 5.1 方案 A 被质询的问题与回应

| 质询点 | 回应 |
|--------|------|
| TEX→PNG 解压仍走 JS 单线程 | v2 已规划移植 RePKG 为 Rust WASM，解决性能瓶颈 |
| wallpaper-server.ts Range 请求缓存 LRU 缺失 | 阶段二补充 LRU 淘汰策略 |
| scene 资源提取反向依赖 scene/ 子模块 | 通过主进程编排层解耦，不直接反向依赖 |
| manifest schema 扩展需 RFC | 本 RFC 已覆盖 schema 变更 |

### 5.2 方案 B 被质询的问题

| 质询点 | 结论 |
|--------|------|
| Three.js 在低配设备 WebGL 兼容风险 | 风险不可控，需 Canvas2D fallback |
| IR 层打破 wallpaperStore→themeStore 联动 | 需新增 IR→14-token 转换层，复杂度翻倍 |
| 新增 Three.js 违反技术栈约束 | 违反"不可随意新增"原则 |

### 5.3 方案 C 被质询的问题

| 质询点 | 结论 |
|--------|------|
| repkg 的 WE EULA 合规风险 | **致命缺陷**，DMCA 风险不可接受 |
| PixiJS WebGL context 与 CDP iframe GPU 争抢 | Chromium GPU 进程 context 数限制 |
| Adapter 抽象层违规边界 | 最接近"禁止新增适配器"违规 |

### 5.4 方案 D 被质询的问题

| 质询点 | 结论 |
|--------|------|
| 表达能力天花板 | 纯 CSS/Canvas 无法实现粒子流体，需 escape hatch 回退到视频注入 |
| DSL 学习成本 | Studio 可视化编辑器导出 DSL（后续迭代） |
| 解析性能 | 主进程预编译缓存 + Web Worker 离线程解析 |

---

## 六、推荐方案及理由

### 推荐：方案 A（渐进式增强 + RePKG 移植）

**最终得分：8.67（最高）**

**理由**：

1. **对齐项目原则**：满足"最小改动、可验证、可回滚"的开发偏好
2. **风险可控**：每阶段独立交付、独立验证、独立回滚
3. **路径可达**：阶段三完成后可平滑演进至 IR 核心
4. **性能可解**：RePKG (MIT) 移植解决 TEX 解码性能瓶颈
5. **法律安全**：不引入 repkg 等 EULA 灰色地带工具

**牺牲项**：
- 暂不引入真正的可交互 WebGL 预览引擎
- Canvas 2D 渲染能力上限保持现状

**收益项**：
- 2-3 周内完成，每周可交付一个可用版本
- 现有 1336+ 测试零修改
- 为后续 IR 核心奠定 SCE/CE 解析数据基础

---

## 七、执行计划

### Phase 1: 检测补齐 + 可观测层（Week 1）

新增/修改文件：
- `src/main/wallpaper/we/parser.ts` — SCE/CE 类型推断
- `src/main/wallpaper/we/scanner.ts` — DiscoveredItem.sceneFormat 扩展
- `src/ui/stores/wallpaperStore.ts` — renderEngineStatus + refreshEngineStatus
- `src/ui/pages/WallpaperEnginePage.tsx` — SceneEngineHealth 组件

验收标准：
- 含 SCE/CE 项目的目录可正确识别类型
- 网格中 scene/sce/ce 各有独立图标
- 引擎降级时 UI 显示黄色告警

### Phase 2: 轻量解析 + 异步渲染（Week 2）

新增/修改文件：
- `src/main/scene/sce-parser.ts` (新增)
- `src/main/scene/ce-parser.ts` (新增)
- `src/main/scene-renderer-async.ts` — Worker 异步调度
- `src/main/wallpaper/adapter.ts` — SCE/CE branch
- `src/main/scene/tex-wasm-decoder.ts` (新增) — RePKG Rust WASM 绑定

验收标准：
- 30MB+ scene/pkg 渲染不阻塞 IPC
- SCE/CE 项目在预览面板正确渲染
- TEX 解码性能提升 5x+（WASM vs JS）

### Phase 3: 主题联动 + 注入反馈（Week 3）

新增/修改文件：
- `src/main/theme/wallpaper-theme.ts` — scene→14-token
- `src/main/wallpaper/unified-background.ts` — continuation 扩展
- `src/ui/components/wallpaper/InjectResultsPanel.tsx` — 三态徽章

验收标准：
- scene 壁纸应用后，buildWallpaperTheme 生成与配色一致的 14-token 主题
- 多目标应用中 scene 壁纸在 seam 处无错位
- InjectionResultBadge 正确显示成功/失败/超时

---

## 八、风险清单

| 风险 | 等级 | 缓解策略 |
|------|------|---------|
| SCE/CE 格式未知版本检测失败 | 中 | fallback 到 web/image 路径 + UI 降级提示 |
| Rust WASM 编译工具链复杂度 | 中 | 预编译 wasm 二进制，主进程直接加载 |
| Worker 线程传递 Buffer 失败 | 低 | worker 内重新 extractScene |
| scene.pkg Steam 更新后缓存失效 | 低 | 缓存 key = `${pkgPath}:${mtime}` |
| CDP evaluate 超时影响副表面 | 低 | try/catch 兜底 |
| WallpaperEnginePage 状态膨胀 | 中 | 状态收敛进 wallpaperStore |

---

## 九、后续演进路径

Phase 3 完成后，已具备：
- SCE/CE 解析基础设施
- 异步渲染管线（WASM 加速）
- 全类型 wallpaper↔theme 联动

下一里程碑可演进至「引擎核心 IR」：
1. 从 `SceneData` 派生 `SceneIR`（首版仅 PKG→IR）
2. 引入 WebGL 渲染后端（PixiJS 或 Three.js）可选升级
3. Studio 窗口集成可交互预览引擎
4. 可选：WDL 声明式 DSL 作为高级用户创作格式（方案 D 的远期融合）

---

## 十、名词术语

| 术语 | 定义 |
|------|------|
| SCE | Sucrose Engine 场景格式（JSON-based） |
| CE | Cyclone Engine 场景格式（Binary） |
| IR | Intermediate Representation，引擎核心中间表示 |
| Continuation | 副表面共享主表面背景图的轻量注入方案 |
| 14-token | AgentSkin 主题契约中的 14 个语义色彩 token |
| WDL | Wallpaper Description Language，声明式壁纸描述语言 |
| RePKG | Wallpaper Engine PKG/TEX 解析开源项目（MIT） |
