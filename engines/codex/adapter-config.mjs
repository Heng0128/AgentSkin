// SPDX-License-Identifier: MPL-2.0
/**
 * CODEX Adapter Configuration
 * ------------------------------------------------------------
 * Config object consumed by the shared adapter engine
 * (engines/shared/adapter-engine.mjs).  Exposes OpenAI Codex-specific
 * selectors, structural CSS, token overrides, and DeepCore settings.
 *
 * Codex-specific logic that CANNOT be expressed as pure token overrides:
 *   - CSP degradation chain (adoptedStyleSheets → style element → insertRule)
 *   - Codex route detection (home / thread / settings)
 *   - Page-level background token transparency
 *
 * Loaded by the orchestrator BEFORE adapter.mjs and AFTER the shared
 * engine defines __agentskin_shared_engine__.
 */

(() => {
  'use strict';

  const HOST_CLASS = 'agentskin-host-codex';
  const MARKER = '__agentskin_codex_adapter__';

  // ═══════════════════════════════════════════════════════════
  // CSP Detection — Codex uses extreme CSP
  // default-src 'none' + sha256 hash validation
  // ═══════════════════════════════════════════════════════════
  function detectCSP() {
    const result = {
      hasCSP: false,
      styleSrc: null,
      allowsUnsafeInline: false,
      strictness: 'unknown',
      raw: '',
    };

    const cspMeta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
    if (cspMeta) {
      result.hasCSP = true;
      result.raw = cspMeta.getAttribute('content') || '';
    }

    if (result.raw) {
      const styleSrcMatch = result.raw.match(/style-src\s+([^;]*)/);
      if (styleSrcMatch) {
        const styleSrcValue = styleSrcMatch[1].trim();
        result.styleSrc = styleSrcValue;
        if (styleSrcValue.includes("'unsafe-inline'")) {
          result.allowsUnsafeInline = true;
          result.strictness = 'relaxed';
        } else if (styleSrcValue === "'none'" || styleSrcValue === 'none') {
          result.strictness = 'strict';
        } else if (styleSrcMatch[1].includes('sha256-') || styleSrcMatch[1].includes('sha384-') || styleSrcMatch[1].includes('sha512-')) {
          result.strictness = 'hash-only';
        } else if (styleSrcValue.includes("'self'")) {
          result.strictness = 'strict';
        } else {
          result.strictness = 'strict';
        }
      } else if (result.raw.includes('default-src') && (result.raw.includes("'none'") || result.raw.includes('none'))) {
        result.strictness = 'strict';
      }
    } else {
      result.strictness = 'relaxed';
    }
    return result;
  }

  // ═══════════════════════════════════════════════════════════
  // Webview container detection — Codex sandbox protocol
  // codex-sandbox://*.web-sandbox.oaiusercontent.com
  // ═══════════════════════════════════════════════════════════
  function detectWebview() {
    const result = { inWebview: false, reasons: [] };
    const ua = navigator.userAgent || '';
    if (ua.includes('Codex') || ua.includes('ChatGPT') || ua.includes('OpenAI')) {
      result.reasons.push('userAgent');
    }
    const url = location.href || '';
    if (url.startsWith('codex-sandbox://') || url.includes('web-sandbox.oaiusercontent.com')) {
      result.inWebview = true;
      result.reasons.push('sandbox-protocol');
      return result;
    }
    if (url.includes('/webview/') || url.includes('webview%2F')) {
      result.reasons.push('webview-path');
    }
    if (ua.includes('Electron') || (typeof process !== 'undefined' && process.versions && process.versions.electron)) {
      result.reasons.push('electron');
    }
    if (document.querySelector('[data-testid="home-icon"]') ||
        document.querySelector('aside.app-shell-left-panel') ||
        document.querySelector('[data-app-shell-main-surface]')) {
      result.reasons.push('codex-elements');
    }
    if (result.reasons.length >= 2) result.inWebview = true;
    return result;
  }

  const cspInfo = detectCSP();
  const webviewInfo = detectWebview();
  const injectionStrategy = (cspInfo.strictness === 'relaxed') ? 'adopted' : 'style-element';

  if (cspInfo.hasCSP) {
    console.info('[codex-adapter] CSP detected:', cspInfo.strictness, 'strategy:', injectionStrategy);
  }
  if (webviewInfo.inWebview) {
    console.info('[codex-adapter] Webview container detected:', webviewInfo.reasons.join(', '));
  }

  // ═══════════════════════════════════════════════════════════
  // Selector map — multi-version strategy with data-testid >
  // role > stable class > CSS Modules prefix
  // Contract synced with upstream Codex-Dream-Skin selectors.json
  // (2026-08-27, verified 26.715 → 26.818 dual-platform): keep legacy
  // anchors, append stable attributes / CSS-Module prefixes, never match
  // a full hash. [role=main] exists ONLY on the home route.
  // ═══════════════════════════════════════════════════════════
  const SELECTORS = {
    rootContainer: 'main:is(.main-surface, [data-app-shell-main-surface], [class*="_MainContentSurface_"])',
    shellMain: 'main:is(.main-surface, [data-app-shell-main-surface], [class*="_MainContentSurface_"])',
    leftPanel: 'aside.app-shell-left-panel',
    headerTint: 'header:is(.app-header-tint, [data-app-shell-header-edge-scroll], [class*="_Header_"])',
    mainContentTopFade: ':is(.app-shell-main-content-top-fade, [data-app-shell-main-content-top-fade], [class*="_MainContentTopFade_"])',
    homeIcon: '[data-testid="home-icon"]',
    composerChrome: ':is(.composer-surface-chrome, [class*="_ComposerLayoutRoot_"], [data-composer-surface-variant][data-composer-radius-variant])',
    composerToolbar: ':is(.composer-surface-chrome [class*="_footer_"], [class*="_ComposerLayoutRoot_"] [class*="_ComposerLayoutFooter_"], [data-composer-surface-variant][data-composer-radius-variant] :is([data-composer-footer-responsive], [class*="_ComposerLayoutFooter_"], [class*="_footer_"]))',
    homeUtility: ':is([class*="_homeUtilityBar_"], [class*="_ComposerHomeUtilityBar_"])',
    homeSuggestions: '.group\\/home-suggestions',
    markdown: '[class*="_markdown"]',
    threadSurface: '.thread-scroll-container',
    message: ':is([data-message-author-role], [data-local-conversation-user-anchor], [data-local-conversation-final-assistant])',
    overlayMenu: '[role="menu"]',
    overlayDialog: '[role="dialog"]',
    overlayTooltip: '[role="tooltip"]',
    overlayListbox: '[role="listbox"]',
    overlayPopper: '[data-radix-popper-content-wrapper]',
    'route:home': '[data-testid="home-icon"]',
    'route:thread': ':is(.thread-scroll-container, .composer-surface-chrome, [class*="_ComposerLayoutRoot_"])',
    'route:settings': '[data-settings-panel-slug="general-settings"]',
  };

  // ═══════════════════════════════════════════════════════════
  // Token config — codex page-level bg tokens for art punch-through
  // Single-layer CSS-variable architecture via Tailwind @theme
  // ═══════════════════════════════════════════════════════════
  const tokenConfig = {
    knownPrefixes: [
      '--color-token-bg-primary',
      '--color-token-bg-secondary',
      '--color-token-bg-tertiary',
      '--color-token-side-bar-background',
      '--color-token-main-surface-primary',
      '--color-token-diff-surface',
    ],
    outputSelector: 'html.agentskin-host-codex:root',
    categoryPatterns: { bg: /bg|background|side-bar|surface|diff/ },
    valueTransforms: { bg: (v) => 'transparent' },
    bgValueFilter: (v) => (v.startsWith('#') || v.startsWith('rgb')),
    excludePatterns: null,
  };

  // ═══════════════════════════════════════════════════════════
  // DeepCore config — codex route-aware fragments
  // ═══════════════════════════════════════════════════════════
  const deepConfig = {
    shadowMode: 'open-only',
    routes: [
      { id: 'composer-open', test: { selector: '[data-composer-expanded]' }, enterFragment: 'panel-composer', exitFragment: null },
    ],
    fragments: {
      'panel-composer': 'html.' + HOST_CLASS + ' ' + SELECTORS.composerChrome + ' { box-shadow: 0 0 0 2px var(--agentskin-accent) !important; }',
    },
    exposedState: [],
    enabled: true,
  };

  // ═══════════════════════════════════════════════════════════
  // CSP degradation helpers — used by thin wrapper for
  // adopt → style element → insertRule fallback chain
  // ═══════════════════════════════════════════════════════════
  let _cspStyleElement = null;
  let _cspViolationDetected = false;

  function sheetToCss(sheet) {
    if (!sheet) return '';
    try {
      const rules = sheet.cssRules;
      let css = '';
      for (let i = 0; i < rules.length; i++) css += rules[i].cssText + '\n';
      return css;
    } catch (_) { return ''; }
  }

  function cspInjectStyleElement(css) {
    try {
      if (!_cspStyleElement) {
        _cspStyleElement = document.createElement('style');
        _cspStyleElement.setAttribute('data-agentskin', 'codex-adapter');
        const head = document.head || document.documentElement;
        head.appendChild(_cspStyleElement);
      }
      _cspStyleElement.textContent = css;
      return true;
    } catch (err) {
      console.warn('[codex-adapter] Style element injection failed:', err.message);
      return false;
    }
  }

  function cspInjectViaInsertRule(css) {
    try {
      const sheets = document.styleSheets;
      let targetSheet = null;
      for (let i = 0; i < sheets.length; i++) {
        try {
          void sheets[i].cssRules;
          targetSheet = sheets[i];
          break;
        } catch (_) {
          continue;
        }
      }
      if (!targetSheet) {
        const style = document.createElement('style');
        (document.head || document.documentElement).appendChild(style);
        targetSheet = style.sheet;
      }
      const rules = css.split('}');
      for (const rule of rules) {
        const trimmed = rule.trim();
        if (trimmed) {
          try { targetSheet.insertRule(trimmed + '}', targetSheet.cssRules.length); } catch (_) { /* skip invalid rule */ }
        }
      }
      return true;
    } catch (err) {
      console.warn('[codex-adapter] insertRule injection failed:', err.message);
      return false;
    }
  }

  function cspFallbackInject(sheet) {
    const css = sheetToCss(sheet);
    if (!css) return false;
    // Level 2: style element
    if (cspInjectStyleElement(css)) return true;
    // Level 3: insertRule
    return cspInjectViaInsertRule(css);
  }

  // CSP violation listener — degrades on-the-fly if adoptedStyleSheets blocked
  function setupCSPViolationListener() {
    document.addEventListener('securitypolicyviolation', (event) => {
      const violatedDirective = event.violatedDirective || '';
      if (violatedDirective.startsWith('style')) {
        _cspViolationDetected = true;
        console.warn('[codex-adapter] CSP violation detected:', violatedDirective);
      }
    });
  }
  setupCSPViolationListener();

  // ═══════════════════════════════════════════════════════════
  // Hooks — called by shared engine during lifecycle
  // ═══════════════════════════════════════════════════════════

  // Heuristic override: per-element styling on DOM mutations.
  // Codex has no dynamic-element heuristic guards (unlike zcode's
  // PDF/KaTeX), so this is near-no-op.  Included for interface compliance.
  function applyHeuristicOverride(el) {
    if (!el || !(el instanceof Element)) return;
    // No codex-specific per-element guards needed.
  }

  // Reinject hook: in CSP fallback mode, update the <style> element
  // with fresh CSS extracted from the shared engine's sheet.
  function onReinject() {
    if (injectionStrategy === 'adopted' && !_cspViolationDetected) return;
    try {
      const markerState = window[MARKER];
      const sheet = markerState && markerState.sheet;
      if (sheet) cspFallbackInject(sheet);
    } catch (_) { /* silent */ }
  }

  // Health check: tier-graded doctor (upstream Codex-Dream-Skin selectors.json
  // semantics). Tiers mirror engines/codex/selectors.contract.json (C14):
  //   L1 missing  → 皮肤主行为受损 → report.healthy = false
  //   L2 missing  → 精修静默降级   → console.info（不阻断注入）
  // 合同中 home-icon 为 route-scoped L1，但 runtime doctor 无路由上下文且首页
  // 渐进渲染（home-icon 可晚到 1-2 秒），故此处降为 L2 观察。
  const DOCTOR_CONTRACT = [
    { key: 'shell-main', tier: 'L1', selector: SELECTORS.shellMain },
    { key: 'left-panel', tier: 'L1', selector: SELECTORS.leftPanel },
    { key: 'header-tint', tier: 'L1', selector: SELECTORS.headerTint },
    { key: 'main-content-top-fade', tier: 'L2', selector: SELECTORS.mainContentTopFade },
    { key: 'composer-root', tier: 'L2', selector: SELECTORS.composerChrome },
    { key: 'composer-footer', tier: 'L2', selector: SELECTORS.composerToolbar },
    { key: 'home-utility', tier: 'L2', selector: SELECTORS.homeUtility },
    { key: 'home-suggestions', tier: 'L2', selector: SELECTORS.homeSuggestions },
    { key: 'home-icon', tier: 'L2', selector: SELECTORS.homeIcon },
    { key: 'thread-surface', tier: 'L2', selector: SELECTORS.threadSurface },
    { key: 'markdown', tier: 'L2', selector: SELECTORS.markdown },
    { key: 'message', tier: 'L2', selector: SELECTORS.message },
    { key: 'settings-panel', tier: 'L2', selector: SELECTORS['route:settings'] },
  ];

  function onHealthCheck(report) {
    if (!report) return;
    try {
      report.degraded = [];
      for (const check of DOCTOR_CONTRACT) {
        let missing = false;
        try {
          missing = document.querySelectorAll(check.selector).length === 0;
        } catch (_) {
          continue; // invalid selector in this DOM → treat as unverifiable, not degraded
        }
        if (!missing) continue;
        if (check.tier === 'L1') {
          report.healthy = false;
          report.issues.push('L1 missing: ' + check.key + ' (' + check.selector + ')');
        } else {
          report.degraded.push(check.key);
        }
      }
      if (report.degraded.length) {
        console.info('[codex-adapter] L2 silent degradation:', report.degraded.join(', '));
      }
    } catch (e) {
      report.healthy = false;
      report.issues.push('health-check error: ' + e.message);
    }
    if (!report.healthy) console.warn('[codex-adapter] health check:', report);
  }

  // Route detected hook: log codex route changes for diagnostics
  function onRouteDetected(route) {
    // Route polling handled by shared engine; this hook for diagnostics only.
  }

  // ═══════════════════════════════════════════════════════════
  // Config assembly — exposed to shared engine
  // ═══════════════════════════════════════════════════════════
  window.__agentskin_codex_config__ = {
    agentId: 'codex',
    hostClass: HOST_CLASS,
    marker: MARKER,
    selectors: SELECTORS,
    tokenConfig,
    injection: 'adopted',
    cspFallback: true,
    heuristicRegex: { bg: /background\s*:/i },
    heuristicRoles: [],
    deepConfig,
    intervals: {
      selfHeal: 2000,
      sheetGuard: 1500,
      reinjectDebounce: 100,
      progressiveRetry: 2000,
    },
    applyHeuristicOverride,
    onReinject,
    onHealthCheck,
    onRouteDetected,
    // CSP metadata for thin wrapper
    cspInfo,
    webviewInfo,
    injectionStrategy,
    // CSP helpers for thin wrapper
    sheetToCss,
    cspFallbackInject,
    cspInjectStyleElement: () => _cspStyleElement,
  };
})();
