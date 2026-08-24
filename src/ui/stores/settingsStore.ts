// SPDX-License-Identifier: MPL-2.0

/**
 * # settingsStore
 *
 * Settings dialog state and app-path/port mutations. All mutations call the
 * existing IPC endpoints; status changes are pushed to statusStore so the
 * global status bar reflects them independently.
 *
 * Extracted from `useSettings` (Phase A3). Translation strings (`t`) are
 * derived on demand from `shellStore.locale` (same pattern as
 * notificationStore) so there is no need to inject `t` into every action.
 */

import { api } from '@/api/agentSkinClient';
import { useNotificationStore } from '@/stores/notificationStore';
import { useShellStore } from '@/stores/shellStore';
import { useStatusStore } from '@/stores/statusStore';

import { toMessage } from '@shared/errors';
import { uiMessages } from '@shared/i18n';
import type { AgentId, DesktopSettings } from '@shared/types';
import { create } from 'zustand';

/** Build the i18n dictionary for the current locale. */
function currentT() {
  const locale = useShellStore.getState().locale;
  return uiMessages[locale];
}

export type SettingsSection = 'general' | 'appearance' | 'system' | 'about' | 'advanced';

/** User-selectable corner-radius scale (string-valued so it satisfies SegmentedOption<string>). Persisted to localStorage (UI-shell only). */
export type RadiusScale = '0' | '2' | '4' | '8';

/** User-selectable density (UI-shell CSS variable). Persisted to localStorage. */
export type Density = 'compact' | 'comfortable' | 'cozy';

/** User-selectable motion intensity (UI-shell CSS variable). Persisted to localStorage. */
export type Motion = 'full' | 'reduced' | 'none';

const RADIUS_SCALE_KEY = 'agentskin.radiusScale';
const DENSITY_KEY = 'agentskin.density';
const MOTION_KEY = 'agentskin.motion';

function loadRadiusScale(): RadiusScale {
  try {
    const raw = localStorage.getItem(RADIUS_SCALE_KEY);
    if (raw === '0' || raw === '2' || raw === '4' || raw === '8') return raw;
  } catch {
    // localStorage unavailable (private mode) — fall through to default.
  }
  return '2';
}

function loadDensity(): Density {
  try {
    const raw = localStorage.getItem(DENSITY_KEY);
    if (raw === 'compact' || raw === 'comfortable' || raw === 'cozy') return raw;
  } catch {
    // localStorage unavailable — fall through to default.
  }
  return 'comfortable';
}

function loadMotion(): Motion {
  try {
    const raw = localStorage.getItem(MOTION_KEY);
    if (raw === 'full' || raw === 'reduced' || raw === 'none') return raw;
  } catch {
    // localStorage unavailable — fall through to default.
  }
  return 'full';
}

interface SettingsState {
  settingsOpen: boolean;
  settingsSection: SettingsSection;
  settings: DesktopSettings | null;
  /** User-selected corner-radius scale (UI-shell CSS variable). */
  radiusScale: RadiusScale;
  /** User-selected density (UI-shell CSS variable). */
  density: Density;
  /** User-selected motion intensity (UI-shell CSS variable). */
  motion: Motion;
  /** MCP HTTP server running state. */
  mcpRunning: boolean;
  /** MCP HTTP server URL (e.g. "http://127.0.0.1:3333/mcp") or null when stopped. */
  mcpUrl: string | null;

  setSettingsOpen: (open: boolean) => void;
  setSettingsSection: (section: SettingsSection) => void;
  /** Persist and apply a new corner-radius scale. */
  setRadiusScale: (value: RadiusScale) => void;
  /** Persist and apply a new density. */
  setDensity: (value: Density) => void;
  /** Persist and apply a new motion intensity. */
  setMotion: (value: Motion) => void;
  /** Load settings so the page is ready when the route switches. */
  openSettings: (section?: SettingsSection) => Promise<void>;
  /** Load settings data without mutating the active section. */
  loadSettings: () => Promise<DesktopSettings | null>;
  chooseAppPath: (appId: AgentId) => Promise<void>;
  clearAppPath: (appId: AgentId) => Promise<void>;
  saveAppPort: (appId: AgentId, port: number | null) => Promise<boolean>;
  saveLiveDomRefreshInterval: (interval: number) => Promise<void>;
  /** Refresh MCP server status from main process. */
  refreshMcpStatus: () => Promise<void>;
  /** Toggle MCP HTTP server on/off. */
  toggleMcp: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settingsOpen: false,
  settingsSection: 'general',
  settings: null,
  radiusScale: loadRadiusScale(),
  density: loadDensity(),
  motion: loadMotion(),
  mcpRunning: false,
  mcpUrl: null,

  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setSettingsSection: (settingsSection) => set({ settingsSection }),
  setRadiusScale: (radiusScale) => {
    try {
      localStorage.setItem(RADIUS_SCALE_KEY, String(radiusScale));
    } catch {
      // localStorage unavailable — state still updates so the current session reflects the change.
    }
    set({ radiusScale });
  },
  setDensity: (density) => {
    try {
      localStorage.setItem(DENSITY_KEY, density);
    } catch {
      // localStorage unavailable — state still updates so the current session reflects the change.
    }
    set({ density });
  },
  setMotion: (motion) => {
    try {
      localStorage.setItem(MOTION_KEY, motion);
    } catch {
      // localStorage unavailable — state still updates so the current session reflects the change.
    }
    set({ motion });
  },

  openSettings: async (section = 'general') => {
    set({ settingsSection: section });
    try {
      set({ settings: await api.getSettings() });
    } catch (error) {
      useNotificationStore.getState().fail(error);
    }
  },

  loadSettings: async () => {
    try {
      const result = await api.getSettings();
      set({ settings: result });
      return result;
    } catch (error) {
      useNotificationStore.getState().fail(error);
      return null;
    }
  },

  chooseAppPath: async (appId) => {
    try {
      const result = await api.pickAppPath(appId);
      set({ settings: result.settings });
      useStatusStore.getState().setStatus(result.status);
      if (!result.canceled) useNotificationStore.getState().showToast(currentT().settingsSaved);
    } catch (error) {
      useNotificationStore.getState().fail(error);
    }
  },

  clearAppPath: async (appId) => {
    try {
      const result = await api.clearAppPath(appId);
      set({ settings: result.settings });
      useStatusStore.getState().setStatus(result.status);
      useNotificationStore.getState().showToast(currentT().settingsSaved);
    } catch (error) {
      useNotificationStore.getState().fail(error);
    }
  },

  saveAppPort: async (appId, port) => {
    try {
      const result = await api.setAppPort(appId, port);
      set({ settings: result.settings });
      useStatusStore.getState().setStatus(result.status);
      useNotificationStore.getState().showToast(currentT().settingsSaved);
      return true;
    } catch (error) {
      const message = toMessage(error);
      if (message.includes('INVALID_PORT')) {
        useNotificationStore.getState().showToast(currentT().settingsPortInvalid, 'destructive');
      } else {
        useNotificationStore.getState().fail(error);
      }
      return false;
    }
  },

  saveLiveDomRefreshInterval: async (interval) => {
    try {
      const result = await api.setLiveDomRefreshInterval(interval);
      set({ settings: result.settings });
      useNotificationStore.getState().showToast(currentT().settingsSaved);
    } catch (error) {
      useNotificationStore.getState().fail(error);
    }
  },

  refreshMcpStatus: async () => {
    try {
      const status = await api.getMcpStatus();
      set({ mcpRunning: status.running, mcpUrl: status.url });
    } catch {
      // Silently ignore — MCP status is non-critical.
    }
  },

  toggleMcp: async () => {
    const { mcpRunning } = useSettingsStore.getState();
    try {
      if (mcpRunning) {
        await api.stopMcp();
        set({ mcpRunning: false, mcpUrl: null });
      } else {
        const result = await api.startMcp();
        if (result.ok && result.url) {
          set({ mcpRunning: true, mcpUrl: result.url });
        }
      }
    } catch {
      // The main process handler always returns { ok, error }, so exceptions
      // here are unexpected. State remains unchanged.
    }
  },
}));
