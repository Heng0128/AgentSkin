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
    // Cross-adapter exclusions (2026-09-07 CDP probe): codex previously ended
    // in a "any page with a non-empty title" catch-all, which made it claim
    // every other agent's targets — observed in the wild as codex's CDP cache
    // resolving to Doubao's port (title 豆包 passed the catch-all) and the
    // stale app-state keeping that wrong mapping alive. Codex targets must
    // carry Codex-family evidence; never claim the other five agents.
    if (/^vscode-file:/i.test(url)) return false; // TRAE SOLO
    if (/doubao/i.test(url) || /豆包/i.test(title)) return false; // Doubao
    if (/zcode/i.test(url) || /zcode/i.test(title)) return false; // ZCode
    if (/qoder/i.test(url) || /qoder/i.test(title)) return false; // QoderWork
    if (/workbuddy/i.test(url) || /workbuddy/i.test(title)) return false; // WorkBuddy
    // ChatGPT desktop uses app:// custom protocol — primary match.
    if (/^app:\/\//i.test(url)) return true;
    // file:// renderer (some Electron builds serve from disk).
    if (/^file:\/\//i.test(url) && /chatgpt|codex|openai/i.test(url)) return true;
    // Localhost-served renderer (dev mode or Tauri-based architecture) — must
    // carry Codex-family evidence, otherwise it steals other agents' dev pages.
    if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(url)
        && (/chatgpt|codex|openai/i.test(url) || /chatgpt|codex|openai/i.test(title))) return true;
    // app.asar renderer (standard Electron packaging) — only with Codex-family
    // path evidence (WorkBuddy/QoderWork/ZCode renderers also live in app.asar).
    if (/app\.asar/i.test(url) && /chatgpt|codex|openai/i.test(url)) return true;
    // Title-based: ChatGPT or Codex in window title.
    if (/chatgpt|codex|openai/i.test(title)) return true;
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
  // JS getComputedStyle() reads resolve to the active theme. These map Codex's
  // LIVE native tokens (--color-token-*, verified against a running renderer)
  // onto AgentSkin roles — the legacy flat --text-primary/--bg-* namespace was
  // removed because it no longer exists in current Codex builds (dead no-op).
  //
  // Popover surface family (upstream Codex-Dream-Skin #233 fix): native
  // dropdown/menu surfaces resolve from Codex's own appearanceTheme, NOT the
  // injected theme — when the two disagree the popover keeps the opposite
  // palette (dark popover on a light skin, etc.). Bridging the dropdown
  // background + foreground + list-hover tokens makes every native popover
  // follow the active AgentSkin theme in both shells.
  bridge: [
    { var: "--color-token-text-primary", role: "text" },
    { var: "--color-token-text-secondary", role: "muted" },
    { var: "--color-token-bg-tertiary", role: "surface-elevated", alpha: 0.85 },
    { var: "--color-token-border", role: "border", alpha: 0.5 },
    { var: "--color-token-border-heavy", role: "border" },
    // Popover / dropdown surface family (#233-type mismatch fix).
    { var: "--color-token-dropdown-background", role: "surface-elevated" },
    { var: "--color-token-foreground", role: "text" },
    { var: "--color-token-muted-foreground", role: "muted" },
    { var: "--color-token-description-foreground", role: "muted" },
    { var: "--color-token-list-hover-background", role: "surface", alpha: 0.9 },
  ],
  verification: {
    // The root landmark is the only blocking check: it doubles as the
    // "app finished booting" signal and the minimal app fingerprint. Everything
    // else warns — the sidebar collapses, and CSS is inert on absent nodes.
    //
    // Selector contract synced with upstream Codex-Dream-Skin selectors.json
    // (2026-08-27, verified against Codex 26.715 → 26.818 on both platforms):
    // keep legacy anchors, append stable attributes / CSS-Module prefixes,
    // never match a full hash. 26.727.40816 added data-app-shell-main-surface
    // alongside the `_MainContentSurface_` CSS Module; `.main-surface` covers
    // pre-26.727 builds. We deliberately do NOT fall back to a bare `<main>`
    // (matches route content / auxiliary surfaces — see CodeDrobe PR #7's test
    // guard) and do NOT use `#root main` (that targets a different Windows
    // build lineage that wraps the root in #root; our verified renderer at
    // 62640 has no #root ancestor, so `#root main` would be a dead selector).
    rootAny: [ "main:is(.main-surface, [data-app-shell-main-surface], [class*='_MainContentSurface_'])" ],
    recommended: [
      { name: "sidebar", any: ["aside.app-shell-left-panel"] },
      // Composer shell: 26.814+ migrated to the `_ComposerLayoutRoot_` CSS
      // Module with stable data-composer-surface-variant / radius-variant
      // attributes; `.composer-surface-chrome` remains for legacy builds.
      { name: "composer", any: [
        ":is(.composer-surface-chrome, [class*='_ComposerLayoutRoot_'], [data-composer-surface-variant][data-composer-radius-variant])",
      ] },
      // Header tint: 26.727.40816 emits data-app-shell-header-edge-scroll and
      // the `_Header_` CSS Module; `.app-header-tint` covers legacy builds.
      { name: "toolbar", any: [
        "header:is(.app-header-tint, [data-app-shell-header-edge-scroll], [class*='_Header_'])",
      ] },
    ],
  },
};

export default codex;
