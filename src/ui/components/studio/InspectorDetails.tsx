// SPDX-License-Identifier: MPL-2.0

/**
 * # InspectorDetails
 *
 * Right inspector "Computed" tab — styles for the selected landmark,
 * including pseudo-states, light/dark scheme variants, and the CSS
 * cascade. Re-uses logic from the old StudioRightInspector but
 * isolated in a single component.
 */

import { useMemo } from 'react';
import { CascadeView } from '@/components/studio/CascadeView';
import { useStudioStore } from '@/stores/studioStore';

import type { UiMessages } from '@shared/i18n';
import { useShallow } from 'zustand/react/shallow';

export function InspectorDetails({ t }: { t: UiMessages }) {
  const { snapshot, inspectingIdx, pseudoView, schemeView, setPseudoView, setSchemeView } =
    useStudioStore(
      useShallow((s) => ({
        snapshot: s.snapshot,
        inspectingIdx: s.inspectingIdx,
        pseudoView: s.pseudoView,
        schemeView: s.schemeView,
        setPseudoView: s.setPseudoView,
        setSchemeView: s.setSchemeView,
      })),
    );

  const inspectingLandmark = useMemo(
    () => snapshot?.landmarks[inspectingIdx ?? -1] ?? null,
    [snapshot, inspectingIdx],
  );

  const activePseudo = useMemo(
    () => (pseudoView ? inspectingLandmark?.pseudo?.[pseudoView] : undefined),
    [pseudoView, inspectingLandmark],
  );

  const activeScheme = useMemo(
    () => (schemeView ? inspectingLandmark?.scheme?.[schemeView] : undefined),
    [schemeView, inspectingLandmark],
  );

  if (!inspectingLandmark) {
    return (
      <p className="font-mono text-[10px] text-[var(--fg-2)] px-1">{t.studioInspectorEmpty}</p>
    );
  }

  return (
    <div className="space-y-[var(--space-2)]">
      {/* Header: selector + tag + dimensions */}
      <div className="flex items-center gap-[var(--space-1)] flex-wrap">
        <span
          className="truncate font-mono text-[10px] font-medium"
          style={{ color: 'var(--fg-0)' }}
          title={inspectingLandmark.selector}
        >
          {inspectingLandmark.selector}
        </span>
        <span
          className="shrink-0 bg-[var(--bg-4)] px-1 py-0 font-mono text-[10px]"
          style={{ color: 'var(--fg-2)', borderRadius: 'var(--r-micro)' }}
        >
          {inspectingLandmark.tag}
        </span>
        {inspectingLandmark.boxModel && (
          <span
            className="shrink-0 bg-[var(--bg-4)] px-1 py-0 font-mono text-[10px] font-medium"
            style={{
              color: 'var(--fg-2)',
              borderRadius: 'var(--r-micro)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {inspectingLandmark.boxModel.width}
            {'×'}
            {inspectingLandmark.boxModel.height}
          </span>
        )}
      </div>

      {/* Style rows */}
      <div className="ws-detail-group">
        <div className="ws-detail-group__title">{t.studioInspector}</div>
        {inspectingLandmark.styles.length === 0 ? (
          <p className="font-mono text-[10px]" style={{ color: 'var(--fg-3)' }}>
            No inline styles
          </p>
        ) : (
          inspectingLandmark.styles.map((style) => (
            <div key={style.property} className="ws-style-row">
              <span className="prop">{style.property}</span>
              <span className="val">{style.value}</span>
            </div>
          ))
        )}
      </div>

      {/* Pseudo-state variants */}
      {inspectingLandmark.pseudo && Object.keys(inspectingLandmark.pseudo).length > 0 && (
        <div className="ws-detail-group">
          <div className="ws-detail-group__title">{t.studioPseudo}</div>
          <div className="flex flex-wrap gap-[var(--space-1)] mb-[var(--space-1)]">
            {Object.keys(inspectingLandmark.pseudo).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPseudoView(p === pseudoView ? null : p)}
                className="h-5 px-1 font-mono text-[10px]"
                style={{
                  background: pseudoView === p ? 'var(--accent)' : 'var(--bg-4)',
                  color: pseudoView === p ? 'var(--primary-foreground)' : 'var(--fg-2)',
                  borderRadius: 'var(--r-micro)',
                  letterSpacing: '0.04em',
                }}
              >
                :{p}
              </button>
            ))}
          </div>
          {pseudoView && activePseudo && (
            <div className="space-y-[2px]">
              {activePseudo.computed.map((s) => (
                <div key={s.property} className="ws-style-row">
                  <span className="prop">{s.property}</span>
                  <span className="val">{s.value}</span>
                </div>
              ))}
              <CascadeView cascade={activePseudo} t={t} />
            </div>
          )}
        </div>
      )}

      {/* Light/dark scheme variants */}
      {inspectingLandmark.scheme && Object.keys(inspectingLandmark.scheme).length > 0 && (
        <div className="ws-detail-group">
          <div className="ws-detail-group__title">{t.studioScheme}</div>
          <div className="flex gap-[var(--space-1)] mb-[var(--space-1)]">
            {(['light', 'dark'] as const).map((sc) => (
              <button
                key={sc}
                type="button"
                onClick={() => setSchemeView(sc)}
                className="h-5 px-1 font-mono text-[10px]"
                style={{
                  background: schemeView === sc ? 'var(--accent)' : 'var(--bg-4)',
                  color: schemeView === sc ? 'var(--primary-foreground)' : 'var(--fg-2)',
                  borderRadius: 'var(--r-micro)',
                }}
              >
                {sc === 'light' ? t.studioSchemeLight : t.studioSchemeDark}
              </button>
            ))}
          </div>
          {schemeView && activeScheme && (
            <div className="space-y-[2px]">
              {activeScheme.styles.map((s) => (
                <div key={s.property} className="ws-style-row">
                  <span className="prop">{s.property}</span>
                  <span className="val">{s.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Matched CSS rules cascade */}
      {inspectingLandmark.matchedRules && inspectingLandmark.matchedRules.length > 0 && (
        <div className="ws-detail-group">
          <div className="ws-detail-group__title">CSS CASCADE</div>
          <CascadeView
            cascade={{
              matchedRules: inspectingLandmark.matchedRules,
              platformFonts: inspectingLandmark.platformFonts ?? [],
              boxModel: inspectingLandmark.boxModel ?? null,
            }}
            t={t}
          />
        </div>
      )}

      {/* Live CDP data if no snapshot landmark */}
      {!inspectingLandmark.styles.length && !inspectingLandmark.matchedRules?.length && (
        <p className="font-mono text-[10px]" style={{ color: 'var(--fg-3)' }}>
          No computed styles available (CDP inactive)
        </p>
      )}
    </div>
  );
}
