# AgentSkin Theme Manager for AI Desktop Apps

[![Latest Release](https://img.shields.io/github/v/release/agentskin/desktop?display_name=tag&sort=semver)](https://github.com/agentskin/desktop/releases/latest)
[![Release Build](https://github.com/agentskin/desktop/actions/workflows/build.yml/badge.svg)](https://github.com/agentskin/desktop/actions/workflows/build.yml)
[![Downloads](https://img.shields.io/github/downloads/agentskin/desktop/total)](https://github.com/agentskin/desktop/releases)
[![License: MPL-2.0](https://img.shields.io/badge/license-MPL--2.0-blue.svg)](LICENSE)
[![macOS and Windows](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-6f4d62)](https://github.com/agentskin/desktop/releases)

[Chinese](README_zh.md)

Website: [agentskin.app](https://agentskin.app) �� [Download the latest release](https://github.com/agentskin/desktop/releases/latest)

AgentSkin is an open-source theme manager for AI desktop apps �� currently **TRAE Work CN**, **QoderWork CN**, and **WorkBuddy** �� on macOS and Windows. Browse the AgentSkin theme store, apply a theme to any supported app with one click, and restore the native interface at any time. Themes only change appearance: your app installation and data stay untouched.

![AgentSkin theme manager](docs/images/desktop.png)

## What's new in v2

Version 2 is a complete rebuild:

- **New UI** built with Tailwind CSS + shadcn-style components, sharing the design language of [agentskin.app](https://agentskin.app).
- **Multi-app support** on the `@codedrobe/core` engine: one theme package can target several apps, and the detail drawer applies it per app (TRAE Work CN, QoderWork CN, WorkBuddy).
- **AgentSkin account sign-in** (OAuth 2.0 PKCE through your system browser) with likes, a synced **Favorites** view, and share actions.
- **Deep links**: `agentskin://themes/apply?theme=<slug>&app=<id>` from the website installs and applies a theme after an in-app confirmation.
- **Settings dialog** with categorized sections: display language, manual app-path override, per-app debug ports, and software updates.
- **Smarter apply flow**: apps already running with a debug connection get live theme swaps; a restart is only requested the first time an app must be relaunched or when host appearance settings change.

## Features

- Browse bilingual categories and free themes from the online store, with search, sorting, and per-app filters.
- See which installed themes have newer versions and update them in place.
- Every download is verified against the marketplace SHA-256 record before it is imported.
- Sign in with your AgentSkin account to like themes and browse your favorites; publishing and profile editing open the website.
- Apply a theme to a specific app from the detail drawer �� running apps switch live, stopped apps are launched with the theme.
- Restore any app's original appearance from the sidebar status list or the system tray.
- Import and export portable `.agenttheme` packages (legacy `.codedrobe-theme` and `.codex-theme` files are converted on import).
- Configure app install locations manually when auto-detection misses (mainly Windows) and change per-app debug ports when the defaults are occupied.
- Switch between Chinese and English; the first launch follows the system locale.
- Update in place from inside the app: macOS swaps the app bundle via the built-in updater and Windows (installed builds) applies the update silently �� one click on "Restart & install". Portable/MSI builds fall back to the downloads page.

## Theme gallery

| Cyber Neon | Arctic White | Sakura |
| --- | --- | --- |
| ![Cyber Neon theme](docs/images/cyber-neon.png) | ![Arctic White theme](docs/images/arctic-white.png) | ![Sakura theme](docs/images/sakura.png) |

## Account and permissions

Signing in opens your system browser for an OAuth 2.0 Authorization Code + PKCE flow against `agentskin.app`; the app never sees your password. Requested scopes are shown on the consent page and can be revoked at any time from the website's **Authorized apps** page. Credentials are stored in a file readable only by your user account (mode 0600) inside the app's data directory �� the same model as the AgentSkin CLI. Signing out revokes the grant server-side and deletes the file.

## Deep links

The website's "Open in app" actions use the `agentskin://` scheme. Every request shows a confirmation dialog before anything is installed or applied. On macOS the scheme is registered by the packaged app; during development, pass the URL as a launch argument instead:

```bash
npm start -- -- "agentskin://themes/apply?theme=<slug>&app=traework"
```

## Local development

```bash
npm install
npm start
```

Point the app at a local website instance with `AGENTSKIN_API_BASE=http://localhost:4173 npm start`.

The Desktop app pins an exact [`@codedrobe/core`](https://www.npmjs.com/package/@codedrobe/core) version from npm, so development and CI build against the same Core release.

## Test and package

```bash
npm run check
npm run package
npm run make
npm run make:windows:installers
```

- macOS builds produce DMG and ZIP artifacts.
- Windows release builds produce an NSIS Setup executable. Run `npm run package -- --arch=x64` first to produce the prepackaged application directory, then `npm run make:windows:installers` to generate the installer.

## Related projects

- [AgentSkin Core](https://github.com/agentskin/core) �� the Apache-2.0 theme engine and CLI shared by the Desktop app and the Skill (theme format, app adapters, apply/restore).
- [AgentSkin Skills](https://github.com/agentskin/skills) �� AI skills for creating and customizing themes from your coding agent.

## License

AgentSkin source code is licensed under the [Mozilla Public License 2.0](LICENSE). If you distribute a modified build, the MPL-covered source files and your modifications to those files must remain available under the MPL.

The license does not grant rights to AgentSkin branding or bundled artwork. See [TRADEMARKS.md](TRADEMARKS.md) and [ASSETS_LICENSE.md](ASSETS_LICENSE.md). Third-party components remain under their own licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
