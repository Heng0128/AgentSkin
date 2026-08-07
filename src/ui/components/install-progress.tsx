// SPDX-License-Identifier: MPL-2.0

import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { HugeIcon } from '@/components/ui/huge-icon';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { InstallStep } from '@/stores/installFlowStore';

import { AlertCircleIcon, CheckIcon, LoadingIcon, RotateIcon, X } from '@hugeicons/core-free-icons';
import type { UiMessages } from '@shared/i18n';
import appIcon from '../../../assets/branding/app-icon.png';

// ---------------------------------------------------------------------------
// Formatted elapsed time from ms
// ---------------------------------------------------------------------------

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  return `${s}s`;
}

// ---------------------------------------------------------------------------
// Step row
// ---------------------------------------------------------------------------

function StepRow({ step }: { step: InstallStep }) {
  const statusIcon = (() => {
    switch (step.status) {
      case 'done':
        return <HugeIcon icon={CheckIcon} className="size-3.5 text-cr-success" />;
      case 'active':
        return <HugeIcon icon={LoadingIcon} className="size-3.5 animate-spin text-primary" />;
      case 'error':
        return <HugeIcon icon={AlertCircleIcon} className="size-3.5 text-destructive" />;
      case 'cancelled':
        return <HugeIcon icon={X} className="size-3.5 text-muted-foreground" />;
      default:
        return <span className="size-3.5 rounded-full border border-muted-foreground/30" />;
    }
  })();

  return (
    <li className="flex items-start gap-2 text-xs">
      <span className="mt-0.5 shrink-0">{statusIcon}</span>
      <div className="min-w-0 flex-1">
        <span
          className={
            step.status === 'error'
              ? 'text-destructive'
              : step.status === 'cancelled'
                ? 'text-muted-foreground/50'
                : 'text-foreground'
          }
        >
          {step.label}
        </span>
        {step.message && step.status === 'error' && (
          <p className="truncate text-[11px] text-destructive/80">{step.message}</p>
        )}
        {step.elapsed !== undefined && step.elapsed > 0 && (
          <span className="ml-1.5 text-[10px] text-muted-foreground/50">
            {formatElapsed(step.elapsed)}
          </span>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Log entry renderer
// ---------------------------------------------------------------------------

interface LogEntry {
  time: string;
  module: string;
  level: string;
  message: string;
}

function parseLogLine(line: string): LogEntry | null {
  // Format: [HH:MM:SS] [Module] [LEVEL] message
  const m = line.match(/^\[(\d{2}:\d{2}:\d{2})\]\s+\[([^\]]+)\]\s+\[([^\]]+)\]\s+(.+)$/);
  if (!m) return null;
  return { time: m[1], module: m[2], level: m[3], message: m[4] };
}

function LogEntryRow({ entry }: { entry: LogEntry }) {
  const levelColor = (() => {
    switch (entry.level) {
      case 'ERROR':
        return 'text-destructive';
      case 'WARN':
        return 'text-cr-warning';
      default:
        return 'text-muted-foreground';
    }
  })();

  return (
    <div className="flex gap-2 font-mono text-[11px] leading-5">
      <span className="text-muted-foreground/40 shrink-0">{entry.time}</span>
      <span className="text-primary/70 shrink-0">[{entry.module}]</span>
      <span className={cn(levelColor, 'shrink-0')}>[{entry.level}]</span>
      <span className="text-foreground/80 break-all">{entry.message}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Full Wizard
// ---------------------------------------------------------------------------

export function InstallWizard({
  steps,
  currentTheme,
  lastError,
  progress,
  isInstalling,
  isComplete,
  isFailed,
  isCancelled,
  onRetry,
  onCancel,
  onClose,
  logs,
  t,
}: {
  steps: InstallStep[];
  currentTheme: string | null;
  lastError: string | null;
  progress: number;
  isInstalling: boolean;
  isComplete: boolean;
  isFailed: boolean;
  isCancelled: boolean;
  onRetry?: () => void;
  onCancel?: () => void;
  onClose?: () => void;
  logs: string[];
  t?: UiMessages;
}) {
  const logRef = useRef<HTMLDivElement>(null);

  // Auto-scroll logs
  // P2-13: Empty deps meant this only ran on mount — never re-scrolled when
  // new log lines arrived during an install. We now run after every render
  // that changes `logs`, and only scroll when the user wasn't manually
  // scrolling up. `steps.length` is included so the scroll also catches the
  // state transition at the end of a step (when the "done" row appears).
  // `void logs` / `void steps.length` reads keep biome exhaustive-deps happy
  // (both deps are trigger-only and not used for actual DOM computation).
  useEffect(() => {
    void logs;
    void steps.length;
    if (!logRef.current) return;
    const el = logRef.current;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (atBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [logs, steps.length]);

  if (steps.length === 0 && !isInstalling && !isComplete && !isFailed && !isCancelled) return null;

  const title = (() => {
    if (isFailed) return t?.installFailed ?? '安装失败';
    if (isCancelled) return t?.installCancelled ?? '安装已取消';
    if (isComplete) return t?.installCompleted ?? '安装完成';
    return t?.installProgress ?? '正在安装主题…';
  })();

  // Parse logs into entries
  const logEntries = logs
    .map(parseLogLine)
    .filter((e): e is LogEntry => e !== null)
    .slice(-50); // last 50 entries

  return (
    <div className="animate-page-enter fixed bottom-4 left-1/2 z-[110] w-[480px] -translate-x-1/2 rounded-[2px] border bg-popover shadow-xl">
      {/* Header */}
      <div className="flex items-center gap-3 border-b px-4 py-3">
        <img src={appIcon} alt="" className="size-6 rounded" draggable={false} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">{title}</p>
          {currentTheme && (
            <p className="text-[11px] text-muted-foreground truncate">{currentTheme}</p>
          )}
        </div>
        {(isComplete || isFailed || isCancelled) && (
          <Button size="sm" variant="ghost" className="size-6 p-0" onClick={onClose}>
            <HugeIcon icon={X} className="size-3.5" />
          </Button>
        )}
      </div>

      {/* Progress bar */}
      <div className="px-4 pt-3">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-1">
          <span>{progress}%</span>
          <span>{steps.length} steps</span>
        </div>
        <Progress
          value={progress}
          className="h-1.5"
          fillClassName={isFailed ? 'bg-destructive' : isComplete ? 'bg-cr-success' : undefined}
        />
      </div>

      {/* Steps list */}
      <div className="mx-4 mt-3 max-h-32 overflow-y-auto rounded-[2px] bg-muted/30 p-2">
        <ul className="flex flex-col gap-1">
          {steps.map((step) => (
            <StepRow key={step.id} step={step} />
          ))}
        </ul>
      </div>

      {/* Live log */}
      {logEntries.length > 0 && (
        <div
          ref={logRef}
          className="mx-4 mt-2 max-h-24 overflow-y-auto rounded-[2px] border bg-muted/20 p-2"
        >
          {logEntries.map((entry, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: log entries are append-only display items — no reorder, insert, or delete, so index keys are safe.
            <LogEntryRow key={i} entry={entry} />
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 border-t px-4 py-3">
        {isFailed && onRetry && (
          <Button size="sm" variant="outline" onClick={onRetry}>
            <HugeIcon icon={RotateIcon} className="size-3.5" />
            {t?.restartAndApply ?? '重试'}
          </Button>
        )}
        {isInstalling && onCancel && (
          <Button size="sm" variant="outline" onClick={onCancel}>
            <HugeIcon icon={X} className="size-3.5" />
            {t?.cancel ?? '取消'}
          </Button>
        )}
        {isComplete && (
          <span className="text-xs text-cr-success">✓ {t?.installCompleted ?? '完成'}</span>
        )}
        {isFailed && lastError && (
          <span className="text-xs text-destructive truncate">{lastError}</span>
        )}
        <div className="ml-auto" />
        {onClose && (isComplete || isFailed || isCancelled) && (
          <Button size="sm" onClick={onClose}>
            {t?.close ?? '关闭'}
          </Button>
        )}
      </div>
    </div>
  );
}
