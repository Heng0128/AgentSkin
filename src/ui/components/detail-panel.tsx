// SPDX-License-Identifier: MPL-2.0

import { useEffect, useRef, useState } from 'react';
import { APP_META, AppMark } from '@/components/app-mark';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { HugeIcon } from '@/components/ui/huge-icon';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import type { AppController, Selection } from '@/hooks/useAppController';
import { cn } from '@/lib/utils';
import { useWallpaperVideoUrl } from '@/lib/wallpaperVideo';

import { Delete02Icon, PaintBoardIcon, Share05Icon } from '@hugeicons/core-free-icons';
import { AGENT_IDS, type AgentId } from '@shared/types';

/** Per-app apply rows: the drawer chooses the target app, not a global picker. */
function AppActionList({
  controller,
  supportedAgents,
  installedThemeId,
  schemeId,
  onApply,
}: {
  controller: AppController;
  supportedAgents: AgentId[];
  installedThemeId: string | null;
  /** Currently selected color-scheme id (undefined = default). */
  schemeId?: string;
  onApply: (appId: AgentId) => Promise<unknown>;
}) {
  const { t } = controller;
  const [pendingApps, setPendingApps] = useState<Set<AgentId>>(new Set());
  const [pendingAll, setPendingAll] = useState(false);

  const run = async (appId: AgentId) => {
    setPendingApps((prev) => new Set(prev).add(appId));
    try {
      await onApply(appId).catch(() => undefined);
    } finally {
      setPendingApps((prev) => {
        const next = new Set(prev);
        next.delete(appId);
        return next;
      });
    }
  };

  /** Agents this theme supports that are actually installed on this machine. */
  const eligibleApps = AGENT_IDS.filter(
    (appId) =>
      supportedAgents.includes(appId) && Boolean(controller.appStatusFor(appId)?.installed),
  );

  /** When the first detection round has not returned yet, every apply button
   *  is replaced by a single "detecting" state instead of greyed-out rows. */
  const detecting = controller.statusStale;

  /** Run applies across all eligible apps with a bounded worker pool so the
   *  operations run concurrently (useThemes allows up to 4 in flight) instead
   *  of blocking one after another. */
  const runAll = async () => {
    setPendingAll(true);
    try {
      const queue = [...eligibleApps];
      const CONCURRENCY = 4;
      const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        for (;;) {
          const appId = queue.shift();
          if (!appId) break;
          await run(appId).catch(() => undefined);
        }
      });
      await Promise.all(workers);
    } finally {
      setPendingAll(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium">{t.appPickerTitle}</p>
          <p className="text-[11px] text-muted-foreground">{t.appPickerHint}</p>
        </div>
      </div>

      {/* One-click: apply to every detected agent on this computer */}
      <Button
        size="sm"
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
          <span className="ml-1 text-xs opacity-70">
            {pendingAll ? `${pendingApps.size}/${eligibleApps.length}` : `(${eligibleApps.length})`}
          </span>
        )}
      </Button>

      <div className="flex flex-col gap-1">
        {AGENT_IDS.map((appId) => {
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
                'flex items-center gap-2.5 rounded-xl border bg-background/50 px-3 py-2 transition-colors',
                !supported && 'opacity-50',
                supported && detected && 'hover:bg-background/80',
              )}
            >
              <AppMark appId={appId} size={22} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-xs font-medium">
                  {displayName}
                  {isActive && <Badge className="px-1.5 py-0 text-[10px]">{t.activeBadge}</Badge>}
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
      </div>
    </div>
  );
}

/** Metadata row: label + value pair for theme info. */
function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">{label}</span>
      <span className="text-xs font-medium">{value}</span>
    </div>
  );
}

/** Color-scheme picker: one swatch card per scheme, using each scheme's
 *  actual colors so the difference is visible at a glance. */
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
    <div className="mb-3">
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
                'flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] transition-colors',
                selected
                  ? 'border-primary bg-card text-foreground shadow-sm'
                  : 'border-border bg-background/50 text-muted-foreground hover:bg-background/80',
              )}
            >
              <span
                className="size-3 shrink-0 rounded-[2px]"
                style={swatchStyle}
                aria-hidden="true"
              />
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
}: {
  controller: AppController;
  selection?: Selection;
}) {
  const { t } = controller;
  const selection = selectionOverride !== undefined ? selectionOverride : controller.selection;
  const [schemeId, setSchemeId] = useState<string | undefined>(undefined);

  // Theme-bundled wallpaper videos can't be a static preview; fetch the
  // media as an inline base64 data URL (no custom scheme) so it plays
  // reliably in the sandboxed renderer. Must be called before any early
  // return to satisfy the Rules of Hooks.
  const dynamicWallpaperId =
    selection && (selection.theme.wallpaper?.video || selection.theme.wallpaper?.workshopId)
      ? `theme:${selection.theme.id}`
      : null;
  const { url: videoUrl, loading: videoLoading } = useWallpaperVideoUrl(dynamicWallpaperId);

  // When the selection changes, reset the scheme back to default. Track the
  // selection id in a ref so the effect only fires on theme switch, not on
  // every schemeId update (biome's exhaustive-deps rule can't see the ref).
  const lastSelectionIdRef = useRef<string | null>(null);
  useEffect(() => {
    const current = selection?.theme.id ?? null;
    if (lastSelectionIdRef.current !== current) {
      lastSelectionIdRef.current = current;
      setSchemeId(undefined);
    }
  });

  if (!selection) {
    return (
      <div className="flex min-h-48 items-center justify-center p-6 text-center">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <HugeIcon icon={PaintBoardIcon} className="size-8 opacity-40" />
          <p className="text-sm">{t.selectThemeHint}</p>
        </div>
      </div>
    );
  }

  const theme = selection.theme;
  const isDynamic = Boolean(theme.wallpaper?.video || theme.wallpaper?.workshopId);

  return (
    <div className="flex h-[min(80svh,38rem)] overflow-hidden">
      {/* Left: preview image / video */}
      <div className="relative flex w-[58%] shrink-0 items-center justify-center overflow-hidden bg-muted/60">
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
          <img src={theme.preview} alt={theme.name} className="size-full object-contain" />
        ) : (
          <div className="flex size-full items-center justify-center bg-gradient-to-br from-primary/10 via-muted to-accent text-muted-foreground">
            <HugeIcon icon={PaintBoardIcon} className="size-8 opacity-50" />
          </div>
        )}
        {/* Subtle inner shadow for depth */}
        <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_24px_var(--border)]" />
      </div>

      {/* Right: info + actions */}
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto p-4">
        {/* Title block */}
        <div className="mb-3">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold tracking-[-0.015em]">{theme.name}</h2>
            {isDynamic && (
              <Badge className="bg-violet-500/15 text-violet-600 dark:text-violet-400 px-1.5 py-0 text-[10px]">
                {t.themeDynamicBadge}
              </Badge>
            )}
            {theme.unofficial && (
              <Badge variant="outline" className="text-[10px]">
                {t.themeUnofficial}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-[11px] tabular-nums text-muted-foreground">
            {t.versionLabel(theme.version)}
          </p>
        </div>

        {/* Metadata grid */}
        {(theme.author || theme.category || theme.license) && (
          <div className="mb-3 grid grid-cols-2 gap-x-4 gap-y-2 rounded-xl bg-muted/40 px-3 py-2.5">
            {theme.author && <MetaRow label={t.themeAuthor} value={theme.author} />}
            {theme.category && (
              <MetaRow label={t.themeCategory} value={t.categoryLabel(theme.category)} />
            )}
            {theme.license && <MetaRow label={t.themeLicense} value={theme.license} />}
          </div>
        )}

        {/* Description */}
        {theme.description && (
          <p className="mb-3 text-xs leading-relaxed text-muted-foreground">{theme.description}</p>
        )}

        {/* Tags */}
        {theme.tags.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1">
            {theme.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="rounded-md text-[10px] font-normal">
                {tag}
              </Badge>
            ))}
          </div>
        )}

        <Separator className="mb-3" />

        {/* Color-scheme picker (v2.2+): only when the theme ships alternatives */}
        {theme.schemes && theme.schemes.length > 1 && (
          <ColorSchemePicker
            schemes={theme.schemes}
            activeSchemeId={schemeId}
            onChange={setSchemeId}
            t={t}
          />
        )}

        {/* Apply section */}
        <AppActionList
          controller={controller}
          supportedAgents={theme.supportedAgents}
          installedThemeId={theme.id}
          schemeId={schemeId}
          onApply={(appId) => controller.applyToApp(theme.id, theme.name, appId, { schemeId })}
        />

        {/* Bottom actions — pinned to bottom */}
        <div className="mt-auto flex gap-2 border-t pt-3">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={() => void controller.exportTheme(theme.id)}
          >
            <HugeIcon icon={Share05Icon} data-icon="inline-start" />
            {t.exportTheme}
          </Button>
          <Button
            variant="destructive"
            size="sm"
            className="flex-1"
            disabled={controller.busy !== null}
            onClick={() => controller.setDeletePrompt(theme)}
          >
            <HugeIcon icon={Delete02Icon} data-icon="inline-start" />
            {t.deleteTheme}
          </Button>
        </div>
      </div>
    </div>
  );
}
