// SPDX-License-Identifier: MPL-2.0

/**
 * Test helpers for deep-core unit tests.
 *
 * deep-core.mjs is a pure script (no import/export) designed to be concatenated
 * ahead of an adapter.mjs in a CDP Runtime.evaluate context. To test its classes
 * in Vitest (happy-dom), we read the source, eval it in the global scope, and
 * expose the classes for assertions.
 *
 * ## Instance-based API
 *
 * Since the static-to-instance refactor, SafeAttachShadowPatcher and
 * FragmentRegistry are no longer static. Tests hold an INSTANCE directly so
 * each test's registry is isolated from all others. A module-level singleton
 * is also returned so the "safe singleton patching" invariant (only one
 * patched Element.prototype.attachShadow per page) can be verified.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DEEP_CORE_SRC = readFileSync(join(here, '../../engines/shared/deep-core.mjs'), 'utf-8');

/**
 * Internal module-singleton state exposed for test assertions only.
 * These live at the module scope of the IIFE in deep-core.mjs (via the
 * new Function call). We cannot reach them directly, so the helpers
 * below use the class-level current-instance getter when available.
 */

/**
 * DeepCore test-kit: a single DeepCore instance plus its public handles.
 */
export interface DeepCoreHandles {
  /** The DeepCore instance itself. */
  instance: any;
  /**
   * The fragment registry bound to this DeepCore instance.
   * Call register / activate / deactivate / hotReplace / dispose on this
   * directly — exactly as the old static tests did.
   */
  fragmentRegistry: any;
  /**
   * The shadow patcher bound to this DeepCore instance.
   * Call install / uninstall on this directly.
   */
  shadowPatcher: any;
}

/**
 * Load deep-core classes into the current global scope.
 * Safe to call multiple times (idempotent via window guards).
 *
 * Uses `new Function` instead of `eval` because private class fields
 * (#inject, #orig, etc.) cannot cross the eval scope boundary in strict mode.
 * `new Function` creates a function in global scope where private fields work.
 *
 * Returns both the raw class references and a freshly-created DeepCore kit
 * for tests that exercise the instance-based API.
 */
export function loadDeepCore(): {
  SafeAttachShadowPatcher: any;
  FragmentRegistry: any;
  DeepCore: any;
  /** Create a new isolated DeepCore kit (instance + per-instance handles). */
  createDeepCore: (config?: any, ctx?: any) => DeepCoreHandles;
} {
  // Create a function from the source and execute it in global scope
  const fn = new Function(DEEP_CORE_SRC);
  fn.call(globalThis);

  const SafeAttachShadowPatcher = (window as any).SafeAttachShadowPatcher;
  const FragmentRegistry = (window as any).FragmentRegistry;
  const DeepCore = (window as any).DeepCore;

  /**
   * Create a fresh DeepCore instance. Because the idempotency guard
   * short-circuits re-entry of the IIFE, multiple createDeepCore() calls
   * inside one test file will all use the same underlying classes. State
   * isolation comes from the per-instance _fragmentRegistry and _shadowPatcher.
   */
  const createDeepCore = (config: any = {}, ctx: any = {}): DeepCoreHandles => {
    const instance = new DeepCore(
      { shadowMode: 'open-only', routes: [], fragments: {}, ...config },
      { agent: 'test', ...ctx },
    );
    return {
      instance,
      fragmentRegistry: (instance as any)._fragmentRegistry,
      shadowPatcher: (instance as any)._shadowPatcher,
    };
  };

  return {
    SafeAttachShadowPatcher,
    FragmentRegistry,
    DeepCore,
    createDeepCore,
  };
}

/**
 * Reset DOM state between tests.
 */
export function resetDom(): void {
  document.body.innerHTML = '';
  document.documentElement.className = '';
  // Reset adoptedStyleSheets
  document.adoptedStyleSheets = [];
  // Clear deep-core globals
  delete (globalThis as any).__AGENTSKIN_DEEP_CORE__;
  delete (globalThis as any).__agentskin_shadow_orig__;
  delete (window as any).__AGENTSKIN_DEEP_CORE__;
  delete (window as any).__agentskin_shadow_orig__;
  delete (window as any).DeepCore;
  delete (window as any).SafeAttachShadowPatcher;
  delete (window as any).FragmentRegistry;
  // 清除 IIFE 幂等守卫，确保下次 loadDeepCore() 能重新执行脚本
  delete (window as any).__AGENTSKIN_DEEP_CORE_LOADED__;
  // Reset history to default
  if (history.pushState !== History.prototype.pushState) {
    history.pushState = History.prototype.pushState;
    history.replaceState = History.prototype.replaceState;
  }
}
