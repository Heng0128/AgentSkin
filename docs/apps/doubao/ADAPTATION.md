# 豆包 适配档案（AgentSkin）

> 文档日期：2026-08-19 | 实测版本：豆包（端口 63551，chromium-webview 架构）
> 对应文档：`docs/apps/doubao/architecture.md`（如存在）
> 本档定位：**适配策略 + 实测结论**

---

## 1. 一句话画像

豆包是字节的 Electron 应用（**chromium-webview 架构**，非 VS Code 族），主视觉由 **Semi Design 体系**驱动：`--semi-color-*`（语义层）与 `--s-*`（压缩层）并存，`--dbx-*` 是**已废弃的旧封装层**。它是 6 端里**唯一非 VS Code 架构**的端，也是唯一有**稳定 data-testid 锚点**的端。

## 2. 原生命名空间（实测）

| 命名空间 | 数量 | 角色 |
|---|---|---|
| `--s-*` | 298 | Semi 压缩命名（`--s-color-*` 等，聊天输入/面板/卡片） |
| `--semi-*` | 261 | **Semi Design 语义层（当前主视觉）** |
| `--dbx-*` | 251 | **已废弃**（规则声明仅 49 处，仅 `--dbx-bg-body-web` 残留） |
| `--color-*` | 92 | 其他语义色（含 `--color-link-text`） |
| `--md-*` | 34 | markdown 渲染体系（`--md-box-samantha-*`） |

### 2.1 命名空间迁移（核心认知）
- **旧适配假设 `--dbx-*` 是主 token**（2026-08-18 实拍时 dbx 251 个）→ **当前版本主视觉已迁移到 `--semi-color-*`**（规则声明 semi≈1498 vs dbx≈49）。
- 与 Codex 的 `--color-token-*` 迁移同型——**这是豆包适配"不全"的根因**。

## 3. 适配策略（引擎层 + 主题层双源）

| 层 | 文件 | 状态 |
|---|---|---|
| 引擎层 L0 | `engines/doubao/tokens.css` | ✅ 412 定义（semi 主面 + 语义色 + dbx 残留 + s-color） |
| 主题层 | `scripts/generators/doubaoCss.mjs` | ✅ 同源同步（449 定义） |
| 结构层 | `engines/doubao/adapter.mjs` | ✅ **data-testid 锚点**（2026-08-19 迁移） |

### 3.1 覆盖明细
- **semi 主面**（bg-0/1/2、text-0/1/2/3、primary、border、fill、link、nav-bg、overlay）✅
- **semi 语义色**（info/success/warning/danger/black/white/default + hover/active/disabled，反向盲区补 25 个）✅
- **dbx 残留**（body-web/base-2/float 等仍有效的）✅
- **s-color**（聊天输入/面板体系）✅
- **md-box-samantha**（markdown 渲染）✅
- **color-link-text** ✅

### 3.2 故意保留原生
- 语义色（semi-color-success/warning/danger 等用固定可辨识色值）
- 图表/数据色

## 4. 专属特点 / 坑

1. **body 级遮蔽**：豆包原生 CSS 在 **body 上直接重声明** `--semi-color-*`（`body, body[theme-mode="dark"] .semi-always-light`）——`:root` 级覆盖被遮蔽 → **必须 body 级 mirror**（2026-08-19 修复）。
2. **data-testid 稳定锚点**（46 个 distinct）：`chat_route_layout_leftside_nav`/`chat_input`/`chat_list_wrapper`/`create_conversation_button`/`container:main` 等——比哈希类抗漂移（2026-08-19 adapter 迁移）。
3. **chromium-webview**：`cdp-full-extract` 对豆包超时（工具限制），需轻量探针。
4. **`--dbx-*` 是旧层**：覆盖它的 token 大部分 no-op（保留必要残留即可），别往旧层投入。

## 5. 实测结论（2026-08-19）

| 项 | 值 |
|---|---|
| semi 主面 | ✅ body-mirror 后全部主题化（bg0 #16161a→#0a0e1a、primary→#6ee7d3） |
| semi 语义色 | ✅ 25 个补齐（info→极光青、white→#e6ecf5、link→#6ee7d3） |
| 反向盲区 | 已清零 |
| adapter 锚点 | data-testid 迁移完成（4 处，原类 fallback） |
| 注入验证 | semi 主面+语义色+markdown+link 全通过 ✅ |
| 版本漂移风险 | **高**（chromium-webview + dbx→semi 迁移证明版本变化大） |

## 6. 验证探针

- `debug-tools/probe-doubao-tokens.mjs` / `probe-doubao-token-check.mjs` / `probe-doubao-ns.mjs` / `probe-doubao-theme.mjs` / `probe-doubao-anchors.mjs` / `probe-doubao-input-anchor.mjs` / `probe-doubao-semantic.mjs`
- GitHub 对标参考：`styoha/doubao-theme-engine`（data-testid 锚点来源）
