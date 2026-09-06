// SPDX-License-Identifier: MPL-2.0

import { type ReactNode, useMemo } from 'react';
import { cn } from '@/lib/utils';

/* =================================================================== */
/* Flexible Skeleton System                                             */
/* =================================================================== */
/* Declarative, config-driven skeleton. Pages describe *what* their
   structure is (header + toolbar + grid/list), and the provider
   renders matching placeholders. No hardcoded per-page JSX — change
   the real layout and the skeleton follows automatically.          */

interface SkeletonProviderProps {
  /** Whether to show the skeleton (true) or the real content (false) */
  loading: boolean;
  /** Layout configuration — describes the page structure declaratively */
  config: SkeletonConfig;
  /** The real content to show when not loading (optional for Suspense fallback use) */
  children?: ReactNode;
  /** Transition duration in ms */
  duration?: number;
  /** Additional className for the container */
  className?: string;
}

interface SkeletonConfig {
  /** Show header placeholder (title + actions) */
  header?: boolean | 'minimal';
  /** Show toolbar placeholder (filter chips + search) */
  toolbar?: boolean;
  /** Body layout type */
  body?: 'grid' | 'list';
  /** Number of placeholder items to render */
  count?: number;
  /** CSS aspect ratio for grid cards (e.g. '16/9', '1/1') */
  aspect?: string;
  /** Number of text lines in each card (grid mode) */
  cardLines?: number;
  /** Whether list rows have avatars */
  rowAvatar?: boolean;
  /** Whether list rows have a trailing badge */
  rowBadge?: boolean;
  /** Grid columns override (default: responsive 1→2→3→4) */
  columns?: number;
}

const DEFAULT_COUNT = 8;

/** Generates an array of stable indices for skeleton items */
function useSkeletonIndices(count: number): number[] {
  return useMemo(() => Array.from({ length: count }, (_, i) => i), [count]);
}

export function SkeletonProvider({
  loading,
  config,
  children,
  duration = 250,
  className,
}: SkeletonProviderProps) {
  const itemCount = config.count ?? DEFAULT_COUNT;
  const indices = useSkeletonIndices(itemCount);

  return (
    <div className={cn('relative', className)}>
      {/* Skeleton layer — shown while loading */}
      <div
        className={cn(
          'absolute inset-0 transition-opacity ease-out',
          loading ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        style={{ transitionDuration: `${duration}ms` }}
        aria-hidden={!loading}
        data-state={loading ? 'showing' : 'hidden'}
      >
        <SkeletonView config={config} indices={indices} />
      </div>

      {/* Content layer — shown when loaded (rendered only if children provided) */}
      {children !== undefined && (
        <div
          className={cn(
            'flex h-full flex-col transition-opacity ease-out',
            loading ? 'pointer-events-none opacity-0' : 'opacity-100',
          )}
          style={{ transitionDuration: `${duration}ms` }}
          aria-hidden={loading}
          data-state={loading ? 'hidden' : 'showing'}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** Renders the skeleton structure based on config */
function SkeletonView({ config, indices }: { config: SkeletonConfig; indices: number[] }) {
  const columnsStyle = config.columns
    ? ({ '--skeleton-columns': config.columns } as React.CSSProperties)
    : undefined;

  return (
    <div className="skeleton-provider">
      {/* Header placeholder */}
      {config.header && (
        <div className="skeleton-header">
          <div className="skeleton-header-title">
            <div className="skeleton-block h-4 w-40" />
            {config.header !== 'minimal' && <div className="skeleton-block h-3 w-64" />}
          </div>
          <div className="flex items-center gap-2">
            <div className="skeleton-block h-8 w-24 rounded-md" />
          </div>
        </div>
      )}

      {/* Toolbar placeholder */}
      {config.toolbar && (
        <div className="skeleton-toolbar">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="skeleton-block h-6 w-16 rounded-md" />
          ))}
          <div className="skeleton-block ml-auto h-8 w-[260px] rounded-md" />
        </div>
      )}

      {/* Body placeholder — grid or list */}
      {config.body && (
        <div className="skeleton-body">
          {config.body === 'grid' ? (
            <div className="skeleton-grid" style={columnsStyle}>
              {indices.map((i) => (
                <SkeletonCard key={i} aspect={config.aspect} lines={config.cardLines} />
              ))}
            </div>
          ) : (
            <div className="skeleton-list">
              {indices.map((i) => (
                <SkeletonListRow key={i} avatar={config.rowAvatar} badge={config.rowBadge} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Grid card placeholder */
function SkeletonCard({ aspect, lines = 1 }: { aspect?: string; lines?: number }) {
  const style = aspect ? ({ '--skeleton-aspect': aspect } as React.CSSProperties) : undefined;

  return (
    <div className="skeleton-card">
      <div className="skeleton-card-thumb" style={style} />
      <div className="skeleton-card-lines">
        <div className="skeleton-block h-3.5 w-2/3" />
        {lines >= 2 && <div className="skeleton-block h-2.5 w-1/2" />}
      </div>
    </div>
  );
}

/** List row placeholder */
function SkeletonListRow({ avatar = true, badge = true }: { avatar?: boolean; badge?: boolean }) {
  return (
    <div className="skeleton-row">
      {avatar && <div className="skeleton-block size-8 shrink-0 rounded-full" />}
      <div className="skeleton-row-content">
        <div className="skeleton-block h-3 w-1/3" />
        <div className="skeleton-block h-2.5 w-1/2" />
      </div>
      {badge && <div className="skeleton-block h-5 w-14 shrink-0 rounded-md" />}
    </div>
  );
}
