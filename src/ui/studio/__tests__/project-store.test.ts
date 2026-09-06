// SPDX-License-Identifier: MPL-2.0

/**
 * # project-store tests
 *
 * Verifies ProjectState actions: initial state, getActiveProject selection,
 * CRUD lifecycle (create / delete), editing mode toggling, and form mutation.
 *
 * External modules (@/api/agentSkinClient, @/stores/notificationStore,
 * @/stores/shellStore) are mocked via vi.hoisted + vi.mock so tests run
 * without Electron IPC.
 */

import type { AgentId, StudioProject } from '@shared/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockListStudioProjects,
  mockCreateStudioProject,
  mockDeleteStudioProject,
  mockSaveStudioProject,
  mockShowToast,
} = vi.hoisted(() => ({
  mockListStudioProjects: vi.fn(),
  mockCreateStudioProject: vi.fn(),
  mockDeleteStudioProject: vi.fn(),
  mockSaveStudioProject: vi.fn(),
  mockShowToast: vi.fn(),
}));

vi.mock('@/api/agentSkinClient', () => ({
  api: {
    listStudioProjects: mockListStudioProjects,
    createStudioProject: mockCreateStudioProject,
    deleteStudioProject: mockDeleteStudioProject,
    saveStudioProject: mockSaveStudioProject,
  },
}));

vi.mock('@/stores/notificationStore', () => ({
  useNotificationStore: {
    getState: vi.fn(() => ({
      showToast: mockShowToast,
    })),
  },
}));

vi.mock('@/stores/shellStore', () => ({
  useShellStore: {
    getState: vi.fn(() => ({
      locale: 'en' as const,
    })),
  },
}));

// Import AFTER all mocks are in place
import { useProjectStore } from '@/studio/project-store';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeProject = (id: string, name = 'Test Project'): StudioProject => ({
  schema: 'agentskin-studio-project/v1',
  id,
  name,
  author: 'tester',
  agentId: 'traework' as AgentId,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  hasSnapshot: false,
});

/** Reset store to clean slate before each test. */
const resetStore = () => {
  useProjectStore.setState({
    projects: [],
    activeProjectId: null,
    creatingProject: false,
    projectForm: { name: '', author: '', agentId: 'traework' },
    importing: false,
    editing: null,
  });
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useProjectStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ------------------------------------------------------------------
  // 1. Initial state
  // ------------------------------------------------------------------

  it('initializes with empty projects and null activeProjectId', () => {
    const state = useProjectStore.getState();
    expect(state.projects).toEqual([]);
    expect(state.activeProjectId).toBeNull();
    expect(state.creatingProject).toBe(false);
    expect(state.importing).toBe(false);
    expect(state.editing).toBeNull();
    expect(state.projectForm).toEqual({ name: '', author: '', agentId: 'traework' });
  });

  // ------------------------------------------------------------------
  // 2. getActiveProject — not found returns null
  // ------------------------------------------------------------------

  it('getActiveProject returns null when no project matches activeProjectId', () => {
    useProjectStore.setState({ projects: [makeProject('p1')] });
    expect(useProjectStore.getState().getActiveProject()).toBeNull();

    // Now select it and confirm it is found.
    useProjectStore.setState({ activeProjectId: 'p1' });
    expect(useProjectStore.getState().getActiveProject()?.id).toBe('p1');
  });

  // ------------------------------------------------------------------
  // 3. selectProject sets activeProjectId
  // ------------------------------------------------------------------

  it('selectProject updates activeProjectId', () => {
    useProjectStore.getState().selectProject('abc');
    expect(useProjectStore.getState().activeProjectId).toBe('abc');

    // null clears it.
    useProjectStore.getState().selectProject(null);
    expect(useProjectStore.getState().activeProjectId).toBeNull();
  });

  // ------------------------------------------------------------------
  // 4. createProject — adds to lists and resets form
  // ------------------------------------------------------------------

  it('createProject calls api and prepends the new project', async () => {
    const newProject = makeProject('new-1', 'My Project');
    mockCreateStudioProject.mockResolvedValueOnce(newProject);

    useProjectStore.setState({
      projectForm: { name: 'My Project', author: 'alice', agentId: 'qoderwork' },
    });

    await useProjectStore.getState().createProject();

    expect(mockCreateStudioProject).toHaveBeenCalledWith({
      name: 'My Project',
      author: 'alice',
      agentId: 'qoderwork',
    });

    const state = useProjectStore.getState();
    expect(state.projects).toHaveLength(1);
    expect(state.projects[0]!.id).toBe('new-1');
    expect(state.activeProjectId).toBe('new-1');
    expect(state.creatingProject).toBe(false);
    // Form is reset but agentId preserved.
    expect(state.projectForm).toEqual({ name: '', author: '', agentId: 'qoderwork' });
  });

  it('createProject uses fallback name when form name is blank', async () => {
    const newProject = makeProject('new-2', '未命名工程');
    mockCreateStudioProject.mockResolvedValueOnce(newProject);

    useProjectStore.setState({
      projectForm: { name: '   ', author: '', agentId: 'traework' },
    });

    await useProjectStore.getState().createProject();

    expect(mockCreateStudioProject).toHaveBeenCalledWith({
      name: '未命名工程',
      author: '',
      agentId: 'traework',
    });
  });

  // ------------------------------------------------------------------
  // 5. deleteProject — removes from list and adjusts active id
  // ------------------------------------------------------------------

  it('deleteProject removes the project via api', async () => {
    mockDeleteStudioProject.mockResolvedValueOnce(undefined);

    useProjectStore.setState({
      projects: [makeProject('p1'), makeProject('p2')],
      activeProjectId: 'p1',
    });

    await useProjectStore.getState().deleteProject('p1');

    expect(mockDeleteStudioProject).toHaveBeenCalledWith('p1');
    const state = useProjectStore.getState();
    expect(state.projects).toHaveLength(1);
    expect(state.projects[0]!.id).toBe('p2');
    // Active project shifted to next available.
    expect(state.activeProjectId).toBe('p2');
  });

  it('deleteProject clears activeProjectId when last project is removed', async () => {
    mockDeleteStudioProject.mockResolvedValueOnce(undefined);

    useProjectStore.setState({
      projects: [makeProject('only')],
      activeProjectId: 'only',
    });

    await useProjectStore.getState().deleteProject('only');

    const state = useProjectStore.getState();
    expect(state.projects).toHaveLength(0);
    expect(state.activeProjectId).toBeNull();
  });

  // ------------------------------------------------------------------
  // 6. startEditing / cancelEditing
  // ------------------------------------------------------------------

  it('startEditing populates the editing state from the project', () => {
    useProjectStore.setState({
      projects: [makeProject('p1', 'Alpha')],
    });

    useProjectStore.getState().startEditing('p1');
    expect(useProjectStore.getState().editing).toEqual({
      id: 'p1',
      name: 'Alpha',
      author: 'tester',
    });
  });

  it('startEditing is a no-op when id not found', () => {
    useProjectStore.setState({ projects: [makeProject('p1')] });
    useProjectStore.getState().startEditing('nonexistent');
    expect(useProjectStore.getState().editing).toBeNull();
  });

  it('cancelEditing clears the editing state', () => {
    useProjectStore.setState({ projects: [makeProject('p1')] });
    useProjectStore.getState().startEditing('p1');
    expect(useProjectStore.getState().editing).not.toBeNull();

    useProjectStore.getState().cancelEditing();
    expect(useProjectStore.getState().editing).toBeNull();
  });

  // ------------------------------------------------------------------
  // 7. updateEditingField
  // ------------------------------------------------------------------

  it('updateEditingField updates the specified field', () => {
    useProjectStore.setState({ projects: [makeProject('p1', 'Alpha')] });
    useProjectStore.getState().startEditing('p1');

    useProjectStore.getState().updateEditingField('name', 'Beta');
    expect(useProjectStore.getState().editing?.name).toBe('Beta');

    useProjectStore.getState().updateEditingField('author', 'charlie');
    expect(useProjectStore.getState().editing?.author).toBe('charlie');
  });

  it('updateEditingField is a no-op when editing is null', () => {
    // No editing active — should not throw.
    useProjectStore.setState({ editing: null });
    useProjectStore.getState().updateEditingField('name', 'whatever');
    expect(useProjectStore.getState().editing).toBeNull();
  });
});
