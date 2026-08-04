// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { extractThemeFilesFromArgv, FileOpenQueue, isThemePackagePath } from './file-open';

describe('isThemePackagePath', () => {
  it('accepts both theme package extensions', () => {
    expect(isThemePackagePath('/tmp/neon.agenttheme')).toBe(true);
    expect(isThemePackagePath('/tmp/neon.agentskin-theme')).toBe(true);
    expect(isThemePackagePath('C:\\themes\\retro.codex-theme')).toBe(true);
  });

  it('rejects other files', () => {
    expect(isThemePackagePath('/tmp/readme.md')).toBe(false);
    expect(isThemePackagePath('agentskin://themes/apply?theme=neon')).toBe(false);
    expect(isThemePackagePath('/tmp/neon.agentskin-theme.bak')).toBe(false);
  });
});

describe('extractThemeFilesFromArgv', () => {
  const argv = [
    'AgentSkin.exe',
    '--allow-file-access',
    'C:\\Downloads\\neon.agentskin-theme',
    'agentskin://themes/apply?theme=neon&app=codex',
    '/tmp/legacy.codex-theme',
    '/tmp/missing.agentskin-theme',
  ];

  it('returns only existing theme package arguments', () => {
    const exists = (candidate: string) => !candidate.includes('missing');
    expect(extractThemeFilesFromArgv(argv, exists)).toEqual([
      'C:\\Downloads\\neon.agentskin-theme',
      '/tmp/legacy.codex-theme',
    ]);
  });

  it('drops theme-looking arguments that are not on disk', () => {
    expect(extractThemeFilesFromArgv(argv, () => false)).toEqual([]);
  });
});

describe('FileOpenQueue', () => {
  it('queues paths until a sink is attached, then flushes in order', () => {
    const queue = new FileOpenQueue();
    expect(queue.handlePath('/tmp/a.agentskin-theme')).toBe(true);
    expect(queue.handlePath('/tmp/b.codex-theme')).toBe(true);
    const received: string[] = [];
    queue.setSink((filePath) => received.push(filePath));
    expect(received).toEqual(['/tmp/a.agentskin-theme', '/tmp/b.codex-theme']);
  });

  it('delivers directly once a sink is attached', () => {
    const queue = new FileOpenQueue();
    const received: string[] = [];
    queue.setSink((filePath) => received.push(filePath));
    queue.handlePath('/tmp/c.agentskin-theme');
    expect(received).toEqual(['/tmp/c.agentskin-theme']);
  });

  it('ignores non-theme paths', () => {
    const queue = new FileOpenQueue();
    const received: string[] = [];
    queue.setSink((filePath) => received.push(filePath));
    expect(queue.handlePath('/tmp/note.txt')).toBe(false);
    expect(received).toEqual([]);
  });
});
