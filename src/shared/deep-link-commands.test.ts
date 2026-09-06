// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import {
  type DeepLinkCommand,
  isDeepLinkCommand,
  parseDeepLink,
  serializeDeepLink,
  validateApplyParams,
  validateInstallUrl,
  validateNavigatePage,
  validateOpenPath,
} from './deep-link-commands';

// ---------------------------------------------------------------------------
// isDeepLinkCommand
// ---------------------------------------------------------------------------

describe('isDeepLinkCommand', () => {
  it('accepts valid commands', () => {
    expect(isDeepLinkCommand('apply')).toBe(true);
    expect(isDeepLinkCommand('restore')).toBe(true);
    expect(isDeepLinkCommand('install')).toBe(true);
    expect(isDeepLinkCommand('open')).toBe(true);
    expect(isDeepLinkCommand('navigate')).toBe(true);
  });

  it('rejects unknown commands', () => {
    expect(isDeepLinkCommand('delete')).toBe(false);
    expect(isDeepLinkCommand('')).toBe(false);
    expect(isDeepLinkCommand('agentskin://')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// validateApplyParams
// ---------------------------------------------------------------------------

describe('validateApplyParams', () => {
  it('accepts valid theme ids', () => {
    expect(validateApplyParams('neon')).toBeNull();
    expect(validateApplyParams('dark-theme')).toBeNull();
    expect(validateApplyParams('theme_v2')).toBeNull();
    expect(validateApplyParams('Theme123')).toBeNull();
  });

  it('rejects theme ids with path separators', () => {
    expect(validateApplyParams('../etc/passwd')).toBeTruthy();
    expect(validateApplyParams('themes/../neon')).toBeTruthy();
    expect(validateApplyParams('neon/agent')).toBeTruthy();
  });

  it('accepts optional appId and schemeId', () => {
    expect(validateApplyParams('neon', 'codex')).toBeNull();
    expect(validateApplyParams('neon', 'codex', 'midnight')).toBeNull();
  });

  it('rejects empty appId', () => {
    expect(validateApplyParams('neon', '')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// validateInstallUrl
// ---------------------------------------------------------------------------

describe('validateInstallUrl', () => {
  it('accepts https URLs', () => {
    expect(validateInstallUrl('https://example.com/theme.agentskin-theme')).toBeNull();
  });

  it('accepts http URLs', () => {
    expect(validateInstallUrl('http://localhost:3000/theme.agentskin-theme')).toBeNull();
  });

  it('rejects non-http protocols', () => {
    expect(validateInstallUrl('file:///etc/passwd')).toBeTruthy();
    expect(validateInstallUrl('ftp://example.com/theme')).toBeTruthy();
  });

  it('rejects malformed URLs', () => {
    expect(validateInstallUrl('not-a-url')).toBeTruthy();
  });

  it('rejects URLs with embedded credentials', () => {
    expect(validateInstallUrl('https://user:pass@example.com/theme')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// validateOpenPath
// ---------------------------------------------------------------------------

describe('validateOpenPath', () => {
  it('accepts absolute unix paths', () => {
    expect(validateOpenPath('/home/user/themes/neon.agentskin-theme')).toBeNull();
  });

  it('accepts absolute windows paths', () => {
    expect(validateOpenPath('C:\\Users\\user\\themes\\neon.agentskin-theme')).toBeNull();
    expect(validateOpenPath('D:\\themes\\neon.agentskin-theme')).toBeNull();
  });

  it('rejects relative paths', () => {
    expect(validateOpenPath('themes/neon.agentskin-theme')).toBeTruthy();
    expect(validateOpenPath('./themes/neon.agentskin-theme')).toBeTruthy();
  });

  it('rejects paths with traversal', () => {
    expect(validateOpenPath('/home/user/../../etc/passwd')).toBeTruthy();
    expect(validateOpenPath('C:\\Users\\..\\Windows\\System32')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// validateNavigatePage
// ---------------------------------------------------------------------------

describe('validateNavigatePage', () => {
  it('accepts valid page names', () => {
    expect(validateNavigatePage('dashboard')).toBeNull();
    expect(validateNavigatePage('themes')).toBeNull();
    expect(validateNavigatePage('wallpaper')).toBeNull();
    expect(validateNavigatePage('settings')).toBeNull();
    expect(validateNavigatePage('agents')).toBeNull();
    expect(validateNavigatePage('workspace')).toBeNull();
  });

  it('rejects unknown page names', () => {
    expect(validateNavigatePage('admin')).toBeTruthy();
    expect(validateNavigatePage('')).toBeTruthy();
    expect(validateNavigatePage('../etc')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// parseDeepLink
// ---------------------------------------------------------------------------

describe('parseDeepLink', () => {
  it('parses apply command with themeId', () => {
    const cmd = parseDeepLink('agentskin://apply/neon');
    expect(cmd).toEqual({ command: 'apply', themeId: 'neon' });
  });

  it('parses apply command with themeId and appId', () => {
    const cmd = parseDeepLink('agentskin://apply/neon?app=codex');
    expect(cmd).toEqual({ command: 'apply', themeId: 'neon', appId: 'codex' });
  });

  it('parses apply command with themeId, appId, and schemeId', () => {
    const cmd = parseDeepLink('agentskin://apply/neon?app=codex&scheme=midnight');
    expect(cmd).toEqual({
      command: 'apply',
      themeId: 'neon',
      appId: 'codex',
      schemeId: 'midnight',
    });
  });

  it('parses restore command', () => {
    const cmd = parseDeepLink('agentskin://restore');
    expect(cmd).toEqual({ command: 'restore' });
  });

  it('parses restore command with appId', () => {
    const cmd = parseDeepLink('agentskin://restore?app=traework');
    expect(cmd).toEqual({ command: 'restore', appId: 'traework' });
  });

  it('parses install command', () => {
    const cmd = parseDeepLink('agentskin://install?url=https://example.com/theme.agentskin-theme');
    expect(cmd).toEqual({
      command: 'install',
      url: 'https://example.com/theme.agentskin-theme',
    });
  });

  it('parses open command', () => {
    const cmd = parseDeepLink('agentskin://open?path=/home/user/themes/neon.agentskin-theme');
    expect(cmd).toEqual({
      command: 'open',
      path: '/home/user/themes/neon.agentskin-theme',
    });
  });

  it('parses navigate command', () => {
    const cmd = parseDeepLink('agentskin://navigate/themes');
    expect(cmd).toEqual({ command: 'navigate', page: 'themes' });
  });

  it('rejects non-agentskin URLs', () => {
    expect(() => parseDeepLink('https://example.com')).toThrow();
    expect(() => parseDeepLink('agentskin-theme://cover/neon')).toThrow();
  });

  it('rejects unknown commands', () => {
    expect(() => parseDeepLink('agentskin://delete/neon')).toThrow();
  });

  it('rejects apply without themeId', () => {
    expect(() => parseDeepLink('agentskin://apply')).toThrow();
  });

  it('rejects apply with invalid themeId', () => {
    expect(() => parseDeepLink('agentskin://apply/../../etc/passwd')).toThrow();
  });

  it('rejects install without url', () => {
    expect(() => parseDeepLink('agentskin://install')).toThrow();
  });

  it('rejects install with non-http url', () => {
    expect(() => parseDeepLink('agentskin://install?url=file:///etc/passwd')).toThrow();
  });

  it('rejects open without path', () => {
    expect(() => parseDeepLink('agentskin://open')).toThrow();
  });

  it('rejects navigate with invalid page', () => {
    expect(() => parseDeepLink('agentskin://navigate/unknown')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// serializeDeepLink (round-trip)
// ---------------------------------------------------------------------------

describe('serializeDeepLink', () => {
  it('serializes apply command without optional params', () => {
    const cmd: DeepLinkCommand = { command: 'apply', themeId: 'neon' };
    expect(serializeDeepLink(cmd)).toBe('agentskin://apply/neon');
  });

  it('serializes apply command with appId', () => {
    const cmd: DeepLinkCommand = { command: 'apply', themeId: 'neon', appId: 'codex' };
    const url = serializeDeepLink(cmd);
    expect(url).toContain('agentskin://apply/neon');
    expect(url).toContain('app=codex');
  });

  it('serializes apply command with schemeId', () => {
    const cmd: DeepLinkCommand = {
      command: 'apply',
      themeId: 'neon',
      appId: 'codex',
      schemeId: 'midnight',
    };
    const url = serializeDeepLink(cmd);
    expect(url).toContain('agentskin://apply/neon');
    expect(url).toContain('app=codex');
    expect(url).toContain('scheme=midnight');
  });

  it('serializes restore command without appId', () => {
    const cmd: DeepLinkCommand = { command: 'restore' };
    expect(serializeDeepLink(cmd)).toBe('agentskin://restore');
  });

  it('serializes restore command with appId', () => {
    const cmd: DeepLinkCommand = { command: 'restore', appId: 'traework' };
    expect(serializeDeepLink(cmd)).toBe('agentskin://restore?app=traework');
  });

  it('serializes install command', () => {
    const cmd: DeepLinkCommand = {
      command: 'install',
      url: 'https://example.com/theme.agentskin-theme',
    };
    const url = serializeDeepLink(cmd);
    expect(url).toContain('agentskin://install');
    expect(url).toContain('url=');
  });

  it('serializes open command', () => {
    const cmd: DeepLinkCommand = {
      command: 'open',
      path: '/home/user/themes/neon.agentskin-theme',
    };
    const url = serializeDeepLink(cmd);
    expect(url).toContain('agentskin://open');
    expect(url).toContain('path=');
  });

  it('serializes navigate command', () => {
    const cmd: DeepLinkCommand = { command: 'navigate', page: 'themes' };
    expect(serializeDeepLink(cmd)).toBe('agentskin://navigate/themes');
  });
});

// ---------------------------------------------------------------------------
// Round-trip: parse -> serialize -> re-parse
// ---------------------------------------------------------------------------

describe('round-trip parse/serialize', () => {
  const cases: DeepLinkCommand[] = [
    { command: 'apply', themeId: 'neon' },
    { command: 'apply', themeId: 'dark-theme', appId: 'codex', schemeId: 'midnight' },
    { command: 'restore' },
    { command: 'restore', appId: 'traework' },
    { command: 'install', url: 'https://example.com/theme.agentskin-theme' },
    { command: 'open', path: '/home/user/themes/neon.agentskin-theme' },
    { command: 'navigate', page: 'wallpaper' },
  ];

  for (const cmd of cases) {
    it(`round-trips ${cmd.command}`, () => {
      const url = serializeDeepLink(cmd);
      expect(() => parseDeepLink(url)).not.toThrow();
      const reparsed = parseDeepLink(url);
      expect(reparsed).toEqual(cmd);
    });
  }
});
