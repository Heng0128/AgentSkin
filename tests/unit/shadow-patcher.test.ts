// SPDX-License-Identifier: MPL-2.0

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadDeepCore, resetDom } from './deep-core-helpers';

const { SafeAttachShadowPatcher } = loadDeepCore();

describe('SafeAttachShadowPatcher', () => {
  let originalAttachShadow: typeof Element.prototype.attachShadow;
  let patcher: InstanceType<typeof SafeAttachShadowPatcher>;

  beforeEach(() => {
    resetDom();
    originalAttachShadow = Element.prototype.attachShadow;
    patcher = new SafeAttachShadowPatcher();
  });

  afterEach(() => {
    // Ensure patch is always cleaned up
    if (patcher.isPatched) {
      patcher.uninstall();
    }
    resetDom();
  });

  it('should install the patch and set isPatched flag', () => {
    patcher.install(() => {});
    expect(patcher.isPatched).toBe(true);
  });

  it('should be idempotent — second install does not double-patch', () => {
    const firstFn = () => {};
    const secondFn = () => {};
    patcher.install(firstFn);
    const origAfterFirst = Element.prototype.attachShadow;

    patcher.install(secondFn);
    const origAfterSecond = Element.prototype.attachShadow;

    // Should be the same patched function (not nested)
    expect(origAfterFirst).toBe(origAfterSecond);
  });

  it('should call injectFn when a new shadow root is created', () => {
    const injectedRoots: any[] = [];
    patcher.install((root) => injectedRoots.push(root));

    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });

    expect(injectedRoots.length).toBe(1);
    expect(injectedRoots[0]).toBe(root);
  });

  it('should save original reference to window.__agentskin_shadow_orig__', () => {
    patcher.install(() => {});
    expect((window as any).__agentskin_shadow_orig__).toBe(originalAttachShadow);
  });

  it('should uninstall and restore original attachShadow', () => {
    patcher.install(() => {});
    expect(Element.prototype.attachShadow).not.toBe(originalAttachShadow);

    patcher.uninstall();
    expect(Element.prototype.attachShadow).toBe(originalAttachShadow);
    expect(patcher.isPatched).toBe(false);
  });

  it('should clean up __agentskin_shadow_orig__ on uninstall', () => {
    patcher.install(() => {});
    expect((window as any).__agentskin_shadow_orig__).toBeDefined();

    patcher.uninstall();
    expect((window as any).__agentskin_shadow_orig__).toBeUndefined();
  });

  it('should handle uninstall when not installed (no-op)', () => {
    const freshPatcher = new SafeAttachShadowPatcher();
    expect(() => freshPatcher.uninstall()).not.toThrow();
    expect(freshPatcher.isPatched).toBe(false);
  });

  it('should handle injectFn throwing gracefully', () => {
    patcher.install(() => {
      throw new Error('inject failed');
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    // Should not throw even if injectFn throws
    expect(() => host.attachShadow({ mode: 'open' })).not.toThrow();
  });

  it('should allow a second patcher to take over the global patch', () => {
    const patcher1 = new SafeAttachShadowPatcher();
    const roots1: any[] = [];
    patcher1.install((root) => roots1.push(root));
    expect(patcher1.isPatched).toBe(true);

    const patcher2 = new SafeAttachShadowPatcher();
    const roots2: any[] = [];
    patcher2.install((root) => roots2.push(root));

    // patcher2 now owns the patch; patcher1 has released ownership
    expect(patcher2.isPatched).toBe(true);
    expect(patcher1.isPatched).toBe(false);

    // New shadow root should fire patcher2's callback, not patcher1's
    const host = document.createElement('div');
    document.body.appendChild(host);
    host.attachShadow({ mode: 'open' });

    expect(roots1.length).toBe(0);
    expect(roots2.length).toBe(1);

    patcher2.uninstall();
  });
});
