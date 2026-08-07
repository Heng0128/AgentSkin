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

import {
  Delete01Icon,
  Download01Icon,
  Package01Icon,
  RefreshIcon,
} from '@hugeicons/core-free-icons';

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

interface Props {
  onToast: (msg: string, variant?: 'default' | 'destructive') => void;
}

export function BundleStudioTab({ onToast }: Props) {
  const [bundles, setBundles] = useState<BundleEntry[]>([]);
  const [status, setStatus] = useState<BundleStatus>({ loading: false, error: null });

  const refresh = useCallback(async () => {
    setStatus((s) => ({ ...s, loading: true, error: null }));
    try {
      const list = await api.listBundles();
      setBundles(list);
    } catch (e) {
      setStatus((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) }));
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
        onToast(`已安装 Bundle: ${result.name}`);
        await refresh();
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      onToast(`导入失败: ${msg}`, 'destructive');
    }
  }, [onToast, refresh]);

  const handleInstall = useCallback(
    async (id: string) => {
      try {
        await api.installBundleById(id);
        onToast(`Bundle ${id} 已安装并应用`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        onToast(`安装失败: ${msg}`, 'destructive');
      }
    },
    [onToast],
  );

  const handleReveal = useCallback(async (id: string) => {
    try {
      await api.showInFolder(`bundles/${id}`);
    } catch {
      /* folder may not exist yet */
    }
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await api.deleteBundle(id);
        onToast(`已删除: ${id}`);
        await refresh();
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        onToast(`删除失败: ${msg}`, 'destructive');
      }
    },
    [onToast, refresh],
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
          主题包 · BUNDLE WORKSPACE
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
          导入 .agentskin-bundle
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
          刷新
        </Button>
      </div>

      {/* Hint */}
      <p
        className="px-4 pb-2 font-mono text-[9px] leading-relaxed"
        style={{ color: 'var(--muted-foreground)' }}
      >
        Bundle 是主题 + 壁纸的组合包 (
        <code style={{ color: 'var(--primary)' }}>.agentskin-bundle</code>)。 在 THEME
        标签中导出主题后可在管理这里安装/分享。
      </p>

      {/* Error */}
      {status.error && (
        <div
          className="mx-4 mb-2 border border-border bg-card p-2 font-mono text-[9px]"
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
              className="font-mono text-[9px] uppercase"
              style={{ letterSpacing: '0.1em', color: 'var(--muted-foreground)' }}
            >
              加载中…
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
              className="font-mono text-[9px] uppercase"
              style={{ letterSpacing: '0.1em', color: 'var(--muted-foreground)' }}
            >
              暂无 Bundle
            </p>
            <p
              className="mt-1 font-mono text-[8px]"
              style={{ color: 'var(--muted-foreground)', opacity: 0.6 }}
            >
              点击「导入」添加 .agentskin-bundle 文件
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
                        className="font-mono text-[8px]"
                        style={{ color: 'var(--muted-foreground)' }}
                      >
                        {b.id}
                      </span>
                      {b.themeId && (
                        <span
                          className="border border-border px-1 py-0 font-mono text-[7.5px] uppercase"
                          style={{
                            borderRadius: '2px',
                            color: 'var(--muted-foreground)',
                            letterSpacing: '0.05em',
                          }}
                          title="包含主题"
                        >
                          主题
                        </span>
                      )}
                      {b.hasWallpaper && (
                        <span
                          className="border border-border px-1 py-0 font-mono text-[7.5px] uppercase"
                          style={{
                            borderRadius: '2px',
                            color: 'var(--muted-foreground)',
                            letterSpacing: '0.05em',
                          }}
                          title="包含壁纸"
                        >
                          壁纸
                        </span>
                      )}
                    </div>
                  </div>
                  {b.createdAt && (
                    <span
                      className="shrink-0 font-mono text-[8px]"
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
                    className="h-6 gap-1 px-1.5 font-mono text-[8.5px] uppercase"
                    style={{ letterSpacing: '0.05em', borderRadius: '2px' }}
                  >
                    安装
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleReveal(b.id)}
                    className="h-6 gap-1 px-1.5 font-mono text-[8.5px] uppercase"
                    style={{ letterSpacing: '0.05em', borderRadius: '2px' }}
                  >
                    定位
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDelete(b.id)}
                    className="ml-auto h-6 gap-1 px-1.5 font-mono text-[8.5px] uppercase"
                    style={{
                      letterSpacing: '0.05em',
                      borderRadius: '2px',
                      color: 'var(--primary)',
                    }}
                  >
                    <HugeIcon icon={Delete01Icon} className="size-2.5" />
                    删除
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
