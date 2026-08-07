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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { HugeIcon } from '@/components/ui/huge-icon';
import { ScrollArea } from '@/components/ui/scroll-area';
import { contrastRatio, generatePalettes } from '@/utils/color-theory';

import {
  BlocksIcon,
  ContrastIcon,
  RefreshIcon,
  StarIcon,
  SwatchIcon,
} from '@hugeicons/core-free-icons';
import { AGENT_IDS, AGENT_META, type AgentId } from '@shared/types';

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

const HARMONY_LABELS: Record<string, string> = {
  complementary: '互补',
  splitComplementary: '分裂互补',
  triadic: '三元',
  analogous: '类似',
  tetradic: '四边',
  monochromatic: '单色',
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

function textOn(hex: string): string {
  if (!hex) return '#ffffff';
  const m = hex.replace('#', '');
  if (m.length < 6) return '#ffffff';
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  if ([r, g, b].some((n) => Number.isNaN(n))) return '#ffffff';
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.5 ? '#000000' : '#ffffff';
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ScoreBadge({ score }: { score: Proposal['score'] }) {
  const { label, cls, dot } = scoreColor(score.total);
  return (
    <div className="flex items-center gap-1.5">
      <span className={`size-[6px] rounded-full ${dot}`} />
      <span className={`font-mono text-[9px] font-bold ${cls}`}>{label}</span>
      <span className="font-mono text-[8px] text-white/30">{score.total}</span>
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
            className="mb-0.5 hidden font-mono text-[7px] font-bold group-hover:block"
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
}: {
  proposal: Proposal;
  agentId: AgentId;
  rank: number;
  isRecommended: boolean;
  onPreview: (agentId: string, palette: Record<string, string>) => void;
  onExport: (agentId: string, palette: Record<string, string>) => void;
}) {
  const harmonyLabel = HARMONY_LABELS[proposal.harmony] || proposal.harmony;
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
          <span className="font-mono text-[9px] font-bold text-white/20">
            #{rank.toString().padStart(2, '0')}
          </span>
          {isRecommended && <HugeIcon icon={StarIcon} className="size-3 text-[#FFD240]" />}
          <Badge className="h-[14px] rounded-[2px] border border-white/[0.08] bg-transparent px-1 font-mono text-[8px] font-medium text-white/40">
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
          <Badge className="h-[14px] rounded-[2px] bg-[#FF453A]/10 border border-[#FF453A]/25 px-1.5 font-mono text-[8px] font-medium text-[#FF453A]">
            {meta?.displayName || agentId}
          </Badge>
          <span className="font-mono text-[8px] text-white/25">
            <span className="text-white/40">C:</span>
            {fgBgContrast}:1
          </span>
          <span className="font-mono text-[8px] text-white/25">
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
            className="h-5 gap-1 rounded-[2px] px-1.5 font-mono text-[8px] font-medium uppercase text-white/50 hover:bg-white/[0.06] hover:text-white/80"
          >
            <HugeIcon icon={ContrastIcon} className="size-2.5" />
            预览
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onExport(agentId, proposal.palette)}
            className="h-5 gap-1 rounded-[2px] px-1.5 font-mono text-[8px] font-medium uppercase text-white/50 hover:bg-white/[0.06] hover:text-white/80"
          >
            <HugeIcon icon={SwatchIcon} className="size-2.5" />
            导出
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section header (kicker)
// ---------------------------------------------------------------------------

function Kicker({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <div className="mb-2 flex items-center gap-1.5 font-mono text-[9.5px] font-semibold uppercase">
      <span className="size-[3px] rounded-full bg-[#FF453A]" />
      <span style={{ letterSpacing: '0.14em', color: 'var(--muted-foreground)', opacity: 0.75 }}>
        {children}
      </span>
      {count !== undefined && (
        <Badge className="ml-1 h-[12px] rounded-[2px] border border-white/[0.08] bg-transparent px-1 font-mono text-[7px] text-white/30">
          {count}
        </Badge>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface FitGeneratorPanelProps {
  onClose?: () => void;
  onPreviewPalette?: (agentId: string, palette: Record<string, string>) => void;
}

export function FitGeneratorPanel({ onClose, onPreviewPalette }: FitGeneratorPanelProps) {
  const [selectedAgent, setSelectedAgent] = useState<AgentId>(FIT_AGENT_IDS[0] ?? 'codex');
  const [profile, setProfile] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [count, setCount] = useState(6);
  const [scheme] = useState<'dark' | 'light'>('dark');
  const [generating, setGenerating] = useState(false);

  // --- Load profile when agent changes ---
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
        if (!cancelled) setError(e instanceof Error ? e.message : '加载 Profile 失败');
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
  const cancelGenRef = useRef(false);
  const genTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup timer on unmount or before new generation
  useEffect(() => {
    return () => {
      cancelGenRef.current = true;
      if (genTimerRef.current) clearTimeout(genTimerRef.current);
    };
  }, []);

  const handleGenerate = useCallback(() => {
    if (!profile) return;
    // Cancel any previous pending generation
    cancelGenRef.current = true;
    if (genTimerRef.current) clearTimeout(genTimerRef.current);
    // Start fresh
    cancelGenRef.current = false;
    setGenerating(true);
    // Use setTimeout to allow UI to update before heavy computation
    genTimerRef.current = setTimeout(() => {
      if (cancelGenRef.current) return;
      try {
        const result = generatePalettes(profile as Parameters<typeof generatePalettes>[0], {
          count,
          scheme,
          seed: Math.floor(Math.random() * 2 ** 31),
        });
        if (!cancelGenRef.current) setProposals(result);
      } catch (e) {
        if (!cancelGenRef.current) setError(e instanceof Error ? e.message : '生成失败');
      } finally {
        if (!cancelGenRef.current) setGenerating(false);
      }
    }, 30);
  }, [profile, count, scheme]);

  // --- Export handler ---
  const handleExport = useCallback((agentId: string, palette: Record<string, string>) => {
    const payload = {
      agentId,
      palette,
      generatedAt: new Date().toISOString(),
      generator: 'fit-harmony-v1',
    };
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2)).catch(() => {
      /* best-effort */
    });
  }, []);

  // --- Preview handler ---
  const handlePreview = useCallback(
    (agentId: string, palette: Record<string, string>) => {
      onPreviewPalette?.(agentId, palette);
    },
    [onPreviewPalette],
  );

  // --- Recommended: top 5 ---
  const recommended = useMemo(() => proposals.slice(0, 5), [proposals]);
  const remaining = useMemo(() => proposals.slice(5), [proposals]);

  return (
    <div className="flex h-full w-full bg-[#141418] text-white">
      {/* ================================================================
          LEFT COLUMN — Controls (250px)
          ================================================================ */}
      <aside className="flex w-[250px] shrink-0 flex-col border-r border-white/[0.06]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/[0.06] px-4 py-3">
          <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-white/90">
            主题搭配
          </span>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="font-mono text-[10px] text-white/40 transition-colors hover:text-white"
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
                      : 'border border-transparent hover:bg-white/[0.04]'
                  }`}
                >
                  <HugeIcon
                    icon={BlocksIcon}
                    className={`size-3 ${isSelected ? 'text-[#FF453A]' : 'text-white/25'}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[10px] font-medium text-white/85">
                      {meta?.displayName ?? id}
                    </span>
                    <span className="block truncate font-mono text-[8px] text-white/30">{id}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </ScrollArea>

        {/* Controls */}
        <div className="border-t border-white/[0.06] p-3 space-y-2">
          {/* Count selector */}
          <div>
            <Kicker count={count}>方案数量</Kicker>
            <div className="flex gap-1">
              {[3, 6, 9, 12].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCount(n)}
                  className={`flex h-6 flex-1 items-center justify-center rounded-[2px] border font-mono text-[9px] font-medium transition-colors ${
                    count === n
                      ? 'border-[#FF453A]/40 bg-[#FF453A]/15 text-[#FF453A]'
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
            {generating ? '生成中…' : '随机搭配'}
          </Button>
        </div>

        {/* Agent stats footer */}
        {profile && (
          <div className="border-t border-white/[0.06] px-3 py-2">
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {[
                [
                  'CSS',
                  String(
                    (profile.tokens as Record<string, unknown>)?.light
                      ? ((
                          (profile.tokens as Record<string, unknown>).light as Record<
                            string,
                            unknown
                          >
                        )?.varCount ?? '—')
                      : '—',
                  ),
                ],
                [
                  '节点',
                  String(
                    (profile.stats as Record<string, unknown>)?.domNodes
                      ? ((
                          (profile.stats as Record<string, unknown>).domNodes as Record<
                            string,
                            unknown
                          >
                        )?.default ?? '—')
                      : '—',
                  ),
                ],
              ].map(([label, val]) => (
                <div key={label}>
                  <span className="font-mono text-[7.5px] uppercase tracking-wider text-white/25">
                    {label}
                  </span>
                  <span className="ml-1 font-mono text-[9px] font-medium text-white/60">{val}</span>
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
            <HugeIcon icon={SwatchIcon} className="size-10 text-white/10" />
            <p className="font-mono text-[11px] text-white/30">左侧选择一个 Agent 生成搭配方案</p>
          </div>
        )}

        {loading && (
          <div className="flex h-full items-center justify-center">
            <span className="font-mono text-[10px] text-white/30">加载 Profile 中…</span>
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
                  <Kicker count={recommended.length}>推荐方案 · TOP {recommended.length}</Kicker>
                  <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
                    {recommended.map((p, i) => (
                      <ProposalCard
                        key={`${p.harmony}-${p.sourceHue}-${p.palette.background}`}
                        proposal={p}
                        agentId={selectedAgent}
                        rank={i + 1}
                        isRecommended={true}
                        onPreview={handlePreview}
                        onExport={handleExport}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Remaining */}
              {remaining.length > 0 && (
                <section>
                  <Kicker count={remaining.length}>更多方案</Kicker>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {remaining.map((p, i) => (
                      <ProposalCard
                        key={`${p.harmony}-${p.sourceHue}-${p.palette.background}`}
                        proposal={p}
                        agentId={selectedAgent}
                        rank={i + 6}
                        isRecommended={false}
                        onPreview={handlePreview}
                        onExport={handleExport}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Score breakdown */}
              {proposals.length > 0 && (
                <section className="rounded-[2px] border border-white/[0.06] bg-white/[0.015] p-3">
                  <Kicker>评分算法</Kicker>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      {
                        name: '对比度',
                        weight: '50%',
                        desc: '前景/背景 WCAG ≥ 4.5',
                        score: proposals[0]?.score.contrast ?? 0,
                      },
                      {
                        name: '和谐度',
                        weight: '30%',
                        desc: 'HSL 配色理论一致性',
                        score: proposals[0]?.score.harmony ?? 0,
                      },
                      {
                        name: '语义',
                        weight: '20%',
                        desc: 'error=red / success=green / info=blue',
                        score: proposals[0]?.score.semantic ?? 0,
                      },
                    ].map((s) => (
                      <div key={s.name} className="text-center">
                        <span className="font-mono text-[8px] uppercase tracking-wider text-white/25">
                          {s.name}
                        </span>
                        <div className="mt-0.5 font-mono text-[13px] font-bold text-white/80">
                          {Math.round(
                            s.name === '对比度'
                              ? s.score * 0.5
                              : s.name === '和谐度'
                                ? s.score * 0.3
                                : s.score * 0.2,
                          )}
                          <span className="text-[9px] text-white/30">/{s.weight}</span>
                        </div>
                        <span className="font-mono text-[7.5px] text-white/20">{s.desc}</span>
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
            <HugeIcon icon={SwatchIcon} className="size-10 text-white/10" />
            <p className="font-mono text-[11px] text-white/40">
              点击左侧「随机搭配」生成 {count} 套方案
            </p>
            <p className="max-w-xs font-mono text-[9px] text-white/20">
              从 {AGENT_META[selectedAgent]?.displayName} 的 CDP 爬取数据中 提取配色
              hue，基于互补、分裂互补、三元、类似、单色等 HSL 配色理论生成协调主题
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
