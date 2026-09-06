export const WORKBUDDY_THEME_V1_PROFILE = "workbuddy-theme-v1";

function runtime({ theme, imageDataUrls = {}, imageUrls = {}, artDataUrl, artUrl = imageUrls.hero ?? artDataUrl }) {
  const CHROME_ID = "agentskin-workbuddy-skin-chrome";
  const copy = {
    brandTitle: theme.displayName ?? "AgentSkin",
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
    const home = document.querySelector(".wb-home-page");
    const conversation = document.querySelector(".chat-container:not(.chat-container--welcome)");
    return { home, conversation };
  };

  const ensure = () => {
    const root = document.documentElement;
    if (!root) return false;
    root.classList.add("agentskin-workbuddy-skin");
    root.dataset.workbuddySkinTheme = theme.id;

    root.style.setProperty("--dream-tagline", cssString(copy.tagline));
    root.style.setProperty("--dream-signature", cssString(copy.signature));
    root.style.setProperty("--dream-ribbon", cssString(copy.ribbon));

    const { home, conversation } = detectContext();
    const mainContent = document.querySelector(".teams-main-content") || document.querySelector(".main-content");
    if (mainContent) {
      mainContent.classList.toggle("dream-home-shell", Boolean(home));
      mainContent.classList.toggle("dream-conversation-shell", Boolean(conversation));
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

    if (mainContent) {
      const box = mainContent.getBoundingClientRect();
      chrome.style.left = `${Math.round(box.left)}px`;
      chrome.style.top = `${Math.round(box.top)}px`;
      chrome.style.width = `${Math.round(box.width)}px`;
      chrome.style.height = `${Math.round(box.height)}px`;
    }
    chrome.classList.toggle("dream-home-shell", Boolean(home));
    chrome.classList.toggle("dream-conversation-shell", Boolean(conversation));
    return true;
  };

  const cleanup = () => {
    const root = document.documentElement;
    root?.classList.remove("agentskin-workbuddy-skin");
    if (root) delete root.dataset.workbuddySkinTheme;
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
    if (!root?.classList.contains("agentskin-workbuddy-skin")) {
      missing.push({ name: "root-class", selectors: ["html.agentskin-workbuddy-skin"] });
    }
    if (!chrome) missing.push({ name: "chrome-layer", selectors: ["#agentskin-workbuddy-skin-chrome"] });
    if (chrome && getComputedStyle(chrome).pointerEvents !== "none") {
      missing.push({ name: "noninteractive-chrome", selectors: ["#agentskin-workbuddy-skin-chrome { pointer-events: none }"] });
    }
    return {
      id: "workbuddy-theme-v1",
      pass: missing.length === 0,
      missing,
      rootClassPresent: Boolean(root?.classList.contains("agentskin-workbuddy-skin")),
      chromePresent: Boolean(chrome),
    };
  };

  return { ensure, cleanup, verify };
}

function cleanup() {
  const root = document.documentElement;
  root?.classList.remove("agentskin-workbuddy-skin");
  if (root) delete root.dataset.workbuddySkinTheme;
  root?.style.removeProperty("--dream-tagline");
  root?.style.removeProperty("--dream-signature");
  root?.style.removeProperty("--dream-ribbon");
  document.querySelectorAll(".dream-home-shell, .dream-conversation-shell").forEach((node) => {
    node.classList.remove("dream-home-shell", "dream-conversation-shell");
  });
  document.getElementById("agentskin-workbuddy-skin-chrome")?.remove();
}

export default {
  id: WORKBUDDY_THEME_V1_PROFILE,
  runtime,
  cleanup,
};
