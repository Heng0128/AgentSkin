// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadLocalePreference, saveLocalePreference } from './locale-preferences';

let root = '';

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-locale-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('locale preferences', () => {
  it('uses Chinese on first launch regardless of system locale and persists it', async () => {
    await expect(loadLocalePreference(root, 'en-US')).resolves.toBe('zh-CN');
    await expect(fs.readFile(path.join(root, 'preferences.json'), 'utf8')).resolves.toContain(
      '"locale": "zh-CN"',
    );
  });

  it('falls back to Chinese for unsupported system languages', async () => {
    await expect(loadLocalePreference(root, 'fr-FR')).resolves.toBe('zh-CN');
  });

  it('keeps the saved user choice instead of following later system changes', async () => {
    await saveLocalePreference(root, 'zh-CN');
    await expect(loadLocalePreference(root, 'en-US')).resolves.toBe('zh-CN');
  });
});
