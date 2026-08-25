// SPDX-License-Identifier: MPL-2.0

/**
 * @vitest-environment node
 *
 * Unit tests for sce-parser — parses Sucrose Wallpaper Engine (SCE) projects
 * into the unified SceneData structure. SCE projects are directory-based with
 * a `project.json` describing particles, effects, and background.
 *
 * Strategy: fs/promises is mocked so parseSce() reads from in-memory fixtures
 * instead of disk. This gives fast, deterministic tests without temp files.
 *
 * Coverage targets:
 *   - parseSce: color background, image background, gradient background
 *   - parseSce: particles with various parameter combinations
 *   - parseSce: effects array mapping
 *   - parseSce: missing/malformed project.json
 *   - parseSceMetadata: title/author extraction
 *   - isSceProject: directory detection
 */

import type { Stats } from 'node:fs';
import fs from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isSceProject, parseSce, parseSceMetadata } from './sce-parser';

// ---------------------------------------------------------------------------
// Mock fs
// ---------------------------------------------------------------------------

vi.mock('node:fs/promises');

let mockFiles: Record<string, string | Buffer> = {};

function setMockFile(relPath: string, content: string | Buffer) {
  mockFiles[relPath.replace(/\\/g, '/')] = content;
}

function clearMockFiles() {
  mockFiles = {};
}

beforeEach(() => {
  clearMockFiles();
  vi.mocked(fs.readFile).mockImplementation(async (filePath: Parameters<typeof fs.readFile>[0]) => {
    const p = String(filePath).replace(/\\/g, '/');
    // Try direct match first, then resolve
    if (p in mockFiles) {
      const content = mockFiles[p];
      return content instanceof Buffer ? content : content;
    }
    // Try matching by suffix (for path.resolve scenarios)
    for (const [key, value] of Object.entries(mockFiles)) {
      if (p.endsWith(key) || p.includes(key)) {
        return value instanceof Buffer ? value : value;
      }
    }
    throw new Error(`ENOENT: no such file or directory, open '${p}'`);
  });
  vi.mocked(fs.stat).mockImplementation(async (filePath: Parameters<typeof fs.stat>[0]) => {
    const p = String(filePath).replace(/\\/g, '/');
    if (p.endsWith('project.json') && mockFiles[p.replace(/.*\/?/, '')] !== undefined) {
      return { isFile: () => true } as unknown as Stats;
    }
    // Check if any key matches
    for (const key of Object.keys(mockFiles)) {
      if (p.endsWith(key)) {
        return { isFile: () => true } as unknown as Stats;
      }
    }
    throw new Error(`ENOENT: no such file or directory, stat '${p}'`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal SCE project.json content. */
function makeProjectJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    title: 'Test Scene',
    author: 'TestAuthor',
    width: 1920,
    height: 1080,
    background: { type: 'color', color: '#336699' },
    particles: [],
    effects: [],
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// parseSce
// ---------------------------------------------------------------------------

describe('parseSce', () => {
  it('returns null when project.json does not exist', async () => {
    clearMockFiles();
    const result = await parseSce('/fake/sce-project');
    expect(result).toBeNull();
  });

  it('returns null when project.json is malformed JSON', async () => {
    setMockFile('project.json', '{ not valid json }');
    const result = await parseSce('/fake/sce-project');
    expect(result).toBeNull();
  });

  it('parses color background correctly', async () => {
    setMockFile(
      'project.json',
      makeProjectJson({
        background: { type: 'color', color: '#ff0000' },
      }),
    );
    const result = await parseSce('/fake/sce-project');
    expect(result).not.toBeNull();
    // #ff0000 → r:1, g:0, b:0
    expect(result!.general.clearColor.r).toBeCloseTo(1, 1);
    expect(result!.general.clearColor.g).toBeCloseTo(0, 1);
    expect(result!.general.clearColor.b).toBeCloseTo(0, 1);
  });

  it('parses dark color background (#000000)', async () => {
    setMockFile(
      'project.json',
      makeProjectJson({
        background: { type: 'color', color: '#000000' },
      }),
    );
    const result = await parseSce('/fake/sce-project');
    expect(result!.general.clearColor).toEqual({ r: 0, g: 0, b: 0 });
  });

  it('parses 3-digit hex color (#fff)', async () => {
    setMockFile(
      'project.json',
      makeProjectJson({
        background: { type: 'color', color: '#fff' },
      }),
    );
    const result = await parseSce('/fake/sce-project');
    expect(result!.general.clearColor.r).toBeCloseTo(1, 1);
    expect(result!.general.clearColor.g).toBeCloseTo(1, 1);
    expect(result!.general.clearColor.b).toBeCloseTo(1, 1);
  });

  it('parses gradient background', async () => {
    setMockFile(
      'project.json',
      makeProjectJson({
        background: { type: 'gradient', value: ['#ff0000', '#0000ff'], angle: 45 },
      }),
    );
    const result = await parseSce('/fake/sce-project');
    expect(result).not.toBeNull();
    const bg = result!.objects[0]; // background object is id=0
    expect(bg.name).toBe('background');
    expect(bg.config?.backgroundType).toBe('gradient');
    expect(bg.config?.gradient).toEqual({ stops: ['#ff0000', '#0000ff'], angle: 45 });
  });

  it('parses image background', async () => {
    setMockFile(
      'project.json',
      makeProjectJson({
        background: { type: 'image', image: 'bg/sky.png' },
      }),
    );
    // Mock the image file
    setMockFile('bg/sky.png', Buffer.from([0x89, 0x50, 0x4e, 0x47])); // PNG magic
    const result = await parseSce('/fake/sce-project');
    expect(result).not.toBeNull();
    const bg = result!.objects[0];
    expect(bg.config?.backgroundType).toBe('image');
    expect(bg.image).toBe('bg/sky.png');
  });

  it('parses particles with count, color, size', async () => {
    setMockFile(
      'project.json',
      makeProjectJson({
        particles: [
          {
            count: 100,
            color: '#00ff00',
            size: 10,
            speed: 5,
            velocity: { x: 1, y: 2 },
            alpha: 0.8,
            lifespan: 3000,
            emitter: { shape: 'box', width: 800, height: 600 },
          },
        ],
      }),
    );
    const result = await parseSce('/fake/sce-project');
    expect(result).not.toBeNull();
    // particle_1 is id=1
    const particle = result!.objects.find((o) => o.id === 1);
    expect(particle).toBeDefined();
    expect(particle!.name).toBe('particle_1');
    expect(particle!.config.rate).toBe(100);
    expect(particle!.config.sizeMin).toBe(5); // 10 * 0.5
    expect(particle!.config.sizeMax).toBe(10);
    expect(particle!.config.speed).toBe(5);
    expect(particle!.config.alpha || particle!.alpha).toBeDefined();
    expect(particle!.alpha).toBeCloseTo(0.8);
    expect(particle!.config.lifespan).toBe(3000);
  });

  it('parses particles with scalar size (min = size * 0.5)', async () => {
    setMockFile(
      'project.json',
      makeProjectJson({
        particles: [{ size: 20 }],
      }),
    );
    const result = await parseSce('/fake/sce-project');
    const particle = result!.objects.find((o) => o.id === 1);
    expect(particle!.config.sizeMin).toBe(10);
    expect(particle!.config.sizeMax).toBe(20);
  });

  it('parses particles with {min, max} size', async () => {
    setMockFile(
      'project.json',
      makeProjectJson({
        particles: [{ size: { min: 3, max: 15 } }],
      }),
    );
    const result = await parseSce('/fake/sce-project');
    const particle = result!.objects.find((o) => o.id === 1);
    expect(particle!.config.sizeMin).toBe(3);
    expect(particle!.config.sizeMax).toBe(15);
  });

  it('parses effects array', async () => {
    setMockFile(
      'project.json',
      makeProjectJson({
        effects: [
          { type: 'blur', radius: 5 },
          { type: 'bloom', intensity: 0.8 },
          { type: 'chromatic', offset: 3 },
          { type: 'scanlines', density: 200 },
          { type: 'vignette', strength: 0.5 },
          { type: 'noise', opacity: 0.2 },
          { type: 'colorgrade', tint: '#ff0000' },
        ],
      }),
    );
    const result = await parseSce('/fake/sce-project');
    expect(result).not.toBeNull();
    const bg = result!.objects[0];
    expect(bg.effects).toHaveLength(7);
    expect(bg.effects[0].name).toBe('blur');
    expect(bg.effects[0].passes[0].constantShaderValues.radius).toBe(5);
    expect(bg.effects[1].name).toBe('bloom');
    expect(bg.effects[1].passes[0].constantShaderValues.intensity).toBe(0.8);
    expect(bg.effects[2].name).toBe('chromatic');
    expect(bg.effects[2].passes[0].constantShaderValues.offset).toBe(3);
  });

  it('skips effects with unknown type gracefully', async () => {
    setMockFile(
      'project.json',
      makeProjectJson({
        effects: [
          // @ts-expect-error testing unknown type handling
          { type: 'unknown-effect' },
        ],
      }),
    );
    const result = await parseSce('/fake/sce-project');
    expect(result).not.toBeNull();
    const bg = result!.objects[0];
    expect(bg.effects).toHaveLength(1);
    expect(bg.effects[0].passes[0].constantShaderValues.intensity).toBe(0.5); // default
  });

  it('uses default dimensions when width/height missing', async () => {
    setMockFile('project.json', makeProjectJson({ width: undefined, height: undefined }));
    const result = await parseSce('/fake/sce-project');
    expect(result!.general.orthogonalProjection).toEqual({ width: 1920, height: 1080 });
  });

  it('uses custom dimensions when provided', async () => {
    setMockFile('project.json', makeProjectJson({ width: 3840, height: 2160 }));
    const result = await parseSce('/fake/sce-project');
    expect(result!.general.orthogonalProjection).toEqual({ width: 3840, height: 2160 });
  });

  it('returns null for non-object JSON (array)', async () => {
    setMockFile('project.json', JSON.stringify([1, 2, 3]));
    const result = await parseSce('/fake/sce-project');
    expect(result).toBeNull();
  });

  it('returns null for non-object JSON (string)', async () => {
    setMockFile('project.json', '"just a string"');
    const result = await parseSce('/fake/sce-project');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseSceMetadata
// ---------------------------------------------------------------------------

describe('parseSceMetadata', () => {
  it('extracts title and author from project.json', async () => {
    setMockFile(
      'project.json',
      JSON.stringify({
        title: 'My Awesome Scene',
        author: 'CreativeDev',
      }),
    );
    const result = await parseSceMetadata('/fake/sce-project');
    expect(result).not.toBeNull();
    expect(result!.title).toBe('My Awesome Scene');
    expect(result!.author).toBe('CreativeDev');
  });

  it('returns null when project.json is missing', async () => {
    clearMockFiles();
    const result = await parseSceMetadata('/fake/sce-project');
    expect(result).toBeNull();
  });

  it('returns null when project.json is malformed', async () => {
    setMockFile('project.json', '{ broken }');
    const result = await parseSceMetadata('/fake/sce-project');
    expect(result).toBeNull();
  });

  it('handles missing title/author gracefully', async () => {
    setMockFile('project.json', JSON.stringify({ width: 1920 }));
    const result = await parseSceMetadata('/fake/sce-project');
    expect(result).not.toBeNull();
    expect(result!.title).toBeUndefined();
    expect(result!.author).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// isSceProject
// ---------------------------------------------------------------------------

describe('isSceProject', () => {
  it('returns true when project.json exists as a file', async () => {
    setMockFile('project.json', '{}');
    const result = await isSceProject('/fake/sce-project');
    expect(result).toBe(true);
  });

  it('returns false when project.json does not exist', async () => {
    clearMockFiles();
    const result = await isSceProject('/fake/sce-project');
    expect(result).toBe(false);
  });
});
