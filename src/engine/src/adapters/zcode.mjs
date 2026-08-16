import { DISPLAY_NAMES } from "./meta.mjs";

// ZCode — packaged Electron desktop app (@zcode/desktop, v3.6.5+).
//
// The Windows installer is Squirrel-based: ZCode.exe + Uninstall ZCode.exe
// land in C:\Program Files\ZCode (with a resources/app.asar bundle), and the
// Chromium profile lives under %APPDATA%\ZCode\session\. The renderer is a
// local Vite/React build loaded via file:// (rooted at #root), so the app is
// CDP-themable exactly like Codex/Doubao.
const zcode = {
  id: "zcode",
  displayName: DISPLAY_NAMES.zcode,
  defaultPort: 0,
  platforms: {
    win32: {
      executableCandidates: [
        "%PROGRAMFILES%\\ZCode\\ZCode.exe",
        "%LOCALAPPDATA%\\Programs\\ZCode\\ZCode.exe",
        // x86 / per-machine installs on non-default drives are common.
        "%PROGRAMFILES(X86)%\\ZCode\\ZCode.exe",
        "%PROGRAMDATA%\\ZCode\\ZCode.exe",
        "%LOCALAPPDATA%\\ZCode\\ZCode.exe",
      ],
      // Squirrel installers register HKCU\...\Uninstall\ZCode.
      uninstallKeys: ["ZCode"],
      processNames: ["ZCode.exe"],
      // ZCode writes DevToolsActivePort to its Chromium user-data dir under
      // APPDATA — verified at %APPDATA%\ZCode\session\DevToolsActivePort
      // (the app runs Electron with a "session" user-data subdirectory, so
      // the file is NOT at %APPDATA%\ZCode\DevToolsActivePort). The app-root
      // path is kept as a fallback for older versions.
      devToolsActivePortFile: [
        "%APPDATA%\\ZCode\\session\\DevToolsActivePort",
        "%APPDATA%\\ZCode\\DevToolsActivePort",
      ],
    },
  },
  matchTarget(target) {
    if (target?.type !== "page") return false;
    const url = String(target.url ?? "");
    const title = String(target.title ?? "");
    if (/^(devtools|chrome-extension):/i.test(url)) return false;
    if (/^about:/i.test(url)) return false;
    // ZCode's renderer is served from the app bundle via file://.
    if (/^file:\/\//i.test(url) && /zcode/i.test(url)) return true;
    // Title-based match covers the main window ("ZCode") and localized variants.
    if (/zcode/i.test(title)) return true;
    // app.asar renderer (standard Electron packaging).
    if (/app\.asar/i.test(url)) return true;
    return false;
  },
  // CSS variable bridge (S3): declaratively re-route the Tailwind v4 token
  // family ZCode reads onto AgentSkin semantic roles. Compiled by the engine
  // at apply time (css-var-bridge.mjs) so both the app's own CSS rules and any
  // JS getComputedStyle() reads resolve to the active theme. Alphas mirror
  // engines/zcode/tokens.css to preserve translucency/art punch-through.
  // Art-transparent variables (--color-background, --color-surface, --bg-primary,
  // --bg-base, --bg-canvas) are intentionally omitted so the hero/wallpaper
  // stays visible.
  bridge: [
    { var: "--color-foreground", role: "text" },
    { var: "--color-foreground-subtle", role: "muted" },
    { var: "--color-accent", role: "accent" },
    { var: "--color-primary", role: "accent" },
    { var: "--color-border", role: "border" },
  ],
  verification: {
    // The root landmark is the only blocking check: it doubles as the
    // "app finished booting" signal and the minimal app fingerprint.
    rootAny: ["#root", "body"],
    recommended: [
      { name: "sidebar", any: ["[class*='sidebar']", "aside"] },
      { name: "composer", any: ["[contenteditable='true']"] },
    ],
  },
};

export default zcode;
