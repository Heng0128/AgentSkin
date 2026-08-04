// SPDX-License-Identifier: MPL-2.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mainError,
  mainErrorFromCatch,
  mainInfo,
  mainWarn,
  mainWarnFromCatch,
  setMainLogListener,
} from './logger';

describe('main-process logger facade', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;
  let consoleWarn: ReturnType<typeof vi.spyOn>;
  let consoleInfo: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Detach any listener left over from a previous test and silence the
    // console mirrors so test output stays clean.
    setMainLogListener(null);
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    setMainLogListener(null);
    consoleError.mockRestore();
    consoleWarn.mockRestore();
    consoleInfo.mockRestore();
  });

  describe('level helpers', () => {
    it('mainWarn forwards a WARN-scoped line to the listener', () => {
      const lines: string[] = [];
      setMainLogListener((line) => lines.push(line));
      mainWarn('ThemeInstaller', 'missing field');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('[WARN]');
      expect(lines[0]).toContain('[ThemeInstaller]');
      expect(lines[0]).toContain('missing field');
      expect(consoleWarn).toHaveBeenCalled();
    });

    it('mainError forwards an ERROR-scoped line to the listener', () => {
      const lines: string[] = [];
      setMainLogListener((line) => lines.push(line));
      mainError('ThemeLibrary', 'disk full');
      expect(lines[0]).toContain('[ERROR]');
      expect(lines[0]).toContain('disk full');
      expect(consoleError).toHaveBeenCalled();
    });

    it('mainInfo forwards an INFO-scoped line to the listener', () => {
      const lines: string[] = [];
      setMainLogListener((line) => lines.push(line));
      mainInfo('Boot', 'ready');
      expect(lines[0]).toContain('[INFO]');
      expect(lines[0]).toContain('ready');
      expect(consoleInfo).toHaveBeenCalled();
    });
  });

  describe('buffering before a listener is attached', () => {
    it('buffers messages emitted before setMainLogListener and flushes them on attach', () => {
      mainWarn('Scope', 'buffered one');
      mainError('Scope', 'buffered two');
      const lines: string[] = [];
      setMainLogListener((line) => lines.push(line));
      expect(lines).toHaveLength(2);
      expect(lines[0]).toContain('buffered one');
      expect(lines[1]).toContain('buffered two');
    });

    it('caps the buffer at 1000 entries to avoid unbounded memory growth (P3-11 raised ceiling) and prefers keeping WARN/ERROR over INFO when overflowing', () => {
      // First 1000 INFO entries — fills the buffer completely with INFO.
      for (let i = 0; i < 1000; i++) mainInfo('Scope', `info ${i}`);
      // Next 50 entries are INFO too — buffer is already full of INFO, so
      // every extra INFO is dropped immediately (it never evicts an older
      // INFO, because that would be a pointless ring-buffer shuffle).
      for (let i = 1000; i < 1050; i++) mainInfo('Scope', `info ${i}`);
      // Now emit 80 WARN lines. Because the new-INFO drop path short-circuits
      // above, the buffer is still 1000 INFO entries, and WARN/ERROR evicts
      // the oldest INFO entry available (policy: always preserve failure
      // signals over noisy INFO lines, bounded by the 1000-entry cap).
      for (let i = 0; i < 80; i++) mainWarn('Scope', `warn ${i}`);
      const lines: string[] = [];
      setMainLogListener((line) => lines.push(line));
      // Final total is still exactly 1000 — memory never grows unbounded.
      expect(lines).toHaveLength(1000);
      // All 80 WARN entries survived; 80 INFO entries were evicted instead.
      const warnCount = lines.filter((l) => l.includes('[WARN]')).length;
      expect(warnCount).toBe(80);
      // And any extra INFO beyond the first 1000 was dropped (not 1050 INFO).
      const infoCount = lines.filter((l) => l.includes('[INFO]')).length;
      expect(infoCount).toBe(920); // 1000 - 80 = 920 INFO left.
    });

    it('does not flush an empty buffer when a listener is attached', () => {
      const lines: string[] = [];
      setMainLogListener((line) => lines.push(line));
      expect(lines).toHaveLength(0);
    });
  });

  describe('catch helpers', () => {
    it('mainWarnFromCatch extracts the message from an Error and logs at WARN', () => {
      const lines: string[] = [];
      setMainLogListener((line) => lines.push(line));
      mainWarnFromCatch('Settings', new Error('parse failed'));
      expect(lines[0]).toContain('parse failed');
      expect(lines[0]).toContain('[WARN]');
    });

    it('mainWarnFromCatch prepends a prefix when provided', () => {
      const lines: string[] = [];
      setMainLogListener((line) => lines.push(line));
      mainWarnFromCatch('Settings', new Error('nope'), 'migration skipped');
      expect(lines[0]).toContain('migration skipped: nope');
    });

    it('mainWarnFromCatch stringifies non-Error values', () => {
      const lines: string[] = [];
      setMainLogListener((line) => lines.push(line));
      mainWarnFromCatch('Settings', 'plain string');
      expect(lines[0]).toContain('plain string');
    });

    it('mainErrorFromCatch extracts the message from an Error and logs at ERROR', () => {
      const lines: string[] = [];
      setMainLogListener((line) => lines.push(line));
      mainErrorFromCatch('Theme', new TypeError('bad type'), 'apply failed');
      expect(lines[0]).toContain('[ERROR]');
      expect(lines[0]).toContain('apply failed: bad type');
    });
  });

  describe('listener detach', () => {
    it('stops forwarding after the listener is set to null', () => {
      const lines: string[] = [];
      setMainLogListener((line) => lines.push(line));
      mainInfo('Scope', 'captured');
      setMainLogListener(null);
      mainInfo('Scope', 'not captured');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('captured');
    });
  });
});
