// SPDX-License-Identifier: MPL-2.0

import type * as React from 'react';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
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

function PageToolbar({
  search,
  sort,
  sortOrder,
  actions,
  left,
  className,
}: PageToolbarProps) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      {left}
      {search && (
        <InputGroup className="h-6 rounded-sm" style={{ width: '240px' }}>
          <InputGroupInput
            value={search.value}
            onChange={(e) => search.onChange(e.target.value)}
            placeholder={search.placeholder}
            aria-label={search.placeholder}
          />
          <InputGroupAddon align="inline-start">
            <Search />
          </InputGroupAddon>
        </InputGroup>
      )}
      {sort && (
        <Select value={sort.value} onValueChange={sort.onChange}>
          <SelectTrigger
            className="h-6 w-[130px] rounded-sm border-input bg-muted text-[10px] focus:border-primary focus:shadow-[0_0_0_3px_rgba(var(--primary-rgb),0.13)]"
            aria-label={sort.options.find((o) => o.value === sort.value)?.label}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="rounded-sm border-border bg-card">
            {sort.options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} className="text-[10px]">
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {sortOrder && (
        <div className="inline-flex items-center gap-0 rounded-sm bg-muted p-0.5">
          <button
            type="button"
            onClick={sortOrder.onToggle}
            aria-label={sortOrder.order === 'asc' ? 'Sort descending' : 'Sort ascending'}
            aria-pressed={sortOrder.order === 'asc'}
            className={cn(
              'h-6 rounded-sm px-2 text-[10px] font-normal transition-all duration-fast',
              'bg-card text-foreground',
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

export { PageToolbar };
export type { PageToolbarProps };
