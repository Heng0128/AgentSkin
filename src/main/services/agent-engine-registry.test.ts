// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import type { SchemeSnapshot } from '../agent-scheme';
import { AgentEngineRegistry } from './agent-engine-registry';

const SCHEMES: SchemeSnapshot[] = [
  { agentId: 'traework', dataTheme: null, storage: {} },
  { agentId: 'traework', dataTheme: 'light', storage: { theme: 'light' } },
  { agentId: 'traework', dataTheme: 'dark', storage: { theme: 'dark' } },
];

function makeRegistry(): AgentEngineRegistry {
  return new AgentEngineRegistry();
}

describe('AgentEngineRegistry — initial state', () => {
  it('starts with empty apps', () => {
    const reg = makeRegistry();
    expect(reg.getApp('traework')).toBeUndefined();
    expect(reg.getActiveThemeId('traework')).toBeNull();
    expect(reg.getPort('traework')).toBeNull();
    expect(reg.getSchemeSnapshot('traework')).toBeNull();
    expect(reg.getDetectedPath('traework')).toBeNull();
  });

  it('snapshot returns the internal state object', () => {
    const reg = makeRegistry();
    const snap = reg.snapshot();
    expect(snap).toEqual({ version: 2, apps: {} });
    expect(Object.isFrozen(snap)).toBe(false); // Readonly<T> is compile-time only
  });
});

describe('AgentEngineRegistry — loadFrom / snapshot', () => {
  it('replaces entire state on loadFrom', () => {
    const reg = makeRegistry();
    const newState = {
      version: 2 as const,
      apps: {
        traework: {
          activeThemeId: 'sakura-pastel',
          activeSchemeId: 'light',
          port: 9222,
          schemeSnapshot: SCHEMES[1],
          detectedPath: '/Applications/Trae.app',
        },
      },
    };
    reg.loadFrom(newState as Parameters<typeof reg.loadFrom>[0]);
    expect(reg.getActiveThemeId('traework')).toBe('sakura-pastel');
    expect(reg.getPort('traework')).toBe(9222);
    expect(reg.getDetectedPath('traework')).toBe('/Applications/Trae.app');
  });

  it('snapshot reflects mutations after loadFrom', () => {
    const reg = makeRegistry();
    reg.setApp('traework', {
      activeThemeId: 'test-theme',
      activeSchemeId: null,
      port: 9222,
      schemeSnapshot: null,
      detectedPath: null,
    });
    const snap = reg.snapshot();
    expect(snap.apps['traework']?.activeThemeId).toBe('test-theme');
  });
});

describe('AgentEngineRegistry — setApp', () => {
  it('creates a new entry for an agent', () => {
    const reg = makeRegistry();
    reg.setApp('traework', {
      activeThemeId: 'theme-a',
      activeSchemeId: 'dark',
      port: 9222,
      schemeSnapshot: SCHEMES[2],
      detectedPath: '/path/to/app',
    });
    const app = reg.getApp('traework');
    expect(app).toBeDefined();
    expect(app?.activeThemeId).toBe('theme-a');
    expect(app?.activeSchemeId).toBe('dark');
    expect(app?.port).toBe(9222);
    expect(app?.schemeSnapshot).toEqual(SCHEMES[2]);
    expect(app?.detectedPath).toBe('/path/to/app');
  });

  it('overwrites an existing entry', () => {
    const reg = makeRegistry();
    reg.setApp('traework', {
      activeThemeId: 'theme-a',
      activeSchemeId: null,
      port: 9222,
      schemeSnapshot: null,
      detectedPath: null,
    });
    reg.setApp('traework', {
      activeThemeId: 'theme-b',
      activeSchemeId: 'light',
      port: 9223,
      schemeSnapshot: SCHEMES[1],
      detectedPath: '/new/path',
    });
    expect(reg.getActiveThemeId('traework')).toBe('theme-b');
    expect(reg.getPort('traework')).toBe(9223);
  });
});

describe('AgentEngineRegistry — patchApp', () => {
  it('merges partial fields onto existing entry', () => {
    const reg = makeRegistry();
    reg.setApp('traework', {
      activeThemeId: 'theme-a',
      activeSchemeId: null,
      port: 9222,
      schemeSnapshot: null,
      detectedPath: '/original',
    });
    reg.patchApp('traework', { port: 9333, detectedPath: '/updated' });
    expect(reg.getActiveThemeId('traework')).toBe('theme-a');
    expect(reg.getPort('traework')).toBe(9333);
    expect(reg.getDetectedPath('traework')).toBe('/updated');
  });

  it('creates a new entry when agent does not exist', () => {
    const reg = makeRegistry();
    reg.patchApp('traework', { port: 9222 });
    expect(reg.getApp('traework')).toBeDefined();
    expect(reg.getPort('traework')).toBe(9222);
    expect(reg.getActiveThemeId('traework')).toBeNull();
  });

  it('fills missing fields with null when creating via patch', () => {
    const reg = makeRegistry();
    reg.patchApp('qoderwork', { activeThemeId: 'theme-x' });
    const app = reg.getApp('qoderwork');
    expect(app).toBeDefined();
    expect(app?.activeThemeId).toBe('theme-x');
    expect(app?.activeSchemeId).toBeNull();
    expect(app?.port).toBeNull();
    expect(app?.schemeSnapshot).toBeNull();
    expect(app?.detectedPath).toBeNull();
  });
});

describe('AgentEngineRegistry — setPort silent no-op on missing entry', () => {
  it('does not create an entry when agent does not exist', () => {
    const reg = makeRegistry();
    reg.setPort('traework', 9222);
    expect(reg.getApp('traework')).toBeUndefined();
  });

  it('updates port on existing entry', () => {
    const reg = makeRegistry();
    reg.patchApp('traework', {});
    reg.setPort('traework', 9222);
    expect(reg.getPort('traework')).toBe(9222);
  });

  it('sets port to null', () => {
    const reg = makeRegistry();
    reg.patchApp('traework', { port: 9222 });
    reg.setPort('traework', null);
    expect(reg.getPort('traework')).toBeNull();
  });
});

describe('AgentEngineRegistry — setSchemeSnapshot silent no-op on missing entry', () => {
  it('does not create an entry when agent does not exist', () => {
    const reg = makeRegistry();
    reg.setSchemeSnapshot('traework', SCHEMES[0]);
    expect(reg.getApp('traework')).toBeUndefined();
  });

  it('updates scheme snapshot on existing entry', () => {
    const reg = makeRegistry();
    reg.patchApp('traework', {});
    reg.setSchemeSnapshot('traework', SCHEMES[2]);
    expect(reg.getSchemeSnapshot('traework')).toEqual(SCHEMES[2]);
  });
});

describe('AgentEngineRegistry — setDetectedPath silent no-op on missing entry', () => {
  it('does not create an entry when agent does not exist', () => {
    const reg = makeRegistry();
    reg.setDetectedPath('traework', '/some/path');
    expect(reg.getApp('traework')).toBeUndefined();
  });

  it('updates detected path on existing entry', () => {
    const reg = makeRegistry();
    reg.patchApp('traework', {});
    reg.setDetectedPath('traework', '/new/path');
    expect(reg.getDetectedPath('traework')).toBe('/new/path');
  });
});

describe('AgentEngineRegistry — clearPort', () => {
  it('sets port to null on existing entry', () => {
    const reg = makeRegistry();
    reg.patchApp('traework', { port: 9222 });
    reg.clearPort('traework');
    expect(reg.getPort('traework')).toBeNull();
  });

  it('silently no-ops when agent does not exist', () => {
    const reg = makeRegistry();
    reg.clearPort('traework');
    expect(reg.getApp('traework')).toBeUndefined();
  });

  it('preserves other fields', () => {
    const reg = makeRegistry();
    reg.setApp('traework', {
      activeThemeId: 'theme-a',
      activeSchemeId: 'light',
      port: 9222,
      schemeSnapshot: SCHEMES[1],
      detectedPath: '/path',
    });
    reg.clearPort('traework');
    expect(reg.getActiveThemeId('traework')).toBe('theme-a');
    expect(reg.getDetectedPath('traework')).toBe('/path');
  });
});

describe('AgentEngineRegistry — clearActiveTheme', () => {
  it('clears theme/scheme/snapshot while preserving port and detectedPath', () => {
    const reg = makeRegistry();
    reg.setApp('traework', {
      activeThemeId: 'theme-a',
      activeSchemeId: 'light',
      port: 9222,
      schemeSnapshot: SCHEMES[1],
      detectedPath: '/path/to/app',
    });
    reg.clearActiveTheme('traework', 9333);
    expect(reg.getActiveThemeId('traework')).toBeNull();
    expect(reg.getActiveSchemeId('traework')).toBeNull();
    expect(reg.getSchemeSnapshot('traework')).toBeNull();
    expect(reg.getPort('traework')).toBe(9333);
    expect(reg.getDetectedPath('traework')).toBe('/path/to/app');
  });

  it('overrides the port with the provided value', () => {
    const reg = makeRegistry();
    reg.patchApp('traework', { port: 1111 });
    reg.clearActiveTheme('traework', 2222);
    expect(reg.getPort('traework')).toBe(2222);
  });

  it('preserves existing detectedPath if no new one provided', () => {
    const reg = makeRegistry();
    reg.setApp('traework', {
      activeThemeId: 'theme-a',
      activeSchemeId: null,
      port: null,
      schemeSnapshot: null,
      detectedPath: '/existing',
    });
    reg.clearActiveTheme('traework', null);
    expect(reg.getDetectedPath('traework')).toBe('/existing');
  });

  it('creates a new entry if agent did not exist', () => {
    const reg = makeRegistry();
    reg.clearActiveTheme('traework', 9222);
    expect(reg.getApp('traework')).toBeDefined();
    expect(reg.getActiveThemeId('traework')).toBeNull();
    expect(reg.getPort('traework')).toBe(9222);
  });
});

describe('AgentEngineRegistry — forEachApp', () => {
  it('iterates over all existing entries', () => {
    const reg = makeRegistry();
    reg.patchApp('traework', { port: 9222 });
    reg.patchApp('qoderwork', { port: 9223 });
    reg.patchApp('workbuddy', { port: 9224 });

    const visited: Array<{ appId: string; port: number | null }> = [];
    reg.forEachApp((appId, entry) => {
      visited.push({ appId, port: entry.port });
    });

    expect(visited).toHaveLength(3);
    expect(visited).toEqual(
      expect.arrayContaining([
        { appId: 'traework', port: 9222 },
        { appId: 'qoderwork', port: 9223 },
        { appId: 'workbuddy', port: 9224 },
      ]),
    );
  });

  it('does not invoke callback for undefined entries', () => {
    const reg = makeRegistry();
    reg.patchApp('traework', { port: 9222 });
    // Patch with empty object creates entry with null fields
    reg.patchApp('qoderwork', {});

    const visited: string[] = [];
    reg.forEachApp((appId) => {
      visited.push(appId);
    });

    expect(visited).toContain('traework');
    expect(visited).toContain('qoderwork');
  });

  it('allows in-place mutation via the callback', () => {
    const reg = makeRegistry();
    reg.patchApp('traework', { port: 9222 });
    reg.forEachApp((appId, entry) => {
      entry.port = 9999;
    });
    expect(reg.getPort('traework')).toBe(9999);
  });

  it('handles empty registry', () => {
    const reg = makeRegistry();
    const visited: string[] = [];
    reg.forEachApp((appId) => {
      visited.push(appId);
    });
    expect(visited).toHaveLength(0);
  });
});

describe('AgentEngineRegistry — multi-agent isolation', () => {
  it('mutations to one agent do not affect others', () => {
    const reg = makeRegistry();
    reg.patchApp('traework', { port: 9222, activeThemeId: 'theme-a' });
    reg.patchApp('qoderwork', { port: 9223, activeThemeId: 'theme-b' });

    reg.setPort('traework', 1111);
    reg.patchApp('qoderwork', { activeThemeId: 'theme-c' });

    expect(reg.getPort('traework')).toBe(1111);
    expect(reg.getPort('qoderwork')).toBe(9223);
    expect(reg.getActiveThemeId('traework')).toBe('theme-a');
    expect(reg.getActiveThemeId('qoderwork')).toBe('theme-c');
  });
});
