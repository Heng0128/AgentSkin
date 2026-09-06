// SPDX-License-Identifier: MPL-2.0

/**
 * # design-bridge
 *
 * One-way bridge layer (RC-04) that re-exports pure functions from the
 * scripts/ design-language and extended-colors modules. UI components import
 * from this bridge rather than reaching into scripts/ directly, preserving
 * the layered dependency direction (UI → shared → scripts-as-utility).
 *
 * This module is the **sole authorised import gateway** between src/ui/studio/
 * and the script-layer pure functions. Any new script-layer dependency must
 * be re-exported here first.
 */

export {
  motionMs,
  radiusPx,
  SHADOW_VALUES,
  SPACING_BASE,
  SPACING_MULTIPLIERS,
  shadowValue,
  spacingPx,
} from '../../../scripts/design-language.mjs';
export { autoOnColor, wcagCheck } from '../../../scripts/extended-colors.mjs';
export { hexToOklch, oklchToHex } from '../../../scripts/oklch-utils.mjs';
