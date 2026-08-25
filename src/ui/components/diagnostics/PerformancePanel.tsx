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
import { APP_META } from '@/components/AppMark';
import { EmptyState } from '@/components/ui/empty-state';
import { cn } from '@/lib/utils';
import { useDiagnosticsStore } from '@/stores/diagnosticsStore';
import { useShellStore } from '@/stores/shellStore';

import type { UiMessages } from '@shared/i18n';
import { format } from 'date-fns';
import { enUS, zhCN } from 'date-fns/locale';
import { Activity, Hourglass, PieChart, Trash2 } from 'lucide-react';

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
  overflowCount: number;
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

  const timeoutEvents = useDiagnosticsStore((s) => s.timeoutEvents);
  const timeoutsLoading = useDiagnosticsStore((s) => s.timeoutsLoading);
  const storeLoadTimeouts = useDiagnosticsStore((s) => s.loadTimeouts);
  const storeClearTimeouts = useDiagnosticsStore((s) => s.clearTimeouts);

  // Timeouts: auto-poll on the same 5s cadence as trace history.
  useEffect(() => {
    void storeLoadTimeouts();
    const timer = setInterval(() => {
      void storeLoadTimeouts();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [storeLoadTimeouts]);

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

  const stats = data?.stats ?? {
    totalApplies: 0,
    avgDurationMs: 0,
    perAgentAvg: {},
    overflowCount: 0,
  };
  const traces = data?.recent ?? [];

  return (
    <div className="flex flex-col gap-3">
      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-2">
        <StatCard
          icon={Activity}
          label={t.settingsPerfTotalApplies}
          value={String(stats.totalApplies)}
          suffix=""
        />
        <StatCard
          icon={Hourglass}
          label={t.settingsPerfAvg}
          value={stats.avgDurationMs > 0 ? String(stats.avgDurationMs) : '—'}
          suffix={stats.avgDurationMs > 0 ? 'ms' : ''}
        />
        <PerAgentCard
          icon={PieChart}
          label={t.settingsPerfAgentAvg}
          perAgentAvg={stats.perAgentAvg}
        />
      </div>

      {/* Recent history table */}
      <div className="rounded-md  overflow-hidden">
        <div className="flex items-center justify-between  bg-card2 px-3 py-2">
          <div className="flex items-center gap-2">
            <Hourglass className="size-4 text-muted-foreground" />
            <span className="text-[11px] font-normal  text-foreground">
              {t.settingsPerfRecentHistory}
            </span>
          </div>
          <span className="text-[11px]   text-muted-foreground/50">
            {traces.length}/{HISTORY_COUNT}
          </span>
        </div>

        {error ? (
          <div className="px-3 py-4 text-[11px] text-destructive">{error}</div>
        ) : traces.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <EmptyState icon={<Activity />} title={t.settingsPerfEmpty} iconSize="md" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className=" bg-muted/20">
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

      {/* Overflow warning — visible only when the ring buffer has discarded traces */}
      {stats.overflowCount > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-cr-warning/30 bg-cr-warning/10 px-3 py-2">
          <span className="text-[11px] text-cr-warning">
            ⚠ {t.settingsPerfOverflow(stats.overflowCount)}
          </span>
        </div>
      )}

      {/* Recent IPC timeouts */}
      <div className="rounded-md  overflow-hidden">
        <div className="flex items-center justify-between  bg-card2 px-3 py-2">
          <div className="flex items-center gap-2">
            <Trash2 className="size-4 text-muted-foreground" />
            <span className="text-[11px] font-normal  text-foreground">
              {t.settingsPerfTimeoutTitle}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void storeClearTimeouts()}
            disabled={timeoutsLoading}
            className="inline-flex items-center gap-1 rounded-md  bg-muted/30 px-2 py-0 text-[11px]   text-muted-foreground hover:bg-muted disabled:opacity-50"
            title={t.settingsPerfTimeoutClear}
          >
            {timeoutsLoading ? t.settingsPerfTimeoutClearing : t.settingsPerfTimeoutClear}
          </button>
        </div>

        {timeoutEvents.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <EmptyState icon={<Trash2 />} title={t.settingsPerfTimeoutEmpty} iconSize="md" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className=" bg-muted/20">
                  <TH>{t.settingsPerfTimeoutColTime}</TH>
                  <TH>{t.settingsPerfTimeoutColChannel}</TH>
                  <TH className="text-right">{t.settingsPerfTimeoutColMs}</TH>
                </tr>
              </thead>
              <tbody>
                {timeoutEvents.map((ev) => (
                  <TimeoutRow key={ev.id} event={ev} />
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
  icon: typeof Activity;
  label: string;
  value: string;
  suffix: string;
}) {
  const Icon = icon;
  return (
    <div
      className="flex flex-col gap-1 rounded-md  px-3 py-2"
      style={{ background: 'color-mix(in srgb, var(--card) 60%, transparent)' }}
    >
      <div className="flex items-center gap-1">
        <Icon className="size-3 text-muted-foreground/70" />
        <span className="text-[11px]   text-muted-foreground/60">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="font-display text-[20px] font-normal tabular-nums text-foreground">
          {value}
        </span>
        {suffix && <span className="font-mono text-[10px] text-muted-foreground/50">{suffix}</span>}
      </div>
    </div>
  );
}

function PerAgentCard({
  icon,
  label,
  perAgentAvg,
}: {
  icon: typeof PieChart;
  label: string;
  perAgentAvg: Record<string, number>;
}) {
  const Icon = icon;
  const entries = Object.entries(perAgentAvg);

  return (
    <div
      className="flex flex-col gap-1 rounded-md  px-3 py-2"
      style={{ background: 'color-mix(in srgb, var(--card) 60%, transparent)' }}
    >
      <div className="flex items-center gap-1">
        <Icon className="size-3 text-muted-foreground/70" />
        <span className="text-[11px]   text-muted-foreground/60">{label}</span>
      </div>
      {entries.length === 0 ? (
        <span className="font-display text-[20px] font-normal text-muted-foreground/40">—</span>
      ) : (
        <div className="flex flex-col gap-0">
          {entries.map(([agentId, avgMs]) => (
            <div key={agentId} className="flex items-center justify-between gap-2">
              <span className="truncate font-mono text-[10px] text-muted-foreground/70">
                {APP_META[agentId as keyof typeof APP_META]?.name ?? agentId}
              </span>
              <span className="shrink-0 font-display text-[11px] font-normal tabular-nums text-foreground">
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
  const locale = useShellStore((s) => s.locale);
  const dateLocale = locale === 'en' ? enUS : zhCN;
  const date = parseDate(trace.finishedAt);
  const timeLabel = date ? format(date, 'HH:mm:ss', { locale: dateLocale }) : '—';
  const fullDate = date
    ? format(date, 'yyyy-MM-dd HH:mm:ss', { locale: dateLocale })
    : trace.finishedAt;
  const agentName = APP_META[trace.agentId as keyof typeof APP_META]?.name ?? trace.agentId;

  return (
    <tr className=" last:border-b-0">
      <TD>
        <span className="font-mono text-[10px] text-muted-foreground/70" title={fullDate}>
          {timeLabel}
        </span>
      </TD>
      <TD>
        <div className="flex items-center gap-1">
          <AppMarkSmall appId={trace.agentId as keyof typeof APP_META} />
          <span className="font-mono text-[10px] text-foreground truncate max-w-[80px]">
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
                'inline-flex items-center rounded-md border px-1 py-0 font-mono text-[10px] leading-4',
                step.success
                  ? 'bg-muted/30 text-muted-foreground/80'
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
          <span className="inline-flex size-4 items-center justify-center rounded-md bg-cr-success/15 font-mono text-[10px] text-cr-success">
            ✓
          </span>
        ) : (
          <span
            className="inline-flex size-4 items-center justify-center rounded-md bg-destructive/15 font-mono text-[10px] text-destructive"
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

function TimeoutRow({
  event,
}: {
  event: { id: string; channel: string; ms: number; timestamp: number };
}) {
  const date = new Date(event.timestamp);
  const timeLabel = Number.isNaN(date.getTime()) ? '—' : format(date, 'HH:mm:ss');

  return (
    <tr className=" last:border-b-0">
      <TD>
        <span className="font-mono text-[10px] text-muted-foreground/70">{timeLabel}</span>
      </TD>
      <TD>
        <span className="font-mono text-[10px] text-foreground truncate max-w-[200px]">
          {event.channel}
        </span>
      </TD>
      <TD className="text-right">
        <span className="font-mono text-[11px] font-normal tabular-nums text-cr-warning">
          {event.ms}ms
        </span>
      </TD>
    </tr>
  );
}

function TH({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={cn('px-3 py-2 text-left text-[10px] text-muted-foreground', className)}>
      {children}
    </th>
  );
}

function TD({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn('px-2 py-1', className)}>{children}</td>;
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
    <span className={cn('font-display text-[11px] font-normal tabular-nums', tone)}>{ms}ms</span>
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
    return <img src={iconUrl} className="size-4 rounded-md" width={14} height={14} alt="" />;
  }
  return (
    <span className="inline-flex size-4 items-center justify-center rounded-md bg-muted text-[10px] text-muted-foreground/50">
      ?
    </span>
  );
}
