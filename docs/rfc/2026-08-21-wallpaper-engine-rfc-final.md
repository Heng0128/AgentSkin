# RFC 2026-08-21 FINAL — 壁纸引擎增强与主题/注入联动

- **状态**: APPROVED
- **作者**: AgentSkin Team
- **日期**: 2026-08-21
- **版本**: FINAL（多子智能体3批次并行执行后定稿）
- **相关**: docs/ARCHITECTURE.md, theme-wallpaper.ts, scene-renderer-html.md

---

## 一、执行摘要

本 RFC 通过 3 批次 × 多子智能体并行执行，完成了壁纸引擎增强方案的设计、审计、验证全流程。

**最终推荐方案：方案 E'（分层融合精简版）**，聚焦 5 个核心改动，砍掉 SVG 渲染、桌面嵌入等对 AgentSkin 不直接相关的能力。

---

## 二、5 个核心改动（按优先级排序）

### C1. PKG 深度解析增强（最核心）

**目标**：补齐当前 PKG/TEX 解析盲区，支持更多 Wallpaper Engine 壁纸

| 盲区 | 当前状态 | 增强方案 | 工作量 |
|------|---------|---------|--------|
| BC7 纹理 | 不支持，静默丢弃 | 移植 bcdec.h 为纯 TS 模块 | ~3h |
| PKG 版本 | 不区分 V0001/V0002 | 读取 HeaderSize 字段 | ~15min |
| TEXV0006 | 硬编码拒绝 | 白名单扩展 | ~30min |
| 层级树 | 未构建 | SceneData 增加 layerTree | ~1h |
| general 字段 | 不完整 | 按需追加 | 持续 |

**关键文件**：
- `src/main/scene/tex-parser.ts` — 新增 BC7 解压 + TEXV0006 支持
- `src/main/scene/pkg-parser.ts` — 新增版本兼容层
- `src/main/scene/scene-extractor.ts` — 新增层级树构建

**参考**：RePKG (github.com/notscuffed/repkg, MIT)

---

### C2. 预览图三档渐进加载

**目标**：列表秒开 + 预览高清 + 按需加载原图

| 档位 | 精度 | 加载时机 | 技术方案 |
|------|------|---------|---------|
| L0 元数据 | KB 级 | 扫描完成 | 仅标题/类型/作者 |
| L1 高清预览 | 1920px | 卡片入屏 | Electron nativeImage（零新依赖）|
| L2 原图 | 2K/4K | 点击详情 | 现有 previewUrl 路径 |

**缓存策略**：
- 内存索引：Map<string, CacheEntry>，200 条 LRU
- 磁盘缓存：`<userData>/preview-cache/<hash>.webp`，200 MB
- 缓存 key：`sha1(sourcePath + mtime + tier)`

**关键文件**：
- `src/main/wallpaper/preview-cache.ts` — 新建缓存管理器
- `src/main/ipc/wallpaper-ipc.ts` — 新增 WALLPAPER_PREVIEW_URL handler
- `src/main/wallpaper/adapter.ts` — list() 不再注册预览 URL
- `src/ui/components/wallpaper/WallpaperCard.tsx` — 按 tier 请求 URL

---

### C3. SCE/CE 分档解析

**目标**：支持 Sucrose (SCE) 和 Cyclone (CE) 壁纸引擎格式

| 档位 | SCE 实现 | CE 实现 |
|------|---------|---------|
| L0 识别 | 目录含 project.json | 目录含 scene.dat + magic bytes |
| L1 元数据 | 读 project.json 标题/作者 | 读 meta.json 或目录名推断 |
| L2 预览图 | 目录内 preview.jpg/png | 同上 |
| L3 场景结构 | 完整 JSON → SceneData | 首版最小 SceneData + 预留接口 |

**关键文件**：
- `src/main/scene/sce-parser.ts` — 新建 SCE JSON 解析器
- `src/main/scene/ce-parser.ts` — 新建 CE 二进制探测 + 元数据回退

---

### C4. 自动主题生成管线

**目标**：壁纸 → 14-token 主题一键生成

**管线流程**：
```
壁纸图片 → color-thief 主色提取 → OKLCH 量化 → HCT 转换 → Tonal Palette → 14-token 映射
```

**14-token 映射规则**：
| Token | HCT 来源 | 策略 |
|-------|----------|------|
| --ag-accent | 主色 chroma 最高 | tone 80 |
| --ag-background | 最暗色调 | tone 8(暗)/92(亮) |
| --ag-surface | 浅色调 | tone 12(暗)/88(亮) |
| --ag-text | WCAG 对比度最高 | ≥ 4.5:1 |
| ... | ... | ... |

**关键文件**：
- `src/main/theme/wallpaper-color-engine.ts` — 新建引擎封装
- `src/main/theme/wallpaper-theme.ts` — 替换采样→引擎调用
- `package.json` — 新增 color-thief + @material-color-utilities

**依赖**：
- color-thief (MIT, ~15KB) — 主色提取
- @material-color-utilities (Apache-2.0, ~50KB) — HCT + Tonal Palette

---

### C5. 三层渲染降级

**目标**：轻薄本到游戏本全覆盖，按设备能力自动降级

| 层级 | 名称 | 技术 | 覆盖 |
|------|------|------|------|
| L1 | 静态高清 | CSS background-image | 80% |
| L2 | 轻动画 | Canvas 2D + rAF (30FPS cap) | 15% |
| L3 | GPU 预留 | WebGL capability probe | 5% |

**关键文件**：
- `src/shared/types/wallpaper.ts` — 新增 renderTier 字段
- `src/main/scene-renderer-capability.ts` — 新建能力检测
- `src/main/scene-renderer-html.ts` — 新增 renderSceneToStaticHtml
- `src/main/wallpaper-injector.ts` — scene 注入按 tier 分流

---

## 三、全链路审计发现的问题（10 个）

### 阻塞级 (3)

| # | 问题 | 影响 | 修复 |
|---|------|------|------|
| B1 | Worker 无复用池 | 切换壁纸时反复 new/terminate，~100ms × N 卡顿 | 引入 WorkerPool |
| B2 | theme: 壁纸 rescan 未清理 | 主题多次安装旧条目残留 | rescan 释放 theme: 前缀 |
| B3 | 目录名直接作为 ID | 畸形路径可能碰撞 | 增加路径校验 |

### 建议级 (4)

| # | 问题 | 修复 |
|---|------|------|
| S1 | fallback 选图不一致 | 统一选最大图 |
| S2 | 主题注册无反馈 | 增加 notification |
| S3 | 缓存 key 无 mtime | 加 mtime 组合 |
| S4 | list 串行生成 preview | 并发 pool |

### 优化级 (3)

| # | 问题 | 修复 |
|---|------|------|
| N1 | 并发硬编码 | 提取常量 |
| N2 | 错误态覆盖不全 | 补充 IPC 失败场景 |
| N3 | bare-image fallback 随机命中 | 按尺寸排序 |

---

## 四、集成验证发现的阻塞项 (3)

| # | 阻塞项 | 解决方案 |
|---|--------|---------|
| I1 | color-thief 与现有 BGRA 契约不匹配 | 适配层转换 RGB ↔ BGRA |
| I2 | IPC 通道无渐进预览 | 新增 WALLPAPER_PREVIEW_URL |
| I3 | 自动主题生成 fallback 未定义 | color-thief 失败 → median-cut → 暗色默认 |

---

## 五、执行计划（4 周迭代）

### Week 1: PKG 深度解析 + 审计修复

| 任务 | 文件 | 产出 |
|------|------|------|
| BC7 解压 | tex-parser.ts | BC7 纹理支持 |
| PKG 版本兼容 | pkg-parser.ts | V0001/V0002 兼容 |
| TEXV0006 | tex-parser.ts | 新版 TEX 支持 |
| Worker 池化 | scene-renderer-async.ts | Worker 复用 |
| 审计问题修复 | 多文件 | 10 个问题全部修复 |

### Week 2: 预览图分档 + SCE/CE 解析

| 任务 | 文件 | 产出 |
|------|------|------|
| PreviewCache | preview-cache.ts | 缓存管理器 |
| IPC 扩展 | wallpaper-ipc.ts | 渐进预览通道 |
| SCE 解析 | sce-parser.ts | Sucrose 支持 |
| CE 解析 | ce-parser.ts | Cyclone 支持 |

### Week 3: 自动主题生成

| 任务 | 文件 | 产出 |
|------|------|------|
| 引擎封装 | wallpaper-color-engine.ts | color-thief + Material |
| 14-token 映射 | token-generator.ts | 完整映射规则 |
| 集成测试 | 多文件 | 端到端验证 |

### Week 4: 渲染降级 + 集成验证

| 任务 | 文件 | 产出 |
|------|------|------|
| 能力检测 | scene-renderer-capability.ts | L1/L2/L3 探测 |
| L1 静态渲染 | scene-renderer-html.ts | renderSceneToStaticHtml |
| FPS 自适应 | scene-renderer-html-scripts.ts | 动态降级 |
| 全链路验证 | 测试套件 | 所有测试通过 |

---

## 六、风险清单

| 风险 | 等级 | 缓解 |
|------|------|------|
| BC7 解压性能 | 中 | WASM 加速或降采样 |
| color-thief 失败 | 中 | fallback 到 median-cut |
| 预览缓存满 | 低 | LRU 淘汰 |
| SCE/CE 格式变化 | 中 | 防御式解析 + 默认值 |
| WebGL 不可用 | 低 | 自动 fallback 到 L2 |
| Worker 池死锁 | 低 | 超时 + 重启机制 |

---

## 七、验收标准

### PKG 解析
- [ ] BC7 纹理正确解码
- [ ] PKG V0001/V0002 均可解析
- [ ] TEXV0006 文件不拒绝
- [ ] 层级树正确构建

### 预览图分档
- [ ] 列表加载 < 100ms（L0 元数据）
- [ ] 卡片入屏后 < 200ms 显示 L1 预览
- [ ] 缓存命中率 > 80%
- [ ] 磁盘缓存不超过 200MB

### SCE/CE 解析
- [ ] SCE 项目正确识别 + 元数据提取
- [ ] CE 项目正确识别 + 降级展示
- [ ] 渲染层无需关心来源格式

### 自动主题
- [ ] 壁纸→14-token < 200ms
- [ ] WCAG 对比度 ≥ 4.5:1
- [ ] 失败时 fallback 到现有管线

### 渲染降级
- [ ] 轻薄本自动使用 L1
- [ ] FPS < 15 持续 3s 自动降级
- [ ] 用户可手动锁定层级

---

## 八、下一步行动

### 立即执行
1. ✅ RFC 评审通过
2. 🔨 Week 1 启动：PKG 深度解析 + 审计修复
3. 📦 RePKG 算法预研：验证 BC7 解压移植可行性

### 暂缓执行
1. L3 WebGL 完整实现 — 等 WebGPU 普及率提升
2. WDL 声明式 DSL — 作为远期高级创作格式
3. AI 驱动壁纸生成 — 独立 RFC

### 舍弃
1. 桌面壁纸嵌入（weebp）— AgentSkin 不是桌面壁纸工具
2. SVG 渲染（resvg）— 当前不需要
3. 图片预处理（image-rs/Photon）— 不是瓶颈

---

## 九、名词术语

| 术语 | 定义 |
|------|------|
| PKG | Wallpaper Engine 场景包格式 |
| SCE | Sucrose Engine 场景格式（JSON-based） |
| CE | Cyclone Engine 场景格式（Binary） |
| BC7 | 高质量纹理压缩格式（DX10+） |
| TEXV0005/6 | Wallpaper Engine 纹理格式版本 |
| HCT | Hue-Chroma-Tone，Google Material You 感知色彩空间 |
| Tonal Palette | HCT 色彩空间的 13 级色阶 |
| 14-token | AgentSkin 主题契约中的 14 个语义色彩 token |
| nativeImage | Electron 内置图片处理模块 |
| LRU | Least Recently Used，最近最少使用淘汰算法 |
