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
import type { PerformanceStep, ThemeApplyTrace } from '../main/services/performance/types';
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

// ---------------------------------------------------------------------------
// ThemeApplyTrace — performance trace record
// ---------------------------------------------------------------------------

describe('ThemeApplyTrace — round-trip', () => {
  it('preserves nested steps and device info', () => {
    const trace: ThemeApplyTrace = {
      id: 'apply_003',
      agentId: 'traework',
      themeId: 'sakura-noir',
      startedAt: 1000,
      finishedAt: 1850,
      duration: 850,
      success: true,
      steps: [
        {
          name: 'resolveTheme',
          startedAt: 1000,
          duration: 50,
          success: true,
          children: [
            {
              name: 'readManifest',
              startedAt: 1000,
              duration: 20,
              success: true,
              parentId: 'resolveTheme',
            },
          ],
        },
        { name: 'connectCdp', startedAt: 1050, duration: 120, success: true },
      ],
      device: {
        platform: 'win32',
        arch: 'x64',
        cpus: 16,
        totalMemory: 32768,
        freeMemory: 16384,
        electronVersion: '37.0.0',
      },
    };
    const roundTripped = JSON.parse(JSON.stringify(trace)) as ThemeApplyTrace;
    expect(roundTripped).toEqual(trace);
  });

  it('preserves error state and failed steps', () => {
    const trace: ThemeApplyTrace = {
      id: 'apply_004',
      agentId: 'codex',
      startedAt: 2000,
      finishedAt: 2100,
      duration: 100,
      success: false,
      steps: [
        {
          name: 'connectCdp',
          startedAt: 2000,
          duration: 100,
          success: false,
          error: 'CDP connection failed',
        },
      ],
      error: 'CDP connection failed',
      device: {
        platform: 'darwin',
        arch: 'arm64',
        cpus: 10,
        totalMemory: 16384,
        freeMemory: 8192,
        electronVersion: '37.0.0',
      },
    };
    const roundTripped = JSON.parse(JSON.stringify(trace)) as ThemeApplyTrace;
    expect(roundTripped).toEqual(trace);
  });
});

// ---------------------------------------------------------------------------
// PerformanceStep — individual step within a trace
// ---------------------------------------------------------------------------

describe('PerformanceStep — round-trip', () => {
  it('preserves sub-step parentId linkage', () => {
    const step: PerformanceStep = {
      name: 'injectCss',
      startedAt: 1200,
      duration: 300,
      success: true,
      children: [
        { name: 'palette', startedAt: 1200, duration: 50, success: true, parentId: 'injectCss' },
        { name: 'tokens', startedAt: 1250, duration: 80, success: true, parentId: 'injectCss' },
      ],
    };
    const roundTripped = JSON.parse(JSON.stringify(step)) as PerformanceStep;
    expect(roundTripped).toEqual(step);
  });
});
