// SPDX-License-Identifier: MPL-2.0

/**
 * # Theme Switcher Menu
 *
 * A self-contained, CDP-injectable UI that mounts a floating 🎨 trigger in the
 * top-right corner of a target application. Clicking it reveals a panel listing
 * installed themes, an image-upload entry, and a "restore defaults" action.
 *
 * The component is framework-free (no React) and survives navigation when
 * registered as a `Page.addScriptToEvaluateOnNewDocument` persistence script —
 * the same mechanism the core injector uses for theme re-application.
 *
 * ## Architecture
 *
 * ```
 *   buildThemeSwitcherExpression(options)  →  IIFE string
 *          │                                       │
 *          │  (Node side)                          │  (Browser / Runtime.evaluate)
 *          ▼                                       ▼
 *   Serialises themes + CSS                Mounts DOM, wires events,
 *                                         persists to localStorage
 * ```
 *
 * The IIFE is fully idempotent: repeated calls replace the existing instance
 * rather than stacking duplicates. The mounted DOM is tagged with
 * `data-agentskin-menu` so the self-heal loop (AdaptiveMutationObserver) can
 * treat it as excluded infrastructure.
 *
 * ## Events dispatched on `window`
 *
 * | Event                       | Detail                                            |
 * |-----------------------------|---------------------------------------------------|
 * | `agentskin:menu-theme`      | `{ appId, themeId }` — theme selected or `null`   |
 * | `agentskin:menu-image`      | `{ appId, image, restored? }` — image uploaded    |
 *
 * ## State contract
 *
 * ```ts
 * window.__agentskin__ ||= { hosts: {}, menuState: {} }
 * window.__agentskin__.menuState[appId] = { activeThemeId, uploadedImage }
 * ```
 *
 * `activeThemeId` is mirrored to localStorage key
 * `agentskin.menu.<appId>.theme` so it survives cross-navigation.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single theme entry as seen by the menu. Serialised into the IIFE. */
export interface ThemeSwitcherTheme {
  id: string;
  displayName: string;
  version: string;
  /** Representative colours for the swatch chip. */
  preview?: {
    surface?: string;
    accent?: string;
    text?: string;
  };
}

/** Full options bag for the builder. */
export interface ThemeSwitcherOptions {
  /** Target application adapter id (e.g. "traework"). */
  appId: string;
  /** Themes available for instant switching. */
  themes: ThemeSwitcherTheme[];
  /** Currently active theme id, or null for the unthemed default. */
  activeThemeId: string | null;
  /** Raw CSS string for the menu chrome (from theme-switcher-menu.css). */
  cssText: string;
  /** Optional UI strings — falls back to English defaults. */
  i18n?: {
    title?: string;
    uploadLabel?: string;
    restoreLabel?: string;
    noThemes?: string;
    closeLabel?: string;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STORAGE_PREFIX = "agentskin.menu.";
const MENU_TAG = "data-agentskin-menu";

// ---------------------------------------------------------------------------
// IIFE body (single template, values injected via JSON.stringify)
// ---------------------------------------------------------------------------

/**
 * The IIFE body uses the same `JSON.stringify` injection convention as the
 * engine's `renderer-payload.mjs`: every dynamic value is serialised at build
 * time and embedded as a literal, so the resulting string is a pure expression
 * with no free variables — safe for `Runtime.evaluate` and
 * `Page.addScriptToEvaluateOnNewDocument`.
 */
const IIFE_BODY = `(() => {
  'use strict';
  const APP_ID = /*__APP_ID*/;
  const THEMES = /*__THEMES*/;
  const ACTIVE_THEME_ID = /*__ACTIVE_THEME_ID*/;
  const CSS_TEXT = /*__CSS_TEXT*/;
  const I18N = /*__I18N*/;

  // --- DOM id helpers ---------------------------------------------------
  const menuId = 'agentskin-menu-' + APP_ID;
  const triggerId = 'agentskin-menu-trigger-' + APP_ID;
  const panelId = 'agentskin-menu-panel-' + APP_ID;
  const styleId = 'agentskin-menu-style-' + APP_ID;

  // --- localStorage helpers ---------------------------------------------
  const STORAGE_KEY = ${JSON.stringify(STORAGE_PREFIX)} + APP_ID + '.theme';
  const IMAGE_KEY = ${JSON.stringify(STORAGE_PREFIX)} + APP_ID + '.image';

  const readStoredTheme = () => {
    try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
  };
  const writeStoredTheme = (id) => {
    try { if (id) localStorage.setItem(STORAGE_KEY, id); else localStorage.removeItem(STORAGE_KEY); } catch { /* private mode */ }
  };
  const readStoredImage = () => {
    try { return localStorage.getItem(IMAGE_KEY); } catch { return null; }
  };
  const writeStoredImage = (data) => {
    try { localStorage.setItem(IMAGE_KEY, data); } catch { /* quota / private mode */ }
  };

  // --- shared root state ------------------------------------------------
  // 2026-09-02 RFC: V2(V2大写)→V3(小写)迁移桥接
  const rootState = window.__agentskin__ ||= {};
  // 兜底迁移：若旧 V2 遗留有大写 __AGENTSKIN__ 值，桥接合并
  if (window.__AGENTSKIN__ && !window.__agentskin__.menuState) {
    window.__agentskin__.menuState = window.__AGENTSKIN__.menuState;
    window.__agentskin__.hosts = window.__AGENTSKIN__.hosts;
  }
  window.__agentskin__.hosts ||= {};
  window.__agentskin__.menuState ||= {};
  const menuState = rootState.menuState[APP_ID] ||= { activeThemeId: ACTIVE_THEME_ID };

  // --- idempotency: tear down prior instance ---------------------------
  const prior = document.getElementById(menuId);
  if (prior) prior.remove();
  const priorStyle = document.getElementById(styleId);
  if (priorStyle) priorStyle.remove();

  // --- inject styles ----------------------------------------------------
  try {
    const style = document.createElement('style');
    style.id = styleId;
    style.setAttribute(${JSON.stringify(MENU_TAG)}, '');
    style.textContent = CSS_TEXT;
    document.documentElement.appendChild(style);
  } catch { /* injection must never break the page */ }

  // --- build trigger + panel -------------------------------------------
  const menu = document.createElement('div');
  menu.id = menuId;
  menu.setAttribute(${JSON.stringify(MENU_TAG)}, '');
  menu.className = 'agentskin-menu';

  const trigger = document.createElement('button');
  trigger.id = triggerId;
  trigger.className = 'agentskin-menu-trigger';
  trigger.type = 'button';
  trigger.setAttribute('aria-label', I18N.title || 'Theme switcher');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.innerHTML = '<span class="agentskin-menu-trigger-icon" aria-hidden="true">\\u{1F3A8}</span>';

  const panel = document.createElement('div');
  panel.id = panelId;
  panel.className = 'agentskin-menu-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', I18N.title || 'Theme switcher');
  panel.hidden = true;

  // --- panel header ----------------------------------------------------
  const header = document.createElement('div');
  header.className = 'agentskin-menu-header';
  const heading = document.createElement('h2');
  heading.className = 'agentskin-menu-heading';
  heading.textContent = I18N.title || 'Theme';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'agentskin-menu-close';
  closeBtn.setAttribute('aria-label', I18N.closeLabel || 'Close');
  closeBtn.textContent = '\\u2715';
  header.append(heading, closeBtn);

  // --- theme list ------------------------------------------------------
  const list = document.createElement('ul');
  list.className = 'agentskin-menu-list';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', I18N.title || 'Theme list');

  const currentActive = menuState.activeThemeId || ACTIVE_THEME_ID;

  for (const theme of THEMES) {
    const li = document.createElement('li');
    li.className = 'agentskin-menu-item';
    li.dataset.themeId = theme.id;
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', String(theme.id === currentActive));

    const swatch = document.createElement('span');
    swatch.className = 'agentskin-menu-swatch';
    const p = theme.preview || {};
    swatch.style.setProperty('--ms-surface', p.surface || '#888');
    swatch.style.setProperty('--ms-accent', p.accent || '#555');
    swatch.style.setProperty('--ms-text', p.text || '#ccc');
    swatch.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'agentskin-menu-label';
    label.textContent = theme.displayName;

    const check = document.createElement('span');
    check.className = 'agentskin-menu-check';
    check.setAttribute('aria-hidden', 'true');
    check.textContent = '\\u2713';

    li.append(swatch, label, check);
    list.appendChild(li);
  }

  if (THEMES.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'agentskin-menu-empty';
    empty.textContent = I18N.noThemes || 'No themes installed';
    list.appendChild(empty);
  }

  // --- upload entry ----------------------------------------------------
  const uploadItem = document.createElement('li');
  uploadItem.className = 'agentskin-menu-upload';
  const uploadInput = document.createElement('input');
  uploadInput.type = 'file';
  uploadInput.accept = 'image/*';
  uploadInput.className = 'agentskin-menu-upload-input';
  uploadInput.setAttribute('aria-label', I18N.uploadLabel || 'Upload image');
  const uploadLabel = document.createElement('label');
  uploadLabel.className = 'agentskin-menu-upload-label';
  uploadLabel.appendChild(document.createTextNode(I18N.uploadLabel || 'Upload image '));
  uploadLabel.appendChild(uploadInput);
  uploadItem.appendChild(uploadLabel);

  // --- restore entry ---------------------------------------------------
  const restoreItem = document.createElement('li');
  restoreItem.className = 'agentskin-menu-restore';
  restoreItem.textContent = I18N.restoreLabel || 'Restore defaults';

  const footer = document.createElement('div');
  footer.className = 'agentskin-menu-footer';
  footer.append(uploadItem, restoreItem);

  panel.append(header, list, footer);
  menu.append(trigger, panel);
  document.body.appendChild(menu);

  // --- state -----------------------------------------------------------
  let isOpen = false;
  const setOpen = (open) => {
    isOpen = open;
    panel.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    menu.classList.toggle('is-open', open);
  };

  // --- helpers ---------------------------------------------------------
  const applyTheme = (themeId) => {
    if (!themeId) {
      // Restore: delegate to the core injector's cleanup path.
      const hostState = rootState.hosts?.[APP_ID];
      if (hostState?.cleanup) hostState.cleanup();
      document.documentElement.classList.remove('agentskin-theme');
      menuState.activeThemeId = null;
      writeStoredTheme('');
    } else {
      // Select: update state + signal the core injector via CustomEvent.
      // The injector's watch loop listens for 'agentskin:menu-theme' and
      // re-applies the full theme CSS via buildApplyExpression().
      menuState.activeThemeId = themeId;
      rootState.menuState[APP_ID] = menuState;
      writeStoredTheme(themeId);
      document.documentElement.dataset.agentskinMenuTheme = themeId;
    }
    // Reflect selection in the DOM.
    const items = Array.from(list.querySelectorAll('.agentskin-menu-item'));
    for (const el of items) {
      el.setAttribute('aria-selected', String(el.dataset.themeId === themeId));
    }
    // Notify listeners (core injector watch loop, diagnostics, etc.).
    window.dispatchEvent(new CustomEvent('agentskin:menu-theme', {
      detail: { appId: APP_ID, themeId },
    }));
  };

  const handleUpload = (file) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      writeStoredImage(dataUrl);
      menuState.uploadedImage = dataUrl;
      window.dispatchEvent(new CustomEvent('agentskin:menu-image', {
        detail: { appId: APP_ID, image: dataUrl },
      }));
    };
    reader.readAsDataURL(file);
  };

  // --- event wiring ----------------------------------------------------
  trigger.addEventListener('click', () => setOpen(!isOpen));
  closeBtn.addEventListener('click', () => setOpen(false));

  list.addEventListener('click', (event) => {
    const item = event.target?.closest?.('.agentskin-menu-item');
    if (!item || !item.dataset.themeId) return;
    applyTheme(item.dataset.themeId);
  });

  uploadInput.addEventListener('change', (event) => {
    const file = event.target?.files?.[0];
    if (file) handleUpload(file);
  });

  restoreItem.addEventListener('click', () => applyTheme(null));

  // Close on Escape.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isOpen) setOpen(false);
  }, { passive: true });

  // Close on outside click.
  document.addEventListener('click', (event) => {
    if (!isOpen) return;
    if (!menu.contains(event.target)) setOpen(false);
  }, { passive: true });

  // --- restore stored image --------------------------------------------
  const storedImage = readStoredImage();
  if (storedImage) {
    menuState.uploadedImage = storedImage;
    window.dispatchEvent(new CustomEvent('agentskin:menu-image', {
      detail: { appId: APP_ID, image: storedImage, restored: true },
    }));
  }

  // --- sync initial theme from storage ---------------------------------
  const storedTheme = readStoredTheme();
  if (storedTheme && storedTheme !== menuState.activeThemeId) {
    menuState.activeThemeId = storedTheme;
  }

  return { mounted: true, appId: APP_ID, themes: THEMES.length };
})()`;

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/**
 * Build a self-contained IIFE string that mounts the theme switcher menu when
 * evaluated in the target page (via CDP `Runtime.evaluate` or
 * `Page.addScriptToEvaluateOnNewDocument`).
 *
 * @param options — Theme list, active theme, CSS, and i18n strings.
 * @returns A pure-expression string safe for CDP injection.
 */
export function buildThemeSwitcherExpression(options: ThemeSwitcherOptions): string {
  const { appId, themes, activeThemeId, cssText, i18n = {} } = options;

  if (typeof appId !== "string" || !appId) {
    throw new Error("theme-switcher-menu: appId must be a non-empty string.");
  }
  if (!Array.isArray(themes)) {
    throw new Error("theme-switcher-menu: themes must be an array.");
  }
  if (typeof cssText !== "string") {
    throw new Error("theme-switcher-menu: cssText must be a string.");
  }

  return IIFE_BODY
    .replace("/*__APP_ID*/", JSON.stringify(appId))
    .replace("/*__THEMES*/", JSON.stringify(themes))
    .replace("/*__ACTIVE_THEME_ID*/", JSON.stringify(activeThemeId))
    .replace("/*__CSS_TEXT*/", JSON.stringify(cssText))
    .replace("/*__I18N*/", JSON.stringify(i18n));
}

/** localStorage key for the active theme of a given app. */
export function storageKeyFor(appId: string): string {
  return `${STORAGE_PREFIX}${appId}.theme`;
}

/** localStorage key for the uploaded image of a given app. */
export function imageStorageKeyFor(appId: string): string {
  return `${STORAGE_PREFIX}${appId}.image`;
}
