// SPDX-License-Identifier: MPL-2.0
// One-shot: patch codex-root verification selector across all 15 built-in
// themes to tolerate Codex's hashed MainContentSurface class.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THEMES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'themes');
const OLD_LINES = [
  '            "name": "codex-root",',
  '            "any": [',
  '              "main.main-surface"',
  '            ]',
];
const NEW_LINES = [
  '            "name": "codex-root",',
  '            "any": [',
  '              "main.main-surface",',
  '              "main[class*=\'MainContentSurface\']"',
  '            ]',
];

let patched = 0;
for (const id of fs.readdirSync(THEMES_DIR)) {
  const manifestPath = path.join(THEMES_DIR, id, 'manifest.json');
  if (!fs.existsSync(manifestPath)) continue;
  const raw = fs.readFileSync(manifestPath, 'utf8');
  if (!raw.includes('"main.main-surface"')) continue;
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const OLD = OLD_LINES.join(eol);
  const NEW = NEW_LINES.join(eol);
  if (!raw.includes(OLD)) {
    console.error(`[patch] ${id}: codex-root block not found, skipping`);
    continue;
  }
  fs.writeFileSync(manifestPath, raw.replace(OLD, NEW), 'utf8');
  patched += 1;
  console.log(`[patch] ${id}: codex-root selector patched`);
}
console.log(`[patch] patched ${patched} theme manifests.`);