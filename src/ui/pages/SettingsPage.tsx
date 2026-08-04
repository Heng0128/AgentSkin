// SPDX-License-Identifier: MPL-2.0

import { type ReactNode, useEffect, useState } from 'react';
import { APP_META, AppMark } from '@/components/app-mark';
import { Button } from '@/components/ui/button';
import { HugeIcon } from '@/components/ui/huge-icon';
import { Input } from '@/components/ui/input';
import type { ThemeMode } from '@/design/theme-mode';
import type { AppController, SettingsSection } from '@/hooks/useAppController';
import { useThemeMode } from '@/hooks/useThemeMode';
import { cn } from '@/lib/utils';

import { DashboardSquare01Icon, Folder01Icon, Settings01Icon } from '@hugeicons/core-free-icons';
import { AGENT_IDS, type AgentId } from '@shared/types';

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
    <div
      className="setrow flex items-center justify-between gap-4 rounded-[2px] border border-border px-3.5 py-2.5"
      style={{ background: 'color-mix(in srgb, var(--card) 60%, transparent)' }}
    >
      <div className="min-w-0">
        <p className="text-[12.5px] font-semibold text-foreground">{title}</p>
        {description && (
          <p className="mt-0.5 text-[10.5px] text-muted-foreground/70">{description}</p>
        )}
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
    <div className="rounded-[2px] border border-border bg-card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
        <AppMark appId={appId} size={18} />
        <span className="font-display text-[13px] font-bold tracking-[-.01em]">
          {APP_META[appId].name}
        </span>
      </div>
      <div className="flex items-center justify-between gap-4 border-b border-border px-3.5 py-2.5">
        <div className="min-w-0">
          <p className="font-mono text-[11px] tracking-wide text-foreground">
            {t.settingsPathLabel}
          </p>
          <p
            className="mt-0.5 truncate font-mono text-[10px] tracking-wider text-muted-foreground/70"
            title={override.appPath ?? undefined}
          >
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
      <div className="flex items-center justify-between gap-4 px-3.5 py-2.5">
        <div>
          <p className="font-mono text-[11px] tracking-wide text-foreground">
            {t.settingsPortLabel}
          </p>
          <p className="mt-0.5 font-mono text-[10px] tracking-wider text-muted-foreground">
            {t.settingsPortHint(defaultPort)}
          </p>
        </div>
        <Input
          value={portDraft}
          inputMode="numeric"
          placeholder={defaultPort > 0 ? String(defaultPort) : t.settingsPortHint(0)}
          className="h-[30px] w-24 rounded-[2px] border-border bg-muted font-mono text-[11px] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
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
  // P3-2: controller.openSettings is already stable (useCallback with empty
  // deps in useSettings.ts — identity never changes). The explicit section
  // dep means we also reload data when the user switches the settings rail
  // (General / Apps / Wallpaper), so per-section caches are refreshed and
  // stale overrides don't linger. eslint-disable can be removed safely
  // because the dep list now exactly matches what the effect body uses.
  useEffect(() => {
    void controller.openSettings(section);
  }, [section, controller.openSettings]);

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
    <div className="setp flex h-full min-h-0 flex-col min-w-0">
      <div className="grid min-h-0 flex-1 grid-cols-[180px_minmax(0,1fr)]">
        {/* Section rail (Swiss) */}
        <aside className="set-rail flex min-h-0 flex-col gap-[3px] overflow-y-auto border-r border-border bg-card2 p-2">
          <p className="px-3 pb-1 font-mono text-[8.5px] font-semibold uppercase tracking-[.18em] text-muted-foreground/60">
            {t.settingsTitle.toUpperCase()}
          </p>
          {sections.map((item) => (
            <Button
              key={item.id}
              variant="ghost"
              size="sm"
              className={cn(
                'justify-start rounded-[2px] h-8 px-3 text-muted-foreground',
                section === item.id &&
                  'bg-card text-foreground shadow-[inset_3px_0_0_var(--primary)]',
              )}
              onClick={() => setSection(item.id)}
            >
              <HugeIcon icon={item.icon} data-icon="inline-start" />
              {item.label}
            </Button>
          ))}
        </aside>

        {/* Content */}
        <div className="flex min-h-0 flex-col">
          <div className="border-b border-border px-3.5 py-2.5">
            <h2 className="font-display text-[13px] font-bold tracking-tight">
              {activeSection.label}
            </h2>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3.5 py-2.5">
            {section === 'general' && (
              <>
                <SettingRow title={t.themeModeLabel}>
                  <div className="inline-flex items-center gap-[2px] rounded-[2px] border border-border bg-muted p-[2px]">
                    {themeOptions.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setMode(opt.value)}
                        aria-pressed={mode === opt.value}
                        className={cn(
                          'h-6 rounded-[2px] px-3 font-medium text-[11.5px] transition-all duration-fast',
                          mode === opt.value
                            ? 'bg-card text-foreground shadow-sm'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </SettingRow>
                <SettingRow title={t.settingsAbout} description={t.settingsAboutDesc}>
                  <span className="font-mono text-[10px] tracking-wider text-muted-foreground/70">
                    v{appVersion}
                  </span>
                </SettingRow>
              </>
            )}
            {section === 'apps' && (
              <>
                <p className="font-mono text-[11px] tracking-wider text-muted-foreground/70">
                  {t.settingsAppsHint}
                </p>
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
