// SPDX-License-Identifier: MPL-2.0

/**
 * # InspectorFingerprint
 *
 * Right inspector "Fingerprint" tab — 8-dimension signature cards
 * derived from the snapshot: color, shape, type, motion, filter,
 * effects. Rendered as Swiss detail groups with tabular-nums values.
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
  const modeBg = sig.color.mode === 'dark' ? '#201a40' : '#f0f0f0';
  const modeFg = sig.color.mode === 'dark' ? '#ffffff' : '#111111';

  return (
    <div className="space-y-[var(--space-2)]">
      {/* Compact fingerprint string */}
      <div
        className="border border-[var(--border-subtle)] bg-[var(--bg-3)] p-2"
        style={{ borderRadius: 'var(--r-xs)' }}
      >
        <div className="mb-1 flex items-center gap-[var(--space-1)]">
          <span className="size-[3px] rounded-full bg-[var(--accent)]" />
          <span className="font-mono text-[9.5px] font-semibold uppercase tracking-wider text-[var(--fg-2)]">
            {t.studioDimensions}
          </span>
          <span
            className="ml-auto rounded-[var(--r-micro)] px-1 py-0.5 font-mono text-[9px] font-bold"
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
        <DimRow k="bg" v={sig.color.rootBackground ?? '—'} />
        <DimRow k="fg" v={sig.color.rootColor ?? '—'} />
        <DimRow k="mode" v={sig.color.mode} />
        {sig.color.backgrounds.length > 0 && (
          <div className="flex flex-wrap gap-[2px] mt-[var(--space-1)]">
            {[...new Set(sig.color.backgrounds)].map((c) => (
              <span
                key={c}
                className="inline-block size-[10px] rounded-[var(--r-micro)] border border-[var(--border-subtle)]"
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
        <DimRow k="primary" v={sig.radius.primary} />
        <DimRow k="unique" v={`${sig.radius.values.length} values`} />
      </div>

      {/* Spacing card */}
      <div className="ws-dim-card">
        <div className="ws-dim-card__title">{t.studioDimSpacing}</div>
        <DimRow k="avg padding" v={`${Math.round(sig.spacing.avgPadding)}px`} />
      </div>

      {/* Shadow card */}
      <div className="ws-dim-card">
        <div className="ws-dim-card__title">{t.studioDimShadow}</div>
        <DimRow k="level" v={sig.shadow.level} />
      </div>

      {/* Blur card */}
      <div className="ws-dim-card">
        <div className="ws-dim-card__title">{t.studioDimBlur}</div>
        <DimRow k="elements" v={`${sig.blur.countWithBlur}`} />
      </div>

      {/* Typography card */}
      <div className="ws-dim-card">
        <div className="ws-dim-card__title">{t.studioDimFont}</div>
        <DimRow
          k="family"
          v={sig.font.family.split(',')[0]?.trim().replace(/'/g, '') ?? 'system-ui'}
        />
        <DimRow k="sizes" v={`${[...new Set(sig.font.sizes)].length} unique`} />
      </div>

      {/* Motion card */}
      <div className="ws-dim-card">
        <div className="ws-dim-card__title">{t.studioDimMotion}</div>
        <DimRow k="duration" v={sig.motion.defaultDuration} />
        <DimRow k="timing" v={sig.motion.defaultTiming} />
      </div>

      {/* Decoration card */}
      <div className="ws-dim-card">
        <div className="ws-dim-card__title">{t.studioDimDecoration}</div>
        <DimRow
          k="gradients"
          v={
            sig.decoration.gradients.length > 0
              ? `${sig.decoration.gradients.length} found`
              : 'none'
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
