// SPDX-License-Identifier: MPL-2.0

/**
 * # UnifiedWorkspacePage
 *
 * 统一工作区页面 — 合并原 AgentDashboardPage（概览统计）、
 * WorkspacePage（环境网格 + 快捷操作）和 AgentsPage（Agent 配置）。
 *
 * 结构（从上到下）：
 *   1. 统计卡行（3 个 StatTile）
 *   2. 环境网格主体（EnvironmentGrid + QuickEnvironmentCreate）
 *   3. 快捷操作面板（4 项，不含「新建工程」）
 *   4. Agent 配置折叠区（默认折叠，展开后双列网格）
 *
 * 注意：不引入「最近环境」和「最近活动」轮询区块，减少噪音。
 */

import { useCallback, useEffect, useState } from 'react';
import { APP_META, AppMark } from '@/components/app-mark';
import { RenameDialog } from '@/components/rename-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { AgentDetailSheet } from '@/components/workspace/AgentDetailSheet';
import { EnvironmentGrid } from '@/components/workspace/EnvironmentGrid';
import { QuickEnvironmentCreate } from '@/components/workspace/QuickEnvironmentCreate';
import type { AppController } from '@/hooks/useAppController';
import { useEnvironments } from '@/hooks/useEnvironments';
import { cn } from '@/lib/utils';
import { useEnvironmentStore } from '@/stores/environmentStore';
import { useStatusStore } from '@/stores/statusStore';

import { AGENT_IDS, type AgentId } from '@shared/types';
import type { EnvironmentModel } from '@shared/types/environment';
import { Folder, Image, PaintBucket, RotateCw, Upload } from 'lucide-react';

/* ------------------------------------------------------------------ */
/* StatTile — copied from AgentDashboardPage                           */
/* ------------------------------------------------------------------ */

function StatTile({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string | number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer rounded-[2px] border border-border bg-card p-4 text-left transition-colors duration-fast hover:border-border-strong hover:bg-card2"
    >
      <div className="mb-2">
        <span className="font-mono text-[9.5px] font-semibold tracking-[0.14em] uppercase text-muted-foreground">
          {label}
        </span>
      </div>
      <span className="font-display text-3xl font-bold tracking-tight text-foreground">
        {value}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* AgentConfigCard — copied from AgentsPage                             */
/* ------------------------------------------------------------------ */

function AgentConfigCard({ controller, appId }: { controller: AppController; appId: AgentId }) {
  const { t, settings } = controller;
  const override = settings?.apps[appId] ?? { appPath: null, port: null };
  const defaultPort = settings?.defaultPorts[appId] ?? 0;
  const [portDraft, setPortDraft] = useState('');

  useEffect(() => {
    setPortDraft(override.port === null ? '' : String(override.port));
  }, [override.port]);

  const commitPort = async () => {
    const trimmed = portDraft.trim();
    if (trimmed === (override.port === null ? '' : String(override.port))) return;
    const parsed = trimmed === '' ? null : Number(trimmed);
    const saved = await controller.saveAppPort(appId, parsed);
    if (!saved) setPortDraft(override.port === null ? '' : String(override.port));
  };

  const appStatus = controller.appStatusFor(appId);
  const isRunning = appStatus?.running ?? false;
  const isInstalled = appStatus?.installed ?? false;
  const isDebugReady = appStatus?.debugReady ?? false;

  return (
    <div className="rounded-[2px] border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <AppMark appId={appId} size={18} />
        <span className="font-display text-[13px] font-bold tracking-[-.01em]">
          {APP_META[appId].name}
        </span>
        <span className="ml-auto flex items-center gap-1.5">
          <span
            className={cn(
              'inline-block size-[7px] rounded-full',
              isRunning
                ? 'bg-[var(--grn)]'
                : isInstalled
                  ? 'bg-[var(--amb)]'
                  : 'bg-[var(--muted-foreground)] opacity-25',
            )}
          />
          <span className="font-mono text-[10px] text-muted-foreground">
            {isRunning
              ? t.agentsStatusRunning
              : isInstalled
                ? t.agentsStatusInstalled
                : t.agentsStatusNotInstalled}
          </span>
        </span>
      </div>

      {/* Path override */}
      <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-2">
        <div className="min-w-0">
          <p className="font-mono text-[11px] tracking-wide text-foreground">
            {t.settingsPathLabel}
          </p>
          <p
            className="mt-0.5 truncate font-mono text-[10px] tracking-wider text-muted-foreground/70"
            title={override.appPath ?? undefined}
          >
            {override.appPath ?? t.agentsPathAuto}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {override.appPath && (
            <Button variant="ghost" size="xs" onClick={() => void controller.clearAppPath(appId)}>
              {t.agentsResetPath}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => void controller.chooseAppPath(appId)}>
            <Folder size={14} className="text-muted-foreground/70" />
            {t.settingsChoosePath}
          </Button>
        </div>
      </div>

      {/* Port override */}
      <div className="flex items-center justify-between gap-4 px-4 py-2">
        <div>
          <p className="font-mono text-[11px] tracking-wide text-foreground">
            {t.settingsPortLabel}
          </p>
          <p className="mt-0.5 font-mono text-[10px] tracking-wider text-muted-foreground">
            {t.agentsPortDefault(defaultPort)}
          </p>
        </div>
        <Input
          value={portDraft}
          inputMode="numeric"
          placeholder={defaultPort > 0 ? String(defaultPort) : '—'}
          className="h-[30px] w-24 rounded-[2px] border-border bg-muted font-mono text-[11px] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/25"
          onChange={(event) => setPortDraft(event.target.value)}
          onBlur={() => void commitPort()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void commitPort();
          }}
        />
      </div>

      {/* Status footer */}
      <div className="flex items-center justify-between border-t border-border bg-card2 px-4 py-2">
        <span className="font-mono text-[10px] text-muted-foreground/70">
          CDP: {isDebugReady ? t.agentsDebugReady : t.agentsStatusStopped}
        </span>
        <Button variant="ghost" size="xs" onClick={() => controller.setRoute('themes')}>
          {t.agentsSupportedThemes} →
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* SwissPanel + QuickButton primitives (from WorkspacePage)             */
/* ------------------------------------------------------------------ */

function SwissPanel({
  label,
  action,
  children,
  className,
}: {
  label: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'rounded-[2px] border border-border bg-card overflow-hidden',
        'transition-[border-color,background-color] duration-200 hover:border-border-strong',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
        <span className="flex items-center gap-2 whitespace-nowrap font-mono text-[9.5px] font-semibold tracking-[0.14em] uppercase text-muted-foreground">
          {label}
        </span>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function QuickButton({
  icon: Icon,
  label,
  shortcut,
  disabled,
  onClick,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  shortcut: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'group/qbtn relative flex flex-col items-start gap-1.5 overflow-hidden',
        'rounded-[2px] border border-border bg-card2 px-3 py-3 pb-2',
        'text-left text-foreground transition-[background-color,border-color] duration-[180ms]',
        'hover:border-border-strong',
        disabled && 'pointer-events-none opacity-40',
      )}
    >
      {/* Red bar grows from top to bottom on hover */}
      <span className="absolute left-0 top-0 h-0 w-[3px] bg-primary transition-all duration-250 group-hover/qbtn:h-full" />
      <Icon size={14} className="text-muted-foreground/70" />
      <b className="text-[12px]">{label}</b>
      {shortcut && <span className="font-mono text-[10px] text-[var(--dim)]">{shortcut}</span>}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* UnifiedWorkspacePage                                                 */
/* ------------------------------------------------------------------ */

export function UnifiedWorkspacePage({ controller }: { controller: AppController }) {
  const { activeEnvironment, environments } = useEnvironments();
  const { t, status, installed, setRoute } = controller;
  const isSwitching = useEnvironmentStore((s) => s.switching);
  const statusError = useStatusStore((s) => s.error);
  const isStatusRefreshing = useStatusStore((s) => s.isRefreshing);
  const refreshStatus = useStatusStore((s) => s.refreshStatus);

  const supportedCount = AGENT_IDS.length;
  const runningCount = status?.apps.filter((a) => a.running).length ?? 0;
  const envCount = environments.length;

  // Installed themes (for per-agent counts in the detail sheet).
  const installedThemes = installed;

  // Environment whose detail sheet is open (null = closed).
  const [detailEnv, setDetailEnv] = useState<EnvironmentModel | null>(null);

  // --- Lifecycle handlers ---

  const handleSelectEnv = useCallback((env: EnvironmentModel) => {
    setDetailEnv(env);
  }, []);

  const handleApplyFromDetail = useCallback((env: EnvironmentModel) => {
    void useEnvironmentStore.getState().switchEnvironment(env);
  }, []);

  const handleBrowseThemes = useCallback(() => {
    controller.setRoute('themes');
  }, [controller]);

  const handleOpenWallpaperCenter = useCallback(() => {
    controller.setRoute('wallpaper');
  }, [controller]);

  const handleRestoreAll = useCallback(() => controller.restoreAll(), [controller]);

  // --- Rename dialog state ---
  const [renamePresetId, setRenamePresetId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const handleRenameOpen = useCallback(
    (presetId: string) => {
      const preset = environments.find((e) => e.presetId === presetId);
      if (preset) {
        setRenameValue(preset.name);
      }
      setRenamePresetId(presetId);
    },
    [environments],
  );

  const handleRenameSubmit = useCallback(() => {
    if (renamePresetId && renameValue.trim()) {
      useEnvironmentStore.getState().renameEnvironment(renamePresetId, renameValue.trim());
    }
    setRenamePresetId(null);
    setRenameValue('');
  }, [renamePresetId, renameValue]);

  const handleDuplicate = useCallback(
    (presetId: string) => {
      const preset = environments.find((e) => e.presetId === presetId);
      if (preset) {
        const newName = `${preset.name} 副本`;
        useEnvironmentStore.getState().duplicateEnvironment(presetId, newName);
      }
    },
    [environments],
  );

  const handleDelete = useCallback((presetId: string) => {
    useEnvironmentStore.getState().deleteEnvironment(presetId);
  }, []);

  // Quick create form visibility
  const [showQuickCreate, setShowQuickCreate] = useState(false);

  const handleQuickCreateSuccess = useCallback(() => {
    setShowQuickCreate(false);
  }, []);

  // Load settings on mount so AgentConfigCard override data is available.
  useEffect(() => {
    void controller.loadSettings();
  }, [controller.loadSettings]);

  // Quick actions — 4 items, no "new project"
  const hasActiveTheme = (controller.status?.apps ?? []).some((app) => app.activeThemeId);
  const quickActions: {
    id: string;
    icon: React.ComponentType<{ size?: number; className?: string }>;
    label: string;
    shortcut: string;
    disabled?: boolean;
    onClick: () => void;
  }[] = [
    {
      id: 'browseThemes',
      icon: PaintBucket,
      label: t.browseThemes,
      shortcut: '⌘T',
      onClick: handleBrowseThemes,
    },
    {
      id: 'importTheme',
      icon: Upload,
      label: t.importTheme,
      shortcut: '',
      onClick: () => void controller.importTheme(),
    },
    {
      id: 'wallpaper',
      icon: Image,
      label: t.actionWallpaperCenter,
      shortcut: '',
      onClick: handleOpenWallpaperCenter,
    },
    {
      id: 'restoreAll',
      icon: RotateCw,
      label: t.actionRestoreAll,
      shortcut: 'ESC',
      disabled: !hasActiveTheme,
      onClick: () => void handleRestoreAll(),
    },
  ];

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* Swiss: dotted grid pattern overlay */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.018]"
        style={{
          backgroundImage: 'radial-gradient(circle, currentColor 1px, transparent 1px)',
          backgroundSize: '22px 22px',
        }}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1240px] px-8 py-6 pb-[70px]">
          {/* Page header */}
          <header className="mb-5">
            <h1 className="font-display text-[22px] font-bold tracking-tight text-foreground">
              {t.navOverview}
            </h1>
            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
              {new Date().toLocaleDateString()} · {new Date().toLocaleTimeString()}
            </p>
          </header>

          {/* 1. Stats row */}
          <section className="mb-4">
            <div className="grid grid-cols-3 gap-4">
              <StatTile
                label={t.dashboardAgents}
                value={`${runningCount}/${supportedCount}`}
                onClick={() => {
                  /* agent section is below — scroll or toggle accordion in future */
                }}
              />
              <StatTile
                label={t.installedTitle}
                value={installed.length}
                onClick={() => setRoute('themes')}
              />
              <StatTile
                label={t.yourEnvironments}
                value={envCount}
                onClick={() => {
                  /* already on this page — no-op */
                }}
              />
            </div>
          </section>

          {/* 2. Environment grid */}
          <section className="mb-4">
            <div className="flex flex-col gap-4">
              {showQuickCreate && (
                <QuickEnvironmentCreate
                  onCreated={handleQuickCreateSuccess}
                  onCancel={() => setShowQuickCreate(false)}
                />
              )}
              <EnvironmentGrid
                environments={environments}
                activeId={activeEnvironment?.id ?? null}
                onSwitch={handleSelectEnv}
                onRename={handleRenameOpen}
                onDuplicate={handleDuplicate}
                onDelete={handleDelete}
                title={t.yourEnvironments}
                t={t}
                onBrowseThemes={handleBrowseThemes}
                progress={controller.bootProgress}
                lastStatusAt={controller.lastStatusAt}
                isRefreshing={isStatusRefreshing}
                error={statusError}
                onRetry={() => void refreshStatus()}
              />
            </div>
          </section>

          {/* 3. Quick actions panel (4 items) */}
          <section className="mb-4">
            <SwissPanel
              label={
                <>
                  <b className="text-primary">QUICK</b> · 快捷操作
                </>
              }
            >
              <div className="grid grid-cols-4 gap-2">
                {quickActions.map((action) => (
                  <QuickButton
                    key={action.id}
                    icon={action.icon}
                    label={action.label}
                    shortcut={action.shortcut}
                    disabled={action.disabled}
                    onClick={action.onClick}
                  />
                ))}
              </div>
            </SwissPanel>
          </section>

          {/* 4. Agent config collapsible section */}
          <section className="mt-4">
            <details className="rounded-[2px] border border-border bg-card overflow-hidden">
              <summary className="cursor-pointer select-none px-4 py-3 font-mono text-[9.5px] font-semibold tracking-[0.14em] uppercase text-muted-foreground transition-colors duration-fast hover:bg-card2">
                Agent · 配置
              </summary>
              <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2">
                {AGENT_IDS.map((appId) => (
                  <AgentConfigCard key={appId} controller={controller} appId={appId} />
                ))}
              </div>
            </details>
          </section>
        </div>
      </div>

      {/* Rename dialog */}
      <RenameDialog
        open={renamePresetId !== null}
        value={renameValue}
        onChange={setRenameValue}
        onConfirm={handleRenameSubmit}
        onCancel={() => setRenamePresetId(null)}
        title={t.environmentRename}
        confirmLabel={t.confirm}
        cancelLabel={t.cancel}
      />

      {/* Agent detail sheet — opens on card click */}
      <AgentDetailSheet
        env={detailEnv}
        installedThemeCount={
          detailEnv
            ? installedThemes.filter((th) => th.supportedAgents.includes(detailEnv.agent.id)).length
            : 0
        }
        t={t}
        onApply={handleApplyFromDetail}
        onOpenChange={(open) => {
          if (!open) setDetailEnv(null);
        }}
        isApplying={isSwitching}
      />
    </div>
  );
}

export default UnifiedWorkspacePage;
