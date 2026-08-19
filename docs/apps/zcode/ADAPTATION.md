# ZCode 适配档案（AgentSkin）

> 文档日期：2026-08-19 | 实测版本：ZCode v3.6.5+（端口 50894 实拍，448 rootVars）
> 对应文档：`docs/apps/zcode/architecture.md`、`docs/apps/zcode/fragility.md`
> 本档定位：**适配策略 + 实测结论**

---

## 1. 一句话画像

ZCode 是 Tailwind v4 的 Electron 应用（`file://` Vite/React build，`#root` 挂载），**主视觉由 `--color-*` 家族（257 个）驱动**（background/surface/foreground/border/accent 等语义面）。它是 6 端里"原生 token 体系最庞大（257）"的端——也是唯一在 RFC 评审后走"主题层全权接管"架构的端。

## 2. 原生命名空间（实测）

| 命名空间 | 数量 | 角色 |
|---|---|---|
| `--color-*` | 257 | **唯一主视觉层**（Tailwind v4 语义面：bg/surface/fg/border/accent + 子体系） |
| `--color-token-*` | 0 | 不存在（非 Codex 族） |
| 扁平 `--text-*`/`--bg-*`/`--button-*` | 引擎自建 | adapter 结构层消费（var(--x, fallback)） |

### 2.1 主视觉语义族（257 内的重点）
- 主面：`--color-background/surface/foreground/border/accent/primary/secondary`
- 次级面：`--color-card/popover/tooltip/menu/sidebar/panel/input/tab`
- 节点体系：`--color-{subagent,plugin,skill}-node*`
- 终端 16 色 ANSI：`--color-terminal-{black,red,green,...,bright-*}`（**功能语义色，保留原生**）

## 3. 适配策略（主题层全权接管，RFC 2026-08-19 A′ 方案）

| 层 | 文件 | 状态 |
|---|---|---|
| 主题层 | `scripts/theme-utils.mjs` → `zcodeColorTokenOverrides()` | ✅ 65+16 覆盖（主面 + 次级面） |
| 引擎层 L0 | `engines/zcode/tokens.css` | **占位**（RFC A′：主题层单源，引擎层 no-op） |
| 生成物 | `themes/*/assets/css/zcode.css` | 65 主面 + 16 次级面 + 扁平语义段 |

### 3.1 适配历史（重要）
- **旧病**：`zcodeCss.mjs` 曾委托 `shellTokenOverrides`（扁平 token 全 no-op，同 Codex 旧病）。
- **但引擎层当时是对的**（`--color-*` 65 个调色板感知）→ zcode 不是"假完整"而是"作者失控 + 双写"。
- **RFC A′ 决策**：主题层新增 `zcodeColorTokenOverrides` 接管主视觉，引擎层占位化——与 Codex 修复后完全同构（6 端统一心智）。

### 3.2 故意保留原生
- 终端 16 色 ANSI 全系（功能语义色）
- 语义色（success/warning/destructive 等已主题化，但保留可辨识性）

## 4. 专属特点 / 坑

1. **Tailwind v4 语义面命名**：`--color-*` 是语义命名（非颜色值命名），覆盖需按语义面（background/surface 等），不是色值。
2. **host 选择器 `html.agentskin-host-zcode:root`**：高特异性压制 `.theme-zai-dark`。
3. **扁平语义段是 adapter 契约**：`--text-*`/`--bg-*` 等由主题层产出、adapter 消费（var(--x, fallback)），不能删。
4. **`--color-*` ×257 覆盖面**：主面 65 + 次级面 16 覆盖后，剩余为布局/图表/低使用率 token（不追全量）。

## 5. 实测结论（2026-08-19）

| 项 | 值 |
|---|---|
| 主面覆盖 | 65（引擎层原面，全部有效） |
| 次级面（反向盲区补） | 16（popover-fg/menu-hover/card-selected/node 系列） |
| no-op | 0 |
| 注入验证 | popover-foreground→#e6ecf5、card-selected→aurora mix、subagent-node-fg→#e6ecf5 ✅ |
| 版本漂移风险 | 中（Tailwind 语义面稳定，但类名哈希多） |

## 6. 验证探针

- `debug-tools/smoke-zcode-inject.mjs`（注入验证）
- `scripts/cdp-full-extract.mjs --port <p> --name zcode`（实拍）
