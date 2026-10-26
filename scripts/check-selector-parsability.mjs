// SPDX-License-Identifier: MPL-2.0
//
// C15 — Selector parsability guard.
//
// Validates every selector candidate in engines/shared/semantic-selectors.json
// with a zero-dependency structural check. Two real bugs motivated this guard:
//   • 2026-09-08 audit S1: "[role='navigation'" (missing ]) — an invalid
//     candidate that silently never matches and can make querySelectorAll throw.
//   • 2026-09-07 workbuddy fix: ":is(...)," trailing comma inside the string —
//     SYNTAX_ERROR on every call.
//
// This is deliberately NOT a full CSS parser (no postcss dependency): it
// catches the structural class of typos that survive JSON validity —
// unbalanced brackets/quotes, trailing/leading commas, empty candidates.
//
// Usage: node scripts/check-selector-parsability.mjs
// Exit codes: 0 = all selectors structurally valid; 1 = violations found.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SELECTORS_PATH = path.join(__dirname, '..', 'engines', 'shared', 'semantic-selectors.json');

/**
 * Structural validation of a single CSS selector string.
 * @param {string} sel
 * @returns {string | null} error message, or null when valid
 */
export function validateSelector(sel) {
  if (typeof sel !== 'string') return `not a string: ${JSON.stringify(sel)}`;
  const s = sel.trim();
  if (!s) return 'empty selector';

  const stack = [];
  let quote = null;
  const pairs = { ')': '(', ']': '[', '}': '{' };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      if (ch === '\\') {
        i++;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      stack.push(ch);
      continue;
    }
    if (ch === ')' || ch === ']' || ch === '}') {
      if (stack.pop() !== pairs[ch]) return `unbalanced '${ch}' at index ${i}`;
    }
  }
  if (quote) return `unterminated quote ${quote}`;
  if (stack.length) return `unclosed '${stack[stack.length - 1]}' (depth ${stack.length})`;

  // Comma hygiene (outside quotes — quotes already verified balanced above).
  const unquoted = s.replace(/'[^']*'|"[^"]*"/g, (m) => '\u0000'.repeat(m.length));
  if (/,{2,}/.test(unquoted)) return 'empty candidate between commas';
  if (/,\s*$/.test(unquoted)) return 'trailing comma';
  if (/^\s*,/.test(unquoted)) return 'leading comma';
  // Trailing comma immediately before a closer: ":is(a,)" / ":not(a,)"
  if (/\[\s*\]/.test(unquoted)) return 'empty attribute brackets';
  return null;
}

function main() {
  const raw = readFileSync(SELECTORS_PATH, 'utf8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.error(
      `[check-selector-parsability] FAIL: ${path.basename(SELECTORS_PATH)} is not valid JSON: ${e.message}`,
    );
    process.exit(1);
  }

  const errors = [];
  let checked = 0;
  for (const [agent, roles] of Object.entries(data)) {
    if (agent.startsWith('_')) continue;
    if (!roles || typeof roles !== 'object') {
      errors.push(`${agent}: value is not an object`);
      continue;
    }
    for (const [role, candidates] of Object.entries(roles)) {
      if (role.startsWith('_')) continue;
      if (!Array.isArray(candidates)) {
        errors.push(`${agent}.${role}: candidates must be an array`);
        continue;
      }
      candidates.forEach((sel, idx) => {
        checked++;
        const err = validateSelector(sel);
        if (err)
          errors.push(
            `${agent}.${role}[${idx}]: ${err} — ${JSON.stringify(String(sel).slice(0, 80))}`,
          );
      });
    }
  }

  if (errors.length) {
    console.error(
      `[check-selector-parsability] FAIL — ${errors.length} invalid selector candidate(s):`,
    );
    for (const e of errors) console.error(`  ✗ ${e}`);
    console.error('\nFix the candidates in engines/shared/semantic-selectors.json (C15).');
    process.exit(1);
  }
  console.log(
    `[check-selector-parsability] ok (${checked} selector candidates across ${Object.keys(data).filter((k) => !k.startsWith('_')).length} agents)`,
  );
}

// Direct-execution guard: vitest imports validateSelector without firing main().
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
