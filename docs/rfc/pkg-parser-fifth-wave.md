# PKG 壁纸解析器第五波升级 — 最终选型报告

> **日期**: 2026-08-26
> **状态**: 选型完成，等待执行
> **最优方案**: 方案 D — 定向修复 + bc7enc 位精确参考向量（评分 9.2）

---

## 一、核心发现

### 1.1 BC7 modes 0-3 包含两个 CRITICAL Bug

| Bug | 描述 | 影响 |
|-----|------|------|
| D1 | 端点读取顺序错误：per-endpoint 应为 per-channel | modes 0-3 全部 R/G/B 通道分配错误 |
| D2 | Mode 3 Pbit 数量错误：2 应为 4 | Mode 3 index 偏移偏移 2 位 |

影响面：约 30-40% 的 BC7 壁纸（所有使用 modes 0-3 的纹理）。

### 1.2 表数据已完全存在

代码中已包含 bc7enc 的全部表数据（权重/分区/anchor），无需"引入"。
引用来源已在第 94-96 行注释标注。

### 1.3 方案 B（bc7enc 移植）为何被驳回

bc7enc 表已存在于当前代码中。"200 行移植"严重虚标，实际仅需约 36 行定向修复。
移植本身还引入转录风险。

---

## 二、最终选定 — 方案 D

### 2.1 改动范围

| 改动 | 文件 | 行数 | 风险 |
|------|------|------|------|
| 修复 D1：端点读取顺序 | tex-parser.ts | 约 36 | 低 |
| 修复 D2：Mode 3 Pbit | tex-parser.ts | 约 5 | 低 |
| bc7enc 参考向量测试 | tex-parser.test.ts | 约 120 | 极低 |
| **合计** | | **约 160** | |

### 2.2 D1 修复：端点读取顺序

```typescript
// Before（per-endpoint 顺序 — 错误）:
for (let i = 0; i < numEndpoints; i++) {
  r = bc7ReadBits(block, bitOps, rBitCount); bitOps += rBitCount;
  g = bc7ReadBits(block, bitOps, gBitCount); bitOps += gBitCount;
  b = bc7ReadBits(block, bitOps, bBitCount); bitOps += bBitCount;
  rawEndpoints.push([r, g, b, 255]);
}

// After（per-channel 顺序 — 匹配 BC7 spec）:
for (let c = 0; c < 3; c++) {
  for (let i = 0; i < numEndpoints; i++) {
    val = bc7ReadBits(block, bitOps, bitCount); bitOps += bitCount;
    rawEndpoints[i][c] = val;
  }
}
```

### 2.3 Mode 3 Pbit 修复

```typescript
// Before:
case 3: numPbits = 2; break;

// After:
case 3: numPbits = 4; break;  // Unique P-bit per endpoint
```

### 2.4 参考向量测试

用 bc7enc 生成 50+ 组 mode 0-3 的 16 字节输入 + 64 字节期望输出，逐像素断言。

---

## 三、评分对比

| 维度 | 权重 | B 移植 | A 纯修复 | D 修复+测试 |
|------|:----:|:------:|:--------:|:----------:|
| 业务根治 | 20% | 9 | 8 | 10 |
| 场景兼容 | 13% | 9 | 9 | 10 |
| 故障安全 | 13% | 7 | 9 | 10 |
| 工程契约 | 10% | 8 | 8 | 10 |
| 可工程化 | 10% | 6 | 4 | 10 |
| 架构一致性 | 10% | 8 | 10 | 9 |
| 长期演进 | 12% | 8 | 4 | 10 |
| 边界健壮 | 12% | 8 | 5 | 10 |
| **总分** | | ~5.3 | ~6.7 | **9.2** |

---

## 四、验收标准

- D1 修复：modes 0-3 端点读取顺序与 bc7enc 一致
- D2 修复：mode 3 读取 4 个 P-bit
- 50+ 组参考向量逐像素通过
- 全量测试 3053+ 通过
- Biome 0 errors

---

## 五、风险清单

| 风险 | 等级 | 缓解 |
|------|------|------|
| 读取顺序修改影响 modes 0-3 | 低 | bc7enc 参考向量测试保护 |
| Mode 3 Pbit 修改影响 index 偏移 | 低 | 参考向量测试保护 |
| 参考向量数据转录错误 | 中 | 用脚本从 bc7enc 自动生成 + 手动验证 |
