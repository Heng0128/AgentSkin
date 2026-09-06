// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it, vi } from 'vitest';
import type { DeepLinkCommand } from '../shared/deep-link-commands';
import { DeepLinkManager } from './deep-link-manager';

describe('DeepLinkManager', () => {
  it('returns false for non-agentskin URLs', () => {
    const mgr = new DeepLinkManager();
    expect(mgr.handleUrl('https://example.com')).toBe(false);
    expect(mgr.handleUrl('agentskin-theme://cover/neon')).toBe(false);
    expect(mgr.handleUrl('C:\\Windows\\System32\\cmd.exe')).toBe(false);
  });

  it('buffers URLs when no handler is registered', () => {
    const mgr = new DeepLinkManager();
    expect(mgr.handleUrl('agentskin://apply/neon')).toBe(true);
    expect(mgr.handleUrl('agentskin://navigate/themes')).toBe(true);
    expect(mgr.pendingCount).toBe(2);
    expect(mgr.hasHandler).toBe(false);
  });

  it('dispatches directly when handler is registered', () => {
    const mgr = new DeepLinkManager();
    const handler = vi.fn();
    mgr.setHandler(handler);
    expect(mgr.handleUrl('agentskin://apply/neon?app=codex')).toBe(true);
    expect(handler).toHaveBeenCalledTimes(1);
    const [command, rawUrl] = handler.mock.calls[0] as [DeepLinkCommand, string];
    expect(command.command).toBe('apply');
    // Narrow the discriminated union before accessing command-specific fields.
    if (command.command !== 'apply') throw new Error('expected apply command');
    expect(command.themeId).toBe('neon');
    expect(command.appId).toBe('codex');
    expect(rawUrl).toBe('agentskin://apply/neon?app=codex');
  });

  it('flushes buffered URLs in FIFO order when handler is registered', () => {
    const mgr = new DeepLinkManager();
    mgr.handleUrl('agentskin://apply/neon');
    mgr.handleUrl('agentskin://navigate/themes');
    mgr.handleUrl('agentskin://restore?app=codex');

    const received: string[] = [];
    mgr.setHandler((cmd) => {
      received.push(cmd.command);
    });

    expect(received).toEqual(['apply', 'navigate', 'restore']);
    expect(mgr.pendingCount).toBe(0);
    expect(mgr.hasHandler).toBe(true);
  });

  it('rejects malformed agentskin:// URLs', () => {
    const mgr = new DeepLinkManager();
    const handler = vi.fn();
    mgr.setHandler(handler);

    expect(mgr.handleUrl('agentskin://unknown/command')).toBe(false);
    expect(mgr.handleUrl('agentskin://apply/../../etc/passwd')).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  });

  it('does not throw when handler throws', () => {
    const mgr = new DeepLinkManager();
    mgr.setHandler(() => {
      throw new Error('handler boom');
    });
    expect(() => mgr.handleUrl('agentskin://apply/neon')).not.toThrow();
  });

  it('enforces max pending limit and drops oldest', () => {
    const mgr = new DeepLinkManager();
    // Fill to capacity + overflow.
    for (let i = 0; i < 25; i++) {
      mgr.handleUrl(`agentskin://apply/theme${i}`);
    }
    // Should have capped at MAX_PENDING (20) and dropped the 5 oldest.
    expect(mgr.pendingCount).toBe(20);
  });

  it('re-registering a handler replaces the previous one', () => {
    const mgr = new DeepLinkManager();
    const first = vi.fn();
    const second = vi.fn();
    mgr.setHandler(first);
    mgr.setHandler(second);
    mgr.handleUrl('agentskin://apply/neon');
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('drain returns pending and clears the queue', () => {
    const mgr = new DeepLinkManager();
    mgr.handleUrl('agentskin://apply/neon');
    mgr.handleUrl('agentskin://navigate/themes');
    const drained = mgr.drain();
    expect(drained.length).toBe(2);
    expect(mgr.pendingCount).toBe(0);
  });
});
