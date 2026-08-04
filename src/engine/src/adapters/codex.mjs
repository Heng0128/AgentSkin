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
  verification: {
    // The root landmark is the only blocking check: it doubles as the
    // "app finished booting" signal and the minimal app fingerprint. Everything
    // else warns — the sidebar collapses, and CSS is inert on absent nodes.
    rootAny: ["main.main-surface"],
    recommended: [
      { name: "sidebar", any: ["aside.app-shell-left-panel"] },
      { name: "composer", any: [".composer-surface-chrome"] },
    ],
  },
};

export default codex;
