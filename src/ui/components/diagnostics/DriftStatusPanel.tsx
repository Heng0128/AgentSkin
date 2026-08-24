// SPDX-License-Identifier: MPL-2.0

/**
 * # DriftStatusPanel
 *
 * Diagnostics panel — per-agent P3 Self-Healing drift detection status.
 * Subscribes to `useDiagnosticsStore.driftStatusByAgent` which is fed by the
 * main process via the `theme:drift-status` IPC channel after each fingerprint
 * capture + drift detection cycle.
 *
 * Shows per-agent cards with: drift score (color-coded LED + numeric), signal
 * list, confidence badge, last regen result, and a manual regen trigger button.
 *
 * Empty state when no drift data has been captured yet.
 *
 * Swiss/International design: 11px font, tabular-nums, mono accents,
 * single accent color, no scale/slide animations.
 */

import { useState } from 'react';
import { api } from '@/api/agentSkinClient';
import { AppMark } from '@/components/app-mark';
import { cn } from '@/lib/utils';
import { useDiagnosticsStore } from '@/stores/diagnosticsStore';

import type { UiMessages } from '@shared/i18n';
import { AGENT_META, type AgentId } from '@shared/types';
import type { DriftStatus } from '@shared/types/drift-status';
import { format } from 'date-fns';
import { EmptyState } from '@/components/ui/empty-state';
import { Activity, RefreshCw } from 'lucide-react';

export function DriftStatusPanel({ t }: { t: UiMessages }) {
  const driftStatusByAgent = useDiagnosticsStore((s) => s.driftStatusByAgent);

  const agentEntries = Object.entries(driftStatusByAgent);

  if (agentEntries.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <EmptyState icon={<Activity />} title={t.settingsDriftStatusEmpty} iconSize="md" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {agentEntries.map(([agentId, status]) => (
        <DriftAgentCard key={agentId} agentId={agentId} status={status} t={t} />
      ))}
    </div>
  );
}

function DriftAgentCard({
  agentId,
  status,
  t,
}: {
  agentId: string;
  status: DriftStatus;
  t: UiMessages;
}) {
  const [regenLoading, setRegenLoading] = useState(false);
  const [regenFeedback, setRegenFeedback] = useState<{
    type: 'success' | 'failed';
    message: string;
  } | null>(null);

  const agentMeta = AGENT_META[agentId as AgentId];
  const score = status.driftScore;
  const scoreColor =
    score < 0.1
      ? 'bg-cr-success text-cr-success'
      : score < 0.3
        ? 'bg-cr-warning text-cr-warning'
        : 'bg-destructive text-destructive';

  const handleRegen = async () => {
    setRegenLoading(true);
    setRegenFeedback(null);
    try {
      const result = await api.triggerManualRegen(agentId as AgentId, status.themeId);
      if (result.status === 'success') {
        setRegenFeedback({ type: 'success', message: t.settingsDriftStatusRegenSuccess });
      } else {
        setRegenFeedback({
          type: 'failed',
          message: `${t.settingsDriftStatusRegenFailed}: ${result.reason}`,
        });
      }
    } catch (err) {
      setRegenFeedback({
        type: 'failed',
        message: `${t.settingsDriftStatusRegenFailed}: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setRegenLoading(false);
    }
  };

  const lastCaptureDate = new Date(status.lastCaptureAt);
  const lastCaptureLabel = Number.isNaN(lastCaptureDate.getTime())
    ? '—'
    : format(lastCaptureDate, 'HH:mm:ss');

  const regenDate = status.lastRegenResult ? new Date(status.lastRegenResult.timestamp) : null;
  const regenTimeLabel =
    regenDate && !Number.isNaN(regenDate.getTime()) ? format(regenDate, 'HH:mm:ss') : '—';

  return (
    <div className="rounded-md  overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between  bg-card2 px-3 py-2">
        <div className="flex items-center gap-2">
          <AppMark appId={agentId as AgentId} size={16} />
          <span className="font-mono text-[11px] font-normal  text-foreground">
            {agentMeta?.displayName ?? agentId}
          </span>
          <span className="text-[11px] text-muted-foreground/50">{status.themeId}</span>
        </div>
        <button
          type="button"
          onClick={() => void handleRegen()}
          disabled={regenLoading}
          className={cn(
            'inline-flex items-center gap-1 rounded-md  bg-muted/30 px-2 py-1 as-mono transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50',
          )}
          title={t.settingsDriftStatusManualRegen}
        >
          <RefreshCw className={cn('size-3', regenLoading && 'animate-spin')} />
          {regenLoading ? t.settingsDriftStatusRegening : t.settingsDriftStatusManualRegen}
        </button>
      </div>

      {/* Score row */}
      <div className="flex items-center gap-4  px-3 py-2">
        {/* LED + score */}
        <div className="flex items-center gap-2">
          <span
            className={cn('inline-block size-2 rounded-md', scoreColor.split(' ')[0], 'opacity-80')}
            aria-hidden
          />
          <span className="font-mono text-[10px]  text-muted-foreground/60">
            {t.settingsDriftStatusScore}
          </span>
          <span
            className={cn(
              'font-display text-[13px] font-normal tabular-nums',
              scoreColor.split(' ')[1],
            )}
          >
            {(score * 100).toFixed(0)}%
          </span>
        </div>

        {/* Confidence badge */}
        <span
          className={cn(
            'inline-flex items-center rounded-md  px-1 py-0 font-mono text-[10px] leading-4',
            status.confidence === 'high'
              ? 'bg-cr-success/15 text-cr-success'
              : 'bg-cr-warning/15 text-cr-warning',
          )}
        >
          {status.confidence === 'high'
            ? t.settingsDriftStatusConfidenceHigh
            : t.settingsDriftStatusConfidenceLow}
        </span>

        {/* Last capture */}
        <span className="ml-auto font-mono text-[10px] tabular-nums text-muted-foreground/50">
          {lastCaptureLabel}
        </span>
      </div>

      {/* Signals */}
      {status.signals.length > 0 && (
        <div className="border-t border-border/30  px-3 py-2">
          <p className="mb-1 font-mono text-[10px]  text-muted-foreground/50">
            {t.settingsDriftStatusSignals} ({status.signals.length})
          </p>
          <div className="flex flex-col gap-0">
            {status.signals.map((signal) => (
              <div
                key={`${signal.type}-${signal.detail}`}
                className="flex items-center gap-2 px-1 py-0"
              >
                <span
                  className="inline-block size-1.5 rounded-md bg-cr-warning opacity-60"
                  aria-hidden
                />
                <span className="font-mono text-[10px]  text-muted-foreground/70">
                  {signalTypeLabel(signal.type, t)}
                </span>
                <span className="truncate font-mono text-[10px]  text-foreground">
                  {signal.detail}
                </span>
                <span className="ml-auto shrink-0 font-display text-[10px] tabular-nums text-muted-foreground/40">
                  ×{(signal.weight * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Last regen result */}
      {status.lastRegenResult && (
        <div className="border-t border-border/30  px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px]  text-muted-foreground/50">
              {t.settingsDriftStatusLastRegen}
            </span>
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground/50">
              {regenTimeLabel}
            </span>
          </div>
          <div className="mt-0 flex items-center gap-1">
            <span
              className={cn(
                'inline-flex size-3 items-center justify-center rounded-md font-mono text-[9px]',
                status.lastRegenResult.status === 'success'
                  ? 'bg-cr-success/15 text-cr-success'
                  : status.lastRegenResult.status === 'failed'
                    ? 'bg-destructive/15 text-destructive'
                    : 'bg-muted text-muted-foreground/50',
              )}
            >
              {status.lastRegenResult.status === 'success'
                ? '✓'
                : status.lastRegenResult.status === 'failed'
                  ? '✗'
                  : '–'}
            </span>
            <span className="truncate font-mono text-[10px]  text-muted-foreground/70">
              {status.lastRegenResult.reason}
            </span>
          </div>
        </div>
      )}

      {/* Regen feedback toast (transient) */}
      {regenFeedback && (
        <div
          className={cn(
            'border-t border-border/30  px-3 py-1',
            regenFeedback.type === 'success' ? 'bg-cr-success/5' : 'bg-destructive/5',
          )}
        >
          <span
            className={cn(
              'font-mono text-[10px]',
              regenFeedback.type === 'success' ? 'text-cr-success' : 'text-destructive',
            )}
          >
            {regenFeedback.message}
          </span>
        </div>
      )}
    </div>
  );
}

function signalTypeLabel(type: string, t: UiMessages): string {
  switch (type) {
    case 'selector_hit_drop':
      return t.settingsDrignalTypeSelectorHitDrop;
    case 'accent_shift':
      return t.settingsDrignalTypeAccentShift;
    case 'sheet_mount_failed':
      return t.settingsDrignalTypeSheetMountFailed;
    case 'app_version_change':
      return t.settingsDrignalTypeAppVersionChange;
    default:
      return type;
  }
}
