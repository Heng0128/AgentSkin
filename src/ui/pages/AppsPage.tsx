// SPDX-License-Identifier: MPL-2.0

/**
 * # AppsPage
 *
 * Application quick-launcher page. Displays scanned Electron applications in
 * two sections: "adapted" (backed by an AgentSkin adapter, auto-injected
 * with CDP port) and "other" (raw Electron, launched as-is). Double-clicking
 * a card launches the app.
 *
 * ## Layout
 *
 *   ┌──────────────────────────────────────────────┐
 *   │  应用                                    [扫描]│
 *   │                                              │
 *   │  已适配应用                                  │
 *   │  ┌─────┐ ┌─────┐ ┌─────┐                  │
 *   │  │icon │ │icon │ │icon │                  │
 *   │  │ ●   │ │ ○   │ │ ●   │                  │
 *   │  │TRAE │ │Qoder│ │WorkB│                  │
 *   │  │:9222│ │     │ │:9225│                  │
 *   │  └─────┘ └─────┘ └─────┘                  │
 *   │                                              │
 *   │  其它 Electron 应用                          │
 *   │  ┌─────┐ ┌─────┐ ┌─────┐                  │
 *   │  │icon │ │icon │ │icon │                  │
 *   │  │ ○   │ │ ●   │ │ ▲   │                  │
 *   │  │Code │ │Notion│ │Slack│                  │
 *   │  └─────┘ └─────┘ └─────┘                  │
 *   │                                              │
 *   │  [手动添加]                                   │
 *   └──────────────────────────────────────────────┘
 *
 * ## State
 *
 * All state lives in `appsStore`. This page is a pure view layer — it reads
 * from the store and delegates user actions back to store actions.
 */

import { useEffect, useRef } from 'react';
import { AppCard } from '@/components/apps/AppCard';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAppsStore } from '@/stores/appsStore';

import { identityKey } from '@shared/app-identity';
import { Plus, RefreshCw } from 'lucide-react';

export function AppsPage() {
  const scanResult = useAppsStore((s) => s.scanResult);
  const scanning = useAppsStore((s) => s.scanning);
  const scanError = useAppsStore((s) => s.scanError);
  const launchingApps = useAppsStore((s) => s.launchingApps);
  const runningApps = useAppsStore((s) => s.runningApps);
  const scan = useAppsStore((s) => s.scan);
  const launch = useAppsStore((s) => s.launch);
  const addCustomApp = useAppsStore((s) => s.addCustomApp);

  /** Hidden file input triggerable from the manual-add button. */
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scan on mount if we have no data yet. `scanError` is part of the
  // guard so a failed auto-scan does NOT re-trigger on every render (which
  // would loop a persistently-failing scan forever); the user retries via the
  // button instead.
  useEffect(() => {
    if (!scanResult && !scanError && !scanning) {
      void scan();
    }
  }, [scanResult, scanError, scanning, scan]);

  const adapted = scanResult?.adapted ?? [];
  const other = scanResult?.other ?? [];

  /** Open the native-style file picker via a hidden input[type=file]. */
  const handleManualAdd = () => {
    fileInputRef.current?.click();
  };

  /** When the user picks an exe, resolve its real path and add to the list. */
  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Electron injects `path` onto File objects; fallback to name for safety.
    const exePath = (file as File & { path?: string }).path ?? file.name;
    if (exePath) {
      await addCustomApp(exePath);
    }

    // Reset input so selecting the same file twice re-fires onChange.
    e.target.value = '';
  };

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1240px] px-8 py-6 pb-[70px]">
          {/* Page header */}
          <header className="mb-5 flex items-center justify-between">
            <div>
              <h1 className="font-display text-sm font-bold tracking-tight text-foreground">
                应用
              </h1>
              <p className="mt-1 text-[10px] text-muted-foreground">
                双击启动应用 · 已适配应用自动注入 CDP 端口
              </p>
            </div>
            <Button variant="outline" size="sm" disabled={scanning} onClick={() => void scan(true)}>
              <RefreshCw
                size={14}
                className={cn('text-muted-foreground', scanning && 'animate-spin')}
              />
              {scanning ? '扫描中...' : '扫描'}
            </Button>
          </header>

          {/* Scan error banner */}
          {scanError && (
            <div
              className="mb-5 flex items-center justify-between gap-3 rounded-md px-4 py-3"
              style={{ background: 'var(--redbg)' }}
            >
              <p
                className="min-w-0 flex-1 truncate text-[12px]"
                style={{ color: 'var(--destructive)' }}
              >
                扫描失败：{scanError}
              </p>
              <Button variant="ghost" size="sm" onClick={() => void scan(true)}>
                重试
              </Button>
            </div>
          )}

          {/* Status legend */}
          <div className="mb-5 flex items-center gap-4 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-2">
              <span className="inline-block size-2 rounded-full bg-cr-success" />
              运行中
            </span>
            <span className="flex items-center gap-2">
              <span className="inline-block size-2 rounded-full bg-[var(--muted-foreground)] opacity-25" />
              未启动
            </span>
            <span className="flex items-center gap-2">
              <span className="inline-block size-2 rounded-full bg-cr-warning" />
              无端口
            </span>
          </div>

          {/* Adapted apps section */}
          {adapted.length > 0 && (
            <section className="mb-6">
              <h2 className="mb-3 font-display text-[13px] font-bold tracking-[-.01em] text-foreground">
                已适配应用
              </h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
                {adapted.map((app) => {
                  const running = runningApps.get(app.id);
                  const isRunning = running !== undefined;
                  const isLaunching = launchingApps.has(app.id);
                  return (
                    <AppCard
                      // Stable identity key — a streamed `update` (better entry
                      // for the same product) must reuse the card, not remount it.
                      key={identityKey(app)}
                      app={app}
                      isRunning={isRunning}
                      isLaunching={isLaunching}
                      port={running?.port ?? null}
                      onDoubleClick={() => void launch(app)}
                    />
                  );
                })}
              </div>
            </section>
          )}

          {/* Other Electron apps section */}
          {other.length > 0 && (
            <section className="mb-6">
              <h2 className="mb-3 font-display text-[13px] font-bold tracking-[-.01em] text-foreground">
                其它 Electron 应用
              </h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
                {other.map((app) => {
                  const running = runningApps.get(app.id);
                  const isRunning = running !== undefined;
                  const isLaunching = launchingApps.has(app.id);
                  return (
                    <AppCard
                      // Stable identity key — see adapted section comment.
                      key={identityKey(app)}
                      app={app}
                      isRunning={isRunning}
                      isLaunching={isLaunching}
                      port={running?.port ?? null}
                      onDoubleClick={() => void launch(app)}
                    />
                  );
                })}
              </div>
            </section>
          )}

          {/* Empty state */}
          {scanResult && adapted.length === 0 && other.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <p className="font-mono text-[11px]">未发现任何 Electron 应用</p>
            </div>
          )}

          {/* Manual add button */}
          <div className="mt-4">
            <Button variant="ghost" size="sm" onClick={handleManualAdd}>
              <Plus size={14} className="text-muted-foreground/50" />
              手动添加
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".exe"
              className="hidden"
              onChange={handleFileSelected}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
