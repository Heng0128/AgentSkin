// SPDX-License-Identifier: MPL-2.0
/**
 * ENGINE: traework — thin wrapper
 * ------------------------------------------------------------
 * Runs inside the TRAE Work (solo-lite shell, VS Code-based) renderer via CDP
 * Runtime.evaluate.  TRAE uses a <style> element injection strategy (NOT
 * adoptedStyleSheets) and delegates self-healing to createSelfHeal.
 *
 * Config-driven thin wrapper that:
 *   1. Loads window.__agentskin_traework_config__ (set by adapter-config.mjs)
 *   2. Sets up style-element injection + host class
 *   3. Initializes token-discovery agent for icube variables
 *   4. Applies heuristic mutation observer (style/class attribute guards)
 *   5. Starts createSelfHeal for structural self-healing
 *   6. Progressive rendering probe
 *   7. DeepCore bootstrap (after self-heal)
 *   8. Delayed selector health check
 *
 * All traework-specific selectors, CSS, route detection, heuristic rules,
 * and token prefixes live in adapter-config.mjs.  This file is a pure
 * lifecycle orchestrator.
 *
 * Modifications from original:
 *   - All CSS/selectors/routes/heuristics moved to adapter-config.mjs
 *   - Style-element injection preserved (not adoptedStyleSheets)
 *   - createSelfHeal preserved (delegated, not shared-engine self-heal)
 *   - data-trae-ref anchors and body-class route detection preserved
 *
 * Usage: injected as a JS expression string via CDP Runtime.evaluate.
 * Concatenated AFTER the shared engine + adapter-config by the orchestrator.
 */

(() => {
  'use strict';

  const MARKER = '__agentskin_traework_adapter__';
  if (window[MARKER]) return 'already-applied';

  const HOST_CLASS = 'agentskin-host-traework';

  const config = window.__agentskin_traework_config__;
  if (!config) {
    console.warn('[AgentSkin] traework-adapter: config not present, skipping');
    return 'no-config';
  }

  // ═══════════════════════════════════════════════════════════
  // AdaptiveMutationObserver guard
  // ═══════════════════════════════════════════════════════════
  // Resolve ONCE: the class may live on `window` directly or under the
  // `window.__agentskin__` namespace. Reading only `window.X` at the `new`
  // site throws "is not a constructor" when the namespaced form is the one
  // installed — and at IIFE top level that throw silently kills self-heal,
  // DeepCore and progressive retries.
  const AdaptiveMutationObserverCtor =
    window.AdaptiveMutationObserver || window.__agentskin__?.AdaptiveMutationObserver;
  if (!AdaptiveMutationObserverCtor) {
    console.warn('[AgentSkin] AdaptiveMutationObserver not loaded; self-heal observer disabled');
  }

  // ═══════════════════════════════════════════════════════════
  // Sheet manager install (protects other layers' adoptedStyleSheets)
  // ═══════════════════════════════════════════════════════════
  try {
    window.__agentskin_sheet_manager__?.install?.();
  } catch (e) {
    // silent — fallback to polling if manager unavailable
  }

  // ═══════════════════════════════════════════════════════════
  // Token-discovery agent init
  // ═══════════════════════════════════════════════════════════
  const _tokenAgent = config.initTokenAgent();

  // ═══════════════════════════════════════════════════════════
  // Style-element management (injection: 'style-element')
  // ═══════════════════════════════════════════════════════════
  function buildFullCss() {
    const parts = [];
    if (config.structuralCss) parts.push(config.structuralCss);
    if (config.discoverAndOverrideTokens && _tokenAgent) {
      parts.push(config.discoverAndOverrideTokens(_tokenAgent));
    }
    return parts.filter(Boolean).join('\n');
  }

  function ensureStyleElement() {
    const id = config.styleId || 'agentskin-style';
    var style = document.getElementById(id);
    if (!style) {
      style = document.createElement('style');
      style.id = id;
      (document.head || document.documentElement).appendChild(style);
    }
    return style;
  }

  function appendToStyle(css) {
    try {
      var style = ensureStyleElement();
      style.textContent = (style.textContent || '') + '\n' + css;
    } catch {}
  }

  // ═══════════════════════════════════════════════════════════
  // Host class + initial CSS injection
  // ═══════════════════════════════════════════════════════════
  document.documentElement.classList.add(HOST_CLASS);
  appendToStyle(buildFullCss());

  // ═══════════════════════════════════════════════════════════
  // Heuristic MutationObserver — inline-style guards
  // ═══════════════════════════════════════════════════════════
  // Skip only the observer when unavailable — never the sections below.
  const observer = AdaptiveMutationObserverCtor
    ? new AdaptiveMutationObserverCtor((mutations) => {
        for (const m of mutations) {
          if (m.type === 'attributes' && (m.attributeName === 'style' || m.attributeName === 'class')) {
            if (config.matchesHeuristicRules && config.applyHeuristicStylesToElement) {
              if (config.matchesHeuristicRules(m.target)) {
                config.applyHeuristicStylesToElement(m.target);
              }
            }
          }
        }
      })
    : null;

  if (observer) {
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    // 治本：同时观察 documentElement（host class / hero URL 所在），立即捕获清除
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
  }

  // ═══════════════════════════════════════════════════════════
  // Progressive rendering awareness
  // ═══════════════════════════════════════════════════════════
  let progressiveRetryCount = 0;
  const sel = config.selectors || {};
  const progressiveInterval = setInterval(() => {
    progressiveRetryCount++;
    if (progressiveRetryCount > 5) {
      clearInterval(progressiveInterval);
      return;
    }
    if (document.querySelector(sel.sidebar)) {
      clearInterval(progressiveInterval);
      try {
        appendToStyle(buildFullCss());
      } catch {}
    }
  }, config.intervals?.progressiveRetry || 2000);

  // ═══════════════════════════════════════════════════════════
  // Self-healing — createSelfHeal (TRAE delegates, not shared engine)
  // ═══════════════════════════════════════════════════════════
  // Optional-call guard: an older engine (or a partial injection) must not
  // kill the whole adapter IIFE here — style injection above already ran,
  // and DeepCore + registration below would be skipped.
  const selfHeal =
    typeof window.__agentskin__?.createSelfHeal === 'function'
      ? window.__agentskin__.createSelfHeal({
          HOST_CLASS,
          getSheet: () => null, // style element — no adoptedSheet
          rebuildCss: () => buildFullCss(),
          onReinject: (css) => { appendToStyle(css); },
          layer: 'adapter',
          intervalMs: config.intervals?.selfHeal || 2500,
        })
      : null;
  if (selfHeal) {
    selfHeal.start();
  } else {
    console.warn('[AgentSkin] traework-adapter: createSelfHeal unavailable — structural self-heal disabled');
  }

  // ═══════════════════════════════════════════════════════════
  // DeepCore integration (RFC 2026-08-20)
  // Initialized AFTER self-heal intervals — RC1 safety-net ordering.
  // ═══════════════════════════════════════════════════════════
  if (config.deepConfig && config.deepConfig.enabled && typeof DeepCore !== "undefined") {
    try {
      const deepCoreInstance = new DeepCore(config.deepConfig, {
        agent: "traework",
        themeId: config.themeId || "unknown",
        heroUrl: config.heroUrl || "",
        HOST_CLASS: HOST_CLASS
      });
    } catch (err) {
      console.warn("[traework-adapter] DeepCore init failed, fallback:", err);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Selector health check — run once after init
  // ═══════════════════════════════════════════════════════════
  setTimeout(() => {
    if (config.checkSelectorHealth) {
      const health = config.checkSelectorHealth();
      if (!health.healthy) {
        console.warn("[traework-adapter] Selector health check:", health);
      }
    }
  }, 3000);

  // ── Native defect fixes (mirror of src/shared/theme/native-defect-fixes.mjs) ──
  // chat-bubble-shadow: kill native squared box-shadow on chat bubbles
  // user-message-surface: clear native grey rounded surface on user-message box
  // message-navigator-mask: remove native hardcoded fade-gradient mask
  // task-list-shadow: remove native sticky fade-gradient shadow band in sidebar
  try {
    const ndfSheet = new CSSStyleSheet();
    ndfSheet.replaceSync(`
      html.${HOST_CLASS} [class*="message-bubble"],
      html.${HOST_CLASS} [class*="messageBubble"],
      html.${HOST_CLASS} [class*="msg-bubble"],
      html.${HOST_CLASS} [class*="chat-bubble"],
      html.${HOST_CLASS} [class*="message-content"],
      html.${HOST_CLASS} [class*="msg-content"] {
        box-shadow: none !important;
        outline: none !important;
      }
      html.${HOST_CLASS} .user-message__text-box,
      html.${HOST_CLASS} [class*="user-message__text-box"] {
        background: transparent !important;
        background-color: transparent !important;
        background-image: none !important;
        border-color: transparent !important;
      }
      html.${HOST_CLASS} [class*="user-message-navigator__mask"] {
        background-image: none !important;
        background: transparent !important;
      }
      html.${HOST_CLASS} .task-list-shadow-bottom,
      html.${HOST_CLASS} .task-list-shadow-top {
        background-image: none !important;
        background: transparent !important;
      }
    `);
    ndfSheet.__agentskin_layer = 'native-defect-fix';
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, ndfSheet];
  } catch {}

  // ═══════════════════════════════════════════════════════════
  // Registration for external cleanup / diagnostics
  // ═══════════════════════════════════════════════════════════
  window[MARKER] = {
    observer,
    selfHeal,
    progressiveInterval,
    tokenAgent: _tokenAgent,
    health: config.checkSelectorHealth,
  };
  return "applied";
})();
