// SPDX-License-Identifier: MPL-2.0

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface SkeletonTransitionProps {
  /** 是否显示骨架屏（true=骨架屏，false=真实内容） */
  showSkeleton: boolean;
  /** 骨架屏内容 */
  skeleton: ReactNode;
  /** 真实内容 */
  children: ReactNode;
  /** 过渡时长（ms），默认 250 */
  duration?: number;
  /** 额外 className */
  className?: string;
}

/**
 * 骨架屏 ↔ 真实内容的交叉淡出过渡
 *
 * 结构：相对定位容器，两层绝对定位叠加
 * - 骨架屏层：showSkeleton 时 opacity-100，否则 opacity-0 pointer-events-none
 * - 内容层：showSkeleton 时 opacity-0 pointer-events-none，否则 opacity-100
 */
export function SkeletonTransition({
  showSkeleton,
  skeleton,
  children,
  duration = 250,
  className,
}: SkeletonTransitionProps) {
  return (
    <div className={cn('relative', className)}>
      {/* 骨架屏层 */}
      <div
        className={cn(
          'absolute inset-0 transition-opacity ease-out',
          showSkeleton ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        style={{ transitionDuration: `${duration}ms` }}
        aria-hidden={!showSkeleton}
        data-state={showSkeleton ? 'showing' : 'hidden'}
      >
        {skeleton}
      </div>

      {/* 真实内容层 */}
      <div
        className={cn(
          'absolute inset-0 flex flex-col transition-opacity ease-out',
          showSkeleton ? 'pointer-events-none opacity-0' : 'opacity-100',
        )}
        style={{ transitionDuration: `${duration}ms` }}
        aria-hidden={showSkeleton}
        data-state={showSkeleton ? 'hidden' : 'showing'}
      >
        {children}
      </div>
    </div>
  );
}
