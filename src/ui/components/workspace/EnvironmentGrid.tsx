// SPDX-License-Identifier: MPL-2.0

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import type { ProgressMap } from '@/hooks/useBootProgress';

import type { UiMessages } from '@shared/i18n';
import type { EnvironmentModel } from '@shared/types/environment';
import { Bot, RefreshCw } from 'lucide-react';
import { EnvironmentCard } from './EnvironmentCard';

/**
 * # EnvironmentGrid
 *
 * Displays all environments in a responsive grid with a live status header.
 * Merges the former AgentStatusBar's real-time refresh indicator into the
 * section title so agent status and environment management live in one place.
 *
 * Each card supports:
 *   - Click to switch
 *   - Menu (…) for preset operations (rename/duplicate/delete)
 *   - Live progress bar during apply/restore operations
 */

/**
 * # StatusRefreshLabel
 *
 * Live "x s ago" refresh indicator. Isolated in its own component so its
 * 1s ticker re-renders ONLY this label — not the whole environment grid
 * (which previously re-rendered every card every second via a top-level
 * useTick). The grid now re-renders solely on real data changes.
 */
function StatusRefreshLabel({
  lastStatusAt,
  isRefreshing,
  t,
}: {
  lastStatusAt?: number | null;
  isRefreshing?: boolean;
  t: UiMessages;
}) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  const agoLabel = lastStatusAt
    ? (() => {
        const diff = Math.max(0, Math.floor((Date.now() - lastStatusAt) / 1000));
        if (diff < 1) return 'now';
        if (diff < 60) return `${diff}s`;
        const m = Math.floor(diff / 60);
        return m < 10 ? `${m}m` : null;
      })()
    : null;

  if (isRefreshing) {
    return (
      <span
        aria-live="polite"
        aria-atomic="true"
        className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground/80"
      >
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-muted-foreground/30 opacity-75" />
          <span className="relative inline-flex size-1.5 rounded-full bg-muted-foreground/50" />
        </span>
        <span className="text-muted-foreground">{t.statusDetecting}</span>
      </span>
    );
  }
  if (!agoLabel) return null;
  return (
    <span
      aria-live="polite"
      aria-atomic="true"
      className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground/80"
    >
      <span className="size-1.5 rounded-full bg-cr-success/60" />
      <span>{agoLabel}</span>
    </span>
  );
}
/**
 * # StatusErrorBanner
 *
 * Conditionally rendered when the last status refresh failed. Shows the error
 * message in muted/destructive tone with a retry button that triggers
 * `onRetry` (the caller wires this to `useStatusStore.refreshStatus`).
 *
 *  - Only mounts when `error` is a non-empty string.
 *  - Disables the retry button while `isRefreshing` to prevent duplicate calls.
 *  - style: rounded-md, mono label, destructive left border accent.
 */
function StatusErrorBanner({
  error,
  isRefreshing,
  onRetry,
  t,
}: {
  error: string | null;
  isRefreshing: boolean;
  onRetry: () => void;
  t: UiMessages;
}) {
  if (!error) return null;

  return (
    <div
      role="alert"
      className="mb-3 flex items-center gap-3 rounded-md border border-destructive/25 bg-destructive/5 px-3 py-2"
    >
      {/* Left accent bar */}
      <span className="h-5 w-[3px] shrink-0 rounded-md bg-destructive" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{error}</span>
      <button
        type="button"
        onClick={onRetry}
        disabled={isRefreshing}
        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-destructive/30 bg-card2 px-2 py-1 text-[11px] text-destructive transition-colors duration-base hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-45"
      >
        {isRefreshing ? <Spinner className="size-3" /> : <RefreshCw className="size-3" />}
        {t.statusRetry}
      </button>
    </div>
  );
}

/**
 * Adaptive grid columns based on environment count:
 *   1 → 1 col, 2 → 2 cols, 3 → 3 cols (single row),
 *   4 → 2 cols (2×2), 5–6 → 3 cols, 7+ → 4 cols.
 * On smaller screens, always fall back to fewer columns.
 */
function gridColsClass(count: number): string {
  if (count <= 1) return 'grid-cols-1';
  if (count === 2) return 'grid-cols-1 sm:grid-cols-2';
  if (count === 3) return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';
  if (count === 4) return 'grid-cols-1 sm:grid-cols-2';
  if (count <= 6) return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';
  return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';
}

export function EnvironmentGrid({
  environments,
  activeId,
  onSwitch,
  onRename,
  onDuplicate,
  onDelete,
  title,
  t,
  onBrowseThemes,
  progress,
  lastStatusAt,
  isRefreshing,
  error,
  onRetry,
}: {
  environments: EnvironmentModel[];
  activeId: string | null;
  onSwitch?: (env: EnvironmentModel) => void;
  onRename?: (presetId: string) => void;
  onDuplicate?: (presetId: string) => void;
  onDelete?: (presetId: string) => void;
  title: string;
  t: UiMessages;
  onBrowseThemes?: () => void;
  progress?: ProgressMap;
  /** Timestamp (epoch ms) of the last successful status refresh. */
  lastStatusAt?: number | null;
  /** True while a status refresh is in flight (drives the live pulse). */
  isRefreshing?: boolean;
  /** Error message from the last failed refresh; null when last refresh succeeded. */
  error?: string | null;
  /** Callback invoked when the user clicks the retry button in the error banner. */
  onRetry?: () => void;
}) {
  if (environments.length === 0) {
    return (
      <div className="mt-6">
        {/* section header */}
        <div className="mb-3 flex items-center gap-2">
          <span className="as-label">{title}</span>
        </div>
        <StatusErrorBanner
          error={error ?? null}
          isRefreshing={isRefreshing ?? false}
          onRetry={onRetry ?? (() => {})}
          t={t}
        />
        <div className="rounded-md border-2 border-dashed border-border/40 py-10 text-center dark:border-border/30">
          <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-md bg-card2">
            <Bot className="size-5 text-muted-foreground/50" />
          </div>
          <p className="as-mono">{t.emptyEnvironmentsHint}</p>
          {onBrowseThemes && (
            <Button
              size="sm"
              variant="outline"
              className="mt-3 gap-1 text-[11px]"
              onClick={onBrowseThemes}
            >
              {t.browseThemes}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-5">
      {/* section header with mono label */}
      <div className="mb-3 flex items-center gap-2 px-1">
        <span className="as-label">{title}</span>
        <span className="inline-flex size-[18px] items-center justify-center rounded-md bg-card2 text-[11px] font-normal text-muted-foreground ring-1 ring-border">
          {environments.length}
        </span>
        {/* Live refresh indicator — isolated ticker so the grid doesn't re-render every second. */}
        <StatusRefreshLabel lastStatusAt={lastStatusAt} isRefreshing={isRefreshing} t={t} />
      </div>
      <StatusErrorBanner
        error={error ?? null}
        isRefreshing={isRefreshing ?? false}
        onRetry={onRetry ?? (() => {})}
        t={t}
      />
      <div className={`grid gap-2 ${gridColsClass(environments.length)}`}>
        {environments.map((env) => (
          <EnvironmentCard
            key={env.id}
            env={env}
            isActive={env.id === activeId}
            onClick={onSwitch ? () => onSwitch(env) : undefined}
            onRename={onRename}
            onDuplicate={onDuplicate}
            onDelete={onDelete}
            t={t}
            progress={progress?.get(env.agent.id) ?? null}
          />
        ))}
      </div>
    </div>
  );
}
