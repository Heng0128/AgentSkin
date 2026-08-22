// SPDX-License-Identifier: MPL-2.0

/**
 * # AppDetailsDrawer
 *
 * Bottom detail drawer for the Apps page. Shows extended metadata and actions
 * for the selected app (`drawerAppId` in appsStore).
 *
 * Actions:
 *   · 启动 (launch) — calls appsStore.launch(app)
 *   · 隐藏/显示 (toggle hidden) — calls appsStore.toggleHidden(appId)
 *   · 关闭 (close) — sets drawerAppId to null
 *
 * Slides up from the bottom with a translate-y animation. Height ~300px.
 */

import { AppMark } from '@/components/app-mark';
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
    <div
      aria-hidden={!drawerAppId}
      className={cn(
        'absolute bottom-0 left-0 right-0 z-20 h-[300px] border-t border-border-strong bg-card shadow-float',
        'transition-transform duration-slow ease-[cubic-bezier(.16,1,.3,1)]',
        drawerAppId ? 'translate-y-0' : 'translate-y-full pointer-events-none',
      )}
    >
      {/* Close button */}
      <button
        type="button"
        onClick={handleClose}
        aria-label={t.appDetailsClose}
        className="absolute right-3 top-3 z-10 flex size-6 items-center justify-center rounded-[var(--dl-radius,2px)] bg-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <X size={14} />
      </button>

      {!app ? (
        /* App not found (e.g. uninstalled while drawer was open) */
        <div className="flex h-full items-center justify-center">
          <p className="as-mono">{t.appDetailsAppUnavailable}</p>
        </div>
      ) : (
        <div className="flex h-full gap-6 px-6 py-5">
          {/* Left: icon + name */}
          <div className="flex flex-col items-center gap-2 pt-1">
            {app.adapterMatch ? (
              <AppMark appId={app.adapterMatch} size={48} />
            ) : (
              <span className="flex size-12 items-center justify-center font-display text-[22px] font-bold tracking-tight text-muted-foreground">
                {app.productName.slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className="max-w-[80px] truncate font-display text-[12px] font-bold tracking-[-.01em] text-foreground">
              {app.productName}
            </span>
          </div>

          {/* Right: details + actions */}
          <div className="flex min-w-0 flex-1 flex-col gap-4">
            {/* Metadata grid */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
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
                      <span className="inline-block size-2 rounded-full bg-[var(--muted-foreground)] opacity-25" />
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
                onClick={() => void launch(app)}
                disabled={isRunning}
              >
                <Play size={12} />
                {isRunning ? t.appDetailsRunning : t.appDetailsLaunch}
              </Button>
              <Button variant="outline" size="sm" onClick={() => toggleHidden(app.id)}>
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
        </div>
      )}
    </div>
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
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span
        className={cn('truncate text-[11px] text-foreground', mono && 'font-mono tabular-nums')}
      >
        {value}
      </span>
    </div>
  );
}
