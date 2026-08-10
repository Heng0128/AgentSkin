// SPDX-License-Identifier: MPL-2.0

/**
 * # FitGeneratorPanel
 *
 * Theme Harmony Generator — derives coordinated color palettes from each
 * crawled Agent profile using HSL color theory. Users pick an Agent, hit
 * "Random Fit", and receive up to N candidate palettes ranked by contrast,
 * harmony, and semantic accuracy scores.
 *
 * Swiss/International design system: #141418 base, border-white/[0.06],
 * rounded-[2px], #FF453A accent, font-mono labels.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/api/agentSkinClient';
import { buildSkinTokens } from '@/components/studio/palette';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { HugeIcon } from '@/components/ui/huge-icon';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useNotificationStore } from '@/stores/notificationStore';
import { contrastRatio, generatePalettes, textOn } from '@/utils/color-theory';

import {
  BlocksIcon,
  ContrastIcon,
  RefreshIcon,
  StarIcon,
  SwatchIcon,
} from '@hugeicons/core-free-icons';
import { toMessage } from '@shared/errors';
import type { UiMessages } from '@shared/i18n';
import { AGENT_IDS, AGENT_META, type AgentId } from '@shared/types';
import { Kicker } from './kicker';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Proposal {
  palette: Record<string, string>;
  score: { total: number; contrast: number; harmony: number; semantic: number };
  harmony: string;
  sourceHue: number;
}

type PaletteKey =
  | 'background'
  | 'foreground'
  | 'surface'
  | 'border'
  | 'accent'
  | 'muted'
  | 'error'
  | 'warning'
  | 'success'
  | 'info';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PALETTE_KEYS: PaletteKey[] = [
  'accent',
  'background',
  'foreground',
  'surface',
  'border',
  'muted',
  'error',
  'warning',
  'success',
  'info',
];

const PALETTE_LABELS: Record<PaletteKey, string> = {
  accent: 'ACCENT',
  background: 'BG',
  foreground: 'FG',
  surface: 'SURFACE',
  border: 'BORDER',
  muted: 'MUTED',
  error: 'ERR',
  warning: 'WARN',
  success: 'OK',
  info: 'INFO',
};

const HARMONY_T_KEYS: Record<string, keyof UiMessages> = {
  complementary: 'harmonyComplementary',
  splitComplementary: 'harmonySplitComplementary',
  triadic: 'harmonyTriadic',
  analogous: 'harmonyAnalogous',
  tetradic: 'harmonyTetradic',
  monochromatic: 'harmonyMonochromatic',
};

const FIT_AGENT_IDS: AgentId[] = AGENT_IDS.filter((id) =>
  ['codex', 'doubao', 'qoderwork', 'traework', 'workbuddy', 'zcode'].includes(id),
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scoreColor(total: number): { label: string; cls: string; dot: string } {
  if (total >= 70) return { label: 'AAA', cls: 'text-[#2ED573]', dot: 'bg-[#2ED573]' };
  if (total >= 50) return { label: 'AA', cls: 'text-[#FFD240]', dot: 'bg-[#FFD240]' };
  return { label: 'LOW', cls: 'text-[#FF453A]', dot: 'bg-[#FF453A]' };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ScoreBadge({ score }: { score: Proposal['score'] }) {
  const { label, cls, dot } = scoreColor(score.total);
  return (
    <div className="flex items-center gap-1.5">
      <span className={`size-[6px] rounded-full ${dot}`} />
      <span className={`font-mono text-[10px] font-bold ${cls}`}>{label}</span>
      <span className="font-mono text-[10px] text-white/30">{score.total}</span>
    </div>
  );
}

function PaletteStrip({ palette }: { palette: Record<string, string> }) {
  return (
    <div className="flex gap-[3px]">
      {PALETTE_KEYS.map((key) => (
        <div
          key={key}
          className="group relative flex h-8 flex-1 items-end justify-center rounded-[2px] border border-white/[0.06] transition-all hover:flex-[2]"
          style={{ background: palette[key] || '#333' }}
          title={`${PALETTE_LABELS[key]}: ${palette[key]}`}
        >
          <span
            className="mb-0.5 hidden font-mono text-[9.5px] font-bold group-hover:block"
            style={{ color: textOn(palette[key] || '#333') }}
          >
            {PALETTE_LABELS[key]}
          </span>
        </div>
      ))}
    </div>
  );
}

function ProposalCard({
  proposal,
  agentId,
  rank,
  isRecommended,
  onPreview,
  onExport,
  onApply,
  t,
}: {
  proposal: Proposal;
  agentId: AgentId;
  rank: number;
  isRecommended: boolean;
  onPreview: (agentId: string, palette: Record<string, string>) => void;
  onExport: (agentId: string, palette: Record<string, string>) => void;
  onApply?: (agentId: string, palette: Record<string, string>) => void;
  t: UiMessages;
}) {
  const harmonyTKey = HARMONY_T_KEYS[proposal.harmony];
  const harmonyLabel = harmonyTKey ? String(t[harmonyTKey]) : proposal.harmony;
  const meta = AGENT_META[agentId];
  const fgBgContrast = contrastRatio(
    proposal.palette.foreground,
    proposal.palette.background,
  ).toFixed(1);

  return (
    <div
      className={`group relative flex flex-col gap-2.5 rounded-[2px] border p-3 transition-colors ${
        isRecommended
          ? 'border-[#FFD240]/25 bg-[#FFD240]/[0.03]'
          : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12]'
      }`}
    >
      {/* Top row: rank + score + harmony */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] font-bold text-white/20">
            #{rank.toString().padStart(2, '0')}
          </span>
          {isRecommended && <HugeIcon icon={StarIcon} className="size-3 text-[#FFD240]" />}
          <Badge className="h-[14px] rounded-[2px] border border-white/[0.08] bg-transparent px-1 font-mono text-[10px] font-medium text-white/40">
            {harmonyLabel}
          </Badge>
        </div>
        <ScoreBadge score={proposal.score} />
      </div>

      {/* Palette strip */}
      <PaletteStrip palette={proposal.palette} />

      {/* Meta row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge className="h-[14px] rounded-[2px] bg-[#FF453A]/10 border border-[#FF453A]/25 px-1.5 font-mono text-[10px] font-medium text-[#FF453A]">
            {meta?.displayName || agentId}
          </Badge>
          <span className="font-mono text-[10px] text-white/25">
            <span className="text-white/40">C:</span>
            {fgBgContrast}:1
          </span>
          <span className="font-mono text-[10px] text-white/25">
            <span className="text-white/40">H:</span>
            {Math.round(proposal.sourceHue)}°
          </span>
        </div>

        {/* Actions */}
        <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onPreview(agentId, proposal.palette)}
            className="h-5 gap-1 rounded-[2px] px-1.5 font-mono text-[10px] font-medium uppercase text-white/50 hover:bg-white/[0.06] hover:text-white/80"
          >
            <HugeIcon icon={ContrastIcon} className="size-2.5" />
            {t.studioFitPreview}
          </Button>
          {onApply && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onApply(agentId, proposal.palette)}
              className="h-5 gap-1 rounded-[2px] px-1.5 font-mono text-[10px] font-medium uppercase text-white/50 hover:bg-white/[0.06] hover:text-white/80"
            >
              <HugeIcon icon={SwatchIcon} className="size-2.5" />
              {t.studioFitApply}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onExport(agentId, proposal.palette)}
            className="h-5 gap-1 rounded-[2px] px-1.5 font-mono text-[10px] font-medium uppercase text-white/50 hover:bg-white/[0.06] hover:text-white/80"
          >
            <HugeIcon icon={SwatchIcon} className="size-2.5" />
            {t.studioFitExport}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface FitGeneratorPanelProps {
  t: UiMessages;
  onClose?: () => void;
  onPreviewPalette?: (agentId: string, palette: Record<string, string>) => void;
  onPaletteApply?: (agentId: string, palette: Record<string, string>) => void;
  embedded?: boolean;
}

// Map a visual-analysis palette (10 semantic keys) onto the `--agentskin-*`
// token namespace the theme package builder expects. Mirrors
// `buildStudioPalette` in palette.ts so the recolor takes effect on the agent.
function paletteToAgentSkinRoot(palette: Record<string, string>): Record<string, string> {
  // Map a visual-analysis palette (10 semantic keys) onto the `--agentskin-*`
  // token namespace. Token math lives in buildSkinTokens (shared with the
  // snapshot export path) so both pipelines produce identical results.
  const bg = palette.background || '#201a40';
  const fg = palette.foreground || '#e8e2ff';
  const accent = palette.accent || '#9d8bff';
  return buildSkinTokens({ bg, fg, accent });
}

export function FitGeneratorPanel({
  t,
  onClose,
  onPreviewPalette,
  onPaletteApply,
  embedded,
}: FitGeneratorPanelProps) {
  const showToast = useNotificationStore((s) => s.showToast);
  const [selectedAgent, setSelectedAgent] = useState<AgentId>(FIT_AGENT_IDS[0] ?? 'codex');
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [count, setCount] = useState(6);
  const [scheme] = useState<'dark' | 'light'>('dark');
  const [generating, setGenerating] = useState(false);

  // --- Load profile when agent changes ---
  // biome-ignore lint(correctness/useExhaustiveDependencies): t is a stable i18n table reference
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await api.getVisualAnalysisTarget(selectedAgent);
        if (!cancelled) {
          setProfile(data);
          setProposals([]);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : t.studioFitLoadProfileFailed);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [selectedAgent]);

  // --- Generate palettes ---
  const generationIdRef = useRef(0);
  const genTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timer + invalidate any pending generation on unmount
  useEffect(() => {
    return () => {
      generationIdRef.current++; // invalidate pending generation
      if (genTimerRef.current) clearTimeout(genTimerRef.current);
    };
  }, []);

  // biome-ignore lint(correctness/useExhaustiveDependencies): t is a stable i18n table reference
  const handleGenerate = useCallback(() => {
    if (!profile) return;
    // Increment generationId so any previous pending generation is stale
    const thisGen = ++generationIdRef.current;
    if (genTimerRef.current) clearTimeout(genTimerRef.current);
    setGenerating(true);
    // Use setTimeout to allow UI to update before heavy computation
    genTimerRef.current = setTimeout(() => {
      if (thisGen !== generationIdRef.current) return; // stale
      try {
        const result = generatePalettes(profile as Parameters<typeof generatePalettes>[0], {
          count,
          scheme,
          seed: Math.floor(Math.random() * 2 ** 31),
        });
        if (thisGen !== generationIdRef.current) return; // stale after compute
        setProposals(result);
      } catch (e) {
        if (thisGen !== generationIdRef.current) return; // stale
        setError(e instanceof Error ? e.message : t.studioFitGenerateFailed);
      } finally {
        if (thisGen === generationIdRef.current) setGenerating(false);
      }
    }, 30);
  }, [profile, count, scheme]);

  // --- Export handler ---
  const handleExport = useCallback(
    async (agentId: string, palette: Record<string, string>) => {
      const root = paletteToAgentSkinRoot(palette);
      const metaName = AGENT_META[agentId as AgentId]?.displayName || agentId;
      const themeData = {
        meta: { name: `${metaName} ${t.studioFitThemeNameSuffix}`, author: 'AgentSkin Studio' },
        root,
      };
      try {
        const res = await api.exportVisualAnalysisTheme(agentId, themeData);
        if (res.ok && res.path) {
          showToast(t.studioFitExportSuccess(res.path), 'default');
        } else {
          showToast(t.studioFitExportFailed, 'destructive');
        }
      } catch (e) {
        showToast(t.studioFitExportError(toMessage(e)), 'destructive');
      }
    },
    [showToast, t],
  );

  // --- Preview handler ---
  const handlePreview = useCallback(
    (agentId: string, palette: Record<string, string>) => {
      onPreviewPalette?.(agentId, palette);
    },
    [onPreviewPalette],
  );

  // --- Apply handler ---
  const handleApply = useCallback(
    (agentId: string, palette: Record<string, string>) => {
      onPaletteApply?.(agentId, palette);
      onPreviewPalette?.(agentId, palette); // apply also previews
    },
    [onPaletteApply, onPreviewPalette],
  );

  // --- Recommended: top 5 ---
  const recommended = useMemo(() => proposals.slice(0, 5), [proposals]);
  const remaining = useMemo(() => proposals.slice(5), [proposals]);

  // --- Embedded mode color tokens ---
  // When embedded, use CSS variables and Tailwind semantic classes
  // so the panel inherits the parent ThemeStudio theme.
  const _v = embedded
    ? {
        bgMain: 'bg-[var(--background)]',
        bgCard: 'bg-[var(--card)]',
        bgCardH: 'hover:bg-[var(--muted)]',
        border: 'border-[var(--border)]',
        borderH: 'hover:border-[var(--border)]',
        t90: 'text-[var(--foreground)] opacity-90',
        t85: 'text-[var(--foreground)] opacity-85',
        t80: 'text-[var(--foreground)] opacity-80',
        t60: 'text-muted-foreground',
        t50: 'text-muted-foreground opacity-80',
        t40: 'text-muted-foreground opacity-80',
        t30: 'text-muted-foreground opacity-70',
        t25: 'text-muted-foreground opacity-65',
        t20: 'text-muted-foreground opacity-60',
        t10: 'text-muted-foreground opacity-50',
      }
    : {
        bgMain: 'bg-[#141418]',
        bgCard: 'bg-white/[0.02]',
        bgCardH: 'hover:bg-white/[0.04]',
        border: 'border-white/[0.06]',
        borderH: 'hover:border-white/[0.12]',
        t90: 'text-white/90',
        t85: 'text-white/85',
        t80: 'text-white/80',
        t60: 'text-white/60',
        t50: 'text-white/50',
        t40: 'text-white/40',
        t30: 'text-white/30',
        t25: 'text-white/25',
        t20: 'text-white/20',
        t10: 'text-white/10',
      };

  return (
    <div className={`flex h-full w-full ${_v.bgMain} text-[var(--foreground)]`}>
      {/* ================================================================
          LEFT COLUMN — Controls (250px)
          ================================================================ */}
      <aside className={`flex w-[250px] shrink-0 flex-col border-r ${_v.border}`}>
        {/* Header */}
        <div className={`flex items-center justify-between border-b ${_v.border} px-4 py-3`}>
          <span
            className={`font-mono text-[11px] font-semibold uppercase tracking-[0.12em] ${_v.t90}`}
          >
            {t.studioFitTitle}
          </span>
          {!embedded && onClose && (
            <button
              type="button"
              onClick={onClose}
              className={`font-mono text-[10px] ${_v.t40} transition-colors hover:text-[var(--foreground)]`}
            >
              ✕
            </button>
          )}
        </div>

        {/* Agent switcher */}
        <ScrollArea className="flex-1">
          <div className="space-y-0.5 p-2">
            {FIT_AGENT_IDS.map((id) => {
              const meta = AGENT_META[id];
              const isSelected = id === selectedAgent;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSelectedAgent(id)}
                  className={`flex w-full items-center gap-2 rounded-[2px] px-3 py-2 text-left transition-colors ${
                    isSelected
                      ? 'border border-[#FF453A]/30 bg-[#FF453A]/12'
                      : `border border-transparent ${_v.bgCardH}`
                  }`}
                >
                  <HugeIcon
                    icon={BlocksIcon}
                    className={`size-3 ${isSelected ? 'text-[#FF453A]' : _v.t25}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate font-mono text-[10px] font-medium ${_v.t85}`}>
                      {meta?.displayName ?? id}
                    </span>
                    <span className={`block truncate font-mono text-[10px] ${_v.t30}`}>{id}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </ScrollArea>

        {/* Controls */}
        <div className={`border-t ${_v.border} p-3 space-y-2`}>
          {/* Count selector */}
          <div>
            <Kicker count={count}>{t.studioFitCount}</Kicker>
            <div className="flex gap-1">
              {[3, 6, 9, 12].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCount(n)}
                  className={`flex h-6 flex-1 items-center justify-center rounded-[2px] border font-mono text-[10px] font-medium transition-colors ${
                    count === n
                      ? 'border-[#FF453A]/40 bg-[#FF453A]/15 text-[#FF453A]'
                      : embedded
                        ? 'border-[var(--border)] bg-[var(--card)] text-muted-foreground opacity-80 hover:border-[var(--border)]'
                        : 'border-white/[0.08] bg-white/[0.02] text-white/40 hover:border-white/[0.15]'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {/* Big generate button */}
          <Button
            onClick={handleGenerate}
            disabled={!profile || loading || generating}
            className="h-9 w-full gap-2 rounded-[2px] border border-[#FF453A]/40 bg-[#FF453A]/10 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-[#FF453A] transition-all hover:bg-[#FF453A]/20 active:scale-[0.98]"
            style={{ letterSpacing: '0.1em' }}
          >
            {generating ? (
              <span className="size-3 animate-spin rounded-full border-2 border-[#FF453A]/30 border-t-[#FF453A]" />
            ) : (
              <HugeIcon icon={RefreshIcon} className="size-3" />
            )}
            {generating ? t.studioFitGenerating : t.studioFitRandom}
          </Button>
        </div>

        {/* Agent stats footer */}
        {profile && (
          <div className={`border-t ${_v.border} px-3 py-2`}>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {[
                {
                  key: 'cssVars',
                  label: t.studioFitCssVars,
                  value: String(
                    (profile.stats as { rootVars?: { default?: number } } | undefined)?.rootVars
                      ?.default ?? '—',
                  ),
                },
                {
                  key: 'domNodes',
                  label: t.studioFitDomNodes,
                  value: String(
                    (profile.stats as { domNodes?: { default?: number } } | undefined)?.domNodes
                      ?.default ?? '—',
                  ),
                },
                {
                  key: 'styleVars',
                  label: t.studioFitStyleVars,
                  value: String(
                    (profile.stats as { styleVars?: { neutral?: number } } | undefined)?.styleVars
                      ?.neutral ?? '—',
                  ),
                },
                {
                  key: 'samples',
                  label: t.studioFitSamples,
                  value: String(
                    (profile.stats as { computedSamples?: { default?: number } } | undefined)
                      ?.computedSamples?.default ?? '—',
                  ),
                },
              ].map(({ key, label, value }) => (
                <div key={key}>
                  <span className={`font-mono text-[10px] uppercase tracking-wider ${_v.t25}`}>
                    {label}
                  </span>
                  <span className={`ml-1 font-mono text-[10px] font-medium ${_v.t60}`}>
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>

      {/* ================================================================
          MAIN AREA — Proposals grid
          ================================================================ */}
      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Empty state */}
        {!loading && !profile && !error && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <HugeIcon icon={SwatchIcon} className={`size-10 ${_v.t10}`} />
            <p className={`font-mono text-[11px] ${_v.t30}`}>{t.studioFitEmptyHint}</p>
          </div>
        )}

        {loading && (
          <div className="flex h-full items-center justify-center">
            <span className={`font-mono text-[10px] ${_v.t30}`}>{t.studioFitLoading}</span>
          </div>
        )}

        {error && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <p className="font-mono text-[10px] text-[#FF453A]">{error}</p>
          </div>
        )}

        {/* Proposals */}
        {proposals.length > 0 && (
          <ScrollArea className="flex-1">
            <div className="space-y-5 p-5">
              {/* Recommended */}
              {recommended.length > 0 && (
                <section>
                  <Kicker count={recommended.length}>
                    {t.studioFitRecommendedTopN(recommended.length)}
                  </Kicker>
                  <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
                    {recommended.map((p, i) => (
                      <ProposalCard
                        key={`${p.harmony}-${p.sourceHue}-${p.palette.background}`}
                        proposal={p}
                        agentId={selectedAgent}
                        rank={i + 1}
                        isRecommended={true}
                        onPreview={handlePreview}
                        onApply={handleApply}
                        onExport={handleExport}
                        t={t}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Remaining */}
              {remaining.length > 0 && (
                <section>
                  <Kicker count={remaining.length}>{t.studioFitMoreOptions}</Kicker>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {remaining.map((p, i) => (
                      <ProposalCard
                        key={`${p.harmony}-${p.sourceHue}-${p.palette.background}`}
                        proposal={p}
                        agentId={selectedAgent}
                        rank={i + 6}
                        isRecommended={false}
                        onPreview={handlePreview}
                        onApply={handleApply}
                        onExport={handleExport}
                        t={t}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Score breakdown */}
              {proposals.length > 0 && (
                <section
                  className={`rounded-[2px] border ${_v.border} ${embedded ? 'bg-transparent' : 'bg-white/[0.015]'} p-3`}
                >
                  <Kicker>{t.studioFitScoringAlgorithm}</Kicker>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      {
                        key: 'contrast',
                        weight: '50%',
                        desc: t.studioFitContrastDesc,
                        score: proposals[0]?.score.contrast ?? 0,
                      },
                      {
                        key: 'harmony',
                        weight: '30%',
                        desc: t.studioFitHarmonyDesc,
                        score: proposals[0]?.score.harmony ?? 0,
                      },
                      {
                        key: 'semantic',
                        weight: '20%',
                        desc: t.studioFitSemanticDesc,
                        score: proposals[0]?.score.semantic ?? 0,
                      },
                    ].map((s) => (
                      <div key={s.key} className="text-center">
                        <span
                          className={`font-mono text-[10px] uppercase tracking-wider ${_v.t25}`}
                        >
                          {s.key === 'contrast'
                            ? t.studioFitContrast
                            : s.key === 'harmony'
                              ? t.studioFitHarmony
                              : t.studioFitSemantic}
                        </span>
                        <div className={`mt-0.5 font-mono text-[13px] font-bold ${_v.t80}`}>
                          {Math.round(
                            s.key === 'contrast'
                              ? s.score * 0.5
                              : s.key === 'harmony'
                                ? s.score * 0.3
                                : s.score * 0.2,
                          )}
                          <span className={`text-[10px] ${_v.t30}`}>/{s.weight}</span>
                        </div>
                        <span className={`font-mono text-[10px] ${_v.t20}`}>{s.desc}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </ScrollArea>
        )}

        {/* Has profile but no proposals yet */}
        {profile && proposals.length === 0 && !loading && !error && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <HugeIcon icon={SwatchIcon} className={`size-10 ${_v.t10}`} />
            <p className={`font-mono text-[11px] ${_v.t40}`}>{t.studioFitClickToGenerate(count)}</p>
            <p className={`max-w-xs font-mono text-[10px] ${_v.t20}`}>
              {t.studioFitExtractionDesc}
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
