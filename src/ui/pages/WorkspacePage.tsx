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
 *
 * Features:
 *   - M3 undo/redo: Ctrl+Z / Ctrl+Shift+Z
 *   - M5 A/B compare: dual preview when compare preset is active
 *   - M8 element picking: click preview to highlight corresponding field
 *   - M9 export/import: share tweak configs as JSON
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
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

import { uiMessages } from '@shared/i18n';
import type { AppStatus } from '@shared/types';
import {
  AlertTriangle,
  CheckCircle,
  Download,
  RefreshCw,
  Search,
  Upload,
  XCircle,
} from 'lucide-react';

/**
 * i18n fallbacks for error banners. These are narrowly-scoped fallbacks used
 * only when a locale omits the corresponding key; the canonical copy lives in
 * the i18n message tables (see direction E — i18n completeness). Kept as
 * module constants so the hardcoded Chinese strings are not duplicated inline.
 */
const PUSH_FAILED_FALLBACK = '实时推送失败：';
const IMPORT_FAILED_FALLBACK = '导入失败：';

/**
 * Shared error-banner shell. Replaces the previously inline, CSS-variable
 * driven alert with semantic design-system classes (destructive tint), so the
 * styling stays consistent with the rest of the app instead of reaching for
 * the internal `--redbg` alias directly.
 */
function ErrorBanner({
  message,
  label,
  onDismiss,
  dismissLabel,
}: {
  message: string;
  label: string;
  onDismiss: () => void;
  dismissLabel: string;
}) {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 rounded-md bg-destructive/10 px-4 py-3"
    >
      <p className="min-w-0 flex-1 truncate text-[12px] text-destructive">
        {label}
        {message}
      </p>
      <Button variant="ghost" size="sm" onClick={onDismiss}>
        {dismissLabel}
      </Button>
    </div>
  );
}

export function WorkspacePage() {
  // Subscribe to locale so the page re-renders on language change and stays
  // outside the useSyncExternalStore tearing window (INDEX.md invariant §render).
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
  // M3 undo/redo
  const undo = useWorkspaceStore((s) => s.undo);
  const redo = useWorkspaceStore((s) => s.redo);
  const canUndo = useWorkspaceStore((s) => s.canUndo);
  const canRedo = useWorkspaceStore((s) => s.canRedo);
  // M5 A/B compare
  const dualPreviewActive = useWorkspaceStore((s) => s.dualPreviewActive);
  // M8 inspect mode
  const inspectMode = useWorkspaceStore((s) => s.window.inspectMode);
  const toggleInspectMode = useWorkspaceStore((s) => s.toggleInspectMode);
  // M9 export/import
  const exportTweakConfig = useWorkspaceStore((s) => s.exportTweakConfig);
  const importTweakConfig = useWorkspaceStore((s) => s.importTweakConfig);

  const healthReportByAgent = useDiagnosticsStore((s) => s.healthReportByAgent);
  const healthReport = currentAgentId ? (healthReportByAgent[currentAgentId] ?? null) : null;
  const setHealthReport = useDiagnosticsStore((s) => s.setHealthReport);

  // M8: track the currently highlighted field from element picking.
  const [highlightedField, setHighlightedField] = useState<string | undefined>(undefined);
  // M9: import error message.
  const [importError, setImportError] = useState<string | null>(null);

  /** Subscribe to theme health reports pushed from the main process. */
  useEffect(() => {
    const unsubscribe = api.onThemeHealthReport(setHealthReport);
    return unsubscribe;
  }, [setHealthReport]);

  /** M3: keyboard shortcuts — Ctrl+Z undo, Ctrl+Shift+Z redo. */
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

  /** Running agents that expose a CDP port — eligible for live tweaking. */
  const runningAgents = useMemo(
    () => (status?.apps ?? []).filter((a) => a.running && a.port !== null) as AppStatus[],
    [status],
  );

  // M8: map a picked element ref to a ToolOverride field key.
  const handleElementPicked = useCallback((ref: string) => {
    // The ref is either a data-as-ref value or a tagName. Map common tagNames
    // to likely override fields; otherwise just store the raw ref.
    const tagToField: Record<string, string> = {
      button: 'radius',
      input: 'radius',
      select: 'radius',
      textarea: 'radius',
      hr: 'borderWidth',
      img: 'radius',
    };
    setHighlightedField(tagToField[ref.toLowerCase()] ?? ref);
    // Clear highlight after 3 seconds.
    setTimeout(() => setHighlightedField(undefined), 3000);
  }, []);

  // M9: export to clipboard.
  const handleExport = useCallback(() => {
    const json = exportTweakConfig();
    void navigator.clipboard.writeText(json);
  }, [exportTweakConfig]);

  // M9: import from file.
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
        <div className="flex items-center gap-4  px-4 py-2 bg-[var(--bg-2)] border border-[var(--border-subtle)] rounded-[var(--dl-radius,2px)] mx-4 mb-3">
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
        <div className="flex items-center  px-4 py-2 bg-[var(--bg-2)] border border-[var(--border-subtle)] rounded-[var(--dl-radius,2px)] mx-4 mb-3">
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
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[11px] tracking-tight text-muted-foreground ">
                    {t.workspacePreview}
                  </span>
                  {/* M8: inspect mode toggle */}
                  <button
                    type="button"
                    onClick={() => toggleInspectMode()}
                    className={`flex items-center gap-1 rounded-[var(--dl-radius,2px)] px-2 py-0.5 font-mono text-[10px] transition-colors ${
                      inspectMode
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-[var(--bg-3)]'
                    }`}
                    title={inspectMode ? '退出元素选取' : '选取元素以定位参数'}
                  >
                    <Search className="size-3" />
                    {inspectMode ? '退出选取' : '选取元素'}
                  </button>
                </div>
                <AgentLivePreview
                  agentId={currentAgentId}
                  overrides={currentOverrides}
                  t={t}
                  dualPreview={dualPreviewActive}
                  inspectMode={inspectMode}
                  onElementPicked={handleElementPicked}
                />
              </section>

              {/* Tweak controls */}
              <section className="flex flex-col gap-3  pt-3">
                <span className="text-[11px] tracking-tight text-muted-foreground ">
                  {t.workspaceTweakControls}
                </span>
                {pushError && (
                  <div className="mb-5">
                    <ErrorBanner
                      message={pushError}
                      label={t.workspacePushFailed ?? PUSH_FAILED_FALLBACK}
                      onDismiss={clearPushError}
                      dismissLabel={t.commonDismiss ?? '关闭'}
                    />
                  </div>
                )}

                <TweakPanel
                  overrides={currentOverrides}
                  onChange={(next) => {
                    // TweakPanel 每次只改一个 key，找到变化项直接透传。
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
                  {/* M3: undo / redo buttons */}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={!canUndo()}
                    onClick={() => void undo()}
                    title="Ctrl+Z"
                  >
                    ↶
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={!canRedo()}
                    onClick={() => void redo()}
                    title="Ctrl+Shift+Z"
                  >
                    ↷
                  </Button>
                  {/* M9: export / import */}
                  <div className="ml-auto flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={handleExport}
                      title="导出配置到剪贴板"
                    >
                      <Download className="size-3" />
                      <span className="text-[11px]">导出</span>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => void handleImport()}
                      title="从 JSON 文件导入配置"
                    >
                      <Upload className="size-3" />
                      <span className="text-[11px]">导入</span>
                    </Button>
                  </div>
                </div>

                {/* M9: import error display */}
                {importError && (
                  <ErrorBanner
                    message={importError}
                    label={IMPORT_FAILED_FALLBACK}
                    onDismiss={() => setImportError(null)}
                    dismissLabel={t.commonDismiss ?? '关闭'}
                  />
                )}
              </section>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
