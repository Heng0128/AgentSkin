// SPDX-License-Identifier: MPL-2.0

/**
 * # QuickActionsCard
 *
 * Quick-action entries displayed at the top of WorkspacePage. Enhanced layout
 * providing one-tap access to common tasks plus live theme status:
 *
 * ## Layout (sm+ breakpoint)
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ Status Bar: agent icon | theme name | injection dot     │
 *   ├───────────────────────┬──────────────────────────────────┤
 *   │ Quick Switch (dropdown) │ From Image (upload button)     │
 *   ├───────────────────────┴──────────────────────────────────┤
 *   │ Legacy row: Apply Theme | Set Wallpaper | Verify | Restore│
 *   └──────────────────────────────────────────────────────────┘
 *
 * Features:
 *   1. Theme status bar — shows active theme name + injection state
 *   2. Quick theme switch — dropdown of installed themes for one-tap apply
 *   3. From Image — upload image → extract palette → apply as theme
 *   4. Legacy actions — navigate to themes/wallpaper, verify, restore
 */

import { useCallback, useRef, useState } from 'react';
import { api } from '@/api/agentSkinClient';
import { cn } from '@/lib/utils';
import { useShellStore } from '@/stores/shellStore';
import { useStatusStore } from '@/stores/statusStore';
import { useThemeStore } from '@/stores/themeStore';
import type { Route } from '@/types/navigation';

import { uiMessages } from '@shared/i18n';
import type { AgentId, ThemeCatalogItem } from '@shared/types';
import { AGENT_META } from '@shared/types';
import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  ChevronDown,
  ImageIcon,
  Paintbrush,
  Palette,
  RotateCcw,
  Upload,
} from 'lucide-react';

/** Keys whose values are plain strings (excludes function-valued keys). */
type StringMessageKey = {
  [K in keyof typeof uiMessages.en]: (typeof uiMessages.en)[K] extends string ? K : never;
}[keyof typeof uiMessages.en];

interface QuickActionsCardProps {
  activeAgentId: string;
}

interface LegacyActionItem {
  id: string;
  icon: LucideIcon;
  labelKey: StringMessageKey;
  descriptionKey: StringMessageKey;
  route?: Route;
  action?: 'verify' | 'restore';
}

const LEGACY_ACTIONS: LegacyActionItem[] = [
  {
    id: 'apply-theme',
    icon: Paintbrush,
    labelKey: 'quickActionApplyTheme',
    descriptionKey: 'quickActionApplyThemeDesc',
    route: 'themes',
  },
  {
    id: 'set-wallpaper',
    icon: ImageIcon,
    labelKey: 'quickActionSetWallpaper',
    descriptionKey: 'quickActionSetWallpaperDesc',
    route: 'wallpaper',
  },
  {
    id: 'verify-injection',
    icon: Activity,
    labelKey: 'quickActionVerifyInjection',
    descriptionKey: 'quickActionVerifyInjectionDesc',
    action: 'verify',
  },
  {
    id: 'restore-native',
    icon: RotateCcw,
    labelKey: 'quickActionRestoreNative',
    descriptionKey: 'quickActionRestoreNativeDesc',
    action: 'restore',
  },
];

/**
 * Resolve the display name of the active theme for a given agent.
 * Reads from statusStore (activeThemeId) → themeStore (installed catalog).
 */
function useActiveThemeName(activeAgentId: string): string | null {
  const status = useStatusStore((s) => s.status);
  const installed = useThemeStore((s) => s.installed);
  const activeThemeId = status?.apps.find((a) => a.appId === activeAgentId)?.activeThemeId;
  if (!activeThemeId) return null;
  const theme = installed.find((t) => t.id === activeThemeId);
  return theme?.name ?? activeThemeId;
}

/**
 * Theme status bar — compact row showing agent icon, active theme name,
 * and injection state dot.
 */
function ThemeStatusBar({
  activeAgentId,
  t,
}: {
  activeAgentId: string;
  t: (typeof uiMessages)['en'];
}) {
  const status = useStatusStore((s) => s.status);
  const activeThemeName = useActiveThemeName(activeAgentId);
  const appStatus = status?.apps.find((a) => a.appId === activeAgentId);
  const isInjected = !!appStatus?.activeThemeId;
  const agentMeta = AGENT_META[activeAgentId as AgentId];

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
      {/* Injection state dot */}
      <span
        className={cn(
          'size-2 shrink-0 rounded-full',
          isInjected ? 'bg-cr-success' : 'bg-muted-foreground/30',
        )}
        role="img"
        aria-label={isInjected ? t.quickActionActive : t.quickActionInactive}
      />
      {/* Agent display name */}
      <span className="text-sm font-medium text-foreground">
        {agentMeta?.displayName ?? activeAgentId}
      </span>
      {/* Divider */}
      <span className="size-3 shrink-0 rounded-full bg-border" />
      {/* Active theme name */}
      <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
        {activeThemeName ?? t.quickActionNoTheme}
      </span>
      {/* Status label */}
      <span
        className={cn(
          'shrink-0 text-[11px] font-medium',
          isInjected ? 'text-cr-success' : 'text-muted-foreground/60',
        )}
      >
        {isInjected ? t.quickActionActive : t.quickActionInactive}
      </span>
    </div>
  );
}

/**
 * Quick theme switch dropdown — lists installed themes for one-tap apply.
 */
function QuickThemeSwitch({
  activeAgentId,
  t,
}: {
  activeAgentId: string;
  t: (typeof uiMessages)['en'];
}) {
  const [open, setOpen] = useState(false);
  const installed = useThemeStore((s) => s.installed);
  const applyToApp = useThemeStore((s) => s.applyToApp);
  const busy = useThemeStore((s) => s.busy);
  const currentBusy = busy[activeAgentId as AgentId];
  const isApplying = currentBusy?.startsWith('apply:') ?? false;

  // Filter themes that support this agent
  const compatibleThemes = installed.filter((theme) =>
    theme.supportedAgents.includes(activeAgentId as AgentId),
  );

  const handleSelectTheme = useCallback(
    (theme: ThemeCatalogItem) => {
      setOpen(false);
      void applyToApp(theme.id, theme.name, activeAgentId as AgentId);
    },
    [applyToApp, activeAgentId],
  );

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={isApplying}
        className={cn(
          'flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-left',
          'transition-colors duration-base hover:border-border-strong hover:bg-muted',
          isApplying && 'cursor-wait opacity-70',
        )}
      >
        <div
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-md',
            'bg-accent text-muted-foreground',
          )}
        >
          {isApplying ? (
            <span className="size-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
          ) : (
            <Palette size={16} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{t.quickActionQuickSwitch}</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {t.quickActionQuickSwitchDesc}
          </p>
        </div>
        <ChevronDown
          size={14}
          className={cn(
            'shrink-0 text-muted-foreground/60 transition-transform duration-base',
            open && 'rotate-180',
          )}
        />
      </button>

      {/* Dropdown menu */}
      {open && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
          {compatibleThemes.length === 0 ? (
            <div className="px-3 py-4 text-center text-[11px] text-muted-foreground">
              {t.quickActionNoTheme}
            </div>
          ) : (
            compatibleThemes.map((theme) => (
              <button
                key={theme.id}
                type="button"
                onClick={() => handleSelectTheme(theme)}
                className={cn(
                  'flex w-full items-center gap-2.5 px-3 py-2 text-left',
                  'transition-colors duration-base hover:bg-muted',
                )}
              >
                {/* Color swatch */}
                {theme.colors?.accent && (
                  <span
                    className="size-3 shrink-0 rounded-full ring-1 ring-border"
                    style={{ backgroundColor: theme.colors.accent }}
                  />
                )}
                <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">
                  {theme.name}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/**
 * From Image entry — triggers file upload → palette extraction → apply.
 */
function FromImageEntry({ t }: { activeAgentId: string; t: (typeof uiMessages)['en'] }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [extracting, setExtracting] = useState(false);
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setExtracting(true);
    try {
      // Read file as base64 data URL
      const reader = new FileReader();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsDataURL(file);
      });

      // Extract palette from image
      const result = await api.extractThemeFromImage(dataUrl);

      console.info(
        `[QuickActionsCard] Extracted palette from ${file.name}:`,
        result.palette.accent,
        result.mode,
      );

      // Navigate to themes page where user can create from palette
      useShellStore.getState().setRoute('themes');
    } catch (error) {
      console.error('[QuickActionsCard] Failed to extract theme from image:', error);
    } finally {
      setExtracting(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }, []);

  const handleClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  return (
    <div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileSelect}
      />
      <button
        type="button"
        onClick={handleClick}
        disabled={extracting}
        className={cn(
          'flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-left',
          'transition-colors duration-base hover:border-border-strong hover:bg-muted',
          extracting && 'cursor-wait opacity-70',
        )}
      >
        <div
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-md',
            'bg-accent text-muted-foreground',
          )}
        >
          {extracting ? (
            <span className="size-3 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground" />
          ) : (
            <Upload size={16} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">{t.quickActionFromImage}</p>
          <p className="truncate text-[11px] text-muted-foreground">{t.quickActionFromImageDesc}</p>
        </div>
      </button>
    </div>
  );
}

export function QuickActionsCard({ activeAgentId }: QuickActionsCardProps) {
  const locale = useShellStore((s) => s.locale);
  const setRoute = useShellStore((s) => s.setRoute);
  const restoreApp = useThemeStore((s) => s.restoreApp);
  const t = uiMessages[locale];

  const handleLegacyClick = useCallback(
    (item: LegacyActionItem) => {
      if (item.route) {
        setRoute(item.route);
        return;
      }
      if (item.action === 'verify') {
        void api.refreshStatus();
        return;
      }
      if (item.action === 'restore') {
        void restoreApp(activeAgentId as AgentId);
      }
    },
    [setRoute, restoreApp, activeAgentId],
  );

  return (
    <div className="flex flex-col gap-3">
      {/* Row 1: Status bar */}
      <ThemeStatusBar activeAgentId={activeAgentId} t={t} />

      {/* Row 2: Quick Switch + From Image */}
      <div className="grid gap-3 sm:grid-cols-2">
        <QuickThemeSwitch activeAgentId={activeAgentId} t={t} />
        <FromImageEntry activeAgentId={activeAgentId} t={t} />
      </div>

      {/* Row 3: Legacy actions */}
      <div className="grid gap-2 sm:grid-cols-4">
        {LEGACY_ACTIONS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => handleLegacyClick(item)}
            className={cn(
              'group flex items-center gap-2.5 rounded-lg border border-border bg-card p-2.5 text-left',
              'transition-colors duration-base hover:border-border-strong hover:bg-muted',
            )}
          >
            <div
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-md',
                'bg-accent text-muted-foreground transition-colors duration-base',
                'group-hover:text-foreground',
              )}
            >
              <item.icon size={14} />
            </div>
            <div className="min-w-0">
              <p className="truncate text-[12px] font-medium text-foreground">{t[item.labelKey]}</p>
              <p className="truncate text-[11px] text-muted-foreground">{t[item.descriptionKey]}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
