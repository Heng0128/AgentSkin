# AgentSkin AI 应用主题管理器

[![最新版本](https://img.shields.io/github/v/release/agentskin/desktop?display_name=tag&sort=semver)](https://github.com/agentskin/desktop/releases/latest)
[![版本构建](https://github.com/agentskin/desktop/actions/workflows/build.yml/badge.svg)](https://github.com/agentskin/desktop/actions/workflows/build.yml)
[![下载量](https://img.shields.io/github/downloads/agentskin/desktop/total)](https://github.com/agentskin/desktop/releases)
[![许可证 MPL-2.0](https://img.shields.io/badge/license-MPL--2.0-blue.svg)](LICENSE)
[![macOS 与 Windows](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-6f4d62)](https://github.com/agentskin/desktop/releases)

[English](README.md)

官方网站：[agentskin.app](https://agentskin.app) — [下载最新版本](https://github.com/agentskin/desktop/releases/latest)

AgentSkin 是一款面向 AI 桌面应用的开源主题管理器，目前支持 **TRAE SOLO CN**、**QoderWork CN**、**WorkBuddy** 和 **豆包**，可在 macOS 和 Windows 上使用。一键将主题应用到任何支持的应用，并随时恢复原生界面。主题只改变外观，不修改应用安装和数据。

![AgentSkin 主题管理器](docs/images/desktop.png)

## v2 全新改版

v2 是一次完全的重构：

- **全新 UI**：基于 Tailwind CSS + shadcn 风格组件，与 [agentskin.app](https://agentskin.app) 共享同一设计语言。
- **多应用支持**：基于 `@agentskin/engine` 引擎，一个主题包可以针对多个应用，详情面板按应用（TRAE SOLO CN、QoderWork CN、WorkBuddy、豆包）单独应用。
- **设置对话框**：分类设置项：显示语言、手动指定应用安装路径、应用自定义调试端口。
- **智能应用流程**：应用已有调试连接时直接切换主题；仅在首次需要重启应用或主机外观设置变更时才请求重启。

## 主要功能

- 浏览内置主题库，支持搜索排序和按应用筛选。
- 从详情面板应用到指定应用：运行中的应用直接切换，未运行的则启动后应用。
- 从侧边栏应用状态列表或系统托盘恢复应用的原始界面。
- 导入、导出便携式 `.agenttheme` 包，旧版 `.agentskin-theme` 和 `.codex-theme` 文件导入时自动转换。
- 自动检测不到应用时手动指定安装路径（主要在 Windows），默认调试端口被占用时可按应用修改。
- 支持中英双语切换，首次启动跟随系统语言。

## 主题画廊

| Cyber Neon | Arctic White | Sakura |
| --- | --- | --- |
| ![Cyber Neon 主题](docs/images/cyber-neon.png) | ![Arctic White 主题](docs/images/arctic-white.png) | ![Sakura 主题](docs/images/sakura.png) |

## 本地开发

```bash
npm install
npm start
```

使用 `AGENTSKIN_API_BASE=http://localhost:4173 npm start` 指向本地网站实例。

桌面端将 [`@agentskin/engine`](https://github.com/agentskin/core)（fork 自 `@agentskin/engine`）直接 vendored 在 `src/engine/`，因此开发始终基于仓内引擎版本构建。

## 测试和构建

```bash
npm run check
npm run build
```

- `npm run check` 运行类型检查、lint 和测试。
- `npm run build` 运行 `electron-vite build` 打包前端代码。

## 构建安装包

```bash
npm run build:installer
```

该命令默认自动递增 patch 版本号，构建前端代码，然后执行 `electron-builder --win --x64` 直接生成 NSIS Setup 安装程序。输出路径为 `out/make/v{version}/AgentSkin-{version}-x64-Setup.exe`。

指定版本递增级别：

```bash
npm run build:installer:minor
npm run build:installer:major
npm run build:installer:nobump
```

或者直接调用 electron-builder（不管理版本号）：

```bash
npx electron-builder --win --x64
```

- macOS 构建通过 `npm run make -- --arch=arm64` 同时生成 DMG 和 ZIP。
- Windows 构建通过 electron-builder 内置 NSIS 目标生成 NSIS Setup 安装程序。

## 相关项目

- [AgentSkin Core](https://github.com/agentskin/core) 供 Desktop 和 Skill 共用的 Apache-2.0 主题引擎和 CLI（主题格式、应用适配器、应用/恢复）。
- [AgentSkin Skills](https://github.com/agentskin/skills) 供 AI 编码助手创建和自定义主题的 AI 技能。

## 许可证

AgentSkin 源代码使用 [Mozilla Public License 2.0](LICENSE)。如果您分发修改后的版本，MPL 覆盖的源文件和您的修改必须继续以 MPL 形式提供源码。

该许可证不授予 AgentSkin 品牌或捆绑艺术资产的使用权。请参阅 [TRADEMARKS.md](TRADEMARKS.md) 和 [ASSETS_LICENSE.md](ASSETS_LICENSE.md)。第三方组件遵循各自的许可证，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
