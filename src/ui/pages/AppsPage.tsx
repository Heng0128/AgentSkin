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
import { EmptyState } from '@/components/ui/empty-state';
import { FilterChips } from '@/components/ui/filter-chips';
import { PageHeader } from '@/components/ui/page-header';
import { PageToolbar } from '@/components/ui/page-toolbar';
import { Spinner } from '@/components/ui/spinner';
import { useAppsStore } from '@/stores/appsStore';
import { useShellStore } from '@/stores/shellStore';

import { identityKey } from '@shared/app-identity';
import { uiMessages } from '@shared/i18n';
import type { ScannedApp } from '@shared/types';
import { Monitor, Plus, RefreshCw } from 'lucide-react';

/** Static skeleton item IDs — avoids array-index keys in the loading placeholder. */
const SKELETON_ITEMS = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];

/** Category filter tabs. */
const CATEGORY_TABS = [
  { key: 'all' as const, label: 'appsFilterAll' },
  { key: 'adapted' as const, label: 'appsFilterAdapted' },
  { key: 'other' as const, label: 'appsFilterOther' },
  { key: 'hidden' as const, label: 'appsFilterHidden' },
];

export function AppsPage() {
  // i18n
  const locale = useShellStore((s) => s.locale);
  const t = uiMessages[locale];

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

  /** Build filter chips options with counts appended to labels. */
  const filterOptions = useMemo(() => {
    return CATEGORY_TABS.map((tab) => ({
      value: tab.key,
      label: `${t[tab.label as keyof typeof t]} (${counts[tab.key]})`,
    }));
  }, [t, counts]);

  /** Trigger a forced rescan of installed Electron applications. */
  const handleScan = () => {
    void scan(true);
  };

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
        <div className="px-3 py-3 pb-[var(--pb-drawer,320px)]">
          {/* Page header */}
          <PageHeader title={t.navApps} count={visibleApps.length}>
            <PageToolbar
              actions={
                <Button variant="outline" size="sm" onClick={handleScan} disabled={scanning}>
                  {scanning ? <Spinner className="animate-spin" /> : <RefreshCw className="size-3.5" />}
                  {t.scan}
                </Button>
              }
            />
          </PageHeader>

          {/* Category filter chips */}
          <div className="mb-5">
            <FilterChips
              options={filterOptions}
              value={categoryFilter}
              onChange={setCategoryFilter}
            />
          </div>

          {/* Scan progress bar */}
          {scanning && (
            <div
              className="mb-5 h-1 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={scanProgress}
            >
              <div
                className="h-full bg-primary transition-all duration-slow"
                style={{ width: `${scanProgress}%` }}
              />
            </div>
          )}

          {/* Scan error banner */}
          {scanError && (
            <div
              role="alert"
              className="mb-5 flex items-center justify-between gap-2 rounded-md bg-destructive/10 px-2 py-2.5"
            >
              <p className="min-w-0 flex-1 truncate text-label text-destructive">
                {t.appsScanFailed}
                {scanError}
              </p>
              <Button variant="ghost" size="sm" onClick={() => void scan(true)}>
                {t.appsActionRetry}
              </Button>
            </div>
          )}

          {/* Status legend */}
          <div className="mb-5 flex items-center gap-4 as-micro">
            <span className="flex items-center gap-2">
              <span className="inline-block size-2 rounded-full bg-cr-success" />
              {t.appsStatusRunning}
            </span>
            <span className="flex items-center gap-2">
              <span className="inline-block size-2 rounded-full bg-muted-foreground/25" />
              {t.appsStatusStopped}
            </span>
            <span className="flex items-center gap-2">
              <span className="inline-block size-2 rounded-full bg-cr-warning" />
              {t.appsStatusNoPort}
            </span>
          </div>

          {/* Skeleton during initial scan */}
          {scanning && !scanResult && (
            <section className="mb-6 snap-start">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8">
                {SKELETON_ITEMS.map((id) => (
                  <div key={id} className="h-24 animate-pulse rounded-md bg-muted" />
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
            <EmptyState
              icon={<Monitor />}
              iconSize="lg"
              title={categoryFilter === 'hidden' ? t.appsEmptyHidden : t.appsEmptyNoApps}
            />
          )}

          {/* Empty state — pre-scan guidance */}
          {!scanResult && !scanning && !scanError && (
            <EmptyState
              icon={<Monitor />}
              iconSize="lg"
              title={t.appsScanToFind}
              action={
                <Button variant="outline" size="sm" onClick={() => void scan(true)}>
                  <RefreshCw size={14} />
                  {t.appsActionScan}
                </Button>
              }
            />
          )}

          {/* Manual add button */}
          <div className="mt-4">
            <Button variant="ghost" size="sm" onClick={handleManualAdd}>
              <Plus size={14} className="text-muted-foreground" />
              {t.appsActionAddManual}
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
