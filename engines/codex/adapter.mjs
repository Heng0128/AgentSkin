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
 * Art analysis (upstream Codex-Dream-Skin parity): after apply, the hero
 * blob is sampled through a 96px canvas to derive the safe-area direction
 * (which half of the art carries the subject). The result is written to
 * <html data-agentskin-art-safe> + --ag-art-focus-x/y, which the cosmetic
 * scrim rules consume to mirror the readability shade. Canvas drawImage on
 * a same-origin blob: URL works under Codex's CSP (upstream runs the same
 * pipeline in-renderer); custom-scheme URLs may taint the canvas — that
 * path degrades silently to the CSS default (safe side left).
 *
 * Usage: injected as a JS expression string via CDP Runtime.evaluate.
 * unified engine is concatenated ahead of adapter-config.mjs by orchestrator.
 */

(() => {
  'use strict';

  // ── Art safe-area analysis ──────────────────────────────────────────
  // Ported from upstream Codex-Dream-Skin renderer-inject.js analyzeArt():
  // downsample the hero to a 96px canvas, compare per-half luminance,
  // classify left/right/center. Mirrors image-analyzer.ts inferSafeArea
  // semantics (|left - right| < 0.02 → center) but runs renderer-side so
  // the main-process apply path stays untouched. Async, best-effort — a
  // failed analysis leaves the CSS default (left) intact.
  const analyzeArtSafeArea = () => {
    if (typeof window.Image !== 'function' || !document?.createElement) return;
    const root = document.documentElement;
    if (!root) return;

    let url = '';
    try {
      const raw = getComputedStyle(root).getPropertyValue('--agentskin-art').trim();
      const m = raw.match(/url\(["']?(blob:[^"')]+)["']?\)/i);
      if (m) url = m[1];
    } catch (_) { return; }
    if (!url) return; // custom-scheme or none → keep CSS default

    let settled = false;
    const finish = (safe) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!safe || window[MARKER] === undefined) return;
      root.setAttribute('data-agentskin-art-safe', safe);
      // Focus sits opposite the reading side so the subject stays visible.
      const focusX = safe === 'left' ? '0.72' : safe === 'right' ? '0.28' : '0.5';
      root.style.setProperty('--ag-art-focus-x', focusX);
      root.style.setProperty('--ag-art-focus-y', '0.5');
    };
    const timer = setTimeout(() => finish(null), 6000);

    const image = new window.Image();
    image.onerror = () => finish(null);
    image.onload = () => {
      try {
        const ratio = image.naturalWidth / image.naturalHeight;
        if (!Number.isFinite(ratio) || ratio <= 0) return finish(null);
        // Aspect metadata (upstream parity thresholds): wide >= 1.75,
        // ultrawide >= 2.25. data-agentskin-art-wide gates the cosmetic
        // immersive mode (art painted on body + fixed attachment); the
        // aspect attribute is diagnostics-only.
        if (window[MARKER] !== undefined) {
          root.setAttribute('data-agentskin-art-wide', String(ratio >= 1.75));
          root.setAttribute(
            'data-agentskin-art-aspect',
            ratio >= 2.25 ? 'ultrawide' : ratio >= 1.45 ? 'wide' : 'standard',
          );
        }
        const maxDimension = 96;
        const width = Math.max(16, Math.round(ratio >= 1 ? maxDimension : maxDimension * ratio));
        const height = Math.max(16, Math.round(ratio >= 1 ? maxDimension / ratio : maxDimension));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return finish(null);
        context.drawImage(image, 0, 0, width, height);
        const data = context.getImageData(0, 0, width, height).data; // may throw on tainted canvas

        const halfLuminance = (x0, x1) => {
          let total = 0;
          let count = 0;
          for (let y = 0; y < height; y++) {
            for (let x = x0; x < x1; x++) {
              const offset = (y * width + x) * 4;
              if (data[offset + 3] < 32) continue;
              total += (0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]) / 255;
              count += 1;
            }
          }
          return count > 0 ? total / count : 0.5;
        };
        const midX = Math.floor(width / 2);
        const left = halfLuminance(0, midX);
        const right = halfLuminance(midX, width);
        if (Math.abs(left - right) < 0.02) return finish('center');
        // The subject is the denser half; the safe reading side is the
        // opposite one. Upstream semantics: safeArea names the side the
        // text sits on — i.e. the quieter half.
        finish(left < right ? 'left' : 'right');
      } catch (_) {
        finish(null); // tainted canvas / SecurityError
      }
    };
    image.src = url;
  };

  // ── Shell appearance signal ─────────────────────────────────────────
  // Upstream Codex-Dream-Skin parity: native dropdowns/scrollbars resolve
  // from Codex's own appearanceTheme, which can disagree with the injected
  // theme (their #233). We derive the shell from the THEME's surface
  // brightness — fallback chain: electron-dark/light class → OS preference —
  // then write <html data-agentskin-shell> + color-scheme so native controls
  // follow the skin. Self-terminating: when the host class disappears
  // (atomic clear / theme removal) the observer fires once more, removes the
  // residue, and disconnects.
  const installShellAppearanceWatch = () => {
    const existing = window.__agentskin_codex_shell_watch__;
    if (existing) {
      try { existing.apply(); } catch (_) { /* re-inject refresh is best-effort */ }
      return;
    }
    const root = document.documentElement;
    if (!root || typeof MutationObserver !== 'function') return;

    const parseColorToRgb = (value) => {
      const v = String(value || '').trim();
      let m = /^#([0-9a-f]{3,8})$/i.exec(v);
      if (m) {
        let hex = m[1];
        if (hex.length === 3 || hex.length === 4) {
          hex = hex.split('').map((c) => c + c).join('');
        }
        return {
          r: Number.parseInt(hex.slice(0, 2), 16) / 255,
          g: Number.parseInt(hex.slice(2, 4), 16) / 255,
          b: Number.parseInt(hex.slice(4, 6), 16) / 255,
        };
      }
      m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(v);
      if (m) return { r: Number(m[1]) / 255, g: Number(m[2]) / 255, b: Number(m[3]) / 255 };
      return null;
    };

    const apply = () => {
      // Host class gone → theme was cleared: remove residue and stop watching.
      if (!root.classList.contains('agentskin-host-codex')) {
        root.removeAttribute('data-agentskin-shell');
        try { root.style.removeProperty('color-scheme'); } catch (_) {}
        const watch = window.__agentskin_codex_shell_watch__;
        if (watch) watch.disconnect();
        return;
      }
      let shell = null;
      // 1) Theme brightness decides (native controls follow the skin).
      try {
        const rgb = parseColorToRgb(getComputedStyle(root).getPropertyValue('--agentskin-surface'));
        if (rgb) {
          const luminance = 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b;
          shell = luminance < 0.5 ? 'dark' : 'light';
        }
      } catch (_) { /* fall through */ }
      // 2) Codex's own appearance class, then OS preference.
      if (!shell) {
        if (root.classList.contains('electron-dark')) shell = 'dark';
        else if (root.classList.contains('electron-light')) shell = 'light';
        else {
          try {
            shell = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
          } catch (_) { return; }
        }
      }
      if (root.getAttribute('data-agentskin-shell') === shell) return;
      root.setAttribute('data-agentskin-shell', shell);
      try { root.style.setProperty('color-scheme', shell, 'important'); } catch (_) {}
    };

    const observer = new MutationObserver(apply);
    observer.observe(root, { attributes: true, attributeFilter: ['class'] });
    let mediaQuery = null;
    try {
      mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      mediaQuery.addEventListener?.('change', apply);
    } catch (_) { /* older matchMedia */ }
    window.__agentskin_codex_shell_watch__ = {
      apply,
      disconnect: () => {
        observer.disconnect();
        try { mediaQuery?.removeEventListener?.('change', apply); } catch (_) {}
        delete window.__agentskin_codex_shell_watch__;
      },
    };
    apply();
  };

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

  // Art safe-area analysis (upstream parity): derive which half of the hero
  // carries the subject and mirror the cosmetic scrim accordingly. Async,
  // best-effort — a failed analysis leaves the CSS default (left) intact.
  try { analyzeArtSafeArea(); } catch (_) { /* silent */ }

  // Shell appearance signal (upstream parity): theme brightness →
  // data-agentskin-shell + color-scheme, with change watchers installed.
  try { installShellAppearanceWatch(); } catch (_) { /* silent */ }

  return 'applied';
})();
