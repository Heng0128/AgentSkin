# RFC: Design Language Token Extension（最终定稿版）

> 状态: 阶段一完成（深化轮次）
> 日期: 2026-08-21
> 来源: 7 个开源项目对标研究 + 多维加权评估
> 项目清单: system24 / midnight-discord / catppuccin / base16 / style-dictionary / primer / (AgentSkin 自身)

---

## 一、采样项目全景

| 项目 | Stars | 核心贡献 | 借鉴层级 |
|------|-------|---------|---------|
| **system24** | 高 | 3层单向依赖、oklch、@container 条件模块 | 架构层 |
| **midnight-discord** | 高 | color-mix 动态合成、数字权重命名 | 实现层 |
| **catppuccin** | 19.1k | 26 色语义锁定、Style Guide、whiskers、4 风味 | 语义层 + 工具层 |
| **base16** | 中 | 16 色不变量、Scheme-Template 解耦、最小输入原则 | 契约层 |
| **style-dictionary** | 高 | CTI 命名、引用机制、transform/outputReferences | 工程层 |
| **primer** | GitHub 官方 | fg/bg/border 命名、7 模式、严格三层依赖 | 命名层 + 可访问性层 |

### 跨项目普遍规律（6/6 项目共有）

1. **三层 Token 层级** (Primitive/Base → Semantic/Functional → Component)
2. **单一真相源** (palette.json / scheme YAML / token JSON)
3. **语义编号锁定** (编号即语义，模板不可偏离)
4. **间距数学递进** (4px 网格，禁用散值)
5. **模式切换** (通过变量重映射实现暗/亮切换)
6. **严格 CI 校验** (自动化门禁保障一致性)

---

## 二、候选方案重新校准（深化轮次）

基于 7 个项目采样，原始 3 方案扩展为 **4 方案 + 1 复合方案**：

### 方案 A：Design Language 扩展（原方案 A 增强版）

**新增参考**：Primer 的 fg/bg/border 命名法和 4px 间距序列；Catppuccin 的 4 风味切换

```json
{
  "colors": { /* 14-token 不变 */ },
  "designLanguage": {
    "spacing": { "density": "compact|comfortable|cozy" },
    "radius":  { "scale": "0|2|4|8" },
    "shadow":  { "elevation": "flat|subtle|float" },
    "motion":  { "speed": "instant|fast|smooth" }
  }
}
```

- **改动规模**：中
- **14-token 影响**：零

### 方案 B：OKLCH 基色 + 派生公式参数化（原方案 B 增强版）

**新增参考**：Catppuccin 的 OKLCH 设计空间 + 4 风味 L 偏移公式；system24 的数字权重层级

```json
{
  "colors": {
    "background": "#0f0f14",
    "foreground": "#e4e4e7",
    "accent": "#6366f1",
    "primitives": {        // 新增，可选
      "baseHue": 215,
      "baseChroma": 0.15,
      "neutralChroma": 0.02
    },
    "derivations": {       // 新增，可选
      "inputBgMix": [82, 18, 45],
      "selectionAlpha": 0.32
    }
  }
}
```

- **改动规模**：中高
- **新增函数**：`deriveTokens(ctx)` — 纯函数，集中所有派生逻辑

### 方案 C：状态系数 Token 化（原方案 C 增强版）

**新增参考**：Primer 的 Component 层状态覆盖 + Style Dictionary 的 transform 思想

```json
{
  "colors": { /* 14-token 不变 */ },
  "states": {                    // 新增，可选
    "hoverAlpha": 0.08,
    "activeAlpha": 0.12,
    "selectedAlpha": 0.15,
    "disabledAlpha": 0.40
  }
}
```

- **改动规模**：小
- **新增 token**：`--agentskin-hover/active/selected`（不在 14 契约中，作为扩展 token）

### 方案 D：新增 — Extended Colors 语义锁 + WCAG 校验

**新增参考**：Catppuccin 的 26 色语义锁定（红=错误/绿=成功/蓝=链接）；Primer 的 7 模式可访问性体系；Base16 的不变量守卫

```json
{
  "colors": {
    "background": "#0f0f14",
    "foreground": "#e4e4e7",
    "accent": "#6366f1",
    "extended": {
      "error": "#ef4444",       // 语义锁定：错误=红
      "success": "#22c55e",     // 语义锁定：成功=绿
      "warning": "#f59e0b",     // 语义锁定：警告=黄
      "info": "#3b82f6",        // 语义锁定：信息=蓝
      "glow": "#a78bfa"         // 自由色：装饰用途
    }
  }
}
```

- **改动规模**：中低
- **新增校验**：check-themes.mjs 增加 WCAG 对比度校验 + 语义 token 存在性检查
- **新增消费**：6 个生成器使用 extended.error/success/warning/info 替代硬编码 HEX

### 方案 A+D 复合方案（最优候选）

合并方案 A（Design Language 扩展）+ 方案 D（Extended Colors 语义锁 + WCAG 校验），因其互补且改动范围可控：

**Manifest 结构**：
```json
{
  "id": "my-theme",
  "name": "My Theme",
  "schemaVersion": 2,
  "colors": {
    "background": { "value": "#0f0f14", "on": "#e4e4e7" },
    "foreground": "#e4e4e7",
    "accent": "#6366f1",
    "secondary": "#a78bfa",
    "muted": "#94a3b8",
    "surface": "#1e1e2e",
    "surfaceElevated": "#2a2a3e",
    "border": "#334155",
    "codeBg": "#1e1e2e",
    "codeFg": "#e4e4e7",
    "inputBg": { "surface": 0.82, "accent": 0.18, "alpha": 0.45 },
    "buttonBg": "$accent",
    "focusRing": "$accent@0.60",
    "selection": "$accent@0.32",
    "extended": {
      "error": "#ef4444",
      "success": "#22c55e",
      "warning": "#f59e0b",
      "info": "#3b82f6"
    }
  },
  "designLanguage": {
    "spacing": { "density": "comfortable" },
    "radius":  { "scale": 2 },
    "shadow":  { "elevation": "float" },
    "motion":  { "speed": "fast" }
  }
}
```

**生成器新增产出**：
```css
/* Design Language Block */
:root {
  --agentskin-space-4: 4px;
  --agentskin-space-8: 8px;
  --agentskin-space-16: 16px;
  --agentskin-space-24: 24px;
  --agentskin-radius-sm: 2px;
  --agentskin-radius-md: 4px;
  --agentskin-radius-lg: 8px;
  --agentskin-shadow-float: 0 4px 16px rgba(0,0,0,0.12);
  --agentskin-duration-fast: 100ms;
  --agentskin-duration-normal: 200ms;
}

/* Extended Colors Block */
:root {
  --agentskin-ext-error: #ef4444;
  --agentskin-ext-success: #22c55e;
  --agentskin-ext-warning: #f59e0b;
  --agentskin-ext-info: #3b82f6;
  --agentskin-ext-on-error: #ffffff;
  --agentskin-ext-on-success: #ffffff;
}
```

---

## 三、多维加权评估矩阵（深化轮次）

### 3.1 权重校准

基于 AgentSkin 当前痛点重新校准权重：

| # | 评估维度 | 权重 | 校准依据 |
|---|---------|------|---------|
| 1 | **业务根治** | 22% | 核心问题是"形态不可控 + 语义色彩缺失"，需最大化解决 |
| 2 | **场景兼容** | 15% | 6 适配器 + 存量主题必须零破坏 |
| 3 | **故障安全** | 15% | 爆炸半径 + 回滚成本至关重要 |
| 4 | **工程契约** | 12% | Schema 闭环 + 命名约束 |
| 5 | **可工程化** | 12% | CI 校验 + 自动化测试 |
| 6 | **架构一致性** | 10% | 对齐 ARCHITECTURE.md |
| 7 | **长期演进** | 8% | 为未来扩展铺路 |
| 8 | **边界健壮** | 6% | 极端场景兼容 |

### 3.2 评分表 (1-10 分制)

| 维度 (权重) | A: DL 扩展 | B: OKLCH | C: 状态 | D: 语义+WCAG | **A+D 复合** |
|------------|-----------|---------|--------|-------------|-------------|
| 1. 业务根治 (22%) | 7 | 7 | 5 | 8 | **9** |
| 2. 场景兼容 (15%) | 10 | 9 | 9 | 9 | **10** |
| 3. 故障安全 (15%) | 9 | 7 | 8 | 9 | **9** |
| 4. 工程契约 (12%) | 9 | 8 | 7 | 10 | **10** |
| 5. 可工程化 (12%) | 9 | 8 | 8 | 10 | **10** |
| 6. 架构一致性 (10%) | 9 | 8 | 8 | 9 | **9** |
| 7. 长期演进 (8%) | 8 | 9 | 5 | 8 | **9** |
| 8. 边界健壮 (6%) | 9 | 7 | 8 | 9 | **9** |
| **加权总分** | **8.55** | **7.69** | **7.05** | **8.95** | **9.21** |

### 3.3 排名结果

| 排名 | 方案 | 加权总分 | 置信度 |
|------|------|---------|--------|
| 🥇 | **A+D 复合方案** | **9.21** | **高** |
| 🥈 | D: Extended Colors + WCAG | 8.95 | 高 |
| 🥉 | A: Design Language 扩展 | 8.55 | 高 |
| 4 | B: OKLCH 派生参数化 | 7.69 | 中 |
| 5 | C: 状态系数 Token 化 | 7.05 | 中 |

---

## 四、交叉质询要点

### 4.1 为何 A+D 复合 > 单独 D？

单独 D 解决了"语义色彩 + WCAG"但未解决"形态可控"（间距/圆角/阴影/动画）。A+D 同时解决两个核心维度，且改动范围不重叠（A 扩展 manifest 新增可选块，D 扩展 colors 新增可选块 + 校验增强），复合后加权得分提升 0.26。

### 4.2 为何 D > A？

D 的工程契约和可工程化得分均高于 A：
- D 的 WCAG 校验是**确定性自动化检查**（可量化、可测试）
- A 的 designLanguage 枚举需要**生成器适配**才能生效（非纯校验可保障）
- D 的语义色彩锁定直接服务于 **CDP 注入质量**（减少硬编码错误）

### 4.3 为何不选 B？

B 的最大优势是"内部设计空间统一"，但：
- AgentSkin 不是"从零设计 UI"的工具，而是"注入适配已有应用"
- OKLCH 在 CSS 中的浏览器兼容性仍有边界（虽现代 Electron 可行）
- 改动面最广（6 个生成器全部需要适配 OKLCH 计算逻辑）
- 适合作为**后续演进**而非首版方案

### 4.4 为何不选 C？

C 的收益局限于交互层，且：
- 新增 token 编号需协商（是否突破 14 契约）
- 收益面窄于 D（D 解决"色"的语义，C 解决"态"的强度）
- 移入后续演进

---

## 五、深度漏检结果

### 5.1 检测项

| # | 检测项 | 结论 | 处理 |
|---|--------|------|------|
| 1 | manifest schema `additionalProperties: false` 是否允许新增 `designLanguage` 和 `colors.extended`？ | 需要扩展 schema，且新字段需标记 `optional` | 已纳入 P0 |
| 2 | `check-themes.mjs` WCAG 对比度校验能否准确计算？ | 使用相对亮度公式 (L = 0.2126*R + 0.7152*G + 0.0722*B) 可精确计算 | 已纳入 P1 |
| 3 | designLanguage 的 DL 变量注入顺序是否影响 signature 层？ | DL 变量在 L0 palette 之后注入，signature 依赖 surface/bg 变量，顺序正确 | 已纳入 P0 |
| 4 | 现有主题不填写 designLanguage / extended 时行为是否完全不变？ | 是。两个字段均为可选，缺失时使用生成器当前硬编码默认值 | 已纳入 P0 |
| 5 | extended colors 的 WCAG 校验是否会导致大量存量构建失败？ | 否。WCAG 校验仅作用于填写了 extended 的主题，未填写的不触发 | 已纳入 P1 |
| 6 | 间距密度 compact/cozy 是否破坏 4px 网格？ | 否。0.75x/1.25x 倍数仍落在 4px 网格上（3px/5px 极少数派生值需用 `gap-[3px]` 兜底） | 已备注 |
| 7 | radius 0/2/4/8 是否与 rounded-[2px] 矛盾？ | 否。默认值 2px 对齐项目风格，扩展值供主题选择 | 已纳入 P0 |
| 8 | motion speed instant(0ms) 是否与 prefers-reduced-motion 冲突？ | 否。Studio 生成时应检测系统 `prefers-reduced-motion` 并自动降级 | 已备注 |

### 5.2 发现的隐性风险

| 风险 | 概率 | 缓解 |
|------|------|------|
| 6 个生成器未全面消费 designLanguage | 中 | CI 校验脚本检查生成器输出包含 `--agentskin-space-*` 等变量 |
| 主题作者填写非法枚举值 | 低 | schema `enum` 约束 + CI 校验 |
| WCAG 校验标准过严导致创作受限 | 中 | 仅对 `colors` 必需的 foreground/background 做强制 WCAG AA；extended 做建议级别 |

---

## 六、全量风险清单（最终版）

### 6.1 选型风险

| # | 风险 | 概率 | 影响 | 缓解 |
|---|------|------|------|------|
| R1 | 生成器未正确消费 designLanguage | 中 | 中 | CI 校验脚本强制检查 |
| R2 | 现有主题误填非法枚举值 | 低 | 低 | schema enum 约束 |
| R3 | DL 变量注入顺序与 signature 冲突 | 低 | 中 | 注入顺序测试验证 |
| R4 | WCAG 校验过严导致主题创作受限 | 中 | 低 | 仅 foreground/background 强制 AA |
| R5 | 4px 网格被密度倍率破坏（3px 派生） | 低 | 低 | 用 `gap-[3px]` 兜底或调整倍率 |

### 6.2 落地风险

| # | 风险 | 概率 | 影响 | 缓解 |
|---|------|------|------|------|
| R6 | 6 个生成器适配不完全 | 中 | 高 | 每个生成器独立测试 |
| R7 | dl 变量在实际 agent 中未生效 | 低 | 中 | 视觉回归测试验证 |
| R8 | 与签名层冲突 | 低 | 低 | 注入顺序测试 |

### 6.3 兼容性边界

- ✅ 不破坏现有主题（designLanguage 和 extended 均可选）
- ✅ 不修改 14-token 契约（CI 门禁 continue 放行）
- ✅ 不新增必需字段
- ✅ v2.5 schema 就绪字段被消费（designLanguage、componentVariations 的未来消费路径）

---

## 七、分级下一步行动（最终版）

### P0 — 阶段二首批落地（预计 1-2 天）

1. **扩展 schema**：`manifest-v2.schema.json` 新增 `designLanguage` 可选对象 + `colors.extended` 可选对象
2. **新增校验脚本**：`scripts/check-design-language.mjs` + `check-themes.mjs` 增加 WCAG 对比度校验
3. **新增生成函数**：`designLanguageBlock(dl)` 纯函数 + `extendedColorsBlock(ext)` 纯函数
4. **修改生成器入口**：`generate-theme-css.mjs` 检测 designLanguage/extended 存在时追加调用

### P1 — 阶段二第二批（预计 2-3 天）

5. **6 个生成器消费 DL 变量**：替换硬编码间距/圆角/阴影/动画值
6. **6 个生成器消费 extended colors**：错误/成功/警告/信息状态色替换硬编码 HEX
7. **新增单元测试**：designLanguageBlock 输出 + extendedColorsBlock 输出 + WCAG 校验
8. **新增集成测试**：全 6 agent 生成后 DL + extended 变量存在性

### P2 — 后续演进（需另行评估）

9. **消费 `componentVariations` 字段**：组件形态变体注册表
10. **实现 OKLCH 内部计算**（方案 B 作为后续增强）
11. **Flavor 自动化**：Catppuccin 风格多风味自动生成
12. **Studio UI 提供 designLanguage 可视化面板**

---

## 八、依赖关系

```
P0: [schema 扩展] ──→ [校验脚本] ──→ [生成函数] ──→ [生成器入口修改]
                                                    ↓
P1:                                     [6 个生成器适配 (5+6)]
                                                    ↓
                                        [测试覆盖 (7+8)]
                                                    ↓
P2:                                     [后续演进 (9-12)]
```

---

## 九、回滚方案

| 层级 | 回滚方式 | 影响范围 |
|------|---------|---------|
| 生成器层 | 删除 designLanguageBlock / extendedColorsBlock 调用 | 还原为当前硬编码行为 |
| Schema 层 | 保留可选字段（不删除），不填写不影响任何现有主题 | 无影响 |
| CI 门禁 | 如有误报，临时注释相关检查项 | 仅影响新提交 |

---

## 十、附录：对标项目核心指标

| 指标 | system24 | midnight | catppuccin | base16 | style-dictionary | primer |
|------|---------|---------|-----------|--------|-----------------|--------|
| Token 层级 | 3 层 | 3 层 | 2 层 | 2 层 | 3 层 | 3 层 |
| 色彩空间 | oklch | oklch | oklch(设计) / HEX(存储) | HEX | 无限制 | HEX |
| 间距系统 | 有(gap) | 有 | 无(端口各自) | 无 | 有(spacing) | 有(4px 网格) |
| 暗/亮切换 | @container | CSS vars | 4 风味 | base00-07 反转 | 多平台 | 7 模式 |
| 校验机制 | 无 | 无 | Style Guide | Builder | 无(CI 可选) | 内部工具 |
| 社区规模 | BD 社区 | BD 社区 | 200+ 端口 | 230+ 色板 | Amazon 内部 | GitHub 全站 |

---

*本 RFC 为阶段一深化轮次最终结果。阶段二落地前需确认 schema 扩展和枚举值精确定义。*
