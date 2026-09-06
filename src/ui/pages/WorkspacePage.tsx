// SPDX-License-Identifier: MPL-2.0

/**
 * # WorkspacePage — Live Tweak
 *
 * Real-time micro-adjustment panel. Three-column layout:
 *   ┌────┬──────────────────────────┬──────────┐
 *   │rail│  Preview (dominant)      │ Tweak    │
 *   │56px│                          │ 300px    │
 *   │    │                          │          │
 *   └────┴──────────────────────────┴──────────┘
 *
 * - Left rail: icon-only running-agent selector
 * - Center: large DOM preview iframe (no window chrome)
 * - Right: tweak controls + action buttons
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/api/agentSkinClient';
import { AppMark } from '@/components/AppMark';
import { ErrorBanner } from '@/components/ErrorBanner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { SkeletonProvider } from '@/components/ui/SkeletonProvider';
import { Spinner } from '@/components/ui/spinner';
import { AgentLivePreview } from '@/components/workspace/AgentLivePreview';
import { QuickActionsCard } from '@/components/workspace/QuickActionsCard';
import { TweakPanel } from '@/components/workspace/TweakPanel';
import { useDiagnosticsStore } from '@/stores/diagnosticsStore';
import { useShellStore } from '@/stores/shellStore';
import { useStatusStore } from '@/stores/statusStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { ToolOverride } from '@/types/override';

import { uiMessages } from '@shared/i18n';
import type { AppStatus } from '@shared/types';
import { Download, Paintbrush, Redo2, RefreshCw, Search, Undo2, Upload } from 'lucide-react';

const PUSH_FAILED_FALLBACK = '实时推送失败：';
const IMPORT_FAILED_FALLBACK = '导入失败：';

export function WorkspacePage() {
  const locale = useShellStore((s) => s.locale);
  const t = uiMessages[locale];

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
  const undo = useWorkspaceStore((s) => s.undo);
  const redo = useWorkspaceStore((s) => s.redo);
  const canUndo = useWorkspaceStore((s) => s.canUndo);
  const canRedo = useWorkspaceStore((s) => s.canRedo);
  const dualPreviewActive = useWorkspaceStore((s) => s.dualPreviewActive);
  const inspectMode = useWorkspaceStore((s) => s.window.inspectMode);
  const toggleInspectMode = useWorkspaceStore((s) => s.toggleInspectMode);
  const exportTweakConfig = useWorkspaceStore((s) => s.exportTweakConfig);
  const importTweakConfig = useWorkspaceStore((s) => s.importTweakConfig);

  const healthReportByAgent = useDiagnosticsStore((s) => s.healthReportByAgent);
  const healthReport = currentAgentId ? (healthReportByAgent[currentAgentId] ?? null) : null;
  const setHealthReport = useDiagnosticsStore((s) => s.setHealthReport);

  const [highlightedField, setHighlightedField] = useState<string | undefined>(undefined);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = api.onThemeHealthReport(setHealthReport);
    return unsubscribe;
  }, [setHealthReport]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          void redo();
        } else {
          void undo();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo]);

  const runningAgents = useMemo(
    // TODO: type-guard — 待渐进式加固
    () => (status?.apps ?? []).filter((a) => a.running && a.port !== null) as AppStatus[],
    [status],
  );

  const handleElementPicked = useCallback((ref: string) => {
    const tagToField: Record<string, string> = {
      button: 'radius',
      input: 'radius',
      select: 'radius',
      textarea: 'radius',
      hr: 'borderWidth',
      img: 'radius',
    };
    setHighlightedField(tagToField[ref.toLowerCase()] ?? ref);
    setTimeout(() => setHighlightedField(undefined), 3000);
  }, []);

  const handleExport = useCallback(() => {
    const json = exportTweakConfig();
    void navigator.clipboard.writeText(json);
  }, [exportTweakConfig]);

  const handleRefreshStatus = useCallback(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const handleImport = useCallback(async () => {
    setImportError(null);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      const result = await importTweakConfig(text);
      if (!result.ok) {
        setImportError(result.error ?? 'import_failed');
      }
    };
    input.click();
  }, [importTweakConfig]);

  const currentApp = runningAgents.find((a) => a.appId === currentAgentId);

  // Show skeleton before first status poll completes (status === null).
  const showWorkspaceSkeleton = status === null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* ── Quick Actions ── */}
      {currentAgentId && <QuickActionsCard activeAgentId={currentAgentId} />}

      <SkeletonProvider
        loading={showWorkspaceSkeleton}
        config={{ header: true, toolbar: true, body: 'list', count: 6, rowAvatar: true }}
        className="min-h-0 flex-1"
      >
        {/* ── Three-column workspace ── */}
        <div className="flex min-h-0 flex-1 gap-3">
          {/* ── Left: running-agent rail (icon-only) ── */}
          <aside className="as-panel flex w-14 shrink-0 flex-col items-center gap-1.5 py-2.5">
            <button
              type="button"
              onClick={handleRefreshStatus}
              title={t.refreshStatus}
              className="mb-1 flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-fast hover:bg-accent/50 hover:text-foreground"
            >
              {isRefreshing ? (
                <Spinner className="size-3.5 animate-spin" />
              ) : (
                <RefreshCw className="size-3.5" />
              )}
            </button>
            <div className="h-px w-6 bg-border" />
            {runningAgents.length === 0 ? (
              <div className="mt-4 flex flex-col items-center gap-2 px-1">
                <p className="text-center text-[11px] leading-tight line-clamp-2 text-muted-foreground">
                  {t.workspaceNoRunningAgents}
                </p>
                <button
                  type="button"
                  onClick={handleRefreshStatus}
                  title={t.refreshStatus}
                  className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors duration-fast hover:bg-accent/50 hover:text-foreground"
                >
                  <RefreshCw className="size-3" />
                </button>
              </div>
            ) : (
              runningAgents.map((app) => {
                const active = app.appId === currentAgentId;
                return (
                  <button
                    key={app.appId}
                    type="button"
                    onClick={() => selectAgent(app.appId, app.port ?? 0)}
                    title={`${app.displayName} :${app.port}`}
                    className={`relative flex size-9 items-center justify-center rounded-lg transition-all duration-base ${
                      active
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    }`}
                  >
                    <AppMark appId={app.appId} size={18} />
                    {active && (
                      <span className="as-brand-line absolute -left-2 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full shadow-[0_0_8px_rgba(var(--brand-rgb),0.5)]" />
                    )}
                  </button>
                );
              })
            )}
          </aside>

          {/* ── Center: preview (dominant) ── */}
          <main className="flex min-w-0 flex-1 flex-col gap-3">
            {/* Preview toolbar */}
            <div className="as-panel flex h-8 shrink-0 items-center gap-2 px-3">
              {currentApp ? (
                <>
                  <AppMark appId={currentApp.appId} size={14} />
                  <span className="text-[12px] font-medium">{currentApp.displayName}</span>
                  <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                    :{currentApp.port}
                  </span>
                  {healthReport && (
                    <>
                      <span className="h-3.5 w-px bg-border" />
                      <span
                        className={`size-1.5 rounded-full ${
                          healthReport.score >= 80
                            ? 'bg-cr-success'
                            : healthReport.score >= 50
                              ? 'bg-cr-warning'
                              : 'bg-destructive'
                        }`}
                      />
                      <span className="text-[11px] font-medium tabular-nums">
                        {healthReport.score}
                      </span>
                    </>
                  )}
                </>
              ) : (
                <span className="text-[11px] text-muted-foreground">
                  {t.workspaceSelectAgentHint}
                </span>
              )}
              <div className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => toggleInspectMode()}
                  title={inspectMode ? t.workspaceInspectStop : t.workspaceInspectStart}
                  className={`flex size-7 items-center justify-center rounded-md transition-colors duration-fast ${
                    inspectMode
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                  }`}
                >
                  <Search className="size-3.5" />
                </button>
              </div>
            </div>

            {/* Preview surface */}
            <div className="min-h-0 flex-1">
              {currentAgentId === null ? (
                <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border bg-card/30 p-6">
                  <EmptyState
                    icon={<Paintbrush />}
                    iconSize="lg"
                    title={t.workspaceSelectAgentHint}
                    hint={runningAgents.length === 0 ? t.workspaceNoRunningAgents : undefined}
                    action={
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleRefreshStatus}
                      >
                        <RefreshCw className="size-3.5" />
                        <span>{t.refreshStatus}</span>
                      </Button>
                    }
                  />
                </div>
              ) : (
                <AgentLivePreview
                  agentId={currentAgentId}
                  overrides={currentOverrides}
                  t={t}
                  dualPreview={dualPreviewActive}
                  inspectMode={inspectMode}
                  onElementPicked={handleElementPicked}
                />
              )}
            </div>
          </main>

          {/* ── Right: tweak panel ── */}
          <aside className="as-panel flex w-[300px] shrink-0 flex-col gap-3 overflow-y-auto p-3">
            <div className="flex items-center justify-between">
              <span className="as-section-title">{t.workspaceTweakControls}</span>
              <div className="flex items-center gap-0.5">
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={!canUndo()}
                  onClick={() => void undo()}
                  title="Ctrl+Z"
                >
                  <Undo2 className="size-3.5" />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  disabled={!canRedo()}
                  onClick={() => void redo()}
                  title="Ctrl+Shift+Z"
                >
                  <Redo2 className="size-3.5" />
                </Button>
              </div>
            </div>

            {pushError && (
              <ErrorBanner
                message={t.workspacePushFailed ?? PUSH_FAILED_FALLBACK}
                detail={pushError}
                onDismiss={clearPushError}
                dismissLabel={t.commonDismiss ?? '关闭'}
              />
            )}

            {currentAgentId !== null && (
              <TweakPanel
                overrides={currentOverrides}
                onChange={(next) => {
                  for (const [k, v] of Object.entries(next)) {
                    if (currentOverrides[k as keyof ToolOverride] !== v) {
                      void updateOverride(k as keyof ToolOverride, v);
                      return;
                    }
                  }
                }}
                t={t}
                highlightedField={highlightedField}
              />
            )}

            {/* Actions */}
            {currentAgentId !== null && (
              <div className="mt-auto flex flex-col gap-2 border-t border-border pt-3">
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    className="flex-1"
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
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={handleExport}
                    title={t.workspaceExportTooltip}
                  >
                    <Download className="size-3.5" />
                    <span>{t.workspaceExport}</span>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="flex-1"
                    onClick={() => void handleImport()}
                    title={t.workspaceImportTooltip}
                  >
                    <Upload className="size-3.5" />
                    <span>{t.workspaceImport}</span>
                  </Button>
                </div>
                {importError && (
                  <ErrorBanner
                    message={IMPORT_FAILED_FALLBACK}
                    detail={importError}
                    onDismiss={() => setImportError(null)}
                    dismissLabel={t.commonDismiss ?? '关闭'}
                  />
                )}
              </div>
            )}
          </aside>
        </div>
      </SkeletonProvider>
    </div>
  );
}
