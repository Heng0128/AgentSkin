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
 * Environment presets are managed by environmentStore.
 */
import { useCallback, useState } from 'react';
import { RenameDialog } from '@/components/rename-dialog';
import { HugeIcon } from '@/components/ui/huge-icon';
import { AgentDetailSheet } from '@/components/workspace/AgentDetailSheet';
import { EnvironmentGrid } from '@/components/workspace/EnvironmentGrid';
import { QuickEnvironmentCreate } from '@/components/workspace/QuickEnvironmentCreate';
import type { AppController } from '@/hooks/useAppController';
import { useEnvironments } from '@/hooks/useEnvironments';
import { cn } from '@/lib/utils';
import { useEnvironmentStore } from '@/stores/environmentStore';
import type { EnvironmentModel } from '@/types/environment';

import {
  Add01Icon,
  Copy01Icon,
  Image02Icon,
  PackageIcon,
  Search01Icon,
} from '@hugeicons/core-free-icons';
import type { HugeiconsIconProps } from '@hugeicons/react';

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
      {shortcut && <span className="font-mono text-[9px] text-[var(--dim)]">{shortcut}</span>}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* WorkspacePage                                                       */
/* ------------------------------------------------------------------ */

export function WorkspacePage({ controller }: { controller: AppController }) {
  const { activeEnvironment, environments } = useEnvironments();
  const { t } = controller;

  // Installed themes (for per-agent counts shown in the detail sheet).
  const installedThemes = controller.installed;

  // Environment whose detail sheet is open (null = closed).
  const [detailEnv, setDetailEnv] = useState<EnvironmentModel | null>(null);

  // --- Lifecycle handlers ---

  // Clicking a card opens its detail sheet instead of switching immediately.
  const handleSelectEnv = useCallback((env: EnvironmentModel) => {
    setDetailEnv(env);
  }, []);

  // Apply from the detail sheet — switches, then closes the sheet.
  const handleApplyFromDetail = useCallback((env: EnvironmentModel) => {
    void useEnvironmentStore.getState().switchEnvironment(env);
  }, []);

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
      useEnvironmentStore.getState().renameEnvironment(renamePresetId, renameValue.trim());
    }
    setRenamePresetId(null);
    setRenameValue('');
  }, [renamePresetId, renameValue]);

  // --- Duplicate handler ---
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

  // --- Delete handler ---
  const handleDelete = useCallback((presetId: string) => {
    useEnvironmentStore.getState().deleteEnvironment(presetId);
  }, []);

  // Quick create form visibility
  const [showQuickCreate, setShowQuickCreate] = useState(false);

  const handleQuickCreateSuccess = useCallback(() => {
    setShowQuickCreate(false);
  }, []);

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
      id: 'new',
      icon: Add01Icon,
      label: '新建工程',
      shortcut: '⌘N',
      onClick: () => setShowQuickCreate(true),
    },
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
      shortcut: '',
      onClick: () => void controller.importTheme(),
    },
    {
      id: 'wallpaper',
      icon: Image02Icon,
      label: t.actionWallpaperCenter,
      shortcut: '',
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
      {/* Content — EnvironmentGrid full-width (removed the hero banner and
          the demo DASHBOARD / ENGINE / LIVE FEED panels). */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-12 gap-3.5">
          {/* Environment grid — full width */}
          <div className="col-span-12 flex flex-col gap-3.5">
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
              isRefreshing={controller.isRefreshing}
            />

            {/* Quick actions */}
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
