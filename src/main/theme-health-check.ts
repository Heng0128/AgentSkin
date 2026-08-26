// SPDX-License-Identifier: MPL-2.0

/**
 * # theme-health-check
 *
 * Post-injection DOM probe that walks the render tree from the art layer
 * (#root or body) downward, identifying elements whose opaque backgrounds
 * block the hero art from being visible. Returns a structured report that
 * the UI can display as a "theme diagnostics" panel, or that the engine
 * can use to auto-generate additional punch-through CSS rules.
 *
 * Designed to be run AFTER injectThemeViaCdp succeeds, as a "health check"
 * to detect app updates that introduce new opaque containers.
 */

import { SHEET_OWNED_FLAG } from '../shared/injection-constants';
import type {
  HealthCheckReport,
  OpaqueLayer,
  OverriddenVariable,
} from '../shared/types/health-check';
import type { CdpSession } from './cdp/cdp-client';

// Re-export so existing importers (cdp-fanout, tests) keep working.
export type { HealthCheckReport, OpaqueLayer, OverriddenVariable };

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

/**
 * Run a health check on the currently themed page.
 * Never throws — returns a report with score=-1 on connection failure.
 */
export async function checkThemeHealth(
  session: CdpSession,
  agentId: string,
): Promise<HealthCheckReport> {
  try {
    await session.send('Runtime.enable');
  } catch {
    return emptyReport(agentId);
  }

  // --- Token & art status ---
  let statusRaw: string;
  try {
    statusRaw = await session.evaluate(`(() => {
      const rootCs = getComputedStyle(document.documentElement);
      const root = document.getElementById('root') || document.body;
      const rootBg = getComputedStyle(root).backgroundImage || '';
      const rootBeforeBg = getComputedStyle(root, '::before').backgroundImage || '';
      const bodyBg = getComputedStyle(document.body).backgroundImage || '';
      const bodyBeforeBg = getComputedStyle(document.body, '::before').backgroundImage || '';
      const adopted = (document.adoptedStyleSheets || []).filter(s => s.${SHEET_OWNED_FLAG}).length;
      const hostClass = 'agentskin-host-' + ${JSON.stringify(agentId)};
      const hostClassPresent = document.documentElement.classList.contains(hostClass);
      const adapterMarker = '__agentskin_' + ${JSON.stringify(agentId)} + '_adapter__';
      const adapterPresent = !!window[adapterMarker];
      // Sample key native tokens per agent to verify overrides took effect.
      // --dbx-* are DEAD tokens in Doubao; real system is --semi-color-*.
      const nativeTokens = {};
      const tokenSamples = {
        doubao: ['--semi-color-bg-0','--semi-color-text-0','--semi-color-primary','--normal-bg'],
        traework: ['--vscode-foreground','--vscode-editor-background','--vscode-sideBar-background','--vscode-button-background'],
        qoderwork: ['--color-bg-base','--color-text-primary','--color-brand-default','--color-bg-elevated'],
        workbuddy: ['--cb-bg-primary','--cb-text-primary','--cb-button-dark-background','--cb-vscode-editor-background'],
        codex: ['--color-bg-base','--color-text-primary','--color-brand-default','--color-bg-elevated'],
      };
      const sampleKeys = tokenSamples[${JSON.stringify(agentId)}] || tokenSamples.doubao;
      for (const k of sampleKeys) {
        nativeTokens[k] = rootCs.getPropertyValue(k).trim();
      }
      return JSON.stringify({
        heroArtActive: rootBg.includes('blob:') || rootBeforeBg.includes('blob:') || bodyBg.includes('blob:') || bodyBeforeBg.includes('blob:'),
        themeSheetPresent: adopted > 0,
        accentToken: rootCs.getPropertyValue('--agentskin-accent').trim(),
        hostClassPresent,
        adapterPresent,
        nativeTokens,
      });
    })()`);
  } catch {
    return emptyReport(agentId);
  }

  let status: {
    heroArtActive: boolean;
    themeSheetPresent: boolean;
    accentToken: string;
    hostClassPresent: boolean;
    adapterPresent: boolean;
    nativeTokens: Record<string, string>;
  };
  try {
    status = JSON.parse(statusRaw);
  } catch {
    return emptyReport(agentId);
  }

  // --- Opaque layer walk ---
  let layersRaw: string;
  try {
    layersRaw = await session.evaluate(`(() => {
      const results = [];
      const root = document.getElementById('root') || document.body;
      if (!root) return '[]';

      function walk(el, depth) {
        if (depth > 8 || results.length > 50) return;
        const cs = getComputedStyle(el);
        const bg = cs.backgroundColor;
        const bgImg = cs.backgroundImage;
        // Parse alpha from rgba(r, g, b, a) — only truly opaque (a >= 0.9) blocks art.
        // P0-1: the old inline regex /[d.]+(?=s*)$/ treated [d.] as a character
        // class (d or dot), so every rgba() with a fractional alpha failed to
        // match and fell through to alpha=1 — semi-transparent surfaces were
        // misclassified as opaque blockers and the health score was meaningless.
        // Delegate to parseBgAlpha (the single source of truth shared with
        // isSemiTransparent below).
        const isOpaque = parseBgAlpha(bg) >= 0.9;
        // Elements with backdrop-filter are intentional frosted glass — not blockers.
        const hasFrost = !!(cs.backdropFilter && cs.backdropFilter !== 'none');
        const hasBgImg = bgImg && bgImg !== 'none' && !bgImg.includes('blob:');
        if ((isOpaque || hasBgImg) && !hasFrost && el.offsetWidth > 10 && el.offsetHeight > 10) {
          // Skip the art root itself (it has the hero gradient layers)
          if (depth === 0 && (el.id === 'root' || el === document.body)) {
            for (const child of el.children) walk(child, depth + 1);
            return;
          }
          const semantic = el.getAttribute('data-view-id')
            || el.getAttribute('data-application-name')
          || '';
        results.push({
          depth,
          tagName: el.tagName,
          id: el.id || '',
          classes: (el.className || '').toString().slice(0, 120),
          semanticAttr: semantic,
          backgroundColor: isOpaque ? bg : '',
          backgroundImage: hasBgImg ? bgImg.slice(0, 100) : '',
          size: el.offsetWidth + 'x' + el.offsetHeight,
          visible: el.offsetWidth > 0,
          backdropFilter: cs.backdropFilter || '',
        });
      }
      for (const child of el.children) walk(child, depth + 1);
    }
    walk(root, 0);
    return JSON.stringify(results);
  })()`);
  } catch {
    return emptyReport(agentId);
  }

  let opaqueLayers: OpaqueLayer[] = [];
  try {
    opaqueLayers = JSON.parse(layersRaw);
  } catch {
    // Parse failure — treat as no layers found.
  }

  const blockingCount = opaqueLayers.filter((l) => l.visible).length;

  // --- Overridden variable detection ---
  // Compare what the theme sheets DECLARE vs what the browser COMPUTES.
  // A mismatch means a later cascade rule (app CSS, inline style, or JS)
  // overrode the theme value — a common cause of "theme looks wrong".
  const overriddenVariables = await detectOverriddenVariables(session);

  // Score: start at 100, deduct per visible blocking layer.
  // Large elements (>50% viewport) deduct more.
  const score = computeScore(opaqueLayers, status.heroArtActive, overriddenVariables);

  return {
    agentId,
    timestamp: Date.now(),
    heroArtActive: status.heroArtActive,
    themeSheetPresent: status.themeSheetPresent,
    accentToken: status.accentToken,
    hostClassPresent: status.hostClassPresent,
    adapterPresent: status.adapterPresent,
    nativeTokens: status.nativeTokens,
    overriddenVariables,
    opaqueLayers,
    blockingCount,
    score,
  };
}

// ---------------------------------------------------------------------------
// Auto-fix: generate punch-through CSS for discovered opaque layers
// ---------------------------------------------------------------------------

/**
 * Given a health report, generate CSS rules that punch transparency through
 * the discovered opaque layers. Returns a CSS string ready for injection.
 * Only targets layers that are:
 * - Visible (offsetWidth > 0)
 * - Not already using backdrop-filter (those are intentional frosted glass)
 * - Larger than 100x100 (small elements like badges are fine)
 */
export function generatePunchThroughCss(report: HealthCheckReport): string {
  const targets = report.opaqueLayers.filter(
    (l) => l.visible && !l.backdropFilter && !isSemiTransparent(l.backgroundColor),
  );

  if (targets.length === 0) return '';

  const rules: string[] = ['/* Auto-generated punch-through rules from theme-health-check */'];

  for (const layer of targets) {
    const selector = buildSelector(layer);
    if (!selector) continue;
    // P1-7: Previously this blanketed the element with three !important rules,
    // including the overly-broad `background: transparent !important` shorthand
    // which RESETS ALL background longhands (position, size, repeat, origin,
    // clip, attachment) and often broke legitimate styling. We now emit only
    // the longhand property that actually caused the opaqueness:
    //   - If the layer has an OPAQUE computed background-color → neutralize it.
    //   - If the layer has a NON-NONE background-image → neutralize it.
    // Nothing else gets touched.
    const declarations: string[] = [];
    const bgColorOpaque = layer.backgroundColor && !isSemiTransparent(layer.backgroundColor);
    const bgImageActive =
      layer.backgroundImage &&
      layer.backgroundImage !== 'none' &&
      layer.backgroundImage.trim() !== '';
    if (bgColorOpaque) declarations.push('  background-color: transparent !important;');
    if (bgImageActive) declarations.push('  background-image: none !important;');
    if (declarations.length === 0) continue;
    rules.push(`${selector} {\n${declarations.join('\n')}\n}`);
  }

  return rules.join('\n\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse the alpha channel of a computed `backgroundColor` string.
 * Returns a value in [0, 1]:
 *   - `transparent` / `rgba(0,0,0,0)` → 0
 *   - `rgba(r, g, b, a)` → the parsed alpha
 *   - `rgb(...)` / named colors / anything unparseable → 1 (opaque)
 *
 * P0-1: this is the single source of truth for background opacity parsing.
 * The old health-check inline regex (`/[d.]+(?=s*)$/`) treated `[d.]` as a
 * character class and misclassified every fractional-alpha rgba() as opaque;
 * `isSemiTransparent` previously had its own (correct) regex. Both now go
 * through here so they can never disagree.
 */
export function parseBgAlpha(bg: string | undefined): number {
  if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') return 0;
  // Anchor the match so trailing whitespace can't hide a fractional alpha.
  const m = /^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(bg);
  if (!m) return 1; // rgb() / named color / unparseable → treat as opaque
  if (m[1] === undefined) return 1; // rgb() has no alpha channel → opaque
  const alpha = parseFloat(m[1]);
  if (Number.isNaN(alpha)) return 1;
  return Math.min(1, Math.max(0, alpha));
}

/**
 * Check whether a computed backgroundColor string is semi-transparent
 * (alpha < 1). Handles `rgba(r,g,b,a)` format; `rgb(...)` and named colors
 * are treated as opaque. Delegates to {@link parseBgAlpha}.
 */
export function isSemiTransparent(bg: string): boolean {
  return parseBgAlpha(bg) < 1;
}

/**
 * Escape a string for use as a CSS identifier (class name).
 * Minimal replacement for the browser-only `CSS.escape` — handles the
 * characters that appear in CSS-module hashes and typical class names.
 */
function escapeCssIdent(value: string): string {
  return value.replace(/([^\w-])/g, '\\$1');
}

function buildSelector(layer: OpaqueLayer): string | null {
  // Prefer semantic attributes (stable across versions)
  if (layer.semanticAttr) {
    return `[data-view-id="${layer.semanticAttr}"]`;
  }
  // Use id if present
  if (layer.id) {
    return `#${layer.id}`;
  }
  // Use first class name (CSS module hash — may change between versions)
  const firstClass = layer.classes.split(' ')[0];
  if (firstClass && firstClass.length > 2) {
    return `.${escapeCssIdent(firstClass)}`;
  }
  return null;
}

/**
 * Detect CSS variables that are declared in theme sheets but whose computed
 * value differs from what was declared — indicating a later cascade rule
 * (app CSS, inline style, or JS) overrode the theme value.
 *
 * Strategy: walk every owned adoptedStyleSheet's cssRules, find `:root` rules,
 * extract custom property declarations (`--*`), then compare each declared
 * value against the live computed value on `<html>`. Mismatches are reported.
 */
async function detectOverriddenVariables(session: CdpSession): Promise<OverriddenVariable[]> {
  try {
    const raw = await session.evaluate(`(() => {
      const rootCs = getComputedStyle(document.documentElement);
      const sheets = document.adoptedStyleSheets || [];
      const owned = sheets.filter(function(s) { return s.__agentskin === true; });
      const mismatches = [];

      for (var i = 0; i < owned.length; i++) {
        var rules = [];
        try { rules = owned[i].cssRules || []; } catch(e) { continue; }
        for (var j = 0; j < rules.length; j++) {
          var rule = rules[j];
          // Only inspect :root style rules (selectorText === ':root')
          if (!rule.selectorText || rule.selectorText !== ':root') continue;
          var style = rule.style;
          if (!style) continue;
          for (var k = 0; k < style.length; k++) {
            var prop = style[k];
            if (prop.indexOf('--') !== 0) continue; // only custom properties
            var declared = style.getPropertyValue(prop).trim();
            if (!declared) continue;
            var computed = rootCs.getPropertyValue(prop).trim();
            // Normalize both for comparison (strip !important, lowercase)
            var declNorm = declared.replace(/\\s*!important\\s*$/i, '').toLowerCase();
            var compNorm = computed.replace(/\\s*!important\\s*$/i, '').toLowerCase();
            if (declNorm !== compNorm) {
              mismatches.push({ name: prop, declared: declared, computed: computed });
            }
          }
        }
      }
      return JSON.stringify(mismatches);
    })()`);
    // TODO: type-guard — 待渐进式加固
    return JSON.parse(raw) as OverriddenVariable[];
  } catch {
    return [];
  }
}

function computeScore(
  layers: OpaqueLayer[],
  heroActive: boolean,
  overriddenVariables: OverriddenVariable[],
): number {
  if (!heroActive) return 0; // No art = theme fundamentally broken
  let score = 100;
  for (const layer of layers) {
    if (!layer.visible) continue;
    // Parse size
    const [w, h] = layer.size.split('x').map(Number);
    const area = (w || 0) * (h || 0);
    if (area > 500_000)
      score -= 20; // Large blocker (>~700x700)
    else if (area > 100_000)
      score -= 10; // Medium
    else if (area > 10_000)
      score -= 5; // Small
    else score -= 2; // Tiny
  }
  // Overridden variables indicate the theme is being partially suppressed
  score -= Math.min(30, overriddenVariables.length * 10);
  return Math.max(0, score);
}

function emptyReport(agentId: string): HealthCheckReport {
  return {
    agentId,
    timestamp: Date.now(),
    heroArtActive: false,
    themeSheetPresent: false,
    accentToken: '',
    hostClassPresent: false,
    adapterPresent: false,
    nativeTokens: {},
    overriddenVariables: [],
    opaqueLayers: [],
    blockingCount: 0,
    score: -1,
  };
}
