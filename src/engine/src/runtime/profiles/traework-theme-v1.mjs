export const TRAEWORK_THEME_V1_PROFILE = "traework-theme-v1";

function runtime({ theme, imageDataUrls = {}, imageUrls = {}, artDataUrl, artUrl = imageUrls.hero ?? artDataUrl }) {
  const CHROME_ID = "codedrobe-traework-skin-chrome";
  const copy = {
    brandTitle: theme.displayName ?? "CodeDrobe",
    brandSubtitle: "",
    signature: "",
    tagline: "",
    ribbon: "✦",
    ...(theme.copy ?? {}),
  };
  const cssString = (value) => JSON.stringify(String(value ?? ""));

  const updateChromeCopy = (chrome) => {
    const title = chrome.querySelector(".dream-brand-title");
    const subtitle = chrome.querySelector(".dream-brand-subtitle");
    const signature = chrome.querySelector(".dream-signature");
    const ribbon = chrome.querySelector(".dream-ribbon-emoji");
    if (title) title.textContent = String(copy.brandTitle ?? "");
    if (subtitle) subtitle.textContent = String(copy.brandSubtitle ?? "");
    if (signature) signature.textContent = String(copy.signature ?? "");
    if (ribbon) ribbon.textContent = String(copy.ribbon ?? "");
  };

  const detectContext = () => {
    const panelContainer = document.querySelector(".panel-container");
    const soloLayout = document.querySelector(".solo-lite-layout");
    const initialChat = document.querySelector(".initial-chat-panel");
    const chatPanel = document.querySelector(".solo-lite-chat-panel-container");
    const home = Boolean(initialChat) || (panelContainer && !chatPanel);
    return { panelContainer, soloLayout, home };
  };

  const ensure = () => {
    const root = document.documentElement;
    if (!root) return false;
    root.classList.add("codedrobe-traework-skin");
    root.dataset.traeworkSkinTheme = theme.id;

    root.style.setProperty("--dream-tagline", cssString(copy.tagline));
    root.style.setProperty("--dream-signature", cssString(copy.signature));
    root.style.setProperty("--dream-ribbon", cssString(copy.ribbon));

    const { panelContainer, soloLayout, home } = detectContext();
    const workspace = panelContainer || soloLayout;
    if (workspace) {
      workspace.classList.toggle("dream-home-shell", home);
      workspace.classList.toggle("dream-conversation-shell", !home);
    }

    if (!document.body) return true;

    let chrome = document.getElementById(CHROME_ID);
    if (!chrome || chrome.parentElement !== document.body) {
      chrome?.remove();
      chrome = document.createElement("div");
      chrome.id = CHROME_ID;
      chrome.setAttribute("aria-hidden", "true");
      chrome.innerHTML = `
        <div class="dream-brand"><span class="dream-note">♫</span><span><b class="dream-brand-title"></b><small class="dream-brand-subtitle"></small></span></div>
        <div class="dream-signature"></div>
        <div class="dream-sparkles"><i></i><i></i><i></i><i></i><i></i><i></i></div>
        <div class="dream-ribbon"><span>♡</span><b class="dream-ribbon-emoji"></b><span>✦</span></div>
        <div class="dream-polaroid"></div>`;
      document.body.appendChild(chrome);
    }
    updateChromeCopy(chrome);

    if (workspace) {
      const box = workspace.getBoundingClientRect();
      chrome.style.left = `${Math.round(box.left)}px`;
      chrome.style.top = `${Math.round(box.top)}px`;
      chrome.style.width = `${Math.round(box.width)}px`;
      chrome.style.height = `${Math.round(box.height)}px`;
    }
    chrome.classList.toggle("dream-home-shell", home);
    chrome.classList.toggle("dream-conversation-shell", !home);
    return true;
  };

  const cleanup = () => {
    const root = document.documentElement;
    root?.classList.remove("codedrobe-traework-skin");
    if (root) delete root.dataset.traeworkSkinTheme;
    root?.style.removeProperty("--dream-tagline");
    root?.style.removeProperty("--dream-signature");
    root?.style.removeProperty("--dream-ribbon");
    document.querySelectorAll(".dream-home-shell, .dream-conversation-shell").forEach((node) => {
      node.classList.remove("dream-home-shell", "dream-conversation-shell");
    });
    document.getElementById(CHROME_ID)?.remove();
  };

  const verify = () => {
    const root = document.documentElement;
    const chrome = document.getElementById(CHROME_ID);
    const missing = [];
    if (!root?.classList.contains("codedrobe-traework-skin")) {
      missing.push({ name: "root-class", selectors: ["html.codedrobe-traework-skin"] });
    }
    if (!chrome) missing.push({ name: "chrome-layer", selectors: ["#codedrobe-traework-skin-chrome"] });
    if (chrome && getComputedStyle(chrome).pointerEvents !== "none") {
      missing.push({ name: "noninteractive-chrome", selectors: ["#codedrobe-traework-skin-chrome { pointer-events: none }"] });
    }
    return {
      id: "traework-theme-v1",
      pass: missing.length === 0,
      missing,
      rootClassPresent: Boolean(root?.classList.contains("codedrobe-traework-skin")),
      chromePresent: Boolean(chrome),
    };
  };

  return { ensure, cleanup, verify };
}

function cleanup() {
  const root = document.documentElement;
  root?.classList.remove("codedrobe-traework-skin");
  if (root) delete root.dataset.traeworkSkinTheme;
  root?.style.removeProperty("--dream-tagline");
  root?.style.removeProperty("--dream-signature");
  root?.style.removeProperty("--dream-ribbon");
  document.querySelectorAll(".dream-home-shell, .dream-conversation-shell").forEach((node) => {
    node.classList.remove("dream-home-shell", "dream-conversation-shell");
  });
  document.getElementById("codedrobe-traework-skin-chrome")?.remove();
}

export default {
  id: TRAEWORK_THEME_V1_PROFILE,
  runtime,
  cleanup,
};
