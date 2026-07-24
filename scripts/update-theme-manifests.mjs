// SPDX-License-Identifier: MPL-2.0
//
// # update-theme-manifests.mjs
//
// One-shot maintenance script that rewrites every themes/<id>/manifest.json:
//
//   1. Adds the `hero` field (assets/hero.<ext>) when the artwork exists.
//   2. Replaces each target's `verification` with selectors that match the
//      real application DOM (per @codedrobe/core v0.6.0 adapter landmarks).
//      The old anchors (.solo-home / .home-hero / .monaco-workbench) do not
//      exist in TRAE SOLO's solo-lite shell or QoderWork's agents layout,
//      which made the engine's DOM preflight reject every apply with
//      CODEDROBE_DOM_INCOMPATIBLE.
//   3. Bumps the theme version to 2.0.0 so the version-aware seeder
//      reinstalls the fixed packages over older copies persisted in userData.
//
// Usage:  node scripts/update-theme-manifests.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const THEMES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'themes');

/**
 * Verification anchors per agent, mirroring the adapter landmarks in
 * @codedrobe/core (traework.mjs / qoderwork.mjs / workbuddy.mjs).
 * `required` uses the route/layout containers that are always rendered and
 * visible in the main window; everything else is `recommended` (non-blocking).
 */
const VERIFICATION = {
  traework: {
    required: [
      { name: 'solo-shell', any: ['.panel-container', '.solo-lite-layout'] },
    ],
    recommended: [
      { name: 'task-sidebar', any: ['.task-list-base', '.task-list-panel'] },
      { name: 'composer', any: [".chat-input-v2-input-box-editable[contenteditable='true']"] },
    ],
  },
  qoderwork: {
    required: [
      { name: 'agents-root', any: ['.agents-layout-root'] },
    ],
    recommended: [
      { name: 'sidebar', any: ['.agents-sidebar', '[data-resizable-sidebar]'] },
      { name: 'workspace', any: ['.agents-content-area', '.agents-layout-body'] },
      { name: 'composer', any: [".chat-input-editor-text[contenteditable='true']"] },
    ],
  },
  workbuddy: {
    required: [
      { name: 'teams-root', any: ['.teams-container'] },
    ],
    recommended: [
      { name: 'sidebar', any: ['.conversation-sidebar', '.conversation-list'] },
      { name: 'workspace', any: ['.teams-main-content', '.main-content', '.chat-container'] },
      { name: 'composer', any: ["[role='textbox'][contenteditable='true']", ".wb-home-composer [contenteditable='true']"] },
    ],
  },
};

const HERO_CANDIDATES = ['hero.png', 'hero.webp', 'hero.jpg', 'hero.jpeg'];

let updated = 0;
for (const id of fs.readdirSync(THEMES_DIR).sort()) {
  const themeDir = path.join(THEMES_DIR, id);
  const manifestPath = path.join(themeDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) continue;

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  // 1. hero artwork reference
  let hero = null;
  for (const candidate of HERO_CANDIDATES) {
    if (fs.existsSync(path.join(themeDir, 'assets', candidate))) {
      hero = `assets/${candidate}`;
      break;
    }
  }
  if (hero) manifest.hero = hero;
  else delete manifest.hero;

  // 2. verification anchors aligned with the real DOM
  if (manifest.targets && typeof manifest.targets === 'object') {
    for (const [agent, target] of Object.entries(manifest.targets)) {
      if (VERIFICATION[agent]) {
        target.verification = VERIFICATION[agent];
      }
    }
  }

  // 3. version bump so persisted copies get re-seeded
  manifest.version = '2.0.0';

  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  updated += 1;
  console.log(`[update-theme-manifests] ${id} → v2.0.0 hero=${hero ?? 'none'}`);
}
console.log(`[update-theme-manifests] updated ${updated} manifests.`);
