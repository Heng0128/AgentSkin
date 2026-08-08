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
 * Pinned selectors are always visible at the bottom as a chip row so the user
 * can review what feeds the next snapshot.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/api/agentSkinClient';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { HugeIcon } from '@/components/ui/huge-icon';
import { ScrollArea } from '@/components/ui/scroll-area';
import { appStatusFor } from '@/stores/agentStore';

import { Copy01Icon, EyeIcon, Search01Icon } from '@hugeicons/core-free-icons';
import {
  AGENT_IDS,
  AGENT_META,
  type AgentId,
  type CssMatchedRule,
  type InspectedNode,
} from '@shared/types';
import { Kicker } from './kicker';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface InspectStudioTabProps {
  activeAgent: AgentId | null;
  pinnedSelectors: string[];
  onPinSelector: (sel: string) => void;
  onToast: (msg: string, variant?: 'default' | 'destructive') => void;
}

type Mode = 'pick' | 'profile';

// ---------------------------------------------------------------------------
// CascadeView — inline (simplified from ThemeStudioPage)
// ---------------------------------------------------------------------------

function CascadeView({ cascade }: { cascade: InspectedNode['cascade'] }) {
  const boxModel = cascade.boxModel;
  return (
    <div className="space-y-1.5">
      {/* Render fonts */}
      {cascade.platformFonts.length > 0 && (
        <div
          className="border border-border bg-card p-1.5"
          style={{ borderRadius: 'var(--radius)' }}
        >
          <Kicker>RENDER FONTS</Kicker>
          <div className="mt-1 flex flex-wrap gap-1">
            {cascade.platformFonts.map((f) => (
              <span
                key={f}
                className="bg-muted px-1 py-0.5 font-mono text-[8px]"
                style={{ color: 'var(--foreground)', borderRadius: 'var(--radius)' }}
              >
                {f}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Box model badge */}
      {boxModel && (boxModel.width !== undefined || boxModel.height !== undefined) && (
        <div className="flex items-center gap-1">
          <span
            className="bg-muted px-1 py-0.5 font-mono text-[8px]"
            style={{ color: 'var(--muted-foreground)', borderRadius: 'var(--radius)' }}
          >
            {boxModel.width ?? '?'} × {boxModel.height ?? '?'}
          </span>
          {boxModel.left !== undefined && boxModel.top !== undefined && (
            <span
              className="bg-muted px-1 py-0.5 font-mono text-[8px]"
              style={{ color: 'var(--muted-foreground)', borderRadius: 'var(--radius)' }}
            >
              @ {boxModel.left}, {boxModel.top}
            </span>
          )}
        </div>
      )}

      {/* Matched CSS rules */}
      <div className="border border-border bg-card p-1.5" style={{ borderRadius: 'var(--radius)' }}>
        <Kicker>CASCADE</Kicker>
        {cascade.matchedRules.length === 0 ? (
          <p className="font-mono text-[9px]" style={{ color: 'var(--muted-foreground)' }}>
            无（CDP CSS 域不可用）
          </p>
        ) : (
          <div className="mt-1 space-y-1">
            {cascade.matchedRules.slice(0, 8).map((rule, idx) => {
              const declKey = rule.declarations[0]
                ? `${rule.declarations[0].name}:${rule.declarations[0].value}`
                : 'empty';
              const stableKey = `${rule.origin}::${rule.selector ?? ''}::${declKey}::${idx}`;
              return <CSSRuleRow key={stableKey} rule={rule} />;
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function CSSRuleRow({ rule }: { rule: CssMatchedRule }) {
  return (
    <div className="border border-border bg-muted p-1" style={{ borderRadius: 'var(--radius)' }}>
      <div className="flex items-center gap-1">
        <span
          className="px-1 py-0.5 font-mono text-[8px]"
          style={{
            borderRadius: 'var(--radius)',
            color: 'var(--primary)',
            background: 'var(--accent)',
          }}
        >
          {rule.origin}
        </span>
        <span
          className="truncate font-mono text-[8.5px]"
          style={{ color: 'var(--foreground)' }}
          title={rule.selector ?? ''}
        >
          {rule.selector ?? '(inline style)'}
        </span>
      </div>
      {rule.declarations.length > 0 && (
        <div className="mt-1 space-y-px">
          {rule.declarations.slice(0, 12).map((d) => (
            <div
              key={`${d.name}:${d.value}${d.important ? '!important' : ''}`}
              className="flex items-baseline gap-1 px-0.5 font-mono text-[8.5px]"
            >
              <span
                className="w-[100px] shrink-0 truncate"
                style={{ color: 'var(--muted-foreground)', opacity: 0.7 }}
              >
                {d.name}
              </span>
              <span className="truncate" style={{ color: 'var(--foreground)' }}>
                {d.value}
                {d.important ? ' !important' : ''}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent Profile Card
// ---------------------------------------------------------------------------

/** Derive a few representative swatches from AGENT_META identity.
 *  In a real implementation these would come from a theme engine, but for
 *  the profile browser we use stable stand-in colors per-agent derived
 *  from a hash of the agent id so the swatches are consistent across renders. */
function swatchesForAgent(agentId: AgentId): string[] {
  // Simple deterministic hash → hue
  let hash = 0;
  for (let i = 0; i < agentId.length; i++) hash = agentId.charCodeAt(i) + ((hash << 5) - hash);
  const h1 = Math.abs(hash % 360);
  const h2 = (h1 + 30) % 360;
  const h3 = (h1 + 330) % 360;
  return [`hsl(${h1}, 70%, 55%)`, `hsl(${h2}, 60%, 45%)`, `hsl(${h3}, 65%, 50%)`];
}

function AgentProfileCard({ agentId }: { agentId: AgentId }) {
  const meta = AGENT_META[agentId];
  const swatches = swatchesForAgent(agentId);
  return (
    <div className="border border-border bg-card p-2" style={{ borderRadius: 'var(--radius)' }}>
      <div className="flex items-center justify-between">
        <span
          className="font-mono text-[9.5px] font-semibold uppercase"
          style={{ letterSpacing: '0.1em', color: 'var(--foreground)' }}
        >
          {meta.displayName}
        </span>
        <Badge variant="outline" className="h-4 px-1 text-[7.5px] tracking-wider">
          {meta.region}
        </Badge>
      </div>
      <div className="mt-1.5 flex items-center gap-1">
        {swatches.map((c) => (
          <div
            key={c}
            className="size-5"
            style={{
              background: c,
              borderRadius: '1px',
              border: '1px solid var(--border)',
            }}
          />
        ))}
        <span className="ml-1 font-mono text-[7.5px]" style={{ color: 'var(--muted-foreground)' }}>
          {meta.officialName}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// InspectStudioTab — main export
// ---------------------------------------------------------------------------

export function InspectStudioTab({
  activeAgent,
  pinnedSelectors,
  onPinSelector,
  onToast,
}: InspectStudioTabProps) {
  const [mode, setMode] = useState<Mode>('pick');
  const [inspecting, setInspecting] = useState(false);
  const [inspectBusy, setInspectBusy] = useState(false);
  const [liveNode, setLiveNode] = useState<InspectedNode | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  // Track mounted state to avoid state updates after unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Subscribe to picked-node results (only meaningful in 'pick' mode,
  // but the subscription is harmless in 'profile' mode and avoids stale
  // closures when the user switches back).
  useEffect(() => {
    const off = api.onInspectResult((node) => {
      if (!mountedRef.current) return;
      if (!node) return;
      if ('error' in node) {
        setLiveError(node.error);
        setLiveNode(null);
        return;
      }
      setLiveError(null);
      setLiveNode(node);
    });
    return off;
  }, []);

  // Cleanup inspect session on unmount.
  useEffect(() => {
    return () => {
      if (inspecting) {
        api.stopInspect().catch(() => {});
      }
    };
  }, [inspecting]);

  const togglePick = useCallback(async () => {
    if (inspectBusy) return;
    setInspectBusy(true);
    try {
      if (inspecting) {
        await api.stopInspect().catch(() => {});
        if (mountedRef.current) setInspecting(false);
        return;
      }
      if (!activeAgent) {
        onToast('请先选择一个 Agent', 'destructive');
        return;
      }
      await api.startInspect(activeAgent);
      if (!mountedRef.current) return;
      setInspecting(true);
      setLiveNode(null);
      setLiveError(null);
      setMode('pick');
    } catch (e) {
      if (mountedRef.current)
        onToast(`进入检查模式失败：${e instanceof Error ? e.message : String(e)}`, 'destructive');
    } finally {
      if (mountedRef.current) setInspectBusy(false);
    }
  }, [inspectBusy, inspecting, activeAgent, onToast]);

  const copyPath = useCallback(
    (path: string) => {
      if (!navigator.clipboard) {
        onToast('当前环境不支持剪贴板', 'destructive');
        return;
      }
      navigator.clipboard.writeText(path).then(
        () => onToast('已复制选择器'),
        () => onToast('复制失败', 'destructive'),
      );
    },
    [onToast],
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
                      className={`size-[5px] rounded-full ${inspecting ? 'animate-pulse' : ''}`}
                      style={{
                        background: inspecting ? 'var(--primary)' : 'var(--muted-foreground)',
                        opacity: 0.6,
                      }}
                    />
                    <span
                      className="font-mono text-[8px] uppercase"
                      style={{ color: 'var(--muted-foreground)' }}
                    >
                      {inspecting ? 'ACTIVE' : 'IDLE'}
                    </span>
                  </div>
                </div>
                <Button
                  size="lg"
                  variant={inspecting ? 'destructive' : 'primary'}
                  disabled={inspectBusy || (!inspecting && !activeAgent)}
                  onClick={togglePick}
                  className="mt-2"
                >
                  {inspecting ? (
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
                        onClick={() => onPinSelector(liveNode.path)}
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
                  {inspecting
                    ? '已为真实 Agent 开启放大镜，点击任意元素即可抓取它的完整级联。'
                    : '点击上方按钮开启检查模式。扫描完成后将列出完整的 CSS 级联。'}
                </p>
              )}
            </>
          )}

          {/* ---- PROFILE mode ---- */}
          {mode === 'profile' && (
            <>
              <Kicker>AGENT PROFILES</Kicker>
              <div className="space-y-1.5">
                {AGENT_IDS.filter((id) => Boolean(appStatusFor(id)?.installed)).map((id) => (
                  <AgentProfileCard key={id} agentId={id} />
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
