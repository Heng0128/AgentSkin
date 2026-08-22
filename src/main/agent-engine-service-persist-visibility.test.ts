// SPDX-License-Identifier: MPL-2.0

/**
 * Persistence-failure observability tests for AgentEngineService.
 *
 * Scope: lock in the additive reliability signal introduced for the
 * in-memory/disk desync window (direction A — core-link reliability):
 *   - `lastPersistError()` returns the most recent failure message, or null
 *     after a successful write (does NOT change the swallow contract).
 *   - a `persist_failed` structured-log event is emitted on every failure so
 *     the desync window is observable before the threshold user notification.
 *
 * Execution detail (applyThemeFlow / restoreThemeFlow) is mocked, matching the
 * sibling orchestration tests. We only exercise the persistence path directly
 * via `reconcileActiveThemes`, which persists when it nulls an unavailable
 * active theme.
 */

import { writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentId } from '../shared/types';
import { AgentEngineService } from './agent-engine-service';
import { probeAppStatus } from './app-discovery';
import { appendLogLine, writeJsonAtomic } from './fs-utils';
import type { StructuredLogEvent } from './services/contracts';

// ---------------------------------------------------------------------------
// Module mocks — only discovery + fs-utils are relevant here.
// ---------------------------------------------------------------------------

vi.mock('./app-discovery', () => ({
  LivePortCache: class {
    private m = new Map<string, number>();
    get(a: string) {
      return this.m.get(a) ?? null;
    }
    set(a: string, p: number) {
      this.m.set(a, p);
    }
    clear(a: string) {
      this.m.delete(a);
    }
    clearAll() {
      this.m.clear();
    }
    size() {
      return this.m.size;
    }
  },
  reconcileZombiePorts: vi.fn(async () => {}),
  probeAppStatus: vi.fn(),
  resolveLivePort: vi.fn(async () => null),
  ensureCdpReady: vi.fn(async () => ({ ok: true, port: 9222, reason: null })),
  inferRestartReason: vi.fn(async () => ({ kind: 'not-installed' })),
}));
vi.mock('./fs-utils', () => ({
  writeJsonAtomic: vi.fn(async () => {}),
  appendLogLine: vi.fn(async () => {}),
}));
// The remaining deps are imported for type completeness but only discovery /
// fs-utils are exercised; provide harmless mocks so the module graph resolves.
vi.mock('./theme-apply-flow', () => ({ applyThemeFlow: vi.fn() }));
vi.mock('./theme-restore-flow', () => ({ restoreThemeFlow: vi.fn() }));
vi.mock('./wallpaper-injector', () => ({
  applyAgentWallpaperNow: vi.fn(async () => ({ ok: true })),
  applyWallpaperToAgent: vi.fn(async () => ({ ok: true })),
  injectAgentWallpaperFromApply: vi.fn(async () => {}),
  removeAgentVideoWallpaper: vi.fn(async () => {}),
  removeWallpaperFromAgent: vi.fn(async () => ({ ok: true })),
}));
vi.mock('./cdp/injection/engine-strategy', () => ({
  cleanupEngineInjectionForAgent: vi.fn(),
  disposeEngineInjectionState: vi.fn(),
}));
vi.mock('./wallpaper/injection-state', () => ({
  cleanupWallpaperStateForAgent: vi.fn(),
  disposeWallpaperInjectionState: vi.fn(),
}));
vi.mock('./wallpaper-self-heal', () => ({
  cleanupSelfHealForAgent: vi.fn(),
  disposeSelfHealState: vi.fn(),
}));
vi.mock('./theme/utils', () => ({ disposeThemeAssetCache: vi.fn() }));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_APP: AgentId = 'traework';

interface SettingsOverrides {
  port?: number | null;
}
function makeSettings(opts: SettingsOverrides = {}) {
  return {
    initialize: vi.fn(async () => {}),
    overridesFor: vi.fn(() => ({ appPath: null, port: opts.port ?? null })),
    wallpaper: vi.fn(() => ({ enabled: false, id: null, render: null })),
    agentWallpaper: vi.fn(() => ({ enabled: false })),
    toDto: vi.fn(() => ({})),
    setAppPath: vi.fn(async () => {}),
    setAppPort: vi.fn(async () => {}),
    setWallpaper: vi.fn(async () => {}),
    setAgentWallpaper: vi.fn(async () => {}),
    customThemeCss: vi.fn(() => ''),
    setCustomThemeCss: vi.fn(async () => {}),
    // biome-ignore lint/suspicious/noExplicitAny: test stub satisfies the contract structurally
  } as any;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('AgentEngineService persistence-failure observability', () => {
  let tmpDir: string;
  let stateFile: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    vi.mocked(probeAppStatus).mockResolvedValue({
      appId: TEST_APP,
      displayName: TEST_APP,
      installed: true,
      running: false,
      debugReady: false,
      port: null,
      activeThemeId: null,
    } as never);
    vi.mocked(writeJsonAtomic).mockResolvedValue(undefined);
    tmpDir = await mkdtemp(path.join(os.tmpdir(), 'agent-engine-persist-vis-'));
    stateFile = path.join(tmpDir, 'agent-state.json');
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(tmpDir, { recursive: true, force: true });
  });

  function makeService() {
    // biome-ignore lint/suspicious/noExplicitAny: library is never exercised here
    return new AgentEngineService({} as any, stateFile, makeSettings());
  }

  /** Write persisted state and initialize the service from it. */
  async function makeInitializedService(apps: Record<string, unknown>) {
    writeFileSync(stateFile, JSON.stringify({ version: 2, apps }), 'utf8');
    const svc = makeService();
    await svc.initialize();
    return svc;
  }

  /** Collect `[STRUCTURED]` events captured by the mocked `appendLogLine`. */
  function capturedStructured(): StructuredLogEvent[] {
    const events: StructuredLogEvent[] = [];
    for (const call of vi.mocked(appendLogLine).mock.calls) {
      const line = call[1] as string;
      if (line.includes('[STRUCTURED]|')) {
        const json = line.slice(line.indexOf('[STRUCTURED]|') + '[STRUCTURED]|'.length);
        events.push(JSON.parse(json) as StructuredLogEvent);
      }
    }
    return events;
  }

  it('reports null after a successful persist', async () => {
    // Initialize with a healthy state file; the initial load write succeeds.
    const svc = await makeInitializedService({});
    expect(svc.lastPersistError()).toBeNull();
  });

  it('captures the failure message and emits persist_failed on a write error', async () => {
    // Force the next persist (triggered by reconcileActiveThemes) to fail.
    vi.mocked(writeJsonAtomic).mockRejectedValueOnce(new Error('disk full'));

    const svc = await makeInitializedService({
      [TEST_APP]: { activeThemeId: 't1', port: null },
    });

    // t1 is not in the available set, so reconcileActiveThemes nulls it and
    // persists (the persist write fails).
    await svc.reconcileActiveThemes(new Set<string>());

    expect(svc.lastPersistError()).toBe('disk full');
    const failed = capturedStructured().filter((e) => e.type === 'persist_failed');
    expect(failed).toHaveLength(1);
    if (failed[0].type === 'persist_failed') {
      expect(failed[0].reason).toBe('disk full');
      expect(failed[0].agentId).toBe('*');
    }
  });

  it('clears the failure signal after a subsequent successful persist', async () => {
    vi.mocked(writeJsonAtomic).mockRejectedValueOnce(new Error('disk full'));

    // First service: the persist fails, so the on-disk state file still holds
    // t1 (the failed write never reached disk).
    const svc1 = await makeInitializedService({
      [TEST_APP]: { activeThemeId: 't1', port: null },
    });
    await svc1.reconcileActiveThemes(new Set<string>());
    expect(svc1.lastPersistError()).toBe('disk full');

    // Second service from the same (unchanged) state file, with a working
    // write: the persist now succeeds and the flag is cleared.
    vi.mocked(writeJsonAtomic).mockResolvedValue(undefined);
    const svc2 = await makeInitializedService({
      [TEST_APP]: { activeThemeId: 't1', port: null },
    });
    await svc2.reconcileActiveThemes(new Set<string>());
    expect(svc2.lastPersistError()).toBeNull();
  });
});
