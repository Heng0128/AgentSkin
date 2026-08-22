// SPDX-License-Identifier: MPL-2.0

/**
 * # injection/css-inject
 *
 * CSS injection helpers using adoptedStyleSheets. Both unnamed owned-sheet
 * and named-layer variants are supported.
 *
 * Extracted from the split of {@link ./shared}.
 */

import { toMessage } from '../../../shared/errors';
import {
  buildAdoptLayerExpression,
  buildAdoptOwnedSheetExpression,
} from '../../../shared/injection-runtime';
import { mainWarn } from '../../logger';
import type { CdpSession } from '../cdp-client';

// ---------------------------------------------------------------------------
// adoptedStyleSheets CSS injection
// ---------------------------------------------------------------------------

/**
 * Inject CSS as an unnamed owned adoptedStyleSheet.
 * Clears all previously-owned sheets first, then adds the new one.
 * Delegates to `buildAdoptOwnedSheetExpression` in the shared kernel.
 */
export async function injectCssAdopted(session: CdpSession, css: string): Promise<boolean> {
  try {
    const result = await session.evaluate(buildAdoptOwnedSheetExpression(css));
    if (!result.startsWith('ok:')) {
      mainWarn('Inject.CSS', `adopt-owned returned non-ok: ${String(result).slice(0, 120)}`);
    }
    return result.startsWith('ok:');
  } catch (error) {
    mainWarn(
      'Inject.CSS',
      `adopt-owned CDP evaluate failed (${css.length}B CSS): ${toMessage(error)}`,
    );
    return false;
  }
}

/**
 * Inject a single named CSS layer as an adoptedStyleSheet.
 * Each layer is tagged with __agentskin_layer for independent lifecycle management.
 * Delegates to `buildAdoptLayerExpression` in the shared injection kernel
 * so the adoption logic is defined exactly once across the codebase.
 */
export async function injectCssLayer(
  session: CdpSession,
  layerName: string,
  css: string,
): Promise<boolean> {
  try {
    const result = await session.evaluate(buildAdoptLayerExpression(layerName, css));
    if (!result.startsWith('ok:')) {
      mainWarn(
        'Inject.CSS',
        `adopt-layer [${layerName}] returned non-ok: ${String(result).slice(0, 120)}`,
      );
    }
    return result.startsWith('ok:');
  } catch (error) {
    mainWarn(
      'Inject.CSS',
      `adopt-layer [${layerName}] CDP evaluate failed (${css.length}B CSS): ${toMessage(error)}`,
    );
    return false;
  }
}
