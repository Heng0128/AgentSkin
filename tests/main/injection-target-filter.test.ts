// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from 'vitest';

// Mock @agentskin/engine so that filterTargets can be tested without booting
// the full engine runtime. We use `importOriginal` to preserve all real
// exports and only provide the connector symbols the engine needs — the
// pure `filterTargets` function only reads `type`/`url` from CdpTarget and
// never touches the engine, but the surrounding module code references
// THEME_EXTENSION, LEGACY_THEME_EXTENSION, getAdapter, etc.
vi.mock('@agentskin/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@agentskin/engine')>();
  return {
    ...actual,
    THEME_EXTENSION: '.agentskin-theme',
    LEGACY_THEME_EXTENSION: '.codex-theme',
  };
});

// Import AFTER mock so the module graph uses the mocked engine.
import type { CdpTarget } from '../../src/legacy/agentskin-core-runtime';
import {
  DEFAULT_INJECTION_BLOCKLIST,
  filterTargets,
} from '../../src/legacy/agentskin-core-runtime';

/**
 * Build a minimal CdpTarget for tests. Only `type` / `url` matter for the
 * filter, so the rest are filled with sensible defaults.
 */
function makeTarget(overrides: Partial<CdpTarget> = {}): CdpTarget {
  return {
    id: 'target-1',
    type: 'page',
    url: 'https://app.example.com/main',
    title: 'Test',
    webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/1',
    ...overrides,
  };
}

describe('filterTargets', () => {
  // --- 1. Normal page target is not filtered out ---
  it('keeps a normal page target with a regular URL', () => {
    const targets: CdpTarget[] = [
      makeTarget({ id: 'main', type: 'page', url: 'https://app.example.com/main' }),
    ];
    const result = filterTargets(targets);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('main');
  });

  // --- 2. Non-page type targets are skipped ---
  it('skips targets whose type is not page (e.g. service_worker)', () => {
    const targets: CdpTarget[] = [
      makeTarget({ id: 'worker', type: 'service_worker', url: 'sw.js' }),
      makeTarget({ id: 'main', type: 'page', url: 'https://app.example.com' }),
    ];
    const result = filterTargets(targets);
    expect(result.map((t) => t.id)).toEqual(['main']);
  });

  it('skips shared_worker, background_page, and browser targets', () => {
    const targets: CdpTarget[] = [
      makeTarget({ id: 'sw', type: 'service_worker' }),
      makeTarget({ id: 'shared', type: 'shared_worker' }),
      makeTarget({ id: 'bg', type: 'background_page' }),
      makeTarget({ id: 'browser', type: 'browser' }),
    ];
    expect(filterTargets(targets)).toEqual([]);
  });

  // --- 3. URL blocklist: avatar-overlay ---
  it('skips a target whose URL contains "avatar-overlay"', () => {
    const targets: CdpTarget[] = [
      makeTarget({ id: 'overlay', type: 'page', url: 'https://app.example.com/avatar-overlay' }),
      makeTarget({ id: 'main', type: 'page', url: 'https://app.example.com/main' }),
    ];
    const result = filterTargets(targets);
    expect(result.map((t) => t.id)).toEqual(['main']);
  });

  // --- 4. URL blocklist: pet / settings / modal ---
  it('skips a target whose URL contains "pet" (desktop pet window)', () => {
    const targets: CdpTarget[] = [
      makeTarget({ id: 'pet', type: 'page', url: 'https://app.example.com/pet' }),
    ];
    expect(filterTargets(targets)).toEqual([]);
  });

  it('skips a target whose URL contains "settings"', () => {
    const targets: CdpTarget[] = [
      makeTarget({ id: 'settings', type: 'page', url: 'https://app.example.com/settings' }),
    ];
    expect(filterTargets(targets)).toEqual([]);
  });

  it('skips a target whose URL contains "modal"', () => {
    const targets: CdpTarget[] = [
      makeTarget({ id: 'modal', type: 'page', url: 'https://app.example.com/modal' }),
    ];
    expect(filterTargets(targets)).toEqual([]);
  });

  // --- 5. Whitelist overrides blacklist ---
  it('keeps a blocklisted target when its URL matches the allowlist', () => {
    const targets: CdpTarget[] = [
      makeTarget({ id: 'pet', type: 'page', url: 'https://app.example.com/pet?override=1' }),
      makeTarget({ id: 'main', type: 'page', url: 'https://app.example.com/main' }),
    ];
    const result = filterTargets(targets, { allowlist: [/pet/] });
    expect(result.map((t) => t.id)).toContain('pet');
    expect(result.map((t) => t.id)).toContain('main');
  });

  // --- 6. Empty target list → no error, empty result ---
  it('returns an empty array when given an empty target list', () => {
    expect(filterTargets([])).toEqual([]);
  });

  // --- 7. Undefined-type targets with http(s)/file URLs are treated as pages ---
  it('accepts targets with undefined type when URL has http/https/file scheme', () => {
    const targets: CdpTarget[] = [
      makeTarget({ id: 'typeless-http', type: undefined, url: 'http://localhost/app' }),
      makeTarget({ id: 'typeless-https', type: undefined, url: 'https://localhost/app' }),
      makeTarget({ id: 'typeless-file', type: undefined, url: 'file:///C:/app/index.html' }),
    ];
    const result = filterTargets(targets);
    expect(result.map((t) => t.id)).toEqual(['typeless-http', 'typeless-https', 'typeless-file']);
  });

  it('rejects undefined-type targets with non-page URLs (devtools, ws, chrome)', () => {
    const targets: CdpTarget[] = [
      makeTarget({ id: 'devtools', type: undefined, url: 'devtools://devtools/bundled' }),
      makeTarget({ id: 'ws', type: undefined, url: 'ws://127.0.0.1:9222' }),
      makeTarget({ id: 'chrome', type: undefined, url: 'chrome-devtools://devtools' }),
    ];
    expect(filterTargets(targets)).toEqual([]);
  });

  // --- 8. Empty allowlist does not accidentally keep everything ---
  it('an empty allowlist does not change blocklist behavior', () => {
    const targets: CdpTarget[] = [
      makeTarget({ id: 'pet', type: 'page', url: 'https://app.example.com/pet' }),
      makeTarget({ id: 'main', type: 'page', url: 'https://app.example.com/main' }),
    ];
    const result = filterTargets(targets, { allowlist: [] });
    expect(result.map((t) => t.id)).toEqual(['main']);
  });

  // --- 9. Custom blocklist override replaces default ---
  it('uses caller-supplied blocklist instead of the default', () => {
    const targets: CdpTarget[] = [
      makeTarget({ id: 'block-me', type: 'page', url: 'https://app.example.com/secret' }),
      makeTarget({ id: 'pet', type: 'page', url: 'https://app.example.com/pet' }),
      makeTarget({ id: 'main', type: 'page', url: 'https://app.example.com/main' }),
    ];
    // Only block /secret — "pet" should now pass (no default blocklist).
    const result = filterTargets(targets, { blocklist: [/secret/], allowlist: [] });
    expect(result.map((t) => t.id)).toEqual(['pet', 'main']);
  });

  // --- 10. Default blocklist contents are sane ---
  it('DEFAULT_INJECTION_BLOCKLIST matches the four documented patterns', () => {
    expect(DEFAULT_INJECTION_BLOCKLIST).toHaveLength(4);
    // Spot-check each pattern
    expect(DEFAULT_INJECTION_BLOCKLIST.some((p) => p.test('avatar-overlay'))).toBe(true);
    expect(DEFAULT_INJECTION_BLOCKLIST.some((p) => p.test('PET'))).toBe(true);
    expect(DEFAULT_INJECTION_BLOCKLIST.some((p) => p.test('Settings'))).toBe(true);
    expect(DEFAULT_INJECTION_BLOCKLIST.some((p) => p.test('Modal'))).toBe(true);
  });

  // --- 11. filterTargets does not mutate the input array ---
  it('does not mutate the original target array', () => {
    const targets: CdpTarget[] = [
      makeTarget({ id: 'worker', type: 'service_worker' }),
      makeTarget({ id: 'main', type: 'page', url: 'https://app.example.com' }),
    ];
    const snapshot = [...targets];
    filterTargets(targets);
    expect(targets).toEqual(snapshot);
  });

  // --- 12. Multiple valid page targets pass through ---
  it('keeps all valid page targets that do not match the blocklist', () => {
    const targets: CdpTarget[] = [
      makeTarget({ id: 'a', type: 'page', url: 'https://a.example.com' }),
      makeTarget({ id: 'b', type: 'page', url: 'https://b.example.com' }),
      makeTarget({ id: 'c', type: 'page', url: 'https://c.example.com' }),
    ];
    const result = filterTargets(targets);
    expect(result.map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });
});
