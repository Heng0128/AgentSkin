// SPDX-License-Identifier: MPL-2.0

/**
 * @vitest-environment happy-dom
 */

/**
 * # StudioTopBar — undo/redo + view switcher tests
 *
 * Verifies that StudioTopBar:
 *   1. Reflects undo/redo disabled state based on stack lengths.
 *   2. Switches preview view when view tabs are clicked.
 *   3. Toggles panels (dock/drawer/inspector) via workspace store.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Hoisted mocks --------------------------------------------------------

const {
  mockUndoStack,
  mockRedoStack,
  mockPreviewView,
  mockSetPreviewView,
  mockUndo,
  mockRedo,
  mockDock,
  mockDrawer,
  mockInspector,
  mockToggleDock,
  mockToggleDrawer,
  mockToggleInspector,
} = vi.hoisted(() => ({
  mockUndoStack: vi.fn(() => []),
  mockRedoStack: vi.fn(() => []),
  mockPreviewView: vi.fn(() => 'theme'),
  mockSetPreviewView: vi.fn(),
  mockUndo: vi.fn(),
  mockRedo: vi.fn(),
  mockDock: vi.fn(() => ({ open: true })),
  mockDrawer: vi.fn(() => ({ open: true })),
  mockInspector: vi.fn(() => ({ open: false })),
  mockToggleDock: vi.fn(),
  mockToggleDrawer: vi.fn(),
  mockToggleInspector: vi.fn(),
}));

vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: vi.fn((selector) => {
    const state = {
      dock: mockDock(),
      drawer: mockDrawer(),
      inspector: mockInspector(),
      toggleDock: mockToggleDock,
      toggleDrawer: mockToggleDrawer,
      toggleInspector: mockToggleInspector,
    };
    return selector ? selector(state) : state;
  }),
}));

vi.mock('@/stores/studioStore', () => ({
  useStudioStore: vi.fn((selector) => {
    const state = {
      getActiveProject: vi.fn(() => null),
      undoStack: mockUndoStack(),
      redoStack: mockRedoStack(),
      previewView: mockPreviewView(),
      undo: mockUndo,
      redo: mockRedo,
      setPreviewView: mockSetPreviewView,
    };
    return selector ? selector(state) : state;
  }),
}));

// --- Import component AFTER mocks are registered ------------------------

import { StudioTopBar } from './StudioTopBar';

// --- Minimal UiMessages mock ---------------------------------------------

const mockT = {
  studioBrand: 'AgentSkin',
  studioHeaderBeta: 'BETA',
  studioUndo: 'Undo',
  studioRedo: 'Redo',
  studioTabTheme: 'Theme',
  studioTabWallpaper: 'Wallpaper',
  studioTabBundle: 'Bundle',
  studioTabRaw: 'Raw',
  studioDockToggle: 'Dock',
  studioDockTabFx: 'FX',
  studioDrawerToggle: 'Drawer',
  studioInspectorToggle: 'Inspector',
  studioSwitchProject: 'Switch project',
} as Record<string, string>;

// --- Tests ----------------------------------------------------------------

describe('StudioTopBar', () => {
  beforeEach(() => {
    mockUndoStack.mockReturnValue([]);
    mockRedoStack.mockReturnValue([]);
    mockPreviewView.mockReturnValue('theme');
    mockDock.mockReturnValue({ open: true });
    mockDrawer.mockReturnValue({ open: true });
    mockInspector.mockReturnValue({ open: false });
    mockSetPreviewView.mockReset();
    mockUndo.mockReset();
    mockRedo.mockReset();
    mockToggleDock.mockReset();
    mockToggleDrawer.mockReset();
    mockToggleInspector.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  // ------------------------------------------------------------------
  // 1. Undo/redo disabled state
  // ------------------------------------------------------------------

  it('disables undo button when undoStack is empty', () => {
    mockUndoStack.mockReturnValue([]);
    render(<StudioTopBar t={mockT as never} />);
    const buttons = screen.getAllByRole('button');
    // Undo is the first button in the undo/redo group
    const undoBtn = buttons.find((b) => b.title === 'Undo') as HTMLButtonElement | undefined;
    expect(undoBtn).toBeTruthy();
    expect(undoBtn?.disabled).toBe(true);
  });

  it('disables redo button when redoStack is empty', () => {
    mockRedoStack.mockReturnValue([]);
    render(<StudioTopBar t={mockT as never} />);
    const buttons = screen.getAllByRole('button');
    const redoBtn = buttons.find((b) => b.title === 'Redo') as HTMLButtonElement | undefined;
    expect(redoBtn).toBeTruthy();
    expect(redoBtn?.disabled).toBe(true);
  });

  // ------------------------------------------------------------------
  // 2. View switching
  // ------------------------------------------------------------------

  it('renders all four view tabs', () => {
    render(<StudioTopBar t={mockT as never} />);
    expect(screen.getByText('Theme')).toBeTruthy();
    expect(screen.getByText('Wallpaper')).toBeTruthy();
    expect(screen.getByText('Bundle')).toBeTruthy();
    expect(screen.getByText('Raw')).toBeTruthy();
  });

  // ------------------------------------------------------------------
  // 3. Panel toggling
  // ------------------------------------------------------------------

  it('calls toggleDock when dock button is clicked', () => {
    render(<StudioTopBar t={mockT as never} />);
    const dockBtn = screen.getByTitle('Dock');
    fireEvent.click(dockBtn);
    expect(mockToggleDock).toHaveBeenCalledTimes(1);
  });

  it('calls toggleDrawer when drawer button is clicked', () => {
    render(<StudioTopBar t={mockT as never} />);
    const drawerBtn = screen.getByTitle('Drawer');
    fireEvent.click(drawerBtn);
    expect(mockToggleDrawer).toHaveBeenCalledTimes(1);
  });

  it('calls toggleInspector when inspector button is clicked', () => {
    render(<StudioTopBar t={mockT as never} />);
    const inspectorBtn = screen.getByTitle('Inspector');
    fireEvent.click(inspectorBtn);
    expect(mockToggleInspector).toHaveBeenCalledTimes(1);
  });
});
