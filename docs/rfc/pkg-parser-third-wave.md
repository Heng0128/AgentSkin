# PKG 壁纸解析器第三波升级 — 最终选型报告

> **日期**: 2026-08-26
> **状态**: 选型完成，等待执行
> **最优方案**: 方案 δ（评分 8.65）

---

## 一、核心发现

### 1.1 extractSceneAsync 的真实阻塞分布

```
readFileSync (PKG文件读取)     ~10-15%   I/O 阻塞
parseTex (BC7/DXT 解码)       ~45-60%   CPU 密集  ← 真正瓶颈
texToDataUrl (base64 编码)     ~15-25%   CPU + 内存拷贝
buildRenderLayers (几何计算)    ~5%       CPU
```

### 1.2 renderSceneToStaticHtmlAsync 的 CRITICAL 类型 Bug

```
当前代码（scene-renderer-html.ts:98）：
  return renderSceneToStaticHtml(scene.objects as unknown as RenderLayer[]);

SceneObject[]  →  RenderLayer[]  零字段重叠
  id, name, origin, scale, image       dataUrl, frames, x, y, scaleX, scaleY

layer.frames → undefined, layer.dataUrl → undefined → 输出纯黑 HTML
```

已有桥接函数 `buildRenderLayers`（`scene-renderer-layers.ts:28`）可正确转换。

---

## 二、方案对比

| 方案 | 业务根治 | 场景兼容 | 故障安全 | 工程契约 | 可工程化 | 架构一致性 | 长期演进 | 边界健壮 | 总分 |
|------|:-------:|:-------:|:-------:|:-------:|:-------:|:---------:|:-------:|:-------:|:----:|
| γ 原始声明 | 9 | 8 | 7 | 10 | 10 | 8 | 10 | 10 | 8.91 |
| γ 修正后 | 7.5 | 8 | 5.5 | 8 | 9 | 7.5 | 7 | 7 | 8.39 |
| **δ 推荐** | **7.5** | **8.5** | **7.5** | **8.5** | **9** | **8.5** | **7** | **8** | **8.65** |

---

## 三、最终选定 — 方案 δ

### 3.1 分阶段改动

| Phase | 改动 | 文件 | 行数 | 风险 |
|-------|------|------|------|------|
| **Phase 1** | 修复 renderSceneToStaticHtmlAsync 类型 Bug + weInstallRoot 透传 + dynamic import → static import | scene-renderer-html.ts | ~15 | 低 |
| **Phase 2** | 缓存 key 改为 `pkgPath:mtimeMs`，可选 byte-size eviction | scene-extractor.ts | ~10 | 低 |
| **Phase 3** | handleRenderRequest 改 async + `mode: 'static'\|'full'` 字段 + L1 走 Worker Pool | scene-renderer-worker.ts, scene-renderer-async.ts, media-registry.ts | ~50 | 中 |

### 3.2 Phase 1 修复核心

```typescript
// Before（黑屏 Bug）:
return renderSceneToStaticHtml(scene.objects as unknown as RenderLayer[]);

// After（正确桥接）:
const weInstallRoot = options?.weInstallRoot ?? deriveWeInstallRoot(pkgPath);
const layers = buildRenderLayers(scene, weInstallRoot);
return renderSceneToStaticHtml(layers);
```

### 3.3 Phase 3 关键安全约束

**CRITICAL**: `handleRenderRequest` 必须改为 `async` 函数，否则 G4 的 Worker Pool 路由会引入 unhandled rejection 路径。

```typescript
// Before（同步，try/catch 无法捕获 async throw）:
export function handleRenderRequest(request: RenderRequest): WorkerResponse {
  try { return { html: renderSceneToHtml(...) } }
  catch (error) { return { html: null, error: String(error) } }
}

// After（async，完整错误边界）:
export async function handleRenderRequest(request: WorkerRequest): Promise<WorkerResponse> {
  try {
    const html = request.mode === 'static'
      ? await renderSceneToStaticHtmlFromPkg(request.pkgPath, request.options)
      : renderSceneToHtml(request.pkgPath, request.options);
    return { requestId: request.requestId, html };
  } catch (error) {
    return { requestId: request.requestId, html: null, error: String(error) };
  }
}
```

Worker 消息监听器改为：
```typescript
parentPort?.on('message', async (request: WorkerRequest) => {
  if (!request || typeof request.requestId !== 'number') {
    parentPort?.postMessage({ requestId: -1, html: null, error: 'Invalid request' });
    return;
  }
  try {
    const result = await handleRenderRequest(request);
    parentPort?.postMessage(result);
  } catch (error) {
    parentPort?.postMessage({ requestId: request.requestId, html: null, error: String(error) });
  }
});
```

### 3.4 不改动的项目

| 不做 | 原因 |
|------|------|
| Worker 入口请求验证（G3） | 已在 production 代码中实现 |
| BC7 mode 0-3 精确化 | 用户确认暂缓 |
| fast-png / 手写 PNG 替换 | ROI 不足 |
| binary-parser 引入 | 零新依赖原则 |
| SceneData 中内嵌 RenderLayer[] | 违反 C4 分层 |

---

## 四、验收标准

| Phase | 验证 |
|-------|------|
| Phase 1 | `renderSceneToStaticHtmlAsync` 返回含 `<img>` 的 HTML，**非纯黑** |
| Phase 2 | 修改文件 mtime 后 30s 内同路径调用返回**不同**解析结果 |
| Phase 3 | Worker 内 `throw` → pool 内 Promise reject + worker alive 翻 false |
| 协议兼容 | 旧版 worker binary 无 `mode` 字段时继续走 full 路径 |
| 全量测试 | `npm test` 全绿（排除 7 个预存失败） |
| Biome | 0 errors |

---

## 五、风险清单

| 风险 | 等级 | 缓解 |
|------|------|------|
| Phase 3 async handleRenderRequest 引入 unhandled rejection | 高 | 已在外层 listener 加 try/catch |
| 缓存 mtime 增加 stat 调用 | 低 | `fs.promises.stat` 非阻塞 |
| L1 Worker 路由对低配设备的内存压力 | 中 | Worker Pool maxSize 可配置（Phase 3 包含） |
| `mode` 字段协议扩展的向后兼容 | 中 | 默认 `'full'`，与旧版一致 |
