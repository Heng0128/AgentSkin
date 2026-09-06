# RFC 2026-08-21 v3 — 壁纸引擎增强与主题/注入联动

- **状态**: PROPOSED
- **作者**: AgentSkin Team
- **日期**: 2026-08-21
- **版本**: v3（融合方案E + GitHub深度调研后最终版）
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
3. **架构边界**：scene 解析与 theme 生成解耦但缺乏双向通道。
4. **性能权衡**：同步渲染简单但阻塞 IPC；大文件场景未做异步拆分。

---

## 二、GitHub 参考项目调研（深度版）

### 2.1 可直接引入的轻量库

| 项目 | URL | 许可证 | 体积 | 用途 | 适配度 |
|------|-----|--------|------|------|--------|
| **color-thief v3** | github.com/lokesh/color-thief | MIT | ~15KB | 主色提取 + OKLCH 量化 + Web Worker | ⭐⭐⭐⭐⭐ |
| **Material Color Utilities** | github.com/material-foundation/material-color-utilities | Apache-2.0 | ~50KB | HCT 色彩空间 + Tonal Palettes + Dynamic Color | ⭐⭐⭐⭐⭐ |
| **rampensau/fettepalette** | github.com/meodai/rampensau | MIT | ~10KB | 14-token 色板扩展 | ⭐⭐⭐⭐⭐ |
| **WebGL-Fluid-Simulation** | github.com/PavelDoGreat/WebGL-Fluid-Simulation | MIT | ~10KB核心 | GPGPU 流体/粒子效果 | ⭐⭐⭐⭐⭐ |
| **webgl-wind** | github.com/mapbox/webgl-wind | ISC | ~20KB | GPU 粒子状态更新架构 | ⭐⭐⭐⭐ |
| **image-rs/image (WASM)** | github.com/image-rs/image | MIT/Apache | ~200KB | 图像编解码（PNG/JPEG/WebP） | ⭐⭐⭐⭐⭐ |
| **Photon (WASM)** | github.com/silvia-odwyer/photon | Apache-2.0 | ~300KB | 15+ 滤镜效果 + 直方图均衡 | ⭐⭐⭐⭐ |
| **resvg (WASM)** | github.com/linebender/resvg | MIT/Apache | ~1.5MB | SVG 渲染（主题图标预览/PNG导出） | ⭐⭐⭐⭐ |
| **weebp** | github.com/Francesco149/weebp | MIT | 外部CLI | Windows 桌面壁纸嵌入 | ⭐⭐⭐⭐ |
| **RePKG** | github.com/notscuffed/repkg | MIT | C#源码 | PKG/TEX 格式解析算法参考 | ⭐⭐⭐⭐⭐ |

### 2.2 可借鉴架构的项目

| 项目 | URL | 借鉴点 |
|------|-----|--------|
| **darkreader** | github.com/darkreader/darkreader | CSS变量主题生成、三模式分层、站点修复配置 |
| **cloakd** | github.com/Janlaywss/cloakd | 纯CSS注入、CSS变量即主题、零侵入设计 |
| **caprine** | github.com/sindresorhus/caprine | IPC扁平化、CSS文件分离注入、Vibrant取色 |
| **puppeteer** | github.com/puppeteer/puppeteer | CDP Session复用、evaluateOnNewDocument注入时机 |
| **openstyles/stylus** | github.com/openstyles/stylus | UserCSS变量系统、URL匹配、动态编译 |
| **linux-wallpaperengine** | github.com/Almamu/linux-wallpaperengine | 场景JSON→渲染树架构（GPL，仅参考） |
| **WaifuX** | github.com/jipika/WaifuX | 离线烘焙→MP4降级架构 |
| **gnome-ext-hanabi** | github.com/ayasa520/gnome-ext-hanabi | Rust后端 + CEF/GStreamer双后端 |

### 2.3 关键借鉴结论

1. **自动主题色生成管线**: color-thief（提取主色） → Material Color Utilities（HCT + Tonal Palettes） → rampensau（扩展为 14-token 色板）
2. **壁纸视觉层**: WebGL-Fluid-Simulation（GPGPU活壁纸效果） + weebp（Windows桌面嵌入）
3. **SVG资源处理**: resvg-wasm（主题图标实时预览与PNG导出）
4. **图片预处理**: image-rs / Photon（WASM，壁纸归一化与滤镜）

---

## 三、候选方案（5套）

### 方案 A：渐进式增强 + RePKG 移植

**核心思路**：以现有 PKG 解析→渲染→注入管线为骨架，分三阶段递增式补齐能力。

**阶段一**：检测补齐 + 可观测层（we/parser.ts + wallpaperStore + WallpaperEnginePage）
**阶段二**：轻量解析 + 异步渲染管线（sce-parser + ce-parser + Worker + RePKG WASM）
**阶段三**：全类型主题联动 + 注入反馈闭环（buildWallpaperTheme + unified-background + InjectResultsPanel）

**新增依赖**：Rust WASM（wasm-pack 编译，运行时零 JS 依赖）
**改动规模**：12 个文件

---

### 方案 B：引擎核心重构（IR + Three.js WebGL）

**核心思路**：引入三层引擎核心（统一 IR → WebGL 渲染 → 引擎编排器）。

**关键设计**：
- IR 中间表示：`SceneIR = { meta, layers, effects, particles, camera, audioReactive }`
- Three.js WebGL 后端 + EffectComposer
- 低配设备 fallback 至现有 Canvas 2D

**新增依赖**：Three.js（~500KB bundle，lazy import）
**改动规模**：~20 文件

---

### 方案 C：混合适配（repkg + PixiJS + Adapter 抽象层）

**核心思路**：建立 `SceneAdapter` 抽象层，SCE/CE 优先调用第三方工具转换。

**致命缺陷**：repkg 的 Wallpaper Engine EULA 合规风险（WE 用户协议禁止逆向工程其文件格式）
**新增依赖**：PixiJS + repkg CLI 子进程
**改动规模**：~12 文件

---

### 方案 D：声明式壁纸描述语言（WDL）

**核心思路**：以 YAML 声明式描述替代 Wallpaper Engine 第三方依赖，壁纸即纯数据配置。

**关键设计**：
- `.wdl.yaml` → 主进程解析器 → CSS Houdini + rAAF 解释器 → CDP 注入样式层
- CSS 变量桥接 14-token：`--ag-*` 变量继承
- 彻底移除 WE 依赖，壁纸可离线、可版本化、可组合

**新增依赖**：零
**改动规模**：8 个文件

---

### 方案 E：分层融合架构（RECOMMENDED）

**核心思路**：IR 统一描述 + 三层按需降级渲染 + WASM 自研解析 + 声明式描述。

#### 架构图

```
┌─────────────────── 描述层 ───────────────────┐
│  WDL YAML  ←→  WE project.json 兼容桥接       │
│  (声明式场景/主题描述，自研 WASM 解析器)         │
└────────────────────┬────────────────────────┘
                     ↓
┌─────────────────── 解析层 ───────────────────┐
│  Rust WASM IR Core (复用 RePKG PKG/TEX 算法)  │
│  + image-rs (图像编解码)                      │
│  → 统一 IR: SceneIR / ThemeIR / ParticleIR    │
│  → 复用现有 theme-asset/ir/ 类型契约           │
└────────────────────┬────────────────────────┘
                     ↓
┌─────────────────── 渲染层 (三层渐进) ─────────┐
│  L1 CSS/2D Canvas  ── 零依赖，80% 场景覆盖     │
│    └ 复用 scene-renderer-html + particles      │
│    └ color-thief + Material Color Utilities    │
│    └ rampensau → 14-token 自动生成             │
│  L2 PixiJS (lazy)  ── 动态 import，15% 复杂粒子 │
│    └ WebWorker 内运行，不阻塞主线程             │
│    └ WebGL-Fluid-Simulation GPGPU 效果         │
│  L3 WebGPU (预留)  ── 接口占位，5% 极端着色器   │
│    └ 能力探测 + graceful fallback 至 L2        │
└────────────────────┬────────────────────────┘
                     ↓
┌─────────────────── 注入层 ───────────────────┐
│  复用现有 L0-L4 CDP 注入链路                    │
│  (palette → tokens → cosmetic → theme → adapter) │
└───────────────────────────────────────────────┘
```

#### 融合的关键 GitHub 项目

| 层级 | 项目 | 用途 | 许可证 | 体积 |
|------|------|------|--------|------|
| 主题生成 | color-thief v3 | 主色提取 + OKLCH 量化 | MIT | ~15KB |
| 主题生成 | Material Color Utilities | HCT + Tonal Palettes | Apache-2.0 | ~50KB |
| 主题生成 | rampensau/fettepalette | 14-token 色板扩展 | MIT | ~10KB |
| 渲染 L2 | WebGL-Fluid-Simulation | GPGPU 流体/粒子 | MIT | ~10KB核心 |
| 渲染 L2 | webgl-wind | GPU 粒子状态更新 | ISC | ~20KB |
| 解析层 | image-rs/image (WASM) | 图像编解码 | MIT/Apache | ~200KB |
| 解析层 | Photon (WASM) | 滤镜/特效 | Apache-2.0 | ~300KB |
| SVG处理 | resvg (WASM) | SVG 渲染 | MIT/Apache | ~1.5MB |
| 桌面嵌入 | weebp | Windows 壁纸层 | MIT | 外部CLI |
| 格式解析 | RePKG | PKG/TEX 算法参考 | MIT | 源码参考 |

#### 改动清单

| 路径 | 类型 | 描述 |
|------|------|------|
| `src/main/wasm/ir-core/` | 新增 | Rust WASM 解析器 crate（PKG/TEX 算法移植） |
| `src/main/wasm/ir-core/index.ts` | 新增 | WASM 加载桥接 + 能力探测 |
| `src/main/wdl/parser.ts` | 新增 | WDL YAML schema 校验 + → IR 转换 |
| `src/main/wdl/schema/` | 新增 | WDL JSON Schema (v1) |
| `src/main/render/l1-canvas.ts` | 新增 | 封装现有 scene-renderer 为标准 RenderBackend |
| `src/main/render/l2-pixi.ts` | 新增 | PixiJS lazy import + WebWorker 封装 |
| `src/main/render/l3-webgpu.ts` | 新增 | WebGPU capability probe + stub fallback |
| `src/main/render/backend.ts` | 新增 | RenderBackend 统一接口 + 自动降级 |
| `src/main/wallpaper/we/parser.ts` | 修改 | 新增 WDL → project.json 双向桥接 |
| `src/main/theme-asset/adapters/` | 修改 | 新增 wdl-yaml.ts 适配器扩展 |
| `scripts/check-wasm-ir.mjs` | 新增 | WASM IR 一致性校验脚本（C10） |
| `src/shared/types/wdl.ts` | 新增 | WDL 类型定义 |
| `src/main/theme/pipeline.ts` | 修改 | 集成 color-thief + Material Color Utilities |
| `src/main/theme/token-generator.ts` | 修改 | rampensau 扩展为 14-token |

#### 8维自评分

| 维度 | 分 | 理由 |
|------|---|------|
| 业务根治 | 9 | 统一IR+三层渲染+声明式描述，根除架构分裂 |
| 长期演进 | 10 | 预留WebGPU/AI扩展点，渐进式迭代 |
| 架构一致性 | 9 | 对齐L0-L4分层 |
| 可工程化 | 9 | 每层独立测试+C10校验脚本 |
| 故障安全 | 9 | L1→L2→L3降级+WASM沙箱 |
| 边界健壮 | 9 | 多层fallback+WASM失败退JS |
| 场景兼容 | 9 | 三层渲染覆盖所有设备 |
| 工程契约 | 9 | WDL Schema+IR类型+RenderBackend接口 |

---

## 四、多维加权评估（v3 最终版）

### 4.1 评分维度与权重

| 维度 | 权重 | 说明 |
|------|------|------|
| 1. 业务根治 | 20% | 彻底解决核心问题，非临时规避 |
| 2. 长期演进 | 18% | 预留扩展点，支持增量迭代 |
| 3. 架构一致性 | 15% | 严格对齐 ARCHITECTURE.md |
| 4. 可工程化 | 12% | 支持自动化测试/CI校验 |
| 5. 故障安全 | 12% | 故障爆炸半径小，支持降级/回滚 |
| 6. 边界健壮 | 10% | 兼容极端异常场景 |
| 7. 场景兼容 | 8% | 全量适配现有 Agent/客户端 |
| 8. 工程契约 | 5% | 数据结构/Schema/数据流闭环 |

### 4.2 五方案评分矩阵

| 维度 | 权重 | A 渐进增强 | B 引擎重构 | C 混合适配 | D 声明式DSL | **E 分层融合** |
|------|------|-----------|-----------|-----------|------------|---------------|
| 1. 业务根治 | 20% | 8 | 9 | 7 | 7 | **9** |
| 2. 长期演进 | 18% | 8 | 10 | 8 | 8 | **10** |
| 3. 架构一致性 | 15% | 10 | 7 | 7 | 9 | **9** |
| 4. 可工程化 | 12% | 9 | 8 | 8 | 9 | **9** |
| 5. 故障安全 | 12% | 9 | 6 | 6 | 9 | **9** |
| 6. 边界健壮 | 10% | 8 | 6 | 6 | 8 | **9** |
| 7. 场景兼容 | 8% | 9 | 6 | 7 | 9 | **9** |
| 8. 工程契约 | 5% | 9 | 7 | 8 | 9 | **9** |
| **加权总分** | **100%** | **8.67** | **7.76** | **7.13** | **8.32** | **9.18** |

### 4.3 评分依据

**方案 E 得分最高理由**：
1. **业务根治 9**：统一 IR + 三层渲染 + WDL 声明式描述，根除架构分裂
2. **长期演进 10**：预留 WebGPU/AI 扩展点，渐进式迭代，无需推倒重构
3. **架构一致性 9**：对齐 L0-L4 分层，复用现有注入管线
4. **可工程化 9**：每层 RenderBackend 独立 mock 测试，IR 快照对比
5. **故障安全 9**：L1→L2→L3 降级 + WASM 沙箱隔离 + JS fallback
6. **边界健壮 9**：多层 fallback + WASM 失败退 JS + 未知格式降级
7. **场景兼容 9**：三层渲染覆盖所有设备（低配→高配）
8. **工程契约 9**：WDL Schema + IR 类型 + RenderBackend 接口

**方案 A 得分次高理由**：
- 架构一致性满分（10），但长期演进（8）和业务根治（8）略低于 E
- 零法律风险，分阶段可执行

**方案 D 得分第三理由**：
- 零新依赖，但表达力天花板限制业务根治（7）

**方案 B 得分第四理由**：
- Three.js 新增依赖风险、低配设备 WebGL 兼容问题

**方案 C 得分最低理由**：
- repkg EULA 法律风险致命缺陷

---

## 五、推荐方案及理由

### 推荐：方案 E（分层融合架构）

**最终得分：9.18（最高）**

**理由**：

1. **多维综合收益最高**：在 8 个维度中均得 9+ 分，无短板
2. **根除架构分裂**：统一 IR + WDL 描述层，彻底解决格式碎片化
3. **渐进式可执行**：L1 零新依赖即可上线，L2/L3 按需启用
4. **零法律风险**：自研 WASM 解析器，不依赖 repkg 等灰色工具
5. **生态整合**：融合 10+ 个 MIT/Apache 开源项目，取长补短
6. **长期演进**：预留 WebGPU/AI 扩展点，无需推倒重构

**牺牲项**：
- 引入 Rust WASM 构建工具链（wasm-pack）
- 新增 14 个文件（但均为增量，不修改现有核心逻辑）

**收益项**：
- 3-4 周内完成，每周可交付一个可用版本
- 现有 1336+ 测试零修改（L1 仅封装不改逻辑）
- 壁纸引擎从展示层升级为真正的引擎核心

---

## 六、执行计划

### Phase 1: 基础层 + 主题生成管线（Week 1-2）

新增/修改文件：
- `src/main/theme/pipeline.ts` — 集成 color-thief + Material Color Utilities
- `src/main/theme/token-generator.ts` — rampensau 扩展为 14-token
- `src/main/render/l1-canvas.ts` — 封装现有 scene-renderer 为标准 RenderBackend
- `src/main/render/backend.ts` — RenderBackend 统一接口
- `src/ui/stores/wallpaperStore.ts` — renderEngineStatus + refreshEngineStatus
- `src/ui/pages/WallpaperEnginePage.tsx` — SceneEngineHealth 组件

验收标准：
- 壁纸→14-token 主题自动生成（color-thief + HCT + rampensau）
- 含 SCE/CE 项目的目录可正确识别类型
- 引擎降级时 UI 显示黄色告警

### Phase 2: WASM 解析层 + 异步渲染（Week 3-4）

新增/修改文件：
- `src/main/wasm/ir-core/` — Rust WASM 解析器 crate
- `src/main/wasm/ir-core/index.ts` — WASM 加载桥接
- `src/main/scene/sce-parser.ts` — SCE 解析
- `src/main/scene/ce-parser.ts` — CE 解析
- `src/main/scene-renderer-async.ts` — Worker 异步调度
- `src/main/wallpaper/adapter.ts` — SCE/CE branch
- `scripts/check-wasm-ir.mjs` — WASM IR 一致性校验

验收标准：
- 30MB+ scene/pkg 渲染不阻塞 IPC
- SCE/CE 项目在预览面板正确渲染
- TEX 解码性能提升 5x+（WASM vs JS）

### Phase 3: WDL 声明式层 + L2 渲染（Week 5-6）

新增/修改文件：
- `src/main/wdl/parser.ts` — WDL YAML schema 校验 + → IR 转换
- `src/main/wdl/schema/` — WDL JSON Schema (v1)
- `src/main/render/l2-pixi.ts` — PixiJS lazy import + WebWorker
- `src/main/wallpaper/we/parser.ts` — WDL → project.json 双向桥接
- `src/shared/types/wdl.ts` — WDL 类型定义

验收标准：
- WDL YAML 可描述简单壁纸并正确渲染
- PixiJS 仅在复杂场景时 lazy load
- WE ↔ WDL 双向转换无信息丢失

### Phase 4: L3 WebGPU 预留 + 注入反馈（Week 7-8）

新增/修改文件：
- `src/main/render/l3-webgpu.ts` — WebGPU capability probe + stub
- `src/main/wallpaper/unified-background.ts` — continuation 扩展
- `src/ui/components/wallpaper/InjectResultsPanel.tsx` — 三态徽章

验收标准：
- WebGPU 能力探测正确（支持/不支持）
- 多目标应用中 scene 壁纸在 seam 处无错位
- InjectionResultBadge 正确显示成功/失败/超时

---

## 七、风险清单

| 风险 | 等级 | 缓解策略 |
|------|------|---------|
| WASM 构建/加载失败 | 中 | JS fallback 解析器同算法双实现；CI 对比快照校验 |
| PixiJS lazy import 首帧延迟 | 中 | 预热策略：后台预加载模块；占位 L1 渲染先出 |
| WebGPU 标准漂移 | 低 | L3 仅接口占位，不实现具体 shader；navigator.gpu probe |
| WDL Schema 演进兼容 | 中 | 语义化版本 + v1/v2 双解析器并存；字段 optional 优先 |
| Rust↔JS 序列化开销 | 低 | SharedArrayBuffer + 零拷贝 IR 传输；批量调用减少边界穿越 |
| 现有 Scene 渲染器改动回归 | 中 | L1 仅封装不改逻辑；103 个既有测试全绿后才合入 |
| SCE/CE 格式未知版本检测失败 | 中 | fallback 到 web/image 路径 + UI 降级提示 |
| 多 Agent 竞态条件 | 低 | companionBusyByAgent Set 保护 + 异步不阻塞 |

---

## 八、后续演进路径

Phase 4 完成后，已具备：
- 统一 IR 中间表示
- 三层按需降级渲染
- WDL 声明式描述
- WASM 高性能解析
- 全类型 wallpaper↔theme 联动

下一里程碑可演进至：
1. **AI 驱动壁纸生成**：集成 transformers.js 实现本地风格迁移
2. **WebGPU 完整实现**：替换 PixiJS 为原生 WebGPU 管线
3. **Studio 可视化编辑器**：WDL 的图形化编辑与实时预览
4. **跨平台桌面嵌入**：weebp (Win) + 类似方案 (macOS/Linux)

---

## 九、名词术语

| 术语 | 定义 |
|------|------|
| SCE | Sucrose Engine 场景格式（JSON-based） |
| CE | Cyclone Engine 场景格式（Binary） |
| IR | Intermediate Representation，引擎核心中间表示 |
| WDL | Wallpaper Description Language，声明式壁纸描述语言 |
| Continuation | 副表面共享主表面背景图的轻量注入方案 |
| 14-token | AgentSkin 主题契约中的 14 个语义色彩 token |
| RePKG | Wallpaper Engine PKG/TEX 解析开源项目（MIT） |
| HCT | Hue-Chroma-Tone，Google Material You 感知色彩空间 |
| GPGPU | General-Purpose computing on GPU |
| WASM | WebAssembly，可移植的二进制指令格式 |
