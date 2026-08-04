// SPDX-License-Identifier: MPL-2.0

/**
 * # useThemeCenter
 *
 * Transforms controller data into Theme Center models with search,
 * category filter, and sorting (name, author, category, version).
 * ThemesPage consumes this — it never touches ThemeCatalogItem directly.
 *
 * Future: marketplace themes will be merged in here without changing
 * the page or components.
 */

import { useMemo, useState } from 'react';
import type { ThemeCenterCardModel } from '@/types/theme-center';

import type { AppController } from './useAppController';

function toCard(theme: AppController['installed'][number]): ThemeCenterCardModel {
  return {
    id: theme.id,
    name: theme.name,
    preview: theme.preview,
    author: theme.author || '—',
    version: theme.version || '1.0.0',
    tags: theme.tags,
    category: theme.category,
    mode: theme.mode ?? null,
    supportedAgents: theme.supportedAgents,
    installed: theme.installed,
    source: theme.source,
    icon: theme.icon ?? null,
    hasWallpaper: Boolean(theme.wallpaper?.video || theme.wallpaper?.workshopId),
  };
}

export type ThemeSortKey = 'name' | 'author' | 'category' | 'version';
export type SortOrder = 'asc' | 'desc';
export type ThemeModeFilter = 'all' | 'dark' | 'light';
export type ThemeDynamicFilter = 'all' | 'dynamic';

export function useThemeCenter(controller: AppController) {
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [modeFilter, setModeFilter] = useState<ThemeModeFilter>('all');
  const [dynamicFilter, setDynamicFilter] = useState<ThemeDynamicFilter>('all');
  const [sortBy, setSortBy] = useState<ThemeSortKey>('name');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  const allThemes = useMemo(() => controller.installed.map(toCard), [controller.installed]);

  const categories = useMemo(() => {
    const set = new Set(allThemes.map((t) => t.category).filter(Boolean));
    return [...set].sort();
  }, [allThemes]);

  const themes = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = allThemes.filter((theme) => {
      if (
        q &&
        !theme.name.toLowerCase().includes(q) &&
        !theme.author.toLowerCase().includes(q) &&
        !theme.tags.some((t) => t.toLowerCase().includes(q)) &&
        !(theme.category && theme.category.toLowerCase().includes(q))
      ) {
        return false;
      }
      if (selectedCategory && theme.category !== selectedCategory) {
        return false;
      }
      // Mode filter: 'dark' matches mode 'dark' or 'auto' (auto themes render
      // on a dark canvas); 'light' matches mode 'light' only.
      if (modeFilter === 'dark' && theme.mode !== 'dark' && theme.mode !== 'auto') {
        return false;
      }
      if (modeFilter === 'light' && theme.mode !== 'light') {
        return false;
      }
      if (dynamicFilter === 'dynamic' && !theme.hasWallpaper) {
        return false;
      }
      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      let va: string, vb: string;
      if (sortBy === 'version') {
        // Parse version strings for proper sorting (e.g. "2.0.0" vs "1.5.3")
        va = a.version || '';
        vb = b.version || '';
      } else {
        va = (a[sortBy] ?? '').toString().toLowerCase();
        vb = (b[sortBy] ?? '').toString().toLowerCase();
      }
      // Compare version numerically if both look like semver
      if (sortBy === 'version') {
        const vaParts = va.split('.').map(Number);
        const vbParts = vb.split('.').map(Number);
        for (let i = 0; i < Math.max(vaParts.length, vbParts.length); i++) {
          const av = vaParts[i] || 0;
          const bv = vbParts[i] || 0;
          if (av !== bv) return av < bv ? -1 : 1;
        }
        return 0;
      }
      const cmp = va < vb ? -1 : va > vb ? 1 : 0;
      return sortOrder === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [allThemes, query, selectedCategory, modeFilter, dynamicFilter, sortBy, sortOrder]);

  const hasDynamic = useMemo(() => allThemes.some((t) => t.hasWallpaper), [allThemes]);

  return {
    themes,
    allCount: allThemes.length,
    query,
    setQuery,
    categories,
    selectedCategory,
    setSelectedCategory,
    modeFilter,
    setModeFilter,
    dynamicFilter,
    setDynamicFilter,
    hasDynamic,
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder,
  };
}
