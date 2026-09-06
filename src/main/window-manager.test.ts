// SPDX-License-Identifier: MPL-2.0

/**
 * # window-manager tests
 *
 * RC-C fix: window-manager.ts previously had zero unit test coverage despite
 * owning the full BrowserWindow lifecycle. These tests verify the critical
 * resource-management behaviors.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createElectronMock } from '../../fixtures/mocks/electron';

// ---------------------------------------------------------------------------
// Stateful BrowserWindow mock — creates window-like objects on each construction.
// ---------------------------------------------------------------------------

interface MockWindow {
  args: Record<string, unknown>;
  listeners: Map<string, Array<(e: unknown) => void>>;
  webContents: {
    send: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    setWindowOpenHandler: ReturnType<typeof vi.fn>;
    loadURL: ReturnType<typeof vi.fn>;
    loadFile: ReturnType<typeof vi.fn>;
    id: number;
  };
  setMenuBarVisibility: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
  hide: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  focus: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  isDestroyed: ReturnType<typeof vi.fn>;
  loadURL: ReturnType<typeof vi.fn>;
  loadFile: ReturnType<typeof vi.fn>;
  on: (event: string, handler: (e: unknown) => void) => void;
  once: (event: string, handler: (e: unknown) => void) => void;
  off: (event: string, handler: (e: unknown) => void) => void;
}

const tracked: MockWindow[] = [];

function makeWindow(args: Record<string, unknown>): MockWindow {
  const listeners = new Map<string, Array<(e: unknown) => void>>();
  const win: MockWindow = {
    args,
    listeners,
    webContents: {
      send: vi.fn(),
      on: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      loadURL: vi.fn().mockResolvedValue(undefined),
      loadFile: vi.fn().mockResolvedValue(undefined),
      id: tracked.length + 1,
    },
    setMenuBarVisibility: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    close: vi.fn(),
    focus: vi.fn(),
    destroy: vi.fn(),
    isDestroyed: vi.fn(() => false),
    loadURL: vi.fn().mockResolvedValue(undefined),
    loadFile: vi.fn().mockResolvedValue(undefined),
    on(event: string, handler: (e: unknown) => void) {
      const existing = listeners.get(event) ?? [];
      existing.push(handler);
      listeners.set(event, existing);
    },
    once(event: string, handler: (e: unknown) => void) {
      const wrapped = (e: unknown) => {
        win.off(event, wrapped);
        handler(e);
      };
      win.on(event, wrapped);
    },
    off(event: string, handler: (e: unknown) => void) {
      const handlers = listeners.get(event);
      if (handlers) {
        const idx = handlers.indexOf(handler);
        if (idx !== -1) handlers.splice(idx, 1);
      }
    },
  };
  tracked.push(win);
  return win;
}

vi.mock('electron', () => ({
  ...createElectronMock(new Map()),
  BrowserWindow: vi.fn().mockImplementation(makeWindow),
  screen: {
    getPrimaryDisplay: vi.fn().mockReturnValue({
      scaleFactor: 1,
      workArea: { width: 1920, height: 1080 },
    }),
  },
}));

const { createMainWindow, createStudioWindow } = await import('./window-manager');
const { ctx } = await import('./main-context');

describe('window-manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    tracked.length = 0;
    ctx.mainWindow = null;
    ctx.studioWindow = null;
    ctx.isQuitting = false;
  });

  afterEach(() => {
    ctx.mainWindow = null;
    ctx.studioWindow = null;
    ctx.isQuitting = false;
  });

  describe('createMainWindow', () => {
    it('creates a BrowserWindow and stores it on ctx.mainWindow', async () => {
      await createMainWindow({ rendererUrl: 'http://localhost:5173' });
      expect(tracked.length).toBe(1);
      expect(ctx.mainWindow).toBe(tracked[0]);
    });

    it('passes expected window configuration', async () => {
      await createMainWindow({ rendererUrl: 'http://localhost:5173' });
      expect(tracked[0].args).toMatchObject({
        show: false,
        title: 'AgentSkin',
      });
    });

    it('close-to-tray: hides window when not quitting', async () => {
      await createMainWindow({ rendererUrl: 'http://localhost:5173' });
      const win = tracked[0];
      const closeHandlers = win.listeners.get('close') ?? [];
      expect(closeHandlers.length).toBeGreaterThan(0);

      const mockEvent = { preventDefault: vi.fn() };
      for (const handler of closeHandlers) handler(mockEvent);

      expect(mockEvent.preventDefault).toHaveBeenCalled();
      expect(win.hide).toHaveBeenCalled();
    });

    it('allows close when isQuitting is true', async () => {
      await createMainWindow({ rendererUrl: 'http://localhost:5173' });
      ctx.isQuitting = true;
      const win = tracked[0];
      const closeHandlers = win.listeners.get('close') ?? [];

      const mockEvent = { preventDefault: vi.fn() };
      for (const handler of closeHandlers) handler(mockEvent);

      expect(mockEvent.preventDefault).not.toHaveBeenCalled();
    });
  });

  describe('createStudioWindow', () => {
    it('creates a studio window with correct title', async () => {
      await createStudioWindow({ rendererUrl: 'http://localhost:5173' });
      expect(tracked[0].args.title).toBe('AgentSkin Studio');
    });

    it('clears studioWindow ref on closed event', async () => {
      await createStudioWindow({ rendererUrl: 'http://localhost:5173' });
      const studioWin = tracked[0];
      const closedHandlers = studioWin.listeners.get('closed') ?? [];
      expect(closedHandlers.length).toBeGreaterThan(0);

      for (const handler of closedHandlers) handler({});

      expect(ctx.studioWindow).toBeNull();
    });

    it('is idempotent — does not create duplicate studio windows', async () => {
      await createStudioWindow({ rendererUrl: 'http://localhost:5173' });
      expect(tracked.length).toBe(1);

      await createStudioWindow({ rendererUrl: 'http://localhost:5173' });
      expect(tracked.length).toBe(1);
    });
  });
});
