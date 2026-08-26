// SPDX-License-Identifier: MPL-2.0

import { useEffect, useRef, useState } from 'react';
import { APP_META, AppMark } from '@/components/AppMark';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import type { AppController, Selection } from '@/hooks/useAppController';
import { cn } from '@/lib/utils';
import { useWallpaperVideoUrl } from '@/lib/wallpaperVideo';

import { AGENT_IDS, type AgentId } from '@shared/types';
import { Package, PaintBucket, Share2, Trash2, X } from 'lucide-react';

/** Per-app apply rows: the drawer chooses the target app, not a global picker. */
function AppActionList({
  controller,
  supportedAgents,
  installedThemeId,
  onApply,
}: {
  controller: AppController;
  supportedAgents: AgentId[];
  installedThemeId: string | null;
  onApply: (appId: AgentId) => Promise<unknown>;
}) {
  const { t } = controller;
  const [pendingApps, setPendingApps] = useState<Set<AgentId>>(new Set());
  const [pendingAll, setPendingAll] = useState(false);

  const run = async (appId: AgentId) => {
    setPendingApps((prev) => new Set(prev).add(appId));
    try {
      await onApply(appId).catch((e) => console.warn('[DetailPanel] apply failed:', e));
    } finally {
      setPendingApps((prev) => {
        const next = new Set(prev);
        next.delete(appId);
        return next;
      });
    }
  };

  const eligibleApps = AGENT_IDS.filter(
    (appId) =>
      supportedAgents.includes(appId) && Boolean(controller.appStatusFor(appId)?.installed),
  );

  const installedApps = AGENT_IDS.filter((appId) =>
    Boolean(controller.appStatusFor(appId)?.installed),
  );

  const detecting = controller.statusStale;

  const runAll = async () => {
    setPendingAll(true);
    try {
      const queue = [...eligibleApps];
      const CONCURRENCY = 6;
      const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        for (;;) {
          const appId = queue.shift();
          if (!appId) break;
          await run(appId).catch((e) => console.warn('[DetailPanel] apply failed:', e));
        }
      });
      await Promise.all(workers);
    } finally {
      setPendingAll(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <Button
        size="sm"
        variant="primary"
        className="w-full"
        disabled={
          pendingAll ||
          detecting ||
          (controller.busy !== null && !String(controller.busy).startsWith('apply:')) ||
          eligibleApps.length === 0
        }
        title={detecting ? t.applyDetectingHint : undefined}
        onClick={() => void runAll()}
      >
        {pendingAll && <Spinner data-icon="inline-start" />}
        {detecting ? t.statusDetecting : t.applyToAllAgents}
        {!detecting && eligibleApps.length > 0 && (
          <span className="ml-1 text-[11px] opacity-70">
            {pendingAll ? `${pendingApps.size}/${eligibleApps.length}` : `(${eligibleApps.length})`}
          </span>
        )}
      </Button>

      <div className="flex flex-col gap-1">
        {installedApps.map((appId) => {
          const supported = supportedAgents.includes(appId);
          const appStatus = controller.appStatusFor(appId);
          const detected = Boolean(appStatus?.installed);
          const live = Boolean(appStatus?.running || appStatus?.debugReady);
          const isActive =
            installedThemeId !== null && appStatus?.activeThemeId === installedThemeId;
          const stateText = !supported
            ? t.notSupported
            : detecting
              ? t.statusDetecting
              : !detected
                ? t.statusNotInstalled
                : appStatus?.debugReady
                  ? t.statusDebugReady
                  : appStatus?.running
                    ? t.statusRunning
                    : t.statusInstalled;
          const appPending = pendingApps.has(appId);
          const displayName =
            controller.agents.find((a) => a.id === appId)?.displayName ??
            APP_META[appId]?.name ??
            appId;
          return (
            <div
              key={appId}
              className={cn(
                'flex items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors',
                isActive
                  ? 'border-cr-success/30 bg-cr-success/[0.04]'
                  : 'border-border bg-muted/30',
                !supported && 'opacity-50',
                supported && detected && 'hover:bg-muted/60',
              )}
            >
              <AppMark appId={appId} size={20} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-[12px] font-medium">
                  {displayName}
                  {isActive && (
                    <Badge
                      variant="secondary"
                      className="bg-cr-success/15 text-cr-success text-[10px]"
                    >
                      {t.activeBadge}
                    </Badge>
                  )}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">{stateText}</p>
              </div>
              <Button
                size="sm"
                variant={live ? 'default' : 'outline'}
                disabled={
                  !supported ||
                  detecting ||
                  !detected ||
                  appPending ||
                  pendingAll ||
                  (controller.busy !== null && !String(controller.busy).startsWith('apply:'))
                }
                title={
                  detecting
                    ? t.applyDetectingHint
                    : !supported
                      ? t.notSupported
                      : !detected
                        ? t.statusNotInstalled
                        : undefined
                }
                onClick={() => void run(appId)}
              >
                {appPending && <Spinner data-icon="inline-start" />}
                {detecting ? t.statusDetecting : live ? t.applyAction : t.applyAndLaunch}
              </Button>
            </div>
          );
        })}
        {!detecting && installedApps.length === 0 && (
          <p className="px-1 py-2 text-[11px] text-muted-foreground">{t.statusNotInstalled}</p>
        )}
      </div>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{label}</span>
      <span className="text-[12px] font-medium">{value}</span>
    </div>
  );
}

function ColorSchemePicker({
  schemes,
  activeSchemeId,
  onChange,
  t,
}: {
  schemes: NonNullable<import('@shared/types').ThemeCatalogItem['schemes']>;
  activeSchemeId?: string;
  onChange: (schemeId: string | undefined) => void;
  t: import('@shared/i18n').UiMessages;
}) {
  return (
    <div>
      <p className="mb-1.5 text-[10px] uppercase tracking-wide text-muted-foreground/70">
        {t.colorSchemesLabel}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {schemes.map((scheme) => {
          const selected = (activeSchemeId ?? 'default') === scheme.id;
          const bg = scheme.colors.background ?? scheme.colors.bg;
          const accent = scheme.colors.accent;
          const swatchStyle: React.CSSProperties = {};
          if (bg) swatchStyle.backgroundColor = bg;
          if (accent) swatchStyle.boxShadow = `inset 0 0 0 1px ${accent}`;
          return (
            <button
              key={scheme.id}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(scheme.id === 'default' ? undefined : scheme.id)}
              className={cn(
                'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] transition-colors',
                selected
                  ? 'border-primary bg-accent text-accent-foreground'
                  : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted/60',
              )}
            >
              <span className="size-3 shrink-0 rounded-sm" style={swatchStyle} aria-hidden="true" />
              {scheme.id === 'default' ? t.colorSchemeDefault : scheme.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DetailPanel({
  controller,
  selection: selectionOverride,
  onClose,
}: {
  controller: AppController;
  selection?: Selection;
  onClose?: () => void;
}) {
  const { t } = controller;
  const selection = selectionOverride !== undefined ? selectionOverride : controller.selection;
  const [schemeId, setSchemeId] = useState<string | undefined>(undefined);

  const dynamicWallpaperId =
    selection && (selection.theme.wallpaper?.video || selection.theme.wallpaper?.workshopId)
      ? `theme:${selection.theme.id}`
      : null;
  const { url: videoUrl, loading: videoLoading } = useWallpaperVideoUrl(dynamicWallpaperId);

  const lastSelectionIdRef = useRef<string | null>(null);
  useEffect(() => {
    const current = selection?.theme.id ?? null;
    if (lastSelectionIdRef.current !== current) {
      lastSelectionIdRef.current = current;
      setSchemeId(undefined);
    }
  }, [selection]);

  if (!selection) {
    return null;
  }

  const theme = selection.theme;
  const isDynamic = Boolean(theme.wallpaper?.video || theme.wallpaper?.workshopId);

  return (
    <aside className="flex h-full max-h-[90vh] w-[400px] shrink-0 flex-col border-l border-border bg-card">
      {/* Preview — large 16:9 at top */}
      <div className="relative aspect-video w-full shrink-0 overflow-hidden bg-muted">
        {isDynamic && videoUrl ? (
          <video
            key={theme.id}
            src={videoUrl}
            poster={theme.preview ?? undefined}
            autoPlay
            loop
            muted
            playsInline
            disablePictureInPicture
            className="size-full object-cover"
          />
        ) : isDynamic && videoLoading ? (
          <div className="flex size-full items-center justify-center">
            <Spinner className="size-6 text-muted-foreground/50" />
          </div>
        ) : theme.preview ? (
          <img src={theme.preview} alt={theme.name} className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center bg-muted text-muted-foreground">
            <PaintBucket className="size-10 opacity-30" />
          </div>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={t.close}
            className="absolute right-2 top-2 flex size-7 items-center justify-center rounded-md bg-background/60 text-foreground backdrop-blur-sm transition-colors hover:bg-background/80"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* Scrollable body */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {/* Title */}
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-[16px] font-semibold tracking-tight">{theme.name}</h2>
            {isDynamic && (
              <Badge className="bg-primary/15 text-primary text-[10px]">
                {t.themeDynamicBadge}
              </Badge>
            )}
            {theme.unofficial && (
              <Badge variant="outline" className="text-[10px]">
                {t.themeUnofficial}
              </Badge>
            )}
          </div>
          <p className="mt-0.5 font-mono text-[11px] tabular-nums text-muted-foreground">
            {t.versionLabel(theme.version)}
          </p>
        </div>

        {/* Metadata grid */}
        {(theme.author || theme.category || theme.license) && (
          <div className="grid grid-cols-3 gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2.5">
            {theme.author && <MetaRow label={t.themeAuthor} value={theme.author} />}
            {theme.category && (
              <MetaRow label={t.themeCategory} value={t.categoryLabel(theme.category)} />
            )}
            {theme.license && <MetaRow label={t.themeLicense} value={theme.license} />}
          </div>
        )}

        {/* Description */}
        {theme.description && (
          <p className="text-[12px] leading-relaxed text-muted-foreground">{theme.description}</p>
        )}

        {/* Tags */}
        {theme.tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {theme.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="rounded-md text-[10px] font-normal">
                {tag}
              </Badge>
            ))}
          </div>
        )}

        {/* Color-scheme picker */}
        {theme.schemes && theme.schemes.length > 1 && (
          <ColorSchemePicker
            schemes={theme.schemes}
            activeSchemeId={schemeId}
            onChange={setSchemeId}
            t={t}
          />
        )}

        {/* Apply section */}
        <div>
          <p className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground/70">
            {t.appPickerTitle}
          </p>
          <AppActionList
            controller={controller}
            supportedAgents={theme.supportedAgents}
            installedThemeId={theme.id}
            onApply={(appId) => controller.applyToApp(theme.id, theme.name, appId, { schemeId })}
          />
        </div>
      </div>

      {/* Footer actions */}
      <div className="flex gap-2 border-t border-border p-3">
        <Button
          variant="outline"
          size="sm"
          className="flex-1"
          onClick={() => void controller.exportTheme(theme.id)}
        >
          <Share2 size={14} className="text-muted-foreground/70" />
          {t.exportTheme}
        </Button>
        {theme.wallpaper && (
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            disabled={controller.busy !== null}
            onClick={() => void controller.createBundle(theme.id)}
          >
            <Package size={14} className="text-muted-foreground/70" />
            {t.bundleExport}
          </Button>
        )}
        <Button
          variant="destructive"
          size="sm"
          className="flex-1"
          disabled={controller.busy !== null}
          onClick={() => controller.setDeletePrompt(theme)}
        >
          <Trash2 size={14} className="text-muted-foreground/70" />
          {t.deleteTheme}
        </Button>
      </div>
    </aside>
  );
}
