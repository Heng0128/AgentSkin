// SPDX-License-Identifier: MPL-2.0
/**
 * ENGINE: doubao — Layer 1: Structural Adaptation
 * ------------------------------------------------------------
 * Runs inside the Doubao renderer via CDP Runtime.evaluate.
 *
 * Phase 2 — config-driven adapter built on top of the
 * unified engine (engines/unified/engine.mjs).  The engine
 * handles the full lifecycle: sheet injection, self-heal, DeepCore
 * bootstrap, progressive rendering, route awareness, and health
 * checks.  This file is now a thin wrapper that:
 *
 *   1. Loads window.__agentskin_doubao_config__ (set by adapter-config.mjs)
 *   2. Calls createAdapter via window.__agentskin_shared_engine__ (backward-compat alias)
 *   3. Invokes adapter.apply()
 *
 * Doubao-specific logic that CANNOT be expressed as config selectors
 * (CDP state awareness, background-layer div recreation, dark-mode
 * token remap, Chromium warning, local-page fast-path) is exposed
 * through the config's _helpers namespace.
 *
 * Usage: injected as a JS expression string via CDP Runtime.evaluate.
 * unified engine is concatenated ahead of adapter-config.mjs by orchestrator.
 */

(() => {
  'use strict';

  const MARKER = '__agentskin_doubao_adapter__';
  if (window[MARKER]) return 'already-applied';

  const HOST_CLASS = 'agentskin-host-doubao';

  // Ensure the shared engine is loaded.
  const engine = window.__agentskin_shared_engine__;
  if (!engine || typeof engine.createAdapter !== 'function') {
    console.warn('[AgentSkin] doubao-adapter: shared engine not loaded, skipping');
    return 'no-engine';
  }

  const config = window.__agentskin_doubao_config__;
  if (!config) {
    console.warn('[AgentSkin] doubao-adapter: config not present, skipping');
    return 'no-config';
  }

  const H = config._helpers;

  // ── CDP connection state awareness ──
  const cdpState = H.buildCdpState();

  // ── Page-type detection (local pages get fast-path) ──
  const pageType = H.detectPageType();
  const isLocalPage = pageType === 'local';
  if (isLocalPage) {
    document.documentElement.classList.add(H.HOST_CLASS);
    if (H.isDarkModePreferred()) {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(H.buildDarkModeCss());
      sheet.__agentskin_layer = 'adapter-local';
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    }
    window[MARKER] = { cdpState, pageType, localOnly: true };
    return 'applied-local';
  }

  // ── Chromium version warning ──
  const chromiumVersion = H.warnChromiumVersion();

  // ── Adopt shared sheet manager ──
  try { window.__agentskin_sheet_manager__?.install?.(); } catch {}

  // ── Dark-mode token remap (separate adopted sheet) ──
  if (H.isDarkModePreferred()) {
    try {
      const dmSheet = new CSSStyleSheet();
      dmSheet.replaceSync(H.buildDarkModeCss());
      dmSheet.__agentskin = true;
      dmSheet.__agentskin_layer = 'dark-mode';
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, dmSheet];
    } catch {}
  }

  // ── Native defect fixes (mirror of src/shared/theme/native-defect-fixes.mjs) ──
  // suggest-cards-shadow: kill native shadow/border effects on suggestion & topic cards
  // suggest-cards-shadow-desc: kill stacked shadow/blur/border on suggested-card children
  try {
    const ndfSheet = new CSSStyleSheet();
    ndfSheet.replaceSync(`
      [class*="suggest"],
      [class*="recommend"],
      [class*="topic"] {
        outline: none !important;
        box-shadow: none !important;
        border-image: none !important;
      }
      [class*="suggest"] *,
      [class*="recommend"] *,
      [class*="topic"] * {
        border-color: transparent !important;
        outline: none !important;
        box-shadow: none !important;
        backdrop-filter: none !important;
      }
    `);
    ndfSheet.__agentskin_layer = 'native-defect-fix';
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, ndfSheet];
  } catch {}

  // ── Create adapter via shared engine ──
  const adapter = engine.createAdapter(config);
  adapter.apply();

  // ── Background layer div recreation + bgObserver ──
  // APP-SPECIFIC: watches Doubao data-theme resets (not injected CSS)
  H.createBackgroundLayer();
  const bgObs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type !== 'attributes' || m.attributeName !== 'style' || m.target !== document.body) continue;
      const body = document.body;
      const bgImg = body.style.backgroundImage;
      const bgColor = body.style.backgroundColor;
      if (bgImg === '' || bgImg === 'none' || bgColor === '' || bgColor === 'transparent') {
        if (!document.querySelector(`div.${H.BG_LAYER_CLASS}`)) { H.removeBackgroundLayer(); H.createBackgroundLayer(); }
      }
    }
  });
  if (document.body) bgObs.observe(document.body, { attributes: true, attributeFilter: ['style'] });

  // ── Selector health check (delayed) ──
  setTimeout(() => {
    const health = H.checkSelectorHealth();
    if (!health.healthy) console.warn('[doubao-adapter] Selector health check:', health);
  }, 3000);

  window[MARKER] = { adapter, bgObserver: bgObs, cdpState, pageType, chromiumVersion };
  return 'applied';
})();
