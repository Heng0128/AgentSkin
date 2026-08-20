# P3a 实施计划 — fingerprint.ts 核心模块

## 一、子任务拆解

### 批次1：基础类型与工具（可并行）
| 子任务 | 内容 | 依赖 |
|--------|------|------|
| T1.1 | FingerprintError 错误类（RegenError + FingerprintCaptureError） | 无 |
| T1.2 | 哈希工具函数（computeTokenHash + computeCssHash） | node:crypto |
| T1.3 | DriftSignal / DriftResult 类型定义 | 无 |

### 批次2：核心模块（串行，依赖批次1）
| 子任务 | 内容 | 依赖 |
|--------|------|------|
| T2.1 | captureFingerprint() — CDP 探针采集 | T1.1, T2.2 |
| T2.2 | 存储层（loadBaseline + saveBaseline 原子写） | T1.1 |
| T2.3 | computeDriftScore() — 多信号漂移检测 | T1.3 |
| T2.4 | shouldAutoRegen() — 人工介入门控 | T1.3 |
| T2.5 | regenerateTheme() — deferred thunk + 并发守卫 | T2.1-T2.4 |

### 批次3：测试（串行，依赖批次2）
| 子任务 | 内容 | 依赖 |
|--------|------|------|
| T3.1 | capture/storage 单元测试 | T2.1, T2.2 |
| T3.2 | diff/shouldAutoRegen 单元测试 | T2.3, T2.4 |
| T3.3 | regenerate 集成测试 | T2.5 |

---

## 二、依赖关系图

```
fingerprint.ts 依赖链：
├── ir/errors.ts (ThemeAssetError, InferenceError)
├── ir/normalize.ts (COLOR_KEYS)
├── verify/probe.ts (probeAgent, ProbeResult)
├── cdp/cdp-client.ts (CdpSession)
├── catalog/theme-manifest.ts (ThemeColors)
└── cdp/baseline-validator.ts (FidelityVerdict) — 仅类型引用
```

无循环依赖（fingerprint.ts 是新叶子模块，不回头被依赖）。

---

## 三、验收标准

### P3a 验收（离线可测）
- [ ] captureFingerprint() 返回合法 ThemeFingerprint
- [ ] computeDriftScore() 在 selectorHitMap 下降时 score > 0.3
- [ ] computeDriftScore() 在 identical 输入时 score = 0
- [ ] shouldAutoRegen() 在 matchRatio < 0.5 时返回 manual_required
- [ ] fingerprint.json 写入/读取 round-trip 一致
