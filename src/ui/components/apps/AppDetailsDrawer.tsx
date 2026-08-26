// SPDX-License-Identifier: MPL-2.0

/**
 * # AppDetailsDrawer
 *
 * Right-side detail panel for the Apps page. Shows extended metadata and
 * actions for the selected app (`drawerAppId` in appsStore).
 *
 * Actions:
 *   · 启动 (launch) — calls appsStore.launch(app)
 *   · 隐藏/显示 (toggle hidden) — calls appsStore.toggleHidden(appId)
 *   · 关闭 (close) — sets drawerAppId to null
 *
 * In-flow right column (400px, border-l) matching the Themes/Wallpaper detail
 * panels — the app list yields width to it instead of a bottom-drawer overlay.
 */

import { AppMark } from '@/components/AppMark';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAppsStore } from '@/stores/appsStore';
import { useShellStore } from '@/stores/shellStore';

import type { UiMessages } from '@shared/i18n';
import { uiMessages } from '@shared/i18n';
import type { ScannedApp } from '@shared/types';
import { Eye, EyeOff, Play, X } from 'lucide-react';

export function AppDetailsDrawer() {
  const drawerAppId = useAppsStore((s) => s.drawerAppId);
  const openDrawer = useAppsStore((s) => s.openDrawer);
  const scanResult = useAppsStore((s) => s.scanResult);
  const runningApps = useAppsStore((s) => s.runningApps);
  const hiddenApps = useAppsStore((s) => s.hiddenApps);
  const launch = useAppsStore((s) => s.launch);
  const toggleHidden = useAppsStore((s) => s.toggleHidden);
  const locale = useShellStore((s) => s.locale);
  const t: UiMessages = uiMessages[locale];

  // Resolve the app from scan result (adapted + other).
  const app: ScannedApp | undefined = drawerAppId
    ? [...(scanResult?.adapted ?? []), ...(scanResult?.other ?? [])].find(
        (a) => a.id === drawerAppId,
      )
    : undefined;

  const running = drawerAppId ? runningApps.get(drawerAppId) : undefined;
  const isRunning = running !== undefined;
  const isHidden = drawerAppId ? hiddenApps.has(drawerAppId) : false;

  // Close handler.
  const handleClose = () => openDrawer(null);

  return (
    <aside className="relative flex h-full w-[400px] shrink-0 flex-col border-l border-border bg-card">
      {/* Close button */}
      <button
        type="button"
        onClick={handleClose}
        aria-label={t.appDetailsClose}
        className="absolute right-3 top-3 z-[var(--z-content)] flex size-6 items-center justify-center rounded-sm bg-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X size={14} />
      </button>

      {!app ? (
        /* App not found (e.g. uninstalled while drawer was open) */
        <div className="flex flex-1 items-center justify-center">
          <p className="text-[11px] text-muted-foreground">{t.appDetailsAppUnavailable}</p>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4">
          {/* Identity: icon + name + status */}
          <div className="flex items-center gap-3 pr-8">
            {app.adapterMatch ? (
              <AppMark appId={app.adapterMatch} size={36} />
            ) : (
              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-lg font-normal text-muted-foreground">
                {app.productName.slice(0, 1).toUpperCase()}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium leading-snug">{app.productName}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span
                  className={cn(
                    'inline-block size-1.5 shrink-0 rounded-full',
                    isRunning ? 'bg-cr-success' : 'bg-muted-foreground/25',
                  )}
                />
                {isRunning ? t.appDetailsRunning : t.appDetailsNotStarted}
              </p>
            </div>
          </div>

          {/* Metadata grid */}
          <div className="grid grid-cols-2 gap-x-3 gap-y-2.5 rounded-lg border border-border bg-muted/30 px-3.5 py-3">
            <DetailRow label={t.appDetailsPath} value={app.exePath} mono />
            <DetailRow
              label={t.appDetailsStatus}
              value={
                isRunning ? (
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block size-2 rounded-full bg-cr-success" />
                    {t.appDetailsRunning}
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block size-2 rounded-full bg-muted-foreground/25" />
                    {t.appDetailsNotStarted}
                  </span>
                )
              }
            />
            <DetailRow
              label={t.appDetailsCdpPort}
              value={
                running?.port !== undefined && running.port !== null ? `:${running.port}` : '—'
              }
            />
            <DetailRow label={t.appDetailsPid} value={running?.pid ? String(running.pid) : '—'} />
            <DetailRow label={t.appDetailsAdapter} value={app.adapterMatch ?? '—'} />
            <DetailRow label={t.appDetailsSource} value={app.source ?? '—'} />
          </div>

          {/* Action buttons */}
          <div className="mt-auto flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              className="flex-1"
              onClick={() => void launch(app)}
              disabled={isRunning}
            >
              <Play size={12} />
              {isRunning ? t.appDetailsRunning : t.appDetailsLaunch}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => toggleHidden(app.id)}
            >
              {isHidden ? (
                <>
                  <Eye size={12} />
                  {t.appDetailsShow}
                </>
              ) : (
                <>
                  <EyeOff size={12} />
                  {t.appDetailsHide}
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </aside>
  );
}

/** A single label-value row in the detail grid. */
function DetailRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-micro text-muted-foreground">{label}</span>
      <span
        className={cn('truncate text-[11px] text-foreground', mono && 'font-mono tabular-nums')}
      >
        {value}
      </span>
    </div>
  );
}
