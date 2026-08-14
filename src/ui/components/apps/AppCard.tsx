// SPDX-License-Identifier: MPL-2.0

/**
 * # AppCard
 *
 * A single application tile in the Apps launcher page. Displays the app icon
 * (or a letter placeholder), product name, running-status indicator, and
 * CDP port number. Double-clicking the card triggers the launch callback.
 *
 * ## Status indicator
 *
 *   - Green dot  (●) — running with CDP port.
 *   - Gray dot   (○) — not running (or launched but no port yet).
 *   - Yellow dot (▲) — running but no CDP port (non-adapted or discovery
 *     failed).
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import type { ScannedApp } from '@shared/types';

/** Running state of an app — determines the status dot color. */
export type AppRunningState = 'running' | 'running-no-port' | 'idle' | 'launching';

/** Props for computing the running state of a given app. */
interface AppCardProps {
  /** The scanned app to display. */
  app: ScannedApp;
  /** Whether the app is currently running. */
  isRunning: boolean;
  /** Whether the app is currently being launched. */
  isLaunching: boolean;
  /** The CDP port number (null if not available). */
  port: number | null;
  /** Whether to show the running-status indicator and port number. */
  showRunningStatus?: boolean;
  /** Callback when the card is double-clicked. */
  onDoubleClick?: () => void;
}

/** Resolve the visual running state from props. */
function resolveRunningState(
  isLaunching: boolean,
  isRunning: boolean,
  port: number | null,
): AppRunningState {
  if (isLaunching) return 'idle';
  if (!isRunning) return 'idle';
  return port === null ? 'running-no-port' : 'running';
}

function StatusDot({ state }: { state: AppRunningState }) {
  return (
    <span
      className={cn(
        'inline-block size-[7px] rounded-full',
        state === 'running' && 'bg-[var(--grn)]',
        state === 'running-no-port' && 'bg-[var(--amb)]',
        state === 'idle' && 'bg-[var(--muted-foreground)] opacity-25',
      )}
    />
  );
}

export function AppCard({
  app,
  isRunning,
  isLaunching,
  port,
  showRunningStatus = true,
  onDoubleClick,
}: AppCardProps) {
  const [imgError, setImgError] = useState(false);
  const runningState = resolveRunningState(isLaunching, isRunning, port);

  // Letter placeholder: first character of the product name (uppercase).
  const placeholder = app.productName.slice(0, 1).toUpperCase();

  return (
    <Button
      variant="ghost"
      onDoubleClick={onDoubleClick}
      className={cn(
        'group flex h-auto w-full flex-col items-center gap-2 rounded-[2px] border border-border bg-card p-4 transition-all duration-fast ease-out',
        'hover:border-border-strong hover:bg-card2',
      )}
    >
      {/* Icon area */}
      <div className="relative flex size-12 items-center justify-center">
        {app.iconPath && !imgError ? (
          <img
            src={`file://${app.iconPath}`}
            alt={app.productName}
            className="size-10 rounded-[2px] object-contain"
            onError={() => setImgError(true)}
          />
        ) : (
          <span className="flex size-10 items-center justify-center rounded-[2px] border border-border bg-card2 font-display text-[18px] font-bold tracking-tight text-muted-foreground">
            {placeholder}
          </span>
        )}

        {/* Status dot — overlaid on icon bottom-right */}
        {showRunningStatus && (
          <span className="absolute -bottom-0.5 -right-0.5 flex size-[14px] items-center justify-center rounded-full bg-card">
            <StatusDot state={runningState} />
          </span>
        )}
      </div>

      {/* Name + port */}
      <div className="flex w-full flex-col items-center gap-0.5">
        <span className="max-w-full truncate font-display text-[12px] font-bold tracking-[-.01em]">
          {app.productName}
        </span>
        {showRunningStatus && port !== null && (
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground/60">
            :{port}
          </span>
        )}
      </div>
    </Button>
  );
}
