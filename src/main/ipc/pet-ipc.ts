// SPDX-License-Identifier: MPL-2.0

/**
 * # Pet IPC
 *
 * Manages the floating desktop pet window — a transparent, frameless,
 * always-on-top BrowserWindow that renders the active pet outside of any
 * target AI application.
 *
 * The window is created lazily on the first `pet:show` call and reused
 * across show/hide cycles. A single fixed-size window follows the
 * position reported by the renderer (petStore.setPosition).
 *
 * Renderer fire-and-forget calls (show / hide / move / set) are registered
 * with `ipcMain.on` — they mirror the studio / wallpaper window-control
 * pattern (`window-ipc.ts`).
 */

import path from 'node:path';
import { BrowserWindow, ipcMain, screen } from 'electron';
import { IpcChannel } from '../../shared/ipc-channels';
import type { PetMoveRequest, PetSetRequest } from '../../shared/types/pet';
import { brandingRoot } from '../main-context';

/** Default pet window dimensions. Tuned for a small floating companion. */
const PET_WINDOW_WIDTH = 180;
const PET_WINDOW_HEIGHT = 180;

/** Module-level pet window reference. */
let petWindow: BrowserWindow | null = null;

/**
 * Create (or focus, if already open) the floating pet window.
 *
 * The window is frameless, transparent, always-on-top, and skips the taskbar
 * so it behaves like a lightweight overlay that does not steal focus from
 * the user's work in other apps.
 */
function createPetWindow(): BrowserWindow {
  if (petWindow && !petWindow.isDestroyed()) {
    return petWindow;
  }

  const win = new BrowserWindow({
    width: PET_WINDOW_WIDTH,
    height: PET_WINDOW_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    fullscreenable: false,
    focusable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    icon: path.join(brandingRoot(), 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Prevent the pet window from appearing in the Alt-Tab switcher on Windows.
  if (process.platform === 'win32') {
    win.setSkipTaskbar(true);
    try {
      win.setAlwaysOnTop(true, 'screen-saver');
    } catch {
      // Fallback already set via constructor flag.
    }
  }

  // Clear the reference on close so a later show recreates it.
  win.on('closed', () => {
    if (petWindow === win) petWindow = null;
  });

  // Load the pet renderer URL — dev server in development, bundled HTML in prod.
  if (process.env.ELECTRON_RENDERER_URL) {
    const base = process.env.ELECTRON_RENDERER_URL.replace(/\/+$/, '');
    void win.loadURL(`${base}/pet.html`);
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/pet.html'));
  }

  petWindow = win;
  return win;
}

/** Ensure the pet window is visible and positioned at the supplied coords. */
function showPetWindow(petId: string): void {
  const win = createPetWindow();
  const { x, y } = resolveDefaultPosition();

  if (!win.isVisible()) {
    win.setPosition(x, y);
    win.showInactive();
  }

  // Notify the renderer which pet is active so it renders the right sprite.
  win.webContents.send(IpcChannel.PET_SET, { petId } satisfies PetSetRequest);
}

/** Hide the pet window without destroying it so a later show is instant. */
function hidePetWindow(): void {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.hide();
  }
}

/** Move the pet window to the supplied position. */
function movePetWindow(req: PetMoveRequest): void;
function movePetWindow(x: number, y: number): void;
function movePetWindow(xOrReq: number | PetMoveRequest, maybeY?: number): void {
  if (!petWindow || petWindow.isDestroyed()) return;
  const x = typeof xOrReq === 'number' ? xOrReq : xOrReq.x;
  const y = typeof xOrReq === 'number' ? (maybeY ?? 0) : xOrReq.y;
  petWindow.setPosition(x, y);
}

/** Compute a safe default position (bottom-right of the primary display). */
function resolveDefaultPosition(): { x: number; y: number } {
  const { width, height } = screen.getPrimaryDisplay().workArea;
  return {
    x: Math.max(0, width - PET_WINDOW_WIDTH - 80),
    y: Math.max(0, height - PET_WINDOW_HEIGHT - 80),
  };
}

/** Register the pet IPC handlers. Call once during boot. */
export function registerPetIpc(): void {
  ipcMain.on(IpcChannel.PET_SHOW, (_event, petId: string) => {
    showPetWindow(petId);
  });

  ipcMain.on(IpcChannel.PET_HIDE, () => {
    hidePetWindow();
  });

  ipcMain.on(IpcChannel.PET_MOVE, (_event, req: PetMoveRequest) => {
    movePetWindow(req);
  });

  ipcMain.on(IpcChannel.PET_SET, (_event, req: PetSetRequest) => {
    // Forward the active-pet switch to the pet window's renderer.
    petWindow?.webContents.send(IpcChannel.PET_SET, req);
  });
}

/** Tear down the pet window on app quit. */
export function disposePetWindow(): void {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.destroy();
  }
  petWindow = null;
}
