// SPDX-License-Identifier: MPL-2.0

/**
 * # BundleStudioTab
 *
 * BUNDLE tab for Theme Studio's Workbench. Manages `.agentskin-bundle`
 * packages — a Theme + Wallpaper combo container that can be shared.
 *
 * Operations (this iteration):
 *   - Import a .agentskin-bundle file (unpacks + registers theme + wallpaper)
 *   - Install / Reveal / Delete installed bundles
 *
 * Bundle *creation* happens from the THEME tab (export flow) — the BUNDLE tab
 * is the landing zone for installing and managing received bundles.
 *
 * Inspired by:
 *   - HeiGe Codex Skin Studio: theme export packaging
 *   - Trae-Skin: theme create/update/delete lifecycle
 *
 * Design: Swiss/International — rounded-[2px], #FF453A primary,
 * Space Grotesk display + IBM Plex Mono mono.
 */

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/api/agentSkinClient';
import { Button } from '@/components/ui/button';
import { HugeIcon } from '@/components/ui/huge-icon';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useNotificationStore } from '@/stores/notificationStore';
import { useStudioStore } from '@/stores/studioStore';

import {
  Delete01Icon,
  Download01Icon,
  Package01Icon,
  RefreshIcon,
} from '@hugeicons/core-free-icons';
import { toMessage } from '@shared/errors';
import type { UiMessages } from '@shared/i18n';
import type { ApplyRequest } from '@shared/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BundleEntry {
  id: string;
  name: string;
  themeId?: string;
  hasWallpaper: boolean;
  createdAt: string;
}

interface BundleStatus {
  loading: boolean;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function BundleStudioTab({ t }: { t: UiMessages }) {
  const showToast = useNotificationStore((s) => s.showToast);
  const activeAgent = useStudioStore((s) => s.getActiveProject()?.agentId ?? null);
  const [bundles, setBundles] = useState<BundleEntry[]>([]);
  const [status, setStatus] = useState<BundleStatus>({ loading: false, error: null });

  const refresh = useCallback(async () => {
    setStatus((s) => ({ ...s, loading: true, error: null }));
    try {
      const list = await api.listBundles();
      setBundles(list);
    } catch (e) {
      setStatus((s) => ({ ...s, error: toMessage(e) }));
    } finally {
      setStatus((s) => ({ ...s, loading: false }));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const handleImport = useCallback(async () => {
    try {
      const result = await api.importBundle();
      if (result) {
        showToast(t.studioBundleInstalled(result.name));
        await refresh();
      }
    } catch (e) {
      const msg = toMessage(e);
      showToast(t.studioBundleImportFailed(msg), 'destructive');
    }
  }, [showToast, refresh, t]);

  const handleInstall = useCallback(
    async (id: string) => {
      try {
        const res = await api.installBundleById(id);
        if (!res.ok) {
          showToast(
            t.studioBundleInstallFailed(res.error ?? t.studioBundleUnknownError),
            'destructive',
          );
          return;
        }
        // Install registers the theme into the library. If a studio project
        // (and thus an agent) is active, push the apply so "安装" genuinely
        // reaches the agent instead of only landing in the library.
        if (activeAgent) {
          try {
            const applyRes = await api.applyTheme({
              themeId: id,
              appId: activeAgent,
            } as ApplyRequest);
            if (applyRes.status === 'applied' || applyRes.status === 'requires-restart') {
              showToast(t.studioBundleInstalledAndApplied(id, activeAgent));
              return;
            }
          } catch {
            /* fall through to the installed-only toast */
          }
        }
        showToast(t.studioBundleInstalledToLibrary(id));
      } catch (e) {
        const msg = toMessage(e);
        showToast(t.studioBundleInstallFailed(msg), 'destructive');
      }
    },
    [showToast, activeAgent, t],
  );

  const handleReveal = useCallback(
    async (id: string) => {
      try {
        await api.showInFolder(`bundles/${id}`);
      } catch (e) {
        // Folder may not exist yet (never exported), or the OS reveal failed.
        showToast(t.studioBundleRevealFailed(toMessage(e)), 'destructive');
      }
    },
    [showToast, t],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await api.deleteBundle(id);
        showToast(t.studioBundleDeleted(id));
        await refresh();
      } catch (e) {
        const msg = toMessage(e);
        showToast(t.studioBundleDeleteFailed(msg), 'destructive');
      }
    },
    [showToast, refresh, t],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header kicker */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <span className="size-2 shrink-0 rounded-full bg-primary" />
        <span
          className="font-mono text-[9.5px] font-semibold uppercase"
          style={{ letterSpacing: '0.14em', color: 'var(--muted-foreground)', opacity: 0.75 }}
        >
          {t.studioBundleKicker}
        </span>
      </div>

      {/* Import / Refresh bar */}
      <div className="flex gap-2 px-4 pb-3">
        <Button
          size="sm"
          variant="default"
          onClick={handleImport}
          className="h-7 flex-1 gap-1 font-mono text-[9.5px] uppercase"
          style={{ letterSpacing: '0.06em', borderRadius: 'var(--radius)' }}
        >
          <HugeIcon icon={Download01Icon} className="size-3" />
          {t.studioBundleImport}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={refresh}
          disabled={status.loading}
          className="h-7 gap-1 font-mono text-[9.5px] uppercase"
          style={{ letterSpacing: '0.06em', borderRadius: 'var(--radius)' }}
        >
          <HugeIcon icon={RefreshIcon} className="size-3" />
          {t.studioBundleRefresh}
        </Button>
      </div>

      {/* Hint */}
      <p
        className="px-4 pb-2 font-mono text-[10px] leading-relaxed"
        style={{ color: 'var(--muted-foreground)' }}
      >
        {t.studioBundleHint}
      </p>

      {/* Error */}
      {status.error && (
        <div
          className="mx-4 mb-2 border border-border bg-card p-2 font-mono text-[10px]"
          style={{ borderRadius: 'var(--radius)', color: 'var(--primary)' }}
        >
          {status.error}
        </div>
      )}

      {/* Bundle list */}
      <ScrollArea className="flex-1 px-4 pb-4">
        {status.loading ? (
          <div className="flex h-20 items-center justify-center">
            <span
              className="font-mono text-[10px] uppercase"
              style={{ letterSpacing: '0.1em', color: 'var(--muted-foreground)' }}
            >
              {t.studioBundleLoading}
            </span>
          </div>
        ) : bundles.length === 0 ? (
          <div
            className="flex h-32 flex-col items-center justify-center border border-dashed border-border bg-card"
            style={{ borderRadius: 'var(--radius)' }}
          >
            <HugeIcon
              icon={Package01Icon}
              className="mb-2 size-6"
              style={{ color: 'var(--muted-foreground)', opacity: 0.4 }}
            />
            <p
              className="font-mono text-[10px] uppercase"
              style={{ letterSpacing: '0.1em', color: 'var(--muted-foreground)' }}
            >
              {t.studioBundleEmpty}
            </p>
            <p
              className="mt-1 font-mono text-[9.5px]"
              style={{ color: 'var(--muted-foreground)', opacity: 0.6 }}
            >
              {t.studioBundleEmptyHint}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {bundles.map((b) => (
              <div
                key={b.id}
                className="border border-border bg-card p-2"
                style={{ borderRadius: 'var(--radius)' }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <HugeIcon icon={Package01Icon} className="size-3 shrink-0 text-primary" />
                      <span
                        className="truncate font-mono text-[10px] font-medium"
                        style={{ color: 'var(--foreground)' }}
                      >
                        {b.name}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <span
                        className="font-mono text-[9.5px]"
                        style={{ color: 'var(--muted-foreground)' }}
                      >
                        {b.id}
                      </span>
                      {b.themeId && (
                        <span
                          className="border border-border px-1 py-0 font-mono text-[9.5px] uppercase"
                          style={{
                            borderRadius: '2px',
                            color: 'var(--muted-foreground)',
                            letterSpacing: '0.05em',
                          }}
                          title={t.studioBundleTagThemeTooltip}
                        >
                          {t.studioBundleTagTheme}
                        </span>
                      )}
                      {b.hasWallpaper && (
                        <span
                          className="border border-border px-1 py-0 font-mono text-[9.5px] uppercase"
                          style={{
                            borderRadius: '2px',
                            color: 'var(--muted-foreground)',
                            letterSpacing: '0.05em',
                          }}
                          title={t.studioBundleTagWallpaperTooltip}
                        >
                          {t.studioBundleTagWallpaper}
                        </span>
                      )}
                    </div>
                  </div>
                  {b.createdAt && (
                    <span
                      className="shrink-0 font-mono text-[9.5px]"
                      style={{ color: 'var(--muted-foreground)', opacity: 0.6 }}
                    >
                      {new Date(b.createdAt).toLocaleDateString()}
                    </span>
                  )}
                </div>

                {/* Actions */}
                <div className="mt-2 flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleInstall(b.id)}
                    className="h-6 gap-1 px-1.5 font-mono text-[10px] uppercase"
                    style={{ letterSpacing: '0.05em', borderRadius: '2px' }}
                  >
                    {t.studioBundleActionInstall}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleReveal(b.id)}
                    className="h-6 gap-1 px-1.5 font-mono text-[10px] uppercase"
                    style={{ letterSpacing: '0.05em', borderRadius: '2px' }}
                  >
                    {t.studioBundleActionReveal}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDelete(b.id)}
                    className="ml-auto h-6 gap-1 px-1.5 font-mono text-[10px] uppercase"
                    style={{
                      letterSpacing: '0.05em',
                      borderRadius: '2px',
                      color: 'var(--primary)',
                    }}
                  >
                    <HugeIcon icon={Delete01Icon} className="size-2.5" />
                    {t.studioBundleActionDelete}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
