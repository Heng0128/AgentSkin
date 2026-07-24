// SPDX-License-Identifier: MPL-2.0
//
// # bump-version.mjs
//
// Flexible version management for package.json.
//
// Version numbers use decimal carry (like base-10 addition): each position
// is 0-9, and incrementing past 9 carries into the next position.
//   5.0.9 + patch -> 5.1.0    (patch 9 -> 10, carry into minor)
//   5.9.9 + patch -> 6.0.0    (cascade carry through major)
//   5.9.0 + minor -> 6.0.0    (minor 9 -> 10, carry into major)
//
// Usage:
//   node scripts/bump-version.mjs            bump patch  (5.0.9 -> 5.1.0)
//   node scripts/bump-version.mjs patch      same as above
//   node scripts/bump-version.mjs minor      bump minor  (5.0.9 -> 5.1.0)
//   node scripts/bump-version.mjs major      bump major  (5.0.9 -> 6.0.0)
//   node scripts/bump-version.mjs --set 3.0.0   set explicit version
//   node scripts/bump-version.mjs --no-bump  keep current version (no write)
//
// Output: prints ONLY the new version string on stdout (last line),
//         so callers can capture it with `for /f`.
//         Diagnostics (old -> new) go to stderr.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
const raw = fs.readFileSync(pkgPath, 'utf8');
const pkg = JSON.parse(raw);

const oldVersion = String(pkg.version || '0.0.0');
const arg = (process.argv[2] || 'patch').toLowerCase();

/** Per-position upper bound (exclusive). 10 means each digit is 0-9. */
const BASE = 10;

function parseParts(ver) {
  const p = ver.split('.').map(Number);
  while (p.length < 3) p.push(0);
  return p.slice(0, 3);
}

/**
 * Add 1 to the patch position with decimal carry into minor and major.
 * Returns a new [major, minor, patch] array.
 *
 *   [5, 0, 9]  -> [5, 1, 0]
 *   [5, 9, 9]  -> [6, 0, 0]
 */
function bumpPatch(parts) {
  const [maj, min, pat] = parts;
  const nextPatch = pat + 1;
  if (nextPatch < BASE) return [maj, min, nextPatch];
  // patch overflowed (>=10): reset patch to 0 and carry into minor.
  // Pass the ORIGINAL minor (not min+1) — bumpMinor adds 1 itself.
  return bumpMinor([maj, min, 0]);
}

/**
 * Add 1 to the minor position with decimal carry into major.
 * Resets patch to 0.
 *
 *   [5, 0, 9]  -> [5, 1, 0]
 *   [5, 9, 0]  -> [6, 0, 0]
 */
function bumpMinor(parts) {
  const [maj, min] = parts;
  const nextMinor = min + 1;
  if (nextMinor < BASE) return [maj, nextMinor, 0];
  return [maj + 1, 0, 0];
}

/**
 * Add 1 to the major position. Resets minor and patch to 0.
 *
 *   [5, 9, 9]  -> [6, 0, 0]
 */
function bumpMajor(parts) {
  return [parts[0] + 1, 0, 0];
}

let newVersion = oldVersion;

switch (arg) {
  case '--no-bump':
  case 'skip':
  case 'none':
    // Keep current version, no write
    break;

  case '--set': {
    const explicit = process.argv[3];
    if (!explicit || !/^\d+\.\d+\.\d+/.test(explicit)) {
      process.stderr.write('[bump-version] ERROR: --set requires a valid semver, e.g. --set 3.0.0\n');
      process.exit(1);
    }
    newVersion = explicit;
    break;
  }

  case 'major': {
    newVersion = bumpMajor(parseParts(oldVersion)).join('.');
    break;
  }

  case 'minor': {
    newVersion = bumpMinor(parseParts(oldVersion)).join('.');
    break;
  }

  case 'patch':
  default: {
    newVersion = bumpPatch(parseParts(oldVersion)).join('.');
    break;
  }
}

if (newVersion !== oldVersion) {
  pkg.version = newVersion;
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
  process.stderr.write(`[bump-version] ${oldVersion} -> ${newVersion}\n`);
} else {
  process.stderr.write(`[bump-version] version unchanged: ${newVersion}\n`);
}

// stdout: ONLY the version string (callers capture this)
console.log(newVersion);
