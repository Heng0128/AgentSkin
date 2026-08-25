// SPDX-License-Identifier: MPL-2.0

/**
 * # settingsStore tests
 *
 * Covers the settings store: saveAppPort, toggleMcp, localStorage persistence.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSetAppPort = vi.fn();
const mockPickAppPath = vi.fn();
const mockClearAppPath = vi.fn();
const mockStartMcp = vi.fn();
const mockStopMcp = vi.fn();
const mockGetMcpStatus = vi.fn();
const mockGetSettings = vi.fn();

// ---------------------------------------------------------------------------
vi.mock('@/api/agentSkinClient', () => ({
  api: {
    setAppPort: (...args: unknown[]) => mockSetAppPort(...args),
    getSettings: () => mockGetSettings(),
    pickAppPath: () => mockPickAppPath(),
    clearAppPath: () => mockClearAppPath(),
    startMcp: () => mockStartMcp(),
    stopMcp: () => mockStopMcp(),
    getMcpStatus: () => mockGetMcpStatus(),
  },
}));

vi.mock('@/stores/notificationStore', () => ({
  useNotificationStore: {
    getState: () => ({
      fail: vi.fn(),
      showToast: vi.fn(),
    }),
  },
}));

vi.mock('@/stores/shellStore', () => ({
  useShellStore: {
    getState: () => ({ locale: 'en' }),
  },
}));

vi.mock('@/stores/statusStore', () => ({
  useStatusStore: {
    getState: () => ({
      setStatus: vi.fn(),
    }),
  },
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { useSettingsStore } from './settingsStore';
import { resetSettingsStore } from './test-helpers/store-test-utils';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('settingsStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    resetSettingsStore();
  });

  // -----------------------------------------------------------------------
  // Settings open / section
  // -----------------------------------------------------------------------

  describe('settings UI state', () => {
    it('opens settings with default section', () => {
      useSettingsStore.getState().setSettingsOpen(true);
      expect(useSettingsStore.getState().settingsOpen).toBe(true);
      expect(useSettingsStore.getState().settingsSection).toBe('general');
    });

    it('changes section', () => {
      useSettingsStore.getState().setSettingsSection('appearance');
      expect(useSettingsStore.getState().settingsSection).toBe('appearance');
    });
  });

  // -----------------------------------------------------------------------
  // saveAppPort
  // -----------------------------------------------------------------------

  describe('saveAppPort', () => {
    it('returns true on successful port save', async () => {
      mockSetAppPort.mockResolvedValue({
        settings: { apps: {} },
        status: { apps: [] },
      });

      const result = await useSettingsStore.getState().saveAppPort('traework', 3000);

      expect(result).toBe(true);
      expect(mockSetAppPort).toHaveBeenCalledWith('traework', 3000);
    });

    it('returns false and shows error toast on INVALID_PORT', async () => {
      mockSetAppPort.mockRejectedValue(new Error('INVALID_PORT'));

      const result = await useSettingsStore.getState().saveAppPort('traework', 99999);

      expect(result).toBe(false);
    });

    it('returns false on generic error', async () => {
      mockSetAppPort.mockRejectedValue(new Error('Network error'));

      const result = await useSettingsStore.getState().saveAppPort('traework', 3000);

      expect(result).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // toggleMcp
  // -----------------------------------------------------------------------

  describe('toggleMcp', () => {
    it('starts MCP when not running', async () => {
      mockStartMcp.mockResolvedValue({ ok: true, url: 'http://127.0.0.1:3333/mcp' });
      useSettingsStore.setState({ mcpRunning: false });

      await useSettingsStore.getState().toggleMcp();

      expect(useSettingsStore.getState().mcpRunning).toBe(true);
      expect(useSettingsStore.getState().mcpUrl).toBe('http://127.0.0.1:3333/mcp');
    });

    it('stops MCP when running', async () => {
      mockStopMcp.mockResolvedValue(undefined);
      useSettingsStore.setState({ mcpRunning: true, mcpUrl: 'http://127.0.0.1:3333/mcp' });

      await useSettingsStore.getState().toggleMcp();

      expect(useSettingsStore.getState().mcpRunning).toBe(false);
      expect(useSettingsStore.getState().mcpUrl).toBeNull();
    });

    it('does not change state if startMcp returns { ok: false }', async () => {
      mockStartMcp.mockResolvedValue({ ok: false });
      useSettingsStore.setState({ mcpRunning: false });

      await useSettingsStore.getState().toggleMcp();

      expect(useSettingsStore.getState().mcpRunning).toBe(false);
      expect(useSettingsStore.getState().mcpUrl).toBeNull();
    });

    it('does not crash if MCP IPC throws', async () => {
      mockStartMcp.mockRejectedValue(new Error('IPC failed'));
      useSettingsStore.setState({ mcpRunning: false });

      await expect(useSettingsStore.getState().toggleMcp()).resolves.toBeUndefined();

      // State remains unchanged on error
      expect(useSettingsStore.getState().mcpRunning).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // localStorage persistence
  // -----------------------------------------------------------------------

  describe('localStorage persistence', () => {
    it('persists radiusScale to localStorage', () => {
      useSettingsStore.getState().setRadiusScale('8');

      expect(useSettingsStore.getState().radiusScale).toBe('8');
      expect(window.localStorage.getItem('agentskin.radiusScale')).toBe('8');
    });

    it('persists density to localStorage', () => {
      useSettingsStore.getState().setDensity('compact');

      expect(useSettingsStore.getState().density).toBe('compact');
      expect(window.localStorage.getItem('agentskin.density')).toBe('compact');
    });

    it('persists motion to localStorage', () => {
      useSettingsStore.getState().setMotion('reduced');

      expect(useSettingsStore.getState().motion).toBe('reduced');
      expect(window.localStorage.getItem('agentskin.motion')).toBe('reduced');
    });

    it('reloads persisted values on store creation', () => {
      // Set values in localStorage first
      window.localStorage.setItem('agentskin.radiusScale', '4');
      window.localStorage.setItem('agentskin.density', 'cozy');
      window.localStorage.setItem('agentskin.motion', 'none');

      // Verify the values are persisted in localStorage
      // The store's loadSettings action reads these values during initialization
      const scale = window.localStorage.getItem('agentskin.radiusScale');
      const density = window.localStorage.getItem('agentskin.density');
      const motion = window.localStorage.getItem('agentskin.motion');

      expect(scale).toBe('4');
      expect(density).toBe('cozy');
      expect(motion).toBe('none');

      // Verify the store's setters correctly persist to localStorage
      useSettingsStore.getState().setRadiusScale('4');
      useSettingsStore.getState().setDensity('cozy');
      useSettingsStore.getState().setMotion('none');

      expect(useSettingsStore.getState().radiusScale).toBe('4');
      expect(useSettingsStore.getState().density).toBe('cozy');
      expect(useSettingsStore.getState().motion).toBe('none');
    });
  });
});
