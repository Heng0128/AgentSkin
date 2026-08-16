// SPDX-License-Identifier: MPL-2.0

/**
 * # AgentLivePreview
 *
 * Workbench preview surface — wraps {@link RealDomPreview} with live-tweak
 * semantics: fetches the agent's native (un-themed) DOM snapshot on mount and
 * re-feeds it as `overrides` change, so slider / color-picker adjustments are
 * reflected instantly inside the sandboxed replay iframe.
 *
 * The DOM snapshot is captured via `api.snapshotBaseline`, which returns the
 * agent's native appearance. When the probe is unavailable the snapshot has no
 * `domTree` and {@link RealDomPreview} shows its built-in fallback message.
 *
 * Overrides never reach this component over the network — they are rendered
 * into the iframe via `postMessage` (see `RealDomPreview.overridesToCss`).
 * The real-time push to the *live* agent happens in `workspaceStore.updateOverride`,
 * not here. This component is purely a local preview.
 */

import { useEffect, useState } from 'react';
import { api } from '@/api/agentSkinClient';
import { RealDomPreview } from '@/components/studio/RealDomPreview';
import type { ToolOverride } from '@/types/override';

import type { UiMessages } from '@shared/i18n';
import type { DomTreeNode, ThemeVisualSnapshot } from '@shared/types';

export function AgentLivePreview({
  agentId,
  overrides,
  t,
}: {
  agentId: string;
  overrides: ToolOverride;
  t: UiMessages;
}) {
  const [loading, setLoading] = useState(true);
  const [snapshots, setSnapshots] = useState<Record<string, DomTreeNode | undefined>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const cached = snapshots[agentId];

    if (cached) {
      // Cache hit: display immediately, refresh in background
      setRefreshing(true);
      setRefreshFailed(false);
      api
        .snapshotBaseline(agentId as never)
        .then((snap: ThemeVisualSnapshot) => {
          if (cancelled) return;
          setSnapshots((prev) => ({ ...prev, [agentId]: snap.domTree }));
          setRefreshFailed(false);
        })
        .catch(() => {
          // Refresh failed: keep cache, mark failure (bar turns red)
          if (!cancelled) setRefreshFailed(true);
        })
        .finally(() => {
          if (!cancelled) setRefreshing(false);
        });
      return () => {
        cancelled = true;
      };
    }

    // Cache miss: show loading
    setLoading(true);
    api
      .snapshotBaseline(agentId as never)
      .then((snap: ThemeVisualSnapshot) => {
        if (cancelled) return;
        setSnapshots((prev) => ({ ...prev, [agentId]: snap.domTree }));
      })
      .catch(() => {
        /* leave domTree undefined → RealDomPreview shows fallback */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, snapshots]);

  const domTree = snapshots[agentId];

  if (loading && !domTree) {
    return (
      <div className="flex h-[280px] items-center justify-center rounded-md bg-card">
        <span className="font-mono text-[11px] text-muted-foreground">
          {t.workspacePreviewLoading}
        </span>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-md">
      {refreshing && !refreshFailed && (
        <div className="absolute inset-x-0 top-0 h-1 bg-primary/30 animate-pulse" />
      )}
      {refreshFailed && (
        <div
          role="alert"
          className="absolute inset-x-0 top-0 h-1"
          style={{ background: 'var(--destructive)' }}
          title={t.workspacePreviewRefreshFailed ?? '刷新失败，显示缓存'}
        >
          <span className="sr-only">{t.workspacePreviewRefreshFailed ?? '刷新失败，显示缓存'}</span>
        </div>
      )}
      <RealDomPreview domTree={domTree} overrides={overrides} t={t} />
    </div>
  );
}
