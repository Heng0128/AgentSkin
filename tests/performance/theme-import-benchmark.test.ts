// SPDX-License-Identifier: MPL-2.0

/**
 * # Theme Import Pipeline — Performance Benchmark
 *
 * Measures parsing performance for all four parsers, the registry lookup,
 * and the end-to-end import flow.
 *
 * ## Thresholds
 * - Single parser parse: < 50ms
 * - Registry findParser: < 5ms
 * - End-to-end import: < 200ms
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { agentskinBuiltParser } from '../../src/shared/import/parsers/agentskin-built-parser';
import { codedrobeParser } from '../../src/shared/import/parsers/codedrobe-parser';
import { dreamskinParser } from '../../src/shared/import/parsers/dreamskin-parser';
import { sourceDirectoryParser } from '../../src/shared/import/parsers/source-directory-parser';
import type { ParserSource } from '../../src/shared/import/theme-source-parser';
import { ParserRegistry } from '../../src/shared/import/theme-source-parser';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of iterations for each benchmark. */
const ITERATIONS = 100;

/** Maximum allowed time for a single parser parse (ms). */
const PARSE_THRESHOLD_MS = 50;

/** Maximum allowed time for a registry findParser call (ms). */
const REGISTRY_LOOKUP_THRESHOLD_MS = 5;

/** Maximum allowed time for end-to-end import (ms). */
const E2E_THRESHOLD_MS = 200;

// ---------------------------------------------------------------------------
// Benchmark helper
// ---------------------------------------------------------------------------

/**
 * Run an async function `iterations` times and return timing statistics.
 *
 * Returns average, median, min, max, and total time in milliseconds.
 */
async function benchmark(
  fn: () => Promise<void>,
  iterations: number = ITERATIONS,
): Promise<{
  avg: number;
  median: number;
  min: number;
  max: number;
  total: number;
}> {
  const times: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    const end = performance.now();
    times.push(end - start);
  }

  times.sort((a, b) => a - b);

  const total = times.reduce((sum, t) => sum + t, 0);
  const avg = total / times.length;
  const median = times[Math.floor(times.length / 2)];
  const min = times[0];
  const max = times[times.length - 1];

  return { avg, median, min, max, total };
}

// ---------------------------------------------------------------------------
// Test data builders
// ---------------------------------------------------------------------------

/** Build a realistic codedrobe-theme JSON source. */
function buildCodedrobeSource(): ParserSource {
  return {
    json: {
      format: 'codedrobe-theme',
      schemaVersion: '1.0',
      exportedAt: '2026-01-01T00:00:00Z',
      theme: {
        id: 'benchmark-codedrobe',
        displayName: 'Benchmark Codedrobe Theme',
        version: '1.0.0',
        catalog: {
          name: { en: 'Benchmark Codedrobe', zh: '基准测试 Codedrobe' },
          description: { en: 'A theme for benchmarking', zh: '用于基准测试的主题' },
          categories: ['benchmark', 'test'],
        },
      },
      targets: {
        codex: { css: ':root.codedrobe-codex-skin { --accent: #39c5bb; --bg: #0a0a0a; }' },
        traework: { css: ':root.codedrobe-traework-skin { --accent: #39c5bb; --bg: #0a0a0a; }' },
        qoderwork: { css: ':root.codedrobe-qoderwork-skin { --accent: #39c5bb; --bg: #0a0a0a; }' },
        workbuddy: { css: ':root.codedrobe-workbuddy-skin { --accent: #39c5bb; --bg: #0a0a0a; }' },
        doubao: { css: ':root.codedrobe-doubao-skin { --accent: #39c5bb; --bg: #0a0a0a; }' },
        zcode: { css: ':root.codedrobe-zcode-skin { --accent: #39c5bb; --bg: #0a0a0a; }' },
      },
      assets: {
        images: {
          hero: {
            filename: 'hero.png',
            mimeType: 'image/png',
            base64:
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
          },
          texture: {
            filename: 'texture.png',
            mimeType: 'image/png',
            base64:
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
          },
        },
      },
    },
  };
}

/** Build a realistic DreamSkin file map source. */
function buildDreamskinSource(): ParserSource {
  const files = new Map<string, Uint8Array>();
  const encoder = new TextEncoder();

  const themeJson = {
    name: 'Benchmark DreamSkin',
    author: 'benchmark_user',
    version: '1.0.0',
    description: 'A theme for benchmarking',
    image: 'hero.png',
    css: 'theme.css',
    tags: ['benchmark', 'test'],
    category: 'benchmark',
    colors: {
      accent: '#ff0080',
      background: '#0a0a0a',
      foreground: '#ffffff',
      surface: '#1a1a1a',
      muted: '#666666',
      border: '#333333',
    },
  };

  files.set('theme.json', encoder.encode(JSON.stringify(themeJson)));
  files.set(
    'theme.css',
    encoder.encode(
      ':root { --ds-accent: #ff0080; --ds-bg: #0a0a0a; --ds-fg: #ffffff; color-scheme: dark; }',
    ),
  );
  // 1x1 PNG
  files.set(
    'hero.png',
    new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00, 0x00, 0x90,
      0x77, 0x53, 0xde,
    ]),
  );

  return { files };
}

/** Build a realistic agentskin-theme file map source. */
function buildAgentskinSource(): ParserSource {
  const files = new Map<string, Uint8Array>();
  const encoder = new TextEncoder();

  const manifest = {
    id: 'benchmark-agentskin',
    name: 'benchmark-agentskin',
    displayName: 'Benchmark Agentskin Theme',
    version: '1.0.0',
    author: { name: 'Benchmark Author', url: 'https://example.com' },
    mode: 'dark',
    category: 'benchmark',
    tags: ['benchmark', 'test', 'dark'],
    colors: {
      accent: '#0077b6',
      secondary: '#00b4d8',
      background: '#03045e',
      foreground: '#caf0f8',
      muted: '#90e0ef',
      surface: '#023e8a',
      surfaceElevated: '#0077b6',
      border: '#0096c7',
      codeBackground: '#023e8a',
      codeForeground: '#caf0f8',
      inputBackground: '#03045e',
      buttonBackground: '#0077b6',
      buttonForeground: '#caf0f8',
      focusRing: '#00b4d8',
    },
    targets: {
      traework: { css: 'assets/css/traework.css' },
      codex: { css: 'assets/css/codex.css' },
      qoderwork: { css: 'assets/css/qoderwork.css' },
      workbuddy: { css: 'assets/css/workbuddy.css' },
      doubao: { css: 'assets/css/doubao.css' },
      zcode: { css: 'assets/css/zcode.css' },
    },
    assets: {
      images: {
        decoration1: 'assets/images/deco1.png',
        texture1: 'assets/images/texture1.png',
      },
    },
  };

  files.set('manifest.json', encoder.encode(JSON.stringify(manifest)));
  files.set(
    'assets/css/traework.css',
    encoder.encode(':root { --agentskin-accent: #0077b6; --agentskin-bg: #03045e; }'),
  );
  files.set(
    'assets/css/codex.css',
    encoder.encode(':root { --agentskin-accent: #0077b6; --agentskin-bg: #03045e; }'),
  );
  files.set(
    'assets/css/qoderwork.css',
    encoder.encode(':root { --agentskin-accent: #0077b6; --agentskin-bg: #03045e; }'),
  );
  files.set(
    'assets/css/workbuddy.css',
    encoder.encode(':root { --agentskin-accent: #0077b6; --agentskin-bg: #03045e; }'),
  );
  files.set(
    'assets/css/doubao.css',
    encoder.encode(':root { --agentskin-accent: #0077b6; --agentskin-bg: #03045e; }'),
  );
  files.set(
    'assets/css/zcode.css',
    encoder.encode(':root { --agentskin-accent: #0077b6; --agentskin-bg: #03045e; }'),
  );
  files.set('assets/images/deco1.png', new Uint8Array(50_000));
  files.set('assets/images/texture1.png', new Uint8Array(150_000));

  return { files };
}

/** Build a realistic source directory file map source. */
function buildSourceDirectorySource(): ParserSource {
  const files = new Map<string, Uint8Array>();
  const encoder = new TextEncoder();

  const manifest = {
    id: 'benchmark-source-dir',
    displayName: 'Benchmark Source Directory',
    version: '1.0.0',
    author: { name: 'Benchmark Dev' },
    mode: 'light',
    category: 'benchmark',
    tags: ['benchmark', 'light', 'nature'],
    colors: {
      accent: '#2d6a4f',
      background: '#f0fff0',
      foreground: '#1b4332',
      surface: '#d8f3dc',
      muted: '#52b788',
      border: '#95d5b2',
    },
  };

  files.set('manifest.json', encoder.encode(JSON.stringify(manifest)));
  files.set(
    'theme.css',
    encoder.encode(':root { --accent: #2d6a4f; --bg: #f0fff0; --fg: #1b4332; }'),
  );
  files.set('icon.png', new Uint8Array(20_000));
  files.set('preview.png', new Uint8Array(80_000));
  files.set('hero.png', new Uint8Array(200_000));

  return { files };
}

// ---------------------------------------------------------------------------
// 1. Parser Performance Tests
// ---------------------------------------------------------------------------

describe('Parser Performance', () => {
  describe('CodedrobeParser', () => {
    it('should parse within 50ms threshold', async () => {
      const source = buildCodedrobeSource();
      const stats = await benchmark(() => codedrobeParser.parse(source));

      expect(stats.avg).toBeLessThan(PARSE_THRESHOLD_MS);
      // Log for visibility (not a failure, just informational)
      // eslint-disable-next-line no-console
      console.log(
        `[CodedrobeParser] avg=${stats.avg.toFixed(3)}ms median=${stats.median.toFixed(3)}ms min=${stats.min.toFixed(3)}ms max=${stats.max.toFixed(3)}ms`,
      );
    });
  });

  describe('DreamSkinParser', () => {
    it('should parse within 50ms threshold', async () => {
      const source = buildDreamskinSource();
      const stats = await benchmark(() => dreamskinParser.parse(source));

      expect(stats.avg).toBeLessThan(PARSE_THRESHOLD_MS);
      // eslint-disable-next-line no-console
      console.log(
        `[DreamSkinParser] avg=${stats.avg.toFixed(3)}ms median=${stats.median.toFixed(3)}ms min=${stats.min.toFixed(3)}ms max=${stats.max.toFixed(3)}ms`,
      );
    });
  });

  describe('AgentskinBuiltParser', () => {
    it('should parse within 50ms threshold', async () => {
      const source = buildAgentskinSource();
      const stats = await benchmark(() => agentskinBuiltParser.parse(source));

      expect(stats.avg).toBeLessThan(PARSE_THRESHOLD_MS);
      // eslint-disable-next-line no-console
      console.log(
        `[AgentskinBuiltParser] avg=${stats.avg.toFixed(3)}ms median=${stats.median.toFixed(3)}ms min=${stats.min.toFixed(3)}ms max=${stats.max.toFixed(3)}ms`,
      );
    });
  });

  describe('SourceDirectoryParser', () => {
    it('should parse within 50ms threshold', async () => {
      const source = buildSourceDirectorySource();
      const stats = await benchmark(() => sourceDirectoryParser.parse(source));

      expect(stats.avg).toBeLessThan(PARSE_THRESHOLD_MS);
      // eslint-disable-next-line no-console
      console.log(
        `[SourceDirectoryParser] avg=${stats.avg.toFixed(3)}ms median=${stats.median.toFixed(3)}ms min=${stats.min.toFixed(3)}ms max=${stats.max.toFixed(3)}ms`,
      );
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Registry Performance Tests
// ---------------------------------------------------------------------------

describe('Registry Performance', () => {
  let registry: ParserRegistry;

  beforeEach(() => {
    registry = new ParserRegistry();
    registry.register(agentskinBuiltParser, 5);
    registry.register(codedrobeParser, 10);
    registry.register(dreamskinParser, 20);
    registry.register(sourceDirectoryParser, 100);
  });

  describe('findParser', () => {
    it('should find parser for codedrobe source within 5ms threshold', async () => {
      const source = buildCodedrobeSource();
      const stats = await benchmark(() => registry.findParser(source));

      expect(stats.avg).toBeLessThan(REGISTRY_LOOKUP_THRESHOLD_MS);
      // eslint-disable-next-line no-console
      console.log(
        `[Registry.findParser/codedrobe] avg=${stats.avg.toFixed(3)}ms median=${stats.median.toFixed(3)}ms min=${stats.min.toFixed(3)}ms max=${stats.max.toFixed(3)}ms`,
      );
    });

    it('should find parser for dreamskin source within 5ms threshold', async () => {
      const source = buildDreamskinSource();
      const stats = await benchmark(() => registry.findParser(source));

      expect(stats.avg).toBeLessThan(REGISTRY_LOOKUP_THRESHOLD_MS);
      // eslint-disable-next-line no-console
      console.log(
        `[Registry.findParser/dreamskin] avg=${stats.avg.toFixed(3)}ms median=${stats.median.toFixed(3)}ms min=${stats.min.toFixed(3)}ms max=${stats.max.toFixed(3)}ms`,
      );
    });

    it('should find parser for agentskin source within 5ms threshold', async () => {
      const source = buildAgentskinSource();
      const stats = await benchmark(() => registry.findParser(source));

      expect(stats.avg).toBeLessThan(REGISTRY_LOOKUP_THRESHOLD_MS);
      // eslint-disable-next-line no-console
      console.log(
        `[Registry.findParser/agentskin] avg=${stats.avg.toFixed(3)}ms median=${stats.median.toFixed(3)}ms min=${stats.min.toFixed(3)}ms max=${stats.max.toFixed(3)}ms`,
      );
    });

    it('should find parser for source-directory source within 5ms threshold', async () => {
      const source = buildSourceDirectorySource();
      const stats = await benchmark(() => registry.findParser(source));

      expect(stats.avg).toBeLessThan(REGISTRY_LOOKUP_THRESHOLD_MS);
      // eslint-disable-next-line no-console
      console.log(
        `[Registry.findParser/source-directory] avg=${stats.avg.toFixed(3)}ms median=${stats.median.toFixed(3)}ms min=${stats.min.toFixed(3)}ms max=${stats.max.toFixed(3)}ms`,
      );
    });
  });

  describe('register / unregister', () => {
    it('should register a parser within 5ms threshold', async () => {
      // Create a fresh registry for this test to avoid polluting others
      const freshRegistry = new ParserRegistry();
      const parser = {
        name: 'benchmark-parser',
        description: 'Benchmark parser',
        extensions: ['.bench'],
        canParse: () => true,
        parse: async () => ({
          id: 'bench',
          displayName: 'Bench',
          version: '1.0.0',
          author: { name: 'Bench' },
          mode: 'dark' as const,
          colors: {},
          images: {},
          agentCss: {},
          sourceFormat: 'bench',
        }),
      };

      const stats = await benchmark(() => {
        freshRegistry.register(parser, 50);
      }, 1000);

      expect(stats.avg).toBeLessThan(REGISTRY_LOOKUP_THRESHOLD_MS);
      // eslint-disable-next-line no-console
      console.log(
        `[Registry.register] avg=${stats.avg.toFixed(4)}ms median=${stats.median.toFixed(4)}ms min=${stats.min.toFixed(4)}ms max=${stats.max.toFixed(4)}ms`,
      );
    });

    it('should unregister a parser within 5ms threshold', async () => {
      const freshRegistry = new ParserRegistry();
      const parser = {
        name: 'removable-parser',
        description: 'Removable parser',
        extensions: [],
        canParse: () => true,
        parse: async () => ({
          id: 'removable',
          displayName: 'Removable',
          version: '1.0.0',
          author: { name: 'Test' },
          mode: 'dark' as const,
          colors: {},
          images: {},
          agentCss: {},
          sourceFormat: 'test',
        }),
      };

      freshRegistry.register(parser, 50);

      const stats = await benchmark(() => {
        freshRegistry.unregister('removable-parser');
        freshRegistry.register(parser, 50);
      }, 1000);

      expect(stats.avg).toBeLessThan(REGISTRY_LOOKUP_THRESHOLD_MS);
      // eslint-disable-next-line no-console
      console.log(
        `[Registry.unregister] avg=${stats.avg.toFixed(4)}ms median=${stats.median.toFixed(4)}ms min=${stats.min.toFixed(4)}ms max=${stats.max.toFixed(4)}ms`,
      );
    });
  });
});

// ---------------------------------------------------------------------------
// 3. End-to-End Import Performance Tests
// ---------------------------------------------------------------------------

describe('End-to-End Import Performance', () => {
  let registry: ParserRegistry;

  beforeEach(() => {
    registry = new ParserRegistry();
    registry.register(agentskinBuiltParser, 5);
    registry.register(codedrobeParser, 10);
    registry.register(dreamskinParser, 20);
    registry.register(sourceDirectoryParser, 100);
  });

  /**
   * Simulates the full import pipeline:
   * 1. Find the correct parser via registry
   * 2. Parse the source into IR
   * 3. Normalize (validate IR structure)
   * 4. Package (construct a minimal package descriptor)
   */
  async function simulateImportPipeline(source: ParserSource): Promise<{
    id: string;
    displayName: string;
    sourceFormat: string;
  }> {
    // Step 1: Find parser
    const parser = await registry.findParser(source);
    if (!parser) {
      throw new Error('No parser found for source');
    }

    // Step 2: Parse into IR
    const ir = await parser.parse(source);

    // Step 3: Normalize — validate required fields
    if (!ir.id || !ir.displayName) {
      throw new Error('Invalid IR: missing required fields');
    }

    // Step 4: Package — construct a minimal package descriptor
    const packageDescriptor = {
      id: ir.id,
      displayName: ir.displayName,
      sourceFormat: ir.sourceFormat,
    };

    return packageDescriptor;
  }

  it('should complete codedrobe import within 200ms threshold', async () => {
    const source = buildCodedrobeSource();
    const stats = await benchmark(() => simulateImportPipeline(source));

    expect(stats.avg).toBeLessThan(E2E_THRESHOLD_MS);
    // eslint-disable-next-line no-console
    console.log(
      `[E2E/codedrobe] avg=${stats.avg.toFixed(3)}ms median=${stats.median.toFixed(3)}ms min=${stats.min.toFixed(3)}ms max=${stats.max.toFixed(3)}ms`,
    );
  });

  it('should complete dreamskin import within 200ms threshold', async () => {
    const source = buildDreamskinSource();
    const stats = await benchmark(() => simulateImportPipeline(source));

    expect(stats.avg).toBeLessThan(E2E_THRESHOLD_MS);
    // eslint-disable-next-line no-console
    console.log(
      `[E2E/dreamskin] avg=${stats.avg.toFixed(3)}ms median=${stats.median.toFixed(3)}ms min=${stats.min.toFixed(3)}ms max=${stats.max.toFixed(3)}ms`,
    );
  });

  it('should complete agentskin import within 200ms threshold', async () => {
    const source = buildAgentskinSource();
    const stats = await benchmark(() => simulateImportPipeline(source));

    expect(stats.avg).toBeLessThan(E2E_THRESHOLD_MS);
    // eslint-disable-next-line no-console
    console.log(
      `[E2E/agentskin] avg=${stats.avg.toFixed(3)}ms median=${stats.median.toFixed(3)}ms min=${stats.min.toFixed(3)}ms max=${stats.max.toFixed(3)}ms`,
    );
  });

  it('should complete source-directory import within 200ms threshold', async () => {
    const source = buildSourceDirectorySource();
    const stats = await benchmark(() => simulateImportPipeline(source));

    expect(stats.avg).toBeLessThan(E2E_THRESHOLD_MS);
    // eslint-disable-next-line no-console
    console.log(
      `[E2E/source-directory] avg=${stats.avg.toFixed(3)}ms median=${stats.median.toFixed(3)}ms min=${stats.min.toFixed(3)}ms max=${stats.max.toFixed(3)}ms`,
    );
  });
});
