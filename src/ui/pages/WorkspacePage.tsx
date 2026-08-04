// SPDX-License-Identifier: MPL-2.0

import type { ReactNode } from 'react';
/**
 * # WorkspacePage
 *
 * Product home — "AI Coding Environment Manager".
 *
 * Layout (g12 Swiss grid):
 *   - Hero (compact Swiss panel, full-width)
 *   - g12 grid: right `c8` (environment grid + live feed) + left `c4` stack
 *     (dashboard stats / engine KV / quick actions)
 *
 * Environment actions are centralized in useEnvironmentActions:
 *   - switchEnvironment() creates preset + applies theme
 *   - renameEnvironment() updates preset name
 *   - duplicateEnvironment() clones a preset
 *   - deleteEnvironment() removes a preset
 *   - No direct controller calls from JSX
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { RenameDialog } from '@/components/rename-dialog';
import { HugeIcon } from '@/components/ui/huge-icon';
import { AgentDetailSheet } from '@/components/workspace/AgentDetailSheet';
import { EnvironmentGrid } from '@/components/workspace/EnvironmentGrid';
import type { AppController } from '@/hooks/useAppController';
import { useEnvironmentActions } from '@/hooks/useEnvironmentActions';
import { useEnvironments } from '@/hooks/useEnvironments';
import { cn } from '@/lib/utils';
import type { EnvironmentModel } from '@/types/environment';

import { Copy01Icon, Image02Icon, PackageIcon, Search01Icon } from '@hugeicons/core-free-icons';
import type { HugeiconsIconProps } from '@hugeicons/react';
import type { UiMessages } from '@shared/i18n';

/* ------------------------------------------------------------------ */
/* Swiss panel primitives                                              */
/* ------------------------------------------------------------------ */

/**
 * SwissPanel — bordered container with p-head + p-body sections.
 * Mirrors A.html `.panel` / `.p-head` / `.p-label` / `.p-body`.
 */
function SwissPanel({
  label,
  action,
  children,
  className,
}: {
  label: ReactNode;
  action?: ReactNode;
  children: ReactNode;
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
      <div className="flex items-center justify-between gap-2 border-b border-border px-[14px] py-[9px]">
        <span className="flex items-center gap-2 whitespace-nowrap font-mono text-[9.5px] font-semibold tracking-[0.14em] uppercase text-muted-foreground">
          {label}
        </span>
        {action}
      </div>
      <div className="p-[14px]">{children}</div>
    </div>
  );
}

/** KvRow — key/value pair with dashed bottom border (A.html `.kv`). */
function KvRow({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-dashed border-border py-[6.5px] text-sm last:border-0">
      <span className="font-mono text-[9.5px] font-medium tracking-[0.12em] text-[var(--dim)]">
        {k}
      </span>
      <span className="font-mono text-[11.5px] font-semibold">{v}</span>
    </div>
  );
}

/** Loadbar — small horizontal bar (A.html `.loadbar`). */
function Loadbar({ percent }: { percent: number }) {
  return (
    <span className="ml-2 inline-block h-1 w-[70px] overflow-hidden rounded bg-border align-middle">
      <span
        className="block h-full bg-primary transition-[width] duration-600"
        style={{ width: `${Math.min(100, percent)}%` }}
      />
    </span>
  );
}

/** QuickButton — `.qbtn` with hover red bar growing from top to bottom. */
function QuickButton({
  icon: Icon,
  label,
  shortcut,
  disabled,
  onClick,
}: {
  icon: HugeiconsIconProps['icon'];
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
        'rounded-[2px] border border-border bg-card2 px-3 py-[12px] pb-[10px]',
        'text-left text-foreground transition-all duration-[180ms]',
        'hover:-translate-y-0.5 hover:border-border-strong hover:shadow',
        disabled && 'pointer-events-none opacity-40',
      )}
    >
      {/* Red bar grows from top to bottom on hover */}
      <span className="absolute left-0 top-0 h-0 w-[3px] bg-primary transition-all duration-250 group-hover/qbtn:h-full" />
      <HugeIcon icon={Icon} size={14} className="text-muted-foreground/70" />
      <b className="text-[12px]">{label}</b>
      <span className="font-mono text-[9px] text-[var(--dim)]">{shortcut}</span>
    </button>
  );
}

/** FeedList — activity feed (A.html `#feedList`). */
function FeedList({ entries }: { entries: { color: string; msg: string }[] }) {
  if (entries.length === 0) {
    return <p className="font-mono text-[11px] text-muted-foreground/50">暂无活动</p>;
  }
  return (
    <ul className="max-h-[190px] overflow-y-auto">
      {entries.map((e, i) => (
        <li
          // biome-ignore lint/suspicious/noArrayIndexKey: stable static list
          key={`feed-${e.color}-${e.msg}-${i}`}
          className="flex items-baseline gap-2 border-b border-dashed border-border py-[5px] font-mono text-[11px] last:border-0"
        >
          <span className={cn('shrink-0 font-semibold', e.color)}>·</span>
          <span className="text-muted-foreground">{e.msg}</span>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ */
/* Compact Hero                                                        */
/* ------------------------------------------------------------------ */

/**
 * CompactHero — slim Swiss banner replacing the original EnvironmentHero.
 * Shows active environment inline with a "Continue" action.
 */
function CompactHero({
  activeEnv,
  t,
  onContinue,
}: {
  activeEnv: EnvironmentModel | null;
  t: UiMessages;
  onContinue?: () => void;
}) {
  return (
    <div className="relative overflow-hidden rounded-[2px] border border-border bg-gradient-to-br from-card to-card2">
      {/* Blob decoration layer */}
      <div className="absolute right-[8%] top-[-45%] size-[340px] rounded-full bg-[var(--redbg)] opacity-55 blur-[60px] pointer-events-none animate-[agentskin-blob_9s_ease-in-out_infinite_alternate]" />
      <div
        className="absolute left-[32%] bottom-[-75%] size-[340px] rounded-full opacity-55 blur-[60px] pointer-events-none animate-[agentskin-blob_13s_ease-in-out_infinite_alternate-reverse]"
        style={{ background: 'color-mix(in srgb, var(--blu) 13%, transparent)' }}
      />
      {/* Dot pattern texture */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.06]"
        style={{
          backgroundImage: 'radial-gradient(var(--border-strong) 1px, transparent 1px)',
          backgroundSize: '14px 14px',
          maskImage: 'linear-gradient(120deg, transparent 30%, #000)',
        }}
      />
      {/* Decorative letter watermark */}
      <span className="pointer-events-none select-none absolute right-5 bottom-[-46px] font-display text-[160px]/none font-bold opacity-[0.13] [-webkit-text-stroke:1.5px_var(--red)] text-transparent">
        A
      </span>
      <div className="relative flex items-center gap-4 px-7 py-6">
        {/* Environment ring indicator */}
        {activeEnv && (
          <div
            className={`grid size-[38px] shrink-0 place-items-center rounded-full border-2 font-display text-[13px] font-bold ${activeEnv.status === 'active' ? 'border-primary text-primary shadow-[0_0_0_4px_var(--redbg)]' : 'border-muted-foreground/40 text-muted-foreground'}`}
          >
            {activeEnv.name.slice(0, 1)}
          </div>
        )}
        {/* Greeting / title */}
        <div className="min-w-0 flex-1">
          <p className="font-display text-[26px]/[1.15] font-bold tracking-tight">
            {activeEnv ? activeEnv.name : t.yourWorkspace}
          </p>
          {/* Subtitle info row */}
          <div className="mt-1.5 flex flex-wrap gap-3.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            <span>2026.08.04 TUE</span>
            <span>NEURAL-CDP READY</span>
            <span>LOCAL MODE</span>
          </div>
          <p className="mt-1 font-mono text-[10px] text-muted-foreground/70">
            {activeEnv
              ? `${activeEnv.agent.displayName}${activeEnv.theme ? ` · ${activeEnv.theme.name}` : ''}`
              : 'No active environment'}
          </p>
        </div>
        {/* Status */}
        {activeEnv && (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-cr-success/25 bg-cr-success/10 px-2 py-0.5 text-[10px] font-medium text-cr-success">
            <span className="size-[5px] rounded-full bg-cr-success" />
            {t.activeBadge}
          </span>
        )}
        {/* Continue */}
        {activeEnv && onContinue && (
          <button
            type="button"
            onClick={onContinue}
            className="h-[27px] rounded-[2px] border border-primary bg-primary px-3 text-[11px] font-semibold text-white hover:bg-primary/90"
          >
            {t.continueWorking}
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* WorkspacePage                                                       */
/* ------------------------------------------------------------------ */

export function WorkspacePage({ controller }: { controller: AppController }) {
  const { activeEnvironment, environments } = useEnvironments(controller);
  const envActions = useEnvironmentActions(controller);
  const { t } = controller;

  // Installed themes (for per-agent counts shown in the detail sheet).
  const installedThemes = controller.installed;

  // Environment whose detail sheet is open (null = closed).
  const [detailEnv, setDetailEnv] = useState<EnvironmentModel | null>(null);

  // --- Dashboard metrics ---
  const activeCount = useMemo(
    () => environments.filter((e) => e.status === 'active').length,
    [environments],
  );
  const detectedCount = useMemo(
    () => environments.filter((e) => e.agentInstalled).length,
    [environments],
  );
  const installedAppsCount = useMemo(
    () => (controller.status?.apps ?? []).filter((a) => a.installed).length,
    [controller.status?.apps],
  );

  // --- Uptime counter ---
  const [uptime, setUptime] = useState('00:00:00');
  useEffect(() => {
    const start = Date.now();
    const fmt = (ms: number) => {
      const s = Math.floor(ms / 1000);
      const h = String(Math.floor(s / 3600)).padStart(2, '0');
      const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
      const sec = String(s % 60).padStart(2, '0');
      return `${h}:${m}:${sec}`;
    };
    setUptime(fmt(Date.now() - start));
    const id = setInterval(() => setUptime(fmt(Date.now() - start)), 1000);
    return () => clearInterval(id);
  }, []);

  // --- Activity feed entries ---
  const feedEntries = useMemo(() => {
    return environments
      .filter((e) => e.status !== 'offline')
      .slice(0, 6)
      .map((e) => ({
        color:
          e.status === 'active'
            ? 'text-primary'
            : e.agentRunning
              ? 'text-cr-info'
              : 'text-cr-warning',
        msg:
          e.status === 'active'
            ? `${e.agent.displayName} — ${e.theme?.name ?? 'no theme'}`
            : `${e.agent.displayName} — ${e.agentRunning ? t.statusInstalled : t.detailNotInstalled}`,
      }));
  }, [environments, t]);

  // --- Lifecycle handlers ---

  // Clicking a card opens its detail sheet instead of switching immediately.
  const handleSelectEnv = useCallback((env: EnvironmentModel) => {
    setDetailEnv(env);
  }, []);

  // Apply from the detail sheet — switches, then closes the sheet.
  const handleApplyFromDetail = useCallback(
    (env: EnvironmentModel) => {
      void envActions.switchEnvironment(env);
    },
    [envActions],
  );

  const handleContinue = useCallback(() => {
    if (activeEnvironment) {
      void envActions.switchEnvironment(activeEnvironment);
    }
  }, [activeEnvironment, envActions]);

  const handleBrowseThemes = useCallback(() => {
    controller.setRoute('themes');
  }, [controller]);

  const handleOpenWallpaperCenter = useCallback(() => {
    controller.setRoute('wallpaper');
  }, [controller]);

  // Restore every app that currently has an active theme.
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
      envActions.renameEnvironment(renamePresetId, renameValue.trim());
    }
    setRenamePresetId(null);
    setRenameValue('');
  }, [renamePresetId, renameValue, envActions]);

  // --- Duplicate handler ---
  const handleDuplicate = useCallback(
    (presetId: string) => {
      const preset = environments.find((e) => e.presetId === presetId);
      if (preset) {
        const newName = `${preset.name} 副本`;
        envActions.duplicateEnvironment(presetId, newName);
      }
    },
    [environments, envActions],
  );

  // --- Delete handler ---
  const handleDelete = useCallback(
    (presetId: string) => {
      envActions.deleteEnvironment(presetId);
    },
    [envActions],
  );

  // Quick actions (plain array — handlers are useCallback-stable, controller is stable)
  const hasActiveTheme = (controller.status?.apps ?? []).some((app) => app.activeThemeId);
  const quickActions: {
    id: string;
    icon: HugeiconsIconProps['icon'];
    label: string;
    shortcut: string;
    disabled?: boolean;
    onClick: () => void;
  }[] = [
    {
      id: 'browse',
      icon: Search01Icon,
      label: t.browseThemes,
      shortcut: '⌘T',
      onClick: handleBrowseThemes,
    },
    {
      id: 'import',
      icon: PackageIcon,
      label: t.importTheme,
      shortcut: '⌘I',
      onClick: () => void controller.importTheme(),
    },
    {
      id: 'wallpaper',
      icon: Image02Icon,
      label: t.actionWallpaperCenter,
      shortcut: '⌘W',
      onClick: handleOpenWallpaperCenter,
    },
    {
      id: 'restore-all',
      icon: Copy01Icon,
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
      {/* Hero — full-width compact Swiss banner */}
      <CompactHero activeEnv={activeEnvironment} t={t} onContinue={handleContinue} />

      {/* g12 grid layout — scrolls below the fixed hero once the app height
          chain gives this page a definite height. */}
      <div className="mt-3.5 min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-12 gap-3.5">
          {/* ===== RIGHT column: c8 (2/3) ===== */}
          <div className="col-span-8 flex flex-col gap-3.5">
            {/* Environment grid */}
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
              isRefreshing={controller.isRefreshing}
            />

            {/* Activity feed */}
            <SwissPanel
              label={
                <>
                  <b className="text-primary">LIVE FEED</b> · 实时流
                </>
              }
              action={
                <span className="relative flex size-1.5">
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-cr-success opacity-75" />
                  <span className="relative inline-flex size-1.5 rounded-full bg-cr-success" />
                </span>
              }
            >
              <FeedList entries={feedEntries} />
            </SwissPanel>
          </div>

          {/* ===== LEFT column: c4 stack (1/3) ===== */}
          <div className="col-span-4 flex flex-col gap-3.5">
            {/* Dashboard stats */}
            <SwissPanel
              label={
                <>
                  <b className="text-primary">DASHBOARD</b> · 仪表盘
                </>
              }
              action={
                <span className="font-mono text-[10px] text-cr-success">
                  {activeCount > 0 ? `▲ +${activeCount}` : '·'}
                </span>
              }
            >
              <div className="font-display text-4xl font-bold tracking-tight">{activeCount}</div>
              <div className="mt-0.5 font-display text-[15px] text-muted-foreground/60">
                次注入 · 本月
              </div>
              <div className="mt-2 font-mono text-[10.5px] text-muted-foreground">
                已安装 <b className="text-foreground">{installedAppsCount}</b> 平台 · 可检测{' '}
                <b className="text-foreground">{detectedCount}</b> / {environments.length}
              </div>
            </SwissPanel>

            {/* Engine KV status */}
            <SwissPanel
              label={
                <>
                  <b className="text-primary">ENGINE</b> · CDP 状态
                </>
              }
              action={
                <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9.5px] font-medium tracking-wide text-muted-foreground">
                  <span className="size-[5px] rounded-full bg-cr-success" />
                  V2.0
                </span>
              }
            >
              <KvRow k="STATUS" v={<span className="text-cr-success">● 运行中</span>} />
              <KvRow k="LATENCY" v="12ms" />
              <KvRow
                k="LOAD"
                v={
                  <>
                    <span>{Math.min(99, activeCount * 12 + 20)}%</span>
                    <Loadbar percent={activeCount * 12 + 20} />
                  </>
                }
              />
              <KvRow k="UPTIME" v={uptime} />
              <KvRow k="TARGETS" v={`${detectedCount}/${environments.length}`} />
            </SwissPanel>

            {/* Quick actions grid */}
            <SwissPanel
              label={
                <>
                  <b className="text-primary">QUICK</b> · 快捷操作
                </>
              }
            >
              <div className="grid grid-cols-2 gap-2">
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
          </div>
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
      />
    </div>
  );
}
