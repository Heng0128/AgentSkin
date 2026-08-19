// SPDX-License-Identifier: MPL-2.0

/**
 * # CenterTabInspect — health-check rendering tests
 *
 * Verifies that the health-check section renders correctly:
 * - Score ring displays the numeric score.
 * - Blocking count > 0 applies the destructive border/bg warning style.
 * - Blocking count === 0 uses the neutral style.
 * - Opaque layers collapsible renders layer entries.
 * - Native tokens table renders token name + value.
 *
 * The 'ui' vitest project runs under `environment: 'node'`, so we assert
 * against `renderToStaticMarkup` output. zustand's SSR snapshot reads the
 * store *initial* state, so `setState` cannot drive server rendering here;
 * we mock `@/stores/studioStore` (same pattern as
 * `StudioImageToThemePanel.test.tsx`) and mutate module-level fixtures
 * before each render.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mock shellStore (locale source used by i18n) -----------------------

vi.mock('@/stores/shellStore', () => ({
  useShellStore: vi.fn(() => ({ locale: 'zh-CN' as const })),
}));

import { uiMessages } from '@shared/i18n';
import type { ThemeVisualSnapshot } from '@shared/types';
import type { HealthCheckReport } from '@shared/types/health-check';
import { CenterTabInspect } from './CenterTabInspect';

// --- Mutable store state (simulates useStudioStore.getState()) ----------
let mockSnapshot: ThemeVisualSnapshot | null = null;
let mockHealthReportByAgent: Record<string, HealthCheckReport> = {};
const mockActiveProject = {
  id: 'proj-001',
  name: 'Test Project',
  agentId: 'traework',
};

vi.mock('@/stores/studioStore', () => ({
  useStudioStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      snapshot: mockSnapshot,
      healthReportByAgent: mockHealthReportByAgent,
      getActiveProject: () => mockActiveProject,
    }),
}));

// --- Fixtures --------------------------------------------------------------

const mockSnapshotFixture: ThemeVisualSnapshot = {
  themeId: 'theme-001',
  themeName: 'Test Theme',
  agentId: 'traework',
  timestamp: '2025-01-01T00:00:00.000Z',
  landmarks: [
    {
      selector: '#main',
      tag: 'main',
      styles: [],
      matchedRules: [],
      platformFonts: [],
      boxModel: null,
      visible: true,
    },
  ],
  summary: {
    totalLandmarks: 1,
    visibleLandmarks: 1,
    selectorsTried: 1,
    boxModelAvailable: false,
    cascadeAvailable: false,
  },
  rootVars: { '--color-bg': '#1a1a1a' },
};

const mockHealthReportFixture: HealthCheckReport = {
  agentId: 'traework',
  timestamp: Date.now(),
  heroArtActive: true,
  themeSheetPresent: true,
  accentToken: '#ff453a',
  hostClassPresent: true,
  adapterPresent: true,
  nativeTokens: {
    '--vscode-foreground': '#cccccc',
    '--vscode-editor-background': '#1e1e1e',
  },
  opaqueLayers: [
    {
      depth: 2,
      tagName: 'DIV',
      id: 'sidebar',
      classes: 'sidebar-container',
      semanticAttr: '',
      backgroundColor: 'rgb(30, 30, 30)',
      backgroundImage: '',
      size: '1200x800',
      visible: true,
      backdropFilter: '',
    },
  ],
  blockingCount: 1,
  score: 72,
};

/** Reset store to a clean slate before each test. */
beforeEach(() => {
  mockSnapshot = null;
  mockHealthReportByAgent = {};
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Tests -------------------------------------------------------------------

describe('CenterTabInspect — health check rendering', () => {
  it('renders the score value inside the health-score card', () => {
    mockSnapshot = mockSnapshotFixture;
    mockHealthReportByAgent = { traework: mockHealthReportFixture };

    const html = renderToStaticMarkup(<CenterTabInspect t={uiMessages['zh-CN']} />);

    // Score "72" should appear in the SVG text element
    expect(html).toContain('72');
    // Health score label
    expect(html).toContain('健康评分');
  });

  it('applies destructive border when blockingCount > 0', () => {
    mockSnapshot = mockSnapshotFixture;
    mockHealthReportByAgent = { traework: { ...mockHealthReportFixture, blockingCount: 3 } };

    const html = renderToStaticMarkup(<CenterTabInspect t={uiMessages['zh-CN']} />);

    // The blocking card with count > 0 uses var(--destructive) border
    expect(html).toContain('border-[var(--destructive)]');
    expect(html).toContain('bg-[var(--redbg)]');
  });

  it('uses neutral style when blockingCount === 0', () => {
    mockSnapshot = mockSnapshotFixture;
    mockHealthReportByAgent = {
      traework: { ...mockHealthReportFixture, blockingCount: 0, score: 95 },
    };

    const html = renderToStaticMarkup(<CenterTabInspect t={uiMessages['zh-CN']} />);

    // Should NOT contain the destructive border style
    expect(html).not.toContain('border-[var(--destructive)]');
    // Score 95 should render
    expect(html).toContain('95');
  });

  it('renders opaque layers section with count (collapsed in SSR)', () => {
    mockSnapshot = mockSnapshotFixture;
    mockHealthReportByAgent = { traework: mockHealthReportFixture };

    const html = renderToStaticMarkup(<CenterTabInspect t={uiMessages['zh-CN']} />);

    // The opaque layers section header shows the count
    expect(html).toContain('不透明层');
    expect(html).toContain('(1)');
    // SSR renders static markup only: the collapsible defaults to collapsed,
    // so the toggle shows '▶' and the layer entries are not rendered.
    expect(html).toContain('▶');
    expect(html).not.toContain('DIV');
  });

  it('renders native tokens table with name + value', () => {
    mockSnapshot = mockSnapshotFixture;
    mockHealthReportByAgent = { traework: mockHealthReportFixture };

    const html = renderToStaticMarkup(<CenterTabInspect t={uiMessages['zh-CN']} />);

    // Native tokens section label
    expect(html).toContain('原生 Tokens');
    // Token name and value
    expect(html).toContain('--vscode-foreground');
    expect(html).toContain('#cccccc');
  });

  it('does not render health section when healthReport is null', () => {
    mockSnapshot = mockSnapshotFixture;
    mockHealthReportByAgent = {};

    const html = renderToStaticMarkup(<CenterTabInspect t={uiMessages['zh-CN']} />);

    // Health-specific labels should NOT appear
    expect(html).not.toContain('健康评分');
    expect(html).not.toContain('原生 Tokens');
    // But the snapshot-based sections should still render
    expect(html).toContain('Landmark 列表');
  });
});
