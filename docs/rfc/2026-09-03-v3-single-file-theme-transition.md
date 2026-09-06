# RFC: V3 单文件主题 — 一次性直接切换（无转换器、无共存期）

- **日期**: 2026-09-03（v3，修正自 v2；v2 曾假设"引擎层已全覆盖生成器内容"，经审计证伪）
- **状态**: 待评审
- **决策来源**: 老板 2026-09-03 —— "不需要过渡，这个版本直接变成 V3，不要转换器"。

---

## 0. 审计修正（v2 → v3 的关键变更）

执行期引擎覆盖度审计（scripts/audit-engine-coverage.mjs）推翻 v2 的核心假设：

| v2 假设 | 审计事实 |
|---------|---------|
| 冻结 CSS 内容 ≈ 引擎 tokens/cosmetic 层（删文件安全） | **部分成立**：traework/qoderwork/workbuddy/doubao 引擎层已覆盖大半（Gate B 缺口仅 36 token）；**但 codex/zcode 引擎 token 层是当年刻意留空**（theme 层持有映射权），且大量结构规则（workbuddy 45、doubao 31 选择器缺口）引擎层没有 |
| 缺口可"一次性补进引擎层"（静态移植） | **不可行**：生成器含 **mode 分支值**（`titleBarFg = isLight ? '#1f2937' : '#fff'`）、**shade() 派生色**（accent hover 亮暗按 mode 翻转）、**palette 亮度计算参数**（art 层 wash 百分比）——这些是 palette/mode 的函数，无法静态写进共享引擎 CSS |
| 需新建 V3 schema + 加载归一化层 | **引擎侧 v3 基建已存在**：`src/engine/src/theme/package.mjs` `buildThemePackage` 已支持 v3 源码格式（themeCss + apps[] + 可选 overrides/<app>.css，`scopeCssWithHost` 按 host class 包装）；被拒只因**目录加载器（ThemePackageLoader/manifest-validator）只认 v2 schema** |

**修正后架构**：V3 不是"把生成器内容搬进引擎"，而是**引擎已是权威、加载器接上 v3**。
生成器产出继续作为 theme.css 的构建来源；v3 包结构统一为
`theme.css（语义基础）+ overrides/<app>.css（该应用特有部分）`。

## 1. V3 包格式（引擎已实现，此处定稿语义）

```
<id>/
├── manifest.json      # schemaVersion: 3；semanticVersion≥1 或 themeCss 触发 v3 路径
├── theme.css          # 语义部件选择器基础层（可为空壳）；经 scopeCssWithHost 注入
├── overrides/<app>.css # 可选：该应用特有覆盖（v3 官方机制）
├── hero.jpg|webp|png
├── icon.webp          # 缺失自动生成
└── preview.webp       # 缺失自动生成
```

加载路径：`buildThemePackage`（v3 分支）→ targets[app].css =
`scope(theme.css, host) + overrides/<app>.css` → 既有注入链路零改动。

## 2. 存量 16 主题处置：机械升级（非转换器）

16 个 v2 主题的冻结 per-agent CSS 由生成器从 palette 确定性产出（Gate A 实证：
除模板进化外与当前生成器逐字节同构，零手写）。机械升级两步：
1. `assets/css/<app>.css` → `overrides/<app>.css`（文件搬移，内容不动）
2. manifest 改写为 v3 形状（schemaVersion 3 + themeCss: 最小占位 + apps[] + overrides 引用）

渲染 1:1 保真（同一份 CSS 内容走同一注入位），无转换、无丢失、可随时 git 回滚。
后续去重是增量优化：overrides 中与引擎 tokens/cosmetic 重复的规则可逐步删除，
由 `scripts/audit-engine-coverage.mjs` 的 Gate B/C 报告持续指引。

## 3. 实施清单（修订）

1. ✅ 引擎覆盖度审计脚本（已完成，报告 docs/reports/2026-09-02-v3-engine-coverage-audit.md）
2. 目录加载器接 v3：manifest-validator 按 schemaVersion 路由（v1/v2 → 拒 + 指引；
   v3 → 走 engine buildThemePackage 或等价校验）
3. `scripts/upgrade-themes-to-v3.mjs`：16 主题 dry-run + 执行（§2 两步）
4. 资产生成：icon/preview 缺失自动生成（Pillow/脚本，登记 INDEX）；hero 永不降分辨率
5. sakura-pastel-v3 补齐资产后经 v3 路径上架，dev 日志无 WARN
6. 生成器 / wallpaper-theme / theme-from-image 产 v3 包（不写 assets/css）
7. 全量 npm run check + 逐主题注入验收

## 4. 验收与风险

- 验收：sakura 上架可用；16 主题注入 verification 读数与迁移前一致（同一 CSS 内容）
- 风险：加载器改动影响面（catalog/installer/import 三路）——以现有 catalog 单测为网
- C2/C3：v3 colors 仍过 14-token 契约；冻结 CSS 消失后 check-theme-staleness 相应退役


对 16 个 V2 主题逐一审计（`themes/` 共 17 包：16×v2 + 1×v3 实验），证据链：

1. **96 份 per-agent CSS 全部是机器生成的冻结产物**，由
   `src/shared/theme/generators/{traework,qoderwork,workbuddy,doubao,codex,zcode}Css.mjs`
   从 manifest 的 14-token 色板确定性展开。跨主题 diff（剥离色值）证明：
   除注释标题与 `color-scheme`/`text-shadow` 等 palette 派生值外**逐字节同构**，
   无任何手写主题个性内容。
2. **冻结 CSS 的三段内容在引擎层全部已有运行时等价物**：
   | 冻结 CSS 段 | 引擎层等价物 |
   |---|---|
   | 14-token 块 | Layer 0 palette.css（manifest.colors → 注入期生成） |
   | 原生 token 映射（--dbx-* 等 ~650 行） | Layer 1 `engines/<agent>/tokens.css`（自述 "theme-agnostic, never needs regeneration"，doubao 828 行） |
   | hero 背景层 + 透明化结构规则 | Layer 2 cosmetic.css（已消费 `--agentskin-art`，doubao 158 行） |
3. 结论：**V2 包 = palette（已在 manifest）+ 引擎已有的 theme-agnostic 层的过期快照**。
   切 V3 不是"转换 CSS"，而是"扔掉快照、升版 manifest"。

