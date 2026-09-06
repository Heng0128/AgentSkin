// SPDX-License-Identifier: MPL-2.0

/**
 * # CdpPerformancePanel
 *
 * Lightweight real-time CDP performance HUD overlay. Collapsed by default into
 * a compact top-right floating badge; expands to reveal full metrics:
 *
 *   1. CDP connection status — active session count, P99 latency, reconnect tally.
 *   2. Injection throughput — operations per minute (rolling 60s window).
 *   3. Memory trend — heapUsed / RSS sparkline from main-process samples.
 *
 * ## Data flow
 *
 * main process → performance:cdp-metrics IPC → useDiagnosticsSync → store
 * main process → performance:new-trace IPC → useDiagnosticsSync → store
 * api.getPerformanceMemory() → loadMemorySamples() → store.memorySamples
 *
 * A 1s local tick recalculates `operationsPerMinute` from the trace window.
 *
 * Swiss/International design: 11px base font, tabular-nums for all numeric
 * values, mono accents, no scale/slide animations, single accent color.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useDiagnosticsStore } from '@/stores/diagnosticsStore';

import type { UiMessages } from '@shared/i18n';
import { Activity, ChevronDown, ChevronUp, Cpu, Wifi, WifiOff } from 'lucide-react';

// --- Constants -----------------------------------------------------------

/** Local recalculation interval for operationsPerMinute (1s). */
const OPS_INTERVAL_MS = 1_000;
/** Sparkline SVG dimensions. */
const SPARKLINE_WIDTH = 120;
const SPARKLINE_HEIGHT = 32;
/** Number of samples visible in the sparkline. */
const SPARKLINE_SAMPLES = 30;

// --- Component -----------------------------------------------------------

export function CdpPerformancePanel({ t }: { t: UiMessages }) {
  const [expanded, setExpanded] = useState(false);

  const cdpSessionCount = useDiagnosticsStore((s) => s.cdpSessionCount);
  const cdpReconnectCount = useDiagnosticsStore((s) => s.cdpReconnectCount);
  const operationsPerMinute = useDiagnosticsStore((s) => s.operationsPerMinute);
  const recentTraces = useDiagnosticsStore((s) => s.recentTraces);
  const memorySamples = useDiagnosticsStore((s) => s.memorySamples);
  const loadMemorySamples = useDiagnosticsStore((s) => s.loadMemorySamples);
  const calculateOperationsPerMinute = useDiagnosticsStore((s) => s.calculateOperationsPerMinute);

  // Load memory samples on mount.
  useEffect(() => {
    void loadMemorySamples();
  }, [loadMemorySamples]);

  // 1s tick: recalculate operations per minute only when new traces arrive.
  const lastTraceCount = useRef(0);
  useEffect(() => {
    calculateOperationsPerMinute();
    lastTraceCount.current = recentTraces.length;
  }, [calculateOperationsPerMinute, recentTraces.length]);

  useEffect(() => {
    const timer = setInterval(() => {
      // Only recalculate when trace count changed since last check
      if (recentTraces.length !== lastTraceCount.current) {
        calculateOperationsPerMinute();
        lastTraceCount.current = recentTraces.length;
      }
    }, OPS_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [calculateOperationsPerMinute, recentTraces.length]);

  // Compute P99 latency from recent traces (last 10 traces).
  const p99Latency = useMemo(() => {
    if (recentTraces.length === 0) return 0;
    const durations = recentTraces
      .slice(0, 10)
      .map((tr) => tr.duration)
      .sort((a, b) => a - b);
    const idx = Math.min(Math.ceil(durations.length * 0.99) - 1, durations.length - 1);
    return durations[Math.max(0, idx)];
  }, [recentTraces]);

  const toggleExpanded = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  return (
    <div className="fixed right-4 top-4 z-50 flex flex-col items-end gap-2">
      {/* Expanded HUD panel */}
      {expanded && (
        <div
          className="flex flex-col gap-3 rounded-md border border-border bg-card px-4 py-3 shadow-sm"
          style={{ minWidth: 240 }}
        >
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Cpu className="size-3 text-muted-foreground/70" />
              <span className="text-[11px] font-normal text-foreground">
                {t.settingsCdpHudTitle}
              </span>
            </div>
            <button
              type="button"
              onClick={toggleExpanded}
              className="inline-flex items-center rounded-md px-1 py-0 text-[11px] text-muted-foreground hover:bg-muted/30 hover:text-foreground"
              title={t.settingsCdpHudCollapse}
              aria-label={t.settingsCdpHudCollapse}
            >
              <ChevronUp className="size-3" />
            </button>
          </div>

          {/* CDP Connection Status */}
          <div className="flex flex-col gap-2">
            <MetricRow
              icon={cdpSessionCount > 0 ? Wifi : WifiOff}
              label={t.settingsCdpHudSessions}
              value={String(cdpSessionCount)}
              tone={cdpSessionCount > 0 ? 'success' : 'muted'}
            />
            <MetricRow
              icon={Activity}
              label={t.settingsCdpHudLatency}
              value={p99Latency > 0 ? `${p99Latency}ms` : '—'}
              tone={p99Latency >= 2000 ? 'warning' : 'foreground'}
            />
            <MetricRow
              icon={Cpu}
              label={t.settingsCdpHudReconnects}
              value={String(cdpReconnectCount)}
              tone={cdpReconnectCount > 5 ? 'warning' : 'foreground'}
            />
          </div>

          {/* Divider */}
          <div className="h-px bg-border/60" />

          {/* Throughput */}
          <div className="flex flex-col gap-1">
            <span className="text-[10px] text-muted-foreground/60">{t.settingsCdpHudOpsMin}</span>
            <span className="font-display text-[20px] font-normal tabular-nums text-foreground">
              {operationsPerMinute}
            </span>
          </div>

          {/* Memory Trend Sparkline */}
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground/60">{t.settingsCdpHudMemory}</span>
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/50">
                  <span className="inline-block size-1 rounded-full bg-cr-info" />
                  {t.settingsCdpHudHeap}
                </span>
                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/50">
                  <span className="inline-block size-1 rounded-full bg-cr-success" />
                  {t.settingsCdpHudRss}
                </span>
              </div>
            </div>
            <MemorySparkline samples={memorySamples} />
          </div>
        </div>
      )}

      {/* Collapsed floating badge */}
      <button
        type="button"
        onClick={toggleExpanded}
        className={cn(
          'inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 shadow-sm transition-colors hover:bg-muted',
          expanded && 'hidden',
        )}
        title={expanded ? t.settingsCdpHudCollapse : t.settingsCdpHudExpand}
        aria-label={expanded ? t.settingsCdpHudCollapse : t.settingsCdpHudExpand}
      >
        {cdpSessionCount > 0 ? (
          <Wifi className="size-3 text-cr-success" />
        ) : (
          <WifiOff className="size-3 text-muted-foreground/50" />
        )}
        <span className="font-display text-[11px] tabular-nums text-foreground">
          {cdpSessionCount}
        </span>
        <span className="text-[10px] text-muted-foreground/50">|</span>
        <span className="font-display text-[11px] tabular-nums text-foreground">
          {operationsPerMinute}/m
        </span>
        <ChevronDown className="size-3 text-muted-foreground/50" />
      </button>
    </div>
  );
}

// --- Sub-components ------------------------------------------------------

function MetricRow({
  icon,
  label,
  value,
  tone,
}: {
  icon: typeof Wifi;
  label: string;
  value: string;
  tone: 'success' | 'warning' | 'foreground' | 'muted';
}) {
  const Icon = icon;
  const toneClass =
    tone === 'success'
      ? 'text-cr-success'
      : tone === 'warning'
        ? 'text-cr-warning'
        : tone === 'muted'
          ? 'text-muted-foreground/40'
          : 'text-foreground';

  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1">
        <Icon className="size-3 text-muted-foreground/60" />
        <span className="text-[11px] text-muted-foreground/70">{label}</span>
      </div>
      <span className={cn('font-display text-[11px] font-normal tabular-nums', toneClass)}>
        {value}
      </span>
    </div>
  );
}

function MemorySparkline({
  samples,
}: {
  samples: Array<{ ts: number; heapUsed: number; rss: number }>;
}) {
  const visible = samples.slice(-SPARKLINE_SAMPLES);

  if (visible.length < 2) {
    return (
      <div
        className="flex items-center justify-center rounded-md bg-muted/10 text-[10px] text-muted-foreground/40"
        style={{ width: SPARKLINE_WIDTH, height: SPARKLINE_HEIGHT }}
      >
        Collecting…
      </div>
    );
  }

  const heapValues = visible.map((s) => s.heapUsed);
  const rssValues = visible.map((s) => s.rss);
  const allValues = [...heapValues, ...rssValues];
  const maxVal = Math.max(...allValues);
  const minVal = Math.min(...allValues);
  const range = maxVal - minVal || 1;

  const toPath = (values: number[]): string => {
    const step = SPARKLINE_WIDTH / (values.length - 1);
    return values
      .map((v, i) => {
        const x = i * step;
        const y = SPARKLINE_HEIGHT - ((v - minVal) / range) * SPARKLINE_HEIGHT;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  };

  const heapPath = toPath(heapValues);
  const rssPath = toPath(rssValues);

  return (
    <div
      className="rounded-md bg-muted/10"
      style={{ width: SPARKLINE_WIDTH, height: SPARKLINE_HEIGHT }}
    >
      <svg
        width={SPARKLINE_WIDTH}
        height={SPARKLINE_HEIGHT}
        viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d={heapPath} fill="none" stroke="var(--cr-info)" strokeWidth={1} />
        <path d={rssPath} fill="none" stroke="var(--cr-success)" strokeWidth={1} />
      </svg>
    </div>
  );
}
