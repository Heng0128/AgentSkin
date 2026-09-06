// SPDX-License-Identifier: MPL-2.0
//
// # theme-switcher-menu.mjs — Lightweight Theme Switcher Menu
//
// Generates the HTML, CSS, and JavaScript for a lightweight theme switcher
// menu that can be injected into target applications via CDP (Chrome DevTools
// Protocol). Inspired by CodeDrobe / workbuddy-skin-studio's top-right
// palette menu — provides instant theme switching without restarting the app.
//
// Architecture:
//   - Pure functions that generate strings (HTML / CSS / JS) — no DOM access
//   - No side effects — safe to unit-test in Node.js without a browser
//   - Self-contained injection script: handles render, event binding, switching,
//     persistence, and restoration
//
// Security boundaries:
//   - Injected code never reads document.cookie, localStorage keys outside its
//     own namespace, or any token-bearing headers
//   - No network requests — all theme CSS is embedded in the injection script
//   - No eval of dynamic content — only static CSS class application

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** localStorage key for persisting the user's theme preference. */
export const THEME_PREFERENCE_KEY = 'agentskin-theme-preference';

/** DOM id for the switcher container — prefixed to avoid collisions. */
export const SWITCHER_DOM_ID = 'agentskin-theme-switcher';

/** CSS class prefix for theme-specific stylesheets. */
export const THEME_CLASS_PREFIX = 'as-theme-';

/** Z-index for the switcher menu — high enough to float above app UI. */
export const SWITCHER_Z_INDEX = 99999;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} ThemeDefinition
 * @property {string} id        Unique theme identifier (e.g. "catppuccin").
 * @property {string} name      Human-readable display name (e.g. "Catppuccin").
 * @property {string} [css]     Optional raw CSS override for this theme.
 */

// ---------------------------------------------------------------------------
// Menu HTML generation
// ---------------------------------------------------------------------------

/**
 * Generate the HTML markup for the theme switcher menu.
 *
 * Produces a fixed-position container with a palette button and a dropdown
 * list built from the supplied themes array. The first item is always the
 * "native" (no-theme) option.
 *
 * @param {ThemeDefinition[]} themes - Array of available themes.
 * @returns {string} Raw HTML string for the switcher menu.
 */
export function createSwitcherMenu(themes) {
  if (!Array.isArray(themes)) {
    throw new TypeError('createSwitcherMenu: themes must be an array');
  }

  const items = [
    `<div class="as-theme-item" data-theme-id="native" data-action="switch-theme">原生界面</div>`,
  ];

  for (const theme of themes) {
    if (!theme || typeof theme !== 'object') {
      throw new TypeError('createSwitcherMenu: each theme must be a non-null object');
    }
    if (typeof theme.id !== 'string' || theme.id.trim() === '') {
      throw new TypeError('createSwitcherMenu: theme.id must be a non-empty string');
    }
    if (typeof theme.name !== 'string' || theme.name.trim() === '') {
      throw new TypeError('createSwitcherMenu: theme.name must be a non-empty string');
    }
    items.push(
      `<div class="as-theme-item" data-theme-id="${escapeHtmlAttr(theme.id)}" data-action="switch-theme">${escapeHtml(theme.name)}</div>`,
    );
  }

  return `<div id="${SWITCHER_DOM_ID}" class="as-switcher-root" style="position:fixed;top:8px;right:8px;z-index:${SWITCHER_Z_INDEX};font-family:system-ui,-apple-system,sans-serif;">
  <button class="as-theme-btn" type="button" aria-label="切换主题" title="切换主题 (AgentSkin)">🎨</button>
  <div class="as-theme-dropdown" style="display:none;">
    ${items.join('\n    ')}
  </div>
</div>`;
}

// ---------------------------------------------------------------------------
// Theme CSS generation
// ---------------------------------------------------------------------------

/**
 * Generate the CSS block that defines all theme styles.
 *
 * Each theme (except "native") gets a class `as-theme-<id>` that sets CSS
 * custom properties on `:root`. The "native" theme simply resets overrides.
 *
 * @param {ThemeDefinition[]} themes - Array of available themes.
 * @returns {string} CSS string containing all theme definitions.
 */
export function generateThemeCss(themes) {
  if (!Array.isArray(themes)) {
    throw new TypeError('generateThemeCss: themes must be an array');
  }

  const lines = [
    `/* AgentSkin Theme Switcher — generated styles */`,
    `#${SWITCHER_DOM_ID} .as-theme-btn{`,
    `  width:32px;height:32px;border-radius:8px;border:1px solid rgba(128,128,128,0.3);`,
    `  background:rgba(128,128,128,0.1);cursor:pointer;font-size:16px;`,
    `  display:flex;align-items:center;justify-content:center;`,
    `  transition:background 0.15s ease;`,
    `}`,
    `#${SWITCHER_DOM_ID} .as-theme-btn:hover{background:rgba(128,128,128,0.2);}`,
    `#${SWITCHER_DOM_ID} .as-theme-dropdown{`,
    `  position:absolute;top:38px;right:0;min-width:140px;`,
    `  background:var(--as-dropdown-bg,#fff);border:1px solid rgba(128,128,128,0.2);`,
    `  border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,0.12);`,
    `  padding:4px 0;max-height:300px;overflow-y:auto;`,
    `}`,
    `#${SWITCHER_DOM_ID} .as-theme-item{`,
    `  padding:8px 16px;cursor:pointer;font-size:13px;`,
    `  color:var(--as-dropdown-text,#333);white-space:nowrap;`,
    `}`,
    `#${SWITCHER_DOM_ID} .as-theme-item:hover{background:rgba(128,128,128,0.1);}`,
    `#${SWITCHER_DOM_ID} .as-theme-item.as-active{font-weight:600;color:var(--as-accent,#4f46e5);}`,
  ];

  for (const theme of themes) {
    if (!theme || typeof theme !== 'object') continue;
    if (theme.id === 'native') continue;
    if (typeof theme.css === 'string' && theme.css.trim().length > 0) {
      lines.push(`.${THEME_CLASS_PREFIX}${theme.id}{`);
      lines.push(`  ${theme.css.trim()}`);
      lines.push(`}`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Theme switching JS snippets
// ---------------------------------------------------------------------------

/**
 * Generate the JavaScript code that switches the active theme.
 *
 * The returned string is a self-contained JS expression (safe for
 * CDP `Runtime.evaluate`) that:
 *   1. Removes all theme classes from document.documentElement.
 *   2. Applies the target theme class (unless "native").
 *   3. Updates the active indicator in the dropdown.
 *
 * @param {string} themeId - The theme identifier to switch to.
 * @returns {string} JavaScript code string.
 */
export function switchTheme(themeId) {
  if (typeof themeId !== 'string' || themeId.trim() === '') {
    throw new TypeError('switchTheme: themeId must be a non-empty string');
  }
  const safeId = themeId.replace(/[^a-zA-Z0-9_-]/g, '');

  return `((tid)=>{
    const root=document.documentElement;
    const prefix='${THEME_CLASS_PREFIX}';
    const all=Array.from(root.classList);
    for(const c of all){if(c.startsWith(prefix)) root.classList.remove(c);}
    if(tid!=='native') root.classList.add(prefix+tid);
    const items=document.querySelectorAll('#${SWITCHER_DOM_ID} .as-theme-item');
    for(const item of items){
      item.classList.toggle('as-active', item.dataset.themeId===tid);
    }
  })('${safeId}')`;
}

// ---------------------------------------------------------------------------
// Persistence JS snippets
// ---------------------------------------------------------------------------

/**
 * Generate the JavaScript code that persists the chosen theme to localStorage.
 *
 * @param {string} themeId - The theme identifier to store.
 * @returns {string} JavaScript code string.
 */
export function persistTheme(themeId) {
  if (typeof themeId !== 'string' || themeId.trim() === '') {
    throw new TypeError('persistTheme: themeId must be a non-empty string');
  }
  const safeId = themeId.replace(/[^a-zA-Z0-9_-]/g, '');

  return `(()=>{
    try{
      const data={themeId:'${safeId}',timestamp:Date.now()};
      localStorage.setItem('${THEME_PREFERENCE_KEY}', JSON.stringify(data));
    }catch(_){/* localStorage may be unavailable in some contexts */}
  })()`;
}

/**
 * Generate the JavaScript code that reads the persisted theme from localStorage.
 *
 * @returns {string} JavaScript code string that returns the themeId or "native".
 */
export function getPersistedTheme() {
  return `(()=>{
    try{
      const raw=localStorage.getItem('${THEME_PREFERENCE_KEY}');
      if(!raw) return 'native';
      const data=JSON.parse(raw);
      return (data && typeof data.themeId==='string') ? data.themeId : 'native';
    }catch(_){return 'native'}
  })()`;
}

// ---------------------------------------------------------------------------
// Full injection script
// ---------------------------------------------------------------------------

/**
 * Build the complete self-contained injection script.
 *
 * Combines menu HTML, theme CSS, and JavaScript into a single string that
 * can be evaluated via CDP `Runtime.evaluate`. The script:
 *   1. Checks for existing injection (idempotent — skips if already present).
 *   2. Injects CSS into <head>.
 *   3. Injects menu HTML into <body>.
 *   4. Binds click handlers for theme switching.
 *   5. Restores the persisted theme (if any).
 *
 * @param {ThemeDefinition[]} themes - Available themes.
 * @param {object} [options]
 * @param {string} [options.agentId] - Optional adapter identifier for scoping.
 * @returns {string} Complete JavaScript injection script.
 */
export function buildInjectionScript(themes, _options = {}) {
  if (!Array.isArray(themes)) {
    throw new TypeError('buildInjectionScript: themes must be an array');
  }
  const menuHtml = createSwitcherMenu(themes);
  const themeCss = generateThemeCss(themes);

  return `(()=>{
  // --- Guard: skip if already injected ---
  if(document.getElementById('${SWITCHER_DOM_ID}')) return 'already-injected';

  // --- Inject CSS ---
  const style=document.createElement('style');
  style.id='${SWITCHER_DOM_ID}-style';
  style.textContent=${JSON.stringify(themeCss)};
  document.head.appendChild(style);

  // --- Inject menu HTML ---
  const wrapper=document.createElement('div');
  wrapper.innerHTML=${JSON.stringify(menuHtml)};
  document.body.appendChild(wrapper.firstElementChild);

  // --- Event binding ---
  const root=document.getElementById('${SWITCHER_DOM_ID}');
  const btn=root.querySelector('.as-theme-btn');
  const dropdown=root.querySelector('.as-theme-dropdown');

  btn.addEventListener('click',(e)=>{
    e.stopPropagation();
    dropdown.style.display = dropdown.style.display==='none' ? 'block' : 'none';
  });

  document.addEventListener('click',()=>{
    dropdown.style.display='none';
  });

  dropdown.addEventListener('click',(e)=>{
    const item=e.target.closest('.as-theme-item');
    if(!item) return;
    const tid=item.dataset.themeId;
    if(!tid) return;
    // Switch theme class on <html>
    const prefix='${THEME_CLASS_PREFIX}';
    const all=Array.from(document.documentElement.classList);
    for(const c of all){if(c.startsWith(prefix)) document.documentElement.classList.remove(c);}
    if(tid!=='native') document.documentElement.classList.add(prefix+tid);
    // Update active indicator
    for(const el of dropdown.querySelectorAll('.as-theme-item')){
      el.classList.toggle('as-active', el.dataset.themeId===tid);
    }
    // Persist
    try{
      localStorage.setItem('${THEME_PREFERENCE_KEY}', JSON.stringify({themeId:tid,timestamp:Date.now()}));
    }catch(_){}
    // Close dropdown
    dropdown.style.display='none';
  });

  // --- Restore persisted theme ---
  try{
    const raw=localStorage.getItem('${THEME_PREFERENCE_KEY}');
    if(raw){
      const data=JSON.parse(raw);
      if(data && typeof data.themeId==='string'){
        const tid=data.themeId;
        const prefix='${THEME_CLASS_PREFIX}';
        if(tid!=='native') document.documentElement.classList.add(prefix+tid);
        for(const el of dropdown.querySelectorAll('.as-theme-item')){
          el.classList.toggle('as-active', el.dataset.themeId===tid);
        }
      }
    }
  }catch(_){}

  return 'injected';
})()`;
}

/**
 * Generate a CDP Runtime.evaluate payload for injecting the theme switcher.
 *
 * This convenience function wraps buildInjectionScript into the shape
 * expected by CDP clients (e.g. the agent-state-engine).
 *
 * @param {ThemeDefinition[]} themes - Available themes.
 * @param {object} [options]
 * @param {string} [options.agentId] - Optional adapter identifier.
 * @returns {{ method: string, params: { expression: string, returnByValue: boolean } }}}
 */
export function injectMenu(themes, options = {}) {
  if (!Array.isArray(themes)) {
    throw new TypeError('injectMenu: themes must be an array');
  }
  const script = buildInjectionScript(themes, options);
  return {
    method: 'Runtime.evaluate',
    params: {
      expression: script,
      returnByValue: true,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Escape a string for safe use as HTML text content.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escape a string for safe use as an HTML attribute value.
 * @param {string} str
 * @returns {string}
 */
function escapeHtmlAttr(str) {
  return escapeHtml(str);
}

export default {
  THEME_PREFERENCE_KEY,
  SWITCHER_DOM_ID,
  THEME_CLASS_PREFIX,
  SWITCHER_Z_INDEX,
  createSwitcherMenu,
  generateThemeCss,
  switchTheme,
  persistTheme,
  getPersistedTheme,
  buildInjectionScript,
  injectMenu,
};
