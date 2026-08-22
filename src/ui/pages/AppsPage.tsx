// SPDX-License-Identifier: MPL-2.0

/**
 * # AppsPage
 *
 * Application quick-launcher page. Displays scanned Electron applications in
 * two sections: "adapted" (backed by an AgentSkin adapter, auto-injected
 * with CDP port) and "other" (raw Electron, launched as-is). Double-clicking
 * a card launches the app. Single-clicking opens the bottom detail drawer.
 *
 * ## Layout
 *
 *   ┌───────────────────────────────────────────────────────────────┐
 *   │  应用                                      [扫描]            │
 *   │  全部 (5)  已适配 (3)  其它 (2)  隐藏 (0)                     │
 *   │  ─────────────────────────────────────────────────────────    │
 *   │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐         │
 *   │  │icon │ │icon │ │icon │ │icon │ │icon │ │icon │         │
 *   │  │ ●   │ │ ○   │ │ ●   │ │ ○   │ │ ●   │ │ ○   │         │
 *   │  │TRAE │ │Qoder│ │WorkB│ │App1 │ │App2 │ │App3 │         │
 *   │  │:9222│ │     │ │:9225│ │     │ │     │ │     │         │
 *   │  └─────┘ └─────┘ └─────┘ └─────┘ └─────┘ └─────┘         │
 *   ├───────────────────────────────────────────────────────────────┤
 *   │ AppDetailsDrawer (bottom, ~300px)                            │
 *   └───────────────────────────────────────────────────────────────┘
 *
 * ## Filtering
 *
 * Horizontal category tabs at the top control which apps are visible:
 *   · all      → adapted + other (excluding hidden)
 *   · adapted  → only adapted section
 *   · other    → only other section
 *   · hidden   → only hidden apps
 *
 * ## State
 *
 * All state lives in `appsStore`. This page is a pure view layer — it reads
 * from the store and delegates user actions back to store actions.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { AppCard } from '@/components/apps/AppCard';
import { AppDetailsDrawer } from '@/components/apps/AppDetailsDrawer';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAppsStore } from '@/stores/appsStore';

import { identityKey } from '@shared/app-identity';
import type { ScannedApp } from '@shared/types';
import { Plus, RefreshCw } from 'lucide-react';

/** Static skeleton item IDs — avoids array-index keys in the loading placeholder. */
const SKELETON_ITEMS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];

/** Category filter tabs. */
const CATEGORY_TABS = [
  { key: 'all' as const, label: '全部' },
  { key: 'adapted' as const, label: '已适配' },
  { key: 'other' as const, label: '其它' },
  { key: 'hidden' as const, label: '隐藏' },
];

export function AppsPage() {
  const scanResult = useAppsStore((s) => s.scanResult);
  const scanning = useAppsStore((s) => s.scanning);
  const scanError = useAppsStore((s) => s.scanError);
  const launchingApps = useAppsStore((s) => s.launchingApps);
  const runningApps = useAppsStore((s) => s.runningApps);
  const hiddenApps = useAppsStore((s) => s.hiddenApps);
  const scan = useAppsStore((s) => s.scan);
  const launch = useAppsStore((s) => s.launch);
  const addCustomApp = useAppsStore((s) => s.addCustomApp);
  const scanProgress = useAppsStore((s) => s.scanProgress);
  const openDrawer = useAppsStore((s) => s.openDrawer);

  /** Active category filter for the horizontal tab bar (local state). */
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'adapted' | 'other' | 'hidden'>(
    'all',
  );

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

  /** Count per category tab. */
  const counts = useMemo(
    () => ({
      all: adapted.length + other.length - hiddenApps.size,
      adapted: adapted.length,
      other: other.length,
      hidden: hiddenApps.size,
    }),
    [adapted, other, hiddenApps],
  );

  /** Apps filtered by the active category tab. */
  const visibleApps = useMemo(() => {
    const all = [...adapted, ...other];
    switch (categoryFilter) {
      case 'adapted':
        return adapted.filter((a) => !hiddenApps.has(a.id));
      case 'other':
        return other.filter((a) => !hiddenApps.has(a.id));
      case 'hidden':
        return all.filter((a) => hiddenApps.has(a.id));
      default:
        return all.filter((a) => !hiddenApps.has(a.id));
    }
  }, [categoryFilter, adapted, other, hiddenApps]);

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

  /** Render a single app card with click (drawer) + double-click (launch). */
  const renderCard = (app: ScannedApp) => {
    const running = runningApps.get(app.id);
    const isRunning = running !== undefined;
    const isLaunching = launchingApps.has(app.id);
    return (
      <AppCard
        key={identityKey(app)}
        app={app}
        isRunning={isRunning}
        isLaunching={isLaunching}
        port={running?.port ?? null}
        onClick={() => openDrawer(app.id)}
        onDoubleClick={() => void launch(app)}
      />
    );
  };

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* Scrollable content */}
      <div className="min-h-0 flex-1 snap-y snap-proximity overflow-y-auto scroll-smooth">
        <div className="mx-auto max-w-[1240px] px-8 py-6" style={{ paddingBottom: '320px' }}>
          {/* Page header */}
          <header className="mb-5 flex items-center justify-between">
            <div>
              <h1 className="font-display text-sm font-bold tracking-tight text-foreground">
                应用
              </h1>
              <p className="mt-1 as-micro">
                单击查看详情 · 双击启动应用 · 已适配应用自动注入 CDP 端口
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

          {/* Horizontal category tabs */}
          <div className="mb-5 flex gap-2 border-b border-border pb-2">
            {CATEGORY_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setCategoryFilter(tab.key)}
                className={cn(
                  'flex items-center gap-1.5 rounded-[var(--dl-radius,2px)] px-3 py-1.5 text-[12px] font-medium transition-colors duration-fast',
                  categoryFilter === tab.key
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                {tab.label}
                <span
                  className={cn(
                    'font-mono text-[10px] tabular-nums',
                    categoryFilter === tab.key ? 'text-foreground/70' : 'text-muted-foreground/50',
                  )}
                >
                  {counts[tab.key]}
                </span>
              </button>
            ))}
          </div>

          {/* Scan progress bar */}
          {scanning && (
            <div
              className="mb-5 h-1 overflow-hidden rounded-[var(--dl-radius,2px)] bg-muted"
              role="progressbar"
              aria-valuenow={scanProgress}
            >
              <div
                className="h-full bg-cr-primary transition-all duration-slow"
                style={{ width: `${scanProgress}%` }}
              />
            </div>
          )}

          {/* Scan error banner */}
          {scanError && (
            <div
              role="alert"
              className="mb-5 flex items-center justify-between gap-3 rounded-md bg-destructive/10 px-4 py-3"
            >
              <p className="min-w-0 flex-1 truncate text-[12px] text-destructive">
                扫描失败：{scanError}
              </p>
              <Button variant="ghost" size="sm" onClick={() => void scan(true)}>
                重试
              </Button>
            </div>
          )}

          {/* Status legend */}
          <div className="mb-5 flex items-center gap-4 as-micro">
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

          {/* Skeleton during initial scan */}
          {scanning && !scanResult && (
            <section className="mb-6 snap-start">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
                {SKELETON_ITEMS.map((id) => (
                  <div key={id} className="h-24 animate-pulse rounded-lg bg-muted" />
                ))}
              </div>
            </section>
          )}

          {/* App grid — single unified grid based on active category */}
          {visibleApps.length > 0 && (
            <section className="mb-6 snap-start">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
                {visibleApps.map(renderCard)}
              </div>
            </section>
          )}

          {/* Empty state — scanned but no apps found for current filter */}
          {scanResult && !scanning && visibleApps.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <p className="font-mono text-[11px]">
                {categoryFilter === 'hidden' ? '没有隐藏的应用' : '未发现任何 Electron 应用'}
              </p>
            </div>
          )}

          {/* Empty state — pre-scan guidance */}
          {!scanResult && !scanning && !scanError && (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <p className="text-[13px]">点击扫描按钮发现应用</p>
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

      {/* Bottom detail drawer */}
      <AppDetailsDrawer />
    </div>
  );
}
