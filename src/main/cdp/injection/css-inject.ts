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
  buildStyleExpression,
} from '../../../shared/injection-runtime';
import { mainWarn } from '../../logger';
import type { CdpSession } from '../cdp-client';

// ---------------------------------------------------------------------------
// Unified CSS injection (DreamSkin-aligned <style> element)
// ---------------------------------------------------------------------------

/**
 * Inject CSS via a `<style id="agentskin-style">` element (DreamSkin-aligned).
 *
 * 2026-09-01: This is the UNIFIED CSS injection path used by both engine-strategy
 * and cdp-strategy. It replaces the former adoptedStyleSheets-based injectCssAdopted
 * to eliminate dual-path coverage conflicts where two different injection mechanisms
 * ran sequentially on the same target.
 *
 * All CSS layers (palette + tokens + cosmetic + theme + custom) are concatenated
 * by the caller and injected as a single textContent write — the browser's native
 * CSS cascade resolves layer precedence by source order, exactly matching the
 * DreamSkin approach.
 *
 * Doubao recovery note: if Doubao strips the `<style>` element within ~50ms, the
 * post-verify recovery in cdp-fanout falls back to adoptedStyleSheet injection
 * for that specific re-inject attempt only.
 */
export async function injectCssStyle(session: CdpSession, css: string): Promise<boolean> {
  try {
    // buildStyleExpression creates/updates <style id="agentskin-style"> and sets
    // its textContent to the full CSS string. Returns 'ok:<ruleCount>' on success.
    const result = await session.evaluate(buildStyleExpression(css));
    if (!result.startsWith('ok:')) {
      mainWarn('Inject.CSS', `style-element returned non-ok: ${String(result).slice(0, 120)}`);
    }
    return result.startsWith('ok:');
  } catch (error) {
    mainWarn(
      'Inject.CSS',
      `style-element CDP evaluate failed (${css.length}B CSS): ${toMessage(error)}`,
    );
    return false;
  }
}

// ---------------------------------------------------------------------------
// adoptedStyleSheets CSS injection (Doubao recovery / legacy layers)
// ---------------------------------------------------------------------------

/**
 * Inject CSS as an unnamed owned adoptedStyleSheet.
 *
 * @deprecated 2026-09-01 — Use {@link injectCssStyle} instead. Retained ONLY for
 * Doubao-specific post-verify recovery in cdp-fanout (when `<style>` is stripped).
 * All primary injection paths now use the unified `<style>` element approach.
 *
 * Clears all previously-owned sheets first, then adds the new one.
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
