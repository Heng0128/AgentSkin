// SPDX-License-Identifier: MPL-2.0

import { useEffect, useState, type ReactNode } from 'react';
import {
  DashboardSquare01Icon,
  Folder01Icon,
  Settings01Icon,
} from '@hugeicons/core-free-icons';
import type { AppController, SettingsSection } from '@/hooks/useAppController';
import { AppMark, APP_META } from '@/components/app-mark';
import { AGENT_IDS, type AgentId } from '@shared/types';
import { Button } from '@/components/ui/button';
import { HugeIcon } from '@/components/ui/huge-icon';
import { Input } from '@/components/ui/input';
import { useThemeMode } from '@/hooks/useThemeMode';
import type { ThemeMode } from '@/design/theme-mode';
import { cn } from '@/lib/utils';

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border bg-background/60 px-4 py-3.5">
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</p>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

function AppOverrideCard({ controller, appId }: { controller: AppController; appId: AgentId }) {
  const { t, settings } = controller;
  const override = settings?.apps[appId] ?? { appPath: null, port: null };
  const defaultPort = settings?.defaultPorts[appId] ?? controller.appStatusFor(appId)?.port ?? 0;
  const [portDraft, setPortDraft] = useState('');

  useEffect(() => {
    setPortDraft(override.port === null ? '' : String(override.port));
  }, [override.port]);

  const commitPort = async () => {
    const trimmed = portDraft.trim();
    if (trimmed === (override.port === null ? '' : String(override.port))) return;
    const parsed = trimmed === '' ? null : Number(trimmed);
    const saved = await controller.saveAppPort(appId, parsed);
    if (!saved) setPortDraft(override.port === null ? '' : String(override.port));
  };

  return (
    <div className="rounded-xl border bg-background/60">
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <AppMark appId={appId} size={22} />
        <span className="text-sm font-medium">{APP_META[appId].name}</span>
      </div>
      <div className="flex items-center justify-between gap-4 border-b px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm">{t.settingsPathLabel}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground" title={override.appPath ?? undefined}>
            {override.appPath ?? t.settingsPathAuto}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {override.appPath && (
            <Button variant="ghost" size="xs" onClick={() => void controller.clearAppPath(appId)}>
              {t.settingsClearPath}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => void controller.chooseAppPath(appId)}>
            <HugeIcon icon={Folder01Icon} data-icon="inline-start" />
            {t.settingsChoosePath}
          </Button>
        </div>
      </div>
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <div>
          <p className="text-sm">{t.settingsPortLabel}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t.settingsPortHint(defaultPort)}</p>
        </div>
        <Input
          value={portDraft}
          inputMode="numeric"
          placeholder={defaultPort > 0 ? String(defaultPort) : t.settingsPortHint(0)}
          className="h-8 w-28 text-xs"
          onChange={(event) => setPortDraft(event.target.value)}
          onBlur={() => void commitPort()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void commitPort();
          }}
        />
      </div>
    </div>
  );
}

/**
 * # SettingsPage
 *
 * In-page settings — no separate dialog. Sits alongside Workspace and Themes
 * in the sidebar. A left section rail (General / Apps / Wallpaper) switches
 * the right-hand content, mirroring the old dialog layout but embedded.
 */
export function SettingsPage({ controller }: { controller: AppController }) {
  const { t, appVersion } = controller;
  const { mode, setMode } = useThemeMode();
  const section = controller.settingsSection;
  const setSection = controller.setSettingsSection;

  // Load settings data on mount so AppOverrideCard has real overrides.
  useEffect(() => {
    void controller.openSettings(section);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sections: Array<{ id: SettingsSection; label: string; icon: typeof Settings01Icon }> = [
    { id: 'general', label: t.settingsGeneralTitle, icon: Settings01Icon },
    { id: 'apps', label: t.settingsAppsTitle, icon: DashboardSquare01Icon },
  ];
  const activeSection = sections.find((item) => item.id === section) ?? sections[0];

  const themeOptions: { value: ThemeMode; label: string }[] = [
    { value: 'dark', label: t.themeDark },
    { value: 'light', label: t.themeLight },
    { value: 'system', label: t.themeSystem },
  ];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid min-h-0 flex-1 grid-cols-[190px_minmax(0,1fr)]">
        {/* Section rail */}
        <aside className="flex min-h-0 flex-col gap-1 overflow-y-auto border-r bg-muted/40 p-3">
          <p className="px-2 pt-1 pb-2 text-sm font-semibold">{t.settingsTitle}</p>
          {sections.map((item) => (
            <Button
              key={item.id}
              variant={section === item.id ? 'secondary' : 'ghost'}
              size="sm"
              className={cn('justify-start', section !== item.id && 'text-muted-foreground')}
              onClick={() => setSection(item.id)}
            >
              <HugeIcon icon={item.icon} data-icon="inline-start" />
              {item.label}
            </Button>
          ))}
        </aside>

        {/* Content */}
        <div className="flex min-h-0 flex-col">
          <div className="border-b px-6 py-4">
            <h2 className="text-base font-semibold tracking-[-0.01em]">{activeSection.label}</h2>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-6 py-4">
            {section === 'general' && (
              <>
                <SettingRow title={t.themeModeLabel}>
                  <div className="inline-flex items-center gap-0.5 rounded-[11px] bg-black/[0.05] p-0.5 dark:bg-white/[0.06]">
                    {themeOptions.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setMode(opt.value)}
                        aria-pressed={mode === opt.value}
                        className={cn(
                          'h-7 rounded-lg px-3 text-xs font-medium transition-all duration-200 ease-out',
                          mode === opt.value
                            ? 'bg-card text-foreground shadow-xs'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </SettingRow>
                <SettingRow title={t.settingsAbout} description={t.settingsAboutDesc}>
                  <span className="text-xs text-muted-foreground">
                    v{appVersion}
                  </span>
                </SettingRow>
              </>
            )}
            {section === 'apps' && (
              <>
                <p className="text-xs leading-5 text-muted-foreground">{t.settingsAppsHint}</p>
                {AGENT_IDS.map((appId) => (
                  <AppOverrideCard key={appId} controller={controller} appId={appId} />
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
