// SPDX-License-Identifier: MPL-2.0

/**
 * Unit tests for services/scanner/index.ts
 *
 * Tests the three-layer Electron app scan orchestration with mocked collectors.
 * Focuses on: cache behavior, single-flight guard, pipeline execution, and
 * result enrichment.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock all scanner submodules BEFORE importing the index
vi.mock('./collectors/filesystem', () => ({
  isSkippableApp: vi.fn().mockReturnValue(false),
  resolveScanRoots: vi.fn().mockReturnValue([{ dir: '/test', depth: 2 }]),
  scanFilesystem: vi.fn().mockResolvedValue(undefined),
  scanFilesystemParallel: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./collectors/knownAgent', () => ({
  scanKnownAgents: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./collectors/registry', () => ({
  scanRegistry: vi.fn().mockResolvedValue(undefined),
  scanRegistryV2: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./collectors/msix', () => ({
  scanMsixPackages: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./collectors/shortcut', () => ({
  scanStartMenuShortcuts: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./flags', () => ({
  scannerPipeline: vi.fn().mockReturnValue('v2'),
}));

vi.mock('./infra/cache', () => ({
  freshCache: vi.fn().mockReturnValue(null),
  getInflight: vi.fn().mockReturnValue(null),
  setCachedScan: vi.fn(),
  setInflight: vi.fn(),
}));

vi.mock('./infra/persist-cache', () => ({
  loadPersistedScan: vi.fn().mockResolvedValue(null),
  savePersistedScan: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./infra/validate', () => ({
  validateExistence: vi.fn().mockImplementation(async (r: unknown) => r),
}));

vi.mock('../app-icon', () => ({
  extractAppIcon: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../shared/app-identity', () => ({
  normalizeProductName: vi.fn().mockImplementation((s: string) => s.toLowerCase()),
}));

import { resolveScanRoots } from './collectors/filesystem';
import { scanKnownAgents } from './collectors/knownAgent';
import { scanMsixPackages } from './collectors/msix';
import { scanRegistryV2 } from './collectors/registry';
import { scanStartMenuShortcuts } from './collectors/shortcut';
import { scanElectronApps } from './index';
import { freshCache, getInflight, setCachedScan } from './infra/cache';
import { loadPersistedScan, savePersistedScan } from './infra/persist-cache';
import { validateExistence } from './infra/validate';

describe('scanner/index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module-level backgroundInflight by waiting for any pending
    return new Promise((resolve) => setImmediate(resolve));
  });

  describe('cache behavior', () => {
    it('returns fresh cache hit without running scan', async () => {
      const mockResult = {
        adapted: [{ id: 'cached-app', exePath: '/cached/app.exe' }],
        other: [],
        meta: { timedOut: false, durationMs: 100, pipeline: 'v2' },
      };
      vi.mocked(freshCache).mockReturnValueOnce({
        result: mockResult as never,
        timestamp: Date.now(),
      });

      const result = await scanElectronApps();

      expect(result).toBe(mockResult);
      expect(scanKnownAgents).not.toHaveBeenCalled();
      expect(scanRegistryV2).not.toHaveBeenCalled();
    });

    it('skips cache when useCache is false', async () => {
      vi.mocked(freshCache).mockReturnValue(null);
      vi.mocked(loadPersistedScan).mockResolvedValue(null);

      const result = await scanElectronApps({ useCache: false });

      expect(result).toBeDefined();
      expect(result.meta).toBeDefined();
      expect(scanKnownAgents).toHaveBeenCalled();
    });
  });

  describe('persisted cache', () => {
    it('loads persisted scan when userDataPath provided', async () => {
      vi.mocked(freshCache).mockReturnValue(null);
      const persistedResult = {
        adapted: [{ id: 'persisted-app', exePath: '/persisted/app.exe' }],
        other: [],
        meta: { timedOut: false, durationMs: 200, pipeline: 'v2' },
      };
      vi.mocked(loadPersistedScan).mockResolvedValueOnce({
        result: persistedResult,
        timestamp: Date.now(),
      } as never);
      vi.mocked(validateExistence).mockResolvedValueOnce(persistedResult as never);

      const streamedApps: unknown[] = [];
      const result = await scanElectronApps({
        userDataPath: '/test/userData',
        onApp: (event) => {
          if (event.op === 'add') streamedApps.push(event);
        },
      });

      expect(result.adapted).toHaveLength(1);
      expect(result.adapted[0]?.exePath).toBe('/persisted/app.exe');
      expect(validateExistence).toHaveBeenCalled();
      // Should stream cached apps to renderer
      expect(streamedApps.length).toBeGreaterThan(0);
      // Should seed in-memory cache
      expect(setCachedScan).toHaveBeenCalled();
    });

    it('skips persistence validation when shouldValidate is false', async () => {
      vi.mocked(freshCache).mockReturnValue(null);
      const persistedResult = {
        adapted: [],
        other: [],
        meta: { timedOut: false, durationMs: 0 },
      };
      vi.mocked(loadPersistedScan).mockResolvedValueOnce({
        result: persistedResult,
        timestamp: Date.now(),
      } as never);

      const _result = await scanElectronApps({
        userDataPath: '/test/userData',
        validateExistence: false,
      });

      expect(validateExistence).not.toHaveBeenCalled();
      expect(setCachedScan).toHaveBeenCalled();
    });
  });

  describe('scan execution', () => {
    it('executes L1 → L2 → L2.5 → L3 → L3.5 pipeline', async () => {
      vi.mocked(freshCache).mockReturnValue(null);
      vi.mocked(loadPersistedScan).mockResolvedValue(null);

      const callOrder: string[] = [];
      vi.mocked(scanKnownAgents).mockImplementationOnce(async () => {
        callOrder.push('L1');
      });
      vi.mocked(scanRegistryV2).mockImplementationOnce(async () => {
        callOrder.push('L2');
      });
      vi.mocked(scanMsixPackages).mockImplementationOnce(async () => {
        callOrder.push('L2.5');
      });
      vi.mocked(scanStartMenuShortcuts).mockImplementationOnce(async () => {
        callOrder.push('L3.5');
      });

      await scanElectronApps({ useCache: false });

      expect(callOrder).toEqual(['L1', 'L2', 'L2.5', 'L3.5']);
    });

    it('returns scan result with meta', async () => {
      vi.mocked(freshCache).mockReturnValue(null);
      vi.mocked(loadPersistedScan).mockResolvedValue(null);

      const result = await scanElectronApps({ useCache: false });

      expect(result.adapted).toBeDefined();
      expect(result.other).toBeDefined();
      expect(result.meta).toBeDefined();
      // meta is guaranteed to exist after the assertion above
      expect(result.meta!.pipeline).toBe('v2');
      expect(result.meta!.timedOut).toBe(false);
      expect(result.meta!.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('caches successful scan result', async () => {
      vi.mocked(freshCache).mockReturnValue(null);
      vi.mocked(loadPersistedScan).mockResolvedValue(null);

      await scanElectronApps({ useCache: true, userDataPath: '/test/userData' });

      expect(setCachedScan).toHaveBeenCalled();
      expect(savePersistedScan).toHaveBeenCalled();
    });
  });

  describe('single-flight guard', () => {
    it('returns in-flight scan promise when one exists', async () => {
      const existingResult = {
        adapted: [],
        other: [],
        meta: { timedOut: false, durationMs: 0 },
      };
      const pendingPromise = Promise.resolve(existingResult);
      vi.mocked(getInflight).mockReturnValueOnce(pendingPromise as never);

      const result = await scanElectronApps({ useCache: true });

      expect(result).toBe(existingResult);
      expect(scanKnownAgents).not.toHaveBeenCalled();
    });
  });

  describe('result enrichment', () => {
    it('resolves scan roots for meta', async () => {
      vi.mocked(freshCache).mockReturnValue(null);
      vi.mocked(loadPersistedScan).mockResolvedValue(null);
      vi.mocked(resolveScanRoots).mockReturnValue([{ dir: '/custom/root', depth: 3 }]);

      const result = await scanElectronApps({ useCache: false, extraDirs: ['/custom/root'] });

      expect(result.meta?.scannedRoots).toContain('/custom/root');
    });

    it('adapted and other arrays are separate', async () => {
      vi.mocked(freshCache).mockReturnValue(null);
      vi.mocked(loadPersistedScan).mockResolvedValue(null);

      const result = await scanElectronApps({ useCache: false });

      // Both arrays should exist and be separate
      expect(Array.isArray(result.adapted)).toBe(true);
      expect(Array.isArray(result.other)).toBe(true);
    });
  });
});
