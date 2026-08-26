// SPDX-License-Identifier: MPL-2.0

import { Skeleton } from '@/components/ui/skeleton';

export function ThemeGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex flex-col gap-2.5 overflow-hidden rounded-lg border border-border bg-card p-2.5"
        >
          <Skeleton className="aspect-[16/9] w-full rounded-lg" />
          <div className="flex items-center justify-between">
            <Skeleton className="h-3.5 w-2/3" />
            <Skeleton className="h-2.5 w-8" />
          </div>
          <Skeleton className="h-2.5 w-1/2" />
          <div className="flex items-center gap-1.5 pt-1">
            <Skeleton className="size-5 rounded-full" />
            <Skeleton className="size-5 rounded-full" />
            <Skeleton className="size-5 rounded-full" />
          </div>
        </div>
      ))}
    </div>
  );
}
