import codexThemeV1Profile from "../runtime/profiles/codex-theme-v1.mjs";
import codexHostSettings from "../host/codex-settings.mjs";
import { DISPLAY_NAMES } from "./meta.mjs";

const codex = {
  id: "codex",
  displayName: DISPLAY_NAMES.codex,
  defaultPort: 0,
  lastVerified: {
    darwin: { appVersion: "26.707.72221", build: "5307", verifiedAt: "2026-07-16" },
  },
  rendererProfiles: {
    [codexThemeV1Profile.id]: codexThemeV1Profile,
  },
  hostSettings: codexHostSettings,
  platforms: {
    darwin: {
      bundleId: "com.openai.codex",
      appCandidates: ["/Applications/ChatGPT.app", "~/Applications/ChatGPT.app"],
      executableRelative: "Contents/MacOS/ChatGPT",
      processMarkers: ["/ChatGPT.app/Contents/MacOS/ChatGPT"],
    },
    win32: {
      appxPackage: "OpenAI.Codex",
      executableRelative: "app\\ChatGPT.exe",
      // Filesystem candidates for non-MSIX installs (portable / electron-
      // builder / manually-extracted builds). MSIX installs live under the
      // WindowsApps package dir and are discovered via appxPackage instead.
      executableCandidates: [
        "%LOCALAPPDATA%\\Programs\\OpenAI\\ChatGPT\\app\\ChatGPT.exe",
        "%LOCALAPPDATA%\\Programs\\ChatGPT\\app\\ChatGPT.exe",
        "%LOCALAPPDATA%\\Programs\\Codex\\app\\ChatGPT.exe",
        "%PROGRAMFILES%\\OpenAI\\ChatGPT\\app\\ChatGPT.exe",
        "%PROGRAMFILES%\\ChatGPT\\app\\ChatGPT.exe",
        "%LOCALAPPDATA%\\ChatGPT\\app\\ChatGPT.exe",
        "%APPDATA%\\ChatGPT\\app\\ChatGPT.exe",
      ],
      processNames: ["ChatGPT.exe"],
      // ChatGPT desktop writes DevToolsActivePort to its user-data dir.
      devToolsActivePortFile: [
        "%APPDATA%\\ChatGPT\\DevToolsActivePort",
        "%APPDATA%\\Codex\\DevToolsActivePort",
      ],
    },
  },
  matchTarget(target) {
    if (target?.type !== "page") return false;
    const url = String(target.url ?? "");
    const title = String(target.title ?? "");
    // Exclude devtools and extension pages.
    if (/^(devtools|chrome-extension):/i.test(url)) return false;
    // Exclude about:blank and other non-app pages.
    if (/^about:/i.test(url)) return false;
    // ChatGPT desktop uses app:// custom protocol — primary match.
    if (/^app:\/\//i.test(url)) return true;
    // file:// renderer (some Electron builds serve from disk).
    if (/^file:\/\//i.test(url) && /chatgpt|codex|openai/i.test(url)) return true;
    // Localhost-served renderer (dev mode or Tauri-based architecture).
    if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(url)) return true;
    // app.asar renderer (standard Electron packaging).
    if (/app\.asar/i.test(url)) return true;
    // Title-based: ChatGPT or Codex in window title.
    if (/chatgpt|codex|openai/i.test(title)) return true;
    // Broad fallback: any page target with a non-empty title that looks like
    // an app window (not DevTools, not chrome-internal).
    if (title && !/^(DevTools|chrome|about:)/i.test(title) && url && !url.startsWith("about:")) return true;
    return false;
  },
  // RFC A2 — rendererHints: 主 renderer 语义锚点。Codex 暴露多个兼容 page target，
  // 其中 `?initialRoute=avatar-overlay`（头像浮层页）显式为**次** renderer——绝不应
  // 被当作主窗口注入。其余（主 index.html / 设置 / 其他窗口）未命中 secondaryPatterns，
  // 由 partitionRenderers 退化为第一个 page 即主 renderer（现状），零行为回归。
  rendererHints: {
    secondaryPatterns: ["initialRoute=avatar-overlay", "avatar-overlay"],
  },
  // CSS variable bridge (S3): declaratively re-route the native Tailwind token
  // family Codex reads onto AgentSkin semantic roles. Compiled by the engine
  // at apply time (css-var-bridge.mjs) so both the app's own CSS rules and any
  // JS getComputedStyle() reads resolve to the active theme. Alphas mirror
  // engines/codex/tokens.css to preserve translucency/art punch-through.
  bridge: [
    { var: "--text-primary", role: "text" },
    { var: "--text-secondary", role: "muted" },
    { var: "--bg-tertiary", role: "surface-elevated", alpha: 0.85 },
    { var: "--border-subtle", role: "border", alpha: 0.5 },
    { var: "--border-medium", role: "border" },
  ],
  verification: {
    // The root landmark is the only blocking check: it doubles as the
    // "app finished booting" signal and the minimal app fingerprint. Everything
    // else warns — the sidebar collapses, and CSS is inert on absent nodes.
    // Codex's main content surface uses a CSS-Modules hashed class
    // (`_MainContentSurface_xxx`) rather than the `main-surface` class, so
    // match the hashed prefix and fall back to a bare `<main>`.
    rootAny: [ "main[class*='MainContentSurface']", "main"],
    recommended: [
      { name: "sidebar", any: ["aside.app-shell-left-panel"] },
      { name: "composer", any: [] },
    ],
  },
};

export default codex;
