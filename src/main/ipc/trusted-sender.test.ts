// SPDX-License-Identifier: MPL-2.0

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertTrustedSender, isTrustedSender, setTrustedSenderId } from './trusted-sender';

// Electron's WebFrameMain exposes `parent: WebFrameMain | null`; the main
// frame is the only one with `parent === null`.
const mainFrame = { sender: { id: 1 }, senderFrame: { parent: null } };
const iframe = { sender: { id: 1 }, senderFrame: { parent: {} } };

describe('trusted-sender (G5 / O1)', () => {
  beforeEach(() => {
    setTrustedSenderId(1);
  });

  afterEach(() => {
    setTrustedSenderId(null);
  });

  it('accepts a call from the recorded main window top frame', () => {
    expect(isTrustedSender(mainFrame)).toBe(true);
  });

  it('rejects a call from a different webContents', () => {
    expect(isTrustedSender({ sender: { id: 999 }, senderFrame: { parent: null } })).toBe(false);
  });

  it('rejects a call from an iframe even when it shares the webContents id (O1)', () => {
    // iframes share the parent webContents.id — only the isMainFrame check
    // can exclude them.
    expect(isTrustedSender(iframe)).toBe(false);
  });

  it('rejects before the trusted id is set', () => {
    setTrustedSenderId(null);
    expect(isTrustedSender(mainFrame)).toBe(false);
  });

  it('assertTrustedSender throws for an untrusted / iframe sender', () => {
    expect(() => assertTrustedSender(iframe)).toThrow('Untrusted IPC sender');
    expect(() => assertTrustedSender(mainFrame)).not.toThrow();
  });
});
