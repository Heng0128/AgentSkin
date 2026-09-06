// SPDX-License-Identifier: MPL-2.0

/**
 * # landmarks/index — barrel export for all adapter landmark definitions.
 *
 * Provides a unified registry mapping adapterId → { required, recommended }.
 * Import this to look up the built-in landmarks for any of the six adapters.
 */

import { codexLandmarks } from './codex.mjs';
import { doubaoLandmarks } from './doubao.mjs';
import { qoderworkLandmarks } from './qoderwork.mjs';
import { traeworkLandmarks } from './traework.mjs';
import { workbuddyLandmarks } from './workbuddy.mjs';
import { zcodeLandmarks } from './zcode.mjs';

/** Registry mapping adapterId to its landmark definition. */
export const LANDMARK_REGISTRY = Object.freeze({
  traework: traeworkLandmarks,
  qoderwork: qoderworkLandmarks,
  workbuddy: workbuddyLandmarks,
  doubao: doubaoLandmarks,
  codex: codexLandmarks,
  zcode: zcodeLandmarks,
});

/**
 * Look up the built-in landmarks for a given adapter.
 * @param {string} adapterId
 * @returns {{ required: { name: string, selectors: string[] }[], recommended: { name: string, selectors: string[] }[] } | undefined}
 */
export function getLandmarksForAdapter(adapterId) {
  return LANDMARK_REGISTRY[adapterId];
}

export default { LANDMARK_REGISTRY, getLandmarksForAdapter };
