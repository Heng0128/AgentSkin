// Covers both editions: QoderWork CN (com.qoder.work.cn) and the global
// QoderWork (com.qoder.work). Their v0.9.12 packages ship byte-identical
// renderer stylesheets and identical landmark class inventories (verified by
// static extraction of the official installers), so one adapter id serves
// both and themes apply unchanged.
import qoderworkThemeV1Profile from "../runtime/profiles/qoderwork-theme-v1.mjs";
import { DISPLAY_NAMES } from "./meta.mjs";

const qoderwork = {
  id: "qoderwork",
  displayName: DISPLAY_NAMES.qoderwork,
  defaultPort: 0,
  rendererProfiles: {
    [qoderworkThemeV1Profile.id]: qoderworkThemeV1Profile,
  },
  // Real-app signoff exists for the CN edition on macOS only; global macOS
  // and Windows support is based on static package analysis of the same
  // version and stays unverified until a real-app pass.
  lastVerified: {
    darwin: { appVersion: "0.9.12", build: "0.9.12", verifiedAt: "2026-07-19" },
  },
  platforms: {
    darwin: {
      bundleIds: ["com.qoder.work.cn", "com.qoder.work"],
      appCandidates: [
        "/Applications/QoderWork CN.app",
        "~/Applications/QoderWork CN.app",
        "/Applications/QoderWork.app",
        "~/Applications/QoderWork.app",
      ],
      // Each edition names the binary after its bundle; discovery also derives
      // "Contents/MacOS/<bundle name>" per candidate.
      executableRelative: "Contents/MacOS/QoderWork CN",
      processMarkers: [
        "/QoderWork CN.app/Contents/MacOS/QoderWork CN",
        "/QoderWork.app/Contents/MacOS/QoderWork",
      ],
      // The main process forces `remote-debugging-port=0`, so caller-chosen
      // ports never bind; the live port is published only through these files
      // (one user-data directory per edition).
      devToolsActivePortFile: [
        "~/Library/Application Support/QoderWork CN/DevToolsActivePort",
        "~/Library/Application Support/QoderWork/DevToolsActivePort",
      ],
    },
    win32: {
      executableCandidates: [
        "%LOCALAPPDATA%\\Programs\\QoderWork\\QoderWork.exe",
        "%LOCALAPPDATA%\\Programs\\QoderWork CN\\QoderWork CN.exe",
        "%LOCALAPPDATA%\\Programs\\QoderWorkCN\\QoderWorkCN.exe",
        // QoderWork is also installed to Program Files (per-machine installs);
        // the CN edition nests an extra "QoderWork CN" subfolder.
        "%PROGRAMFILES%\\QoderWork\\QoderWork.exe",
        "%PROGRAMFILES%\\QoderWork CN\\QoderWork CN\\QoderWork CN.exe",
        "%PROGRAMFILES%\\QoderWork CN\\QoderWork.exe",
        "%PROGRAMFILES(X86)%\\QoderWork\\QoderWork.exe",
        "%PROGRAMFILES(X86)%\\QoderWork CN\\QoderWork CN\\QoderWork CN.exe",
      ],
      // electron-builder keys the uninstall entry by appId (or product name on
      // older builds); probe both editions.
      uninstallKeys: ["com.qoder.work", "com.qoder.work.cn", "QoderWork", "QoderWork CN"],
      processNames: ["QoderWork.exe", "QoderWork CN.exe", "QoderWorkCN.exe"],
      devToolsActivePortFile: [
        "%APPDATA%\\QoderWork\\DevToolsActivePort",
        "%APPDATA%\\QoderWork CN\\DevToolsActivePort",
      ],
    },
  },
  matchTarget(target) {
    if (target?.type !== "page") return false;
    const url = String(target.url ?? "");
    const title = String(target.title ?? "");
    if (/^(devtools|chrome-extension):/i.test(url)) return false;
    if (/^about:/i.test(url)) return false;
    // Auxiliary windows (artifact preview, quick pick, voice overlay, MCP app
    // preview) live in the same renderer directory but are not the main shell.
    if (/(artifact-preview|mcp-app-preview|quickpick|voice-overlay)\.html/i.test(url)) return false;
    if (/app\.asar\/out\/renderer\/index\.html/i.test(url)) return true;
    // Localhost-served renderer (dev mode or new architecture).
    if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(url)) return true;
    // Title fallback (previously injected at runtime by patchWindowsAdapters;
    // now static so engine and runtime agree). Broader `/qoder/i` catches
    // both "Qoder" and "QoderWork" window titles.
    if (/qoder/i.test(title)) return true;
    // Broad fallback: any page target with a non-empty title that looks like
    // an app window (not DevTools, not chrome-internal). Catches edge cases
    // where the window title is the conversation name rather than the product.
    if (title && !/^(DevTools|chrome|about:)/i.test(title) && url && !url.startsWith("about:")) return true;
    return false;
  },
  // CSS variable bridge (S3): re-route the native --color-* family QoderWork
  // reads onto AgentSkin semantic roles. Alphas mirror
  // engines/qoderwork/tokens.css (art-transparent *-bg-container) vars are
  // intentionally omitted.
  bridge: [
    { var: "--color-primary", role: "accent" },
    { var: "--color-text", role: "text" },
    { var: "--color-text-secondary", role: "muted" },
    { var: "--color-text-tertiary", role: "text", alpha: 0.55 },
    { var: "--color-muted", role: "muted" },
    { var: "--color-text-on-primary", role: "bg" },
    { var: "--color-bg-elevated", role: "surface-elevated", alpha: 0.85 },
    { var: "--color-popover", role: "surface-elevated" },
    { var: "--color-border", role: "border" },
    { var: "--color-border-secondary", role: "border", alpha: 0.6 },
    { var: "--color-fill", role: "text", alpha: 0.16 },
    { var: "--color-link", role: "accent" },
  ],
  verification: {
    // The root landmark is the only blocking check: it doubles as the
    // "app finished booting" signal and the minimal app fingerprint. Everything
    // else warns — panels hide per view/window, and CSS is inert on absent nodes.
    rootAny: ["#root .agents-layout-root", ".agents-layout-root", "#root"],
    recommended: [
      { name: "sidebar", any: [".agents-sidebar", "[data-resizable-sidebar]"] },
      { name: "workspace", any: [".agents-content-area", ".agents-layout-body"] },
      // The editable div has a placeholder twin with the same class, so the
      // contenteditable attribute filter is load-bearing.
      { name: "composer", any: [".chat-input-editor-text[contenteditable='true']"] },
    ],
  },
};

export default qoderwork;
