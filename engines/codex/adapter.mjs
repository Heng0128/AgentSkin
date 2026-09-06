// SPDX-License-Identifier: MPL-2.0
/**
 * ENGINE: codex — thin wrapper
 * ------------------------------------------------------------
 * Runs inside the OpenAI Codex (ChatGPT desktop app) renderer via CDP
 * Runtime.evaluate.  Codex is an Electron app using an `app://` renderer
 * scheme with extreme CSP (default-src 'none' + sha256 hashes).
 *
 * This is now a config-driven thin wrapper that:
 *   1. Loads window.__agentskin_codex_config__ (set by adapter-config.mjs)
 *   2. Calls createAdapter via window.__agentskin_shared_engine__ (backward-compat alias)
 *   3. Invokes adapter.apply()
 *   4. Post-apply CSP degradation: if adoptedStyleSheets was blocked,
 *      extract CSS from the shared engine's sheet and inject via
 *      style-element fallback (codex CSP degradation chain).
 *
 * Codex-specific logic CSP degradation lives in adapter-config.mjs
 * (sheetToCss, cspFallbackInject, onReinject).  The thin wrapper only
 * performs the initial adoption-failure detection.
 *
 * Usage: injected as a JS expression string via CDP Runtime.evaluate.
 * unified engine is concatenated ahead of adapter-config.mjs by orchestrator.
 */

(() => {
  'use strict';

  const MARKER = '__agentskin_codex_adapter__';
  if (window[MARKER]) return 'already-applied';

  const HOST_CLASS = 'agentskin-host-codex';

  // Ensure the shared engine is loaded.  The orchestrator concatenates
  // adapter-engine.mjs before this file; if missing, silently skip.
  const engine = window.__agentskin_shared_engine__;
  if (!engine || typeof engine.createAdapter !== 'function') {
    console.warn('[AgentSkin] codex-adapter: shared engine not loaded, skipping');
    return 'no-engine';
  }

  const config = window.__agentskin_codex_config__;
  if (!config) {
    console.warn('[AgentSkin] codex-adapter: config not present, skipping');
    return 'no-config';
  }

  // Adopt the shared sheet manager so that host-initiated
  // adoptedStyleSheets replacement does not drop our adapter layer.
  try { window.__agentskin_sheet_manager__?.install?.(); } catch {}

  const adapter = engine.createAdapter(config);
  adapter.apply();

  // CSP degradation: verify the adapter sheet was actually adopted.
  // Codex's strict CSP may silently block adoptedStyleSheets assignment.
  try {
    const markerState = window[MARKER];
    const adapterSheet = markerState && markerState.sheet;
    if (adapterSheet) {
      const adopted = document.adoptedStyleSheets;
      const isAdopted = adopted && Array.prototype.indexOf.call(adopted, adapterSheet) !== -1;
      if (!isAdopted && typeof config.cspFallbackInject === 'function') {
        console.info('[codex-adapter] adoptedStyleSheets blocked, degrading to style-element');
        config.cspFallbackInject(adapterSheet);
      }
    }
  } catch (_) { /* silent — degradation is best-effort */ }

  return 'applied';
})();
