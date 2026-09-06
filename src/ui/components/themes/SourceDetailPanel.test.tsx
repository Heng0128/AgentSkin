// SPDX-License-Identifier: MPL-2.0

/**
 * # SourceDetailPanel — rendering + interaction contract tests
 *
 * Follows the project UI test convention: SSR via renderToStaticMarkup in the
 * node environment. Mocks communityStore / shellStore / lucide / Button.
 *
 * Covers:
 *   1. Empty state (no selection) renders DetailEmptyState
 *   2. Selected theme renders name, author, rating, downloads, tags
 *   3. Install button visible when idle (not installing / not installed)
 *   4. Installing state shows cancel button + DownloadProgress
 *   5. Cancel button visible when installingIds contains themeId
 *   6. Empty description does not crash
 *   7. ISO 8601 updatedAt renders a formatted date
 */

import type { CommunityThemeDetail, DownloadProgress } from '@shared/types/community';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Hoisted mock factories ----------------------------------------------

const {
  installThemeMock,
  cancelInstallMock,
  selectThemeMock,
  uninstallThemeMock,
} = vi.hoisted(() => ({
  installThemeMock: vi.fn(),
  cancelInstallMock: vi.fn(),
  selectThemeMock: vi.fn(),
  uninstallThemeMock: vi.fn(),
}));

// --- Mutable community store state (reassigned per test) ------------------

let communityState: {
  selectedThemeDetail: CommunityThemeDetail | null;
  selectedThemeId: string | null;
  installingIds: Set<string>;
  downloadProgress: Map<string, DownloadProgress>;
  installedIds: Set<string>;
  installTheme: typeof installThemeMock;
  cancelInstall: typeof cancelInstallMock;
  selectTheme: typeof selectThemeMock;
  uninstallTheme: typeof uninstallThemeMock;
} = {
  selectedThemeDetail: null,
  selectedThemeId: null,
  installingIds: new Set(),
  downloadProgress: new Map(),
  installedIds: new Set(),
  installTheme: installThemeMock,
  cancelInstall: cancelInstallMock,
  selectTheme: selectThemeMock,
  uninstallTheme: uninstallThemeMock,
};

// --- Mock stores ----------------------------------------------------------

vi.mock('@/stores/communityStore', () => ({
  useCommunityStore: (selector: (s: typeof communityState) => unknown) =>
    selector(communityState),
}));

vi.mock('@/stores/shellStore', () => ({
  useShellStore: (selector: (s: { locale: string }) => unknown) =>
    selector({ locale: 'en' }),
}));

// --- Mock lucide icons (SSR-safe: return string markers) ------------------

vi.mock('lucide-react', () => {
  const mk = (name: string) =>
    () => `<svg data-icon="${name}"></svg>`;
  return {
    Camera: mk('Camera'),
    Calendar: mk('Calendar'),
    Download: mk('Download'),
    FileArchive: mk('FileArchive'),
    Hash: mk('Hash'),
    Image: mk('Image'),
    Info: mk('Info'),
    Palette: mk('Palette'),
    Shield: mk('Shield'),
    Star: mk('Star'),
    X: mk('X'),
    Loader2: mk('Loader2'),
    Package: mk('Package'),
  };
});

// --- Mock cn utility ------------------------------------------------------

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// --- Mock Button (renders children + disabled marker for SSR assertion) --

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    disabled,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
  }) => `<button${disabled ? ' disabled' : ''}>${children}</button>`,
}));

// --- Mock EmptyState (renders title + hint for SSR assertion) ------------

vi.mock('@/components/ui/empty-state', () => ({
  EmptyState: ({
    title,
    hint,
  }: {
    title: string;
    hint?: string;
  }) => `<div data-empty="true"><span data-title>${title}</span>${hint ? `<span data-hint>${hint}</span>` : ''}</div>`,
}));

// --- Mock DownloadProgress (renders phase + percent for SSR assertion) ---

vi.mock('./DownloadProgress', () => ({
  DownloadProgress: ({
    progress,
    phase,
  }: {
    progress: number;
    phase?: string;
  }) => `<div data-progress="${progress}" data-phase="${phase ?? 'downloading'}"></div>`,
}));

// --- Import component AFTER mocks are registered ------------------------

import { SourceDetailPanel } from './SourceDetailPanel';

// --- Test helpers ---------------------------------------------------------

function makeTheme(overrides: Partial<CommunityThemeDetail> = {}): CommunityThemeDetail {
  return {
    themeId: 'theme-001',
    name: 'Aurora',
    slug: 'aurora',
    author: { id: 'author-1', displayName: 'Alice' },
    description: 'Aurora theme for testing',
    thumbUrl: 'https://example.com/thumb.jpg',
    tags: ['minimal', 'dark'],
    downloads: 12345,
    rating: 4.7,
    updatedAt: '2025-03-15T08:30:00.000Z',
    packageSize: 2048576,
    version: '2.1.0',
    screenshots: ['https://example.com/screenshot1.png'],
    targetAgents: ['traework'],
    license: 'MPL-2.0',
    displayMeta: {
      colors: {
        accent: '#7c3aed',
        background: '#1e1b4b',
      },
    },
    ...overrides,
  };
}

function renderPanel() {
  return renderToStaticMarkup(<SourceDetailPanel />);
}

// --- Tests ----------------------------------------------------------------

describe('SourceDetailPanel — rendering & interaction', () => {
  beforeEach(() => {
    installThemeMock.mockReset();
    cancelInstallMock.mockReset();
    selectThemeMock.mockReset();
    uninstallThemeMock.mockReset();

    // Reset to empty state
    communityState = {
      selectedThemeDetail: null,
      selectedThemeId: null,
      installingIds: new Set(),
      downloadProgress: new Map(),
      installedIds: new Set(),
      installTheme: installThemeMock,
      cancelInstall: cancelInstallMock,
      selectTheme: selectThemeMock,
      uninstallTheme: uninstallThemeMock,
    };
  });

  // 1. Empty state -------------------------------------------------------
  it('1. renders DetailEmptyState when no theme is selected', () => {
    const html = renderPanel();
    expect(html).toContain('data-empty=&quot;true&quot;');
    // "No theme selected" title (en locale from shellStore mock)
    expect(html).toContain('No theme selected');
    // Hint text
    expect(html).toContain('Select a theme from the list to view details');
  });

  // 2. Theme rendering ---------------------------------------------------
  it('2. renders theme name, author, rating, downloads, and tags', () => {
    const theme = makeTheme();
    communityState.selectedThemeDetail = theme;
    communityState.selectedThemeId = theme.themeId;

    const html = renderPanel();

    expect(html).toContain('Aurora');
    expect(html).toContain('Alice');
    expect(html).toContain('4.7');
    // formatNumber(12345, 'en') → "12,345"
    expect(html).toContain('12,345');
    // Tags
    expect(html).toContain('minimal');
    expect(html).toContain('dark');
  });

  // 3. Install button when idle ------------------------------------------
  it('3. shows "Install" button when theme is not installing and not installed', () => {
    const theme = makeTheme();
    communityState.selectedThemeDetail = theme;
    communityState.selectedThemeId = theme.themeId;

    const html = renderPanel();

    // Button should contain "Install" text (from themesMessages.en.install)
    expect(html).toContain('Install');
    // Button should NOT be disabled (since not installing)
    expect(html).not.toContain('DISABLED');
  });

  // 4. Installing state ---------------------------------------------------
  it('4. shows "Cancel" button and DownloadProgress when installing', () => {
    const theme = makeTheme();
    communityState.selectedThemeDetail = theme;
    communityState.selectedThemeId = theme.themeId;
    communityState.installingIds = new Set([theme.themeId]);

    const progress: DownloadProgress = {
      themeId: theme.themeId,
      progress: 65,
      bytesDownloaded: 1331000,
      totalBytes: 2048576,
      phase: 'downloading',
    };
    communityState.downloadProgress = new Map([[theme.themeId, progress]]);

    const html = renderPanel();

    // "Cancel" button text (from commonMessages.en.cancel)
    expect(html).toContain('Cancel');
    // DownloadProgress rendered (attribute values HTML-escaped by renderToStaticMarkup)
    expect(html).toContain('data-progress=&quot;65&quot;');
    expect(html).toContain('data-phase=&quot;downloading&quot;');
  });

  // 5. Cancel button when installing -------------------------------------
  it('5. footer shows "Cancel" (not "Install") when installingIds contains themeId', () => {
    const theme = makeTheme();
    communityState.selectedThemeDetail = theme;
    communityState.selectedThemeId = theme.themeId;
    communityState.installingIds = new Set([theme.themeId]);

    const html = renderPanel();

    expect(html).toContain('Cancel');
    // "Install" should NOT appear when installing
    expect(html).not.toContain('Install');
  });

  // 6. Empty description does not crash ----------------------------------
  it('6. does not crash when description is empty string', () => {
    const theme = makeTheme({ description: '' });
    communityState.selectedThemeDetail = theme;
    communityState.selectedThemeId = theme.themeId;

    // Should not throw
    expect(() => renderPanel()).not.toThrow();
    const html = renderPanel();
    // Theme name still renders
    expect(html).toContain('Aurora');
  });

  // 7. Date formatting ---------------------------------------------------
  it('7. formats ISO 8601 updatedAt to a locale date string', () => {
    const theme = makeTheme({ updatedAt: '2025-03-15T08:30:00.000Z' });
    communityState.selectedThemeDetail = theme;
    communityState.selectedThemeId = theme.themeId;

    const html = renderPanel();

    // formatDate(new Date('2025-03-15T08:30:00.000Z'), 'en') → "Mar 15, 2025"
    expect(html).toContain('Mar 15, 2025');
  });
});
