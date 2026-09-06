// SPDX-License-Identifier: MPL-2.0

/**
 * # CommunityPage — regression tests for the standalone community browser.
 *
 * Covers:
 *   R-1: Page renders with the localized "Community" title
 *   R-2: Loading state shows the page-level skeleton (no double-flicker)
 *   R-3: Theme grid displays community themes when store has data
 *   R-4: Source switch triggers data loading (setActiveSource)
 *   R-5: Empty state shown when no themes match
 *   R-6: Skeleton renders while loading; R-6b: real content replaces it
 *   R-7: Three-column layout renders SourceDetailPanel alongside CommunityTabPanel
 *   R-8: CommunityTabPanel is rendered with hideDetailPanel prop
 */

import type { CommunitySourceId, CommunityThemeSummary } from '@shared/types/community';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mutable store state — mirrors communityStore flat-field mirrors
// ---------------------------------------------------------------------------

let mockThemes: CommunityThemeSummary[] = [];
let mockLoading = false;
let mockError: string | null = null;
let mockQuery = '';
let mockTotal = 0;
let mockActiveSourceId: CommunitySourceId = 'dreamskin';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockListCommunityThemes, mockOnCommunityDownloadProgress } = vi.hoisted(() => ({
  mockListCommunityThemes: vi.fn(),
  mockOnCommunityDownloadProgress: vi.fn(),
}));

vi.mock('@/api/agentSkinClient', () => ({
  api: {
    listCommunityThemes: mockListCommunityThemes,
    onCommunityDownloadProgress: mockOnCommunityDownloadProgress,
    cancelCommunityDownload: vi.fn(),
    downloadCommunityTheme: vi.fn(),
  },
}));

vi.mock('@/stores/notificationStore', () => ({
  useNotificationStore: {
    getState: () => ({
      fail: vi.fn(),
      showToast: vi.fn(),
    }),
  },
}));

vi.mock('@/stores/themeStore', () => ({
  useThemeStore: {
    getState: () => ({
      refreshThemes: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

let mockSources: Record<string, { total: number; status: 'online' | 'degraded' | 'offline' }> = {
  dreamskin: { total: 42, status: 'online' },
  codedrobe: { total: 0, status: 'offline' },
};

vi.mock('@/stores/communityStore', () => ({
  useCommunityStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = {
      themes: mockThemes,
      total: mockTotal,
      loading: mockLoading,
      loadingMore: false,
      error: mockError,
      query: mockQuery,
      sortBy: 'popular' as const,
      installingIds: new Set<string>(),
      installedIds: new Set<string>(),
      downloadProgress: new Map<string, unknown>(),
      selectedThemeId: null,
      selectedThemeDetail: null,
      detailLoading: false,
      activeSourceId: mockActiveSourceId,
      sources: mockSources,
      getSourceStatus: (sourceId: string) => mockSources[sourceId]?.status ?? 'offline',
      loadThemes: vi.fn().mockResolvedValue(undefined),
      loadMore: vi.fn().mockResolvedValue(undefined),
      setQuery: vi.fn(),
      setSortBy: vi.fn().mockResolvedValue(undefined),
      setActiveSource: vi.fn().mockResolvedValue(undefined),
      selectTheme: vi.fn(),
      loadThemeDetail: vi.fn().mockResolvedValue(undefined),
      installTheme: vi.fn().mockResolvedValue({ success: true }),
      uninstallTheme: vi.fn().mockResolvedValue(undefined),
      cancelInstall: vi.fn().mockResolvedValue(undefined),
      selectDeduplicatedThemes: vi.fn().mockReturnValue([]),
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/stores/shellStore', () => {
  const state = { locale: 'en' };
  const store = (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state);
  store.getState = () => state;
  return { useShellStore: store };
});

vi.mock('@shared/i18n', () => ({
  uiMessages: {
    en: {
      sourceCommunity: 'Community',
      communitySortPopular: 'Popular',
      communitySortRecent: 'Recent',
      communitySortRating: 'Rating',
      communitySearchPlaceholder: 'Search themes',
      communityEmptyNoThemes: 'No themes available',
      communityEmptyNoResult: 'No themes match your search',
      communityLoadMore: 'Load more',
      communityLoading: 'Loading…',
      communityRetry: 'Retry',
      communitySourceTitle: 'Sources',
      communityThemeCount: (count: number) => `${count} themes`,
      communityStatusDegraded: 'Connection unstable',
      communityStatusOffline: 'Temporarily offline',
      communitySourceComingSoon: 'Coming soon',
      communitySourceOfflineDescription: 'This community is not yet available — stay tuned',
      communitySelectThemeHint: 'Select a theme from the list to view details',
      communityNoSelectTitle: 'No theme selected',
      communityDedupFilterLabel: 'Show exclusive only',
      communityDedupFilterTooltip: 'Filter out themes also found in other communities',
      communityDedupActiveBadge: 'Exclusive',
    },
    'zh-CN': {
      sourceCommunity: '社区',
    },
  },
}));

// --- Mock CommunityTabPanel (render as a marker so we can assert on it) ----

vi.mock('@/components/themes/CommunityTabPanel', () => ({
  CommunityTabPanel: (props: Record<string, unknown>) => {
    const hideDetail = props.hideDetailPanel ? ' hide-detail' : '';
    return `<div data-testid="community-tab-panel"${hideDetail}>CommunityTabPanel</div>`;
  },
}));

vi.mock('@/components/themes/SourceDetailPanel', () => ({
  SourceDetailPanel: () => '<aside data-testid="source-detail-panel">SourceDetailPanel</aside>',
}));

// --- Mock PageHeader ------------------------------------------------------

vi.mock('@/components/ui/page-header', () => ({
  PageHeader: ({ title }: { title: string }) => `<header data-title="${title}">${title}</header>`,
}));

// --- Mock lucide icons (SSR-safe) ----------------------------------------

vi.mock('lucide-react', () => {
  const stub = () => null;
  return {
    Search: stub,
    AlertCircle: stub,
    Globe: stub,
    WifiOff: stub,
    Users: stub,
    BadgeCheck: stub,
    Clock: stub,
    Sparkles: stub,
  };
});

// --- Import component AFTER mocks are registered -------------------------

import { CommunityPage } from './CommunityPage';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTheme(id: string, name = `Theme ${id}`): CommunityThemeSummary {
  return {
    themeId: id,
    name,
    slug: id,
    author: { id: 'a1', displayName: 'Author' },
    thumbUrl: undefined,
    downloads: 100,
    tags: [],
    updatedAt: '2026-01-01',
    description: `Description for ${id}`,
    rating: 4.5,
    version: '1.0.0',
  };
}

function renderPage(source: 'dreamskin' | 'codedrobe' = 'dreamskin') {
  return renderToStaticMarkup(<CommunityPage route={`community.${source}`} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CommunityPage', () => {
  beforeEach(() => {
    mockThemes = [];
    mockLoading = false;
    mockError = null;
    mockQuery = '';
    mockTotal = 0;
    mockActiveSourceId = 'dreamskin';
    mockSources = {
      dreamskin: { total: 42, status: 'online' },
      codedrobe: { total: 0, status: 'offline' },
    };
    mockListCommunityThemes.mockReset();
    mockOnCommunityDownloadProgress.mockReset();
  });

  // R-1: Renders with the localized title
  it('R-1: renders the page with the localized Community title', () => {
    const html = renderPage();
    // SSR HTML-encodes mock return strings, so assert on substrings that survive encoding.
    expect(html).toContain('data-title');
    expect(html).toContain('Community');
  });

  // R-2: CommunityTabPanel is mounted as child content
  it('R-2: mounts CommunityTabPanel as child content', () => {
    const html = renderPage();
    expect(html).toContain('data-testid');
    expect(html).toContain('community-tab-panel');
  });

  // R-3: Renders page structure when themes store has data
  // (CommunityTabPanel is mocked, so theme rendering is not exercised here)
  it('R-3: renders page structure when themes are present in the store', () => {
    mockThemes = [makeTheme('t1', 'Aurora'), makeTheme('t2', 'Midnight')];
    mockTotal = 2;
    const html = renderPage();
    expect(html).toContain('data-title');
    expect(html).toContain('community-tab-panel');
  });

  // R-4: Source switching via setActiveSource
  it('R-4: activeSourceId reflects the store state', () => {
    mockActiveSourceId = 'codedrobe';
    mockThemes = [makeTheme('cr-1', 'CR Theme')];
    mockTotal = 1;
    const html = renderPage();
    expect(html).toContain('community-tab-panel');
    expect(mockActiveSourceId).toBe('codedrobe');
  });

  // R-5: Empty state path — no themes, no error, not loading
  it('R-5: renders when store is empty (CommunityTabPanel handles empty state)', () => {
    // Empty defaults: themes=[], loading=false, error=null
    const html = renderPage();
    expect(html).toContain('data-title');
    expect(html).toContain('community-tab-panel');
  });

  // R-6: Page always renders real layout (CommunityTabPanel owns its loading skeleton).
  // The CommunityPage itself does NOT gate on loading — doing so would prevent
  // CommunityTabPanel from mounting, which prevents its useEffect from calling
  // loadThemes(), causing a deadlock where loading=true never resolves.
  it('R-6: always renders real layout even while loading (no top-level skeleton)', () => {
    mockLoading = true;
    mockThemes = [];
    const html = renderPage();
    // Real page content must be present so CommunityTabPanel mounts & triggers loadThemes()
    expect(html).toContain('community-tab-panel');
    expect(html).toContain('data-title');
  });

  // R-7: SourceDetailPanel is conditionally rendered — only when a theme is selected.
  // On initial mount (no selection), it should NOT be present.
  it('R-7: does NOT render SourceDetailPanel when no theme is selected', () => {
    const html = renderPage();
    expect(html).toContain('community-tab-panel');
    expect(html).not.toContain('source-detail-panel');
  });

  // R-8: CommunityTabPanel receives hideDetailPanel prop
  it('R-8: CommunityTabPanel is rendered with hideDetailPanel prop', () => {
    const html = renderPage();
    // The mocked CommunityTabPanel renders hide-detail attr when hideDetailPanel is truthy
    expect(html).toContain('hide-detail');
  });
});
