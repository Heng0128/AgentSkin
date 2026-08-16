// SPDX-License-Identifier: MPL-2.0

/**
 * # Batch 6 · Reseed built-in themes into the live userData library
 *
 * MANUAL maintenance test. Regenerates every installed `.agentskin-theme`
 * package (userData/themes) from the repo `themes/` directory so the codex-root
 * verification selector fix (hashed MainContentSurface fallback) is picked up
 * by the live-apply integration test.
 *
 * Run explicitly: `npx vitest run src/main/cdp/reseed-themes.manual.test.ts`
 */

import { it } from 'vitest';
import { ThemeInstaller } from '../catalog/theme-installer';
import { ThemePackageLoader } from '../catalog/theme-package-loader';
import { ThemeLibrary } from '../theme/store';

const THEMES_ROOT = 'C:/Users/snowb/AppData/Roaming/AgentSkin/themes';
const REPO_THEMES = 'C:/Users/snowb/Desktop/work/desktop-main/themes';

it('reseed built-in themes from repo themes/ into the live library', async () => {
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
}, 120000);
