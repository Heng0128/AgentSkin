// SPDX-License-Identifier: MPL-2.0

/**
 * # studioStore Tests
 *
 * Tests for the Studio facade store and its decomposed sub-stores.
 * The facade (useStudioStore in src/ui/studio/) aggregates state from
 * project-store, bundle-store, capture-store, and image-wallpaper-store.
 *
 * These tests verify:
 * - Initial state across sub-stores
 * - Project switching and form field setters
 * - Capture store override/inspect logic
 * - Bundle store state management
 * - Facade getState/setState behavior
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must precede imports that use them at module level
// ---------------------------------------------------------------------------

vi.mock('@/api/agentSkinClient', () => ({
  api: {
    listStudioProjects: vi.fn(async () => []),
    createStudioProject: vi.fn(async () => ({})),
    saveStudioProject: vi.fn(async () => undefined),
    deleteStudioProject: vi.fn(async () => undefined),
    importStudioProject: vi.fn(async () => null),
    listBundles: vi.fn(async () => []),
    importBundle: vi.fn(async () => null),
    installBundleById: vi.fn(async () => ({ ok: true })),
    deleteBundle: vi.fn(async () => ({ ok: true })),
    snapshotBaseline: vi.fn(async () => ({})),
    restoreApp: vi.fn(async () => undefined),
    exportStudioTheme: vi.fn(async () => ({ packageDir: '/tmp/export' })),
    startInspect: vi.fn(async () => undefined),
    stopInspect: vi.fn(async () => undefined),
    saveStudioSnapshot: vi.fn(async () => undefined),
    onVisualAnalysisProgress: vi.fn(),
    onThemeHealthReport: vi.fn(),
  },
}));

vi.mock('@/stores/notificationStore', () => ({
  useNotificationStore: {
    getState: vi.fn(() => ({
      showToast: vi.fn(),
      fail: vi.fn(),
    })),
    setState: vi.fn(),
  },
}));

vi.mock('@/stores/shellStore', () => ({
  useShellStore: {
    getState: vi.fn(() => ({ locale: 'zh-CN' })),
    setState: vi.fn(),
  },
}));

vi.mock('@shared/i18n', () => ({
  uiMessages: {
    'zh-CN': {},
    'en-US': {},
  },
  type: {} as import('@shared/i18n').AppLocale,
}));

// ---------------------------------------------------------------------------
// Sub-store tests: project-store
// ---------------------------------------------------------------------------

import { useProjectStore } from '@/studio/project-store';
import type { AgentId, StudioProject } from '@shared/types';

function makeProject(id: string, name: string): StudioProject {
  return {
    id,
    name,
    author: 'Test Author',
    agentId: 'traework' as AgentId,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-02T00:00:00Z',
    installedThemeId: null,
    palette: undefined,
    overrides: undefined,
  };
}

describe('project-store initial state', () => {
  beforeEach(() => {
    useProjectStore.setState({
      projects: [],
      activeProjectId: null,
      creatingProject: false,
      projectForm: { name: '', author: '', agentId: 'traework' },
      importing: false,
      editing: null,
    });
  });

  it('has empty projects list and null activeProjectId', () => {
    const state = useProjectStore.getState();
    expect(state.projects).toEqual([]);
    expect(state.activeProjectId).toBeNull();
  });

  it('has creatingProject false and importing false', () => {
    const state = useProjectStore.getState();
    expect(state.creatingProject).toBe(false);
    expect(state.importing).toBe(false);
  });

  it('has default projectForm with traework agent', () => {
    const state = useProjectStore.getState();
    expect(state.projectForm.name).toBe('');
    expect(state.projectForm.author).toBe('');
    expect(state.projectForm.agentId).toBe('traework');
  });

  it('has null editing state', () => {
    const state = useProjectStore.getState();
    expect(state.editing).toBeNull();
  });

  it('getActiveProject returns null when no projects', () => {
    expect(useProjectStore.getState().getActiveProject()).toBeNull();
  });
});

describe('project-store project switching', () => {
  beforeEach(() => {
    const p1 = makeProject('proj-1', 'Project One');
    const p2 = makeProject('proj-2', 'Project Two');
    useProjectStore.setState({
      projects: [p1, p2],
      activeProjectId: 'proj-1',
      creatingProject: false,
      projectForm: { name: '', author: '', agentId: 'traework' },
      importing: false,
      editing: null,
    });
  });

  it('selectProject changes activeProjectId', () => {
    useProjectStore.getState().selectProject('proj-2');
    expect(useProjectStore.getState().activeProjectId).toBe('proj-2');
  });

  it('selectProject to null clears activeProjectId', () => {
    useProjectStore.getState().selectProject(null);
    expect(useProjectStore.getState().activeProjectId).toBeNull();
  });

  it('getActiveProject returns the correct project', () => {
    const project = useProjectStore.getState().getActiveProject();
    expect(project?.id).toBe('proj-1');
    expect(project?.name).toBe('Project One');
  });

  it('getActiveProject returns null after deselecting', () => {
    useProjectStore.getState().selectProject(null);
    expect(useProjectStore.getState().getActiveProject()).toBeNull();
  });

  it('selectProject is a no-op when id is unchanged', () => {
    const stateBefore = useProjectStore.getState();
    useProjectStore.getState().selectProject('proj-1');
    expect(useProjectStore.getState().activeProjectId).toBe(stateBefore.activeProjectId);
  });
});

describe('project-store form setters', () => {
  beforeEach(() => {
    useProjectStore.setState({
      projects: [],
      activeProjectId: null,
      creatingProject: false,
      projectForm: { name: '', author: '', agentId: 'traework' },
      importing: false,
      editing: null,
    });
  });

  it('setProjectName updates form name', () => {
    useProjectStore.getState().setProjectName('New Name');
    expect(useProjectStore.getState().projectForm.name).toBe('New Name');
  });

  it('setProjectAuthor updates form author', () => {
    useProjectStore.getState().setProjectAuthor('New Author');
    expect(useProjectStore.getState().projectForm.author).toBe('New Author');
  });

  it('setProjectAgent updates form agentId', () => {
    useProjectStore.getState().setProjectAgent('qoderwork');
    expect(useProjectStore.getState().projectForm.agentId).toBe('qoderwork');
  });

  it('setCreatingProject toggles the creating flag', () => {
    useProjectStore.getState().setCreatingProject(true);
    expect(useProjectStore.getState().creatingProject).toBe(true);
    useProjectStore.getState().setCreatingProject(false);
    expect(useProjectStore.getState().creatingProject).toBe(false);
  });
});

describe('project-store editing state', () => {
  beforeEach(() => {
    const p1 = makeProject('proj-1', 'Project One');
    useProjectStore.setState({
      projects: [p1],
      activeProjectId: 'proj-1',
      creatingProject: false,
      projectForm: { name: '', author: '', agentId: 'traework' },
      importing: false,
      editing: null,
    });
  });

  it('startEditing populates editing state from project', () => {
    useProjectStore.getState().startEditing('proj-1');
    const editing = useProjectStore.getState().editing;
    expect(editing).not.toBeNull();
    expect(editing?.id).toBe('proj-1');
    expect(editing?.name).toBe('Project One');
    expect(editing?.author).toBe('Test Author');
  });

  it('startEditing does nothing for unknown id', () => {
    useProjectStore.getState().startEditing('nonexistent');
    expect(useProjectStore.getState().editing).toBeNull();
  });

  it('cancelEditing clears editing state', () => {
    useProjectStore.getState().startEditing('proj-1');
    useProjectStore.getState().cancelEditing();
    expect(useProjectStore.getState().editing).toBeNull();
  });

  it('updateEditingField updates name', () => {
    useProjectStore.getState().startEditing('proj-1');
    useProjectStore.getState().updateEditingField('name', 'Updated Name');
    expect(useProjectStore.getState().editing?.name).toBe('Updated Name');
  });

  it('updateEditingField updates author', () => {
    useProjectStore.getState().startEditing('proj-1');
    useProjectStore.getState().updateEditingField('author', 'Updated Author');
    expect(useProjectStore.getState().editing?.author).toBe('Updated Author');
  });
});

// ---------------------------------------------------------------------------
// Sub-store tests: capture-store
// ---------------------------------------------------------------------------

import { useCaptureStore } from '@/studio/capture-store';

describe('capture-store initial state', () => {
  beforeEach(() => {
    useCaptureStore.setState({
      previewView: 'theme',
      inspectingIdx: null,
      searchQuery: '',
      hoveredIdx: null,
      toolOverrides: null,
      undoStack: [],
      redoStack: [],
      inspectMode: false,
      liveNode: null,
      liveError: null,
      pinnedSelectors: [],
      pseudoStates: [],
      captureSchemes: false,
      customSelectorInput: '',
      pseudoView: null,
      schemeView: null,
      baselines: {},
      baselineLoadingMap: {},
      baselineErrorMap: {},
      exportName: '',
      exportAuthor: '',
      exportState: { loading: false, dir: null, error: null },
      domTreeVersion: 0,
    });
  });

  it('has default initial state', () => {
    const state = useCaptureStore.getState();
    expect(state.previewView).toBe('theme');
    expect(state.inspectingIdx).toBeNull();
    expect(state.searchQuery).toBe('');
    expect(state.toolOverrides).toBeNull();
    expect(state.undoStack).toEqual([]);
    expect(state.redoStack).toEqual([]);
    expect(state.inspectMode).toBe(false);
    expect(state.liveNode).toBeNull();
      expect(state.liveError).toBeNull();
  });
});

describe('capture-store override actions', () => {
  beforeEach(() => {
    useCaptureStore.setState({
      previewView: 'theme',
      inspectingIdx: null,
      searchQuery: '',
      hoveredIdx: null,
      toolOverrides: null,
      undoStack: [],
      redoStack: [],
      inspectMode: false,
      liveNode: null,
      liveError: null,
      pinnedSelectors: [],
      pseudoStates: [],
      captureSchemes: false,
      customSelectorInput: '',
      pseudoView: null,
      schemeView: null,
      baselines: {},
      baselineLoadingMap: {},
      baselineErrorMap: {},
      exportName: '',
      exportAuthor: '',
      exportState: { loading: false, dir: null, error: null },
      domTreeVersion: 0,
    });
  });

  it('setOverride adds a tool override', () => {
    useCaptureStore.getState().setOverride('accent', '#ff0000');
    const state = useCaptureStore.getState();
    expect(state.toolOverrides).not.toBeNull();
    expect(state.toolOverrides?.accent).toBe('#ff0000');
  });

  it('setOverride pushes previous state to undo stack', () => {
    useCaptureStore.getState().setOverride('accent', '#ff0000');
    useCaptureStore.getState().setOverride('background', '#ffffff');
    // The undo stack should have the previous state (accent only)
    const state = useCaptureStore.getState();
    expect(state.undoStack.length).toBeGreaterThanOrEqual(1);
  });

  it('setOverride with undefined value removes the key', () => {
    useCaptureStore.getState().setOverride('accent', '#ff0000');
    useCaptureStore.getState().setOverride('accent', undefined);
    const state = useCaptureStore.getState();
    // After removing the only key, toolOverrides should be null
    expect(state.toolOverrides).toBeNull();
  });

  it('resetOverrides clears toolOverrides and pushes to undo', () => {
    useCaptureStore.getState().setOverride('accent', '#ff0000');
    useCaptureStore.getState().resetOverrides();
    const state = useCaptureStore.getState();
    expect(state.toolOverrides).toBeNull();
    expect(state.undoStack.length).toBeGreaterThanOrEqual(1);
  });

  it('undo reverts to previous override state', () => {
    useCaptureStore.getState().setOverride('accent', '#ff0000');
    useCaptureStore.getState().setOverride('background', '#ffffff');
    // Undo should revert to accent-only state
    useCaptureStore.getState().undo();
    const state = useCaptureStore.getState();
    expect(state.toolOverrides?.accent).toBe('#ff0000');
    expect(state.toolOverrides?.background).toBeUndefined();
  });

  it('redo re-applies undone state', () => {
    useCaptureStore.getState().setOverride('accent', '#ff0000');
    useCaptureStore.getState().setOverride('background', '#ffffff');
    useCaptureStore.getState().undo();
    useCaptureStore.getState().redo();
    const state = useCaptureStore.getState();
    expect(state.toolOverrides?.background).toBe('#ffffff');
  });

  it('undo on empty stack is a no-op', () => {
    const stateBefore = useCaptureStore.getState();
    useCaptureStore.getState().undo();
    const stateAfter = useCaptureStore.getState();
    expect(stateAfter.toolOverrides).toEqual(stateBefore.toolOverrides);
  });

  it('redo on empty stack is a no-op', () => {
    const stateBefore = useCaptureStore.getState();
    useCaptureStore.getState().redo();
    const stateAfter = useCaptureStore.getState();
    expect(stateAfter.toolOverrides).toEqual(stateBefore.toolOverrides);
  });
});

describe('capture-store simple setters', () => {
  beforeEach(() => {
    useCaptureStore.setState({
      previewView: 'theme',
      inspectingIdx: null,
      searchQuery: '',
      hoveredIdx: null,
      toolOverrides: null,
      undoStack: [],
      redoStack: [],
      inspectMode: false,
      liveNode: null,
      liveError: null,
      pinnedSelectors: [],
      pseudoStates: [],
      captureSchemes: false,
      customSelectorInput: '',
      pseudoView: null,
      schemeView: null,
      baselines: {},
      baselineLoadingMap: {},
      baselineErrorMap: {},
      exportName: '',
      exportAuthor: '',
      exportState: { loading: false, dir: null, error: null },
      domTreeVersion: 0,
    });
  });

  it('setSearchQuery updates search query', () => {
    useCaptureStore.getState().setSearchQuery('test query');
    expect(useCaptureStore.getState().searchQuery).toBe('test query');
  });

  it('setHoveredIdx updates hovered index', () => {
    useCaptureStore.getState().setHoveredIdx(5);
    expect(useCaptureStore.getState().hoveredIdx).toBe(5);
  });

  it('setInspectingIdx updates inspecting index', () => {
    useCaptureStore.getState().setInspectingIdx(3);
    expect(useCaptureStore.getState().inspectingIdx).toBe(3);
  });

  it('setSchemeView updates scheme view', () => {
    useCaptureStore.getState().setSchemeView('dark');
    expect(useCaptureStore.getState().schemeView).toBe('dark');
  });

  it('setCaptureSchemes updates capture schemes flag', () => {
    useCaptureStore.getState().setCaptureSchemes(true);
    expect(useCaptureStore.getState().captureSchemes).toBe(true);
  });

  it('setExportName and setExportAuthor update export metadata', () => {
    useCaptureStore.getState().setExportName('My Theme');
    useCaptureStore.getState().setExportAuthor('Author Name');
    const state = useCaptureStore.getState();
    expect(state.exportName).toBe('My Theme');
    expect(state.exportAuthor).toBe('Author Name');
  });
});

describe('capture-store pinned selectors and pseudo states', () => {
  beforeEach(() => {
    useCaptureStore.setState({
      previewView: 'theme',
      inspectingIdx: null,
      searchQuery: '',
      hoveredIdx: null,
      toolOverrides: null,
      undoStack: [],
      redoStack: [],
      inspectMode: false,
      liveNode: null,
      liveError: null,
      pinnedSelectors: [],
      pseudoStates: [],
      captureSchemes: false,
      customSelectorInput: '',
      pseudoView: null,
      schemeView: null,
      baselines: {},
      baselineLoadingMap: {},
      baselineErrorMap: {},
      exportName: '',
      exportAuthor: '',
      exportState: { loading: false, dir: null, error: null },
      domTreeVersion: 0,
    });
  });

  it('addPinnedSelector adds a selector from customSelectorInput', () => {
    useCaptureStore.getState().setCustomSelectorInput('.my-class');
    useCaptureStore.getState().addPinnedSelector();
    expect(useCaptureStore.getState().pinnedSelectors).toContain('.my-class');
    expect(useCaptureStore.getState().customSelectorInput).toBe('');
  });

  it('addPinnedSelector ignores empty input', () => {
    useCaptureStore.getState().setCustomSelectorInput('');
    useCaptureStore.getState().addPinnedSelector();
    expect(useCaptureStore.getState().pinnedSelectors).toEqual([]);
  });

  it('addPinnedSelector does not duplicate existing selectors', () => {
    useCaptureStore.getState().setCustomSelectorInput('.my-class');
    useCaptureStore.getState().addPinnedSelector();
    useCaptureStore.getState().setCustomSelectorInput('.my-class');
    useCaptureStore.getState().addPinnedSelector();
    expect(useCaptureStore.getState().pinnedSelectors).toHaveLength(1);
  });

  it('removePinnedSelector removes a selector', () => {
    useCaptureStore.getState().setCustomSelectorInput('.my-class');
    useCaptureStore.getState().addPinnedSelector();
    useCaptureStore.getState().removePinnedSelector('.my-class');
    expect(useCaptureStore.getState().pinnedSelectors).not.toContain('.my-class');
  });

  it('togglePseudo adds and removes pseudo states', () => {
    useCaptureStore.getState().togglePseudo('hover');
    expect(useCaptureStore.getState().pseudoStates).toContain('hover');
    useCaptureStore.getState().togglePseudo('hover');
    expect(useCaptureStore.getState().pseudoStates).not.toContain('hover');
  });
});

// ---------------------------------------------------------------------------
// Sub-store tests: bundle-store
// ---------------------------------------------------------------------------

import { useBundleStore } from '@/studio/bundle-store';

describe('bundle-store initial state', () => {
  beforeEach(() => {
    useBundleStore.setState({
      bundles: [],
      bundlesLoading: false,
    });
  });

  it('has empty bundles list', () => {
    expect(useBundleStore.getState().bundles).toEqual([]);
  });

  it('has bundlesLoading false', () => {
    expect(useBundleStore.getState().bundlesLoading).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Facade tests: useStudioStore
// ---------------------------------------------------------------------------

import { useStudioStore } from '@/studio/useStudioStore';

describe('studioStore facade', () => {
  beforeEach(() => {
    // Reset all sub-stores
    useProjectStore.setState({
      projects: [],
      activeProjectId: null,
      creatingProject: false,
      projectForm: { name: '', author: '', agentId: 'traework' },
      importing: false,
      editing: null,
    });
    useBundleStore.setState({ bundles: [], bundlesLoading: false });
    useCaptureStore.setState({
      previewView: 'theme',
      inspectingIdx: null,
      searchQuery: '',
      hoveredIdx: null,
      toolOverrides: null,
      undoStack: [],
      redoStack: [],
      inspectMode: false,
      liveNode: null,
      liveError: null,
      pinnedSelectors: [],
      pseudoStates: [],
      captureSchemes: false,
      customSelectorInput: '',
      pseudoView: null,
      schemeView: null,
      baselines: {},
      baselineLoadingMap: {},
      baselineErrorMap: {},
      exportName: '',
      exportAuthor: '',
      exportState: { loading: false, dir: null, error: null },
      domTreeVersion: 0,
    });
  });

  it('getState returns combined state from all sub-stores', () => {
    const state = useStudioStore.getState();
    expect(state).toHaveProperty('projects');
    expect(state).toHaveProperty('activeProjectId');
    expect(state).toHaveProperty('bundles');
    expect(state).toHaveProperty('bundlesLoading');
    expect(state).toHaveProperty('previewView');
    expect(state).toHaveProperty('toolOverrides');
    expect(state).toHaveProperty('undoStack');
    expect(state).toHaveProperty('redoStack');
  });

  it('getState includes action methods', () => {
    const state = useStudioStore.getState();
    expect(typeof state.setCreatingProject).toBe('function');
    expect(typeof state.setNewName).toBe('function');
    expect(typeof state.setNewAuthor).toBe('function');
    expect(typeof state.setNewAgent).toBe('function');
    expect(typeof state.selectProject).toBe('function');
    expect(typeof state.setSearchQuery).toBe('function');
    expect(typeof state.setPreviewView).toBe('function');
    expect(typeof state.setExportName).toBe('function');
    expect(typeof state.setExportAuthor).toBe('function');
  });

  it('setState propagates project fields to project-store', () => {
    useStudioStore.setState({
      projects: [makeProject('p1', 'Test')],
      activeProjectId: 'p1',
    });
    expect(useProjectStore.getState().projects).toHaveLength(1);
    expect(useProjectStore.getState().activeProjectId).toBe('p1');
  });

  it('setState propagates capture fields to capture-store', () => {
    useStudioStore.setState({
      searchQuery: 'hello',
      previewView: 'theme',
    });
    expect(useCaptureStore.getState().searchQuery).toBe('hello');
    expect(useCaptureStore.getState().previewView).toBe('theme');
  });

  it('setState propagates bundle fields to bundle-store', () => {
    useStudioStore.setState({
      bundlesLoading: true,
    });
    expect(useBundleStore.getState().bundlesLoading).toBe(true);
  });

  it('getActiveProject returns null when no active project', () => {
    expect(useStudioStore.getState().getActiveProject()).toBeNull();
  });

  it('getActiveProject returns the active project', () => {
    const project = makeProject('p1', 'Active');
    useProjectStore.setState({
      projects: [project],
      activeProjectId: 'p1',
    });
    expect(useStudioStore.getState().getActiveProject()?.name).toBe('Active');
  });
});
