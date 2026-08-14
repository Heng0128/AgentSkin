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

import { useMemo } from 'react';
import { AppMark } from '@/components/app-mark';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { AgentLivePreview } from '@/components/workspace/AgentLivePreview';
import { TweakPanel } from '@/components/workspace/TweakPanel';
import { useShellStore } from '@/stores/shellStore';
import { useStatusStore } from '@/stores/statusStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';

import { type UiMessages, uiMessages } from '@shared/i18n';
import type { AppStatus } from '@shared/types';
import { RefreshCw } from 'lucide-react';

import '@/styles/workspace.css';

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
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
        <h1 className="font-mono text-[12px] font-semibold tracking-tight uppercase">
          {t.navWorkspace}
        </h1>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => void refreshStatus()}
          disabled={isRefreshing}
          className="gap-1.5"
        >
          {isRefreshing ? <Spinner className="size-3" /> : <RefreshCw className="size-3" />}
          <span className="text-[11px]">{t.workspaceRefreshStatus}</span>
        </Button>
      </header>

      {/* ---------------------------------------------------------------- */}
      {/* Body — two-column grid: agent rail / preview+tweak               */}
      {/* ---------------------------------------------------------------- */}
      <div className="grid min-h-0 flex-1 grid-cols-[200px_1fr]">
        {/* Agent rail */}
        <aside className="flex flex-col gap-2 overflow-y-auto border-r border-border px-3 py-3">
          <span className="px-1 font-mono text-[10px] tracking-tight text-muted-foreground uppercase">
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
                  className={`flex w-full items-center gap-2 rounded-[2px] border px-2 py-2 text-left transition-colors ${
                    active
                      ? 'border-primary/40 bg-primary/5'
                      : 'border-transparent hover:border-border hover:bg-card'
                  }`}
                >
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-[2px] bg-accent">
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
              <p className="font-mono text-[11px] text-muted-foreground uppercase tracking-tight">
                {t.workspaceSelectAgentHint}
              </p>
            </div>
          ) : (
            <>
              {/* Preview pane */}
              <section className="flex min-h-0 flex-col">
                <span className="mb-2 font-mono text-[10px] tracking-tight text-muted-foreground uppercase">
                  {t.workspacePreview}
                </span>
                <AgentLivePreview agentId={currentAgentId} overrides={currentOverrides} t={t} />
              </section>

              {/* Tweak controls */}
              <section className="flex flex-col gap-3 border-t border-border pt-3">
                <span className="font-mono text-[10px] tracking-tight text-muted-foreground uppercase">
                  {t.workspaceTweakControls}
                </span>
                <TweakPanel
                  overrides={currentOverrides}
                  onChange={(next) => {
                    // Push each changed dimension to the store, which forwards
                    // the full override set to the live agent in real time.
                    for (const kv of Object.entries(next)) {
                      const k = kv[0] as keyof typeof currentOverrides;
                      if (currentOverrides[k] !== next[k]) {
                        updateOverride(k, kv[1]);
                        break;
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
