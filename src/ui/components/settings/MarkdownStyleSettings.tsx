// SPDX-License-Identifier: MPL-2.0

/**
 * # MarkdownStyleSettings
 *
 * Settings panel for runtime Markdown style customization. Provides color
 * pickers for heading, link, code block, inline code, and blockquote colors,
 * plus a font family input. Includes a live preview area that reflects the
 * current style configuration.
 *
 * The styles are injected at runtime via CDP — they do NOT modify app.asar
 * and are automatically cleared on app restart.
 */

import { useEffect, useState } from 'react';
import { api } from '@/api/agentSkinClient';
import type { AppController } from '@/hooks/useAppController';
import { cn } from '@/lib/utils';

import type { MarkdownStyles } from '@shared/types/markdown';
import { RotateCcw, Save } from 'lucide-react';

/** Default (empty) configuration — all fields undefined = no overrides. */
const DEFAULT_STYLES: MarkdownStyles = {};

/** A single color picker row with label. */
function ColorRow({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  placeholder: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value ?? '#000000'}
          onChange={(e) => onChange(e.target.value)}
          className="size-6 cursor-pointer rounded border border-border"
          aria-label={label}
        />
        <input
          type="text"
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value || undefined)}
          placeholder={placeholder}
          className="w-24 rounded border border-border bg-background px-2 py-0.5 text-[11px] text-foreground font-mono"
        />
      </div>
    </div>
  );
}

/** Live preview panel showing the current Markdown styles. */
function MarkdownPreview({ styles, label }: { styles: MarkdownStyles; label: string }) {
  const headingStyle = (color?: string) => (color ? { color } : undefined);
  const codeStyle = {
    backgroundColor: styles.codeBackground || undefined,
    color: styles.codeColor || undefined,
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-medium text-foreground">{label}</span>
      <div
        className="rounded border border-border bg-background p-3"
        style={styles.fontFamily ? { fontFamily: styles.fontFamily } : undefined}
      >
        <h1
          className="text-[14px] font-bold"
          style={headingStyle(styles.headingColorH1 || styles.headingColor)}
        >
          Heading 1
        </h1>
        <h2
          className="text-ui font-semibold"
          style={headingStyle(styles.headingColorH2 || styles.headingColor)}
        >
          Heading 2
        </h2>
        <h3
          className="text-[12px] font-medium"
          style={headingStyle(styles.headingColorH3 || styles.headingColor)}
        >
          Heading 3
        </h3>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Text with a{/* Style-preview only: renders link styling without navigation semantics. */}
          <span
            className="underline"
            style={styles.linkColor ? { color: styles.linkColor } : undefined}
          >
            link example
          </span>{' '}
          and{' '}
          <code
            className="rounded px-1"
            style={styles.inlineCodeColor ? { color: styles.inlineCodeColor } : undefined}
          >
            inline code
          </code>
          .
        </p>
        <pre
          className="mt-1 rounded p-2 text-[10px]"
          style={codeStyle.backgroundColor || codeStyle.color ? codeStyle : undefined}
        >
          <code>{'const x = 42;\nconsole.log(x);'}</code>
        </pre>
        <blockquote
          className="mt-1 border-l-2 pl-2 text-[11px] italic"
          style={styles.blockquoteColor ? { color: styles.blockquoteColor } : undefined}
        >
          A blockquote example
        </blockquote>
      </div>
    </div>
  );
}

/**
 * # MarkdownStyleSettings
 *
 * Self-contained settings panel for runtime Markdown style customization.
 * Loads and persists via the AgentSkin IPC bridge; `t` / `showToast` are
 * passed in by the Settings page (same contract as CustomCssEditor).
 */
export function MarkdownStyleSettings({
  t,
  showToast,
}: {
  t: AppController['t'];
  showToast: AppController['showToast'];
}) {
  const [value, setValue] = useState<MarkdownStyles>(DEFAULT_STYLES);
  const [draft, setDraft] = useState<MarkdownStyles>(DEFAULT_STYLES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load persisted markdown styles on mount.
  useEffect(() => {
    let cancelled = false;
    void api
      .getMarkdownStyles()
      .then((styles) => {
        if (cancelled) return;
        const loaded = styles ?? DEFAULT_STYLES;
        setValue(loaded);
        setDraft(loaded);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = <K extends keyof MarkdownStyles>(key: K, val: MarkdownStyles[K]) => {
    setDraft((prev) => ({ ...prev, [key]: val }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.saveMarkdownStyles(draft);
      setValue(draft);
      showToast(t.settingsMarkdownStylesSaved);
    } catch {
      // Save failed: value stays in draft so the user can retry.
      showToast(t.settingsMarkdownStylesFailed, 'destructive');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    setSaving(true);
    try {
      await api.saveMarkdownStyles(DEFAULT_STYLES);
      setValue(DEFAULT_STYLES);
      setDraft(DEFAULT_STYLES);
      showToast(t.settingsMarkdownStylesResetDone);
    } catch {
      // Reset failed: keep the current draft untouched so nothing is lost.
      showToast(t.settingsMarkdownStylesFailed, 'destructive');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="as-panel flex items-center justify-center p-8">
        <span className="text-[11px] text-muted-foreground">{t.loading}</span>
      </div>
    );
  }

  const isModified = JSON.stringify(draft) !== JSON.stringify(value);

  return (
    <div className="as-panel flex flex-col gap-4 p-4">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <span className="text-ui font-medium text-foreground">{t.settingsMarkdownStylesTitle}</span>
        <span className="text-[11px] text-muted-foreground">{t.settingsMarkdownStylesDesc}</span>
      </div>

      {/* Color controls */}
      <div className="flex flex-col gap-2.5">
        <ColorRow
          label={t.settingsMarkdownStylesHeadingColor}
          value={draft.headingColor}
          onChange={(v) => update('headingColor', v)}
          placeholder="#111111"
        />
        <ColorRow
          label={t.settingsMarkdownStylesHeadingColorH1}
          value={draft.headingColorH1}
          onChange={(v) => update('headingColorH1', v)}
          placeholder="#222222"
        />
        <ColorRow
          label={t.settingsMarkdownStylesHeadingColorH2}
          value={draft.headingColorH2}
          onChange={(v) => update('headingColorH2', v)}
          placeholder="#333333"
        />
        <ColorRow
          label={t.settingsMarkdownStylesHeadingColorH3}
          value={draft.headingColorH3}
          onChange={(v) => update('headingColorH3', v)}
          placeholder="#444444"
        />
        <ColorRow
          label={t.settingsMarkdownStylesLinkColor}
          value={draft.linkColor}
          onChange={(v) => update('linkColor', v)}
          placeholder="#0969da"
        />
        <ColorRow
          label={t.settingsMarkdownStylesCodeBackground}
          value={draft.codeBackground}
          onChange={(v) => update('codeBackground', v)}
          placeholder="#f6f8fa"
        />
        <ColorRow
          label={t.settingsMarkdownStylesCodeColor}
          value={draft.codeColor}
          onChange={(v) => update('codeColor', v)}
          placeholder="#24292f"
        />
        <ColorRow
          label={t.settingsMarkdownStylesInlineCodeColor}
          value={draft.inlineCodeColor}
          onChange={(v) => update('inlineCodeColor', v)}
          placeholder="#d73a49"
        />
        <ColorRow
          label={t.settingsMarkdownStylesBlockquoteColor}
          value={draft.blockquoteColor}
          onChange={(v) => update('blockquoteColor', v)}
          placeholder="#6a737d"
        />
      </div>

      {/* Font family */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] text-muted-foreground">
          {t.settingsMarkdownStylesFontFamily}
        </span>
        <input
          type="text"
          value={draft.fontFamily ?? ''}
          onChange={(e) => update('fontFamily', e.target.value || undefined)}
          placeholder="Inter, system-ui, sans-serif"
          className="w-48 rounded border border-border bg-background px-2 py-0.5 text-[11px] text-foreground font-mono"
        />
      </div>

      {/* Preview */}
      <MarkdownPreview styles={draft} label={t.settingsMarkdownStylesPreview} />

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
        <button
          type="button"
          onClick={() => void handleReset()}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors duration-base hover:bg-muted hover:text-foreground"
        >
          <RotateCcw className="size-3" />
          {t.settingsMarkdownStylesReset}
        </button>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!isModified || saving}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] transition-colors duration-base',
            isModified && !saving
              ? 'bg-primary text-white hover:bg-primary/90'
              : 'bg-muted text-muted-foreground/50 cursor-not-allowed',
          )}
        >
          <Save className="size-3" />
          {t.settingsMarkdownStylesSave}
        </button>
      </div>
    </div>
  );
}
