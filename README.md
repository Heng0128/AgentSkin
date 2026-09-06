# AgentSkin Desktop

AI 应用视觉环境配置器（Visual Environment Composer）：通过 CDP（Chrome DevTools Protocol）为主题和壁纸无法自我定制的 Electron AI 应用注入主题与动态壁纸，把"换肤"升级为完整的 AI 工作环境。

## 产品形态

```
Agent（目标 AI 应用）
  + Theme Runtime      主题运行时（.agentskin-theme）
  + Wallpaper Runtime  壁纸运行时（Wallpaper Engine 库 / Scene / 视频 / 图片 / Web）
  + Environment Bundle 环境组合包（.agentskin-bundle = 主题 + 壁纸）
```

- **不是 IDE 插件**：独立于目标应用运行，通过 CDP 注入，不修改目标应用的文件。
- **不服务有原生主题能力的工具**：Cursor / VS Code 系自带主题体系，不在目标范围内。
- **服务零定制能力的应用**：豆包、ChatGPT 桌面版等 Electron 应用，用户连换暗色的入口都没有。

## 支持的目标应用

| 应用 | 类型 | 平台 |
|------|------|------|
| 豆包 | 桌面助手 | Windows |
| ChatGPT 桌面版（Codex） | Agent | Windows / macOS |
| TRAE SOLO CN | Agent | Windows / macOS |
| QoderWork CN | IDE | Windows |
| WorkBuddy | Agent | Windows |
| ZCode | Agent | Windows |

## 核心能力

- **五层 CDP 注入**：L0 调色板 → L1 原生 token 映射 → L2 视觉打磨 → L3 主题 CSS → L4 结构适配 JS；持久化到目标应用导航之后，MutationObserver 自愈，注入后自动验证。
- **声明式主题管线**：manifest 声明 14 个语义色 token，自动生成全部目标应用的 CSS；CI 门禁保证四源一致。
- **多配色方案**：一个主题可携带多套配色（color-schemes）。
- **壁纸运行时**：浏览并注入 Wallpaper Engine 订阅库（视频 / 图片 / 网页 / Scene 场景包），壁纸取色可自动生成配套主题。
- **Scene PKG 解析**：解析 Wallpaper Engine 的 Scene 场景包（TEX 纹理 / LZ4 / 粒子），渲染为 HTML 后注入目标应用。
- **环境组合包**：`.agentskin-bundle` 把主题与壁纸打包为一个交付单元，支持导入 / 安装 / 导出。
- **Theme Studio**：独立窗口，抓取目标应用的 DOM 快照、检查元素样式、调参预览、导出主题包。

## 开发

要求 Node.js ≥ 22。

```bash
npm install          # 安装依赖
npm start            # 开发模式（electron-vite dev）
npm run check        # typecheck + lint + test + 注入契约/主题/配色门禁
npm run package:win  # 打包 Windows 版
npm run package:mac  # 打包 macOS 版
```

## 文档

| 文档 | 内容 |
|------|------|
| [docs/PRODUCT.md](docs/PRODUCT.md) | 产品定位、护城河、投资边界（活文档） |
| [docs/ROADMAP.md](docs/ROADMAP.md) | 当前路线与优先级（活文档） |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | 架构总览与模块地图（活文档） |
| [docs/THEME_SPEC.md](docs/THEME_SPEC.md) | 主题包规范 v2.1 |
| [docs/THEME_API.md](docs/THEME_API.md) | 主题包接口规范 |
| [docs/manifest-v2.schema.json](docs/manifest-v2.schema.json) | manifest schema 镜像（权威副本在 src/main/catalog/，测试逐字节校验） |

文档原则：PRODUCT / ROADMAP / ARCHITECTURE 与代码同步更新；规范类文档只在对应系统变更时更新。一次性提案文档不进入 docs/。

## Attribution

AgentSkin is an independent evolution based on CodeDrobe Desktop, licensed under MPL 2.0.

AgentSkin introduces substantial changes including:

- New product positioning (AI Agent Environment Runtime)
- Redesigned adapter architecture
- Wallpaper runtime with Wallpaper Engine integration
- Scene PKG parsing pipeline
- Environment bundle system
- Complete UI redesign

CodeDrobe trademarks and visual assets are not used. See [NOTICE](NOTICE) for full attribution.

## 许可

MPL-2.0（见 [LICENSE](LICENSE)）；素材与商标见 ASSETS_LICENSE.md 与 TRADEMARKS.md。
