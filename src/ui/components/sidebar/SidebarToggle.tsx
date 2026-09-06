// SPDX-License-Identifier: MPL-2.0

/**
 * # SidebarToggle
 *
 * Expand / collapse button placed at the bottom of the sidebar.
 *
 * Shows:
 *   - Collapsed → chevron-right (click to expand)
 *   - Expanded  → chevron-left  + localized "收起侧边栏" label
 *
 * High-contrast colors ensure visibility against glass/dark backgrounds.
 */

import { cn } from '@/lib/utils';
import { useShellStore } from '@/stores/shellStore';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useSidebar } from './SidebarProvider';

export function SidebarToggle() {
  const locale = useShellStore((s) => s.locale);
  const { collapsed, toggle } = useSidebar();

  const label = collapsed
    ? locale === 'zh-CN'
      ? '展开侧边栏'
      : 'Expand sidebar'
    : locale === 'zh-CN'
      ? '收起侧边栏'
      : 'Collapse sidebar';

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={cn(
        'flex w-full items-center rounded-[6px] text-foreground transition-colors duration-fast',
        'hover:text-primary hover:bg-card2',
        collapsed ? 'size-8 justify-center' : 'h-8 justify-end px-3',
      )}
    >
      {collapsed ? (
        <ChevronRight className="size-4" aria-hidden="true" />
      ) : (
        <>
          <ChevronLeft className="size-4" aria-hidden="true" />
          <span className="ml-2 text-[13px] font-medium">{label}</span>
        </>
      )}
    </button>
  );
}
