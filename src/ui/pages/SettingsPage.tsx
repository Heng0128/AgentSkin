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
  ArrowLeft,
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
    <div className="flex items-center justify-between gap-2 py-1.5 px-2 border-b border-border last:border-0">
      <div>
        <p className="text-[10px] text-foreground">{title}</p>
        {description && <p className="text-[10px] text-muted-foreground mt-0.5">{description}</p>}
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
    } finally {
      setSaving(false);
    }
  };

  const clear = () => setValue('');

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 py-1.5 px-2 border-b border-border last:border-0">
        <div>
          <p className="text-[10px] text-foreground">{t.settingsCustomCssTitle}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{t.settingsCustomCssDesc}</p>
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
        className="min-h-32 w-full resize-y rounded-md bg-card text-[13px] leading-5"
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
    <SettingRow
      title={t.settingsLiveDomRefreshInterval}
      description={t.settingsLiveDomRefreshIntervalDesc}
    >
      <Select
        value={String(current)}
        onValueChange={(v) => void saveLiveDomRefreshInterval(Number(v))}
      >
        <SelectTrigger className="h-6 w-[160px] rounded-md border-border bg-muted text-[10px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="rounded-md border-border bg-card">
          {options.map((opt) => (
            <SelectItem key={opt.value} value={String(opt.value)} className="text-[10px]">
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingRow>
  );
}

/** MCP Service settings panel — Blender MCP style: Start/Stop buttons + status + copy URL. */
function McpSettingsPanel({ t }: { t: AppController['t'] }) {
  const mcpRunning = useSettingsStore((s) => s.mcpRunning);
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
    <div className="rounded-md border border-border bg-card p-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] text-foreground">{t.settingsMcpTitle}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{t.settingsMcpDesc}</p>
        </div>
        <div className="flex items-center gap-1">
          {mcpRunning ? (
            <Button
              size="sm"
              variant="outline"
              className="h-6 gap-1 px-2 text-[10px]"
              onClick={() => void toggleMcp()}
            >
              {t.settingsMcpStop}
            </Button>
          ) : (
            <Button
              size="sm"
              className="h-6 gap-1 px-2 text-[10px]"
              onClick={() => void toggleMcp()}
            >
              {t.settingsMcpStart}
            </Button>
          )}
        </div>
      </div>
      <div className="mt-2 space-y-1">
        <div className="flex items-center gap-2 text-[10px]">
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
          <div className="flex items-center gap-1 text-[10px]">
            <span className="text-muted-foreground">{t.settingsMcpEndpoint}:</span>
            <code className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">
              {mcpUrl}
            </code>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0"
              onClick={() => void handleCopy()}
              title={copied ? t.settingsMcpCopied : t.settingsMcpCopy}
            >
              {copied ? (
                <CheckCircle2 className="size-3 text-cr-success" />
              ) : (
                <Copy className="size-3 text-muted-foreground" />
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
    <div className="setp flex h-full min-h-0 flex-col min-w-0">
      {/* Global back-to-workspace bar — settings is a full-screen route with
          the sidebar hidden, so this is the only way back to the app. */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-2 py-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => controller.setRoute('workspace')}
          className="h-6 gap-1 px-2 text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-3.5" />
          {t.navWorkspace}
        </Button>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[160px_minmax(0,1fr)]">
        {/* Section rail — desktop only (md+) */}
        <aside className="set-rail hidden min-h-0 flex-col gap-1 overflow-y-auto border-r border-border bg-surface p-2 md:flex">
          <div className="px-2 pt-2 pb-1">
            <SectionLabel label={t.settingsTitle} />
          </div>
          {sections.map((item) => (
            <Button
              key={item.id}
              variant="ghost"
              size="sm"
              aria-current={section === item.id ? 'page' : undefined}
              className={cn(
                'justify-start rounded-md h-6 px-2 text-muted-foreground',
                section === item.id && 'bg-accent text-accent-foreground',
              )}
              onClick={() => setSection(item.id)}
            >
              <item.icon
                size={14}
                className={cn(
                  section === item.id ? 'text-accent-foreground/70' : 'text-muted-foreground/70',
                )}
              />
              {item.label}
            </Button>
          ))}
        </aside>

        {/* Content */}
        <div className="flex min-h-0 flex-col">
          {/* Mobile header: breadcrumb + section selector */}
          <div className="flex items-center justify-between px-2 py-1.5 md:hidden">
            <span className="text-[10px] text-muted-foreground">{activeSection.label}</span>
            <Select value={section} onValueChange={(v) => setSection(v as SettingsSection)}>
              <SelectTrigger className="h-6 w-auto min-w-[120px] rounded-md border-border bg-muted text-[10px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-md border-border bg-card">
                {sectionOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="text-[10px]">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Desktop header: title + copy logs */}
          <div className="hidden px-2 py-1.5 md:block">
            <PageHeader title={activeSection.label}>
              {section === 'system' && logs.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleCopy()}
                  className="h-6 shrink-0 gap-1 px-2 text-[10px]"
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
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-1.5">
            {section === 'general' && (
              <>
                <SettingRow title={t.themeModeLabel}>
                  <Select value={mode} onValueChange={(v) => setMode(v as ThemeMode)}>
                    <SelectTrigger className="h-6 w-[160px] rounded-md border-border bg-muted text-[10px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-md border-border bg-card">
                      {themeOptions.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value} className="text-[10px]">
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
                    <SelectTrigger className="h-6 w-[160px] rounded-md border-border bg-muted text-[10px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-md border-border bg-card">
                      <SelectItem value="zh-CN" className="text-[10px]">
                        {t.chinese}
                      </SelectItem>
                      <SelectItem value="en" className="text-[10px]">
                        {t.english}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </SettingRow>
              </>
            )}
            {section === 'appearance' && (
              <>
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
              </>
            )}
            {section === 'system' &&
              (logs.length === 0 ? (
                <EmptyState
                  icon={<FileText />}
                  iconSize="lg"
                  title={t.noLogs}
                  className="w-full"
                />
              ) : (
                <div className="space-y-px rounded-md bg-card p-2 text-[10px] leading-5">
                  <div className="mb-1 px-1 text-micro text-muted-foreground/50">
                    {logs.length} {t.showLogs}
                  </div>
                  <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
                    {logs.map((line, i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: log lines are append-only display items — no reorder, insert, or delete, so index keys are safe.
                      <div key={i} className="flex gap-2 rounded px-1 py-0 odd:bg-muted/30">
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
              <SettingRow title={t.settingsAbout} description={t.settingsAboutDesc}>
                <span className="text-[10px] text-muted-foreground">v{appVersion}</span>
              </SettingRow>
            )}
            {section === 'advanced' && (
              <>
                <p className="text-[10px] text-muted-foreground/70">
                  {t.settingsAdvancedDesc}
                </p>
                <McpSettingsPanel t={t} />
                <LiveDomRefreshIntervalEditor t={t} />
                <Accordion type="single" collapsible>
                  <AccordionItem value="diagnostics" className="border-b-0">
                    <AccordionTrigger className="py-1.5 text-[10px] text-foreground">
                      {t.settingsDiagnosticsTitle}
                    </AccordionTrigger>
                    <AccordionContent>
                      <PerformancePanel t={t} />
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
                <Accordion type="single" collapsible>
                  <AccordionItem value="secondary-inject" className="border-b-0">
                    <AccordionTrigger className="py-1.5 text-[10px] text-foreground">
                      {t.settingsSecondaryInjectTitle}
                    </AccordionTrigger>
                    <AccordionContent>
                      <SecondaryInjectTrace t={t} />
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
                <Accordion type="single" collapsible>
                  <AccordionItem value="custom-css" className="border-b-0">
                    <AccordionTrigger className="py-1.5 text-[10px] text-foreground">
                      {t.settingsCustomCssTitle}
                    </AccordionTrigger>
                    <AccordionContent>
                      <CustomCssEditor t={t} showToast={showToast} />
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
                <Accordion type="single" collapsible>
                  <AccordionItem value="drift-status" className="border-b-0">
                    <AccordionTrigger className="py-1.5 text-[10px] text-foreground">
                      {t.settingsDriftStatusTitle}
                    </AccordionTrigger>
                    <AccordionContent>
                      <DriftStatusPanel t={t} />
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
