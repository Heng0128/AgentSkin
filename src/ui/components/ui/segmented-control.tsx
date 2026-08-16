// SPDX-License-Identifier: MPL-2.0

import type { ComponentType, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { cn } from '@/lib/utils';

/**
 * # SegmentedControl
 *
 * Unified segmented control — the single implementation replacing the five
 * previously hand-written inline variants (title-bar theme mode, ThemesPage
 * category/mode filters, WallpaperEngine type filter, SettingsPage select).
 *
 * ARIA: single-select, no associated tabpanels → uses the `radiogroup` /
 * `radio` pattern (`aria-checked`), with ←/→ arrow-key navigation.
 *
 * Design tokens: `bg-muted` track + `bg-card` active segment, `rounded-md`
 * radius (now bound to `--radius-md` = 3px), 4px-grid spacing only.
 */
export interface SegmentedOption<T extends string> {
  value: T;
  label?: React.ReactNode;
  icon?: ComponentType<{ className?: string }>;
  title?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  bordered = false,
  className,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  bordered?: boolean;
  className?: string;
}) {
  const iconOnly = options.every((opt) => !opt.label);

  // radiogroup ←/→ arrow-key navigation: move selection to the neighbouring
  // option, wrapping around at the ends.
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const idx = options.findIndex((opt) => opt.value === value);
    const delta = e.key === 'ArrowRight' ? 1 : -1;
    const next = options[(idx + delta + options.length) % options.length];
    if (next) onChange(next.value);
  };

  return (
    <div
      role="radiogroup"
      onKeyDown={onKeyDown}
      className={cn(
        'inline-flex items-center gap-1 rounded-md bg-muted p-1',
        bordered && 'border border-border',
        className,
      )}
    >
      {options.map((opt) => {
        const Icon = opt.icon;
        const active = opt.value === value;
        return (
          // biome-ignore lint/a11y/useSemanticElements: button-based radiogroup is intentional — it preserves the segmented-control visual styling while still exposing the correct radiogroup/radio ARIA pattern with arrow-key navigation below.
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            title={opt.title}
            onClick={() => onChange(opt.value)}
            className={cn(
              'inline-flex items-center justify-center rounded-md font-medium transition-all duration-fast',
              iconOnly
                ? size === 'sm'
                  ? 'size-6'
                  : 'size-7'
                : size === 'sm'
                  ? 'h-6 gap-2 px-2 text-[11px]'
                  : 'h-7 gap-2 px-4 text-[11.5px]',
              active ? 'bg-card text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {Icon && <Icon className="size-3 shrink-0" />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
