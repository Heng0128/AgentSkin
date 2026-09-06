// SPDX-License-Identifier: MPL-2.0

/**
 * # sync-hooks tests
 *
 * Verifies initStudioCrossSync behavior: when the active project changes,
 * capture store transient state (undo/redo stacks, pinned selectors, tool
 * overrides, etc.) is reset so overrides from one project don't leak
 * into another.
 *
 * Uses vi.hoisted + vi.mock to avoid pulling in Electron IPC dependencies.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock state (captured via vi.hoisted so vi.mock factories can close
// over them without TDZ issues).
// ---------------------------------------------------------------------------

const {
  mockCaptureGetState,
  mockCaptureSetState,
  mockCaptureState,
  getCurrentActiveProjectId,
  setCurrentActiveProjectId,
  projectSubscribers,
} = vi.hoisted(() => {
  const mockCaptureState = {
    undoStack: [{ fontSize: '16px' }],
    redoStack: [{ fontWeight: 'bold' }],
    pinnedSelectors: ['#header', '.btn'],
    pseudoStates: ['hover'],
    customSelectorInput: '#main',
    pseudoView: 'hover',
    schemeView: 'light' as const,
    inspectingIdx: 3,
    toolOverrides: { fontSize: '16px' },
    resetOverrides: vi.fn(),
  };
  type ProjectSubscriber = (s: { activeProjectId: string | null }) => void;
  const subscribers: ProjectSubscriber[] = [];
  let activeId: string | null = 'proj-1';

  return {
    mockCaptureGetState: vi.fn(() => mockCaptureState),
    mockCaptureSetState: vi.fn(),
    mockCaptureState,
    getCurrentActiveProjectId: () => activeId,
    setCurrentActiveProjectId: (id: string | null) => {
      activeId = id;
    },
    projectSubscribers: subscribers,
  };
});

vi.mock('@/studio/capture-store', () => ({
  useCaptureStore: {
    getState: mockCaptureGetState,
    setState: mockCaptureSetState,
  },
}));

vi.mock('@/studio/project-store', () => ({
  useProjectStore: {
    getState: vi.fn(() => ({
      activeProjectId: getCurrentActiveProjectId(),
    })),
    subscribe: vi.fn((cb: (s: { activeProjectId: string | null }) => void) => {
      projectSubscribers.push(cb);
      return () => {
        const idx = projectSubscribers.indexOf(cb);
        if (idx !== -1) projectSubscribers.splice(idx, 1);
      };
    }),
  },
}));

// ---------------------------------------------------------------------------
// SUT (import after mocks)
// ---------------------------------------------------------------------------

import { initStudioCrossSync } from '../sync-hooks';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('initStudioCrossSync', () => {
  beforeEach(() => {
    projectSubscribers.length = 0;
    vi.clearAllMocks();
    setCurrentActiveProjectId('proj-1');
    vi.mocked(mockCaptureState.resetOverrides).mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('subscribes to project-store on init and returns an unsubscribe function', () => {
    const unsub = initStudioCrossSync();
    expect(projectSubscribers).toHaveLength(1);
    expect(typeof unsub).toBe('function');
    unsub();
    expect(projectSubscribers).toHaveLength(0);
  });

  it('does NOT reset capture state when activeProjectId is unchanged', () => {
    initStudioCrossSync();
    // Notify with same id.
    projectSubscribers[0]({ activeProjectId: 'proj-1' });
    expect(mockCaptureState.resetOverrides).not.toHaveBeenCalled();
    expect(mockCaptureSetState).not.toHaveBeenCalled();
  });

  it('resets capture transient state when activeProjectId changes', () => {
    initStudioCrossSync();
    // Simulate switching to a different project.
    projectSubscribers[0]({ activeProjectId: 'proj-2' });

    // resetOverrides called first (tool overrides cleanup).
    expect(mockCaptureState.resetOverrides).toHaveBeenCalledTimes(1);

    // setState called with cleared transient state.
    expect(mockCaptureSetState).toHaveBeenCalledTimes(1);
    expect(mockCaptureSetState.mock.calls[0][0]).toMatchObject({
      undoStack: [],
      redoStack: [],
      pinnedSelectors: [],
      pseudoStates: [],
      customSelectorInput: '',
      pseudoView: null,
      schemeView: null,
      inspectingIdx: null,
    });
  });

  it('only resets on actual ID change — repeated same-id notifications are no-ops', () => {
    initStudioCrossSync();

    projectSubscribers[0]({ activeProjectId: 'proj-2' }); // change
    projectSubscribers[0]({ activeProjectId: 'proj-2' }); // same
    projectSubscribers[0]({ activeProjectId: 'proj-2' }); // same
    projectSubscribers[0]({ activeProjectId: 'proj-3' }); // change

    expect(mockCaptureState.resetOverrides).toHaveBeenCalledTimes(2);
    expect(mockCaptureSetState).toHaveBeenCalledTimes(2);
  });

  it('handles null → id transition (first project loaded)', () => {
    setCurrentActiveProjectId(null);
    initStudioCrossSync();

    projectSubscribers[0]({ activeProjectId: 'proj-1' });

    expect(mockCaptureState.resetOverrides).toHaveBeenCalledTimes(1);
    expect(mockCaptureSetState).toHaveBeenCalledTimes(1);
  });

  it('handles id → null transition (last project deleted)', () => {
    initStudioCrossSync();
    projectSubscribers[0]({ activeProjectId: null });

    expect(mockCaptureState.resetOverrides).toHaveBeenCalledTimes(1);
    expect(mockCaptureSetState).toHaveBeenCalledTimes(1);
  });
});
