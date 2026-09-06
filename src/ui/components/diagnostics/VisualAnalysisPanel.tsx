// SPDX-License-Identifier: MPL-2.0

/**
 * # VisualAnalysisPanel
 *
 * Diagnostics panel for the Visual Analysis subsystem. Displays:
 *   1. Available analysis targets (agent names with stored snapshots)
 *   2. All analysis summaries (compact overview grid)
 *   3. Detection result for a specific agent (running? port?)
 *   4. Export button to save an analysis as a theme package
 *   5. Real-time progress bar during analysis operations
 *
 * Data flows from `useVisualAnalysisStore` + `useVisualAnalysisSync`.
 */

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Progress } from '@/components/ui/progress';
import { Spinner } from '@/components/ui/spinner';
import { useVisualAnalysisSync } from '@/hooks/useVisualAnalysisSync';
import { cn } from '@/lib/utils';
import { useVisualAnalysisStore } from '@/stores/visualAnalysisStore';

import {
  Activity,
  CheckCircle2,
  Cpu,
  Download,
  Eye,
  EyeOff,
  ImageIcon,
  Search,
  Target,
} from 'lucide-react';

export function VisualAnalysisPanel() {
  const {
    targets,
    summaries,
    detection,
    progress,
    loading,
    exportResult,
    loadTargets,
    loadSummaries,
    loadTarget,
    detectAgent,
    exportTheme,
  } = useVisualAnalysisStore();

  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  // Subscribe to real-time progress events
  useVisualAnalysisSync();

  // Load targets & summaries on mount
  useEffect(() => {
    void loadTargets();
    void loadSummaries();
  }, [loadTargets, loadSummaries]);

  // Handle export: load target data first, then export.
  // Use subscribe to wait for currentTarget to update after loadTarget,
  // avoiding the race condition where getState() reads a stale value
  // if loadTarget resolves before the store update propagates.
  const handleExport = async (agentId: string) => {
    const target = await new Promise<Record<string, unknown> | null>((resolve) => {
      void loadTarget(agentId);
      const unsub = useVisualAnalysisStore.subscribe((state) => {
        if (state.currentTarget) {
          unsub();
          resolve(state.currentTarget);
        }
      });
      // Timeout fallback: if currentTarget never appears within 5s, proceed
      // with null (exportTheme will reject with a clear error).
      setTimeout(() => {
        unsub();
        resolve(null);
      }, 5000);
    });
    void exportTheme(agentId, target ?? {});
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Progress bar */}
      {progress && (
        <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
              <Activity className="size-3 text-primary" />
              {progress.agent} — {progress.step}
            </span>
            <span className="text-[11px] tabular-nums text-muted-foreground">
              {progress.progress}%
            </span>
          </div>
          <Progress value={progress.progress} size="sm" />
        </div>
      )}

      {/* CDP live-extract unavailable notice */}
      <div className="flex items-start gap-2 rounded-lg border border-cr-warning/30 bg-cr-warning/10 p-2.5 text-[11px] text-cr-warning">
        <ImageIcon className="mt-0.5 size-3.5 shrink-0" />
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">Live CDP extraction unavailable</span>
          <span className="text-cr-warning/80">
            Real-time browser extraction is not implemented yet. Use the image import feature to
            analyze themes from screenshots instead.
          </span>
        </div>
      </div>

      {/* Export result toast */}
      {exportResult && (
        <div
          className={cn(
            'flex items-center gap-2 rounded-lg border p-2.5 text-[11px]',
            exportResult.ok
              ? 'border-cr-success/30 bg-cr-success/10 text-cr-success'
              : 'border-destructive/30 bg-destructive/10 text-destructive',
          )}
        >
          {exportResult.ok ? (
            <CheckCircle2 className="size-3.5" />
          ) : (
            <EyeOff className="size-3.5" />
          )}
          {exportResult.ok && exportResult.path
            ? `Exported: ${exportResult.path}`
            : 'Export failed'}
        </div>
      )}

      {/* Targets list */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
            <Target className="size-3.5 text-primary" />
            Analysis Targets
          </h3>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => void loadTargets()}
            disabled={loading.targets}
          >
            {loading.targets ? <Spinner /> : <Search className="size-3" />}
            Refresh
          </Button>
        </div>
        {targets.length === 0 ? (
          <EmptyState
            icon={<Target />}
            title="No targets"
            hint="No agent analysis data found. Run visual analysis from the main process."
            iconSize="sm"
          />
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {targets.map((agent) => (
              <button
                key={`va-target-${agent}`}
                type="button"
                onClick={() => {
                  setSelectedAgent(agent);
                  void detectAgent(agent);
                }}
                className={cn(
                  'rounded-md border px-2.5 py-1 text-[11px] font-medium transition-all duration-base hover:border-primary hover:text-primary',
                  selectedAgent === agent
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-card text-foreground',
                )}
              >
                {agent}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Detection result */}
      {detection && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-card p-2.5">
          <div className="flex items-center gap-2">
            <Cpu
              className={cn(
                'size-3.5',
                detection.running ? 'text-cr-success' : 'text-muted-foreground',
              )}
            />
            <span className="text-[11px] font-medium text-foreground">{detection.agent}</span>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            {detection.running ? (
              <>
                <span className="text-cr-success">Running</span>
                {detection.port && <span>Port: {detection.port}</span>}
                {detection.title && <span>{detection.title}</span>}
              </>
            ) : (
              <span>Not running</span>
            )}
          </div>
        </div>
      )}

      {/* Summaries grid */}
      <div className="flex flex-col gap-2">
        <h3 className="flex items-center gap-1.5 text-[12px] font-semibold text-foreground">
          <Eye className="size-3.5 text-primary" />
          Analysis Summaries
        </h3>
        {loading.summaries ? (
          <div className="flex items-center gap-2 py-4">
            <Spinner /> <span className="text-[11px] text-muted-foreground">Loading...</span>
          </div>
        ) : summaries.length === 0 ? (
          <EmptyState
            icon={<Eye />}
            title="No summaries"
            hint="No visual analysis summaries available."
            iconSize="sm"
          />
        ) : (
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {summaries.map((summary) => (
              <div
                key={`va-summary-${summary.id}`}
                className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-2.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium text-foreground">{summary.id}</span>
                  {summary.brandDark && (
                    <span
                      className="size-3 rounded-md border border-border"
                      style={{ backgroundColor: summary.brandDark }}
                    />
                  )}
                </div>
                <div className="flex gap-3 text-[11px] text-muted-foreground">
                  <span>Light: {summary.tokensLight}</span>
                  <span>Dark: {summary.tokensDark}</span>
                </div>
                {summary.categories.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {summary.categories.slice(0, 3).map((cat) => (
                      <span
                        key={`cat-${summary.id}-${cat}`}
                        className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                      >
                        {cat}
                      </span>
                    ))}
                  </div>
                )}
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => void handleExport(summary.id)}
                  disabled={loading.export || loading.target}
                >
                  <Download className="size-3" />
                  Export
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
