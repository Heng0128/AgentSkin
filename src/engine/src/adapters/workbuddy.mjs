import workbuddyThemeV1Profile from "../runtime/profiles/workbuddy-theme-v1.mjs";
import { DISPLAY_NAMES } from "./meta.mjs";

const workbuddy = {
  id: "workbuddy",
  displayName: DISPLAY_NAMES.workbuddy,
  defaultPort: 0,
  rendererProfiles: {
    [workbuddyThemeV1Profile.id]: workbuddyThemeV1Profile,
  },
  lastVerified: {
    darwin: { appVersion: "5.3.5", build: "5.3.5", verifiedAt: "2026-07-25" },
    // 2026-08-19 live probe (port 50489): body attrs data-product-version=5.3.14,
    // --cb-* / --vscode-* / --wb-* all verified themed after injection.
    win32: { appVersion: "5.3.14", build: "5.3.14", verifiedAt: "2026-08-19" },
  },
  platforms: {
    darwin: {
      bundleId: "com.workbuddy.workbuddy",
      appCandidates: ["/Applications/WorkBuddy.app", "~/Applications/WorkBuddy.app"],
      executableRelative: "Contents/MacOS/Electron",
      processMarkers: ["/WorkBuddy.app/Contents/MacOS/Electron"],
    },
    win32: {
      executableCandidates: [
        "%PROGRAMFILES%\\WorkBuddy\\WorkBuddy.exe",
        "%LOCALAPPDATA%\\Programs\\WorkBuddy\\WorkBuddy.exe",
        "%LOCALAPPDATA%\\WorkBuddy\\WorkBuddy.exe",
        "%PROGRAMFILES(X86)%\\WorkBuddy\\WorkBuddy.exe",
        "%PROGRAMDATA%\\WorkBuddy\\WorkBuddy.exe",
      ],
      // Covers installs on non-default drives (e.g. D:\Program Files) via the
      // installer's registry uninstall entry.
      uninstallKeys: ["WorkBuddy"],
      processNames: ["WorkBuddy.exe", "Electron.exe"],
      // WorkBuddy 5.3.x writes DevToolsActivePort to its user-data dir under
      // the user profile. The session/ subdir variant is used when multiple
      // sessions are active.
      devToolsActivePortFile: [
        "%USERPROFILE%\\.workbuddy\\app\\session\\DevToolsActivePort",
        "%USERPROFILE%\\.workbuddy\\app\\DevToolsActivePort",
      ],
    },
  },
  matchTarget(target) {
    // Accept both "page" and "webview" types (newer Electron may report differently)
    const type = String(target?.type ?? "");
    if (type !== "page" && type !== "webview") return false;
    const url = String(target.url ?? "");
    const title = String(target.title ?? "");
    // Reject TRAE's vscode-file:// pages FIRST. The previous acceptance of
    // vscode-file:// here was too broad — it matched TRAE Work CN's
    // solo-lite.html page, causing WorkBuddy's CDP discovery to hijack TRAE's
    // port and fail with AGENTSKIN_DOM_INCOMPATIBLE (.teams-container not
    // found in TRAE). (Previously enforced at runtime by patchWindowsAdapters;
    // now static so engine and runtime agree.)
    if (/^vscode-file:/i.test(url)) return false;
    // Exclude devtools and extension pages
    if (/^(devtools|chrome-extension):/i.test(url)) return false;
    // Title-based: window title contains workbuddy (case-insensitive)
    if (/workbuddy/i.test(title)) return true;
    // URL-based: app.asar anywhere in path (covers renderer/index.html and variants)
    if (/app\.asar/i.test(url)) return true;
    // Custom protocols used by Electron apps (vscode-file intentionally
    // excluded — see the early rejection above).
    if (/^(workbuddy|electron):/i.test(url)) return true;
    // file:// with WorkBuddy in path (some versions serve from file)
    if (/^file:\/\//i.test(url) && /workbuddy/i.test(url)) return true;
    // Localhost-served renderer (dev mode or new architecture)
    if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(url)) return true;
    // Fallback: title contains workbuddy or wb- prefix (WorkBuddy 5.3.x may
    // use conversation title as window title; "wb-" covers internal tooling
    // windows that don't carry the full product name).
    if (/workbuddy|wb-/i.test(title)) return true;
    // Fallback: any page target with a non-empty title that looks like an app window
    if (type === "page" && title && !/^(DevTools|chrome)/i.test(title) && url && !url.startsWith("about:")) return true;
    return false;
  },
  // CSS variable bridge (S3): re-route the native --cb-* (VS Code-arch) family
  // WorkBuddy reads onto AgentSkin semantic roles. Art-transparent vars
  // (--cb-chat-bg) omitted; surface/text/border/accent alphas mirror
  // engines/workbuddy/tokens.css.
  bridge: [
    { var: "--cb-bg-primary", role: "surface" },
    { var: "--cb-bg-secondary", role: "surface", alpha: 0.94 },
    { var: "--cb-panel-bg-primary", role: "surface", alpha: 0.88 },
    { var: "--cb-text-primary", role: "text" },
    { var: "--cb-text-secondary", role: "text", alpha: 0.7 },
    { var: "--cb-text-disabled", role: "text", alpha: 0.42 },
    { var: "--cb-text-link", role: "accent" },
    { var: "--cb-vscode-editor-background", role: "surface" },
    { var: "--cb-vscode-foreground", role: "text" },
    { var: "--cb-vscode-focusBorder", role: "accent", alpha: 0.4 },
    { var: "--cb-vscode-button-background", role: "accent" },
    { var: "--cb-vscode-button-foreground", role: "bg" },
    { var: "--cb-vscode-panel-border", role: "accent", alpha: 0.3 },
    { var: "--cb-input-placeholder", role: "text", alpha: 0.5 },
    { var: "--cb-sidebar-bg", role: "surface", alpha: 0.12 },
    // Native --vscode-* workbench layer (added 2026-08-19, mirror of the 78
    // tokens in workbuddyCss.mjs / engines/workbuddy/tokens.css). WorkBuddy is
    // VS Code arch: the workbench chrome (editor/sidebar/tab/panel/input) reads
    // these directly, so the bridge must route them onto the semantic roles.
    { var: "--vscode-editor-background", role: "surface" },
    { var: "--vscode-sideBar-background", role: "surface", alpha: 0.88 },
    { var: "--vscode-panel-background", role: "surface" },
    { var: "--vscode-tab-activeBackground", role: "surface" },
    { var: "--vscode-menu-background", role: "surface" },
    { var: "--vscode-dropdown-background", role: "surface" },
    { var: "--vscode-terminal-background", role: "surface" },
    { var: "--vscode-input-background", role: "surface", alpha: 0.82 },
    { var: "--vscode-editorWidget-background", role: "surface" },
    { var: "--vscode-foreground", role: "text" },
    { var: "--vscode-editor-foreground", role: "text" },
    { var: "--vscode-descriptionForeground", role: "text", alpha: 0.7 },
    { var: "--vscode-input-foreground", role: "text" },
    { var: "--vscode-dropdown-foreground", role: "text" },
    { var: "--vscode-menu-foreground", role: "text" },
    { var: "--vscode-terminal-foreground", role: "text" },
    { var: "--vscode-icon-foreground", role: "text", alpha: 0.72 },
    { var: "--vscode-border", role: "border" },
    { var: "--vscode-panel-border", role: "border" },
    { var: "--vscode-dropdown-border", role: "border" },
    { var: "--vscode-menu-border", role: "border" },
    { var: "--vscode-textLink-foreground", role: "accent" },
    { var: "--vscode-button-background", role: "accent" },
    { var: "--vscode-focusBorder", role: "accent", alpha: 0.55 },
    { var: "--vscode-list-activeSelectionBackground", role: "accent", alpha: 0.16 },
    { var: "--vscode-list-hoverBackground", role: "accent", alpha: 0.1 },
    { var: "--vscode-badge-background", role: "accent" },
    { var: "--vscode-editor-selectionBackground", role: "accent", alpha: 0.18 },
  ],
  verification: {
    // The root landmark is the only blocking check: it doubles as the
    // "app finished booting" signal and the minimal app fingerprint. Everything
    // else warns — panels hide per view/window, and CSS is inert on absent nodes.
    rootAny: ["#root > .teams-container", ".teams-container", "#root", "body > div"],
    recommended: [
      { name: "sidebar", any: [".conversation-sidebar", ".conversation-list", "[class*='sidebar']"] },
      { name: "workspace", any: [".teams-main-content", ".main-content", ".chat-container", "[class*='chat']"] },
      { name: "composer", any: ["[role='textbox'][contenteditable='true']", "[contenteditable='true']"] },
    ],
  },
};

export default workbuddy;
