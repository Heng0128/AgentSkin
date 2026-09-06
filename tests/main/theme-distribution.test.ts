// SPDX-License-Identifier: MIT
//
// # theme-distribution.test.ts — unit tests for the Theme Distribution Protocol.
//
// Validates the public exports:
//   - generateManifest: produces a DistributionManifest from a bundle file.
//   - verifyIntegrity: verifies SHA-256 integrity of a bundle.
//   - computeSha256: computes SHA-256 hex digest of a file.
//   - parseDeepLink: parses agentskin:// deep-link URLs.
//   - generateDeepLink: constructs agentskin:// deep-link URLs.
//   - ThemeDistribution: class facade wrapping all functions.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  computeSha256,
  generateDeepLink,
  generateManifest,
  parseDeepLink,
  SUPPORTED_AGENTS,
  ThemeDistribution,
  verifyIntegrity,
} from '../../scripts/lib/theme-distribution.mjs';

// ---------------------------------------------------------------------------
// Test fixtures — temporary directory
// ---------------------------------------------------------------------------

let tempDir: string;

beforeEach(() => {
  tempDir = join(tmpdir(), `theme-dist-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

/** A valid theme manifest JSON for testing. */
const VALID_MANIFEST = {
  id: 'test-theme',
  displayName: 'Test Theme',
  version: '1.2.0',
  author: { name: 'TestAuthor' },
  supportedAgents: ['traework', 'codex', 'doubao'],
};

/** Write a file with given content and return its absolute path. */
function writeFixture(filename: string, content: string | object): string {
  const filePath = join(tempDir, filename);
  const data = typeof content === 'string' ? content : JSON.stringify(content);
  writeFileSync(filePath, data);
  return filePath;
}

// ---------------------------------------------------------------------------
// 1. computeSha256
// ---------------------------------------------------------------------------

describe('computeSha256', () => {
  it('produces a valid 64-character lowercase hex string for a known file', async () => {
    const filePath = writeFixture('hello.txt', 'AgentSkin');
    const hash = await computeSha256(filePath);

    expect(hash).toBeTypeOf('string');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces a deterministic hash for identical file content', async () => {
    const filePath1 = writeFixture('dup1.txt', 'duplicate content');
    const filePath2 = writeFixture('dup2.txt', 'duplicate content');

    const hash1 = await computeSha256(filePath1);
    const hash2 = await computeSha256(filePath2);
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different file content', async () => {
    const hash1 = await computeSha256(writeFixture('a.txt', 'content-A'));
    const hash2 = await computeSha256(writeFixture('b.txt', 'content-B'));
    expect(hash1).not.toBe(hash2);
  });

  it('throws when the file does not exist', async () => {
    await expect(computeSha256(join(tempDir, 'nonexistent.file'))).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 2. verifyIntegrity
// ---------------------------------------------------------------------------

describe('verifyIntegrity', () => {
  it('returns true when the SHA-256 matches the expected digest', async () => {
    const filePath = writeFixture('bundle.txt', 'bundle-data');
    const expected = await computeSha256(filePath);
    const result = await verifyIntegrity(filePath, expected);
    expect(result).toBe(true);
  });

  it('returns false when the SHA-256 does not match', async () => {
    const filePath = writeFixture('bundle.txt', 'bundle-data');
    const wrongHash = 'a'.repeat(64);
    const result = await verifyIntegrity(filePath, wrongHash);
    expect(result).toBe(false);
  });

  it('returns false when the expected hash has wrong length', async () => {
    const filePath = writeFixture('bundle.txt', 'bundle-data');
    const result = await verifyIntegrity(filePath, 'deadbeef');
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. generateManifest — structural correctness
// ---------------------------------------------------------------------------

describe('generateManifest', () => {
  it('returns a complete DistributionManifest for a valid JSON manifest file', async () => {
    const filePath = writeFixture('manifest.json', VALID_MANIFEST);
    const manifest = await generateManifest(filePath);

    expect(manifest).toHaveProperty('version');
    expect(manifest).toHaveProperty('themeId');
    expect(manifest).toHaveProperty('themeName');
    expect(manifest).toHaveProperty('author');
    expect(manifest).toHaveProperty('sha256');
    expect(manifest).toHaveProperty('size');
    expect(manifest).toHaveProperty('createdAt');
    expect(manifest).toHaveProperty('agents');

    expect(manifest.themeId).toBe('test-theme');
    expect(manifest.themeName).toBe('Test Theme');
    expect(manifest.author).toBe('TestAuthor');
    expect(manifest.version).toBe('1.2.0');
  });

  it('extracts supported agents and filters unsupported ones', async () => {
    const filePath = writeFixture('manifest.json', {
      ...VALID_MANIFEST,
      supportedAgents: ['traework', 'unknown-agent', 'codex'],
    });
    const manifest = await generateManifest(filePath);

    expect(manifest.agents).toContain('traework');
    expect(manifest.agents).toContain('codex');
    expect(manifest.agents).not.toContain('unknown-agent');
  });

  it('populates sha256 as a valid hex digest', async () => {
    const filePath = writeFixture('manifest.json', VALID_MANIFEST);
    const manifest = await generateManifest(filePath);

    expect(manifest.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reports the correct file size in bytes', async () => {
    const content = 'Hello, AgentSkin Distribution!';
    const filePath = writeFixture('sized.txt', content);
    const manifest = await generateManifest(filePath);

    expect(manifest.size).toBe(Buffer.byteLength(content, 'utf8'));
  });

  it('includes a valid ISO-8601 createdAt timestamp', async () => {
    const filePath = writeFixture('manifest.json', VALID_MANIFEST);
    const manifest = await generateManifest(filePath);

    expect(() => new Date(manifest.createdAt)).not.toThrow();
    expect(Number.isNaN(Date.parse(manifest.createdAt))).toBe(false);
  });

  it('uses the filename (sans extension) as themeId when JSON parsing fails', async () => {
    const filePath = writeFixture('broken.json', '{ not valid json }');
    const manifest = await generateManifest(filePath);

    expect(manifest.themeId).toBe('broken');
    expect(manifest.themeName).toBe('broken');
  });

  it('defaults to all supported agents when none specified', async () => {
    const filePath = writeFixture('manifest.json', {
      id: 'minimal-theme',
      version: '1.0.0',
    });
    const manifest = await generateManifest(filePath);

    expect(manifest.agents).toEqual([...SUPPORTED_AGENTS]);
  });

  it('defaults author to "unknown" when missing from manifest', async () => {
    const filePath = writeFixture('manifest.json', { id: 'no-author' });
    const manifest = await generateManifest(filePath);

    expect(manifest.author).toBe('unknown');
  });

  it('throws when the bundle file does not exist', async () => {
    await expect(generateManifest(join(tempDir, 'ghost.json'))).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 4. generateDeepLink
// ---------------------------------------------------------------------------

describe('generateDeepLink', () => {
  it('generates a valid deep link with themeId only (no agent)', () => {
    const link = generateDeepLink('midnight-dessert-feast');

    expect(link).toBe('agentskin:///themes/apply?theme=midnight-dessert-feast');
  });

  it('generates a valid deep link with both themeId and agent', () => {
    const link = generateDeepLink('midnight-dessert-feast', 'traework');

    expect(link).toBe('agentskin:///themes/apply?theme=midnight-dessert-feast&app=traework');
  });

  it('URL-encodes special characters in themeId', () => {
    const link = generateDeepLink('my theme & co');

    expect(link).toBe('agentskin:///themes/apply?theme=my+theme+%26+co');
  });

  it('URL-encodes special characters in agent', () => {
    const link = generateDeepLink('theme-id', 'agent with space');

    expect(link).toContain('app=agent+with+space');
  });
});

// ---------------------------------------------------------------------------
// 5. parseDeepLink
// ---------------------------------------------------------------------------

describe('parseDeepLink', () => {
  it('parses a deep link with themeId and agent', () => {
    const result = parseDeepLink('agentskin:///themes/apply?theme=test-theme&app=codex');

    expect(result).toEqual({
      action: 'themes/apply',
      themeId: 'test-theme',
      agent: 'codex',
    });
  });

  it('parses a deep link with themeId only (agent is undefined)', () => {
    const result = parseDeepLink('agentskin:///themes/apply?theme=test-theme');

    expect(result.action).toBe('themes/apply');
    expect(result.themeId).toBe('test-theme');
    expect(result.agent).toBeUndefined();
  });

  it('preserves URL-encoded themeId', () => {
    const result = parseDeepLink('agentskin:///themes/apply?theme=my+theme+%26+co');

    expect(result.themeId).toBe('my theme & co');
  });

  it('throws on an invalid scheme', () => {
    expect(() => parseDeepLink('https://themes/apply?theme=test')).toThrow(/Invalid scheme/);
  });

  it('throws when the theme query parameter is missing', () => {
    expect(() => parseDeepLink('agentskin:///themes/apply?app=traework')).toThrow(
      /Missing required 'theme'/,
    );
  });
});

// ---------------------------------------------------------------------------
// 6. ThemeDistribution class facade
// ---------------------------------------------------------------------------

describe('ThemeDistribution class facade', () => {
  it('generateManifest delegates to the standalone function', async () => {
    const filePath = writeFixture('manifest.json', VALID_MANIFEST);
    const manifest = await ThemeDistribution.generateManifest(filePath);

    expect(manifest.themeId).toBe('test-theme');
    expect(manifest.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verifyIntegrity delegates to the standalone function', async () => {
    const filePath = writeFixture('bundle.txt', 'facade-test');
    const hash = await computeSha256(filePath);
    const result = await ThemeDistribution.verifyIntegrity(filePath, hash);

    expect(result).toBe(true);
  });

  it('parseDeepLink delegates to the standalone function', () => {
    const result = ThemeDistribution.parseDeepLink(
      'agentskin:///themes/apply?theme=facade&app=doubao',
    );

    expect(result.themeId).toBe('facade');
    expect(result.agent).toBe('doubao');
  });

  it('generateDeepLink delegates to the standalone function', () => {
    const link = ThemeDistribution.generateDeepLink('facade-theme', 'zcode');

    expect(link).toBe('agentskin:///themes/apply?theme=facade-theme&app=zcode');
  });
});

// ---------------------------------------------------------------------------
// 7. Round-trip: generate then parse deep link
// ---------------------------------------------------------------------------

describe('deep-link round-trip', () => {
  it('parseDeepLink recovers the original themeId and agent from generateDeepLink', () => {
    const themeId = 'galactic-garden';
    const agent = 'workbuddy';

    const link = generateDeepLink(themeId, agent);
    const parsed = parseDeepLink(link);

    expect(parsed.themeId).toBe(themeId);
    expect(parsed.agent).toBe(agent);
    expect(parsed.action).toBe('themes/apply');
  });

  it('round-trip works without an agent', () => {
    const themeId = 'void-donut-boy';

    const link = generateDeepLink(themeId);
    const parsed = parseDeepLink(link);

    expect(parsed.themeId).toBe(themeId);
    expect(parsed.agent).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 8. Constants
// ---------------------------------------------------------------------------

describe('SUPPORTED_AGENTS constant', () => {
  it('contains exactly 6 agent IDs', () => {
    expect(SUPPORTED_AGENTS).toHaveLength(6);
  });

  it('includes all expected adapters', () => {
    expect(SUPPORTED_AGENTS).toContain('traework');
    expect(SUPPORTED_AGENTS).toContain('qoderwork');
    expect(SUPPORTED_AGENTS).toContain('workbuddy');
    expect(SUPPORTED_AGENTS).toContain('doubao');
    expect(SUPPORTED_AGENTS).toContain('codex');
    expect(SUPPORTED_AGENTS).toContain('zcode');
  });
});
