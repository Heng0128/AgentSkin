// SPDX-License-Identifier: MPL-2.0

/**
 * # SettingsDashboard — unit tests
 *
 * Verifies the dashboard-first UX for the Settings page:
 * - Renders all 6 adapters' status cards
 * - Displays correct status badges (online / offline / retry-needed)
 * - Shows current theme per agent
 * - Displays relative-time "last applied" labels
 * - Summary bar shows correct online/offline/retry counts
 *
 * Uses renderToStaticMarkup (SSR) like other component tests in this project.
 */

import type { UiMessages } from '@shared/i18n';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mutable store state
// ---------------------------------------------------------------------------

let mockStatus: {
  platform: 'win32';
  apps: Array<{
    appId: 'traework' | 'qoderwork' | 'workbuddy' | 'doubao' | 'codex' | 'zcode';
    displayName: string;
    installed: boolean;
    running: boolean;
    debugReady: boolean;
    port: number | null;
    activeThemeId: string | null;
  }>;
} | null = null;
let mockLastStatusAt: number | null = null;
let mockIsRefreshing = false;
const mockRefreshStatus = vi.fn();
let mockInstalledThemes: Array<{ id: string; displayName: string }> = [];

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockUiMessages } = vi.hoisted(() => {
  const t = {
    settingsDashboardTitle: 'Status Overview',
    settingsDashboardDesc: 'Overview of all adapter injection statuses',
    settingsDashboardOnline: 'Online',
    settingsDashboardOffline: 'Offline',
    settingsDashboardRetry: 'Retry needed',
    settingsDashboardCurrentTheme: 'Current theme',
    settingsDashboardNoTheme: 'No theme applied',
    settingsDashboardLastApplied: 'Last applied',
    settingsDashboardNeverApplied: 'Never applied',
    settingsDashboardJustNow: 'just now',
    settingsDashboardMinutesAgo: (n: number) => `${n} min ago`,
    settingsDashboardHoursAgo: (n: number) => `${n} hr ago`,
    settingsDashboardDaysAgo: (n: number) => `${n} day(s) ago`,
    settingsDashboardStatusReady: 'Ready',
    settingsDashboardStatusNotReady: 'Not ready',
    settingsDashboardStatusInstalled: 'Installed',
    settingsDashboardStatusNotInstalled: 'Not installed',
    settingsDashboardRefresh: 'Refresh',
  } as unknown as UiMessages;

  return {
    mockUiMessages: {
      en: t,
      'zh-CN': t,
    },
  };
});

vi.mock('@/stores/statusStore', () => ({
  useStatusStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = {
      status: mockStatus,
      lastStatusAt: mockLastStatusAt,
      isRefreshing: mockIsRefreshing,
      refreshStatus: mockRefreshStatus,
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/stores/themeStore', () => ({
  useThemeStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = {
      installed: mockInstalledThemes,
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@shared/i18n', () => ({
  uiMessages: mockUiMessages,
}));

vi.mock('lucide-react', () => {
  const stub = (props: Record<string, unknown>) =>
    `<svg data-icon="${props['data-icon'] ?? ''}"></svg>`;
  return {
    AlertTriangle: stub,
    CheckCircle2: stub,
    Clock: stub,
    Monitor: stub,
    Palette: stub,
    RefreshCw: stub,
  };
});

// Import component AFTER mocks are registered
import { SettingsDashboard } from './SettingsDashboard';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderDashboard() {
  // The component receives `t` directly from the parent — we pass the mock.
  const t = mockUiMessages.en;
  return renderToStaticMarkup(<SettingsDashboard t={t} />);
}

/** Full status with all 6 agents running and themes applied. */
function createFullStatus() {
  return {
    platform: 'win32' as const,
    apps: [
      {
        appId: 'traework' as const,
        displayName: 'TRAE Work CN',
        installed: true,
        running: true,
        debugReady: true,
        port: 9222,
        activeThemeId: 'theme-1',
      },
      {
        appId: 'qoderwork' as const,
        displayName: 'QoderWork CN',
        installed: true,
        running: true,
        debugReady: true,
        port: 9223,
        activeThemeId: 'theme-2',
      },
      {
        appId: 'workbuddy' as const,
        displayName: 'WorkBuddy',
        installed: true,
        running: false,
        debugReady: false,
        port: null,
        activeThemeId: null,
      },
      {
        appId: 'doubao' as const,
        displayName: '豆包',
        installed: true,
        running: true,
        debugReady: false,
        port: 9224,
        activeThemeId: 'theme-3',
      },
      {
        appId: 'codex' as const,
        displayName: 'ChatGPT Desktop',
        installed: false,
        running: false,
        debugReady: false,
        port: null,
        activeThemeId: null,
      },
      {
        appId: 'zcode' as const,
        displayName: 'ZCode',
        installed: true,
        running: false,
        debugReady: false,
        port: null,
        activeThemeId: null,
      },
    ],
  };
}

function resetState() {
  mockStatus = null;
  mockLastStatusAt = null;
  mockIsRefreshing = false;
  mockInstalledThemes = [];
  mockRefreshStatus.mockReset();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SettingsDashboard — rendering', () => {
  beforeEach(() => {
    resetState();
  });

  it('renders all 6 adapter cards when status is fully populated', () => {
    mockStatus = createFullStatus();
    mockInstalledThemes = [
      { id: 'theme-1', displayName: 'Dark Neon' },
      { id: 'theme-2', displayName: 'Ocean Blue' },
      { id: 'theme-3', displayName: 'Warm Sunset' },
    ];
    const html = renderDashboard();
    // Should contain all 6 agent display names
    expect(html).toContain('TRAE Work CN');
    expect(html).toContain('QoderWork CN');
    expect(html).toContain('WorkBuddy');
    expect(html).toContain('豆包');
    expect(html).toContain('ChatGPT Desktop');
    expect(html).toContain('ZCode');
  });

  it('renders empty summary (0/0) when status is null', () => {
    mockStatus = null;
    const html = renderDashboard();
    // No apps loaded yet → 0/0
    expect(html).toContain('0/0');
    // Should not render any agent cards
    expect(html).not.toContain('TRAE Work CN');
  });
});

describe('SettingsDashboard — status badges', () => {
  beforeEach(() => {
    resetState();
  });

  it('shows online status for running + debugReady agents', () => {
    mockStatus = createFullStatus();
    const html = renderDashboard();
    // traework and qoderwork are online (running + debugReady)
    expect(html).toContain('Online');
  });

  it('shows offline status for not-installed agents', () => {
    mockStatus = createFullStatus();
    const html = renderDashboard();
    // codex is not installed → offline
    expect(html).toContain('Offline');
  });

  it('shows retry-needed status for running but not debugReady agents', () => {
    mockStatus = createFullStatus();
    const html = renderDashboard();
    // doubao is running but not debugReady → retry needed
    expect(html).toContain('Retry needed');
  });
});

describe('SettingsDashboard — theme display', () => {
  beforeEach(() => {
    resetState();
  });

  it('shows active theme name for agents with a theme applied', () => {
    mockStatus = createFullStatus();
    mockInstalledThemes = [{ id: 'theme-1', displayName: 'Dark Neon' }];
    const html = renderDashboard();
    expect(html).toContain('Dark Neon');
  });

  it('shows "No theme applied" for agents without an active theme', () => {
    mockStatus = createFullStatus();
    const html = renderDashboard();
    // workbuddy has no activeThemeId
    expect(html).toContain('No theme applied');
  });
});

describe('SettingsDashboard — relative time', () => {
  beforeEach(() => {
    resetState();
  });

  it('shows "just now" for very recent timestamps', () => {
    mockStatus = createFullStatus();
    mockLastStatusAt = Date.now() - 30_000; // 30 seconds ago
    mockInstalledThemes = [{ id: 'theme-1', displayName: 'Dark Neon' }];
    const html = renderDashboard();
    expect(html).toContain('just now');
  });

  it('shows "X min ago" for timestamps within an hour', () => {
    mockStatus = createFullStatus();
    mockLastStatusAt = Date.now() - 5 * 60_000; // 5 minutes ago
    mockInstalledThemes = [{ id: 'theme-1', displayName: 'Dark Neon' }];
    const html = renderDashboard();
    expect(html).toContain('5 min ago');
  });

  it('shows "X hr ago" for timestamps within a day', () => {
    mockStatus = createFullStatus();
    mockLastStatusAt = Date.now() - 3 * 60 * 60_000; // 3 hours ago
    mockInstalledThemes = [{ id: 'theme-1', displayName: 'Dark Neon' }];
    const html = renderDashboard();
    expect(html).toContain('3 hr ago');
  });

  it('shows "Never applied" when lastStatusAt is null', () => {
    mockStatus = createFullStatus();
    mockLastStatusAt = null;
    mockInstalledThemes = [{ id: 'theme-1', displayName: 'Dark Neon' }];
    const html = renderDashboard();
    expect(html).toContain('Never applied');
  });
});

describe('SettingsDashboard — summary counts', () => {
  beforeEach(() => {
    resetState();
  });

  it('counts online adapters correctly', () => {
    mockStatus = createFullStatus();
    const html = renderDashboard();
    // traework + qoderwork = 2 online
    // The summary shows "2/6" at the end
    expect(html).toContain('2/6');
  });
});
