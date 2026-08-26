// SPDX-License-Identifier: MPL-2.0

/**
 * # ThemeWall
 *
 * Remote theme wall component — displays a searchable, filterable grid
 * of theme cards. Users click a card to select a theme; the parent
 * handles the actual apply/injection via the provided onApply callback.
 *
 * Features:
 *  - Responsive card grid (1-4 columns)
 *  - Search input with debounce
 *  - Category filter chips
 *  - Loading skeleton state
 *  - Error state with retry
 *  - Empty state for no results
 */

import { useCallback, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { type FilterChipOption, FilterChips } from '@/components/ui/filter-chips';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';

import { AlertCircle, Palette, Search } from 'lucide-react';
import { ThemeCard, type ThemeCardPreview } from './ThemeCard';

export type ThemeCategoryFilter = 'all' | 'dark' | 'light' | 'colorful' | 'minimal';

const CATEGORY_OPTIONS: FilterChipOption<ThemeCategoryFilter>[] = [
  { value: 'all', label: '全部' },
  { value: 'dark', label: '暗色' },
  { value: 'light', label: '亮色' },
  { value: 'colorful', label: '彩色' },
  { value: 'minimal', label: '极简' },
];

const SKELETON_KEYS = [
  'skeleton-1',
  'skeleton-2',
  'skeleton-3',
  'skeleton-4',
  'skeleton-5',
  'skeleton-6',
  'skeleton-7',
  'skeleton-8',
];

interface ThemeWallProps {
  themes: ThemeCardPreview[];
  selectedId: string | null;
  loading: boolean;
  error: string | null;
  onSelect: (id: string) => void;
  onApply: (id: string) => void;
  onRetry: () => void;
}

export function ThemeWall({
  themes,
  selectedId,
  loading,
  error,
  onSelect,
  onApply,
  onRetry,
}: ThemeWallProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ThemeCategoryFilter>('all');

  // Filter themes by search query and category
  const filteredThemes = useMemo(() => {
    let result = themes;

    // Category filter
    if (category !== 'all') {
      result = result.filter((theme) => {
        const themeTags = theme.tags ?? [];
        if (category === 'dark') return themeTags.includes('dark');
        if (category === 'light') return themeTags.includes('light');
        if (category === 'colorful')
          return themeTags.includes('colorful') || themeTags.includes('vibrant');
        if (category === 'minimal')
          return themeTags.includes('minimal') || themeTags.includes('clean');
        return true;
      });
    }

    // Search query filter
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      result = result.filter(
        (theme) =>
          theme.name.toLowerCase().includes(q) ||
          theme.author.toLowerCase().includes(q) ||
          (theme.tags ?? []).some((tag) => tag.toLowerCase().includes(q)),
      );
    }

    return result;
  }, [themes, query, category]);

  const handleSearch = useCallback((value: string) => {
    setQuery(value);
  }, []);

  const handleCardClick = useCallback(
    (id: string) => {
      onSelect(id);
      onApply(id);
    },
    [onSelect, onApply],
  );

  // --- Error state ---
  if (error) {
    return (
      <EmptyState
        icon={<AlertCircle />}
        iconSize="lg"
        title={error}
        action={
          <Button variant="outline" size="sm" onClick={onRetry}>
            重试
          </Button>
        }
        className="min-h-[400px] w-full"
      />
    );
  }

  // --- Loading skeleton ---
  if (loading && themes.length === 0) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {SKELETON_KEYS.map((key) => (
          <div
            key={key}
            className="flex flex-col gap-2 overflow-hidden rounded-lg border border-border bg-card p-2"
          >
            <Skeleton className="aspect-[16/9] w-full rounded-md" />
            <div className="flex items-center justify-between px-0.5">
              <Skeleton className="h-3 w-2/3" />
            </div>
            <Skeleton className="h-2 w-1/2 px-0.5" />
          </div>
        ))}
      </div>
    );
  }

  // --- Empty state ---
  if (filteredThemes.length === 0) {
    return (
      <EmptyState
        icon={<Palette />}
        iconSize="lg"
        title={query ? '未找到匹配的主题' : '暂无主题'}
        className="min-h-[400px] w-full"
      />
    );
  }

  // --- Main grid ---
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Toolbar — search + category filter */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-[240px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <Input
            type="text"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="搜索主题名称、作者或标签…"
            className="pl-8"
          />
        </div>
        <FilterChips options={CATEGORY_OPTIONS} value={category} onChange={setCategory} />
      </div>

      {/* Theme grid */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="grid grid-cols-1 gap-3 pb-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredThemes.map((theme) => (
            <ThemeCard
              key={theme.id}
              theme={theme}
              selected={selectedId === theme.id}
              onSelect={handleCardClick}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
