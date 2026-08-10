// SPDX-License-Identifier: MPL-2.0

import { useMemo } from 'react';
import { api } from '@/api/agentSkinClient';
import { CascadeView } from '@/components/studio/CascadeView';
import { ImageToThemePanel } from '@/components/studio/ImageToThemePanel';
import { Kicker } from '@/components/studio/kicker';
import { PresetThemePicker } from '@/components/studio/PresetThemePicker';
import {
  computeSignature,
  fingerprintFromSnapshot,
  ToolboxPanel,
} from '@/components/studio/Toolbox';
import { Button } from '@/components/ui/button';
import { HugeIcon } from '@/components/ui/huge-icon';
import { Spinner } from '@/components/ui/spinner';
import { useStudioStore } from '@/stores/studioStore';

import {
  Download01Icon,
  Folder01Icon,
  Package01Icon,
  SlidersHorizontalIcon,
} from '@hugeicons/core-free-icons';
import type { UiMessages } from '@shared/i18n';
import { AGENT_META } from '@shared/types';
import { useShallow } from 'zustand/react/shallow';

/**
 * Studio right inspector — landmark inspector + live inspect + signature +
 * node tree + preset/image-to-theme/toolbox/export. Reads shared studio state
 * directly from {@link useStudioStore}.
 */
export function StudioRightInspector({ t }: { t: UiMessages }) {
  // ---- Selector strategy: 17 data selectors merged into 3 shallow subscriptions ----
  // (Eliminates redundant store-listener callbacks and cross-selector tearing.)
  const {
    snapshot,
    snapshotLoading,
    inspectingIdx,
    hoveredIdx,
    searchQuery,
    inspectMode,
    liveNode,
    liveError,
    pinnedSelectors,
    toolOverrides,
    pseudoView,
    schemeView,
  } = useStudioStore(
    useShallow((s) => ({
      snapshot: s.snapshot,
      snapshotLoading: s.snapshotLoading,
      inspectingIdx: s.inspectingIdx,
      hoveredIdx: s.hoveredIdx,
      searchQuery: s.searchQuery,
      inspectMode: s.inspectMode,
      liveNode: s.liveNode,
      liveError: s.liveError,
      pinnedSelectors: s.pinnedSelectors,
      toolOverrides: s.toolOverrides,
      pseudoView: s.pseudoView,
      schemeView: s.schemeView,
    })),
  );

  const { activeProject, installedThemes } = useStudioStore(
    useShallow((s) => ({
      activeProject: s.getActiveProject(),
      installedThemes: s.installedThemes,
    })),
  );
  const activeAgent = activeProject?.agentId ?? null;

  const { exportName, exportAuthor, exportState } = useStudioStore(
    useShallow((s) => ({
      exportName: s.exportName,
      exportAuthor: s.exportAuthor,
      exportState: s.exportState,
    })),
  );

  // Actions — zustand guarantees stable refs, no re-render cost.
  const setInspectingIdx = useStudioStore((s) => s.setInspectingIdx);
  const setHoveredIdx = useStudioStore((s) => s.setHoveredIdx);
  const setPseudoView = useStudioStore((s) => s.setPseudoView);
  const setSchemeView = useStudioStore((s) => s.setSchemeView);
  const pinSelector = useStudioStore((s) => s.pinSelector);
  const setOverride = useStudioStore((s) => s.setOverride);
  const resetOverrides = useStudioStore((s) => s.resetOverrides);
  const setExportName = useStudioStore((s) => s.setExportName);
  const setExportAuthor = useStudioStore((s) => s.setExportAuthor);
  const exportTheme = useStudioStore((s) => s.exportTheme);
  const refreshThemeLibrary = useStudioStore((s) => s.refreshThemeLibrary);
  const setPaletteLoaded = useStudioStore((s) => s.setPaletteLoaded);
  const setOverrideColors = useStudioStore((s) => s.setOverrideColors);

  // ---- Derived values (memoized to avoid recompute on unrelated re-renders) ----
  const allLandmarks = useMemo(() => snapshot?.landmarks ?? [], [snapshot]);
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

  const landmarkSearch = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allLandmarks;
    return allLandmarks.filter(
      (lm) => lm.selector.toLowerCase().includes(q) || lm.tag.toLowerCase().includes(q),
    );
  }, [allLandmarks, searchQuery]);

  // computeSignature iterates all visible landmarks — hot path; only recompute when snapshot changes.
  const computeSignatureMemo = useMemo(
    () => (snapshot ? computeSignature(snapshot) : null),
    [snapshot],
  );

  return (
    <div
      className="overflow-y-auto border-l border-border px-3 pt-3"
      style={{ background: 'var(--bg, var(--background))' }}
    >
      {/* Inspector section */}
      {inspectingLandmark && (
        <>
          <Kicker>{t.studioInspector}</Kicker>
          <div className="mt-2 mb-3 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <span
                className="truncate font-mono text-[10px] font-medium"
                style={{ color: 'var(--foreground)' }}
              >
                {inspectingLandmark.selector}
              </span>
              <span
                className="shrink-0 rounded-sm bg-muted px-1 py-0.5 font-mono text-[9.5px]"
                style={{ color: 'var(--muted-foreground)', borderRadius: 'var(--radius)' }}
              >
                {inspectingLandmark.tag}
              </span>
              {inspectingLandmark.boxModel && (
                <span
                  className="shrink-0 rounded-sm bg-muted px-1 py-0.5 font-mono text-[9.5px]"
                  style={{ color: 'var(--muted-foreground)', borderRadius: 'var(--radius)' }}
                >
                  {inspectingLandmark.boxModel.width}×{inspectingLandmark.boxModel.height}
                </span>
              )}
            </div>
            <div
              className="border border-border bg-card p-1.5"
              style={{ borderRadius: 'var(--radius)' }}
            >
              {inspectingLandmark.styles.map((style) => (
                <div
                  key={style.property}
                  className="flex items-baseline gap-1 px-0.5 py-0.5 font-mono text-[9.5px]"
                >
                  <span
                    className="w-[120px] shrink-0 truncate"
                    style={{ color: 'var(--muted-foreground)', opacity: 0.7 }}
                  >
                    {style.property}
                  </span>
                  <span className="truncate" style={{ color: 'var(--foreground)' }}>
                    {style.value}
                  </span>
                </div>
              ))}
            </div>

            {/* P5: pseudo-state variants */}
            {inspectingLandmark.pseudo && (
              <div className="mt-2 space-y-1">
                {t.studioPseudo}
                <div className="flex flex-wrap gap-1">
                  {Object.keys(inspectingLandmark.pseudo).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setPseudoView(p === pseudoView ? null : p)}
                      className="px-1.5 py-0.5 font-mono text-[10px]"
                      style={{
                        background: pseudoView === p ? 'var(--primary)' : 'var(--muted)',
                        color:
                          pseudoView === p
                            ? 'var(--primary-foreground)'
                            : 'var(--muted-foreground)',
                        borderRadius: 'var(--radius)',
                      }}
                    >
                      :{p}
                    </button>
                  ))}
                </div>
                {pseudoView && activePseudo && (
                  <div
                    className="border border-border bg-card p-1.5"
                    style={{ borderRadius: 'var(--radius)' }}
                  >
                    <div
                      className="mb-1 font-mono text-[10px] font-medium"
                      style={{ color: 'var(--foreground)' }}
                    >
                      {t.studioPseudoComputed(pseudoView)}
                    </div>
                    {activePseudo.computed.map((s) => (
                      <div
                        key={s.property}
                        className="flex items-baseline gap-1 px-0.5 py-0.5 font-mono text-[10px]"
                      >
                        <span
                          className="w-[120px] truncate"
                          style={{ color: 'var(--muted-foreground)', opacity: 0.7 }}
                        >
                          {s.property}
                        </span>
                        <span className="truncate" style={{ color: 'var(--foreground)' }}>
                          {s.value}
                        </span>
                      </div>
                    ))}
                    <CascadeView cascade={activePseudo} t={t} />
                  </div>
                )}
              </div>
            )}

            {/* P5: light/dark scheme variants */}
            {inspectingLandmark.scheme && (
              <div className="mt-2 space-y-1">
                {t.studioScheme}
                <div className="flex gap-1">
                  {(['light', 'dark'] as const).map((sc) => (
                    <button
                      key={sc}
                      type="button"
                      onClick={() => setSchemeView(sc)}
                      className="px-1.5 py-0.5 font-mono text-[10px]"
                      style={{
                        background: schemeView === sc ? 'var(--primary)' : 'var(--muted)',
                        color:
                          schemeView === sc
                            ? 'var(--primary-foreground)'
                            : 'var(--muted-foreground)',
                        borderRadius: 'var(--radius)',
                      }}
                    >
                      {sc === 'light' ? t.studioSchemeLight : t.studioSchemeDark}
                    </button>
                  ))}
                </div>
                {schemeView && activeScheme && (
                  <div
                    className="border border-border bg-card p-1.5"
                    style={{ borderRadius: 'var(--radius)' }}
                  >
                    <div
                      className="mb-1 font-mono text-[10px] font-medium"
                      style={{ color: 'var(--foreground)' }}
                    >
                      {t.studioSchemeComputed(
                        schemeView === 'light' ? t.studioSchemeLight : t.studioSchemeDark,
                      )}
                    </div>
                    {activeScheme.styles.map((s) => (
                      <div
                        key={s.property}
                        className="flex items-baseline gap-1 px-0.5 py-0.5 font-mono text-[10px]"
                      >
                        <span
                          className="w-[120px] truncate"
                          style={{ color: 'var(--muted-foreground)', opacity: 0.7 }}
                        >
                          {s.property}
                        </span>
                        <span className="truncate" style={{ color: 'var(--foreground)' }}>
                          {s.value}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {inspectingLandmark.matchedRules?.length > 0 && (
              <CascadeView
                t={t}
                cascade={{
                  matchedRules: inspectingLandmark.matchedRules,
                  platformFonts: inspectingLandmark.platformFonts,
                  boxModel: inspectingLandmark.boxModel,
                }}
              />
            )}
          </div>

          {/* Divider */}
          <div className="border-t border-border" />
        </>
      )}

      {/* Live inspect (Tier B) */}
      {inspectMode && (
        <>
          <div
            className="flex items-center justify-between border border-primary/40 bg-accent p-2"
            style={{ borderRadius: 'var(--radius)' }}
          >
            <span
              className="font-mono text-[10px] font-semibold uppercase"
              style={{ color: 'var(--primary)', letterSpacing: '0.08em' }}
            >
              ● {t.studioLiveInspect}
            </span>
            <span className="font-mono text-[10px]" style={{ color: 'var(--muted-foreground)' }}>
              {activeAgent ? AGENT_META[activeAgent].displayName : ''}
            </span>
          </div>
          {liveError && (
            <p className="mt-1 font-mono text-[10px]" style={{ color: 'var(--primary)' }}>
              {liveError}
            </p>
          )}
          {liveNode && (
            <div className="mt-2">
              <div className="mb-1 flex items-center gap-1.5">
                <span
                  className="truncate font-mono text-[10px] font-medium"
                  style={{ color: 'var(--foreground)' }}
                >
                  {liveNode.path}
                </span>
                <span
                  className="shrink-0 bg-muted px-1 py-0.5 font-mono text-[9.5px]"
                  style={{ color: 'var(--muted-foreground)', borderRadius: 'var(--radius)' }}
                >
                  {liveNode.tag}
                </span>
                {liveNode.cascade.boxModel && (
                  <span
                    className="shrink-0 bg-muted px-1 py-0.5 font-mono text-[9.5px]"
                    style={{
                      color: 'var(--muted-foreground)',
                      borderRadius: 'var(--radius)',
                    }}
                  >
                    {liveNode.cascade.boxModel.width}×{liveNode.cascade.boxModel.height}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => pinSelector(liveNode.path)}
                className="mb-2 flex items-center gap-1 border border-border bg-muted px-2 py-1 font-mono text-[9.5px] uppercase"
                style={{
                  letterSpacing: '0.06em',
                  borderRadius: 'var(--radius)',
                  color: pinnedSelectors.includes(liveNode.path)
                    ? 'var(--primary)'
                    : 'var(--muted-foreground)',
                }}
              >
                {pinnedSelectors.includes(liveNode.path) ? '✓ PINNED' : '+ PIN TO SNAPSHOT'}
              </button>
              <CascadeView cascade={liveNode.cascade} t={t} />
            </div>
          )}
          {!liveNode && !liveError && (
            <p
              className="mt-2 font-mono text-[10px]"
              style={{ color: 'var(--dim, var(--muted-foreground))' }}
            >
              {t.studioLiveInspectEmpty}
            </p>
          )}
          <div className="mt-2 border-t border-border" />
        </>
      )}

      {/* Dimension fingerprint card */}
      {snapshot && (
        <>
          <Kicker>{t.studioDimensions} · SIGNATURE</Kicker>
          <div
            className="mt-1.5 mb-3 border border-border bg-card p-2"
            style={{ borderRadius: 'var(--radius)' }}
          >
            <div className="flex items-center gap-1.5">
              <HugeIcon icon={SlidersHorizontalIcon} className="size-3 text-primary" />
              <span
                className="font-mono text-[10px] font-semibold uppercase"
                style={{ letterSpacing: '0.08em', color: 'var(--foreground)' }}
              >
                {t.studioDimensions}
              </span>
            </div>
            <p
              className="mt-1 break-all font-mono text-[10px] leading-tight"
              style={{ color: 'var(--muted-foreground)' }}
            >
              {fingerprintFromSnapshot(snapshot)}
            </p>
          </div>
        </>
      )}

      {/* Landmark list — compact node tree */}
      {snapshot && (
        <>
          <Kicker>
            {t.studioLandmark} · {t.studioNodeLandmarks}
          </Kicker>
          <div className="mt-1 mb-2 flex items-baseline justify-between">
            <span
              className="font-mono text-[10px]"
              style={{ color: 'var(--dim, var(--muted-foreground))' }}
            >
              {t.studioLandmarkCount(landmarkSearch.length, allLandmarks.length)}
            </span>
          </div>
          {landmarkSearch.length === 0 ? (
            <p className="font-mono text-[10px]" style={{ color: 'var(--muted-foreground)' }}>
              {t.studioNoMatch}
            </p>
          ) : (
            <div className="space-y-0.5 mb-3">
              {landmarkSearch.map((lm) => {
                const realIdx = allLandmarks.indexOf(lm);
                return (
                  <button
                    key={`${lm.selector}-${realIdx}`}
                    type="button"
                    onClick={() => {
                      setInspectingIdx(realIdx);
                      setHoveredIdx(null);
                    }}
                    onMouseEnter={() => setHoveredIdx(realIdx)}
                    onMouseLeave={() => setHoveredIdx(null)}
                    className="flex w-full items-center gap-1.5 px-2 py-1 text-left font-mono text-[9.5px]"
                    style={{
                      borderRadius: 'var(--radius)',
                      background:
                        inspectingIdx === realIdx
                          ? 'var(--accent)'
                          : hoveredIdx === realIdx
                            ? 'var(--muted)'
                            : 'transparent',
                      color:
                        inspectingIdx === realIdx
                          ? 'var(--primary)'
                          : hoveredIdx === realIdx
                            ? 'var(--foreground)'
                            : 'var(--muted-foreground)',
                      outline: inspectingIdx === realIdx ? '1px solid var(--primary)' : 'none',
                    }}
                  >
                    <span className="truncate">{lm.selector}</span>
                    <span
                      className="ml-auto shrink-0 rounded-sm bg-muted px-1 py-0.5 text-[9.5px] uppercase"
                      style={{ borderRadius: 'var(--radius)' }}
                    >
                      {lm.tag}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {!inspectingLandmark && !snapshotLoading && snapshot && (
        <p
          className="mt-2 text-center font-mono text-[10px]"
          style={{ color: 'var(--dim, var(--muted-foreground))' }}
        >
          {t.studioInspectorEmpty}
        </p>
      )}

      {/* P2a: Preset themes grid */}
      <div className="mb-4 border-b border-border pb-4">
        <PresetThemePicker
          t={t}
          activeAgent={activeAgent}
          themes={installedThemes}
          onPaletteLoaded={setPaletteLoaded}
          onRefresh={() => void refreshThemeLibrary()}
        />
      </div>

      {/* P2b: Image → Theme workflow */}
      {snapshot && <ImageToThemePanel t={t} onThemeGenerated={setOverrideColors} compact />}
      {/* P3: Toolbox */}
      {snapshot && (
        <ToolboxPanel
          t={t}
          originalSig={computeSignatureMemo!}
          overrides={toolOverrides}
          onOverride={setOverride}
          onReset={resetOverrides}
        />
      )}

      {/* P4: Export */}
      {snapshot && (
        <div
          className="mt-4 border border-border bg-card p-3"
          style={{ borderRadius: 'var(--radius)' }}
        >
          <div className="mb-2 flex items-center gap-1.5 border-b border-border pb-1.5">
            <HugeIcon icon={Package01Icon} className="size-3.5 text-primary" />
            <span
              className="font-mono text-[10px] font-semibold uppercase"
              style={{ letterSpacing: '0.1em', color: 'var(--foreground)' }}
            >
              {t.studioLandmark} · {t.studioExport}
            </span>
          </div>
          <p
            className="mb-2 font-mono text-[10px] leading-relaxed"
            style={{ color: 'var(--muted-foreground)' }}
          >
            {t.studioExportDesc('.agentskin-theme')}
          </p>
          <div className="space-y-1.5">
            <input
              value={exportName}
              onChange={(e) => setExportName(e.target.value)}
              placeholder={t.studioExportNamePlaceholder}
              className="h-6 w-full border border-border bg-muted px-2 font-mono text-[10px] outline-none focus:border-primary/60"
              style={{ borderRadius: 'var(--radius)' }}
            />
            <input
              value={exportAuthor}
              onChange={(e) => setExportAuthor(e.target.value)}
              placeholder={t.studioExportAuthorPlaceholder}
              className="h-6 w-full border border-border bg-muted px-2 font-mono text-[10px] outline-none focus:border-primary/60"
              style={{ borderRadius: 'var(--radius)' }}
            />
            <Button
              size="sm"
              disabled={exportState.loading || !activeAgent}
              onClick={() => void exportTheme()}
              className="h-6 w-full gap-1 font-mono text-[9.5px] uppercase"
              style={{ letterSpacing: '0.08em', borderRadius: 'var(--radius)' }}
            >
              {exportState.loading ? (
                <Spinner data-icon="inline-start" className="size-3" />
              ) : (
                <HugeIcon icon={Download01Icon} className="size-3" />
              )}
              {exportState.loading ? t.studioExporting : t.studioExportButton}
            </Button>
            {exportState.dir && (
              <div
                className="border border-border bg-muted p-2"
                style={{ borderRadius: 'var(--radius)' }}
              >
                <p className="font-mono text-[10px]" style={{ color: 'var(--muted-foreground)' }}>
                  {t.studioExportedTo}
                </p>
                <p
                  className="break-all font-mono text-[10px]"
                  style={{ color: 'var(--foreground)' }}
                >
                  {exportState.dir}
                </p>
                <Button
                  size="sm"
                  onClick={() => api.showInFolder(exportState.dir!)}
                  className="mt-1 h-5 gap-1 font-mono text-[10px] uppercase"
                  style={{ letterSpacing: '0.06em', borderRadius: 'var(--radius)' }}
                >
                  <HugeIcon icon={Folder01Icon} className="size-2.5" />
                  REVEAL
                </Button>
              </div>
            )}
            {exportState.error && (
              <p className="font-mono text-[10px]" style={{ color: 'var(--primary)' }}>
                {t.studioExportError(exportState.error)}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
