// SPDX-License-Identifier: MPL-2.0

import { useEffect, useRef, useState } from 'react';
import { HugeIcon } from '@/components/ui/huge-icon';
import { cn } from '@/lib/utils';

import type { HugeiconsIconProps } from '@hugeicons/react';

export interface WorkspaceStatItem {
  id: string;
  label: string;
  value: number;
  icon: HugeiconsIconProps['icon'];
  /** Tailwind accent tokens, e.g. 'emerald', 'violet', 'sky'. */
  accent: 'emerald' | 'violet' | 'sky' | 'amber';
}

/**
 * # StatValue
 *
 * Renders the numeric value with a brief scale+color flash whenever it
 * changes, so live status polls (agent online/offline, theme applied) are
 * immediately visible rather than reading as a static number.
 */
function StatValue({ value, accent }: { value: number; accent: WorkspaceStatItem['accent'] }) {
  const prev = useRef(value);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (prev.current === value) return;
    prev.current = value;
    setFlash(true);
    const id = window.setTimeout(() => setFlash(false), 600);
    return () => window.clearTimeout(id);
  }, [value]);

  const flashColor: Record<WorkspaceStatItem['accent'], string> = {
    emerald: 'text-emerald-600 dark:text-emerald-400',
    violet: 'text-violet-600 dark:text-violet-400',
    sky: 'text-sky-600 dark:text-sky-400',
    amber: 'text-amber-600 dark:text-amber-400',
  };

  return (
    <p
      className={cn(
        'text-base font-bold leading-none tabular-nums transition-all duration-500',
        flash && cn('scale-110', flashColor[accent]),
      )}
    >
      {value}
    </p>
  );
}

/**
 * # WorkspaceStats
 *
 * Compact stat cards (3-up) showing summary counts at a glance.
 * Each card: icon + numeric value + label.
 */
export function WorkspaceStats({ items }: { items: WorkspaceStatItem[] }) {
  const accentMap: Record<WorkspaceStatItem['accent'], { icon: string; ring: string }> = {
    emerald: {
      icon: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
      ring: 'ring-emerald-500/20',
    },
    violet: {
      icon: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
      ring: 'ring-violet-500/20',
    },
    sky: {
      icon: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
      ring: 'ring-sky-500/20',
    },
    amber: {
      icon: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
      ring: 'ring-amber-500/20',
    },
  };

  return (
    <div className="mt-4 grid grid-cols-3 gap-2">
      {items.map((item) => {
        const a = accentMap[item.accent];
        return (
          <div
            key={item.id}
            className={cn(
              'flex items-center gap-2.5 rounded-lg border bg-card p-2.5',
              'transition-all duration-200 ease-out hover:shadow-sm',
            )}
          >
            <div
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-md ring-1',
                a.icon,
                a.ring,
              )}
            >
              <HugeIcon icon={item.icon} size={15} />
            </div>
            <div className="min-w-0">
              <StatValue value={item.value} accent={item.accent} />
              <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{item.label}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
