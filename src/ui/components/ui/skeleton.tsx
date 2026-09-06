// SPDX-License-Identifier: MPL-2.0

import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-muted/60', className)}
      aria-hidden="true"
      {...props}
    />
  );
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {Array.from({ length: Math.max(1, lines) }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn('h-3', i === Math.max(1, lines) - 1 ? 'w-2/3' : 'w-full')}
        />
      ))}
    </div>
  );
}

export function SkeletonCard({
  variant = 'default',
  className,
}: {
  variant?: 'default' | 'wide' | 'compact';
  className?: string;
}) {
  if (variant === 'compact') {
    return (
      <div
        className={cn(
          'flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3',
          className,
        )}
      >
        <Skeleton className="size-10 rounded-md" />
        <div className="flex flex-1 flex-col gap-1.5">
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="h-2.5 w-1/2" />
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex flex-col gap-2.5 overflow-hidden rounded-lg border border-border bg-card p-2.5',
        className,
      )}
    >
      <Skeleton className="aspect-[16/9] w-full rounded-lg" />
      <div className="flex flex-col gap-1.5 px-0.5">
        <Skeleton className="h-3.5 w-2/3" />
        {variant === 'default' && <Skeleton className="h-2.5 w-1/2" />}
      </div>
    </div>
  );
}

export function SkeletonListRow({
  avatar = true,
  rounded = true,
  className,
}: {
  avatar?: boolean;
  rounded?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3',
        className,
      )}
    >
      {avatar && (
        <Skeleton className={cn('size-8 shrink-0', rounded ? 'rounded-full' : 'rounded-md')} />
      )}
      <div className="flex flex-1 flex-col gap-1.5">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-2.5 w-1/2" />
      </div>
      <Skeleton className="h-5 w-14 shrink-0 rounded-md" />
    </div>
  );
}

export function SkeletonStat({
  subtitle = false,
  className,
}: {
  subtitle?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn('flex flex-col gap-2 rounded-lg border border-border bg-card p-4', className)}
    >
      <Skeleton className="h-2.5 w-16" />
      <Skeleton className="h-7 w-12" />
      {subtitle && <Skeleton className="h-2 w-20" />}
    </div>
  );
}

export function PageSkeleton({
  header = true,
  toolbar = false,
  children,
}: {
  header?: boolean | 'minimal';
  toolbar?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="sr-only" aria-live="polite">
        正在加载页面内容
      </div>

      {header && (
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-2 pt-1">
            <Skeleton className="h-4 w-40" />
            {header !== 'minimal' && <Skeleton className="h-3 w-64" />}
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-8 w-24 rounded-md" />
          </div>
        </div>
      )}

      {toolbar && (
        <div className="flex flex-wrap items-center gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-16 rounded-md" />
          ))}
          <Skeleton className="ml-auto h-8 w-[260px] rounded-md" />
        </div>
      )}

      {children}
    </div>
  );
}
