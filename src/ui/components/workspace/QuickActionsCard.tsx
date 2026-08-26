// SPDX-License-Identifier: MPL-2.0

/**
 * # QuickActionsCard
 *
 * Quick-action entries displayed at the top of WorkspacePage. A 2x2 grid
 * providing one-tap access to the four most common tasks:
 *   1. Apply Theme  → navigate to Themes page
 *   2. Set Wallpaper → navigate to Wallpaper page
 *   3. Verify Injection → trigger a status refresh (health report updates push from main process)
 *   4. Restore Native → restore the active agent's official appearance
 *
 * Layout: 1 column on mobile, 2 columns at sm breakpoint and above.
 */

import { api } from '@/api/agentSkinClient';
import { cn } from '@/lib/utils';
import { useShellStore } from '@/stores/shellStore';
import { useThemeStore } from '@/stores/themeStore';
import type { Route } from '@/types/navigation';

import { uiMessages } from '@shared/i18n';
import type { AgentId } from '@shared/types';
import type { LucideIcon } from 'lucide-react';
import { Activity, ImageIcon, Paintbrush, RotateCcw } from 'lucide-react';

/** Keys whose values are plain strings (excludes function-valued keys like `nativeRestored`). */
type StringMessageKey = {
  [K in keyof typeof uiMessages.en]: (typeof uiMessages.en)[K] extends string ? K : never;
}[keyof typeof uiMessages.en];

interface QuickActionsCardProps {
  activeAgentId: string;
}

interface ActionItem {
  id: string;
  icon: LucideIcon;
  labelKey: StringMessageKey;
  descriptionKey: StringMessageKey;
  route?: Route;
  action?: 'verify' | 'restore';
}

const ACTIONS: ActionItem[] = [
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

export function QuickActionsCard({ activeAgentId }: QuickActionsCardProps) {
  const locale = useShellStore((s) => s.locale);
  const setRoute = useShellStore((s) => s.setRoute);
  const restoreApp = useThemeStore((s) => s.restoreApp);
  const t = uiMessages[locale];

  const handleClick = (item: ActionItem) => {
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
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {ACTIONS.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => handleClick(item)}
          className={cn(
            'group flex items-center gap-3 rounded-lg border border-border bg-card p-3 text-left',
            'transition-colors duration-base hover:border-border-strong hover:bg-muted',
          )}
        >
          <div
            className={cn(
              'flex size-9 shrink-0 items-center justify-center rounded-md',
              'bg-accent text-muted-foreground transition-colors duration-base',
              'group-hover:text-foreground',
            )}
          >
            <item.icon size={16} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">{t[item.labelKey]}</p>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {t[item.descriptionKey]}
            </p>
          </div>
        </button>
      ))}
    </div>
  );
}
