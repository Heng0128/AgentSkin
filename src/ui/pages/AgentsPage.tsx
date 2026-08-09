// SPDX-License-Identifier: MPL-2.0

/**
 * # AgentsPage
 *
 * Agent 管理视图 — 聚合所有 Agent 的状态、安装路径、调试端口配置。
 *
 * 此页面吸收自：
 *   - 原 Dashboard 的「Connected Agents」区块
 *   - 原 Settings 的「Apps」分区（路径/端口覆盖）
 *
 * 设计原则：每个 Agent 单一职责，状态单一事实源来自 statusStore。
 */

import { useEffect, useState } from 'react';
import { APP_META, AppMark } from '@/components/app-mark';
import { Button } from '@/components/ui/button';
import { HugeIcon } from '@/components/ui/huge-icon';
import { Input } from '@/components/ui/input';
import type { AppController } from '@/hooks/useAppController';
import { cn } from '@/lib/utils';

import { Folder01Icon } from '@hugeicons/core-free-icons';
import { AGENT_IDS, type AgentId } from '@shared/types';

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
      <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
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
      <div className="flex items-center justify-between gap-4 border-b border-border px-3.5 py-2.5">
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
            <HugeIcon icon={Folder01Icon} data-icon="inline-start" />
            {t.settingsChoosePath}
          </Button>
        </div>
      </div>

      {/* Port override */}
      <div className="flex items-center justify-between gap-4 px-3.5 py-2.5">
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
      <div className="flex items-center justify-between border-t border-border bg-card2 px-3.5 py-2">
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

export default function AgentsPage({ controller }: { controller: AppController }) {
  const { t } = controller;

  // Load settings on mount so override cards have data.
  // Using loadSettings (not openSettings) to avoid mutating settingsSection
  // as a side-effect of mounting the Agents page.
  useEffect(() => {
    void controller.loadSettings();
  }, [controller.loadSettings]);

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1240px] px-[30px] py-[22px] pb-[70px]">
          {/* Page header */}
          <header className="mb-5">
            <h1 className="font-display text-[22px] font-bold tracking-tight text-foreground">
              {t.agentsPageTitle}
            </h1>
            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{t.agentsPageDesc}</p>
          </header>

          {/* Agent cards grid */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {AGENT_IDS.map((appId) => (
              <AgentConfigCard key={appId} controller={controller} appId={appId} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
