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
  ArrowLeft,
  CheckCircle2,
  Copy,
  FileText,
  Info,
  LayoutDashboard,
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
    <div
      className="setrow flex items-center justify-between gap-4 p-4 py-2 rounded-md  transition-colors duration-fast hover:bg-card2"
      style={{ background: 'color-mix(in srgb, var(--card) 60%, transparent)' }}
    >
      <div className="min-w-0">
        <p className="text-[11px] text-muted-foreground">{title}</p>
        {description && (
          <p className="mt-0.5 text-[10px] text-muted-foreground/70">{description}</p>
        )}
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
      <div
        className="flex items-center justify-between gap-4 rounded-md  px-4 py-2"
        style={{ background: 'color-mix(in srgb, var(--card) 60%, transparent)' }}
      >
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-foreground">{t.settingsCustomCssTitle}</p>
          <p className="mt-0.5 text-[10px] text-muted-foreground/70">{t.settingsCustomCssDesc}</p>
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
        className="min-h-32 w-full resize-y rounded-md bg-card font-mono text-[11px] leading-5"
      />
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
    { id: 'system', label: t.settingsSystemTitle, icon: FileText },
    { id: 'about', label: t.settingsAbout, icon: Info },
    { id: 'advanced', label: t.settingsAdvancedTitle, icon: LayoutDashboard },
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
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[180px_minmax(0,1fr)]">
        {/* Section rail — desktop only (md+) */}
        <aside className="set-rail hidden min-h-0 flex-col gap-[3px] overflow-y-auto  bg-card2 p-2 md:flex">
          {/* Back control — integrated into the rail header */}
          <button
            type="button"
            onClick={() => controller.setRoute('workspace')}
            className="flex items-center gap-1 rounded-md px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
          >
            <ArrowLeft className="size-3" />
            {t.settingsBack}
          </button>
          <div className="mt-1 h-px bg-border" aria-hidden />
          <p className="px-3 pt-2 pb-1 text-[11px] font-semibold text-muted-foreground/60">
            {t.settingsTitle}
          </p>
          {sections.map((item) => (
            <Button
              key={item.id}
              variant="ghost"
              size="sm"
              aria-current={section === item.id ? 'page' : undefined}
              className={cn(
                'justify-start rounded-md h-8 px-3 text-muted-foreground',
                section === item.id &&
                  'bg-card text-foreground shadow-[inset_3px_0_0_var(--primary)]',
              )}
              onClick={() => setSection(item.id)}
            >
              <item.icon size={14} className="text-muted-foreground/70" />
              {item.label}
            </Button>
          ))}
        </aside>

        {/* Content */}
        <div className="flex min-h-0 flex-col">
          {/* Mobile header: breadcrumb + section selector */}
          <div className="flex items-center justify-between  px-4 py-2 md:hidden">
            <button
              type="button"
              onClick={() => controller.setRoute('workspace')}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-3" />
              {t.settingsBack}
            </button>
            <Select value={section} onValueChange={(v) => setSection(v as SettingsSection)}>
              <SelectTrigger className="h-7 w-auto min-w-[120px] rounded-md border-border bg-muted text-[11px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="rounded-md border-border bg-card">
                {sectionOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="text-[11px]">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Desktop header: breadcrumb + copy logs */}
          <div className="hidden items-center justify-between  px-4 py-2 md:flex">
            <h2 className="font-display text-[13px] font-bold tracking-tight">
              {activeSection.label}
            </h2>
            {section === 'system' && logs.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleCopy()}
                className="h-7 shrink-0 gap-1 px-2 text-[11px]"
              >
                {copied ? (
                  <CheckCircle2 className={cn('size-4', 'text-cr-success')} />
                ) : (
                  <Copy className="size-4" />
                )}
                {copied ? t.copyLogsDone : t.copyLogs}
              </Button>
            )}
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-4 py-2">
            {section === 'general' && (
              <SettingRow title={t.themeModeLabel}>
                <Select value={mode} onValueChange={(v) => setMode(v as ThemeMode)}>
                  <SelectTrigger className="h-7 w-[140px] rounded-md border-border bg-muted text-[11px]">
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
            )}
            {section === 'system' &&
              (logs.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                  <div className="flex size-10 items-center justify-center rounded-md bg-muted/60">
                    <FileText className="size-4 text-muted-foreground/50" />
                  </div>
                  <p className="text-xs text-muted-foreground">{t.noLogs}</p>
                </div>
              ) : (
                <div className="space-y-px rounded-md  bg-card p-2 font-mono text-[11px] leading-5">
                  <div className="mb-1 px-1 text-[10px] text-muted-foreground/50">
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
                <span className="text-[11px] text-muted-foreground/70">v{appVersion}</span>
              </SettingRow>
            )}
            {section === 'advanced' && (
              <>
                <p className="font-mono text-[11px]  text-muted-foreground/70">
                  {t.settingsAdvancedDesc}
                </p>
                <Accordion type="single" collapsible>
                  <AccordionItem value="diagnostics" className="border-b-0">
                    <AccordionTrigger className="py-2 text-[13px] font-semibold text-foreground">
                      {t.settingsDiagnosticsTitle}
                    </AccordionTrigger>
                    <AccordionContent>
                      <PerformancePanel t={t} />
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
                <Accordion type="single" collapsible>
                  <AccordionItem value="secondary-inject" className="border-b-0">
                    <AccordionTrigger className="py-2 text-[13px] font-semibold text-foreground">
                      {t.settingsSecondaryInjectTitle}
                    </AccordionTrigger>
                    <AccordionContent>
                      <SecondaryInjectTrace t={t} />
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
                <Accordion type="single" collapsible>
                  <AccordionItem value="custom-css" className="border-b-0">
                    <AccordionTrigger className="py-2 text-[13px] font-semibold text-foreground">
                      {t.settingsCustomCssTitle}
                    </AccordionTrigger>
                    <AccordionContent>
                      <CustomCssEditor t={t} showToast={showToast} />
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
                <Accordion type="single" collapsible>
                  <AccordionItem value="drift-status" className="border-b-0">
                    <AccordionTrigger className="py-2 text-[13px] font-semibold text-foreground">
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
