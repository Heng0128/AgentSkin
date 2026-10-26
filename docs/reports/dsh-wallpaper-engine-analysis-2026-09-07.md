# dsh-wallpaper-engine 项目分析 — 可借鉴能力评估

> 日期：2026-09-07
> 对象：C:\Users\snowb\Desktop\work\dsh-wallpaper-engine-main（dsh-plugin-wallpaper-engine v0.7.1，MIT）
> 方法：源码级一手分析（lib/index.js、src/client.js、lib/we-renderer/*、docs/WE-REVERSE.md、TODO.md），对照 AgentSkin 现有壁纸系统逐项评估。
> 结论先行：**最大价值 = 完整 WE Scene 渲染器（官方逆向验证）+ 场景动画管线（静态帧→MP4/APNG 渐进升级）+ 视频抽帧转码**；三者均零框架依赖（仅 jpeg-js + @shaderfrog/glsl-parser），MIT 许可，可平移进 Electron 主进程。

---

## 1. 项目概况

把本机 Wallpaper Engine 壁纸渲染为 DSH Web GUI 背景的 DSH/Cordis 插件：

- **宿主端** lib/index.js（~132KB）：Cordis 插件，壁纸发现 + 同源 HTTP 路由（inventory/media/preview/scene-frame/scene-anim/upload/settings/media-info/transcoded/transcode-progress）+ 场景帧渲染 + ffmpeg 转码。
- **客户端** src/client.js（~860KB）：注入式单文件，壁纸图层 + 液态玻璃 + 选择器 + 省电暂停。
- **场景渲染器** lib/we-renderer/（15+ 模块）+ scene-manifest.js / scene-player.js / pkg-extract.js：纯 JS 重放 WE 场景（对象树/纹理/粒子/puppet/文本/shader 效果）。
- **方法论**：以 wallpaper64.exe 官方引擎逆向为事实基准（docs/WE-REVERSE.md 记录定位数学/相机/骨骼矩阵链等已验证结论；TODO.md 608 行逐项验证记录）。
- **外部依赖仅 2 个**：jpeg-js（JPEG 纹理解码）、@shaderfrog/glsl-parser（GLSL 解释器）。其余全为 Node 内置。

## 2. AgentSkin 现状（对照基线）

| 能力 | AgentSkin 现状 | 位置 |
|---|---|---|
| WE 发现 | ✅ VDF 解析 + workshop 扫描 + web/scene/video/image 判定 + SCE/CE 扩展 | src/main/steam-path-resolver.ts、src/main/wallpaper/we/* |
| 媒体服务 | ✅ loopback HTTP（token + Range + LRU + 主动断流） | src/main/wallpaper-server.ts |
| 渲染选项 | ✅ 对齐 WE 面板（speed/loop/scrim/alignment/position/flip/parallax/滤镜/tint/audio/particles） | src/shared/types/wallpaper.ts |
| 场景渲染 | ⚠️ L2 Canvas 2D 简化层合成（无 shader/puppet/文本/JPEG 纹理） | src/main/scene-renderer-html.ts 及拆分模块 |
| 静态帧 | ✅ 5 级降级链（合成→主纹理→preview→纯色→透明） | src/main/scene/static-frame-extractor.ts |
| 纹理解码 | ✅ RGBA/DXT/BC7 + worker 池 | src/main/scene/tex-parser/*、texture-decode-pool.ts |
| 桌面暂停 | ✅ hidden/focus 两档 | src/ui/components/DynamicBackground.tsx |
| Agent 暂停 | ⚠️ suspend/battery 两档（无 hidden/focus 档） | src/main/wallpaper-lifecycle.ts |
| 视频转码 | ❌ 无 | — |
| 场景动画 | ❌ 无（scene = 静态帧/简化 HTML） | — |
| WE 项目来源 | ⚠️ 仅 workshop + 本地导入（缺 defaultprojects/myprojects） | src/main/wallpaper/adapter.ts |

## 3. 可借鉴能力（按优先级）

### P0-1 完整 Scene 渲染器（最大差距，整体可平移）

lib/pkg-extract.js（PKGV/LZ4）+ lib/scene-manifest.js + lib/we-renderer/：

- 官方数学逆向验证：定位矩阵 origin×0.5×M、puppet 骨骼链、相机 view/proj、视图平移 y=0 定论（WE-REVERSE.md §3）。
- 20+ 官方 shader 效果 CPU 复刻：waterwaves（方向 rotateVec2 修正）/ waterripple（法线贴图双采样）/ shake（锯齿+摩擦曲线）/ godrays 5-pass / blur 4-pass / blend 32 模式 / swing / depthparallax ray-march 等，均标注源码依据与验证结论。
- GLSL 效果解释器（sf40）：@shaderfrog/glsl-parser PEG 解析 + 自写 AST→JS 转译 + 宿主运行时，直接执行 workshop 第三方 .frag/.vert，覆盖任意 custom 效果。
- MDL/puppet：MDLV0023/MDLS0004/MDAT0001/MDMP0001/MDLE0002/MDLA0006 段解析 + 蒙皮 + 动画层合成（mix/additive 世界空间 delta）。
- 完整粒子系统：emitter/initializer/operator 全套 + mulberry32 确定性 RNG。
- NSL 脚本运行时（sf35）：脚本缓存 + engine API 补全 + ownerRef 代理——修"组件运动全错"的根因。
- TTF/CFF 文本引擎 + 高分辨率补偿（sf38b，逆向 lwe CText）。
- JPEG baseline 解码（自实现）。
- 降采样近似优化（sf38）：效果链在显示尺寸而非 4K 原始纹理上执行，2695ms→67ms/帧，1.6s/帧@1080p，视觉差异 1.3%——移植必须带上。

移植评估：模块无 DSH/Cordis 依赖；worker 以 workerData 输入（src/width/height/time/weAssetsDir/videoFrames）、ArrayBuffer 零拷贝回传。AgentSkin 已有 texture-decode-pool worker 基建，接法同构。外部依赖需新增 jpeg-js + @shaderfrog/glsl-parser（licenses/ 登记 MIT）。预估：静态帧管线 = 平移 + 接线 static-frame-extractor 降级链；动画管线 = + ffmpeg 合成与缓存。

### P0-2 场景动画管线（scene-anim：静态帧→动画渐进升级）

lib/index.js L690-770、L2376-2500：

1. 静态帧秒开（先渲染单帧 PNG）；
2. 后台 worker 多帧渲染（frameCount = fps × max(sec, loop)，t0=0，sf37 修复"普遍快放"根因）→ APNG 自研编码器（apng-encode.js，纯 zlib）或 ffmpeg 合成 MP4(x264)/WebM(VP9)；
3. 缓存 key san_sf32_<sha256(路径|mtime|参数|格式)>，并发去重 Map<key,Promise>；
4. 客户端 queueSceneAnimUpgrade：隐藏 video 预加载，完成后校验当前 URL 未变才切换（防轮播误升级），失败保持静态帧；
5. 进度：worker 逐帧上报 → .apng.prog / .vid.prog 文件（格式隔离防进度互覆）→ /scene-anim-progress 轮询 → UI 进度条；
6. 取消链：客户端断开 res close → AbortController 杀 worker/ffmpeg/删 .prog（sf34）；
7. 缓存命中必须走 serveFile（Range/206）——trackStream 全量 200 导致 MP4 seek 黑屏（sf38c 教训）。

移植评估：与 AgentSkin DynamicBackground/注入管线天然契合——scene 类型从"静态帧/简化 HTML"升级为"动画视频"，且与视频壁纸共享同一套播放控制（倍速/暂停/循环）。高价值低成本。

### P0-3 视频抽帧转码（fps cap，解码占用 60%→15%）

lib/index.js L1034-1560：

- /media-info：零依赖 moov 探测（mvhd/mdhd/stsd/stts 盒解析 → 分辨率/编码/fps/时长），"moov 必须紧贴 EOF"过滤 mdat 误报。
- 源 fps > cap 时 ffmpeg 一次性重编码：AV1(NVENC) → H.264(NVENC) 逐编码器回退；时间线保持 1.0x（丢帧不减速，与 playbackRate 倍速完全解耦）。
- 并发闸 2（排队不计超时）、单任务硬超时 15min（kill 全部编码器尝试）、-progress 输出实时解析（进度/ETA）、磁盘缓存 + 启动清理孤儿 .tmp/.prog。
- ffmpeg 供给三档：env → 本地 bundle → 系统 PATH → 懒下载（ffmpeg-static b6.0 固定 sha256 + magic-byte 校验，npmmirror+GitHub 双源竞速）。
- 客户端：先播原文件秒开，转码就绪后换 capped 文件；media-info 在途时不触发转码（防浪费）。

移植评估：纯 Node child_process，无框架依赖；AgentSkin 壁纸以 4K 视频居多时收益显著。需用户感知的磁盘占用策略（缓存上限/清理）由 AgentSkin 侧补。

### P1-4 遮挡暂停三档（WE-style）

src/client.js L1410-1430、L5272-5290：document.hidden（最小化/切页）、!document.hasFocus()（失焦=大概率被遮挡）、navigator.getBattery() 未充电——三档独立开关持久化；暂停 video 即停 rVFC → 解码引擎归零；iframe 无法暂停，只能靠浏览器 hidden 节流。

移植：桌面端 DynamicBackground 已有两档，补 battery 档 + 三档开关；agent 端 wallpaper-lifecycle 现只挂 suspend/on-battery，可并入 hidden/focus/battery 三档（经 CDP 桥 AGENTSKIN_WP_PAUSE 通道已有）。

### P1-5 配置持久化工程手法（直接照搬）

lib/index.js L453-537：atomicWriteFileSync（tmp+rename + 跨卷/锁定回退）+ enqueueConfigWrite promise 链（读-改-写串行化，防后写者吞先写者）+ 损坏回退默认值。AgentSkin settings 写入可直接借鉴。

### P1-6 渲染缓存 key 规范

<管线版本前缀 sf*/san_*>_<sha256(路径|mtime|参数)>——管线变更 bump 前缀即全量失效。AgentSkin PreviewCache（自定义壁纸 preview-cache）与未来的场景帧缓存统一采用。

### P1-7 壁纸来源补全

- defaultprojects/myprojects 枚举（AgentSkin 现仅 workshop）；
- 上传目录可迁移（config 持久化 + 跨卷 copy + .meta.json sha256 去重）；
- Steam 位置探测支持 WSL /mnt（AgentSkin 是 Windows 桌面应用，暂不需要）。

### P2-8 值得了解的体验细节

- 渐进升级模式（先秒开后升级、校验防竞态）：通用于任何"重计算换高质量"场景。
- 防闪白：根因是常驻 CSS filter（拉绳）+ 多余合成层；修复=移除 will-change/transform/contain 常驻层。AgentSkin 注入 theme 时同理避免常驻大 blur。
- 液态玻璃配方：blur+saturate(1.8)+brightness(1.04)+contrast(1.01) + 顶部高光渐变 + 三层 inset 边框阴影 + sheen 随透明度联动；对 workbuddy 等目标应用的玻璃主题适配有参考价值。
- corner-shape: superellipse(1.5)：harness rc.1 给全元素加方圆角会把 border-radius:50% 渲染成圆角矩形；插件对自身正圆显式重置。AgentSkin 注入目标应用升级 Chromium 后可能踩同类问题，留档备查。
- WebGL 实时播放器（scene-player.js）不移植：自包含 WebGL 运行时（fetch manifest 播放），但对方实测"每个场景一个 WebGL context 冻结页面"，默认禁用仅作路由 fallback。结论：走预渲染动画管线，不做实时播放。

## 4. 落地建议（若立项）

1. 第一步（小）：P1-5 原子写 + 串行队列；P1-6 缓存 key；P1-4 三档暂停。半天级。
2. 第二步（中）：scene-anim 管线接入现有 scene 类型（依赖 P0-1 渲染器）。
3. 第三步（大）：整体平移 we-renderer（含降采样优化 + NSL 运行时），替换 scene-renderer-html 的 L2 简化渲染；static-frame-extractor 降级链保留为渲染失败回退。
4. 第四步（可选）：视频 fps cap 转码 + ffmpeg 供给；defaultprojects/myprojects 来源补全。
5. 许可合规：MIT 复制 LICENSE 到 licenses/；新增依赖 jpeg-js、@shaderfrog/glsl-parser 登记。

## 5. 不移植清单

- Cordis/DSH webserver 路由层（AgentSkin 用 Electron IPC + 自有 loopback server）。
- 液态玻璃设置页 UI（六页封顶约束；只借 CSS 配方）。
- localStorage 配置迁移（不适用）。
- Edge 检测 + video→canvas drawImage 渲染（AgentSkin 目标应用非 Edge 场景；如未来目标应用出现同类悬浮工具栏问题再借）。
