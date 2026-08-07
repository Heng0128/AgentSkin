// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * settings.ts keeps a module-level cache (`settings`) and resolves its on-disk
 * path from process.env.APPDATA. Each test points APPDATA at a fresh temp dir
 * and re-imports the module (vi.resetModules) so the cache starts empty.
 */
describe('wallpaper settings (config/settings.ts)', () => {
  let tmpDir: string;
  let savedAppdata: string | undefined;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentskin-settings-'));
    savedAppdata = process.env.APPDATA;
    process.env.APPDATA = tmpDir;
    vi.resetModules();
  });

  afterEach(async () => {
    process.env.APPDATA = savedAppdata;
    vi.resetModules();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const settingsFile = (base: string) => path.join(base, 'AgentSkin', 'wallpaper-settings.json');

  it('returns the default threshold and writes a default config when no file exists', async () => {
    const { getImageBlobThresholdBytes } = await import('./settings');
    expect(getImageBlobThresholdBytes()).toBe(20 * 1024 * 1024);
    // The default config file should now exist on disk.
    const raw = await fs.readFile(settingsFile(tmpDir), 'utf8');
    expect(JSON.parse(raw).imageBlobThresholdMB).toBe(20);
  });

  it('reads a persisted custom threshold from the config file', async () => {
    await fs.mkdir(path.dirname(settingsFile(tmpDir)), { recursive: true });
    await fs.writeFile(
      settingsFile(tmpDir),
      JSON.stringify({ imageBlobThresholdMB: 5 }, null, 2),
      'utf8',
    );
    const { getImageBlobThresholdBytes } = await import('./settings');
    expect(getImageBlobThresholdBytes()).toBe(5 * 1024 * 1024);
  });

  it('updateSetting persists a new value to disk and reflects it in the cache', async () => {
    const { updateSetting, getImageBlobThresholdBytes } = await import('./settings');
    updateSetting('imageBlobThresholdMB', 8);
    expect(getImageBlobThresholdBytes()).toBe(8 * 1024 * 1024);
    const raw = await fs.readFile(settingsFile(tmpDir), 'utf8');
    expect(JSON.parse(raw).imageBlobThresholdMB).toBe(8);
  });

  it('updateSetting rejects a value of the wrong type', async () => {
    const { updateSetting } = await import('./settings');
    // The only known key expects a number; a string must throw.
    expect(() =>
      // @ts-expect-error — intentionally wrong type for runtime validation.
      updateSetting('imageBlobThresholdMB', 'big'),
    ).toThrow('Invalid type');
  });

  it('loadSettings falls back to defaults when the config file is invalid JSON', async () => {
    await fs.mkdir(path.dirname(settingsFile(tmpDir)), { recursive: true });
    await fs.writeFile(settingsFile(tmpDir), '{ not valid json !!!', 'utf8');
    const { getImageBlobThresholdBytes, loadSettings } = await import('./settings');
    expect(getImageBlobThresholdBytes()).toBe(20 * 1024 * 1024);
    // The cache is populated with a defaults object.
    expect(loadSettings().imageBlobThresholdMB).toBe(20);
  });

  it('loadSettings drops a type-mismatched field instead of using the bad value', async () => {
    await fs.mkdir(path.dirname(settingsFile(tmpDir)), { recursive: true });
    await fs.writeFile(
      settingsFile(tmpDir),
      JSON.stringify({ imageBlobThresholdMB: 'not-a-number' }, null, 2),
      'utf8',
    );
    const { loadSettings } = await import('./settings');
    const result = loadSettings();
    // The string value must not survive the type check — the field is removed.
    expect(typeof result.imageBlobThresholdMB).not.toBe('string');
  });

  it('loadSettings clamps an out-of-range threshold back to the default', async () => {
    await fs.mkdir(path.dirname(settingsFile(tmpDir)), { recursive: true });
    for (const bad of [-5, 0, 1e10, Number.NaN]) {
      // resetModules so each write is a fresh load
      vi.resetModules();
      await fs.writeFile(
        settingsFile(tmpDir),
        JSON.stringify({ imageBlobThresholdMB: bad }, null, 2),
        'utf8',
      );
      const { getImageBlobThresholdBytes } = await import('./settings');
      // Clamped to the default 20MB, never a nonsense cap.
      expect(getImageBlobThresholdBytes()).toBe(20 * 1024 * 1024);
    }
  });

  it('updateSetting rejects an out-of-range threshold', async () => {
    const { updateSetting } = await import('./settings');
    expect(() => updateSetting('imageBlobThresholdMB', 0)).toThrow(/between 1 and 1000/);
    expect(() => updateSetting('imageBlobThresholdMB', -3)).toThrow(/between 1 and 1000/);
    expect(() => updateSetting('imageBlobThresholdMB', 1e10)).toThrow(/between 1 and 1000/);
    // A valid value still persists.
    updateSetting('imageBlobThresholdMB', 100);
    const { getImageBlobThresholdBytes } = await import('./settings');
    expect(getImageBlobThresholdBytes()).toBe(100 * 1024 * 1024);
  });
});
