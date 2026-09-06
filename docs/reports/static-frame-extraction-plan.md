# 静态帧提取方案实施计划

> **目标**：基于现有 PKG/TEX 解析管线，实现"静态帧降级链"——从 Wallpaper Engine Scene 中提取最佳静态图像，用于壁纸预览/缩略图。
>
> **日期**：2026-08-28
>
> **前置研究**：Scene 特性支持矩阵、RePKG TEX 格式规范、现有代码审计

---

## 1. 现状分析

### 1.1 已有能力（无需新建）

| 模块 | 文件 | 状态 |
|------|------|------|
| PKG 容器解析 | `src/main/scene/pkg-parser.ts` | ✅ 完整（V0001/V0002 + Legacy） |
| TEX 纹理解码 | `src/main/scene/tex-parser.ts` | ✅ 完整（DXT1/3/5/BC7 modes 0-3, R8, RG88） |
| LZ4 解压 | `src/main/lz4-decoder.ts` | ✅ 纯 JS 实现 |
| Scene JSON 解析 | `src/main/scene/scene-json-parser.ts` | ✅ 类型化 |
| 场景提取编排 | `src/main/scene/scene-extractor.ts` | ✅ 含 30s 缓存 |
| Canvas 2D 渲染 | `src/main/scene-renderer-html.ts` | ✅ 可渲染图层+粒子 |
| 预览缓存 | `src/main/wallpaper/preview-cache.ts` | ✅ 使用 omggif + pngjs |
| Wallpaper Store | `src/ui/stores/wallpaperStore.ts` | ✅ Zustand + IPC |

### 1.2 已知缺陷（需修复）

| Bug | 描述 | 影响 | 修复量 |
|-----|------|------|--------|
| D1 | BC7 modes 0-3 端点读取顺序错误（per-endpoint vs per-channel） | ~30-40% BC7 壁纸色彩通道错误 | ~36 行 |
| D2 | BC7 mode 3 Pbit 数量错误（2 vs 4） | Mode 3 index 偏移 2 位 | ~5 行 |

### 1.3 缺失能力（需新建）

| 能力 | 说明 | 优先级 |
|------|------|--------|
| 主纹理评分算法 | 从多个 image 对象中选出"艺术图可能性"最高的纹理 | P0 |
| 静态帧提取服务 | 干净的 API：输入 PKG 路径 → 输出 base64 PNG | P0 |
| 降级链编排 | 合成帧 → 单张主纹理 → preview.jpg → 纯色 | P1 |
| BC7 modes 4-7 | 高级 BC7 模式（rotation + alpha） | P2 |

---

## 2. 实施范围（MVP）

### 2.1 包含

1. **修复 BC7 bugs D1/D2** — 确保现有解码器正确性
2. **主纹理评分算法** — 基于多维度评分选出最佳纹理
3. **静态帧提取服务** — `StaticFrameExtractor` 类
4. **降级链** — 4 级降级保证始终有输出
5. **IPC 集成** — 暴露给 Renderer 进程调用
6. **单元测试** — 覆盖核心路径

### 2.2 不包含（后续迭代）

- BC7 modes 4-7 实现
- 图层合成（Canvas 2D 渲染已有，但不在 MVP 范围）
- WASM 加速
- Worker 池并行

---

## 3. 技术设计

### 3.1 主纹理评分算法

评分维度（权重总和 = 1.0）：

| 维度 | 权重 | 计算方式 |
|------|------|---------|
| 分辨率 | 0.30 | `Math.log2(width * height) / Math.log2(4096 * 4096)` |
| 名称启发式 | 0.20 | 匹配 "hero"、"main"、"background"、"art" 等关键词 |
| 场景尺寸匹配 | 0.15 | `1 - Math.abs(aspectRatio - sceneAspectRatio) / sceneAspectRatio` |
| 宽高比 | 0.15 | 接近 16:9 或 4:3 的得分高 |
| 位置 | 0.10 | 居中位置得分高（position 接近 scene 中心） |
| 不透明度/混合 | 0.10 | opacity=1.0 且 blendMode=normal 得分高 |

### 3.2 降级链

```
Level 0: 合成帧（所有图层 Canvas 合成）
    ↓ 失败
Level 1: 单张主纹理（评分最高的 image 对象）
    ↓ 失败
Level 2: preview.jpg（WE 自带的预览图）
    ↓ 失败
Level 3: 纯色（从 scene.json 提取背景色）
    ↓ 失败
Level 4: 透明 1x1 PNG
```

### 3.3 静态帧提取服务 API

```typescript
class StaticFrameExtractor {
  // 主入口：提取静态帧
  async extractStaticFrame(pkgPath: string): Promise<StaticFrameResult>
  
  // 带缓存的提取
  async extractWithCache(pkgPath: string): Promise<StaticFrameResult>
  
  // 仅获取主纹理（跳过合成）
  async extractMainTexture(pkgPath: string): Promise<StaticFrameResult>
}

interface StaticFrameResult {
  dataUrl: string;        // base64 PNG data URL
  width: number;
  height: number;
  source: 'composite' | 'main-texture' | 'preview' | 'solid-color' | 'transparent';
  score?: number;         // 主纹理评分（仅 main-texture 来源）
}
```

### 3.4 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/main/scene/tex-parser.ts` | 修改 | 修复 BC7 D1/D2 bugs |
| `src/main/scene/texture-scorer.ts` | 新建 | 主纹理评分算法 |
| `src/main/scene/static-frame-extractor.ts` | 新建 | 静态帧提取服务 |
| `src/main/scene/static-frame-ipc.ts` | 新建 | IPC handler |
| `src/main/scene/index.ts` | 修改 | 导出新 API |
| `src/main/wallpaper/preview-cache.ts` | 修改 | 集成静态帧缓存 |
| `src/main/scene/texture-scorer.test.ts` | 新建 | 评分算法测试 |
| `src/main/scene/static-frame-extractor.test.ts` | 新建 | 提取服务测试 |

---

## 4. 实施步骤

### Phase 1：修复 BC7 bugs（~40 行修改）

**目标**：确保 DXT/BC7 解码正确性

1. 修改 `tex-parser.ts` 中 BC7 modes 0-3 的端点读取顺序
2. 修改 mode 3 的 Pbit 数量
3. 补充回归测试

### Phase 2：主纹理评分算法（~150 行新代码）

**目标**：从 scene.json 的 objects 列表中选出最佳纹理

1. 实现 `texture-scorer.ts`
2. 解析 scene.json 的 objects → image 对象列表
3. 对每个 image 对象计算评分
4. 返回评分最高的 image 引用

### Phase 3：静态帧提取服务（~200 行新代码）

**目标**：完整的降级链实现

1. 实现 `static-frame-extractor.ts`
2. Level 0: 调用现有 `scene-renderer-html.ts` 合成帧
3. Level 1: 调用 `texture-scorer` + `tex-parser` 解码主纹理
4. Level 2: 查找并读取 preview.jpg
5. Level 3: 从 scene.json 提取背景色生成纯色图
6. Level 4: 返回透明 1x1 PNG

### Phase 4：IPC 集成 + 缓存（~100 行新代码）

**目标**：Renderer 可调用，结果可缓存

1. 实现 `static-frame-ipc.ts` handler
2. 集成到 `preview-cache.ts`
3. 在 wallpaperStore 中添加调用入口

### Phase 5：测试（~200 行测试代码）

**目标**：核心路径覆盖率 > 90%

1. `texture-scorer.test.ts` — 评分维度、边界条件
2. `static-frame-extractor.test.ts` — 降级链各级 fallback
3. 集成测试 — 真实 PKG 文件端到端

---

## 5. 风险评估

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| BC7 修复引入回归 | 中 | 高 | 补充回归测试，对比修复前后输出 |
| 主纹理评分不准确 | 中 | 中 | 可配置权重，收集用户反馈调整 |
| 大 PKG 解析性能 | 低 | 中 | 使用现有 30s 缓存，异步解析 |
| 特殊 scene.json 格式 | 中 | 低 | 降级链保证始终有输出 |

---

## 6. 验收标准

- [ ] BC7 解码修复后，测试用例全部通过
- [ ] 主纹理评分算法对 10 个测试场景选出正确主纹理
- [ ] 静态帧提取服务对 5 种降级场景正确输出
- [ ] IPC 调用 < 500ms（缓存命中）
- [ ] 单元测试覆盖率 > 90%
- [ ] 无新增 biome/tsc 错误
