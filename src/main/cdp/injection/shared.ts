// SPDX-License-Identifier: MPL-2.0

/**
 * # injection/shared
 *
 * Barrel module: re-exports the public API of the injection sub-modules
 * and owns the remaining helpers (verification, delay).
 *
 * For the focused sub-modules, see:
 *   - {@link ./types}       — ThemeVerification interface
 *   - {@link ./hero-inject} — hero image → Blob URL injection
 *   - {@link ./css-inject}  — adoptedStylesheets CSS injection
 */

import { toMessage } from '../../../shared/errors';
import { SHEET_OWNED_FLAG } from '../../../shared/injection-constants';
import { mainWarn } from '../../logger';
import type { CdpSession } from '../cdp-client';

// ===========================================================================
// Re-exports — sub-module public API (preserves existing import contracts)
// ===========================================================================

import type { ThemeVerification } from './types';

export { injectCssAdopted, injectCssLayer } from './css-inject';
export {
  injectHeroBlob,
  injectHeroFromDataUrl,
  transferHeroBase64,
} from './hero-inject';
export type { ThemeVerification } from './types';

// ===========================================================================
// Verification
// ===========================================================================

export async function verifyTheme(session: CdpSession): Promise<ThemeVerification | null> {
  try {
    const raw = await session.evaluate(`(() => {
      const rootCs = getComputedStyle(document.documentElement);
      const root = document.getElementById('root') || document.body;
      const rootBg = getComputedStyle(root).backgroundImage || '';
      const bodyBg = getComputedStyle(document.body).backgroundImage || '';
      const adopted = (document.adoptedStyleSheets || []).filter(s => s.${SHEET_OWNED_FLAG}).length;
      return JSON.stringify({
        accent: rootCs.getPropertyValue('--agentskin-accent').trim(),
        agentskinArt: rootCs.getPropertyValue('--agentskin-art').trim().slice(0, 60),
        heroBlobActive: rootBg.includes('blob:') || bodyBg.includes('blob:'),
        adoptedSheetCount: adopted,
      });
    })()`);

    return JSON.parse(raw) as ThemeVerification;
  } catch (error) {
    mainWarn('Inject.Verify', `theme-verify CDP evaluate failed: ${toMessage(error)}`);
    return null;
  }
}

// ===========================================================================
// Helpers
// ===========================================================================

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
