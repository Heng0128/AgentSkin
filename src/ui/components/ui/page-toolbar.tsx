// SPDX-License-Identifier: MPL-2.0

import type * as React from 'react';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

import { ArrowDown, ArrowUp, Search } from 'lucide-react';

interface PageToolbarProps {
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  };
  sort?: {
    value: string;
    options: { value: string; label: string }[];
    onChange: (value: string) => void;
  };
  sortOrder?: {
    order: 'asc' | 'desc';
    onToggle: () => void;
  };
  actions?: React.ReactNode;
  left?: React.ReactNode;
  className?: string;
}

function PageToolbar({ search, sort, sortOrder, actions, left, className }: PageToolbarProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {left}
      {search && (
        <InputGroup className="h-8 rounded-md" style={{ width: '260px' }}>
          <InputGroupInput
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
            placeholder={search.placeholder}
            aria-label={search.placeholder}
          />
          <InputGroupAddon align="inline-start">
            <Search className="size-3.5 text-muted-foreground" />
          </InputGroupAddon>
        </InputGroup>
      )}
      {sort && (
        <Select value={sort.value} onValueChange={sort.onChange}>
          <SelectTrigger
            className="h-8 w-[140px] rounded-md border-border bg-muted text-[11px] focus:border-primary focus:shadow-[0_0_0_3px_rgba(var(--brand-rgb),0.13)]"
            aria-label={sort.options.find((o) => o.value === sort.value)?.label}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="rounded-md border-border bg-card">
            {sort.options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} className="text-[11px]">
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {sortOrder && (
        <div className="inline-flex items-center gap-0 rounded-md bg-muted p-0.5">
          <button
            type="button"
            onClick={sortOrder.onToggle}
            aria-label={sortOrder.order === 'asc' ? 'Sort descending' : 'Sort ascending'}
            aria-pressed={sortOrder.order === 'asc'}
            className={cn(
              'flex h-7 items-center rounded-sm px-2 text-[11px] font-medium transition-all duration-fast',
              'bg-card text-foreground shadow-sm',
            )}
          >
            {sortOrder.order === 'asc' ? (
              <ArrowUp className="size-3.5" />
            ) : (
              <ArrowDown className="size-3.5" />
            )}
          </button>
        </div>
      )}
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export type { PageToolbarProps };
export { PageToolbar };
