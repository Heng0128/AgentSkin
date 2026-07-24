export const QODERWORK_THEME_V1_PROFILE = "qoderwork-theme-v1";

function runtime({ theme, imageDataUrls = {}, imageUrls = {}, artDataUrl, artUrl = imageUrls.hero ?? artDataUrl }) {
  const CHROME_ID = "codedrobe-qoderwork-skin-chrome";
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
    const parchment = document.querySelector(".agents-parchment-paper-surface");
    const chat = document.querySelector(".agents-chat-panel");
    const welcome = document.querySelector(".welcome-title");
    return { parchment, chat, welcome, home: Boolean(welcome && !chat?.children?.length) };
  };

  const ensure = () => {
    const root = document.documentElement;
    if (!root) return false;
    root.classList.add("codedrobe-qoderwork-skin");
    root.dataset.qoderworkSkinTheme = theme.id;

    root.style.setProperty("--dream-tagline", cssString(copy.tagline));
    root.style.setProperty("--dream-signature", cssString(copy.signature));
    root.style.setProperty("--dream-ribbon", cssString(copy.ribbon));

    const layoutRoot = document.querySelector(".agents-layout-root");
    const contentArea = document.querySelector(".agents-content-area") || document.querySelector(".agents-layout-body");
    if (contentArea) {
      const { home } = detectContext();
      contentArea.classList.toggle("dream-home-shell", home);
      contentArea.classList.toggle("dream-conversation-shell", !home);
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

    if (contentArea) {
      const box = contentArea.getBoundingClientRect();
      chrome.style.left = `${Math.round(box.left)}px`;
      chrome.style.top = `${Math.round(box.top)}px`;
      chrome.style.width = `${Math.round(box.width)}px`;
      chrome.style.height = `${Math.round(box.height)}px`;
    }
    const { home } = detectContext();
    chrome.classList.toggle("dream-home-shell", home);
    chrome.classList.toggle("dream-conversation-shell", !home);
    return true;
  };

  const cleanup = () => {
    const root = document.documentElement;
    root?.classList.remove("codedrobe-qoderwork-skin");
    if (root) delete root.dataset.qoderworkSkinTheme;
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
    if (!root?.classList.contains("codedrobe-qoderwork-skin")) {
      missing.push({ name: "root-class", selectors: ["html.codedrobe-qoderwork-skin"] });
    }
    if (!chrome) missing.push({ name: "chrome-layer", selectors: ["#codedrobe-qoderwork-skin-chrome"] });
    if (chrome && getComputedStyle(chrome).pointerEvents !== "none") {
      missing.push({ name: "noninteractive-chrome", selectors: ["#codedrobe-qoderwork-skin-chrome { pointer-events: none }"] });
    }
    return {
      id: "qoderwork-theme-v1",
      pass: missing.length === 0,
      missing,
      rootClassPresent: Boolean(root?.classList.contains("codedrobe-qoderwork-skin")),
      chromePresent: Boolean(chrome),
    };
  };

  return { ensure, cleanup, verify };
}

function cleanup() {
  const root = document.documentElement;
  root?.classList.remove("codedrobe-qoderwork-skin");
  if (root) delete root.dataset.qoderworkSkinTheme;
  root?.style.removeProperty("--dream-tagline");
  root?.style.removeProperty("--dream-signature");
  root?.style.removeProperty("--dream-ribbon");
  document.querySelectorAll(".dream-home-shell, .dream-conversation-shell").forEach((node) => {
    node.classList.remove("dream-home-shell", "dream-conversation-shell");
  });
  document.getElementById("codedrobe-qoderwork-skin-chrome")?.remove();
}

export default {
  id: QODERWORK_THEME_V1_PROFILE,
  runtime,
  cleanup,
};
