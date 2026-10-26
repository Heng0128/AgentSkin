// SPDX-License-Identifier: MPL-2.0

/**
 * # TemplatePicker
 *
 * Modal-style panel that displays curated studio theme templates as a card
 * grid. Each card shows a palette swatch preview + override summary. Clicking
 * a card seeds the active StudioProject with the template's 14-token palette
 * and tool overrides.
 *
 * Filtering: all / dark / light.
 */

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/api/agentSkinClient';
import { useNotificationStore } from '@/stores/notificationStore';
import { useShellStore } from '@/stores/shellStore';
import { useStudioStore } from '@/stores/studioStore';

import type { UiMessages } from '@shared/i18n';
import { uiMessages } from '@shared/i18n';
import { X } from 'lucide-react';

type TemplateSummary = {
  id: string;
  name: string;
  mode: 'light' | 'dark';
  category: string;
  description: string;
};

type TemplateDetail = {
  id: string;
  name: string;
  mode: 'light' | 'dark';
  palette: Record<string, string>;
  overrides?: Record<string, number | string>;
};

type ModeFilter = 'all' | 'dark' | 'light';

/** Keys shown as preview swatches on each card. */
const SWATCH_KEYS: Array<{ key: string; label: string }> = [
  { key: 'accent', label: 'A' },
  { key: 'background', label: 'BG' },
  { key: 'foreground', label: 'FG' },
  { key: 'surface', label: 'SF' },
  { key: 'border', label: 'BD' },
];

/** Compact override summary: show only the meaningful ones. */
function summarizeOverrides(overrides?: Record<string, number | string>): string {
  if (!overrides) return '';
  const parts: string[] = [];
  if (overrides.radius) parts.push(`r=${overrides.radius}`);
  if (overrides.fontSize) parts.push(`${overrides.fontSize}px`);
  if (overrides.spacing) parts.push(`sp=${overrides.spacing}`);
  if (overrides.shadowLevel) parts.push(`${overrides.shadowLevel}`);
  if (overrides.blurPx) parts.push(`blur=${overrides.blurPx}`);
  if (overrides.fontFam) parts.push('mono');
  return parts.join(' · ');
}

export function TemplatePicker({ onClose }: { onClose: () => void }) {
  const locale = useShellStore((s) => s.locale);
  const t: UiMessages = uiMessages[locale];

  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [details, setDetails] = useState<Record<string, TemplateDetail>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ModeFilter>('all');
  const [applyingId, setApplyingId] = useState<string | null>(null);

  const activeProjectId = useStudioStore((s) => s.activeProjectId);
  const saveActiveProject = useStudioStore((s) => s.saveActiveProject);
  const showToast = useNotificationStore((s) => s.showToast);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .listStudioTemplates()
      .then((list) => {
        if (cancelled) return;
        setTemplates(list);
        // Fetch all template details in parallel (fixes N+1 IPC).
        return Promise.allSettled(list.map((tpl) => api.getStudioTemplate(tpl.id)));
      })
      .then((results) => {
        if (cancelled || !results) return;
        const map: Record<string, TemplateDetail> = {};
        for (const r of results) {
          if (r.status === 'fulfilled' && r.value) map[r.value.id] = r.value;
        }
        setDetails(map);
      })
      .catch(() => {
        /* silent — empty state shown */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(
    () => (filter === 'all' ? templates : templates.filter((t) => t.mode === filter)),
    [templates, filter],
  );

  async function handleApply(templateId: string) {
    if (!activeProjectId) {
      showToast(t.studioNoActiveProject, 'default');
      return;
    }
    setApplyingId(templateId);
    try {
      const detail = await api.getStudioTemplate(templateId);
      if (!detail) return;
      await saveActiveProject({
        palette: detail.palette,
        overrides: detail.overrides as Record<string, string | number> | undefined,
      });
      showToast(t.studioTemplateApplySuccess(detail.name), 'default');
      onClose();
    } catch {
      showToast(t.studioLoadPaletteFailed, 'destructive');
    } finally {
      setApplyingId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="relative w-full max-w-2xl max-h-[80vh] flex flex-col rounded-lg border border-border bg-surface shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div>
            <h2 className="text-sm font-medium text-foreground">{t.studioTemplatePickerTitle}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{t.studioTemplatePickerDesc}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-muted text-muted-foreground"
            aria-label={t.cancel}
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 px-4 py-2 border-b border-border">
          {(['all', 'dark', 'light'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setFilter(mode)}
              className={`px-2 py-1 text-xs rounded ${
                filter === mode
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {mode === 'all' && t.studioTemplateFilterAll}
              {mode === 'dark' && t.studioTemplateFilterDark}
              {mode === 'light' && t.studioTemplateFilterLight}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              {t.studioTemplateLoading}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-8 text-sm text-muted-foreground">
              {t.studioPresetNoThemes}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {filtered.map((tpl) => (
                <TemplateCard
                  key={tpl.id}
                  template={tpl}
                  detail={details[tpl.id]}
                  t={t}
                  applying={applyingId === tpl.id}
                  onApply={() => void handleApply(tpl.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TemplateCard({
  template,
  detail,
  t,
  applying,
  onApply,
}: {
  template: TemplateSummary;
  detail?: TemplateDetail;
  t: UiMessages;
  applying: boolean;
  onApply: () => void;
}) {
  const palette = detail?.palette;
  const overrideSummary = summarizeOverrides(detail?.overrides);

  return (
    <div className="flex flex-col gap-2 p-3 rounded-md border border-border bg-surface-raised hover:border-primary/50 transition-colors">
      {/* Swatch row */}
      <div className="flex gap-1 h-6 rounded overflow-hidden">
        {SWATCH_KEYS.map(({ key, label }) => (
          <div
            key={key}
            className="flex-1 flex items-center justify-center text-[10px] font-medium"
            style={{
              backgroundColor: palette?.[key] ?? 'transparent',
              color:
                key === 'background' || key === 'surface' || key === 'border'
                  ? (palette?.foreground ?? 'var(--muted-foreground)')
                  : (palette?.background ?? 'var(--background)'),
            }}
            title={key}
          >
            {label}
          </div>
        ))}
      </div>

      {/* Name + mode badge */}
      <div className="flex items-center gap-1">
        <span className="text-xs font-medium text-foreground truncate flex-1">{template.name}</span>
        <span
          className={`text-[10px] px-1 py-0.5 rounded ${
            template.mode === 'dark' ? 'bg-slate-700 text-slate-200' : 'bg-amber-100 text-amber-800'
          }`}
        >
          {template.mode === 'dark' ? t.studioSchemeDark : t.studioSchemeLight}
        </span>
      </div>

      {/* Description */}
      <p className="text-[11px] text-muted-foreground line-clamp-2 leading-tight">
        {template.description}
      </p>

      {/* Override summary */}
      {overrideSummary && <p className="text-[10px] text-muted-foreground/70">{overrideSummary}</p>}

      {/* Apply button */}
      <button
        type="button"
        onClick={onApply}
        disabled={applying}
        className="mt-auto w-full px-2 py-1 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {applying ? t.studioLoadingDots : t.studioTemplateApplyToProject}
      </button>
    </div>
  );
}
