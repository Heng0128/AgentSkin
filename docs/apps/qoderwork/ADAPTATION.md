# QoderWork 适配档案（AgentSkin）

> 文档日期：2026-08-19 | 实测版本：QoderWork CN（端口 50494，VS Code + antd 混合架构）
> 对应文档：`docs/apps/qoderwork/architecture.md`、`docs/apps/qoderwork/fragility.md`
> 本档定位：**适配策略 + 实测结论**

---

## 1. 一句话画像

QoderWork 是 VS Code 架构 + **antd 组件体系混合**的 Electron 应用，主视觉由 **`--color-*`（antd 语义，111 个）** 驱动。它是 6 端里**覆盖最完整、最健康**的端——反向盲区检测确认 **111/111 全覆盖、0 no-op、0 盲区**，唯一无漂移的端。

## 2. 原生命名空间（实测）

| 命名空间 | 数量 | 角色 |
|---|---|---|
| `--color-*` | 111 | **主视觉（antd 语义：primary/success/warning/error/bg/text/border）** |
| `--vscode-*` | 0 | 运行时无（虽然 VS Code 架构，但主视觉不走 vscode token） |
| `--bg-*`/`--shadow-*` | 0 | 无（历史文档的盲区已消失） |
| `aicoding.*`（主题 JSON 键） | 34 | Qoder 私有键（AI 面板/Quest 面），**非 DOM CSS 变量** |

### 2.1 aicoding 认知（核心）
`Ailln/qoder-skin-skill` 揭示 QoderWork 有 `aicoding.*` 34 个私有主题键（bgContainer/primaryText/questBrandAccent/spark* 三件套等），作用于 AI 面板/Quest 页面。
**但实拍确认（50494，22 个探针变量全 0 命中）：它们是 VS Code 主题 JSON 键（Electron 内部消费 workbench.colorTheme），不暴露为 DOM CSS 变量** → 我们的 CSS 注入层无需覆盖。

## 3. 适配策略（引擎层 + 主题层双源）

| 层 | 文件 | 状态 |
|---|---|---|
| 引擎层 L0 | `engines/qoderwork/tokens.css` | ✅ 108 定义（color 主面 99） |
| 主题层 | `scripts/generators/qoderworkCss.mjs` | ✅ 135 定义（color 111 全覆盖） |
| 门禁 | `src/engine/src/adapters/qoderwork.mjs` | `lastVerified` 0.9.12 |

### 3.1 覆盖明细
- **antd 主视觉**：primary/success/warning/error + bg/text/border 体系，111 全覆盖 ✅
- **生成物独有 12 个**：`--color-blue/orange/slate/yellow`(+bg/hover)——**故意保留原生**的语义色（同 codex charts-blue 思路）
- **生成器独立手写**（非 shellTokenOverrides 委托）→ 无旧病

### 3.2 故意保留原生
- 语义色（blue/orange/slate/yellow 家族）
- aicoding 体系（主题 JSON 键，非 DOM 变量）

## 4. 专属特点 / 坑

1. **antd 语义命名**：`--color-primary` 等是 antd 组件语义（不是 Tailwind），覆盖需按 antd 语义。
2. **混合架构**：VS Code 架构但运行时无 `--vscode-*`（主视觉走 antd）——不能照搬 workbuddy 的 vscode 层打法。
3. **无 data-testid 锚点需求**：覆盖已完整，结构层不需额外锚点。
4. **生成物是超集**：引擎层 99 ⊂ 生成物 111（生成物独有 12 个语义色），双层不冲突。

## 5. 实测结论（2026-08-19）

| 项 | 值 |
|---|---|
| 反向盲区 | **0**（111/111，唯一全齐的端） |
| no-op | 0 |
| aicoding | 22 个探针变量 0 存在（主题 JSON 键，无需覆盖） |
| GitHub 对标 | 无 CSS 变量项目能覆盖我们没覆盖的面（qoder-skin-skill 走主题 JSON 路线） |
| 注入验证 | live 50494 全通过 ✅ |
| 版本漂移风险 | 低（antd 语义稳定） |

## 6. 验证探针

- `debug-tools/probe-qoderwork-aicoding.mjs` / `probe-qoderwork-aicoding-deep.mjs`
- `scripts/cdp-full-extract.mjs --port <p> --name qoderwork`（唯一可全量实拍的 VS Code 族端）
- GitHub 对标参考：`Ailln/qoder-skin-skill`（aicoding 键 + 角色映射方法论）、`YaoShenyaoge/unofficial-desktop-dream-skins`
