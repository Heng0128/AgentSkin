// SPDX-License-Identifier: MPL-2.0

/**
 * # Contract Tests — Data Model Round-Trip
 *
 * Verifies that key domain objects survive object → JSON → parse → deep-equal
 * round-tripping without data loss. These tests focus on data models that
 * cross the IPC boundary (main ⇄ renderer) or are persisted to disk,
 * ensuring the shared type contract remains stable.
 */

import { describe, expect, it } from 'vitest';
import type { ApplyRequest, ApplyResponse } from './types/ipc';
import type { InstalledTheme } from './types/theme';

// ---------------------------------------------------------------------------
// ApplyRequest — theme apply IPC contract
// ---------------------------------------------------------------------------

describe('ApplyRequest — round-trip', () => {
  it('preserves all fields including optional schemeId', () => {
    const req: ApplyRequest = {
      themeId: 'sakura-noir',
      schemeId: 'dark-contrast',
      appId: 'traework',
      port: 9336,
      restartExisting: true,
    };
    const roundTripped = JSON.parse(JSON.stringify(req)) as ApplyRequest;
    expect(roundTripped).toEqual(req);
  });

  it('handles minimal request (only required fields)', () => {
    const req: ApplyRequest = {
      themeId: 'ocean-dark',
      appId: 'codex',
    };
    const roundTripped = JSON.parse(JSON.stringify(req)) as ApplyRequest;
    expect(roundTripped).toEqual(req);
  });
});

// ---------------------------------------------------------------------------
// ApplyResponse — theme apply result contract
// ---------------------------------------------------------------------------

describe('ApplyResponse — round-trip', () => {
  it('preserves requires-restart with structured reason', () => {
    const res: ApplyResponse = {
      status: 'requires-restart',
      message: 'Agent is running without --remote-debugging-port',
      system: { platform: 'win32', apps: [] },
      restartReason: 'no-cdp',
    };
    const roundTripped = JSON.parse(JSON.stringify(res)) as ApplyResponse;
    expect(roundTripped).toEqual(res);
  });

  it('preserves skipped-concurrent status', () => {
    const res: ApplyResponse = {
      status: 'skipped-concurrent',
      message: 'Concurrent apply deduplicated against in-flight operation',
      system: { platform: 'win32', apps: [] },
    };
    const roundTripped = JSON.parse(JSON.stringify(res)) as ApplyResponse;
    expect(roundTripped).toEqual(res);
  });
});

// ---------------------------------------------------------------------------
// InstalledTheme — theme library entry
// ---------------------------------------------------------------------------

describe('InstalledTheme — round-trip', () => {
  it('preserves optional fields (colors, wallpaper, packageRoot)', () => {
    const theme: InstalledTheme = {
      id: 'sakura-noir',
      displayName: 'Sakura Noir',
      version: '2.1.0',
      author: 'studio',
      supportedAgents: ['traework', 'codex'],
      coverDataUrl: null,
      tagline: 'Cherry blossoms at midnight',
      colors: { background: '#0a0a0a', text: '#ffe0e0' },
      mode: 'dark',
      packageRoot: 'C:\\Users\\agent\\themes\\sakura-noir',
    };
    const roundTripped = JSON.parse(JSON.stringify(theme)) as InstalledTheme;
    expect(roundTripped).toEqual(theme);
  });
});
