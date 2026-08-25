// SPDX-License-Identifier: MPL-2.0

import type { ComponentType } from 'react';
import { cn } from '@/lib/utils';

export interface FilterChipOption<T extends string> {
  value: T;
  label: string;
  icon?: ComponentType<{ className?: string }>;
}

export interface FilterChipsProps<T extends string> {
  options: FilterChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** 是否允许多选 */
  multiple?: boolean;
  /** 多选时的值 */
  valueSet?: Set<T>;
  onMultipleChange?: (valueSet: Set<T>) => void;
  /** 额外 className */
  className?: string;
}

export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  multiple = false,
  valueSet,
  onMultipleChange,
  className,
}: FilterChipsProps<T>) {
  if (multiple && valueSet && onMultipleChange) {
    return (
      // biome-ignore lint/a11y/useSemanticElements: div-based group is intentional — fieldset would override chip-pill visual styling.
      <div role="group" className={cn('inline-flex items-center gap-1', className)}>
        {options.map((opt) => {
          const active = valueSet.has(opt.value);
          const Icon = opt.icon;
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={active}
              onClick={() => {
                const next = new Set(valueSet);
                if (active) {
                  next.delete(opt.value);
                } else {
                  next.add(opt.value);
                }
                onMultipleChange(next);
              }}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium transition-all duration-fast',
                active
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              {Icon && <Icon className="size-3" />}
              {opt.label}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div role="radiogroup" className={cn('inline-flex items-center gap-1', className)}>
      {options.map((opt) => {
        const active = value === opt.value;
        const Icon = opt.icon;
        return (
          // biome-ignore lint/a11y/useSemanticElements: button-based radiogroup is intentional — preserves chip-pill visual styling while exposing the correct radiogroup/radio ARIA pattern.
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium transition-all duration-fast',
              active
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {Icon && <Icon className="size-3" />}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
