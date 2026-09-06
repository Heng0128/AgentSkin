# Codex 适配档案（AgentSkin）

> 文档日期：2026-08-19 | 实测版本：Codex v26.814（端口 62300/62640 双实拍）
> 对应文档：`docs/apps/codex/architecture.md`（逆向理解）、`docs/apps/codex/fragility.md`（脆弱性）
> 本档定位：**适配策略 + 实测结论**（区别于 architecture 的逆向理解）

---

## 1. 一句话画像

Codex 是 OpenAI 的 Electron 桌面应用（`app://` scheme），**主视觉完全由 `--color-token-*` 命名空间驱动**（25 个，钉在 `:root`）。它是 6 端里唯一一个"原生 token 命名空间最小、最集中"的——也是第一个发现"主题层假完整"问题的端。

## 2. 原生命名空间（实测）

| 命名空间 | 数量 | 角色 |
|---|---|---|
| `--color-token-*` | 25 | **唯一主视觉层**（bg/text/border/accent/surface/sidebar/dropdown/hover/focus/diff） |
| `--text-*` | 20 | Tailwind 排版字号（非颜色，no-op 陷阱源） |
| `--bg-*`/`--accent`/`--border-*` 等扁平 | 0 | 不存在（旧适配器曾假设存在 → 100% no-op） |

## 3. 适配策略（主题层单源）

| 层 | 文件 | 状态 |
|---|---|---|
| 主题层 | `scripts/theme-utils.mjs` → `codexColorTokenOverrides()` | ✅ 23/25 覆盖（`--color-token-*`），0 no-op |
| 引擎层 L0 | `engines/codex/tokens.css` | **占位**（no-op 占位，加载器/契约必需） |
| 门禁 | `src/engine/src/adapters/codex.mjs` | `rootAny: ["main[class*='MainContentSurface']"]`（哈希类，删了裸 `main` 反模式） |

### 3.1 故意保留原生（设计决策）
- `--color-token-charts-blue`（数据可视化品牌蓝）
- `--color-token-editor-warning-foreground`（编辑器警告橙）
- 背景类 token（bg-primary/side-bar/main-surface/dropdown）→ `transparent`（adapter 透出艺术层）

## 4. 专属特点 / 坑

1. **`--color-token-*` 是唯一真视觉**：旧生成器 `shellTokenOverrides` 打的扁平 token 全 no-op → "假完整"（主题看似应用，实际只有 color-scheme+text-shadow 生效）。
2. **根地标用哈希类**：`_MainContentSurface_`（CSS Modules），非上游 CodeDrobe 的 `main.main-surface`。实拍无 `#root` 祖先 → 上游 PR #7 的 `#root main` 对我们无效。
3. **bridge 重映射**：`css-var-bridge` 从死 flat var 重映射到 `--color-token-*`（text-primary→text-primary、border-subtle→border、bg-tertiary→bg-tertiary）。
4. **双 page target**：主窗口 + avatar-overlay，注入需过滤后者。

## 5. 实测结论（2026-08-19）

| 项 | 值 |
|---|---|
| 反向盲区 | 0（25/25，2 个故意保留） |
| no-op | 0 |
| 注入验证 | `--color-token-primary` #339cff→#6ee7d3、foreground→#e6ecf5、border→accent-tint ✅ |
| 版本漂移风险 | 低（token 名稳定，rootAny 哈希类抗漂移） |

## 6. 验证探针

- `debug-tools/apply-codex-theme.mjs`（注入验证）
- `scripts/cdp-full-extract.mjs --port <p> --name codex`（实拍）
