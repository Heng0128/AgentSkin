# WorkBuddy 适配档案（AgentSkin）

> 文档日期：2026-08-19 | 实测版本：WorkBuddy 5.3.14（端口 50489，VS Code 架构）
> 对应文档：`docs/apps/workbuddy/architecture.md`、`docs/apps/workbuddy/fragility.md`
> 本档定位：**适配策略 + 实测结论**

---

## 1. 一句话画像

WorkBuddy 是腾讯的 Electron 应用（VS Code 架构，本产品自家工作台），主视觉由**三层 token 体系**驱动：`--cb-*`（WorkBuddy 封装层）、`--vscode-*`（VS Code 工作台层）、`--sc-ui-*`（独立组件库层）。它是 6 端里**分层最多**的端（3 层），且 host 选择器特殊（`body[data-application-name="workbuddy"]`）。

## 2. 原生命名空间（实测）

| 命名空间 | 数量 | 角色 |
|---|---|---|
| `--cb-*` | 466 | WorkBuddy 封装层（聊天面板/团队卡片/自绘组件） |
| `--vscode-*` | 867 | VS Code 工作台层（editor/sideBar/tab/panel/menu/terminal） |
| `--wb-*` | 863 | 基础变量（我们注入层的 `--wb-accent/surface/text` 等） |
| `--sc-ui-*` | 19+ | **独立组件库**（text/bg/surface/primary/danger/success/warning/focus-ring 全套） |
| `--sc-*` | 若干 | sc-ui 相关（text-default/inline-code-bg/divider 等） |

### 2.1 三层认知（核心）
WorkBuddy 不是单一 token 体系，而是三层叠加：
1. **`--cb-*`**：WorkBuddy 自绘 UI 的主视觉（先期适配只覆盖这层）
2. **`--vscode-*`**：VS Code 工作台 chrome（editor/sidebar 等）——**曾完全未覆盖**（GitHub 对标 Lucky2024 后补 78 个）
3. **`--sc-ui-*`**：独立组件库（反向盲区发现）——**曾完全未覆盖**（补 24 个）

## 3. 适配策略（引擎层 + 主题层双源）

| 层 | 文件 | 状态 |
|---|---|---|
| 引擎层 L0 | `engines/workbuddy/tokens.css` | ✅ 197 token（cb + vscode 78 + sc-ui 24） |
| 主题层 | `scripts/generators/workbuddyCss.mjs` | ✅ 同源同步（166 定义） |
| 门禁 | `src/engine/src/adapters/workbuddy.mjs` | `lastVerified` win32 5.3.14（2026-08-19 更新）；bridge 16 cb + 28 vscode 映射 |

### 3.1 覆盖明细
- **cb 层**：bg/text/panel/sidebar/chat/markdown/tab/notification/badge/input 系 ✅
- **vscode 层**：editor/sideBar/tab/panel/menu/dropdown/terminal/input/scrollbar/badge/diff/focusBorder/textLink 系 ✅ 78 个
- **sc-ui 层**：primary/bg/surface/text/hover/active/focus-ring/danger/success/warning 系 ✅ 24 个
- **bridge 语义映射**：cb 16 + vscode 28（surface/text/border/accent role 对齐）

### 3.2 故意保留原生
- 语义色（sc-ui danger #e53e3e/success #10b981/warning #f59e0b）
- vscode 语义色（errorForeground 等）

## 4. 专属特点 / 坑

1. **host 选择器特殊**：`body[data-application-name="workbuddy"]`（不是 html class）——六端唯一，探针/注入必须读 body scope。
2. **三层 token 体系**：覆盖 cb 层≠完整（vscode/sc-ui 曾全漏）——这是"适配不全"的根因（用户指出 + GitHub 对标 + 反向盲区三重确认）。
3. **`--wb-*` 是注入层基础变量**（原生无、注入后有）——探针易误判 no-op。
4. **sc-ui 独立于 vscode-dark**：它有自己的浅色值（#1f1f1f/#fff），即使应用是暗色也生效——必须显式覆盖。
5. **data-testid 无**：WorkBuddy 用 `data-application-name`，无豆包那种 data-testid 锚点。

## 5. 实测结论（2026-08-19）

| 项 | 值 |
|---|---|
| 三层覆盖 | cb ✅ + vscode 78 ✅ + sc-ui 24 ✅ |
| 反向盲区 | 已清零 |
| bridge | 16 cb + 28 vscode（S3 语义层对齐） |
| lastVerified | 5.3.14（2026-08-19 实拍更新） |
| 注入验证 | cb/vscode/sc-ui 三层的 bg/text/accent/focus 全部主题化 ✅ |
| 版本漂移风险 | 中（三层体系，任一层 token 更新都可能漏） |

## 6. 验证探针

- `debug-tools/probe-workbuddy-tokens.mjs` / `probe-workbuddy-theme.mjs` / `probe-workbuddy-scui.mjs`
- GitHub 对标参考：`Lucky2024-pllove/workbuddy-theme`（vscode 层）、CodeDrobe/core `references/workbuddy.md`
