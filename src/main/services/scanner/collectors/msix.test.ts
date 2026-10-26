// SPDX-License-Identifier: MPL-2.0

/**
 * Unit tests for the L2.5 MSIX + L3.5 Start-menu shortcut collectors.
 * Covers the pure parsing/ranking helpers; the PowerShell sweeps themselves
 * are integration territory (hermetically mocked in electron-scanner.test.ts
 * for the orchestration layer).
 */

import { describe, expect, it } from 'vitest';
import { parseMsixLine } from './msix';
import { nameFromShortcut, parseShortcutLine } from './shortcut';

describe('parseMsixLine', () => {
  it('parses a full sweep line', () => {
    const entry = parseMsixLine(
      'ChatGPT|OpenAI.ChatGPT-Desktop|C:\\Program Files\\WindowsApps\\OpenAI.ChatGPT-Desktop_1.2.3_x64__abcde|1.2.3.0|C:\\...\\app\\ChatGPT.exe|C:\\...\\Assets',
    );
    expect(entry).not.toBeNull();
    expect(entry?.displayName).toBe('ChatGPT');
    expect(entry?.packageName).toBe('OpenAI.ChatGPT-Desktop');
    expect(entry?.version).toBe('1.2.3.0');
    expect(entry?.exePath).toContain('ChatGPT.exe');
    expect(entry?.assetsDir).toContain('Assets');
  });

  it('returns null for short or exe-less lines', () => {
    expect(parseMsixLine('a|b|c')).toBeNull();
    expect(parseMsixLine('a|b||1.0.0||')).toBeNull();
  });
});

describe('parseShortcutLine', () => {
  it('parses lnk|target|icon output', () => {
    const s = parseShortcutLine(
      'C:\\StartMenu\\微信开发者工具.lnk|D:\\tools\\wechat_devtools.exe|D:\\tools\\icon.ico',
    );
    expect(s?.lnkPath).toContain('微信开发者工具.lnk');
    expect(s?.targetPath).toBe('D:\\tools\\wechat_devtools.exe');
    expect(s?.iconPath).toBe('D:\\tools\\icon.ico');
  });

  it('returns null when target is missing', () => {
    expect(parseShortcutLine('C:\\a.lnk||')).toBeNull();
    expect(parseShortcutLine('garbage')).toBeNull();
  });
});

describe('nameFromShortcut', () => {
  it('strips the .lnk extension and keeps the localized name', () => {
    expect(nameFromShortcut('C:\\SM\\微信开发者工具.lnk')).toBe('微信开发者工具');
    expect(nameFromShortcut('C:\\SM\\Docker Desktop.lnk')).toBe('Docker Desktop');
  });
});
