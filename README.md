# AgentSkin Theme Manager for AI Desktop Apps

[![Latest Release](https://img.shields.io/github/v/release/agentskin/desktop?display_name=tag&sort=semver)](https://github.com/agentskin/desktop/releases/latest)
[![Release Build](https://github.com/agentskin/desktop/actions/workflows/build.yml/badge.svg)](https://github.com/agentskin/desktop/actions/workflows/build.yml)
[![Downloads](https://img.shields.io/github/downloads/agentskin/desktop/total)](https://github.com/agentskin/desktop/releases)
[![License: MPL-2.0](https://img.shields.io/badge/license-MPL--2.0-blue.svg)](LICENSE)
[![macOS and Windows](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-6f4d62)](https://github.com/agentskin/desktop/releases)

[Chinese](README_zh.md)

Website: [agentskin.app](https://agentskin.app) — [Download the latest release](https://github.com/agentskin/desktop/releases/latest)

AgentSkin is an open-source theme manager for AI desktop apps — currently **TRAE SOLO CN**, **QoderWork CN**, **WorkBuddy**, and **Doubao** — on macOS and Windows. Apply a theme to any supported app with one click and restore the native interface at any time. Themes only change appearance: your app installation and data stay untouched.

![AgentSkin theme manager](docs/images/desktop.png)

## What's new in v2

Version 2 is a complete rebuild:

- **New UI** built with Tailwind CSS + shadcn-style components, sharing the design language of [agentskin.app](https://agentskin.app).
- **Multi-app support** on the `@agentskin/engine` engine: one theme package can target several apps, and the detail drawer applies it per app (TRAE SOLO CN, QoderWork CN, WorkBuddy, Doubao).
- **Settings dialog** with categorized sections: display language, manual app-path override, and per-app debug ports.
- **Smarter apply flow**: apps already running with a debug connection get live theme swaps; a restart is only requested the first time an app must be relaunched or when host appearance settings change.

## Features

- Browse the built-in theme library with search, sorting, and per-app filters.
- Apply a theme to a specific app from the detail drawer — running apps switch live, stopped apps are launched with the theme.
- Restore any app's original appearance from the sidebar status list or the system tray.
- Import and export portable `.agenttheme` packages (legacy `.agentskin-theme` and `.codex-theme` files are converted on import).
- Configure app install locations manually when auto-detection misses (mainly Windows) and change per-app debug ports when the defaults are occupied.
- Switch between Chinese and English; the first launch follows the system locale.

## Theme gallery

| Cyber Neon | Arctic White | Sakura |
| --- | --- | --- |
| ![Cyber Neon theme](docs/images/cyber-neon.png) | ![Arctic White theme](docs/images/arctic-white.png) | ![Sakura theme](docs/images/sakura.png) |

## Local development

```bash
npm install
npm start
```

Point the app at a local website instance with `AGENTSKIN_API_BASE=http://localhost:4173 npm start`.

The Desktop app vendors [`@agentskin/engine`](https://github.com/agentskin/core) (forked from `@agentskin/engine`) directly in `src/engine/`, so development always builds against the in-tree engine release.

## Test and package

```bash
npm run check
npm run build
```

- `npm run check` runs type-check, lint, and tests.
- `npm run build` runs `electron-vite build` to bundle the frontend code.

## Build installer

```bash
npm run build:installer
```

This single command bumps the patch version (by default), builds the frontend, and runs `electron-builder --win --x64` to produce an NSIS Setup executable directly. The output installer is placed at `out/make/v{version}/AgentSkin-{version}-x64-Setup.exe`.

For a specific version bump level:

```bash
npm run build:installer:minor
npm run build:installer:major
npm run build:installer:nobump
```

Or invoke electron-builder directly without version management:

```bash
npx electron-builder --win --x64
```

- macOS builds produce DMG and ZIP artifacts via `npm run make -- --arch=arm64`.
- Windows builds produce an NSIS Setup executable via electron-builder's built-in NSIS target.

## Related projects

- [AgentSkin Core](https://github.com/agentskin/core) — the Apache-2.0 theme engine and CLI shared by the Desktop app and the Skill (theme format, app adapters, apply/restore).
- [AgentSkin Skills](https://github.com/agentskin/skills) — AI skills for creating and customizing themes from your coding agent.

## License

AgentSkin source code is licensed under the [Mozilla Public License 2.0](LICENSE). If you distribute a modified build, the MPL-covered source files and your modifications to those files must remain available under the MPL.

The license does not grant rights to AgentSkin branding or bundled artwork. See [TRADEMARKS.md](TRADEMARKS.md) and [ASSETS_LICENSE.md](ASSETS_LICENSE.md). Third-party components remain under their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
