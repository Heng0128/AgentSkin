// SPDX-License-Identifier: MPL-2.0

/**
 * # RunningAgentList
 *
 * Compact status strip at the bottom of the expanded sidebar showing
 * running agents as a list of name + status dot. Replaces the single
 * number badge in the original implementation.
 *
 * In collapsed mode, renders a single DOT + count badge instead of the
 * full list (space constraint).
 *
 * Swiss/International: 11px labels, tabular-nums for count, primary/dot
 * accent for running state.
 */

import { cn } from '@/lib/utils';
import { useShellStore } from '@/stores/shellStore';
import { useStatusStore } from '@/stores/statusStore';

import { useSidebar } from './SidebarProvider';

export function RunningAgentList() {
  const locale = useShellStore((s) => s.locale);
  const status = useStatusStore((s) => s.status);
  const { collapsed } = useSidebar();

  const apps = status?.apps ?? [];
  const runningApps = apps.filter((a) => a.running);
  const runningCount = runningApps.length;
  const collapsedLabel =
    locale === 'zh-CN' ? `${runningCount} 个运行中` : `${runningCount} running`;

  // No agents running — render empty state (preserves DOM for layout)
  if (runningCount === 0) {
    return (
      <div
        className={cn(
          'flex shrink-0 items-center justify-center border-t border-border/60 py-2',
          collapsed ? 'px-1' : 'px-2',
        )}
        role="status"
        aria-label={locale === 'zh-CN' ? '没有运行中的 agent' : 'No running agents'}
      >
        {/* Empty state preserves layout height */}
      </div>
    );
  }

  return (
    <div
      className={cn('shrink-0 border-t border-border/60', collapsed ? 'px-1 py-2' : 'px-2 py-2')}
      role="status"
      aria-label={
        collapsed
          ? collapsedLabel
          : locale === 'zh-CN'
            ? `${runningCount} 个 agent 正在运行`
            : `${runningCount} agents running`
      }
    >
      {collapsed ? (
        // Collapsed: single dot + count badge (compact)
        <div className="flex items-center justify-center">
          <div
            className="flex size-5 items-center justify-center rounded-md bg-accent/80"
            title={collapsedLabel}
          >
            <span className="text-[10px] font-semibold tabular-nums text-accent-foreground">
              {runningCount}
            </span>
          </div>
        </div>
      ) : (
        // Expanded: compact list with status dots
        <div className="flex flex-col gap-1">
          {runningApps.map((app) => (
            <div
              key={app.appId}
              className="flex items-center gap-2 px-1 py-0.5 text-[11px] text-muted-foreground"
            >
              <span
                className="size-1.5 shrink-0 animate-status-pulse rounded-full bg-primary"
                aria-hidden="true"
              />
              <span className="truncate font-medium">{app.appId}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
