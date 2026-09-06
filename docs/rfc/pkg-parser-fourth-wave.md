# PKG 壁纸解析器第四波升级 — 最终选型报告

> **日期**: 2026-08-26
> **状态**: 选型完成，等待执行
> **最优方案**: 方案 delta-4（评分 8.7-9.0）

---

## 一、审计发现的原方案缺陷

方案 delta-3（8.93 分）经独立评审后修正为 ~7.9 分。核心问题：

| 问题 | 原因 |
|------|------|
| 缓存已存在 | extractSceneAsync 在 Phase 2 已实现 mtime 缓存，delta-3 属于重复建设 |
| Knip 冗余 | 已有 detect-dead-code.mjs，Biome 也覆盖 unused exports |
| 业务根治虚高 | 4 个子改动均为清理+防护，无一致触及 CPU 密集瓶颈（parseTex 45-60%） |
| 长期演进虚高 | Knip 是静态分析工具，与架构演进无关 |

---

## 二、最终选定 — 方案 delta-4

### 2.1 核心思路

不要在主进程内新增异步封装，而是让 Worker 直接使用带缓存的 extractSceneAsync。

### 2.2 改动范围

| Phase | 改动 | 文件 | 行数 | 风险 |
|-------|------|------|------|------|
| Phase 1 | 删除 renderSceneToStaticHtmlAsync 死导出 | scene-renderer-html.ts | -18 | 极低 |
| Phase 2 | Worker 内 renderStaticFromPkgSync 改用 async 版本 | scene-renderer-worker.ts | ~20 | 低 |
| Phase 3 | 新增 6 个缓存单元测试 | scene-extractor.test.ts | ~80 | 极低 |
| Phase 4 | 新增 2 个 WorkerPool FIFO 排队测试 | scene-renderer-async.test.ts (新) | ~60 | 极低 |

不执行：
- 不提取 scene-cache.ts（缓存已在 extractor 内封装）
- 不引入 Knip（已有 detect-dead-code.mjs）
- 不引入 p-queue（当前无并发瓶颈）
- 不修改 sync extractScene（Worker 不需要 sync 版）

### 2.3 Phase 2 核心：Worker 内 async 化

Before（scene-renderer-worker.ts:63-90 — 同步，无缓存）：
```typescript
function renderStaticFromPkgSync(pkgPath, options) {
  const scene = extractScene(pkgPath);  // 无缓存，阻塞 Worker
  ...
}
```

After（异步，自动享受 mtime 缓存）：
```typescript
async function renderStaticFromPkgAsync(pkgPath, options) {
  const scene = await extractSceneAsync(pkgPath);  // 带 mtime 缓存
  ...
}
```

handleRenderRequest 已经是 async 函数，只需将内部调用从 sync 改为 await。

---

## 三、多维评分对比

| 维度 | 权重 | delta-3 | delta-4 |
|------|------|:-------:|:-------:|
| 业务根治 | 20% | 5 | 9 |
| 场景兼容 | 13% | 8 | 10 |
| 故障安全 | 13% | 7 | 9 |
| 工程契约 | 10% | 7 | 9 |
| 可工程化 | 10% | 9 | 8 |
| 架构一致性 | 10% | 6 | 9 |
| 长期演进 | 12% | 5 | 8 |
| 边界健壮 | 12% | 6 | 8 |
| **总分** | | **~7.9** | **8.7-9.0** |

评分依据：
- delta-4 业务根治 = 9：Worker 使用带缓存的 extractSceneAsync 是真正的根治
- delta-4 场景兼容 = 10：删死代码 + Worker 内部改动对外零影响
- delta-4 架构一致性 = 9：复用已有的缓存和 async 机制，不引入新抽象
- delta-4 长期演进 = 8：Worker 全异步化是未来全管线 async + Worker 内进度报告的基础

---

## 四、验收标准

| Phase | 验证 |
|-------|------|
| Phase 1 | renderSceneToStaticHtmlAsync 在 scene-renderer-html.ts 中不存在 |
| Phase 2 | Worker 内 renderStaticFromPkg 使用 extractSceneAsync |
| Phase 2 | L1 输出含 img 而非纯黑（zero-runtime 契约保持） |
| Phase 3 | 6 个缓存测试：命中/mtime 变化/TTL 过期/LRU 驱逐 |
| Phase 4 | 2 个 WorkerPool 测试：FIFO 排队/worker 替换 |

---

## 五、风险清单

| 风险 | 等级 | 缓解 |
|------|------|------|
| Worker 内 fs.promises 可用性 | 低 | Node.js worker_threads 支持完整 fs API |
| extractSceneAsync 的 stat 失败回退 | 低 | catch 回退到 pkgPath-only key |
| Worker async 化后错误传播路径变化 | 低 | handleRenderRequest 已是 async + try/catch |
| 测试 mock Worker 的复杂度 | 中 | 使用 vi.mock + createMockWorker 工厂 |
