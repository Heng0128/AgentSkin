# AgentSkin 壁纸引擎集成方案（严格修订版）

## 原则

本方案基于对壁纸模块代码的严格审查。审查发现多个严重且相互关联的问题：安全漏洞（CSP 绕过）、功能错误（GIF 处理）、资源泄漏（token 累积）、架构混乱（单体模块）、类型弱化（any 泛滥）。这些不是孤立的 bug，而是系统性工程债务的体现。

修订后的方案将修复优先级的顺序调整为：**先堵洞再建楼**——Phase 0 的五个修复项完成后代码才能进入安全发布态，之后才逐步完善功能和性能。这是严格质量控制的必要步骤。

核心转变在于：**不再把壁纸引擎当作"锦上添花"的功能，而是作为与主题应用同等重要的核心特性来构建**。安全问题不能妥协，资源泄漏不可容忍，多种壁纸类型的支撑必须完备且一致。

---

## 一、紧急发现——必须立即修复的严重问题（Phase 0：热修复）

### 1. CSP 无条件绕过 —— 高危安全漏洞

**位置：** `src/main/cdp/cdp-wallpaper-inject.ts: bypassPageCsp()`

**问题描述：**
三层 CSP 绕过策略无条件执行：
- Layer 1: 直接调用 `Page.setBypassCSP({enabled:true})`，不判断目标页面是否真的需要绕过
- Layer 2: 盲目删除页面中所有 CSP meta 标签，无论这些 CSP 是否为 agent 注入
- Layer 3: 无任何 fallback 验证，即使前两层失败也继续执行后续注入

**风险后果：**
任意获得 CDP 会话的攻击者可以彻底禁用目标页面的 CSP 保护，注入任意脚本、加载任意外部资源。这是完整的安全策略失效。

**修复方案：**
引入配置开关 + 审计日志：
- 新增配置文件项：`security.cspBypassEnabled: boolean`（默认 false）
- 在 injection 前检查该标志，仅在 true 时执行 bypass，否则记录警告
- 每次 bypass 尝试需记录到日志：`{ timestamp, appId, layer, success, error }`

### 2. URL 输入验证不足 —— 潜在 XSS/钓鱼风险

**位置：** `src/main/cdp/cdp-wallpaper-inject.ts: mountVideoWallpaper()`

**问题描述：**
对 `src` 参数仅做最浅层的引号检查，远远不够：
- 未验证协议白名单（允许 `javascript:`、`data://`、`http://evil.com` 等任意 URL）
- 未限制 `data:` URL 大小（可构造超大 base64 字符串导致内存耗尽）
- 未处理特殊字符编码绕过

**风险后果：**
恶意的 wallpaper ID 可注入任意 JavaScript 代码、跳转至钓鱼站点、或消耗大量内存使 agent 崩溃。

**修复方案：**
严格白名单校验 + 大小限制：
- 正则：`^(https?:|blob:|data:)`
- `data:` URL 超过 1MB 则拒绝

### 3. Web/Scene 壁纸注入实现缺失 —— 功能盲区

**位置：** `src/main/cdp/cdp-wallpaper-inject.ts`

**问题描述：**
代码中有 `injectWebWallpaper` 的导入声明，但未发现其实现。该函数负责将 web-type 壁纸（HTML 项目）通过 iframe 注入到目标页面。

**风险后果：**
如果实现不存在或不完整，WE 中的 HTML 壁纸在选择应用时将静默失败，用户体验严重受损且难以调试。

**修复方案：**
- 确认存在性，如缺失立即补全实现
- 创建 iframe，设置 `src` 为 `webUrlFor()` 返回的 loopback URL
- 添加必要的 `sandbox` 属性
- 包含完整的错误处理和回退（失败时显示预览图 + 错误提示）

### 4. Media Token 泄漏 —— 资源累积

**位置：** `src/main/wallpaper-injector.ts: activeMediaTokens Map`

**问题描述：**
模块级全局 Map `activeMediaTokens` 用于跟踪每个 agent 使用的 HTTP token。但在以下路径未正确清理：
- `injectAgentWallpaper()` 早期退出（无 service、无 targets、epoch-cancelled）时未调用 `setActiveMediaToken(appId, null)`
- 异常捕获块中仅返回错误结果，未清理已注册的 token
- Web/scene 类型的 token 由 wallpaperService 缓存，但注入失败后不会触发清理

**风险后果：**
loopback HTTP 服务器的 entries Map 会持续累积已失效的 token，长期运行后将导致文件描述符泄露和内存持续增长。

**修复方案：**
确保在所有 exit point 都有对应的 cleanup：

```ts
function setActiveMediaToken(appId: AgentId, token: string | null): void {
  const prev = activeMediaTokens.get(appId);
  if (prev) wallpaperMediaServer.unregister(prev); // ALWAYS unregister previous
  if (token) activeMediaTokens.set(appId, token);
  else activeMediaTokens.delete(appId);
}
```

### 5. GIF 壁纸处理不当 —— 功能不正确

**位置：** `src/main/wallpaper-service.ts: playbackFor() + injectAgentWallpaper()`

**问题描述：**
- `playbackFor()` 正确识别 `.gif` 文件返回 `'gif'` 作为播放类型
- 但在 `injectAgentWallpaper()` 中，没有针对 `'gif'` 的特殊处理分支
- GIF 会被当作普通视频走 `mountVideoWallpaper()` 路径，使用 `<video>` 标签注入
- 浏览器不支持在 `<video>` 标签中播放动画 GIF（只显示第一帧）

**风险后果：**
用户选择 animated GIF 壁纸时看到的是静止图片，体验严重受损。

**修复方案：**
增加 GIF 专用路径：

```ts
if (playback === 'gif') {
  return injectImageWallpaper(session, { /* params using <img> */ });
}
```

## 二、架构与设计缺陷（Phase 1：重构基础）

在完成 Phase 0 的紧急修复后，必须解决深层架构问题。

### 6. 单一职责 violation —— wallpaper-service.ts 过于庞大

**问题描述：**
`wallpaper-service.ts` 超过 800 行，同时承担以下职责：
- Wallpaper Engine 安装路径 discovery
- VDF 文件解析
- Workshop 项目遍历与扫描
- project.json 解析与类型判定
- 媒体/预览文件查找
- 本地目录扫描（scanCustomDir）
- Media server token 管理
- 结果列表构建

这是典型的"上帝对象"，难以测试、维护。

**解决方案：** 拆分为独立模块：

```
src/main/wallpaper/
  ├── we/                  # WE 专项子模块
  │   ├── discovery.ts     # 路径检测
  │   ├── scanner.ts       # 并行扫描
  │   └── parser.ts        # project.json 解析
  ├── local/               # 本地导入子模块
  │   ├── importer.ts      # 统一导入 API
  │   └── thumbnailer.ts   # 缩略图生成
  ├── storage/             # 持久化状态
  └── adapter.ts           # 兼容适配层
```

### 7. 魔数硬编码缺乏配置 —— 难以调优

**问题描述：** 多处硬编码阈值且无文档说明：
- `VIDEO_HTTP_THRESHOLD = 50MB`（决定何时用 HTTP stream）
- `VIDEO_BLOB_FALLBACK_CAP = 120MB`（base64 fallback 上限）
- `WATCHDOG_MS = 12000`（媒体加载超时）

这些值没有配置文件，不同硬件环境需要不同优化。

**解决方案：** 提取为配置对象并添加文档说明。

### 8. `any` 类型滥用 —— TypeScript 价值丧失

**问题描述：** 在 snapshot-theme.ts 等处大量使用 `as any` 应对 CDP 动态响应，牺牲了类型检查的核心价值。

**解决方案：** 为常见 CDP 响应定义明确接口，减少 `any` 使用。

### 9. 缺少增量扫描机制 —— 大型库场景性能灾难

**问题描述：** 每次 `list()` 都会完整遍历整个 Workshop 目录（可能数千个项目），导致显著卡顿。

**解决方案：** 实现增量扫描状态持久化（mtime/hash 比对），只重新处理变更项目。

### 10. 全局变量并发隐患

**问题描述：** 模块级 `let wallpaperDeps` 可能被并发调用覆盖，导致上下文错误。

**解决方案：** 将 deps 作为参数显式传递，或使用 per-request 闭包捕获。

## 三、多壁纸类型支持深入分析

当前支持五种类型，每种都存在深层问题：

| 类型 | 当前实现 | 问题 | 修复建议 |
|------|----------|------|----------|
| video | HTTP stream 或 base64 blob | 缺少 codec 兼容性检测；失败时无具体原因 | 增加前置 codec 检查；细化错误码 |
| image | 小文件 blob / 大文件 stream | 缺少图片缩放/对齐选项（cover/contain） | 添加 CSS 控制参数 |
| web | 未确认实现 | **功能缺失**风险最高 | 立即补全 + iframe sandbox |
| scene | scene-pkg-parser 生成 HTML | 解析失败时优雅降级缺失 | 失败时回退到预览图 + 错误提示 |
| application | 被忽略或跳过 | 可能被归类错误或静默跳过 | 明确标记为 unsupported |
| gif | 误用 video 标签 | 动画不显示，仅第一帧可见 | 专用 img 注入路径 |

## 四、实施路线图（按优先级重排）

**Phase 0：紧急热修复（1-3天）—— 阻塞发布**
- [ ] 0.1 CSP 管理器：添加开关 + 日志（CRITICAL）
- [ ] 0.2 URL 白名单验证（HIGH）
- [ ] 0.3 确认并补全 injectWebWallpaper 实现（CRITICAL）
- [ ] 0.4 所有退出路径的 token 清理（HIGH）
- [ ] 0.5 GIF 专用注入路径（MEDIUM）

**Phase 1：架构解耦与类型完备（2-3周）**
- [ ] 1.1 拆分 we-discovery/we-scanner/we-parser 模块
- [ ] 1.2 实现统一导入 API（copy/reference 模式）
- [ ] 1.3 缩略图自动生成（视频抽首帧、格式转换）
- [ ] 1.4 增强类型定义，减少 any 使用
- [ ] 1.5 Scene 壁纸 fallback 机制

**Phase 2：增量扫描与性能优化（2周）**
- [ ] 2.1 增量扫描状态存储（mtime/hash 比对）
- [ ] 2.2 并发扫描控制（最大 N=8 并行）
- [ ] 2.3 异步视频元数据收集（ffprobe）
- [ ] 2.4 `list()` 接口优化（默认读缓存）

**Phase 3：UI 与安全加固集成（2-3周）**
- [ ] 3.1 Dynamic Wallpapers 页（画廊视图 + 筛选）
- [ ] 3.2 托盘快捷菜单（最近 5 个）
- [ ] 3.3 加载动画 + 详细失败原因
- [ ] 3.4 IPC 入口 URL 验证
- [ ] 3.5 Web 壁纸 iframe sandbox
- [ ] 3.6 E2E 测试套件

**Phase 4：生产就绪（持续）**
- [ ] 4.1 性能基准测试
- [ ] 4.2 内存泄漏验证
- [ ] 4.3 错误上报机制
- [ ] 4.4 用户文档

## 五、安全加固清单（发布前逐项核对）

- [ ] CSP 绕过默认关闭，用户明确启用后才允许
- [ ] 所有外部传入的 URL 经过白名单校验
- [ ] HTTP 服务绑定 127.0.0.1（已正确）
- [ ] directory serving 有双重路径遍历防护
- [ ] Web 壁纸 iframe 添加 sandbox 属性
- [ ] CDP evaluate 中的动态字符串经 JSON.stringify 转义
- [ ] 错误消息不含敏感信息（生产环境）
- [ ] 依赖扫描无高危漏洞

## 六、总结

本方案的核心转变在于：**不再把壁纸引擎当作"锦上添花"的功能，而是作为与主题应用同等重要的核心特性来构建**。安全问题不能妥协，资源泄漏不可容忍，多种壁纸类型的支撑必须完备且一致。

从之前的代码审查来看，该项目在壁纸模块存在**多个严重且相互关联的问题**：安全漏洞（CSP 绕过）、功能错误（GIF 处理）、资源泄漏（token 累积）、架构混乱（单体模块）、类型弱化（any 泛滥）。这些不是孤立的 bug，而是系统性工程债务的体现。

修订后的方案将修复优先级的顺序调整为：**先堵洞再建楼**——Phase 0 的五个修复项完成后代码才能进入安全发布态，之后才逐步完善功能和性能。这是严格质量控制的必要步骤。

---

**文档生成时间：** 2026-07-27
