// SPDX-License-Identifier: MPL-2.0

/**
 * # CenterTabGenerator
 *
 * Snapshot → Override extraction panel.
 * Reads the current snapshot from studioStore, displays extracted properties,
 * and provides an "Apply to Tweak" button that merges into toolOverrides.
 */

import { useMemo } from 'react';
import { extractOverrideFromSnapshot } from '@/lib/snapshot-to-override';
import { useStudioStore } from '@/stores/studioStore';

import type { UiMessages } from '@shared/i18n';
import type { ToolOverride } from '@shared/types/override';

/** Format an override value for display. */
function fmtValue(v: string | number | boolean | undefined): string {
  if (v === undefined) return '—';
  return String(v);
}

/** Describe which keys were extracted vs missing. */
function describeExtraction(override: ToolOverride): { key: string; value: string }[] {
  return [
    { key: 'background', value: fmtValue(override.background) },
    { key: 'foreground', value: fmtValue(override.foreground) },
    { key: 'accent', value: fmtValue(override.accent) },
    { key: 'radius', value: fmtValue(override.radius) },
    { key: 'fontFam', value: fmtValue(override.fontFam) },
    { key: 'fontSize', value: fmtValue(override.fontSize) },
  ];
}

export function CenterTabGenerator({ t }: { t: UiMessages }) {
  const snapshot = useStudioStore((s) => s.snapshot);
  const applyOverrideFromSnapshot = useStudioStore((s) => s.applyOverrideFromSnapshot);

  const extracted = useMemo(
    () => (snapshot ? extractOverrideFromSnapshot(snapshot) : null),
    [snapshot],
  );

  const entries = extracted ? describeExtraction(extracted) : [];
  const hasExtracted = extracted !== null && entries.some((e) => e.value !== '—');

  if (!snapshot) {
    return (
      <div className="rounded-[2px] border border-[var(--border-subtle)] bg-[var(--bg-1)] p-4">
        <h3 className="font-mono text-xs font-bold text-[var(--fg-0)]">{t.studioTabGenerator}</h3>
        <p className="mt-2 font-mono text-[10px] leading-relaxed text-[var(--fg-2)]">
          {t.studioTabGeneratorDesc}
        </p>
        <div className="mt-4 rounded-[2px] border border-dashed border-[var(--border-subtle)] bg-[var(--bg-2)] p-8 text-center">
          <p className="font-mono text-xs font-bold text-[var(--fg-0)]">
            {t.studioInspectEmptyTitle}
          </p>
          <p className="mt-2 font-mono text-[10px] text-[var(--fg-3)]">
            {t.studioInspectEmptyHint}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[2px] border border-[var(--border-subtle)] bg-[var(--bg-1)] p-4">
      <h3 className="font-mono text-xs font-bold text-[var(--fg-0)]">{t.studioTabGenerator}</h3>
      <p className="mt-2 font-mono text-[10px] leading-relaxed text-[var(--fg-2)]">
        {t.studioTabGeneratorDesc}
      </p>

      {/* Extraction summary */}
      <div className="mt-4">
        <h4 className="font-mono text-[10px] font-bold text-[var(--fg-0)]">
          {t.studioGeneratorExtracted}
        </h4>
        <div className="mt-2 rounded-[2px] border border-[var(--border-subtle)]">
          {entries.map((entry) => (
            <div
              key={entry.key}
              className="flex items-center justify-between border-b border-[var(--border-subtle)] px-2 py-1 font-mono text-[10px] last:border-b-0"
            >
              <span className="text-[var(--fg-1)]">{entry.key}</span>
              <span
                className={
                  entry.value === '—' ? 'text-[var(--fg-3)]' : 'text-[var(--fg-0)] font-bold'
                }
              >
                {entry.value}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Apply button */}
      <div className="mt-4">
        <button
          type="button"
          className="ws-btn ws-btn--sm"
          disabled={!hasExtracted}
          onClick={applyOverrideFromSnapshot}
        >
          {t.studioGeneratorApply}
        </button>
      </div>
    </div>
  );
}
