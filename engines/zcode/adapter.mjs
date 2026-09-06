// SPDX-License-Identifier: MPL-2.0
/**
 * ENGINE: zcode — Layer 1: Structural Adaptation
 * ------------------------------------------------------------
 * Runs inside the ZCode desktop app renderer via CDP
 * Runtime.evaluate. ZCode is a packaged Electron app
 * (@zcode/desktop, v3.6.5+) whose renderer is a local Vite/React
 * build served via file:// and rooted at `#root`.
 *
 * Phase 2 pilot — config-driven adapter built on top of the
 * unified engine (engines/unified/engine.mjs).  The engine
 * handles the full lifecycle: sheet injection, self-heal, DeepCore
 * bootstrap, progressive rendering, route awareness, and health
 * checks.  This file is now a thin wrapper that:
 *
 *   1. Loads window.__agentskin_zcode_config__ (set by adapter-config.mjs)
 *   2. Calls createAdapter via window.__agentskin_shared_engine__ (backward-compat alias)
 *   3. Invokes adapter.apply()
 *
 * Zcode-specific logic that CANNOT be expressed as config selectors:
 *   - Geometry-based sidebar/composer detection (findSidebar/findComposer)
 *   - PDF.js / KaTeX dynamic-element heuristic guards
 *
 * These live in adapter-config.mjs as the `applyHeuristicOverride`,
 * `onReinject`, and `onHealthCheck` hooks.
 *
 * Usage: injected as a JS expression string via CDP Runtime.evaluate.
 * unified engine is concatenated ahead of adapter-config.mjs by orchestrator.
 */

(() => {
  'use strict';

  const MARKER = '__agentskin_zcode_adapter__';
  if (window[MARKER]) return 'already-applied';

  const HOST_CLASS = 'agentskin-host-zcode';

  // Ensure the shared engine is loaded.  The orchestrator concatenates
  // adapter-engine.mjs before this file; if it is missing we silently
  // skip so the caller can diagnose via console.
  const engine = window.__agentskin_shared_engine__;
  if (!engine || typeof engine.createAdapter !== 'function') {
    console.warn('[AgentSkin] zcode-adapter: shared engine not loaded, skipping');
    return 'no-engine';
  }

  const config = window.__agentskin_zcode_config__;
  if (!config) {
    console.warn('[AgentSkin] zcode-adapter: config not present, skipping');
    return 'no-config';
  }

  // Adopt the shared sheet manager so that host-initiated
  // adoptedStyleSheets replacement does not drop our adapter layer.
  try { window.__agentskin_sheet_manager__?.install?.(); } catch {}

  const adapter = engine.createAdapter(config);
  adapter.apply();

  return 'applied';
})();
