// SPDX-License-Identifier: MPL-2.0

/**
 * Add SPDX license header to bridge theme CSS files.
 * All bridged themes use MPL-2.0 per their manifest.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const agents = ['codex', 'doubao', 'qoderwork', 'traework', 'workbuddy', 'zcode'];
const themes = ['github-noir', 'obsidian-poise', 'sweet-strawberry-code'];

const SPDX_HEADER = '/* SPDX-License-Identifier: MPL-2.0 */\n\n';

let updated = 0;
let skipped = 0;

for (const theme of themes) {
  for (const agent of agents) {
    const cssPath = join(root, 'themes', theme, 'assets', 'css', `${agent}.css`);
    try {
      const content = readFileSync(cssPath, 'utf8');
      if (content.startsWith('/* SPDX-License-Identifier:')) {
        skipped++;
        continue;
      }
      writeFileSync(cssPath, SPDX_HEADER + content);
      updated++;
      console.log(`  ✓ ${theme}/assets/css/${agent}.css`);
    } catch (err) {
      console.error(`  ✗ ${theme}/assets/css/${agent}.css — ${err.message}`);
    }
  }
}

console.log(`\nDone — ${updated} files updated, ${skipped} already had SPDX header.`);
