// SPDX-License-Identifier: MPL-2.0

/**
 * # InspectStudioTab
 *
 * Full-tab version of the inspect functionality for the AgentSkin Theme Studio
 * INSPECT tab. Replaces the old button-toggle pattern with a two-mode tab
 * layout:
 *
 *   - PICK:    live CDP element picker with cascade display
 *   - PROFILE: agent cards showing core identity as mini swatches
 *
 * Live-inspect state (mode + picked node + errors) lives in the shared
 * {@link useStudioStore} — the page-level subscription routes `onInspectResult`
 * into the store, so this tab and the right inspector see the same node.
 * Pinned selectors are always visible at the bottom as a chip row so the user
 * can review what feeds the next snapshot.
 */

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/api/agentSkinClient';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { HugeIcon } from '@/components/ui/huge-icon';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useNotificationStore } from '@/stores/notificationStore';
import { useStudioStore } from '@/stores/studioStore';

import { Copy01Icon, EyeIcon, Search01Icon } from '@hugeicons/core-free-icons';
import { toMessage } from '@shared/errors';
import { AGENT_META, type AgentId, type VisualAnalysisSummary } from '@shared/types';
import { CascadeView } from './CascadeView';
import { Kicker } from './kicker';

type Mode = 'pick' | 'profile';

// ---------------------------------------------------------------------------
// Agent Profile Card — real crawled visual-analysis data
// ---------------------------------------------------------------------------

/** Pull normalized hex swatches from a tokenTree category/scheme (best-effort). */
function samplesFromTokenTree(
  tokenTree: Record<string, unknown> | undefined,
  category: string,
  scheme: 'dark' | 'light' | 'neutral',
  max = 8,
): string[] {
  const bucket = (tokenTree?.[category] as Record<string, unknown> | undefined)?.[scheme];
  if (!Array.isArray(bucket)) return [];
  const out: string[] = [];
  for (const entry of bucket) {
    const norm = (entry as { normalized?: string })?.normalized;
    if (norm && /^[0-9a-fA-F]{6}$/.test(norm)) out.push(`#${norm}`);
    if (out.length >= max) break;
  }
  return out;
}

function StatCell({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <span
        className="font-mono text-[7.5px] uppercase tracking-wider"
        style={{ color: 'var(--muted-foreground)', opacity: 0.75 }}
      >
        {label}
      </span>
      <span
        className="ml-1 font-mono text-[9px] font-medium"
        style={{ color: 'var(--foreground)', opacity: 0.85 }}
      >
        {value}
      </span>
    </div>
  );
}

function AgentProfileCard({
  summary,
  expanded,
  onToggle,
  profile,
  profileLoading,
}: {
  summary: VisualAnalysisSummary;
  expanded: boolean;
  onToggle: () => void;
  profile: Record<string, unknown> | null;
  profileLoading: boolean;
}) {
  const meta = AGENT_META[summary.id];
  const brand = summary.brandDark || summary.brandLight;
  const tokenTree = (profile?.tokenTree as Record<string, unknown> | undefined) ?? undefined;
  const accentSwatches =
    expanded && tokenTree ? samplesFromTokenTree(tokenTree, 'accent', 'dark', 8) : [];
  const semanticSwatches =
    expanded && tokenTree ? samplesFromTokenTree(tokenTree, 'semantic', 'dark', 6) : [];
  const bgSwatches =
    expanded && tokenTree ? samplesFromTokenTree(tokenTree, 'backgrounds', 'dark', 4) : [];

  return (
    <div className="border border-border bg-card" style={{ borderRadius: 'var(--radius)' }}>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-2.5 py-2 text-left"
      >
        <div className="flex items-center gap-2">
          <span
            className="size-5 shrink-0 border border-border"
            style={{ background: brand || 'var(--muted)', borderRadius: '1px' }}
            title={brand ?? 'unknown brand'}
          />
          <span
            className="font-mono text-[9.5px] font-semibold uppercase"
            style={{ letterSpacing: '0.1em', color: 'var(--foreground)' }}
          >
            {meta?.displayName ?? summary.id}
          </span>
          <Badge variant="outline" className="h-4 px-1 text-[7.5px] tracking-wider">
            {meta?.region}
          </Badge>
        </div>
        <span className="font-mono text-[8px] text-muted-foreground">{expanded ? '−' : '+'}</span>
      </button>

      {/* Stats row (always visible — real crawled numbers) */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-border px-2.5 py-1.5">
        <StatCell label="tokens" value={`${summary.tokensLight}/${summary.tokensDark}`} />
        <StatCell label="css变量" value={summary.stats.rootVars.default} />
        <StatCell label="dom节点" value={summary.stats.domNodes.default} />
        <StatCell label="样式变量" value={summary.stats.styleVars.neutral} />
        <StatCell label="采样" value={summary.stats.computedSamples.default} />
        <StatCell label="分类" value={summary.categories.length} />
      </div>

      {/* Category chips (real token categories from the crawl) */}
      {summary.categories.length > 0 && (
        <div className="flex flex-wrap gap-1 border-t border-border px-2.5 py-1.5">
          {summary.categories.slice(0, 8).map((c) => (
            <span
              key={c}
              className="border border-border bg-muted px-1 py-0.5 font-mono text-[7px] uppercase"
              style={{ color: 'var(--muted-foreground)' }}
            >
              {c}
            </span>
          ))}
          {summary.categories.length > 8 && (
            <span
              className="px-1 py-0.5 font-mono text-[7px]"
              style={{ color: 'var(--muted-foreground)' }}
            >
              +{summary.categories.length - 8}
            </span>
          )}
        </div>
      )}

      {/* Expanded: real color samples from the crawled profile */}
      {expanded && (
        <div className="space-y-2 border-t border-border px-2.5 py-2">
          {profileLoading && (
            <p className="font-mono text-[8px]" style={{ color: 'var(--muted-foreground)' }}>
              加载完整 profile…
            </p>
          )}
          {!profileLoading && !profile && (
            <p className="font-mono text-[8px]" style={{ color: 'var(--muted-foreground)' }}>
              无法加载 profile
            </p>
          )}
          {!profileLoading && profile && (
            <>
              {accentSwatches.length > 0 && (
                <div>
                  <Kicker>ACCENT</Kicker>
                  <div className="flex flex-wrap gap-1">
                    {accentSwatches.map((c) => (
                      <span
                        key={`a-${c}`}
                        className="size-4 border border-border"
                        style={{ background: c, borderRadius: '1px' }}
                        title={c}
                      />
                    ))}
                  </div>
                </div>
              )}
              {semanticSwatches.length > 0 && (
                <div>
                  <Kicker>SEMANTIC</Kicker>
                  <div className="flex flex-wrap gap-1">
                    {semanticSwatches.map((c) => (
                      <span
                        key={`s-${c}`}
                        className="size-4 border border-border"
                        style={{ background: c, borderRadius: '1px' }}
                        title={c}
                      />
                    ))}
                  </div>
                </div>
              )}
              {bgSwatches.length > 0 && (
                <div>
                  <Kicker>BACKGROUND</Kicker>
                  <div className="flex flex-wrap gap-1">
                    {bgSwatches.map((c) => (
                      <span
                        key={`b-${c}`}
                        className="size-4 border border-border"
                        style={{ background: c, borderRadius: '1px' }}
                        title={c}
                      />
                    ))}
                  </div>
                </div>
              )}
              {accentSwatches.length === 0 &&
                semanticSwatches.length === 0 &&
                bgSwatches.length === 0 && (
                  <p className="font-mono text-[8px]" style={{ color: 'var(--muted-foreground)' }}>
                    该 profile 未提供可展示的色彩样本
                  </p>
                )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// InspectStudioTab — main export
// ---------------------------------------------------------------------------

export function InspectStudioTab() {
  const [mode, setMode] = useState<Mode>('pick');
  const activeProject = useStudioStore((s) => s.getActiveProject());
  const activeAgent = activeProject?.agentId ?? null;
  const inspectMode = useStudioStore((s) => s.inspectMode);
  const liveNode = useStudioStore((s) => s.liveNode);
  const liveError = useStudioStore((s) => s.liveError);
  const pinnedSelectors = useStudioStore((s) => s.pinnedSelectors);
  const pinSelector = useStudioStore((s) => s.pinSelector);
  const toggleInspect = useStudioStore((s) => s.toggleInspect);
  const showToast = useNotificationStore((s) => s.showToast);

  // --- Visual Analyzer summaries (real crawled data) ---
  const [summaries, setSummaries] = useState<VisualAnalysisSummary[]>([]);
  const [summariesLoading, setSummariesLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<AgentId | null>(null);
  const [expandedProfile, setExpandedProfile] = useState<Record<string, unknown> | null>(null);
  const [expandedLoading, setExpandedLoading] = useState(false);

  useEffect(() => {
    if (mode !== 'profile') return;
    let cancelled = false;
    async function load() {
      setSummariesLoading(true);
      try {
        const data = await api.listVisualAnalysisSummaries();
        if (!cancelled) setSummaries(data);
      } catch (e) {
        if (!cancelled) showToast(`加载视觉分析数据失败：${toMessage(e)}`, 'destructive');
      } finally {
        if (!cancelled) setSummariesLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [mode, showToast]);

  const toggleExpand = useCallback(
    async (id: AgentId) => {
      if (expandedId === id) {
        setExpandedId(null);
        setExpandedProfile(null);
        return;
      }
      setExpandedId(id);
      setExpandedProfile(null);
      setExpandedLoading(true);
      try {
        const prof = await api.getVisualAnalysisTarget(id);
        setExpandedProfile(prof);
      } catch {
        setExpandedProfile(null);
      } finally {
        setExpandedLoading(false);
      }
    },
    [expandedId],
  );

  const togglePick = useCallback(() => {
    void toggleInspect();
  }, [toggleInspect]);

  const copyPath = useCallback(
    (path: string) => {
      if (!navigator.clipboard) {
        showToast('当前环境不支持剪贴板', 'destructive');
        return;
      }
      navigator.clipboard.writeText(path).then(
        () => showToast('已复制选择器'),
        () => showToast('复制失败', 'destructive'),
      );
    },
    [showToast],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Mode toggle bar */}
      <div className="flex items-center gap-2 border-b border-border px-3 pt-2 pb-1.5">
        <span
          className="shrink-0 font-mono text-[9.5px] font-semibold uppercase"
          style={{ letterSpacing: '0.14em', color: 'var(--muted-foreground)', opacity: 0.75 }}
        >
          MODE
        </span>
        <div className="inline-flex gap-[3px] rounded-[2px] bg-muted p-[2px]">
          <button
            type="button"
            onClick={() => setMode('pick')}
            className="h-5 px-2.5 font-mono text-[9px] font-semibold uppercase"
            style={{
              letterSpacing: '0.1em',
              borderRadius: '1px',
              color: mode === 'pick' ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
              background: mode === 'pick' ? 'var(--primary)' : 'transparent',
            }}
          >
            PICK
          </button>
          <button
            type="button"
            onClick={() => setMode('profile')}
            className="h-5 px-2.5 font-mono text-[9px] font-semibold uppercase"
            style={{
              letterSpacing: '0.1em',
              borderRadius: '1px',
              color: mode === 'profile' ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
              background: mode === 'profile' ? 'var(--primary)' : 'transparent',
            }}
          >
            PROFILE
          </button>
        </div>
      </div>

      {/* Scrollable body */}
      <ScrollArea className="flex-1">
        <div className="space-y-2 p-3">
          {/* ---- PICK mode ---- */}
          {mode === 'pick' && (
            <>
              {/* Start / Stop control */}
              <div
                className="border border-border bg-card p-3"
                style={{ borderRadius: 'var(--radius)' }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <HugeIcon icon={EyeIcon} className="size-3.5 text-primary" />
                    <span
                      className="font-mono text-[10px] font-semibold uppercase"
                      style={{ letterSpacing: '0.1em', color: 'var(--foreground)' }}
                    >
                      元素拾取器
                    </span>
                  </div>
                  <div
                    className="flex items-center gap-1.5"
                    title={activeAgent ? undefined : '选择 Agent 以启用'}
                  >
                    <span
                      className={`size-[5px] rounded-full ${inspectMode ? 'animate-pulse' : ''}`}
                      style={{
                        background: inspectMode ? 'var(--primary)' : 'var(--muted-foreground)',
                        opacity: 0.6,
                      }}
                    />
                    <span
                      className="font-mono text-[8px] uppercase"
                      style={{ color: 'var(--muted-foreground)' }}
                    >
                      {inspectMode ? 'ACTIVE' : 'IDLE'}
                    </span>
                  </div>
                </div>
                <Button
                  size="lg"
                  variant={inspectMode ? 'destructive' : 'primary'}
                  disabled={!inspectMode && !activeAgent}
                  onClick={togglePick}
                  className="mt-2"
                >
                  {inspectMode ? (
                    <>停止拾取</>
                  ) : (
                    <>
                      <HugeIcon icon={Search01Icon} className="-ml-0.5 size-3.5" />
                      开启拾取
                    </>
                  )}
                </Button>
              </div>

              {/* Live node cascade */}
              {liveError && (
                <p
                  className="border border-destructive/30 bg-destructive/10 px-2 py-1 font-mono text-[9px] text-destructive"
                  style={{ borderRadius: 'var(--radius)' }}
                >
                  {liveError}
                </p>
              )}

              {liveNode && (
                <>
                  <Kicker>NODE</Kicker>
                  <div className="space-y-1">
                    <div className="flex items-center gap-1">
                      <span
                        className="bg-muted px-1 py-0.5 font-mono text-[8px]"
                        style={{
                          color: 'var(--foreground)',
                          borderRadius: 'var(--radius)',
                        }}
                      >
                        {liveNode.path}
                      </span>
                      <span
                        className="bg-muted px-1 py-0.5 font-mono text-[8px]"
                        style={{
                          color: 'var(--muted-foreground)',
                          borderRadius: 'var(--radius)',
                        }}
                      >
                        {liveNode.tag}
                      </span>
                      <button
                        type="button"
                        onClick={() => copyPath(liveNode.path)}
                        className="ml-auto flex items-center gap-0.5 border border-border bg-muted px-1 py-0.5 font-mono text-[8px] uppercase"
                        style={{
                          letterSpacing: '0.06em',
                          borderRadius: 'var(--radius)',
                          color: 'var(--muted-foreground)',
                        }}
                        title="复制选择器"
                      >
                        <HugeIcon icon={Copy01Icon} className="size-2.5" />
                        COPY
                      </button>
                    </div>
                    {pinnedSelectors.includes(liveNode.path) ? (
                      <Badge variant="red" className="text-[7.5px]">
                        已 PIN
                      </Badge>
                    ) : (
                      <button
                        type="button"
                        onClick={() => pinSelector(liveNode.path)}
                        className="flex items-center gap-1 border border-border bg-muted px-2 py-1 font-mono text-[9.5px] uppercase"
                        style={{
                          letterSpacing: '0.06em',
                          borderRadius: 'var(--radius)',
                          color: 'var(--muted-foreground)',
                        }}
                      >
                        + PIN TO SNAPSHOT
                      </button>
                    )}
                  </div>

                  <CascadeView cascade={liveNode.cascade} />
                </>
              )}

              {!liveNode && !liveError && (
                <p
                  className="font-mono text-[9px]"
                  style={{ color: 'var(--dim, var(--muted-foreground))' }}
                >
                  {inspectMode
                    ? '已为真实 Agent 开启放大镜，点击任意元素即可抓取它的完整级联。'
                    : '点击上方按钮开启检查模式。扫描完成后将列出完整的 CSS 级联。'}
                </p>
              )}
            </>
          )}

          {/* ---- PROFILE mode (real crawled visual-analysis data) ---- */}
          {mode === 'profile' && (
            <>
              <Kicker count={summaries.length}>AGENT PROFILES · 真实爬取</Kicker>
              {summariesLoading && (
                <p className="font-mono text-[9px]" style={{ color: 'var(--muted-foreground)' }}>
                  加载视觉分析摘要…
                </p>
              )}
              {!summariesLoading && summaries.length === 0 && (
                <p className="font-mono text-[9px]" style={{ color: 'var(--muted-foreground)' }}>
                  未找到任何 agent 视觉 profile
                </p>
              )}
              <div className="space-y-1.5">
                {summaries.map((s) => (
                  <AgentProfileCard
                    key={s.id}
                    summary={s}
                    expanded={expandedId === s.id}
                    onToggle={() => void toggleExpand(s.id)}
                    profile={expandedId === s.id ? expandedProfile : null}
                    profileLoading={expandedId === s.id ? expandedLoading : false}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </ScrollArea>

      {/* Pinned selector chips — always visible */}
      {pinnedSelectors.length > 0 && (
        <div className="border-t border-border px-3 py-2">
          <Kicker count={pinnedSelectors.length}>PINNED</Kicker>
          <div className="mt-1 flex flex-wrap gap-1">
            {pinnedSelectors.map((sel) => (
              <span
                key={sel}
                className="border border-border bg-muted px-1.5 py-0.5 font-mono text-[8.5px]"
                style={{
                  color: 'var(--foreground)',
                  borderRadius: 'var(--radius)',
                  maxWidth: '100%',
                }}
              >
                {sel}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
