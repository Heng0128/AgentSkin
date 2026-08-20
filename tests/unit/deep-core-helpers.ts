// SPDX-License-Identifier: MPL-2.0

/**
 * Test helpers for deep-core unit tests.
 *
 * deep-core.mjs is a pure script (no import/export) designed to be concatenated
 * ahead of an adapter.mjs in a CDP Runtime.evaluate context. To test its classes
 * in Vitest (happy-dom), we read the source, eval it in the global scope, and
 * expose the classes for assertions.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const DEEP_CORE_SRC = readFileSync(join(here, '../../engines/shared/deep-core.mjs'), 'utf-8');

/**
 * Load deep-core classes into the current global scope.
 * Safe to call multiple times (idempotent via window guards).
 *
 * Uses `new Function` instead of `eval` because private class fields
 * (#inject, #orig, etc.) cannot cross the eval scope boundary in strict mode.
 * `new Function` creates a function in global scope where private fields work.
 */
export function loadDeepCore(): {
  SafeAttachShadowPatcher: any;
  FragmentRegistry: any;
  DeepCore: any;
} {
  // Create a function from the source and execute it in global scope
  const fn = new Function(DEEP_CORE_SRC);
  fn.call(globalThis);

  return {
    SafeAttachShadowPatcher: (window as any).SafeAttachShadowPatcher,
    FragmentRegistry: (window as any).FragmentRegistry,
    DeepCore: (window as any).DeepCore,
  } as {
    SafeAttachShadowPatcher: any;
    FragmentRegistry: any;
    DeepCore: any;
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
