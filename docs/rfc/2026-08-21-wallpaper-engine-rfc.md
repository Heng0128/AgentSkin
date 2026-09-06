# RFC 2026-08-21 — 壁纸引擎增强与主题/注入联动

- **状态**: PROPOSED
- **作者**: AgentSkin Team
- **日期**: 2026-08-21
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

## 二、候选方案

### 方案 A：渐进式增强（RECOMMENDED）

**核心思路**：以现有 PKG 解析→渲染→注入管线为骨架，分三阶段递增式补齐能力。不新增适配器、不动 14-token 契约、不突破六页封顶。

**阶段一：检测补齐 + 可观测层**
- `we/parser.ts` 新增 SCE/CE 类型推断
- `wallpaperStore` 新增 `renderEngineStatus` 状态
- WallpaperEnginePage 底部增加引擎健康指示

**阶段二：轻量解析 + 异步渲染管线**
- 新建 `sce-parser.ts` / `ce-parser.ts`
- `renderSceneToHtml` 迁移至 `worker_threads.Worker`（解除 IPC 阻塞）
- 渲染结果缓存（pkgPath:mtime 复合 key）

**阶段三：全类型主题联动 + 注入反馈闭环**
- `buildWallpaperTheme` 支持 scene→14-token 派生
- `unified-background.ts` 扩展 continuation 至 scene/web
- InjectResultsPanel 增加注入结果三态徽章

**新增依赖**：无
**改动规模**：10 个文件（2 新增 + 8 修改）

---

### 方案 B：引擎核心重构

**核心思路**：引入三层引擎核心（统一 IR → WebGL 渲染 → 引擎编排器），壁纸页升级为可交互预览引擎。

**关键设计**：
- IR 中间表示：`SceneIR = { meta, layers, effects, particles, camera, audioReactive }`
- Three.js WebGL 后端 + EffectComposer（bloom/distort/wind 着色器映射）
- 低配设备 fallback 至现有 Canvas 2D

**SCE/CE 策略**：适配器 + IR 归一化，无新增外部依赖（纯协议解析）
**新增依赖**：Three.js（~500KB bundle，lazy import）
**改动规模**：~20 文件（全新 engine 核心层）

---

### 方案 C：混合适配

**核心思路**：建立 `SceneAdapter` 抽象层，SCE/CE 优先调用第三方工具（repkg）转换，共用现有渲染管线。

**关键设计**：
- `SceneAdapter` 接口 + pkg/sce/ce 三个适配器
- PixiJS v8 作为 WebGL 后端（300KB gzip，lazy import）
- Canvas 2D 保留为 fallback

**第三方依赖**：repkg CLI 子进程调用
**新增依赖**：PixiJS（lazy import）
**改动规模**：~12 文件（adapter 层 + 双后端）

---

## 三、多维加权评估

| 维度 | 权重 | A（渐进增强） | B（引擎重构） | C（混合适配） |
|------|------|-------------|-------------|-------------|
| 1. 业务根治 | 20% | 8（分阶段根治） | 9（引入引擎核心） | 8（适配器补齐） |
| 2. 场景兼容 | 8% | 9（无破坏性改动） | 7（WebGL兼容验证） | 8（fallback兜底） |
| 3. 故障安全 | 12% | 9（阶段可独立回滚） | 7（Three.js风险） | 8（lazy隔离） |
| 4. 工程契约 | 5% | 9（扩展现有Schema） | 7（新增IR需定义） | 8（Adapter接口清晰） |
| 5. 可工程化 | 12% | 9（每阶段独立验证） | 8（WebGL独立测试） | 8（Adapter独立测试） |
| 6. 架构一致性 | 15% | 10（完全在分层内） | 8（需调整边界） | 8（新增adapter层） |
| 7. 长期演进 | 18% | 7（可演进至IR核心） | 10（终极架构） | 8（易扩展新格式） |
| 8. 边界健壮 | 10% | 8（逆向风险可控） | 7（GLSL语义差异） | 7（第三方工具依赖） |
| **加权总分** | **100%** | **8.49** | **8.21** | **7.90** |

---

## 四、推荐方案及理由

### 推荐：方案 A（渐进式增强）

**理由**：

1. **对齐项目原则**：满足"最小改动、可验证、可回滚"的开发偏好，符合 workspace rules 第 4 条禁止一次性重构的约束
2. **风险可控**：每阶段独立交付、独立验证、独立回滚，故障爆炸半径小
3. **路径可达**：阶段三的完成后，已建立 SCE/CE 解析基础，后续可平滑演进至 IR 核心（方案 B 的终态）
4. **零新依赖**：不引入 Three.js/PixiJS 等重依赖，bundle 体积零增长
5. **契约安全**：14-token 生成路径不变，theme-staleness 校验链不破坏

**牺牲项**：
- 暂不引入真正的可交互预览引擎（阶段三后可 Studio 窗口实现）
- Canvas 2D 渲染能力上限不变（复杂 shader 场景保持降级）

**收益项**：
- 2-3 周内完成，每周可交付一个可用版本
- 现有 1336+ 测试零修改
- 为后续 IR 核心奠定 SCE/CE 解析数据基础

---

## 五、执行计划

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

验收标准：
- 30MB+ scene/pkg 渲染不阻塞 IPC
- SCE/CE 项目在预览面板正确渲染
- 渲染结果缓存命中时零延迟

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

## 六、风险清单

| 风险 | 等级 | 缓解策略 |
|------|------|---------|
| SCE/CE 格式未知版本检测失败 | 中 | fallback 到 web/image 路径，UI 降级提示 |
| Worker 线程传递 Buffer 失败 | 低 | worker 内重新 extractScene（不跨线程传 Buffer） |
| scene.pkg 被 Steam 更新后缓存失效 | 低 | 缓存 key = `${pkgPath}:${mtime}`，rescan 触发清理 |
| CDP evaluate 超时影响副表面 | 低 | buildContinuationMountJs try/catch 兜底 |

---

## 七、后续演进路径

Phase 3 完成后，已具备：
- SCE/CE 解析基础设施
- 异步渲染管线
- 全类型 wallpaper↔theme 联动

下一里程碑可演进至「引擎核心 IR」：
1. 从 `SceneData` 派生 `SceneIR`（首版仅 PKG→IR）
2. 引入 WebGL 渲染后端（PixiJS 或 Three.js）可选升级
3. Studio 窗口集成可交互预览引擎

此演进路径保持架构一致性，无需推倒重构。

---

## 八、名词术语

| 术语 | 定义 |
|------|------|
| SCE | Sucrose Engine 场景格式（JSON-based），含粒子、图层描述 |
| CE | Cyclone Engine 场景格式（Binary），另一主流壁纸引擎格式 |
| IR | Intermediate Representation，引擎核心中间表示 |
| Continuation | 副表面共享主表面背景图的轻量注入方案 |
| 14-token | AgentSkin 主题契约中的 14 个语义色彩 token |
