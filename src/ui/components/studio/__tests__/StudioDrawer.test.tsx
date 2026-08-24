// SPDX-License-Identifier: MPL-2.0

/**
 * # StudioDrawer — profile summary card tests
 *
 * Covers the agent profile summary card rendered inside the project creation
 * form:
 *   1. Card is hidden when creatingProject is false
 *   2. Card renders token count, categories, brand colors, strategy when agent selected
 *   3. Card updates strategy text based on token thresholds
 *   4. Card is hidden for unknown agent ids (defensive)
 *
 * Uses renderToStaticMarkup (SSR) like StudioImageToThemePanel.test.tsx.
 */

import type { UiMessages } from '@shared/i18n';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockAppStatusFor } = vi.hoisted(() => ({
  mockAppStatusFor: vi.fn(),
}));

// Mutable store state
let mockDrawerOpen = true;
let mockCreatingProject = false;
let mockNewAgent: string | null = null;
let mockProjects: unknown[] = [];
let mockInstalledThemes: unknown[] = [];
let mockActiveProjectId: string | null = null;
let mockWallpapers: unknown[] = [];

const mockSetDrawerCollapsed = vi.fn();

vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = {
      drawer: { open: mockDrawerOpen },
      setDrawerCollapsed: mockSetDrawerCollapsed,
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/stores/studioStore', () => ({
  useStudioStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = {
      projects: mockProjects,
      activeProjectId: mockActiveProjectId,
      installedThemes: mockInstalledThemes,
      creatingProject: mockCreatingProject,
      createProject: vi.fn(),
      selectProject: vi.fn(),
      setCreatingProject: vi.fn(),
      newName: '',
      setNewName: vi.fn(),
      newAuthor: '',
      setNewAuthor: vi.fn(),
      newAgent: mockNewAgent,
      setNewAgent: vi.fn(),
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/stores/wallpaperStore', () => ({
  useWallpaperStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ wallpapers: mockWallpapers }),
}));

vi.mock('@/stores/agentStore', () => ({
  appStatusFor: mockAppStatusFor,
}));

vi.mock('lucide-react', () => {
  const stub = () => null;
  return {
    Image: stub,
    Layers: stub,
    LayoutGrid: stub,
    Lock: stub,
    Package: stub,
    Palette: stub,
    Shield: stub,
    ShieldCheck: stub,
  };
});

// Import component AFTER mocks are registered
import { StudioDrawer } from '../StudioDrawer';

// ---------------------------------------------------------------------------
// Minimal UiMessages mock (only keys used by the component)
// ---------------------------------------------------------------------------

const mockT = {
  expandSidebar: 'Expand',
  collapseSidebar: 'Collapse',
  studioProjectTitle: 'Project · PROJECT',
  studioProjectNew: 'New',
  studioProjectPlaceholder: 'Project name',
  studioProjectAuthorPlaceholder: 'Author (optional)',
  studioProjectCreate: 'Create',
  studioProfileSummary: 'Agent Profile',
  studioProfileTokens: 'Tokens',
  studioProfileCategories: 'Categories',
  studioProfileAccent: 'Accent',
  studioProfileStrategy: 'Strategy',
  studioProfileHighTokens: 'High token coverage — recommend Token Mapper',
  studioProfileMediumTokens: 'Medium coverage — combine with Override',
  studioProfileLowTokens: 'Low coverage — Override recommended',
  studioProfileSelectAbove: 'Select an agent to view details',
  cancel: 'Cancel',
  studioResourcesTitle: 'Resources',
  themeLibrary: 'Theme Library',
  studioLibraryEmpty: 'No installed themes',
  studioWallpaperAllTitle: 'Wallpapers',
  studioWallpaperEmpty: 'No wallpapers',
  studioTabBundle: 'Bundles',
  studioBundleImport: 'Import Bundle',
  agentsTitle: 'Agents',
  studioSecurityLabel: 'Security',
  studioSecurityContextIsolation: 'Context Isolation',
  studioSecuritySandbox: 'Sandbox',
  studioSecurityWebSecurity: 'WebSecurity',
  studioSecurityEnabled: 'ON',
  studioSecurityDisabled: 'OFF',
  studioSecurityStrict: 'strict',
  studioSecurityStandard: 'standard',
} as unknown as UiMessages;

function renderDrawer() {
  return renderToStaticMarkup(<StudioDrawer t={mockT} />);
}

function resetState() {
  mockDrawerOpen = true;
  mockCreatingProject = false;
  mockNewAgent = null;
  mockProjects = [];
  mockInstalledThemes = [];
  mockActiveProjectId = null;
  mockWallpapers = [];
  mockAppStatusFor.mockReset();
  // All agents appear installed so the selector renders
  mockAppStatusFor.mockReturnValue({ installed: true });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StudioDrawer — profile summary card', () => {
  beforeEach(() => {
    resetState();
  });

  // -----------------------------------------------------------------------
  // 1. Hidden when creatingProject is false
  // -----------------------------------------------------------------------
  it('does not render profile summary when not creating a project', () => {
    mockCreatingProject = false;
    mockNewAgent = 'traework';
    const html = renderDrawer();
    expect(html).not.toContain('Agent Profile');
  });

  // -----------------------------------------------------------------------
  // 2. Renders full profile for a high-token agent (workbuddy)
  // -----------------------------------------------------------------------
  it('renders token count, categories, brand colors, and strategy for workbuddy', () => {
    mockCreatingProject = true;
    mockNewAgent = 'workbuddy';
    const html = renderDrawer();

    // Title
    expect(html).toContain('Agent Profile');
    // Agent display name
    expect(html).toContain('WorkBuddy');

    // Token count — workbuddy has 3617 dark tokens (styleVars.dark)
    expect(html).toContain('3617');
    // Categories — workbuddy has 16 categories
    expect(html).toContain('16');
    // Strategy — high tokens (≥1000) → Token Mapper
    expect(html).toContain('High token coverage');
    // Brand color swatches (inline style with hex)
    expect(html).toContain('#0078d4');
  });

  // -----------------------------------------------------------------------
  // 3. Strategy updates based on token thresholds
  // -----------------------------------------------------------------------
  it('shows medium strategy for zcode (410 tokens)', () => {
    mockCreatingProject = true;
    mockNewAgent = 'zcode';
    const html = renderDrawer();
    expect(html).toContain('Medium coverage');
    expect(html).toContain('410');
    expect(html).toContain('#001d3d');
  });

  it('shows high strategy for codex (1255 tokens)', () => {
    mockCreatingProject = true;
    mockNewAgent = 'codex';
    const html = renderDrawer();
    expect(html).toContain('High token coverage');
    expect(html).toContain('1255');
    expect(html).toContain('#40c977');
  });

  it('shows medium strategy for qoderwork (141 tokens)', () => {
    mockCreatingProject = true;
    mockNewAgent = 'qoderwork';
    const html = renderDrawer();
    expect(html).toContain('Medium coverage');
    expect(html).toContain('141');
    expect(html).toContain('#8ee5a1');
  });

  // -----------------------------------------------------------------------
  // 4. Hidden when drawer is closed
  // -----------------------------------------------------------------------
  it('does not render anything when drawer is closed', () => {
    mockDrawerOpen = false;
    mockCreatingProject = true;
    mockNewAgent = 'traework';
    const html = renderDrawer();
    expect(html).not.toContain('Agent Profile');
    // Drawer closed shows only the rail
    expect(html).toContain('data-collapsed="true"');
  });
});
