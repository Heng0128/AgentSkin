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
import { ErrorBanner } from '@/components/ErrorBanner';
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
  const [error, setError] = useState<string | null>(null);
  // Bump to force a re-fetch of the snapshot (retry mechanism).
  const [retryCount, setRetryCount] = useState(0);
  // Track the iframe element for click-listener injection (element picking).
  const inspectCleanupRef = useRef<(() => void) | null>(null);

  // RC1-A fix: useRef-backed cache to break the useEffect→setState→useEffect loop.
  // The effect now depends only on `agentId`. Cache reads go through ref.current
  // (no re-render trigger), and a `fetchingAgentId` ref prevents duplicate requests.
  const snapshotCacheRef = useRef<Record<string, DomTreeNode | undefined>>({});
  const fetchingAgentIdRef = useRef<string | null>(null);

  const handleRetry = useCallback(() => {
    setRetryCount((c) => c + 1);
    setRefreshFailed(false);
    setError(null);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: retryCount triggers intentional re-fetch on retry
  useEffect(() => {
    // Prevent duplicate concurrent fetches for the same agentId
    if (fetchingAgentIdRef.current === agentId) return;
    fetchingAgentIdRef.current = agentId;

    let cancelled = false;
    const cached = snapshotCacheRef.current[agentId];

    const handleSuccess = (snap: ThemeVisualSnapshot) => {
      if (cancelled) return;
      snapshotCacheRef.current = { ...snapshotCacheRef.current, [agentId]: snap.domTree };
      setSnapshots((prev) =>
        prev[agentId] === snap.domTree ? prev : { ...prev, [agentId]: snap.domTree },
      );
      setRefreshFailed(false);
      setError(null);
    };

    const handleFinally = () => {
      if (cancelled) return;
      fetchingAgentIdRef.current = null;
      setRefreshing(false);
      setLoading(false);
    };

    if (cached) {
      // Cache hit: display immediately, refresh in background
      setRefreshing(true);
      setRefreshFailed(false);
      api
        .snapshotBaseline(agentId as never)
        .then(handleSuccess)
        .catch((err: unknown) => {
          // Refresh failed: keep cache, mark failure (bar turns red)
          if (cancelled) return;
          setRefreshFailed(true);
          setError(err instanceof Error ? err.message : t.workspacePreviewRefreshFailed);
        })
        .finally(handleFinally);
      return () => {
        cancelled = true;
        fetchingAgentIdRef.current = null;
      };
    }

    // Cache miss: show loading
    setLoading(true);
    api
      .snapshotBaseline(agentId as never)
      .then(handleSuccess)
      .catch((err: unknown) => {
        if (cancelled) return;
        setRefreshFailed(true);
        setError(err instanceof Error ? err.message : t.workspacePreviewLoadFailed);
      })
      .finally(handleFinally);
    return () => {
      cancelled = true;
      fetchingAgentIdRef.current = null;
    };
    // retryCount is intentionally a dependency — incrementing it triggers a re-fetch.
  }, [agentId, retryCount, t]);

  // Sync snapshots state from cache ref on mount and when agentId changes
  useEffect(() => {
    const cached = snapshotCacheRef.current[agentId];
    if (cached) {
      setSnapshots((prev) => (prev[agentId] === cached ? prev : { ...prev, [agentId]: cached }));
    }
  }, [agentId]);

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
      <div className="flex h-full items-center justify-center rounded-lg border border-border bg-card">
        <span className="as-mono">{t.workspacePreviewLoading}</span>
      </div>
    );
  }

  // Status bar (shared across single and dual modes).
  // When a snapshot fetch fails, show an ErrorBanner with a retry button and
  // the failure reason — replacing the previous 1px red bar that offered no
  // recovery path.
  const statusBar = (
    <>
      {refreshing && !refreshFailed && (
        <div className="absolute inset-x-0 top-0 h-1 bg-primary/30 animate-pulse" />
      )}
      {refreshFailed && (
        <div className="absolute inset-x-0 top-0 z-[var(--z-overlay)] p-2">
          <ErrorBanner
            message={t.workspacePreviewRefreshFailed}
            detail={error ?? undefined}
            onRetry={handleRetry}
            retryLabel={t.workspacePreviewRetry}
          />
        </div>
      )}
    </>
  );

  // In dual-preview mode, render A/B side by side.
  if (dualPreview) {
    return (
      <div className="relative h-full overflow-hidden rounded-lg border border-border">
        {statusBar}
        <div className="grid h-full grid-cols-2 gap-px bg-border">
          {/* Left: current overrides */}
          <div className="flex flex-col bg-surface">
            <div className="shrink-0 px-2 py-1 text-center text-[11px] font-medium tracking-tight text-muted-foreground">
              {t.workspacePreviewDualA}
            </div>
            <div className="min-h-0 flex-1">
              <RealDomPreview domTree={domTree} overrides={overrides} t={t} chrome={false} />
            </div>
          </div>
          {/* Right: baseline (no overrides) */}
          <div className="flex flex-col bg-surface">
            <div className="shrink-0 px-2 py-1 text-center text-[11px] font-medium tracking-tight text-muted-foreground">
              {t.workspacePreviewDualB}
            </div>
            <div className="min-h-0 flex-1">
              <RealDomPreview domTree={domTree} overrides={null} t={t} chrome={false} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Single preview mode (with optional inspect mode).
  return (
    <div className="relative h-full overflow-hidden rounded-lg border border-border">
      {statusBar}
      <div className="h-full" style={{ cursor: inspectMode ? 'crosshair' : 'default' }}>
        <RealDomPreview
          domTree={domTree}
          overrides={overrides}
          t={t}
          chrome={false}
          onIframeMount={inspectMode ? handleIframeMount : undefined}
        />
      </div>
    </div>
  );
}
