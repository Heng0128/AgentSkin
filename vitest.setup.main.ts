// SPDX-License-Identifier: MPL-2.0

/**
 * vitest setup for main project — mocks the 'electron' package.
 *
 * Electron is an optional native dependency provided by the Electron runtime,
 * not installed in the dev/test node_modules. All main-process source files
 * import from 'electron'; this setup provides a minimal in-memory mock so the
 * modules can be imported and unit-tested in the vitest node environment.
 */

import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// Minimal EventEmitter (used by app, ipcMain, ipcRenderer, powerMonitor)
// ---------------------------------------------------------------------------
class MockEventEmitter {
  private listeners = new Map<string | symbol, Set<(args: unknown[]) => void>>();

  on(event: string | symbol, listener: (args: unknown[]) => void): this {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
    return this;
  }

  once(event: string | symbol, listener: (args: unknown[]) => void): this {
    const wrapped = (args: unknown[]) => {
      this.off(event, wrapped);
      listener(args);
    };
    return this.on(event, wrapped);
  }

  off(event: string | symbol, listener: (args: unknown[]) => void): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  emit(event: string | symbol, ...args: unknown[]): boolean {
    this.listeners.get(event)?.forEach((fn) => fn(args));
    return this.listeners.has(event);
  }

  removeAllListeners(event?: string | symbol): this {
    if (event === undefined) this.listeners.clear();
    else this.listeners.delete(event);
    return this;
  }

  listenerCount(event: string | symbol): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

// ---------------------------------------------------------------------------
// app mock
// ---------------------------------------------------------------------------
const app = new MockEventEmitter() as MockEventEmitter & {
  getPath: ReturnType<typeof vi.fn>;
  getName: ReturnType<typeof vi.fn>;
  getVersion: ReturnType<typeof vi.fn>;
  getAppPath: ReturnType<typeof vi.fn>;
  quit: ReturnType<typeof vi.fn>;
  whenReady: ReturnType<typeof vi.fn>;
  isReady: ReturnType<typeof vi.fn>;
  relaunch: ReturnType<typeof vi.fn>;
  exit: ReturnType<typeof vi.fn>;
  requestSingleInstanceLock: ReturnType<typeof vi.fn>;
};

app.getPath = vi.fn((name: string) => `/mock/path/${name}`);
app.getName = vi.fn(() => 'agentskin-desktop');
app.getVersion = vi.fn(() => '1.0.0');
app.getAppPath = vi.fn(() => process.cwd());
app.quit = vi.fn();
app.whenReady = vi.fn(() => Promise.resolve());
app.isReady = vi.fn(() => true);
app.relaunch = vi.fn();
app.exit = vi.fn();
app.requestSingleInstanceLock = vi.fn(() => true);

// ---------------------------------------------------------------------------
// BrowserWindow mock
// ---------------------------------------------------------------------------
class MockBrowserWindow extends MockEventEmitter {
  static getAllWindows = vi.fn(() => []);
  static getFocusedWindow = vi.fn(() => null);
  static fromId = vi.fn(() => null);
  static fromWebContents = vi.fn(() => null);

  id = 1;
  webContents = {
    send: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    off: vi.fn(),
    executeJavaScript: vi.fn(() => Promise.resolve()),
    openDevTools: vi.fn(),
    getURL: vi.fn(() => 'about:blank'),
    setWindowOpenHandler: vi.fn(),
    session: {
      on: vi.fn(),
      once: vi.fn(),
      removeAllListeners: vi.fn(),
    },
  };

  constructor(_options?: unknown) {
    super();
  }

  loadURL = vi.fn(() => Promise.resolve());
  loadFile = vi.fn(() => Promise.resolve());
  show = vi.fn();
  hide = vi.fn();
  close = vi.fn();
  destroy = vi.fn();
  focus = vi.fn();
  minimize = vi.fn();
  maximize = vi.fn();
  restore = vi.fn();
  setMenu = vi.fn();
  removeMenu = vi.fn();
  isDestroyed = vi.fn(() => false);
  isVisible = vi.fn(() => true);
  isFocused = vi.fn(() => false);
  getBounds = vi.fn(() => ({ x: 0, y: 0, width: 800, height: 600 }));
  setBounds = vi.fn();
  setTitle = vi.fn();
  setBackgroundColor = vi.fn();
  setAlwaysOnTop = vi.fn();
}

// ---------------------------------------------------------------------------
// Tray mock
// ---------------------------------------------------------------------------
class MockTray extends MockEventEmitter {
  constructor(_icon?: unknown) {
    super();
  }
  setImage = vi.fn();
  setToolTip = vi.fn();
  setContextMenu = vi.fn();
  popUpContextMenu = vi.fn();
  getBounds = vi.fn(() => ({ x: 0, y: 0, width: 16, height: 16 }));
  isDestroyed = vi.fn(() => false);
  destroy = vi.fn();
}

// ---------------------------------------------------------------------------
// Menu mock
// ---------------------------------------------------------------------------
class MockMenu extends MockEventEmitter {
  constructor() {
    super();
  }
  static setApplicationMenu = vi.fn();
  static getApplicationMenu = vi.fn(() => null);
  static buildFromTemplate = vi.fn(() => new MockMenu());
  append = vi.fn();
  insert = vi.fn();
  popup = vi.fn();
  closePopup = vi.fn();
}

// ---------------------------------------------------------------------------
// ipcMain / ipcRenderer mock
// ---------------------------------------------------------------------------
const ipcMain = new MockEventEmitter() as MockEventEmitter & {
  handle: ReturnType<typeof vi.fn>;
  handleOnce: ReturnType<typeof vi.fn>;
  removeHandler: ReturnType<typeof vi.fn>;
};
ipcMain.handle = vi.fn();
ipcMain.handleOnce = vi.fn();
ipcMain.removeHandler = vi.fn();

const ipcRenderer = new MockEventEmitter() as MockEventEmitter & {
  invoke: ReturnType<typeof vi.fn>;
  send: ReturnType<typeof vi.fn>;
  sendSync: ReturnType<typeof vi.fn>;
};
ipcRenderer.invoke = vi.fn(() => Promise.resolve());
ipcRenderer.send = vi.fn();
ipcRenderer.sendSync = vi.fn(() => undefined);

// ---------------------------------------------------------------------------
// dialog mock
// ---------------------------------------------------------------------------
const dialog = {
  showOpenDialog: vi.fn(() => Promise.resolve({ canceled: false, filePaths: [] })),
  showSaveDialog: vi.fn(() => Promise.resolve({ canceled: false, filePath: '' })),
  showMessageBox: vi.fn(() => Promise.resolve({ response: 0, checkboxChecked: false })),
  showErrorBox: vi.fn(),
};

// ---------------------------------------------------------------------------
// nativeImage mock
// ---------------------------------------------------------------------------
const nativeImage = {
  createEmpty: vi.fn(() => ({ isEmpty: () => true, getSize: () => ({ width: 0, height: 0 }) })),
  createFromPath: vi.fn((_path: string) => ({
    isEmpty: () => false,
    getSize: () => ({ width: 1, height: 1 }),
  })),
  createFromBuffer: vi.fn(() => ({
    isEmpty: () => true,
    getSize: () => ({ width: 0, height: 0 }),
  })),
  createFromDataURL: vi.fn(() => ({
    isEmpty: () => true,
    getSize: () => ({ width: 0, height: 0 }),
  })),
};

// ---------------------------------------------------------------------------
// shell mock
// ---------------------------------------------------------------------------
const shell = {
  openExternal: vi.fn(() => Promise.resolve()),
  openPath: vi.fn(() => Promise.resolve('')),
  showItemInFolder: vi.fn(),
  moveItemToTrash: vi.fn(() => true),
  beep: vi.fn(),
};

// ---------------------------------------------------------------------------
// contextBridge mock
// ---------------------------------------------------------------------------
const contextBridge = {
  exposeInMainWorld: vi.fn(),
};

// ---------------------------------------------------------------------------
// webUtils mock
// ---------------------------------------------------------------------------
const webUtils = {
  getPathForFile: vi.fn((f: File) => f.name || ''),
};

// ---------------------------------------------------------------------------
// net mock
// ---------------------------------------------------------------------------
const net = {
  fetch: vi.fn(() => Promise.resolve(new Response(null, { status: 200 }))),
};

// ---------------------------------------------------------------------------
// protocol mock
// ---------------------------------------------------------------------------
const protocol = {
  registerFileProtocol: vi.fn(() => true),
  unregisterProtocol: vi.fn(() => true),
  isProtocolRegistered: vi.fn(() => true),
  handle: vi.fn(() => true),
  isProtocolHandled: vi.fn(() => true),
};

// ---------------------------------------------------------------------------
// powerMonitor mock
// ---------------------------------------------------------------------------
const powerMonitor = new MockEventEmitter() as MockEventEmitter & {
  isOnBatteryPower: boolean;
};
powerMonitor.isOnBatteryPower = false;

// ---------------------------------------------------------------------------
// Install the mock via vi.mock (hoisted by vitest)
// ---------------------------------------------------------------------------
vi.mock('electron', () => ({
  app,
  BrowserWindow: MockBrowserWindow,
  Tray: MockTray,
  Menu: MockMenu,
  dialog,
  nativeImage,
  shell,
  contextBridge,
  webUtils,
  net,
  protocol,
  ipcMain,
  ipcRenderer,
  powerMonitor,
}));
