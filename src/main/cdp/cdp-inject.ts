// SPDX-License-Identifier: MPL-2.0

/**
 * # cdp-inject (barrel)
 *
 * Theme injection strategies via CDP. The implementation has been split into
 * focused modules under {@link ./injection/}:
 *
 *   - {@link ./injection/shared}          — shared helpers (hero blob transfer,
 *     CSS adoptedStyleSheets injection, verification, delay) and the
 *     `ThemeVerification` type. Used by both strategies.
 *   - {@link ./injection/cdp-strategy}    — simple adoptedStyleSheet + hero
 *     blob injection (`injectThemeViaCdp`). Used as a "hardening" pass after
 *     @agentskin/engine's applyTheme.
 *   - {@link ./injection/engine-strategy} — multi-layer engine injection
 *     (`injectThemeViaEngine`) with persistence via
 *     `Page.addScriptToEvaluateOnNewDocument`, plus teardown
 *     (`removeEngineInjection`).
 *
 * This file re-exports the public API for backward compatibility — all
 * existing imports from `./cdp-inject` or `../cdp/cdp-inject` continue to
 * work unchanged.
 *
 * Wallpaper injection (video / image) lives in {@link ./cdp-wallpaper-inject}
 * and is not part of this barrel — it shares only the CDP session transport
 * and runs on a separate lifecycle.
 */

// ---------------------------------------------------------------------------
// Public API re-exports
// ---------------------------------------------------------------------------

export {
  type InjectThemeOptions,
  type InjectThemeResult,
  injectThemeViaCdp,
} from './injection/cdp-strategy';
export {
  type InjectEngineOptions,
  type InjectEngineResult,
  injectThemeViaEngine,
  removeEngineInjection,
} from './injection/engine-strategy';
export type { ThemeVerification } from './injection/shared';
