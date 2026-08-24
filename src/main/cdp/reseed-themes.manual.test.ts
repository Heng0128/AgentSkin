// SPDX-License-Identifier: MPL-2.0

/**
 * # Batch 6 · Reseed built-in themes into the live userData library
 *
 * MANUAL maintenance test. Regenerates every installed `.agentskin-theme`
 * package (userData/themes) from the repo `themes/` directory so the codex-root
 * verification selector fix (hashed MainContentSurface fallback) is picked up
 * by the live-apply integration test.
 *
 * Run explicitly (manual gate): `AGENTSKIN_MANUAL=1 npx vitest run src/main/cdp/reseed-themes.manual.test.ts`
 * Without `AGENTSKIN_MANUAL=1` the test is skipped so `npm run check` never
 * rewrites the live userData theme library (the vitest `main` project glob
 * would otherwise collect `*.manual.test.ts`).
 *
 * Environment variables:
 *   AGENTSKIN_THEMES_PATH — override themes directory (default: ~/AppData/Roaming/AgentSkin/themes)
 *   AGENTSKIN_REPO_THEMES_PATH — override repo themes directory (default: <repo-root>/themes)
 */

import os from 'node:os';
import path from 'node:path';
import { it } from 'vitest';
import { ThemeInstaller } from '../catalog/theme-installer';
import { ThemePackageLoader } from '../catalog/theme-package-loader';
import { ThemeLibrary } from '../theme/store';

const THEMES_ROOT = process.env.AGENTSKIN_THEMES_PATH || path.join(os.homedir(), 'AppData', 'Roaming', 'AgentSkin', 'themes');
const REPO_THEMES = process.env.AGENTSKIN_REPO_THEMES_PATH || path.join(__dirname, '..', '..', '..', 'themes');
// Manual gate: only runs when explicitly requested via `AGENTSKIN_MANUAL=1`,
// so `npm run check` skips it (see header note).
const MANUAL = process.env.AGENTSKIN_MANUAL === '1';

it.skipIf(!MANUAL)(
  'reseed built-in themes from repo themes/ into the live library',
  async () => {
    const library = new ThemeLibrary(THEMES_ROOT);
    await library.initialize();
    const loader = new ThemePackageLoader(REPO_THEMES);
    const packages = await loader.scan();
    const installer = new ThemeInstaller(library);
    const installed = await installer.installAll(packages);
    console.log(`[reseed] installed ${installed.length} theme package(s)`);

    // Verify the codex-root selector fix landed in the default bundle.
    const bundle = (await library.find('sakura-noir')).bundle;
    const codexVerif = bundle.targets?.codex?.verification as
      | { required?: { name?: string; any?: string[] }[] }
      | undefined;
    console.log('[reseed] sakura-noir codex verification =', JSON.stringify(codexVerif));
    const any = codexVerif?.required?.[0]?.any ?? [];
    if (!any.some((s) => s.includes('MainContentSurface'))) {
      throw new Error('codex-root selector fix not present in installed bundle');
    }
  },
  120000,
);
