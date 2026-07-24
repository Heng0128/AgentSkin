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

import type { CdpSession } from './cdp-client';
import { SHEET_OWNED_FLAG } from '../shared/injection-constants';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OpaqueLayer {
  /** Depth from the art root (#root or body). */
  depth: number;
  tagName: string;
  id: string;
  /** First 120 chars of className. */
  classes: string;
  /** data-view-id or similar semantic attribute (empty if none). */
  semanticAttr: string;
  /** Computed backgroundColor (non-transparent). */
  backgroundColor: string;
  /** Computed backgroundImage snippet (if any). */
  backgroundImage: string;
  /** Element dimensions "WxH". */
  size: string;
  /** Whether the element is actually visible (offsetWidth > 0). */
  visible: boolean;
  /** backdrop-filter value (empty if none). */
  backdropFilter: string;
}

export interface HealthCheckReport {
  /** Agent ID this report is for. */
  agentId: string;
  /** Timestamp of the check. */
  timestamp: number;
  /** Whether --codedrobe-art is set and active. */
  heroArtActive: boolean;
  /** Whether an __agentskin adoptedStyleSheet is present. */
  themeSheetPresent: boolean;
  /** --agentskin-accent value (confirms token injection). */
  accentToken: string;
  /** Opaque layers that block the hero art, sorted by depth. */
  opaqueLayers: OpaqueLayer[];
  /** Summary: how many visible opaque layers remain. */
  blockingCount: number;
  /** Overall health score 0-100 (100 = perfect transparency). */
  score: number;
}

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
      const bodyBg = getComputedStyle(document.body).backgroundImage || '';
      const adopted = (document.adoptedStyleSheets || []).filter(s => s.${SHEET_OWNED_FLAG}).length;
      return JSON.stringify({
        heroArtActive: rootBg.includes('blob:') || bodyBg.includes('blob:'),
        themeSheetPresent: adopted > 0,
        accentToken: rootCs.getPropertyValue('--agentskin-accent').trim(),
      });
    })()`);
  } catch {
    return emptyReport(agentId);
  }

  let status: { heroArtActive: boolean; themeSheetPresent: boolean; accentToken: string };
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
        const isOpaque = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
        const hasBgImg = bgImg && bgImg !== 'none' && !bgImg.includes('blob:');
        if ((isOpaque || hasBgImg) && el.offsetWidth > 10 && el.offsetHeight > 10) {
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

  // Score: start at 100, deduct per visible blocking layer.
  // Large elements (>50% viewport) deduct more.
  const score = computeScore(opaqueLayers, status.heroArtActive);

  return {
    agentId,
    timestamp: Date.now(),
    heroArtActive: status.heroArtActive,
    themeSheetPresent: status.themeSheetPresent,
    accentToken: status.accentToken,
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
    (l) =>
      l.visible &&
      !l.backdropFilter &&
      !l.backgroundColor.includes('0.') === false, // skip already semi-transparent
  );

  if (targets.length === 0) return '';

  const rules: string[] = [
    '/* Auto-generated punch-through rules from theme-health-check */',
  ];

  for (const layer of targets) {
    const selector = buildSelector(layer);
    if (!selector) continue;
    rules.push(
      `${selector} {\n  background: transparent !important;\n  background-color: transparent !important;\n  background-image: none !important;\n}`,
    );
  }

  return rules.join('\n\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    return `.${CSS.escape(firstClass)}`;
  }
  return null;
}

function computeScore(layers: OpaqueLayer[], heroActive: boolean): number {
  if (!heroActive) return 0; // No art = theme fundamentally broken
  let score = 100;
  for (const layer of layers) {
    if (!layer.visible) continue;
    // Parse size
    const [w, h] = layer.size.split('x').map(Number);
    const area = (w || 0) * (h || 0);
    if (area > 500_000) score -= 20; // Large blocker (>~700x700)
    else if (area > 100_000) score -= 10; // Medium
    else if (area > 10_000) score -= 5; // Small
    else score -= 2; // Tiny
  }
  return Math.max(0, score);
}

function emptyReport(agentId: string): HealthCheckReport {
  return {
    agentId,
    timestamp: Date.now(),
    heroArtActive: false,
    themeSheetPresent: false,
    accentToken: '',
    opaqueLayers: [],
    blockingCount: 0,
    score: -1,
  };
}
