// SPDX-License-Identifier: MPL-2.0

/**
 * # CenterTabBundle
 *
 * Bundle management panel — lists installed bundle packages and provides
 * import / install / delete operations.
 *
 * Data source: studioStore (bundles, bundlesLoading, refreshBundles,
 * importAndInstallBundle, deleteBundle).
 *
 * Visual style follows Quiet Workbench design tokens:
 *   · rounded-md corners
 *   · spacing from the 4/8/16/24/32/48 Tailwind scale only
 *   · typography: text-[10px] mono for body, text-xs for headings
 *   · all colors via CSS custom properties (no bare hex/rgba)
 */

import { useEffect } from 'react';
import { useStudioStore } from '@/stores/studioStore';

import type { UiMessages } from '@shared/i18n';
import { EmptyState } from '@/components/ui/empty-state';
import { Package, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

export function CenterTabBundle({ t }: { t: UiMessages }) {
  const { bundles, bundlesLoading, refreshBundles, importAndInstallBundle, deleteBundle } =
    useStudioStore(
      useShallow((s) => ({
        bundles: s.bundles,
        bundlesLoading: s.bundlesLoading,
        refreshBundles: s.refreshBundles,
        importAndInstallBundle: s.importAndInstallBundle,
        deleteBundle: s.deleteBundle,
      })),
    );

  useEffect(() => {
    void refreshBundles();
  }, [refreshBundles]);

  const handleImport = () => {
    void importAndInstallBundle();
  };

  const handleRefresh = () => {
    void refreshBundles();
  };

  const handleDelete = (id: string) => {
    if (window.confirm(t.studioBundleDeleteConfirm)) {
      void deleteBundle(id);
    }
  };

  return (
    <div className="flex h-full flex-col rounded-md border border-border bg-surface p-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="h-3.5 w-3.5 text-muted-foreground" />
          <h3 className="text-[11px] font-normal text-foreground">
            {t.studioBundleListTitle.toUpperCase()}
          </h3>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={bundlesLoading}
            className="flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[10px] text-foreground/60 transition-colors hover:bg-card2 disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${bundlesLoading ? 'animate-spin' : ''}`} />
            {t.studioBundleRefresh}
          </button>
          <button
            type="button"
            onClick={handleImport}
            disabled={bundlesLoading}
            className="flex items-center gap-1 rounded-md border border-[var(--primary)] bg-[var(--primary)] px-2 py-1 text-[10px] text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Plus className="h-3 w-3" />
            {t.studioBundleImportBtn}
          </button>
        </div>
      </div>

      {/* Description */}
      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
        {t.studioBundlePanelDesc}
      </p>

      {/* Content area */}
      <div className="mt-4 flex-1 overflow-auto">
        {bundlesLoading && bundles.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <p className="text-[10px] text-muted-foreground/40">{t.studioBundleLoading}</p>
          </div>
        ) : bundles.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <EmptyState icon={<Package />} title={t.studioBundleEmpty} hint={t.studioBundleImportBtn} iconSize="md" />
          </div>
        ) : (
          <div className="space-y-2">
            {bundles.map((bundle) => (
              <div
                key={bundle.id}
                className="flex items-center justify-between rounded-md border border-border bg-card p-3"
              >
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-normal text-foreground">
                    {bundle.name}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground">
                      {t.studioBundleTagTheme}: {bundle.themeId ?? '—'}
                    </span>
                    {bundle.hasWallpaper && (
                      <span className="rounded-md bg-card2 px-1 py-0.5 text-[10px] text-foreground/60">
                        {t.studioBundleHasWallpaper}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] tabular-nums text-muted-foreground/40">
                    {bundle.createdAt !== undefined && bundle.createdAt !== ''
                      ? bundle.createdAt
                      : '—'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleDelete(bundle.id)}
                  className="flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:border-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3" />
                  {t.studioBundleDeleteBtn}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
