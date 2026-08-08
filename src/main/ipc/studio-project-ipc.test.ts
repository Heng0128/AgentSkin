// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { IpcChannel } from '../../shared/ipc-channels';
import { isSafeThemeId } from '../../shared/theme-id';
import type { StudioProject } from '../../shared/types';

// ---------------------------------------------------------------------------
// Mocks — must be set BEFORE importing the module under test, because its
// module-level `PROJECTS_DIR` constant is derived from `app.getPath('userData')`
// at import time.
// ---------------------------------------------------------------------------

const TEST_USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'agentskin-studio-test-'));

const handlers = new Map<string, (...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((name: string) => (name === 'userData' ? TEST_USER_DATA : os.tmpdir())),
  },
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    }),
  },
  dialog: {
    showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
  },
}));

// Import AFTER mocks so PROJECTS_DIR resolves to the temp dir.
const { registerStudioProjectIpc } = await import('./studio-project-ipc');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function call<T>(channel: string, ...args: unknown[]): T {
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`No handler registered for ${channel}`);
  // ipcMain.handle handlers are invoked as (event, ...args); the event is
  // unused by studio-project-ipc, so pass a minimal stub.
  return handler({}, ...args) as T;
}

function projectsDir(): string {
  return path.join(TEST_USER_DATA, 'theme-workbench', 'projects');
}

function fileExists(...segments: string[]): boolean {
  return fs.existsSync(path.join(...segments));
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('studio-project-ipc — project CRUD', () => {
  beforeAll(() => {
    registerStudioProjectIpc();
  });

  beforeEach(() => {
    // Clean the temp project dir between tests so each case starts fresh.
    fs.rmSync(projectsDir(), { recursive: true, force: true });
  });

  afterAll(() => {
    fs.rmSync(TEST_USER_DATA, { recursive: true, force: true });
  });

  it('creates a project with an ASCII-safe id even for Chinese names', () => {
    const p = call<StudioProject>(IpcChannel.STUDIO_PROJECT_CREATE, {
      name: '我的第一个工程',
      author: '张三',
      agentId: 'traework',
    });
    expect(p.name).toBe('我的第一个工程');
    expect(p.agentId).toBe('traework');
    // The regression we fixed: the derived id must satisfy isSafeThemeId so
    // downstream snapshot/delete guards accept it.
    expect(isSafeThemeId(p.id)).toBe(true);
    // The project file should actually be written to disk.
    expect(fileExists(projectsDir(), p.id, 'project.json')).toBe(true);
  });

  it('creates a project with an English name and a slug-based id', () => {
    const p = call<StudioProject>(IpcChannel.STUDIO_PROJECT_CREATE, {
      name: 'My Cool Theme',
      author: '',
      agentId: 'zcode',
    });
    expect(isSafeThemeId(p.id)).toBe(true);
    expect(p.id.startsWith('my-cool-theme')).toBe(true);
  });

  it('rejects an invalid agentId on create', () => {
    expect(() =>
      call(IpcChannel.STUDIO_PROJECT_CREATE, { name: 'x', author: '', agentId: 'nonsense' }),
    ).toThrow('Invalid agentId');
  });

  it('lists projects, auto-seeding a default project when empty', () => {
    // First list on an empty dir seeds a default project (non-empty result).
    const list = call<StudioProject[]>(IpcChannel.STUDIO_PROJECT_LIST);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].id).toBeTruthy();
    // Its id must also be safe (the default name is Chinese).
    expect(isSafeThemeId(list[0].id)).toBe(true);
  });

  it('saves an updated project back to disk', () => {
    const created = call<StudioProject>(IpcChannel.STUDIO_PROJECT_CREATE, {
      name: 'theme',
      author: '',
      agentId: 'doubao',
    });
    const updated = call<StudioProject>(IpcChannel.STUDIO_PROJECT_SAVE, {
      ...created,
      name: 'renamed',
      hasSnapshot: true,
    });
    expect(updated.name).toBe('renamed');
    expect(updated.hasSnapshot).toBe(true);
    // Reload from disk to confirm persistence.
    const list = call<StudioProject[]>(IpcChannel.STUDIO_PROJECT_LIST);
    const found = list.find((p) => p.id === created.id);
    expect(found?.name).toBe('renamed');
  });

  it('rejects a save with an invalid payload', () => {
    expect(() =>
      call(IpcChannel.STUDIO_PROJECT_SAVE, { schema: 'bad', agentId: 'traework' }),
    ).toThrow('Invalid project payload');
  });

  it('deletes a project and removes its directory', () => {
    const created = call<StudioProject>(IpcChannel.STUDIO_PROJECT_CREATE, {
      name: 'delete-me',
      author: '',
      agentId: 'workbuddy',
    });
    expect(fileExists(projectsDir(), created.id)).toBe(true);
    const res = call<{ ok: boolean }>(IpcChannel.STUDIO_PROJECT_DELETE, { id: created.id });
    expect(res.ok).toBe(true);
    expect(fileExists(projectsDir(), created.id)).toBe(false);
  });

  it('rejects deleting an unsafe (path-traversal) id', () => {
    const res = call<{ ok: boolean; error?: string }>(IpcChannel.STUDIO_PROJECT_DELETE, {
      id: '../../../../etc',
    });
    expect(res.ok).toBe(false);
  });

  it('rejects deleting a non-ASCII id (defense for the old slugify bug)', () => {
    const res = call<{ ok: boolean; error?: string }>(IpcChannel.STUDIO_PROJECT_DELETE, {
      id: '我的第一个工程-abc',
    });
    expect(res.ok).toBe(false);
  });
});

describe('studio-project-ipc — snapshots', () => {
  beforeAll(() => {
    registerStudioProjectIpc();
  });

  beforeEach(() => {
    fs.rmSync(projectsDir(), { recursive: true, force: true });
  });

  afterAll(() => {
    fs.rmSync(TEST_USER_DATA, { recursive: true, force: true });
  });

  it('saves and loads a snapshot for an existing project id', () => {
    const created = call<StudioProject>(IpcChannel.STUDIO_PROJECT_CREATE, {
      name: 'snap',
      author: '',
      agentId: 'codex',
    });
    const snapshot = { themeName: 'midnight', nodes: [{ selector: '.x' }] };
    const save = call<{ ok: boolean; error?: string }>(IpcChannel.STUDIO_SNAPSHOT_SAVE, {
      projectId: created.id,
      snapshot,
      kind: 'current',
    });
    expect(save.ok).toBe(true);
    const loaded = call<unknown | null>(IpcChannel.STUDIO_SNAPSHOT_LOAD, {
      projectId: created.id,
      kind: 'current',
    });
    expect(loaded).toEqual(snapshot);
  });

  it('rejects snapshot save for an unsafe project id', () => {
    const res = call<{ ok: boolean; error?: string }>(IpcChannel.STUDIO_SNAPSHOT_SAVE, {
      projectId: '我的第一个工程-abc',
      snapshot: { themeName: 'x' },
    });
    expect(res.ok).toBe(false);
  });

  it('returns null loading a snapshot for a missing/invalid id', () => {
    const res = call<unknown | null>(IpcChannel.STUDIO_SNAPSHOT_LOAD, {
      projectId: 'does-not-exist',
      kind: 'current',
    });
    expect(res).toBeNull();
  });
});
