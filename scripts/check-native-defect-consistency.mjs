// SPDX-License-Identifier: MPL-2.0
//
// # check-native-defect-consistency.mjs
//
// Guard (see AGENTS.md §4 invariant C-something) that the runtime adapter of
// every agent still covers the shared native-defect registry
// (scripts/native-defect-fixes.mjs). The registry is the single source; each
// engines/<agent>/adapter.mjs also carries a self-contained copy (it cannot
// `import` the Node module). If an adapter drifts — uses different selectors,
// or drops a required clear declaration — this script fails non-zero so
// `npm run check` catches the divergence.
//
// Match semantics are deliberately *wide*: an adapter may rewrite/scaffold the
// selectors (host-prefix, descendant `*`, pseudo-elements) as long as it still
// names the same stable anchor AND declares the same clear property. This is a
// drift guard, not a byte-for-byte diff.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getNativeDefectRules } from './native-defect-fixes.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Extract stable anchor substrings from a host-descendant selector.
 *  e.g. '.user-message__text-box' -> ['user-message__text-box']
 *       '[class*="quick-action"]:not(.quick-actions__item)' -> ['quick-action', 'quick-actions__item'] */
function selectorAnchors(selector) {
  const anchors = new Set();
  const attrValues = selector.match(/\[class\*="([^"]+)"\]/g);
  if (attrValues) for (const m of attrValues) anchors.add(m.match(/"([^"]+)"/)[1]);
  const classNames = selector.match(/(?<![\w-])\.[\w-]+/g);
  if (classNames) for (const m of classNames) anchors.add(m.slice(1));
  return [...anchors];
}

/** 'box-shadow: none !important' -> 'box-shadow: none' */
function clearDecl(prop) {
  return prop.replace(/\s*!important\s*$/, '');
}

function main() {
  const agents = ['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode'];
  const failures = [];
  let checkedRules = 0;

  for (const agent of agents) {
    const rules = getNativeDefectRules(agent);
    if (rules.length === 0) continue;

    const adapterPath = join(ROOT, 'engines', agent, 'adapter.mjs');
    let adapterSrc;
    try {
      adapterSrc = readFileSync(adapterPath, 'utf8');
    } catch {
      failures.push(`[${agent}] missing adapter at engines/${agent}/adapter.mjs`);
      continue;
    }

    for (const rule of rules) {
      checkedRules += 1;
      const anchors = rule.selectors.flatMap(selectorAnchors);
      const decls = rule.props.map(clearDecl);
      const hasAnchor = anchors.some((a) => adapterSrc.includes(a));
      const hasDecl = decls.some((d) => adapterSrc.includes(d));
      if (!hasAnchor || !hasDecl) {
        failures.push(
          `[${agent}] defect rule '${rule.label}' not covered by adapter.\n` +
            `    expected any selector anchor among: ${anchors.join(' | ')}\n` +
            `    expected any clear decl among: ${decls.join(' | ')}\n` +
            `    -> add/mirror this rule in engines/${agent}/adapter.mjs (source: native-defect-fixes.mjs)`,
        );
      }
    }
  }

  if (failures.length > 0) {
    console.error('[check-native-defect-consistency] FAIL\n\n' + failures.join('\n\n') + '\n');
    process.exit(1);
  }
  console.log(
    `[check-native-defect-consistency] ok (${checkedRules} defect rule(s) verified across adapters)`,
  );
}

main();
