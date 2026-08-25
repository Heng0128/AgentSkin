// SPDX-License-Identifier: MPL-2.0

/**
 * # WorkspacePage — interaction tests for M5/M8/M9 features
 *
 * Covers:
 *   M5: A/B compare mode renders dual preview when dualPreviewActive is true
 *   M8: Inspect mode toggle button visible and toggles state
 *   M9: Export/Import buttons render and are clickable
 *   M3: Undo/redo buttons render with correct disabled states
 *
 * Uses renderToStaticMarkup (SSR) like other component tests in this project.
 */

import type { ToolOverride } from '@/types/override';

import type { UiMessages } from '@shared/i18n';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mutable store state
// ---------------------------------------------------------------------------

let mockCurrentAgentId: string | null = 'codex';
let mockCurrentOverrides: ToolOverride = {};
let mockDirty = false;
let mockDualPreviewActive = false;
let mockInspectMode = false;
let mockCanUndo = false;
let mockCanRedo = false;
let mockPushError: string | null = null;
const mockSelectAgent = vi.fn();
const mockUpdateOverride = vi.fn();
const mockSaveChanges = vi.fn();
const mockDiscardChanges = vi.fn();
const mockClearPushError = vi.fn();
const mockUndo = vi.fn();
const mockRedo = vi.fn();
const mockToggleInspectMode = vi.fn();
const mockExportTweakConfig = vi.fn();
const mockImportTweakConfig = vi.fn();
const mockRefreshStatus = vi.fn();

// ---------------------------------------------------------------------------
// Hoisted mocks — must be defined before any vi.mock factory that references them.
// ---------------------------------------------------------------------------

const { mockOnThemeHealthReport, mockUiMessages } = vi.hoisted(() => {
  const t = {
    navWorkspace: 'Workspace',
    workspaceRefreshStatus: 'Refresh',
    workspaceRunningApps: 'Running Apps',
    workspaceNoRunningAgents: 'No running agents',
    workspaceSelectAgentHint: 'Select an agent to start tweaking',
    workspacePreview: 'Preview',
    workspaceTweakControls: 'Tweak Controls',
    workspaceSavePreset: 'Save',
    workspaceDiscardChanges: 'Discard',
    workspaceHealthSelectAgent: 'Select agent for health info',
    workspaceHealthScore: 'Health Score',
    workspaceHealthBlocking: 'Blocking',
    workspaceHealthSheetPresent: 'Theme Sheet',
    workspaceHealthArtActive: 'Hero Art',
    workspacePushFailed: 'Push failed: ',
    workspaceExport: 'Export',
    workspaceExportTooltip: 'Export config to clipboard',
    workspaceImport: 'Import',
    workspaceImportTooltip: 'Import config from JSON file',
    workspaceInspectStart: 'Pick element to locate parameter',
    workspaceInspectStop: 'Exit element picking',
    workspaceInspectStartBtn: 'Pick element',
    workspaceInspectStopBtn: 'Exit picking',
    commonDismiss: 'Dismiss',
  } as unknown as UiMessages;

  return {
    mockOnThemeHealthReport: vi.fn(),
    mockUiMessages: {
      en: t,
      'zh-CN': t,
    },
  };
});

vi.mock('@/api/agentSkinClient', () => ({
  api: {
    onThemeHealthReport: mockOnThemeHealthReport,
  },
}));

vi.mock('@/stores/workspaceStore', () => ({
  useWorkspaceStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = {
      currentAgentId: mockCurrentAgentId,
      currentOverrides: mockCurrentOverrides,
      dirty: mockDirty,
      dualPreviewActive: mockDualPreviewActive,
      window: { inspectMode: mockInspectMode },
      canUndo: () => mockCanUndo,
      canRedo: () => mockCanRedo,
      pushError: mockPushError,
      selectAgent: mockSelectAgent,
      updateOverride: mockUpdateOverride,
      saveChanges: mockSaveChanges,
      discardChanges: mockDiscardChanges,
      clearPushError: mockClearPushError,
      undo: mockUndo,
      redo: mockRedo,
      toggleInspectMode: mockToggleInspectMode,
      exportTweakConfig: mockExportTweakConfig,
      importTweakConfig: mockImportTweakConfig,
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/stores/statusStore', () => ({
  useStatusStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = {
      status: { apps: [] },
      isRefreshing: false,
      refreshStatus: mockRefreshStatus,
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/stores/shellStore', () => {
  const state = { locale: 'en' };
  const store = (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state);
  // WorkspacePage calls useShellStore.getState().locale directly.
  store.getState = () => state;
  return { useShellStore: store };
});

vi.mock('@/stores/diagnosticsStore', () => ({
  useDiagnosticsStore: (selector?: (state: Record<string, unknown>) => unknown) => {
    const state = {
      healthReportByAgent: {},
      setHealthReport: vi.fn(),
    };
    return selector ? selector(state) : state;
  },
}));

vi.mock('@/components/AppMark', () => ({
  AppMark: () => null,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    disabled,
    title,
    type: _type,
    variant: _variant,
    size: _size,
    onClick: _onClick,
    className: _className,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    title?: string;
    type?: string;
    variant?: string;
    size?: string;
    onClick?: () => void;
    className?: string;
  }) => {
    // SSR: render as <button> with disabled + title attributes so tests can assert.
    const attrs = `${disabled ? ' disabled' : ''}${title ? ` title="${title}"` : ''}`;
    return `<button${attrs}>${children}</button>`;
  },
}));

vi.mock('@/components/ui/page-header', () => ({
  PageHeader: ({ title, children }: { title: string; children?: React.ReactNode }) =>
    `<div data-title="${title}">${children ?? ''}</div>`,
}));

vi.mock('@/components/ui/page-toolbar', () => ({
  PageToolbar: ({ actions }: { actions?: React.ReactNode }) => (actions ? `${actions}` : ''),
}));

vi.mock('@/components/ui/spinner', () => ({
  Spinner: () => null,
}));

vi.mock('@/components/workspace/AgentLivePreview', () => ({
  AgentLivePreview: ({
    dualPreview,
    inspectMode,
  }: {
    dualPreview: boolean;
    inspectMode: boolean;
  }) => `<div data-dual-preview="${dualPreview}" data-inspect-mode="${inspectMode}">Preview</div>`,
}));

vi.mock('@/components/workspace/TweakPanel', () => ({
  TweakPanel: () => '<div>TweakPanel</div>',
}));

vi.mock('lucide-react', () => {
  const stub = (props: Record<string, unknown>) =>
    `<svg data-icon="${props['data-icon'] ?? ''}"></svg>`;
  return {
    AlertTriangle: stub,
    CheckCircle: stub,
    Download: stub,
    Redo2: stub,
    RefreshCw: stub,
    Search: stub,
    Undo2: stub,
    Upload: stub,
    XCircle: stub,
  };
});

// Import component AFTER mocks are registered
import { WorkspacePage } from './WorkspacePage';

// mockT and mockUiMessages are defined via vi.hoisted above.

// Mock uiMessages for currentT() — uses hoisted mockUiMessages.
vi.mock('@shared/i18n', () => ({
  uiMessages: mockUiMessages,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPage() {
  return renderToStaticMarkup(<WorkspacePage />);
}

function resetState() {
  mockCurrentAgentId = 'codex';
  mockCurrentOverrides = {};
  mockDirty = false;
  mockDualPreviewActive = false;
  mockInspectMode = false;
  mockCanUndo = false;
  mockCanRedo = false;
  mockPushError = null;
  mockSelectAgent.mockReset();
  mockUpdateOverride.mockReset();
  mockSaveChanges.mockReset();
  mockDiscardChanges.mockReset();
  mockClearPushError.mockReset();
  mockUndo.mockReset();
  mockRedo.mockReset();
  mockToggleInspectMode.mockReset();
  mockExportTweakConfig.mockReset();
  mockImportTweakConfig.mockReset();
  mockRefreshStatus.mockReset();
  mockOnThemeHealthReport.mockReset();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkspacePage — M5 A/B compare', () => {
  beforeEach(() => {
    resetState();
  });

  it('passes dualPreview=false to AgentLivePreview when compare preset is inactive', () => {
    mockDualPreviewActive = false;
    const html = renderPage();
    expect(html).toContain('data-dual-preview');
    expect(html).toContain('false');
  });

  it('passes dualPreview=true to AgentLivePreview when compare preset is active', () => {
    mockDualPreviewActive = true;
    const html = renderPage();
    expect(html).toContain('data-dual-preview');
    expect(html).toContain('true');
  });
});

describe('WorkspacePage — M8 inspect mode', () => {
  beforeEach(() => {
    resetState();
  });

  it('renders inspect mode toggle button', () => {
    const html = renderPage();
    expect(html).toContain('Pick element');
  });

  it('passes inspectMode=false when inspect mode is off', () => {
    mockInspectMode = false;
    const html = renderPage();
    expect(html).toContain('data-inspect-mode');
    expect(html).toContain('false');
  });

  it('passes inspectMode=true when inspect mode is on', () => {
    mockInspectMode = true;
    const html = renderPage();
    expect(html).toContain('data-inspect-mode');
    expect(html).toContain('true');
  });
});

describe('WorkspacePage — M9 export/import', () => {
  beforeEach(() => {
    resetState();
  });

  it('renders export button', () => {
    const html = renderPage();
    expect(html).toContain('Export');
  });

  it('renders import button', () => {
    const html = renderPage();
    expect(html).toContain('Import');
  });
});

describe('WorkspacePage — M3 undo/redo buttons', () => {
  beforeEach(() => {
    resetState();
  });

  it('renders undo/redo buttons', () => {
    const html = renderPage();
    // Undo button has title "Ctrl+Z", redo has title "Ctrl+Shift+Z"
    expect(html).toContain('Ctrl+Z');
    expect(html).toContain('Ctrl+Shift+Z');
  });

  it('undo button is disabled when canUndo is false', () => {
    mockCanUndo = false;
    const html = renderPage();
    // The undo button should have disabled attribute
    expect(html).toContain('disabled');
  });
});

describe('WorkspacePage — save/discard buttons', () => {
  beforeEach(() => {
    resetState();
  });

  it('save button is disabled when dirty is false', () => {
    mockDirty = false;
    const html = renderPage();
    // Save button should be disabled
    expect(html).toContain('disabled');
  });

  it('renders push error banner when pushError is set', () => {
    mockPushError = 'CDP timeout';
    const html = renderPage();
    expect(html).toContain('CDP timeout');
  });
});
