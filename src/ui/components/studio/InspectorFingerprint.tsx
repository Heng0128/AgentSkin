// SPDX-License-Identifier: MPL-2.0

/**
 * # InspectorFingerprint
 *
 * Right inspector "Fingerprint" tab — 8-dimension signature cards
 * derived from the snapshot: color, shape, type, motion, filter,
 * effects. Rendered as detail groups with tabular-nums values.
 */

import { computeSignature, fingerprintFromSnapshot } from '@/components/studio/Toolbox';
import { useStudioStore } from '@/stores/studioStore';

import type { UiMessages } from '@shared/i18n';
import { useShallow } from 'zustand/react/shallow';

export function InspectorFingerprint({ t }: { t: UiMessages }) {
  const snapshot = useStudioStore(useShallow((s) => s.snapshot));

  if (!snapshot) {
    return (
      <p className="font-mono text-[10px] text-[var(--fg-2)] px-1">{t.studioInspectorEmpty}</p>
    );
  }

  const sig = computeSignature(snapshot);
  const fingerprint = fingerprintFromSnapshot(snapshot);

  // Color mode badge
  const modeBg = sig.color.mode === 'dark' ? 'var(--bg-4)' : 'var(--accent-subtle)';
  const modeFg = sig.color.mode === 'dark' ? 'var(--primary-foreground)' : 'var(--fg-0)';

  return (
    <div className="space-y-[var(--space-2)]">
      {/* Compact fingerprint string */}
      <div
        className="border border-[var(--border-subtle)] bg-[var(--bg-3)] p-2"
        style={{ borderRadius: 'var(--r-xs)' }}
      >
        <div className="mb-1 flex items-center gap-[var(--space-1)]">
          <span className="size-[3px] rounded-[2px] bg-[var(--accent)]" />
          <span className="font-mono text-[10px] font-semibold   text-[var(--fg-2)]">
            {t.studioDimensions}
          </span>
          <span
            className="ml-auto rounded-[2px] px-1 py-0 font-mono text-[10px] font-bold"
            style={{ background: modeBg, color: modeFg }}
          >
            {sig.color.mode.toUpperCase()}
          </span>
        </div>
        <p className="font-mono text-[10px] text-[var(--fg-2)] leading-relaxed break-all">
          {fingerprint}
        </p>
      </div>

      {/* Color card */}
      <div className="ws-dim-card">
        <div className="ws-dim-card__title">{t.studioDimColor}</div>
        <DimRow k={t.studioDimBgKey} v={sig.color.rootBackground ?? '—'} />
        <DimRow k={t.studioDimFgKey} v={sig.color.rootColor ?? '—'} />
        <DimRow k={t.studioDimModeKey} v={sig.color.mode} />
        {sig.color.backgrounds.length > 0 && (
          <div className="flex flex-wrap gap-0 mt-[var(--space-1)]">
            {[...new Set(sig.color.backgrounds)].map((c) => (
              <span
                key={c}
                role="img"
                aria-label={`${t.studioDimColor} ${c}`}
                className="inline-block size-[10px] rounded-[2px] border border-[var(--border-subtle)]"
                style={{ background: c }}
                title={c}
              />
            ))}
          </div>
        )}
      </div>

      {/* Shape card */}
      <div className="ws-dim-card">
        <div className="ws-dim-card__title">{t.studioDimRadius}</div>
        <DimRow k={t.studioDimPrimary} v={sig.radius.primary} />
        <DimRow k={t.studioDimUnique} v={`${sig.radius.values.length} values`} />
      </div>

      {/* Spacing card */}
      <div className="ws-dim-card">
        <div className="ws-dim-card__title">{t.studioDimSpacing}</div>
        <DimRow k={t.studioDimAvgPadding} v={`${Math.round(sig.spacing.avgPadding)}px`} />
      </div>

      {/* Shadow card */}
      <div className="ws-dim-card">
        <div className="ws-dim-card__title">{t.studioDimShadow}</div>
        <DimRow k={t.studioDimLevel} v={sig.shadow.level} />
      </div>

      {/* Blur card */}
      <div className="ws-dim-card">
        <div className="ws-dim-card__title">{t.studioDimBlur}</div>
        <DimRow k={t.studioDimElements} v={`${sig.blur.countWithBlur}`} />
      </div>

      {/* Typography card */}
      <div className="ws-dim-card">
        <div className="ws-dim-card__title">{t.studioDimFont}</div>
        <DimRow
          k={t.studioDimFamily}
          v={sig.font.family.split(',')[0]?.trim().replace(/'/g, '') ?? 'system-ui'}
        />
        <DimRow k={t.studioDimUniqueSizes} v={`${[...new Set(sig.font.sizes)].length} unique`} />
      </div>

      {/* Motion card */}
      <div className="ws-dim-card">
        <div className="ws-dim-card__title">{t.studioDimMotion}</div>
        <DimRow k={t.studioDimDuration} v={sig.motion.defaultDuration} />
        <DimRow k={t.studioDimTiming} v={sig.motion.defaultTiming} />
      </div>

      {/* Decoration card */}
      <div className="ws-dim-card">
        <div className="ws-dim-card__title">{t.studioDimDecoration}</div>
        <DimRow
          k={t.studioDimGradients}
          v={
            sig.decoration.gradients.length > 0
              ? t.studioDimFound(sig.decoration.gradients.length)
              : t.studioDimNone
          }
        />
      </div>
    </div>
  );
}

function DimRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="ws-dim-row">
      <span className="dk">{k}</span>
      <span className="dv" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {v}
      </span>
    </div>
  );
}
