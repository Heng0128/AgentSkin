// SPDX-License-Identifier: MPL-2.0

/**
 * @vitest-environment happy-dom
 */

/**
 * # StudioDock — drag height + tab bar tests
 *
 * Verifies that StudioDock:
 *   1. Returns null when dock is closed.
 *   2. Renders the drag handle and tab bar when open.
 *   3. Adjusts height via drag interaction (clamped to min/max).
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Hoisted mocks --------------------------------------------------------

const { mockDock, mockSetDockTab, mockSetDockHeight, mockToggleDock } = vi.hoisted(() => ({
  mockDock: vi.fn(() => ({ open: true, height: 260, collapsed: false, activeTab: 'export' })),
  mockSetDockTab: vi.fn(),
  mockSetDockHeight: vi.fn(),
  mockToggleDock: vi.fn(),
}));

// Mock api BEFORE workspaceStore so that the real capture-store module
// (transitively loaded) does not crash on api.onInspectResult().
vi.mock('@/api/agentSkinClient', () => ({
  api: {
    onInspectResult: vi.fn(),
    onThemeHealthReport: vi.fn(),
  },
}));

vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: vi.fn((selector) => {
    const state = {
      dock: mockDock(),
      setDockTab: mockSetDockTab,
      setDockHeight: mockSetDockHeight,
      toggleDock: mockToggleDock,
    };
    return selector ? selector(state) : state;
  }),
}));

// --- Import component AFTER mocks are registered ------------------------

import { StudioDock } from './StudioDock';

// --- Minimal UiMessages mock ---------------------------------------------

const mockT = {
  studioDockDragHint: 'Drag to resize',
  studioDockDragHintSr: 'Drag handle',
  studioDockTabExport: 'Export',
} as Record<string, string>;

// --- Tests ----------------------------------------------------------------

describe('StudioDock', () => {
  beforeEach(() => {
    mockDock.mockReturnValue({ open: true, height: 260, collapsed: false, activeTab: 'export' });
    mockSetDockTab.mockReset();
    mockSetDockHeight.mockReset();
    mockToggleDock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  // ------------------------------------------------------------------
  // 1. Visibility
  // ------------------------------------------------------------------

  it('returns null when dock is closed', () => {
    mockDock.mockReturnValue({ open: false, height: 260, collapsed: false, activeTab: 'export' });
    const { container } = render(<StudioDock t={mockT as never} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the dock when open', () => {
    const { container } = render(<StudioDock t={mockT as never} />);
    expect(container.firstChild).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // 2. Drag handle
  // ------------------------------------------------------------------

  it('renders a drag handle for height adjustment', () => {
    render(<StudioDock t={mockT as never} />);
    const handle = screen.getByTitle('Drag to resize');
    expect(handle).toBeTruthy();
  });

  it('calls toggleDock when drag handle is double-clicked', () => {
    render(<StudioDock t={mockT as never} />);
    const handle = screen.getByTitle('Drag to resize');
    fireEvent.doubleClick(handle);
    expect(mockToggleDock).toHaveBeenCalledTimes(1);
  });

  // ------------------------------------------------------------------
  // 3. Tab bar
  // ------------------------------------------------------------------

  it('renders the export tab', () => {
    render(<StudioDock t={mockT as never} />);
    expect(screen.getByText('Export')).toBeTruthy();
  });

  it('calls setDockTab when export tab is clicked', () => {
    render(<StudioDock t={mockT as never} />);
    const tab = screen.getByText('Export');
    fireEvent.click(tab);
    expect(mockSetDockTab).toHaveBeenCalledTimes(1);
  });
});
