// SPDX-License-Identifier: MPL-2.0

import type { BrowserWindow } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { IpcEventBus } from './ipc-event-bus';

/**
 * Minimal BrowserWindow mock that tracks webContents.send calls and
 * isDestroyed() state.
 */
function createMockWindow(opts: { destroyed?: boolean } = {}) {
  const sendFn = vi.fn();
  const win = {
    isDestroyed: vi.fn().mockReturnValue(opts.destroyed ?? false),
    webContents: { send: sendFn },
    on: vi.fn(),
    // Expose the send fn for assertions.
    _sendFn: sendFn,
  } as unknown as BrowserWindow & { _sendFn: ReturnType<typeof vi.fn> };
  return win;
}

describe('IpcEventBus', () => {
  it('is a singleton with shared state', () => {
    expect(typeof IpcEventBus.addWindow).toBe('function');
    expect(typeof IpcEventBus.broadcast).toBe('function');
  });

  it('broadcasts to all registered windows', () => {
    const win1 = createMockWindow();
    const win2 = createMockWindow();
    IpcEventBus.addWindow(win1);
    IpcEventBus.addWindow(win2);

    IpcEventBus.broadcast('test:event', { foo: 'bar' });

    expect(win1._sendFn).toHaveBeenCalledWith('test:event', { foo: 'bar' });
    expect(win2._sendFn).toHaveBeenCalledWith('test:event', { foo: 'bar' });

    IpcEventBus.clear();
  });

  it('skips destroyed windows and removes them from the set', () => {
    const win1 = createMockWindow({ destroyed: true });
    const win2 = createMockWindow({ destroyed: false });
    IpcEventBus.addWindow(win1);
    IpcEventBus.addWindow(win2);

    IpcEventBus.broadcast('test:event', 42);

    expect(win1._sendFn).not.toHaveBeenCalled();
    expect(win2._sendFn).toHaveBeenCalledWith('test:event', 42);
    IpcEventBus.clear();
  });

  it('does not throw when send fails on a window', () => {
    const win = createMockWindow();
    win._sendFn.mockImplementation(() => {
      throw new Error('renderer gone');
    });
    IpcEventBus.addWindow(win);

    expect(() => IpcEventBus.broadcast('test:event')).not.toThrow();

    IpcEventBus.clear();
  });

  it('windowCount reflects registered windows', () => {
    expect(IpcEventBus.windowCount).toBe(0);
    const win1 = createMockWindow();
    const win2 = createMockWindow();
    IpcEventBus.addWindow(win1);
    IpcEventBus.addWindow(win2);
    expect(IpcEventBus.windowCount).toBe(2);
    IpcEventBus.clear();
    expect(IpcEventBus.windowCount).toBe(0);
  });

  it('addWindow is idempotent — registering twice does not double-deliver', () => {
    const win = createMockWindow();
    IpcEventBus.addWindow(win);
    IpcEventBus.addWindow(win);

    IpcEventBus.broadcast('test:event', 'data');
    expect(win._sendFn).toHaveBeenCalledTimes(1);

    IpcEventBus.clear();
  });

  it('removeWindow unregisters cleanly', () => {
    const win = createMockWindow();
    IpcEventBus.addWindow(win);
    IpcEventBus.removeWindow(win);

    IpcEventBus.broadcast('test:event');
    expect(win._sendFn).not.toHaveBeenCalled();
  });

  it('broadcast works with no payload (pure event)', () => {
    const win = createMockWindow();
    IpcEventBus.addWindow(win);

    IpcEventBus.broadcast('status:changed');

    expect(win._sendFn).toHaveBeenCalledWith('status:changed');

    IpcEventBus.clear();
  });
});
