// SPDX-License-Identifier: MPL-2.0

import { Logo } from '@/components/Logo';
import { cn } from '@/lib/utils';
import { useShellStore } from '@/stores/shellStore';
import type { Route } from '@/types/navigation';

import { Home, Image, LayoutGrid, PaintBucket, Settings } from 'lucide-react';

interface NavIcon {
  route: Route;
  icon: typeof Home;
}

const NAV_ICONS: NavIcon[] = [
  { route: 'themes', icon: PaintBucket },
  { route: 'wallpaper', icon: Image },
  { route: 'workspace', icon: Home },
  { route: 'apps', icon: LayoutGrid },
  { route: 'settings', icon: Settings },
];

/**
 * Sidebar — fixed 52px icon-only navigation for Refined Workbench.
 *
 * Structure:
 *   Logo (top, 32px strip)
 *   Navigation — 28x28px icon buttons, active item gets accent bg + left indicator
 *
 * Global status (LED + version + clock) lives in the full-width StatusBar,
 * which spans below this rail — keeping the narrow column clean.
 */
export function Sidebar() {
  const route = useShellStore((s) => s.route);
  const setRoute = useShellStore((s) => s.setRoute);

  return (
    <aside className="flex h-full w-[52px] flex-col border-r border-border bg-surface">
      {/* Top — small logo */}
      <div className="flex h-8 shrink-0 items-center justify-center border-b border-border">
        <Logo variant="mono" className="size-4" />
      </div>

      {/* Navigation — pure icon buttons */}
      <nav className="flex flex-1 flex-col items-center gap-1 overflow-y-auto py-2">
        {NAV_ICONS.map((item) => {
          const Icon = item.icon;
          const active = route === item.route;
          return (
            <button
              key={item.route}
              type="button"
              onClick={() => setRoute(item.route)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'relative flex size-7 items-center justify-center rounded-md text-muted-foreground transition-all duration-fast ease-out hover:bg-card2 hover:text-foreground active:scale-90',
                active && 'bg-accent text-accent-foreground',
              )}
            >
              {active && (
                <span className="absolute -left-[9px] top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-primary" />
              )}
              <Icon className="size-[15px]" />
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
