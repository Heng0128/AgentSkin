// SPDX-License-Identifier: MPL-2.0
/**
 * QODERWORK Adapter Configuration
 * ------------------------------------------------------------
 * Config object consumed by the shared adapter engine
 * (engines/shared/adapter-engine.mjs).  Exposes app-specific
 * selectors, structural CSS, per-renderer CSS blocks, token
 * overrides, element-level heuristic guards, and DeepCore
 * settings.
 *
 * Loaded by the orchestrator BEFORE adapter.mjs and AFTER the
 * shared engine defines window.__agentskin_shared_engine__.
 */

(() => {
  'use strict';

  const HOST_CLASS = 'agentskin-host-qoderwork';
  const MARKER = '__agentskin_qoderwork_adapter__';

  // ═══════════════════════════════════════════════════════════
  // 6-RENDERER-TYPE DETECTION
  // QoderWork ships 6 independent renderer pages (plus main index.html):
  //   voice-overlay.html   — voice input overlay
  //   mcp-app-preview.html — MCP app preview
  //   artifact-preview.html — artifact preview panel
  //   quickpick.html       — command palette
  //   resources/canvas/index.html  — canvas design tool (6.4MB React 19)
  //   resources/writing/index.html — writing editor (3.7MB React 19)
  // Detection via location.pathname.
  // ═══════════════════════════════════════════════════════════

  function detectRendererType() {
    const pathname = window.location.pathname || '';
    if (pathname.includes('voice-overlay')) return 'voice-overlay';
    if (pathname.includes('mcp-app-preview')) return 'mcp-app-preview';
    if (pathname.includes('artifact-preview')) return 'artifact-preview';
    if (pathname.includes('quickpick')) return 'quickpick';
    if (pathname.includes('resources/canvas')) return 'canvas';
    if (pathname.includes('resources/writing')) return 'writing';
    return 'main';
  }

  // ═══════════════════════════════════════════════════════════
  // Element-level heuristic guards
  // Applies targeted inline styles to dynamically-added elements
  // that match QoderWork structural patterns.
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
    if (tag === 'nav' || tag === 'aside' || /agents-sidebar/i.test(cls)) {
      el.style.setProperty('background', 'color-mix(in srgb, var(--agentskin-surface) var(--ag-glass-bg-md), transparent)', 'important');
      el.style.setProperty('backdrop-filter', 'blur(var(--ag-glass-blur-md)) saturate(var(--ag-glass-sat-md))', 'important');
      return;
    }
    if (el.hasAttribute('contenteditable') || tag === 'textarea' || role === 'textbox' || /chat-input|composer|editor/i.test(cls)) {
      el.style.setProperty('border-color', 'var(--color-primary)', 'important');
      return;
    }
    if (/agents-layout|agents-content|chat-panel|message-list|conversation-panel|workspace-panel/i.test(cls)) {
      el.style.setProperty('background', 'transparent', 'important');
      el.style.setProperty('background-color', 'transparent', 'important');
      el.style.setProperty('background-image', 'none', 'important');
      el.style.setProperty('backdrop-filter', 'none', 'important');
      return;
    }
    const style = el.getAttribute('style') || '';
    if (/background(?:-color)?\s*:/i.test(style) && !/transparent/i.test(style)) {
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
    layoutRoot: ':is(.agents-layout-root, .agents-layout-body, .agents-content-area)',
    sidebar: ':is(.agents-sidebar, aside, [data-view-id="sidebar"])',
    mainSurface: ':is([class*="agents-content"], [class*="chat-panel"], [class*="message-list"], [class*="conversation-panel"], [class*="workspace-panel"])',
    header: ':is([class*="agents-header"], [class*="titlebar"], [class*="title-bar"], [class*="top-bar"], [class*="topbar"], [class*="app-header"], [class*="window-header"], [class*="header"])',
    navItem: ':is(button[class~="group/extensions-nav"], [data-extension-nav-item="true"])',
    cmEditor: ':is(.cm-editor, .cm-content, .cm-line)',
    overlayDialog: '[role="dialog"]',
    overlayMenu: '[role="menu"]',
    overlayTooltip: '[role="tooltip"]',
    overlayListbox: '[role="listbox"]',
    'route:workspace': ':is(.agents-layout-root, .agents-layout-body)',
    'route:chat': ':is(.agents-sidebar, aside)',
    'route:index': '#root',
  };

  // ═══════════════════════════════════════════════════════════
  // Per-renderer CSS blocks — 6 independent renderer pages.
  // Each key maps to a CSS string applied only when that renderer
  // is detected via detectRendererType().
  // ═══════════════════════════════════════════════════════════

  const RENDERER_CSS = {
    'voice-overlay': `
/* === voice-overlay: 全屏覆盖层，透明背景 + 居中玻璃效果 === */
html.${HOST_CLASS} body {
  background: transparent !important;
  background-color: transparent !important;
}
html.${HOST_CLASS} #root,
html.${HOST_CLASS} [class*="voice-overlay"],
html.${HOST_CLASS} [class*="voice-container"],
html.${HOST_CLASS} [class*="voice-panel"] {
  background: transparent !important;
  background-color: transparent !important;
}
html.${HOST_CLASS} [class*="voice-input-area"],
html.${HOST_CLASS} [class*="voice-core"],
html.${HOST_CLASS} .voice-glass {
  background: color-mix(in srgb, var(--agentskin-surface-elevated) 72%, transparent) !important;
  backdrop-filter: blur(var(--ag-glass-blur-lg)) saturate(var(--ag-glass-sat-lg)) !important;
  -webkit-backdrop-filter: blur(var(--ag-glass-blur-lg)) saturate(var(--ag-glass-sat-lg)) !important;
  border-radius: 16px !important;
  border: 1px solid var(--ag-glass-border) !important;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18) !important;
}
`,
    'mcp-app-preview': `
/* === mcp-app-preview: iframe 预览容器，透明边框 === */
html.${HOST_CLASS} body {
  background: transparent !important;
  background-color: transparent !important;
}
html.${HOST_CLASS} #root,
html.${HOST_CLASS} [class*="mcp-preview"],
html.${HOST_CLASS} [class*="mcp-container"],
html.${HOST_CLASS} [class*="preview-frame"] {
  background: transparent !important;
  background-color: transparent !important;
}
html.${HOST_CLASS} iframe,
html.${HOST_CLASS} [class*="mcp-iframe"],
html.${HOST_CLASS} [class*="preview-iframe"] {
  border: none !important;
  background: transparent !important;
}
html.${HOST_CLASS} [class*="mcp-header"],
html.${HOST_CLASS} [class*="preview-toolbar"] {
  background: color-mix(in srgb, var(--agentskin-surface) 60%, transparent) !important;
  backdrop-filter: blur(var(--ag-glass-blur-md)) !important;
  -webkit-backdrop-filter: blur(var(--ag-glass-blur-md)) !important;
  border-bottom: 1px solid var(--ag-glass-border) !important;
}
`,
    'artifact-preview': `
/* === artifact-preview: 预览面板，暗色表面 === */
html.${HOST_CLASS} body {
  background: var(--agentskin-surface) !important;
  background-color: var(--agentskin-surface) !important;
}
html.${HOST_CLASS} #root,
html.${HOST_CLASS} [class*="artifact-preview"],
html.${HOST_CLASS} [class*="artifact-container"],
html.${HOST_CLASS} [class*="artifact-viewer"] {
  background: var(--agentskin-surface) !important;
  background-color: var(--agentskin-surface) !important;
}
html.${HOST_CLASS} [class*="artifact-content"],
html.${HOST_CLASS} [class*="artifact-body"] {
  background: var(--agentskin-surface-elevated) !important;
  border-radius: 8px !important;
}
html.${HOST_CLASS} [class*="artifact-header"],
html.${HOST_CLASS} [class*="artifact-toolbar"] {
  background: var(--agentskin-surface) !important;
  border-bottom: 1px solid color-mix(in srgb, var(--agentskin-text) 12%, transparent) !important;
}
`,
    'quickpick': `
/* === quickpick: 命令面板，紧凑玻璃效果 === */
html.${HOST_CLASS} body {
  background: transparent !important;
  background-color: transparent !important;
}
html.${HOST_CLASS} #root {
  background: transparent !important;
  background-color: transparent !important;
  display: flex !important;
  align-items: flex-start !important;
  justify-content: center !important;
  padding-top: 12vh !important;
}
html.${HOST_CLASS} [class*="quickpick"],
html.${HOST_CLASS} [class*="command-palette"],
html.${HOST_CLASS} [class*="picker-container"] {
  background: color-mix(in srgb, var(--agentskin-surface-elevated) 80%, transparent) !important;
  backdrop-filter: blur(var(--ag-glass-blur-lg)) saturate(var(--ag-glass-sat-lg)) !important;
  -webkit-backdrop-filter: blur(var(--ag-glass-blur-lg)) saturate(var(--ag-glass-sat-lg)) !important;
  border-radius: 12px !important;
  border: 1px solid var(--ag-glass-border) !important;
  box-shadow: 0 12px 48px rgba(0, 0, 0, 0.24) !important;
  max-width: 600px !important;
  width: 90% !important;
  overflow: hidden !important;
}
html.${HOST_CLASS} [class*="quickpick-input"],
html.${HOST_CLASS} [class*="picker-input"],
html.${HOST_CLASS} [class*="command-input"] {
  background: transparent !important;
  border: none !important;
  border-bottom: 1px solid var(--ag-glass-border) !important;
  border-radius: 0 !important;
  padding: 12px 16px !important;
}
html.${HOST_CLASS} [class*="quickpick-item"],
html.${HOST_CLASS} [class*="picker-item"],
html.${HOST_CLASS} [class*="command-item"] {
  padding: 8px 16px !important;
}
html.${HOST_CLASS} [class*="quickpick-item"]:hover,
html.${HOST_CLASS} [class*="quickpick-item"][data-active="true"],
html.${HOST_CLASS} [class*="picker-item"]:hover,
html.${HOST_CLASS} [class*="picker-item"][data-active="true"],
html.${HOST_CLASS} [class*="command-item"]:hover,
html.${HOST_CLASS} [class*="command-item"][data-active="true"] {
  background: var(--color-primary-bg-hover) !important;
}
`,
    'canvas': `
/* === canvas: 画布设计工具 (6.4MB React 19) === */
/* 全屏画布区域透明，工具栏/侧边栏毛玻璃 */
html.${HOST_CLASS} body {
  background: transparent !important;
  background-color: transparent !important;
}
html.${HOST_CLASS} #root,
html.${HOST_CLASS} [class*="canvas"],
html.${HOST_CLASS} [class*="Canvas"],
html.${HOST_CLASS} [class*="design-surface"],
html.${HOST_CLASS} [class*="artboard"] {
  background: transparent !important;
  background-color: transparent !important;
}
html.${HOST_CLASS} [class*="canvas-toolbar"],
html.${HOST_CLASS} [class*="canvas-sidebar"],
html.${HOST_CLASS} [class*="design-toolbar"],
html.${HOST_CLASS} [class*="design-panel"] {
  background: color-mix(in srgb, var(--agentskin-surface) 60%, transparent) !important;
  backdrop-filter: blur(var(--ag-glass-blur-md)) saturate(var(--ag-glass-sat-md)) !important;
  -webkit-backdrop-filter: blur(var(--ag-glass-blur-md)) saturate(var(--ag-glass-sat-md)) !important;
  border-color: var(--ag-glass-border) !important;
}
html.${HOST_CLASS} [class*="canvas-canvas"],
html.${HOST_CLASS} [class*="design-canvas"],
html.${HOST_CLASS} [class*="artboard-surface"] {
  background: color-mix(in srgb, var(--agentskin-surface-elevated) 40%, transparent) !important;
}
`,
    'writing': `
/* === writing: 写作编辑器 (3.7MB React 19) === */
/* 编辑器区域透明，侧边栏/工具栏毛玻璃 */
html.${HOST_CLASS} body {
  background: transparent !important;
  background-color: transparent !important;
}
html.${HOST_CLASS} #root,
html.${HOST_CLASS} [class*="writing"],
html.${HOST_CLASS} [class*="Writing"],
html.${HOST_CLASS} [class*="editor-surface"],
html.${HOST_CLASS} [class*="editor-container"] {
  background: transparent !important;
  background-color: transparent !important;
}
html.${HOST_CLASS} [class*="writing-sidebar"],
html.${HOST_CLASS} [class*="editor-sidebar"],
html.${HOST_CLASS} [class*="writing-toolbar"],
html.${HOST_CLASS} [class*="editor-toolbar"] {
  background: color-mix(in srgb, var(--agentskin-surface) 60%, transparent) !important;
  backdrop-filter: blur(var(--ag-glass-blur-md)) saturate(var(--ag-glass-sat-md)) !important;
  -webkit-backdrop-filter: blur(var(--ag-glass-blur-md)) saturate(var(--ag-glass-sat-md)) !important;
  border-color: var(--ag-glass-border) !important;
}
html.${HOST_CLASS} [class*="writing-editor"],
html.${HOST_CLASS} [class*="editor-content"],
html.${HOST_CLASS} [class*="ProseMirror"],
html.${HOST_CLASS} [class*="cm-editor"] {
  background: transparent !important;
  color: var(--agentskin-text) !important;
}
`
  };

  // Returns the CSS block for the current renderer type, or '' for main.
  function getRendererCss() {
    const type = detectRendererType();
    if (type === 'main' || !RENDERER_CSS[type]) return '';
    return RENDERER_CSS[type];
  }

  // ═══════════════════════════════════════════════════════════
  // Token discovery config — qoderwork uses --color-* prefix.
  // Theme layer owns primary overrides; this adapter
  // force-transparentizes remaining background tokens.
  // ═══════════════════════════════════════════════════════════

  const tokenConfig = {
    knownPrefixes: ['--color-'],
    outputSelector: 'html.agentskin-host-qoderwork:root',
    categoryPatterns: { bg: /bg|background|container|layout/ },
    valueTransforms: { bg: (v) => 'transparent' },
    bgValueFilter: (v) => (v.startsWith('#') || v.startsWith('rgb')),
  };

  // ═══════════════════════════════════════════════════════════
  // DeepCore config (RFC 2026-08-20) — qoderwork DeepCore is
  // enabled but ships no routes/fragments; self-heal handles
  // structural preservation.  Shadow DOM piercing limited to
  // open-only.
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

  window.__agentskin_qoderwork_config__ = {
    agentId: 'qoderwork',
    hostClass: HOST_CLASS,
    marker: MARKER,
    selectors: SELECTORS,
    dynamicCss: getRendererCss,
    tokenConfig,
    deepConfig,
    intervals: { selfHeal: 2000, sheetGuard: 1500, reinjectDebounce: 100, progressiveRetry: 2000 },
    applyHeuristicOverride,
    onReinject: () => {},
    onHealthCheck: (report) => {
      if (!report) return;
      const sel = SELECTORS;
      try {
        const l1Checks = [
          { key: 'rootContainer', selector: sel.rootContainer, required: true },
          { key: 'layoutRoot', selector: sel.layoutRoot, required: true },
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
      if (!report.healthy) console.warn('[qoderwork-adapter] health check:', report);
    },
  };
})();
