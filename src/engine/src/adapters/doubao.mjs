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
  // RFC A2 — rendererHints: 主 renderer 语义锚点。Doubao 暴露「boot/启动页 + 主聊天
  // 窗口」等多个兼容 page target。主窗口为已文档化的 `chrome://doubao-chat/chat`，
  // 用 preferredUrlPatterns 把它稳定判为主 renderer，避免 /json/list 顺序把启动页
  // 推到首位。未命中该 pattern 时不改变任何排序（partitionRenderers 退化为第一个
  // page 即主 renderer，现状）。启动页的具体 URL 形态尚未实机观察，故不加
  // secondaryPatterns，避免误伤。
  rendererHints: {
    preferredUrlPatterns: ["doubao-chat/chat"],
  },
  // CSS variable bridge (S3): re-route the semi/dbx native token family Doubao
  // reads onto AgentSkin semantic roles. Skips the art-transparent (*-body/web,
  // --chat-bg-color) vars to preserve hero punch-through. Alphas mirror
  // engines/doubao/tokens.css.
  bridge: [
    { var: "--semi-color-bg-0", role: "bg" },
    { var: "--semi-color-bg-1", role: "surface" },
    { var: "--semi-color-bg-2", role: "surface-elevated" },
    { var: "--semi-color-text-0", role: "text" },
    { var: "--semi-color-text-1", role: "muted" },
    { var: "--semi-color-text-2", role: "muted", alpha: 0.75 },
    { var: "--semi-color-primary", role: "accent" },
    { var: "--semi-color-secondary", role: "secondary" },
    { var: "--semi-color-border", role: "border" },
    { var: "--semi-color-link", role: "accent" },
    { var: "--semi-color-nav-bg", role: "surface" },
    { var: "--dbx-bg-base-5", role: "surface" },
    { var: "--dbx-bg-float", role: "surface-elevated" },
    { var: "--dbx-text-primary", role: "text" },
    { var: "--dbx-text-secondary", role: "muted" },
    { var: "--dbx-text-tertiary", role: "muted", alpha: 0.7 },
    { var: "--dbx-brand-default", role: "accent" },
    { var: "--dbx-code-text", role: "code-fg" },
  ],
  verification: {
    // The root landmark is the only blocking check: it doubles as the
    // "app finished booting" signal and the minimal app fingerprint.
    rootAny: ["#root", "body"],
  },
};

export default doubao;
