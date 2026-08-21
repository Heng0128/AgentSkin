# PKG 壁纸解析器加强 — 最优方案选型报告

> **日期**: 2026-08-22
> **项目**: AgentSkin (desktop-main)
> **范围**: src/main/scene/ → PKG/TEX 解析加强

---

## 一、现状分析摘要

### 1.1 当前格式支持

| 格式 | 解析器 | 评分 | 说明 |
|------|--------|------|------|
| PKG 容器 | pkg-parser.ts | 92/100 | V0001/V0002 双格式，边界校验完善 |
| TEX 纹理 | tex-parser.ts | 58/100 | DXT1/3/5 完整，BC7 modes 4-7 品红占位 |
| scene.json | scene-json-parser.ts | 95/100 | ~33 general + ~47 object 字段全覆盖 |
| SCE | sce-parser.ts | 75/100 | 背景+粒子+效果 |
| CE | ce-parser.ts | 35/100 | 仅 header，图层未实现 |
| BinaryReader | binary-reader.ts | 90/100 | 完整边界校验，零拷贝 subarray |

**综合加权评分: 71/100**

### 1.2 关键缺陷 (按严重度)

| 级别 | 缺陷 | 文件:行号 | 影响 |
|------|------|----------|------|
| **P0** | BC7 modes 4-7 品红占位符 | tex-parser.ts:677-737 | ~50% 现代 WE 壁纸视觉瑕疵 |
| **P0** | BC7 modes 0-3 非位精确 | tex-parser.ts:695-736 | 颜色偏差 |
| **P1** | 全同步 IO | pkg-parser.ts:58, scene-extractor.ts:437,470,507 | 主进程阻塞，140MB PKG 卡 UI |
| **P1** | Worker 不支持 async | scene-renderer-worker.ts:53-55 | 不能安全地异步化 extractScene |
| **P2** | MAX_SCENE_TEXTURE_DIM=2048 硬编码 | tex-parser.ts:84 | 4K 壁纸模糊 |
| **P2** | 手写 PNG 编码器 | tex-parser.ts:963-1015 | 维护成本高 |

### 1.3 测试覆盖现状

| 模块 | 行数 | 覆盖评估 |
|------|------|---------|
| pkg-parser.test.ts | 292 | 良好：正常+边界+V0001/V0002 |
| tex-parser.test.ts | 589 | 良好：DXT1/嵌入PNG/GIF/BC7(部分) |
| binary-reader.test.ts | 61 | 良好：全部越界场景 |
| lz4-decoder.test.ts | 207 | 优秀：全路径+扩展+错误 |
| scene-extractor.test.ts | 487 | 中等：缺 PKG+TEX+JSON 端到端 |

---

## 二、外部调研摘要

### 2.1 PKG/TEX 直接参考

| 项目 | 地址 | 核心价值 | 可移植设计 |
|------|------|---------|----------|
| **RePKG** (notscuffed) | github.com/notscuffed/repkg | PKG/TEX 逆向工程权威实现 | 三层架构(CLI/App/Core)、Strategy 模式读取器、两段式解压管线(LZ4→DXT→RGBA) |
| **RePKG.Neo** (masterLazy) | github.com/masterLazy/RePKG.Neo | GUI 增强版 | 批量操作 UX |
| **tex2img** (Python) | pypi.org/project/tex2img | Basis Universal 绑定 | 格式映射表 |
| **wallpaper-engine-extractor** | github.com/Orion-zhen/ | 批量 PKG 提取 | 元数据管理模式 |

### 2.2 纹理解码参考

| 项目 | 地址 | 核心能力 | 可用性 |
|------|------|---------|--------|
| **Basis Universal** | github.com/BinomialLLC/basis_universal | DXT1/3/5/BC7→RGBA (WASM) | C++→WASM，**无现成 npm BC7 包** |
| ktx-parse | npm | KTX2 容器解析 | 纯 TS，不与裸 DXT 兼容 |

### 2.3 二进制解析工具

| 包名 | 类型 | 适用性 |
|------|------|--------|
| **binary-parser** | npm 声明式 | ★★★★★ 最适合 PKG 解析 |
| Kaitai Struct | YAML 格式描述 | ★★★★☆ 学习曲线 |
| lz4 | npm 原生 | ★★★★☆ raw block 解压 |

### 2.4 架构参考

| 项目 | 可借鉴设计 | 移植度 |
|------|-----------|--------|
| RePKG | 三层架构、Strategy 读取器、两段解压管线 | ★★★★☆ |
| Lively Wallpaper | 网格暂停算法、多显示器管理 | ★★★☆☆ |
| Sucrose | 多格式抽象 | ★★★☆☆ |

---

## 三、候选方案对比

### 方案 A：渐进式降级修复

**策略**：BC7 modes 4-7 从品红占位改为跳过 block + 降级显示预览图。仅修复降级路径，不替换解码器。

**改动范围**：tex-parser.ts (修改 decompressBc7 降级逻辑)。

| 维度 | 权重 | 得分 | 加权 |
|------|------|------|------|
| 业务根治 | 20% | 4 | 0.80 |
| 场景兼容 | 13% | 10 | 1.30 |
| 故障安全 | 13% | 9 | 1.17 |
| 工程契约 | 10% | 6 | 0.60 |
| 可工程化 | 10% | 7 | 0.70 |
| 架构一致性 | 10% | 10 | 1.00 |
| 长期演进 | 12% | 3 | 0.36 |
| 边界健壮 | 12% | 6 | 0.72 |
| **总分** | | | **6.65** |

**淘汰原因**：不解决 BC7 根因，只是"更好的错误画面"。50% 现代壁纸不可用。

### 方案 B：WASM 纹理管线替换

**策略**：引入 Basis Universal WASM 替换 DXT/BC7 手写解码器。

**改动范围**：tex-parser.ts (重写)、新增 WASM 桥接层、Worker 调度层、构建配置。

| 维度 | 权重 | 得分 | 加权 |
|------|------|------|------|
| 业务根治 | 20% | 9 | 1.80 |
| 场景兼容 | 13% | 8 | 1.04 |
| 故障安全 | 13% | 7 | 0.91 |
| 工程契约 | 10% | 8 | 0.80 |
| 可工程化 | 10% | 9 | 0.90 |
| 架构一致性 | 10% | 5 | 0.50 |
| 长期演进 | 12% | 10 | 1.20 |
| 边界健壮 | 12% | 8 | 0.96 |
| **总分** | | | **8.11** |

**淘汰原因**：Basis Universal 无现成 npm 可用 BC7 包。自建 C++/Emscripten 编译管线违反 npmRebuild: false 策略。Worker 与 WASM 的集成需重构消息协议，改动范围扩大到 7-8 个文件。

### 方案 C：RePKG 三层架构重构

**策略**：重写 scene/ 为三层架构，用 binary-parser 声明式解析，Strategy 模式 TEX 读取。

| 维度 | 权重 | 得分 | 加权 |
|------|------|------|------|
| 业务根治 | 20% | 7 | 1.40 |
| 场景兼容 | 13% | 6 | 0.78 |
| 故障安全 | 13% | 5 | 0.65 |
| 工程契约 | 10% | 10 | 1.00 |
| 可工程化 | 10% | 8 | 0.80 |
| 架构一致性 | 10% | 6 | 0.60 |
| 长期演进 | 12% | 10 | 1.20 |
| 边界健壮 | 12% | 7 | 0.84 |
| **总分** | | | **7.27** |

**淘汰原因**：大规模重构回归风险高（故障安全 5/10）。场景覆盖 6/10——如果不引入 WASM，BC7 问题仍然存在。

### 方案 D：靶向手写 BC7 + 异步 IO（最终最优）

**策略**：手写实现 BC7 全部 8 种 mode 精确解码。新增 `parsePkgAsync`（保持 `parsePkg` 签名不变）。Worker 保持同步不触碰。

**改动范围**：5 个文件修改，零新依赖。

| 维度 | 权重 | 得分 | 加权 | 得分依据 |
|------|------|------|------|---------|
| 业务根治 | 20% | 8 | 1.60 | 手写覆盖全部 BC7 mode，magenta 完全消除 |
| 场景兼容 | 13% | 10 | 1.30 | 零新依赖，零接口变更，全量兼容 |
| 故障安全 | 13% | 9 | 1.17 | magenta 降级兜底，try/catch 保护 |
| 工程契约 | 10% | 8 | 0.80 | 仅修改内部函数签名，对外契约不变 |
| 可工程化 | 10% | 9 | 0.90 | 每种 mode 独立 fixture 测试 |
| 架构一致性 | 10% | 10 | 1.00 | 零新模块，零架构冲击 |
| 长期演进 | 12% | 7 | 0.84 | 纯 TS 实现，无 WASM 依赖，可维护 |
| 边界健壮 | 12% | 8 | 0.96 | 完整 mode 测试 + 真实 fixture |
| **总分** | | | **8.57** | |

---

## 四、最终选定：方案 D

### 4.1 改动清单

| # | 文件 | 操作 | 行数预估 | 说明 |
|---|------|------|---------|------|
| D1 | tex-parser.ts | 修改 decompressBc7 | +150/-60 | 实现 mode 4-7 精确解码，修正 mode 0-3 |
| D2 | tex-parser.test.ts | 修改+新增 | +80/-30 | 更新 3 个现有测试 + 新增 mode fixture |
| D3 | pkg-parser.ts | 新增 parsePkgAsync | +15 | async readFile → parsePkgBuffer |
| D4 | pkg-parser.test.ts | 新增 | +30 | parsePkgAsync 测试 |
| D5 | ARCHITECTURE.md | 更新 | +10 | 记录 BC7 实现和异步 IO 策略 |

### 4.2 BC7 实现规范

BC7 block = 16 bytes = 128 bits，模式由第一个置位 bit 位置决定：

| Mode | 特点 | 实现复杂度 |
|------|------|----------|
| 0 | 3 subsets, 3-bit indices, RGB565 endpoints | 中 |
| 1 | 2 subsets, P-bit shared, RGB565 | 中 |
| 2 | 3 subsets, 2-partition, 6-bit indices | 低 |
| 3 | 2 subsets, 7-bit endpoints, 2-bit indices | 低 |
| 4 | 1 subset, rotation, 5-bit indices, punch-through alpha | **高** |
| 5 | 1 subset, rotation, 7-bit endpoints, 1-bit alpha | **高** |
| 6 | 1 subset, full RGBA 8-bit endpoints, 4-bit indices | 低 |
| 7 | 1 subset, P-bit, 5-bit endpoints, punch-through | 中 |

Reference: stb_dxt.h (nothings/stb), DirectXTex BC7.cpp (Microsoft)

### 4.3 风险清单

| 风险 | 等级 | 缓解策略 |
|------|------|---------|
| BC7 mode 4-5 rotation 实现错误 | 中 | 每种 mode 独立 fixture 测试 + 真实 WE BC7 block 验证 |
| 解码性能不如 WASM | 低 | 预览尺寸（≤2048px）性能足够；4K 场景用 mipmap LOD0 |
| parsePkgAsync 调用方遗漏 | 低 | 只新增不改旧，parsePkg 签名不变 |
| 现有 BC7 测试失败 | 高 | TDD：先更新测试期望值，再改实现 |

### 4.4 范围外 Deferred（独立任务）

- Worker 架构重构支持 async extractScene（需修改消息协议，影响 5+ 文件）
- 全局异步 IO 迁移（涉及 scene-extractor.ts 签名变更）
- PNG 编码器替换为 sharp/pngjs
- 4K+ 大纹理解码优化
- 基于 Worker 的并行纹理解码

---

## 五、实施检查清单

- [ ] BC7 参考实现分析（stb_dxt.h / DirectXTex）
- [ ] Mode 6（最简单完整 target）实现 + 测试
- [ ] Mode 7 实现 + 测试
- [ ] Mode 0 修正 + 测试（更新现有 fixture）
- [ ] Mode 4 实现 + 测试
- [ ] Mode 5 实现 + 测试
- [ ] 更新 tex-parser.ts decompressBc7 主入口
- [ ] 更新 3 个现有 BC7 测试
- [ ] parsePkgAsync 实现 + 测试
- [ ] 全量 `npm test` 通过验证
- [ ] `npm run check` 全绿验证
