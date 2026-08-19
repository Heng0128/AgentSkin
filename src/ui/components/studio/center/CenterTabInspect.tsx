// SPDX-License-Identifier: MPL-2.0

/**
 * # CenterTabInspect
 *
 * Compliance inspection panel for the Studio center tab.
 * Reads the current snapshot from studioStore and displays
 * an overview of landmarks, CSS variables, DOM node count, and
 * theme health-check data (score, blocking layers, native tokens).
 */

import { useMemo, useState } from 'react';
import { useStudioStore } from '@/stores/studioStore';

import type { UiMessages } from '@shared/i18n';
import type { DomTreeNode } from '@shared/types/ipc';

const MAX_LANDMARKS = 50;
const MAX_ROOT_VARS = 30;
const MAX_OPAQUE_LAYERS = 20;

function countDomNodes(node: DomTreeNode | undefined): number {
  if (!node) return 0;
  let count = 0;
  const stack: DomTreeNode[] = [node];
  while (stack.length > 0) {
    const current = stack.pop()!;
    count++;
    for (let i = current.children.length - 1; i >= 0; i--) {
      const child = current.children[i];
      if (child) stack.push(child);
    }
  }
  return count;
}

/** Score color: green >= 80, yellow 50-79, red < 50. */
function scoreColor(score: number): string {
  if (score >= 80) return 'var(--cr-ok)';
  if (score >= 50) return 'var(--cr-warn)';
  return 'var(--destructive)';
}

/** SVG circular progress indicator for the health score. */
function ScoreRing({ score, label }: { score: number; label: string }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  const offset = c - (score / 100) * c;
  const color = scoreColor(score);
  return (
    <svg width={48} height={48} viewBox="0 0 48 48" className="mx-auto" role="img">
      <title>{label}</title>
      <circle cx={24} cy={24} r={r} fill="none" stroke="var(--border-subtle)" strokeWidth={3} />
      <circle
        cx={24}
        cy={24}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={3}
        strokeDasharray={c}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform="rotate(-90 24 24)"
      />
      <text
        x={24}
        y={24}
        textAnchor="middle"
        dominantBaseline="central"
        className="font-mono"
        fill={color}
        fontSize={12}
        fontWeight={700}
      >
        {score}
      </text>
    </svg>
  );
}

export function CenterTabInspect({ t }: { t: UiMessages }) {
  const snapshot = useStudioStore((s) => s.snapshot);
  const activeProject = useStudioStore((s) => s.getActiveProject());
  const healthReportByAgent = useStudioStore((s) => s.healthReportByAgent);
  const healthReport = activeProject ? (healthReportByAgent[activeProject.agentId] ?? null) : null;
  const [opaqueExpanded, setOpaqueExpanded] = useState(false);
  const domNodeCount = useMemo(() => countDomNodes(snapshot?.domTree), [snapshot]);

  if (!snapshot) {
    return (
      <div className="rounded-[2px] border border-[var(--border-subtle)] bg-[var(--bg-1)] p-4">
        <h3 className="font-mono text-xs font-bold text-[var(--fg-0)]">{t.studioTabInspect}</h3>
        <p className="mt-2 font-mono text-[10px] leading-relaxed text-[var(--fg-2)]">
          {t.studioInspectPanelDesc}
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

  const landmarkCount = snapshot.landmarks.length;
  const rootVarCount = Object.keys(snapshot.rootVars ?? {}).length;

  const visibleLandmarks = snapshot.landmarks.slice(0, MAX_LANDMARKS);
  const rootVarEntries = Object.entries(snapshot.rootVars ?? {}).slice(0, MAX_ROOT_VARS);

  const nativeTokenEntries = healthReport
    ? Object.entries(healthReport.nativeTokens).filter(([, v]) => v && v.trim() !== '')
    : [];
  const visibleOpaqueLayers = healthReport
    ? healthReport.opaqueLayers.slice(0, MAX_OPAQUE_LAYERS)
    : [];

  return (
    <div className="rounded-[2px] border border-[var(--border-subtle)] bg-[var(--bg-1)] p-4">
      <h3 className="font-mono text-xs font-bold text-[var(--fg-0)]">{t.studioTabInspect}</h3>
      <p className="mt-2 font-mono text-[10px] leading-relaxed text-[var(--fg-2)]">
        {t.studioInspectPanelDesc}
      </p>

      {/* Overview cards */}
      <div className="mt-4">
        <h4 className="font-mono text-[10px] font-bold text-[var(--fg-0)]">
          {t.studioInspectOverview}
        </h4>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <div className="rounded-[2px] border border-[var(--border-subtle)] bg-[var(--bg-2)] p-2 text-center">
            <p className="font-mono text-[10px] text-[var(--fg-2)]">{t.studioInspectLandmarks}</p>
            <p className="mt-1 font-mono text-xs font-bold text-[var(--fg-0)] tabular-nums">
              {landmarkCount}
            </p>
          </div>
          <div className="rounded-[2px] border border-[var(--border-subtle)] bg-[var(--bg-2)] p-2 text-center">
            <p className="font-mono text-[10px] text-[var(--fg-2)]">{t.studioInspectRootVars}</p>
            <p className="mt-1 font-mono text-xs font-bold text-[var(--fg-0)] tabular-nums">
              {rootVarCount}
            </p>
          </div>
          <div className="rounded-[2px] border border-[var(--border-subtle)] bg-[var(--bg-2)] p-2 text-center">
            <p className="font-mono text-[10px] text-[var(--fg-2)]">{t.studioInspectDomNodes}</p>
            <p className="mt-1 font-mono text-xs font-bold text-[var(--fg-0)] tabular-nums">
              {domNodeCount}
            </p>
          </div>
        </div>
      </div>

      {/* Health check section */}
      {healthReport && (
        <>
          {/* Score + Blocking cards */}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="flex flex-col items-center rounded-[2px] border border-[var(--border-subtle)] bg-[var(--bg-2)] p-2">
              <p className="font-mono text-[10px] text-[var(--fg-2)]">
                {t.studioInspectHealthScore}
              </p>
              <div className="mt-1">
                <ScoreRing score={healthReport.score} label={t.studioInspectScoreLabel} />
              </div>
            </div>
            <div
              className={`rounded-[2px] border p-2 text-center ${
                healthReport.blockingCount > 0
                  ? 'border-[var(--destructive)] bg-[var(--redbg)]'
                  : 'border-[var(--border-subtle)] bg-[var(--bg-2)]'
              }`}
            >
              <p className="font-mono text-[10px] text-[var(--fg-2)]">{t.studioInspectBlocking}</p>
              <p
                className={`mt-1 font-mono text-base font-bold tabular-nums ${
                  healthReport.blockingCount > 0
                    ? 'text-[var(--destructive)]'
                    : 'text-[var(--cr-ok)]'
                }`}
              >
                {healthReport.blockingCount}
              </p>
            </div>
          </div>

          {/* Status summary row */}
          <div className="mt-2 grid grid-cols-3 gap-2">
            <div className="rounded-[2px] border border-[var(--border-subtle)] bg-[var(--bg-2)] px-2 py-1 text-center">
              <p className="font-mono text-[10px] text-[var(--fg-2)]">{t.studioInspectHeroArt}</p>
              <p
                className={`mt-1 font-mono text-[10px] font-bold ${
                  healthReport.heroArtActive ? 'text-[var(--cr-ok)]' : 'text-[var(--destructive)]'
                }`}
              >
                {healthReport.heroArtActive
                  ? t.studioInspectStatusActive
                  : t.studioInspectStatusInactive}
              </p>
            </div>
            <div className="rounded-[2px] border border-[var(--border-subtle)] bg-[var(--bg-2)] px-2 py-1 text-center">
              <p className="font-mono text-[10px] text-[var(--fg-2)]">
                {t.studioInspectThemeSheet}
              </p>
              <p
                className={`mt-1 font-mono text-[10px] font-bold ${
                  healthReport.themeSheetPresent
                    ? 'text-[var(--cr-ok)]'
                    : 'text-[var(--destructive)]'
                }`}
              >
                {healthReport.themeSheetPresent
                  ? t.studioInspectStatusActive
                  : t.studioInspectStatusInactive}
              </p>
            </div>
            <div className="rounded-[2px] border border-[var(--border-subtle)] bg-[var(--bg-2)] px-2 py-1 text-center">
              <p className="font-mono text-[10px] text-[var(--fg-2)]">
                {t.studioInspectAccentToken}
              </p>
              <p className="mt-1 font-mono text-[10px] font-bold text-[var(--fg-0)]">
                {healthReport.accentToken || '—'}
              </p>
            </div>
          </div>

          {/* Opaque layers collapsible */}
          <div className="mt-4">
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-[2px] border border-[var(--border-subtle)] bg-[var(--bg-2)] px-2 py-1 text-left"
              onClick={() => setOpaqueExpanded((v) => !v)}
            >
              <span className="font-mono text-[10px] font-bold text-[var(--fg-0)]">
                {t.studioInspectOpaqueLayers} ({healthReport.opaqueLayers.length})
              </span>
              <span className="font-mono text-[10px] text-[var(--fg-3)]">
                {opaqueExpanded ? '▼' : '▶'}
              </span>
            </button>
            {opaqueExpanded && (
              <div className="mt-2 max-h-48 overflow-y-auto rounded-[2px] border border-[var(--border-subtle)]">
                {visibleOpaqueLayers.length === 0 ? (
                  <div className="px-2 py-1 font-mono text-[10px] text-[var(--fg-3)]">
                    {t.studioInspectNoOpaqueLayers}
                  </div>
                ) : (
                  visibleOpaqueLayers.map((layer) => (
                    <div
                      key={`${layer.tagName}-${layer.depth}-${layer.id || layer.backgroundColor}-${layer.size}`}
                      className="border-b border-[var(--border-subtle)] px-2 py-1 font-mono text-[10px] last:border-b-0"
                    >
                      <span className="text-[var(--primary)]">{layer.tagName}</span>
                      <span className="ml-2 text-[var(--fg-3)]">{layer.size}</span>
                      {layer.backgroundColor && (
                        <span
                          className="ml-2 inline-block h-2 w-2 rounded-[2px] border border-[var(--border-subtle)]"
                          style={{ backgroundColor: layer.backgroundColor }}
                          title={layer.backgroundColor}
                        />
                      )}
                      {layer.backgroundColor && (
                        <span className="ml-1 text-[var(--fg-2)]">{layer.backgroundColor}</span>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Native tokens table */}
          {nativeTokenEntries.length > 0 && (
            <div className="mt-4">
              <h4 className="font-mono text-[10px] font-bold text-[var(--fg-0)]">
                {t.studioInspectNativeTokens}
              </h4>
              <div className="mt-2 max-h-48 overflow-y-auto rounded-[2px] border border-[var(--border-subtle)]">
                {nativeTokenEntries.map(([name, value]) => (
                  <div
                    key={name}
                    className="border-b border-[var(--border-subtle)] px-2 py-1 font-mono text-[10px] last:border-b-0"
                  >
                    <span className="text-[var(--fg-1)]">{name}</span>
                    <span className="ml-2 text-[var(--fg-3)]">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Landmark list */}
      <div className="mt-4">
        <h4 className="font-mono text-[10px] font-bold text-[var(--fg-0)]">
          {t.studioInspectLandmarkList}
        </h4>
        <div className="mt-2 max-h-48 overflow-y-auto rounded-[2px] border border-[var(--border-subtle)]">
          {visibleLandmarks.map((lm) => (
            <div
              key={lm.selector}
              className="border-b border-[var(--border-subtle)] px-2 py-1 font-mono text-[10px] text-[var(--fg-1)] last:border-b-0"
            >
              <span className="text-[var(--primary)]">{lm.tag}</span>
              <span className="ml-2 text-[var(--fg-3)]">{lm.selector}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Root variables list */}
      <div className="mt-4">
        <h4 className="font-mono text-[10px] font-bold text-[var(--fg-0)]">
          {t.studioInspectRootVarsList}
        </h4>
        <div className="mt-2 max-h-48 overflow-y-auto rounded-[2px] border border-[var(--border-subtle)]">
          {rootVarEntries.map(([name, value]) => (
            <div
              key={name}
              className="border-b border-[var(--border-subtle)] px-2 py-1 font-mono text-[10px] last:border-b-0"
            >
              <span className="text-[var(--fg-1)]">{name}</span>
              <span className="ml-2 text-[var(--fg-3)]">{value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
