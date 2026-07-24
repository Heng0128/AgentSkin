// SPDX-License-Identifier: MPL-2.0

/**
 * # useSettings
 *
 * Manages the settings dialog state and app-path/port mutations.
 * All mutations call the existing IPC endpoints and update shared status.
 */

import { useCallback, useState } from 'react';
import { api } from '@/api/agentSkinClient';

import { toMessage } from '@shared/errors';
import type { UiMessages } from '@shared/i18n';
import type { AgentId, DesktopSettings, SystemStatus } from '@shared/types';

export type SettingsSection = 'general' | 'apps' | 'wallpaper';

interface UseSettingsDeps {
  showToast: (message: string, tone?: 'default' | 'destructive') => void;
  fail: (error: unknown) => void;
  t: UiMessages;
  setStatus: (status: SystemStatus | null) => void;
}

export function useSettings(deps: UseSettingsDeps) {
  const { showToast, fail, t, setStatus } = deps;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general');
  const [settings, setSettings] = useState<DesktopSettings | null>(null);

  // Settings now live in-page (SettingsPage) instead of a dialog. openSettings
  // is kept as a convenience for callers that want to jump to a specific
  // section: it just loads the settings data so the page is ready when the
  // route switches. The dialog open flag is no longer used for rendering.
  const openSettings = useCallback((section: SettingsSection = 'general') => {
    setSettingsSection(section);
    void api
      .getSettings()
      .then(setSettings)
      .catch(() => undefined);
  }, []);

  const chooseAppPath = useCallback(
    async (appId: AgentId) => {
      try {
        const result = await api.pickAppPath(appId);
        setSettings(result.settings);
        setStatus(result.status);
        if (!result.canceled) showToast(t.settingsSaved);
      } catch (error) {
        fail(error);
      }
    },
    [fail, showToast, t, setStatus],
  );

  const clearAppPath = useCallback(
    async (appId: AgentId) => {
      try {
        const result = await api.clearAppPath(appId);
        setSettings(result.settings);
        setStatus(result.status);
        showToast(t.settingsSaved);
      } catch (error) {
        fail(error);
      }
    },
    [fail, showToast, t, setStatus],
  );

  const saveAppPort = useCallback(
    async (appId: AgentId, port: number | null) => {
      try {
        const result = await api.setAppPort(appId, port);
        setSettings(result.settings);
        setStatus(result.status);
        showToast(t.settingsSaved);
        return true;
      } catch (error) {
        const message = toMessage(error);
        if (message.includes('INVALID_PORT')) showToast(t.settingsPortInvalid, 'destructive');
        else fail(error);
        return false;
      }
    },
    [fail, showToast, t, setStatus],
  );

  return {
    settingsOpen,
    setSettingsOpen,
    settingsSection,
    setSettingsSection,
    settings,
    openSettings,
    chooseAppPath,
    clearAppPath,
    saveAppPort,
  };
}
