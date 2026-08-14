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
  const [domTree, setDomTree] = useState<DomTreeNode | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .snapshotBaseline(agentId as never)
      .then((snap: ThemeVisualSnapshot) => {
        if (cancelled) return;
        setDomTree(snap.domTree);
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
  }, [agentId]);

  if (loading) {
    return (
      <div className="flex h-[280px] items-center justify-center border border-border rounded-[2px] bg-card">
        <span className="font-mono text-[11px] text-muted-foreground uppercase tracking-tight">
          {t.workspacePreviewLoading}
        </span>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-[2px] border border-border">
      <RealDomPreview domTree={domTree} overrides={overrides} t={t} />
    </div>
  );
}
