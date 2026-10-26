// SPDX-License-Identifier: MPL-2.0
/**
 * ENGINE: workbuddy — Layer 1: Structural Adaptation
 * ------------------------------------------------------------
 * Runs inside the WorkBuddy desktop app renderer via CDP
 * Runtime.evaluate.
 *
 * Phase 2 — config-driven adapter built on top of the
 * unified engine (engines/unified/engine.mjs).  The engine
 * handles the full lifecycle: sheet injection, self-heal, DeepCore
 * bootstrap, progressive rendering, route awareness, and health
 * checks.  This file is now a thin wrapper that:
 *
 *   1. Loads window.__agentskin_workbuddy_config__ (set by adapter-config.mjs)
 *   2. Calls createAdapter via window.__agentskin_shared_engine__ (backward-compat alias)
 *   3. Invokes adapter.apply()
 *
 * WorkBuddy-specific logic that CANNOT be expressed as config selectors:
 *   - Service Worker cache-busting (clearSWCaches)
 *   - localStorage theme-aware wrapping (initThemeStorageAwareness)
 *   - Geometry-based input/sidebar detection (findInputContainer/findSidebar)
 *
 * These live in adapter-config.mjs.
 *
 * Usage: injected as a JS expression string via CDP Runtime.evaluate.
 * unified engine is concatenated ahead of adapter-config.mjs by orchestrator.
 */

(() => {
  'use strict';

  const MARKER = '__agentskin_workbuddy_adapter__';
  if (window[MARKER]) return 'already-applied';

  // Ensure the shared engine is loaded.  The orchestrator concatenates
  // adapter-engine.mjs before this file; if it is missing we silently
  // skip so the caller can diagnose via console.
  const engine = window.__agentskin_shared_engine__;
  if (!engine || typeof engine.createAdapter !== 'function') {
    console.warn('[AgentSkin] workbuddy-adapter: shared engine not loaded, skipping');
    return 'no-engine';
  }

  const config = window.__agentskin_workbuddy_config__;
  if (!config) {
    console.warn('[AgentSkin] workbuddy-adapter: config not present, skipping');
    return 'no-config';
  }

  // Adopt the shared sheet manager so that host-initiated
  // adoptedStyleSheets replacement does not drop our adapter layer.
  try { window.__agentskin_sheet_manager__?.install?.(); } catch {}

  const adapter = engine.createAdapter(config);

  // Expose workbuddy-specific force-reinject hook for SW/theme listeners
  // that are established in adapter-config.mjs before adapter exists.
  window.__agentskin_workbuddy_force_reinject = () => { adapter.reinject(); };

  adapter.apply();

  // ── Native defect fixes (mirror of src/shared/theme/native-defect-fixes.mjs) ──
  // quick-actions-shadow: kill native side shadows on the recommendation chips
  // quick-actions-shadow-desc: kill stacked side shadows on descendants
  try {
    const ndfSheet = new CSSStyleSheet();
    ndfSheet.replaceSync(`
      .quick-actions,
      .quick-actions__list,
      [class*="quick-action"]:not(.quick-actions__item) {
        box-shadow: none !important;
        outline: none !important;
      }
      .quick-actions *,
      .quick-actions__list * {
        box-shadow: none !important;
        outline: none !important;
      }
    `);
    ndfSheet.__agentskin_layer = 'native-defect-fix';
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, ndfSheet];
  } catch {}

  // ── Marker registration (audit W5 fix, 2026-09-08) ──
  // Previously workbuddy was the ONLY adapter that never set window[MARKER]:
  // the already-applied guard above was dead code, and the restore chain
  // (injection-runtime CLEAR_ADAPTERS_BODY) had no marker to clean, so the
  // localStorage/serviceWorker monkey-patches and the patrol survived
  // restore forever. Register lifecycle handles the way doubao does.
  window[MARKER] = {
    adapter,
    storageRestore: typeof config.restoreHostPatches === 'function'
      ? config.restoreHostPatches
      : undefined,
    patrolStop() {
      try {
        if (typeof window.__agentskin_createPatrolCleanup === 'function') {
          window.__agentskin_createPatrolCleanup();
        }
      } catch {}
    },
  };

  return 'applied';
})();
