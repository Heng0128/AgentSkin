// SPDX-License-Identifier: MPL-2.0

/**
 * # SidebarMenuSub
 *
 * Community source sub-menu (DreamSkin / CodeDrobe). Rendered as an
 * indented list under the parent "Community" item, visible only when:
 *   1. The sidebar is expanded (not collapsed)
 *   2. The current route starts with `community.`
 *
 * Visual: a vertical guide rail hangs off the parent icon so the two sources
 * read as children rather than as two more top-level rows; 13px labels, 6px
 * radius, `text-primary` for the active source. No icon transform.
 *
 * Rows carry `data-nav-item` / `data-nav-route` so `SidebarMenu`'s arrow-key
 * walk reaches them — the index-based version it replaced could only cycle the
 * six top-level entries, stranding these rows as tab stops with no arrow
 * coverage.
 */

import { useCallback } from 'react';
import { cn } from '@/lib/utils';
import { useCommunityStore } from '@/stores/communityStore';
import { useShellStore } from '@/stores/shellStore';
import type { CommunitySubRoute, Route } from '@/types/navigation';

import { commonMessages } from '@shared/i18n';
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
    <div
      id="community-subnav"
      role="group"
      aria-label={locale === 'zh-CN' ? '社区来源' : 'Community sources'}
      className="as-fade-in ml-5 flex flex-col gap-0.5 border-l border-sidebar-border pb-0.5 pl-2.5"
    >
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
            data-nav-item=""
            data-nav-route={subRoute}
            className={cn(
              'group relative flex h-8 w-full items-center gap-2 rounded-md px-2',
              'text-muted-foreground transition-[background-color,color] duration-fast ease-out',
              // Same motion-safe padding shift as the top-level rows — the
              // hierarchy slides as one system, not two different widgets.
              'motion-safe:transition-[background-color,color,padding] motion-safe:duration-base motion-safe:ease-out',
              'motion-safe:hover:pl-[calc(8px+var(--ag-sidebar-hover-shift,3px))]',
              'hover:bg-[var(--ag-sidebar-item-hover,var(--card2))] hover:text-sidebar-foreground',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
              isActive &&
                'bg-[var(--ag-sidebar-item-active,var(--sidebar-accent))] text-sidebar-accent-foreground',
            )}
          >
            {/* Active marker — a short brand line ON the guide rail, hanging
                off the parent item's own indicator. -left-3 (12px) centres the
                3px bar over the 1px guide: container border sits 11px left of
                the row (pl-2.5 + 1px border), bar spans -12..-9 relative to the
                row → centre -10.5 = the border's centre. Same entrance
                animation as the top-level indicator so route switches animate
                the whole tree, not just the primary tier. */}
            {isActive && (
              <span
                className={cn(
                  'as-brand-line as-brand-line-in absolute top-1/2 h-3.5 w-[3px] -translate-y-1/2 rounded-full -left-3',
                )}
                aria-hidden="true"
              />
            )}
            <Globe
              className={cn('size-[15px] shrink-0', src.accentClass)}
              strokeWidth={isActive ? 2.2 : 1.8}
              aria-hidden="true"
            />
            <span className={cn('truncate text-ui font-medium', isActive && 'font-semibold')}>
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
