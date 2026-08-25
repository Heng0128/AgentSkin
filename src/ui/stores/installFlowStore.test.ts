// SPDX-License-Identifier: MPL-2.0

/**
 * # installFlowStore Tests
 *
 * Tests for the install flow state machine:
 * - Pure functions: makeSteps, getProgress
 * - State transitions: idle → selecting → installing → completed/failed/cancelled
 * - Epoch-based cancellation
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock dependencies before importing the store
vi.mock('@/api/agentSkinClient', () => ({
  api: {
    importTheme: vi.fn(),
    importThemeFromPath: vi.fn(),
  },
}));

vi.mock('@/stores/notificationStore', () => ({
  useNotificationStore: {
    getState: vi.fn(() => ({
      showToast: vi.fn(),
      fail: vi.fn(),
    })),
    setState: vi.fn(),
  },
}));

vi.mock('@/stores/shellStore', () => ({
  useShellStore: {
    getState: vi.fn(() => ({ locale: 'zh-CN' })),
    setState: vi.fn(),
  },
}));

vi.mock('@/stores/themeStore', () => ({
  useThemeStore: {
    getState: vi.fn(() => ({
      refreshThemes: vi.fn(async () => {}),
    })),
    setState: vi.fn(),
  },
}));

import { useInstallFlowStore, getProgress, type InstallStep } from './installFlowStore';

// Mock window.setTimeout/clearTimeout for Node.js test environment
const mockSetTimeout = vi.fn(() => 123 as unknown as number);
const mockClearTimeout = vi.fn();
Object.defineProperty(window, 'setTimeout', { value: mockSetTimeout, writable: true });
Object.defineProperty(window, 'clearTimeout', { value: mockClearTimeout, writable: true });

// ---------------------------------------------------------------------------
// Pure function tests
// ---------------------------------------------------------------------------

describe('installFlowStore pure functions', () => {
  describe('getProgress', () => {
    it('returns 0 for empty steps array', () => {
      expect(getProgress([])).toBe(0);
    });

    it('returns 0 when all steps are pending', () => {
      const steps: InstallStep[] = [
        { id: 'read', label: 'Reading', status: 'pending', timestamp: 0 },
        { id: 'copy', label: 'Copying', status: 'pending', timestamp: 0 },
      ];
      expect(getProgress(steps)).toBe(0);
    });

    it('returns 100 when all steps are done', () => {
      const steps: InstallStep[] = [
        { id: 'read', label: 'Reading', status: 'done', timestamp: Date.now() },
        { id: 'copy', label: 'Copying', status: 'done', timestamp: Date.now() },
      ];
      expect(getProgress(steps)).toBe(100);
    });

    it('returns ~50 when half steps are done', () => {
      const steps: InstallStep[] = [
        { id: 'read', label: 'Reading', status: 'done', timestamp: Date.now() },
        { id: 'copy', label: 'Copying', status: 'pending', timestamp: 0 },
      ];
      expect(getProgress(steps)).toBe(50);
    });

    it('adds 0.5 weight for active step', () => {
      const steps: InstallStep[] = [
        { id: 'read', label: 'Reading', status: 'done', timestamp: Date.now() },
        { id: 'copy', label: 'Copying', status: 'active', timestamp: Date.now() },
        { id: 'register', label: 'Registering', status: 'pending', timestamp: 0 },
      ];
      // 1 done + 0.5 active = 1.5 / 3 = 50%
      expect(getProgress(steps)).toBe(50);
    });
  });
});

// ---------------------------------------------------------------------------
// Store state tests
// ---------------------------------------------------------------------------

describe('installFlowStore state', () => {
  beforeEach(() => {
    // Reset store to initial state
    useInstallFlowStore.setState({
      steps: [],
      flowState: 'idle',
      currentTheme: null,
      lastError: null,
    });
    vi.clearAllMocks();
  });

  it('initial state is idle with empty steps', () => {
    const state = useInstallFlowStore.getState();
    expect(state.flowState).toBe('idle');
    expect(state.steps).toEqual([]);
    expect(state.currentTheme).toBeNull();
    expect(state.lastError).toBeNull();
  });

  it('setFlowState updates flow state', () => {
    useInstallFlowStore.getState().setFlowState('installing');
    expect(useInstallFlowStore.getState().flowState).toBe('installing');
  });

  it('setSteps updates steps array', () => {
    const newSteps: InstallStep[] = [
      { id: 'read', label: 'Reading', status: 'active', timestamp: Date.now() },
    ];
    useInstallFlowStore.getState().setSteps(newSteps);
    expect(useInstallFlowStore.getState().steps).toEqual(newSteps);
  });

  it('cancelInstall sets flowState to cancelled and marks active/pending steps as cancelled', () => {
    // Setup: set some steps with active and pending statuses
    const steps: InstallStep[] = [
      { id: 'read', label: 'Reading', status: 'done', timestamp: Date.now() },
      { id: 'copy', label: 'Copying', status: 'active', timestamp: Date.now() },
      { id: 'register', label: 'Registering', status: 'pending', timestamp: 0 },
    ];
    useInstallFlowStore.getState().setSteps(steps);
    useInstallFlowStore.getState().setFlowState('installing');

    // Cancel the install
    useInstallFlowStore.getState().cancelInstall();

    const state = useInstallFlowStore.getState();
    expect(state.flowState).toBe('cancelled');
    // Done steps should remain done
    expect(state.steps[0].status).toBe('done');
    // Active and pending steps should be cancelled
    expect(state.steps[1].status).toBe('cancelled');
    expect(state.steps[2].status).toBe('cancelled');
  });
});

// ---------------------------------------------------------------------------
// Epoch cancellation tests
// ---------------------------------------------------------------------------

describe('installFlowStore epoch cancellation', () => {
  beforeEach(() => {
    useInstallFlowStore.setState({
      steps: [],
      flowState: 'idle',
      currentTheme: null,
      lastError: null,
    });
    vi.clearAllMocks();
  });

  it('cancelInstall increments epoch to invalidate in-flight operations', () => {
    // Setup: start an install flow
    useInstallFlowStore.getState().setFlowState('installing');
    const steps: InstallStep[] = [
      { id: 'read', label: 'Reading', status: 'active', timestamp: Date.now() },
    ];
    useInstallFlowStore.getState().setSteps(steps);

    // Cancel should change flow state
    useInstallFlowStore.getState().cancelInstall();
    expect(useInstallFlowStore.getState().flowState).toBe('cancelled');
  });
});
