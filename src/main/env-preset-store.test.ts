// SPDX-License-Identifier: MPL-2.0

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EnvironmentPreset } from '../shared/types/environment';
import { envPresetsPath, loadEnvPresets, saveEnvPresets } from './env-preset-store';

function makePreset(over: Partial<EnvironmentPreset> = {}): EnvironmentPreset {
  const now = new Date().toISOString();
  return {
    id: 'p1',
    name: 'Frontend Studio',
    agentId: 'doubao',
    themeId: null,
    wallpaperId: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

describe('env-preset-store', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'envpreset-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns [] when the preset file is missing', async () => {
    expect(await loadEnvPresets(dir)).toEqual([]);
  });

  it('round-trips presets including wallpaperId', async () => {
    const p = makePreset({ wallpaperId: 'wp-123' });
    expect(await saveEnvPresets(dir, [p])).toBe(true);
    const loaded = await loadEnvPresets(dir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.wallpaperId).toBe('wp-123');
  });

  it('back-fills wallpaperId: null for legacy (v1) entries', async () => {
    const legacy = {
      v: 1,
      presets: [
        { id: 'p1', name: 'n', agentId: 'doubao', themeId: null, createdAt: 't', updatedAt: 't' },
      ],
    };
    writeFileSync(envPresetsPath(dir), JSON.stringify(legacy));
    const loaded = await loadEnvPresets(dir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.wallpaperId).toBeNull();
  });

  it('drops presets that fail field validation', async () => {
    const bad = { v: 2, presets: [{ id: 'x' }] };
    writeFileSync(envPresetsPath(dir), JSON.stringify(bad));
    expect(await loadEnvPresets(dir)).toEqual([]);
  });

  it('persists under schema version 2', async () => {
    await saveEnvPresets(dir, [makePreset()]);
    const raw = JSON.parse(readFileSync(envPresetsPath(dir), 'utf8')) as { v: number };
    expect(raw.v).toBe(2);
  });

  it('saveEnvPresets tolerates non-array input', async () => {
    // @ts-expect-error testing runtime guard
    expect(await saveEnvPresets(dir, undefined)).toBe(true);
    const loaded = await loadEnvPresets(dir);
    expect(loaded).toEqual([]);
  });

  it('saveEnvPresets filters out malformed / oversized entries (G2)', async () => {
    const good = makePreset({ id: 'good' });
    const badType = { id: 'x', name: 42 };
    const oversized = { ...makePreset({ id: 'big' }), name: 'x'.repeat(600) };
    await saveEnvPresets(dir, [
      good,
      badType as unknown as EnvironmentPreset,
      oversized as unknown as EnvironmentPreset,
    ]);
    const loaded = await loadEnvPresets(dir);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.id).toBe('good');
  });
});
