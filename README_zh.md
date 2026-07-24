# AgentSkin AI 应用主题管理器

[![最新版本](https://img.shields.io/github/v/release/agentskin/desktop?display_name=tag&sort=semver)](https://github.com/agentskin/desktop/releases/latest)
[![版本构建](https://github.com/agentskin/desktop/actions/workflows/build.yml/badge.svg)](https://github.com/agentskin/desktop/actions/workflows/build.yml)
[![下载量](https://img.shields.io/github/downloads/agentskin/desktop/total)](https://github.com/agentskin/desktop/releases)
[![许可证 MPL-2.0](https://img.shields.io/badge/license-MPL--2.0-blue.svg)](LICENSE)
[![macOS 与 Windows](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-6f4d62)](https://github.com/agentskin/desktop/releases)

[English](README.md)

官方网站：[agentskin.app](https://agentskin.app) �� [下载最新版本](https://github.com/agentskin/desktop/releases/latest)

AgentSkin 是一款面向 AI 桌面应用的开源主题管理器，目前支持 **TRAE Work CN**、**QoderWork CN** 和 **WorkBuddy**，可在 macOS 和 Windows 上使用。浏览 AgentSkin 主题商店，一键应用到任何支持的应用，并随时恢复原生界面。主题只改变外观，不修改应用安装和数据。

![AgentSkin 主题管理器](docs/images/desktop.png)

## v2 全新改版

v2 是一次完全的重构：

- **全新 UI**：基于 Tailwind CSS + shadcn 风格组件，与 [agentskin.app](https://agentskin.app) 共享同一设计语言。
- **多应用支持**：基于新的 `@codedrobe/core` 引擎，一个主题包可以针对多个应用，详情面板按应用（TRAE Work CN、QoderWork CN、WorkBuddy）单独应用。
- **AgentSkin 账号登录**：通过系统浏览器 OAuth 2.0 PKCE 授权，支持点赞、同步的**收藏**列表和分享操作。
- **深度链接**：网站上的 `agentskin://themes/apply?theme=<slug>&app=<id>` 链接在应用内确认后自动安装和应用主题。
- **设置对话框**：分类设置项：显示语言、手动指定应用安装路径、应用自定义调试端口、软件更新。
- **智能应用流程**：应用已有调试连接时直接切换主题；仅在首次需要重启应用或主机外观设置变更时才请求重启。

## 主要功能

- 浏览双语分类的免费主题，支持搜索排序和按应用筛选。
- 识别已安装主题的新版本并直接更新。
- 每次下载都与市场记录中的 SHA-256 校验值核对后再导入。
- 登录 AgentSkin 账号后可收藏主题、查看收藏夹，发布和编辑操作会跳转到网站。
- 从详情面板应用到指定应用：运行中的应用直接切换，未运行的则启动后应用。
- 从侧边栏应用状态列表或系统托盘恢复应用的原始界面。
- 导入、导出便携式 `.agenttheme` 包，旧版 `.codedrobe-theme` 和 `.codex-theme` 文件导入时自动转换。
- 自动检测不到应用时手动指定安装路径（主要在 Windows），默认调试端口被占用时可按应用修改。
- 支持中英双语切换，首次启动跟随系统语言。
- 应用内一键更新：macOS 通过内置更新器替换应用，Windows 安装版静默安装点击"重启并完成安装"即可，Portable/MSI 版本跳转到下载页。

## 主题画廊

| Cyber Neon | Arctic White | Sakura |
| --- | --- | --- |
| ![Cyber Neon 主题](docs/images/cyber-neon.png) | ![Arctic White 主题](docs/images/arctic-white.png) | ![Sakura 主题](docs/images/sakura.png) |

## 账号和权限

登录打开系统浏览器进行 OAuth 2.0 授权码 + PKCE 流程，应用永远不会接触您的密码。请求的权限会在同意页面显示并可随时从网站的**授权应用**页面撤销。凭证存储在应用数据目录中仅当前用户可读的文件中（权限 0600），与 AgentSkin CLI 模型一致，登出会远程撤销授权并删除文件。

## 深度链接

网站上的"在应用中打开"使用 `agentskin://` 协议，每个请求都会先弹出确认框确认后才安装和应用主题。macOS 下协议可由打包的应用注册；开发期间可以传递 URL 作为启动参数：

```bash
npm start -- -- "agentskin://themes/apply?theme=<slug>&app=traework"
```

## 本地开发

```bash
npm install
npm start
```

使用 `AGENTSKIN_API_BASE=http://localhost:4173 npm start` 指向本地网站实例。

桌面端锁定 npm 上精确的 [`@codedrobe/core`](https://www.npmjs.com/package/@codedrobe/core) 版本，因此开发和 CI 构建都使用相同的 Core 发布版。

## 测试和打包

```bash
npm run check
npm run package
npm run make
npm run make:windows:installers
```

- macOS 构建同时生成 DMG 和 ZIP。
- Windows 构建同时生成 WiX MSI 安装程序、NSIS Setup 安装程序和 Portable 便携版。在 Windows 上执行 `npm run make:windows:installers` 之前需要先运行 `npm run make -- --arch=x64`，这样才能生成应用目录和 MSI。

## 相关项目

- [AgentSkin Core](https://github.com/agentskin/core) 供 Desktop 和 Skill 共用的 Apache-2.0 主题引擎和 CLI（主题格式、应用适配器、应用/恢复）。
- [AgentSkin Skills](https://github.com/agentskin/skills) 供 AI 编码助手创建和自定义主题的 AI 技能。

## 许可证

AgentSkin 源代码使用 [Mozilla Public License 2.0](LICENSE)。如果您分发修改后的版本，MPL 覆盖的源文件和您的修改必须继续以 MPL 形式提供源码。

该许可证不授予 AgentSkin 品牌或捆绑艺术资产的使用权。请参阅 [TRADEMARKS.md](TRADEMARKS.md) 和 [ASSETS_LICENSE.md](ASSETS_LICENSE.md)。第三方组件遵循各自的许可证，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
