// SPDX-License-Identifier: MPL-2.0

import { Skeleton } from '@/components/ui/skeleton';

const skeletonCardIds = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

export function PageSkeleton() {
  return (
    <div className="flex h-full flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-5 w-8 rounded-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-7 w-20 rounded-md" />
          <Skeleton className="h-7 w-20 rounded-md" />
        </div>
      </div>

      {/* Description */}
      <Skeleton className="h-4 w-48" />

      {/* Toolbar */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-8 flex-1 max-w-xs rounded-md" />
        <Skeleton className="h-8 w-32 rounded-md" />
        <Skeleton className="h-8 w-16 rounded-md" />
      </div>

      {/* Stats bar */}
      <Skeleton className="h-10 w-full rounded-lg" />

      {/* Card grid — 8 placeholders */}
      <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {skeletonCardIds.map((id) => (
          <div
            key={id}
            className="flex flex-col gap-2.5 rounded-lg border border-border bg-card p-2.5"
          >
            <Skeleton className="aspect-[16/9] w-full rounded-lg" />
            <Skeleton className="h-3.5 w-3/4" />
            <Skeleton className="h-2.5 w-1/2" />
            <div className="flex gap-1.5 pt-1">
              <Skeleton className="h-5 w-5 rounded-full" />
              <Skeleton className="h-5 w-5 rounded-full" />
              <Skeleton className="h-5 w-5 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
