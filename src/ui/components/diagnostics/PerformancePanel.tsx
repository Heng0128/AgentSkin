// SPDX-License-Identifier: MPL-2.0

/**
 * # PerformancePanel
 *
 * Diagnostics read-only view of the main-process PerformanceLogger ring buffer.
 * Polls `api.getPerformanceHistory(10)` every 5 s (low-fidelity initial version)
 * and renders:
 *
 *   1. Three stat cards — Total Applies, Avg Duration, Per-Agent Avg.
 *   2. A recent-apply table (last 10 traces) with per-step timing breakdown.
 *
 * ## Data flow
 *
 * main/theme-apply-flow → PerformanceLogger (ring buffer, main process)
 *     → PERFORMANCE_GET IPC → api.getPerformanceHistory(10)
 *     → React state refreshed on a 5 s interval.
 *
 * No writes ever flow back — clicking rows or data has no side effect.
 */

import { useEffect, useState } from 'react';
import { api } from '@/api/agentSkinClient';
import { APP_META } from '@/components/app-mark';
import { HugeIcon } from '@/components/ui/huge-icon';
import { cn } from '@/lib/utils';

import { Activity02Icon, HourglassIcon, PieChartIcon } from '@hugeicons/core-free-icons';
import type { UiMessages } from '@shared/i18n';
import { format } from 'date-fns';

// --- Types (mirror AgentSkinApi.getPerformanceHistory response) ---------

interface PerfStep {
  name: string;
  duration: number;
  success: boolean;
  error?: string;
}

interface PerfTrace {
  id: string;
  agentId: string;
  themeId?: string;
  finishedAt: string;
  duration: number;
  success: boolean;
  steps: PerfStep[];
  error?: string;
}

interface PerfStats {
  totalApplies: number;
  avgDurationMs: number;
  perAgentAvg: Record<string, number>;
}

interface PerfHistory {
  recent: PerfTrace[];
  stats: PerfStats;
}

// --- Component -----------------------------------------------------------

const POLL_MS = 5_000;
const HISTORY_COUNT = 10;

/** Safe Date parse — returns null for invalid timestamps. */
function parseDate(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function PerformancePanel({ t }: { t: UiMessages }) {
  const [data, setData] = useState<PerfHistory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const fetchData = async () => {
      try {
        const res = await api.getPerformanceHistory(HISTORY_COUNT);
        if (!cancelled) {
          setData(res);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }
      // Schedule the next tick regardless of success or failure — partial
      // errors from one poll should not stop the whole diagnostics surface.
      if (!cancelled) {
        timer = setTimeout(fetchData, POLL_MS);
      }
    };

    void fetchData();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const stats = data?.stats ?? { totalApplies: 0, avgDurationMs: 0, perAgentAvg: {} };
  const traces = data?.recent ?? [];

  return (
    <div className="flex flex-col gap-3">
      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-2">
        <StatCard
          icon={Activity02Icon}
          label={t.settingsPerfTotalApplies}
          value={String(stats.totalApplies)}
          suffix=""
        />
        <StatCard
          icon={HourglassIcon}
          label={t.settingsPerfAvg}
          value={stats.avgDurationMs > 0 ? String(stats.avgDurationMs) : '—'}
          suffix={stats.avgDurationMs > 0 ? 'ms' : ''}
        />
        <PerAgentCard
          icon={PieChartIcon}
          label={t.settingsPerfAgentAvg}
          perAgentAvg={stats.perAgentAvg}
        />
      </div>

      {/* Recent history table */}
      <div className="rounded-[2px] border border-border overflow-hidden">
        <div className="flex items-center justify-between border-b border-border bg-card2 px-3 py-2">
          <div className="flex items-center gap-2">
            <HugeIcon icon={HourglassIcon} className="size-3.5 text-muted-foreground" />
            <span className="font-mono text-[11px] font-semibold tracking-wide text-foreground">
              {t.settingsPerfRecentHistory}
            </span>
          </div>
          <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground/50">
            {traces.length}/{HISTORY_COUNT}
          </span>
        </div>

        {error ? (
          <div className="px-3 py-4 text-[11px] text-destructive font-mono">{error}</div>
        ) : traces.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
            <div className="flex size-9 items-center justify-center rounded-[2px] bg-muted/60">
              <HugeIcon icon={Activity02Icon} className="size-4 text-muted-foreground/50" />
            </div>
            <p className="text-[11px] text-muted-foreground/70">{t.settingsPerfEmpty}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border bg-muted/20">
                  <TH>{t.settingsPerfColTime}</TH>
                  <TH>{t.settingsPerfColAgent}</TH>
                  <TH className="text-right">{t.settingsPerfColTotal}</TH>
                  <TH>{t.settingsPerfColSteps}</TH>
                  <TH className="text-center">{t.settingsPerfColStatus}</TH>
                </tr>
              </thead>
              <tbody>
                {traces.map((trace) => (
                  <TraceRow key={trace.id} trace={trace} t={t} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Sub-components ------------------------------------------------------

function StatCard({
  icon,
  label,
  value,
  suffix,
}: {
  icon: typeof Activity02Icon;
  label: string;
  value: string;
  suffix: string;
}) {
  return (
    <div
      className="flex flex-col gap-1.5 rounded-[2px] border border-border px-3 py-2.5"
      style={{ background: 'color-mix(in srgb, var(--card) 60%, transparent)' }}
    >
      <div className="flex items-center gap-1.5">
        <HugeIcon icon={icon} className="size-3 text-muted-foreground/70" />
        <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground/60">
          {label}
        </span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="font-display text-[20px] font-bold tabular-nums text-foreground">
          {value}
        </span>
        {suffix && <span className="font-mono text-[9px] text-muted-foreground/50">{suffix}</span>}
      </div>
    </div>
  );
}

function PerAgentCard({
  icon,
  label,
  perAgentAvg,
}: {
  icon: typeof PieChartIcon;
  label: string;
  perAgentAvg: Record<string, number>;
}) {
  const entries = Object.entries(perAgentAvg);

  return (
    <div
      className="flex flex-col gap-1.5 rounded-[2px] border border-border px-3 py-2.5"
      style={{ background: 'color-mix(in srgb, var(--card) 60%, transparent)' }}
    >
      <div className="flex items-center gap-1.5">
        <HugeIcon icon={icon} className="size-3 text-muted-foreground/70" />
        <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground/60">
          {label}
        </span>
      </div>
      {entries.length === 0 ? (
        <span className="font-display text-[20px] font-bold text-muted-foreground/40">—</span>
      ) : (
        <div className="flex flex-col gap-0.5">
          {entries.map(([agentId, avgMs]) => (
            <div key={agentId} className="flex items-center justify-between gap-2">
              <span className="truncate font-mono text-[10px] text-muted-foreground/70">
                {APP_META[agentId as keyof typeof APP_META]?.name ?? agentId}
              </span>
              <span className="shrink-0 font-mono text-[11px] font-semibold tabular-nums text-foreground">
                {avgMs}ms
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TraceRow({ trace, t }: { trace: PerfTrace; t: UiMessages }) {
  const date = parseDate(trace.finishedAt);
  const timeLabel = date ? format(date, 'HH:mm:ss') : '—';
  const fullDate = date ? format(date, 'yyyy-MM-dd HH:mm:ss') : trace.finishedAt;
  const agentName = APP_META[trace.agentId as keyof typeof APP_META]?.name ?? trace.agentId;

  return (
    <tr className="border-b border-border/60 last:border-b-0 hover:bg-muted/20">
      <TD>
        <span className="font-mono text-[10px] text-muted-foreground/70" title={fullDate}>
          {timeLabel}
        </span>
      </TD>
      <TD>
        <div className="flex items-center gap-1.5">
          <AppMarkSmall appId={trace.agentId as keyof typeof APP_META} />
          <span className="font-mono text-[10.5px] text-foreground truncate max-w-[80px]">
            {agentName}
          </span>
        </div>
      </TD>
      <TD className="text-right">
        <DurationBadge ms={trace.duration} success={trace.success} />
      </TD>
      <TD>
        <div className="flex flex-wrap gap-1">
          {trace.steps.map((step) => (
            <span
              key={step.name}
              className={cn(
                'inline-flex items-center rounded-[2px] border px-1 py-0 font-mono text-[9px] leading-4',
                step.success
                  ? 'border-border bg-muted/30 text-muted-foreground/80'
                  : 'border-destructive/30 bg-destructive/10 text-destructive',
              )}
              title={step.error ?? `${step.name}: ${step.duration}ms ${step.success ? '✓' : '✗'}`}
            >
              {step.name} {step.duration}ms{step.success ? '' : ' ✗'}
            </span>
          ))}
        </div>
      </TD>
      <TD className="text-center">
        {trace.success ? (
          <span className="inline-flex size-4 items-center justify-center rounded-[2px] bg-cr-success/15 font-mono text-[9px] text-cr-success">
            ✓
          </span>
        ) : (
          <span
            className="inline-flex size-4 items-center justify-center rounded-[2px] bg-destructive/15 font-mono text-[9px] text-destructive"
            title={trace.error ?? t.settingsPerfStatusFailed}
          >
            ✗
          </span>
        )}
      </TD>
    </tr>
  );
}

// --- Tiny table-cell wrappers (keep markup DRY) --------------------------

function TH({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={cn(
        'px-2 py-1.5 text-left font-mono text-[9px] uppercase tracking-wider text-muted-foreground/50',
        className,
      )}
    >
      {children}
    </th>
  );
}

function TD({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn('px-2 py-1.5', className)}>{children}</td>;
}

// --- Duration color-coded badge ------------------------------------------

function DurationBadge({ ms, success }: { ms: number; success: boolean }) {
  const tone = !success
    ? 'text-destructive'
    : ms < 500
      ? 'text-cr-success'
      : ms < 2000
        ? 'text-foreground'
        : 'text-cr-warning';

  return (
    <span className={cn('font-mono text-[11px] font-semibold tabular-nums', tone)}>{ms}ms</span>
  );
}

// --- Lightweight icon for use inside table rows --------------------------

const APP_ICONS: Record<string, string> = {
  workbuddy: '../assets/apps/workbuddy.png',
  qoderwork: '../assets/apps/qoderwork.png',
  traework: '../assets/apps/traework.png',
  doubao: '../assets/apps/doubao.png',
  codex: '../assets/apps/codex.png',
  zcode: '../assets/apps/zcode.png',
};

function AppMarkSmall({ appId }: { appId: keyof typeof APP_META }) {
  const iconUrl = APP_ICONS[String(appId)];
  if (iconUrl) {
    return <img src={iconUrl} className="size-3.5 rounded-[2px]" width={14} height={14} alt="" />;
  }
  return (
    <span className="inline-flex size-3.5 items-center justify-center rounded-[2px] bg-muted font-mono text-[7px] text-muted-foreground/50">
      ?
    </span>
  );
}
