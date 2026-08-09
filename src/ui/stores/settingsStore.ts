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

export type SettingsSection = 'general' | 'system' | 'about' | 'advanced' | 'wallpaper';

interface SettingsState {
  settingsOpen: boolean;
  settingsSection: SettingsSection;
  settings: DesktopSettings | null;

  setSettingsOpen: (open: boolean) => void;
  setSettingsSection: (section: SettingsSection) => void;
  /** Load settings so the page is ready when the route switches. */
  openSettings: (section?: SettingsSection) => Promise<void>;
  chooseAppPath: (appId: AgentId) => Promise<void>;
  clearAppPath: (appId: AgentId) => Promise<void>;
  saveAppPort: (appId: AgentId, port: number | null) => Promise<boolean>;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settingsOpen: false,
  settingsSection: 'general',
  settings: null,

  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setSettingsSection: (settingsSection) => set({ settingsSection }),

  openSettings: async (section = 'general') => {
    set({ settingsSection: section });
    try {
      set({ settings: await api.getSettings() });
    } catch (error) {
      useNotificationStore.getState().fail(error);
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
}));
