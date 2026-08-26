// SPDX-License-Identifier: MPL-2.0

/**
 * # StudioInspector — component tests
 *
 * Covers the inspector panel rendering:
 *   1. Collapsed state → renders expand button
 *   2. Open state → renders tab bar with Profile / Element tabs
 *   3. Resolution preset buttons render
 *   4. Device frame toggle renders
 *
 * Uses renderToStaticMarkup (SSR) like StudioDrawer.test.tsx.
 */

import type { UiMessages } from '@shared/i18n';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

let mockInspector = { open: true, collapsed: false, width: 240, activeTab: 'profile' as const };
let mockActiveProject: { id: string; name: string; agentId: string } | null = null;

vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = {
      inspector: mockInspector,
      setInspectorTab: vi.fn(),
      setInspectorOpen: vi.fn(),
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/stores/studioStore', () => ({
  useStudioStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = {
      getActiveProject: () => mockActiveProject,
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/components/studio/InspectorProfile', () => ({
  InspectorProfile: () => null,
}));

vi.mock('@/components/studio/inspector-element', () => ({
  InspectorElement: () => null,
}));

vi.mock('@/components/AppMark', () => ({
  AppMark: () => null,
}));

vi.mock('lucide-react', () => {
  const stub = () => null;
  return { FlaskConical: stub };
});

// Import component AFTER mocks are registered
import { StudioInspector } from '../StudioInspector';

// ---------------------------------------------------------------------------
// Minimal UiMessages mock
// ---------------------------------------------------------------------------

const mockT = {
  studioExpandInspector: 'Expand Inspector',
  studioTabProfile: 'Profile',
  studioTabElement: 'Element',
} as unknown as UiMessages;

function renderInspector() {
  return renderToStaticMarkup(
    <StudioInspector
      t={mockT}
      iframeRef={{ current: null }}
      pickedPath={null}
      onClearPicked={() => {}}
      resolution="desktop"
      onResolutionChange={() => {}}
      showDeviceFrame={false}
      onToggleDeviceFrame={() => {}}
    />,
  );
}

function resetState() {
  mockInspector = { open: true, collapsed: false, width: 240, activeTab: 'profile' };
  mockActiveProject = null;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StudioInspector — rendering', () => {
  beforeEach(() => {
    resetState();
  });

  // -----------------------------------------------------------------------
  // 1. Collapsed state → expand button
  // -----------------------------------------------------------------------
  it('renders expand button when collapsed', () => {
    mockInspector = { open: true, collapsed: true, width: 240, activeTab: 'profile' };
    const html = renderInspector();
    expect(html).toContain('data-collapsed="true"');
    expect(html).toContain('Ins');
  });

  it('renders expand button when closed', () => {
    mockInspector = { open: false, collapsed: false, width: 240, activeTab: 'profile' };
    const html = renderInspector();
    expect(html).toContain('data-collapsed="true"');
  });

  // -----------------------------------------------------------------------
  // 2. Open state → tab bar
  // -----------------------------------------------------------------------
  it('renders tab bar with Profile and Element tabs when open', () => {
    const html = renderInspector();
    expect(html).toContain('data-collapsed="false"');
    expect(html).toContain('Profile');
    expect(html).toContain('Element');
  });

  // -----------------------------------------------------------------------
  // 3. Resolution preset buttons
  // -----------------------------------------------------------------------
  it('renders resolution preset buttons', () => {
    const html = renderInspector();
    expect(html).toContain('ws-inspector__resolution');
    expect(html).toContain('ws-inspector__res-btn');
  });

  // -----------------------------------------------------------------------
  // 4. Device frame toggle
  // -----------------------------------------------------------------------
  it('renders device frame toggle button', () => {
    const html = renderInspector();
    expect(html).toContain('ws-inspector__frame-toggle');
    expect(html).toContain('Toggle Frame');
  });
});
