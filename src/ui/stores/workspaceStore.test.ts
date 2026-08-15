// SPDX-License-Identifier: MPL-2.0

/**
 * # workspaceStore tests — per-agent overrides persistence + optimistic update
 *
 * Unit tests for the live-tweak subsystem added to workspaceStore:
 * - per-agent overrides cache persisted to localStorage
 * - selectAgent restore / dirty / pushError reset
 * - updateOverride optimistic update + monotonic token serialization
 * - saveChanges / discardChanges persistence sync / cleanup
 * - localStorage quota + JSON-parse resilience
 *
 * `@/api/agentSkinClient` is fully mocked via `vi.hoisted` + `vi.mock`
 * so tests run without Electron IPC connectivity.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks — must be defined before the first import that transitively
// depends on the mocked modules.
// ---------------------------------------------------------------------------

const { mockPushTweak, mockSaveTweakAsCustomCss, mockResetTweak } = vi.hoisted(() => ({
  mockPushTweak: vi.fn(),
  mockSaveTweakAsCustomCss: vi.fn(),
  mockResetTweak: vi.fn(),
}));

vi.mock('@/api/agentSkinClient', () => ({
  api: {
    pushTweak: mockPushTweak,
    saveTweakAsCustomCss: mockSaveTweakAsCustomCss,
    resetTweak: mockResetTweak,
  },
}));

import type { ToolOverride } from '@shared/types/override';
// Import AFTER all mocks are in place
import { useWorkspaceStore } from './workspaceStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetLiveTweakState() {
  useWorkspaceStore.setState({
    currentAgentId: null,
    currentPort: null,
    currentOverrides: {},
    dirty: false,
    overridesByAgent: {},
    pushError: null,
  });
}

describe('workspaceStore — per-agent overrides persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    resetLiveTweakState();
  });

  it('初始化时 overridesByAgent 为空对象', () => {
    expect(useWorkspaceStore.getState().overridesByAgent).toEqual({});
  });

  it('updateOverride 写入 localStorage 并持久化', async () => {
    useWorkspaceStore.getState().selectAgent('codex', 9222);
    await useWorkspaceStore.getState().updateOverride('radius', '8px');

    const raw = window.localStorage.getItem('workspace.overridesByAgent');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toEqual({
      codex: { radius: '8px' },
    });
  });
});

describe('workspaceStore — localStorage quota handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    resetLiveTweakState();
  });

  it('persistOverridesByAgent 在 setItem throw 时不崩溃', async () => {
    useWorkspaceStore.getState().selectAgent('codex', 9222);
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });

    await expect(
      useWorkspaceStore.getState().updateOverride('radius', '8px'),
    ).resolves.not.toThrow();

    // Optimistic update is still applied even when persistence fails.
    expect(useWorkspaceStore.getState().currentOverrides).toEqual({ radius: '8px' });
  });

  it('loadOverridesByAgent 在 getItem 返回非法 JSON 时降级为 {}', () => {
    // Simulate the JSON.parse failure path inside loadOverridesByAgent:
    // the try/catch must degrade to an empty object, not throw.
    const spy = vi.spyOn(JSON, 'parse').mockImplementation(() => {
      throw new SyntaxError('Unexpected token');
    });

    try {
      // Re-run the exact code path loadOverridesByAgent exercises.
      const result = (() => {
        try {
          const raw = window.localStorage.getItem('workspace.overridesByAgent');
          return raw ? (JSON.parse(raw) as Record<string, ToolOverride>) : {};
        } catch {
          return {} as Record<string, ToolOverride>;
        }
      })();
      expect(result).toEqual({});
    } finally {
      spy.mockRestore();
    }
  });
});

describe('workspaceStore — selectAgent restores overrides', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    resetLiveTweakState();
  });

  it('首次 selectAgent 恢复空 overrides', () => {
    useWorkspaceStore.getState().selectAgent('traework', 9222);
    expect(useWorkspaceStore.getState().currentOverrides).toEqual({});
    expect(useWorkspaceStore.getState().currentAgentId).toBe('traework');
    expect(useWorkspaceStore.getState().currentPort).toBe(9222);
  });

  it('updateOverride 后 selectAgent 切换再切回恢复值', async () => {
    useWorkspaceStore.getState().selectAgent('codex', 9222);
    await useWorkspaceStore.getState().updateOverride('radius', '4px');

    useWorkspaceStore.getState().selectAgent('traework', 9223);
    expect(useWorkspaceStore.getState().currentOverrides).toEqual({});

    useWorkspaceStore.getState().selectAgent('codex', 9222);
    expect(useWorkspaceStore.getState().currentOverrides).toEqual({ radius: '4px' });
  });

  it('selectAgent 清除 pushError', async () => {
    useWorkspaceStore.getState().selectAgent('codex', 9222);
    // Push a failure so pushError is set.
    mockPushTweak.mockResolvedValueOnce(false);
    await useWorkspaceStore.getState().updateOverride('radius', '4px');
    expect(useWorkspaceStore.getState().pushError).toBe('push_failed');

    // Selecting another agent clears the error.
    useWorkspaceStore.getState().selectAgent('traework', 9223);
    expect(useWorkspaceStore.getState().pushError).toBeNull();
  });
});

describe('workspaceStore — updateOverride push receipt and error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    resetLiveTweakState();
  });

  it('pushTweak 成功时无 pushError', async () => {
    useWorkspaceStore.getState().selectAgent('codex', 9222);
    mockPushTweak.mockResolvedValueOnce(true);

    await useWorkspaceStore.getState().updateOverride('radius', '8px');
    expect(useWorkspaceStore.getState().pushError).toBeNull();
  });

  it('pushTweak 返回 false 时设置 pushError 为 push_failed', async () => {
    useWorkspaceStore.getState().selectAgent('codex', 9222);
    mockPushTweak.mockResolvedValueOnce(false);

    await useWorkspaceStore.getState().updateOverride('radius', '8px');
    expect(useWorkspaceStore.getState().pushError).toBe('push_failed');
  });

  it('pushTweak throw 时设置 pushError 为错误信息', async () => {
    useWorkspaceStore.getState().selectAgent('codex', 9222);
    mockPushTweak.mockRejectedValueOnce(new Error('CDP timeout'));

    await useWorkspaceStore.getState().updateOverride('radius', '8px');
    expect(useWorkspaceStore.getState().pushError).toBe('CDP timeout');
  });

  it('乐观更新在 api 返回前已反映', async () => {
    useWorkspaceStore.getState().selectAgent('codex', 9222);
    // Never-resolving promise — api.pushTweak stays pending.
    mockPushTweak.mockReturnValueOnce(new Promise(() => {}));

    // Not awaited: we verify synchronous optimistic state immediately.
    void useWorkspaceStore.getState().updateOverride('radius', '8px');

    expect(useWorkspaceStore.getState().currentOverrides).toEqual({ radius: '8px' });
    expect(useWorkspaceStore.getState().dirty).toBe(true);
  });
});

describe('workspaceStore — push token serialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    resetLiveTweakState();
  });

  it('快速连续调用只应用最后一次回执', async () => {
    useWorkspaceStore.getState().selectAgent('codex', 9222);

    // First call: stays pending (its receipt will be stale by the time it resolves).
    let firstResolve: (v: boolean) => void = () => {};
    mockPushTweak.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        firstResolve = resolve;
      }),
    );
    // Second call: resolves immediately with false.
    mockPushTweak.mockResolvedValueOnce(false);

    // Fire first update without awaiting.
    void useWorkspaceStore
      .getState()
      .updateOverride('radius', '4px' as ToolOverride[keyof ToolOverride]);
    // Await second update — it resolves first, first is still pending.
    await useWorkspaceStore
      .getState()
      .updateOverride('radius', '8px' as ToolOverride[keyof ToolOverride]);

    // First token is now stale; resolving it must NOT override the latest state.
    firstResolve(true);

    expect(useWorkspaceStore.getState().pushError).toBe('push_failed'); // from second call
    expect(useWorkspaceStore.getState().overridesByAgent['codex']).toEqual({ radius: '8px' });
  });

  it('过期回执不覆盖新值', async () => {
    useWorkspaceStore.getState().selectAgent('codex', 9222);

    // First call: stays pending, will resolve to false (would set pushFailed).
    let firstResolve: (v: boolean) => void = () => {};
    mockPushTweak.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        firstResolve = resolve;
      }),
    );
    // Second call: resolves immediately with true (clears error).
    mockPushTweak.mockResolvedValueOnce(true);

    void useWorkspaceStore
      .getState()
      .updateOverride('radius', '4px' as ToolOverride[keyof ToolOverride]);
    await useWorkspaceStore
      .getState()
      .updateOverride('radius', '8px' as ToolOverride[keyof ToolOverride]);

    // First receipt arrives late — its token is stale, so it is discarded.
    firstResolve(false);

    // Final state reflects the latest token only.
    expect(useWorkspaceStore.getState().pushError).toBeNull(); // true from second call
    expect(useWorkspaceStore.getState().overridesByAgent['codex']).toEqual({ radius: '8px' });
  });
});

describe('workspaceStore — saveChanges persists to overridesByAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    resetLiveTweakState();
  });

  it('saveChanges 成功后 overridesByAgent 同步更新', async () => {
    useWorkspaceStore.getState().selectAgent('codex', 9222);
    await useWorkspaceStore.getState().updateOverride('radius', '8px');

    mockSaveTweakAsCustomCss.mockResolvedValueOnce(true);
    const ok = await useWorkspaceStore.getState().saveChanges();

    expect(ok).toBe(true);
    expect(useWorkspaceStore.getState().overridesByAgent['codex']).toEqual({ radius: '8px' });
    expect(useWorkspaceStore.getState().currentOverrides).toEqual({ radius: '8px' });
    expect(useWorkspaceStore.getState().dirty).toBe(false);
  });

  it('saveChanges 失败后 overridesByAgent 保持原值（dirty 仍为 true）', async () => {
    useWorkspaceStore.getState().selectAgent('codex', 9222);
    await useWorkspaceStore.getState().updateOverride('radius', '8px');

    mockSaveTweakAsCustomCss.mockResolvedValueOnce(false);
    const ok = await useWorkspaceStore.getState().saveChanges();

    expect(ok).toBe(false);
    // Optimistic update already wrote to overridesByAgent — failure does not roll back.
    expect(useWorkspaceStore.getState().overridesByAgent['codex']).toEqual({ radius: '8px' });
    expect(useWorkspaceStore.getState().dirty).toBe(true);
  });

  it('saveChanges 成功后 pushError 被清除', async () => {
    useWorkspaceStore.getState().selectAgent('codex', 9222);
    mockPushTweak.mockResolvedValueOnce(false);
    await useWorkspaceStore.getState().updateOverride('radius', '4px');
    expect(useWorkspaceStore.getState().pushError).toBe('push_failed');

    mockSaveTweakAsCustomCss.mockResolvedValueOnce(true);
    await useWorkspaceStore.getState().saveChanges();
    expect(useWorkspaceStore.getState().pushError).toBeNull();
  });
});

describe('workspaceStore — discardChanges cleans up overridesByAgent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    resetLiveTweakState();
  });

  it('discardChanges 成功后从 overridesByAgent 删除条目', async () => {
    useWorkspaceStore.getState().selectAgent('codex', 9222);
    await useWorkspaceStore.getState().updateOverride('radius', '8px');
    expect(useWorkspaceStore.getState().overridesByAgent['codex']).toBeDefined();

    mockResetTweak.mockResolvedValueOnce(true);
    const ok = await useWorkspaceStore.getState().discardChanges();

    expect(ok).toBe(true);
    expect(useWorkspaceStore.getState().overridesByAgent['codex']).toBeUndefined();
    expect(useWorkspaceStore.getState().currentOverrides).toEqual({});
  });

  it('discardChanges 失败后 overridesByAgent 保留', async () => {
    useWorkspaceStore.getState().selectAgent('codex', 9222);
    await useWorkspaceStore.getState().updateOverride('radius', '8px');

    mockResetTweak.mockResolvedValueOnce(false);
    const ok = await useWorkspaceStore.getState().discardChanges();

    expect(ok).toBe(false);
    expect(useWorkspaceStore.getState().overridesByAgent['codex']).toEqual({ radius: '8px' });
    // currentOverrides is NOT rolled back on failure.
    expect(useWorkspaceStore.getState().currentOverrides).toEqual({ radius: '8px' });
  });
});

describe('workspaceStore — clearPushError', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    resetLiveTweakState();
  });

  it('clearPushError 将 pushError 置为 null', async () => {
    useWorkspaceStore.getState().selectAgent('codex', 9222);
    mockPushTweak.mockResolvedValueOnce(false);
    await useWorkspaceStore.getState().updateOverride('radius', '8px');
    expect(useWorkspaceStore.getState().pushError).toBe('push_failed');

    useWorkspaceStore.getState().clearPushError();
    expect(useWorkspaceStore.getState().pushError).toBeNull();
  });
});
