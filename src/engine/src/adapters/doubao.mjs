// Doubao (豆包) — Tencent's Chromium-based Electron desktop assistant.
//
// @agentskin/engine 0.6.0 does not ship a Doubao adapter; this file is the
// product-level static descriptor. CDP access has been verified via
// scripts/doubao-cdp.ps1.
//
// Runtime-only Windows patches (Tencent installer registry probing, the
// `vscode-file:`-rejecting matchTarget wrapper, DevToolsActivePort file
// discovery) live in `src/legacy/agentskin-core-runtime.ts:patchWindowsAdapters`
// and apply on top of this descriptor at process start.

import { DISPLAY_NAMES } from "./meta.mjs";

const doubao = {
  id: "doubao",
  displayName: DISPLAY_NAMES.doubao,
  defaultPort: 0,
  platforms: {
    win32: {
      executableCandidates: [
        "%LOCALAPPDATA%\\Programs\\Doubao\\Doubao.exe",
        "%LOCALAPPDATA%\\Doubao\\Doubao.exe",
        "%PROGRAMFILES%\\Doubao\\Doubao.exe",
        "%PROGRAMFILES(X86)%\\Doubao\\Doubao.exe",
        "%PROGRAMDATA%\\Doubao\\Doubao.exe",
        // Tencent installer puts Doubao under a versioned game directory on
        // a non-standard drive. The registry UninstallString points at
        // ..\Doubao\uninstall.exe, and the real exe is ..\Doubao\app\Doubao.exe.
        // The legacy runtime layer augments this list with the registry-derived
        // path at process start (patchWindowsAdapters).
        "%MyAppPrograms%\\com.tencent.pcgame.doubao\\Doubao\\app\\Doubao.exe",
      ],
      // HKCU\...\Uninstall\Doubao — Tencent's installer registers here.
      // (uninstallKeys is read by core's discoverWindowsRegistry at runtime
      // even though AdapterPlatformConfig's type doesn't declare it.)
      uninstallKeys: ["Doubao"],
      processNames: ["Doubao.exe"],
      // Doubao writes DevToolsActivePort to its user-data dir under APPDATA.
      // The runtime layer (patchWindowsAdapters) also injects PID/netstat-
      // discovered live port files into this list at process start.
      devToolsActivePortFile: [
        "%APPDATA%\\Doubao\\DevToolsActivePort",
      ],
    },
  },
  matchTarget(target) {
    if (target?.type !== "page") return false;
    const url = String(target.url ?? "");
    const title = String(target.title ?? "");
    if (/^(devtools|chrome-extension):/i.test(url)) return false;
    // Doubao 主页面为 chrome://doubao-chat/chat；放宽匹配以覆盖标题/URL 变体。
    // Title match includes the Chinese name (豆包) so the product's localized
    // window title is recognized. (Previously injected at runtime by
    // patchWindowsAdapters; now static so engine and runtime agree.)
    return /豆包|doubao/i.test(title) || /doubao/i.test(url);
  },
  verification: {
    // The root landmark is the only blocking check: it doubles as the
    // "app finished booting" signal and the minimal app fingerprint.
    rootAny: ["#root", "body"],
  },
};

export default doubao;
