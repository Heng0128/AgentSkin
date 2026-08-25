// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  flushLocalePreference,
  loadLocalePreference,
  saveLocalePreference,
} from './locale-preferences';

let root = '';

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-locale-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('locale preferences', () => {
  it('detects English on first launch when system locale is en-US and persists it', async () => {
    await expect(loadLocalePreference(root, 'en-US')).resolves.toBe('en');
    await expect(fs.readFile(path.join(root, 'preferences.json'), 'utf8')).resolves.toContain(
      '"locale": "en"',
    );
  });

  it('detects Chinese on first launch when system locale is zh-CN', async () => {
    await expect(loadLocalePreference(root, 'zh-CN')).resolves.toBe('zh-CN');
  });

  it('falls back to Chinese for unsupported system languages', async () => {
    await expect(loadLocalePreference(root, 'fr-FR')).resolves.toBe('zh-CN');
  });

  it('keeps the saved user choice instead of following later system changes', async () => {
    await saveLocalePreference(root, 'zh-CN');
    await expect(loadLocalePreference(root, 'en-US')).resolves.toBe('zh-CN');
  });

  it('flushLocalePreference writes preferences synchronously', () => {
    flushLocalePreference(root, 'en');
    const content = fs.readFileSync(path.join(root, 'preferences.json'), 'utf8');
    expect(content).toContain('"locale": "en"');
  });

  it('flushLocalePreference overwrites previous locale', async () => {
    await saveLocalePreference(root, 'en');
    flushLocalePreference(root, 'zh-CN');
    const content = fs.readFileSync(path.join(root, 'preferences.json'), 'utf8');
    expect(content).toContain('"locale": "zh-CN"');
  });
});
