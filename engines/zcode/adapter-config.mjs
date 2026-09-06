// SPDX-License-Identifier: MPL-2.0
/**
 * ZCODE Adapter Configuration
 * ------------------------------------------------------------
 * Config object consumed by the shared adapter engine
 * (engines/shared/adapter-engine.mjs).  Exposes app-specific
 * selectors, structural CSS, token overrides, geometry-based
 * sidebar/composer detection, and DeepCore settings.
 *
 * Loaded by the orchestrator BEFORE adapter.mjs and AFTER the
 * shared engine defines window.__agentskin_shared_engine__.
 */

(() => {
  'use strict';

  const HOST_CLASS = 'agentskin-host-zcode';
  const MARKER = '__agentskin_zcode_adapter__';
  const SIDEBAR_ATTR = 'data-agentskin-sidebar';
  const COMPOSER_ATTR = 'data-agentskin-composer';

  // ═══════════════════════════════════════════════════════════
  // Geometry-based sidebar / composer detection (CV-06/CV-07)
  // Unlike other adapters, zcode cannot rely on stable class
  // names or data-testid attributes — it ships a packaged
  // Electron build with hashed CSS modules.  Instead, we probe
  // element geometry and semantic hints at runtime.
  // ═══════════════════════════════════════════════════════════

  function findSidebar() {
    // Strategy 0 (P1-02 fix): probe-verified exact anchor
    const probe = document.querySelector('[data-workspace-sidebar-panel="true"]');
    if (probe) return probe;
    // Strategy 1: <aside> or <nav> on the left with sidebar-like geometry
    const candidate = document.querySelector('aside[role="navigation"], aside, nav');
    if (candidate) {
      const rect = candidate.getBoundingClientRect();
      if (rect.left < 60 && rect.width < 400 && rect.height > 300) return candidate;
    }
    return null;
  }

  function findComposer() {
    // Strategy 1: contenteditable or textarea → walk up to enclosing container
    const editable = document.querySelector('[contenteditable="true"]')
      || document.querySelector('textarea');
    if (editable) {
      let el = editable.parentElement;
      for (let i = 0; i < 6 && el; i++) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 300 && rect.height > 60 && rect.height < 300) return el;
        el = el.parentElement;
      }
    }
    // Strategy 2: form containing a textarea
    const textarea = document.querySelector('textarea');
    if (textarea) {
      const form = textarea.closest('form');
      if (form) return form;
    }
    return null;
  }

  function applySemanticAnchors() {
    const sidebar = findSidebar();
    if (sidebar) { try { sidebar.setAttribute(SIDEBAR_ATTR, ''); } catch {} }
    const composer = findComposer();
    if (composer) { try { composer.setAttribute(COMPOSER_ATTR, ''); } catch {} }
  }

  // ═══════════════════════════════════════════════════════════
  // Element-level heuristic guards
  // Matches by role, tag, class-name pattern, or inline style —
  // needed for dynamically-added elements (PDF viewer / KaTeX)
  // that the host renders with opaque inline styles.
  // ═══════════════════════════════════════════════════════════

  function applyHeuristicOverride(el) {
    if (!el || !(el instanceof Element)) return;
    const cls = typeof el.className === 'string' ? el.className : '';
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    const role = el.getAttribute('role') || '';

    if (['dialog', 'menu', 'tooltip', 'listbox'].includes(role)) {
      el.style.setProperty('background', 'color-mix(in srgb, var(--agentskin-surface-elevated) 94%, transparent)', 'important');
      el.style.setProperty('border', 'none', 'important');
      return;
    }
    if (tag === 'nav' || tag === 'aside' || /sidebar/i.test(cls) || el.hasAttribute(SIDEBAR_ATTR)) {
      el.style.setProperty('background', 'var(--sidebar-bg, color-mix(in srgb, color-mix(in srgb, var(--agentskin-surface) 82%, var(--agentskin-accent) 18%) 22%, transparent))', 'important');
      el.style.setProperty('border-right', 'none', 'important');
      return;
    }
    if (el.hasAttribute('contenteditable') || tag === 'textarea' || role === 'textbox' || /composer/i.test(cls) || el.hasAttribute(COMPOSER_ATTR)) {
      el.style.setProperty('background', 'var(--input-bg, color-mix(in srgb, color-mix(in srgb, var(--agentskin-surface) 82%, var(--agentskin-accent) 18%) 45%, transparent))', 'important');
      el.style.setProperty('border', '1px solid color-mix(in srgb, var(--agentskin-accent) 20%, transparent)', 'important');
      el.style.setProperty('border-radius', '14px', 'important');
      return;
    }
    if (/pdfToolbar|pdf-toolbar|toolbarViewer/i.test(cls)) {
      el.style.setProperty('background', 'color-mix(in srgb, var(--agentskin-surface) 88%, transparent)', 'important');
      el.style.setProperty('border-bottom', '1px solid var(--ag-glass-border)', 'important');
      el.style.setProperty('color', 'var(--agentskin-text)', 'important');
      return;
    }
    if (/pdfViewer|pdf-viewer/i.test(cls)) {
      el.style.setProperty('background', 'transparent', 'important');
      return;
    }
    if (/pdfSidebar|pdf-sidebar|sidebarContainer|sidebarContent/i.test(cls)) {
      el.style.setProperty('background', 'color-mix(in srgb, var(--agentskin-surface) 92%, transparent)', 'important');
      el.style.setProperty('border-right', '1px solid var(--ag-glass-border)', 'important');
      el.style.setProperty('color', 'var(--agentskin-text)', 'important');
      return;
    }
    if (/katex|math|formula/i.test(cls)) {
      el.style.setProperty('color', 'var(--agentskin-text)', 'important');
      el.style.setProperty('background', 'transparent', 'important');
      return;
    }
    const style = el.getAttribute('style') || '';
    if (/background(?:-color)?\s*:/i.test(style) && !/transparent/i.test(style)) {
      el.style.setProperty('background', 'transparent', 'important');
      el.style.setProperty('background-color', 'transparent', 'important');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Selector map — multi-version strategy with data-testid >
  // role > stable class > CSS Modules prefix.  Shared engine uses
  // route:* keys for route detection; rootContainer for progressive
  // rendering probe.
  // ═══════════════════════════════════════════════════════════

  const SELECTORS = {
    rootContainer: '#root',
    mainSurface: ':is(main, [role="main"], .main-content, [class*="main-area"])',
    sidebar: ':is(aside, [data-agentskin-sidebar], [class*="sidebar"], nav)',
    composer: ':is([contenteditable="true"], textarea, [role="textbox"], [data-agentskin-composer])',
    editor: ':is(.editor, [class*="editor"], [class*="code-area"])',
    terminal: ':is(.terminal, [class*="terminal"])',
    overlayDialog: '[role="dialog"]',
    overlayMenu: '[role="menu"]',
    overlayTooltip: '[role="tooltip"]',
    overlayListbox: '[role="listbox"]',
    pdfViewer: ':is(.pdfViewer, .pdf-viewer, [class*="pdfViewer"], [class*="pdf-viewer"])',
    katex: ':is(.katex, .katex-display, [class*="katex"])',
    'route:editor': ':is(.editor, [class*="editor"], [class*="code-area"])',
    'route:terminal': ':is(.terminal, [class*="terminal"])',
    'route:main': ':is(main, [role="main"], .main-content, [class*="main-area"])',
  };


  // ═══════════════════════════════════════════════════════════
  // Token discovery config — zcode uses Tailwind v4 --color-*
  // family.  Theme layer owns the primary overrides; this adapter
  // force-transparentizes remaining background tokens that the
  // theme layer does NOT reach (P1-04 fix with excludePatterns).
  // ═══════════════════════════════════════════════════════════

  const tokenConfig = {
    knownPrefixes: [],
    outputSelector: 'html.agentskin-host-zcode:root',
    categoryPatterns: { bg: /bg|background|container|layout|surface/ },
    valueTransforms: { bg: (v) => 'transparent' },
    bgValueFilter: (v) => (v.startsWith('#') || v.startsWith('rgb')),
    excludePatterns: /^--(color-(card|panel|sidebar|header|tab|input|button|popover|modal)|text-)/,
  };

  // ═══════════════════════════════════════════════════════════
  // DeepCore config (RFC 2026-08-20) — zcode DeepCore is enabled
  // but ships no routes/fragments; self-heal handles structural
  // preservation.  Shadow DOM piercing limited to open-only.
  // ═══════════════════════════════════════════════════════════

  const deepConfig = {
    shadowMode: "open-only",
    routes: [],
    fragments: {},
    exposedState: [],
    enabled: true,
  };

  // ═══════════════════════════════════════════════════════════
  // Config object exposed to the shared engine
  // ═══════════════════════════════════════════════════════════

  window.__agentskin_zcode_config__ = {
    agentId: 'zcode',
    hostClass: HOST_CLASS,
    marker: MARKER,
    selectors: SELECTORS,
    tokenConfig,
    deepConfig,
    intervals: { selfHeal: 2000, sheetGuard: 1500, reinjectDebounce: 100, progressiveRetry: 2000 },
    applyHeuristicOverride,
    onReinject: () => { applySemanticAnchors(); },
    onHealthCheck: (report) => {
      if (!report) return;
      const sel = SELECTORS;
      try {
        const l1Checks = [
          { key: 'rootContainer', selector: sel.rootContainer, required: true },
          { key: 'mainSurface', selector: sel.mainSurface, required: true },
        ];
        for (const check of l1Checks) {
          if (check.required && document.querySelectorAll(check.selector).length === 0) {
            report.healthy = false;
            report.issues.push(`L1 missing: ${check.key} (${check.selector})`);
          }
        }
      } catch (e) {
        report.healthy = false;
        report.issues.push('health-check error: ' + e.message);
      }
      if (!report.healthy) console.warn('[zcode-adapter] health check:', report);
    },
  };

  // Apply semantic anchors immediately so the host DOM is tagged
  // BEFORE the shared engine adopts the structural stylesheet.
  applySemanticAnchors();
})();
