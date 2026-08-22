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
 * into the iframe via direct DOM write (see `RealDomPreview.pushOverrides`).
 * The real-time push to the *live* agent happens in `workspaceStore.updateOverride`,
 * not here. This component is purely a local preview.
 *
 * Features:
 * - **A/B compare** (`dualPreview`): splits the preview into current (left) vs
 *   baseline (right, no overrides) for visual diff.
 * - **Element picking** (`inspectMode`): injects a click listener into the
 *   iframe to map clicked elements back to their `data-as-ref` identifier.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/api/agentSkinClient';
import { RealDomPreview } from '@/components/studio/RealDomPreview';
import type { ToolOverride } from '@/types/override';

import type { UiMessages } from '@shared/i18n';
import type { DomTreeNode, ThemeVisualSnapshot } from '@shared/types';

export function AgentLivePreview({
  agentId,
  overrides,
  t,
  dualPreview = false,
  inspectMode = false,
  onElementPicked,
}: {
  agentId: string;
  overrides: ToolOverride;
  t: UiMessages;
  /** When true, render a side-by-side A/B comparison (current vs baseline). */
  dualPreview?: boolean;
  /** When true, enable element picking inside the preview iframe. */
  inspectMode?: boolean;
  /** Callback invoked when the user picks an element in inspect mode. */
  onElementPicked?: (ref: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [snapshots, setSnapshots] = useState<Record<string, DomTreeNode | undefined>>({});
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  // Track the iframe element for click-listener injection (element picking).
  const inspectCleanupRef = useRef<(() => void) | null>(null);

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
        if (cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agentId, snapshots]);

  // --- Element picking: inject click listener into the iframe ---
  // Clean up previous listener on unmount.
  useEffect(() => {
    return () => {
      if (inspectCleanupRef.current) {
        inspectCleanupRef.current();
        inspectCleanupRef.current = null;
      }
    };
  }, []);

  const handleIframeMount = useCallback(
    (iframe: HTMLIFrameElement) => {
      // Clean up any previous listener first.
      if (inspectCleanupRef.current) {
        inspectCleanupRef.current();
        inspectCleanupRef.current = null;
      }
      if (!inspectMode || !onElementPicked) return;
      try {
        const doc = iframe.contentDocument;
        if (!doc) return;
        const handler = (e: Event) => {
          const target = e.target as HTMLElement;
          const ref = target.getAttribute('data-as-ref') ?? target.tagName.toLowerCase();
          onElementPicked(ref);
          e.preventDefault();
          e.stopPropagation();
        };
        doc.addEventListener('click', handler, { capture: true });
        inspectCleanupRef.current = () => {
          doc.removeEventListener('click', handler, { capture: true });
        };
      } catch {
        // Cross-origin: contentDocument inaccessible, degrade silently.
      }
    },
    [inspectMode, onElementPicked],
  );

  const domTree = snapshots[agentId];

  if (loading && !domTree) {
    return (
      <div className="flex h-[280px] items-center justify-center rounded-md bg-card">
        <span className="as-mono">{t.workspacePreviewLoading}</span>
      </div>
    );
  }

  // Status bar (shared across single and dual modes).
  const statusBar = (
    <>
      {refreshing && !refreshFailed && (
        <div className="absolute inset-x-0 top-0 h-1 bg-primary/30 animate-pulse" />
      )}
      {refreshFailed && (
        <div
          role="alert"
          className="absolute inset-x-0 top-0 h-1 bg-destructive"
          title={t.workspacePreviewRefreshFailed}
        >
          <span className="sr-only">{t.workspacePreviewRefreshFailed}</span>
        </div>
      )}
    </>
  );

  // In dual-preview mode, render A/B side by side.
  if (dualPreview) {
    return (
      <div className="relative overflow-hidden rounded-md">
        {statusBar}
        <div className="grid grid-cols-2 gap-px bg-[var(--border-subtle)]">
          {/* Left: current overrides */}
          <div className="bg-[var(--surface)]">
            <div className="px-2 py-1 text-center font-mono text-[10px] tracking-wider text-muted-foreground">
              {t.workspacePreviewDualA}
            </div>
            <RealDomPreview domTree={domTree} overrides={overrides} t={t} />
          </div>
          {/* Right: baseline (no overrides) */}
          <div className="bg-[var(--surface)]">
            <div className="px-2 py-1 text-center font-mono text-[10px] tracking-wider text-muted-foreground">
              {t.workspacePreviewDualB}
            </div>
            <RealDomPreview domTree={domTree} overrides={null} t={t} />
          </div>
        </div>
      </div>
    );
  }

  // Single preview mode (with optional inspect mode).
  return (
    <div className="relative overflow-hidden rounded-md">
      {statusBar}
      <div style={{ cursor: inspectMode ? 'crosshair' : 'default' }}>
        <RealDomPreview
          domTree={domTree}
          overrides={overrides}
          t={t}
          onIframeMount={inspectMode ? handleIframeMount : undefined}
        />
      </div>
    </div>
  );
}
