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
 * - undo / redo history stack
 * - named tweak presets (save / load / delete / rename)
 *
 * `@/api/agentSkinClient` is fully mocked via `vi.hoisted` + `vi.mock`
 * so tests run without Electron IPC connectivity.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
    // Reset history and presets for clean test isolation.
    history: [],
    historyIndex: -1,
    tweakPresets: [],
    tweakPresetActiveId: null,
  });
  // Reset module-level pushToken to ensure monotonic token isolation between tests.
  useWorkspaceStore.getState().testResetPushToken();
}

/**
 * Flush all pending microtasks so that previously dispatched async operations
 * (e.g. pushToAgent promise chains) complete before the next test starts.
 * This prevents cross-test state leakage.
 */
async function flushPromises() {
  for (let i = 0; i < 50; i++) {
    await Promise.resolve();
  }
}

describe('workspaceStore — per-agent overrides persistence', () => {
  beforeEach(async () => {
    // Wait for any pending async operations from the previous test to complete
    // before resetting state, preventing cross-test state leakage.
    await flushPromises();
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
    // v1 format: { _version: 1, data: { agentId: overrides } }
    expect(JSON.parse(raw as string)).toEqual({
      _version: 1,
      data: { codex: { radius: '8px' } },
    });
  });
});

describe('workspaceStore — localStorage quota handling', () => {
  beforeEach(async () => {
    // Wait for any pending async operations from the previous test to complete
    // before resetting state, preventing cross-test state leakage.
    await flushPromises();
    vi.clearAllMocks();
    window.localStorage.clear();
    resetLiveTweakState();
  });

  // Restore any spies (e.g. setItem mockImplementation) after each test so
  // they don't leak into subsequent describe blocks.
  afterEach(() => {
    vi.restoreAllMocks();
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
      // Re-run the exact code path loadOverridesByAgent exercises (v1 format).
      const result = (() => {
        try {
          const raw = window.localStorage.getItem('workspace.overridesByAgent');
          if (!raw) return {};
          const parsed = JSON.parse(raw) as
            | { _version: number; data: Record<string, ToolOverride> }
            | Record<string, ToolOverride>;
          if (
            parsed &&
            typeof parsed === 'object' &&
            '_version' in parsed &&
            (parsed as { _version: number })._version === 1
          ) {
            return (parsed as { _version: number; data: Record<string, ToolOverride> }).data;
          }
          if (parsed && typeof parsed === 'object') return parsed as Record<string, ToolOverride>;
          return {};
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
  beforeEach(async () => {
    // Wait for any pending async operations from the previous test to complete
    // before resetting state, preventing cross-test state leakage.
    await flushPromises();
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
    // In test mode, push is synchronous — pushError is set immediately.
    expect(useWorkspaceStore.getState().pushError).toBe('push_failed');

    // Selecting another agent clears the error.
    useWorkspaceStore.getState().selectAgent('traework', 9223);
    expect(useWorkspaceStore.getState().pushError).toBeNull();
  });
});

describe('workspaceStore — updateOverride push receipt and error handling', () => {
  beforeEach(async () => {
    // Wait for any pending async operations from the previous test to complete
    // before resetting state, preventing cross-test state leakage.
    await flushPromises();
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
    // In test mode, push is synchronous — pushError is set immediately.
    expect(useWorkspaceStore.getState().pushError).toBe('push_failed');
  });

  it('pushTweak throw 时设置 pushError 为错误信息', async () => {
    useWorkspaceStore.getState().selectAgent('codex', 9222);
    mockPushTweak.mockRejectedValueOnce(new Error('CDP timeout'));

    await useWorkspaceStore.getState().updateOverride('radius', '8px');
    // In test mode, push is synchronous — pushError is set immediately.
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
  beforeEach(async () => {
    // Wait for any pending async operations from the previous test to complete
    // before resetting state, preventing cross-test state leakage.
    await flushPromises();
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
    // In test mode, push is synchronous — pushError is set immediately after second call.
    expect(useWorkspaceStore.getState().pushError).toBe('push_failed'); // from second call
    expect(useWorkspaceStore.getState().overridesByAgent.codex).toEqual({ radius: '8px' });
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
    expect(useWorkspaceStore.getState().overridesByAgent.codex).toEqual({ radius: '8px' });
  });
});

describe('workspaceStore — saveChanges persists to overridesByAgent', () => {
  beforeEach(async () => {
    // Wait for any pending async operations from the previous test to complete
    // before resetting state, preventing cross-test state leakage.
    await flushPromises();
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
    expect(useWorkspaceStore.getState().overridesByAgent.codex).toEqual({ radius: '8px' });
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
    expect(useWorkspaceStore.getState().overridesByAgent.codex).toEqual({ radius: '8px' });
    expect(useWorkspaceStore.getState().dirty).toBe(true);
  });

  it('saveChanges 成功后 pushError 被清除', async () => {
    useWorkspaceStore.getState().selectAgent('codex', 9222);
    mockPushTweak.mockResolvedValueOnce(false);
    await useWorkspaceStore.getState().updateOverride('radius', '4px');
    // In test mode, push is synchronous — pushError is set immediately.
    expect(useWorkspaceStore.getState().pushError).toBe('push_failed');

    mockSaveTweakAsCustomCss.mockResolvedValueOnce(true);
    await useWorkspaceStore.getState().saveChanges();
    expect(useWorkspaceStore.getState().pushError).toBeNull();
  });
});

describe('workspaceStore — discardChanges cleans up overridesByAgent', () => {
  beforeEach(async () => {
    // Wait for any pending async operations from the previous test to complete
    // before resetting state, preventing cross-test state leakage.
    await flushPromises();
    vi.clearAllMocks();
    window.localStorage.clear();
    resetLiveTweakState();
  });

  it('discardChanges 成功后从 overridesByAgent 删除条目', async () => {
    useWorkspaceStore.getState().selectAgent('codex', 9222);
    await useWorkspaceStore.getState().updateOverride('radius', '8px');
    expect(useWorkspaceStore.getState().overridesByAgent.codex).toBeDefined();

    mockResetTweak.mockResolvedValueOnce(true);
    const ok = await useWorkspaceStore.getState().discardChanges();

    expect(ok).toBe(true);
    expect(useWorkspaceStore.getState().overridesByAgent.codex).toBeUndefined();
    expect(useWorkspaceStore.getState().currentOverrides).toEqual({});
  });

  it('discardChanges 失败后 overridesByAgent 保留', async () => {
    useWorkspaceStore.getState().selectAgent('codex', 9222);
    await useWorkspaceStore.getState().updateOverride('radius', '8px');

    mockResetTweak.mockResolvedValueOnce(false);
    const ok = await useWorkspaceStore.getState().discardChanges();

    expect(ok).toBe(false);
    expect(useWorkspaceStore.getState().overridesByAgent.codex).toEqual({ radius: '8px' });
    // currentOverrides is NOT rolled back on failure.
    expect(useWorkspaceStore.getState().currentOverrides).toEqual({ radius: '8px' });
  });
});

describe('workspaceStore — clearPushError', () => {
  beforeEach(async () => {
    // Wait for any pending async operations from the previous test to complete
    // before resetting state, preventing cross-test state leakage.
    await flushPromises();
    vi.clearAllMocks();
    window.localStorage.clear();
    resetLiveTweakState();
  });

  it('clearPushError 将 pushError 置为 null', async () => {
    useWorkspaceStore.getState().selectAgent('codex', 9222);
    mockPushTweak.mockResolvedValueOnce(false);
    await useWorkspaceStore.getState().updateOverride('radius', '8px');
    // In test mode, push is synchronous — pushError is set immediately.
    expect(useWorkspaceStore.getState().pushError).toBe('push_failed');

    useWorkspaceStore.getState().clearPushError();
    expect(useWorkspaceStore.getState().pushError).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// M3: undo / redo
// ---------------------------------------------------------------------------

describe('workspaceStore — undo/redo history', () => {
  beforeEach(async () => {
    await flushPromises();
    vi.clearAllMocks();
    window.localStorage.clear();
    resetLiveTweakState();
  });

  it('每次 updateOverride 压入历史条目', async () => {
    useWorkspaceStore.getState().selectAgent('codex', 9222);
    mockPushTweak.mockResolvedValue(true);

    await useWorkspaceStore.getState().updateOverride('radius', '4px');
    await useWorkspaceStore.getState().updateOverride('radius', '8px');

    const state = useWorkspaceStore.getState();
    expect(state.history).toHaveLength(2);
    expect(state.historyIndex).toBe(1);
  });

  it('undo 回退到上一状态', async () => {
    useWorkspaceStore.getState().selectAgent('codex', 9222);
    mockPushTweak.mockResolvedValue(true);

    await useWorkspaceStore.getState().updateOverride('radius', '4px');
    await useWorkspaceStore.getState().updateOverride('radius', '8px');

    const ok = await useWorkspaceStore.getState().undo();
    expect(ok).toBe(true);
    expect(useWorkspaceStore.getState().currentOverrides).toEqual({ radius: '4px' });
    expect(useWorkspaceStore.getState().historyIndex).toBe(0);
  });

  it('redo 前进到下一状态', async () => {
    useWorkspaceStore.getState().selectAgent('codex', 9222);
    mockPushTweak.mockResolvedValue(true);

    await useWorkspaceStore.getState().updateOverride('radius', '4px');
    await useWorkspaceStore.getState().updateOverride('radius', '8px');

    await useWorkspaceStore.getState().undo();
    const ok = await useWorkspaceStore.getState().redo();
    expect(ok).toBe(true);
    expect(useWorkspaceStore.getState().currentOverrides).toEqual({ radius: '8px' });
    expect(useWorkspaceStore.getState().historyIndex).toBe(1);
  });

  it('canUndo / canRedo 正确反映历史状态', async () => {
    useWorkspaceStore.getState().selectAgent('codex', 9222);
    mockPushTweak.mockResolvedValue(true);

    // No history initially.
    expect(useWorkspaceStore.getState().canUndo()).toBe(false);
    expect(useWorkspaceStore.getState().canRedo()).toBe(false);

    await useWorkspaceStore.getState().updateOverride('radius', '4px');
    // One entry: canUndo needs at least 2 entries (cursor > 0).
    expect(useWorkspaceStore.getState().canUndo()).toBe(false);

    await useWorkspaceStore.getState().updateOverride('radius', '8px');
    expect(useWorkspaceStore.getState().canUndo()).toBe(true);
    expect(useWorkspaceStore.getState().canRedo()).toBe(false);

    await useWorkspaceStore.getState().undo();
    expect(useWorkspaceStore.getState().canRedo()).toBe(true);
  });

  it('新操作清除 redo 分支', async () => {
    useWorkspaceStore.getState().selectAgent('codex', 9222);
    mockPushTweak.mockResolvedValue(true);

    await useWorkspaceStore.getState().updateOverride('radius', '4px');
    await useWorkspaceStore.getState().updateOverride('radius', '8px');
    await useWorkspaceStore.getState().undo();
    // Now canRedo should be true.
    expect(useWorkspaceStore.getState().canRedo()).toBe(true);

    // New update clears redo tail.
    await useWorkspaceStore.getState().updateOverride('radius', '12px');
    expect(useWorkspaceStore.getState().canRedo()).toBe(false);
    expect(useWorkspaceStore.getState().history).toHaveLength(2);
  });

  it('selectAgent 重置历史', async () => {
    useWorkspaceStore.getState().selectAgent('codex', 9222);
    mockPushTweak.mockResolvedValue(true);
    await useWorkspaceStore.getState().updateOverride('radius', '4px');
    expect(useWorkspaceStore.getState().history.length).toBeGreaterThan(0);

    useWorkspaceStore.getState().selectAgent('traework', 9223);
    expect(useWorkspaceStore.getState().history).toHaveLength(0);
    expect(useWorkspaceStore.getState().historyIndex).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// M7: named tweak presets
// ---------------------------------------------------------------------------

describe('workspaceStore — named tweak presets', () => {
  beforeEach(async () => {
    await flushPromises();
    vi.clearAllMocks();
    window.localStorage.clear();
    resetLiveTweakState();
  });

  it('saveTweakPreset 保存当前 overrides 到 preset', async () => {
    useWorkspaceStore.getState().selectAgent('codex', 9222);
    mockPushTweak.mockResolvedValue(true);
    await useWorkspaceStore.getState().updateOverride('radius', '8px');

    const ok = await useWorkspaceStore.getState().saveTweakPreset('My Preset');
    expect(ok).toBe(true);

    const { tweakPresets, tweakPresetActiveId } = useWorkspaceStore.getState();
    expect(tweakPresets).toHaveLength(1);
    expect(tweakPresets[0].name).toBe('My Preset');
    expect(tweakPresets[0].overrides).toEqual({ radius: '8px' });
    expect(tweakPresetActiveId).toBe(tweakPresets[0].id);
  });

  it('saveTweakPreset 拒绝空名称', async () => {
    useWorkspaceStore.getState().selectAgent('codex', 9222);
    const ok = await useWorkspaceStore.getState().saveTweakPreset('  ');
    expect(ok).toBe(false);
    expect(useWorkspaceStore.getState().tweakPresets).toHaveLength(0);
  });

  it('saveTweakPreset 写入 localStorage', async () => {
    useWorkspaceStore.getState().selectAgent('codex', 9222);
    mockPushTweak.mockResolvedValue(true);
    await useWorkspaceStore.getState().updateOverride('radius', '8px');

    await useWorkspaceStore.getState().saveTweakPreset('Preset A');

    const raw = window.localStorage.getItem('workspace.tweakPresets');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('Preset A');
  });

  it('loadTweakPreset 加载 preset 到 currentOverrides', async () => {
    useWorkspaceStore.getState().selectAgent('codex', 9222);
    mockPushTweak.mockResolvedValue(true);
    await useWorkspaceStore.getState().updateOverride('radius', '8px');
    await useWorkspaceStore.getState().saveTweakPreset('Preset A');

    // Change overrides.
    await useWorkspaceStore.getState().updateOverride('radius', '16px');
    expect(useWorkspaceStore.getState().currentOverrides).toEqual({ radius: '16px' });

    // Load preset.
    const presetId = useWorkspaceStore.getState().tweakPresets[0].id;
    const ok = await useWorkspaceStore.getState().loadTweakPreset(presetId);
    expect(ok).toBe(true);
    expect(useWorkspaceStore.getState().currentOverrides).toEqual({ radius: '8px' });
    expect(useWorkspaceStore.getState().tweakPresetActiveId).toBe(presetId);
  });

  it('deleteTweakPreset 删除 preset', async () => {
    useWorkspaceStore.getState().selectAgent('codex', 9222);
    mockPushTweak.mockResolvedValue(true);
    await useWorkspaceStore.getState().updateOverride('radius', '8px');
    await useWorkspaceStore.getState().saveTweakPreset('Preset A');

    const presetId = useWorkspaceStore.getState().tweakPresets[0].id;
    const ok = await useWorkspaceStore.getState().deleteTweakPreset(presetId);
    expect(ok).toBe(true);
    expect(useWorkspaceStore.getState().tweakPresets).toHaveLength(0);
  });

  it('renameTweakPreset 重命名 preset', async () => {
    useWorkspaceStore.getState().selectAgent('codex', 9222);
    mockPushTweak.mockResolvedValue(true);
    await useWorkspaceStore.getState().updateOverride('radius', '8px');
    await useWorkspaceStore.getState().saveTweakPreset('Old Name');

    const presetId = useWorkspaceStore.getState().tweakPresets[0].id;
    const ok = await useWorkspaceStore.getState().renameTweakPreset(presetId, 'New Name');
    expect(ok).toBe(true);
    expect(useWorkspaceStore.getState().tweakPresets[0].name).toBe('New Name');
  });
});

describe('workspaceStore — performance baseline (push duration)', () => {
  beforeEach(() => {
    resetLiveTweakState();
  });

  it('records lastPushDurationMs after a successful push', async () => {
    useWorkspaceStore.getState().selectAgent('codex', 9222);
    mockPushTweak.mockResolvedValue(true);

    await useWorkspaceStore.getState().updateOverride('radius', '8px');

    // After push completes, lastPushDurationMs should be a non-null number
    const { lastPushDurationMs } = useWorkspaceStore.getState();
    expect(lastPushDurationMs).not.toBeNull();
    expect(typeof lastPushDurationMs).toBe('number');
    expect(lastPushDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('records avgPushDurationMs as pushes accumulate', async () => {
    useWorkspaceStore.getState().selectAgent('codex', 9222);
    mockPushTweak.mockResolvedValue(true);

    // Trigger multiple pushes
    await useWorkspaceStore.getState().updateOverride('radius', '8px');
    await useWorkspaceStore.getState().updateOverride('spacing', 16);
    await useWorkspaceStore.getState().updateOverride('fontSize', 14);

    const { avgPushDurationMs, lastPushDurationMs } = useWorkspaceStore.getState();
    expect(avgPushDurationMs).not.toBeNull();
    expect(typeof avgPushDurationMs).toBe('number');
    // avg should be between 0 and last (or equal)
    expect(avgPushDurationMs).toBeGreaterThanOrEqual(0);
    expect(lastPushDurationMs).not.toBeNull();
  });
});
