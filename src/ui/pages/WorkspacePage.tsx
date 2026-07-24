// SPDX-License-Identifier: MPL-2.0

/**
 * # WorkspacePage
 *
 * Product home — "AI Coding Environment Manager".
 *
 * Layout:
 *   Hero (brand gradient, continue action)
 *   Stats (3-up summary: themes installed / agents online / themes applied)
 *   Agent Status (compact strip showing every agent's live state)
 *   All Environments (grid)
 *   Quick Actions (browse themes / import / wallpaper center / restore all)
 *
 * Environment actions are centralized in useEnvironmentActions:
 *   - switchEnvironment() creates preset + applies theme
 *   - renameEnvironment() updates preset name
 *   - duplicateEnvironment() clones a preset
 *   - deleteEnvironment() removes a preset
 *   - No direct controller calls from JSX
 */
import { useCallback, useState } from 'react';
import {
  PackageIcon,
  Search01Icon,
  Image02Icon,
  Copy01Icon,
  PaintBoardIcon,
  BotIcon,
  CheckmarkCircle02Icon,
} from '@hugeicons/core-free-icons';
import type { AgentId } from '@shared/types';
import type { AppController } from '@/hooks/useAppController';
import { useEnvironments } from '@/hooks/useEnvironments';
import { useEnvironmentActions } from '@/hooks/useEnvironmentActions';
import { EnvironmentHero } from '@/components/workspace/EnvironmentHero';
import { EnvironmentGrid } from '@/components/workspace/EnvironmentGrid';
import { WorkspaceQuickActions } from '@/components/workspace/WorkspaceQuickActions';
import { AgentStatusBar } from '@/components/workspace/AgentStatusBar';
import { WorkspaceStats, type WorkspaceStatItem } from '@/components/workspace/WorkspaceStats';
import { RenameDialog } from '@/components/rename-dialog';

export function WorkspacePage({ controller }: { controller: AppController }) {
  const { activeEnvironment, environments } = useEnvironments(controller);
  const envActions = useEnvironmentActions(controller);
  const { t } = controller;

  // --- Lifecycle handlers ---

  const handleSwitchEnv = useCallback((env: typeof environments[number]) => {
    void envActions.switchEnvironment(env);
  }, [envActions]);

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
  // Delegates to controller.restoreAll (shared with TitleBar) to avoid the
  // previous duplication where both sites inlined the same Promise.all logic.
  const handleRestoreAll = useCallback(() => controller.restoreAll(), [controller]);

  // --- Rename dialog state ---
  const [renamePresetId, setRenamePresetId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const handleRenameOpen = useCallback((presetId: string) => {
    const preset = environments.find((e) => e.presetId === presetId);
    if (preset) {
      setRenameValue(preset.name);
    }
    setRenamePresetId(presetId);
  }, [environments]);

  const handleRenameSubmit = useCallback(() => {
    if (renamePresetId && renameValue.trim()) {
      envActions.renameEnvironment(renamePresetId, renameValue.trim());
    }
    setRenamePresetId(null);
    setRenameValue('');
  }, [renamePresetId, renameValue, envActions]);

  // --- Duplicate handler ---
  const handleDuplicate = useCallback((presetId: string) => {
    const preset = environments.find((e) => e.presetId === presetId);
    if (preset) {
      const newName = `${preset.name} 副本`;
      envActions.duplicateEnvironment(presetId, newName);
    }
  }, [environments, envActions]);

  // --- Delete handler ---
  const handleDelete = useCallback((presetId: string) => {
    envActions.deleteEnvironment(presetId);
  }, [envActions]);

  // --- Summary stats ---
  // Derived from controller + environments so the cards update live with
  // status polling and apply/restore operations.
  const installedThemeCount = controller.installed.length;
  const runningAgentCount = environments.filter((e) => e.agentRunning).length;
  const appliedThemeCount = new Set(
    (controller.status?.apps ?? [])
      .map((app) => app.activeThemeId)
      .filter((id): id is string => Boolean(id)),
  ).size;

  const statsItems: WorkspaceStatItem[] = [
    {
      id: 'themes-installed',
      label: t.workspaceStatThemes,
      value: installedThemeCount,
      icon: PaintBoardIcon,
      accent: 'violet',
    },
    {
      id: 'agents-online',
      label: t.workspaceStatAgents,
      value: runningAgentCount,
      icon: BotIcon,
      accent: 'sky',
    },
    {
      id: 'themes-applied',
      label: t.workspaceStatActive,
      value: appliedThemeCount,
      icon: CheckmarkCircle02Icon,
      accent: 'emerald',
    },
  ];

  // Quick actions
  const hasActiveTheme = (controller.status?.apps ?? []).some((app) => app.activeThemeId);
  const quickActions = [
    {
      id: 'browse',
      label: t.browseThemes,
      description: '发现并应用新主题',
      icon: Search01Icon,
      primary: true,
      onClick: handleBrowseThemes,
    },
    {
      id: 'import',
      label: t.importTheme,
      description: '从本地导入主题包',
      icon: PackageIcon,
      onClick: () => void controller.importTheme(),
    },
    {
      id: 'wallpaper',
      label: t.actionWallpaperCenter,
      description: '为 Agent 选择动态壁纸',
      icon: Image02Icon,
      onClick: handleOpenWallpaperCenter,
    },
    {
      id: 'restore-all',
      label: t.actionRestoreAll,
      description: '恢复所有 Agent 原生界面',
      icon: Copy01Icon,
      onClick: () => void handleRestoreAll(),
      disabled: !hasActiveTheme,
    },
  ];

  return (
    <div className="relative h-full overflow-y-auto">
      {/* Subtle page background decoration */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -right-32 -top-32 size-96 rounded-full bg-primary/[0.03] blur-3xl dark:bg-primary/[0.05]" />
        <div className="absolute -bottom-24 -left-24 size-72 rounded-full bg-violet-500/[0.03] blur-3xl dark:bg-violet-400/[0.04]" />
      </div>

      <div className="relative mx-auto flex max-w-5xl flex-col px-6 py-6">
        {/* 1. Hero */}
        <EnvironmentHero
          activeEnv={activeEnvironment}
          t={t}
          onContinue={handleContinue}
        />

        {/* 2. Stats — quick-glance summary cards */}
        <WorkspaceStats items={statsItems} />

        {/* 3. Agent status — compact live strip */}
        <AgentStatusBar
          environments={environments}
          t={t}
          lastStatusAt={controller.lastStatusAt}
          isRefreshing={controller.isRefreshing}
          onSelectAgent={(env) => {
            controller.setActiveAgentId(env.agent.id);
            controller.setRoute('themes');
          }}
        />

        {/* 4. All environments */}
        <EnvironmentGrid
          environments={environments}
          activeId={activeEnvironment?.id ?? null}
          onSwitch={handleSwitchEnv}
          onRename={handleRenameOpen}
          onDuplicate={handleDuplicate}
          onDelete={handleDelete}
          title={t.yourEnvironments}
          t={t}
          onBrowseThemes={handleBrowseThemes}
          progress={controller.bootProgress}
        />

        {/* 5. Quick actions */}
        <WorkspaceQuickActions items={quickActions} />
      </div>

      {/* Rename dialog */}
      <RenameDialog
        open={renamePresetId !== null}
        value={renameValue}
        onChange={setRenameValue}
        onConfirm={handleRenameSubmit}
        onCancel={() => setRenamePresetId(null)}
        title={t.environmentRename}
        confirmLabel={t.confirmDelete}
        cancelLabel={t.cancel}
      />
    </div>
  );
}
