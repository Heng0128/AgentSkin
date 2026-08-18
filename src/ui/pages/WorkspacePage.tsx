// SPDX-License-Identifier: MPL-2.0

/**
 * # WorkspacePage — Live Tweak
 *
 * Real-time micro-adjustment panel. The user picks a running agent from the
 * left rail, then tunes radius / spacing / shadow / color / font size with
 * instant feedback in the preview pane — no full theme re-apply required.
 *
 * Layout (CSS grid on .wt-root):
 *   ┌────────────┬────────────────────────────────────────────┐
 *   │ topbar     │  title                          [刷新状态] │
 *   ├────────────┼────────────────────────────────────────────┤
 *   │ agent rail │  AgentLivePreview                        │
 *   │ (running)  │  TweakPanel                              │
 *   │            │                          [保存] [丢弃]  │
 *   └────────────┴────────────────────────────────────────────┘
 *
 * Data flow:
 *   statusStore.status.apps  ──(filter running+port)──▶  agent rail
 *   workspaceStore.currentAgentId / currentPort       ◀── click agent
 *   workspaceStore.currentOverrides                   ◀── TweakPanel onChange
 *   └─▶ api.pushTweak (real-time) + AgentDomPreview (local replay)
 */

import { useEffect, useMemo } from 'react';
import { api } from '@/api/agentSkinClient';
import { AppMark } from '@/components/app-mark';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { AgentLivePreview } from '@/components/workspace/AgentLivePreview';
import { TweakPanel } from '@/components/workspace/TweakPanel';
import { useDiagnosticsStore } from '@/stores/diagnosticsStore';
import { useShellStore } from '@/stores/shellStore';
import { useStatusStore } from '@/stores/statusStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { ToolOverride } from '@/types/override';

import { type UiMessages, uiMessages } from '@shared/i18n';
import type { AppStatus } from '@shared/types';
import { AlertTriangle, CheckCircle, RefreshCw, XCircle } from 'lucide-react';

/** Read current i18n message table (project-standard pattern). */
function currentT(): UiMessages {
  return uiMessages[useShellStore.getState().locale];
}

export function WorkspacePage() {
  const t = currentT();

  const status = useStatusStore((s) => s.status);
  const isRefreshing = useStatusStore((s) => s.isRefreshing);
  const refreshStatus = useStatusStore((s) => s.refreshStatus);

  const currentAgentId = useWorkspaceStore((s) => s.currentAgentId);
  const currentOverrides = useWorkspaceStore((s) => s.currentOverrides);
  const dirty = useWorkspaceStore((s) => s.dirty);
  const selectAgent = useWorkspaceStore((s) => s.selectAgent);
  const updateOverride = useWorkspaceStore((s) => s.updateOverride);
  const saveChanges = useWorkspaceStore((s) => s.saveChanges);
  const discardChanges = useWorkspaceStore((s) => s.discardChanges);
  const pushError = useWorkspaceStore((s) => s.pushError);
  const clearPushError = useWorkspaceStore((s) => s.clearPushError);

  const healthReport = useDiagnosticsStore((s) => s.healthReport);
  const setHealthReport = useDiagnosticsStore((s) => s.setHealthReport);

  /** Subscribe to theme health reports pushed from the main process. */
  useEffect(() => {
    const unsubscribe = api.onThemeHealthReport(setHealthReport);
    return unsubscribe;
  }, [setHealthReport]);

  /** Running agents that expose a CDP port — eligible for live tweaking. */
  const runningAgents = useMemo(
    () => (status?.apps ?? []).filter((a) => a.running && a.port !== null) as AppStatus[],
    [status],
  );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* ---------------------------------------------------------------- */}
      {/* Top bar — title + refresh                                         */}
      {/* ---------------------------------------------------------------- */}
      <header className="flex shrink-0 items-center justify-between  px-4 py-3">
        <h1 className="font-display text-sm font-bold tracking-tight">{t.navWorkspace}</h1>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => void refreshStatus()}
          disabled={isRefreshing}
          className="gap-1"
        >
          {isRefreshing ? <Spinner className="size-3" /> : <RefreshCw className="size-3" />}
          <span className="text-[11px]">{t.workspaceRefreshStatus}</span>
        </Button>
      </header>

      {/* ---------------------------------------------------------------- */}
      {/* Health status bar — theme injection diagnostics                  */}
      {/* ---------------------------------------------------------------- */}
      {healthReport ? (
        <div className="flex items-center gap-4  px-4 py-2 bg-[var(--bg-2)] border border-[var(--border-subtle)] rounded-[2px] mx-4 mb-3">
          {/* Score with color indicator */}
          <span className="flex items-center gap-2">
            {healthReport.score >= 80 ? (
              <CheckCircle className="size-3.5 text-green-500" />
            ) : healthReport.score >= 50 ? (
              <AlertTriangle className="size-3.5 text-yellow-500" />
            ) : (
              <XCircle className="size-3.5 text-red-500" />
            )}
            <span className="font-mono text-[11px] tabular-nums">
              {t.workspaceHealthScore}: {healthReport.score}
            </span>
          </span>

          {/* Blocking count — red warning when > 0 */}
          <span className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">{t.workspaceHealthBlocking}:</span>
            <span
              className={`font-mono text-[11px] tabular-nums ${
                healthReport.blockingCount > 0
                  ? 'text-red-500 font-medium'
                  : 'text-muted-foreground'
              }`}
            >
              {healthReport.blockingCount}
            </span>
          </span>

          {/* Theme sheet indicator */}
          <span className="flex items-center gap-2">
            <span
              className={`size-2 rounded-full ${healthReport.themeSheetPresent ? 'bg-green-500' : 'bg-muted-foreground/40'}`}
              aria-hidden
            />
            <span className="text-[11px] text-muted-foreground">
              {t.workspaceHealthSheetPresent}
            </span>
          </span>

          {/* Hero art indicator */}
          <span className="flex items-center gap-2">
            <span
              className={`size-2 rounded-full ${healthReport.heroArtActive ? 'bg-green-500' : 'bg-muted-foreground/40'}`}
              aria-hidden
            />
            <span className="text-[11px] text-muted-foreground">{t.workspaceHealthArtActive}</span>
          </span>

          {/* Agent + timestamp */}
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">
            {healthReport.agentId} @ {new Date(healthReport.timestamp).toLocaleTimeString()}
          </span>
        </div>
      ) : (
        <div className="flex items-center  px-4 py-2 bg-[var(--bg-2)] border border-[var(--border-subtle)] rounded-[2px] mx-4 mb-3">
          <span className="text-[11px] text-muted-foreground">{t.workspaceHealthSelectAgent}</span>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Body — two-column grid: agent rail / preview+tweak               */}
      {/* ---------------------------------------------------------------- */}
      <div className="grid min-h-0 flex-1 grid-cols-[200px_1fr]">
        {/* Agent rail */}
        <aside className="flex flex-col gap-2 overflow-y-auto  px-3 py-3">
          <span className="px-1 text-[11px] tracking-tight text-muted-foreground ">
            {t.workspaceRunningApps}
          </span>
          {runningAgents.length === 0 ? (
            <p className="px-1 py-4 text-[11px] text-muted-foreground">
              {t.workspaceNoRunningAgents}
            </p>
          ) : (
            runningAgents.map((app) => {
              const active = app.appId === currentAgentId;
              return (
                <button
                  key={app.appId}
                  type="button"
                  onClick={() => selectAgent(app.appId, app.port ?? 0)}
                  className={`flex w-full items-center gap-2 rounded-md border px-2 py-2 text-left transition-colors ${
                    active ? 'border-primary/40 bg-primary/5' : 'border-transparent hover:bg-card'
                  }`}
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-accent">
                    <AppMark appId={app.appId} size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-medium leading-tight">
                      {app.displayName}
                    </span>
                    <span className="block font-mono text-[10px] tabular-nums text-muted-foreground">
                      :{app.port}
                    </span>
                  </span>
                  <span
                    className={`size-1.5 shrink-0 rounded-full ${active ? 'bg-primary' : 'bg-muted-foreground/40'}`}
                    aria-hidden
                  />
                </button>
              );
            })
          )}
        </aside>

        {/* Preview + tweak column */}
        <main className="flex min-w-0 flex-col gap-4 overflow-y-auto px-4 py-3">
          {currentAgentId === null ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-[11px] text-muted-foreground">{t.workspaceSelectAgentHint}</p>
            </div>
          ) : (
            <>
              {/* Preview pane */}
              <section className="flex min-h-0 flex-col">
                <span className="mb-2 text-[11px] tracking-tight text-muted-foreground ">
                  {t.workspacePreview}
                </span>
                <AgentLivePreview agentId={currentAgentId} overrides={currentOverrides} t={t} />
              </section>

              {/* Tweak controls */}
              <section className="flex flex-col gap-3  pt-3">
                <span className="text-[11px] tracking-tight text-muted-foreground ">
                  {t.workspaceTweakControls}
                </span>
                {pushError && (
                  <div
                    role="alert"
                    className="mb-5 flex items-center justify-between gap-3 rounded-md px-4 py-3"
                    style={{ background: 'var(--redbg)' }}
                  >
                    <p
                      className="min-w-0 flex-1 truncate text-[12px]"
                      style={{ color: 'var(--destructive)' }}
                    >
                      {t.workspacePushFailed ?? '实时推送失败：'}
                      {pushError}
                    </p>
                    <Button variant="ghost" size="sm" onClick={clearPushError}>
                      {t.commonDismiss ?? '关闭'}
                    </Button>
                  </div>
                )}

                <TweakPanel
                  overrides={currentOverrides}
                  onChange={(next) => {
                    // TweakPanel 每次只改一个 key，找到变化项直接透传。
                    // break 改为 return 提升可读性。
                    for (const [k, v] of Object.entries(next)) {
                      if (currentOverrides[k as keyof ToolOverride] !== v) {
                        void updateOverride(k as keyof ToolOverride, v);
                        return;
                      }
                    }
                  }}
                  t={t}
                />

                {/* Action buttons */}
                <div className="mt-3 flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    disabled={!dirty}
                    onClick={() => void saveChanges()}
                  >
                    {t.workspaceSavePreset}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={!dirty}
                    onClick={() => void discardChanges()}
                  >
                    {t.workspaceDiscardChanges}
                  </Button>
                </div>
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
