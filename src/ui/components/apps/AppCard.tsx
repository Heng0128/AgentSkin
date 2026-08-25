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
import { AppMark } from '@/components/app-mark';
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
  /** Callback when the card is clicked (single click — opens detail drawer). */
  onClick?: () => void;
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
        'inline-block size-2 rounded-full',
        state === 'running' && 'bg-cr-success',
        state === 'running-no-port' && 'bg-cr-warning',
        state === 'idle' && 'bg-muted-foreground/25',
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
  onClick,
  onDoubleClick,
}: AppCardProps) {
  const [imgError, setImgError] = useState(false);
  const runningState = resolveRunningState(isLaunching, isRunning, port);

  // Letter placeholder: first character of the product name (uppercase).
  const placeholder = app.productName.slice(0, 1).toUpperCase();

  // Icon source: `iconPath` may be a data URL (extracted from the exe) or a
  // filesystem path (legacy). Data URLs are passed through verbatim.
  const iconSrc = app.iconPath?.startsWith('data:')
    ? app.iconPath
    : app.iconPath
      ? `file://${app.iconPath}`
      : null;

  return (
    <Button
      variant="ghost"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={cn(
        'group flex h-auto w-full flex-col items-center gap-2 rounded-md p-2',
        'transition-colors duration-fast ease-out hover:bg-muted',
        'hover:bg-accent',
        'active:bg-accent/70',
        isRunning && 'ring-1 ring-success',
      )}
    >
      {/* Icon — rendered directly (desktop-shortcut style), no container block */}
      <div className="relative">
        {app.adapterMatch ? (
          <AppMark appId={app.adapterMatch} size={48} className="rounded-none" />
        ) : iconSrc && !imgError ? (
          <img
            src={iconSrc}
            alt={app.productName}
            className="size-12 object-contain"
            onError={() => setImgError(true)}
          />
        ) : (
          <span className="flex size-12 items-center justify-center text-xl font-normal text-muted-foreground">
            {placeholder}
          </span>
        )}

        {/* Status dot — overlaid on icon bottom-right */}
        {showRunningStatus && (
          <span className="absolute -bottom-0.5 -right-0.5 flex size-[14px] items-center justify-center rounded-full bg-background">
            <StatusDot state={runningState} />
          </span>
        )}
      </div>

      {/* Name + port */}
      <div className="flex w-full flex-col items-center gap-0">
        <span className="max-w-full truncate text-body font-medium">{app.productName}</span>
        {showRunningStatus && port !== null && (
          <span className="font-mono text-micro tabular-nums text-muted-foreground/60">
            :{port}
          </span>
        )}
      </div>
    </Button>
  );
}
