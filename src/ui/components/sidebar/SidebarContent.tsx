// SPDX-License-Identifier: MPL-2.0

/**
 * # SidebarContent
 *
 * The expanded sidebar body — rendered only when the sidebar is NOT
 * collapsed. Owns the brand chip, navigation menu, and the agent status
 * strip.
 */

import { Logo } from '@/components/Logo';
import { cn } from '@/lib/utils';
import { useShellStore } from '@/stores/shellStore';

import { RunningAgentList } from './RunningAgentList';
import { SidebarMenu } from './SidebarMenu';
import { useSidebar } from './SidebarProvider';
import { SidebarToggle } from './SidebarToggle';

export function SidebarContent() {
  const _locale = useShellStore((s) => s.locale);
  const { safeAreaInset } = useSidebar();

  return (
    <aside
      className={cn(
        'flex h-full flex-col border-r border-border bg-surface transition-[width] duration-base ease-out',
        'w-[192px]',
      )}
      style={{ paddingTop: `${safeAreaInset}px` }}
    >
      {/* Top — brand mark */}
      <div
        className="flex h-10 shrink-0 items-center justify-center border-b border-border"
        role="banner"
      >
        <Logo variant="mono" className="size-6 rounded-[6px]" />
      </div>

      {/* Middle — navigation menu */}
      <SidebarMenu />

      {/* Bottom — toggle + running agent status */}
      <div className="shrink-0 border-t border-border py-2">
        <SidebarToggle />
      </div>
      <RunningAgentList />
    </aside>
  );
}
