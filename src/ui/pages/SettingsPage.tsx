// SPDX-License-Identifier: MPL-2.0

import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/api/agentSkinClient';
import { DriftStatusPanel } from '@/components/diagnostics/DriftStatusPanel';
import { PerformancePanel } from '@/components/diagnostics/PerformancePanel';
import { SecondaryInjectTrace } from '@/components/diagnostics/SecondaryInjectTrace';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/ui/page-header';
import { SectionLabel } from '@/components/ui/section-label';
import { SegmentedControl, type SegmentedOption } from '@/components/ui/segmented-control';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import type { ThemeMode } from '@/design/theme-mode';
import type { AppController, SettingsSection } from '@/hooks/useAppController';
import { useThemeMode } from '@/hooks/useThemeMode';
import { cn } from '@/lib/utils';
import {
  type Density,
  type Motion,
  type RadiusScale,
  useSettingsStore,
} from '@/stores/settingsStore';

import {
  CheckCircle2,
  Copy,
  FileText,
  Info,
  LayoutDashboard,
  Palette,
  Settings,
} from 'lucide-react';

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
    <div className="flex items-center justify-between gap-4 py-3 px-3.5 border-b border-border last:border-0">
      <div>
        <p className="text-[12px] font-medium text-foreground">{title}</p>
        {description && <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  );
}

/** Custom CSS editor: load the persisted value on mount, edit in a textarea,
 *  save via IPC (apply to agents takes effect on the next apply). */
function CustomCssEditor({
  t,
  showToast,
}: {
  t: AppController['t'];
  showToast: AppController['showToast'];
}) {
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api
      .getCustomThemeCss()
      .then((css) => {
        setValue(css);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.setCustomThemeCss(value);
      showToast(t.settingsCustomCssSaved);
    } catch {
      showToast(t.settingsCustomCssFailed, 'destructive');
    } finally {
      setSaving(false);
    }
  };

  const clear = () => setValue('');

  return (
    <div className="flex flex-col gap-2">
      <div className="as-panel flex items-center justify-between gap-2 px-3 py-2.5">
        <div>
          <p className="text-[12px] font-medium text-foreground">{t.settingsCustomCssTitle}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{t.settingsCustomCssDesc}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={clear}>
            {t.settingsCustomCssClear}
          </Button>
          <Button size="sm" disabled={saving || loading} onClick={() => void save()}>
            {saving ? t.loading : t.settingsCustomCssSave}
          </Button>
        </div>
      </div>
      <Textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={t.settingsCustomCssPlaceholder}
        disabled={loading}
        spellCheck={false}
        className="min-h-32 w-full resize-y rounded-lg bg-card font-mono text-[11px] leading-5"
      />
    </div>
  );
}

/** Live DOM refresh interval editor — dropdown select bound to settings store. */
function LiveDomRefreshIntervalEditor({ t }: { t: AppController['t'] }) {
  const settings = useSettingsStore((s) => s.settings);
  const saveLiveDomRefreshInterval = useSettingsStore((s) => s.saveLiveDomRefreshInterval);

  const current = settings?.liveDomRefreshInterval ?? 0;

  const options: { value: number; label: string }[] = [
    { value: 0, label: t.settingsLiveDomRefreshIntervalOff },
    { value: 5000, label: t.settingsLiveDomRefreshInterval5s },
    { value: 15000, label: t.settingsLiveDomRefreshInterval15s },
    { value: 30000, label: t.settingsLiveDomRefreshInterval30s },
    { value: 60000, label: t.settingsLiveDomRefreshInterval60s },
  ];

  return (
    <div className="as-panel overflow-hidden">
      <SettingRow
        title={t.settingsLiveDomRefreshInterval}
        description={t.settingsLiveDomRefreshIntervalDesc}
      >
        <Select
          value={String(current)}
          onValueChange={(v) => void saveLiveDomRefreshInterval(Number(v))}
        >
          <SelectTrigger className="h-8 w-[160px] rounded-md border-border bg-muted text-[11px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="rounded-md border-border bg-card">
            {options.map((opt) => (
              <SelectItem key={opt.value} value={String(opt.value)} className="text-[11px]">
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingRow>
    </div>
  );
}

/** MCP Service settings panel — Blender MCP style: Start/Stop buttons + status + copy URL. */
function McpSettingsPanel({ t }: { t: AppController['t'] }) {
  const mcpRunning = useSettingsStore((s) => s.mcpRunning);
  const mcpBusy = useSettingsStore((s) => s.mcpBusy);
  const mcpUrl = useSettingsStore((s) => s.mcpUrl);
  const refreshMcpStatus = useSettingsStore((s) => s.refreshMcpStatus);
  const toggleMcp = useSettingsStore((s) => s.toggleMcp);
  const [copied, setCopied] = useState(false);

  // Load MCP status on mount.
  useEffect(() => {
    void refreshMcpStatus();
  }, [refreshMcpStatus]);

  const handleCopy = async () => {
    if (!mcpUrl) return;
    try {
      await navigator.clipboard.writeText(mcpUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <div className="as-panel p-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[12px] font-medium text-foreground">{t.settingsMcpTitle}</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">{t.settingsMcpDesc}</p>
        </div>
        <div className="flex items-center gap-1">
          {mcpRunning ? (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 px-2.5 text-[11px]"
              disabled={mcpBusy}
              onClick={() => void toggleMcp()}
            >
              {mcpBusy ? <Spinner data-icon="inline-start" /> : null}
              {t.settingsMcpStop}
            </Button>
          ) : (
            <Button
              size="sm"
              className="h-7 gap-1.5 px-2.5 text-[11px]"
              disabled={mcpBusy}
              onClick={() => void toggleMcp()}
            >
              {mcpBusy ? <Spinner data-icon="inline-start" /> : null}
              {t.settingsMcpStart}
            </Button>
          )}
        </div>
      </div>
      <div className="mt-3 space-y-1.5">
        <div className="flex items-center gap-2 text-[11px]">
          <span
            className={cn(
              'inline-block size-1.5 rounded-full',
              mcpRunning ? 'bg-cr-success' : 'bg-muted-foreground/40',
            )}
          />
          <span className={mcpRunning ? 'text-cr-success' : 'text-muted-foreground'}>
            {mcpRunning ? t.settingsMcpRunning : t.settingsMcpStopped}
          </span>
        </div>
        {mcpRunning && mcpUrl && (
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className="text-muted-foreground">{t.settingsMcpEndpoint}:</span>
            <code className="rounded bg-muted px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
              {mcpUrl}
            </code>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => void handleCopy()}
              title={copied ? t.settingsMcpCopied : t.settingsMcpCopy}
            >
              {copied ? (
                <CheckCircle2 className="size-3.5 text-cr-success" />
              ) : (
                <Copy className="size-3.5 text-muted-foreground" />
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * # SettingsPage
 *
 * In-page settings — no separate dialog. Sits alongside Workspace and Themes
 * in the sidebar. A left section rail (General / System / About / Advanced)
 * switches the right-hand content, mirroring the old dialog layout but embedded.
 */
export function SettingsPage({ controller }: { controller: AppController }) {
  const { t, appVersion, logs, showToast } = controller;
  const { mode, setMode } = useThemeMode();
  const section = controller.settingsSection;
  const setSection = controller.setSettingsSection;
  const radiusScale = useSettingsStore((s) => s.radiusScale);
  const setRadiusScale = useSettingsStore((s) => s.setRadiusScale);
  const density = useSettingsStore((s) => s.density);
  const setDensity = useSettingsStore((s) => s.setDensity);
  const motion = useSettingsStore((s) => s.motion);
  const setMotion = useSettingsStore((s) => s.setMotion);

  // Copy logs to clipboard — moved from the old LogDrawer sheet.
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up the copy timer on unmount to avoid setState-after-unmount.
  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    if (logs.length === 0) return;
    const text = logs.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      showToast(t.copyLogsDone);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        setCopied(true);
        showToast(t.copyLogsDone);
        if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
        copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
      } catch {
        showToast(t.copyLogsFailed, 'destructive');
      }
    }
  }, [logs, showToast, t]);

  // Load settings data on mount.
  // P3-2: controller.openSettings is already stable (useCallback with empty
  // deps in useSettings.ts — identity never changes). The explicit section
  // dep means we also reload data when the user switches the settings rail,
  // so per-section caches are refreshed and stale data doesn't linger.
  useEffect(() => {
    void controller.openSettings(section);
  }, [section, controller.openSettings]);

  const sections: Array<{ id: SettingsSection; label: string; icon: typeof Settings }> = [
    { id: 'general', label: t.settingsGeneralTitle, icon: Settings },
    { id: 'appearance', label: t.settingsAppearance, icon: Palette },
    { id: 'system', label: t.settingsSystemTitle, icon: FileText },
    { id: 'about', label: t.settingsAbout, icon: Info },
    { id: 'advanced', label: t.settingsAdvancedTitle, icon: LayoutDashboard },
  ];

  /** Options for the radius SegmentedControl on the appearance section. */
  const radiusOptions: SegmentedOption<RadiusScale>[] = [
    { value: '0', label: t.settingsRadiusSharp },
    { value: '2', label: t.settingsRadiusSubtle },
    { value: '4', label: t.settingsRadiusDefault },
    { value: '8', label: t.settingsRadiusSoft },
  ];
  /** Options for the density SegmentedControl on the appearance section. */
  const densityOptions: SegmentedOption<Density>[] = [
    { value: 'compact', label: t.settingsDensityCompact },
    { value: 'comfortable', label: t.settingsDensityComfortable },
    { value: 'cozy', label: t.settingsDensityCozy },
  ];
  /** Options for the motion SegmentedControl on the appearance section. */
  const motionOptions: SegmentedOption<Motion>[] = [
    { value: 'full', label: t.settingsMotionFull },
    { value: 'reduced', label: t.settingsMotionReduced },
    { value: 'none', label: t.settingsMotionNone },
  ];
  const activeSection = sections.find((item) => item.id === section) ?? sections[0];

  const themeOptions: { value: ThemeMode; label: string }[] = [
    { value: 'dark', label: t.themeDark },
    { value: 'light', label: t.themeLight },
    { value: 'system', label: t.themeSystem },
  ];

  // Mobile section selector options for the <Select> replacement of the rail.
  const sectionOptions = sections.map((s) => ({ value: s.id, label: s.label }));

  return (
    <div className="setp flex h-full min-h-0 min-w-0">
      {/* Section nav */}
      <aside className="set-rail hidden w-44 shrink-0 flex-col gap-0.5 overflow-y-auto pr-3 md:flex">
        <div className="px-2 pb-2">
          <SectionLabel label={t.settingsTitle} />
        </div>
        {sections.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={section === item.id ? 'page' : undefined}
            className={cn(
              'flex h-8 items-center gap-2 rounded-lg px-3 text-left text-[12px] font-medium transition-colors',
              section === item.id
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
            onClick={() => setSection(item.id)}
          >
            <item.icon
              size={15}
              className={cn(
                section === item.id ? 'text-accent-foreground/70' : 'text-muted-foreground/70',
              )}
            />
            {item.label}
          </button>
        ))}
      </aside>

      {/* Content */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Mobile section selector */}
        <div className="mb-3 flex items-center justify-between md:hidden">
          <Select value={section} onValueChange={(v) => setSection(v as SettingsSection)}>
            <SelectTrigger className="h-8 w-full rounded-md border-border bg-muted text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-md border-border bg-card">
              {sectionOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-[12px]">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Desktop header */}
        <div className="mb-3 hidden md:block">
          <PageHeader title={activeSection.label}>
            {section === 'system' && logs.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleCopy()}
                className="h-7 shrink-0 gap-1.5 px-2.5 text-[11px]"
              >
                {copied ? (
                  <CheckCircle2 className={cn('size-4', 'text-cr-success')} />
                ) : (
                  <Copy className="size-4" />
                )}
                {copied ? t.copyLogsDone : t.copyLogs}
              </Button>
            )}
          </PageHeader>
        </div>

        {/* Scrollable content — constrained width for readability */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-2xl flex-col gap-3 pb-4">
            {section === 'general' && (
              <div className="as-panel overflow-hidden">
                <SettingRow title={t.themeModeLabel}>
                  <Select value={mode} onValueChange={(v) => setMode(v as ThemeMode)}>
                    <SelectTrigger className="h-8 w-[140px] rounded-md border-border bg-muted text-[11px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-md border-border bg-card">
                      {themeOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value} className="text-[11px]">
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </SettingRow>
                <SettingRow title={t.languageLabel}>
                  <Select
                    value={controller.locale}
                    onValueChange={(v) => void controller.setLocale(v as 'zh-CN' | 'en')}
                  >
                    <SelectTrigger className="h-8 w-[140px] rounded-md border-border bg-muted text-[11px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-md border-border bg-card">
                      <SelectItem value="zh-CN" className="text-[11px]">
                        {t.chinese}
                      </SelectItem>
                      <SelectItem value="en" className="text-[11px]">
                        {t.english}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </SettingRow>
              </div>
            )}
            {section === 'appearance' && (
              <div className="as-panel overflow-hidden">
                <SettingRow title={t.settingsRadiusLabel} description={t.settingsRadiusDescription}>
                  <SegmentedControl
                    options={radiusOptions}
                    value={radiusScale}
                    onChange={(v) => setRadiusScale(v)}
                    size="sm"
                  />
                </SettingRow>
                <SettingRow
                  title={t.settingsDensityLabel}
                  description={t.settingsDensityDescription}
                >
                  <SegmentedControl
                    options={densityOptions}
                    value={density}
                    onChange={(v) => setDensity(v)}
                    size="sm"
                  />
                </SettingRow>
                <SettingRow title={t.settingsMotionLabel} description={t.settingsMotionDescription}>
                  <SegmentedControl
                    options={motionOptions}
                    value={motion}
                    onChange={(v) => setMotion(v)}
                    size="sm"
                  />
                </SettingRow>
              </div>
            )}
            {section === 'system' &&
              (logs.length === 0 ? (
                <EmptyState icon={<FileText />} iconSize="lg" title={t.noLogs} className="w-full" />
              ) : (
                <div className="as-panel p-3 text-[11px] leading-5">
                  <div className="mb-2 px-1 text-[11px] text-muted-foreground/60">
                    {logs.length} {t.showLogs}
                  </div>
                  <div className="max-h-[calc(100vh-280px)] overflow-y-auto rounded-md bg-background/60 p-2">
                    {logs.map((line, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: log lines are append-only display items — no reorder, insert, or delete, so index keys are safe.
                      <div key={i} className="flex gap-2 rounded px-1 py-1 odd:bg-muted/30">
                        <span className="w-6 shrink-0 select-none text-right text-muted-foreground/40 tabular-nums">
                          {i + 1}
                        </span>
                        <span className="min-w-0 break-words whitespace-pre-wrap text-muted-foreground">
                          {line}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            {section === 'about' && (
              <div className="as-panel overflow-hidden">
                <SettingRow title={t.settingsAbout} description={t.settingsAboutDesc}>
                  <span className="font-mono text-[11px] text-muted-foreground">v{appVersion}</span>
                </SettingRow>
              </div>
            )}
            {section === 'advanced' && (
              <div className="as-panel overflow-hidden">
                <McpSettingsPanel t={t} />
                <LiveDomRefreshIntervalEditor t={t} />
                <Accordion type="single" collapsible>
                  <AccordionItem value="diagnostics" className="border-t border-border">
                    <AccordionTrigger className="px-3 py-2.5 text-[12px] font-medium hover:no-underline">
                      {t.settingsDiagnosticsTitle}
                    </AccordionTrigger>
                    <AccordionContent className="px-3 pb-3">
                      <PerformancePanel t={t} />
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="secondary-inject" className="border-t border-border">
                    <AccordionTrigger className="px-3 py-2.5 text-[12px] font-medium hover:no-underline">
                      {t.settingsSecondaryInjectTitle}
                    </AccordionTrigger>
                    <AccordionContent className="px-3 pb-3">
                      <SecondaryInjectTrace t={t} />
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="custom-css" className="border-t border-border">
                    <AccordionTrigger className="px-3 py-2.5 text-[12px] font-medium hover:no-underline">
                      {t.settingsCustomCssTitle}
                    </AccordionTrigger>
                    <AccordionContent className="px-3 pb-3">
                      <CustomCssEditor t={t} showToast={showToast} />
                    </AccordionContent>
                  </AccordionItem>
                  <AccordionItem value="drift-status" className="border-t border-border">
                    <AccordionTrigger className="px-3 py-2.5 text-[12px] font-medium hover:no-underline">
                      {t.settingsDriftStatusTitle}
                    </AccordionTrigger>
                    <AccordionContent className="px-3 pb-3">
                      <DriftStatusPanel t={t} />
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
