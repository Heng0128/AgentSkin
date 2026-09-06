// SPDX-License-Identifier: MPL-2.0

/**
 * # SidebarMenuSub
 *
 * Community source sub-menu (DreamSkin / CodeDrobe). Rendered as an
 * indented list under the parent "Community" item, visible only when:
 *   1. The sidebar is expanded (not collapsed)
 *   2. The current route starts with `community.`
 *
 * Swiss/International: 13px labels, 6px radius, accent text-primary
 * for the active source. No icon transform. No spring ease.
 */

import { useCallback } from 'react';
import { cn } from '@/lib/utils';
import { useCommunityStore } from '@/stores/communityStore';
import { useShellStore } from '@/stores/shellStore';
import type { CommunitySubRoute, Route } from '@/types/navigation';

import { commonMessages, communityMessages } from '@shared/i18n';
import { Globe } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

interface SubDef {
  subRoute: CommunitySubRoute;
  labelKey: 'navDreamskin' | 'navCodedrobe';
  accentClass: string;
}

const SUB_SOURCES: SubDef[] = [
  { subRoute: 'dreamskin', labelKey: 'navDreamskin', accentClass: 'text-primary' },
  { subRoute: 'codedrobe', labelKey: 'navCodedrobe', accentClass: 'text-muted-foreground' },
];

export function SidebarMenuSub() {
  const locale = useShellStore((s) => s.locale);
  const route = useShellStore((s) => s.route);
  const setRoute = useShellStore((s) => s.setRoute);
  // RC-fix: useShallow ensures referential stability for the multi-field
  // selector. Without it, React 19's useSyncExternalStore detects a "new"
  // snapshot on every render ("getSnapshot should be cached") → infinite loop.
  const { sources, setActiveSource } = useCommunityStore(
    useShallow((s) => ({
      sources: s.sources,
      setActiveSource: s.setActiveSource,
    })),
  );

  const handleClick = useCallback(
    async (src: SubDef) => {
      const subRoute: Route = `community.${src.subRoute}`;
      await setActiveSource(src.subRoute);
      setRoute(subRoute);
    },
    [setActiveSource, setRoute],
  );

  return (
    <div id="community-subnav" className="flex flex-col gap-0.5 pb-0.5 pl-3" role="group">
      {SUB_SOURCES.filter((src) => {
        // Hide offline sources completely instead of dimming them
        const srcState = sources[src.subRoute];
        return srcState?.status !== 'offline';
      }).map((src) => {
        const subRoute: Route = `community.${src.subRoute}`;
        const isActive = route === subRoute;
        const label = commonMessages[locale as 'zh-CN' | 'en'][src.labelKey];

        return (
          <button
            key={src.subRoute}
            type="button"
            onClick={() => void handleClick(src)}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'group relative flex h-7 w-full items-center gap-2 rounded-[6px] px-2',
              'text-muted-foreground transition-colors duration-fast',
              'hover:bg-card2 hover:text-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isActive && 'bg-accent text-accent-foreground',
            )}
          >
            <Globe
              className={cn('size-[15px] shrink-0', src.accentClass)}
              strokeWidth={isActive ? 2.2 : 1.8}
              aria-hidden="true"
            />
            <span className={cn('text-[13px] font-medium truncate', isActive && 'font-semibold')}>
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
