# Scene 特性支持矩阵

> **目的**：为 AgentSkin 壁纸引擎的"动态子集渲染"方案提供技术决策依据。逐条标明 Wallpaper Engine Scene 特性在浏览器 WebGL 环境中的可行性边界。
>
> **研究来源**：Almamu/linux-wallpaperengine (C++/OpenGL 3.3)、wqLouis/linux-wallpaperengine (Rust+wgpu/Vulkan+Metal)、waywallen/open-wallpaper-engine (C++20/Vulkan 1.1)
>
> **日期**：2026-08-28

---

## 1. 图层与对象系统

| 特性 | WebGL 2.0 可行性 | Electron/CDP 约束 | 降级策略 | 参考来源 |
|------|-----------------|-------------------|---------|---------|
| Image 图层（静态图） | **完全可行** | 无 | 直接渲染 | Almamu CImage |
| Text 图层 | **完全可行** | 无 | Canvas 2D 叠加或 WebGL 文字渲染 | Almamu CText |
| Composition/Fullscreen 图层 | **完全可行** | 无 | 全屏 quad | waywallen |
| Video 对象 | **完全可行** | 需 `<video>` 元素 + `texImage2D` | 原生视频播放 | Almamu VideoDriver |
| Web 对象（HTML 壁纸） | **不适用** | CDP 已覆盖 | 跳过，由 AgentSkin 自身处理 | Almamu WebBrowser |

## 2. 粒子系统

| 特性 | WebGL 2.0 可行性 | Electron/CDP 约束 | 降级策略 | 参考来源 |
|------|-----------------|-------------------|---------|---------|
| Sprite 粒子（quad） | **完全可行** | 无 | Instanced rendering | waywallen Renderers |
| Trail/Rope 粒子 | **部分可行** | 性能受限 | 降低 trail 长度或回退到 Sprite | waywallen Renderers |
| 发射器（Emitters） | **完全可行** | 无 | CPU 端模拟 + GPU 绘制 | waywallen Emitters |
| 初始化器（Initializers） | **完全可行** | 无 | 顶点属性初始化 | waywallen Initializers |
| 运算符（Operators，物理模拟） | **部分可行** | 复杂运算符性能回退 | 简化物理模型或降低粒子数 | waywallen Operators |
| 控制点（Control Points） | **完全可行** | 无 | Uniform 传入 | waywallen Control Points |
| 子粒子系统（Children） | **部分可行** | 嵌套层级深时性能下降 | 限制嵌套深度 ≤ 2 | waywallen Children |
| 音频响应粒子 | **部分可行** | Web Audio API FFT 精度低于 FFTW3 | 降低频率分辨率 | waywallen Audio Response |
| GPU 粒子（Transform Feedback） | **部分可行** | WebGL 2.0 支持 TF，但性能差异大 | 回退到 CPU 端模拟 | wqLouis compute pipeline |
| 高粒子数场景（>10K） | **部分可行** | 低配设备帧率下降 | 动态粒子数缩放 | Almamu CParticle (89KB) |

## 3. 后处理效果

| 特性 | WebGL 2.0 可行性 | Electron/CDP 约束 | 降级策略 | 参考来源 |
|------|-----------------|-------------------|---------|---------|
| Bloom（全局泛光） | **完全可行** | 无 | 降采样 + 高斯模糊 + 合成 | waywallen Global Bloom |
| 高斯模糊 | **完全可行** | 无 | 分离式 2-pass 模糊 | wqLouis ping-pong |
| 颜色校正（Color Correction） | **完全可行** | 无 | 片段 shader 颜色矩阵 | Almamu schemacolor |
| 暗角（Vignette） | **完全可行** | 无 | 片段 shader | Almamu CPass |
| 色调映射（Tone Mapping） | **完全可行** | 无 | 片段 shader | wqLouis post_processor |
| 水波/扭曲（Distortion） | **完全可行** | 无 | UV 偏移 shader | wqLouis 水波效果 |
| 景深（DOF） | **部分可行** | 深度缓冲访问受限 | 简化版基于距离的模糊 | Almamu CPass |
| 运动模糊 | **部分可行** | 需要速度缓冲 | 降低采样数或关闭 | Almamu CPass |
| MSAA（多重采样抗锯齿） | **有限** | WebGL 2.0 支持渲染缓冲 MSAA，resolve 需手动 | FXAA 后处理替代 | waywallen MSAA 1/2/4/8/16 |
| 自动 Pass 依赖推断 | **不可行** | WebGL 无 Render Pass 对象 | 手动管理 FBO 绑定和清除 | waywallen Render Graph |
| Compute Shader 效果 | **不可行** | WebGL 无 compute shader | 重写为 fragment shader 版本 | wqLouis 8x8 tile dispatch |

## 4. 3D 模型 / Puppet 系统

| 特性 | WebGL 2.0 可行性 | Electron/CDP 约束 | 降级策略 | 参考来源 |
|------|-----------------|-------------------|---------|---------|
| 静态 3D 模型渲染 | **完全可行** | 无 | 标准 PBR 渲染 | waywallen 3D Model |
| 骨骼动画（Skeleton Animation） | **完全可行** | 无 | 顶点 shader 中蒙皮（≤4 bones/vertex） | waywallen Skeleton |
| 网格（Mesh） | **完全可行** | 无 | 标准 VBO/IBO | waywallen Mesh |
| 附件系统（MDAT） | **完全可行** | 无 | 骨骼挂载点计算 | waywallen Attachments |
| 网格遮罩（Mesh Masks） | **完全可行** | 无 | Stencil 或 shader 遮罩 | waywallen Mesh Masks |
| 变形目标/表情（Morph Targets/MDMP） | **部分可行** | 多顶点属性上传开销 | 限制 active morph targets ≤ 4 | waywallen MDMP（不支持） |
| 骨骼物理模拟（Bone Simulation） | **不可行** | 需要物理引擎集成 | 回退到预计算动画 | waywallen Bone Simulation（不支持） |
| PBR 材质 | **完全可行** | 无 | WebGL 2.0 支持 PBR（需手动 IBL） | waywallen PBR Light |
| 全局光照/IBL | **部分可行** | 环境贴图采样开销 | 简化 IBL 或固定环境 | waywallen PBR |

## 5. SceneScript 脚本系统

| 特性 | WebGL 2.0 可行性 | Electron/CDP 约束 | 降级策略 | 参考来源 |
|------|-----------------|-------------------|---------|---------|
| JavaScript 脚本执行 | **完全可行** | 无 | V8/SpiderMonkey 原生支持 | Almamu ScriptEngine |
| QuickJS 引擎 | **完全可行** | 无 | 可编译为 WASM | waywallen quickjs-ng |
| 用户属性（User Properties） | **完全可行** | 无 | JSON 配置映射 | waywallen User Properties |
| 输入事件绑定 | **完全可行** | 无 | 浏览器事件系统 | Almamu InputObject |
| DBus 集成 | **不可行** | 浏览器无 DBus | 移除或替换为 IPC | Almamu DBus |
| 控制台/调试 | **部分可行** | 无 | 浏览器 DevTools | Almamu ConsoleObject |

## 6. 视差与鼠标响应

| 特性 | WebGL 2.0 可行性 | Electron/CDP 约束 | 降级策略 | 参考来源 |
|------|-----------------|-------------------|---------|---------|
| 基础视差（Parallax） | **完全可行** | 无 | Uniform 传入鼠标位置 | Almamu parallaxDepth |
| 深度视差（Depth Parallax） | **完全可行** | 无 | 多层不同速度 | waywallen Depth Parallax |
| 鼠标位置延迟跟踪 | **完全可行** | 无 | 插值平滑 | waywallen Mouse Position with Delay |
| 鼠标跟随粒子 | **完全可行** | 无 | 粒子系统控制点绑定 | waywallen Mouse Follow |
| 点击交互 | **完全可行** | 无 | 浏览器点击事件 | Almamu MouseInput |

## 7. 音频响应

| 特性 | WebGL 2.0 可行性 | Electron/CDP 约束 | 降级策略 | 参考来源 |
|------|-----------------|-------------------|---------|---------|
| 音频可视化（频谱条） | **完全可行** | 无 | Web Audio API AnalyserNode | waywallen Visualization |
| 音频响应参数 | **部分可行** | FFT 频率分辨率低于 FFTW3 | 降低频段数（32→16） | Almamu FFTW3 |
| 音频循环播放 | **完全可行** | 无 | Web Audio API 循环 | waywallen Loop |
| 随机播放 | **完全可行** | 无 | 随机选择音频源 | waywallen Random |
| 高保真音频分析 | **部分可行** | Web Audio API 的 getByteFrequencyData 精度有限 | 降低采样率或频段数 | Almamu AudioStream (18KB) |

## 8. 纹理格式支持

| 格式 | WebGL 2.0 可行性 | Electron/CDP 约束 | 降级策略 | 参考来源 |
|------|-----------------|-------------------|---------|---------|
| PNG/JPEG | **完全可行** | 无 | 原生 Image 元素 | wqLouis tex_parser |
| DXT1/BC1 | **部分可行** | 需 `WEBGL_compressed_texture_s3tc` 扩展 | 转码为 PNG 回退 | wqLouis DXT1/BC1 |
| DXT5/BC3 | **部分可行** | 同上 | 转码为 PNG 回退 | wqLouis DXT5/BC3 |
| R8（单通道） | **完全可行** | WebGL 2.0 原生支持 | 直接使用 | wqLouis R8 |
| RG88（双通道） | **完全可行** | WebGL 2.0 原生支持 | 直接使用 | wqLouis RG88 |
| RGBA8888 | **完全可行** | 无 | 标准格式 | wqLouis |
| BCn Mipmap Chain | **部分可行** | 扩展依赖 | CPU 端生成 mipmap | wqLouis MipChainGenerator |
| 视频纹理（MP4/WebM） | **完全可行** | 无 | `<video>` → `texImage2D` | wqLouis |

## 9. 渲染管线架构

| 架构特性 | WebGL 2.0 可行性 | Electron/CDP 约束 | 降级策略 | 参考来源 |
|---------|-----------------|-------------------|---------|---------|
| 正交相机 | **完全可行** | 无 | 标准正交投影矩阵 | wqLouis projection.rs |
| Ping-Pong 多 Pass | **完全可行** | 无 | 双 FBO 交替渲染 | wqLouis ping_pong.rs |
| NDC 全屏四边形 | **完全可行** | 无 | 标准 quad | wqLouis NDC_VERTICES |
| 混合模式（Blend Mode） | **完全可行** | 无 | `gl.blendFunc` 映射 | waywallen ColorBlendMode |
| Straight-Alpha 保留 | **完全可行** | 无 | One/One 混合 copy pass | wqLouis copy pipeline |
| Render Graph 自动依赖 | **不可行** | WebGL 无 Render Pass 对象 | 手动管理 FBO 和清除 | waywallen Render Graph |
| SPIR-V 反射 | **不可行** | WebGL 使用 GLSL | 改用 glslang 或手动布局 | waywallen SPIR-V |
| Shader Blob 缓存 | **不可行** | WebGL 无管线缓存 | 运行时编译缓存 | waywallen cache-path |
| Push Constants | **不可行** | WebGL 无 push constants | 回退到 `gl.uniform*()` 或 UBO | wqLouis IMMEDIATES |
| 纹理数组非均匀索引 | **有限** | WebGL 2.0 部分支持 | 限制为 uniform 索引 | wqLouis PARTIALLY_BOUND |

---

## 10. 综合可行性判定

### 10.1 特性覆盖率

| 类别 | 总特性数 | 完全可行 | 部分可行 | 不可行 | 可行率 |
|------|---------|---------|---------|--------|--------|
| 图层与对象 | 5 | 4 | 0 | 1 (Web) | 80% |
| 粒子系统 | 10 | 5 | 5 | 0 | 50%+ |
| 后处理 | 11 | 7 | 2 | 2 | 64% |
| 3D 模型/Puppet | 8 | 5 | 2 | 1 | 63% |
| SceneScript | 6 | 4 | 1 | 1 | 67% |
| 视差/鼠标 | 5 | 5 | 0 | 0 | 100% |
| 音频响应 | 5 | 3 | 2 | 0 | 60% |
| 纹理格式 | 8 | 5 | 3 | 0 | 63% |
| 管线架构 | 10 | 5 | 1 | 4 | 50% |
| **总计** | **68** | **43** | **16** | **9** | **63%** |

### 10.2 关键结论

1. **约 63% 的特性可在 WebGL 2.0 中实现**（完全可行），覆盖大部分常见壁纸场景
2. **约 24% 需要降级实现**（部分可行），在低配设备上需要动态调整
3. **约 13% 不可行**，主要是 Vulkan 特定功能（Render Graph 自动依赖、SPIR-V 反射、Compute Shader）

### 10.3 对 AgentSkin 的具体建议

**Tier 1（完全支持，无降级）**：
- 静态图/文字/视频图层
- 基础粒子系统（Sprite + Emitter + Initializer）
- Bloom、模糊、颜色校正后处理
- 骨骼动画、PBR 材质
- 视差/鼠标响应
- PNG/JPEG/R8/RG88 纹理

**Tier 2（条件支持，需降级）**：
- 高粒子数场景（动态缩放）
- GPU 粒子（回退 CPU 模拟）
- BCn 压缩纹理（需扩展，否则转码）
- Morph Targets（限制数量）
- 音频响应（降低频率分辨率）

**Tier 3（不支持，需跳过/替换）**：
- Bone Simulation → 预计算动画
- Compute Shader 效果 → Fragment Shader 重写
- Render Graph 自动依赖 → 手动 Pass 管理
- DBus 集成 → 移除

### 10.4 Electron/CDP 特定注意事项

1. **GPU 进程隔离**：Electron 的 GPU 进程可能与 CDP 注入冲突，需在 BrowserWindow 配置中禁用 `webgl: false` 或使用 `gpu-workaround`
2. **WebGL 上下文限制**：CDP 注入的页面可能已有 WebGL 上下文，需注意上下文切换和资源共享
3. **性能基线**：Electron 的 WebGL 性能通常低于原生浏览器，需建立真实基线后再优化
4. **低配设备**：Electron 在低配设备上 WebGL 性能进一步下降，Tier 2 特性需要更激进的降级策略

---

## 附录 A：研究来源详情

| 项目 | 语言/图形 API | 关键文件 | 研究重点 |
|------|-------------|---------|---------|
| Almamu/linux-wallpaperengine | C++ / OpenGL 3.3 | CParticle.cpp (89KB), CPass.cpp (39KB), ScriptEngine.cpp (25KB) | 完整功能清单、对象层次、脚本系统 |
| wqLouis/linux-wallpaperengine | Rust+wgpu / Vulkan+Metal | projection.rs, intermediate_pass.rs, ping_pong.rs, post_processor/ | 渲染管线架构、GLSL 预处理器、纹理解析 |
| waywallen/open-wallpaper-engine | C++20 / Vulkan 1.1 | Render Graph, Scene/, Vulkan/ | 特性支持边界、Render Graph 架构、PBR/粒子 |

## 附录 B：术语表

| 术语 | 说明 |
|------|------|
| BCn | Block Compression 纹理压缩格式（DXT1/BC1, DXT5/BC3） |
| FBO | Frame Buffer Object，离屏渲染目标 |
| IBL | Image-Based Lighting，基于图像的全息光照 |
| NDC | Normalized Device Coordinates，归一化设备坐标 |
| PBR | Physically Based Rendering，基于物理的渲染 |
| Ping-Pong | 双缓冲交替渲染技术，用于多 Pass 后处理 |
| Render Graph | 自动管理渲染 Pass 依赖关系的图结构 |
| SceneScript | Wallpaper Engine 内置的 JavaScript 脚本系统 |
| SPIR-V | Vulkan 的中间着色器表示格式 |
| Straight-Alpha | 预乘 Alpha 处理方式，避免后处理链灰边伪影 |
| Transform Feedback | GPU 端顶点数据反馈技术，用于粒子模拟 |
| WGSL | WebGPU Shading Language |
| wgpu | Rust 的跨平台 GPU 抽象层 |
