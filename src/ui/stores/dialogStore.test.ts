// SPDX-License-Identifier: MPL-2.0

/**
 * # dialogStore Tests
 *
 * Tests for the centralized dialog/prompt UI state:
 * - Initial state (all prompts null)
 * - Setter actions for each of the 5 dialog states
 * - State reset (null inputs)
 * - Boundary conditions
 */

import { describe, expect, it, beforeEach } from 'vitest';

import { useDialogStore } from './dialogStore';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeRestartPrompt() {
  return {
    themeId: 'theme-1',
    themeName: 'Test Theme',
    appId: 'traework' as const,
    schemeId: 'dark',
    restartReason: 'not-running' as const,
  };
}

function makeWallpaperRestartPrompt() {
  return {
    appId: 'traework' as const,
    wallpaperId: 'wallpaper-1',
    restartReason: 'not-installed' as const,
  };
}

function makeLaunchRestartPrompt() {
  return {
    appId: 'scanned-app-1',
    name: 'Scanned App',
    message: 'App needs restart to enable debug port.',
  };
}

function makeDeletePrompt() {
  return {
    id: 'theme-to-delete',
    name: 'Theme To Delete',
    version: '1.0.0',
    author: 'Author',
    description: 'A theme to delete',
    preview: null,
    supportedAgents: ['traework' as const],
    legacyTargets: [],
    category: 'dark',
    tags: [],
    source: 'file' as const,
    installed: true,
  };
}

function makeFileImportPrompt() {
  return {
    path: '/some/path/theme.json',
    incoming: { id: 'incoming', name: 'Incoming', version: '1.0.0', author: 'A', description: '', preview: null, supportedAgents: ['traework' as const], legacyTargets: [], category: 'dark', tags: [], source: 'file' as const, installed: true },
    existing: { id: 'existing', name: 'Existing', version: '1.0.0', author: 'B', description: '', preview: null, supportedAgents: ['traework' as const], legacyTargets: [], category: 'dark', tags: [], source: 'file' as const, installed: true },
  };
}

// ---------------------------------------------------------------------------
// Initial state tests
// ---------------------------------------------------------------------------

describe('dialogStore initial state', () => {
  beforeEach(() => {
    useDialogStore.setState({
      restartPrompt: null,
      wallpaperRestartPrompt: null,
      launchRestartPrompt: null,
      deletePrompt: null,
      fileImportPrompt: null,
    });
  });

  it('has all prompts null on initial state', () => {
    const state = useDialogStore.getState();
    expect(state.restartPrompt).toBeNull();
    expect(state.wallpaperRestartPrompt).toBeNull();
    expect(state.launchRestartPrompt).toBeNull();
    expect(state.deletePrompt).toBeNull();
    expect(state.fileImportPrompt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Setter tests
// ---------------------------------------------------------------------------

describe('dialogStore setRestartPrompt', () => {
  beforeEach(() => {
    useDialogStore.setState({ restartPrompt: null });
  });

  it('sets a RestartPrompt value', () => {
    const prompt = makeRestartPrompt();
    useDialogStore.getState().setRestartPrompt(prompt);
    expect(useDialogStore.getState().restartPrompt).toEqual(prompt);
  });

  it('resets to null', () => {
    useDialogStore.getState().setRestartPrompt(makeRestartPrompt());
    useDialogStore.getState().setRestartPrompt(null);
    expect(useDialogStore.getState().restartPrompt).toBeNull();
  });

  it('preserves all fields including optional schemeId and restartReason', () => {
    const prompt = makeRestartPrompt();
    useDialogStore.getState().setRestartPrompt(prompt);
    const stored = useDialogStore.getState().restartPrompt;
    expect(stored?.themeId).toBe('theme-1');
    expect(stored?.themeName).toBe('Test Theme');
    expect(stored?.appId).toBe('traework');
    expect(stored?.schemeId).toBe('dark');
    expect(stored?.restartReason).toBe('not-running');
  });
});

describe('dialogStore setWallpaperRestartPrompt', () => {
  beforeEach(() => {
    useDialogStore.setState({ wallpaperRestartPrompt: null });
  });

  it('sets a WallpaperRestartPrompt value', () => {
    const prompt = makeWallpaperRestartPrompt();
    useDialogStore.getState().setWallpaperRestartPrompt(prompt);
    expect(useDialogStore.getState().wallpaperRestartPrompt).toEqual(prompt);
  });

  it('resets to null', () => {
    useDialogStore.getState().setWallpaperRestartPrompt(makeWallpaperRestartPrompt());
    useDialogStore.getState().setWallpaperRestartPrompt(null);
    expect(useDialogStore.getState().wallpaperRestartPrompt).toBeNull();
  });

  it('preserves optional wallpaperId and restartReason', () => {
    const prompt = makeWallpaperRestartPrompt();
    useDialogStore.getState().setWallpaperRestartPrompt(prompt);
    const stored = useDialogStore.getState().wallpaperRestartPrompt;
    expect(stored?.appId).toBe('traework');
    expect(stored?.wallpaperId).toBe('wallpaper-1');
    expect(stored?.restartReason).toBe('not-installed');
  });
});

describe('dialogStore setLaunchRestartPrompt', () => {
  beforeEach(() => {
    useDialogStore.setState({ launchRestartPrompt: null });
  });

  it('sets a LaunchRestartPrompt value', () => {
    const prompt = makeLaunchRestartPrompt();
    useDialogStore.getState().setLaunchRestartPrompt(prompt);
    expect(useDialogStore.getState().launchRestartPrompt).toEqual(prompt);
  });

  it('resets to null', () => {
    useDialogStore.getState().setLaunchRestartPrompt(makeLaunchRestartPrompt());
    useDialogStore.getState().setLaunchRestartPrompt(null);
    expect(useDialogStore.getState().launchRestartPrompt).toBeNull();
  });

  it('preserves appId, name, and message fields', () => {
    const prompt = makeLaunchRestartPrompt();
    useDialogStore.getState().setLaunchRestartPrompt(prompt);
    const stored = useDialogStore.getState().launchRestartPrompt;
    expect(stored?.appId).toBe('scanned-app-1');
    expect(stored?.name).toBe('Scanned App');
    expect(stored?.message).toBe('App needs restart to enable debug port.');
  });
});

describe('dialogStore setDeletePrompt', () => {
  beforeEach(() => {
    useDialogStore.setState({ deletePrompt: null });
  });

  it('sets a ThemeCatalogItem value', () => {
    const prompt = makeDeletePrompt();
    useDialogStore.getState().setDeletePrompt(prompt);
    expect(useDialogStore.getState().deletePrompt).toEqual(prompt);
  });

  it('resets to null', () => {
    useDialogStore.getState().setDeletePrompt(makeDeletePrompt());
    useDialogStore.getState().setDeletePrompt(null);
    expect(useDialogStore.getState().deletePrompt).toBeNull();
  });

  it('preserves catalog item fields', () => {
    const prompt = makeDeletePrompt();
    useDialogStore.getState().setDeletePrompt(prompt);
    const stored = useDialogStore.getState().deletePrompt;
    expect(stored?.id).toBe('theme-to-delete');
    expect(stored?.name).toBe('Theme To Delete');
    expect(stored?.installed).toBe(true);
  });
});

describe('dialogStore setFileImportPrompt', () => {
  beforeEach(() => {
    useDialogStore.setState({ fileImportPrompt: null });
  });

  it('sets a FileImportConfirmRequest value', () => {
    const prompt = makeFileImportPrompt();
    useDialogStore.getState().setFileImportPrompt(prompt);
    expect(useDialogStore.getState().fileImportPrompt).toEqual(prompt);
  });

  it('resets to null', () => {
    useDialogStore.getState().setFileImportPrompt(makeFileImportPrompt());
    useDialogStore.getState().setFileImportPrompt(null);
    expect(useDialogStore.getState().fileImportPrompt).toBeNull();
  });

  it('preserves path, incoming, and existing fields', () => {
    const prompt = makeFileImportPrompt();
    useDialogStore.getState().setFileImportPrompt(prompt);
    const stored = useDialogStore.getState().fileImportPrompt;
    expect(stored?.path).toBe('/some/path/theme.json');
    expect(stored?.incoming.id).toBe('incoming');
    expect(stored?.existing.id).toBe('existing');
  });
});

// ---------------------------------------------------------------------------
// State reset tests
// ---------------------------------------------------------------------------

describe('dialogStore state reset', () => {
  it('can reset all prompts to null after setting them', () => {
    // Set all prompts
    useDialogStore.getState().setRestartPrompt(makeRestartPrompt());
    useDialogStore.getState().setWallpaperRestartPrompt(makeWallpaperRestartPrompt());
    useDialogStore.getState().setLaunchRestartPrompt(makeLaunchRestartPrompt());
    useDialogStore.getState().setDeletePrompt(makeDeletePrompt());
    useDialogStore.getState().setFileImportPrompt(makeFileImportPrompt());

    // Verify all are set
    let state = useDialogStore.getState();
    expect(state.restartPrompt).not.toBeNull();
    expect(state.wallpaperRestartPrompt).not.toBeNull();
    expect(state.launchRestartPrompt).not.toBeNull();
    expect(state.deletePrompt).not.toBeNull();
    expect(state.fileImportPrompt).not.toBeNull();

    // Reset all
    useDialogStore.setState({
      restartPrompt: null,
      wallpaperRestartPrompt: null,
      launchRestartPrompt: null,
      deletePrompt: null,
      fileImportPrompt: null,
    });

    state = useDialogStore.getState();
    expect(state.restartPrompt).toBeNull();
    expect(state.wallpaperRestartPrompt).toBeNull();
    expect(state.launchRestartPrompt).toBeNull();
    expect(state.deletePrompt).toBeNull();
    expect(state.fileImportPrompt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Boundary condition tests
// ---------------------------------------------------------------------------

describe('dialogStore boundary conditions', () => {
  beforeEach(() => {
    useDialogStore.setState({
      restartPrompt: null,
      wallpaperRestartPrompt: null,
      launchRestartPrompt: null,
      deletePrompt: null,
      fileImportPrompt: null,
    });
  });

  it('handles setting a prompt multiple times (last write wins)', () => {
    const first = makeRestartPrompt();
    const second = { ...first, themeName: 'Updated Theme' };

    useDialogStore.getState().setRestartPrompt(first);
    useDialogStore.getState().setRestartPrompt(second);

    expect(useDialogStore.getState().restartPrompt?.themeName).toBe('Updated Theme');
  });

  it('does not affect other prompts when one is set', () => {
    useDialogStore.getState().setRestartPrompt(makeRestartPrompt());

    const state = useDialogStore.getState();
    expect(state.restartPrompt).not.toBeNull();
    expect(state.wallpaperRestartPrompt).toBeNull();
    expect(state.launchRestartPrompt).toBeNull();
    expect(state.deletePrompt).toBeNull();
    expect(state.fileImportPrompt).toBeNull();
  });

  it('handles setting null on already-null state gracefully', () => {
    useDialogStore.getState().setRestartPrompt(null);
    useDialogStore.getState().setWallpaperRestartPrompt(null);
    useDialogStore.getState().setLaunchRestartPrompt(null);
    useDialogStore.getState().setDeletePrompt(null);
    useDialogStore.getState().setFileImportPrompt(null);

    const state = useDialogStore.getState();
    expect(state.restartPrompt).toBeNull();
    expect(state.wallpaperRestartPrompt).toBeNull();
    expect(state.launchRestartPrompt).toBeNull();
    expect(state.deletePrompt).toBeNull();
    expect(state.fileImportPrompt).toBeNull();
  });
});
