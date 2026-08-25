// SPDX-License-Identifier: MPL-2.0

/**
 * # DownloadProgress
 *
 * Progress indicator for community theme downloads. Renders a progress bar,
 * percentage text, and optional byte-level detail. Adapts its icon and
 * label for the downloading / verifying / installing phases.
 */

import { cn } from '@/lib/utils';
import { Loader2, Package } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

// ---------------------------------------------------------------------------
// Phase type
// ---------------------------------------------------------------------------

export type DownloadPhase = 'downloading' | 'verifying' | 'installing';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface DownloadProgressProps {
  /** Download progress 0-100 */
  progress: number;
  /** Bytes downloaded so far */
  bytesDownloaded: number;
  /** Total bytes expected */
  totalBytes: number;
  /** Toggle the byte-level detail row (downloaded / total) */
  showDetails?: boolean;
  /** Current phase — controls icon and label */
  phase?: DownloadPhase;
}

// ---------------------------------------------------------------------------
// Byte formatter
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Phase label
// ---------------------------------------------------------------------------

function phaseLabel(phase: DownloadPhase): string {
  switch (phase) {
    case 'verifying':
      return '验证中…';
    case 'installing':
      return '安装中…';
    default:
      return '下载中…';
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DownloadProgress({
  progress,
  bytesDownloaded,
  totalBytes,
  showDetails = false,
  phase = 'downloading',
}: DownloadProgressProps) {
  const clamped = Math.max(0, Math.min(100, progress));
  const isVerifying = phase === 'verifying';
  const isInstalling = phase === 'installing';

  const icon = isVerifying ? (
    <Loader2 className="size-3.5 animate-spin text-primary" />
  ) : isInstalling ? (
    <Package className="size-3.5 text-primary" />
  ) : null;

  return (
    <div className="flex flex-col gap-1.5">
      {/* Progress bar */}
      <Progress
        value={clamped}
        className="h-1.5"
        fillClassName={cn(
          isVerifying && 'bg-cr-warning',
          isInstalling && 'bg-cr-success',
        )}
      />

      {/* Label + percentage row */}
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          {icon}
          {phaseLabel(phase)}
        </span>
        <span className="font-mono tabular-nums">{clamped}%</span>
      </div>

      {/* Optional byte-level detail */}
      {showDetails && (
        <div className="font-mono text-[10px] text-muted-foreground/60 tabular-nums">
          {formatBytes(bytesDownloaded)} / {formatBytes(totalBytes)}
        </div>
      )}
    </div>
  );
}
