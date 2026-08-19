# TRAE Work 适配档案（AgentSkin）

> 文档日期：2026-08-19 | 实测版本：TRAE Work CN（端口 58510，VS Code 架构）
> 对应文档：`docs/apps/traework/architecture.md`、`docs/apps/traework/fragility.md`
> 本档定位：**适配策略 + 实测结论**

---

## 1. 一句话画像

TRAE Work 是 VS Code 架构的 Electron 应用（ByteDance Trae 中国版），**主视觉由 `--vscode-*`（3771 个）驱动**，且**同一 token 家族以 `--vscode-icube-*` 和裸前缀双体系并存**——这是它最独特的结构（6 端唯一双前缀）。

## 2. 原生命名空间（实测）

| 命名空间 | 数量 | 角色 |
|---|---|---|
| `--vscode-*` | 3771 | 主视觉（VS Code 工作台：editor/sidebar/tab/panel/input/list/menu） |
| `--vscode-icube-*` | 大量 | **icube 自命名空间**（TRAE 语义封装：bg/text/icon/brand/border 系） |
| 裸 `--bg-bg-*`/`--text-text-*`/`--icon-icon-*` | 大量 | **icube 同家族裸前缀版本**（双体系核心特征） |
| `--bg-*` | 36 | 应用根级（`html[data-theme]` 声明，body 遮蔽需容器级补打） |

### 2.1 双前缀体系（核心认知）
TRAE 将同一语义 token 同时以两种形式暴露：
- **`--vscode-icube--bg-bg-base-default`**（带 vscode 前缀）
- **`--bg-bg-base-default`**（裸前缀）

两套都真实存在于运行时——**只覆盖其中一套会留盲区**（这是反向盲区检测的最大收获）。

## 3. 适配策略（引擎层 + 主题层双源）

| 层 | 文件 | 状态 |
|---|---|---|
| 引擎层 L0 | `engines/traework/tokens.css` | ✅ 119 token（vscode 主面 + icube 41 + 裸前缀 26） |
| 主题层 | `scripts/generators/traeworkCss.mjs` | ✅ 同源同步 |
| 门禁 | `src/engine/src/adapters/traework.mjs` | `lastVerified` 0.1.36 |

### 3.1 覆盖明细
- **vscode 主面**（editor/sideBar/tab/panel/input/list/menu/scrollbar/selection/focusBorder/textLink）✅
- **icube 前缀**（`--vscode-icube--bg-bg-*`/`--text-text-*`/`--icon-icon-*`/`--bg-bg-invert-*`/border）✅ 41 个
- **裸前缀**（`--bg-bg-menu/tooltip/brand*`/`--text-text-*`/`--icon-icon-*`）✅ 26 个
- **缺陷修正**（`native-defect-fixes.mjs` 注册表）：chat-bubble-shadow / user-message-surface / message-navigator-mask / **task-list-shadow**（2026-08-19 补）

### 3.2 故意保留原生
- `--vscode-*` 语义色（error 等）
- 终端 ANSI 色

## 4. 专属特点 / 坑

1. **双前缀**：icube 家族带/不带 `--vscode-` 前缀双存在，必须都覆盖（反向盲区最大发现）。
2. **body 级遮蔽**：`html[data-theme]` 在根声明 `--bg-bg-*`，body 级覆盖需容器级补打（`.messageInputChatInput`/`.task-list-base` 等）。
3. **死 token 教训**：`--vscode-selection-background`（kebab）源码 0 处——VS Code 系必须用 camelCase（`selectionBackground`），kebab 是死 token。
4. **裸 `main` 反模式**：rootAny 不能有裸 `main`（会误匹配路由/辅助面，CodeDrobe PR #7 测试证实）。

## 5. 实测结论（2026-08-19）

| 项 | 值 |
|---|---|
| 反向盲区 | 已清零（vscode 主面 22/23 + icube 41 + 裸前缀 25/25） |
| 阴影缺陷 | 3 处渐变遮罩（task-list-shadow/navigator mask）已注入消除 |
| 死 token | `--vscode-selection-background` 已清 |
| 注入验证 | bg-bg-menu→aurora、brand→#6ee7d3、icon→#e6ecf5 ✅ |
| 版本漂移风险 | 中（vscode token 稳定，但哈希类/双前缀易漏） |

## 6. 验证探针

- `debug-tools/probe-traework-tokens.mjs` / `probe-traework-blindspot.mjs` / `probe-traework-bare.mjs` / `probe-traework-shadowfix.mjs` / `probe-traework-selection.mjs`
- `debug-tools/cleanup-traework-verify.mjs`
