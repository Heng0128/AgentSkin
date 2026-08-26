// SPDX-License-Identifier: MPL-2.0

/**
 * # ThemeWall — component tests
 *
 * Covers the ThemeWall and ThemeCard components:
 *  - Theme list rendering
 *  - Click-to-apply interaction
 *  - Search and category filter
 *  - Loading skeleton state
 *  - Error state with retry
 *  - Empty state
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ThemeCardPreview } from '../../../src/ui/components/ThemeWall/ThemeCard';
import { ThemeCard } from '../../../src/ui/components/ThemeWall/ThemeCard';
import { ThemeWall } from '../../../src/ui/components/ThemeWall/ThemeWall';

// happy-dom does not auto-cleanup between tests; ensure each test starts fresh
afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function createTheme(overrides: Partial<ThemeCardPreview> = {}): ThemeCardPreview {
  return {
    id: 'theme-001',
    name: 'Solarized Dark',
    author: 'Alice Chen',
    thumbUrl: 'http://localhost/thumb.jpg',
    colors: {
      accent: '#ff9800',
      background: '#1a1a2e',
      text: '#eaeaea',
      panel: '#16213e',
      secondary: '#0f3460',
    },
    tags: ['dark', 'warm'],
    ...overrides,
  };
}

function createThemes(count: number): ThemeCardPreview[] {
  return Array.from({ length: count }, (_, i) =>
    createTheme({
      id: `theme-${String(i).padStart(3, '0')}`,
      name: `Theme ${i}`,
      author: `Author ${i}`,
      tags: i % 2 === 0 ? ['dark'] : ['light'],
    }),
  );
}

// ---------------------------------------------------------------------------
// Test suite — ThemeWall
// ---------------------------------------------------------------------------

describe('ThemeWall', () => {
  // --- 1. Basic rendering ---

  it('renders a grid of theme cards', () => {
    const themes = createThemes(4);
    const onSelect = vi.fn();
    const onApply = vi.fn();

    render(
      <ThemeWall
        themes={themes}
        selectedId={null}
        loading={false}
        error={null}
        onSelect={onSelect}
        onApply={onApply}
        onRetry={() => {}}
      />,
    );

    // All 4 theme names should be visible
    expect(screen.getByText('Theme 0')).toBeTruthy();
    expect(screen.getByText('Theme 1')).toBeTruthy();
    expect(screen.getByText('Theme 2')).toBeTruthy();
    expect(screen.getByText('Theme 3')).toBeTruthy();
  });

  // --- 2. Click-to-apply interaction ---

  it('calls onSelect and onApply when a card is clicked', () => {
    const themes = createThemes(3);
    const onSelect = vi.fn();
    const onApply = vi.fn();

    render(
      <ThemeWall
        themes={themes}
        selectedId={null}
        loading={false}
        error={null}
        onSelect={onSelect}
        onApply={onApply}
        onRetry={() => {}}
      />,
    );

    // Click the first theme card
    fireEvent.click(screen.getByText('Theme 0'));
    expect(onSelect).toHaveBeenCalledWith('theme-000');
    expect(onApply).toHaveBeenCalledWith('theme-000');
  });

  it('marks the selected card as selected', () => {
    const themes = createThemes(3);

    render(
      <ThemeWall
        themes={themes}
        selectedId="theme-001"
        loading={false}
        error={null}
        onSelect={() => {}}
        onApply={() => {}}
        onRetry={() => {}}
      />,
    );

    // The selected card should have a Check icon (aria-hidden, so we look for the SVG)
    const checkIcons = document.querySelectorAll('svg');
    // At least one check icon should exist for the selected card
    expect(checkIcons.length).toBeGreaterThan(0);
  });

  // --- 3. Search functionality ---

  it('filters themes by search query (name match)', () => {
    const themes = [
      createTheme({ id: 't1', name: 'Ocean Blue' }),
      createTheme({ id: 't2', name: 'Forest Green' }),
      createTheme({ id: 't3', name: 'Sunset Orange' }),
    ];

    render(
      <ThemeWall
        themes={themes}
        selectedId={null}
        loading={false}
        error={null}
        onSelect={() => {}}
        onApply={() => {}}
        onRetry={() => {}}
      />,
    );

    // Type in search
    const searchInput = screen.getByPlaceholderText('搜索主题名称、作者或标签…');
    fireEvent.change(searchInput, { target: { value: 'Ocean' } });

    // Only "Ocean Blue" should remain
    expect(screen.getByText('Ocean Blue')).toBeTruthy();
    expect(screen.queryByText('Forest Green')).toBeNull();
    expect(screen.queryByText('Sunset Orange')).toBeNull();
  });

  it('filters themes by search query (author match)', () => {
    const themes = [
      createTheme({ id: 't1', name: 'Theme A', author: 'Alice' }),
      createTheme({ id: 't2', name: 'Theme B', author: 'Bob' }),
    ];

    render(
      <ThemeWall
        themes={themes}
        selectedId={null}
        loading={false}
        error={null}
        onSelect={() => {}}
        onApply={() => {}}
        onRetry={() => {}}
      />,
    );

    const searchInput = screen.getByPlaceholderText('搜索主题名称、作者或标签…');
    fireEvent.change(searchInput, { target: { value: 'Bob' } });

    expect(screen.getByText('Theme B')).toBeTruthy();
    expect(screen.queryByText('Theme A')).toBeNull();
  });

  it('filters themes by search query (tag match)', () => {
    const themes = [
      createTheme({ id: 't1', name: 'Theme A', tags: ['dark', 'minimal'] }),
      createTheme({ id: 't2', name: 'Theme B', tags: ['light', 'colorful'] }),
    ];

    render(
      <ThemeWall
        themes={themes}
        selectedId={null}
        loading={false}
        error={null}
        onSelect={() => {}}
        onApply={() => {}}
        onRetry={() => {}}
      />,
    );

    const searchInput = screen.getByPlaceholderText('搜索主题名称、作者或标签…');
    fireEvent.change(searchInput, { target: { value: 'minimal' } });

    expect(screen.getByText('Theme A')).toBeTruthy();
    expect(screen.queryByText('Theme B')).toBeNull();
  });

  // --- 4. Category filter ---

  it('filters themes by category (dark)', () => {
    const themes = [
      createTheme({ id: 't1', name: 'Dark Theme', tags: ['dark'] }),
      createTheme({ id: 't2', name: 'Light Theme', tags: ['light'] }),
      createTheme({ id: 't3', name: 'Another Dark', tags: ['dark', 'minimal'] }),
    ];

    render(
      <ThemeWall
        themes={themes}
        selectedId={null}
        loading={false}
        error={null}
        onSelect={() => {}}
        onApply={() => {}}
        onRetry={() => {}}
      />,
    );

    // Click the "暗色" (dark) filter chip
    fireEvent.click(screen.getByRole('radio', { name: '暗色' }));

    expect(screen.getByText('Dark Theme')).toBeTruthy();
    expect(screen.getByText('Another Dark')).toBeTruthy();
    expect(screen.queryByText('Light Theme')).toBeNull();
  });

  it('shows all themes when "全部" (all) category is selected', () => {
    const themes = createThemes(3);

    render(
      <ThemeWall
        themes={themes}
        selectedId={null}
        loading={false}
        error={null}
        onSelect={() => {}}
        onApply={() => {}}
        onRetry={() => {}}
      />,
    );

    // "全部" is selected by default — all themes visible
    expect(screen.getByText('Theme 0')).toBeTruthy();
    expect(screen.getByText('Theme 1')).toBeTruthy();
    expect(screen.getByText('Theme 2')).toBeTruthy();
  });

  // --- 5. Loading state ---

  it('renders loading skeleton when loading is true and no themes', () => {
    render(
      <ThemeWall
        themes={[]}
        selectedId={null}
        loading={true}
        error={null}
        onSelect={() => {}}
        onApply={() => {}}
        onRetry={() => {}}
      />,
    );

    // Skeleton uses animate-pulse class
    const skeletons = document.querySelectorAll('.animate-pulse');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  // --- 6. Error state ---

  it('renders error state with retry button', () => {
    const onRetry = vi.fn();

    render(
      <ThemeWall
        themes={[]}
        selectedId={null}
        loading={false}
        error="Network error: failed to fetch themes"
        onSelect={() => {}}
        onApply={() => {}}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText('Network error: failed to fetch themes')).toBeTruthy();

    // Click retry
    fireEvent.click(screen.getByText('重试'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  // --- 7. Empty state ---

  it('renders empty state when no themes match search', () => {
    const themes = [createTheme({ id: 't1', name: 'Ocean Blue' })];

    render(
      <ThemeWall
        themes={themes}
        selectedId={null}
        loading={false}
        error={null}
        onSelect={() => {}}
        onApply={() => {}}
        onRetry={() => {}}
      />,
    );

    // Search for something that doesn't match
    const searchInput = screen.getByPlaceholderText('搜索主题名称、作者或标签…');
    fireEvent.change(searchInput, { target: { value: 'NonExistent' } });

    expect(screen.getByText('未找到匹配的主题')).toBeTruthy();
  });

  it('renders empty state when themes list is empty', () => {
    render(
      <ThemeWall
        themes={[]}
        selectedId={null}
        loading={false}
        error={null}
        onSelect={() => {}}
        onApply={() => {}}
        onRetry={() => {}}
      />,
    );

    expect(screen.getByText('暂无主题')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Test suite — ThemeCard
// ---------------------------------------------------------------------------

describe('ThemeCard', () => {
  // --- 8. Card rendering ---

  it('renders theme name and author', () => {
    const theme = createTheme();

    render(<ThemeCard theme={theme} selected={false} onSelect={() => {}} />);

    expect(screen.getByText('Solarized Dark')).toBeTruthy();
    expect(screen.getByText('by Alice Chen')).toBeTruthy();
  });

  it('renders tag pills (max 2)', () => {
    const theme = createTheme({ tags: ['dark', 'warm', 'popular'] });

    render(<ThemeCard theme={theme} selected={false} onSelect={() => {}} />);

    // Only first 2 tags should be visible
    expect(screen.getByText('dark')).toBeTruthy();
    expect(screen.getByText('warm')).toBeTruthy();
    expect(screen.queryByText('popular')).toBeNull();
  });

  // --- 9. Card interaction ---

  it('calls onSelect when clicked', () => {
    const theme = createTheme();
    const onSelect = vi.fn();

    render(<ThemeCard theme={theme} selected={false} onSelect={onSelect} />);

    fireEvent.click(screen.getByText('Solarized Dark'));
    expect(onSelect).toHaveBeenCalledWith('theme-001');
  });

  // --- 10. Card states ---

  it('shows selected indicator when selected is true', () => {
    const theme = createTheme();

    render(<ThemeCard theme={theme} selected={true} onSelect={() => {}} />);

    // Check icon should be present (rendered as SVG)
    const checkIcons = document.querySelectorAll('svg');
    expect(checkIcons.length).toBeGreaterThan(0);
  });

  it('does not show selected indicator when selected is false', () => {
    const theme = createTheme({ name: 'Unselected Theme' });

    render(<ThemeCard theme={theme} selected={false} onSelect={() => {}} />);

    // No check icon should be present
    const checkIcons = document.querySelectorAll('svg');
    expect(checkIcons.length).toBe(0);
  });

  // --- 11. Card without preview image ---

  it('renders fallback when thumbUrl is missing', () => {
    const theme = createTheme({ thumbUrl: undefined });

    render(<ThemeCard theme={theme} selected={false} onSelect={() => {}} />);

    // Should show the first letter of the theme name
    expect(screen.getByText('S')).toBeTruthy();
  });

  it('renders color palette strip when colors are provided', () => {
    const theme = createTheme({
      colors: {
        accent: '#ff9800',
        background: '#1a1a2e',
        text: '#eaeaea',
      },
    });

    render(<ThemeCard theme={theme} selected={false} onSelect={() => {}} />);

    // Color strip divs should have inline background-color styles
    const colorBars = document.querySelectorAll('[style*="background-color"]');
    expect(colorBars.length).toBeGreaterThan(0);
  });

  // --- 12. Card without optional fields ---

  it('renders without crashing when tags are empty', () => {
    const theme = createTheme({ tags: [] });

    render(<ThemeCard theme={theme} selected={false} onSelect={() => {}} />);

    expect(screen.getByText('Solarized Dark')).toBeTruthy();
  });

  it('renders without crashing when colors are missing', () => {
    const theme = createTheme({ colors: undefined });

    render(<ThemeCard theme={theme} selected={false} onSelect={() => {}} />);

    expect(screen.getByText('Solarized Dark')).toBeTruthy();
    // No color bars should be present
    const colorBars = document.querySelectorAll('[style*="background-color"]');
    expect(colorBars.length).toBe(0);
  });
});
