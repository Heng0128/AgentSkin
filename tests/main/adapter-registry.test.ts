// SPDX-License-Identifier: MIT
//
// # adapter-registry.test.ts — unit tests for the AdapterRegistry.
//
// Validates:
//   - Pre-loaded six adapters
//   - register / unregister (normal flow)
//   - Duplicate registration handling
//   - get / list queries
//   - findByCapability
//   - checkCompatibility (semver range)
//   - Health status tracking (getHealth / runHealthCheck)
//   - Event system (registered / unregistered / healthChange)
//   - Edge cases (invalid agentId, empty metadata, unknown adapter)

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADAPTER_PRESETS,
  AdapterRegistry,
  BUILTIN_ADAPTERS,
} from '../../scripts/lib/adapter-registry.mjs';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createRegistry(): AdapterRegistry {
  return new AdapterRegistry();
}

/** Minimal valid metadata for a test adapter. */
function makeMetadata(overrides: Record<string, unknown> = {}) {
  return {
    agentId: 'testapp',
    name: 'Test App',
    platform: ['win32'],
    capabilities: ['cdp'],
    version: { min: '1.0.0', max: '2.0.0' },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Pre-loaded six adapters
// ---------------------------------------------------------------------------

describe('pre-loaded adapters', () => {
  it('contains exactly six built-in adapters', () => {
    const registry = createRegistry();
    expect(registry.list()).toHaveLength(6);
  });

  it('includes all six expected agentIds', () => {
    const registry = createRegistry();
    const ids = registry.list().map((a) => a.agentId);
    expect(ids).toEqual(['traework', 'qoderwork', 'workbuddy', 'doubao', 'codex', 'zcode']);
  });

  it('matches BUILTIN_ADAPTERS constant', () => {
    expect(BUILTIN_ADAPTERS).toEqual([
      'traework',
      'qoderwork',
      'workbuddy',
      'doubao',
      'codex',
      'zcode',
    ]);
  });

  it('each preset has required fields', () => {
    for (const agentId of BUILTIN_ADAPTERS) {
      const preset = ADAPTER_PRESETS[agentId];
      expect(preset.agentId).toBe(agentId);
      expect(preset.name).toBeTypeOf('string');
      expect(preset.platform.length).toBeGreaterThan(0);
      expect(preset.capabilities.length).toBeGreaterThan(0);
      expect(preset.version.min).toBeTypeOf('string');
      expect(preset.version.max).toBeTypeOf('string');
    }
  });

  it('each adapter starts with unknown health status', () => {
    const registry = createRegistry();
    for (const agentId of BUILTIN_ADAPTERS) {
      expect(registry.getHealth(agentId)).toBe('unknown');
    }
  });
});

// ---------------------------------------------------------------------------
// 2. register — normal flow
// ---------------------------------------------------------------------------

describe('register', () => {
  let registry: AdapterRegistry;

  beforeEach(() => {
    registry = createRegistry();
  });

  it('registers a new adapter and returns it via get()', () => {
    const meta = makeMetadata();
    registry.register('testapp', meta);
    expect(registry.get('testapp')).toBeDefined();
    expect(registry.get('testapp')?.name).toBe('Test App');
  });

  it('increases the list count after registration', () => {
    expect(registry.list()).toHaveLength(6);
    registry.register('testapp', makeMetadata());
    expect(registry.list()).toHaveLength(7);
  });

  it('stores a copy of platform and capabilities arrays (not references)', () => {
    const platform = ['win32'];
    const capabilities = ['cdp'];
    registry.register('testapp', makeMetadata({ platform, capabilities }));
    // Mutating the original arrays should not affect the stored metadata.
    platform.push('darwin');
    capabilities.push('theme');
    const stored = registry.get('testapp')!;
    expect(stored.platform).toEqual(['win32']);
    expect(stored.capabilities).toEqual(['cdp']);
  });

  it('preserves optional cdpPort and healthCheck fields', () => {
    const healthCheck = vi.fn(async () => true);
    registry.register('testapp', makeMetadata({ cdpPort: 9999, healthCheck }));
    const stored = registry.get('testapp')!;
    expect(stored.cdpPort).toBe(9999);
    expect(stored.healthCheck).toBe(healthCheck);
  });

  it('emits a registered event with the metadata', () => {
    const handler = vi.fn();
    registry.on('registered', handler);
    const meta = makeMetadata();
    registry.register('testapp', meta);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].agentId).toBe('testapp');
  });
});

// ---------------------------------------------------------------------------
// 3. register — duplicate handling
// ---------------------------------------------------------------------------

describe('register — duplicate handling', () => {
  let registry: AdapterRegistry;

  beforeEach(() => {
    registry = createRegistry();
  });

  it('overwrites an existing adapter on re-registration', () => {
    registry.register('testapp', makeMetadata({ name: 'Original' }));
    expect(registry.get('testapp')?.name).toBe('Original');

    registry.register('testapp', makeMetadata({ name: 'Updated' }));
    expect(registry.get('testapp')?.name).toBe('Updated');
    // Still only one entry for testapp.
    expect(registry.list().filter((a) => a.agentId === 'testapp')).toHaveLength(1);
  });

  it('emits registered event on each re-registration', () => {
    const handler = vi.fn();
    registry.on('registered', handler);
    registry.register('testapp', makeMetadata());
    registry.register('testapp', makeMetadata());
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it('can re-register a built-in adapter with custom metadata', () => {
    registry.register('traework', makeMetadata({ agentId: 'traework', name: 'Custom TRAE' }));
    expect(registry.get('traework')?.name).toBe('Custom TRAE');
  });
});

// ---------------------------------------------------------------------------
// 4. register — validation errors
// ---------------------------------------------------------------------------

describe('register — validation errors', () => {
  let registry: AdapterRegistry;

  beforeEach(() => {
    registry = createRegistry();
  });

  it('throws TypeError for empty agentId', () => {
    expect(() => registry.register('', makeMetadata())).toThrow(TypeError);
  });

  it('throws TypeError for non-string agentId', () => {
    // @ts-expect-error testing runtime validation
    expect(() => registry.register(123, makeMetadata())).toThrow(TypeError);
  });

  it('throws TypeError for null metadata', () => {
    // @ts-expect-error testing runtime validation
    expect(() => registry.register('testapp', null)).toThrow(TypeError);
  });

  it('throws TypeError for missing name in metadata', () => {
    const meta = makeMetadata();
    delete meta.name;
    // @ts-expect-error testing runtime validation
    expect(() => registry.register('testapp', meta)).toThrow(TypeError);
  });

  it('throws TypeError for empty platform array', () => {
    expect(() => registry.register('testapp', makeMetadata({ platform: [] }))).toThrow(TypeError);
  });

  it('throws TypeError for non-array capabilities', () => {
    // @ts-expect-error testing runtime validation
    expect(() => registry.register('testapp', makeMetadata({ capabilities: 'cdp' }))).toThrow(
      TypeError,
    );
  });

  it('throws TypeError for missing version', () => {
    const meta = makeMetadata();
    delete meta.version;
    // @ts-expect-error testing runtime validation
    expect(() => registry.register('testapp', meta)).toThrow(TypeError);
  });

  it('throws Error when metadata.agentId does not match agentId', () => {
    expect(() => registry.register('testapp', makeMetadata({ agentId: 'other' }))).toThrow(
      /does not match/,
    );
  });
});

// ---------------------------------------------------------------------------
// 5. unregister
// ---------------------------------------------------------------------------

describe('unregister', () => {
  let registry: AdapterRegistry;

  beforeEach(() => {
    registry = createRegistry();
  });

  it('removes an existing adapter', () => {
    registry.register('testapp', makeMetadata());
    expect(registry.get('testapp')).toBeDefined();
    registry.unregister('testapp');
    expect(registry.get('testapp')).toBeUndefined();
  });

  it('decreases the list count after unregistration', () => {
    registry.register('testapp', makeMetadata());
    expect(registry.list()).toHaveLength(7);
    registry.unregister('testapp');
    expect(registry.list()).toHaveLength(6);
  });

  it('is a silent no-op for non-existent adapter', () => {
    expect(() => registry.unregister('nonexistent')).not.toThrow();
    expect(registry.list()).toHaveLength(6);
  });

  it('removes health status on unregister', () => {
    registry.register('testapp', makeMetadata());
    expect(registry.getHealth('testapp')).toBe('unknown');
    registry.unregister('testapp');
    expect(registry.getHealth('testapp')).toBe('unknown');
  });

  it('emits an unregistered event with the removed metadata', () => {
    const handler = vi.fn();
    registry.on('unregistered', handler);
    registry.register('testapp', makeMetadata());
    registry.unregister('testapp');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].agentId).toBe('testapp');
  });

  it('does not emit unregistered for non-existent adapter', () => {
    const handler = vi.fn();
    registry.on('unregistered', handler);
    registry.unregister('nonexistent');
    expect(handler).not.toHaveBeenCalled();
  });

  it('throws TypeError for empty agentId', () => {
    expect(() => registry.unregister('')).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// 6. get / list
// ---------------------------------------------------------------------------

describe('get / list', () => {
  let registry: AdapterRegistry;

  beforeEach(() => {
    registry = createRegistry();
  });

  it('returns undefined for unknown agentId', () => {
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('returns all adapters in insertion order', () => {
    const all = registry.list();
    expect(all).toHaveLength(6);
    expect(all[0].agentId).toBe('traework');
    expect(all[5].agentId).toBe('zcode');
  });

  it('returns empty array after dispose', () => {
    registry.dispose();
    expect(registry.list()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 7. findByCapability
// ---------------------------------------------------------------------------

describe('findByCapability', () => {
  let registry: AdapterRegistry;

  beforeEach(() => {
    registry = createRegistry();
  });

  it('finds all adapters with cdp capability', () => {
    const result = registry.findByCapability('cdp');
    expect(result).toHaveLength(6);
  });

  it('finds only adapters with the background capability', () => {
    const result = registry.findByCapability('background');
    expect(result).toHaveLength(1);
    expect(result[0].agentId).toBe('doubao');
  });

  it('returns empty array for unknown capability', () => {
    expect(registry.findByCapability('nonexistent')).toEqual([]);
  });

  it('returns empty array for empty string capability', () => {
    expect(registry.findByCapability('')).toEqual([]);
  });

  it('returns empty array for non-string capability', () => {
    // @ts-expect-error testing runtime validation
    expect(registry.findByCapability(123)).toEqual([]);
  });

  it('reflects newly registered adapters', () => {
    registry.register('testapp', makeMetadata({ capabilities: ['cdp', 'custom'] }));
    const result = registry.findByCapability('custom');
    expect(result).toHaveLength(1);
    expect(result[0].agentId).toBe('testapp');
  });
});

// ---------------------------------------------------------------------------
// 8. checkCompatibility
// ---------------------------------------------------------------------------

describe('checkCompatibility', () => {
  let registry: AdapterRegistry;

  beforeEach(() => {
    registry = createRegistry();
  });

  it('returns compatible for version within range', () => {
    const result = registry.checkCompatibility('traework', '1.5.0');
    expect(result.compatible).toBe(true);
    expect(result.reason).toContain('within range');
  });

  it('returns compatible for version at min bound', () => {
    const result = registry.checkCompatibility('traework', '1.0.0');
    expect(result.compatible).toBe(true);
  });

  it('returns compatible for version at max bound', () => {
    const result = registry.checkCompatibility('traework', '99.99.99');
    expect(result.compatible).toBe(true);
  });

  it('returns incompatible for version below min', () => {
    const result = registry.checkCompatibility('traework', '0.9.0');
    expect(result.compatible).toBe(false);
    expect(result.reason).toContain('below minimum');
  });

  it('returns incompatible for version above max', () => {
    const result = registry.checkCompatibility('traework', '100.0.0');
    expect(result.compatible).toBe(false);
    expect(result.reason).toContain('above maximum');
  });

  it('returns incompatible for empty version string', () => {
    const result = registry.checkCompatibility('traework', '');
    expect(result.compatible).toBe(false);
    expect(result.reason).toContain('invalid');
  });

  it('throws Error for unregistered adapter', () => {
    expect(() => registry.checkCompatibility('nonexistent', '1.0.0')).toThrow(/not registered/);
  });

  it('throws TypeError for empty agentId', () => {
    expect(() => registry.checkCompatibility('', '1.0.0')).toThrow(TypeError);
  });

  it('works with custom version ranges', () => {
    registry.register('testapp', makeMetadata({ version: { min: '2.0.0', max: '3.0.0' } }));
    expect(registry.checkCompatibility('testapp', '2.5.0').compatible).toBe(true);
    expect(registry.checkCompatibility('testapp', '1.9.0').compatible).toBe(false);
    expect(registry.checkCompatibility('testapp', '3.1.0').compatible).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 9. Health status tracking
// ---------------------------------------------------------------------------

describe('getHealth', () => {
  let registry: AdapterRegistry;

  beforeEach(() => {
    registry = createRegistry();
  });

  it('returns unknown for built-in adapters without health check', () => {
    expect(registry.getHealth('traework')).toBe('unknown');
  });

  it('returns unknown for unregistered adapter', () => {
    expect(registry.getHealth('nonexistent')).toBe('unknown');
  });
});

describe('runHealthCheck', () => {
  let registry: AdapterRegistry;

  beforeEach(() => {
    registry = createRegistry();
  });

  it('returns unknown when no healthCheck function is provided', async () => {
    const status = await registry.runHealthCheck('traework');
    expect(status).toBe('unknown');
  });

  it('returns healthy when healthCheck resolves true', async () => {
    registry.register('testapp', makeMetadata({ healthCheck: async () => true }));
    const status = await registry.runHealthCheck('testapp');
    expect(status).toBe('healthy');
    expect(registry.getHealth('testapp')).toBe('healthy');
  });

  it('returns unhealthy when healthCheck resolves false', async () => {
    registry.register('testapp', makeMetadata({ healthCheck: async () => false }));
    const status = await registry.runHealthCheck('testapp');
    expect(status).toBe('unhealthy');
    expect(registry.getHealth('testapp')).toBe('unhealthy');
  });

  it('returns unhealthy when healthCheck throws', async () => {
    registry.register(
      'testapp',
      makeMetadata({
        healthCheck: async () => {
          throw new Error('boom');
        },
      }),
    );
    const status = await registry.runHealthCheck('testapp');
    expect(status).toBe('unhealthy');
  });

  it('emits healthChange when status changes', async () => {
    registry.register('testapp', makeMetadata({ healthCheck: async () => true }));
    const handler = vi.fn();
    registry.on('healthChange', handler);
    await registry.runHealthCheck('testapp');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({
      agentId: 'testapp',
      prevStatus: 'unknown',
      newStatus: 'healthy',
    });
  });

  it('does not emit healthChange when status stays the same', async () => {
    registry.register('testapp', makeMetadata({ healthCheck: async () => true }));
    await registry.runHealthCheck('testapp'); // unknown → healthy
    const handler = vi.fn();
    registry.on('healthChange', handler);
    await registry.runHealthCheck('testapp'); // healthy → healthy
    expect(handler).not.toHaveBeenCalled();
  });

  it('emits healthChange on transition from healthy to unhealthy', async () => {
    let healthy = true;
    registry.register('testapp', makeMetadata({ healthCheck: async () => healthy }));
    await registry.runHealthCheck('testapp'); // unknown → healthy
    healthy = false;
    const handler = vi.fn();
    registry.on('healthChange', handler);
    await registry.runHealthCheck('testapp'); // healthy → unhealthy
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].newStatus).toBe('unhealthy');
  });

  it('throws Error for unregistered adapter', async () => {
    await expect(registry.runHealthCheck('nonexistent')).rejects.toThrow(/not registered/);
  });

  it('throws TypeError for empty agentId', async () => {
    await expect(registry.runHealthCheck('')).rejects.toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// 10. Event system
// ---------------------------------------------------------------------------

describe('event system', () => {
  let registry: AdapterRegistry;

  beforeEach(() => {
    registry = createRegistry();
  });

  it('on() returns an unsubscribe function', () => {
    const handler = vi.fn();
    const unsubscribe = registry.on('registered', handler);
    registry.register('testapp', makeMetadata());
    expect(handler).toHaveBeenCalledTimes(1);
    unsubscribe();
    registry.register('testapp2', makeMetadata({ agentId: 'testapp2', name: 'Test 2' }));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('off() removes a specific listener without affecting others', () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    registry.on('registered', handler1);
    registry.on('registered', handler2);
    registry.register('testapp', makeMetadata());
    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(1);
    registry.off('registered', handler1);
    registry.register('testapp2', makeMetadata({ agentId: 'testapp2', name: 'Test 2' }));
    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).toHaveBeenCalledTimes(2);
  });

  it('supports multiple listeners on the same event', () => {
    const h1 = vi.fn();
    const h2 = vi.fn();
    const h3 = vi.fn();
    registry.on('registered', h1);
    registry.on('registered', h2);
    registry.on('registered', h3);
    registry.register('testapp', makeMetadata());
    expect(h1).toHaveBeenCalledTimes(1);
    expect(h2).toHaveBeenCalledTimes(1);
    expect(h3).toHaveBeenCalledTimes(1);
  });

  it('listener errors do not break the registry or other listeners', () => {
    const badHandler = vi.fn(() => {
      throw new Error('listener crash');
    });
    const goodHandler = vi.fn();
    registry.on('registered', badHandler);
    registry.on('registered', goodHandler);
    expect(() => registry.register('testapp', makeMetadata())).not.toThrow();
    expect(badHandler).toHaveBeenCalledTimes(1);
    expect(goodHandler).toHaveBeenCalledTimes(1);
  });

  it('dispose() clears all listeners', () => {
    const handler = vi.fn();
    registry.on('registered', handler);
    registry.dispose();
    registry.register('testapp', makeMetadata());
    expect(handler).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 11. dispose and reuse
// ---------------------------------------------------------------------------

describe('dispose', () => {
  it('clears all adapters', () => {
    const registry = createRegistry();
    expect(registry.list()).toHaveLength(6);
    registry.dispose();
    expect(registry.list()).toHaveLength(0);
  });

  it('registry can be reused after dispose', () => {
    const registry = createRegistry();
    registry.dispose();
    registry.register('testapp', makeMetadata());
    expect(registry.get('testapp')).toBeDefined();
    expect(registry.list()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 12. Integration scenarios
// ---------------------------------------------------------------------------

describe('integration scenarios', () => {
  it('full lifecycle: register → health check → unregister', async () => {
    const registry = createRegistry();
    const healthCheck = vi.fn(async () => true);

    registry.register('testapp', makeMetadata({ healthCheck }));
    expect(registry.get('testapp')).toBeDefined();
    expect(registry.getHealth('testapp')).toBe('unknown');

    const status = await registry.runHealthCheck('testapp');
    expect(status).toBe('healthy');
    expect(healthCheck).toHaveBeenCalledTimes(1);

    registry.unregister('testapp');
    expect(registry.get('testapp')).toBeUndefined();
  });

  it('tracks health across all six built-in adapters', async () => {
    const registry = createRegistry();
    // Register health checks for all six.
    for (const agentId of BUILTIN_ADAPTERS) {
      registry.register(agentId, {
        ...ADAPTER_PRESETS[agentId],
        agentId,
        healthCheck: async () => agentId !== 'codex', // codex fails
      });
    }

    for (const agentId of BUILTIN_ADAPTERS) {
      await registry.runHealthCheck(agentId);
    }

    for (const agentId of BUILTIN_ADAPTERS) {
      const expected = agentId === 'codex' ? 'unhealthy' : 'healthy';
      expect(registry.getHealth(agentId)).toBe(expected);
    }
  });

  it('findByCapability returns correct subset after custom registration', () => {
    const registry = createRegistry();
    registry.register('testapp', makeMetadata({ capabilities: ['cdp', 'ai-agent'] }));
    const cdpAdapters = registry.findByCapability('cdp');
    const aiAdapters = registry.findByCapability('ai-agent');
    // All 6 built-ins have cdp + testapp also has cdp.
    expect(cdpAdapters).toHaveLength(7);
    // Only testapp has ai-agent.
    expect(aiAdapters).toHaveLength(1);
    expect(aiAdapters[0].agentId).toBe('testapp');
  });
});
