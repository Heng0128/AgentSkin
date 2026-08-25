// SPDX-License-Identifier: MPL-2.0

import { Logo } from '@/components/Logo';
import { cn } from '@/lib/utils';
import { useShellStore } from '@/stores/shellStore';
import type { Route } from '@/types/navigation';

import { uiMessages } from '@shared/i18n';
import { Home, Image, LayoutGrid, PaintBucket, Settings } from 'lucide-react';

interface NavIcon {
  route: Route;
  icon: typeof Home;
  labelKey: 'navThemes' | 'navWallpaperEngine' | 'navWorkspace' | 'navApps' | 'navSettings';
}

const NAV_ICONS: NavIcon[] = [
  { route: 'themes', icon: PaintBucket, labelKey: 'navThemes' },
  { route: 'wallpaper', icon: Image, labelKey: 'navWallpaperEngine' },
  { route: 'workspace', icon: Home, labelKey: 'navWorkspace' },
  { route: 'apps', icon: LayoutGrid, labelKey: 'navApps' },
  { route: 'settings', icon: Settings, labelKey: 'navSettings' },
];

/**
 * Sidebar — fixed 56px icon-only navigation for Refined Workbench.
 *
 * Structure:
 *   Logo (top, 40px strip)
 *   Navigation — 32x32px icon buttons, active item gets accent bg + left indicator bar
 *
 * Global status (LED + version + clock) lives in the full-width StatusBar,
 * which spans below this rail — keeping the narrow column clean.
 */
export function Sidebar() {
  const route = useShellStore((s) => s.route);
  const setRoute = useShellStore((s) => s.setRoute);
  const locale = useShellStore((s) => s.locale);
  const t = uiMessages[locale];

  return (
    <aside className="flex h-full w-14 flex-col border-r border-border bg-surface">
      {/* Top — logo mark */}
      <div className="flex h-10 shrink-0 items-center justify-center border-b border-border">
        <Logo variant="mono" className="size-5" />
      </div>

      {/* Navigation — pure icon buttons */}
      <nav className="flex flex-1 flex-col items-center gap-1 overflow-y-auto py-3">
        {NAV_ICONS.map((item) => {
          const Icon = item.icon;
          const active = route === item.route;
          return (
            <button
              key={item.route}
              type="button"
              onClick={() => setRoute(item.route)}
              title={t[item.labelKey]}
              aria-current={active ? 'page' : undefined}
              aria-label={t[item.labelKey]}
              className={cn(
                'relative flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-all duration-fast ease-out',
                'hover:bg-card2 hover:text-foreground active:scale-90',
                active &&
                  'bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              {active && (
                <span className="absolute -left-3 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-primary shadow-[0_0_8px_rgba(var(--brand-rgb),0.5)]" />
              )}
              <Icon className="size-[15px]" strokeWidth={active ? 2.2 : 1.8} />
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
