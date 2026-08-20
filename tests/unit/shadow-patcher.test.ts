// SPDX-License-Identifier: MPL-2.0

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadDeepCore, resetDom } from './deep-core-helpers';

const { SafeAttachShadowPatcher } = loadDeepCore();

describe('SafeAttachShadowPatcher', () => {
  let originalAttachShadow: typeof Element.prototype.attachShadow;

  beforeEach(() => {
    resetDom();
    originalAttachShadow = Element.prototype.attachShadow;
  });

  afterEach(() => {
    // Ensure patch is always cleaned up
    if (SafeAttachShadowPatcher.isPatched) {
      SafeAttachShadowPatcher.uninstall();
    }
    resetDom();
  });

  it('should install the patch and set isPatched flag', () => {
    SafeAttachShadowPatcher.install(() => {});
    expect(SafeAttachShadowPatcher.isPatched).toBe(true);
  });

  it('should be idempotent — second install does not double-patch', () => {
    const firstFn = () => {};
    const secondFn = () => {};
    SafeAttachShadowPatcher.install(firstFn);
    const origAfterFirst = Element.prototype.attachShadow;

    SafeAttachShadowPatcher.install(secondFn);
    const origAfterSecond = Element.prototype.attachShadow;

    // Should be the same patched function (not nested)
    expect(origAfterFirst).toBe(origAfterSecond);
  });

  it('should call injectFn when a new shadow root is created', () => {
    const injectedRoots: any[] = [];
    SafeAttachShadowPatcher.install((root) => injectedRoots.push(root));

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });

    expect(injectedRoots.length).toBe(1);
    expect(injectedRoots[0]).toBe(root);
  });

  it('should save original reference to window.__agentskin_shadow_orig__', () => {
    SafeAttachShadowPatcher.install(() => {});
    expect((window as any).__agentskin_shadow_orig__).toBe(originalAttachShadow);
  });

  it('should uninstall and restore original attachShadow', () => {
    SafeAttachShadowPatcher.install(() => {});
    expect(Element.prototype.attachShadow).not.toBe(originalAttachShadow);

    SafeAttachShadowPatcher.uninstall();
    expect(Element.prototype.attachShadow).toBe(originalAttachShadow);
    expect(SafeAttachShadowPatcher.isPatched).toBe(false);
  });

  it('should clean up __agentskin_shadow_orig__ on uninstall', () => {
    SafeAttachShadowPatcher.install(() => {});
    expect((window as any).__agentskin_shadow_orig__).toBeDefined();

    SafeAttachShadowPatcher.uninstall();
    expect((window as any).__agentskin_shadow_orig__).toBeUndefined();
  });

  it('should handle uninstall when not installed (no-op)', () => {
    expect(() => SafeAttachShadowPatcher.uninstall()).not.toThrow();
    expect(SafeAttachShadowPatcher.isPatched).toBe(false);
  });

  it('should handle injectFn throwing gracefully', () => {
    SafeAttachShadowPatcher.install(() => {
      throw new Error('inject failed');
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    // Should not throw even if injectFn throws
    expect(() => host.attachShadow({ mode: 'open' })).not.toThrow();
  });
});
