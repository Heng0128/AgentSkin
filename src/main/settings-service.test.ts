// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getMainMessages } from '../shared/i18n';
import { AGENT_IDS, type AgentId } from '../shared/types';
import { normalizeRenderOptions, SettingsService } from './settings-service';

// ---------------------------------------------------------------------------
// Helpers — each test gets a fresh temp file so there is zero cross-test
// contamination. SettingsService reads/writes a single JSON file, so an
// OS temp dir is the only external dependency needed (no Electron mock).
// ---------------------------------------------------------------------------

let tmpDir: string;
let settingsFile: string;

async function makeService(preseed?: unknown): Promise<SettingsService> {
  if (preseed !== undefined) {
    await fs.writeFile(settingsFile, JSON.stringify(preseed), 'utf8');
  }
  const svc = new SettingsService(settingsFile);
  await svc.initialize();
  return svc;
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'settings-test-'));
  settingsFile = path.join(tmpDir, 'settings.json');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// initialize()
// ---------------------------------------------------------------------------

describe('SettingsService.initialize', () => {
  it('starts with empty defaults when file does not exist (fresh install)', async () => {
    const svc = await makeService();
    for (const appId of AGENT_IDS) {
      const o = svc.overridesFor(appId);
      expect(o.appPath).toBeNull();
      expect(o.port).toBeNull();
    }
  });

  it('loads a valid v2 settings file', async () => {
    const svc = await makeService({
      version: 2,
      apps: {
        workbuddy: { appPath: 'C:\\Apps\\WorkBuddy.exe', port: 9336 },
        traework: { appPath: null, port: null },
      },
      wallpaper: { enabled: true, id: 'wp-1' },
    });
    expect(svc.overridesFor('workbuddy').appPath).toBe('C:\\Apps\\WorkBuddy.exe');
    expect(svc.overridesFor('workbuddy').port).toBe(9336);
    expect(svc.overridesFor('traework').appPath).toBeNull();
    expect(svc.wallpaper().enabled).toBe(true);
    expect(svc.wallpaper().id).toBe('wp-1');
  });

  it('migrates v1 to v2 by dropping port overrides but keeping appPath', async () => {
    const svc = await makeService({
      version: 1,
      apps: {
        workbuddy: { appPath: 'C:\\WB.exe', port: 9336 },
        qoderwork: { appPath: null, port: 9337 },
      },
      wallpaper: { enabled: false, id: null },
    });
    // appPath preserved
    expect(svc.overridesFor('workbuddy').appPath).toBe('C:\\WB.exe');
    expect(svc.overridesFor('qoderwork').appPath).toBeNull();
    // port wiped (zombie port migration)
    expect(svc.overridesFor('workbuddy').port).toBeNull();
    expect(svc.overridesFor('qoderwork').port).toBeNull();
    // wallpaper preserved
    expect(svc.wallpaper().enabled).toBe(false);

    // The migrated file is persisted to disk as v2
    const raw = JSON.parse(await fs.readFile(settingsFile, 'utf8'));
    expect(raw.version).toBe(2);
    expect(raw.apps.workbuddy.port).toBeNull();
  });

  it('resets to defaults when file is corrupt JSON', async () => {
    await fs.writeFile(settingsFile, '{ this is not valid json', 'utf8');
    const svc = await makeService();
    for (const appId of AGENT_IDS) {
      expect(svc.overridesFor(appId).appPath).toBeNull();
      expect(svc.overridesFor(appId).port).toBeNull();
    }
  });

  it('resets to defaults when file has no apps field', async () => {
    const svc = await makeService({ version: 2, wallpaper: { enabled: true } });
    for (const appId of AGENT_IDS) {
      expect(svc.overridesFor(appId).appPath).toBeNull();
    }
  });

  it('ignores unknown version numbers (falls through to defaults)', async () => {
    const svc = await makeService({
      version: 99,
      apps: { workbuddy: { appPath: 'C:\\WB.exe', port: 8080 } },
    });
    // version !== 1 && version !== 2 → data stays at default empty
    expect(svc.overridesFor('workbuddy').appPath).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// overridesFor()
// ---------------------------------------------------------------------------

describe('SettingsService.overridesFor', () => {
  it('returns null for agents with no entry', async () => {
    const svc = await makeService();
    for (const appId of AGENT_IDS) {
      const o = svc.overridesFor(appId);
      expect(o).toEqual({ appPath: null, port: null });
    }
  });

  it('returns stored appPath and port', async () => {
    const svc = await makeService({
      version: 2,
      apps: { workbuddy: { appPath: '/path/to/app', port: 8080 } },
    });
    expect(svc.overridesFor('workbuddy')).toEqual({
      appPath: '/path/to/app',
      port: 8080,
    });
  });

  it('filters out invalid ports from persisted state', async () => {
    const svc = await makeService({
      version: 2,
      apps: {
        workbuddy: { appPath: null, port: 80 }, // below 1024
        traework: { appPath: null, port: 70000 }, // above 65535
        qoderwork: { appPath: null, port: 'not-a-number' }, // wrong type
        doubao: { appPath: null, port: 8080.5 }, // non-integer
      },
    });
    expect(svc.overridesFor('workbuddy').port).toBeNull();
    expect(svc.overridesFor('traework').port).toBeNull();
    expect(svc.overridesFor('qoderwork').port).toBeNull();
    expect(svc.overridesFor('doubao').port).toBeNull();
  });

  it('filters out empty-string appPath', async () => {
    const svc = await makeService({
      version: 2,
      apps: { workbuddy: { appPath: '', port: null } },
    });
    expect(svc.overridesFor('workbuddy').appPath).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// wallpaper() & agentWallpaper()
// ---------------------------------------------------------------------------

describe('SettingsService.wallpaper', () => {
  it('returns disabled defaults when no wallpaper set', async () => {
    const svc = await makeService();
    const wp = svc.wallpaper();
    expect(wp.enabled).toBe(false);
    expect(wp.id).toBeNull();
    for (const appId of AGENT_IDS) {
      expect(wp.agents[appId]).toEqual({ enabled: false, id: null });
    }
  });

  it('returns global wallpaper settings', async () => {
    const svc = await makeService({
      version: 2,
      apps: {},
      wallpaper: { enabled: true, id: 'cyber-neon' },
    });
    expect(svc.wallpaper().enabled).toBe(true);
    expect(svc.wallpaper().id).toBe('cyber-neon');
  });

  it('normalizes per-agent wallpaper settings', async () => {
    const svc = await makeService({
      version: 2,
      apps: {},
      wallpaper: {
        enabled: true,
        id: 'global-wp',
        agents: {
          workbuddy: { enabled: true, id: 'wp-wb' },
          traework: { enabled: false, id: null },
          qoderwork: { enabled: true, id: '' }, // empty id → null
        },
      },
    });
    const wp = svc.wallpaper();
    expect(wp.agents.workbuddy).toEqual({ enabled: true, id: 'wp-wb' });
    expect(wp.agents.traework).toEqual({ enabled: false, id: null });
    expect(wp.agents.qoderwork).toEqual({ enabled: true, id: null });
  });

  it('agentWallpaper returns defaults for unset agents', async () => {
    const svc = await makeService();
    expect(svc.agentWallpaper('workbuddy')).toEqual({ enabled: false, id: null });
  });

  it('agentWallpaper returns per-agent setting', async () => {
    const svc = await makeService({
      version: 2,
      apps: {},
      wallpaper: {
        enabled: true,
        id: 'g',
        agents: { doubao: { enabled: true, id: 'wp-db' } },
      },
    });
    expect(svc.agentWallpaper('doubao')).toEqual({ enabled: true, id: 'wp-db' });
  });
});

// ---------------------------------------------------------------------------
// toDto()
// ---------------------------------------------------------------------------

describe('SettingsService.toDto', () => {
  it('includes all agents with default ports', async () => {
    const svc = await makeService();
    const defaultPorts = Object.fromEntries(AGENT_IDS.map((id) => [id, 0])) as Record<
      AgentId,
      number
    >;
    const dto = svc.toDto(defaultPorts);
    for (const appId of AGENT_IDS) {
      expect(dto.apps[appId]).toEqual({ appPath: null, port: null });
      expect(dto.defaultPorts[appId]).toBe(0);
    }
    expect(dto.wallpaper.enabled).toBe(false);
  });

  it('merges overrides with default ports', async () => {
    const svc = await makeService({
      version: 2,
      apps: { workbuddy: { appPath: '/wb', port: 9000 } },
    });
    const defaultPorts = { workbuddy: 0, traework: 0, qoderwork: 0, doubao: 0, codex: 0 } as Record<
      AgentId,
      number
    >;
    const dto = svc.toDto(defaultPorts);
    expect(dto.apps.workbuddy).toEqual({ appPath: '/wb', port: 9000 });
    expect(dto.defaultPorts.workbuddy).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// setAppPath()
// ---------------------------------------------------------------------------

describe('SettingsService.setAppPath', () => {
  it('persists a new appPath', async () => {
    const svc = await makeService();
    await svc.setAppPath('workbuddy', 'C:\\Apps\\WB.exe');
    expect(svc.overridesFor('workbuddy').appPath).toBe('C:\\Apps\\WB.exe');
    // port should remain null
    expect(svc.overridesFor('workbuddy').port).toBeNull();
  });

  it('clears appPath with null', async () => {
    const svc = await makeService({
      version: 2,
      apps: { workbuddy: { appPath: '/wb', port: 8080 } },
    });
    await svc.setAppPath('workbuddy', null);
    expect(svc.overridesFor('workbuddy').appPath).toBeNull();
    // port should be preserved
    expect(svc.overridesFor('workbuddy').port).toBe(8080);
  });

  it('survives re-read from disk', async () => {
    const svc = await makeService();
    await svc.setAppPath('traework', '/path/to/trae');
    const svc2 = new SettingsService(settingsFile);
    await svc2.initialize();
    expect(svc2.overridesFor('traework').appPath).toBe('/path/to/trae');
  });
});

// ---------------------------------------------------------------------------
// setAppPort()
// ---------------------------------------------------------------------------

describe('SettingsService.setAppPort', () => {
  it('persists a valid port', async () => {
    const svc = await makeService();
    await svc.setAppPort('workbuddy', 8080);
    expect(svc.overridesFor('workbuddy').port).toBe(8080);
  });

  it('clears port with null', async () => {
    const svc = await makeService({
      version: 2,
      apps: { workbuddy: { appPath: '/wb', port: 8080 } },
    });
    await svc.setAppPort('workbuddy', null);
    expect(svc.overridesFor('workbuddy').port).toBeNull();
    // appPath should be preserved
    expect(svc.overridesFor('workbuddy').appPath).toBe('/wb');
  });

  it('throws for port below 1024', async () => {
    const svc = await makeService();
    await expect(svc.setAppPort('workbuddy', 80)).rejects.toThrow(getMainMessages().invalidPort);
  });

  it('throws for port above 65535', async () => {
    const svc = await makeService();
    await expect(svc.setAppPort('workbuddy', 70000)).rejects.toThrow(getMainMessages().invalidPort);
  });

  it('throws for non-integer port', async () => {
    const svc = await makeService();
    await expect(svc.setAppPort('workbuddy', 8080.5)).rejects.toThrow(
      getMainMessages().invalidPort,
    );
  });
});

// ---------------------------------------------------------------------------
// setWallpaper()
// ---------------------------------------------------------------------------

describe('SettingsService.setWallpaper', () => {
  it('persists global wallpaper settings', async () => {
    const svc = await makeService();
    await svc.setWallpaper({ enabled: true, id: 'neon-wallpaper' });
    expect(svc.wallpaper().enabled).toBe(true);
    expect(svc.wallpaper().id).toBe('neon-wallpaper');
  });

  it('normalizes enabled to boolean', async () => {
    const svc = await makeService();
    await svc.setWallpaper({ enabled: true, id: 'wp' });
    expect(svc.wallpaper().enabled).toBe(true);
  });

  it('normalizes empty id to null', async () => {
    const svc = await makeService();
    await svc.setWallpaper({ enabled: true, id: '' });
    expect(svc.wallpaper().id).toBeNull();
  });

  it('preserves existing per-agent settings when updating global', async () => {
    const svc = await makeService({
      version: 2,
      apps: {},
      wallpaper: {
        enabled: false,
        id: null,
        agents: { workbuddy: { enabled: true, id: 'wp-wb' } },
      },
    });
    await svc.setWallpaper({ enabled: true, id: 'new-global' });
    expect(svc.agentWallpaper('workbuddy')).toEqual({ enabled: true, id: 'wp-wb' });
  });
});

// ---------------------------------------------------------------------------
// setAgentWallpaper()
// ---------------------------------------------------------------------------

describe('SettingsService.setAgentWallpaper', () => {
  it('persists per-agent wallpaper setting', async () => {
    const svc = await makeService();
    await svc.setAgentWallpaper('workbuddy', { enabled: true, id: 'wp-wb' });
    expect(svc.agentWallpaper('workbuddy')).toEqual({ enabled: true, id: 'wp-wb' });
  });

  it('creates wallpaper object if it does not exist', async () => {
    const svc = await makeService();
    // No wallpaper in persisted state initially
    expect(svc.wallpaper().enabled).toBe(false);
    await svc.setAgentWallpaper('traework', { enabled: true, id: 'wp-tr' });
    expect(svc.agentWallpaper('traework')).toEqual({ enabled: true, id: 'wp-tr' });
  });

  it('normalizes empty id to null', async () => {
    const svc = await makeService();
    await svc.setAgentWallpaper('workbuddy', { enabled: true, id: '' });
    expect(svc.agentWallpaper('workbuddy').id).toBeNull();
  });

  it('does not affect other agents', async () => {
    const svc = await makeService({
      version: 2,
      apps: {},
      wallpaper: {
        enabled: true,
        id: 'g',
        agents: {
          workbuddy: { enabled: true, id: 'wp-wb' },
          traework: { enabled: false, id: null },
        },
      },
    });
    await svc.setAgentWallpaper('traework', { enabled: true, id: 'wp-tr' });
    expect(svc.agentWallpaper('workbuddy')).toEqual({ enabled: true, id: 'wp-wb' });
    expect(svc.agentWallpaper('traework')).toEqual({ enabled: true, id: 'wp-tr' });
  });

  it('survives re-read from disk', async () => {
    const svc = await makeService();
    await svc.setAgentWallpaper('doubao', { enabled: true, id: 'wp-db' });
    const svc2 = new SettingsService(settingsFile);
    await svc2.initialize();
    expect(svc2.agentWallpaper('doubao')).toEqual({ enabled: true, id: 'wp-db' });
  });
});

// ---------------------------------------------------------------------------
// normalizeRenderOptions() — render option validation & clamping
// ---------------------------------------------------------------------------

describe('normalizeRenderOptions', () => {
  it('returns undefined for null/undefined/non-object input', () => {
    expect(normalizeRenderOptions(undefined)).toBeUndefined();
    expect(normalizeRenderOptions(null)).toBeUndefined();
    expect(normalizeRenderOptions(42 as never)).toBeUndefined();
    expect(normalizeRenderOptions('x' as never)).toBeUndefined();
  });

  it('returns undefined when every field is missing (empty object)', () => {
    expect(normalizeRenderOptions({})).toBeUndefined();
  });

  it('clamps numeric fields into their allowed ranges', () => {
    const r = normalizeRenderOptions({
      speed: 9,
      scrimOpacity: -5,
      positionX: 250,
      positionY: -250,
      parallax: 500,
      brightness: -10,
      contrast: 500,
      saturation: 0,
      hueRotate: 999,
      sepia: 150,
      grayscale: -3,
      blur: 999,
      audioLevel: 101,
    });
    expect(r).toEqual({
      speed: 2,
      scrimOpacity: 0,
      positionX: 100,
      positionY: -100,
      parallax: 100,
      brightness: 0,
      contrast: 200,
      saturation: 0,
      hueRotate: 180,
      sepia: 100,
      grayscale: 0,
      blur: 50,
      audioLevel: 100,
    });
  });

  it('drops non-finite / non-number values', () => {
    expect(
      normalizeRenderOptions({
        speed: Number.NaN,
        parallax: Number.POSITIVE_INFINITY,
        blur: '8px' as never,
      }),
    ).toBeUndefined();
  });

  it('keeps only whitelisted alignments', () => {
    expect(normalizeRenderOptions({ alignment: 'tile' })?.alignment).toBe('tile');
    expect(normalizeRenderOptions({ alignment: 'stretch' })?.alignment).toBe('stretch');
    expect(normalizeRenderOptions({ alignment: 'cover' as never })?.alignment).toBeUndefined();
    expect(normalizeRenderOptions({ alignment: 42 as never })?.alignment).toBeUndefined();
  });

  it('accepts valid hex tints and rejects malformed ones', () => {
    expect(normalizeRenderOptions({ tint: '#c41e2a' })?.tint).toBe('#c41e2a');
    expect(normalizeRenderOptions({ tint: 'c41e2a' })?.tint).toBe('c41e2a');
    expect(normalizeRenderOptions({ tint: '#fff' })?.tint).toBe('#fff');
    expect(normalizeRenderOptions({ tint: 'red' })?.tint).toBeUndefined();
    expect(normalizeRenderOptions({ tint: '#12' })?.tint).toBeUndefined();
  });

  it('keeps valid booleans and drops others', () => {
    expect(normalizeRenderOptions({ loop: false, flipH: true, flipV: false })).toEqual({
      loop: false,
      flipH: true,
      flipV: false,
    });
    expect(normalizeRenderOptions({ loop: 1 as never })?.loop).toBeUndefined();
  });

  it('round-trips a fully-specified render options object', () => {
    const input = {
      speed: 1.5,
      loop: true,
      scrimOpacity: 45,
      alignment: 'fit' as const,
      positionX: -20,
      positionY: 10,
      flipH: false,
      flipV: true,
      parallax: 30,
      brightness: 110,
      contrast: 95,
      saturation: 120,
      hueRotate: -30,
      sepia: 10,
      grayscale: 0,
      blur: 4,
      tint: '#3366ff',
      audioLevel: 60,
    };
    expect(normalizeRenderOptions(input)).toEqual(input);
  });
});
