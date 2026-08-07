/**
 * Rendering Necessity Analyzer
 * 
 * Reads each agent's full-extract.json, recursively traverses the DOM tree,
 * and classifies nodes into categories:
 *   - coreRendered: visible content nodes
 *   - hiddenNotRendered: display:none, opacity:0, hidden classes
 *   - decorativeOnly: svg/path/g/defs/use/symbol
 *   - placeholderSkeleton: skeleton/shimmer/loading/placeholder/pulse classes
 * 
 * Output: agents-raw-data/_rendering-analysis.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'agents-raw-data');
const OUTPUT_FILE = path.join(DATA_DIR, '_rendering-analysis.json');

const AGENTS = ['codex', 'doubao', 'traework', 'qoderwork', 'workbuddy', 'zcode'];

// ── Classification Constants ────────────────────────────────────────────────

// Must match "hidden" as a standalone class token, not as part of "overflow-hidden" etc.
const HIDDEN_CLASSES_RE = /(?:^|\s)(?:hidden|invisible|sr-only|a11y-hidden|a11y-hidden-group)(?:\s|$)/i;
const SKELETON_CLASSES_RE = /\b(skeleton|shimmer|loading|placeholder|pulse)\b/i;
const ANIMATING_CLASSES_RE = /\b(transitioning|animating)\b/i;
const OFFSCREEN_CLASSES_RE = /\b(offscreen|skip-to-content)\b/i;
const DECORATIVE_TAG_RE = /^(svg|path|g|defs|use|symbol)$/;
const INTERACTIVE_ROLES_RE = /^(menu|listbox|dialog|tooltip|popover)$/;
const CONTENT_TAGS_RE = /^(h[1-6]|p|a|button|input|textarea|select|label|img|video|audio|canvas|table|ul|ol|li|pre|code|blockquote|form|fieldset|figcaption|figure|article|section|main|header|footer|nav|aside|details|summary|meter|progress)$/;

// ── Node Classification ─────────────────────────────────────────────────────

/**
 * Walk a node, returning classification flags for that single node.
 * A node counts in exactly one primary bucket (priority order).
 */
function classifyNode(node) {
  const cls = (node.c || '').toString();
  const s = node.s || {};
  const tag = node.t;

  // 1. Decorative SVG containers (pure visual, no semantic content)
  if (DECORATIVE_TAG_RE.test(tag)) {
    return 'decorativeOnly';
  }

  // 2. Display:none — explicitly suppressed by layout engine
  if (s.dp === 'none') {
    return 'hiddenNotRendered';
  }

  // 3. Opacity:0 — invisible but occupies space
  if (s.op === '0') {
    // Could be offscreen placeholder or intent-hidden; check further
    if (OFFSCREEN_CLASSES_RE.test(cls)) {
      return 'hiddenNotRendered';
    }
    return 'hiddenNotRendered';
  }

  // 4. Hidden utility classes
  if (HIDDEN_CLASSES_RE.test(cls)) {
    return 'hiddenNotRendered';
  }

  // 5. Offscreen positioned elements
  if (s.pos === 'absolute' && OFFSCREEN_CLASSES_RE.test(cls)) {
    return 'hiddenNotRendered';
  }

  // 6. Skeleton / loading / placeholder — transient state
  if (SKELETON_CLASSES_RE.test(cls)) {
    return 'placeholderSkeleton';
  }

  // 7. Animating / transitioning — unstable frame (count separately but treat as rendered)
  if (ANIMATING_CLASSES_RE.test(cls)) {
    return 'coreRendered'; // still visible, just not stable
  }

  // 8. Hidden interactive roles (menu/listbox not expanded)
  // These are hiddenNotRendered because they are not visible
  if (node.r && INTERACTIVE_ROLES_RE.test(node.r)) {
    // If role is interactive but display:none or hidden class, it's hidden
    if (s.dp === 'none' || HIDDEN_CLASSES_RE.test(cls)) {
      return 'hiddenNotRendered';
    }
  }

  // 9. Everything else = core rendered
  return 'coreRendered';
}

// ── Tree Walker ──────────────────────────────────────────────────────────────

function analyzeTree(rootNode) {
  const stats = {
    totalNodes: 0,
    coreRendered: 0,
    hiddenNotRendered: 0,
    decorativeOnly: 0,
    placeholderSkeleton: 0,
    details: {
      hideReasons: [],
      coreTags: {},
      hiddenTags: {},
      decorativeTags: {},
      skeletonTags: {},
      opacityZeroClasses: [],
      displayNoneClasses: [],
    },
  };

  function walk(node) {
    stats.totalNodes++;
    const category = classifyNode(node);
    const tag = node.t;
    const cls = (node.c || '').toString();

    switch (category) {
      case 'coreRendered':
        stats.coreRendered++;
        stats.details.coreTags[tag] = (stats.details.coreTags[tag] || 0) + 1;
        break;

      case 'hiddenNotRendered': {
        stats.hiddenNotRendered++;
        stats.details.hiddenTags[tag] = (stats.details.hiddenTags[tag] || 0) + 1;
        const reason = buildHideReason(node);
        stats.details.hideReasons.push(reason);
        if (node.s?.op === '0') {
          stats.details.opacityZeroClasses.push(cls.slice(0, 100));
        }
        if (node.s?.dp === 'none') {
          stats.details.displayNoneClasses.push(cls.slice(0, 100));
        }
        break;
      }

      case 'decorativeOnly':
        stats.decorativeOnly++;
        stats.details.decorativeTags[tag] = (stats.details.decorativeTags[tag] || 0) + 1;
        break;

      case 'placeholderSkeleton':
        stats.placeholderSkeleton++;
        stats.details.skeletonTags[tag] = (stats.details.skeletonTags[tag] || 0) + 1;
        break;
    }

    // Always recurse into children regardless of parent classification
    if (node.ch) {
      for (const child of node.ch) {
        walk(child);
      }
    }
  }

  walk(rootNode);

  stats.renderEfficiency = stats.totalNodes > 0
    ? parseFloat((stats.coreRendered / stats.totalNodes).toFixed(3))
    : 0;

  return stats;
}

function buildHideReason(node) {
  const cls = (node.c || '').toString();
  const s = node.s || {};
  const reasons = [];

  if (s.dp === 'none') reasons.push('display:none');
  if (s.op === '0') reasons.push('opacity:0');
  if (/(?:^|\s)hidden(?:\s|$)/.test(cls)) reasons.push('class:hidden');
  if (/(?:^|\s)invisible(?:\s|$)/.test(cls)) reasons.push('class:invisible');
  if (/(?:^|\s)sr-only(?:\s|$)/.test(cls)) reasons.push('class:sr-only');
  if (/(?:^|\s)a11y-hidden(?:\s|$)/.test(cls)) reasons.push('class:a11y-hidden');
  if (s.pos === 'absolute' && OFFSCREEN_CLASSES_RE.test(cls)) reasons.push('offscreen-absolute');

  if (reasons.length === 0) reasons.push('other');

  return {
    tag: node.t,
    cls: cls.slice(0, 120),
    reasons,
  };
}

// ── Main ────────────────────────────────────────────────────────────────────

const results = {};

for (const agent of AGENTS) {
  const filePath = path.join(DATA_DIR, `${agent}-full-extract.json`);

  if (!fs.existsSync(filePath)) {
    console.warn(`  [SKIP] ${agent}: file not found`);
    continue;
  }

  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const domRoot = data.dom?.default;

  if (!domRoot) {
    console.warn(`  [SKIP] ${agent}: no dom.default`);
    continue;
  }

  console.log(`Analyzing ${agent}...`);
  const stats = analyzeTree(domRoot);

  // Limit detail arrays to keep output manageable
  stats.details.hideReasons = stats.details.hideReasons.slice(0, 30);
  stats.details.opacityZeroClasses = stats.details.opacityZeroClasses.slice(0, 10);
  stats.details.displayNoneClasses = stats.details.displayNoneClasses.slice(0, 10);

  results[agent] = {
    totalNodes: stats.totalNodes,
    coreRendered: stats.coreRendered,
    hiddenNotRendered: stats.hiddenNotRendered,
    decorativeOnly: stats.decorativeOnly,
    placeholderSkeleton: stats.placeholderSkeleton,
    renderEfficiency: stats.renderEfficiency,
    details: stats.details,
  };

  console.log(
    `  total=${stats.totalNodes} core=${stats.coreRendered} ` +
    `hidden=${stats.hiddenNotRendered} decorative=${stats.decorativeOnly} ` +
    `skeleton=${stats.placeholderSkeleton} efficiency=${stats.renderEfficiency}`
  );
}

// Write output
fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2), 'utf8');
console.log(`\nOutput written to: ${OUTPUT_FILE}`);
console.log(`Analyzed ${Object.keys(results).length} agents.`);
