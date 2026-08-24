// SPDX-License-Identifier: MPL-2.0

/**
 * # capture-store tests
 *
 * Verifies CaptureState override/undo-redo pipeline: initial state,
 * setOverride mutation + undo-stack push, undo/redo round-trip,
 * empty-stack safety, and clearOverrides.
 *
 * External modules (@/api/agentSkinClient, @/stores/notificationStore,
 * @/stores/shellStore, @/studio/project-store) are mocked via vi.hoisted
 * + vi.mock so tests run without Electron IPC.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockShowToast } = vi.hoisted(() => ({
  mockShowToast: vi.fn(),
}));

vi.mock('@/api/agentSkinClient', () => ({
  api: {
    exportStudioTheme: vi.fn(),
    snapshotBaseline: vi.fn(),
    restoreApp: vi.fn(),
    startInspect: vi.fn(),
    stopInspect: vi.fn(),
    saveStudioProject: vi.fn(),
  },
}));

vi.mock('@/stores/notificationStore', () => ({
  useNotificationStore: {
    getState: vi.fn(() => ({
      showToast: mockShowToast,
    })),
  },
}));

vi.mock('@/stores/shellStore', () => ({
  useShellStore: {
    getState: vi.fn(() => ({
      locale: 'en' as const,
    })),
  },
}));

vi.mock('@/studio/project-store', () => ({
  useProjectStore: {
    getState: vi.fn(() => ({
      getActiveProject: vi.fn(() => null),
      activeProjectId: null,
      saveActiveProject: vi.fn(),
    })),
    setState: vi.fn(),
  },
}));

vi.mock('@/lib/palette', () => ({
  mergeOverridesToSkinTokens: vi.fn(() => ({})),
}));

// Import AFTER all mocks are in place
import { useCaptureStore } from '@/studio/capture-store';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reset store to clean slate before each test. */
const resetStore = () => {
  useCaptureStore.setState({
    previewView: 'theme',
    inspectingIdx: null,
    searchQuery: '',
    hoveredIdx: null,
    toolOverrides: null,
    undoStack: [],
    redoStack: [],
    inspectMode: false,
    liveNode: null,
    liveError: null,
    pinnedSelectors: [],
    pseudoStates: [],
    captureSchemes: false,
    customSelectorInput: '',
    pseudoView: null,
    schemeView: null,
    baselines: {},
    baselineLoadingMap: {},
    baselineErrorMap: {},
    exportName: '',
    exportAuthor: '',
    exportState: { loading: false, dir: null, error: null },
    domTreeVersion: 0,
  });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useCaptureStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ------------------------------------------------------------------
  // 1. Initial state
  // ------------------------------------------------------------------

  it('initializes with previewView="theme", empty overrides and undo stack', () => {
    const state = useCaptureStore.getState();
    expect(state.previewView).toBe('theme');
    expect(state.toolOverrides).toBeNull();
    expect(state.undoStack).toEqual([]);
    expect(state.redoStack).toEqual([]);
    expect(state.inspectMode).toBe(false);
    expect(state.hoveredIdx).toBeNull();
  });

  // ------------------------------------------------------------------
  // 2. setOverride — updates toolOverrides and pushes undo
  // ------------------------------------------------------------------

  it('setOverride updates toolOverrides and pushes the previous state onto undoStack', () => {
    useCaptureStore.getState().setOverride('accent', '#ff0000');

    const state = useCaptureStore.getState();
    expect(state.toolOverrides).toMatchObject({ accent: '#ff0000' });
    // undoStack got the previous null pushed.
    expect(state.undoStack).toHaveLength(1);
    // redoStack is cleared.
    expect(state.redoStack).toEqual([]);
  });

  it('setOverride can add multiple keys independently', async () => {
    // Use a different key than prior tests to avoid undo-coalesce bleed.
    useCaptureStore.getState().setOverride('background', '#111111');
    // Wait past the 700ms coalesce window so this is a separate undo step.
    await new Promise((r) => setTimeout(r, 800));
    useCaptureStore.getState().setOverride('radius', '8px');

    const state = useCaptureStore.getState();
    expect(state.toolOverrides).toMatchObject({ background: '#111111', radius: '8px' });
    expect(state.undoStack).toHaveLength(2);
  });

  it('setOverride with undefined value removes the key', async () => {
    useCaptureStore.getState().setOverride('fontSize', 14);
    await new Promise((r) => setTimeout(r, 800));
    useCaptureStore.getState().setOverride('fontSize', undefined);

    const state = useCaptureStore.getState();
    expect(state.toolOverrides?.fontSize).toBeUndefined();
  });

  // ------------------------------------------------------------------
  // 3. undo — reverts to previous overrides state
  // ------------------------------------------------------------------

  it('undo reverts toolOverrides to previous state and pushes to redoStack', async () => {
    useCaptureStore.getState().setOverride('accent', '#ff0000');
    // Wait past the 700ms coalesce window so this is a separate undo step.
    await new Promise((r) => setTimeout(r, 800));
    useCaptureStore.getState().setOverride('background', '#000000');

    // Before undo: overrides have both keys.
    expect(useCaptureStore.getState().toolOverrides).toMatchObject({
      accent: '#ff0000',
      background: '#000000',
    });

    useCaptureStore.getState().undo();

    const state = useCaptureStore.getState();
    // Should have reverted to { accent: '#ff0000' }.
    expect(state.toolOverrides).toMatchObject({ accent: '#ff0000' });
    expect(state.toolOverrides?.background).toBeUndefined();
    expect(state.undoStack).toHaveLength(1);
    expect(state.redoStack).toHaveLength(1);
  });

  // ------------------------------------------------------------------
  // 4. redo — re-applies undone state
  // ------------------------------------------------------------------

  it('redo re-applies the undone state', async () => {
    useCaptureStore.getState().setOverride('accent', '#ff0000');
    await new Promise((r) => setTimeout(r, 800));
    useCaptureStore.getState().setOverride('radius', '4px');

    useCaptureStore.getState().undo();
    useCaptureStore.getState().redo();

    const state = useCaptureStore.getState();
    expect(state.toolOverrides).toMatchObject({ accent: '#ff0000', radius: '4px' });
    expect(state.undoStack).toHaveLength(2);
    expect(state.redoStack).toHaveLength(0);
  });

  // ------------------------------------------------------------------
  // 5. undo on empty stack — does not crash
  // ------------------------------------------------------------------

  it('undo is a no-op when undoStack is empty', () => {
    expect(useCaptureStore.getState().undoStack).toEqual([]);
    // Must not throw.
    useCaptureStore.getState().undo();
    expect(useCaptureStore.getState().toolOverrides).toBeNull();
  });

  it('redo is a no-op when redoStack is empty', () => {
    useCaptureStore.getState().redo();
    // No crash, no state change.
    expect(useCaptureStore.getState().toolOverrides).toBeNull();
  });

  // ------------------------------------------------------------------
  // 6. clearOverrides (resetOverrides) — clears overrides and stacks
  // ------------------------------------------------------------------

  it('resetOverrides pushes current state to undo, clears overrides and redoStack', async () => {
    useCaptureStore.getState().setOverride('accent', '#abc');
    await new Promise((r) => setTimeout(r, 800));
    useCaptureStore.getState().setOverride('background', '#123');

    useCaptureStore.getState().resetOverrides();

    const state = useCaptureStore.getState();
    expect(state.toolOverrides).toBeNull();
    // Both undo and redo should be pushed/cleared.
    expect(state.redoStack).toEqual([]);
    // undo now has the history + the pre-reset snapshot.
    expect(state.undoStack.length).toBeGreaterThan(0);
  });
});
