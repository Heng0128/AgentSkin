# AgentSkin 六端适配档案索引（ADAPTATION）

> 更新日期：2026-08-19
> 每端专属适配文档：`docs/apps/<agent>/ADAPTATION.md`（本索引为总览）

## 六端画像速览

| Agent | 架构族 | 主视觉命名空间 | host 选择器 | 适配架构 | 状态 |
|---|---|---|---|---|---|
| **Codex** | Electron (app://) | `--color-token-*`（25） | `html.agentskin-host-codex` | 主题层单源（引擎层占位） | ✅ 已修（假完整→真完整） |
| **ZCode** | Electron (file:// Vite) | `--color-*`（257，Tailwind v4） | `html.agentskin-host-zcode:root` | **主题层全权接管**（RFC A′） | ✅ 已修（作者失控→单源） |
| **TRAE Work** | VS Code 架构 | `--vscode-*`（3771）+ **icube 双前缀** | `html.agentskin-host-traework` | 引擎层+主题层双源 | ✅ 已修（阴影+死token+双前缀盲区） |
| **WorkBuddy** | VS Code 架构 | **三层**：`--cb-*`+`--vscode-*`+`--sc-ui-*` | **`body[data-application-name="workbuddy"]`** | 引擎层+主题层双源 | ✅ 已修（补 vscode 78 + sc-ui 24） |
| **豆包** | **chromium-webview** | `--semi-color-*`（semi 261）+ 废弃 `--dbx-*` | `html.agentskin-host-doubao` | 引擎层+主题层双源 + **data-testid 锚点** | ✅ 已修（dbx→semi 迁移 + body 遮蔽） |
| **QoderWork** | VS Code + antd 混合 | `--color-*`（111，antd） | `html.agentskin-host-qoderwork` | 引擎层+主题层双源 | ✅ **最健康**（111/111 零盲区） |

## 各端核心差异（为什么每端都要专属文档）

| 维度 | Codex | ZCode | TRAE | WorkBuddy | 豆包 | QoderWork |
|---|---|---|---|---|---|---|
| 主 token 数 | 25（最小） | 257（最大） | 3771 | 三层各数百 | 261 semi | 111 |
| 唯一特征 | 命名空间最小最集中 | Tailwind 语义面 | **双前缀并存** | **三层叠加** | **dbx→semi 迁移** | **antd 语义** |
| 特殊坑 | 根地标哈希类 | 扁平层是 adapter 契约 | body 遮蔽+死 token | host 选择器特殊 | body 遮蔽+webview 超时 | aicoding 非 DOM 变量 |
| 适配架构 | 主题层单源 | 主题层单源 | 双源 | 双源 | 双源+结构锚点 | 双源 |

## 方法论沉淀（2026-08-19）

1. **双向校验**：判定"适配完整"必须同时做 正向（我们的覆盖存在于原生）+ 反向（原生 token 全集 → 我们覆盖集，`probe-reverse-blindspot.mjs`）。仅正向会漏（traework icube/裸前缀、workbuddy sc-ui、doubao semi 语义色都是反向才暴露）。
2. **GitHub 对标**：同应用主题项目是盲区来源（Lucky2024→workbuddy vscode 层、Trae-Skin→traework icube、doubao-theme-engine→data-testid、qoder-skin-skill→aicoding 认知）。
3. **命名空间迁移警惕**：应用大版本可能迁移主 token 体系（codex `--color-token-*`、豆包 dbx→semi）——`lastVerified` 元数据 + 运行时探针是防线。
4. **body 遮蔽**：原生在 body 直接重声明 token 的端（traework/doubao），覆盖必须打到 body 级（`:root` 继承会被遮蔽）。

## 验证探针速查

- 反向盲区：`debug-tools/probe-reverse-blindspot.mjs <port> <agent>`
- 各端专用：见各 `docs/apps/<agent>/ADAPTATION.md` §6
