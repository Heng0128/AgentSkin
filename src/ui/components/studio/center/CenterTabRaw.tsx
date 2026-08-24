// SPDX-License-Identifier: MPL-2.0

/**
 * # CenterTabRaw
 *
 * CSS source editor — reads an agent's baseline stylesheets via CDP, lets the
 * user edit the raw CSS, and injects edits through the existing `workspace-tweak`
 * layer. No new injection mechanism; reuses the same path as live-tweak preview.
 *
 * ## Layout
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │  Stylesheet selector (dropdown)            [status tag] │
 *   ├──────────────────────────────────────────────────────────┤
 *   │  textarea (font-mono, tabsize 2)                         │
 *   │                                                          │
 *   ├──────────────────────────────────────────────────────────┤
 *   │  [Apply Edit]  [Reset to Original]    dirty / error      │
 *   └──────────────────────────────────────────────────────────┘
 */

import { useCallback, useEffect, useRef } from 'react';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import type { UiMessages } from '@shared/i18n';

export function CenterTabRaw({ t }: { t: UiMessages }) {
  const currentAgentId = useWorkspaceStore((s) => s.currentAgentId);
  const rawSheets = useWorkspaceStore((s) => s.rawSheets);
  const rawSheetIndex = useWorkspaceStore((s) => s.rawSheetIndex);
  const rawCss = useWorkspaceStore((s) => s.rawCss);
  const rawDirty = useWorkspaceStore((s) => s.rawDirty);
  const rawError = useWorkspaceStore((s) => s.rawError);
  const rawLoading = useWorkspaceStore((s) => s.rawLoading);

  const loadRawSheets = useWorkspaceStore((s) => s.loadRawSheets);
  const selectRawSheet = useWorkspaceStore((s) => s.selectRawSheet);
  const setRawCss = useWorkspaceStore((s) => s.setRawCss);
  const applyRawEdit = useWorkspaceStore((s) => s.applyRawEdit);
  const resetRawEdit = useWorkspaceStore((s) => s.resetRawEdit);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reload sheet list whenever the selected agent changes.
  useEffect(() => {
    if (currentAgentId) {
      void loadRawSheets();
    }
  }, [currentAgentId, loadRawSheets]);

  const handleSheetChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const idx = Number(e.target.value);
      if (!Number.isNaN(idx)) void selectRawSheet(idx);
    },
    [selectRawSheet],
  );

  const handleApply = useCallback(async () => {
    await applyRawEdit();
  }, [applyRawEdit]);

  const handleReset = useCallback(async () => {
    await resetRawEdit();
  }, [resetRawEdit]);

  const handleTextareaChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setRawCss(e.target.value);
    },
    [setRawCss],
  );

  // Auto-resize textarea to fill available space. rawCss is a genuine content-driven
  // resize trigger (sheet switch / edits grow the textarea); the body reads the
  // rendered scrollHeight rather than the rawCss value, so the linter sees it unused.
  // biome-ignore lint/correctness/useExhaustiveDependencies: content-driven resize depends on rawCss
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.max(ta.scrollHeight, 200)}px`;
  }, [rawCss]);

  const hasAgent = !!currentAgentId;
  const hasSheets = rawSheets.length > 0;
  const selectedSheet = rawSheetIndex !== null ? rawSheets[rawSheetIndex] : null;

  return (
    <div className="flex h-full flex-col rounded-[var(--dl-radius,2px)] border border-[var(--border-subtle)] bg-[var(--bg-1)] p-4">
      {/* Header row: title + selector + status */}
      <div className="flex items-center gap-2">
        <h3 className="font-mono text-[11px] font-normal text-[var(--fg-0)]">{t.studioTabRaw}</h3>

        <select
          className="ml-auto h-6 max-w-[240px] rounded-[var(--dl-radius,2px)] border border-[var(--border-subtle)] bg-[var(--bg-2)] px-2 font-mono text-[10px] text-[var(--fg-1)]"
          value={rawSheetIndex ?? ''}
          onChange={handleSheetChange}
          disabled={!hasSheets || rawLoading}
          aria-label={t.studioRawSelectSheet}
        >
          <option value="" disabled>
            {t.studioRawSheetLabel} ({rawSheets.length})
          </option>
          {rawSheets.map((sheet, i) => (
            <option key={sheet.styleSheetId} value={i}>
              {sheet.label}
              {sheet.disabled ? ' [disabled]' : ''}
            </option>
          ))}
        </select>

        {rawDirty && (
          <span className="rounded-[var(--dl-radius,2px)] bg-[var(--cr-warn-subtle)] px-2 py-px font-mono text-[10px] text-[var(--cr-warn-fg)]">
            {t.studioRawDirty}
          </span>
        )}
      </div>

      {/* Description */}
      <p className="mt-2 font-mono text-[10px] leading-relaxed text-[var(--fg-2)]">
        {t.studioTabRawDesc}
      </p>

      {/* Main content */}
      <div className="mt-4 flex min-h-0 flex-1 flex-col">
        {!hasAgent ? (
          <div className="flex flex-1 items-center justify-center rounded-[var(--dl-radius,2px)] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-2)] p-8">
            <p className="font-mono text-[10px] text-[var(--fg-3)]">{t.studioRawNoAgent}</p>
          </div>
        ) : rawLoading ? (
          <div className="flex flex-1 items-center justify-center rounded-[var(--dl-radius,2px)] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-2)] p-8">
            <p className="font-mono text-[10px] text-[var(--fg-3)]">{t.studioRawLoading}</p>
          </div>
        ) : !hasSheets ? (
          <div className="flex flex-1 items-center justify-center rounded-[var(--dl-radius,2px)] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-2)] p-8">
            <p className="font-mono text-[10px] text-[var(--fg-3)]">{t.studioRawNoSheets}</p>
          </div>
        ) : (
          <textarea
            ref={textareaRef}
            className="min-h-[200px] flex-1 resize-none rounded-[var(--dl-radius,2px)] border border-[var(--border-subtle)] bg-[var(--bg-2)] p-4 font-mono text-[11px] leading-relaxed text-[var(--fg-1)] outline-none focus:border-[var(--fg-3)]"
            value={rawCss}
            onChange={handleTextareaChange}
            spellCheck={false}
            placeholder="/* CSS will appear here after selecting a stylesheet */"
          />
        )}
      </div>

      {/* Footer: actions + error/dirty status */}
      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={handleApply}
          disabled={!rawDirty || rawLoading || !hasSheets}
          className="h-7 rounded-[var(--dl-radius,2px)] bg-[var(--fg-0)] px-4 font-mono text-[10px] text-[var(--bg-1)] disabled:opacity-40"
        >
          {t.studioRawApply}
        </button>
        <button
          type="button"
          onClick={handleReset}
          disabled={!rawDirty || rawLoading || !hasSheets}
          className="h-7 rounded-[var(--dl-radius,2px)] border border-[var(--border-subtle)] bg-[var(--bg-2)] px-4 font-mono text-[10px] text-[var(--fg-1)] disabled:opacity-40"
        >
          {t.studioRawReset}
        </button>

        {rawError && (
          <span className="ml-auto rounded-[var(--dl-radius,2px)] bg-[var(--destructive-subtle)] px-2 py-px font-mono text-[10px] text-[var(--destructive-fg)]">
            {rawError}
          </span>
        )}

        {selectedSheet && (
          <span className="font-mono text-[10px] text-[var(--fg-3)]">
            {selectedSheet.isInline ? '(inline)' : selectedSheet.url} · {selectedSheet.length}B
          </span>
        )}
      </div>
    </div>
  );
}
