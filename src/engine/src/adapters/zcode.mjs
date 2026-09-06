import { DISPLAY_NAMES } from "./meta.mjs";

// ZCode — packaged Electron desktop app (@zcode/desktop, v3.6.5+).
//
// The Windows installer is Squirrel-based: ZCode.exe + Uninstall ZCode.exe
// land in C:\Program Files\ZCode (with a resources/app.asar bundle), and the
// Chromium profile lives under %APPDATA%\ZCode\session\. The renderer is a
// local Vite/React build loaded via file:// (rooted at #root), so the app is
// CDP-themable exactly like Codex/Doubao.
//
// ⚠️ 安全边界（Security Boundary）
// AgentSkin 仅作为只读视觉注入方，不参与 ZCode 客户端的以下机制（已知但不用）：
//   - PermissionRequest 反向控制闭环（write/edit/bash 可被外部 hook 接管）
//   - AskUserQuestion 完全接管（含中文 other 自定义输入）
//   - macOS 系统角色入口（Accessibility 等，本项目不依赖）
// 详见：docs/adapters/zcode-security-boundary.md
//
// 本适配器的注入范围严格限定于：
//   - CSS 变量桥接（bridge 字段，5 个 core 变量）
//   - 视觉层结构样式（engine/zcode/adapter.mjs 内的 MutationObserver 自愈）
//   - 不读取不修改 app.asar、session 数据、token、权限模型
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
