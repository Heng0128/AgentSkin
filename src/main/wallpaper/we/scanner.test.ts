// SPDX-License-Identifier: MPL-2.0

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { mapWithConcurrency, scanWorkshop } from './scanner';

let tmpRoot: string;

afterEach(async () => {
  if (tmpRoot) await fs.rm(tmpRoot, { recursive: true, force: true });
  tmpRoot = '';
});

describe('mapWithConcurrency', () => {
  it('preserves input order in the result', async () => {
    const result = await mapWithConcurrency([3, 1, 2], 2, async (n) => {
      // Delay inversely to input value so a naive "resolve in order of
      // completion" would scramble the output.
      await new Promise((r) => setTimeout(r, (4 - n) * 5));
      return n * 10;
    });
    expect(result).toEqual([30, 10, 20]);
  });

  it('never runs more than `limit` tasks concurrently', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    await mapWithConcurrency(
      Array.from({ length: 10 }, (_, i) => i),
      3,
      async (n) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight--;
        return n;
      },
    );
    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(1); // actually parallel
  });

  it('handles empty input', async () => {
    await expect(mapWithConcurrency([], 4, async (n: number) => n)).resolves.toEqual([]);
  });

  it('propagates a task rejection', async () => {
    await expect(
      mapWithConcurrency([1, 2], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });
});

describe('scanWorkshop', () => {
  it('discovers image wallpapers from workshop-style directories', async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'scan-workshop-'));
    const wp1 = path.join(tmpRoot, '111111');
    const wp2 = path.join(tmpRoot, '222222');
    await fs.mkdir(wp1, { recursive: true });
    await fs.mkdir(wp2, { recursive: true });
    await fs.writeFile(path.join(wp1, 'wallpaper.png'), Buffer.from('png'));
    await fs.writeFile(
      path.join(wp2, 'project.json'),
      JSON.stringify({ type: 'video', file: 'a.mp4' }),
    );
    await fs.writeFile(path.join(wp2, 'a.mp4'), Buffer.from('mp4'));

    const items = await scanWorkshop(tmpRoot);
    expect(items.size).toBe(2);
    expect(items.has('111111')).toBe(true);
    expect(items.get('111111')!.type).toBe('image');
    expect(items.get('222222')!.type).toBe('video');
  });

  it('returns an empty map for an unreadable root', async () => {
    const missing = path.join(os.tmpdir(), `does-not-exist-${Date.now()}`);
    await expect(scanWorkshop(missing)).resolves.toEqual(new Map());
  });
});
