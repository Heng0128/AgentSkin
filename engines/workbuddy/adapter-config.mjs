// SPDX-License-Identifier: MPL-2.0
/**
 * WORKBUDDY Adapter Configuration
 * ------------------------------------------------------------
 * Config object consumed by the shared adapter engine
 * (engines/shared/adapter-engine.mjs).  Exposes workbuddy-specific
 * selectors, structural CSS, token overrides, geometry-based
 * positioning, and SW protection hooks.
 *
 * Loaded by the orchestrator BEFORE adapter.mjs and AFTER the
 * shared engine defines window.__agentskin_shared_engine__.
 *
 * WorkBuddy-specific logic preserved here:
 *   - Service Worker cache-busting (clearSWCaches)
 *   - localStorage theme-aware wrapping (initThemeStorageAwareness)
 *   - Geometry-based input/sidebar detection (findInputContainer/findSidebar)
 *   - workbuddy-specific selectors (CSS Modules prefix patterns)
 */

(() => {
  'use strict';

  const HOST_CLASS = 'agentskin-host-workbuddy';
  const MARKER = '__agentskin_workbuddy_adapter__';

  // ═══════════════════════════════════════════════════════════
  // PWA SERVICE WORKER 缓存击穿防护
  // ═══════════════════════════════════════════════════════════

  async function clearSWCaches() {
    try {
      const cacheNames = await caches.keys();
      const wbCaches = cacheNames.filter(name =>
        name.startsWith('workbox-') || name.includes('workbox') || name.includes('precache')
      );
      await Promise.all(wbCaches.map(name => caches.delete(name)));
    } catch (e) {
      // 静默降级
    }
  }

  function initThemeStorageAwareness() {
    const themeKeyPatterns = [
      /theme/i, /dark/i, /light/i, /appearance/i, /color-scheme/i,
      /workbuddy/i, /wb-/, /cb-/, /codebuddy/i,
    ];
    const themeKeys = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && themeKeyPatterns.some(p => p.test(key))) themeKeys.push(key);
      }
    } catch (e) { /* localStorage 不可用时静默降级 */ }
    if (themeKeys.length === 0) return;

    const themeSnapshots = {};
    for (const key of themeKeys) {
      try { themeSnapshots[key] = localStorage.getItem(key); } catch {}
    }

    window.addEventListener('storage', (e) => {
      if (e.key && themeKeys.includes(e.key) && e.newValue !== themeSnapshots[e.key]) {
        themeSnapshots[e.key] = e.newValue;
        if (typeof window.__agentskin_workbuddy_force_reinject === 'function') {
          window.__agentskin_workbuddy_force_reinject();
        }
      }
    });

    const originalSetItem = localStorage.setItem;
    if (!originalSetItem.__agentskin_patched) {
      localStorage.setItem = function (key, value) {
        const result = originalSetItem.call(this, key, value);
        if (themeKeys.includes(key) && value !== themeSnapshots[key]) {
          themeSnapshots[key] = value;
          if (typeof window.__agentskin_workbuddy_force_reinject === 'function') {
            window.__agentskin_workbuddy_force_reinject();
          }
        }
        return result;
      };
      localStorage.setItem.__agentskin_patched = true;
    }
  }

  function initSWProtection() {
    if (navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (typeof window.__agentskin_workbuddy_force_reinject === 'function') {
          window.__agentskin_workbuddy_force_reinject();
        }
      });

      const originalRegister = navigator.serviceWorker.register;
      if (originalRegister && !originalRegister.__agentskin_patched) {
        navigator.serviceWorker.register = function (...args) {
          return originalRegister.apply(this, args).then((registration) => {
            if (registration.active && typeof window.__agentskin_workbuddy_force_reinject === 'function') {
              window.__agentskin_workbuddy_force_reinject();
            }
            return registration;
          }).catch((err) => {
            console.warn('[AgentSkin] SW register intercepted:', err);
            throw err;
          });
        };
        navigator.serviceWorker.register.__agentskin_patched = true;
      }
    }

    if (window.caches) clearSWCaches();
    initThemeStorageAwareness();
  }

  // ═══════════════════════════════════════════════════════════
  // GEOMETRY-BASED POSITIONING (CV-06/CV-07)
  // ═══════════════════════════════════════════════════════════

  function findInputContainer() {
    const editable = document.querySelector('[contenteditable="true"]')
      || document.querySelector('textarea');
    if (editable) {
      let el = editable.parentElement;
      for (let i = 0; i < 6 && el; i++) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 300 && rect.height > 50 && rect.height < 300) return el;
        el = el.parentElement;
      }
    }
    const textbox = document.querySelector('[role="textbox"]');
    if (textbox) {
      let el = textbox.closest('form') || textbox.parentElement?.parentElement?.parentElement;
      if (el) return el;
    }
    return document.querySelector('[class*="_mainArea_"]')
      || document.querySelector('[class*="composer"]')
      || document.querySelector('[class*="chat-input"]');
  }

  function findSidebar() {
    const sidebar = document.querySelector('.conversation-sidebar, .sidebar-next');
    if (sidebar) return sidebar;
    const nav = document.querySelector('nav');
    if (nav) {
      const rect = nav.getBoundingClientRect();
      if (rect.left < 10 && rect.width < 350 && rect.height > 400) return nav;
    }
    const all = document.querySelectorAll('div, aside, section');
    for (const el of all) {
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (rect.left < 10 && rect.width > 150 && rect.width < 350 && rect.height > 400
          && (style.position === 'fixed' || style.position === 'relative' || style.position === 'absolute')) {
        return el;
      }
    }
    return null;
  }

  function applyHeuristicStyles() {
    const input = findInputContainer();
    if (input) {
      input.style.setProperty('background',
        'color-mix(in srgb, color-mix(in srgb, var(--agentskin-surface) 80%, var(--agentskin-accent) 20%) 48%, transparent)', 'important');
      input.style.setProperty('border', '1px solid color-mix(in srgb, var(--agentskin-accent) 20%, transparent)', 'important');
      input.style.setProperty('border-radius', '14px', 'important');
      input.setAttribute('data-agentskin-input', '1');
    }

    const sidebar = findSidebar();
    if (sidebar) {
      sidebar.style.setProperty('background',
        'color-mix(in srgb, var(--agentskin-surface) 12%, transparent)', 'important');
      sidebar.style.setProperty('border-right', 'none', 'important');
      sidebar.setAttribute('data-agentskin-sidebar', '1');
    }

    const mainArea = document.querySelector('.teams-main-content, .chat-container')
      || document.querySelector('main')
      || document.querySelector('[role="main"]');
    if (mainArea) {
      mainArea.style.setProperty('background', 'transparent', 'important');
      mainArea.style.setProperty('background-color', 'transparent', 'important');
    }
  }

  // ═══════════════════════════════════════════════════════════
  // ELEMENT-LEVEL HEURISTIC GUARDS
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
    if (tag === 'nav' || tag === 'aside' || /sidebar/i.test(cls)) {
      el.style.setProperty('background', 'color-mix(in srgb, var(--agentskin-surface) 12%, transparent)', 'important');
      el.style.setProperty('border-right', 'none', 'important');
      return;
    }
    if (el.hasAttribute('contenteditable') || tag === 'textarea' || role === 'textbox' || /composer|main-area/i.test(cls)) {
      el.style.setProperty('background', 'color-mix(in srgb, color-mix(in srgb, var(--agentskin-surface) 80%, var(--agentskin-accent) 20%) 48%, transparent)', 'important');
      el.style.setProperty('border', '1px solid color-mix(in srgb, var(--agentskin-accent) 20%, transparent)', 'important');
      el.style.setProperty('border-radius', '14px', 'important');
      return;
    }
    el.style.setProperty('background', 'transparent', 'important');
    el.style.setProperty('background-color', 'transparent', 'important');
  }

  // ═══════════════════════════════════════════════════════════
  // SELECTORS — workbuddy-specific CSS Modules prefix patterns
  // ═══════════════════════════════════════════════════════════

  const SELECTORS = {
    rootContainer: '#root',
    gridViewItem: ':is([class*="_gridViewItem_"], [class*="_gridView_"] > div > div)',
    mainArea: ':is([class*="_mainArea_"], .teams-main-content, .chat-container, main, [role="main"])',
    sidebar: ':is(.conversation-sidebar, .sidebar-next, aside, nav)',
    composer: ':is([contenteditable="true"], textarea, [role="textbox"]),',
    conversationList: ':is(.conversation-list, .chat-container, .wb-cb-chat, .chat-main, .message-list, .main-content, .main-content--welcome)',
    dropdown: ':is([class*="_dropdownRoot_"], [class*="_dropdown_"][class*="view-selector"])',
    overlayDialog: '[role="dialog"]',
    overlayMenu: '[role="menu"]',
    'route:grid-view': ':is([class*="_gridViewItem_"])',
    'route:main-view': ':is([class*="_mainArea_"], .teams-main-content, .chat-container)',
  };

  // ═══════════════════════════════════════════════════════════
  // TOKEN DISCOVERY CONFIG — workbuddy uses --cb- / --wb- prefixes
  // ═══════════════════════════════════════════════════════════

  const tokenConfig = {
    knownPrefixes: ['--cb-', '--wb-'],
    excludeSuffix: '-raw',
    outputSelector: 'html.agentskin-host-workbuddy body',
  };

  // ═══════════════════════════════════════════════════════════
  // DEEPCORE CONFIG (RFC 2026-08-20) — open-only shadow mode
  // ═══════════════════════════════════════════════════════════

  const deepConfig = {
    shadowMode: "open-only",
    routes: [],
    fragments: {},
    exposedState: [],
    enabled: true,
  };

  // ═══════════════════════════════════════════════════════════
  // ONE-TIME INIT: SW protection + initial heuristic styles
  // ═══════════════════════════════════════════════════════════

  initSWProtection();
  applyHeuristicStyles();

  // ═══════════════════════════════════════════════════════════
  // CONFIG OBJECT — exposed to the shared engine
  // ═══════════════════════════════════════════════════════════

  window.__agentskin_workbuddy_config__ = {
    agentId: 'workbuddy',
    hostClass: HOST_CLASS,
    marker: MARKER,
    selectors: SELECTORS,
    tokenConfig,
    deepConfig,
    intervals: { selfHeal: 2000, sheetGuard: 1500, reinjectDebounce: 100, progressiveRetry: 2000 },
    applyHeuristicOverride,
    onReinject: () => { applyHeuristicStyles(); },
    onHealthCheck: (report) => {
      if (!report) return;
      try {
        const l1Checks = [
          { key: 'rootContainer', selector: SELECTORS.rootContainer, required: true },
          { key: 'mainArea', selector: SELECTORS.mainArea, required: true },
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
      if (!report.healthy) console.warn('[workbuddy-adapter] health check:', report);
    },
  };
})();
